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

There is now a first backend scaffold in [`backend/`](./backend) with:

- `FastAPI` app skeleton
- Demo graph endpoints
- Text ingestion and Q&A placeholders
- `docker-compose.yml` for `PostgreSQL`, `Neo4j`, and `Redis`

## Suggested product names

If you want something more brandable than `KnowledgeGraph`, a few directions are:

- `MindWeave`
- `GraphLoom`
- `知脉`
- `Knowledge Loom`
- `LexiGraph`

## Run locally

Frontend:

```bash
pnpm install
pnpm dev
```

If you want the frontend to talk to the FastAPI backend, create a local `.env.local` with:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Backend:

```bash
cd backend
pip3 install -r requirements.txt
uvicorn app.main:app --reload
```

Or run the full stack with Docker:

```bash
docker compose up --build
```
