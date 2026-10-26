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
