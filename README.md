# KnowledgeGraph

KnowledgeGraph is a Next.js-based prototype for turning books, dictionaries, and notes into a connected concept map.

## What the current app does

- Visualizes concepts as an interactive graph
- Centers and highlights a selected node
- Shows structured explanations in a detail panel
- Imports demo data, text files, and PDFs
- Answers questions with a lightweight local retrieval layer

## Frontend stack

- `Next.js`
- `React`
- `TypeScript`
- `d3-force` for graph layout
- `pdfjs-dist` for browser-side PDF text extraction

## Backend direction

The intended production stack is documented in [`docs/backend-architecture.md`](./docs/backend-architecture.md).

In short:

- `FastAPI` for API and orchestration
- `PostgreSQL` for documents, chunks, provenance, and jobs
- `Neo4j` for graph traversal and neighborhood search
- `Redis` plus a worker queue for background ingestion

## Suggested product names

If you want something more brandable than `KnowledgeGraph`, a few directions are:

- `MindWeave`
- `GraphLoom`
- `知脉`
- `Knowledge Loom`
- `LexiGraph`

## Run locally

```bash
pnpm install
pnpm dev
```
