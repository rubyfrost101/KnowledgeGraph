from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models import IngestRequest, QARequest, QAResponse
from app.services.store import STORE

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str | int]:
    graph = STORE.snapshot()
    return {
        "status": "ok",
        "nodes": len(graph.nodes),
        "edges": len(graph.edges),
        "documents": len(graph.documents),
    }


@router.get("/graphs/{graph_id}")
def get_graph(graph_id: str):
    if graph_id != "default":
        raise HTTPException(status_code=404, detail="Unknown graph")
    return STORE.snapshot()


@router.get("/nodes/{node_id}")
def get_node(node_id: str):
    node = STORE.node_by_id(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.get("/nodes/{node_id}/neighborhood")
def get_neighborhood(node_id: str):
    if STORE.node_by_id(node_id) is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return STORE.neighborhood(node_id)


@router.get("/search")
def search(q: str):
    return STORE.search(q)


@router.post("/documents")
def ingest_document(request: IngestRequest):
    return STORE.ingest(request)


@router.post("/qa", response_model=QAResponse)
def qa(request: QARequest):
    if request.graph_id != "default":
        raise HTTPException(status_code=404, detail="Unknown graph")
    return STORE.answer(request)
