# Dev Progress Snapshot

This snapshot records the current `dev` line before shifting focus to `steam.dev`.

## What is already in place

- Next.js + React + TypeScript frontend
- Knowledge graph visualization with node focus, relation highlighting, and detail panel
- PDF / text / image ingestion with OCR fallback through the backend
- FastAPI backend scaffold with PostgreSQL, Neo4j, Redis, and worker queue direction
- Persistent import jobs, recycle bin, and provenance-aware restore flow
- Glossary view with:
  - directory tree
  - chapter summaries
  - keywords
  - auto-generated tags
  - citation anchors
  - hover previews
- Task center with job history and progress bars
- Recycle bin for documents and deleted nodes
- Bookmark collection for important nodes
- Branch strategy docs, PR templates, release checklist, and branch protection plan

## Current quality bar

- `pnpm build` passes
- Backend Python compilation passes
- `docker compose config` passes
- The main workflows have been exercised locally and through browser checks

## What `dev` is now optimized for

- Product-like knowledge graph browsing
- Importing and extracting books / PDFs / notes
- Stable QA promotion into `qa`
- Keeping the core product close to a professional research/workbench experience

## What to avoid in `dev`

- Steam-specific gameplay experiments
- Diverging too far from the knowledge-product base
- Adding one-off UI gimmicks that do not help the core graph workflow

## Next likely directions

1. More precise graph extraction and deduplication
2. Better browsing and annotation tools for the knowledge workbench
3. Stronger backend validation and release automation

