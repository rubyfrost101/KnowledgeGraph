from __future__ import annotations

import hashlib
import re


def canonical_text(value: str) -> str:
    normalized = value.strip().lower()
    normalized = re.sub(r"[^\w\s\u4e00-\u9fff]+", " ", normalized, flags=re.UNICODE)
    normalized = re.sub(r"\s+", " ", normalized, flags=re.UNICODE)
    return normalized.strip()


def stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(canonical_text(value).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def unique_list(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        item = value.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result
