<!-- //TR: Koordinatör yetki paketi: ilk teslim akışının (fikir -> proje -> plan -> görev durumu -> akış) route kayıtlarını ve masaüstü allow-list girdilerini tek Founder kararında toplar. -->
# COORD-FIRST-DELIVERY-WIRING: one Founder decision that turns the first-delivery chain on in the app

**Status:** APPROVED IN PRINCIPLE by the Founder (2026-10-21) and APPLIED on branch `claude/coord-first-delivery-wiring` for independent review. Not merged. Both files are protected: `apps/control-api/src/server.ts` (trust-root sealed) and `apps/desktop/main.mjs`.

**Scope of the approval:** the route registrations below, the Desktop allow-list entries, the trust-root reseal they require, and their tests. Nothing else in a protected file.

**Corrections made against the code before applying (Founder instruction):**
1. Two GET routes served by the modules were missing from the Desktop allow-list: `/v1/intakes/:id` (`itk_` + 24 hex) and `/v1/tasks/:id` (`tsk_` + 24 hex). Both are now admitted by exact, anchored patterns.
2. Body limit: the server's global Fastify `bodyLimit` is 64 KB, but the Desktop bridge caps POST bodies at 32 KB. The three new write routes now carry a per-route `bodyLimit` of 32 KB (`LANE_WRITE_BODY_LIMIT` in `routes/deps.ts`). A test pins it equal to `POST_MAX_BODY_BYTES` in `main.mjs`. The global 64 KB limit is unchanged for existing routes.

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
+const INTAKE_DETAIL_RE=/^\/v1\/intakes\/itk_[0-9a-f]{24}$/;
+const MISSION_TASKS_RE=/^\/v1\/missions\/msn_[0-9a-f]{24}\/tasks$/;
+const PROJECT_FLOW_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/flow$/;
+const TASK_DETAIL_RE=/^\/v1\/tasks\/tsk_[0-9a-f]{24}$/;
+const FIRST_DELIVERY_GET_RES=[INTAKES_LIST_RE,INTAKE_DETAIL_RE,MISSION_TASKS_RE,PROJECT_FLOW_RE,TASK_DETAIL_RE];
@@ function desktopExtraGetPathAllowed(value): the return chain gains
+||FIRST_DELIVERY_GET_RES.some(re=>re.test(value))
 // B5-POST-ALLOWLIST-BEGIN
-const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,
+const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/intakes$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/plan$/,/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/transition$/,
```

- **Body limit:** 32 KB on both sides for all three new writes (Desktop bridge `POST_MAX_BODY_BYTES`, server per-route `bodyLimit`).
- **Unchanged:** `EXTRA_GET_ROUTES` does not grow; no query string, trailing slash, extra segment, other prefix or case is admitted.
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

## 4. Applied evidence (branch `claude/coord-first-delivery-wiring`)

- `tests/v7-b1-workos.test.ts` "COORD first-delivery wiring through the real server": the whole chain over HTTP through the real `buildServer` (intake, plan, tasks, dependency-gated task status, flow, reads, audit); token 403, Host 421, Global Stop 423 on every write while reads are served, policy 403, tenant isolation 404, nothing written on refusal; 413 above 32 KB on the three writes.
- `tests/v7-b5-work-screens.test.ts` "COORD first-delivery Desktop allow-list": the 5 reads and 3 writes are admitted exactly; 12 near-miss shapes per path and wrong-method use are refused; the renderer's own paths pass.
- Real Electron end-to-end (Linux, `scripts/e2e-first-delivery-electron.mjs`, 3 consecutive runs PASS 12/12): the real Control API (`server.ts`) and the real Electron app (`main.mjs`, preload, renderer, Electron 44.4.5 provisioned and checksum-verified by `scripts/provision-electron.mjs` after a verified `ensure-dependencies` install). The app runs as a non-root user, so the Chromium sandbox stays on. The renderer is driven over CDP:
  - the main process proves the Control API identity (forced challenge-proof);
  - intake, intake reads, plan, mission tasks, the dependency gate (409), task 1 PENDING→IN_PROGRESS→DONE, task 2 start, task and flow reads, all through the real preload bridge, IPC, `main.mjs` allow-list and token;
  - the bridge refuses near misses, wrong method and a body over 32 KB before any HTTP call;
  - UI: Görevler (`#/work`) shows the mission, the tasks and the task status panel with exactly the allowed targets, and a real click on "Mark as Done" moves task 2 to DONE.
- NOT_EXECUTED here: Windows Electron (no Windows host in this environment). Linux and Windows unit/integration tests run in CI on the PR.
- `config/trust-root-manifest.json` resealed: only the two hashes for `server.ts` and `main.mjs` (and `generatedAt`) change; `verify-trust-root` PASS.

## 5. Founder decision

Approved in principle on 2026-10-21. The PR goes to the Independent Review; if the review fails it is not merged. Merging stays with the Founder.
