<!-- //TR: B/C/H envanter notları — 18 Desktop çalışma alanı, 71 UX kararı ve renderer modül/rota/durum/API bağlantılarının yöntemi, kanıtı ve sınırları (Inventory notes for scopes B/C/H). -->

# Scopes B / C / H: method, evidence and limits (2026-10-19)

Base: `v7/integration@e12dbdd` (worktree `/home/user/uasco-inventory`). master `061f78d` is an older ancestor. Nothing in this inventory is PRODUCT_VERIFIED. No screen, route or workspace has a recorded run of the real desktop app against a live backend.

Files:
- `workspaces.csv`: 18 rows (SC-01..SC-18).
- `ux-decisions.csv`: 71 rows (UX-DEC-001..071).
- `frontend.csv`: 169 rows. That is 66 modules, 2 stores, 24 routes, 70 API client functions and 7 IPC connections.

## Counting rule: do not add these categories together

The row types in `frontend.csv` overlap. A route row (e.g. `#/home`), the module row for its view (`views/home.js`) and the API rows it calls (`api.cockpit`) describe the same code from different angles. Workspace rows and UX-DEC rows also cover the same code as the frontend rows. Use the per-category counts. The 258-row total is a row count, not a count of work items.

## B: the 18 workspaces

- The 18 are SC-01..SC-18. They are defined in `UASCO_COMPLETE_DESKTOP_UI_UX_IMPLEMENTATION_BLUEPRINT.md` §3. That file is **UNKNOWN_SOURCE**: it is not in the repo and not on any branch. The index used here is the stale `inv-src/v6-planning/UASCO_SC_GAP_AND_ROADMAP_2026-10-15.md` §3.
- `ARCHITECTURE-CONSTITUTION.md` and `docs/closure/*` do not define the workspaces. `grep` finds no 18-workspace definition there.
- The stale CSV `domain_owner` column cannot be used for membership. It has 87 distinct values, 48 of them `-` and 39 blank.
- **Membership method (auditor derivation, confidence MEDIUM):**
  - Base: each work package in stale `BACKLOG_CHECKPOINT.json` maps to one SC. Together the 16 packages cover all 252 screens. The mapping is SHELL/STATE-RECOVERY/MISC->01, COCKPIT->02, PROJECTS->03, WORKOS->07, AGENTS->08, QA-SEC->09, DELIVERY->11, TOWER->12, INBOX->13, KNOWLEDGE->14, COMPANY->15, SETTINGS/FIRSTRUN->17, MOBILE->none.
  - Title-based overrides then move screens to the SC that matches their title:
    - SC-04: 011, 022
    - SC-05 (BA/discovery): 012-015, 127, 128
    - SC-06 (plan/architecture): 017-021, 129-131
    - SC-08 (workforce/academy): 028, 030, 032, 133, 134, 170, 197, 200-204, 231
    - SC-09: 042, 144, 214-217, 225
    - SC-10 (review/evidence/audit): 049, 050, 070, 148, 162, 163, 222, 242
    - SC-14: 160, 239, 240, 243
    - SC-15: 075
    - SC-16 (ops/recovery): 071-073, 136, 137, 154, 155, 181, 186, 194, 209, 228
    - SC-17 (provider/installer/integrations/permissions): 034, 060, 061, 078, 121, 189, 190, 192
    - SC-18: 079
    - SC-01: 105
  - Per-screen current status comes from the peer rows `raw/screens-part-1..3.csv` (252/252 present). The stale CSV is used only for membership.
  - The full mapping is in `scratchpad/inv-h/workspaces-summary.json`.
- 18 mobile-companion screens belong to no Desktop SC. They are UI-097..104, 173..180, 249 and 250 (14 DESIGN_ONLY, 4 AUTHORITY_REQUIRED). They are not in the 18 rows.
- Workspace status: 13 INTEGRATED_NOT_VERIFIED, 1 PENDING_CI and 4 AUTHORITY_REQUIRED.
  - SC-10 is PENDING_CI because its dedicated review, lineage and audit surfaces exist only on PRs #24-#27.
  - SC-05, SC-06 and SC-14 are AUTHORITY_REQUIRED because no backend contract or endpoint exists. SC-18 (optional RE lab) is AUTHORITY_REQUIRED because it needs authorization.

## C: UX-DEC-001..071

- The decision texts are **UNKNOWN_SOURCE**. They are on the Founder's PC.
- All 71 ids do appear in stale sources:
  - `REQUIREMENT_TO_UI_CROSSWALK.csv` lists all 71. 17 have dedicated screen citations and 54 are mapped only through the generic "UX-DEC-001..071" blueprint reference.
  - The 71-row summary table in `UASCO_DESKTOP_UX_GAP_ANALYSIS_2026-10-15.md` (lines 35-105) gives the short titles used here. These titles are a secondary summary, not the decision text.
