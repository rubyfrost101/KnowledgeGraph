export type KnowledgeKind = 'concept' | 'term' | 'process' | 'book' | 'topic';

export type RelationKind =
  | 'is-a'
  | 'related-to'
  | 'contrast-with'
  | 'part-of'
  | 'depends-on'
  | 'mentions'
  | 'same-domain';

export interface KnowledgeNode {
  id: string;
  label: string;
  kind: KnowledgeKind;
  category: string;
  summary: string;
  detail: string;
  aliases: string[];
  sources: string[];
  score: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  label: string;
  weight: number;
  sources: string[];
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  type: 'demo' | 'pdf' | 'text' | 'image';
  origin: string;
  importedAt: string;
  pageCount?: number;
  notes?: string;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  documents: KnowledgeDocument[];
}

export interface ImportedKnowledgeBatch {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  documents: KnowledgeDocument[];
}

export interface KnowledgeAnswer {
  title: string;
  answer: string;
  supportingNodes: KnowledgeNode[];
  citations: string[];
}
