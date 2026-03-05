# Mission Control Lite

Lightweight taskboard with lane isolation:
- Lanes: research, finance, sports, ops
- Status flow: backlog -> in_progress -> review -> done
- Only `main-orchestrator` can mark done
- Public read-only view + Admin view split
- L3 research contract fields: acceptance criteria, output format, min sources, counterpoint requirement

## Structure
- `apps/mission-control-lite/` static UI (public/admin)
- `convex/` backend schema + functions + HTTP routes

## Deploy backend (Convex)
Set `CONVEX_DEPLOY_KEY` in env (from secure store), then:

```bash
npx convex deploy --yes --preview-create mission-control-lite
```

## Deploy frontend (Cloudflare Pages)
Deploy only `apps/mission-control-lite` folder.

## Research-agent pilot loop

A starter loop script is included at:
- `scripts/research_agent_cycle.py`

Required env:
- `MISSION_CONTROL_ADMIN_KEY`
- optional `MISSION_CONTROL_BASE` (defaults to current Convex .site URL)

Run:

```bash
python3 scripts/research_agent_cycle.py
```

## Security note
Current admin gating uses `x-admin-key` in HTTP routes.
Set `MISSION_CONTROL_ADMIN_KEY` in Convex env for production.
