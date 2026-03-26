## [LRN-20260326-001] backend_graph_self_loop_guard

**Logged**: 2026-03-26T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
Self-loop `part-of` edges can crash glossary tree rendering, so both ingestion and graph snapshot paths must defensively skip them.

### Details
The glossary browser originally recursed through `part-of` edges without cycle protection. Real stored data contained self-loop section edges, which made the tree builder recurse forever and break the page. The fix is twofold: filter invalid edges in the frontend tree builder and prevent/purge self-loop edges in backend ingestion, merge, snapshot, and projection paths.

### Suggested Action
Keep the edge-sanity checks in place and add a regression test that loads a graph with a self-loop `part-of` edge to ensure the glossary page still renders.

### Metadata
- Source: conversation
- Related Files: /Users/yueqian/Desktop/ai/knowledgeGraph/src/App.tsx, /Users/yueqian/Desktop/ai/knowledgeGraph/backend/app/services/ingestion.py, /Users/yueqian/Desktop/ai/knowledgeGraph/backend/app/services/graph_merge.py, /Users/yueqian/Desktop/ai/knowledgeGraph/backend/app/services/persistent_store.py
- Tags: graph, glossary, cycle, self-loop, ingestion

---
