from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import re

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


@dataclass(slots=True)
class _BlockText:
    bbox: tuple[float, float, float, float]
    text: str
    order: int
    direction: tuple[float, float] | None
    is_label: bool


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def _ensure_ocr_available() -> None:
    if pytesseract is None:
        raise ExtractionError(
            "OCR is not available in this environment. Install pytesseract and tesseract-ocr."
        )


def _ocr_image(image: Image.Image) -> str:
    _ensure_ocr_available()
    settings = get_settings()
    try:
        return pytesseract.image_to_string(image, lang=settings.ocr_lang)
    except Exception as exc:  # pragma: no cover - depends on local OCR runtime
        raise ExtractionError("OCR failed for the provided image.") from exc


def _ocr_pixmap(pixmap: fitz.Pixmap) -> str:
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    return _ocr_image(image)


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _block_text(block: dict, order: int) -> _BlockText | None:
    if block.get("type") != 0:
        return None

    first_direction: tuple[float, float] | None = None
    lines: list[str] = []
    for line in block.get("lines", []):
        if first_direction is None and line.get("dir"):
            direction = line.get("dir")
            if isinstance(direction, (list, tuple)) and len(direction) == 2:
                first_direction = (float(direction[0]), float(direction[1]))
        line_text = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
        if line_text:
            lines.append(_normalize_text(line_text))

    text = "\n".join(line for line in lines if line).strip()
    if not text:
        return None

    bbox = block.get("bbox")
    if not bbox or len(bbox) != 4:
        return None
    clean_length = len(text.replace(" ", ""))
    width = float(bbox[2]) - float(bbox[0])
    height = float(bbox[3]) - float(bbox[1])
    has_space = " " in text.strip()
    verticalish = bool(first_direction and abs(first_direction[1]) > 0.2)
    is_label = (
        (not has_space and clean_length <= 4 and max(width, height) < 240)
        or (not has_space and clean_length <= 8 and max(width, height) < 120)
        or (verticalish and clean_length <= 12 and height < 180)
    )
    return _BlockText(
        bbox=(float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])),
        text=text,
        order=order,
        direction=first_direction,
        is_label=is_label,
    )


def _bbox_union(blocks: list[_BlockText]) -> tuple[float, float, float, float]:
    x0 = min(block.bbox[0] for block in blocks)
    y0 = min(block.bbox[1] for block in blocks)
    x1 = max(block.bbox[2] for block in blocks)
    y1 = max(block.bbox[3] for block in blocks)
    return x0, y0, x1, y1


def _is_tiny_block(block: _BlockText) -> bool:
    text = _normalize_text(block.text)
    width = block.bbox[2] - block.bbox[0]
    height = block.bbox[3] - block.bbox[1]
    return bool(text) and len(text.replace(" ", "")) <= 3 and width <= 32 and height <= 28


def _merge_tiny_blocks(blocks: list[_BlockText]) -> list[_BlockText]:
    merged: list[_BlockText] = []
    run: list[_BlockText] = []

    def flush_run() -> None:
        nonlocal run
        if not run:
            return
        if len(run) == 1:
            merged.append(run[0])
            run = []
            return

        ordered = sorted(run, key=lambda block: block.order)
        segments: list[list[_BlockText]] = [[ordered[0]]]
        for current in ordered[1:]:
            previous = segments[-1][-1]
            order_gap = current.order - previous.order
            x_gap = max(0.0, current.bbox[0] - previous.bbox[2])
            y_gap = max(0.0, current.bbox[1] - previous.bbox[3])
            dominant_gap = max(x_gap, y_gap)
            if order_gap > 1 or dominant_gap > 12:
                segments.append([current])
                continue
            segments[-1].append(current)

        text_segments = ["".join(item.text.replace(" ", "") for item in segment if item.text) for segment in segments]
        text = " ".join(segment for segment in text_segments if segment).strip()
        if text:
            merged.append(
                _BlockText(
                    bbox=_bbox_union(run),
                    text=text,
                    order=min(block.order for block in run),
                    direction=run[0].direction,
                    is_label=run[0].is_label,
                )
            )
        run = []

    for block in blocks:
        if _is_tiny_block(block):
            run.append(block)
            continue
        flush_run()
        merged.append(block)

    flush_run()
    return merged


def _extract_page_text(page: fitz.Page) -> str:
    raw_blocks = page.get_text("dict").get("blocks", [])
    blocks = [_block_text(block, index) for index, block in enumerate(raw_blocks)]
    blocks = [block for block in blocks if block is not None]
    if not blocks:
        return ""

    label_blocks = [block for block in blocks if block.is_label]
    main_blocks = [block for block in blocks if not block.is_label]

    main_blocks = sorted(main_blocks, key=lambda block: (round(block.bbox[1], 1), round(block.bbox[0], 1)))
    main_blocks = _merge_tiny_blocks(main_blocks)
    main_text = "\n\n".join(block.text for block in main_blocks if block.text).strip()

    label_texts: list[str] = []
    if label_blocks:
        label_blocks = sorted(label_blocks, key=lambda block: block.order)
        label_blocks = _merge_tiny_blocks(label_blocks)
        for block in label_blocks:
            label = _normalize_text(block.text)
            if not label:
                continue
            parts = [part for part in re.split(r"\s+", label) if part]
            if len(parts) > 1:
                for part in parts:
                    if not re.search(r"[A-Za-z\u4e00-\u9fff]", part):
                        continue
                    if len(part.replace(" ", "")) <= 12 and part not in label_texts:
                        label_texts.append(part)
                continue
            if not re.search(r"[A-Za-z\u4e00-\u9fff]", label):
                continue
            if len(label.replace(" ", "")) <= 12 and label not in label_texts:
                label_texts.append(label)

    if label_texts:
        labels = "\n".join(f"- {label}" for label in label_texts)
        if main_text:
            return f"{main_text}\n\n## 图示标签\n{labels}".strip()
        return f"## 图示标签\n{labels}".strip()
    return main_text


