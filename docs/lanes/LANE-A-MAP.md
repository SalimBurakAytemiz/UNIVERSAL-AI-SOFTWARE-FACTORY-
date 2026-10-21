<!-- //TR: Lane A (Frontend/UX/Desktop) kisa harita: ilk teslim akisi adimlari, durum ve siradaki isler / Lane A short map: first-delivery flow steps, status, next items -->
# LANE-A map (Frontend / UX / Desktop)

Owner files: `apps/desktop/renderer/{views,*-core,components,forms,...}`, locales en/tr, renderer tests. Data sources: `docs/inventory/2026-10-19/{FRONTEND_BACKEND_MATRIX,SCREEN_AUDIT_252}.md`.

## First-delivery flow (Desktop half)

| Step | Screen | Real endpoint | State |
|---|---|---|---|
| Open app / first run | `firstrun.js`, `home.js` | GET /v1/cockpit | existing |
| Create project | `studio-wizard.js` | POST /v1/projects | existing |
| Founder idea -> first mission | `studio-wizard.js` `ideaPanel` | POST /v1/missions | **LANE-A slug `idea-first-mission`** |
| Mission plan / tasks | `work.js` detail | GET /v1/missions/:id (`tasks`) | honest "no tasks yet" note added; task producer = runner only |
| Run + events/logs | `work.js`, `studio-workspace.js` | POST /v1/missions/:id/runs, GET /v1/work-runs | existing; needs executor + sandbox (409 otherwise) |
| Delivery prepare/accept/export | `delivery-panel.js` | POST /v1/work-runs/:id/delivery/{prepare,accept,export} | existing; export is IPC (main.mjs, protected) |

## Known gaps (not Lane A)

- No API creates planned tasks for a mission before a run (tasks are written by the runner). LANE-B-REQUEST filed in the PR body.
- `GET /v1/predev/:missionId` always NOT_STARTED (no producer).
- `devrun/start|restart` are 409 without a sandbox (authority required).

## Next

PQ-012, then PQ-003/PQ-004 (base claude/ui-105), PQ-005; next-weakest journey step: run monitoring.
