<!-- //TR: Lane A yetki talebi: koşuya bağlı görevleri okuyan GET /v1/work-runs/:id/tasks için main.mjs allow-list yaması / Lane A authority request: main.mjs GET allow-list entry for the tasks linked to a run -->
> **STATUS: APPLIED in #225 @7f6591c.** Nothing is requested any more; the rest of this file is kept as the record of what was asked.
> - `apps/desktop/main.mjs` @7f6591c: `WORK_RUN_TASKS_RE` line 63, in `FIRST_DELIVERY_GET_RES` line 65 (GET only; the reconcile POST stays a separate entry).
> - Test pins @7f6591c: `tests/v7-b5-work-screens.test.ts` line 1627 (`GETS` has `/v1/work-runs/${RUNID}/tasks`), POST of the same path is refused (line 1644), sub-paths and `run_..x` are refused for both methods (line 1645).
> - Renderer side (this chain): `runTasksPath` / `mapRunTasks` in `work-core.js`, `api.runTasks`; it requests exactly `/v1/work-runs/run_<24hex>/tasks` without query.

# LANE-A-run-tasks-allowlist: allow `GET /v1/work-runs/run_<24hex>/tasks` in the desktop main process (protected)

Why: `apps/desktop/main.mjs` is protected. The Work view's run card now shows "Tasks linked to this run" from Lane B's `GET /v1/work-runs/:id/tasks` (`apps/control-api/src/routes/task-runs.ts`, `{links:[TaskRunLink]}`). The path is not in the desktop GET allow-list, so the renderer reports `UNAVAILABLE` ("cannot be read in this build yet") and never claims that no task is linked.

## Patch (apps/desktop/main.mjs, first-delivery GET block)
```diff
+const RUN_TASKS_RE=/^\/v1\/work-runs\/run_[0-9a-f]{24}\/tasks$/;
-const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE,TASK_RUNS_RE];
+const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE,TASK_RUNS_RE,RUN_TASKS_RE];
```
No query is accepted (the pattern is anchored), no new method, no POST. `config/trust-root-manifest.json` needs the usual reseal for `main.mjs`.

## Tests that prove it (protected-batch cases)
- `/v1/work-runs/run_<24hex>/tasks` is allowed; with any query, a trailing slash, `/tasks/extra`, a malformed run id (`run_zz`, uppercase hex, 23 or 25 hex) or a non-GET method it is rejected; `/v1/work-runs/run_<24hex>/tasks/reconcile` stays POST-only.
- Renderer side is tested in the LANE-A PR: strict `mapRunTasks`, `runTasksPath`, honest UNAVAILABLE/ERROR/empty states.
