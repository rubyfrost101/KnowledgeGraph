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


@dataclass(slots=True)
class _SectionContext:
    node: KnowledgeNode
    level: int
    parent_id: str | None
    breadcrumb: list[str]


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
    if re.fullmatch(r".+?\s*\.{2,}\s*\d+(?:\s*)", stripped):
        return True
    if re.fullmatch(r"\d+(?:\.\d+)*\s+.+?\s+\d+", stripped) and len(stripped) <= 96:
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


def _heading_level(line: str) -> int | None:
    stripped = line.strip()
    if not stripped:
        return None

    if stripped.startswith("#"):
        return min(stripped.count("#"), 4)
    if re.search(r"\.{2,}\s*\d+\s*$", stripped):
        prefix = re.sub(r"\s*\.{2,}\s*\d+\s*$", "", stripped).strip()
        if re.match(r"^\d+(?:\.\d+)*\s+", prefix):
            return min(prefix.split()[0].count(".") + 1, 4)
        return 2
    if re.fullmatch(r"(chapter|part)\s*\d+(?:\.\d+)*\s*(?:[:：].*)?", stripped, re.I):
        return 1
    if re.fullmatch(r"(section|subsection)\s*\d+(?:\.\d+)*\s*(?:[:：].*)?", stripped, re.I):
        return 2
    if re.fullmatch(r"第[一二三四五六七八九十百千0-9]+[章节部分篇].*", stripped):
        return 1
    if re.fullmatch(r"[IVXLC]+\.\s+.*", stripped):
        return 1

    numeric_match = re.match(r"^(\d+(?:\.\d+){0,3})\s+(.+)$", stripped)
    if numeric_match:
        number = numeric_match.group(1)
        return min(number.count(".") + 1, 4)

    if _looks_like_heading(line):
        return 3
    return None


def _normalize_heading_label(line: str) -> str:
    cleaned = line.strip().lstrip("#").strip().rstrip(":：")
    cleaned = re.sub(r"\s*\.{2,}\s*\d+\s*$", "", cleaned)
    cleaned = re.sub(r"\s+\d+\s*$", "", cleaned)
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


def _append_citation(detail: str, citation: str) -> str:
    if citation in detail:
        return detail
    if not detail.strip():
        return citation
    return f"{detail}\n\n{citation}"


def _body_lines(lines: list[str]) -> list[str]:
    return [line for line in lines if line and not _looks_like_heading(line) and not _is_page_marker(line)]


def _body_text(lines: list[str]) -> str:
    return "\n".join(_body_lines(lines)).strip()


def _merge_reference_ids(*groups: list[str]) -> list[str]:
    merged: list[str] = []
    for group in groups:
        merged = unique_list([*merged, *group])
    return merged


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


