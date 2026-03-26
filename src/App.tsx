"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { answerQuestion, collectNeighborhood, layoutGraph, mergeGraphData, searchNode } from './lib/graph';
import { ingestText } from './lib/ingest';
import { readKnowledgeFile } from './lib/files';
import { demoGraph } from './lib/sampleData';
import type { KnowledgeAnswer, KnowledgeDocument, KnowledgeGraphData, KnowledgeNode } from './types';
import { askBackendQuestion, fetchBackendGraph, ingestBackendText, isBackendConfigured } from './lib/backendClient';

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
  const [searchMatches, setSearchMatches] = useState<KnowledgeNode[]>([]);
  const [busy, setBusy] = useState(false);

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
    let active = true;

    async function hydrateFromBackend() {
      if (!backendConfigured) {
        return;
      }

      setStatus('正在连接后端知识库...');
      try {
        const remoteGraph = await fetchBackendGraph();
        if (!active) {
          return;
        }
        setGraph(remoteGraph);
        setSelectedId(remoteGraph.nodes[0]?.id ?? '');
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
        setGraph(result.graph);
        setSelectedId(result.graph.nodes[0]?.id ?? selectedId);
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
    setStatus('已恢复示例图谱。');
  }

  function applySearchSelection(node: KnowledgeNode) {
    setSelectedId(node.id);
    setQuery(node.label);
    setStatus(`已聚焦到“${node.label}”。`);
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
              <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={handleFileChange} />
              <span>拖拽或点击上传 PDF / TXT / MD</span>
              <small>PDF 会先提取文字，再进入知识解析流程。</small>
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
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div>
              <p className="card-kicker">Graph</p>
              <h2>{selectedLayoutNode ? selectedLayoutNode.label : '选择一个知识点'}</h2>
            </div>
            <div className="toolbar-badges">
              <span>{selectedNode ? kindLabel(selectedNode.kind) : '无选中'}</span>
              <span>{selectedNode?.category ?? '待聚焦'}</span>
              <span>{backendConfigured ? '后端模式' : '本地模式'}</span>
              <span>{busy ? '处理中' : status}</span>
            </div>
          </div>

          <div className="graph-shell">
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
          </div>
        </section>

        <aside className="panel detail-panel">
          <section className="card">
            <div className="card-head">
              <div>
                <p className="card-kicker">Detail</p>
                <h2>{selectedNode?.label ?? '知识点详情'}</h2>
              </div>
            </div>

            {selectedNode ? (
              <>
                <div className="pill-row">
                  <span className="pill">{kindLabel(selectedNode.kind)}</span>
                  <span className="pill">{selectedNode.category}</span>
                  <span className="pill">{selectedNode.sources.length} 个来源标记</span>
                </div>
                <p className="detail-summary">{selectedNode.summary}</p>
                <p className="detail-body">{selectedNode.detail}</p>

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
                    {selectedNode.sources.map((source) => (
                      <li key={source}>{source}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <p className="muted">点击图谱中的节点，右侧会显示详细解释。</p>
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
