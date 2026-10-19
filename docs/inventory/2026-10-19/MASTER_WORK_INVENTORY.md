<!-- //TR: UASCO ana is envanteri 2026-10-19: tum boyutlarin (ekran, calisma alani, UX karari, faz, rol, lab, endpoint, veri, platform gorevi) ayri tablolari ve hesaplanmis yonetici ozeti / Master work inventory with separate per-dimension tables and the computed executive summary -->

# Master work inventory, 2026-10-19

Base: `origin/v7/integration @ e12dbdd`. Live GitHub re-check: 2026-10-19T04:45Z; critic re-check 2026-10-19T05:10Z (stale PR heads and superseded CLEAN claims annotated in the record fields; no status or count changed; see `README.md` "Critic corrections"). Method, definitions and formulas: `README.md`. Full record fields for every row: `master-work-inventory.csv` (1364 rows, 25 fields). Machine-readable totals: `master-work-inventory.json`.

## Executive summary (computed from the files)

- **Product verification: 0.** No screen, workspace, endpoint or task has a recorded run of the real desktop app against a live backend. No item is DELIVERABLE for 2026-10-31 on current evidence.
- **Screens: 85 of 246 unique screens are working today** in the sense used here (merged on v7/integration and wired, INTEGRATED_NOT_VERIFIED). Only 23 of them are fully wired (UI and API both YES); the other 62 cover part of the screen's function. 9 screens exist only on open PRs awaiting CI. 145 need Founder/admin authority (mostly a protected endpoint or desktop allow-list entry). 7 are renderer-only gaps. 131 screens have no code at all.
- **Platform and governance: 107 unique tasks**; 10 integrated (none verified), 7 obsolete, 90 remaining, of which 26 need authority, 24 wait for CI and 6 are blocked.
- **CI: no head has ever had a green `validate (windows-latest)`.** The real run on `e12dbdd` failed on both OSes. The repository is now **public**, so GitHub-hosted runs work again at $0 on new heads, which conflicts with the private-repo + CircleCI directive. CircleCI is not connected (no `.circleci/` anywhere).
- **Merge gate: none is enforced.** No ruleset, no branch protection, one GitHub identity for every review object (141 counted at about 04:00Z plus 5 posted at 04:41Z; all COMMENT, 0 APPROVED), coded gate only on PR #11 (head moved after a BLOCKED pre-review). 9 PRs were merged with red Windows validate.
- **PR backlog: 38 open PRs; 35 carry code awaiting CI or review**, none is CLEAN_NOT_MERGED.
- **Roles:** 599, all DESIGN_ONLY except 15 MERGED_NOT_INTEGRATED; 0 of 3594 evaluation specs executed. **Phases:** 0 of 149 closed. **Labs:** 24 of 25 not implemented.

## Totals per dimension (rows are not additive across dimensions)

| Dimension | Rows | Unique | DESIGN_ONLY | NOT_STARTED | IN_PROGRESS | IMPLEMENTED_NOT_TESTED | PENDING_REVIEW | PENDING_CI | MERGED_NOT_INTEGRATED | INTEGRATED_NOT_VERIFIED | BLOCKED | AUTHORITY_REQUIRED | DUPLICATE | OBSOLETE |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| screens | 252 | 246 | 7 |  |  |  |  | 9 |  | 85 |  | 145 | 6 |  |
| workspaces | 18 | 18 |  |  |  |  |  | 1 |  | 13 |  | 4 |  |  |
| ux-decisions | 71 | 71 | 3 |  |  |  |  | 2 |  | 36 | 1 | 29 |  |  |
| phases | 149 | 149 | 100 |  | 33 |  |  |  | 9 | 3 |  | 4 |  |  |
| roles | 599 | 599 | 584 |  |  |  |  |  | 15 |  |  |  |  |  |
| labs | 25 | 25 | 15 |  | 1 |  |  |  |  |  |  | 9 |  |  |
| endpoints | 85 | 85 |  |  |  |  |  |  |  | 60 |  | 17 |  | 8 |
| data-persistence | 43 | 43 | 4 |  |  |  |  |  | 6 | 24 |  | 6 |  | 3 |
| tasks | 107 | 107 | 2 | 7 | 8 | 5 | 4 | 24 | 8 | 10 | 6 | 26 |  | 7 |
| requirement-sets | 15 | 15 | 15 |  |  |  |  |  |  |  |  |  |  |  |

## Screens (252 baseline rows; details in `SCREEN_AUDIT_252.md`)

| Status | Count |
|---|---|
| DESIGN_ONLY | 7 |
| PENDING_CI | 9 |
| INTEGRATED_NOT_VERIFIED | 85 |
| AUTHORITY_REQUIRED | 145 |
| DUPLICATE | 6 |

ui_connected: NO 137, PARTIAL 87, YES 28. api_connected: NO 154, YES 81, PARTIAL 17. product_verified: NO 252. oct31_impact: NOT_DELIVERABLE 128, AT_RISK 105, NONE 19.

## Desktop workspaces SC-01..SC-18

Workspace status is as reported by the workspace auditor (aggregate of its host routes). The screen columns use the normalized screen statuses; 18 mobile screens belong to no workspace.

