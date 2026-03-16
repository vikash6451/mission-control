# Mission Control Lite

Lightweight taskboard with lane isolation + cognitive memory:
- Lanes: research, finance, sports, ops
- Status flow: backlog -> in_progress -> review -> done
- Only `main-orchestrator` can mark done
- Public read-only view + Admin view split
- L3 research contract fields: acceptance criteria, output format, min sources, counterpoint requirement
- Cognitive memory APIs: remember/extract/recall/forget/tree + stats/metrics

## Structure
- `apps/mission-control-lite/` static UI (public/admin)
- `convex/` backend schema + functions + HTTP routes
- `scripts/research_agent_cycle.py` memory-aware research loop
- `scripts/memory_metrics_report.py` memory KPI report

## Deploy backend (Convex)
Use deterministic SSM -> Convex env hydration, then deploy:

```bash
python3 /home/ubuntu/clawd/scripts/deploy_mission_control.py
```

This script pulls both `/clawd/CONVEX_DEPLOY_KEY` and `/clawd/MISSION_CONTROL_ADMIN_KEY` from SSM,
sets `MISSION_CONTROL_ADMIN_KEY` in Convex env, then deploys.

## Deploy frontend (Cloudflare Pages)
Deploy only `apps/mission-control-lite` folder.

## Research-agent pilot loop

Required env:
- `MISSION_CONTROL_ADMIN_KEY`
- optional `MISSION_CONTROL_BASE` (defaults to current Convex .site URL)
- optional `MISSION_CONTROL_MEMORY_SCOPE` (default `research`)

Run:

```bash
python3 scripts/research_agent_cycle.py
```

## Memory metrics

```bash
python3 scripts/memory_metrics_report.py
```

## Security note
Current admin gating uses `x-admin-key` in HTTP routes.

Important hardening:
- Placeholder admin keys are rejected.
- If runtime key is missing, protected routes return `503 admin key not configured in runtime`.
- Health endpoint: `GET /mission-control/health/auth-config` (200 when configured, 503 otherwise).
