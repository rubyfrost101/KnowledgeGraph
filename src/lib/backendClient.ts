import type { KnowledgeAnswer, KnowledgeDocument, KnowledgeGraphData, KnowledgeNode } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';

type BackendKnowledgeDocument = {
  id: string;
  title: string;
  type: 'demo' | 'pdf' | 'text' | 'image';
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

type BackendUploadResponse = BackendIngestResponse & {
  filename: string;
  page_count?: number | null;
};

type BackendJobResponse = {
  job_id: string;
  document_id: string;
  filename: string;
  kind: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  summary?: string | null;
  error?: string | null;
};

type BackendMutationResponse = {
  ok: boolean;
  message: string;
  graph?: BackendGraphResponse | null;
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
    headers: init?.body instanceof FormData ? init?.headers : {
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

export async function uploadBackendFile(payload: {
  file: File;
  title?: string;
  origin?: string;
}): Promise<BackendJobResponse> {
  ensureConfigured();
  const formData = new FormData();
  formData.append('file', payload.file);
  if (payload.title) {
    formData.append('title', payload.title);
  }
  if (payload.origin) {
    formData.append('origin', payload.origin);
  }

  const response = await fetch(`${API_BASE_URL}/v1/documents/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Backend request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<BackendJobResponse>;
}

export async function pollBackendJob(jobId: string): Promise<BackendJobResponse> {
  return requestJson<BackendJobResponse>(`/v1/jobs/${jobId}`);
}

async function requestMutation(path: string, method: 'DELETE' | 'POST'): Promise<BackendMutationResponse> {
  return requestJson<BackendMutationResponse>(path, { method });
}

export async function deleteBackendDocument(documentId: string): Promise<{ ok: boolean; message: string; graph?: KnowledgeGraphData }> {
  const response = await requestMutation(`/v1/documents/${documentId}`, 'DELETE');
  return {
    ok: response.ok,
    message: response.message,
    graph: response.graph ? normalizeGraph(response.graph) : undefined,
  };
}

export async function restoreBackendDocument(documentId: string): Promise<{ ok: boolean; message: string; graph?: KnowledgeGraphData }> {
  const response = await requestMutation(`/v1/documents/${documentId}/restore`, 'POST');
  return {
    ok: response.ok,
    message: response.message,
    graph: response.graph ? normalizeGraph(response.graph) : undefined,
  };
}

export async function deleteBackendNode(nodeId: string): Promise<{ ok: boolean; message: string; graph?: KnowledgeGraphData }> {
  const response = await requestMutation(`/v1/nodes/${nodeId}`, 'DELETE');
  return {
    ok: response.ok,
    message: response.message,
    graph: response.graph ? normalizeGraph(response.graph) : undefined,
  };
}

export async function restoreBackendNode(nodeId: string): Promise<{ ok: boolean; message: string; graph?: KnowledgeGraphData }> {
  const response = await requestMutation(`/v1/nodes/${nodeId}/restore`, 'POST');
  return {
    ok: response.ok,
    message: response.message,
    graph: response.graph ? normalizeGraph(response.graph) : undefined,
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
