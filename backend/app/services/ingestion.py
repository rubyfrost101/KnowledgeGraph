from __future__ import annotations

from dataclasses import dataclass
import re
from itertools import combinations
from datetime import datetime, timezone

from app.models import (
    KnowledgeKind,
    IngestRequest,
    KnowledgeDocument,
    KnowledgeEdge,
    KnowledgeGraphData,
    KnowledgeNode,
    RelationKind,
)
from app.services.normalization import canonical_text, stable_id, unique_list


@dataclass(slots=True)
class _ParsedTerm:
    label: str
    detail: str


def _split_blocks(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").strip()
    raw_blocks = [block.strip() for block in re.split(r"\n\s*\n+", normalized) if block.strip()]
    refined: list[str] = []
    for block in raw_blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        current: list[str] = []
        for line in lines:
            if current and _looks_like_heading(line):
                refined.append("\n".join(current).strip())
                current = [line]
            else:
                current.append(line)
        if current:
            refined.append("\n".join(current).strip())
    return refined


def _looks_like_heading(line: str) -> bool:
    stripped = line.strip().lstrip("#").strip().rstrip(":：")
    if not stripped:
        return False
    if line.startswith("#"):
        return True
    if re.fullmatch(r"(page|chapter|section|part)\s*\d+(?:\.\d+)*", stripped, re.I):
        return True
    if re.fullmatch(r"第[一二三四五六七八九十百千0-9]+[章节部分篇].*", stripped):
        return True
    if re.fullmatch(r"\d+(?:\.\d+){0,2}\s*[A-Za-z\u4e00-\u9fff].*", stripped):
        return True
    if re.fullmatch(r"[IVXLC]+\.\s+[A-Za-z\u4e00-\u9fff].*", stripped):
        return True
    if len(stripped) > 72:
        return False
    if re.search(r"[。！？!?\.]$", stripped):
        return False
    words = stripped.split()
    if len(words) <= 8 and stripped[0].isupper():
        return True
    if len(words) <= 5 and len(stripped) <= 18:
        return True
    return False


def _is_page_marker(line: str) -> bool:
    stripped = line.strip().lstrip("#").strip()
    return bool(re.fullmatch(r"page\s*\d+", stripped, re.I))


def _normalize_heading_label(line: str) -> str:
    cleaned = line.strip().lstrip("#").strip().rstrip(":：")
    cleaned = re.sub(r"^(chapter|section|part)\s*\d+(?:\.\d+)*\s*[-–—:：]?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^page\s*\d+\s*[-–—:：]?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^第[一二三四五六七八九十百千0-9]+[章节部分篇]\s*", "", cleaned)
    cleaned = re.sub(r"^\d+(?:\.\d+){0,2}\s*[-–—:：]?\s*", "", cleaned)
    cleaned = cleaned.strip()
    if not cleaned:
        return line.strip().lstrip("#").strip()
    return cleaned


def _append_detail(existing: str, incoming: str) -> str:
    existing_text = existing.strip()
    incoming_text = incoming.strip()
    if not incoming_text or incoming_text in existing_text:
        return existing_text
    if not existing_text:
        return incoming_text
    return "\n\n".join([existing_text, incoming_text])


def _split_sentences(text: str) -> list[str]:
    chunks = [chunk.strip() for chunk in re.split(r"(?<=[。！？!?\.])\s+|(?<=\n)", text.replace("\r\n", "\n")) if chunk.strip()]
    return chunks or [text.strip()]


def _extract_aliases(text: str) -> list[str]:
    return unique_list([match.strip() for match in re.findall(r"[（(]([^（）()]{1,28})[)）]", text)])


def _infer_kind(label: str) -> KnowledgeKind:
    if re.search(r"book|dictionary|textbook|manual|guide", label, re.I):
        return "book"
    if re.search(r"chapter|section|part|第[一二三四五六七八九十百千0-9]+[章节部分篇]", label, re.I):
        return "topic"
    if re.search(r"process|method|diagnosis|analysis|learning|recall|translation", label, re.I):
        return "process"
    if re.search(r"topic|concept|overview|introduction", label, re.I):
        return "topic"
    return "concept"


def _make_node(label: str, category: str, source_id: str, detail: str) -> KnowledgeNode:
    return KnowledgeNode(
        id=stable_id("node", f"{source_id}:{label}"),
        label=label,
        kind=_infer_kind(label),
        category=category,
        summary=_split_sentences(detail)[0][:160] if detail else label,
        detail=detail,
        aliases=[],
        sources=[source_id],
        score=1.0,
    )


def _parse_term_line(line: str) -> _ParsedTerm | None:
    stripped = line.strip().lstrip("-*•").strip()
    if not stripped or _looks_like_heading(stripped):
        return None
    for delimiter in ("：", ":", "—", "–", "=", " - ", " — ", " – "):
        if delimiter not in stripped:
            continue
        left, right = stripped.split(delimiter, 1)
        label = left.strip().rstrip(":：-—–")
        detail = right.strip()
        if not label or not detail:
            continue
        if len(label) > 52 or len(detail) < 10:
            continue
        if len(label.split()) > 8 and len(label) > 24:
            continue
        if detail.endswith("?") or detail.endswith("？"):
            continue
        return _ParsedTerm(label=label, detail=detail)
    return None


def _relation_kind(sentence: str) -> tuple[RelationKind, str]:
    if re.search(r"属于|是|is a|kind of|类型|type of|instance of", sentence, re.I):
        return "is-a", "is a"
    if re.search(r"对比|相对|反义|opposite|contrast|versus|vs\.", sentence, re.I):
        return "contrast-with", "contrast"
    if re.search(r"属于同一|同属|same domain|相关|related|co-?occur|together", sentence, re.I):
        return "related-to", "related"
    if re.search(r"组成|part of|包含|contains|include|includes|made of", sentence, re.I):
        return "part-of", "part of"
    if re.search(r"依赖|depends on|required|causes|leads to|drives|triggers|influences", sentence, re.I):
        return "depends-on", "depends on"
    return "mentions", "mentions"


def _dedupe_edges(edges: list[KnowledgeEdge]) -> list[KnowledgeEdge]:
    seen: dict[str, KnowledgeEdge] = {}
    for edge in edges:
        key = f"{edge.source}:{edge.kind}:{edge.target}:{canonical_text(edge.label)}"
        if key in seen:
            existing = seen[key]
            existing.weight = max(existing.weight, edge.weight)
            existing.sources = unique_list(existing.sources + edge.sources)
        else:
            seen[key] = edge
    return list(seen.values())


def ingest_text(request: IngestRequest) -> tuple[KnowledgeDocument, KnowledgeGraphData, str]:
    title = request.title or _title_from_text(request.text)
    document_id = request.document_id or stable_id("doc", f"{request.origin}:{request.text[:120]}")
    blocks = _split_blocks(request.text)
    nodes_by_key: dict[str, KnowledgeNode] = {}
    section_anchor_count = 0
    term_count = 0

    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        heading = next((line for line in lines if _looks_like_heading(line) and not _is_page_marker(line)), None)
        if heading is None and lines:
            heading = next((line for line in lines if not _is_page_marker(line)), lines[0])
        if not heading:
            continue

        cleaned = _normalize_heading_label(heading)
        key = canonical_text(cleaned)
        if not key:
            continue

        node = nodes_by_key.get(key)
        if node is None:
            node = _make_node(cleaned, _category_from_text(cleaned + " " + block), document_id, block.strip())
            node.aliases = _extract_aliases(block)
            nodes_by_key[key] = node
            section_anchor_count += 1
        else:
            node.detail = _append_detail(node.detail, block.strip())
            node.aliases = unique_list([*node.aliases, *_extract_aliases(block)])

        for line in lines:
            parsed = _parse_term_line(line)
            if parsed is None:
                continue
            term_key = canonical_text(parsed.label)
            if not term_key:
                continue
            existing = nodes_by_key.get(term_key)
            if existing is None:
                term_node = _make_node(
                    parsed.label,
                    _category_from_text(f"{parsed.label} {parsed.detail}"),
                    document_id,
                    parsed.detail,
                )
                term_node.aliases = _extract_aliases(f"{parsed.label} {parsed.detail}")
                nodes_by_key[term_key] = term_node
                term_count += 1
            else:
                existing.detail = _append_detail(existing.detail, parsed.detail)
                existing.aliases = unique_list([*existing.aliases, *_extract_aliases(parsed.label), *_extract_aliases(parsed.detail)])

    if not nodes_by_key:
        fallback_label = title
        nodes_by_key[canonical_text(fallback_label)] = _make_node(fallback_label, _category_from_text(fallback_label), document_id, request.text)

    nodes = list(nodes_by_key.values())
    edges: list[KnowledgeEdge] = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        heading = next((line for line in lines if _looks_like_heading(line) and not _is_page_marker(line)), None)
        if heading is None and lines:
            heading = next((line for line in lines if not _is_page_marker(line)), lines[0])
        section_node: KnowledgeNode | None = None
        if heading:
            section_node = nodes_by_key.get(canonical_text(_normalize_heading_label(heading)))
        block_mentions: list[KnowledgeNode] = []
        if section_node is not None:
            block_mentions.append(section_node)
        for sentence in _split_sentences(block):
            normalized = canonical_text(sentence)
            mentioned = [
                node
                for node in nodes
                if canonical_text(node.label) in normalized
                or any(canonical_text(alias) in normalized for alias in node.aliases)
            ]
            if len(mentioned) < 2:
                block_mentions.extend(mentioned)
                continue

            kind, label = _relation_kind(sentence)
            if kind == "mentions":
                for source, target in combinations(mentioned, 2):
                    edges.append(
                        KnowledgeEdge(
                            id=stable_id("edge", f"{source.id}:same-domain:{target.id}:co-occur:{document_id}"),
                            source=source.id,
                            target=target.id,
                            kind="same-domain",
                            label="co-occur",
                            weight=0.35,
                            sources=[document_id],
                        )
                    )
            else:
                for index in range(len(mentioned) - 1):
                    source = mentioned[index]
                    target = mentioned[index + 1]
                    edges.append(
                        KnowledgeEdge(
                            id=stable_id("edge", f"{source.id}:{kind}:{target.id}:{label}:{document_id}"),
                            source=source.id,
                            target=target.id,
                            kind=kind,
                            label=label,
                            weight=0.45,
                            sources=[document_id],
                        )
                    )
            block_mentions.extend(mentioned)

        unique_block_mentions = list({node.id: node for node in block_mentions}.values())
        if section_node is not None:
            section_key = section_node.id
            for node in unique_block_mentions:
                if node.id == section_key:
                    continue
                edges.append(
                    KnowledgeEdge(
                        id=stable_id("edge", f"{node.id}:part-of:{section_key}:chapter-link:{document_id}"),
                        source=node.id,
                        target=section_key,
                        kind="part-of",
                        label="part of",
                        weight=0.42,
                        sources=[document_id],
                    )
                )
        if len(unique_block_mentions) > 2:
            for source, target in combinations(unique_block_mentions, 2):
                edges.append(
                    KnowledgeEdge(
                        id=stable_id("edge", f"{source.id}:same-domain:{target.id}:section-co-occur:{document_id}"),
                        source=source.id,
                        target=target.id,
                        kind="same-domain",
                        label="section co-occur",
                        weight=0.28,
                        sources=[document_id],
                    )
                )

    edges = _dedupe_edges(edges)
    final_nodes = list(nodes_by_key.values())
    nodes_count = len(final_nodes)
    document = KnowledgeDocument(
        id=document_id,
        title=title,
        type=request.source_type,
        origin=request.origin,
        imported_at=datetime.now(timezone.utc).isoformat(),
        notes=f"从文本导入，章节锚点 {section_anchor_count} 个，术语 {term_count} 个，使用章节和术语启发式解析。",
    )
    graph = KnowledgeGraphData(nodes=final_nodes, edges=edges, documents=[document])
    summary = (
        f"已从文本中提取 {nodes_count} 个知识点（{section_anchor_count} 个章节锚点，"
        f"{term_count} 个术语）与 {len(edges)} 条关系。"
    )
    return document, graph, summary


def _title_from_text(text: str) -> str:
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return first_line.lstrip("#").strip()[:60] if first_line else "Imported notes"


def _category_from_text(text: str) -> str:
    if re.search(r"english|vocabulary|dictionary|word|lexical", text, re.I):
        return "English"
    if re.search(r"history|revolution|empire|dynasty", text, re.I):
        return "History"
    if re.search(r"medicine|disease|diagnosis|anatomy|pathogen", text, re.I):
        return "Medicine"
    if re.search(r"computer|algorithm|graph|recursion|abstraction", text, re.I):
        return "Computer Science"
    return "General"
