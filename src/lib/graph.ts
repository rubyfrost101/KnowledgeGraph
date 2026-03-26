import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type {
  ImportedKnowledgeBatch,
  KnowledgeAnswer,
  KnowledgeDocument,
  KnowledgeEdge,
  KnowledgeGraphData,
  KnowledgeNode,
} from '../types';
import { canonicalText, makeStableId, uniqueList } from './normalize';

function cloneNode(node: KnowledgeNode): KnowledgeNode {
  return {
    ...node,
    aliases: [...node.aliases],
    sources: [...node.sources],
  };
}

function cloneEdge(edge: KnowledgeEdge): KnowledgeEdge {
  return {
    ...edge,
    sources: [...edge.sources],
  };
}

export function mergeGraphData(
  base: KnowledgeGraphData,
  incoming: ImportedKnowledgeBatch,
): KnowledgeGraphData {
  const nodeMap = new Map<string, KnowledgeNode>();
  const labelToId = new Map<string, string>();
  const idRemap = new Map<string, string>();

  for (const node of base.nodes) {
    const copy = cloneNode(node);
    nodeMap.set(copy.id, copy);
    labelToId.set(canonicalText(copy.label), copy.id);
    idRemap.set(copy.id, copy.id);
    for (const alias of copy.aliases) {
      labelToId.set(canonicalText(alias), copy.id);
    }
  }

  for (const node of incoming.nodes) {
    const key = canonicalText(node.label);
    const existingId = labelToId.get(key);
    if (existingId) {
      idRemap.set(node.id, existingId);
      const existing = nodeMap.get(existingId);
      if (existing) {
        existing.summary = existing.summary || node.summary;
        existing.detail = [existing.detail, node.detail].filter(Boolean).join('\n\n');
        existing.aliases = uniqueList([...existing.aliases, ...node.aliases]);
        existing.sources = uniqueList([...existing.sources, ...node.sources]);
        existing.score = Math.max(existing.score, node.score);
      }
      continue;
    }

    const copy = cloneNode(node);
    nodeMap.set(copy.id, copy);
    labelToId.set(key, copy.id);
    idRemap.set(node.id, copy.id);
    for (const alias of copy.aliases) {
      labelToId.set(canonicalText(alias), copy.id);
    }
  }

  const edgeMap = new Map<string, KnowledgeEdge>();
  for (const edge of [...base.edges, ...incoming.edges]) {
    const source = idRemap.get(edge.source) ?? edge.source;
    const target = idRemap.get(edge.target) ?? edge.target;
    const key = `${source}:${edge.kind}:${target}:${canonicalText(edge.label)}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.weight = Math.max(existing.weight, edge.weight);
      existing.sources = uniqueList([...existing.sources, ...edge.sources]);
      continue;
    }
    edgeMap.set(key, {
      ...cloneEdge(edge),
      source,
      target,
    });
  }

  const documents: KnowledgeDocument[] = [...base.documents];
  const seenDocuments = new Set(documents.map((doc) => doc.id));
  for (const document of incoming.documents) {
    if (!seenDocuments.has(document.id)) {
      documents.push(document);
      seenDocuments.add(document.id);
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    documents,
  };
}

export function layoutGraph(
  data: KnowledgeGraphData,
  width: number,
  height: number,
  focusId?: string | null,
): KnowledgeGraphData {
  const nodes = data.nodes.map((node) => ({ ...node }));
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  type LinkDatum = { source: string; target: string; weight: number };

  const links: LinkDatum[] = data.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
  }));

  const centerX = width / 2;
  const centerY = height / 2;

  if (focusId && nodeById.has(focusId)) {
    const focusNode = nodeById.get(focusId);
    if (focusNode) {
      focusNode.fx = centerX;
      focusNode.fy = centerY;
    }
  }

  const simulation = forceSimulation(nodes as any)
    .force(
      'link',
      forceLink<KnowledgeNode, LinkDatum>(links as any)
        .id((d) => d.id)
        .distance((link) => 70 + (1 - link.weight) * 100)
        .strength((link) => Math.max(0.25, link.weight)),
    )
    .force('charge', forceManyBody().strength((node: any) => -260 - (node.score ?? 1) * 20))
    .force('collide', forceCollide().radius((node: any) => 28 + (node.score ?? 1) * 4))
    .force('center', forceCenter(centerX, centerY));

  for (let step = 0; step < 220; step += 1) {
    simulation.tick();
  }
  simulation.stop();

  return {
    ...data,
    nodes,
  };
}

export function collectNeighborhood(graph: KnowledgeGraphData, selectedId: string) {
  const adjacentIds = new Set<string>([selectedId]);
  const relatedEdges = graph.edges.filter((edge) => {
    const match = edge.source === selectedId || edge.target === selectedId;
    if (match) {
      adjacentIds.add(edge.source);
      adjacentIds.add(edge.target);
    }
    return match;
  });

  return {
    adjacentIds,
    relatedEdges,
  };
}

export function searchNode(graph: KnowledgeGraphData, query: string): KnowledgeNode[] {
  const needle = canonicalText(query);
  if (!needle) {
    return [];
  }

  return [...graph.nodes]
    .map((node) => {
      let score = 0;
      const label = canonicalText(node.label);
      const summary = canonicalText(node.summary);
      const detail = canonicalText(node.detail);
      if (label === needle) {
        score += 100;
      } else if (label.includes(needle)) {
        score += 60;
      }
      if (node.aliases.some((alias) => canonicalText(alias).includes(needle))) {
        score += 40;
      }
      if (summary.includes(needle)) {
        score += 20;
      }
      if (detail.includes(needle)) {
        score += 10;
      }
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.node);
}

export function answerQuestion(
  graph: KnowledgeGraphData,
  question: string,
  selectedId?: string | null,
): KnowledgeAnswer {
  const matches = searchNode(graph, question);
  const selected = selectedId ? graph.nodes.find((node) => node.id === selectedId) : undefined;
  const primary = matches[0] ?? selected;
  const supportingNodes = matches.slice(0, 4);

  if (!primary) {
    return {
      title: '暂时没有找到足够相关的知识点',
      answer: '你可以换一个更具体的提法，或者先导入一本书/一份 PDF，让图谱变得更有上下文。',
      supportingNodes: [],
      citations: [],
    };
  }

  const neighborhood = collectNeighborhood(graph, primary.id);
  const relatedNodes = graph.nodes.filter((node) => neighborhood.adjacentIds.has(node.id) && node.id !== primary.id);
  const topRelated = relatedNodes.slice(0, 4).map((node) => node.label).join('、');
  const sourceTitles = uniqueList(
    graph.documents
      .filter((document) => primary.sources.includes(document.id) || primary.sources.includes(document.origin))
      .map((document) => document.title),
  );

  const answerParts = [
    `我先定位到“${primary.label}”。${primary.summary}`,
    topRelated ? `它在图谱中常和 ${topRelated} 一起出现或形成对照。` : '',
    sourceTitles.length ? `相关来源包括：${sourceTitles.join('；')}。` : '',
    matches.length > 1 ? `另外还发现 ${matches.slice(1, 4).map((node) => node.label).join('、')} 也可能相关。` : '',
  ].filter(Boolean);

  return {
    title: `关于“${primary.label}”的回答`,
    answer: answerParts.join(' '),
    supportingNodes: [primary, ...supportingNodes.filter((node) => node.id !== primary.id)].slice(0, 4),
    citations: uniqueList([...primary.sources, ...relatedNodes.flatMap((node) => node.sources)]).slice(0, 6),
  };
}

export function createNodeFromHeading(label: string, category: string, sourceId: string, detail: string, kind: KnowledgeNode['kind'] = 'concept'): KnowledgeNode {
  return {
    id: makeStableId('node', `${sourceId}:${label}`),
    label,
    kind,
    category,
    summary: detail.split(/[。.!?]\s*/u)[0] ?? detail,
    detail,
    aliases: [],
    sources: [sourceId],
    score: 1,
  };
}
