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
Use SSM deploy key and deploy from repo root:

```bash
python3 - <<'PY'
import boto3, os, subprocess
v=boto3.client('ssm',region_name='eu-north-1').get_parameter(Name='/clawd/CONVEX_DEPLOY_KEY',WithDecryption=True)['Parameter']['Value']
env=os.environ.copy(); env['CONVEX_DEPLOY_KEY']=v
subprocess.run(['npx','convex','deploy','--yes','--preview-create','mission-control-lite'],env=env,check=True)
PY
```
