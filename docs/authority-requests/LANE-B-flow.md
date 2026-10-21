<!-- //TR: Lane B yetki talebi: proje akış durumu route kaydı için server.ts yaması ve test kanıtı -->
# LANE-B-flow: register project flow route in server.ts (protected)

Why: `server.ts` is trust-root sealed. `GET /v1/projects/:id/flow` (routes/flow.ts) gives the Desktop one honest read of the first-delivery flow (MISSION, PLAN, RUN, REVIEW, DELIVERY: NOT_STARTED / ACTIVE / DONE / BLOCKED / FAILED / UNKNOWN) derived only from Work OS records. REVIEW is DONE only for a SUCCEEDED run (that write already requires the CLEAN review gate); DELIVERY is DONE only with a run `completion` record. The Electron GET allow-list (main.mjs) needs `/v1/projects/prj_<24hex>/flow` (Lane A / Founder).

## Patch (server.ts)
```diff
+import {registerFlowRoutes} from "./routes/flow.js";
@@ after the /v1/projects/:id/devrun routes
+registerFlowRoutes(app,{getStore,scope,orgId,actor,audit,workosStopped,workosPolicy,workosFail});
```
(`routes/deps.ts` is identical to the one in LANE-B-intake / LANE-B-plan.)

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 16 passed (4 new "LANE-B project flow"). Mutation (REVIEW DONE -> ACTIVE) made 1 test fail.
Errors: 400 INVALID_PROJECT_ID, 403 FORBIDDEN, 404 WORKOS_NOT_FOUND (unknown or other tenant), 500 INTERNAL_ERROR via workosFail.
