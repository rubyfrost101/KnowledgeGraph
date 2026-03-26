from __future__ import annotations

from datetime import datetime, timezone

from app.models import KnowledgeDocument, KnowledgeEdge, KnowledgeGraphData, KnowledgeKind, KnowledgeNode, RelationKind
from app.services.normalization import stable_id


def _node(
    label: str,
    kind: KnowledgeKind,
    category: str,
    summary: str,
    detail: str,
    aliases: list[str] | None = None,
    sources: list[str] | None = None,
    score: float = 1.0,
) -> KnowledgeNode:
    return KnowledgeNode(
        id=stable_id("node", label),
        label=label,
        kind=kind,
        category=category,
        summary=summary,
        detail=detail,
        aliases=aliases or [],
        sources=sources or ["demo"],
        score=score,
    )


def _edge(
    source: str,
    target: str,
    kind: RelationKind,
    label: str,
    weight: float,
    sources: list[str] | None = None,
) -> KnowledgeEdge:
    return KnowledgeEdge(
        id=stable_id("edge", f"{source}:{kind}:{target}:{label}"),
        source=source,
        target=target,
        kind=kind,
        label=label,
        weight=weight,
        sources=sources or ["demo"],
    )


def build_demo_graph() -> KnowledgeGraphData:
    english_root = _node(
        "Lexical semantics",
        "topic",
        "English",
        "词汇语义学帮助我们理解单词之间为什么相关，以及这些关系如何影响记忆与表达。",
        "它把单词放在关系网络里看：同义、反义、上下位、搭配、词根与词缀都会形成稳定的记忆通道。",
        ["semantics"],
    )
    synonym = _node(
        "Synonym",
        "term",
        "English",
        "同义词表示意义接近，但语气、语域和搭配常常不同。",
        "例如 big 和 large 往往互为同义，但在固定搭配中的适用性并不完全相同。",
        ["同义词"],
    )
    antonym = _node(
        "Antonym",
        "term",
        "English",
        "反义词通过对照帮助记忆，并强化概念边界。",
        "例如 hot / cold、increase / decrease。对照关系适合做间隔复习。",
        ["反义词"],
    )
    collocation = _node(
        "Collocation",
        "concept",
        "English",
        "搭配是单词在真实语境中的稳定共现模式。",
        "理解搭配比孤立背单词更接近真实语言使用，也更适合做图谱关系。",
        ["搭配"],
    )
    etymology = _node(
        "Etymology",
        "concept",
        "English",
        "词源把词汇拆回历史路径，帮助理解形态与意义演变。",
        "词源适合连接词根、前缀、后缀和历史借词路径。",
        ["词源"],
    )
    diagnosis = _node(
        "Diagnosis",
        "process",
        "Medicine",
        "诊断是从症状、体征、检查结果推断疾病的过程。",
        "图谱中它通常连接症状、病原体、检查方法和鉴别诊断。",
        ["诊断"],
    )
    inflammation = _node(
        "Inflammation",
        "concept",
        "Medicine",
        "炎症是机体对损伤、感染或刺激的防御性反应。",
        "它和发热、红肿、疼痛、白细胞变化等概念紧密相连。",
        ["炎症"],
    )
    pathogen = _node(
        "Pathogen",
        "concept",
        "Medicine",
        "病原体是能引发疾病的微生物或其他因子。",
        "细菌、病毒、真菌和寄生虫都可以成为病原体。",
        ["病原体"],
    )
    algorithm = _node(
        "Algorithm",
        "concept",
        "Computer Science",
        "算法描述了解决问题的步骤序列。",
        "时间复杂度、空间复杂度和正确性证明都是图谱中常见的邻近节点。",
        ["算法"],
    )
    graph_node = _node(
        "Graph",
        "concept",
        "Computer Science",
        "图结构用节点和边表达关系。",
        "知识图谱本身就可以看作一种带语义的图。",
        ["图"],
    )
    recursion = _node(
        "Recursion",
        "process",
        "Computer Science",
        "递归是函数直接或间接调用自身的思考方式。",
        "它和栈、边界条件、分治思想存在强关联。",
        ["递归"],
    )
    abstraction = _node(
        "Abstraction",
        "concept",
        "Computer Science",
        "抽象把复杂对象提炼成可复用的核心结构。",
        "抽象与接口、模块、分层设计、建模非常接近。",
        ["抽象"],
    )

    nodes = [
        english_root,
        synonym,
        antonym,
        collocation,
        etymology,
        diagnosis,
        inflammation,
        pathogen,
        algorithm,
        graph_node,
        recursion,
        abstraction,
    ]

    edges = [
        _edge(english_root.id, synonym.id, "related-to", "contains", 0.9),
        _edge(english_root.id, antonym.id, "related-to", "contains", 0.9),
        _edge(english_root.id, collocation.id, "related-to", "contains", 0.9),
        _edge(english_root.id, etymology.id, "related-to", "contains", 0.9),
        _edge(synonym.id, antonym.id, "contrast-with", "opposes", 0.65),
        _edge(synonym.id, collocation.id, "depends-on", "usage context", 0.45),
        _edge(etymology.id, synonym.id, "related-to", "explains meaning", 0.5),
        _edge(diagnosis.id, inflammation.id, "related-to", "often evaluates", 0.88),
        _edge(diagnosis.id, pathogen.id, "related-to", "often seeks cause", 0.78),
        _edge(inflammation.id, pathogen.id, "depends-on", "may be triggered by", 0.66),
        _edge(algorithm.id, graph_node.id, "part-of", "implemented on", 0.72),
        _edge(algorithm.id, recursion.id, "depends-on", "may use", 0.68),
        _edge(recursion.id, abstraction.id, "depends-on", "requires", 0.82),
        _edge(graph_node.id, abstraction.id, "related-to", "shares structure thinking", 0.74),
    ]

    documents = [
        KnowledgeDocument(
            id="demo-doc-english",
            title="Oxford-style vocabulary notes",
            type="demo",
            origin="demo",
            imported_at=datetime.now(timezone.utc).isoformat(),
            notes="用于演示词汇语义图谱与关联关系。",
        ),
        KnowledgeDocument(
            id="demo-doc-history",
            title="History chapter sketch",
            type="demo",
            origin="demo",
            imported_at=datetime.now(timezone.utc).isoformat(),
            notes="用于演示同主题知识融合。",
        ),
        KnowledgeDocument(
            id="demo-doc-science",
            title="Science and engineering notes",
            type="demo",
            origin="demo",
            imported_at=datetime.now(timezone.utc).isoformat(),
            notes="用于演示跨学科知识连接。",
        ),
    ]

    return KnowledgeGraphData(nodes=nodes, edges=edges, documents=documents)
