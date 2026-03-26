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
- PDF text is split into page-aware sections before extraction
- Repeated concepts are merged across books using label and alias similarity
- Relations are inferred from cue words plus same-domain co-occurrence

## Branch strategy

The repository now uses two parallel release lines:

- `dev` for everyday development
- `qa` for stabilization and testing before `main`
- `main` for the stable product
- `steam.dev` for Steam-oriented feature work
- `steam.qa` for Steam testing before `steam.main`
- `steam.main` for the stable Steam release line

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full workflow and merge rules.

For release promotions from `qa` to `main`, use [`.github/PULL_REQUEST_TEMPLATE/qa-to-main.md`](./.github/PULL_REQUEST_TEMPLATE/qa-to-main.md) so the merge checklist and release notes stay consistent.

For testing promotions from `dev` to `qa`, use [`.github/PULL_REQUEST_TEMPLATE/dev-to-qa.md`](./.github/PULL_REQUEST_TEMPLATE/dev-to-qa.md).

The GitHub branch protection and required checks plan is documented in [`docs/branch-protection.md`](./docs/branch-protection.md).

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
- `GET /v1/documents?include_deleted=true`
- `GET /v1/nodes?include_deleted=true`

Deletion and undo rules:

- Deleting an imported document removes its provenance from connected nodes and edges
- If a node or edge no longer has any sources, it is soft-deleted
- Deleting a knowledge point is also soft-deleted so it can be restored later
- The UI includes a recycle bin for deleted documents and nodes
- A knowledge point that has lost all provenance must be restored by bringing back its source document first
- Restoring a document replays the saved revision payload and merges it back into the graph
- Restoring a node clears the soft-delete flag and brings back its incident edges

Or run the full stack with Docker:

```bash
docker compose up --build
```
