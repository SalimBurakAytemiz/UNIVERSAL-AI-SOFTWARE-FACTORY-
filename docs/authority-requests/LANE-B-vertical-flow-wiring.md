<!-- //TR: Lane B yetki talebi (toplu): 31 Ekim dikey akışı için hâlâ kayıtsız Lane B route'ları ve Electron izin listesi yolları; fe08022 üzerinde grep ile doğrulandı -->
# LANE-B-vertical-flow-wiring: what the protected batch still has to register for the 31 Oct flow (verified by grep on fe08022)

Registered in server.ts today: Attention, ErrorContract, Flow, Intake, Knowledge, Memory, Plan, Task, TaskRun. Merged but NOT registered, each needed by the flow screens (idea -> project -> plan -> run -> delivery result). Exact diffs live in the per-slug docs; this is the single list.

| Route module | Endpoint | Why the flow needs it | Per-slug doc |
|---|---|---|---|
| routes/readiness.ts `registerReadinessRoutes` | GET /v1/projects/prj_<24hex>/readiness | "why can't the first run start" before pressing Run | LANE-B-run-readiness.md |
| routes/run-summaries.ts `registerRunSummaryRoutes` | GET /v1/run-summaries (query: projectId, missionId, status, limit, cursor) | run list with the sandbox test and delivery state in Founder terms | LANE-B-run-summaries.md |
| routes/predev-decisions.ts `registerPredevDecisionRoutes` | POST /v1/missions/msn_<24hex>/predev/{start,artifacts/pda_<24hex>/approve\|reject} | pre-dev approval step (batch 3b, PR #199) | LANE-B-predev-decisions.md |
| task-outcome interval (inside the runner `if(runnerEnabled){...}` block) | n/a (server hook) | task status follows the run result without a manual reconcile | LANE-B-task-outcomes.md |

## Registration diff (server.ts, next to the other lane registrations)
```diff
+import {registerReadinessRoutes} from "./routes/readiness.js";
+import {registerRunSummaryRoutes} from "./routes/run-summaries.js";
+registerReadinessRoutes(app,laneDeps);
+registerRunSummaryRoutes(app,laneDeps);
```
(`registerPredevDecisionRoutes` is in PR #199.) Optional one-instance studio for the intake template (LANE-B-intake-template.md): add `studio:getStudio` to `laneDeps`.

## Electron allow-list (apps/desktop/main.mjs), GET unless noted, anchored, no extra query keys
- `/v1/projects/prj_<24hex>/readiness` (no query)
- `/v1/run-summaries` with the optional fixed-order query `projectId, missionId, status, limit, cursor` (see LANE-B-run-summaries.md for the exact pattern and the 1..100 limit)
- `/v1/work-runs/run_<24hex>/tasks` (reverse task-run read)
- POST `/v1/work-runs/run_<24hex>/tasks/reconcile` (empty body)

## Evidence
Registered set read from `grep -o "register[A-Za-z]*Routes(" apps/control-api/src/server.ts` on fe08022; route tests: `tests/v7-b1-workos.test.ts` blocks "LANE-B run readiness", "LANE-B run summaries", "LANE-B task outcome reconcile". Not verified here: the main.mjs patterns themselves (take them from the per-slug docs).

## B-FLOW-3: verified on v7/integration (grep) and the exact desktop allow-list diff
- `GET /v1/work-runs/:id/tasks` EXISTS (routes/task-runs.ts:27) and IS registered (server.ts:255 `registerTaskRunRoutes(app,laneDeps)`). Server side needs nothing.
- main.mjs does NOT allow it: `WORK_RUN_DETAIL_RE` matches only `/v1/work-runs/<id>` and `DELIVERY_DETAIL_RE` only `/delivery`, so Lane A's run-card task list would be refused by `desktopExtraGetPathAllowed`. `/v1/projects/prj_*/readiness` and `/v1/run-summaries` are also absent.
```diff
 const TASK_RUNS_RE=/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/runs$/;
+const WORK_RUN_TASKS_RE=/^\/v1\/work-runs\/run_[0-9a-f]{24}\/tasks$/;
+const PROJECT_READINESS_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/readiness$/;
-const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE,TASK_RUNS_RE];
+const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE,TASK_RUNS_RE,WORK_RUN_TASKS_RE,PROJECT_READINESS_RE];
 // POST_ROUTE_RES (exact-anchored, empty body), add:
+/^\/v1\/work-runs\/run_[0-9a-f]{24}\/tasks\/reconcile$/
```
Run ids are `run_` + 24 hex (same shape as `DELIVERY_DETAIL_RE`). `/v1/run-summaries` needs `listQueryAllowed(value,"/v1/run-summaries",["projectId","missionId","status","limit","cursor"])` plus `QUERY_RULES` entries `projectId:/^prj_[0-9a-f]{24}$/` and `status:/^[A-Z][A-Z_]{0,39}$/` (`missionId`, `limit`, `cursor` rules already exist). Not executed here: main.mjs is protected; patterns untested against the desktop test.
