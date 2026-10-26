<!-- //TR: Lane A yetki talebi: proje koşu-hazırlık okuması GET /v1/projects/:id/readiness için main.mjs allow-list yaması ve server.ts kaydı / Lane A authority request: main.mjs GET allow-list entry and server.ts registration for run readiness -->
> **STATUS: APPLIED in #225 @7f6591c.** Nothing is requested any more; the rest of this file is kept as the record of what was asked.
> - `apps/desktop/main.mjs` @7f6591c: `PROJECT_READINESS_RE` line 64, in `FIRST_DELIVERY_GET_RES` line 65 (GET only).
> - `apps/control-api/src/server.ts` @7f6591c: `registerReadinessRoutes(app,laneDeps)` line 263 (import line 72).
> - Test pins @7f6591c: `tests/v7-b5-work-screens.test.ts` describe "COORD first-delivery Desktop allow-list (main.mjs)" line 1622: `GETS` (line 1627) contains `/v1/projects/${PRJ}/readiness`; near-miss and wrong-method checks at line 1636; `/readiness/x` is refused for GET and POST.
> - Renderer side (this chain): `readinessPath` / `mapRunReadiness` in `project-core.js`, `views/run-readiness.js`; the path it requests is exactly `/v1/projects/prj_<24hex>/readiness` without query.

# LANE-A-readiness-allowlist: allow `GET /v1/projects/prj_<24hex>/readiness` in the desktop (protected)

Why: after the Desktop intake creates a project, the Founder must see whether the first run can start, or exactly why not (Lane B `GET /v1/projects/:id/readiness`, `apps/control-api/src/routes/readiness.ts`, contract in `LANE-B-run-readiness.md`). Two protected places block it today, so the renderer shows an honest `UNAVAILABLE` ("not available to the desktop yet… this does not mean the project is ready") and never a green state:

1. `apps/control-api/src/server.ts` does not register the route (the route file exists in the base; `registerReadinessRoutes` has no caller). Patch from `LANE-B-run-readiness.md`:
```diff
+import {registerReadinessRoutes} from "./routes/readiness.js";
@@ after registerFlowRoutes(app,laneDeps);
+registerReadinessRoutes(app,laneDeps);
```
2. `apps/desktop/main.mjs` GET allow-list (first-delivery block). If `LANE-A-run-tasks-allowlist.md` is applied first, extend its line; the two changes are independent:
```diff
+const PROJECT_READINESS_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/readiness$/;
-const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE,TASK_RUNS_RE];
+const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE,TASK_RUNS_RE,PROJECT_READINESS_RE];
```
The pattern is anchored: no query, no trailing slash, no extra segment, GET only. `config/trust-root-manifest.json` needs the usual reseal for `main.mjs` and `server.ts`.

## Tests that prove it (protected-batch cases)
- `/v1/projects/prj_<24hex>/readiness` is allowed; with any query, trailing slash, `/readiness/x`, a malformed project id (`prj_zz`, uppercase hex, 23 or 25 hex), or a non-GET method it is rejected; `/v1/projects/prj_<24hex>/flow` stays allowed.
- Renderer side is tested in the LANE-A PR: strict `mapRunReadiness` (fixed check order and state vocabulary, `ready`/`verifiable` must match the checks or the whole read is ERROR), another project's answer is rejected, UNAVAILABLE/ERROR never render a ready state.
