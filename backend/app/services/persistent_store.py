from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4
import hashlib

from neo4j import GraphDatabase
from pydantic import TypeAdapter
from redis import Redis
from rq import Queue
from sqlalchemy import delete, desc, select

from app.core.config import get_settings
from app.db.models import (
    DocumentBlobORM,
    DocumentORM,
    GraphJobORM,
    GraphRevisionORM,
    KnowledgeEdgeORM,
    KnowledgeNodeORM,
)
from app.db.session import init_db, session_scope
from app.models import (
    GraphNeighborhood,
    ImportedKnowledgeBatch,
    IngestRequest,
    IngestResponse,
    JobStatusResponse,
    KnowledgeDocument,
    KnowledgeEdge,
    KnowledgeGraphData,
    KnowledgeNode,
    MutationResponse,
    QARequest,
    QAResponse,
    SearchHit,
    SearchResponse,
    UploadIngestResponse,
)
from app.services.extraction import ExtractionError, ExtractionResult, extract_text_from_bytes
from app.services.graph_merge import merge_graph_data
from app.services.ingestion import ingest_text
from app.services.normalization import canonical_text, unique_list
from app.services.qa import answer_question
from app.services.sample_data import build_demo_graph


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _doc_to_model(row: DocumentORM) -> KnowledgeDocument:
    return KnowledgeDocument(
        id=row.id,
        title=row.title,
        type=row.type,  # type: ignore[arg-type]
        origin=row.origin,
        imported_at=row.imported_at.isoformat(),
        status=row.status,  # type: ignore[arg-type]
        page_count=row.page_count,
        notes=row.notes,
        deleted_at=row.deleted_at.isoformat() if row.deleted_at else None,
    )


def _node_to_model(row: KnowledgeNodeORM) -> KnowledgeNode:
    return KnowledgeNode(
        id=row.id,
        label=row.label,
        kind=row.kind,  # type: ignore[arg-type]
        category=row.category,
        summary=row.summary,
        detail=row.detail,
        aliases=list(row.aliases or []),
        sources=list(row.sources or []),
        score=row.score,
        deleted_at=row.deleted_at.isoformat() if row.deleted_at else None,
        deleted_reason=row.deleted_reason,
    )


def _edge_to_model(row: KnowledgeEdgeORM) -> KnowledgeEdge:
    return KnowledgeEdge(
        id=row.id,
        source=row.source,
        target=row.target,
        kind=row.kind,  # type: ignore[arg-type]
        label=row.label,
        weight=row.weight,
        sources=list(row.sources or []),
    )


class Neo4jProjector:
    def __init__(self) -> None:
        settings = get_settings()
        self._settings = settings
        self._driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )

    def replace_graph(self, graph: KnowledgeGraphData, graph_id: str = "default") -> None:
        with self._driver.session() as session:
            session.run(
                "MATCH (n:KnowledgeNode {graph_id: $graph_id}) DETACH DELETE n",
                graph_id=graph_id,
            )
            for node in graph.nodes:
                session.run(
                    """
                    MERGE (n:KnowledgeNode {graph_id: $graph_id, id: $id})
                    SET n.label = $label,
                        n.kind = $kind,
                        n.category = $category,
                        n.summary = $summary,
                        n.detail = $detail,
                        n.score = $score,
                        n.sources = $sources
                    """,
                    graph_id=graph_id,
                    id=node.id,
                    label=node.label,
                    kind=node.kind,
                    category=node.category,
                    summary=node.summary,
                    detail=node.detail,
                    score=node.score,
                    sources=node.sources,
                )

            for edge in graph.edges:
                session.run(
                    """
                    MATCH (a:KnowledgeNode {graph_id: $graph_id, id: $source})
                    MATCH (b:KnowledgeNode {graph_id: $graph_id, id: $target})
                    MERGE (a)-[r:KNOWS {graph_id: $graph_id, id: $id}]->(b)
                    SET r.kind = $kind,
                        r.label = $label,
                        r.weight = $weight,
                        r.sources = $sources
                    """,
                    graph_id=graph_id,
                    id=edge.id,
                    source=edge.source,
                    target=edge.target,
                    kind=edge.kind,
                    label=edge.label,
                    weight=edge.weight,
                    sources=edge.sources,
                )


