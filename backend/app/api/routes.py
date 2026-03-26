from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.models import (
    IngestRequest,
    JobStatusResponse,
    KnowledgeDocument,
    KnowledgeNode,
    MutationResponse,
    QARequest,
    QAResponse,
)
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


@router.get("/documents", response_model=list[KnowledgeDocument])
def list_documents(include_deleted: bool = Query(default=False)):
    return STORE.list_documents(include_deleted=include_deleted)


@router.get("/nodes", response_model=list[KnowledgeNode])
def list_nodes(include_deleted: bool = Query(default=False)):
    return STORE.list_nodes(include_deleted=include_deleted)


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


@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    origin: str = Form(default="upload"),
):
    try:
        data = await file.read()
        return STORE.enqueue_upload(
            filename=file.filename or origin,
            content_type=file.content_type,
            data=data,
            title=title,
            origin=origin,
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str):
    try:
        return STORE.get_job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.delete("/documents/{document_id}", response_model=MutationResponse)
def delete_document(document_id: str):
    return STORE.delete_document(document_id)


@router.post("/documents/{document_id}/restore", response_model=MutationResponse)
def restore_document(document_id: str):
    return STORE.restore_document(document_id)


@router.delete("/nodes/{node_id}", response_model=MutationResponse)
def delete_node(node_id: str):
    return STORE.delete_node(node_id)


@router.post("/nodes/{node_id}/restore", response_model=MutationResponse)
def restore_node(node_id: str):
    return STORE.restore_node(node_id)


@router.post("/qa", response_model=QAResponse)
def qa(request: QARequest):
    if request.graph_id != "default":
        raise HTTPException(status_code=404, detail="Unknown graph")
    return STORE.answer(request)
