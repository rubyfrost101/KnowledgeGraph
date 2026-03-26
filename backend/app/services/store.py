from __future__ import annotations

from copy import deepcopy

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
)
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


STORE = InMemoryGraphStore()
