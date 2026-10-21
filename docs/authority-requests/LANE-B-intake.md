<!-- //TR: Lane B yetki talebi: proje intake route kaydı için server.ts yaması ve test kanıtı -->
# LANE-B-intake: register intake routes in server.ts (protected)

Why: `apps/control-api/src/server.ts` is trust-root sealed. The intake routes live in `apps/control-api/src/routes/intake.ts`; they need one registration call. Consumer screen: UI-126 Project Intake (SCREEN_AUDIT_252). The Electron GET/POST allow-lists (apps/desktop/main.mjs) must also allow `/v1/intakes` and `/v1/intakes/itk_<24hex>` (GET) and `/v1/intakes` (POST, body <= 64 KiB) before the renderer can call them; Lane A needs that bridge entry, which is also protected.

## Patch (server.ts)
```diff
+import {registerIntakeRoutes} from "./routes/intake.js";
@@ after the /v1/missions/:id/transition route
+registerIntakeRoutes(app,{getStore,scope,orgId,actor,audit,workosStopped,workosPolicy,workosFail});
```

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 17 passed (5 new, "LANE-B project intake": create, idempotent replay + 409 conflict, validation/token/423/403/tenant isolation, crash-resume, corrupt file 503). Mutation (drop idempotency conflict check) made 1 test fail.
Error codes: 400 INVALID_BODY / INVALID_INTAKE_ID, 403 FORBIDDEN / ACTION_DENIED, 404 INTAKE_NOT_FOUND, 409 INTAKE_IDEMPOTENCY_CONFLICT, 423 GLOBAL_STOP_ACTIVE, 503 INTAKE_STORE_CORRUPT.
