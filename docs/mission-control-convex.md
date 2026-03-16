# Mission Control Lite (Convex) — Cognitive Memory Update

Current backend target:
- HTTP API base: `https://dutiful-goshawk-499.convex.site/mission-control`

## Implemented

### Core taskboard (backward compatible)
- Existing task APIs preserved:
  - `GET /tasks`
  - `POST /tasks`
  - `PATCH /tasks/status`
  - `POST /tasks/claim`
  - `POST /tasks/comment`
  - `POST /tasks/blocked`

### Cognitive memory schema
- `memories` (status: `active|superseded|stale`, `supersedesMemoryId`, contradiction tracking)
- `memory_edges` (supports/contradicts/derived_from/related)
- `memory_recall_logs` (confidence band, evidence gaps, review flags, token proxy)

### Memory APIs
- `POST /memory/remember`
- `POST /memory/extract`
- `POST /memory/recall`
- `POST /memory/forget` (soft-forget -> mark stale)
- `GET /memory/tree?scope=...`
- `GET /memory/stats`
- `GET /memory/metrics`
- `POST /memory/recall/review`

### Behavior implemented
- Duplicate consolidation by fingerprint
- Contradiction/supersede handling via heuristic + status transitions
- Recall composite scoring: similarity + recency + importance + reliability
- Recall confidence bands: high/medium/low
- Low-confidence and evidence-gap signaling via `requiresReview`
- Events + audit writes for memory operations

### UI
- Admin/Public views now include:
  - memory stats
  - memory metrics
  - recent memory conflicts

### Scripts
- `scripts/research_agent_cycle.py` now uses recall before task execution and blocks to review on low-confidence path
- `scripts/memory_metrics_report.py` reports KPI JSON from `/memory/metrics`

## Deployment
Use deterministic SSM -> Convex env hydration + deploy:

```bash
python3 /home/ubuntu/clawd/scripts/deploy_mission_control.py
```

This ensures both:
- `CONVEX_DEPLOY_KEY` (for deploy auth)
- `MISSION_CONTROL_ADMIN_KEY` (for runtime admin auth)

are loaded from SSM before deploy.

## Runtime health check
Verify runtime key configuration after deploy:

```bash
curl -sS https://<your-convex-site>/mission-control/health/auth-config
```

Expected:
- `200` with `{ "ok": true, "configured": true, ... }` when runtime key is set.
- `503` when runtime key is missing/placeholder.
