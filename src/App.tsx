"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { answerQuestion, collectNeighborhood, layoutGraph, mergeGraphData, searchNode } from './lib/graph';
import { ingestText } from './lib/ingest';
import { readKnowledgeFile } from './lib/files';
import { demoGraph } from './lib/sampleData';
import { canonicalText, uniqueList } from './lib/normalize';
import type { KnowledgeAnswer, KnowledgeDocument, KnowledgeEdge, KnowledgeGraphData, KnowledgeJob, KnowledgeNode } from './types';
import {
  askBackendQuestion,
  deleteBackendDocument,
  deleteBackendNode,
  fetchBackendDocuments,
  fetchBackendGraph,
  fetchBackendJobs,
  fetchBackendNodes,
  ingestBackendText,
  isBackendConfigured,
  pollBackendJob,
  restoreBackendDocument,
  restoreBackendNode,
  uploadBackendFile,
} from './lib/backendClient';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 820;

const quickQuestions = [
  '什么是 collocation？',
  '为什么炎症和病原体有关？',
  '递归和抽象有什么关系？',
  '工业革命最重要的节点是什么？',
];

const backendConfigured = isBackendConfigured();

function kindLabel(kind: KnowledgeNode['kind']): string {
  switch (kind) {
    case 'book':
      return '书籍';
    case 'process':
      return '过程';
    case 'term':
      return '术语';
    case 'topic':
      return '主题';
    default:
      return '概念';
  }
}

function relationLabel(kind: string): string {
  switch (kind) {
    case 'is-a':
      return '属于';
    case 'contrast-with':
      return '对比';
    case 'part-of':
      return '组成';
    case 'depends-on':
      return '依赖';
    case 'same-domain':
      return '同域';
    default:
      return '关联';
  }
}

function relationTone(kind: string): string {
  switch (kind) {
    case 'contrast-with':
      return 'tone-contrast';
    case 'depends-on':
      return 'tone-depend';
    case 'part-of':
      return 'tone-part';
    case 'is-a':
      return 'tone-hierarchy';
    default:
      return 'tone-related';
  }
}

function nodeTone(kind: KnowledgeNode['kind']): string {
  switch (kind) {
    case 'book':
      return 'node-book';
    case 'process':
      return 'node-process';
    case 'term':
      return 'node-term';
    case 'topic':
      return 'node-topic';
    default:
      return 'node-concept';
  }
}

function jobStatusLabel(status: KnowledgeJob['status']): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '处理中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function jobStatusTone(status: KnowledgeJob['status']): string {
  switch (status) {
    case 'queued':
      return 'job-queued';
    case 'running':
      return 'job-running';
    case 'completed':
      return 'job-completed';
    case 'failed':
      return 'job-failed';
    default:
      return 'job-neutral';
  }
}

function formatRelativeTime(timestamp?: string | null): string {
  if (!timestamp) {
    return '刚刚';
  }
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) {
    return '刚刚';
  }
  const diffSeconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (diffSeconds < 60) {
    return '刚刚';
  }
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function mergeJobs(current: KnowledgeJob[], incoming: KnowledgeJob): KnowledgeJob[] {
  const next = current.filter((job) => job.jobId !== incoming.jobId);
  next.unshift(incoming);
  return next.sort((left, right) => {
    const leftTime = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
    const rightTime = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
    return rightTime - leftTime;
  });
}

function splitDetail(detail: string): { narrative: string; citations: string[] } {
  const lines = detail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const citations = lines.filter((line) => line.startsWith('引用：') || line.startsWith('原句：'));
  const narrative = lines.filter((line) => !line.startsWith('引用：') && !line.startsWith('原句：')).join(' ');
  return {
    narrative,
    citations,
  };
}

