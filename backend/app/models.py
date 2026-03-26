from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

KnowledgeKind = Literal["concept", "term", "process", "book", "topic"]
RelationKind = Literal[
    "is-a",
    "related-to",
    "contrast-with",
    "part-of",
    "depends-on",
    "mentions",
    "same-domain",
]


class KnowledgeNode(BaseModel):
    id: str
    label: str
    kind: KnowledgeKind
    category: str
    summary: str
    detail: str
    aliases: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    score: float = 1.0


class KnowledgeEdge(BaseModel):
    id: str
    source: str
    target: str
    kind: RelationKind
    label: str
    weight: float = 1.0
    sources: list[str] = Field(default_factory=list)


class KnowledgeDocument(BaseModel):
    id: str
    title: str
    type: Literal["demo", "pdf", "text"]
    origin: str
    imported_at: str
    page_count: int | None = None
    notes: str | None = None


class KnowledgeGraphData(BaseModel):
    nodes: list[KnowledgeNode]
    edges: list[KnowledgeEdge]
    documents: list[KnowledgeDocument]


class GraphNeighborhood(BaseModel):
    center_id: str
    node_ids: list[str]
    edge_ids: list[str]


class SearchHit(BaseModel):
    node: KnowledgeNode
    score: float


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]


class IngestRequest(BaseModel):
    title: str | None = None
    text: str
    origin: str = "upload"
    source_type: Literal["text", "pdf", "demo"] = "text"


class IngestResponse(BaseModel):
    document: KnowledgeDocument
    graph: KnowledgeGraphData
    summary: str


class UploadIngestResponse(IngestResponse):
    filename: str
    page_count: int | None = None


class QARequest(BaseModel):
    question: str
    graph_id: str = "default"
    context_node_id: str | None = None
    top_k: int = 5


class QAResponse(BaseModel):
    title: str
    answer: str
    supporting_nodes: list[KnowledgeNode]
    citations: list[str]
    confidence: float = 0.5
