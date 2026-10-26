<!-- //TR: LANE-C yetki talebi: GET /v1/roles/status-summary rota modülü (apps/control-api/src/routes/role-status.ts) korumalı server.ts içinde kayıt gerektirir. -->
# LANE-C authority request: register `GET /v1/roles/status-summary`

## Why
`apps/control-api/src/routes/role-status.ts` (new, coordinator-assigned package C1) serves the role lifecycle summary computed only from evidence (`core/agents/role-lifecycle.ts`). It is not reachable until `server.ts` (protected) registers it. Lane A builds the UI against the shape below.

## Exact patch (apps/control-api/src/server.ts)
```diff
 import {registerTaskRunRoutes} from "./routes/task-runs.js";
+import {registerRoleStatusRoutes} from "./routes/role-status.js";
 ...
 registerTaskRunRoutes(app,laneDeps);
+registerRoleStatusRoutes(app,{...laneDeps,repoRoot});
```
Static `/v1/roles/status-summary` takes precedence over the parametric `/v1/roles/:roleId` (find-my-way matches static segments first); the existing `:roleId` handler keeps rejecting non-`UASCO-NNNN` ids with 400.

## Response (frozen, Lane A depends on it)
```json
{"statusSummary":{"target":599,"registered":599,"implemented":2,"tested":0,"certified":0,"running":0,
 "byGuild":[{"guildId":"G01","registered":8,"implemented":0,"tested":0,"certified":0,"running":0}],
 "computedAt":"ISO-8601","basis":{"roleDefinitionsSha256":"<hex>","bindingsCount":9}}}
```
Counters are independent (no promotion between them):
- registered: role is in `registries/role-definitions.json`.
- implemented: `resolveRoleExecution` is EXECUTABLE AND the route has a production executor (`CLAUDE_IMPLEMENTER` / `CLAUDE_REVIEWER`) AND a run stage consumes that binding function (`STAGE_CONSUMERS` in `core/agents/first-delivery-bindings.ts`).
- tested: at least one evaluation spec that is not `NOT_EXECUTED` AND whose evidence ref verifies (format, file inside `audit/evidence/role-evaluations`, sha256, content names role/evaluation/verdict, artifact hash, not FAKE).
- certified: the same rule as `scripts/validate-role-registry.mjs` (CERTIFIED + scope + evaluator refs + REVIEWER/APPROVED evidence + six verified PASSED specs + unexpired).
- running: an `AGENT_TRACE` evidence exists in a non-terminal run of the tenant (registered role ids only).
Errors: `503 ROLE_REGISTRY_UNAVAILABLE` when the registry file is missing/invalid (no number is invented); store errors go through `workosFail`.

## Tests that prove it
`tests/v7-wfr03-role-registry.test.ts`, describe "LANE-C C1 role lifecycle computed only from evidence" (registers the route on a bare Fastify app, so it needs no server.ts change to be tested).
