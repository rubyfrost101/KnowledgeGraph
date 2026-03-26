from __future__ import annotations

from app.models import ImportedKnowledgeBatch, KnowledgeEdge, KnowledgeGraphData, KnowledgeNode
from app.services.normalization import canonical_text, unique_list


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
        if existing_id:
            id_remap[node.id] = existing_id
            existing = node_map[existing_id]
            existing.summary = existing.summary or node.summary
            existing.detail = "\n\n".join([part for part in [existing.detail, node.detail] if part])
            existing.aliases = unique_list([*existing.aliases, *node.aliases])
            existing.sources = unique_list([*existing.sources, *node.sources])
            existing.score = max(existing.score, node.score)
            continue

        copy = _clone_node(node)
        node_map[copy.id] = copy
        id_remap[node.id] = copy.id
        label_to_id[key] = copy.id
        for alias in copy.aliases:
            label_to_id[canonical_text(alias)] = copy.id

    edge_map: dict[str, KnowledgeEdge] = {}
    for edge in [*base.edges, *incoming.edges]:
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
