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
    deleted_at: str | None = None
    deleted_reason: str | None = None


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
    type: Literal["demo", "pdf", "text", "image"]
    origin: str
    imported_at: str
    status: Literal["active", "queued", "running", "failed", "deleted"] = "active"
    page_count: int | None = None
    notes: str | None = None
    deleted_at: str | None = None
    deleted_reason: str | None = None


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
    source_type: Literal["text", "pdf", "image", "demo"] = "text"
    document_id: str | None = None


class IngestResponse(BaseModel):
    document: KnowledgeDocument
    graph: KnowledgeGraphData
    summary: str


class ImportedKnowledgeBatch(BaseModel):
    nodes: list[KnowledgeNode]
    edges: list[KnowledgeEdge]
    documents: list[KnowledgeDocument]


class UploadIngestResponse(IngestResponse):
    filename: str
    page_count: int | None = None


class JobStatusResponse(BaseModel):
    job_id: str
    document_id: str
    filename: str
    kind: str
    status: Literal["queued", "running", "completed", "failed"]
    progress: int = 0
    summary: str | None = None
    error: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class MutationResponse(BaseModel):
    ok: bool
    message: str
    graph: KnowledgeGraphData | None = None


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
