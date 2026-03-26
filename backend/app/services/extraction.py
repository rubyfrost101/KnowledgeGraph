from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader
from starlette.datastructures import UploadFile


class ExtractionError(RuntimeError):
    pass


async def extract_text_from_upload(file: UploadFile) -> tuple[str, int | None, str]:
    filename = file.filename or "upload"
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    if suffix == "pdf" or file.content_type == "application/pdf":
        return await _extract_pdf(file)

    data = await file.read()
    if not data:
        raise ExtractionError("Uploaded file is empty")

    try:
        return data.decode("utf-8"), None, "text"
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="ignore"), None, "text"


async def _extract_pdf(file: UploadFile) -> tuple[str, int | None, str]:
    data = await file.read()
    if not data:
        raise ExtractionError("PDF is empty")

    reader = PdfReader(BytesIO(data))
    pages: list[str] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = " ".join(text.split()).strip()
        pages.append(f"# Page {page_number}\n{text}")

    extracted = "\n\n".join(pages).strip()
    if not extracted:
        raise ExtractionError(
            "No selectable text was found in the PDF. OCR is not configured yet."
        )

    return extracted, len(reader.pages), "pdf"
