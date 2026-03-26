from __future__ import annotations

from app.services.store import build_store


def process_upload_job(job_id: str) -> None:
    store = build_store()
    if hasattr(store, "process_upload_job"):
        store.process_upload_job(job_id)
        return
    raise RuntimeError("Selected store does not support upload job processing")
