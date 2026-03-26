from __future__ import annotations

from difflib import SequenceMatcher
import re
from itertools import combinations

from app.models import ImportedKnowledgeBatch, KnowledgeEdge, KnowledgeGraphData, KnowledgeNode
from app.services.normalization import canonical_text, stable_id, unique_list


def _clone_node(node: KnowledgeNode) -> KnowledgeNode:
    return KnowledgeNode(
        id=node.id,
        label=node.label,
        kind=node.kind,
        category=node.category,
        summary=node.summary,
        detail=node.detail,
        aliases=list(node.aliases),
        sources=list(node.sources),
        score=node.score,
    )


def _clone_edge(edge: KnowledgeEdge) -> KnowledgeEdge:
    return KnowledgeEdge(
        id=edge.id,
        source=edge.source,
        target=edge.target,
        kind=edge.kind,
        label=edge.label,
        weight=edge.weight,
        sources=list(edge.sources),
    )


def _token_set(value: str) -> set[str]:
    return {token for token in canonical_text(value).split() if token}


def _label_overlap(left: str, right: str) -> float:
    left_tokens = _token_set(left)
    right_tokens = _token_set(right)
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = left_tokens & right_tokens
    return len(overlap) / max(1, min(len(left_tokens), len(right_tokens)))


def _node_similarity(left: KnowledgeNode, right: KnowledgeNode) -> float:
    left_label = canonical_text(left.label)
    right_label = canonical_text(right.label)
    if not left_label or not right_label:
        return 0.0
    if left_label == right_label:
        return 1.0

    left_aliases = {canonical_text(alias) for alias in left.aliases}
    right_aliases = {canonical_text(alias) for alias in right.aliases}
    if left_label in right_aliases or right_label in left_aliases:
        return 0.98
    if left_label in right_label or right_label in left_label:
        return 0.9

    ratio = SequenceMatcher(None, left_label, right_label).ratio()
    token_overlap = _label_overlap(left_label, right_label)
    summary_overlap = SequenceMatcher(
        None,
        canonical_text(f"{left.summary} {left.detail[:120]}"),
        canonical_text(f"{right.summary} {right.detail[:120]}"),
    ).ratio()
    combined = max(ratio, (ratio * 0.6) + (token_overlap * 0.25) + (summary_overlap * 0.15))
    if left.kind == right.kind:
        combined += 0.03
    if left.category == right.category:
        combined += 0.05
    if any(canonical_text(alias) in right_label for alias in left.aliases):
        combined += 0.04
    if any(canonical_text(alias) in left_label for alias in right.aliases):
        combined += 0.04
    if left.kind in {"book", "topic"} or right.kind in {"book", "topic"}:
        combined = min(combined, 0.84)
    return min(combined, 1.0)


def _append_unique_detail(existing: str, incoming: str) -> str:
    if not incoming or incoming in existing:
        return existing
    if not existing:
        return incoming
    return "\n\n".join([existing, incoming])


def _relation_kind_from_sentence(sentence: str) -> tuple[str, str]:
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
    return "same-domain", "cross-book reference"


def _split_sentences(text: str) -> list[str]:
    chunks = [chunk.strip() for chunk in re.split(r"(?<=[。！？!?\.])\s+|(?<=\n)", text.replace("\r\n", "\n")) if chunk.strip()]
    return chunks or [text.strip()]


def _matches_node(sentence: str, node: KnowledgeNode) -> bool:
    normalized = canonical_text(sentence)
    if not normalized:
        return False
    if canonical_text(node.label) in normalized:
        return True
    return any(canonical_text(alias) in normalized for alias in node.aliases)


def merge_graph_data(base: KnowledgeGraphData, incoming: ImportedKnowledgeBatch) -> KnowledgeGraphData:
    node_map: dict[str, KnowledgeNode] = {}
    label_to_id: dict[str, str] = {}
    id_remap: dict[str, str] = {}

    for node in base.nodes:
        copy = _clone_node(node)
        node_map[copy.id] = copy
        id_remap[copy.id] = copy.id
        label_to_id[canonical_text(copy.label)] = copy.id
        for alias in copy.aliases:
            label_to_id[canonical_text(alias)] = copy.id

    for node in incoming.nodes:
        key = canonical_text(node.label)
        existing_id = label_to_id.get(key)
        if existing_id is None:
            best_score = 0.0
            best_id: str | None = None
            for candidate_id, candidate in node_map.items():
                score = _node_similarity(candidate, node)
                if score > best_score:
                    best_score = score
                    best_id = candidate_id
            if best_score >= 0.88:
                existing_id = best_id
        if existing_id:
            id_remap[node.id] = existing_id
            existing = node_map[existing_id]
            existing.summary = existing.summary or node.summary
            existing.detail = _append_unique_detail(existing.detail, node.detail)
            existing.aliases = unique_list([*existing.aliases, node.label, *node.aliases])
            existing.sources = unique_list([*existing.sources, *node.sources])
            existing.score = max(existing.score, node.score)
            label_to_id[key] = existing_id
            for alias in node.aliases:
                label_to_id[canonical_text(alias)] = existing_id
            continue

        copy = _clone_node(node)
        node_map[copy.id] = copy
        id_remap[node.id] = copy.id
        label_to_id[key] = copy.id
        for alias in copy.aliases:
            label_to_id[canonical_text(alias)] = copy.id

    inferred_edges: list[KnowledgeEdge] = []
    for node in incoming.nodes:
        merged_id = id_remap.get(node.id)
        if not merged_id:
            continue
        merged_node = node_map.get(merged_id)
        if merged_node is None:
            continue
        for sentence in _split_sentences(merged_node.detail):
            matched_nodes = [candidate for candidate in node_map.values() if candidate.id != merged_id and _matches_node(sentence, candidate)]
            if len(matched_nodes) < 1:
                continue
            kind, label = _relation_kind_from_sentence(sentence)
            for source, target in combinations([merged_node, *matched_nodes], 2):
                if source.id == target.id:
                    continue
                inferred_edges.append(
                    KnowledgeEdge(
                        id=stable_id("edge", f"{source.id}:{kind}:{target.id}:{label}:{merged_node.id}"),
                        source=source.id,
                        target=target.id,
                        kind=kind,  # type: ignore[arg-type]
                        label=label,
                        weight=0.3 if kind == "same-domain" else 0.5,
                        sources=list(merged_node.sources),
                    )
                )

    edge_map: dict[str, KnowledgeEdge] = {}
    for edge in [*base.edges, *incoming.edges, *inferred_edges]:
        source = id_remap.get(edge.source, edge.source)
        target = id_remap.get(edge.target, edge.target)
        key = f"{source}:{edge.kind}:{target}:{canonical_text(edge.label)}"
        existing = edge_map.get(key)
        if existing:
            existing.weight = max(existing.weight, edge.weight)
            existing.sources = unique_list([*existing.sources, *edge.sources])
            continue
        copy = _clone_edge(edge)
        copy.source = source
        copy.target = target
        edge_map[key] = copy

    documents = list(base.documents)
    seen_document_ids = {document.id for document in documents}
    for document in incoming.documents:
        if document.id not in seen_document_ids:
            documents.append(document)
            seen_document_ids.add(document.id)

    return KnowledgeGraphData(
        nodes=list(node_map.values()),
        edges=list(edge_map.values()),
        documents=documents,
    )
