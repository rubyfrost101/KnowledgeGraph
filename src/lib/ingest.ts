import type {
  ImportedKnowledgeBatch,
  KnowledgeDocument,
  KnowledgeEdge,
  KnowledgeNode,
} from '../types';
import { canonicalText, makeStableId, uniqueList } from './normalize';
import { createNodeFromHeading } from './graph';

export interface IngestFileResult {
  batch: ImportedKnowledgeBatch;
  summary: string;
}

function splitBlocks(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/g)
    .map((block) => block.trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  const chunks = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？!?\.])\s+|(?<=\n)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.length ? chunks : [text.trim()];
}

function extractAliases(line: string): string[] {
  const matches = [...line.matchAll(/[（(]([^（）()]{1,28})[)）]/g)];
  return matches.map((match) => match[1].trim()).filter(Boolean);
}

function titleFromText(text: string): string {
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.replace(/^#+\s*/, '').slice(0, 60) : 'Imported notes';
}

function inferKind(label: string): KnowledgeNode['kind'] {
  if (/book|chapter|dictionary|text/i.test(label)) {
    return 'book';
  }
  if (/process|method|diagnosis|analysis|learning|recall|translation/i.test(label)) {
    return 'process';
  }
  return 'concept';
}

function connect(nodes: KnowledgeNode[], source: string, target: string, kind: KnowledgeEdge['kind'], label: string, weight: number, documentId: string): KnowledgeEdge {
  return {
    id: makeStableId('edge', `${source}:${kind}:${target}:${label}:${documentId}`),
    source,
    target,
    kind,
    label,
    weight,
    sources: [documentId],
  };
}

function inferRelations(blocks: string[], nodesByLabel: Map<string, KnowledgeNode>, documentId: string): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  for (const block of blocks) {
    const sentences = splitSentences(block);
    for (const sentence of sentences) {
      const normalizedSentence = canonicalText(sentence);
      const mentioned = [...nodesByLabel.values()].filter((node) => normalizedSentence.includes(canonicalText(node.label)) || node.aliases.some((alias) => normalizedSentence.includes(canonicalText(alias))));
      if (mentioned.length < 2) {
        continue;
      }

      for (let index = 0; index < mentioned.length - 1; index += 1) {
        const source = mentioned[index];
        const target = mentioned[index + 1];
        let kind: KnowledgeEdge['kind'] = 'mentions';
        let label = 'mentions';
        if (/属于|是|is a|kind of|类型/.test(sentence)) {
          kind = 'is-a';
          label = 'is a';
        } else if (/对比|相对|反义|opposite|contrast/.test(sentence)) {
          kind = 'contrast-with';
          label = 'contrast';
        } else if (/属于同一|同属|same domain|相关|related/.test(sentence)) {
          kind = 'related-to';
          label = 'related';
        } else if (/组成|part of|包含|contains/.test(sentence)) {
          kind = 'part-of';
          label = 'part of';
        }
        edges.push(connect(nodesByLabelToArray(nodesByLabel), source.id, target.id, kind, label, 0.45, documentId));
      }
    }
  }

  return dedupeEdges(edges);
}

function nodesByLabelToArray(nodesByLabel: Map<string, KnowledgeNode>): KnowledgeNode[] {
  return [...nodesByLabel.values()];
}

function dedupeEdges(edges: KnowledgeEdge[]): KnowledgeEdge[] {
  const map = new Map<string, KnowledgeEdge>();
  for (const edge of edges) {
    const key = `${edge.source}:${edge.kind}:${edge.target}:${canonicalText(edge.label)}`;
    const existing = map.get(key);
    if (existing) {
      existing.weight = Math.max(existing.weight, edge.weight);
      existing.sources = uniqueList([...existing.sources, ...edge.sources]);
    } else {
      map.set(key, edge);
    }
  }
  return [...map.values()];
}

export async function ingestText(text: string, origin: string): Promise<IngestFileResult> {
  const documentId = makeStableId('doc', `${origin}:${text.slice(0, 120)}`);
  const title = titleFromText(text);
  const blocks = splitBlocks(text);
  const nodesByLabel = new Map<string, KnowledgeNode>();

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const heading = lines.find((line) => /^#+\s+/.test(line) || line.length <= 80) ?? lines[0];
    if (!heading) {
      continue;
    }

    const cleaned = heading.replace(/^#+\s*/, '').replace(/[:：]\s*$/, '').trim();
    const key = canonicalText(cleaned);
    const detail = block.replace(/^#+\s*/, '').trim();
    const aliases = uniqueList(extractAliases(block));

    if (!key || nodesByLabel.has(key)) {
      continue;
    }

    const node = createNodeFromHeading(cleaned, inferKind(cleaned), documentId, detail);
    node.aliases = aliases;
    node.sources = [documentId];
    node.referenceIds = [];
    node.summary = splitSentences(detail)[0]?.slice(0, 160) ?? detail.slice(0, 160);
    nodesByLabel.set(key, node);
  }

  if (nodesByLabel.size === 0) {
    const fallbackLabel = titleFromText(text);
    const node = createNodeFromHeading(fallbackLabel, 'book', documentId, text);
    nodesByLabel.set(canonicalText(fallbackLabel), node);
  }

  const nodes = [...nodesByLabel.values()];
  const edges = inferRelations(blocks, nodesByLabel, documentId);

  const document: KnowledgeDocument = {
    id: documentId,
    title,
    type: 'text',
    origin,
    importedAt: new Date().toISOString(),
    notes: '从文本导入，使用章节/术语启发式解析。',
  };

  return {
    batch: {
      nodes,
      edges,
      documents: [document],
    },
    summary: `已从文本中提取 ${nodes.length} 个知识点与 ${edges.length} 条关系。`,
  };
}
