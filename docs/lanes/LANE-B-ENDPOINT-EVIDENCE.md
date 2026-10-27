<!-- //TR: Lane B uc nokta kanit haritasi (yalniz dokuman): 459205c uzerinde kayitli her Control API route'u icin kayit yeri, calistirilmis Linux testleri, masaustu allow-list durumu, renderer cagirani ve tek kanit sinifi. Windows ve gercek Electron NOT_RUN. -->
# LANE-B endpoint evidence map (base 459205c)

Docs only. No code or test was changed. Machine-readable twin: `docs/lanes/LANE-B-ENDPOINT-EVIDENCE.json` (fields per endpoint: `id` G-EP id or UNMAPPED, `a` registration, `b` tests run on this base, `c` desktop allow-list, `d` renderer caller, `e` evidence class).

## Result

108 endpoints enumerated from `apps/control-api/src/server.ts` and `routes/*.ts` (not from the inventory): server.ts registers 76 (devrun start/stop/restart expanded from one template), registered route modules register 27, and 5 sit in route files that `server.ts` never registers.

| class | endpoints |
|---|---|
| TESTED_LINUX | 99 |
| CODE_ONLY | 4 |
| UNREACHABLE_FROM_DESKTOP | 0 |
| NOT_REGISTERED | 5 |

Class precedence when more than one applies (one class per endpoint): NOT_REGISTERED > UNREACHABLE_FROM_DESKTOP > TESTED_LINUX > CODE_ONLY. The test and allow-list facts stay in the row, so nothing is hidden by the precedence. TESTED_LINUX means at least one test that sent an HTTP request to this exact route (any status) passed; the `(2xx)` flag in the table says whether a success response was ever observed.

Test run: 54 test files at 459205c on Linux: 2346 tests, 2336 passed, 0 failed, 10 skipped. Every request any of those tests sent through a Fastify instance was recorded with its route pattern, status and test title (see Method).

## Route files and whether `server.ts` registers them

| route file | route registrations | imported by server.ts |
|---|---|---|
| routes/analysis.ts | 2 | NO |
| routes/attention.ts | 1 | yes |
| routes/deps.ts | 0 | NO |
| routes/error-contract.ts | 0 | yes |
| routes/flow.ts | 1 | yes |
| routes/intake.ts | 3 | yes |
| routes/knowledge.ts | 1 | yes |
| routes/memory.ts | 6 | yes |
| routes/plan.ts | 2 | yes |
| routes/predev-decisions.ts | 4 | yes |
| routes/produce-lock.ts | 0 | NO |
| routes/product-run.ts | 3 | NO |
| routes/readiness.ts | 1 | yes |
| routes/role-status.ts | 1 | yes |
| routes/run-summaries.ts | 1 | yes |
| routes/task-runs.ts | 4 | yes |
| routes/tasks.ts | 2 | yes |

