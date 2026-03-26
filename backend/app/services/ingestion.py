from __future__ import annotations

import re
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


def _split_blocks(text: str) -> list[str]:
    return [block.strip() for block in re.split(r"\n\s*\n+", text.replace("\r\n", "\n")) if block.strip()]


def _split_sentences(text: str) -> list[str]:
    chunks = [chunk.strip() for chunk in re.split(r"(?<=[。！？!?\.])\s+|(?<=\n)", text.replace("\r\n", "\n")) if chunk.strip()]
    return chunks or [text.strip()]


def _extract_aliases(text: str) -> list[str]:
    return unique_list([match.strip() for match in re.findall(r"[（(]([^（）()]{1,28})[)）]", text)])


def _infer_kind(label: str) -> KnowledgeKind:
    if re.search(r"book|chapter|dictionary|text", label, re.I):
        return "book"
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


def _relation_kind(sentence: str) -> tuple[RelationKind, str]:
    if re.search(r"属于|是|is a|kind of|类型", sentence, re.I):
        return "is-a", "is a"
    if re.search(r"对比|相对|反义|opposite|contrast", sentence, re.I):
        return "contrast-with", "contrast"
    if re.search(r"属于同一|同属|same domain|相关|related", sentence, re.I):
        return "related-to", "related"
    if re.search(r"组成|part of|包含|contains", sentence, re.I):
        return "part-of", "part of"
    if re.search(r"依赖|depends on|required", sentence, re.I):
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
    document_id = stable_id("doc", f"{request.origin}:{request.text[:120]}")
    blocks = _split_blocks(request.text)
    nodes_by_key: dict[str, KnowledgeNode] = {}

    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        heading = next((line for line in lines if line.startswith("#") or len(line) <= 80), None)
        if not heading:
            continue

        cleaned = heading.lstrip("#").strip().rstrip(":：")
        key = canonical_text(cleaned)
        if not key or key in nodes_by_key:
            continue

        node = _make_node(cleaned, _category_from_text(cleaned), document_id, block.strip())
        node.aliases = _extract_aliases(block)
        nodes_by_key[key] = node

    if not nodes_by_key:
        fallback_label = title
        nodes_by_key[canonical_text(fallback_label)] = _make_node(fallback_label, _category_from_text(fallback_label), document_id, request.text)

    nodes = list(nodes_by_key.values())
    edges: list[KnowledgeEdge] = []
    for block in blocks:
        for sentence in _split_sentences(block):
            normalized = canonical_text(sentence)
            mentioned = [
                node
                for node in nodes
                if canonical_text(node.label) in normalized
                or any(canonical_text(alias) in normalized for alias in node.aliases)
            ]
            if len(mentioned) < 2:
                continue

            kind, label = _relation_kind(sentence)
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

    edges = _dedupe_edges(edges)
    document = KnowledgeDocument(
        id=document_id,
        title=title,
        type=request.source_type,
        origin=request.origin,
        imported_at=datetime.now(timezone.utc).isoformat(),
        notes="从文本导入，使用章节和术语启发式解析。",
    )
    graph = KnowledgeGraphData(nodes=nodes, edges=edges, documents=[document])
    summary = f"已从文本中提取 {len(nodes)} 个知识点与 {len(edges)} 条关系。"
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
