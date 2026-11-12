# UI-001..UI-252 real implementation audit (code evidence, repo /tmp/claude-0/wt4, detached at main)

Method: every key classified from code (renderer view/panel + backend route handler + store + test), never from planning-doc status. Roadmap titles/status come from docs/closure/uasco-remaining-work/evidence/G2-records.json (252 distinct keys). Full table: scratchpad/screens.csv.

## 1. Counts per category
| Category | Count |
|---|---|
| WORKING | 81 (74 server-backed with endpoint+handler; 7 renderer-only features with no backend need: UI-008,105,106,107,108,114,246; api "-", backend "n/a (client-only)") |
| UI_ONLY | 38 (4 are mobile view-model-only: 097,099,102,177; many are UNCERTAIN partial matches) |
| PLANNED_PANEL | 0 (no route has plannedPackage any more; every route in routes.js hosts a real view. views/planned.js:21-32 only renders a placeholder for a route without `component`, and none exists) |
| NOT_FOUND | 128 |
| EXCLUDED | 5 (UI-152, 171, 185, 235, 245; code for 152 firstrun.js and 245 shell.js palette exists anyway) |
| Total | 252 |

Recorded-status vs. code: 2 keys recorded DONE_BUT_UNVERIFIED have no code at all (UI-033 Agent Handoff Center, UI-221 Test Strategy/Coverage Risk Matrix). Several BLOCKED/NOT_STARTED/IN_PROGRESS keys ARE implemented (e.g. UI-003, 013, 016, 017, 124-ish, 163, 197, 226, 078).

## 2. Counts per route/area (WORKING / UI_ONLY; NOT_FOUND have no route)
projects 9/5 | work 7/3 | work-journey (predev/analysis) 2/3 | workforce 7/1 | assurance 6/2 | company 6/0 | install 4/0 | delivery 4/3 | shell+client-only 11/6 | tower 3/1 | executive 3/0 | operations 2/2 | settings 2/3 | academy 2/1 | posture 2/0 | readiness 2/0 | inbox 2/0 | audit 1/2 | integrations 1/1 | journey 1/1 | home 1/0 | matrix 1/0 | scheduler 1/0 | queue 1/0 | mobile 0/4.
Desktop routes in routes.js: 23 (home, projects, work, workforce, assurance, delivery, tower, inbox, company, academy, journey, executive, queue, readiness, posture, matrix, operations, install, audit, domains, integrations, scheduler, settings). domains has no UI key mapped.

Whole areas with NO implementation: market discovery (012), plan comparison/change (018,019), UX prototype (021), DAG/critical path (024,207), Scrum/Jira (036), all test labs 038-045/141-145/223-225, security events (048), CI/CD, canary, rollback, backup/DR (056,059,072,073,150,155), knowledge graph/import/conflicts (064,065,158,159,237-240), permissions/auth/SSO/tenant/secrets/sessions (068,117-123,164,168,173-176,183,184), FinOps/budget/quota (075,088,190,196), 12 Company OS domains beyond CRM/finance/legal (082,084,086,088,090-096,165-172,229-232,234), notifications settings (077), RE lab (079), licences/SBOM (080,147,217), all mobile except 4 view models, security panels 213-219.

Caveat on e2e: the "real server" tests are renderer (fake DOM) over a real buildServer (tests/support/renderer-real-server*.cases.ts); only scripts/e2e-first-delivery-electron.mjs drives real Electron + real API through the preload bridge, and it is a manual script (not a vitest test; Linux, non-root, xvfb). Company data creation, memory POST and cloud jobs have server routes but no desktop write allowlist (main.mjs:161), so those screens are read-only in the app.

