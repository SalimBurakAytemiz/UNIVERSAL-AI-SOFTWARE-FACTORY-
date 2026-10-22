<!-- //TR: Lane B yetki talebi: Work OS tabanlı Founder dikkat kuyruğu route kaydı için server.ts yaması ve Electron izin listesi yolu -->
# LANE-B-attention-api: Founder attention queue from Work OS (protected registration + Desktop path)

Gap (FRONTEND_BACKEND_MATRIX G-FB-003 / G-FB-048): `GET /v1/founder-attention` derives its list from the retired scheduler state, so it is empty or REJECTED in the packaged runtime while 7 views depend on it. The real "what needs the Founder" signal already lives in the Work OS journal. `routes/attention.ts` + `core/workos/attention.ts` derive it from there; nothing is stored and nothing is invented.

`GET /v1/attention` -> `{attention:{items, counts, truncated, source:"WORKOS"}}`. Each item: `kind`, `nextAction`, `projectId`, `missionId`, `runId|null`, `taskId|null`, `title`, `reason` (secret-redacted, <= 300 chars), `since` (run `updatedAt`, mission `createdAt` where that is the only known time, else null).

| kind | source | nextAction |
|---|---|---|
| RUN_AWAITING_APPROVAL | latest run of a live mission is AWAITING_APPROVAL and no source delivery is accepted yet | PREPARE_DELIVERY (no artifact) / ACCEPT_DELIVERY (artifact prepared) |
| MISSION_FOUNDER_ATTENTION | mission FOUNDER_ATTENTION_REQUIRED | REVIEW_MISSION |
| RUN_NEEDS_DECISION | latest run FAILED / RECOVERY_FAILED / QUARANTINED / BLOCKED | REVIEW_RUN |
| MISSION_AUTHORIZATION_PENDING | mission PREFLIGHT | AUTHORIZE_MISSION |
| MISSION_BLOCKED | mission BLOCKED | REVIEW_MISSION |
| TASK_BLOCKED | task BLOCKED in a live mission | UNBLOCK_TASK |

Rules: COMPLETE missions never appear; only the LATEST run of each mission counts (an old failed run does not nag once a newer run exists); items are ordered by severity then newest; at most 200 items (`truncated:true`, `counts` still count everything); tenant scoped; read-only (no write gate needed).

## Patch (server.ts, next to the other lane registrations)
```diff
+import {registerAttentionRoutes} from "./routes/attention.js";
@@ after registerTaskRunRoutes(app,laneDeps);
+registerAttentionRoutes(app,laneDeps);
```
## Electron allow-list (apps/desktop/main.mjs, protected; Lane A / coordinator)
GET `/v1/attention` (no query). The renderer views that read `/v1/founder-attention` should move to this path (Lane A); the legacy route is left untouched.

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 70 passed (4 new "LANE-B founder attention queue": empty state, every kind in severity order with next actions and secret redaction, latest-run rule and delivery state, COMPLETE missions excluded, 200-item cap, token, tenant isolation, POST 404). Mutations (count every run; keep accepted deliveries; skip redaction; keep COMPLETE missions' tasks; keep COMPLETE missions' runs) each made a test fail. A first mutant (COMPLETE missions kept) survived until I added the COMPLETE test.
Honest limit: AWAITING_APPROVAL with an accepted delivery, and COMPLETE missions, are exercised through a store view (a real COMPLETE or accepted delivery needs the full evidence gate covered by the runner/delivery suites).
