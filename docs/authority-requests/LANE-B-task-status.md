<!-- //TR: Lane B yetki talebi: görev durum geçişi route kaydı için server.ts yaması (store değişikliği koordinatör tarafından yapıldı) -->
# LANE-B-task-status: register task transition routes in server.ts (protected)

Store side: implemented by the coordinator on `claude/coord-task-status` (`transitionTask`, `getTask`, `TASK_TRANSITIONS`, `TASK_TRANSITIONED` journal event). This branch (`claude/lane-b-task-routes`) builds on it.

Why: `server.ts` is trust-root sealed; the HTTP surface for task status lives in `apps/control-api/src/routes/tasks.ts`: `POST /v1/tasks/:id/transition` (strict body `{to, reason}`) and `GET /v1/tasks/:id`. Consumer screens: task board / mission detail (SCREEN_AUDIT_252 task screens), flow PLAN stage. The Electron allow-lists (main.mjs) need `/v1/tasks/tsk_<24hex>` (GET) and `/v1/tasks/tsk_<24hex>/transition` (POST, body <= 64 KiB) (Lane A / Founder).

## Patch (server.ts)
```diff
+import {registerTaskRoutes} from "./routes/tasks.js";
@@ after the /v1/missions/:id/transition route
+registerTaskRoutes(app,{getStore,scope,orgId,actor,audit,workosStopped,workosPolicy,workosFail});
```
(`routes/deps.ts` is identical to the one in the intake/plan/flow requests.)

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 18 passed (3 new "LANE-B task transition routes": chain + dependency gate + restart, illegal/strict-body/id/404, token/423/403/tenant isolation with task unchanged). Mutation (drop the Global Stop check) made a test fail.
Errors via the existing `workosFail`: 400 INVALID_TASK_ID / INVALID_BODY / WORKOS_INVALID_INPUT, 403 FORBIDDEN / ACTION_DENIED, 404 WORKOS_NOT_FOUND, 409 WORKOS_INVALID_TRANSITION / WORKOS_CONFLICT, 423 GLOBAL_STOP_ACTIVE.