## 3. End-to-end flow today (create project -> task -> generate code -> run tests -> show result)
| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | Create real project from the app | REAL | Wizard POST /v1/projects: renderer/views/studio-wizard.js:18-22 -> main.mjs:161 allowlist -> server.ts:224 (store createProjectDetailed; template repo via getStudio().createTemplateRepository, server.ts:231). Also "Fikirden basla" POST /v1/intakes: views/intake.js:65 -> routes/intake.ts:31 (project + first mission). Tests: tests/support/wizard-real-server.cases.ts:89; scripts/e2e-first-delivery-electron.mjs:60 (real Electron). |
| 2 | Give it a task | REAL (manual) / PARTIAL (auto) | Mission via studio-wizard.js:43 (idea panel) / views/work.js:112 -> server.ts:240. Tasks: manual plan form views/plan-form.js:14 -> routes/plan.ts:20; or AI-drafted via analysis step views/analysis-step.js:21 -> routes/analysis.ts:39/75 which needs a paid local-claude builder (server.ts:280, NO_ANALYSIS_BUILDER otherwise). Mission must be moved to AUTHORIZED in #/work (work-actions.js:performTransition -> server.ts:250). Tested: work-nav-real-server.cases.ts:77, analysis-decisions-real-server.cases.ts:98, e2e script :64-75. |
| 3 | Generate code | REAL IN CODE, GATED, NOT PROVEN END-TO-END IN APP | Start run: work-actions.js:32 -> POST /v1/missions/:id/runs (server.ts:315; 409 EXECUTOR_NOT_CONFIGURED unless pair). Engine core/workos/runner.ts stepImplement:866 calls executors.implementer.implement (:884) in an isolated clone. Real adapter LocalClaudeExecutors core/workos/executors.ts:281 is OFF unless founder enables it (Settings -> POST /v1/system/executors/local-claude/enable, views/executors-panel.js:16, server.ts:482) and Claude profile is logged in; runner starts only with runner.enabled (packaged-entry.ts:57) or UASCO_WORKOS_RUNNER=1 (server.ts:309). Dev (non-packaged) launch sets neither by default. Electron e2e deliberately stops before execution (scripts/e2e-first-delivery-electron.mjs:81 "no execution started"). Code gen proven only with FakeExecutors (executors.ts:148; tests/v7-b3a-runner.test.ts, v7-m1a-c2-delivery.test.ts) and manual live smoke scripts/workos-live-smoke.mjs. |
| 4 | Run tests | REAL ONLY WITH SANDBOX, ELSE HONEST STUB | runner.ts:938 stepVerify runs the project testCommand ONLY via ExecutionGate sandbox (runner.ts:791). Default provider exists only on linux (server.ts:300 LinuxUnshareSandboxProvider; win32/mac -> null). Without it: evidence VERIFY_TESTS_NOT_EXECUTED, run continues (runner.ts:796-801), functionalAcceptance NOT_EXECUTED, product never PRODUCT_VERIFIED (tests/v7-m1a-mode.test.ts:41). Root-run Linux self-test also fails closed. |
| 5 | Show result on the desktop | REAL (source level) | Run cards/evidence #/work (views/work.js:410), #/assurance test report (assurance.js:367), delivery card prepare/accept/export (views/delivery-panel.js:22-46 -> server.ts:350/360/371), files/git diff browser (studio-workspace.js:285 -> server.ts:437-453), run/stop product preview (views/product-card.js:19 -> routes/product-run.ts:38 ; needs sandbox, 409 otherwise). Delivery is source-only and always NOT_VERIFIED unless sandbox-attested tests ran. |

Verdict: steps 1, 2 (manual plan) and 5 work for real; steps 3-4 exist as a real engine but need (a) founder enabling local-claude + Claude login, (b) runner on, (c) a Linux sandbox for tests. On Windows/macOS or without the sandbox the app produces source and NOT_EXECUTED test evidence. No automated test drives Electron through run -> code -> tests -> result; only fake-executor server tests and a manual smoke exist.

## 4. Top 10 missing / UI_ONLY screens for a first working product
1. UI-124 Stop dialog live impact counts (UI_ONLY) - founder needs to see what STOP halts.
2. UI-057/188 Deployment center + unapproved prod-deploy block (UI_ONLY, only a BLOCKED label; no deploy path) - needed to ship what is built.
3. UI-014/015/020 Analysis report + smart revision + architecture studio (UI_ONLY) - AI-drafted analysis is only an approve/reject list, no readable report/revision loop; this is how tasks should normally be produced instead of hand-typing.
4. UI-018/019 Plan comparison and plan-change center (NOT_FOUND).
5. UI-024/207 Task DAG map and critical path (NOT_FOUND) - tasks have dependsOn but no graph.
6. UI-038..045 Test strategy/cases/web+API labs (NOT_FOUND); UI-221/222 test strategy / CI evidence chain (not backed) - users cannot see or author what is tested; only recorded evidence or NOT_EXECUTED.
7. UI-075/190/196 FinOps, token budget and quota (NOT_FOUND) - paid Claude runs need spend visibility/limits.
8. UI-136/181 provider quota failover (UI_ONLY/UNCERTAIN) and UI-137 checkpoint rollback/resume (UI_ONLY) - long autonomous runs need recovery controls.
9. UI-068/117-123 permissions, auth/MFA, secrets, sessions (NOT_FOUND) - multi-user/tenant safety; UI-077 notifications settings.
10. UI-004 Founder command console (UI_ONLY: draft-only command intake, no chat) and UI-140 human intervention/handoff (UI_ONLY) - the main interactive entry point to the autonomous factory.
Honorable mentions: UI-012 market discovery, UI-021 UX prototype studio, UI-056 CI/CD, UI-059 rollback, mobile app (UI-097..104, 173-180, 249, 250: only 4 view-model functions, no screens).
