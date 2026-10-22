<!-- //TR: Lane A yetki talebi: görev-koşu bağı rotalarını masaüstü GET/POST allow-list'ine ekleyen main.mjs yaması ve kanıtı / Lane A authority request: main.mjs patch adding the task-run link routes to the desktop GET and POST allow-lists -->
# LANE-A-task-runs-allowlist: allow `GET|POST /v1/tasks/:id/runs` in the desktop main process (protected)

Why: `apps/desktop/main.mjs` is protected. The task inspector in Tasks now has a "Runs for this task" section (`views/task-runs.js`) that reads `GET /v1/tasks/tsk_<24 hex>/runs` and links a run of the same mission with `POST /v1/tasks/tsk_<24 hex>/runs` body `{runId}` (Lane B: `claude/lane-b-task-run-link`; `server.ts` registration requested in `docs/authority-requests/LANE-B-task-run-link.md`). The flow stepper also shows Lane B's `taskRuns` summary from the already admitted `GET /v1/projects/:id/flow`. Until both this allow-list and Lane B's registration are applied the bridge refuses the calls: the section shows an honest "cannot be read" note and offers no link action. No new IPC or storage. `GET /v1/work-runs/:id/tasks` is not used by the renderer and is deliberately not requested.

## Patch (apps/desktop/main.mjs, style of COORD-FIRST-DELIVERY-WIRING)
```diff
 const TASK_DETAIL_RE=/^\/v1\/tasks\/tsk_[0-9a-f]{24}$/;
+const TASK_RUNS_RE=/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/runs$/;
-const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE];
+const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE,TASK_RUNS_RE];
@@ POST_ROUTE_RES (first-delivery block)
-  /^\/v1\/intakes$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/plan$/,/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/transition$/];
+  /^\/v1\/intakes$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/plan$/,/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/transition$/,/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/runs$/];
```
The renderer body is `{runId}` (about 40 bytes), far below the 32 KB bridge cap; Lane B's route also needs the per-route 32 KB `LANE_WRITE_BODY_LIMIT` (already applied in its `routes/task-runs.ts`).

## Tests that prove it (tests/v7-b5-work-screens.test.ts, first-delivery allow-list describe)
- `/v1/tasks/tsk_<24 hex>/runs` allowed for GET and POST; with a query, trailing slash, extra segment, wrong id length/charset, `/v1/tasks/tsk_x/runs`, and the other method (e.g. PUT, or POST on a GET-only path) rejected, using the same 12-near-miss set as the other first-delivery paths.
- Renderer side, tested in this PR: strict `mapTaskRuns`, `linkableRuns`, `buildLinkRunRequest` (`{runId}` only, no link to a done task), no request until the button is pressed, honest refusal states, flow `taskRuns` summary (absent = hidden, null = unknown, impossible ratio = unknown).