| ID | Workspace | Status | Screens | INV | PENDING_CI | AUTH | DESIGN | DUP | PRs |
|---|---|---|---|---|---|---|---|---|---|
| WS-SC-01 | SC-01 Global Desktop Shell | INTEGRATED_NOT_VERIFIED | 22 | 16 | 0 | 2 | 3 | 1 | #20 |
| WS-SC-02 | SC-02 Founder Cockpit / Home | INTEGRATED_NOT_VERIFIED | 4 | 3 | 0 | 0 | 1 | 0 | #19, #36 |
| WS-SC-03 | SC-03 Projects / Portfolio | INTEGRATED_NOT_VERIFIED | 8 | 6 | 0 | 1 | 1 | 0 | #40 |
| WS-SC-04 | SC-04 Project Journey / Studio | INTEGRATED_NOT_VERIFIED | 2 | 2 | 0 | 0 | 0 | 0 | #44, #46 |
| WS-SC-05 | SC-05 Founder Command / BA / Revision | AUTHORITY_REQUIRED | 6 | 0 | 0 | 6 | 0 | 0 | none |
| WS-SC-06 | SC-06 Planning / Architecture Studio | AUTHORITY_REQUIRED | 8 | 1 | 0 | 7 | 0 | 0 | none |
| WS-SC-07 | SC-07 Missions / Work OS | INTEGRATED_NOT_VERIFIED | 9 | 4 | 0 | 4 | 1 | 0 | #47 |
| WS-SC-08 | SC-08 Agents / Workforce (+ Skill Academy) | INTEGRATED_NOT_VERIFIED | 20 | 10 | 2 | 8 | 0 | 0 | #22, #48, #38 |
| WS-SC-09 | SC-09 Assurance / QA + Security | INTEGRATED_NOT_VERIFIED | 30 | 5 | 1 | 23 | 0 | 1 | #41, #26, #25, #24 |
| WS-SC-10 | SC-10 Independent Review / Evidence | PENDING_CI | 8 | 2 | 4 | 2 | 0 | 0 | #24, #25, #26, #27 |
| WS-SC-11 | SC-11 Delivery / Release + SRE | INTEGRATED_NOT_VERIFIED | 14 | 6 | 0 | 8 | 0 | 0 | #45 |
| WS-SC-12 | SC-12 Control Tower 2D / 3D | INTEGRATED_NOT_VERIFIED | 8 | 6 | 1 | 1 | 0 | 0 | #23, #34 |
| WS-SC-13 | SC-13 Inbox / Alerts + Approvals | INTEGRATED_NOT_VERIFIED | 7 | 5 | 0 | 2 | 0 | 0 | #39 |
| WS-SC-14 | SC-14 Knowledge / Project Memory | AUTHORITY_REQUIRED | 12 | 0 | 0 | 12 | 0 | 0 | none |
| WS-SC-15 | SC-15 Company OS / CRM / Finance / Legal | INTEGRATED_NOT_VERIFIED | 34 | 6 | 0 | 25 | 0 | 3 | #43 |
| WS-SC-16 | SC-16 Operations & Recovery | INTEGRATED_NOT_VERIFIED | 12 | 6 | 0 | 6 | 0 | 0 | #33 |
| WS-SC-17 | SC-17 Settings / Provider / Installation | INTEGRATED_NOT_VERIFIED | 29 | 7 | 1 | 19 | 1 | 1 | #8, #28, #27, #32, #35, #37, #42 |
| WS-SC-18 | SC-18 RE / Authorized Analysis Lab (optional) | AUTHORITY_REQUIRED | 1 | 0 | 0 | 1 | 0 | 0 | none |

| Status | Count |
|---|---|
| PENDING_CI | 1 |
| INTEGRATED_NOT_VERIFIED | 13 |
| AUTHORITY_REQUIRED | 4 |

ui_connected: YES 13, PARTIAL 3, NO 2. api_connected: YES 10, PARTIAL 6, NO 2. product_verified: NO 18. oct31_impact: AT_RISK 14, NOT_DELIVERABLE 3, NONE 1.

## UX decisions UX-DEC-001..071

Texts are UNKNOWN_SOURCE; status is judged against stale summary titles (confidence LOW for the INTEGRATED rows).

| Status | Count |
|---|---|
| DESIGN_ONLY | 3 |
| PENDING_CI | 2 |
| INTEGRATED_NOT_VERIFIED | 36 |
| BLOCKED | 1 |
| AUTHORITY_REQUIRED | 29 |

ui_connected: YES 36, NO 26, PARTIAL 9. api_connected: YES 35, NO 28, PARTIAL 8. product_verified: NO 71. oct31_impact: AT_RISK 43, NOT_DELIVERABLE 28.

## Roadmap phases PH-000..PH-148

0 phases closed; no `phase-NNN-evidence.json` exists. Phase 0 (Founder signature + target-machine acceptance) formally gates phases 1-148. All 149 contracts still name the retired Codex review.

| Status | Count |
|---|---|
| DESIGN_ONLY | 100 |
| IN_PROGRESS | 33 |
| MERGED_NOT_INTEGRATED | 9 |
| INTEGRATED_NOT_VERIFIED | 3 |
| AUTHORITY_REQUIRED | 4 |

ui_connected: NO 121, PARTIAL 18, YES 10. api_connected: NO 115, PARTIAL 22, YES 12. product_verified: NO 149. oct31_impact: NONE 109, AT_RISK 36, NOT_DELIVERABLE 4.

- INTEGRATED_NOT_VERIFIED: PH-019, PH-026, PH-045
- MERGED_NOT_INTEGRATED: PH-014, PH-023, PH-029, PH-030, PH-032, PH-036, PH-038, PH-063, PH-104
- AUTHORITY_REQUIRED: PH-000, PH-044, PH-147, PH-148
- IN_PROGRESS (33): PH-001, PH-002, PH-003, PH-004, PH-006, PH-007, PH-015, PH-018, PH-020, PH-021, PH-022, PH-025, PH-027, PH-031, PH-033, PH-034, PH-035, PH-037, PH-039, PH-040, PH-041, PH-042, PH-046, PH-048, PH-077, PH-088, PH-089, PH-093, PH-101, PH-102, PH-124, PH-125, PH-127

## Specialist roles (599)

All 599 RoleDefinitions have lifecycle TARGET, runtimeStatus UNKNOWN, proficiency NOT_EVALUATED; 0 of 3594 evaluation specs executed; 0 certified. 15 roles (13 PRE_DEV + 2 crew dev/review) have orchestration code merged that runs only with fixtures in tests.

| Status | Count |
|---|---|
| DESIGN_ONLY | 584 |
| MERGED_NOT_INTEGRATED | 15 |

ui_connected: PARTIAL 599. api_connected: PARTIAL 599. product_verified: NO 599. oct31_impact: NOT_DELIVERABLE 496, NONE 88, AT_RISK 15.

## Execution labs (25)