def _citation_from_path(document_title: str, breadcrumb: list[str], line: str) -> str:
    path_text = " / ".join(breadcrumb) if breadcrumb else document_title
    citation = f"引用：{document_title} · {path_text}"
    if line:
        citation = f"{citation}\n原句：{line.strip()}"
    return citation


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
        if edge.source == edge.target:
            continue
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
    nodes_by_id: dict[str, KnowledgeNode] = {}
    term_nodes_by_label: dict[str, KnowledgeNode] = {}
    sections_by_key: dict[str, KnowledgeNode] = {}
    relation_edges: list[KnowledgeEdge] = []
    root_node = KnowledgeNode(
        id=stable_id("node", f"{document_id}:book"),
        label=title,
        kind="book",
        category=_category_from_text(title),
        summary=f"{title} 的目录根",
        detail=f"文档来源：{request.origin}\n\n这是这份导入的目录根节点。",
        aliases=unique_list([title, *_extract_aliases(request.text)]),
        sources=[document_id],
        reference_ids=[],
        score=1.0,
    )
    nodes_by_id[root_node.id] = root_node
    sections_by_key[f"root::{canonical_text(title)}"] = root_node
    section_stack: list[_SectionContext] = [_SectionContext(node=root_node, level=0, parent_id=None, breadcrumb=[root_node.label])]
    section_anchor_count = 0
    term_count = 0
    block_contexts: list[_SectionContext] = []

    def _current_section() -> _SectionContext:
        return section_stack[-1]

    def _register_section(label: str, level: int, block_text: str) -> _SectionContext:
        nonlocal section_anchor_count
        while len(section_stack) > 1 and section_stack[-1].level >= level:
            section_stack.pop()
        parent = _current_section()
        section_key = f"{parent.node.id}::{canonical_text(label)}"
        node = sections_by_key.get(section_key)
        body_text = _body_text(block_text.split("\n"))
        if node is None:
            node = KnowledgeNode(
                id=stable_id("node", f"{document_id}:{section_key}"),
                label=label,
                kind="topic",
                category=_category_from_text(f"{label} {block_text}"),
                summary=_split_sentences(body_text or label)[0][:160],
                detail=body_text or block_text.strip(),
                aliases=_extract_aliases(block_text),
                sources=[document_id],
                reference_ids=[parent.node.id] if parent.node.id != root_node.id else [],
                score=1.0,
            )
            sections_by_key[section_key] = node
            nodes_by_id[node.id] = node
            relation_edges.append(
                KnowledgeEdge(
                    id=stable_id("edge", f"{node.id}:part-of:{parent.node.id}:section-parent:{document_id}"),
                    source=node.id,
                    target=parent.node.id,
                    kind="part-of",
                    label="part of",
                    weight=0.92 if parent.parent_id else 0.78,
                    sources=[document_id],
                )
            )
            section_anchor_count += 1
        else:
            node.detail = _append_detail(node.detail, body_text or block_text.strip())
            node.aliases = unique_list([*node.aliases, *_extract_aliases(block_text)])
            node.reference_ids = _merge_reference_ids(node.reference_ids, [parent.node.id] if parent.node.id != root_node.id else [])

        context = _SectionContext(
            node=node,
            level=level,
            parent_id=parent.node.id,
            breadcrumb=[*parent.breadcrumb, node.label],
        )
        section_stack.append(context)
        return context

    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        heading = next((line for line in lines if _looks_like_heading(line) and not _is_page_marker(line)), None)
        if heading is None and lines:
            heading = next((line for line in lines if not _is_page_marker(line)), lines[0])

        section_context = _current_section()
        if heading:
            level = _heading_level(heading) or 3
            cleaned = _normalize_heading_label(heading)
            if cleaned:
                section_context = _register_section(cleaned, level, block.strip())

        block_contexts.append(section_context)
        current_breadcrumb = list(section_context.breadcrumb)
        for line in lines:
            parsed = _parse_term_line(line)
            if parsed is None:
                continue
            term_key = canonical_text(parsed.label)
            if not term_key:
                continue
            citation = _citation_from_path(title, current_breadcrumb, line)
            existing = term_nodes_by_label.get(term_key)
            if existing is None:
                term_body = parsed.detail.strip()
                term_node = KnowledgeNode(
                    id=stable_id("node", f"{document_id}:{term_key}"),
                    label=parsed.label,
                    kind=_infer_kind(parsed.label),
                    category=_category_from_text(f"{parsed.label} {parsed.detail}"),
                    summary=_split_sentences(term_body)[0][:160],
                    detail=_append_citation(parsed.detail, citation),
                    aliases=unique_list([parsed.label, *_extract_aliases(parsed.label), *_extract_aliases(parsed.detail)]),
                    sources=[document_id],
                    reference_ids=[section_context.node.id],
                    score=1.0,
                )
                term_nodes_by_label[term_key] = term_node
                nodes_by_id[term_node.id] = term_node
                term_count += 1
                relation_edges.append(
                    KnowledgeEdge(
                        id=stable_id("edge", f"{term_node.id}:part-of:{section_context.node.id}:term-anchor:{document_id}"),
                        source=term_node.id,
                        target=section_context.node.id,
                        kind="part-of",
                        label="part of",
                        weight=0.74,
                        sources=[document_id],
                    )
                )
            else:
                existing.detail = _append_citation(_append_detail(existing.detail, parsed.detail), citation)
                existing.aliases = unique_list([*existing.aliases, parsed.label, *_extract_aliases(parsed.label), *_extract_aliases(parsed.detail)])
                existing.sources = unique_list([*existing.sources, document_id])
                existing.reference_ids = _merge_reference_ids(existing.reference_ids, [section_context.node.id])
                if existing.id == section_context.node.id:
                    continue
                relation_edges.append(
                    KnowledgeEdge(
                        id=stable_id("edge", f"{existing.id}:part-of:{section_context.node.id}:term-anchor:{document_id}"),
                        source=existing.id,
                        target=section_context.node.id,
                        kind="part-of",
                        label="part of",
                        weight=0.7,
                        sources=[document_id],
                    )
                )

    if len(nodes_by_id) == 0:
        fallback_label = title
        fallback_node = KnowledgeNode(
            id=stable_id("node", f"{document_id}:{fallback_label}"),
            label=fallback_label,
            kind="topic",
            category=_category_from_text(fallback_label),
            summary=_split_sentences(request.text)[0][:160],
            detail=request.text,
            aliases=unique_list([fallback_label, *_extract_aliases(request.text)]),
            sources=[document_id],
            reference_ids=[],
            score=1.0,
        )
        nodes_by_id[fallback_node.id] = fallback_node

    nodes = list(nodes_by_id.values())
    edges: list[KnowledgeEdge] = [*relation_edges]
    for block, section_context in zip(blocks, block_contexts):
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        block_mentions: list[KnowledgeNode] = [section_context.node]
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
                    if source.id == target.id:
                        continue
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
                    if source.id == target.id:
                        continue
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
        if len(unique_block_mentions) > 2:
            for source, target in combinations(unique_block_mentions, 2):
                if source.id == target.id:
                    continue
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
    final_nodes = list(nodes_by_id.values())
    nodes_count = len(final_nodes)
    document = KnowledgeDocument(
        id=document_id,
        title=title,
        type=request.source_type,
        origin=request.origin,
        imported_at=datetime.now(timezone.utc).isoformat(),
        notes=f"从文本导入，章节锚点 {section_anchor_count} 个，术语 {term_count} 个，使用目录树和术语释义引用解析。",
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
