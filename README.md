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
- Text ingestion, queued file upload ingestion, OCR fallback, and Q&A endpoints
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

The backend now accepts both JSON text ingestion and multipart file upload at:

- `POST /v1/documents`
- `POST /v1/documents/upload`

Deletion and undo rules:

- Deleting an imported document removes its provenance from connected nodes and edges
- If a node or edge no longer has any sources, it is soft-deleted
- Deleting a knowledge point is also soft-deleted so it can be restored later
- Restoring a document replays the saved revision payload and merges it back into the graph
- Restoring a node clears the soft-delete flag and brings back its incident edges

Or run the full stack with Docker:

```bash
docker compose up --build
```