| ID | Lab | Status | Oct 31 | Authority needed |
|---|---|---|---|---|
| F-LAB-01 | Browser & Web Execution Lab | DESIGN_ONLY | NOT_DELIVERABLE | Cloud browser vendor accounts (BrowserStack/Sauce/LambdaTest = paid, forbidden without Fou |
| F-LAB-02 | Mobile Device Lab | AUTHORITY_REQUIRED | NOT_DELIVERABLE | Physical Android/iOS devices, macOS worker, paid device farms - Founder authority |
| F-LAB-03 | Desktop & OS Application Lab | DESIGN_ONLY | NOT_DELIVERABLE | macOS hardware worker; Windows execution via cloud CI only (Founder: no local PC) |
| F-LAB-04 | Universal Test Environment & Sandbox Fabric | AUTHORITY_REQUIRED | AT_RISK | Founder decision FD-REL-1-REJECT-HOST-EXEC-2026-10-15: no host execution; sandbox provider |
| F-LAB-05 | Network & Protocol Lab | DESIGN_ONLY | NOT_DELIVERABLE | Network egress policy for test targets |
| F-LAB-06 | Identity & Access Lab | DESIGN_ONLY | NOT_DELIVERABLE | Test IdP tenants/credentials (Test Credential Broker not implemented) |
| F-LAB-07 | Messaging & Notification Lab | DESIGN_ONLY | NOT_DELIVERABLE | Real SMS/email provider accounts (paid) if beyond local capture |
| F-LAB-08 | Data, Database & Storage Lab | DESIGN_ONLY | NOT_DELIVERABLE | Sandbox for DB containers |
| F-LAB-09 | Cloud & Infrastructure Lab | AUTHORITY_REQUIRED | NOT_DELIVERABLE | Cloud accounts/billing (paid resources forbidden without Founder approval) |
| F-LAB-10 | Security Engineering Lab | IN_PROGRESS | AT_RISK | Authorized security assessment of targets is risk-4/5 (Founder authority); semgrep/trivy D |
| F-LAB-11 | Performance, Profiling & Resource Lab | DESIGN_ONLY | NOT_DELIVERABLE | Sandbox; paid load-generation infra if any |
| F-LAB-12 | Observability, Diagnostics & Forensics Lab | DESIGN_ONLY | NOT_DELIVERABLE | Sandbox |
| F-LAB-13 | File, Document & Content Lab | DESIGN_ONLY | NOT_DELIVERABLE | Sandbox for untrusted files (Untrusted Artifact Quarantine FAB-034 not implemented) |
| F-LAB-14 | Accessibility & Human Interaction Lab | DESIGN_ONLY | NOT_DELIVERABLE | Windows/macOS/mobile workers for real screen readers |
| F-LAB-15 | Localization & Globalization Lab | DESIGN_ONLY | NOT_DELIVERABLE | None beyond sandbox |
| F-LAB-16 | Payment & FinTech Transaction Lab | AUTHORITY_REQUIRED | NOT_DELIVERABLE | Payment provider sandbox accounts; any live payment = risk-5 Founder authority |
| F-LAB-17 | AI, ML & LLM Assurance Lab | DESIGN_ONLY | NOT_DELIVERABLE | Model provider usage for evals (cost authority) |
| F-LAB-18 | CI/CD, SCM & Work-Management Integration Fabric | AUTHORITY_REQUIRED | AT_RISK | Founder must install/authorize CircleCI GitHub App with minimal repo scope; branch protect |
| F-LAB-19 | Release, Distribution & Store Lab | AUTHORITY_REQUIRED | NOT_DELIVERABLE | Store developer accounts, code-signing certificates (Founder authority) |
| F-LAB-20 | Legacy & Enterprise Systems Lab | DESIGN_ONLY | NOT_DELIVERABLE | Access to legacy systems/emulators |
| F-LAB-21 | Embedded, IoT & Hardware Lab | AUTHORITY_REQUIRED | NOT_DELIVERABLE | Physical hardware/HIL devices (Founder authority) |
| F-LAB-22 | XR, 3D & Media Lab | AUTHORITY_REQUIRED | NOT_DELIVERABLE | GPU workers and XR devices (Founder authority, possibly paid) |
| F-LAB-23 | Game Execution & Device Lab | AUTHORITY_REQUIRED | NOT_DELIVERABLE | GPU, consoles/devkits only when authorized (COMPLETENESS-BASELINE.md:469) |
| F-LAB-24 | Blockchain & Smart-Contract Lab | DESIGN_ONLY | NOT_DELIVERABLE | Any mainnet transaction = risk-5 Founder authority |
| F-LAB-25 | GIS, Location & Mapping Lab | DESIGN_ONLY | NOT_DELIVERABLE | Map provider API keys if used |

## Backend endpoints (76 HTTP + 9 IPC)

| Status | Count |
|---|---|
| INTEGRATED_NOT_VERIFIED | 60 |
| AUTHORITY_REQUIRED | 17 |
| OBSOLETE | 8 |

ui_connected: YES 64, NO 16, PARTIAL 5. api_connected: YES 85. product_verified: NO 85. oct31_impact: AT_RISK 59, NONE 13, NOT_DELIVERABLE 13.

Not integrated:

| ID | Endpoint | Status | Authority needed |
|---|---|---|---|
| G-EP-005 | GET /v1/scheduler (READ) | OBSOLETE | Founder product decision (keep/remove legacy scheduler surface) |
| G-EP-012 | GET /v1/retry (READ) | OBSOLETE | NONE |
| G-EP-014 | GET /v1/runs (READ) | OBSOLETE | Founder product decision (legacy surface) |
| G-EP-015 | GET /v1/runs/:runId/events (READ) | OBSOLETE | NONE |
| G-EP-016 | GET /v1/runs/:runId/logs (READ) | OBSOLETE | NONE |
| G-EP-017 | GET /v1/runs/:runId/logs/:name (READ) | OBSOLETE | NONE |
| G-EP-020 | POST /v1/control/retry-blocked (WRITE) | OBSOLETE | NONE |
| G-EP-034 | POST /v1/work-runs/:id/delivery/export (WRITE) | AUTHORITY_REQUIRED | FA for protected apps/desktop/main.mjs edit (Founder/Local maintainer) |
| G-EP-037 | POST /v1/projects/:id/devrun/start (WRITE) | AUTHORITY_REQUIRED | Founder risk decision FD-REL-1 / D-SBX (sandbox provider registration) |
| G-EP-039 | POST /v1/projects/:id/devrun/restart (WRITE) | AUTHORITY_REQUIRED | Founder risk decision FD-REL-1 / D-SBX (sandbox provider registration) |
| G-EP-057 | POST /v1/company/accounts (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-058 | POST /v1/company/contacts (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-059 | POST /v1/company/opportunities (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-060 | POST /v1/company/opportunities/:id/stage (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-061 | POST /v1/company/invoices (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-062 | POST /v1/company/invoices/:id/issue (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-063 | POST /v1/company/invoices/:id/void (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-064 | POST /v1/company/payments (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-065 | POST /v1/company/contracts (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-066 | POST /v1/company/contracts/:id/transition (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs allow-list + risk decision for financial/legal actions (approval class) |
| G-EP-075 | POST /v1/system/workos/journal/repair-torn-tail (WRITE) | AUTHORITY_REQUIRED | Founder: protected main.mjs POST allow-list + recovery UX decision |
| G-EP-081 | IPC uasco:retry-blocked - Retry technically blocked legacy package | OBSOLETE | NONE |
| G-EP-083 | IPC uasco:open-preview - Open dev-run preview in default browser | AUTHORITY_REQUIRED | Founder risk decision FD-REL-1 / D-SBX |
| G-EP-084 | IPC uasco:show-export - Show project export in folder | AUTHORITY_REQUIRED | FA for protected apps/desktop/main.mjs |
| G-EP-085 | IPC uasco:export-delivery - Export verified delivery package (save dialog, sha256 re-check) | AUTHORITY_REQUIRED | FA for protected apps/desktop/main.mjs |

## Data / persistence (43)

| Status | Count |
|---|---|
| DESIGN_ONLY | 4 |
| MERGED_NOT_INTEGRATED | 6 |
| INTEGRATED_NOT_VERIFIED | 24 |
| AUTHORITY_REQUIRED | 6 |
| OBSOLETE | 3 |

ui_connected: YES 19, NO 12, PARTIAL 12. api_connected: YES 30, NO 9, PARTIAL 4. product_verified: NO 43. oct31_impact: AT_RISK 29, NONE 7, NOT_DELIVERABLE 7.

| ID | Item | Status |
|---|---|---|
| I-DP-007 | Task entity (tsk_*, dependsOn, status) under missions | MERGED_NOT_INTEGRATED |
| I-DP-013 | Dev-run persistence (devrun/state.json pid+start time+owner, 256 KB redacted log rings, de | AUTHORITY_REQUIRED |
| I-DP-014 | Company OS CRM records (accounts, contacts with PII, opportunities + stage) in the shared  | AUTHORITY_REQUIRED |
| I-DP-015 | Company OS Finance records (invoices, numbering, issue/void, payments + reversal, minor-un | AUTHORITY_REQUIRED |
| I-DP-016 | Company OS Legal records (contracts, transitions, SIGNED with documentSha256/signer) | AUTHORITY_REQUIRED |
| I-DP-017 | Skill Academy records (sources, learnings lifecycle, promotion/global knowledge, reuse eve | MERGED_NOT_INTEGRATED |
| I-DP-018 | Pre-dev sequence + typed artifacts (BUSINESS_ANALYSIS..PLAN, validators, supersession) in  | MERGED_NOT_INTEGRATED |
| I-DP-020 | Crew coordinator + team composer + team read model (writers / composition) | MERGED_NOT_INTEGRATED |
| I-DP-030 | JSON Schema catalog (152 schemas/*.schema.json incl. project, mission, task, customer, inv | MERGED_NOT_INTEGRATED |
| I-DP-033 | Legacy V6 scheduler state (scheduler-state.json, 149-phase DAG, Ed25519 completion attesta | OBSOLETE |
| I-DP-034 | Legacy V6 run ledger (runtime/runs/RUN-*: hash-chained events, redacted logs, Ed25519 seal | OBSOLETE |
| I-DP-035 | Legacy supervisor retry/checkpoint state (SUPERVISOR_RETRY.json, supervisor-checkpoint.jso | OBSOLETE |
| I-DP-036 | Atomic cross-environment task lease (git-ref CAS store) + SHA/session-bound reviewer verdi | AUTHORITY_REQUIRED |
| I-DP-037 | core/resources lease manager + resource registry (in-memory) | MERGED_NOT_INTEGRATED |
| I-DP-039 | Project Memory (persistent per-project knowledge/decision memory and revisions; UI-160 'Be | DESIGN_ONLY |
| I-DP-040 | Backup / restore / recovery objective for Work OS data and managed repos | DESIGN_ONLY |
| I-DP-041 | Journal/data migration and schema versioning | DESIGN_ONLY |
| I-DP-042 | Retention, erasure, legal hold, customer offboarding (PII in CRM contacts) | DESIGN_ONLY |
| I-DP-043 | Governance evidence persistence: Founder authorization ledger and governed reviewer verdic | AUTHORITY_REQUIRED |

## Platform + governance tasks (107 unique)

| Status | Count |
|---|---|
| DESIGN_ONLY | 2 |
| NOT_STARTED | 7 |
| IN_PROGRESS | 8 |
| IMPLEMENTED_NOT_TESTED | 5 |
| PENDING_REVIEW | 4 |
| PENDING_CI | 24 |
| MERGED_NOT_INTEGRATED | 8 |
| INTEGRATED_NOT_VERIFIED | 10 |
| BLOCKED | 6 |
| AUTHORITY_REQUIRED | 26 |
| OBSOLETE | 7 |

ui_connected: NO 105, PARTIAL 2. api_connected: NO 104, PARTIAL 2, YES 1. product_verified: NO 107. oct31_impact: AT_RISK 65, NONE 36, NOT_DELIVERABLE 6.

| ID | Task | Status | Pri | Consolidated from | PRs |
|---|---|---|---|---|---|
| PT-001 | Base CI green on both OSes for v7/integration (ci.yml validate ubuntu-latest + windows-latest, Node 24) | BLOCKED | P0 | QS-002, CI-01 | #49 |
| PT-002 | Free hosted CI capacity: GitHub-hosted runners at $0 because the repository is public | IN_PROGRESS | P0 | CI-07, BL-CI-01 | #49, #50 |
| PT-003 | Ordered test sharding (8 shards) + ci.yml rewrite + protected reseal (PR #49) | BLOCKED | P0 | CI-03, QS-003, BL-CI-06 | #49 |
| PT-004 | Linux: shard tests-2 hangs to the 600 s cap after earlier steps (passes in isolation) | IN_PROGRESS | P0 | CI-04, QS-005 | #49 |
| PT-005 | Windows-latest: real test failures in 9 steps (tests-2/-5/-6/-8, tests-bs1-a/-c/-d/-e/-f) | IN_PROGRESS | P0 | QS-006, CI-05 | #49 |
| PT-006 | SHA-bound CI evidence binder (CI_EVIDENCE.json bound to GITHUB_SHA + PR head SHA) on PR #49 | PENDING_REVIEW | P1 | CI-06, QS-004 | #49 |
| PT-007 | CircleCI Free cloud CI: Linux + Windows jobs, Node 24, shards, SHA-bound status to GitHub (least-privilege GitHub App) | AUTHORITY_REQUIRED | P0 | CI-08, QS-015, BL-CI-02 | none |
| PT-008 | Canonical validation runner + suite (config/validation.json 41 steps, 117 test files) | INTEGRATED_NOT_VERIFIED | P0 | QS-001, CI-02, PR-2 | #2 |
| PT-009 | Windows-only test platform filtering reports SKIP/NOT_RUN, never PASS, on Linux | INTEGRATED_NOT_VERIFIED | P1 | QS-007 | merged |
| PT-010 | Self-hosted Windows runner CI path (runner 21 DESKTOP-G4U0679, PR #30) | OBSOLETE | P1 | AG-017, CI-11, CI-13, BL-CI-09, PR-30 | #30, #49 |
| PT-011 | Deregister old self-hosted runner 21 (public-repo risk: workflows can target it) | AUTHORITY_REQUIRED | P0 | CI-12 | none |
| PT-012 | Repository visibility is PUBLIC: reconcile with the private-repo directive; exposure assessment | AUTHORITY_REQUIRED | P0 | BL-CI-11, QS-014 | #49, #30 |
| PT-013 | CP-CI interim cloud CI-equivalent evidence shaper, explicitly not a verdict (PR #12) | PENDING_CI | P3 | BL-CP-03, AG-013, CI-14, PR-12 | #12 |
| PT-014 | Cloud Node 24 environment (.nvmrc + scripts/cloud-ensure-node24.sh, PR #21) | PENDING_CI | P1 | BL-CP-07, AG-014, CI-15, PR-21 | #21 |
| PT-015 | Desktop E2E harness: real Electron Desktop + real Control API route verification (PR #50) | BLOCKED | P1 | QS-016, CI-16, BL-QA-09 | #50 |
| PT-016 | PR backlog: re-queue all open PRs for CI + final independent verdict + governed merge in dependency order | BLOCKED | P0 | CI-17, BL-CI-10 | #8, #11, #12, #15-#29, #31-#50 |
| PT-017 | Defect (local run): evidence redaction leaks /root (core/evidence/index.ts:292-296 masks only /home/* and /Users/*) | NOT_STARTED | P1 | raw/g-i-evidence.json | none |
| PT-018 | Defect (local run): pkg-aut1 F001 GLOBAL_STOP does not terminate the running command tree on Linux | NOT_STARTED | P1 | raw/g-i-evidence.json | none |
| PT-019 | Defect (local run): pkg-t3 omniroute install-compat fails with NPM_ROOT_UNAVAILABLE instead of honest skip | NOT_STARTED | P3 | raw/g-i-evidence.json | none |
| PT-020 | npm audit egress workaround in cloud sessions (DEPENDENCY_AUDIT_INVALID_RESPONSE) | OBSOLETE | P3 | BL-CI-07 | none |
| PT-021 | Coded merge gate scripts/merge-via-gate.mjs + integration-branch protection helper (PR #11) | PENDING_REVIEW | P0 | AG-025, CI-09, BL-CI-04 | #11 |
| PT-022 | Merge-gate CI-context binding for the chosen CI provider (gate hard-codes GitHub validate contexts) | AUTHORITY_REQUIRED | P0 | BL-CI-03, AG-033 | #11, #49 |
| PT-023 | Branch protection / ruleset on v7/integration (required both-OS checks, no bypass, no force-push) | AUTHORITY_REQUIRED | P0 | AG-026, CI-10, BL-CI-05 | #11, #49 |
| PT-024 | Second, distinct GitHub reviewer/approver identity (no self-approval; common-mode risk) | AUTHORITY_REQUIRED | P0 | AG-031, BL-GOV-01 | #31 |
| PT-025 | Atomic per-task lease + SHA/session-bound verdict guard (PR #10, merged, imported only by tests) | MERGED_NOT_INTEGRATED | P0 | AG-019, AG-020, PR-10 | #10, #11 |
| PT-026 | FA-LEASE2: wire lease + verdict guard into six protected files | AUTHORITY_REQUIRED | P0 | AG-021, BL-GOV-02 | #11, #10 |
| PT-027 | CP-GOV Phase-0: separate-identity governance design + non-protected reference verifier (PR #31) | PENDING_CI | P1 | AG-028, BL-GOV-03, PR-31 | #31, #15 |
| PT-028 | CP-GOV Phase 1+: separate-identity seal/reseal, D3 issuance, KMS custody, M-of-N quorum | AUTHORITY_REQUIRED | P1 | AG-029 | none |
| PT-029 | Trust-root reseal authority per protected change + reseal serialization owner | AUTHORITY_REQUIRED | P0 | AG-032, BL-GOV-04 | #49, #8 |
| PT-030 | Post-merge verification of already merged v7 PRs #1-#7, #9, #10 (merged with red Windows validate; no CLEAN bound to merged head) | NOT_STARTED | P1 | AG-034 | #1, #2, #3, #4, #5, #6, #7, #9, #10 |
| PT-031 | DOC-TRUTH: stale sealed CANONICAL-STATUS.md and .ai state served by GET /v1/factory; release-gate seal currency | AUTHORITY_REQUIRED | P2 | BL-GOV-05, RD-09 | #49 |
| PT-032 | WFR-03 role-registry validation step (needs protected config/validation.json) | AUTHORITY_REQUIRED | P2 | BL-GOV-06 | none |
| PT-033 | Legacy configure-github-protection.mjs (targets main, no required checks) | OBSOLETE | P3 | AG-027 | none |
| PT-034 | Standalone node proofs of docs/** modules are outside canonical validation/CI | AUTHORITY_REQUIRED | P1 | QS-018 | #11, #12, #17, #18, #29, #31 |
| PT-035 | Security: action gateway wired with permissive defaults (server.ts:156-167 tenant local; scope/data/budget/adapter = true; finance/legal writes skip approval class) | AUTHORITY_REQUIRED | P1 | phases + backend auditor findings | none |
| PT-036 | Governed CLAUDE_REVIEWER pipeline (review-pipeline / review-quorum / review-governance / reviewer broker) | INTEGRATED_NOT_VERIFIED | P1 | AG-022 | merged pre-v7 (e12dbdd) |
| PT-037 | Independent cloud reviewer routine + review coverage of the PR backlog | IN_PROGRESS | P0 | AG-002, QS-017 | #8-#49, #8-#50 |
| PT-038 | Codex reviewer broker (retired review path) | OBSOLETE | P3 | AG-023 | none |
| PT-039 | Routine 'UASCO Cloud Development' (hourly cloud implementer) | BLOCKED | P1 | AG-001 | #16, #17, #18, #19, #20, #21, #22, #23, #24, #25, #26, #27, #28, #29 |
| PT-040 | Production heartbeat routine + CP-RECOVERY persistent scheduled executors | IN_PROGRESS | P2 | AG-003, BL-CP-06 | none |
| PT-041 | Routine '05:00 TRT morning production report' (one-shot) | BLOCKED | P2 | AG-004 | none |
| PT-042 | Orchestrator follow-up / safety-net reminder routines (session-bound) | IN_PROGRESS | P3 | AG-005 | #9, #10, #11, #49 |
| PT-043 | Disabled 'UASCO Cloud Development' probe routine (duplicate name) | OBSOLETE | P3 | AG-006 | none |
| PT-044 | Cloud orchestrator / cloud supervisor session (UASCO Master V2) | IN_PROGRESS | P1 | AG-007 | #11, #15, #31, #30, #49 |
| PT-045 | Cloud implementer / maintainer child-session fan-out | IN_PROGRESS | P1 | AG-008 | #12, #13, #14, #31, #32, #33, #34-#48, #50, #21, #30, #38, #42, #49 |
| PT-046 | UASCO-LOOP-RECORD PR poller ('uasco-github-sync (deterministic)'; source off-repo) | INTEGRATED_NOT_VERIFIED | P2 | AG-009 | #4, #8-#48, #30 |
| PT-047 | CP-ENGINE: cloud-first production engine contract + honest QUEUE.json + RECOVERY/DECISIONS docs (PR #15) | PENDING_CI | P2 | BL-CP-05, AG-010, PR-15 | #15, #31 |
| PT-048 | CP-QUEUE persistent cloud task-queue manager (PR #17; first version #14 DUPLICATE, closed) | PENDING_CI | P2 | BL-CP-01, AG-011, PR-17, PR-14 | #17, #14 |
| PT-049 | CP-REPORT 60-minute production reporter (PR #18; first version #13 DUPLICATE, closed) | PENDING_CI | P2 | BL-CP-02, AG-012, PR-18, PR-13 | #18, #13 |
| PT-050 | CP-DISPATCH cloud next-task dispatcher with claim refs + lease record (PR #29) | PENDING_CI | P1 | BL-CP-04, AG-030, PR-29 | #29 |
| PT-051 | Canonical backlog checkpoint docs/planning/BACKLOG_CHECKPOINT.json (BACKLOG-SOURCE-REBASELINE, PR #16) | PENDING_REVIEW | P1 | BL-AUT-01, AG-015, PR-16 | #16, #11 |
| PT-052 | Next-step engine reference (selectNext auto-advance) + loop proof + backlog validator (PR #11) | PENDING_REVIEW | P1 | BL-AUT-02, AG-024 | #11 |
| PT-053 | 72-hour continuous-operation endurance test | DESIGN_ONLY | P2 | BL-AUT-03, AG-018 | #11 |
| PT-054 | Local unattended orchestrator/supervisor stack (engine/state/executors/daemon; merged code) | INTEGRATED_NOT_VERIFIED | P2 | AG-016 | #1 |
| PT-055 | Activate the local unattended orchestrator on the Founder PC (Task Scheduler) | OBSOLETE | P3 | BL-AUT-04 | none |
| PT-056 | Lane A persistent supervisor SV1-1 -> AS1 -> bridge-merge -> live drill (source only on Founder PC) | AUTHORITY_REQUIRED | P2 | BL-AUT-05 | none |
| PT-057 | Anthropic Managed Agents PoC (API-key billed sessions) | OBSOLETE | P3 | BL-AUT-06 | none |
| PT-058 | Security stage with the real gitleaks binary never executed (tests always skipped) | IMPLEMENTED_NOT_TESTED | P2 | QS-008 | merged |
| PT-059 | secret-sanity baseline secret scanner | INTEGRATED_NOT_VERIFIED | P1 | QS-009 | merged |
| PT-060 | Dependency supply chain + npm audit gate + SBOM-lite + release supply-chain binding | INTEGRATED_NOT_VERIFIED | P1 | QS-010, RD-13 | merged |
| PT-061 | Trust-root / release-truth / release supply-chain / mechanical-closure validators | INTEGRATED_NOT_VERIFIED | P1 | QS-011 | #49 |
| PT-062 | EN/TR validation: //TR marker gate + renderer en/tr locale parity tests | INTEGRATED_NOT_VERIFIED | P2 | QS-012 | #22-#48 |
| PT-063 | GitHub-native security scanning (secret scanning + push protection, Dependabot, CodeQL) | NOT_STARTED | P1 | QS-013 | none |
| PT-064 | Screen test+states hardening: tower (functional / negative / a11y) (PR #34) | PENDING_CI | P2 | QS-019, PR-34 | #34 |
| PT-065 | Screen test+states hardening: executors-panel (functional / negative / a11y) (PR #35) | PENDING_CI | P2 | QS-020, PR-35 | #35 |
| PT-066 | Screen test+states hardening: home (functional / negative / a11y) (PR #36) | PENDING_CI | P2 | QS-021, PR-36 | #36 |
| PT-067 | Screen test+states hardening: firstrun (functional / negative / a11y) (PR #37) | PENDING_CI | P2 | QS-022, PR-37 | #37 |
| PT-068 | Screen test+states hardening: academy (functional / negative / a11y) (PR #38) | PENDING_CI | P2 | QS-023, PR-38 | #38 |
| PT-069 | Screen test+states hardening: inbox (functional / negative / a11y) (PR #39) | PENDING_CI | P2 | QS-024, PR-39 | #39 |
| PT-070 | Screen test+states hardening: projects (functional / negative / a11y) (PR #40) | PENDING_CI | P2 | QS-025, PR-40 | #40 |
| PT-071 | Screen test+states hardening: assurance (functional / negative / a11y) (PR #41) | PENDING_CI | P2 | QS-026, PR-41 | #41 |
| PT-072 | Screen test+states hardening: settings (functional / negative / a11y) (PR #42) | PENDING_CI | P2 | QS-027, PR-42 | #42 |
| PT-073 | Screen test+states hardening: company (functional / negative / a11y) (PR #43) | PENDING_CI | P2 | QS-028, PR-43 | #43 |
| PT-074 | Screen test+states hardening: studio-wizard (functional / negative / a11y) (PR #44) | PENDING_CI | P2 | QS-029, PR-44 | #44 |
| PT-075 | Screen test+states hardening: delivery (functional / negative / a11y) (PR #45) | PENDING_CI | P2 | QS-030, PR-45 | #45 |
| PT-076 | Screen test+states hardening: studio-workspace (functional / negative / a11y) (PR #46) | PENDING_CI | P2 | QS-031, PR-46 | #46 |
| PT-077 | Screen test+states hardening: work (functional / negative / a11y) (PR #47) | PENDING_CI | P2 | QS-032, PR-47 | #47 |
| PT-078 | Screen test+states hardening: workforce (functional / negative / a11y) (PR #48) | PENDING_CI | P2 | QS-033, PR-48 | #48 |
| PT-079 | B2-T-APPROVAL: Unit tests for assertApprovalValid (~10 throw branches) | AUTHORITY_REQUIRED | P3 | BL-QA-01 | none |
| PT-080 | B2-T-RESOLVER: Unit tests for resolveCapability | AUTHORITY_REQUIRED | P3 | BL-QA-02 | none |
| PT-081 | B2-T-TEMPLATES: Unit tests for renderTemplate (all templates, name sanitisation) | AUTHORITY_REQUIRED | P3 | BL-QA-03 | none |
| PT-082 | B2-T-PREDEV: Unit tests for applyPreDevEntry/phaseForKind/derivePreDevReadModel | AUTHORITY_REQUIRED | P3 | BL-QA-04 | none |
| PT-083 | B2-T-ACADEMY: Unit tests for academy apply.ts tamper/malformed paths | AUTHORITY_REQUIRED | P3 | BL-QA-05 | none |
| PT-084 | B2-T-COMPANY: Unit tests for company/common.ts + apply.ts | AUTHORITY_REQUIRED | P3 | BL-QA-06 | none |
| PT-085 | B2-T-SELFTESTS: Vitest wrapper running orphan scripts/*selftest*.mjs | AUTHORITY_REQUIRED | P3 | BL-QA-07 | none |
| PT-086 | B2-SBOM: offline CycloneDX SBOM step replacing NOT_IMPLEMENTED in the mission security stage | AUTHORITY_REQUIRED | P3 | BL-QA-08 | none |
| PT-087 | Windows NSIS installer build (unsigned dev build, electron-builder) | MERGED_NOT_INTEGRATED | P1 | RD-01 | none |
| PT-088 | Installer install test (%TEMP%-only silent install, launch, health, uninstall) | IMPLEMENTED_NOT_TESTED | P2 | RD-02 | none |
| PT-089 | Checksum-verified Electron provisioning | INTEGRATED_NOT_VERIFIED | P2 | RD-03 | #50 |
| PT-090 | Authenticode code signing of installer EXE | AUTHORITY_REQUIRED | P2 | RD-04 | none |
| PT-091 | Release SHA256SUMS generation over clean git-archive export | MERGED_NOT_INTEGRATED | P2 | RD-05 | none |
| PT-092 | Deterministic release ZIP build | MERGED_NOT_INTEGRATED | P2 | RD-06 | none |
| PT-093 | verify-release-extract (Windows Expand-Archive fresh-extract verification --with-validation) | MERGED_NOT_INTEGRATED | P2 | RD-07 | none |
| PT-094 | Founder detached release signature over ZIP + SHA256SUMS | AUTHORITY_REQUIRED | P1 | RD-08 | none |
| PT-095 | Target-machine Phase0 acceptance (signed Phase0 report bound to install/source digests) | AUTHORITY_REQUIRED | P1 | RD-10 | #49 |
| PT-096 | Full PowerShell installer chain (install.ps1, install-prereqs.ps1, bootstrap, install-report correlation) | IMPLEMENTED_NOT_TESTED | P2 | RD-11 | none |
| PT-097 | Evidence signing key init (Ed25519) + key hardening | IMPLEMENTED_NOT_TESTED | P2 | RD-12 | none |
| PT-098 | Windows autostart / scheduled supervisor tasks | IMPLEMENTED_NOT_TESTED | P3 | RD-14 | none |
| PT-099 | Liveness / supervisor watchdog monitoring (LV1) | MERGED_NOT_INTEGRATED | P3 | RD-15 | none |
| PT-100 | Monitoring/SRE agents (SRE, log monitoring, synthetic monitoring, agent-activity, security-incident monitoring) | DESIGN_ONLY | P3 | RD-16 | none |
| PT-101 | Continuous deployment / GitHub Releases publication | NOT_STARTED | P3 | RD-17 | none |
| PT-102 | Desktop / Control Tower smoke scripts | MERGED_NOT_INTEGRATED | P3 | RD-18 | #50 |
| PT-103 | PLANNED-SCAFFOLD-CLEANUP: remove unreachable plannedPanel fallback + orphan locale keys (PR #20) | PENDING_CI | P3 | BL-MNT-01, PR-20 | #20 |
| PT-104 | Durable LOW advisories F-PKGE-002 (unused manifest exeSha256) and F-PKGR-001 | NOT_STARTED | P3 | BL-MNT-02 | none |
| PT-105 | Dead renderer API client functions api.stale(), api.exportItem(), api.delivery() (merged, no renderer caller) | MERGED_NOT_INTEGRATED | P3 | FE-API-095, FE-API-116, FE-API-118 | none |
| PT-106 | Pre-dev backend contract (F2): BA -> requirements -> PO/PM plan -> architecture stage contracts + approval POST | AUTHORITY_REQUIRED | P1 | BL-PD-01 | none |
| PT-107 | Domain Packs read-only route #/domains (PR #32; no id in the 252-screen baseline) | PENDING_CI | P2 | PR-32 | #32 |

## Requirement sets (texts only on the Founder PC)

| ID | Set | Status | Oct 31 |
|---|---|---|---|
| BL-REQ-DEV | Desktop 116-development master items DEV-001..DEV-116 (texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-A | Reliability band A 'AI accuracy & evidence': REL-117..REL-121 (5 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-B | Reliability band B 'Agent autonomy': REL-122..REL-126 (5 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-C | Reliability band C 'Data/infrastructure': REL-127..REL-131 (5 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-D | Reliability band D 'Continuous improvement': REL-132..REL-136 (5 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-E | Reliability band E 'Durable runtime / race / progress': REL-137..REL-144 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-F | Reliability band F 'Scheduler / lease / resource fairness': REL-145..REL-152 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-G | Reliability band G 'Model accuracy / calibration / epistemology': REL-153..REL-160 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-H | Reliability band H 'Policy / authority / multi-tenant security': REL-161..REL-168 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-I | Reliability band I 'Evidence & supply provenance integrity': REL-169..REL-176 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-J | Reliability band J 'Operations / DR / fault isolation': REL-177..REL-184 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-K | Reliability band K 'QA / release / install reliability': REL-185..REL-192 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-L | Reliability band L 'Data / time / privacy correctness': REL-193..REL-200 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-M | Reliability band M 'Customer products / contractual continuity': REL-201..REL-208 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |
| BL-REQ-REL-N | Reliability band N 'Self-correction / learning / user trust': REL-209..REL-216 (8 items; texts not in repo) | DESIGN_ONLY | NOT_DELIVERABLE |

## PR -> work item map (all 50 PRs; PRs are evidence, not work items)

| PR | State | PR status (live) | Work item(s) |
|---|---|---|---|
| #1 | merged | INTEGRATED_NOT_VERIFIED | UI-211 (INTEGRATED_NOT_VERIFIED) |
| #2 | merged | INTEGRATED_NOT_VERIFIED | PT-008 (INTEGRATED_NOT_VERIFIED) |
| #3 | merged | INTEGRATED_NOT_VERIFIED | UI-227 (INTEGRATED_NOT_VERIFIED), UI-052 (INTEGRATED_NOT_VERIFIED) |
| #4 | merged | INTEGRATED_NOT_VERIFIED | UI-037 (INTEGRATED_NOT_VERIFIED), UI-046 (INTEGRATED_NOT_VERIFIED) |
| #5 | merged | INTEGRATED_NOT_VERIFIED | UI-205 (INTEGRATED_NOT_VERIFIED) |
| #6 | merged | INTEGRATED_NOT_VERIFIED | UI-071 (INTEGRATED_NOT_VERIFIED), UI-186 (INTEGRATED_NOT_VERIFIED) |
| #7 | merged | INTEGRATED_NOT_VERIFIED | UI-071 (INTEGRATED_NOT_VERIFIED), UI-186 (INTEGRATED_NOT_VERIFIED) |
| #8 | open | AUTHORITY_REQUIRED | UI-074 (AUTHORITY_REQUIRED), UI-136 (AUTHORITY_REQUIRED), UX-DEC-037 (AUTHORITY_REQUIRED) |
| #9 | merged | INTEGRATED_NOT_VERIFIED | UI-248 (INTEGRATED_NOT_VERIFIED), UI-060 (INTEGRATED_NOT_VERIFIED) |
| #10 | merged | MERGED_NOT_INTEGRATED | PT-025 (MERGED_NOT_INTEGRATED) |
| #11 | open | PENDING_REVIEW | PT-021 (PENDING_REVIEW), PT-052 (PENDING_REVIEW), PT-026 (AUTHORITY_REQUIRED) |
| #12 | open | PENDING_CI | PT-013 (PENDING_CI) |
| #13 | closed-unmerged | DUPLICATE | PT-049 (PENDING_CI) |
| #14 | closed-unmerged | DUPLICATE | PT-048 (PENDING_CI) |
| #15 | open | PENDING_CI | PT-047 (PENDING_CI) |
| #16 | open | PENDING_REVIEW | PT-051 (PENDING_REVIEW) |
| #17 | open | PENDING_CI | PT-048 (PENDING_CI) |
| #18 | open | PENDING_CI | PT-049 (PENDING_CI) |
| #19 | open | PENDING_CI | UI-001 (INTEGRATED_NOT_VERIFIED), UI-236 (INTEGRATED_NOT_VERIFIED) |
| #20 | open | PENDING_CI | PT-103 (PENDING_CI) |
| #21 | open | PENDING_CI | PT-014 (PENDING_CI) |
| #22 | open | PENDING_CI | UI-197 (PENDING_CI), UI-029 (PENDING_CI) |
| #23 | open | PENDING_CI | UI-226 (PENDING_CI) |
| #24 | open | PENDING_CI | UI-049 (PENDING_CI) |
| #25 | open | PENDING_CI | UI-050 (PENDING_CI) |
| #26 | open | PENDING_CI | UI-051 (PENDING_CI) |
| #27 | open | PENDING_CI | UI-070 (PENDING_CI), UI-163 (PENDING_CI) |
| #28 | open | PENDING_CI | UI-078 (PENDING_CI) |
| #29 | open | PENDING_CI | PT-050 (PENDING_CI) |
| #30 | closed-unmerged | OBSOLETE | PT-010 (OBSOLETE) |
| #31 | open | PENDING_CI | PT-027 (PENDING_CI) |
| #32 | open | PENDING_CI | PT-107 (PENDING_CI) |
| #33 | open | PENDING_CI | UI-206 (INTEGRATED_NOT_VERIFIED) |
| #34 | open | PENDING_CI | PT-064 (PENDING_CI) |
| #35 | open | PENDING_CI | PT-065 (PENDING_CI) |
| #36 | open | PENDING_CI | PT-066 (PENDING_CI) |
| #37 | open | PENDING_CI | PT-067 (PENDING_CI) |
| #38 | open | PENDING_CI | PT-068 (PENDING_CI) |
| #39 | open | PENDING_CI | PT-069 (PENDING_CI) |
| #40 | open | PENDING_CI | PT-070 (PENDING_CI) |
| #41 | open | PENDING_CI | PT-071 (PENDING_CI) |
| #42 | open | PENDING_CI | PT-072 (PENDING_CI) |
| #43 | open | PENDING_CI | PT-073 (PENDING_CI) |
| #44 | open | PENDING_CI | PT-074 (PENDING_CI) |
| #45 | open | PENDING_CI | PT-075 (PENDING_CI) |
| #46 | open | PENDING_CI | PT-076 (PENDING_CI) |
| #47 | open | PENDING_CI | PT-077 (PENDING_CI) |
| #48 | open | PENDING_CI | PT-078 (PENDING_CI) |
| #49 | open | BLOCKED | PT-003 (BLOCKED), PT-006 (PENDING_REVIEW), PT-001 (BLOCKED), PT-002 (IN_PROGRESS) |
| #50 | open | BLOCKED | PT-015 (BLOCKED) |