`deps.ts`, `error-contract.ts` (registered through `registerErrorContract`, an error handler) and `produce-lock.ts` register no routes. `analysis.ts` and `product-run.ts` are NOT registered: their 5 endpoints exist in code, have passing bare-app tests, and are unreachable on a running server (registration is the protected `server.ts` change in flight in #242).

## NOT_REGISTERED (5)

- `POST /v1/missions/:id/analysis/step` (apps/control-api/src/routes/analysis.ts:39): 17/17 tests passed on a bare app; renderer caller `renderer/views/analysis-step.js:28`; allow-list: NONE. ALSO_UNREACHABLE_FROM_DESKTOP: renderer caller exists but the path is not allow-listed and has no dedicated IPC channel
- `POST /v1/missions/:id/analysis/plan` (apps/control-api/src/routes/analysis.ts:75): 6/6 tests passed on a bare app; renderer caller `renderer/views/analysis-step.js:63`; allow-list: NONE. ALSO_UNREACHABLE_FROM_DESKTOP: renderer caller exists but the path is not allow-listed and has no dedicated IPC channel
- `GET /v1/work-runs/:id/product` (apps/control-api/src/routes/product-run.ts:32): 2/2 tests passed on a bare app; renderer caller `renderer/project-core.js:197`; allow-list: NONE. ALSO_UNREACHABLE_FROM_DESKTOP: renderer caller exists but the path is not allow-listed and has no dedicated IPC channel
- `POST /v1/work-runs/:id/product/start` (apps/control-api/src/routes/product-run.ts:38): 2/2 tests passed on a bare app; renderer caller `renderer/project-core.js:202`; allow-list: NONE. ALSO_UNREACHABLE_FROM_DESKTOP: renderer caller exists but the path is not allow-listed and has no dedicated IPC channel
- `POST /v1/work-runs/:id/product/stop` (apps/control-api/src/routes/product-run.ts:38): 1/1 tests passed on a bare app; renderer caller `renderer/project-core.js:202`; allow-list: NONE. ALSO_UNREACHABLE_FROM_DESKTOP: renderer caller exists but the path is not allow-listed and has no dedicated IPC channel

## CODE_ONLY (4): no HTTP test reached the route

- G-EP-008 `GET /v1/fabrics` (apps/control-api/src/server.ts:139); desktop: LEGACY_GET_ALLOWLIST (automation/lib/control-boundary.mjs:9); renderer caller renderer/integrations-core.js:4. Other tests mention the path only as an allow-list string or a fake-server key, never as a request to the real handler.
- G-EP-010 `GET /v1/domains` (apps/control-api/src/server.ts:141); desktop: LEGACY_GET_ALLOWLIST (automation/lib/control-boundary.mjs:9); renderer caller renderer/domains-core.js:2. Other tests mention the path only as an allow-list string or a fake-server key, never as a request to the real handler.
- G-EP-013 `GET /v1/founder-attention` (apps/control-api/src/server.ts:146); desktop: LEGACY_GET_ALLOWLIST (automation/lib/control-boundary.mjs:9); renderer caller NONE. Other tests mention the path only as an allow-list string or a fake-server key, never as a request to the real handler.
- G-EP-019 `POST /v1/control/resume` (apps/control-api/src/server.ts:170); desktop: DEDICATED_IPC (apps/desktop/main.mjs:320 ipcMain uasco:resume); renderer caller renderer/app.js:32 (window.uasco.resume). Other tests mention the path only as an allow-list string or a fake-server key, never as a request to the real handler.

## Registered but not reachable through the renderer's generic gateway (informational, class stays TESTED/CODE_ONLY)

- G-EP-018 `POST /v1/control/stop`: DEDICATED_IPC (apps/desktop/main.mjs:319 ipcMain uasco:stop); renderer caller renderer/app.js:31 (window.uasco.stop); class TESTED_LINUX
- G-EP-019 `POST /v1/control/resume`: DEDICATED_IPC (apps/desktop/main.mjs:320 ipcMain uasco:resume); renderer caller renderer/app.js:32 (window.uasco.resume); class CODE_ONLY
- G-EP-020 `POST /v1/control/retry-blocked`: DEDICATED_IPC (apps/desktop/main.mjs:321 ipcMain uasco:retry-blocked); renderer caller renderer/app.js:78 (retry button -> uasco.retryBlocked); class TESTED_LINUX
- G-EP-034 `POST /v1/work-runs/:id/delivery/export`: DEDICATED_IPC (apps/desktop/main.mjs:306-308 ipcMain uasco:export-delivery (main-process apiPost bridge)); renderer caller renderer/views/delivery-panel.js:50 (native.exportDelivery); class TESTED_LINUX
- G-EP-057 `POST /v1/company/accounts`: NONE; renderer caller NONE - renderer/company-core.js:6-7 maps GET sources only; no POST caller; class TESTED_LINUX
- G-EP-058 `POST /v1/company/contacts`: NONE; renderer caller NONE - renderer/company-core.js:6-7 maps GET sources only; no POST caller; class TESTED_LINUX
- G-EP-059 `POST /v1/company/opportunities`: NONE; renderer caller NONE - renderer/company-core.js:6-7 maps GET sources only; no POST caller; class TESTED_LINUX
- G-EP-060 `POST /v1/company/opportunities/:id/stage`: NONE; renderer caller NONE; class TESTED_LINUX
- G-EP-061 `POST /v1/company/invoices`: NONE; renderer caller NONE - renderer/company-core.js:6-7 maps GET sources only; no POST caller; class TESTED_LINUX
- G-EP-062 `POST /v1/company/invoices/:id/issue`: NONE; renderer caller NONE; class TESTED_LINUX
- G-EP-063 `POST /v1/company/invoices/:id/void`: NONE; renderer caller NONE; class TESTED_LINUX
- G-EP-064 `POST /v1/company/payments`: NONE; renderer caller NONE - renderer/company-core.js:6-7 maps GET sources only; no POST caller; class TESTED_LINUX
- G-EP-065 `POST /v1/company/contracts`: NONE; renderer caller NONE - renderer/company-core.js:6-7 maps GET sources only; no POST caller; class TESTED_LINUX
- G-EP-066 `POST /v1/company/contracts/:id/transition`: NONE; renderer caller NONE; class TESTED_LINUX
- G-EP-075 `POST /v1/system/workos/journal/repair-torn-tail`: NONE; renderer caller NONE; class TESTED_LINUX
- UNMAPPED `POST /v1/projects/:id/memory`: NONE; renderer caller NONE - renderer matches are GET list builders (renderer/api.js:222, renderer/knowledge-core.js:115); no POST caller; class TESTED_LINUX
- UNMAPPED `POST /v1/missions/:id/predev/produce`: NONE; renderer caller NONE; class TESTED_LINUX

## All endpoints

Columns: G-EP id (UNMAPPED = method+path not in the inventory), method and path, registration (`server.ts:line` or `routes/<file>:line`), tests passed / tests that sent a request to the route, desktop reach (allow-list family; see JSON `c.ref` for file:line), first renderer caller (JSON `d` has all), class.

| G-EP | endpoint | registered at | tests | desktop | renderer caller | class |
|---|---|---|---|---|---|---|
| G-EP-001 | GET `/health` | server.ts:128 | 3/3 (2xx) | LEGACY_GET_ALLOWLIST | renderer/api.js:64 | TESTED_LINUX |
| G-EP-002 | GET `/v1/factory` | server.ts:129 | 1/1 (2xx) | LEGACY_GET_ALLOWLIST | renderer/views/settings.js:134 | TESTED_LINUX |
| G-EP-003 | GET `/v1/phase0` | server.ts:130 | 2/2 (2xx) | LEGACY_GET_ALLOWLIST | renderer/install-core.js:7 | TESTED_LINUX |
| G-EP-004 | GET `/v1/install` | server.ts:131 | 2/2 (2xx) | LEGACY_GET_ALLOWLIST | renderer/install-core.js:6 | TESTED_LINUX |
| G-EP-005 | GET `/v1/scheduler` | server.ts:132 | 2/2 (2xx) | LEGACY_GET_ALLOWLIST | renderer/scheduler-core.js:2 | TESTED_LINUX |
| G-EP-006 | GET `/v1/agents` | server.ts:134 | 2/2 (2xx) | LEGACY_GET_ALLOWLIST | renderer/api.js:104 | TESTED_LINUX |
| G-EP-007 | GET `/v1/capabilities` | server.ts:138 | 1/1 (2xx) | LEGACY_GET_ALLOWLIST | renderer/integrations-core.js:2 | TESTED_LINUX |
| G-EP-008 | GET `/v1/fabrics` | server.ts:139 | 0/0 (no 2xx) | LEGACY_GET_ALLOWLIST | renderer/integrations-core.js:4 | CODE_ONLY |
| G-EP-009 | GET `/v1/adapters` | server.ts:140 | 1/1 (2xx) | LEGACY_GET_ALLOWLIST | renderer/integrations-core.js:3 | TESTED_LINUX |
| G-EP-010 | GET `/v1/domains` | server.ts:141 | 0/0 (no 2xx) | LEGACY_GET_ALLOWLIST | renderer/domains-core.js:2 | CODE_ONLY |
| G-EP-011 | GET `/v1/control/status` | server.ts:144 | 6/6 (2xx) | LEGACY_GET_ALLOWLIST | renderer/api.js:56 | TESTED_LINUX |
| G-EP-012 | GET `/v1/retry` | server.ts:145 | 2/2 (2xx) | LEGACY_GET_ALLOWLIST | renderer/views/tower.js:16 | TESTED_LINUX |
| G-EP-013 | GET `/v1/founder-attention` | server.ts:146 | 0/0 (no 2xx) | LEGACY_GET_ALLOWLIST | NONE | CODE_ONLY |
| G-EP-014 | GET `/v1/runs` | server.ts:148 | 9/9 (2xx) | LEGACY_GET_ALLOWLIST | renderer/api.js:65 | TESTED_LINUX |
| G-EP-015 | GET `/v1/runs/:runId/events` | server.ts:153 | 6/6 (2xx) | LEGACY_GET_ALLOWLIST | renderer/api.js:68 | TESTED_LINUX |
| G-EP-016 | GET `/v1/runs/:runId/logs` | server.ts:157 | 4/4 (2xx) | LEGACY_GET_ALLOWLIST | renderer/views/tower.js:50 | TESTED_LINUX |
| G-EP-017 | GET `/v1/runs/:runId/logs/:name` | server.ts:161 | 4/4 (2xx) | LEGACY_GET_ALLOWLIST | renderer/views/tower.js:53 | TESTED_LINUX |
| G-EP-018 | POST `/v1/control/stop` | server.ts:166 | 3/3 (2xx) | DEDICATED_IPC | renderer/app.js:31 (window.uasco.stop) | TESTED_LINUX |
| G-EP-019 | POST `/v1/control/resume` | server.ts:170 | 0/0 (no 2xx) | DEDICATED_IPC | renderer/app.js:32 (window.uasco.resume) | CODE_ONLY |
| G-EP-020 | POST `/v1/control/retry-blocked` | server.ts:171 | 2/2 (no 2xx) | DEDICATED_IPC | renderer/app.js:78 (retry button -> uasco.retryBlocked) | TESTED_LINUX |
| G-EP-021 | GET `/v1/projects` | server.ts:218 | 18/18 (2xx) | EXTRA_GET_ALLOWLIST | renderer/work-core.js:116 | TESTED_LINUX |
| G-EP-022 | POST `/v1/projects` | server.ts:219 | 70/71 (2xx) | POST_ALLOWLIST | renderer/work-core.js:116 | TESTED_LINUX |
| G-EP-023 | GET `/v1/missions` | server.ts:231 | 20/20 (2xx) | EXTRA_GET_ALLOWLIST | renderer/work-core.js:135 | TESTED_LINUX |
| G-EP-024 | POST `/v1/missions` | server.ts:235 | 24/24 (2xx) | POST_ALLOWLIST | renderer/work-core.js:135 | TESTED_LINUX |
| G-EP-025 | GET `/v1/missions/:id` | server.ts:241 | 8/8 (2xx) | EXTRA_GET_ALLOWLIST | renderer/api.js:71 | TESTED_LINUX |
| G-EP-026 | POST `/v1/missions/:id/transition` | server.ts:245 | 34/34 (2xx) | POST_ALLOWLIST | renderer/work-core.js:367 | TESTED_LINUX |
| G-EP-027 | POST `/v1/missions/:id/runs` | server.ts:304 | 14/14 (2xx) | POST_ALLOWLIST | renderer/work-core.js:379 | TESTED_LINUX |
| G-EP-028 | GET `/v1/work-runs` | server.ts:318 | 21/21 (2xx) | EXTRA_GET_ALLOWLIST | renderer/executive-core.js:5 | TESTED_LINUX |
| G-EP-029 | GET `/v1/work-runs/:id` | server.ts:322 | 12/12 (2xx) | EXTRA_GET_ALLOWLIST | renderer/api.js:78 | TESTED_LINUX |
| G-EP-030 | GET `/v1/deliveries` | server.ts:331 | 1/1 (2xx) | EXTRA_GET_ALLOWLIST | renderer/delivery-core.js:11 | TESTED_LINUX |
| G-EP-031 | GET `/v1/work-runs/:id/delivery` | server.ts:335 | 5/5 (2xx) | EXTRA_GET_ALLOWLIST | renderer/delivery-core.js:12 | TESTED_LINUX |
| G-EP-032 | POST `/v1/work-runs/:id/delivery/prepare` | server.ts:339 | 13/13 (2xx) | POST_ALLOWLIST | renderer/delivery-core.js:58 | TESTED_LINUX |
| G-EP-033 | POST `/v1/work-runs/:id/delivery/accept` | server.ts:349 | 9/9 (2xx) | POST_ALLOWLIST | renderer/delivery-core.js:75 | TESTED_LINUX |
| G-EP-034 | POST `/v1/work-runs/:id/delivery/export` | server.ts:360 | 4/4 (2xx) | DEDICATED_IPC | renderer/views/delivery-panel.js:50 (native.exportDelivery) | TESTED_LINUX |
| G-EP-035 | POST `/v1/projects/:id/import` | server.ts:388 | 7/7 (2xx) | POST_ALLOWLIST | renderer/project-core.js:171 | TESTED_LINUX |
| G-EP-036 | GET `/v1/projects/:id/devrun` | server.ts:411 | 10/10 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:74 | TESTED_LINUX |
| G-EP-037 | POST `/v1/projects/:id/devrun/start` | server.ts:413 | 14/14 (2xx) | POST_ALLOWLIST | renderer/project-core.js:177 | TESTED_LINUX |
| G-EP-038 | POST `/v1/projects/:id/devrun/stop` | server.ts:413 | 8/8 (2xx) | POST_ALLOWLIST | renderer/project-core.js:177 | TESTED_LINUX |
| G-EP-039 | POST `/v1/projects/:id/devrun/restart` | server.ts:413 | 6/6 (2xx) | POST_ALLOWLIST | renderer/project-core.js:177 | TESTED_LINUX |
| G-EP-040 | GET `/v1/projects/:id/files` | server.ts:426 | 5/5 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:80 | TESTED_LINUX |
| G-EP-041 | GET `/v1/projects/:id/file` | server.ts:431 | 5/5 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:83 | TESTED_LINUX |
| G-EP-042 | GET `/v1/projects/:id/git/log` | server.ts:436 | 5/5 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:85 | TESTED_LINUX |
| G-EP-043 | GET `/v1/projects/:id/git/diff` | server.ts:442 | 4/4 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:91 | TESTED_LINUX |
| G-EP-044 | POST `/v1/projects/:id/export` | server.ts:449 | 8/9 (2xx) | POST_ALLOWLIST | renderer/project-core.js:184 | TESTED_LINUX |
| G-EP-045 | GET `/v1/projects/:id/exports` | server.ts:459 | 4/4 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:75 | TESTED_LINUX |
| G-EP-046 | GET `/v1/projects/:id/exports/:exportId` | server.ts:460 | 3/3 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:76 | TESTED_LINUX |
| G-EP-047 | GET `/v1/system/executors` | server.ts:470 | 12/12 (2xx) | PROJECT_STUDIO_GET_ALLOWLIST | renderer/project-core.js:93 | TESTED_LINUX |
| G-EP-048 | POST `/v1/system/executors/local-claude/enable` | server.ts:471 | 2/2 (2xx) | POST_ALLOWLIST | renderer/project-core.js:94 | TESTED_LINUX |
| G-EP-049 | GET `/v1/evidence` | server.ts:484 | 23/23 (2xx) | EXTRA_GET_ALLOWLIST | renderer/api.js:87 | TESTED_LINUX |
| G-EP-050 | GET `/v1/evidence/:evidenceId` | server.ts:498 | 18/18 (2xx) | EXTRA_GET_ALLOWLIST | renderer/api.js:89 | TESTED_LINUX |
| G-EP-051 | GET `/v1/company/accounts` | server.ts:510 | 4/4 (2xx) | EXTRA_GET_ALLOWLIST | renderer/company-core.js:6 | TESTED_LINUX |
| G-EP-052 | GET `/v1/company/contacts` | server.ts:516 | 4/4 (2xx) | EXTRA_GET_ALLOWLIST | renderer/company-core.js:6 | TESTED_LINUX |
| G-EP-053 | GET `/v1/company/opportunities` | server.ts:524 | 5/5 (2xx) | EXTRA_GET_ALLOWLIST | renderer/company-core.js:6 | TESTED_LINUX |
| G-EP-054 | GET `/v1/company/invoices` | server.ts:537 | 8/8 (2xx) | EXTRA_GET_ALLOWLIST | renderer/company-core.js:7 | TESTED_LINUX |
| G-EP-055 | GET `/v1/company/payments` | server.ts:556 | 6/6 (2xx) | EXTRA_GET_ALLOWLIST | renderer/company-core.js:7 | TESTED_LINUX |
| G-EP-056 | GET `/v1/company/contracts` | server.ts:567 | 5/5 (2xx) | EXTRA_GET_ALLOWLIST | renderer/company-core.js:7 | TESTED_LINUX |
| G-EP-057 | POST `/v1/company/accounts` | server.ts:511 | 19/19 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-058 | POST `/v1/company/contacts` | server.ts:519 | 5/5 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-059 | POST `/v1/company/opportunities` | server.ts:527 | 8/8 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-060 | POST `/v1/company/opportunities/:id/stage` | server.ts:532 | 6/6 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-061 | POST `/v1/company/invoices` | server.ts:540 | 11/11 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-062 | POST `/v1/company/invoices/:id/issue` | server.ts:546 | 10/10 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-063 | POST `/v1/company/invoices/:id/void` | server.ts:551 | 3/3 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-064 | POST `/v1/company/payments` | server.ts:559 | 10/10 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-065 | POST `/v1/company/contracts` | server.ts:570 | 6/6 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-066 | POST `/v1/company/contracts/:id/transition` | server.ts:575 | 4/4 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-067 | GET `/v1/roles` | server.ts:593 | 5/5 (2xx) | EXTRA_GET_ALLOWLIST | renderer/api.js:109 | TESTED_LINUX |
| G-EP-068 | GET `/v1/roles/:roleId` | server.ts:609 | 4/4 (2xx) | EXTRA_GET_ALLOWLIST | renderer/agent-factory-core.js:2 | TESTED_LINUX |
| G-EP-069 | GET `/v1/academy` | server.ts:621 | 4/4 (2xx) | EXTRA_GET_ALLOWLIST | renderer/academy-core.js:2 | TESTED_LINUX |
| G-EP-070 | GET `/v1/academy/:id` | server.ts:623 | 2/2 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| G-EP-071 | GET `/v1/predev/:missionId` | server.ts:631 | 7/7 (2xx) | EXTRA_GET_ALLOWLIST | renderer/journey-core.js:3 | TESTED_LINUX |
| G-EP-072 | GET `/v1/crew/:missionId` | server.ts:636 | 6/6 (2xx) | EXTRA_GET_ALLOWLIST | renderer/journey-core.js:4 | TESTED_LINUX |
| G-EP-073 | GET `/v1/reviews` | server.ts:681 | 19/19 (2xx) | EXTRA_GET_ALLOWLIST | renderer/readiness-core.js:6 | TESTED_LINUX |
| G-EP-074 | GET `/v1/reviews/:reviewId` | server.ts:695 | 8/8 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| G-EP-075 | POST `/v1/system/workos/journal/repair-torn-tail` | server.ts:705 | 1/1 (2xx) | NONE | NONE | TESTED_LINUX |
| G-EP-076 | GET `/v1/cockpit` | server.ts:772 | 25/25 (2xx) | EXTRA_GET_ALLOWLIST | renderer/executive-core.js:5 | TESTED_LINUX |
| UNMAPPED | GET `/v1/attention` | routes/attention.ts:7 | 13/13 (2xx) | EXTRA_GET_ALLOWLIST | renderer/attention-core.js:2 | TESTED_LINUX |
| UNMAPPED | GET `/v1/intakes` | routes/intake.ts:23 | 7/7 (2xx) | EXTRA_GET_ALLOWLIST | renderer/intake-core.js:4 | TESTED_LINUX |
| UNMAPPED | POST `/v1/intakes` | routes/intake.ts:29 | 22/22 (2xx) | POST_ALLOWLIST | renderer/intake-core.js:4 | TESTED_LINUX |
| UNMAPPED | GET `/v1/intakes/:id` | routes/intake.ts:24 | 5/5 (2xx) | EXTRA_GET_ALLOWLIST | renderer/intake-core.js:5 | TESTED_LINUX |
| UNMAPPED | POST `/v1/missions/:id/analysis/plan` | routes/analysis.ts:75 | 6/6 (2xx) | NONE | renderer/views/analysis-step.js:63 | NOT_REGISTERED |
| UNMAPPED | POST `/v1/missions/:id/analysis/step` | routes/analysis.ts:39 | 17/17 (2xx) | NONE | renderer/views/analysis-step.js:28 | NOT_REGISTERED |
| UNMAPPED | POST `/v1/missions/:id/plan` | routes/plan.ts:20 | 14/14 (2xx) | POST_ALLOWLIST | renderer/work-core.js:141 | TESTED_LINUX |
| UNMAPPED | POST `/v1/missions/:id/predev/artifacts/:artifactId/approve` | routes/predev-decisions.ts:80 | 11/11 (2xx) | POST_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | POST `/v1/missions/:id/predev/artifacts/:artifactId/reject` | routes/predev-decisions.ts:89 | 4/4 (2xx) | POST_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | POST `/v1/missions/:id/predev/produce` | routes/predev-decisions.ts:101 | 14/14 (2xx) | NONE | NONE | TESTED_LINUX |
| UNMAPPED | POST `/v1/missions/:id/predev/start` | routes/predev-decisions.ts:68 | 21/21 (2xx) | POST_ALLOWLIST | renderer/predev-decisions-core.js:19 | TESTED_LINUX |
| UNMAPPED | GET `/v1/missions/:id/tasks` | routes/plan.ts:15 | 6/6 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/flow` | routes/flow.ts:7 | 7/7 (2xx) | EXTRA_GET_ALLOWLIST | renderer/project-core.js:416 | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/knowledge` | routes/knowledge.ts:9 | 5/5 (2xx) | EXTRA_GET_ALLOWLIST | renderer/knowledge-core.js:17 | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/memory` | routes/memory.ts:47 | 5/5 (2xx) | MEMORY_LIST_ALLOWLIST | renderer/api.js:222 | TESTED_LINUX |
| UNMAPPED | POST `/v1/projects/:id/memory` | routes/memory.ts:67 | 5/5 (2xx) | NONE | NONE | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/memory/:memId` | routes/memory.ts:57 | 2/2 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/memory/:memId/provenance` | routes/memory.ts:62 | 1/1 (2xx) | EXTRA_GET_ALLOWLIST | renderer/knowledge-core.js:72 | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/memory/current` | routes/memory.ts:46 | 1/1 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/memory/health` | routes/memory.ts:45 | 2/2 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | GET `/v1/projects/:id/readiness` | routes/readiness.ts:7 | 7/7 (2xx) | EXTRA_GET_ALLOWLIST | renderer/project-core.js:438 | TESTED_LINUX |
| UNMAPPED | GET `/v1/roles/status-summary` | routes/role-status.ts:13 | 2/2 (2xx) | EXTRA_GET_ALLOWLIST | renderer/agent-factory-core.js:2 | TESTED_LINUX |
| UNMAPPED | GET `/v1/run-summaries` | routes/run-summaries.ts:11 | 3/3 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | GET `/v1/tasks/:id` | routes/tasks.ts:18 | 8/8 (2xx) | EXTRA_GET_ALLOWLIST | NONE | TESTED_LINUX |
| UNMAPPED | GET `/v1/tasks/:id/runs` | routes/task-runs.ts:22 | 8/8 (2xx) | EXTRA_GET_ALLOWLIST | renderer/work-core.js:204 | TESTED_LINUX |
| UNMAPPED | POST `/v1/tasks/:id/runs` | routes/task-runs.ts:32 | 6/6 (2xx) | POST_ALLOWLIST | renderer/work-core.js:204 | TESTED_LINUX |
| UNMAPPED | POST `/v1/tasks/:id/transition` | routes/tasks.ts:23 | 9/9 (2xx) | POST_ALLOWLIST | renderer/work-core.js:177 | TESTED_LINUX |
| UNMAPPED | GET `/v1/work-runs/:id/product` | routes/product-run.ts:32 | 2/2 (2xx) | NONE | renderer/project-core.js:197 | NOT_REGISTERED |
| UNMAPPED | POST `/v1/work-runs/:id/product/start` | routes/product-run.ts:38 | 2/2 (2xx) | NONE | renderer/project-core.js:202 | NOT_REGISTERED |
| UNMAPPED | POST `/v1/work-runs/:id/product/stop` | routes/product-run.ts:38 | 1/1 (2xx) | NONE | renderer/project-core.js:202 | NOT_REGISTERED |
| UNMAPPED | GET `/v1/work-runs/:id/tasks` | routes/task-runs.ts:27 | 5/5 (2xx) | EXTRA_GET_ALLOWLIST | renderer/work-core.js:324 | TESTED_LINUX |
| UNMAPPED | POST `/v1/work-runs/:id/tasks/reconcile` | routes/task-runs.ts:44 | 3/3 (2xx) | POST_ALLOWLIST | renderer/work-core.js:217 | TESTED_LINUX |

## IPC channels (apps/desktop, secondary table)

| G-EP | channel | main.mjs | preload | tests referencing (textual/fake bridge) | class |
|---|---|---|---|---|---|
| G-EP-077 | `uasco:api-get` | main.mjs:317 | preload.mjs:4 (apiGet) | 3 | CODE_ONLY |
| G-EP-078 | `uasco:api-post` | main.mjs:318 | preload.mjs:5 (apiPost) | 1 | CODE_ONLY |
| G-EP-079 | `uasco:stop` | main.mjs:319 | preload.mjs:6 (stop) | 1 | CODE_ONLY |
| G-EP-080 | `uasco:resume` | main.mjs:320 | preload.mjs:7 (resume) | 1 | CODE_ONLY |
| G-EP-081 | `uasco:retry-blocked` | main.mjs:321 | preload.mjs:8 (retryBlocked) | 4 | CODE_ONLY |
| G-EP-082 | `uasco:pick-import-path` | main.mjs:285 | preload.mjs:9 (pickImportPath) | 11 | CODE_ONLY |
| G-EP-083 | `uasco:open-preview` | main.mjs:292 | preload.mjs:10 (openPreview) | 7 | CODE_ONLY |
| G-EP-084 | `uasco:show-export` | main.mjs:298 | preload.mjs:11 (showExport) | 6 | CODE_ONLY |
| G-EP-085 | `uasco:export-delivery` | main.mjs:306 | preload.mjs:13 (exportDelivery) | 6 | CODE_ONLY |

IPC handlers run only inside Electron (NOT_RUN here); the references above are textual or go through fake bridges, so none is classed as tested.

## Method

1. Routes: every `app.get|post|...(path` call in `server.ts` and `routes/*.ts` (regex incl. TypeScript generics); the two template registrations (`devrun/${action}`, `product/${action}`) are expanded. 0 registrations with a non-literal path.
2. Tests: a temporary vitest setup file (not committed) wraps `fastify` with an `onResponse` hook that appends `{method, route pattern, status, current test title, test file}` for every request; it was run over the 54 test files that mention `buildServer`, `.inject(`, `register*Routes`, `/v1/` or the shared `*.cases` support files. Per-test PASS/FAIL comes from the vitest JSON report of the same run and is joined by file + full title. Requests answered by Fastify's 404 for an unknown route carry no route pattern and are not counted. Handler-level calls that bypass Fastify are not observable and are not counted.
3. Desktop reach: the real matcher code is executed, not read: `desktopGetPathAllowed` (`automation/lib/control-boundary.mjs`) plus the B4/B5 allow-list block of `apps/desktop/main.mjs` (`desktopExtraGetPathAllowed`, `desktopPostPathAllowed`) are evaluated against a canonical sample path per endpoint (ids built from the patterns the matchers require; for GET routes that need a query the required query was added). `c.ref` names the matcher that accepted it. Dedicated channels (`uasco:stop`, `uasco:resume`, `uasco:retry-blocked`, the main-process delivery export bridge) are recorded as DEDICATED_IPC.
4. Renderer callers: string/template literals of the path in non-comment code under `apps/desktop/renderer` (locale files excluded), with POST/GET attribution corrected by reading the call sites (`dNotes` in the JSON). Where GET and POST share a path the literal list is attributed by path, not by method.

## NOT_RUN

Windows (every Windows-only branch and CI shard), real Electron and the IPC handlers, real WSL. Handler-level tests that bypass Fastify.

## Limits

- A passing test that only reaches a route's gates (423/403/400) counts as exercising the route; the `(no 2xx)` flag marks routes whose success path was never observed.
- `UNMAPPED` ids are routes added after the 2026-10-19 inventory.
- The inventory's statuses are not restated here; this map is evidence, not a status change.