def _image_blocks(page: fitz.Page) -> list[tuple[float, float, float, float]]:
    raw_blocks = page.get_text("dict").get("blocks", [])
    images: list[tuple[float, float, float, float]] = []
    for block in raw_blocks:
        if block.get("type") != 1:
            continue
        bbox = block.get("bbox")
        if not bbox or len(bbox) != 4:
            continue
        images.append((float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])))
    return images


def _ocr_rect(page: fitz.Page, rect: fitz.Rect) -> str:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), clip=rect, alpha=False)
    return " ".join(_ocr_pixmap(pixmap).split()).strip()


def _detect_split_axis(page: fitz.Page, text_length: int, text_block_count: int) -> str | None:
    images = _image_blocks(page)
    if not images:
        return None

    page_area = page.rect.width * page.rect.height
    largest = max(images, key=lambda bbox: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
    largest_area = (largest[2] - largest[0]) * (largest[3] - largest[1])
    if largest_area < page_area * 0.16 and text_length >= 120 and text_block_count >= 4:
        return None

    width = largest[2] - largest[0]
    height = largest[3] - largest[1]
    if width >= height * 1.15:
        return "lr"
    if height >= width * 1.15:
        return "tb"

    if text_block_count <= 3 or text_length < 120:
        text_boxes = [block for block in page.get_text("dict").get("blocks", []) if block.get("type") == 0 and block.get("bbox")]
        if text_boxes:
            xs = [float(block["bbox"][0]) + (float(block["bbox"][2]) - float(block["bbox"][0])) / 2 for block in text_boxes]
            ys = [float(block["bbox"][1]) + (float(block["bbox"][3]) - float(block["bbox"][1])) / 2 for block in text_boxes]
            x_span = max(xs) - min(xs) if len(xs) > 1 else 0.0
            y_span = max(ys) - min(ys) if len(ys) > 1 else 0.0
            if x_span >= y_span * 1.35:
                return "lr"
            if y_span >= x_span * 1.35:
                return "tb"

    return None


def _ocr_split_page(page: fitz.Page, axis: str) -> list[tuple[str, str]]:
    rect = page.rect
    if axis == "lr":
        left = fitz.Rect(rect.x0, rect.y0, rect.x0 + rect.width * 0.52, rect.y1)
        right = fitz.Rect(rect.x0 + rect.width * 0.48, rect.y0, rect.x1, rect.y1)
        return [
            ("左半页", _ocr_rect(page, left)),
            ("右半页", _ocr_rect(page, right)),
        ]
    top = fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + rect.height * 0.52)
    bottom = fitz.Rect(rect.x0, rect.y0 + rect.height * 0.48, rect.x1, rect.y1)
    return [
        ("上半页", _ocr_rect(page, top)),
        ("下半页", _ocr_rect(page, bottom)),
    ]


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
        text = _extract_page_text(page)
        text_length = len(text)
        text_block_count = len([block for block in page.get_text("dict").get("blocks", []) if block.get("type") == 0])
        split_axis = _detect_split_axis(page, text_length, text_block_count)

        if text:
            page_parts = [f"# Page {page_index + 1}\n{text}"]
            if split_axis and text_length < 120 and text_block_count <= 3:
                try:
                    split_parts = [f"## {label}\n{ocr_text}" for label, ocr_text in _ocr_split_page(page, split_axis) if ocr_text]
                except ExtractionError:
                    split_parts = []
                if split_parts:
                    used_ocr = True
                    page_parts.append("\n\n".join(split_parts))
            pages.append("\n\n".join(page_parts).strip())
            continue

        if split_axis:
            try:
                split_parts = [f"## {label}\n{ocr_text}" for label, ocr_text in _ocr_split_page(page, split_axis) if ocr_text]
            except ExtractionError:
                split_parts = []
            text = "\n\n".join(split_parts).strip()
            if text:
                used_ocr = True
                pages.append(f"# Page {page_index + 1}\n{text}")
                continue

        try:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            text = " ".join(_ocr_pixmap(pixmap).split()).strip()
        except ExtractionError:
            text = ""
        if text:
            used_ocr = True
            pages.append(f"# Page {page_index + 1}\n{text}")

    extracted = "\n\n".join(pages).strip()
    if not extracted:
        raise ExtractionError(
            f"{filename} did not expose selectable text. OCR fallback also failed or returned nothing."
        )

    return ExtractionResult(text=extracted, page_count=doc.page_count, source_type="pdf", used_ocr=used_ocr)
