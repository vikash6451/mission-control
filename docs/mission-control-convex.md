# Mission Control Lite (Convex) — v1

Current deployed backend:
- Cloud: `https://aromatic-okapi-179.convex.cloud`
- HTTP API base: `https://aromatic-okapi-179.convex.site/mission-control`

## What is implemented

Backend in `convex/`:
- `schema.ts`
  - `tasks`
  - `handoffs`
  - `auditLog`
- `missionControl.ts`
  - `createTask`
  - `listTasks`
  - `updateTaskStatus`
  - `createHandoff`
  - `listHandoffs`
- `http.ts`
  - `GET /mission-control/tasks`
  - `POST /mission-control/tasks`
  - `PATCH /mission-control/tasks/status`

Core rules implemented:
- Lanes: `research`, `finance`, `sports`, `ops`
- Status flow: `backlog`, `in_progress`, `review`, `done`
- Only `main-orchestrator` can move task to `done`
- Cross-lane work should be done via explicit `handoffs`
- Audit log written on create/update/handoff events

## Minimal UI (same repo)

- `apps/mission-control-lite/index.html` (landing)
- `apps/mission-control-lite/public.html` (read-only)
- `apps/mission-control-lite/admin.html` (write actions)

Admin gating (lightweight):
- `POST /mission-control/tasks` and `PATCH /mission-control/tasks/status` require header `x-admin-key`.
- Current fallback admin key is: `CHANGE_ME_LOCAL_ADMIN_KEY` (temporary until Convex env var is set).
- Intended env var: `MISSION_CONTROL_ADMIN_KEY`.

Run locally:

```bash
cd /home/ubuntu/clawd/apps/mission-control-lite
python3 -m http.server 8788
```

Then open:
- `http://localhost:8788`

## Deploy/refresh backend

Uses deploy key from SSM:

```bash
cd /home/ubuntu/clawd
python3 - <<'PY'
import boto3, os, subprocess
v=boto3.client('ssm',region_name='eu-north-1').get_parameter(Name='/clawd/CONVEX_DEPLOY_KEY',WithDecryption=True)['Parameter']['Value']
env=os.environ.copy(); env['CONVEX_DEPLOY_KEY']=v
subprocess.run(['npx','convex','deploy','--yes','--preview-create','clawd-mission-control'],env=env)
PY
```

## Notes

- This is functional v1 for fast operations.
- Auth hardening is intentionally not complete yet (as requested).
- Next step: add Google auth + role checks in HTTP layer and hide raw status mutations behind server-side policy.
- Once Convex auth API is stable, set a real key via:

```bash
npx convex env set MISSION_CONTROL_ADMIN_KEY '<new-strong-key>'
```
