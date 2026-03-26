"use client";

import { createPortal } from 'react-dom';
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
const HOVER_PREVIEW_OFFSET = 18;
const HOVER_PREVIEW_WIDTH = 320;
const HOVER_PREVIEW_HEIGHT = 180;

const quickQuestions = [
  '什么是 collocation？',
  '为什么炎症和病原体有关？',
  '递归和抽象有什么关系？',
  '工业革命最重要的节点是什么？',
];

type SteamCampaign = {
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  nodeIds: string[];
  chapterIds: string[];
};

type SteamChapter = {
  id: string;
  title: string;
  summary: string;
  original: string;
  translation: string;
  note: string;
  nodeIds: string[];
};

type SteamQuiz = {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

type SteamScene = 'lobby' | 'map' | 'stage';

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function looksEnglishHeavy(value: string): boolean {
  const latinCount = (value.match(/[A-Za-z]/g) ?? []).length;
  const chineseCount = (value.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return latinCount >= 12 && latinCount >= chineseCount * 2;
}

function hashStable(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

const STEAM_TRANSLATION_RULES: Array<[string, string]> = [
  ['knowledge graph', '知识图谱'],
  ['question answering', '问答'],
  ['multiple choice', '选择题'],
  ['spaced review', '间隔复习'],
  ['part of', '组成'],
  ['depends on', '依赖'],
  ['related to', '相关'],
  ['same domain', '同领域'],
  ['contrast with', '对比'],
  ['is a', '属于'],
  ['chapter', '章节'],
  ['section', '小节'],
  ['term', '术语'],
  ['concept', '概念'],
  ['process', '过程'],
  ['book', '书籍'],
  ['history', '历史'],
  ['military', '军事'],
  ['engineering', '工程'],
  ['mechanical', '机械'],
  ['translation', '翻译'],
  ['learning', '学习'],
  ['memory', '记忆'],
  ['understand', '理解'],
  ['remember', '记住'],
  ['recall', '回忆'],
  ['definition', '定义'],
  ['example', '示例'],
  ['language', '语言'],
  ['word', '单词'],
  ['words', '单词'],
  ['problem', '问题'],
  ['system', '系统'],
  ['relation', '关系'],
  ['relations', '关系'],
  ['cause', '原因'],
  ['effect', '结果'],
  ['event', '事件'],
  ['events', '事件'],
  ['machine', '机器'],
  ['structure', '结构'],
  ['pattern', '模式'],
  ['analysis', '分析'],
  ['strategy', '策略'],
  ['operation', '操作'],
  ['function', '函数'],
  ['component', '组件'],
  ['components', '组件'],
  ['workflow', '流程'],
  ['path', '路径'],
  ['timeline', '时间线'],
  ['mission', '任务'],
  ['campaign', '战役'],
];

function translateSteamText(text: string): string {
  let output = ` ${text.trim()} `;
  for (const [source, target] of [...STEAM_TRANSLATION_RULES].sort((left, right) => right[0].length - left[0].length)) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(source)}\\b`, 'gi'), target);
  }
  output = output.replace(/\s+/g, ' ').trim();
  if (!output) {
    return '暂无可翻译内容。';
  }
  return output;
}

function deriveSteamCampaignNodes(graph: KnowledgeGraphData, document: KnowledgeDocument): KnowledgeNode[] {
  const exactMatches = graph.nodes.filter((node) => node.sources.includes(document.id));
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const title = canonicalText(document.title);
  const titleKeywords = title.split(/\s+/).filter(Boolean);
  const titleText = titleKeywords.join(' ');
  const matches = graph.nodes.filter((node) => {
    const haystack = canonicalText(`${node.label} ${node.category} ${node.summary} ${node.detail} ${node.aliases.join(' ')}`);
    if (/(english|vocabulary|dictionary|lexical|language|collocation)/.test(titleText)) {
      return /english|language|word|term|lexical/.test(haystack) || node.category === 'English' || node.kind === 'term';
    }
    if (/(history|war|revolution|timeline|military)/.test(titleText)) {
      return /history|war|revolution|timeline|military/.test(haystack) || node.category === 'History';
    }
    if (/(medicine|medical|health|diagnosis|pathology)/.test(titleText)) {
      return /medicine|diagnosis|health|pathogen|inflammation/.test(haystack) || node.category === 'Medicine';
    }
    if (/(engineering|mechanical|machine|mechanism|system)/.test(titleText)) {
      return /engineering|mechanical|machine|system|process|component/.test(haystack) || node.kind === 'process';
    }
    return titleKeywords.some((keyword) => haystack.includes(keyword));
  });

  if (matches.length > 0) {
    return Array.from(new Map(matches.map((node) => [node.id, node])).values());
  }

  return [...graph.nodes]
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
}

function deriveSteamCampaigns(graph: KnowledgeGraphData): SteamCampaign[] {
  const documents = graph.documents.filter((document) => document.status !== 'deleted');
  if (documents.length === 0) {
    const fallbackNodes = [...graph.nodes].sort((left, right) => right.score - left.score).slice(0, 8);
    return [
      {
        id: 'demo-campaign',
        title: '示例战役',
        subtitle: `${fallbackNodes.length} 个知识节点`,
        summary: '没有导入文档时，先用当前图谱体验战役流程。',
        nodeIds: fallbackNodes.map((node) => node.id),
        chapterIds: fallbackNodes.filter((node) => node.kind === 'book' || node.kind === 'topic' || node.kind === 'process').map((node) => node.id),
      },
    ];
  }

  return documents.map((document) => {
    const campaignNodes = deriveSteamCampaignNodes(graph, document);
    const chapterIds = campaignNodes
      .filter((node) => node.kind === 'book' || node.kind === 'topic' || node.kind === 'process')
      .map((node) => node.id);
    const resolvedChapterIds = chapterIds.length > 0 ? chapterIds : campaignNodes.slice(0, 4).map((node) => node.id);
    return {
      id: document.id,
      title: document.title,
      subtitle: `${campaignNodes.length} 个知识节点 · ${resolvedChapterIds.length} 个章节`,
      summary: document.notes || '上传这份 PDF 后，系统会把它变成可闯关的知识战役。',
      nodeIds: campaignNodes.map((node) => node.id),
      chapterIds: resolvedChapterIds,
    };
  });
}

function deriveSteamChapters(graph: KnowledgeGraphData, campaign: SteamCampaign | null): SteamChapter[] {
  if (!campaign) {
    return [];
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const chapterNodes = campaign.chapterIds
    .map((chapterId) => nodesById.get(chapterId))
    .filter((node): node is KnowledgeNode => Boolean(node));
  const fallbackNodes = campaign.nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is KnowledgeNode => Boolean(node));
  const sourceNodes = chapterNodes.length > 0 ? chapterNodes : fallbackNodes.slice(0, 4);

  return sourceNodes.map((node, index) => {
    const detailParts = splitDetail(node.detail);
    const rawOriginal = detailParts.narrative || node.summary || node.detail;
    const translated = translateSteamText(rawOriginal);
    const languageHint = looksEnglishHeavy(rawOriginal) ? '英语章节' : '通用章节';
    const noteSource = node.aliases.find((alias) => hasChinese(alias)) || node.category;
    return {
      id: node.id,
      title: node.label,
      summary: truncateText(node.summary || rawOriginal, 110),
      original: truncateText(rawOriginal, 180),
      translation: truncateText(translated, 180),
      note: `${index + 1} 号章节 · ${languageHint} · ${noteSource} · ${node.referenceIds.length > 0 ? `${node.referenceIds.length} 个锚点` : '待解锁锚点'}`,
      nodeIds: [node.id, ...node.referenceIds].filter((value, currentIndex, array) => array.indexOf(value) === currentIndex),
    };
  });
}

function buildSteamQuiz(chapter: SteamChapter, chapters: SteamChapter[]): SteamQuiz {
  const distractorSource = chapters.filter((item) => item.id !== chapter.id).map((item) => item.title);
  const optionsPool = uniqueList([chapter.title, ...distractorSource]).slice(0, 4);
  while (optionsPool.length < 3) {
    optionsPool.push(`${chapter.title} 相关章节 ${optionsPool.length + 1}`);
  }
  const correctIndex = hashStable(chapter.id) % 3;
  const options = [...optionsPool.slice(0, 3)];
  const [correct] = options.splice(0, 1);
  if (correct) {
    options.splice(correctIndex, 0, correct);
  }
  return {
    prompt: `当前关卡的核心章节是哪一个？`,
    options,
    correctIndex,
    explanation: `本关聚焦「${chapter.title}」：${truncateText(chapter.summary, 90)}`,
  };
}

function steamSceneLabel(scene: SteamScene): string {
  switch (scene) {
    case 'lobby':
      return '战役大厅';
    case 'map':
      return '章节地图';
    case 'stage':
      return '关卡页面';
    default:
      return scene;
  }
}

function latestVisibleDocumentId(documents: KnowledgeDocument[]): string {
  const visible = documents.filter((document) => document.status !== 'deleted');
  const sorted = [...visible].sort((left, right) => {
    const leftTime = new Date(left.importedAt ?? 0).getTime();
    const rightTime = new Date(right.importedAt ?? 0).getTime();
    return rightTime - leftTime;
  });
  return sorted[0]?.id ?? '';
}

type SectionSummaryParts = {
  card: string;
  tags: string[];
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
    tags: [],
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
    if (line.startsWith('标签：') || line.startsWith('自动标签：')) {
      structured.tags = uniqueList(
        line
          .replace('标签：', '')
          .replace('自动标签：', '')
          .split(/[\/、,，；;|]/)
          .map((item) => item.trim())
          .filter(Boolean),
      );
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
      tags: [],
      keywords: [],
      oneLine: compact,
    };
  }
  return {
    card: structured.card || fallbackLabel,
    tags: structured.tags,
    keywords: structured.keywords,
    oneLine: structured.oneLine || truncateText(summary || fallbackLabel, 96),
  };
}

function deriveSummaryTags(
  node: KnowledgeNode,
  parts: SectionSummaryParts,
  childSectionCount: number,
  childItemCount: number,
): string[] {
  const tags: string[] = [];
  const normalized = canonicalText(`${node.label} ${node.summary} ${node.detail} ${parts.keywords.join(' ')} ${parts.oneLine}`);
  if (childSectionCount > 0) {
    tags.push('目录层级');
  }
  if (childItemCount >= 3) {
    tags.push('术语密集');
  } else if (childItemCount > 0) {
    tags.push('术语提要');
  }
  if (node.referenceIds.length > 0) {
    tags.push('可追溯');
  }
  if (/(例如|比如|示例|example|such as)/i.test(normalized)) {
    tags.push('示例型');
  }
  if (/(对比|反义|contrast|opposite|versus|vs\.)/i.test(normalized)) {
    tags.push('对照型');
  }
  if (/(步骤|过程|方法|process|workflow|procedure|mechanism|encoding|retrieval)/i.test(normalized)) {
    tags.push('过程型');
  }
  if (/(定义|表示|means|is|are|指|说明|解释)/i.test(normalized)) {
    tags.push('定义型');
  }
  if (/(关系|联系|关联|related|graph|node|edge)/i.test(normalized)) {
    tags.push('关系型');
  }
  if (node.kind === 'book') {
    tags.push('目录根');
  }
  return uniqueList(tags).slice(0, 4);
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
  x: number;
  y: number;
  placement: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
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
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const [steamActiveCampaignId, setSteamActiveCampaignId] = useState('');
  const [steamActiveChapterId, setSteamActiveChapterId] = useState('');
  const [steamScene, setSteamScene] = useState<SteamScene>('lobby');
  const [steamLanguageMode, setSteamLanguageMode] = useState<'dual' | 'original' | 'translation'>('dual');
  const [steamSelectedOption, setSteamSelectedOption] = useState<number | null>(null);
  const [steamClearedChapterIds, setSteamClearedChapterIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const glossaryIndex = buildGlossaryTree(graph);
  const isGlossaryView = viewMode === 'glossary';
  const isSteamSkin = true;
  const steamCampaigns = deriveSteamCampaigns(graph);
  const steamActiveCampaign =
    steamCampaigns.find((campaign) => campaign.id === steamActiveCampaignId) ?? steamCampaigns[0] ?? null;
  const steamChapters = deriveSteamChapters(graph, steamActiveCampaign);
  const steamActiveChapter =
    steamChapters.find((chapter) => chapter.id === steamActiveChapterId) ?? steamChapters[0] ?? null;
  const steamActiveChapterIndex = steamActiveChapter ? steamChapters.findIndex((chapter) => chapter.id === steamActiveChapter.id) : -1;
  const steamQuiz = steamActiveChapter ? buildSteamQuiz(steamActiveChapter, steamChapters) : null;

  function buildHoverPreviewPosition(clientX: number, clientY: number): { x: number; y: number; placement: HoverPreview['placement'] } {
    const fitsRight = clientX + HOVER_PREVIEW_WIDTH + HOVER_PREVIEW_OFFSET + 16 <= window.innerWidth;
    const fitsBottom = clientY + HOVER_PREVIEW_HEIGHT + HOVER_PREVIEW_OFFSET + 16 <= window.innerHeight;
    const x = fitsRight ? clientX + HOVER_PREVIEW_OFFSET : clientX - HOVER_PREVIEW_WIDTH - HOVER_PREVIEW_OFFSET;
    const y = fitsBottom ? clientY + HOVER_PREVIEW_OFFSET : clientY - HOVER_PREVIEW_HEIGHT - HOVER_PREVIEW_OFFSET;
    return {
      x: Math.max(16, x),
      y: Math.max(16, y),
      placement: `${fitsBottom ? 'bottom' : 'top'}-${fitsRight ? 'right' : 'left'}` as HoverPreview['placement'],
    };
  }

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
    if (!isSteamSkin) {
      return;
    }
    if (!steamCampaigns.length) {
      return;
    }
    setSteamActiveCampaignId((current) => {
      if (steamCampaigns.some((campaign) => campaign.id === current)) {
        return current;
      }
      return steamCampaigns[0]?.id ?? '';
    });
  }, [isSteamSkin, steamCampaigns]);

  useEffect(() => {
    if (!isSteamSkin || !steamActiveCampaign) {
      return;
    }
    if (!steamChapters.length) {
      return;
    }
    setSteamActiveChapterId((current) => {
      if (steamChapters.some((chapter) => chapter.id === current)) {
        return current;
      }
      return steamChapters[0]?.id ?? '';
    });
  }, [isSteamSkin, steamActiveCampaign, steamChapters]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedScene = window.localStorage.getItem('knowledgegraph.steam.scene');
    if (storedScene === 'lobby' || storedScene === 'map' || storedScene === 'stage') {
      setSteamScene(storedScene);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedBookmarks = window.localStorage.getItem('knowledgegraph.bookmarks');
    if (!storedBookmarks) {
      return;
    }
    try {
      const parsed = JSON.parse(storedBookmarks);
      if (Array.isArray(parsed)) {
        setBookmarkedIds(
          uniqueList(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)),
        );
      }
    } catch {
      window.localStorage.removeItem('knowledgegraph.bookmarks');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('knowledgegraph.bookmarks', JSON.stringify(bookmarkedIds));
  }, [bookmarkedIds]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedCampaign = window.localStorage.getItem('knowledgegraph.steam.campaign');
    const storedChapter = window.localStorage.getItem('knowledgegraph.steam.chapter');
    const storedLanguage = window.localStorage.getItem('knowledgegraph.steam.language');
    const storedClears = window.localStorage.getItem('knowledgegraph.steam.cleared');
    if (storedCampaign) {
      setSteamActiveCampaignId(storedCampaign);
    }
    if (storedChapter) {
      setSteamActiveChapterId(storedChapter);
    }
    if (storedLanguage === 'original' || storedLanguage === 'translation' || storedLanguage === 'dual') {
      setSteamLanguageMode(storedLanguage);
    }
    if (storedClears) {
      try {
        const parsed = JSON.parse(storedClears);
        if (Array.isArray(parsed)) {
          setSteamClearedChapterIds(uniqueList(parsed.filter((item): item is string => typeof item === 'string')));
        }
      } catch {
        window.localStorage.removeItem('knowledgegraph.steam.cleared');
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('knowledgegraph.steam.campaign', steamActiveCampaignId);
  }, [steamActiveCampaignId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('knowledgegraph.steam.chapter', steamActiveChapterId);
  }, [steamActiveChapterId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('knowledgegraph.steam.language', steamLanguageMode);
  }, [steamLanguageMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('knowledgegraph.steam.cleared', JSON.stringify(steamClearedChapterIds));
  }, [steamClearedChapterIds]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('knowledgegraph.steam.scene', steamScene);
  }, [steamScene]);

  useEffect(() => {
    setBookmarkedIds((current) => {
      const availableIds = new Set(graph.nodes.map((node) => node.id));
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [graph]);

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
    return {
      remoteGraph,
      remoteDocuments,
      remoteNodes,
      remoteJobs,
    };
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
  const bookmarkedNodes = bookmarkedIds
    .map((nodeId) => graph.nodes.find((node) => node.id === nodeId))
    .filter((node): node is KnowledgeNode => Boolean(node));
  const steamCompletedChapters = steamChapters.filter((chapter) => steamClearedChapterIds.includes(chapter.id));
  const steamCampaignProgress = steamChapters.length > 0 ? Math.round((steamCompletedChapters.length / steamChapters.length) * 100) : 0;
  const steamQuizCorrect = steamQuiz ? steamSelectedOption === steamQuiz.correctIndex : false;
  const steamTranslationUnlocked =
    Boolean(steamActiveChapter) && (steamQuizCorrect || steamClearedChapterIds.includes(steamActiveChapter.id));
  const steamHeroTitle = steamActiveCampaign ? steamActiveCampaign.title : '上传 PDF，开始战役';
  const steamHeroSubtitle = steamActiveCampaign
    ? steamActiveCampaign.summary
    : '把一本 PDF 变成一个可玩、可闯关、可翻译的知识战役。';
  const steamHeroBadge = steamActiveCampaign
    ? `${steamCampaignProgress}% 进度 · ${steamChapters.length} 章`
    : '等待你的第一本书';
  const steamLevel = Math.max(1, Math.ceil(graph.nodes.length / 5));
  const steamProgress = Math.min(100, (graph.nodes.length % 5) * 20);
  const steamAnchors = graph.nodes.filter((node) => node.referenceIds.length > 0).length;
  const steamHeat = selectedEdges.length;
  const steamUnlockedDocs = graph.documents.length;
  const steamSceneTitle = steamSceneLabel(steamScene);
  const steamSceneDescription =
    steamScene === 'lobby'
      ? '从这里上传 PDF，启动一场新的知识战役。'
      : steamScene === 'map'
        ? '沿着章节地图前进，挑选下一段路线。'
        : '进入当前章节，解题、解锁翻译卡并推进战役。';
  const steamSceneObjective =
    steamScene === 'lobby'
      ? '上传一本书，生成战役。'
      : steamScene === 'map'
        ? '选择一条章节路线继续推进。'
        : steamTranslationUnlocked
          ? '翻译卡已解锁，可以继续推进下一章。'
          : '完成题目，解锁翻译卡。';
  const steamStages = [
    {
      title: '关卡 1 · 战役点火',
      subtitle: `${graph.nodes.length} 个知识碎片`,
      unlocked: graph.nodes.length >= 5,
    },
    {
      title: '关卡 2 · 路线追踪',
      subtitle: `${steamAnchors} 个可追溯锚点`,
      unlocked: steamAnchors > 0,
    },
    {
      title: '关卡 3 · 章节突破',
      subtitle: `${steamHeat} 条关卡连接`,
      unlocked: steamHeat >= 3,
    },
  ];
  const steamAchievements = [
    {
      title: '图鉴入门',
      description: '收集至少 5 个知识点。',
      unlocked: graph.nodes.length >= 5,
    },
    {
      title: '来源追踪者',
      description: '触发一个可追溯锚点。',
      unlocked: steamAnchors > 0,
    },
    {
      title: '任务完成',
      description: '完成一次导入任务。',
      unlocked: jobs.some((job) => job.status === 'completed'),
    },
    {
      title: '关系指挥官',
      description: '当前节点周围形成 3 条以上连接。',
      unlocked: steamHeat >= 3,
    },
  ];
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
  const detailSummaryTags =
    detailNode && detailSummaryParts
      ? detailSummaryParts.tags.length > 0
        ? detailSummaryParts.tags
        : deriveSummaryTags(
            detailNode,
            detailSummaryParts,
            glossaryChildSections.length,
            glossaryChildItems.length,
          )
      : [];
  const isBookmarked = detailNode ? bookmarkedIds.includes(detailNode.id) : false;
  const steamMission = detailNode
    ? `当前任务：聚焦「${detailNode.label}」，把它的路径和引用锚点点亮。`
    : '当前任务：从图谱里点亮一个节点，开始一段知识冒险。';

  const citationPreviewLayer =
    citationPreview && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="citation-preview-card"
            data-placement={citationPreview.placement}
            aria-live="polite"
            style={{
              left: `${citationPreview.x}px`,
              top: `${citationPreview.y}px`,
              opacity: 1,
            }}
          >
            <div className="citation-preview-head">
              <div>
                <p className="citation-preview-kicker">悬停预览</p>
                <strong>{citationPreview.title}</strong>
              </div>
              <span>{citationPreview.subtitle}</span>
            </div>
            <p className="citation-preview-body">{citationPreview.body}</p>
            {citationPreview.note ? <p className="citation-preview-note">{citationPreview.note}</p> : null}
          </div>,
          document.body,
        )
      : null;

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
        const remote = await syncRemoteCollections();
        if (isSteamSkin) {
          const campaignId = latestVisibleDocumentId(remote.remoteGraph.documents.length > 0 ? remote.remoteGraph.documents : result.graph.documents);
          if (campaignId) {
            setSteamActiveCampaignId(campaignId);
            setSteamActiveChapterId('');
            setSteamScene('map');
          }
        }
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
        if (isSteamSkin) {
          const campaignId = latestVisibleDocumentId(documents);
          if (campaignId) {
            setSteamActiveCampaignId(campaignId);
            setSteamActiveChapterId(result.batch.nodes[0]?.id ?? '');
            setSteamScene('map');
          }
        }
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

        const remote = await syncRemoteCollections();
        if (isSteamSkin) {
          const campaignId = latestVisibleDocumentId(remote.remoteGraph.documents);
          if (campaignId) {
            setSteamActiveCampaignId(campaignId);
            setSteamActiveChapterId('');
            setSteamScene('map');
          }
        }
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
        if (isSteamSkin) {
          const campaignId = latestVisibleDocumentId(documents);
          if (campaignId) {
            setSteamActiveCampaignId(campaignId);
            setSteamActiveChapterId(result.batch.nodes[0]?.id ?? '');
            setSteamScene('map');
          }
        }
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
    setBookmarkedIds([]);
    setSteamActiveCampaignId('');
    setSteamActiveChapterId('');
    setSteamScene('lobby');
    setSteamSelectedOption(null);
    setSteamClearedChapterIds([]);
    setStatus('已恢复示例图谱。');
  }

  function applySearchSelection(node: KnowledgeNode) {
    setSelectedId(node.id);
    setQuery(node.label);
    if (isSteamSkin) {
      setSteamScene('stage');
    }
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

  function focusReferenceNode(node: KnowledgeNode) {
    if (isSteamSkin) {
      setSelectedId(node.id);
      setSteamScene('stage');
      setStatus(`已定位到“${node.label}”。`);
      return;
    }
    focusGlossaryNode(node);
  }

  function toggleBookmark(node: KnowledgeNode) {
    const wasBookmarked = bookmarkedIds.includes(node.id);
    setBookmarkedIds((current) => {
      if (current.includes(node.id)) {
        return current.filter((id) => id !== node.id);
      }
      return [node.id, ...current].filter((id, index, array) => array.indexOf(id) === index);
    });
    setStatus(wasBookmarked ? `已从收藏夹移除「${node.label}」。` : `已收藏「${node.label}」。`);
  }

  function openBookmarkedNode(node: KnowledgeNode) {
    if (isGlossaryView) {
      focusGlossaryNode(node);
      return;
    }
    applySearchSelection(node);
  }

  function openSteamUploadPicker() {
    if (typeof document === 'undefined') {
      return;
    }
    document.querySelector<HTMLInputElement>('.file-drop input')?.click();
  }

  function startSteamCampaign(campaignId: string) {
    const campaign = steamCampaigns.find((item) => item.id === campaignId) ?? steamCampaigns[0] ?? null;
    if (!campaign) {
      return;
    }
    setSteamActiveCampaignId(campaign.id);
    const firstChapterId = campaign.chapterIds[0] ?? campaign.nodeIds[0] ?? '';
    if (firstChapterId) {
      setSteamActiveChapterId(firstChapterId);
      setSelectedId(firstChapterId);
    }
    setSteamScene('map');
    setSteamSelectedOption(null);
    setStatus(`已开始战役「${campaign.title}」。`);
  }

  function focusSteamChapter(chapterId: string) {
    setSteamActiveChapterId(chapterId);
    setSelectedId(chapterId);
    setSteamScene('stage');
    setSteamSelectedOption(null);
    const chapter = steamChapters.find((item) => item.id === chapterId);
    if (chapter) {
      setStatus(`已进入章节关卡「${chapter.title}」。`);
    }
  }

  function answerSteamQuiz(optionIndex: number) {
    if (!steamQuiz || !steamActiveChapter) {
      return;
    }
    setSteamSelectedOption(optionIndex);
    if (optionIndex === steamQuiz.correctIndex) {
      setSteamClearedChapterIds((current) => uniqueList([...current, steamActiveChapter.id]));
      setStatus(`答对了，已解锁「${steamActiveChapter.title}」的翻译卡。`);
    } else {
      setStatus(`还差一点，再看一下章节线索。`);
    }
  }

  function advanceSteamChapter() {
    if (!steamActiveChapter) {
      return;
    }
    const currentIndex = steamChapters.findIndex((chapter) => chapter.id === steamActiveChapter.id);
    const nextChapter = steamChapters[currentIndex + 1] ?? steamChapters[0] ?? null;
    if (nextChapter) {
      focusSteamChapter(nextChapter.id);
    }
  }

  function showReferencePreview(target: KnowledgeNode, clientX: number, clientY: number) {
    const detailParts = splitDetail(target.detail);
    setCitationPreview({
      title: target.label,
      subtitle: `${kindLabel(target.kind)} · ${target.category}`,
      body: truncateText(detailParts.narrative || target.summary || target.detail, 220),
      note: target.referenceIds.length > 0 ? '来源锚点可继续跳转到上级目录。' : '当前节点没有更上层的引用锚点。',
      ...buildHoverPreviewPosition(clientX, clientY),
    });
  }

  function showCitationPreview(citation: string, target: KnowledgeNode | null, clientX: number, clientY: number) {
    const parsed = splitCitationPreview(citation);
    setCitationPreview({
      title: target?.label ?? parsed.source ?? '引用预览',
      subtitle: target ? `${kindLabel(target.kind)} · ${target.category}` : parsed.path || parsed.source || '引用来源',
      body: truncateText(parsed.context || parsed.original || target?.summary || citation, 240),
      note: parsed.original && parsed.original !== parsed.context ? `原句：${parsed.original}` : undefined,
      ...buildHoverPreviewPosition(clientX, clientY),
    });
  }

  function updatePreviewPosition(clientX: number, clientY: number) {
    setCitationPreview((current) => (current ? { ...current, ...buildHoverPreviewPosition(clientX, clientY) } : current));
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
            onClick={() => focusReferenceNode(target)}
            onMouseEnter={(event) => showReferencePreview(target, event.clientX, event.clientY)}
            onMouseMove={(event) => updatePreviewPosition(event.clientX, event.clientY)}
            onMouseLeave={() => setCitationPreview(null)}
            onFocus={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              showReferencePreview(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
            }}
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
              onClick={() => focusReferenceNode(target)}
              onMouseEnter={(event) => showCitationPreview(citation, target, event.clientX, event.clientY)}
              onMouseMove={(event) => updatePreviewPosition(event.clientX, event.clientY)}
              onMouseLeave={() => setCitationPreview(null)}
              onFocus={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                showCitationPreview(citation, target, rect.left + rect.width / 2, rect.top + rect.height / 2);
              }}
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
    const summaryTags = summaryParts.tags.length > 0
      ? summaryParts.tags
      : deriveSummaryTags(section.node, summaryParts, section.children.length, section.items.length);
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
                <article className="summary-mini-card summary-mini-card-main">
                  <span className="summary-card-kicker">目录卡片</span>
                  <strong>{summaryParts.card}</strong>
                  <p>{summaryParts.oneLine || detailParts.narrative || section.node.summary}</p>
                </article>
                <div className="summary-mini-row">
                  <article className="summary-mini-card summary-mini-card-tags">
                    <span className="summary-card-kicker">自动标签</span>
                    <div className="summary-tag-grid">
                      {summaryTags.length > 0 ? (
                        summaryTags.map((tag) => (
                          <span key={tag} className="summary-tag-pill">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="muted">暂无标签</span>
                      )}
                    </div>
                  </article>
                  <article className="summary-mini-card summary-mini-card-keywords">
                    <span className="summary-card-kicker">关键词</span>
                    <div className="summary-keyword-grid">
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
                  </article>
                </div>
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
    <div className="app-shell is-steam">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div>
          <p className="eyebrow">KnowledgeGraph</p>
          <h1>把书、词典和课堂笔记变成一场可以推进的知识战役。</h1>
          <p className="topbar-copy">Steam 版把知识抽取引擎变成战役大厅、章节地图和关卡页面。上传一本书，就能开始闯关。</p>
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
          <div className="metric">
            <span>模式</span>
            <strong>{steamSceneTitle}</strong>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel library-panel">
          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Campaign Entry</p>
                <h2>战役入口</h2>
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
                <p className="card-kicker">Archive Search</p>
                <h2>档案检索</h2>
              </div>
            </div>
            <label className="field">
              <span>搜索战役知识点</span>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入单词、术语或主题"
              />
            </label>
            <div className="search-results">
              {searchMatches.length === 0 ? (
                <p className="muted">输入后会显示候选档案。</p>
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

          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Codex</p>
                <h2>图鉴收藏</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => setBookmarkedIds([])} disabled={bookmarkedNodes.length === 0}>
                清空
              </button>
            </div>
            {bookmarkedNodes.length === 0 ? (
              <p className="muted">把重要节点收藏起来，后面可以随时回到图鉴里。</p>
            ) : (
              <div className="bookmark-list">
                {bookmarkedNodes.map((node) => {
                  const isSelectedBookmark = selectedId === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`bookmark-item ${isSelectedBookmark ? 'is-active' : ''}`}
                      onClick={() => openBookmarkedNode(node)}
                    >
                      <div className="bookmark-item-head">
                        <strong>{node.label}</strong>
                        <span>{kindLabel(node.kind)}</span>
                      </div>
                      <span>{node.summary}</span>
                      <div className="bookmark-item-meta">
                        <span>{node.category}</span>
                        {node.referenceIds.length > 0 ? <span>{node.referenceIds.length} 个锚点</span> : null}
                        {node.deletedAt ? <span>已删除</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {isSteamSkin ? (
            <>
              <section className="card steam-landing steam-hud--enter">
                <div className="card-head">
                  <div>
                    <p className="card-kicker">Steam Mode</p>
                    <h2>{steamHeroTitle}</h2>
                  </div>
                  <span className="steam-badge">{steamHeroBadge}</span>
                </div>
                <p className="steam-landing-copy">{steamHeroSubtitle}</p>
                <div className="steam-landing-cta">
                  <button className="primary-button" type="button" onClick={openSteamUploadPicker}>
                    上传 PDF，开始战役
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setSteamScene('map')}>
                    进入章节地图
                  </button>
                </div>
                <div className="steam-landing-metrics">
                  <article className="steam-mini-stat">
                    <span>探索进度</span>
                    <strong>{steamProgress}%</strong>
                  </article>
                  <article className="steam-mini-stat">
                    <span>已收集档案</span>
                    <strong>{steamUnlockedDocs}</strong>
                  </article>
                  <article className="steam-mini-stat">
                    <span>图鉴锚点</span>
                    <strong>{steamAnchors}</strong>
                  </article>
                </div>
                <div className="steam-onboarding">
                  <article className="steam-step">
                    <span>01</span>
                    <strong>上传一本书</strong>
                    <p>PDF、扫描件或图片都会被解析成可玩的知识战役。</p>
                  </article>
                  <article className="steam-step">
                    <span>02</span>
                    <strong>打开章节地图</strong>
                    <p>沿着路线选择章节，找到本次战役的推进顺序。</p>
                  </article>
                  <article className="steam-step">
                    <span>03</span>
                    <strong>进入关卡页面</strong>
                    <p>答题、翻译、复习都在这一页完成，像打副本一样推进。</p>
                  </article>
                </div>
                <div className="steam-campaign-list">
                  {steamCampaigns.map((campaign) => {
                    const isActiveCampaign = steamActiveCampaign?.id === campaign.id;
                    return (
                      <button
                        key={campaign.id}
                        type="button"
                        className={`steam-campaign-card ${isActiveCampaign ? 'is-active' : ''}`}
                        onClick={() => startSteamCampaign(campaign.id)}
                      >
                        <div className="steam-campaign-head">
                          <strong>{campaign.title}</strong>
                          <span>{campaign.subtitle}</span>
                        </div>
                        <p>{campaign.summary}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="card steam-hud steam-hud--enter">
                <div className="card-head">
                  <div>
                    <p className="card-kicker">Steam Preview</p>
                    <h2>战役日志</h2>
                  </div>
                  <span className="steam-badge">Lv.{steamLevel}</span>
                </div>
                <p className="steam-mission">{steamMission}</p>
                <div className="steam-hud-grid">
                  <article className="steam-stat">
                    <span>战役进度</span>
                    <strong>{steamCampaignProgress}%</strong>
                    <div className="steam-bar">
                      <div className="steam-bar-fill" style={{ width: `${steamCampaignProgress}%` }} />
                    </div>
                  </article>
                  <article className="steam-stat">
                    <span>章节关卡</span>
                    <strong>
                      {steamCompletedChapters.length}/{steamChapters.length}
                    </strong>
                    <p>完成章节即可解锁下一块翻译卡。</p>
                  </article>
                  <article className="steam-stat">
                    <span>图鉴锚点</span>
                    <strong>{steamAnchors}</strong>
                    <p>可继续追溯到上级目录的节点。</p>
                  </article>
                  <article className="steam-stat">
                    <span>连线热度</span>
                    <strong>{steamHeat}</strong>
                    <p>当前节点附近的关系密度。</p>
                  </article>
                </div>
                <div className="steam-chapter-list">
                  {steamChapters.length === 0 ? (
                    <p className="muted">上传 PDF 后，这里会生成章节关卡。</p>
                  ) : (
                    steamChapters.map((chapter, index) => {
                      const isActiveChapter = steamActiveChapter?.id === chapter.id;
                      const isCleared = steamClearedChapterIds.includes(chapter.id);
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          className={`steam-chapter-card ${isActiveChapter ? 'is-active' : ''} ${isCleared ? 'is-cleared' : ''}`}
                          onClick={() => focusSteamChapter(chapter.id)}
                        >
                          <span className="steam-chapter-index">0{index + 1}</span>
                          <div>
                            <strong>{chapter.title}</strong>
                            <p>{chapter.summary}</p>
                          </div>
                          <span className="steam-chapter-state">{isCleared ? '已通关' : '待挑战'}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="steam-stage-list">
                  {steamStages.map((stage, index) => (
                    <button
                      key={stage.title}
                      type="button"
                      className={`steam-stage ${stage.unlocked ? 'is-unlocked' : ''}`}
                      onClick={() => {
                        if (index === 0) {
                          setSteamScene('lobby');
                          return;
                        }
                        if (index === 1) {
                          setSteamScene('map');
                          return;
                        }
                        setSteamScene('stage');
                        setQuestion(quickQuestions[0]);
                      }}
                    >
                      <span className="steam-stage-index">0{index + 1}</span>
                      <div>
                        <strong>{stage.title}</strong>
                        <p>{stage.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="steam-achievement-grid">
                  {steamAchievements.map((achievement) => (
                    <article key={achievement.title} className={`steam-achievement ${achievement.unlocked ? 'is-unlocked' : ''}`}>
                      <span>{achievement.unlocked ? '已解锁' : '未解锁'}</span>
                      <strong>{achievement.title}</strong>
                      <p>{achievement.description}</p>
                    </article>
                  ))}
                </div>
                <div className="steam-quest-list">
                  <button className="steam-quest" type="button" onClick={() => setSteamScene('lobby')}>
                    <strong>返回战役大厅</strong>
                    <span>重新选择一本书，或继续当前战役。</span>
                  </button>
                  <button className="steam-quest" type="button" onClick={() => setSteamScene('stage')}>
                    <strong>直接进入关卡</strong>
                    <span>继续当前章节，优先解锁翻译卡。</span>
                  </button>
                </div>
              </section>
            </>
          ) : null}

          <section className="card task-card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Mission Log</p>
                <h2>任务日志</h2>
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
                <p className="card-kicker">Archives</p>
                <h2>战役卷宗</h2>
              </div>
            </div>
            <div className="search-results">
              {graph.documents.length === 0 ? (
                <p className="muted">暂无卷宗。</p>
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
                <p className="card-kicker">Recovery</p>
                <h2>战役回收站</h2>
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

        <section className="canvas-panel steam-stageboard">
          <div className="canvas-toolbar">
            <div>
              <p className="card-kicker">Steam Mode</p>
              <h2>{steamSceneTitle}</h2>
            </div>
            <div className="toolbar-actions">
              <div className="steam-scene-tabs">
                {(['lobby', 'map', 'stage'] as SteamScene[]).map((scene) => (
                  <button
                    key={scene}
                    className={`view-tab steam-scene-tab ${steamScene === scene ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setSteamScene(scene)}
                  >
                    {steamSceneLabel(scene)}
                  </button>
                ))}
              </div>
              <div className="toolbar-badges">
                <span>{steamActiveCampaign?.title ?? '尚未开启战役'}</span>
                <span>{steamActiveChapter ? `章节 ${steamActiveChapterIndex + 1}` : '等待章节'}</span>
                <span>{steamSceneObjective}</span>
                <span>{busy ? '处理中' : status}</span>
              </div>
            </div>
          </div>

          <div className="steam-scene-shell">
            {steamScene === 'lobby' ? (
              <div className="steam-scene-view steam-scene-lobby">
                <section className="steam-scene-banner steam-scene-banner--lobby">
                  <div>
                    <p className="card-kicker">Campaign Hall</p>
                    <h3>{steamHeroTitle}</h3>
                    <p>{steamSceneDescription}</p>
                  </div>
                  <div className="steam-scene-banner-meta">
                    <span className="steam-badge">{steamHeroBadge}</span>
                    <button className="primary-button" type="button" onClick={openSteamUploadPicker}>
                      上传 PDF，启动战役
                    </button>
                  </div>
                </section>

                <div className="steam-scene-grid">
                  <article className="steam-scene-card">
                    <span className="summary-card-kicker">路线指令</span>
                    <strong>先找地图，再进关卡</strong>
                    <p>上传后，战役会自动生成章节路线，你只需要点开下一段路。</p>
                  </article>
                  <article className="steam-scene-card">
                    <span className="summary-card-kicker">当前目标</span>
                    <strong>{steamSceneObjective}</strong>
                    <p>{steamActiveCampaign ? steamActiveCampaign.summary : '这场战役还在等待第一本书。'}</p>
                  </article>
                  <article className="steam-scene-card">
                    <span className="summary-card-kicker">战役选择</span>
                    <div className="steam-mini-list">
                      {steamCampaigns.slice(0, 3).map((campaign) => {
                        const isActiveCampaign = steamActiveCampaign?.id === campaign.id;
                        return (
                          <button
                            key={campaign.id}
                            type="button"
                            className={`steam-mini-campaign ${isActiveCampaign ? 'is-active' : ''}`}
                            onClick={() => startSteamCampaign(campaign.id)}
                          >
                            <strong>{campaign.title}</strong>
                            <span>{campaign.subtitle}</span>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                </div>
              </div>
            ) : steamScene === 'map' ? (
              <div className="steam-scene-view steam-scene-map">
                <section className="steam-scene-banner steam-scene-banner--map">
                  <div>
                    <p className="card-kicker">Chapter Map</p>
                    <h3>{steamActiveCampaign?.title ?? '章节地图'}</h3>
                    <p>{steamSceneDescription}</p>
                  </div>
                  <div className="steam-scene-banner-meta">
                    <span className="steam-badge">{steamChapters.length} 章</span>
                    <button className="ghost-button" type="button" onClick={() => setSteamScene('stage')} disabled={!steamActiveChapter}>
                      进入当前关卡
                    </button>
                  </div>
                </section>

                <div className="steam-map-track">
                  {steamChapters.length === 0 ? (
                    <p className="muted">导入一本 PDF 后，章节地图会自动生成。</p>
                  ) : (
                    steamChapters.map((chapter, index) => {
                      const isActiveChapter = steamActiveChapter?.id === chapter.id;
                      const isCleared = steamClearedChapterIds.includes(chapter.id);
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          className={`steam-map-node ${isActiveChapter ? 'is-active' : ''} ${isCleared ? 'is-cleared' : ''}`}
                          onClick={() => focusSteamChapter(chapter.id)}
                        >
                          <span className="steam-map-index">0{index + 1}</span>
                          <div>
                            <strong>{chapter.title}</strong>
                            <p>{chapter.summary}</p>
                          </div>
                          <span className="steam-map-state">{isCleared ? '已解锁' : '待挑战'}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="steam-scene-view steam-scene-stage">
                <section className="steam-scene-banner steam-scene-banner--stage">
                  <div>
                    <p className="card-kicker">Stage Page</p>
                    <h3>{steamActiveChapter?.title ?? '当前关卡'}</h3>
                    <p>{steamActiveChapter ? steamActiveChapter.summary : '先在地图里选择一章，然后进入关卡。'}</p>
                  </div>
                  <div className="steam-scene-banner-meta">
                    <span className="steam-badge">{steamTranslationUnlocked ? '翻译解锁' : '等待解锁'}</span>
                    <button className="ghost-button" type="button" onClick={advanceSteamChapter} disabled={steamChapters.length === 0}>
                      下一个关卡
                    </button>
                  </div>
                </section>

                {steamActiveChapter ? (
                  <div className="steam-stage-grid">
                    <article className="steam-stage-panel">
                      <span className="summary-card-kicker">关卡提示</span>
                      <strong>{steamSceneObjective}</strong>
                      <p>{steamActiveChapter.note}</p>
                      <div className="steam-stage-channel">
                        <span className={`pill ${steamTranslationUnlocked ? 'pill-link' : ''}`}>
                          {steamTranslationUnlocked ? '翻译卡已打开' : '完成答题后解锁翻译'}
                        </span>
                        <span className="pill">{steamActiveChapterIndex + 1}/{steamChapters.length || 1}</span>
                      </div>
                    </article>

                    <article className="steam-stage-panel">
                      <span className="summary-card-kicker">原文卡</span>
                      <p className="steam-stage-copy">{steamActiveChapter.original}</p>
                      <div className="steam-stage-channel">
                        <button className="ghost-button" type="button" onClick={() => setSteamLanguageMode('original')}>
                          看原文
                        </button>
                        <button className="ghost-button" type="button" onClick={() => setSteamLanguageMode('dual')}>
                          双语
                        </button>
                        <button className="ghost-button" type="button" onClick={() => setSteamLanguageMode('translation')}>
                          译文
                        </button>
                      </div>
                    </article>

                    <article className="steam-stage-panel">
                      <span className="summary-card-kicker">翻译卡</span>
                      <p className="steam-stage-copy">{steamTranslationUnlocked ? steamActiveChapter.translation : '翻译卡尚未解锁，请先完成题目挑战。'}</p>
                      <div className="steam-stage-channel">
                        <span className="pill">{steamQuizCorrect ? '已答对' : '待闯关'}</span>
                        <span className="pill">{steamActiveChapter.note}</span>
                      </div>
                    </article>
                  </div>
                ) : (
                  <p className="muted">选中一场战役，再进入章节地图选择关卡。</p>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="panel detail-panel">
          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Battle Dossier</p>
                <h2>{detailNode?.label ?? (isGlossaryView ? '引用档案' : '关卡档案')}</h2>
              </div>
              {detailNode ? (
                <button
                  className={`bookmark-toggle ${isBookmarked ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => toggleBookmark(detailNode)}
                  disabled={busy}
                >
                  {isBookmarked ? '已收藏' : '收藏'}
                </button>
              ) : null}
            </div>

            {isSteamSkin ? (
              <div className="steam-adventure">
                <section className="section-block steam-chapter-panel">
                  <h3>关卡档案</h3>
                  {steamActiveChapter ? (
                    <>
                      <div className="steam-chapter-hero">
                        <div>
                          <p className="steam-chapter-kicker">{steamActiveCampaign?.title ?? '当前战役'}</p>
                          <strong>{steamActiveChapter.title}</strong>
                          <p>{steamActiveChapter.summary}</p>
                        </div>
                        <div className="steam-chapter-actions">
                          <span className="pill">{steamActiveChapter.note}</span>
                          <span className="pill">{steamTranslationUnlocked ? '翻译已解锁' : '等待答题解锁'}</span>
                          <button className="ghost-button" type="button" onClick={advanceSteamChapter} disabled={steamChapters.length === 0}>
                            下一章节
                          </button>
                        </div>
                      </div>
                      <div className="steam-language-toggle">
                        <button
                          className={`view-tab ${steamLanguageMode === 'original' ? 'is-active' : ''}`}
                          type="button"
                          onClick={() => setSteamLanguageMode('original')}
                        >
                          原文
                        </button>
                        <button
                          className={`view-tab ${steamLanguageMode === 'dual' ? 'is-active' : ''}`}
                          type="button"
                          onClick={() => setSteamLanguageMode('dual')}
                        >
                          双语
                        </button>
                        <button
                          className={`view-tab ${steamLanguageMode === 'translation' ? 'is-active' : ''}`}
                          type="button"
                          onClick={() => setSteamLanguageMode('translation')}
                        >
                          译文
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">先在左侧上传一本 PDF 或选择一场战役。</p>
                  )}
                </section>

                <section className="section-block steam-quiz-panel">
                  <h3>战斗题目</h3>
                  {steamQuiz && steamActiveChapter ? (
                    <>
                      <p className="steam-quiz-prompt">{steamQuiz.prompt}</p>
                      <div className="steam-quiz-list">
                        {steamQuiz.options.map((option, index) => {
                          const isSelected = steamSelectedOption === index;
                          const isCorrect = steamSelectedOption !== null && index === steamQuiz.correctIndex;
                          const isWrong = isSelected && steamSelectedOption !== steamQuiz.correctIndex;
                          return (
                            <button
                              key={option}
                              type="button"
                              className={`steam-quiz-option ${isSelected ? 'is-selected' : ''} ${isCorrect ? 'is-correct' : ''} ${
                                isWrong ? 'is-wrong' : ''
                              }`}
                              onClick={() => answerSteamQuiz(index)}
                            >
                              <span className="steam-quiz-index">0{index + 1}</span>
                              <strong>{option}</strong>
                            </button>
                          );
                        })}
                      </div>
                      {steamSelectedOption !== null ? (
                        <div className="steam-quiz-result">
                          <span className={`pill ${steamQuizCorrect ? 'pill-link' : ''}`}>{steamQuizCorrect ? '答对了' : '未命中'}</span>
                          <p>{steamQuiz.explanation}</p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="muted">选中一章后，就会生成这一关的题目。</p>
                  )}
                </section>

                <section className="section-block steam-translation-panel">
                  <h3>双语卡片</h3>
                  {steamActiveChapter ? (
                    steamTranslationUnlocked ? (
                      <>
                        <div className="steam-translation-shell">
                          {steamLanguageMode !== 'translation' ? (
                            <article className="steam-translation-card">
                              <span>Original</span>
                              <p>{steamActiveChapter.original}</p>
                            </article>
                          ) : null}
                          {steamLanguageMode !== 'original' ? (
                            <article className="steam-translation-card">
                              <span>Translation</span>
                              <p>{steamActiveChapter.translation}</p>
                            </article>
                          ) : null}
                        </div>
                        <p className="steam-translation-note">{steamActiveChapter.note}</p>
                      </>
                    ) : (
                      <div className="steam-locked-card">
                        <strong>翻译卡尚未解锁</strong>
                        <p>先完成题目闯关，翻译卡就会打开。</p>
                      </div>
                    )
                  ) : (
                    <p className="muted">先启动一个战役，我们再打开这张翻译卡。</p>
                  )}
                </section>
              </div>
            ) : null}

            {detailNode ? (
              isSteamSkin ? (
                <div className="steam-dossier">
                  <div className="steam-dossier-hero">
                    <div>
                      <p className="steam-chapter-kicker">{detailNode.category}</p>
                      <strong>{detailNode.label}</strong>
                      <p>{detailParts.narrative || detailNode.summary}</p>
                    </div>
                    <div className="steam-dossier-actions">
                      <span className="pill">{kindLabel(detailNode.kind)}</span>
                      <span className="pill">{detailNode.sources.length} 个来源</span>
                      <button className="ghost-button" type="button" onClick={() => setSteamScene('map')}>
                        回到地图
                      </button>
                    </div>
                  </div>

                  <div className="section-block">
                    <h3>战役概要</h3>
                    <p className="steam-stage-copy">{detailParts.narrative || detailNode.detail}</p>
                  </div>

                  <div className="section-block">
                    <h3>引用锚点</h3>
                    {detailNode.referenceIds.length > 0 ? renderReferenceChips(detailNode.referenceIds, '引用锚点') : <p className="muted">暂无引用锚点。</p>}
                  </div>

                  <div className="section-block">
                    <h3>来源卷宗</h3>
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
                <div className="section-block">
                  <h3>知识详情</h3>
                  <p className="detail-summary">{detailNode.summary}</p>
                  <p className="detail-body">{detailParts.narrative || detailNode.detail}</p>
                </div>
              )
            ) : (
              <p className="muted">先在战役里点亮一个节点，这里会显示它的档案。</p>
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
      {citationPreviewLayer}
    </div>
  );
}

export default App;
