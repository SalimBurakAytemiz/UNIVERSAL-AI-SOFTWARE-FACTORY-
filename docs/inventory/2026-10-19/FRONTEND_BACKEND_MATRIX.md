<!-- //TR: Frontend-backend matrisi: 154 gorunum-endpoint cifti, veri siniflari, baglanti bosluklari ve bilinen kusurlar / Frontend-backend matrix: 154 view-endpoint pairs, data classes, wiring gaps and known defects -->

# Frontend-backend matrix, 2026-10-19

`FRONTEND_BACKEND_MATRIX.csv` is a byte copy of `raw/frontend-backend-matrix.csv` (154 rows, 25 record fields). Each row is one (view, endpoint) pair on `v7/integration @ e12dbdd` or on an open PR branch. **Pairs are not work items**: they are evidence for the screen rows (`SCREEN_AUDIT_252.csv`) and the endpoint rows (`G-EP-*` in `master-work-inventory.csv`). Served/allow-listed status was checked mechanically by the auditors (`endpoint-check.mjs` against `apps/control-api/src/server.ts`, the `apps/desktop/main.mjs` B4/B5 allow-lists and `automation/lib/control-boundary.mjs`). Product verification: 0 pairs.

## Pair status

| Status | Pairs |
|---|---|
| INTEGRATED_NOT_VERIFIED | 113 |
| AUTHORITY_REQUIRED | 15 |
| PENDING_REVIEW | 14 |
| OBSOLETE | 10 |
| NOT_STARTED | 2 |

Data class of the response the view receives: REAL 100, LEGACY 13, API_ONLY 10, LEGACY_ONLY 7, STATIC 7, EMPTY_IN_PRODUCT 6, REAL_OR_PENDING 4, ALWAYS_409_SANDBOX 2, REAL_BUT_BRIDGE_BROKEN 1, ALWAYS_EMPTY 1, ALWAYS_NOT_STARTED 1, PARTIAL 1, NO_PRODUCER 1. `LEGACY`/`LEGACY_ONLY` means the data comes from the retired V6 supervisor (`automation/factory-supervisor.mjs` exits 64), so packaged runtimes show empty or rejected data; `NO_PRODUCER` means the read API exists but nothing writes the data; `API_ONLY` means served but not reachable from the desktop.

## Per view

