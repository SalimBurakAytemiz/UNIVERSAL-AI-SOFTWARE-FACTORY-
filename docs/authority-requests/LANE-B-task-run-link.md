<!-- //TR: Lane B yetki talebi: görev-koşu bağı route kaydı için server.ts yaması ve test kanıtı -->
# LANE-B-task-run-link: register task-run link routes in server.ts (protected)

Gap: runs belong to a mission (`POST /v1/missions/:id/runs`), but nothing says which task a run executes. `routes/task-runs.ts` links a task to an existing run of the same mission (`core/workos/task-run-link.ts`, side file `task-run-links.jsonl` with the shared torn-tail reader). The run is still created by the existing mission route (executor and risk gates stay in server.ts).

Endpoints: `POST /v1/tasks/:id/runs` body `{runId}` (201 new / 200 replay), `GET /v1/tasks/:id/runs`, `GET /v1/work-runs/:id/tasks`. Consumer screens: task board and run detail. Electron allow-lists (main.mjs) need these three paths (Lane A / Founder).

## Patch (server.ts, next to the other lane registrations)
```diff
+import {registerTaskRunRoutes} from "./routes/task-runs.js";
@@ after registerTaskRoutes(app,laneDeps);
+registerTaskRunRoutes(app,laneDeps);
```

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 46 passed (3 new "LANE-B task-run link routes"). Mutation (drop the DONE-task refusal) made 1 test fail.
Errors: 400 INVALID_TASK_ID / INVALID_RUN_ID / INVALID_BODY, 403 FORBIDDEN / ACTION_DENIED, 404 TASK_NOT_FOUND / RUN_NOT_FOUND, 409 RUN_MISSION_MISMATCH / TASK_NOT_LINKABLE, 423 GLOBAL_STOP_ACTIVE, 503 LINK_STORE_CORRUPT.