class PersistentGraphStore:
    def __init__(self) -> None:
        settings = get_settings()
        self.settings = settings
        init_db()
        self.neo4j = Neo4jProjector()
        self.redis = Redis.from_url(settings.redis_url)
        self.queue = Queue(settings.queue_name, connection=self.redis)
        self._seed_if_empty()

    def snapshot(self) -> KnowledgeGraphData:
        with session_scope() as session:
            documents = [
                _doc_to_model(row)
                for row in session.scalars(
                    select(DocumentORM).where(DocumentORM.deleted_at.is_(None), DocumentORM.status == "active")
                ).all()
            ]
            nodes = [
                _node_to_model(row)
                for row in session.scalars(select(KnowledgeNodeORM).where(KnowledgeNodeORM.deleted_at.is_(None))).all()
            ]
            edges = [
                _edge_to_model(row)
                for row in session.scalars(select(KnowledgeEdgeORM).where(KnowledgeEdgeORM.deleted_at.is_(None))).all()
            ]
        return KnowledgeGraphData(nodes=nodes, edges=edges, documents=documents)

    def list_documents(self, include_deleted: bool = False) -> list[KnowledgeDocument]:
        with session_scope() as session:
            query = select(DocumentORM).order_by(desc(DocumentORM.imported_at))
            if not include_deleted:
                query = query.where(DocumentORM.deleted_at.is_(None))
            rows = session.scalars(query).all()
            return [_doc_to_model(row) for row in rows]

    def list_nodes(self, include_deleted: bool = False) -> list[KnowledgeNode]:
        with session_scope() as session:
            query = select(KnowledgeNodeORM).order_by(KnowledgeNodeORM.label.asc())
            if not include_deleted:
                query = query.where(KnowledgeNodeORM.deleted_at.is_(None))
            rows = session.scalars(query).all()
            return [_node_to_model(row) for row in rows]

    def node_by_id(self, node_id: str) -> KnowledgeNode | None:
        with session_scope() as session:
            row = session.get(KnowledgeNodeORM, node_id)
            if row is None or row.deleted_at is not None:
                return None
            return _node_to_model(row)

    def search(self, query: str) -> SearchResponse:
        needle = canonical_text(query)
        if not needle:
            return SearchResponse(query=query, hits=[])

        graph = self.snapshot()
        hits: list[SearchHit] = []
        for node in graph.nodes:
            score = 0.0
            label = canonical_text(node.label)
            summary = canonical_text(node.summary)
            detail = canonical_text(node.detail)
            if label == needle:
                score += 100
            elif needle in label:
                score += 60
            if any(needle in canonical_text(alias) for alias in node.aliases):
                score += 40
            if needle in summary:
                score += 20
            if needle in detail:
                score += 10
            if score > 0:
                hits.append(SearchHit(node=node, score=score))
        hits.sort(key=lambda item: item.score, reverse=True)
        return SearchResponse(query=query, hits=hits[:10])

    def neighborhood(self, node_id: str) -> GraphNeighborhood:
        graph = self.snapshot()
        related_edges = [edge for edge in graph.edges if edge.source == node_id or edge.target == node_id]
        node_ids = {node_id}
        for edge in related_edges:
            node_ids.add(edge.source)
            node_ids.add(edge.target)
        return GraphNeighborhood(center_id=node_id, node_ids=sorted(node_ids), edge_ids=[edge.id for edge in related_edges])

    def ingest(self, request: IngestRequest) -> IngestResponse:
        document, incoming_graph, summary = ingest_text(request)
        self._save_revision(document.id, "import", incoming_graph)
        merged = merge_graph_data(self.snapshot(), ImportedKnowledgeBatch(**incoming_graph.model_dump()))
        self._persist_snapshot(merged)
        return IngestResponse(document=document, graph=self.snapshot(), summary=summary)

    def enqueue_upload(self, filename: str, content_type: str | None, data: bytes, title: str | None, origin: str) -> JobStatusResponse:
        document_id = f"doc-{uuid4().hex}"
        job_id = f"job-{uuid4().hex}"
        sha256 = hashlib.sha256(data).hexdigest()
        with session_scope() as session:
            document = DocumentORM(
                id=document_id,
                title=title or filename,
                type="text",
                origin=origin,
                imported_at=_now(),
                page_count=None,
                notes="Queued for background processing",
                status="queued",
                deleted_at=None,
            )
            session.add(document)
            session.flush()
            session.add(
                DocumentBlobORM(
                    document_id=document_id,
                    filename=filename,
                    content_type=content_type,
                    data=data,
                    sha256=sha256,
                    created_at=_now(),
                )
            )
            session.add(
                GraphJobORM(
                    id=job_id,
                    document_id=document_id,
                    filename=filename,
                    kind="upload",
                    status="queued",
                    progress=0,
                    summary=None,
                    error=None,
                    created_at=_now(),
                    updated_at=_now(),
                )
            )

        try:
            from app.tasks import process_upload_job

            self.queue.enqueue(process_upload_job, job_id, job_id=job_id, result_ttl=0)
        except Exception:
            self.process_upload_job(job_id)

        return self.get_job(job_id)

    def get_job(self, job_id: str) -> JobStatusResponse:
        with session_scope() as session:
            job = session.get(GraphJobORM, job_id)
            if job is None:
                raise KeyError(f"Job not found: {job_id}")
            return self._job_to_model(job)

    def list_jobs(self, limit: int = 8) -> list[JobStatusResponse]:
        with session_scope() as session:
            rows = session.scalars(
                select(GraphJobORM)
                .order_by(desc(GraphJobORM.updated_at), desc(GraphJobORM.created_at))
                .limit(limit)
            ).all()
            return [self._job_to_model(row) for row in rows]

    def process_upload_job(self, job_id: str) -> None:
        with session_scope() as session:
            job = session.get(GraphJobORM, job_id)
            if job is None:
                raise KeyError(f"Job not found: {job_id}")
            blob = session.get(DocumentBlobORM, job.document_id)
            document = session.get(DocumentORM, job.document_id)
            if blob is None or document is None:
                raise KeyError(f"Document payload not found for job: {job_id}")
            job.status = "running"
            job.progress = 8
            job.summary = "正在读取原始文件"
            job.error = None
            job.updated_at = _now()
            document.status = "running"

        try:
            self._update_job(job_id, progress=18, summary="正在提取文本")
            extraction = extract_text_from_bytes(blob.filename, blob.content_type, blob.data)
            stage_summary = "正在分段解析章节与术语"
            if extraction.used_ocr:
                stage_summary += "，已启用 OCR"
            self._update_job(job_id, progress=36, summary=stage_summary)
            request = IngestRequest(
                title=document.title,
                text=extraction.text,
                origin=document.origin,
                source_type=extraction.source_type,  # type: ignore[arg-type]
                document_id=document.id,
            )
            document_model, incoming_graph, summary = ingest_text(request)
            if extraction.page_count is not None:
                document_model.page_count = extraction.page_count
            if extraction.used_ocr:
                document_model.notes = (document_model.notes or "") + " OCR fallback used."
            self._update_job(job_id, progress=62, summary="正在合并跨书知识与去重")
            self._save_revision(document.id, "import", incoming_graph)
            merged = merge_graph_data(self.snapshot(), ImportedKnowledgeBatch(**incoming_graph.model_dump()))
            self._update_job(job_id, progress=86, summary="正在写入图数据库与持久层")
            self._persist_snapshot(merged)
            with session_scope() as session:
                job = session.get(GraphJobORM, job_id)
                document_row = session.get(DocumentORM, document.id)
                if job is not None:
                    job.status = "completed"
                    job.progress = 100
                    job.summary = summary
                    job.error = None
                    job.updated_at = _now()
                if document_row is not None:
                    document_row.title = document_model.title
                    document_row.type = document_model.type
                    document_row.origin = document_model.origin
                    document_row.imported_at = _now()
                    document_row.page_count = document_model.page_count
                    document_row.notes = document_model.notes
                    document_row.status = "active"
                    document_row.deleted_at = None
            self._sync_projection()
        except Exception as error:
            with session_scope() as session:
                job = session.get(GraphJobORM, job_id)
                document_row = session.get(DocumentORM, document.id)
                if job is not None:
                    job.status = "failed"
                    job.error = str(error)
                    job.updated_at = _now()
                if document_row is not None:
                    document_row.status = "failed"
            raise

    def delete_document(self, document_id: str) -> MutationResponse:
        with session_scope() as session:
            document = session.get(DocumentORM, document_id)
            if document is None or document.deleted_at is not None:
                return MutationResponse(ok=False, message="Document not found or already deleted")
            document.deleted_at = _now()
            document.status = "deleted"
            for node in session.scalars(select(KnowledgeNodeORM).where(KnowledgeNodeORM.deleted_at.is_(None))).all():
                if document_id in (node.sources or []):
                    node.sources = [source for source in node.sources if source != document_id]
                    if not node.sources:
                        node.deleted_at = _now()
                        node.deleted_reason = f"Removed by document {document_id} deletion"
            for edge in session.scalars(select(KnowledgeEdgeORM).where(KnowledgeEdgeORM.deleted_at.is_(None))).all():
                if document_id in (edge.sources or []):
                    edge.sources = [source for source in edge.sources if source != document_id]
                    if not edge.sources:
                        edge.deleted_at = _now()
                        edge.deleted_reason = f"Removed by document {document_id} deletion"
            session.add(
                GraphRevisionORM(
                    document_id=document_id,
                    action="delete",
                    payload={"document_id": document_id},
                    created_at=_now(),
                )
            )
        self._sync_projection()
        return MutationResponse(ok=True, message="Document deleted", graph=self.snapshot())

    def restore_document(self, document_id: str) -> MutationResponse:
        with session_scope() as session:
            revision = session.scalars(
                select(GraphRevisionORM)
                .where(GraphRevisionORM.document_id == document_id, GraphRevisionORM.action == "import")
                .order_by(desc(GraphRevisionORM.id))
            ).first()
            document = session.get(DocumentORM, document_id)
            if revision is None or document is None:
                return MutationResponse(ok=False, message="No revision found for document")
            batch = ImportedKnowledgeBatch.model_validate(revision.payload)
            document.deleted_at = None
            document.status = "active"
        merged = merge_graph_data(self.snapshot(), batch)
        self._persist_snapshot(merged)
        self._sync_projection()
        return MutationResponse(ok=True, message="Document restored", graph=self.snapshot())

    def delete_node(self, node_id: str, reason: str | None = None) -> MutationResponse:
        with session_scope() as session:
            node = session.get(KnowledgeNodeORM, node_id)
            if node is None or node.deleted_at is not None:
                return MutationResponse(ok=False, message="Node not found or already deleted")
            node.deleted_at = _now()
            node.deleted_reason = reason or "Manual deletion"
            for edge in session.scalars(select(KnowledgeEdgeORM).where(KnowledgeEdgeORM.deleted_at.is_(None))).all():
                if edge.source == node_id or edge.target == node_id:
                    edge.deleted_at = _now()
                    edge.deleted_reason = f"Removed by node {node_id} deletion"
            session.add(
                GraphRevisionORM(
                    document_id=self._infer_document_id(node.sources),
                    action="delete-node",
                    payload={"node_id": node_id, "reason": reason},
                    created_at=_now(),
                )
            )
        self._sync_projection()
        return MutationResponse(ok=True, message="Node deleted", graph=self.snapshot())

    def restore_node(self, node_id: str) -> MutationResponse:
        response: MutationResponse
        with session_scope() as session:
            node = session.get(KnowledgeNodeORM, node_id)
            if node is None:
                return MutationResponse(ok=False, message="Node not found")
            if not node.sources:
                return MutationResponse(
                    ok=False,
                    message="This knowledge point has no remaining provenance. Restore the source document first.",
                    graph=self.snapshot(),
                )
            node.deleted_at = None
            node.deleted_reason = None
            for edge in session.scalars(select(KnowledgeEdgeORM)).all():
                if edge.source == node_id or edge.target == node_id:
                    edge.deleted_at = None
                    edge.deleted_reason = None
            response = MutationResponse(ok=True, message="Node restored")
        self._sync_projection()
        response.graph = self.snapshot()
        return response

    def answer(self, request: QARequest) -> QAResponse:
        return answer_question(self.snapshot(), request)

    def _infer_document_id(self, sources: list[str] | None) -> str:
        return sources[0] if sources else "manual"

    def _save_revision(self, document_id: str, action: str, graph: KnowledgeGraphData) -> None:
        with session_scope() as session:
            session.add(
                GraphRevisionORM(
                    document_id=document_id,
                    action=action,
                    payload=graph.model_dump(),
                    created_at=_now(),
                )
            )

    def _job_to_model(self, job: GraphJobORM) -> JobStatusResponse:
        return JobStatusResponse(
            job_id=job.id,
            document_id=job.document_id,
            filename=job.filename,
            kind=job.kind,
            status=job.status,  # type: ignore[arg-type]
            progress=job.progress,
            summary=job.summary,
            error=job.error,
            created_at=job.created_at.isoformat(),
            updated_at=job.updated_at.isoformat(),
        )

    def _update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        summary: str | None = None,
        error: str | None = None,
    ) -> None:
        with session_scope() as session:
            job = session.get(GraphJobORM, job_id)
            if job is None:
                return
            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = progress
            if summary is not None:
                job.summary = summary
            if error is not None:
                job.error = error
            job.updated_at = _now()

    def _persist_snapshot(self, graph: KnowledgeGraphData) -> None:
        with session_scope() as session:
            current_doc_ids = {document.id for document in graph.documents}
            current_node_ids = {node.id for node in graph.nodes}
            current_edge_ids = {edge.id for edge in graph.edges}

            for document in graph.documents:
                row = session.get(DocumentORM, document.id)
                if row is None:
                    row = DocumentORM(
                        id=document.id,
                        title=document.title,
                        type=document.type,
                        origin=document.origin,
                        imported_at=_now(),
                        page_count=document.page_count,
                        notes=document.notes,
                        status="active",
                        deleted_at=None,
                    )
                    session.add(row)
                else:
                    row.title = document.title
                    row.type = document.type
                    row.origin = document.origin
                    row.imported_at = _now()
                    row.page_count = document.page_count
                    row.notes = document.notes
                    row.status = "active"
                    row.deleted_at = None

            for row in session.scalars(select(DocumentORM)).all():
                if row.id not in current_doc_ids and row.deleted_at is None:
                    row.deleted_at = _now()
                    row.status = "deleted"

            for node in graph.nodes:
                row = session.get(KnowledgeNodeORM, node.id)
                if row is None:
                    row = KnowledgeNodeORM(
                        id=node.id,
                        label=node.label,
                        kind=node.kind,
                        category=node.category,
                        summary=node.summary,
                        detail=node.detail,
                        aliases=node.aliases,
                        sources=node.sources,
                        score=node.score,
                        deleted_at=None,
                        deleted_reason=None,
                    )
                    session.add(row)
                else:
                    row.label = node.label
                    row.kind = node.kind
                    row.category = node.category
                    row.summary = node.summary
                    row.detail = node.detail
                    row.aliases = node.aliases
                    row.sources = node.sources
                    row.score = node.score
                    row.deleted_at = None
                    row.deleted_reason = None

            for row in session.scalars(select(KnowledgeNodeORM)).all():
                if row.id not in current_node_ids and row.deleted_at is None:
                    row.deleted_at = _now()
                    row.deleted_reason = "Removed by snapshot sync"

            for edge in graph.edges:
                row = session.get(KnowledgeEdgeORM, edge.id)
                if row is None:
                    row = KnowledgeEdgeORM(
                        id=edge.id,
                        source=edge.source,
                        target=edge.target,
                        kind=edge.kind,
                        label=edge.label,
                        weight=edge.weight,
                        sources=edge.sources,
                        deleted_at=None,
                        deleted_reason=None,
                    )
                    session.add(row)
                else:
                    row.source = edge.source
                    row.target = edge.target
                    row.kind = edge.kind
                    row.label = edge.label
                    row.weight = edge.weight
                    row.sources = edge.sources
                    row.deleted_at = None
                    row.deleted_reason = None

            for row in session.scalars(select(KnowledgeEdgeORM)).all():
                if row.id not in current_edge_ids and row.deleted_at is None:
                    row.deleted_at = _now()
                    row.deleted_reason = "Removed by snapshot sync"

        self._sync_projection(graph)

    def _seed_if_empty(self) -> None:
        with session_scope() as session:
            has_documents = session.scalar(select(DocumentORM.id).limit(1)) is not None
        if not has_documents:
            self._persist_snapshot(build_demo_graph())

    def _sync_projection(self, graph: KnowledgeGraphData | None = None) -> None:
        try:
            self.neo4j.replace_graph(graph or self.snapshot())
        except Exception:
            # Neo4j is a projection layer; persistence must still succeed if it is temporarily unavailable.
            pass
