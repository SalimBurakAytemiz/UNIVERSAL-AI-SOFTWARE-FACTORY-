<!-- //TR: Koordinatör yetki paketi: ilk teslim akışının (fikir -> proje -> plan -> görev durumu -> akış) route kayıtlarını ve masaüstü allow-list girdilerini tek Founder kararında toplar. -->
# COORD-FIRST-DELIVERY-WIRING: one Founder decision that turns the first-delivery chain on in the app

**Status:** request only. Nothing here is applied. Both files are protected: `apps/control-api/src/server.ts` (trust-root sealed) and `apps/desktop/main.mjs`.

**Replaces:** LANE-B-intake.md, LANE-B-plan.md, LANE-B-flow.md and LANE-A-intake-allowlist.md, plus the task-status route.

**What it enables:** without these lines, the route modules, the store API and the Desktop panels exist but are unreachable. The Desktop shows honest refusals and UNAVAILABLE states.

**Code these lines connect:**
- `apps/control-api/src/routes/intake.ts` (claude/lane-b-intake)
- `apps/control-api/src/routes/plan.ts` (claude/lane-b-plan)
- `apps/control-api/src/routes/flow.ts` (claude/lane-b-flow)
- `apps/control-api/src/routes/tasks.ts` (claude/lane-b-task-routes, in progress, on top of claude/coord-task-status)
- `apps/control-api/src/routes/deps.ts` (identical in all of them)

These are integrated together on claude/coord-integration-l1.

## 1. apps/control-api/src/server.ts

```diff
+import {registerIntakeRoutes} from "./routes/intake.js";
+import {registerPlanRoutes} from "./routes/plan.js";
+import {registerFlowRoutes} from "./routes/flow.js";
+import {registerTaskRoutes} from "./routes/tasks.js";
@@ directly after the app.post("/v1/missions/:id/transition", ...) route
+const laneDeps={getStore,scope,orgId,actor,audit,workosStopped,workosPolicy,workosFail};
+registerIntakeRoutes(app,laneDeps);
+registerPlanRoutes(app,laneDeps);
+registerFlowRoutes(app,laneDeps);
+registerTaskRoutes(app,laneDeps);
```

Every write route keeps the existing gates: control token, Global Stop 423, action-gateway policy 403, tenant scope and audit.

**After applying:** reseal the trust root with `node scripts/generate-trust-root.mjs`, then check it with `node scripts/verify-trust-root.mjs`. The seal changes only because `server.ts` changed.

## 2. apps/desktop/main.mjs (B4/B5 allow-lists)

```diff
 // B4-ALLOWLIST-BEGIN
+const INTAKES_LIST_RE=/^\/v1\/intakes$/;
+const MISSION_TASKS_RE=/^\/v1\/missions\/msn_[0-9a-f]{24}\/tasks$/;
+const PROJECT_FLOW_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/flow$/;
@@ function desktopExtraGetPathAllowed(value): extend the final return chain with
+||INTAKES_LIST_RE.test(value)||MISSION_TASKS_RE.test(value)||PROJECT_FLOW_RE.test(value)
 // B5-POST-ALLOWLIST-BEGIN
-const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,
+const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/intakes$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/plan$/,/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/transition$/,
```

- **Body limit:** the existing 32 KB POST limit applies to all three new writes.
- **Unchanged:** no new IPC channel, no storage, and the token stays in the main process.

## 3. Evidence (Linux; Windows and Electron NOT_EXECUTED here)

| Link | Proving tests |
|---|---|
| Intake: idea → project + first mission | `tests/v7-b1-workos.test.ts` "LANE-B project intake" (create, replay, 409 conflict, 400/403/423, tenant isolation, crash-resume, corrupt store 503) |
| Plan: ordered tasks with dependencies | `tests/v7-b1-workos.test.ts` "LANE-B mission task plan" (forward dependencies refused, one plan per mission, idempotent replay) |
| Task status: PENDING → IN_PROGRESS → DONE / BLOCKED | `tests/v7-b1-workos.test.ts` task status transitions (claude/coord-task-status d72159d: dependency gate, completed-mission freeze, replay; forged entries are tamper) |
| Flow read model | `tests/v7-b1-workos.test.ts` flow tests (claude/lane-b-flow) |
| Desktop allow-list shape (exact paths accepted, near-misses refused) | `tests/v7-ps1b-project-studio-ui.test.ts` (claude/lane-a-intake-ui), to be extended to the plan, tasks and flow paths when this is applied |
| Cross-lane chain through the real modules | claude/coord-integration-l1 end-to-end test |

## 4. Founder decision

Reply **"COORD-FIRST-DELIVERY-WIRING onaylıyorum"**. An agent then applies exactly these lines on a separate authority branch, reseals the trust root, runs the suite, and opens a PR for the Independent Review. Merging stays with the Founder.
