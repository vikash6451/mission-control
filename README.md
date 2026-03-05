# Mission Control Lite

Lightweight taskboard with lane isolation:
- Lanes: research, finance, sports, ops
- Status flow: backlog -> in_progress -> review -> done
- Only `main-orchestrator` can mark done
- Public read-only view + Admin view split

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

## Security note
Current admin gating uses `x-admin-key` in HTTP routes.
Set `MISSION_CONTROL_ADMIN_KEY` in Convex env for production.
