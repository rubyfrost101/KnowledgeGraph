import type { KnowledgeAnswer, KnowledgeDocument, KnowledgeGraphData, KnowledgeNode } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';

type BackendKnowledgeDocument = {
  id: string;
  title: string;
  type: 'demo' | 'pdf' | 'text';
  origin: string;
  imported_at: string;
  page_count?: number | null;
  notes?: string | null;
};

type BackendKnowledgeNode = KnowledgeNode;

type BackendKnowledgeEdge = KnowledgeGraphData['edges'][number];

type BackendGraphResponse = {
  nodes: BackendKnowledgeNode[];
  edges: BackendKnowledgeEdge[];
  documents: BackendKnowledgeDocument[];
};

type BackendQAResponse = {
  title: string;
  answer: string;
  supporting_nodes: BackendKnowledgeNode[];
  citations: string[];
  confidence: number;
};

type BackendIngestResponse = {
  document: BackendKnowledgeDocument;
  graph: BackendGraphResponse;
  summary: string;
};

function ensureConfigured() {
  if (!API_BASE_URL) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured');
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  ensureConfigured();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function normalizeDocument(document: BackendKnowledgeDocument): KnowledgeDocument {
  return {
    id: document.id,
    title: document.title,
    type: document.type,
    origin: document.origin,
    importedAt: document.imported_at,
    pageCount: document.page_count ?? undefined,
    notes: document.notes ?? undefined,
  };
}

function normalizeGraph(graph: BackendGraphResponse): KnowledgeGraphData {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    documents: graph.documents.map(normalizeDocument),
  };
}

function normalizeAnswer(answer: BackendQAResponse): KnowledgeAnswer {
  return {
    title: answer.title,
    answer: answer.answer,
    supportingNodes: answer.supporting_nodes,
    citations: answer.citations,
  };
}

export function isBackendConfigured(): boolean {
  return API_BASE_URL.length > 0;
}

export async function fetchBackendGraph(): Promise<KnowledgeGraphData> {
  const graph = await requestJson<BackendGraphResponse>('/v1/graphs/default');
  return normalizeGraph(graph);
}

export async function ingestBackendText(payload: {
  text: string;
  title?: string;
  origin?: string;
  source_type?: 'text' | 'pdf' | 'demo';
}): Promise<{ graph: KnowledgeGraphData; summary: string }> {
  const response = await requestJson<BackendIngestResponse>('/v1/documents', {
    method: 'POST',
    body: JSON.stringify({
      text: payload.text,
      title: payload.title,
      origin: payload.origin ?? 'upload',
      source_type: payload.source_type ?? 'text',
    }),
  });
  return {
    graph: normalizeGraph(response.graph),
    summary: response.summary,
  };
}

export async function askBackendQuestion(payload: {
  question: string;
  contextNodeId?: string;
  topK?: number;
}): Promise<KnowledgeAnswer> {
  const response = await requestJson<BackendQAResponse>('/v1/qa', {
    method: 'POST',
    body: JSON.stringify({
      question: payload.question,
      graph_id: 'default',
      context_node_id: payload.contextNodeId ?? null,
      top_k: payload.topK ?? 5,
    }),
  });
  return normalizeAnswer(response);
}