| View (caller) | Pairs | INV | AUTH | OBSOLETE | PR-only | Not called |
|---|---|---|---|---|---|---|
| shell.js (all routes) | 8 | 6 | 0 | 2 | 0 | 0 |
| app.js native actions | 3 | 2 | 0 | 1 | 0 | 0 |
| views/home.js #/home | 2 | 2 | 0 | 0 | 0 | 0 |
| views/projects.js #/projects | 4 | 4 | 0 | 0 | 0 | 0 |
| views/studio-wizard.js (in #/projects) | 2 | 2 | 0 | 0 | 0 | 0 |
| views/studio-workspace.js (in #/projects) | 15 | 12 | 3 | 0 | 0 | 0 |
| views/delivery-panel.js (in studio-workspace) | 3 | 2 | 1 | 0 | 0 | 0 |
| views/work.js #/work | 9 | 9 | 0 | 0 | 0 | 0 |
| views/inbox.js #/inbox | 6 | 6 | 0 | 0 | 0 | 0 |
| views/workforce.js #/workforce | 5 | 5 | 0 | 0 | 0 | 0 |
| inspector.js (side inspector) | 4 | 4 | 0 | 0 | 0 | 0 |
| views/assurance.js #/assurance | 4 | 4 | 0 | 0 | 0 | 0 |
| views/delivery.js #/delivery | 4 | 4 | 0 | 0 | 0 | 0 |
| views/tower.js #/tower | 17 | 11 | 0 | 6 | 0 | 0 |
| views/company.js #/company | 6 | 6 | 0 | 0 | 0 | 0 |
| views/academy.js #/academy | 1 | 1 | 0 | 0 | 0 | 0 |
| views/journey.js #/journey | 3 | 3 | 0 | 0 | 0 | 0 |
| views/executive.js #/executive | 4 | 4 | 0 | 0 | 0 | 0 |
| views/queue.js #/queue | 3 | 3 | 0 | 0 | 0 | 0 |
| views/readiness.js #/readiness | 4 | 4 | 0 | 0 | 0 | 0 |
| views/posture.js #/posture | 3 | 3 | 0 | 0 | 0 | 0 |
| views/matrix.js #/matrix | 4 | 4 | 0 | 0 | 0 | 0 |
| views/operations.js #/operations | 3 | 2 | 0 | 1 | 0 | 0 |
| views/install.js #/install | 3 | 3 | 0 | 0 | 0 | 0 |
| views/settings.js #/settings | 4 | 4 | 0 | 0 | 0 | 0 |
| views/executors-panel.js (in #/settings) | 2 | 2 | 0 | 0 | 0 | 0 |
| views/firstrun.js (first-run wizard) | 1 | 1 | 0 | 0 | 0 | 0 |
| NONE (no renderer caller on v7) | 13 | 0 | 11 | 0 | 0 | 2 |
| PR #8 providers view (feature/ui074-providers) | 2 | 0 | 0 | 0 | 2 | 0 |
| PR #24-#26 assurance reviews/lineage/test-report stack (claude/l-assurance-ui049..051) | 4 | 0 | 0 | 0 | 4 | 0 |
| PR #27 audit trail (claude/l-routes-ui070) | 3 | 0 | 0 | 0 | 3 | 0 |
| PR #28 extensions & integrations (claude/l-routes-ui078, stacked on #27) | 3 | 0 | 0 | 0 | 3 | 0 |
| PR #32 domain packs (claude/l-domains-ui-domainpacks) | 1 | 0 | 0 | 0 | 1 | 0 |
| PR #33 build scheduler (claude/l-scheduler-ui-buildscheduler) | 1 | 0 | 0 | 0 | 1 | 0 |

## Integrated pairs whose data is not real (20 of 113)

These pairs are wired and served, but the view receives legacy, empty, never-produced or sandbox-refused data, so the screen cannot show a working function even after product verification.

| Pair | Caller | Endpoint | Data class |
|---|---|---|---|
| G-FB-003 | shell.js (all routes) | GET /v1/founder-attention | LEGACY_ONLY |
| G-FB-048 | views/inbox.js #/inbox | GET /v1/founder-attention | LEGACY_ONLY |
| G-FB-068 | views/delivery.js #/delivery | GET /v1/founder-attention | LEGACY_ONLY |
| G-FB-071 | views/tower.js #/tower | GET /v1/phase0 | REAL_OR_PENDING |
| G-FB-072 | views/tower.js #/tower | GET /v1/install | REAL_OR_PENDING |
| G-FB-079 | views/tower.js #/tower | GET /v1/founder-attention | LEGACY_ONLY |
| G-FB-087 | views/company.js #/company | GET /v1/company/accounts | EMPTY_IN_PRODUCT |
| G-FB-088 | views/company.js #/company | GET /v1/company/contacts | EMPTY_IN_PRODUCT |
| G-FB-089 | views/company.js #/company | GET /v1/company/opportunities | EMPTY_IN_PRODUCT |
| G-FB-090 | views/company.js #/company | GET /v1/company/invoices | EMPTY_IN_PRODUCT |
| G-FB-091 | views/company.js #/company | GET /v1/company/payments | EMPTY_IN_PRODUCT |
| G-FB-092 | views/company.js #/company | GET /v1/company/contracts | EMPTY_IN_PRODUCT |
| G-FB-093 | views/academy.js #/academy | GET /v1/academy | ALWAYS_EMPTY |
| G-FB-095 | views/journey.js #/journey | GET /v1/predev/:missionId | ALWAYS_NOT_STARTED |
| G-FB-096 | views/journey.js #/journey | GET /v1/crew/:missionId | PARTIAL |
| G-FB-100 | views/executive.js #/executive | GET /v1/founder-attention | LEGACY_ONLY |
| G-FB-101 | views/queue.js #/queue | GET /v1/founder-attention | LEGACY_ONLY |
| G-FB-117 | views/operations.js #/operations | GET /v1/founder-attention | LEGACY_ONLY |
| G-FB-118 | views/install.js #/install | GET /v1/install | REAL_OR_PENDING |
| G-FB-119 | views/install.js #/install | GET /v1/phase0 | REAL_OR_PENDING |

## Gaps (every pair that is not INTEGRATED_NOT_VERIFIED)

The 14 PR-only pairs were PENDING_REVIEW when the backend auditor read them; at 2026-10-19T04:45Z their PRs (#8 AUTHORITY_REQUIRED; #24-#28, #32, #33 PENDING_CI) are classified in `PR_REVIEW_CI_MERGE_BOTTLENECKS.md`.

| Pair | Caller | Endpoint | Status | Facts |
|---|---|---|---|---|
| G-FB-007 | shell.js (all routes) | GET /v1/runs | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-008 | shell.js (all routes) | GET /v1/runs/:runId/events | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-011 | app.js native actions | POST /v1/control/retry-blocked | OBSOLETE | called=YES served=YES allow=IPC data=LEGACY |
| G-FB-030 | views/studio-workspace.js (in #/projects) | POST /v1/projects/:id/devrun/start | AUTHORITY_REQUIRED | called=YES served=YES allow=YES data=ALWAYS_409_SANDBOX |
| G-FB-032 | views/studio-workspace.js (in #/projects) | POST /v1/projects/:id/devrun/restart | AUTHORITY_REQUIRED | called=YES served=YES allow=YES data=ALWAYS_409_SANDBOX |
| G-FB-034 | views/studio-workspace.js (in #/projects) | GET /v1/projects/:id/exports/:exportId | AUTHORITY_REQUIRED | called=YES served=YES allow=YES data=REAL |
| G-FB-037 | views/delivery-panel.js (in studio-workspace) | POST /v1/work-runs/:id/delivery/export | AUTHORITY_REQUIRED | called=YES served=YES allow=IPC data=REAL_BUT_BRIDGE_BROKEN |
| G-FB-073 | views/tower.js #/tower | GET /v1/scheduler | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-077 | views/tower.js #/tower | GET /v1/retry | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-078 | views/tower.js #/tower | GET /v1/runs | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-084 | views/tower.js #/tower | GET /v1/runs/:runId/events | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-085 | views/tower.js #/tower | GET /v1/runs/:runId/logs | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-086 | views/tower.js #/tower | GET /v1/runs/:runId/logs/:name | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-116 | views/operations.js #/operations | GET /v1/runs | OBSOLETE | called=YES served=YES allow=YES data=LEGACY |
| G-FB-128 | NONE (no renderer caller on v7) | GET /v1/academy/:id | NOT_STARTED | called=NO served=YES allow=YES data=NO_PRODUCER |
| G-FB-129 | NONE (no renderer caller on v7) | GET /v1/work-runs/:id/delivery | NOT_STARTED | called=NO served=YES allow=YES data=REAL |
| G-FB-130 | NONE (no renderer caller on v7) | POST /v1/company/accounts | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-131 | NONE (no renderer caller on v7) | POST /v1/company/contacts | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-132 | NONE (no renderer caller on v7) | POST /v1/company/opportunities | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-133 | NONE (no renderer caller on v7) | POST /v1/company/opportunities/:id/stage | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-134 | NONE (no renderer caller on v7) | POST /v1/company/invoices | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-135 | NONE (no renderer caller on v7) | POST /v1/company/invoices/:id/issue | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-136 | NONE (no renderer caller on v7) | POST /v1/company/invoices/:id/void | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-137 | NONE (no renderer caller on v7) | POST /v1/company/payments | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-138 | NONE (no renderer caller on v7) | POST /v1/company/contracts | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-139 | NONE (no renderer caller on v7) | POST /v1/company/contracts/:id/transition | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=API_ONLY |
| G-FB-140 | NONE (no renderer caller on v7) | POST /v1/system/workos/journal/repair-torn-tail | AUTHORITY_REQUIRED | called=NO served=YES allow=NO data=REAL |
| G-FB-141 | PR #8 providers view (feature/ui074-providers | GET /v1/system/executors | PENDING_REVIEW | called=YES served=YES allow=YES data=REAL |
| G-FB-142 | PR #8 providers view (feature/ui074-providers | GET /v1/control/status | PENDING_REVIEW | called=YES served=YES allow=YES data=REAL |
| G-FB-143 | PR #24-#26 assurance reviews/lineage/test-rep | GET /v1/reviews | PENDING_REVIEW | called=YES served=YES allow=YES data=REAL |
| G-FB-144 | PR #24-#26 assurance reviews/lineage/test-rep | GET /v1/reviews/:reviewId | PENDING_REVIEW | called=YES served=YES allow=YES data=REAL |
| G-FB-145 | PR #24-#26 assurance reviews/lineage/test-rep | GET /v1/work-runs | PENDING_REVIEW | called=YES served=YES allow=YES data=REAL |
| G-FB-146 | PR #24-#26 assurance reviews/lineage/test-rep | GET /v1/evidence | PENDING_REVIEW | called=YES served=YES allow=YES data=REAL |
| G-FB-147 | PR #27 audit trail (claude/l-routes-ui070) | GET /v1/runs | PENDING_REVIEW | called=YES served=YES allow=YES data=LEGACY |
| G-FB-148 | PR #27 audit trail (claude/l-routes-ui070) | GET /v1/runs/:runId/events | PENDING_REVIEW | called=YES served=YES allow=YES data=LEGACY |
| G-FB-149 | PR #27 audit trail (claude/l-routes-ui070) | GET /v1/evidence | PENDING_REVIEW | called=YES served=YES allow=YES data=REAL |
| G-FB-150 | PR #28 extensions & integrations (claude/l-ro | GET /v1/capabilities | PENDING_REVIEW | called=YES served=YES allow=YES data=STATIC |
| G-FB-151 | PR #28 extensions & integrations (claude/l-ro | GET /v1/adapters | PENDING_REVIEW | called=YES served=YES allow=YES data=STATIC |
| G-FB-152 | PR #28 extensions & integrations (claude/l-ro | GET /v1/fabrics | PENDING_REVIEW | called=YES served=YES allow=YES data=STATIC |
| G-FB-153 | PR #32 domain packs (claude/l-domains-ui-doma | GET /v1/domains | PENDING_REVIEW | called=YES served=YES allow=YES data=STATIC |
| G-FB-154 | PR #33 build scheduler (claude/l-scheduler-ui | GET /v1/scheduler | PENDING_REVIEW | called=YES served=YES allow=YES data=LEGACY |

## Endpoints served with no renderer consumer on v7 (16 of 85)

| ID | Endpoint | Status |
|---|---|---|
| G-EP-008 | GET /v1/fabrics (READ) | INTEGRATED_NOT_VERIFIED |
| G-EP-010 | GET /v1/domains (READ) | INTEGRATED_NOT_VERIFIED |
| G-EP-031 | GET /v1/work-runs/:id/delivery (READ) | INTEGRATED_NOT_VERIFIED |
| G-EP-057 | POST /v1/company/accounts (WRITE) | AUTHORITY_REQUIRED |
| G-EP-058 | POST /v1/company/contacts (WRITE) | AUTHORITY_REQUIRED |
| G-EP-059 | POST /v1/company/opportunities (WRITE) | AUTHORITY_REQUIRED |
| G-EP-060 | POST /v1/company/opportunities/:id/stage (WRITE) | AUTHORITY_REQUIRED |
| G-EP-061 | POST /v1/company/invoices (WRITE) | AUTHORITY_REQUIRED |
| G-EP-062 | POST /v1/company/invoices/:id/issue (WRITE) | AUTHORITY_REQUIRED |
| G-EP-063 | POST /v1/company/invoices/:id/void (WRITE) | AUTHORITY_REQUIRED |
| G-EP-064 | POST /v1/company/payments (WRITE) | AUTHORITY_REQUIRED |
| G-EP-065 | POST /v1/company/contracts (WRITE) | AUTHORITY_REQUIRED |
| G-EP-066 | POST /v1/company/contracts/:id/transition (WRITE) | AUTHORITY_REQUIRED |
| G-EP-070 | GET /v1/academy/:id (READ) | INTEGRATED_NOT_VERIFIED |
| G-EP-074 | GET /v1/reviews/:reviewId (READ) | INTEGRATED_NOT_VERIFIED |
| G-EP-075 | POST /v1/system/workos/journal/repair-torn-tail (WRITE) | AUTHORITY_REQUIRED |

## Known defects found by the auditors (not fixed; fixes need the authority shown)

| Defect | Evidence | Authority |
|---|---|---|
| Desktop "Export delivery package" always fails: `apiPost` scrubs absolute paths in 2xx bodies, so `body.path` becomes `[path]` and `deliveryExportCheck` returns DELIVERY_ARTIFACT_MISSING | `main.mjs:190,211-219,224`; reproduced (`raw/g-i-evidence.json` repro.exportDelivery: sanitizedPath `[path]`, bridgeCheck DELIVERY_ARTIFACT_MISSING) | protected `apps/desktop/main.mjs` (G-EP-085) |
| Desktop "Show export in folder" always fails: `psExportPathFromBody` expects path/filePath/exportPath/archivePath, the API returns a relative `export.file` | `main.mjs:160-165`, `core/workos/types.ts:24`; reproduced (candidatePath null) | protected `main.mjs` (G-EP-084) |
| Company OS writes (10 POST routes) are served and API-tested but not in the desktop POST allow-list, so 6 company screens can only show EMPTY | `main.mjs:114-117`; G-EP-057..066, G-FB-130..139 | protected `main.mjs` + Founder approval-class decision |
| Action gateway permissive defaults (scope, data, budget, adapter all true; tenant `local`); invoice issue/void, payments and contract SIGNED never reach the approval-class gate | `server.ts:156-167`, `core/action-gateway/policy.ts:8-10,30-34` | protected `server.ts` (PT-035) |
| `/v1/founder-attention` (7 views) returns only legacy data and omits Work OS founder items | G-FB-003; `server.ts:122` | protected `server.ts` |
| Allow-list accepts evidence `limit` up to 999 and git/log `limit` up to 500 and `HEAD~N`; the server caps at 100/200 and rejects `HEAD~N` | backend-data auditor findings | protected `main.mjs` / `control-boundary.mjs` |
| `GET /v1/work-runs` ships full evidence and checkpoint arrays to 13 views on every poll, no paging | backend-data auditor findings | protected `server.ts` |

## Frontend code register (`raw/frontend.csv`, 169 rows; evidence, not work items)

- Rows: MOD 66, STORE 2, ROUTE 24, API 70, IPC 7 (MOD = renderer modules, ROUTE = routes, API = api.js client functions, IPC = preload/main channels, STORE = state stores).
- Status: INTEGRATED_NOT_VERIFIED 148, PENDING_CI 14, PENDING_REVIEW 4, MERGED_NOT_INTEGRATED 3.
- All 64 renderer JS modules on v7 are reachable from `app.js`; 19 routes are registered on v7 (`routes.js:16-36`); 5 more exist only on open PRs (`#/audit` #27, `#/integrations` #28, `#/domains` #32, `#/scheduler` #33, `#/providers` #8).
- Code present but never executed from the UI: `api.stale()`, `api.exportItem()`, `api.delivery()` (PT-105) and the unreachable `plannedPanel` fallback (removed by PR #20, PT-103).
- Protected renderer entry points (`app.js`, `index.html`, `preload.mjs`, `main.mjs`) mean new views plug in through `views/planned.js` component delegates.
