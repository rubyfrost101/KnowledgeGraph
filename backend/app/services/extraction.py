from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image
from pydantic import BaseModel

try:
    import pytesseract
except Exception:  # pragma: no cover - optional dependency
    pytesseract = None  # type: ignore[assignment]

from starlette.datastructures import UploadFile

from app.core.config import get_settings


class ExtractionError(RuntimeError):
    pass


class ExtractionResult(BaseModel):
    text: str
    page_count: int | None = None
    source_type: str
    used_ocr: bool = False


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def _ensure_ocr_available() -> None:
    if pytesseract is None:
        raise ExtractionError(
            "OCR is not available in this environment. Install pytesseract and tesseract-ocr."
        )


def _ocr_image(image: Image.Image) -> str:
    _ensure_ocr_available()
    settings = get_settings()
    return pytesseract.image_to_string(image, lang=settings.ocr_lang)


def _ocr_pixmap(pixmap: fitz.Pixmap) -> str:
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    return _ocr_image(image)


def extract_text_from_bytes(filename: str, content_type: str | None, data: bytes) -> ExtractionResult:
    suffix = Path(filename.lower()).suffix
    if suffix == ".pdf" or content_type == "application/pdf":
        return _extract_pdf(filename, data)
    if suffix in IMAGE_SUFFIXES or (content_type or "").startswith("image/"):
        return _extract_image(data)
    return _extract_text(filename, data)


async def extract_text_from_upload(file: UploadFile) -> ExtractionResult:
    data = await file.read()
    return extract_text_from_bytes(file.filename or "upload", file.content_type, data)


def _extract_text(filename: str, data: bytes) -> ExtractionResult:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="ignore")
    if not text.strip():
        raise ExtractionError(f"{filename} did not contain readable text")
    return ExtractionResult(text=text, source_type="text")


def _extract_image(data: bytes) -> ExtractionResult:
    image = Image.open(BytesIO(data)).convert("RGB")
    text = _ocr_image(image)
    if not text.strip():
        raise ExtractionError("No text could be recognized in the image.")
    return ExtractionResult(text=text, source_type="image", used_ocr=True)


def _extract_pdf(filename: str, data: bytes) -> ExtractionResult:
    doc = fitz.open(stream=data, filetype="pdf")
    pages: list[str] = []
    used_ocr = False

    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        text = " ".join(page.get_text("text").split()).strip()
        if text:
            pages.append(f"# Page {page_index + 1}\n{text}")
            continue

        pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
        text = " ".join(_ocr_pixmap(pixmap).split()).strip()
        if text:
            used_ocr = True
            pages.append(f"# Page {page_index + 1}\n{text}")

    extracted = "\n\n".join(pages).strip()
    if not extracted:
        raise ExtractionError(
            f"{filename} did not expose selectable text. OCR fallback also failed or returned nothing."
        )

    return ExtractionResult(text=extracted, page_count=doc.page_count, source_type="pdf", used_ocr=used_ocr)
