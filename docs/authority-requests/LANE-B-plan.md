# LANE-B-plan: register mission plan routes in server.ts (protected)

Why: `server.ts` is trust-root sealed; no HTTP route could create tasks even though `WorkOsStore.createTask` exists, so "tasks are planned" had no API. Routes live in `apps/control-api/src/routes/plan.ts` (`POST /v1/missions/:id/plan`, `GET /v1/missions/:id/tasks`). Desktop `main.mjs` GET/POST allow-lists also need these two paths (Lane A / Founder).

## Patch (server.ts)
```diff
+import {registerPlanRoutes} from "./routes/plan.js";
@@ after the /v1/missions/:id/transition route
+registerPlanRoutes(app,{getStore,scope,orgId,actor,audit,workosStopped,workosPolicy,workosFail});
```
(`routes/deps.ts` is shared with LANE-B-intake; identical content.)

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 16 passed (4 new "LANE-B mission task plan"). Mutation (drop forward-dependency check) made tests fail.
Errors: 400 INVALID_BODY/INVALID_MISSION_ID, 403 FORBIDDEN/ACTION_DENIED, 404 PLAN_MISSION_NOT_FOUND/WORKOS_NOT_FOUND, 409 PLAN_ALREADY_EXISTS/MISSION_NOT_PLANNABLE, 423 GLOBAL_STOP_ACTIVE, 503 PLAN_STORE_CORRUPT.
Known gap: task status updates need a store method (core/workos/store.ts is forbidden to Lane B); a store-owner request is needed for PENDING->IN_PROGRESS->DONE.
