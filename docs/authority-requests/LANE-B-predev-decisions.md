<!-- //TR: Lane B yetki talebi: pre-dev Founder karar route'ları için server.ts yaması ve Electron izin listesi yolları -->
# LANE-B-predev-decisions: Founder decisions on the pre-dev sequence (protected registration + Desktop paths)

Gap (FRONTEND_BACKEND_MATRIX G-FB-095/096): `GET /v1/predev/:missionId` and `GET /v1/crew/:missionId` only read. Nothing in the product could start a pre-dev sequence or let the Founder approve or reject an agent's draft, so planning could never move past `AUTHORIZED`. The gates already live in the store/driver (independent approver, evidence required, phase order); these routes only expose them and show a refusal as a fixed code. The agent side (producing drafts through a builder port) stays Lane C's.

## Endpoints (`apps/control-api/src/routes/predev-decisions.ts`)
| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/v1/missions/:id/predev/start` | `{}` | 201 opens the sequence and enters BUSINESS_ANALYSIS; 200 `replayed:true` if it exists |
| POST | `/v1/missions/:id/predev/artifacts/:artifactId/approve` | `{evidenceRefs:[1..20 ids]}` | submit (if still DRAFT) -> APPROVED -> next phase; approver is always the server actor |
| POST | `/v1/missions/:id/predev/artifacts/:artifactId/reject` | `{reason}` | REJECTED with the reason; the phase does NOT advance |
All return `{predev: <read model>}`. Gates in order: Global Stop 423, policy 403, strict body 400, mission/artifact lookup (artifact must belong to the mission, other tenant 404). Gate refusals: 409 `{error:"PREDEV_GATE_REFUSED", reason:"PREDEV_APPROVER_NOT_INDEPENDENT" | "PREDEV_APPROVAL_EVIDENCE_REQUIRED" | "PREDEV_PHASE_ARTIFACT_NOT_APPROVED" | ...}`. Audit: `WORKOS_PREDEV_STARTED`, `WORKOS_PREDEV_ARTIFACT_APPROVED`, `WORKOS_PREDEV_ARTIFACT_REJECTED`.

## Patch (server.ts, next to the other lane registrations)
```diff
+import {registerPredevDecisionRoutes} from "./routes/predev-decisions.js";
@@ after registerTaskRunRoutes(app,laneDeps);
+registerPredevDecisionRoutes(app,laneDeps);
```
## Electron allow-list (apps/desktop/main.mjs, protected; POST body <= 32 KiB)
- `/v1/missions/msn_<24hex>/predev/start`
- `/v1/missions/msn_<24hex>/predev/artifacts/pda_<24hex>/approve`
- `/v1/missions/msn_<24hex>/predev/artifacts/pda_<24hex>/reject`

## Lane C finding (not worked around)
After a rejection, the next draft for that kind must carry `supersedes: <rejected id>` (store rule `PREDEV_VERSION_INCONSISTENT`). `PreDevDriver.produceCurrentPhase` (`core/workos/predev/driver.ts:123`) records without `supersedes`, so once a Founder rejects a draft the driver cannot produce that phase again and the sequence is stuck. Repro: start, `driver.produceCurrentPhase` (RECORDED), reject via the route, `driver.produceCurrentPhase` again -> `WORKOS_INVALID_INPUT: PREDEV_ENTRY_REJECTED:PREDEV_VERSION_INCONSISTENT`. Suggested fix (Lane C): pass the rejected artifact id as `supersedes` when the current artifact of that kind is REJECTED. My test proves the routes accept the superseding re-draft once a producer records it (via `store.recordPreDevArtifact`).

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 73 passed (3 new "LANE-B pre-dev Founder decisions": the whole 5-phase walk to PRE_DEV_COMPLETE with agent drafts from the TaskHub fixtures, gates as fixed codes + reject + supersede recovery + approval recorded with the Founder's own evidence and approver, input/auth/tenant isolation with the journal untouched). Mutations (accept an artifact of another mission; forge evidence in the route; approve as the agent instead of the Founder; drop Global Stop; leave gate refusals untranslated) each made a test fail; one mutant (forged evidence) survived until I asserted the recorded evidence.
