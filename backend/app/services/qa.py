from __future__ import annotations

from app.models import KnowledgeGraphData, KnowledgeNode, QARequest, QAResponse
from app.services.normalization import canonical_text, unique_list


def _search_nodes(graph: KnowledgeGraphData, query: str) -> list[tuple[KnowledgeNode, float]]:
    needle = canonical_text(query)
    if not needle:
        return []

    scored: list[tuple[KnowledgeNode, float]] = []
    for node in graph.nodes:
        score = 0.0
        label = canonical_text(node.label)
        summary = canonical_text(node.summary)
        detail = canonical_text(node.detail)
        if label == needle:
            score += 100
        elif needle in label:
            score += 60
        if any(needle in canonical_text(alias) for alias in node.aliases):
            score += 40
        if needle in summary:
            score += 20
        if needle in detail:
            score += 10
        if score > 0:
            scored.append((node, score))

    scored.sort(key=lambda item: item[1], reverse=True)
    return scored


def answer_question(graph: KnowledgeGraphData, request: QARequest) -> QAResponse:
    matches = _search_nodes(graph, request.question)
    primary = next((node for node, _ in matches), None)
    if primary is None and request.context_node_id:
        primary = next((node for node in graph.nodes if node.id == request.context_node_id), None)

    if primary is None:
        return QAResponse(
            title="暂时没有找到足够相关的知识点",
            answer="你可以换一个更具体的提法，或者先导入一本书/一份 PDF，让图谱变得更有上下文。",
            supporting_nodes=[],
            citations=[],
            confidence=0.1,
        )

    related_nodes = [
        node
        for node in graph.nodes
        if node.id != primary.id
        and any(
            (edge.source == primary.id and edge.target == node.id)
            or (edge.target == primary.id and edge.source == node.id)
            for edge in graph.edges
        )
    ]
    top_related = "、".join(node.label for node in related_nodes[:4])
    source_titles = unique_list(
        [
            document.title
            for document in graph.documents
            if primary.sources and (document.id in primary.sources or document.origin in primary.sources)
        ]
    )
    answer_parts = [
        f'我先定位到“{primary.label}”。{primary.summary}',
        f"它在图谱中常和 {top_related} 一起出现或形成对照。" if top_related else "",
        f"相关来源包括：{'；'.join(source_titles)}。" if source_titles else "",
    ]
    if len(matches) > 1:
        answer_parts.append(f"另外还发现 {', '.join(node.label for node, _ in matches[1:4])} 也可能相关。")

    citations = unique_list([*primary.sources, *[source for node in related_nodes for source in node.sources]])[:6]
    confidence = min(0.95, 0.45 + 0.1 * len(matches) + (0.15 if top_related else 0))
    return QAResponse(
        title=f"关于“{primary.label}”的回答",
        answer=" ".join(part for part in answer_parts if part),
        supporting_nodes=[primary, *[node for node, _ in matches[1:4]]][:4],
        citations=citations,
        confidence=round(confidence, 2),
    )
