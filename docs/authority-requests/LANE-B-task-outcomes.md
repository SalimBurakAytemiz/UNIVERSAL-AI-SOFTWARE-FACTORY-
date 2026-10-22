<!-- //TR: Lane B yetki talebi: görev sonucunun koşudan türetilmesi için server.ts uzlaştırma döngüsü yaması -->
# LANE-B-task-outcomes: record the run result on the task (protected hook needed)

Gap: a task linked to a run (PR #151) never changed status unless someone flipped it by hand. Now the status comes from the run's own result, through the store's public `transitionTask` only (no new storage).

## What is in this change (no server.ts edit needed for the route)
- `core/workos/task-outcome.ts`: `reconcileRunTasks(store, scope, actor, runId)` and `reconcileAllLinkedTasks(store, scope, actor)`.
- `POST /v1/work-runs/:id/tasks/reconcile` in `routes/task-runs.ts` (already registered by `registerTaskRunRoutes`): empty body only (a client cannot send a status), Global Stop 423, policy 403, tenant scope, audit `WORKOS_TASK_OUTCOME_RECORDED` per transition. Consumer: task board / run detail.

## Mapping (single source: the run status; nothing is guessed)
| Run status | Task target |
|---|---|
| SUCCEEDED | DONE (via IN_PROGRESS, dependency order) |
| FAILED, RECOVERY_FAILED, CANCELLED, QUARANTINED, BLOCKED | BLOCKED |
| CREATED, QUEUED | unchanged (not started) |
| every other status (LEASED, RUNNING, VERIFYING, CHECKPOINTING, RETRY_SCHEDULED, DEGRADED, RECOVERING, HANDOFF_PENDING, AWAITING_APPROVAL, CANCELLING) | IN_PROGRESS |

Rules: DONE never regresses; a task is governed by the run it was LAST linked to (an older run's result is reported `SKIPPED/SUPERSEDED_BY_NEWER_RUN`); a BLOCKED task re-enters via PENDING when a newer run starts; a task whose dependencies are not DONE is `SKIPPED/TASK_DEPENDENCIES_NOT_DONE` and retried in the same pass once they are; a COMPLETE mission freezes its tasks (`SKIPPED/MISSION_COMPLETE`). Running it twice changes nothing the second time.

## Protected hook (server.ts): make it automatic
The runner has no event hook and runs on its own interval (Lane C file), so the reconcile is a sibling interval started with the runner. Without it the route above still works on demand.
```diff
+import {reconcileAllLinkedTasks} from "../../../core/workos/task-outcome.js";
@@ inside the existing `if(runnerEnabled){ ... }` block, next to the runner onReady/onClose hooks
+  let outcomeTimer:NodeJS.Timeout|null=null;
+  app.addHook("onReady",async()=>{outcomeTimer=setInterval(()=>{try{for(const r of reconcileAllLinkedTasks(getStore(),scope,actor))audit("WORKOS_TASK_OUTCOME_RECORDED",{actor,kind:"task-outcome",taskId:r.taskId,from:r.from,to:r.to})}catch{/* store salt-okunur/bozuk: sonraki turda yeniden denenir */}},opts.runner?.intervalMs??2000);outcomeTimer.unref?.()});
+  app.addHook("onClose",async()=>{if(outcomeTimer)clearInterval(outcomeTimer)});
```
No Electron change: the route is POST under the existing `/v1/work-runs/run_<24hex>/...` family; if the Desktop should trigger it, allow `POST /v1/work-runs/run_<24hex>/tasks/reconcile` (empty body).

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 55 passed (4 new "LANE-B task outcome reconcile"). Mutations (drop the newer-run rule; SUCCEEDED -> IN_PROGRESS; allow DONE to regress) each made at least 1 test fail.
Honest limit: SUCCEEDED is simulated in tests by a store view (a real SUCCEEDED needs the full evidence gate, covered by the runner/delivery suites); non-terminal and failed states use real store transitions.
