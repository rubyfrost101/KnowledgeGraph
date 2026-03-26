from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone

from app.models import (
    GraphNeighborhood,
    IngestRequest,
    IngestResponse,
    KnowledgeDocument,
    KnowledgeEdge,
    KnowledgeGraphData,
    KnowledgeNode,
    QARequest,
    QAResponse,
    SearchHit,
    SearchResponse,
    UploadIngestResponse,
)
from app.services.extraction import extract_text_from_upload
from app.services.ingestion import ingest_text
from app.services.normalization import canonical_text
from app.services.qa import answer_question
from app.services.sample_data import build_demo_graph


class InMemoryGraphStore:
    def __init__(self) -> None:
        self._graph = build_demo_graph()

    def snapshot(self) -> KnowledgeGraphData:
        return deepcopy(self._graph)

    def node_by_id(self, node_id: str) -> KnowledgeNode | None:
        return next((node for node in self._graph.nodes if node.id == node_id), None)

    def search(self, query: str) -> SearchResponse:
        needle = canonical_text(query)
        hits: list[SearchHit] = []
        if not needle:
            return SearchResponse(query=query, hits=[])

        for node in self._graph.nodes:
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
        related_edges = [edge for edge in self._graph.edges if edge.source == node_id or edge.target == node_id]
        node_ids = {node_id}
        for edge in related_edges:
            node_ids.add(edge.source)
            node_ids.add(edge.target)
        return GraphNeighborhood(center_id=node_id, node_ids=sorted(node_ids), edge_ids=[edge.id for edge in related_edges])

    def ingest(self, request: IngestRequest) -> IngestResponse:
        document, graph, summary = ingest_text(request)
        self._merge_graph(graph)
        return IngestResponse(document=document, graph=self.snapshot(), summary=summary)

    def enqueue_upload(self, filename: str, content_type: str | None, data: bytes, title: str | None, origin: str):
        from app.models import JobStatusResponse
        from uuid import uuid4

        document = KnowledgeDocument(
            id=f"doc-{uuid4().hex}",
            title=title or filename,
            type="text",
            origin=origin,
            imported_at=datetime.now(timezone.utc).isoformat(),
            notes="Processed inline in memory store",
        )
        request = IngestRequest(title=document.title, text=data.decode("utf-8", errors="ignore"), origin=origin, source_type="text", document_id=document.id)
        ingested_document, graph, summary = ingest_text(request)
        self._merge_graph(graph)
        return JobStatusResponse(
            job_id=f"job-{uuid4().hex}",
            document_id=ingested_document.id,
            filename=filename,
            kind="upload",
            status="completed",
            progress=100,
            summary=summary,
            error=None,
            created_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    def get_job(self, job_id: str):
        from app.models import JobStatusResponse

        return JobStatusResponse(
            job_id=job_id,
            document_id="",
            filename="",
            kind="upload",
            status="completed",
            progress=100,
            summary="In-memory jobs are immediate.",
            error=None,
            created_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    def list_jobs(self, limit: int = 8):
        return []

    def process_upload_job(self, job_id: str) -> None:
        return None

    def delete_document(self, document_id: str):
        from app.models import MutationResponse

        self._graph.documents = [document for document in self._graph.documents if document.id != document_id]
        for node in self._graph.nodes:
            node.sources = [source for source in node.sources if source != document_id]
        for edge in self._graph.edges:
            edge.sources = [source for source in edge.sources if source != document_id]
        self._graph.nodes = [node for node in self._graph.nodes if node.sources]
        self._graph.edges = [edge for edge in self._graph.edges if edge.sources]
        return MutationResponse(ok=True, message="Document deleted", graph=self.snapshot())

    def restore_document(self, document_id: str):
        from app.models import MutationResponse

        return MutationResponse(ok=False, message="Restore is not supported in memory store", graph=self.snapshot())

    def delete_node(self, node_id: str, reason: str | None = None):
        from app.models import MutationResponse

        self._graph.nodes = [node for node in self._graph.nodes if node.id != node_id]
        self._graph.edges = [edge for edge in self._graph.edges if edge.source != node_id and edge.target != node_id]
        return MutationResponse(ok=True, message="Node deleted", graph=self.snapshot())

    def restore_node(self, node_id: str):
        from app.models import MutationResponse

        return MutationResponse(ok=False, message="Restore is not supported in memory store", graph=self.snapshot())

    async def ingest_upload(self, file, title: str | None = None, origin: str = "upload") -> UploadIngestResponse:
        text, page_count, source_type = await extract_text_from_upload(file)
        request = IngestRequest(title=title or file.filename, text=text, origin=origin, source_type=source_type)
        document, graph, summary = ingest_text(request)
        if page_count is not None:
            document.page_count = page_count
        self._merge_graph(graph)
        return UploadIngestResponse(
            filename=file.filename or origin,
            page_count=page_count,
            document=document,
            graph=self.snapshot(),
            summary=summary,
        )

    def answer(self, request: QARequest) -> QAResponse:
        return answer_question(self._graph, request)

    def _merge_graph(self, incoming: KnowledgeGraphData) -> None:
        node_map: dict[str, KnowledgeNode] = {node.id: deepcopy(node) for node in self._graph.nodes}
        edge_map: dict[str, KnowledgeEdge] = {edge.id: deepcopy(edge) for edge in self._graph.edges}
        document_map: dict[str, KnowledgeDocument] = {document.id: deepcopy(document) for document in self._graph.documents}

        for node in incoming.nodes:
            node_map[node.id] = deepcopy(node)
        for edge in incoming.edges:
            edge_map[edge.id] = deepcopy(edge)
        for document in incoming.documents:
            document_map[document.id] = deepcopy(document)

        self._graph = KnowledgeGraphData(
            nodes=list(node_map.values()),
            edges=list(edge_map.values()),
            documents=list(document_map.values()),
        )


def build_store():
    try:
        from app.services.persistent_store import PersistentGraphStore

        return PersistentGraphStore()
    except Exception:
        return InMemoryGraphStore()


STORE = build_store()