- In v7 code, only UX-DEC-067 is cited: `apps/desktop/renderer/control-tower/README.md:4`.
- Status is judged from current code against the stale summary title only:
  - 36 INTEGRATED_NOT_VERIFIED (confidence LOW, because conformance to the real text cannot be checked)
  - 28 AUTHORITY_REQUIRED
  - 3 DESIGN_ONLY (008, 042, 060)
  - 2 PENDING_CI (031, 034)
  - 1 PENDING_REVIEW (037)
  - 1 BLOCKED (026: pixel parity needs a Windows render harness and the design package)

## H: renderer modules, routes, state and connections

- **Reachability:** the import graph from `app.js` is in `scratchpad/inv-h/graph.json`, built with `graph.py`. All 64 JS modules on v7 are reachable.
- `app.js` and `index.html` are protected (`config/protected-paths.json`). So are `main.mjs`, `preload.mjs` and `server.ts`. New views therefore plug in through `views/planned.js` `component` delegates without editing `app.js`.
- **Routes:** v7 registers 19 (`routes.js:16-36`). Five more exist only on open PRs: `#/audit` (#27, also carried by #28), `#/integrations` (#28), `#/domains` (#32), `#/scheduler` (#33) and `#/providers` (#8).
- **Endpoints:** every endpoint called on v7 is served in `apps/control-api/src/server.ts` and allowed by the desktop GET/POST allow-lists. This was checked mechanically with `node scratchpad/inv-tools/endpoint-check.mjs`. The PR-only routes use existing endpoints only.
- **Dead or never-executed code (MERGED_NOT_INTEGRATED):**
  - `api.delivery()`: no caller.
  - `api.exportItem()`: no renderer caller; only tests call it.
  - `api.stale()`: no renderer caller.
  - The `plannedPanel` fallback in `views/planned.js` can no longer be reached, because every planned route now has a component. PR #20 removes that scaffolding.
- **State stores:**
  - `state.js`: projectId, persisted in `localStorage uasco.projectId`; epoch; cache; samples.
  - `studio-state.js`: in-memory only.
  - Inside other modules: the response cache and the `companyLastGood` STALE cache in `api.js`, drafts and selection in `forms.js`, `uasco.lang` in `i18n.js`, and `uasco.firstRunSeen` in `views/firstrun.js`.
- **Tests:**
  - 34 renderer-related test files exist and are all registered in `config/validation.json`.
  - A **local, non-CI, Linux** vitest run at `e12dbdd` (2026-10-19T03:10Z, `scratchpad/vitest-tests.json`) passed all 34. Overall it ran 1531 tests: 1513 passed, 3 failed and 15 were skipped. All 3 failures are outside the renderer: `pkg-aut1-orchestrator`, `pkg-t3-omniroute-install-compat` and `v7-b10a-evidence`.
  - Windows: NOT_RUN.

## CI and review facts that change how merged code should be read

- The merged UI PRs #1, #3, #4, #5, #6, #7 and #9 have **`validate (windows-latest)` = failure** at their head SHAs. `ubuntu-latest` passed.
- The last real Windows run on the v7 lineage was at `55bcede` (the merge of #9) on 2026-10-18 04:38Z. It failed at step "Run node scripts/run-validation.mjs" (`gh api .../actions/jobs/117586588911`).
- Every run on `e12dbdd` since then died in about 3 s because the Actions quota is exhausted.
- #1 and #3-#7 have no GitHub review at all. #9's reviews are INCONCLUSIVE or BLOCKED and sit on older commits (`80ae4df`, `9f0018d`), not on the merged head `6db12a5`.
- Open frontend PRs (27). Reviews are COMMENT reviews from the same GitHub identity, so there is no distinct approver.
  - 11 CLEAN at head, scoped, with full validation NOT_RUN: #32, #34, #37, #39, #40, #42, #44-#48.
  - 9 no blocker but explicitly not CLEAN because CI is down: #19, #20, #22-#28.
  - 6 INCONCLUSIVE: #8, #33, #35, #36, #41, #43.
  - 1 BLOCKED: #38 (its hostile-text test is vacuous).
- **Merge-conflict clusters (merge these serially):**
  - #8 / #27 / #28 / #32 / #33 all touch `routes.js`, `planned.js`, `api.js`, the locales, `styles.css` and the same 9 test files.
  - #19 / #36: `home.js`.
  - #23 / #34: `tower.js`.
  - #22 / #48: `workforce.js`.
  - #24 / #25 / #26 (stacked) / #41: `assurance.js`.
  - #35 / #44 / #46: `v7-ps1b-project-studio-ui.test.ts`.
- PR #8 is 11 commits behind v7 and edits the protected `config/validation.json` and `config/trust-root-manifest.json`.

## Not verifiable here

- The design package is UNKNOWN_SOURCE, so design parity cannot be checked.
- Live Electron + backend behavior.
- Windows results.
- The real UX-DEC texts.
