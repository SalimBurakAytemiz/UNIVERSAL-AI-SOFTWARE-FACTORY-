<!-- //TR: Lane B yetki talebi: proje koşu-hazırlık route kaydı için server.ts yaması ve Electron izin listesi yolu -->
# LANE-B-run-readiness: why can't the first run start? (protected registration + Desktop path)

Gap (first-delivery): after intake the Founder had no single answer to "why can't I start the first run?"; blockers surfaced only after a failed start. `GET /v1/projects/:id/readiness` -> `{readiness:{projectId, missionId|null, ready, verifiable, checks:[{id, state:OK|BLOCKED|UNKNOWN, blocking, reason|null, nextAction|null}]}}`. Read-only, no query, no body; tenant scoped (404 unknown/other tenant); no path, URL, profile or provenance detail is ever returned.

| check | blocking | source (single source of truth) | reasons |
|---|---|---|---|
| MISSION | yes | newest non-COMPLETE mission | NO_OPEN_MISSION |
| RISK | yes | `riskAdmitted` / `RISK_REFUSAL` (risk-admission.ts, same code POST /runs returns) | RISK_REQUIRES_FOUNDER_DECISION_AND_OS_SANDBOX |
| REPOSITORY | yes | `repositoryPrecondition` (exported from runner.ts by Lane C #208; the runner calls the same function) | REPOSITORY_NOT_CONFIGURED, REMOTE_REPO_NOT_SUPPORTED_YET, REPOSITORY_NOT_MANAGED, REPOSITORY_PATH_FORBIDDEN, REPOSITORY_PATH_NOT_FOUND |
| TEST_COMMAND | no (run starts, tests NOT_EXECUTED) | `effectiveTestCommand` (exported from runner.ts by Lane C #208, used by the runner) + `testCommandAllowed` | TEST_COMMAND_MISSING, TEST_COMMAND_NOT_ALLOWED |
| PLAN | no | tasks of the target mission | NO_PLANNED_TASKS |

`ready` = every blocking check OK. `verifiable` = ready and every check OK. An unreadable source gives UNKNOWN, never OK. `GET /v1/projects/:id/flow` `testCommand` now uses the same mission-over-project precedence.

Honest limits: the EXECUTOR and PRE-DEV checks were dropped (no readable run-route executor-selection result in the route deps; pre-dev is not a run gate). there is no mirrored rule: readiness.ts and flow.ts import `effectiveTestCommand` and `repositoryPrecondition` from runner.ts, and a test compares readiness answers with the runner's own reasons for all five repository BLOCK cases.

## Patch (server.ts, next to the other lane registrations)
```diff
+import {registerReadinessRoutes} from "./routes/readiness.js";
@@ after registerFlowRoutes(app,laneDeps);
+registerReadinessRoutes(app,laneDeps);
```
## Electron allow-list (apps/desktop/main.mjs, protected; coordinator)
GET `/v1/projects/prj_<24hex>/readiness` (no query).

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts tests/v7-b3a-runner.test.ts`: 156 passed (b1-workos 101 incl. 6 "LANE-B run readiness"). Mutations (RISK always OK, project-over-mission precedence, ready via some, verifiable via some, readiness ignoring the runner's repository reason) each failed a test.