function truncateText(value: string, limit = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit).trimEnd()}…`;
}

type SectionSummaryParts = {
  card: string;
  keywords: string[];
  oneLine: string;
};

function splitSectionSummary(summary: string, fallbackLabel: string): SectionSummaryParts {
  const lines = summary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const structured: SectionSummaryParts = {
    card: fallbackLabel,
    keywords: [],
    oneLine: '',
  };
  let matchedStructuredLine = false;
  for (const line of lines) {
    if (line.startsWith('目录卡片：')) {
      structured.card = line.replace('目录卡片：', '').trim() || fallbackLabel;
      matchedStructuredLine = true;
      continue;
    }
    if (line.startsWith('关键词：')) {
      structured.keywords = uniqueList(
        line
          .replace('关键词：', '')
          .split(/[\/、,，；;|]/)
          .map((item) => item.trim())
          .filter(Boolean),
      );
      matchedStructuredLine = true;
      continue;
    }
    if (line.startsWith('一句话总结：')) {
      structured.oneLine = line.replace('一句话总结：', '').trim();
      matchedStructuredLine = true;
      continue;
    }
  }
  if (!matchedStructuredLine) {
    const compact = truncateText(summary || fallbackLabel, 96);
    return {
      card: fallbackLabel,
      keywords: [],
      oneLine: compact,
    };
  }
  return {
    card: structured.card || fallbackLabel,
    keywords: structured.keywords,
    oneLine: structured.oneLine || truncateText(summary || fallbackLabel, 96),
  };
}

function splitCitationPreview(citation: string): { source: string; path: string; context: string; original: string } {
  const parts = citation
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const source = parts.find((line) => line.startsWith('引用：'))?.replace('引用：', '').trim() ?? '';
  const context = parts.find((line) => line.startsWith('上下文：'))?.replace('上下文：', '').trim() ?? '';
  const original = parts.find((line) => line.startsWith('原句：'))?.replace('原句：', '').trim() ?? '';
  const path = source.includes('·') ? source.split('·').slice(1).join('·').trim() : source;
  return {
    source,
    path,
    context,
    original,
  };
}

function isSectionNode(node: KnowledgeNode): boolean {
  return node.kind === 'book' || node.kind === 'topic';
}

type GlossaryTreeNode = {
  node: KnowledgeNode;
  children: GlossaryTreeNode[];
  items: KnowledgeNode[];
};

type GlossaryTreeIndex = {
  roots: GlossaryTreeNode[];
  orphans: KnowledgeNode[];
  nodesById: Map<string, KnowledgeNode>;
  nodesByCanonicalLabel: Map<string, KnowledgeNode[]>;
  sectionParentById: Map<string, string>;
  sectionChildrenById: Map<string, Set<string>>;
  itemsBySectionId: Map<string, Set<string>>;
  itemParentById: Map<string, string>;
};

type HoverPreview = {
  title: string;
  subtitle: string;
  body: string;
  note?: string;
};

function buildGlossaryTree(graph: KnowledgeGraphData): GlossaryTreeIndex {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodesByCanonicalLabel = new Map<string, KnowledgeNode[]>();
  const sectionParentById = new Map<string, string>();
  const sectionChildrenById = new Map<string, Set<string>>();
  const itemsBySectionId = new Map<string, Set<string>>();
  const itemParentById = new Map<string, string>();
  const attachedItemIds = new Set<string>();

  const indexNode = (node: KnowledgeNode, value: string) => {
    const key = canonicalText(value);
    if (!key) {
      return;
    }
    const existing = nodesByCanonicalLabel.get(key) ?? [];
    if (existing.some((candidate) => candidate.id === node.id)) {
      return;
    }
    nodesByCanonicalLabel.set(key, [...existing, node]);
  };

  for (const node of graph.nodes) {
    indexNode(node, node.label);
    for (const alias of node.aliases) {
      indexNode(node, alias);
    }
  }

  for (const edge of graph.edges) {
    if (edge.kind !== 'part-of') {
      continue;
    }
    if (edge.source === edge.target) {
      continue;
    }
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    if (isSectionNode(source) && isSectionNode(target)) {
      if (!sectionParentById.has(source.id)) {
        sectionParentById.set(source.id, target.id);
        const children = sectionChildrenById.get(target.id) ?? new Set<string>();
        children.add(source.id);
        sectionChildrenById.set(target.id, children);
      }
      continue;
    }
    if (!isSectionNode(source) && isSectionNode(target)) {
      if (!itemParentById.has(source.id)) {
        const items = itemsBySectionId.get(target.id) ?? new Set<string>();
        items.add(source.id);
        itemsBySectionId.set(target.id, items);
        itemParentById.set(source.id, target.id);
        attachedItemIds.add(source.id);
      }
    }
  }

  const buildNode = (sectionId: string, path: Set<string> = new Set()): GlossaryTreeNode | null => {
    if (path.has(sectionId)) {
      return null;
    }
    const node = nodesById.get(sectionId);
    if (!node) {
      return null;
    }
    const nextPath = new Set(path);
    nextPath.add(sectionId);
    const childIds = Array.from(sectionChildrenById.get(sectionId) ?? []).sort((left, right) => {
      const leftNode = nodesById.get(left);
      const rightNode = nodesById.get(right);
      return (leftNode?.label ?? left).localeCompare(rightNode?.label ?? right, 'zh-Hans-CN');
    });
    const children = childIds
      .map((childId) => buildNode(childId, nextPath))
      .filter((child): child is GlossaryTreeNode => child !== null);
    const itemIds = Array.from(itemsBySectionId.get(sectionId) ?? []).sort((left, right) => {
      const leftNode = nodesById.get(left);
      const rightNode = nodesById.get(right);
      return (leftNode?.label ?? left).localeCompare(rightNode?.label ?? right, 'zh-Hans-CN');
    });
    const items = itemIds
      .map((itemId) => nodesById.get(itemId))
      .filter((item): item is KnowledgeNode => Boolean(item));
    return {
      node,
      children,
      items,
    };
  };

  const roots = graph.nodes
    .filter((node) => isSectionNode(node) && !sectionParentById.has(node.id))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'))
    .map((node) => buildNode(node.id))
    .filter((node): node is GlossaryTreeNode => node !== null);

  const orphanItems = graph.nodes.filter((node) => !isSectionNode(node) && !attachedItemIds.has(node.id));
  const orphans = orphanItems.filter((node) => node.kind === 'term' || node.kind === 'concept' || node.kind === 'process');

  return {
    roots,
    orphans,
    nodesById,
    nodesByCanonicalLabel,
    sectionParentById,
    sectionChildrenById,
    itemsBySectionId,
    itemParentById,
  };
}

function buildGlossaryTrail(
  nodeId: string,
  sectionParentById: Map<string, string>,
  itemParentById: Map<string, string>,
): string[] {
  const trail: string[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = nodeId;

  while (currentId && !seen.has(currentId)) {
    trail.unshift(currentId);
    seen.add(currentId);
    currentId = sectionParentById.get(currentId) ?? itemParentById.get(currentId);
  }

  return trail;
}

function resolveGlossaryCitationTarget(
  citation: string,
  glossaryIndex: GlossaryTreeIndex,
  sourceNode: KnowledgeNode | null,
): KnowledgeNode | null {
  if (citation.startsWith('原句：')) {
    return sourceNode;
  }

  const normalizedCitation = citation.replace(/^引用：/, '').trim();
  const pathText = normalizedCitation.includes('·')
    ? normalizedCitation.split('·').slice(1).join('·').trim()
    : normalizedCitation;
  const segments = pathText
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reverse();

  for (const segment of segments) {
    const target = glossaryIndex.nodesByCanonicalLabel.get(canonicalText(segment))?.[0];
    if (target) {
      return target;
    }
  }

  return glossaryIndex.nodesByCanonicalLabel.get(canonicalText(pathText))?.[0] ?? null;
}

function App() {
  const [graph, setGraph] = useState<KnowledgeGraphData>(demoGraph);
  const [selectedId, setSelectedId] = useState<string>(demoGraph.nodes[0]?.id ?? '');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [layout, setLayout] = useState<KnowledgeGraphData>(() =>
    layoutGraph(demoGraph, CANVAS_WIDTH, CANVAS_HEIGHT, demoGraph.nodes[0]?.id),
  );
  const [query, setQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [status, setStatus] = useState('准备就绪，先试试示例图谱。');
  const [importTextValue, setImportTextValue] = useState('');
  const [viewMode, setViewMode] = useState<'graph' | 'glossary'>('graph');
  const [citationPreview, setCitationPreview] = useState<HoverPreview | null>(null);
  const [searchMatches, setSearchMatches] = useState<KnowledgeNode[]>([]);
  const [expandedGlossaryIds, setExpandedGlossaryIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<KnowledgeJob[]>([]);
  const [deletedDocuments, setDeletedDocuments] = useState<KnowledgeDocument[]>([]);
  const [deletedNodes, setDeletedNodes] = useState<KnowledgeNode[]>([]);
  const [busy, setBusy] = useState(false);
  const glossaryIndex = buildGlossaryTree(graph);
  const isGlossaryView = viewMode === 'glossary';

  useEffect(() => {
    const selectedExists = graph.nodes.some((node) => node.id === selectedId);
    const nextSelected = selectedExists ? selectedId : graph.nodes[0]?.id ?? '';
    if (nextSelected !== selectedId) {
      setSelectedId(nextSelected);
    }
    setLayout(layoutGraph(graph, CANVAS_WIDTH, CANVAS_HEIGHT, nextSelected));
  }, [graph, selectedId]);

  useEffect(() => {
    setSearchMatches(searchNode(graph, query).slice(0, 6));
  }, [graph, query]);

  useEffect(() => {
    if (viewMode !== 'glossary') {
      return;
    }
    if (glossaryIndex.roots.length === 0) {
      return;
    }
    setExpandedGlossaryIds((current) => {
      const next = new Set(current);
      if (current.length === 0) {
        for (const root of glossaryIndex.roots) {
          next.add(root.node.id);
        }
      }
      for (const ancestorId of buildGlossaryTrail(selectedId, glossaryIndex.sectionParentById, glossaryIndex.itemParentById).slice(0, -1)) {
        next.add(ancestorId);
      }
      return Array.from(next);
    });
  }, [graph, selectedId, viewMode]);

  async function syncRemoteCollections() {
    const [remoteGraph, remoteDocuments, remoteNodes, remoteJobs] = await Promise.all([
      fetchBackendGraph(),
      fetchBackendDocuments(true),
      fetchBackendNodes(true),
      fetchBackendJobs(12),
    ]);
    setGraph(remoteGraph);
    setDeletedDocuments(remoteDocuments.filter((document) => document.status === 'deleted'));
    setDeletedNodes(remoteNodes.filter((node) => Boolean(node.deletedAt)));
    setJobs(remoteJobs);
  }

  useEffect(() => {
    let active = true;

    async function hydrateFromBackend() {
      if (!backendConfigured) {
        return;
      }

      setStatus('正在连接后端知识库...');
      try {
        const [remoteGraph, remoteDocuments, remoteNodes, remoteJobs] = await Promise.all([
          fetchBackendGraph(),
          fetchBackendDocuments(true),
          fetchBackendNodes(true),
          fetchBackendJobs(12),
        ]);
        if (!active) {
          return;
        }
        setGraph(remoteGraph);
        setDeletedDocuments(remoteDocuments.filter((document) => document.status === 'deleted'));
        setDeletedNodes(remoteNodes.filter((node) => Boolean(node.deletedAt)));
        setJobs(remoteJobs);
        setStatus('已连接后端知识库。');
      } catch {
        if (active) {
          setStatus('后端暂不可用，继续使用本地图谱。');
        }
      }
    }

    void hydrateFromBackend();
    return () => {
      active = false;
    };
  }, []);

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedLayoutNode = layout.nodes.find((node) => node.id === selectedId) ?? selectedNode;
  const neighborhood = selectedId ? collectNeighborhood(graph, selectedId) : null;
  const relatedNodes = selectedId
    ? layout.nodes.filter((node) => neighborhood?.adjacentIds.has(node.id) && node.id !== selectedId)
    : [];
  const selectedEdges = selectedId ? neighborhood?.relatedEdges ?? [] : [];
  const activeTask = jobs.find((job) => job.status === 'running' || job.status === 'queued') ?? jobs[0] ?? null;
  const recentJobs = jobs.slice(0, 6);
  const glossaryTrail = selectedId ? buildGlossaryTrail(selectedId, glossaryIndex.sectionParentById, glossaryIndex.itemParentById) : [];
  const glossarySelectedNode = selectedNode;
  const glossaryChildSections = selectedId
    ? Array.from(glossaryIndex.sectionChildrenById.get(selectedId) ?? [])
        .map((childId) => glossaryIndex.nodesById.get(childId))
        .filter((node): node is KnowledgeNode => Boolean(node))
    : [];
  const glossaryChildItems = selectedId
    ? Array.from(glossaryIndex.itemsBySectionId.get(selectedId) ?? [])
        .map((childId) => glossaryIndex.nodesById.get(childId))
        .filter((node): node is KnowledgeNode => Boolean(node))
    : [];
  const detailNode = viewMode === 'glossary' ? glossarySelectedNode : selectedNode;
  const detailParts = detailNode ? splitDetail(detailNode.detail) : { narrative: '', citations: [] as string[] };
  const detailSummaryParts = detailNode && isGlossaryView ? splitSectionSummary(detailNode.summary, detailNode.label) : null;

  async function importRawText(text: string, origin: string, type: 'text' | 'pdf') {
    const trimmed = text.trim();
    if (!trimmed) {
      setStatus('没有可导入的内容。');
      return;
    }

    setBusy(true);
    try {
      if (backendConfigured) {
        const result = await ingestBackendText({
          text: trimmed,
          origin,
          title: origin,
          source_type: type,
        });
        await syncRemoteCollections();
        setStatus(result.summary);
      } else {
        const result = await ingestText(trimmed, origin);
        const documents: KnowledgeDocument[] = result.batch.documents.map((document) => ({
          ...document,
          type,
          origin,
        }));
        const payload = {
          ...result.batch,
          documents,
        };
        setGraph((current) => mergeGraphData(current, payload));
        setSelectedId(result.batch.nodes[0]?.id ?? selectedId);
        setStatus(result.summary);
      }
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setBusy(true);
    try {
      if (backendConfigured) {
        const job = await uploadBackendFile({
          file,
          title: file.name,
          origin: file.name,
        });
        setJobs((current) => mergeJobs(current, job));
        setStatus(`文件已上传，任务已进入 ${jobStatusLabel(job.status)}。`);

        let currentJob = job;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (currentJob.status === 'completed' || currentJob.status === 'failed') {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          currentJob = await pollBackendJob(job.jobId);
          setJobs((current) => mergeJobs(current, currentJob));
          setStatus(`任务 ${jobStatusLabel(currentJob.status)}，进度 ${currentJob.progress}%`);
        }

        if (currentJob.status === 'failed') {
          throw new Error(currentJob.error || '后端任务失败');
        }

        await syncRemoteCollections();
        setStatus(currentJob.summary || '文件已导入。');
      } else {
        const { text, pageCount } = await readKnowledgeFile(file);
        const result = await ingestText(text, file.name);
        const documents: KnowledgeDocument[] = result.batch.documents.map((document) => ({
          ...document,
          type: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
          origin: file.name,
          pageCount,
        }));
        setGraph((current) => mergeGraphData(current, { ...result.batch, documents }));
        setSelectedId(result.batch.nodes[0]?.id ?? selectedId);
        setStatus(
          pageCount
            ? `已导入 ${file.name}，解析 ${pageCount} 页，提取 ${result.batch.nodes.length} 个知识点。`
            : `已导入 ${file.name}，提取 ${result.batch.nodes.length} 个知识点。`,
        );
      }
      setAnswer(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导入失败，请检查文件格式。');
    } finally {
      setBusy(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt) {
      setStatus('先输入一个问题。');
      return;
    }

    setBusy(true);
    try {
      const result = backendConfigured
        ? await askBackendQuestion({ question: prompt, contextNodeId: selectedId, topK: 5 })
        : answerQuestion(graph, prompt, selectedId);
      setAnswer(result);
      setStatus(`已生成回答：${result.title}`);
    } finally {
      setBusy(false);
    }
  }

  function resetDemo() {
    setGraph(demoGraph);
    setSelectedId(demoGraph.nodes[0]?.id ?? '');
    setQuery('');
    setQuestion('');
    setAnswer(null);
    setViewMode('graph');
    setExpandedGlossaryIds([]);
    setJobs([]);
    setDeletedDocuments([]);
    setDeletedNodes([]);
    setStatus('已恢复示例图谱。');
  }

  function applySearchSelection(node: KnowledgeNode) {
    setSelectedId(node.id);
    setQuery(node.label);
    setStatus(`已聚焦到“${node.label}”。`);
  }

  function toggleGlossarySection(sectionId: string) {
    setExpandedGlossaryIds((current) =>
      current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId],
    );
  }

  function expandGlossaryAncestors(nodeId: string) {
    setExpandedGlossaryIds((current) => {
      const next = new Set(current);
      for (const ancestorId of buildGlossaryTrail(nodeId, glossaryIndex.sectionParentById, glossaryIndex.itemParentById).slice(0, -1)) {
        next.add(ancestorId);
      }
      return Array.from(next);
    });
  }

  function scrollGlossaryNodeIntoView(nodeId: string) {
    window.setTimeout(() => {
      document.getElementById(`glossary-node-${nodeId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }, 0);
  }

  function focusGlossaryNode(node: KnowledgeNode) {
    setSelectedId(node.id);
    setViewMode('glossary');
    expandGlossaryAncestors(node.id);
    setStatus(`已在术语表中定位到“${node.label}”。`);
    scrollGlossaryNodeIntoView(node.id);
  }

  function focusGlossaryReference(referenceId: string) {
    const target = glossaryIndex.nodesById.get(referenceId);
    if (target) {
      focusGlossaryNode(target);
    }
  }

  function showReferencePreview(target: KnowledgeNode) {
    const detailParts = splitDetail(target.detail);
    setCitationPreview({
      title: target.label,
      subtitle: `${kindLabel(target.kind)} · ${target.category}`,
      body: truncateText(detailParts.narrative || target.summary || target.detail, 220),
      note: target.referenceIds.length > 0 ? '来源锚点可继续跳转到上级目录。' : '当前节点没有更上层的引用锚点。',
    });
  }

  function showCitationPreview(citation: string, target: KnowledgeNode | null) {
    const parsed = splitCitationPreview(citation);
    setCitationPreview({
      title: target?.label ?? parsed.source ?? '引用预览',
      subtitle: target ? `${kindLabel(target.kind)} · ${target.category}` : parsed.path || parsed.source || '引用来源',
      body: truncateText(parsed.context || parsed.original || target?.summary || citation, 240),
      note: parsed.original && parsed.original !== parsed.context ? `原句：${parsed.original}` : undefined,
    });
  }

  function renderReferenceChips(referenceIds: string[], label = '来源锚点') {
    const targets = referenceIds
      .map((referenceId) => glossaryIndex.nodesById.get(referenceId))
      .filter((node): node is KnowledgeNode => Boolean(node));
    if (targets.length === 0) {
      return <span className="muted">{label}：暂无</span>;
    }
    return (
      <div className="anchor-chip-row">
        {targets.map((target) => (
          <button
            key={target.id}
            className="anchor-chip"
            type="button"
            onClick={() => focusGlossaryReference(target.id)}
            onMouseEnter={() => showReferencePreview(target)}
            onMouseLeave={() => setCitationPreview(null)}
            onFocus={() => showReferencePreview(target)}
            onBlur={() => setCitationPreview(null)}
          >
            <span className="anchor-chip-kind">{kindLabel(target.kind)}</span>
            <strong>{target.label}</strong>
          </button>
        ))}
      </div>
    );
  }

  function renderCitationChips(citations: string[], sourceNode: KnowledgeNode | null) {
    if (citations.length === 0) {
      return null;
    }
    return (
      <div className="citation-stack">
        {citations.map((citation) => {
          const target = resolveGlossaryCitationTarget(citation, glossaryIndex, sourceNode);
          if (!target) {
            return (
              <div key={citation} className="citation-line">
                <span className="citation">{citation}</span>
              </div>
            );
          }
          return (
            <button
              key={citation}
              type="button"
              className="citation-line citation-button"
              onClick={() => focusGlossaryNode(target)}
              onMouseEnter={() => showCitationPreview(citation, target)}
              onMouseLeave={() => setCitationPreview(null)}
              onFocus={() => showCitationPreview(citation, target)}
              onBlur={() => setCitationPreview(null)}
            >
              <span className="citation">{citation}</span>
              <span className="citation-jump">跳转</span>
            </button>
          );
        })}
      </div>
    );
  }

  async function applyDocumentMutation(documentId: string, action: 'delete' | 'restore') {
    setBusy(true);
    try {
      const result =
        action === 'delete'
          ? await deleteBackendDocument(documentId)
          : await restoreBackendDocument(documentId);
      await syncRemoteCollections();
      setStatus(result.message);
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  async function applyNodeMutation(action: 'delete' | 'restore', nodeId: string = selectedNode?.id ?? '') {
    if (!nodeId) {
      return;
    }
    setBusy(true);
    try {
      const result =
        action === 'delete'
          ? await deleteBackendNode(nodeId)
          : await restoreBackendNode(nodeId);
      await syncRemoteCollections();
      setStatus(result.message);
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  function renderGlossarySection(section: GlossaryTreeNode, depth = 0) {
    const isOpen = depth === 0 || expandedGlossaryIds.includes(section.node.id);
    const detailParts = splitDetail(section.node.detail);
    const summaryParts = splitSectionSummary(section.node.summary, section.node.label);
    const summaryKeywords = summaryParts.keywords.length > 0
      ? summaryParts.keywords
      : uniqueList([...section.children.map((child) => child.node.label), ...section.items.map((item) => item.label)]).slice(0, 4);
    const isSelected = selectedId === section.node.id;
    return (
      <div
        key={section.node.id}
        id={`glossary-node-${section.node.id}`}
        className={`glossary-section ${isSelected ? 'is-selected' : ''}`}
        data-depth={depth}
      >
        <button
          className="glossary-section-head"
          type="button"
          onClick={() => {
            toggleGlossarySection(section.node.id);
            focusGlossaryNode(section.node);
          }}
        >
          <div className="glossary-section-title">
            <strong>{section.node.label}</strong>
            <span>
              {kindLabel(section.node.kind)} · {section.children.length} 小节 · {section.items.length} 条术语
            </span>
          </div>
          <div className="glossary-section-meta">
            <span>{isOpen ? '收起' : '展开'}</span>
            <span>{detailParts.citations.length > 0 ? '含引用' : '无引用'}</span>
          </div>
        </button>

        {isOpen ? (
          <div className="glossary-section-body">
            <div className="glossary-section-summary">
              <div className="summary-card">
                <div className="summary-card-head">
                  <span className="summary-card-kicker">目录卡片</span>
                  <strong>{summaryParts.card}</strong>
                </div>
                <div className="summary-keyword-row">
                  {summaryKeywords.length > 0 ? (
                    summaryKeywords.map((keyword) => (
                      <span key={keyword} className="summary-keyword-pill">
                        {keyword}
                      </span>
                    ))
                  ) : (
                    <span className="muted">暂无关键词</span>
                  )}
                </div>
                <p>{summaryParts.oneLine || detailParts.narrative || section.node.summary}</p>
              </div>
              {section.node.referenceIds.length > 0 ? renderReferenceChips(section.node.referenceIds) : null}
              {renderCitationChips(detailParts.citations, section.node)}
            </div>

            {section.items.length > 0 ? (
              <div className="glossary-item-grid">
                {section.items.map((item) => {
                  const itemParts = splitDetail(item.detail);
                  const evidence = itemParts.citations.length > 0 ? itemParts.citations : [];
                  return (
                    <article
                      key={item.id}
                      id={`glossary-node-${item.id}`}
                      className={`glossary-item ${selectedId === item.id ? 'is-selected' : ''}`}
                    >
                      <button className="glossary-item-main" type="button" onClick={() => focusGlossaryNode(item)}>
                        <div className="glossary-item-head">
                          <strong>{item.label}</strong>
                          <span>{kindLabel(item.kind)}</span>
                        </div>
                        <p>{itemParts.narrative || item.summary}</p>
                      </button>
                      {item.referenceIds.length > 0 ? renderReferenceChips(item.referenceIds) : null}
                      {evidence.length > 0 ? renderCitationChips(evidence.slice(0, 2), item) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="muted">这一节下还没有抽取到术语。</p>
            )}

            {section.children.length > 0 ? (
              <div className="glossary-child-list">
                {section.children.map((child) => renderGlossarySection(child, depth + 1))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div>
          <p className="eyebrow">KnowledgeGraph</p>
          <h1>把书、词典和课堂笔记变成会“关联思考”的知识图谱。</h1>
        </div>
        <div className="topbar-meta">
          <div className="metric">
            <span>知识点</span>
            <strong>{graph.nodes.length}</strong>
          </div>
          <div className="metric">
            <span>关系</span>
            <strong>{graph.edges.length}</strong>
          </div>
          <div className="metric">
            <span>文档</span>
            <strong>{graph.documents.length}</strong>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel library-panel">
          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Library</p>
                <h2>导入入口</h2>
              </div>
              <button className="ghost-button" type="button" onClick={resetDemo}>
                恢复示例
              </button>
            </div>

            <label className="file-drop">
              <input
                type="file"
                accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.tif,.tiff,text/plain,application/pdf,image/*"
                onChange={handleFileChange}
              />
              <span>拖拽或点击上传 PDF / TXT / MD / 图片</span>
              <small>PDF 会先提取文字，扫描件和图片会走 OCR 兜底。</small>
            </label>

            <div className="divider" />

            <label className="field">
              <span>粘贴文本后直接导入</span>
              <textarea
                value={importTextValue}
                onChange={(event) => setImportTextValue(event.target.value)}
                placeholder="例如：\n# Chapter 1\nSynonym: words with similar meanings...\nAntonym: opposite meanings..."
                rows={10}
              />
            </label>
            <div className="actions-row">
              <button
                className="primary-button"
                type="button"
                onClick={() => importRawText(importTextValue, 'clipboard', 'text')}
                disabled={busy}
              >
                导入文本
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setImportTextValue('')}
              >
                清空
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Search</p>
                <h2>快速定位</h2>
              </div>
            </div>
            <label className="field">
              <span>搜索知识点</span>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入单词、术语或主题"
              />
            </label>
            <div className="search-results">
              {searchMatches.length === 0 ? (
                <p className="muted">输入后会显示候选节点。</p>
              ) : (
                searchMatches.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="search-result"
                    onClick={() => applySearchSelection(node)}
                  >
                    <strong>{node.label}</strong>
                    <span>{node.summary}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="card task-card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Tasks</p>
                <h2>任务中心</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => void syncRemoteCollections()} disabled={!backendConfigured || busy}>
                刷新
              </button>
            </div>

            {activeTask ? (
              <div className="task-hero">
                <div className="task-hero-head">
                  <div>
                    <strong>{activeTask.filename}</strong>
                    <span>{activeTask.summary || '正在等待任务结果。'}</span>
                  </div>
                  <span className={`status-chip ${jobStatusTone(activeTask.status)}`}>{jobStatusLabel(activeTask.status)}</span>
                </div>
                <div className="progress-shell">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, activeTask.progress))}%` }} />
                  </div>
                </div>
                <div className="task-hero-meta">
                  <span>{activeTask.kind === 'upload' ? '导入任务' : activeTask.kind}</span>
                  <span>{activeTask.progress}%</span>
                  <span>{formatRelativeTime(activeTask.updatedAt ?? activeTask.createdAt)}</span>
                </div>
                {activeTask.error ? <p className="task-error">{activeTask.error}</p> : null}
              </div>
            ) : (
              <p className="muted">暂无后台任务。导入文件后，进度会在这里实时显示。</p>
            )}

            <div className="task-list">
              {recentJobs.length === 0 ? (
                <p className="muted">这里会显示最近的导入历史和处理进度。</p>
              ) : (
                recentJobs.map((job) => (
                  <article key={job.jobId} className="task-item">
                    <div className="task-item-head">
                      <div>
                        <strong>{job.filename}</strong>
                        <span>{job.summary || '等待更新'}</span>
                      </div>
                      <span className={`status-chip ${jobStatusTone(job.status)}`}>{jobStatusLabel(job.status)}</span>
                    </div>
                    <div className="progress-shell progress-shell-sm">
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} />
                      </div>
                    </div>
                    <div className="task-item-meta">
                      <span>{job.progress}%</span>
                      <span>{formatRelativeTime(job.updatedAt ?? job.createdAt)}</span>
                      <span>#{job.documentId.slice(0, 8)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Documents</p>
                <h2>已导入文档</h2>
              </div>
            </div>
            <div className="search-results">
              {graph.documents.length === 0 ? (
                <p className="muted">暂无文档。</p>
              ) : (
                graph.documents.map((document) => (
                  <div key={document.id} className="search-result">
                    <strong>{document.title}</strong>
                    <span>
                      {document.type} · {document.origin}
                    </span>
                    <div className="actions-row">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => applyDocumentMutation(document.id, 'delete')}
                        disabled={busy}
                      >
                        撤回导入
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Recycle Bin</p>
                <h2>回收站</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => void syncRemoteCollections()} disabled={!backendConfigured || busy}>
                同步
              </button>
            </div>

            <div className="trash-summary">
              <span className="pill">已删除文档 {deletedDocuments.length}</span>
              <span className="pill">已删除知识点 {deletedNodes.length}</span>
              <span className="pill">可恢复来源 {deletedNodes.filter((node) => node.sources.length > 0).length}</span>
            </div>

            <div className="section-block">
              <h3>已删除文档</h3>
              <div className="trash-list">
                {deletedDocuments.length === 0 ? (
                  <p className="muted">暂无可恢复的文档。</p>
                ) : (
                  deletedDocuments.map((document) => (
                    <article key={document.id} className="trash-item">
                      <div className="trash-item-head">
                        <div>
                          <strong>{document.title}</strong>
                          <span>{document.type} · {document.origin}</span>
                        </div>
                        <span className="pill">删除于 {formatRelativeTime(document.deletedAt)}</span>
                      </div>
                      <p className="trash-item-copy">{document.notes || '这份文档目前处于回收站，恢复后会重新合并到图谱里。'}</p>
                      <div className="trash-item-meta">
                        <span className="pill">{document.status === 'deleted' ? '已删除' : document.status}</span>
                        <span className="pill">{document.deletedReason || '软删除'}</span>
                      </div>
                      <div className="actions-row">
                        <button className="ghost-button" type="button" onClick={() => applyDocumentMutation(document.id, 'restore')} disabled={busy}>
                          恢复文档
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="section-block">
              <h3>已删除知识点</h3>
              <div className="trash-list">
                {deletedNodes.length === 0 ? (
                  <p className="muted">暂无可恢复的知识点。</p>
                ) : (
                  deletedNodes.map((node) => (
                    <article key={node.id} className="trash-item">
                      <div className="trash-item-head">
                        <div>
                          <strong>{node.label}</strong>
                          <span>
                            {kindLabel(node.kind)} · {node.category}
                          </span>
                        </div>
                        <span className="pill">来源 {node.sources.length}</span>
                      </div>
                      <p className="trash-item-copy">{node.deletedReason || '已软删除的知识点会保留来源痕迹，便于恢复和追溯。'}</p>
                      <div className="trash-item-meta">
                        <span className="pill">删除于 {formatRelativeTime(node.deletedAt)}</span>
                        {node.sources.slice(0, 3).map((source) => (
                          <span key={source} className="pill">
                            {source}
                          </span>
                        ))}
                      </div>
                      <div className="actions-row">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => {
                            void applyNodeMutation('restore', node.id);
                          }}
                          disabled={busy || node.sources.length === 0}
                        >
                          {node.sources.length === 0 ? '先恢复来源文档' : '恢复知识点'}
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div>
              <p className="card-kicker">Graph</p>
              <h2>{viewMode === 'glossary' ? '术语表' : selectedLayoutNode ? selectedLayoutNode.label : '选择一个知识点'}</h2>
            </div>
            <div className="toolbar-actions">
              <div className="view-toggle">
                <button
                  className={`view-tab ${viewMode === 'graph' ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setViewMode('graph')}
                >
                  图谱
                </button>
                <button
                  className={`view-tab ${viewMode === 'glossary' ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setViewMode('glossary')}
                >
                  术语表
                </button>
              </div>
              <div className="toolbar-badges">
                <span>{selectedNode ? kindLabel(selectedNode.kind) : '无选中'}</span>
                <span>{selectedNode?.category ?? '待聚焦'}</span>
                <span>{backendConfigured ? '后端模式' : '本地模式'}</span>
                <span>{busy ? '处理中' : status}</span>
              </div>
            </div>
          </div>

          <div className={`graph-shell ${isGlossaryView ? 'is-glossary' : ''}`}>
            {viewMode === 'graph' ? (
              <svg
                className="graph-svg"
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                role="img"
                aria-label="Knowledge graph"
              >
                <defs>
                  <linearGradient id="edgeGradient" x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" stopColor="rgba(125, 150, 255, 0.08)" />
                    <stop offset="100%" stopColor="rgba(240, 158, 100, 0.75)" />
                  </linearGradient>
                  <filter id="nodeGlow" x="-60%" y="-60%" width="220%" height="220%">
                    <feGaussianBlur stdDeviation="8" result="blur" />
                    <feColorMatrix
                      in="blur"
                      type="matrix"
                      values="1 0 0 0 0.2 0 1 0 0 0.3 0 0 1 0 0.6 0 0 0 0.9 0"
                    />
                    <feMerge>
                      <feMergeNode />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {layout.edges.map((edge) => {
                  const source = layout.nodes.find((node) => node.id === edge.source);
                  const target = layout.nodes.find((node) => node.id === edge.target);
                  if (!source || !target) {
                    return null;
                  }
                  const active = selectedId ? edge.source === selectedId || edge.target === selectedId : false;
                  const neutral = selectedId ? !active : false;
                  return (
                    <g key={edge.id} className={`edge-group ${neutral ? 'is-dimmed' : ''}`}>
                      <line
                        x1={source.x ?? 0}
                        y1={source.y ?? 0}
                        x2={target.x ?? 0}
                        y2={target.y ?? 0}
                        className={`edge-line ${relationTone(edge.kind)} ${active ? 'is-active' : ''}`}
                      />
                      {active ? (
                        <text
                          x={((source.x ?? 0) + (target.x ?? 0)) / 2}
                          y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 6}
                          className="edge-label"
                        >
                          {relationLabel(edge.kind)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}

                {layout.nodes.map((node) => {
                  const isSelected = node.id === selectedId;
                  const isRelated = selectedId ? neighborhood?.adjacentIds.has(node.id) : true;
                  const isHovered = hoveredId === node.id;
                  const dimmed = selectedId ? !isSelected && !isRelated : false;
                  const size = isSelected ? 34 : node.score > 2 ? 28 : 22;
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
                      className={`graph-node ${dimmed ? 'is-dimmed' : ''} ${isHovered ? 'is-hovered' : ''} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedId(node.id)}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          setSelectedId(node.id);
                        }
                      }}
                    >
                      <circle r={size} className={`node-core ${nodeTone(node.kind)}`} filter={isSelected ? 'url(#nodeGlow)' : undefined} />
                      <circle r={size + 9} className="node-halo" />
                      <text className="node-label" y={size + 24}>
                        {node.label}
                      </text>
                      <title>{node.summary}</title>
                    </g>
                  );
                })}
              </svg>
            ) : (
              <div className="glossary-shell">
                <div className="glossary-tree">
                  <div className="glossary-tree-head">
                    <div>
                      <h3>目录树</h3>
                      <p>
                        {glossaryIndex.roots.length} 个章节根 · {glossaryIndex.orphans.length} 条未归类术语
                      </p>
                    </div>
                    <div className="tree-head-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setExpandedGlossaryIds(glossaryIndex.roots.map((root) => root.node.id))}
                      >
                        展开根目录
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => {
                          setExpandedGlossaryIds([]);
                          setStatus('已折叠目录树。');
                        }}
                      >
                        折叠目录
                      </button>
                    </div>
                  </div>
                  <div className="glossary-tree-body">
                    {glossaryIndex.roots.length === 0 ? (
                      <p className="muted">暂无可展开的目录树，先导入一本带章节的文档。</p>
                    ) : (
                      glossaryIndex.roots.map((root) => renderGlossarySection(root))
                    )}
                    {glossaryIndex.orphans.length > 0 ? (
                      <div className="glossary-orphans">
                        <h4>未归类术语</h4>
                        <div className="glossary-item-grid">
                          {glossaryIndex.orphans.map((item) => {
                            const itemParts = splitDetail(item.detail);
                            return (
                              <article
                                key={item.id}
                                id={`glossary-node-${item.id}`}
                                className={`glossary-item ${selectedId === item.id ? 'is-selected' : ''}`}
                              >
                                <button className="glossary-item-main" type="button" onClick={() => focusGlossaryNode(item)}>
                                  <div className="glossary-item-head">
                                    <strong>{item.label}</strong>
                                    <span>{kindLabel(item.kind)}</span>
                                  </div>
                                  <p>{itemParts.narrative || item.summary}</p>
                                </button>
                                {item.referenceIds.length > 0 ? renderReferenceChips(item.referenceIds) : null}
                                {renderCitationChips(splitDetail(item.detail).citations.slice(0, 2), item)}
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="panel detail-panel">
          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Detail</p>
                <h2>{detailNode?.label ?? (isGlossaryView ? '引用详情' : '知识点详情')}</h2>
              </div>
            </div>

            {detailNode ? (
              <>
                <div className="pill-row">
                  <span className="pill">{kindLabel(detailNode.kind)}</span>
                  <span className="pill">{detailNode.category}</span>
                  <span className="pill">{detailNode.sources.length} 个来源标记</span>
                </div>

                {isGlossaryView ? (
                  <div className="glossary-reader">
                    <section className="reader-block reader-summary">
                      <div className="reader-head">
                        <h3>摘要</h3>
                        <span>卡片式概览</span>
                      </div>
                      {detailSummaryParts ? (
                        <div className="summary-card">
                          <div className="summary-card-head">
                            <span className="summary-card-kicker">目录卡片</span>
                            <strong>{detailSummaryParts.card}</strong>
                          </div>
                          <div className="summary-keyword-row">
                            {(detailSummaryParts.keywords.length > 0
                              ? detailSummaryParts.keywords
                              : uniqueList([...glossaryChildSections.map((node) => node.label), ...glossaryChildItems.map((node) => node.label)]).slice(0, 4)
                            ).map((keyword) => (
                              <span key={keyword} className="summary-keyword-pill">
                                {keyword}
                              </span>
                            ))}
                          </div>
                          <p>{detailSummaryParts.oneLine}</p>
                        </div>
                      ) : (
                        <p className="detail-summary">{detailNode.summary}</p>
                      )}
                    </section>

                    <div className="citation-preview-card" aria-live="polite">
                      {citationPreview ? (
                        <>
                          <div className="citation-preview-head">
                            <div>
                              <p className="citation-preview-kicker">悬停预览</p>
                              <strong>{citationPreview.title}</strong>
                            </div>
                            <span>{citationPreview.subtitle}</span>
                          </div>
                          <p className="citation-preview-body">{citationPreview.body}</p>
                          {citationPreview.note ? <p className="citation-preview-note">{citationPreview.note}</p> : null}
                        </>
                      ) : (
                        <p className="muted">把鼠标移到引用锚点上，可以直接看到原句上下文。</p>
                      )}
                    </div>

                    <section className="reader-block reader-original">
                      <div className="reader-head">
                        <h3>原文</h3>
                        <span>可点击跳转的原句</span>
                      </div>
                      <p className="detail-body">{detailParts.narrative || detailNode.detail}</p>
                      {detailParts.citations.length > 0 ? renderCitationChips(detailParts.citations, detailNode) : null}
                    </section>

                    <section className="reader-block reader-anchors">
                      <div className="reader-head">
                        <h3>锚点</h3>
                        <span>目录路径与来源定位</span>
                      </div>
                      <div className="section-block">
                        <h3>目录路径</h3>
                        {glossaryTrail.length === 0 ? (
                          <p className="muted">没有找到可追溯的路径。</p>
                        ) : (
                          <div className="anchor-chip-row">
                            {glossaryTrail.map((nodeId) => {
                              const trailNode = glossaryIndex.nodesById.get(nodeId);
                              if (!trailNode) {
                                return null;
                              }
                              return (
                                <button
                                  key={trailNode.id}
                                  type="button"
                                  className="anchor-chip"
                                  onClick={() => focusGlossaryNode(trailNode)}
                                >
                                  <span className="anchor-chip-kind">{kindLabel(trailNode.kind)}</span>
                                  <strong>{trailNode.label}</strong>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="section-block">
                        <h3>引用锚点</h3>
                        {renderReferenceChips(detailNode.referenceIds, '引用锚点')}
                      </div>
                    </section>

                    {glossaryChildSections.length > 0 ? (
                      <div className="section-block">
                        <h3>子章节</h3>
                        <div className="relation-list">
                          {glossaryChildSections.map((node) => (
                            <button key={node.id} type="button" className="relation-chip" onClick={() => focusGlossaryNode(node)}>
                              <strong>{node.label}</strong>
                              <span>{kindLabel(node.kind)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {glossaryChildItems.length > 0 ? (
                      <div className="section-block">
                        <h3>本节术语</h3>
                        <div className="relation-list">
                          {glossaryChildItems.map((node) => (
                            <button key={node.id} type="button" className="relation-chip" onClick={() => focusGlossaryNode(node)}>
                              <strong>{node.label}</strong>
                              <span>{kindLabel(node.kind)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="section-block">
                      <h3>来源文档</h3>
                      <ul className="source-list">
                        {detailNode.sources.map((source) => (
                          <li key={source}>{source}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="section-block">
                      <h3>操作</h3>
                      <div className="actions-row">
                        <button className="ghost-button" type="button" onClick={() => applyNodeMutation('delete')} disabled={busy}>
                          删除知识点
                        </button>
                        <button className="ghost-button" type="button" onClick={() => applyNodeMutation('restore')} disabled={busy}>
                          恢复知识点
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="detail-summary">{detailNode.summary}</p>
                    <p className="detail-body">{detailParts.narrative || detailNode.detail}</p>
                    <div className="section-block">
                      <h3>与它相连的知识</h3>
                      <div className="relation-list">
                        {relatedNodes.length === 0 ? (
                          <p className="muted">当前没有可显示的关联节点。</p>
                        ) : (
                          relatedNodes.map((node) => {
                            const edge = selectedEdges.find(
                              (candidate) =>
                                (candidate.source === selectedId && candidate.target === node.id) ||
                                (candidate.target === selectedId && candidate.source === node.id),
                            );
                            return (
                              <button
                                key={node.id}
                                type="button"
                                className="relation-chip"
                                onClick={() => setSelectedId(node.id)}
                              >
                                <strong>{node.label}</strong>
                                <span>{edge ? relationLabel(edge.kind) : '关联'}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="section-block">
                      <h3>来源</h3>
                      <ul className="source-list">
                        {detailNode.sources.map((source) => (
                          <li key={source}>{source}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="section-block">
                      <h3>操作</h3>
                      <div className="actions-row">
                        <button className="ghost-button" type="button" onClick={() => applyNodeMutation('delete')} disabled={busy}>
                          删除知识点
                        </button>
                        <button className="ghost-button" type="button" onClick={() => applyNodeMutation('restore')} disabled={busy}>
                          恢复知识点
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="muted">
                {isGlossaryView
                  ? '点击左侧目录树里的章节或术语，右侧会显示路径、引用锚点和摘要。'
                  : '点击图谱中的节点，右侧会显示详细解释。'}
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Q&A</p>
                <h2>问答窗口</h2>
              </div>
            </div>

            <div className="quick-questions">
              {quickQuestions.map((item) => (
                <button key={item} type="button" className="quick-question" onClick={() => setQuestion(item)}>
                  {item}
                </button>
              ))}
            </div>

            <form onSubmit={handleAsk} className="qa-form">
              <label className="field">
                <span>向图谱提问</span>
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={4}
                  placeholder="例如：递归为什么常常和抽象一起出现？"
                />
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                生成回答
              </button>
            </form>

            {answer ? (
              <div className="answer-card">
                <p className="card-kicker">Response</p>
                <h3>{answer.title}</h3>
                <p>{answer.answer}</p>
                {answer.supportingNodes.length > 0 ? (
                  <div className="pill-row">
                    {answer.supportingNodes.map((node) => (
                      <button key={node.id} type="button" className="pill pill-link" onClick={() => setSelectedId(node.id)}>
                        {node.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {answer.citations.length > 0 ? (
                  <div className="citation-row">
                    <span className="muted">线索：</span>
                    {answer.citations.map((citation) => (
                      <span key={citation} className="citation">
                        {citation}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
