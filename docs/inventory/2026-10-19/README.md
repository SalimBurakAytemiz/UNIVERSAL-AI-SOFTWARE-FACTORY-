<!-- //TR: 2026-10-19 UASCO ana is envanteri: yontem, kanit tabani (SHA), sayim kurallari, durum tanimlari, formuller ve bilinen sinirlar / Master work inventory README: method, evidence base, counting rules, status definitions, formulas, known limits -->

# UASCO master work inventory, 2026-10-19

This folder is an evidence-based inventory of all UASCO work. It claims no PASS, CLEAN, MERGED or PRODUCT_VERIFIED result that the cited evidence does not support. **No item in any dimension is PRODUCT_VERIFIED, and no item is DELIVERABLE for 2026-10-31 on current evidence.**

## Files

| File | What it holds |
|---|---|
| `README.md` | This file: method, evidence base, counting rules, definitions, limits |
| `MASTER_WORK_INVENTORY.md` / `master-work-inventory.csv` / `master-work-inventory.json` | Every record of every dimension (1364 rows, 25 record fields), totals per status and per dimension, the PR-to-work-item map and the normalization log |
| `SCREEN_AUDIT_252.csv` / `SCREEN_AUDIT_252.md` | The 252 screens, normalized, with status by workspace |
| `FRONTEND_BACKEND_MATRIX.md` / `FRONTEND_BACKEND_MATRIX.csv` | View-to-endpoint wiring (154 pairs, copied from `raw/frontend-backend-matrix.csv`) and its gaps |
| `PR_REVIEW_CI_MERGE_BOTTLENECKS.md` | All 50 PRs with live status, CI and review facts, merge order and the interventions that unblock most |
| `AGENT_AUTOMATION_GOVERNANCE_STATUS.md` | Cloud routines and sessions, lease, merge gate, review independence, security posture |
| `DEPENDENCY_MAP.md` / `dependency-map.json` | Keystones, groups and tasks with depends-on edges |
| `PRODUCTION_PLAN_TO_OCT31.md` | Prioritized plan; what needs no new authority versus Founder/admin action |
| `raw/` | The 10 domain auditors' files (inputs; unchanged by the synthesizer) |

## Evidence base

| Item | Value |
|---|---|
| Canonical code | `origin/v7/integration` @ `e12dbdd69c7b0c34dc71209be9d003e0125a17c0` (worktree `/home/user/uasco-inventory`, branch `claude/master-work-inventory`) |
| Older line | `origin/master` @ `061f78d7783f63c2ded3171dcd320c9f6a179e0d`, an ancestor of v7/integration with no renderer views; nothing has merged to master since |
| Open PR heads | Re-read live at 2026-10-19T04:45Z (`gh api pulls?state=open`); 38 open PRs; table in `PR_REVIEW_CI_MERGE_BOTTLENECKS.md` |
| GitHub snapshots | `prs.json` 03:02Z; domain auditors 03:10Z-04:34Z; synthesizer live re-check 04:36Z-04:50Z |
| Requirement/ID source | STALE_BASELINE v6 `docs/planning` export @ `9dbb708` (SCREEN_TRACEABILITY_252_PLUS.csv and others). Used for IDs only, never as status |
| Repository visibility | **public** (`private:false, visibility:public`, re-read 04:37Z). This conflicts with the relayed directive to keep the private repo |
| CircleCI | Not present: no `.circleci/` on any origin ref (re-checked by the synthesizer with `git ls-tree` over every remote ref) |

## Method

1. Ten domain auditors measured their scope against `e12dbdd` and GitHub and wrote `raw/*.csv` with the 25 record fields (plus `raw/*.md` notes and `raw/g-i-evidence.json`).
2. The synthesizer read every raw file and:
   - kept each dimension in its own table (screens, workspaces, UX decisions, phases, roles, labs, endpoints, data/persistence, platform+governance tasks, requirement sets);
   - normalized the 252 screen rows with rules R1-R5 (below) so that the three screen auditors' different conventions give one status class per rule;
   - consolidated 158 platform rows (automation-governance 34, qa-security 33, ci 17, release-deploy 18, backlog 56 minus 15 requirement sets) plus PR rows, 3 dead-code frontend rows and 4 findings that had no row (3 local-run test defects, the permissive action-gateway defaults) into **107 unique tasks** (`PT-001..PT-107`). Every source row maps to exactly one task (`platformTaskSources` in the JSON);
   - mapped every PR (#1-#50) to the work item(s) it implements (`prToWorkItems`). PRs are evidence, not work items;
   - re-read live GitHub state (open PR heads, the latest reviews on moved heads, check runs on `e12dbdd`, `498e2eb` and `ba775b8`, repository visibility) and applied the changes found.
3. The synthesizer ran no tests. Test results quoted here come from the auditors' local Linux runs (not CI) or from GitHub check runs.

## Counting rules

- Screens, workspaces, UX decisions, phases, roles, labs, endpoints, data items, tasks and PRs are **never added together**. Workspaces, UX decisions, endpoints and frontend rows describe the same code as the screens from other angles. Labs overlap phases 44, 55-76, 81-105, 110-131.
- One record per real work item. A screen and the PR that implements it are one item, with the PR as evidence. Corrective PRs collapse into their item (#13 into PT-049, #14 into PT-048, #6 and #7 into UI-071). Six screen rows are DUPLICATE of another screen.
- An opened PR is not a finished product. A registered route or served endpoint is not product verification. A design or CSV row is not a working function. Old baselines are not current truth.
- `unique` = rows minus DUPLICATE. `live` = unique minus OBSOLETE.

## Status definitions (one class per item)

| Status | Meaning used in this inventory |
|---|---|
| DESIGN_ONLY | Only a design/contract/CSV row; for screens, also: the gap can be built without new authority (renderer-only) |
| NOT_STARTED | Nothing anywhere (no code, no PR) and no authority is the blocker |
| IN_PROGRESS | Partial code exists or work is actively running (e.g. diagnosis branch, routine running), not complete |
| IMPLEMENTED_NOT_TESTED | Code merged but its tests never ran for real (e.g. real gitleaks path, installer chain) |
| TESTED_NOT_REVIEWED | Not used: no item has passing CI without a review |
| PENDING_REVIEW | Code on an open PR; the current head has no review or only an INCONCLUSIVE one |
| PENDING_CI | Code on an open PR; the review at the current head found no blocker, but the final verdict waits for green both-OS CI (and a governed merge) |
| CLEAN_NOT_MERGED | Not used: no open PR has a final CLEAN bound to its current head with green CI |
| MERGED_NOT_INTEGRATED | Merged on v7/integration but not wired into any product path (imported only by tests/scripts) |
| INTEGRATED_NOT_VERIFIED | Merged and wired (route registered, endpoint served and allow-listed) but no recorded real-desktop + live-backend run |
| PRODUCT_VERIFIED | Not used: no such evidence exists for any item |
| BLOCKED | A concrete failure or finding blocks it (red CI, BLOCKED review, missing input) |
| AUTHORITY_REQUIRED | The next step needs Founder/admin authority: a protected-path edit or reseal, a new protected endpoint or allow-list entry, a Founder/risk-4-5 decision, an account/App connection or a paid resource |
| DUPLICATE | Same work item as another record |
| OBSOLETE | Superseded by a later Founder decision or PR |

## Executive numbers and their formulas

| Number | Value | Formula (computed from the files) |
|---|---:|---|
| Screens in baseline | 252 | rows of `SCREEN_AUDIT_252.csv` |
| Unique screens | 246 | rows minus DUPLICATE (6) |
| Screens working today | **85** | count(status in {INTEGRATED_NOT_VERIFIED, PRODUCT_VERIFIED}) in `SCREEN_AUDIT_252.csv`. "Working" = merged on v7 and wired; never executed by a recorded product run |
| Screens fully wired on v7 | 23 | INTEGRATED_NOT_VERIFIED and ui_connected=YES and api_connected=YES. The other 62 integrated screens are PARTIAL (part of the screen's function is missing) |
| Screens product-verified | **0** | product_verified=YES |
| Screens with no code at all | 131 | non-duplicate, ui_connected=NO and api_connected=NO |
| Screens awaiting CI on open PRs | 9 | status PENDING_CI |
| Screens needing authority | 145 | status AUTHORITY_REQUIRED |
| Unique platform+governance tasks | **107** | PT-* rows minus DUPLICATE |
| Tasks completed (integrated, unverified) | 10 | PT-* with status INTEGRATED_NOT_VERIFIED or PRODUCT_VERIFIED (0 PRODUCT_VERIFIED) |
| Tasks remaining | 90 | unique tasks - completed - OBSOLETE (7) |
| Open PRs | 38 | live `gh api pulls?state=open` at 2026-10-19T04:45Z |
| Code awaiting review or CI | 35 | open PRs with status PENDING_CI or PENDING_REVIEW |
| Items PRODUCT_VERIFIED, any dimension | 0 | product_verified=YES over all 1364 master rows |
| Items DELIVERABLE by Oct 31, any dimension | 0 | oct31_impact=DELIVERABLE over all master rows |

## Dimensions and ID prefixes

| Prefix | Dimension | Rows | Source |
|---|---|---|---|
| UI- | screens | 252 | raw/screens-part-1.csv; raw/screens-part-2.csv; raw/screens-part-3.csv |
| WS-SC- | workspaces | 18 | raw/workspaces.csv |
| UX-DEC- | ux-decisions | 71 | raw/ux-decisions.csv |
| PH- | phases | 149 | raw/phases.csv |
| E-ROLE- | roles | 599 | raw/roles.csv |
| F-LAB- | labs | 25 | raw/labs.csv |
| G-EP- | endpoints | 85 | raw/backend-endpoints.csv |
| I-DP- | data-persistence | 43 | raw/data-persistence.csv |
| PT- | tasks | 107 | raw/automation-governance.csv; raw/qa-security.csv; raw/ci.csv; raw/release-deploy.csv; raw/backlog-items.csv (non BL-REQ); raw/prs.csv; raw/frontend.csv (3 rows); raw/g-i-evidence.json |
| BL-REQ- | requirement-sets | 15 | raw/backlog-items.csv (BL-REQ-*) |

## Normalizations applied by the synthesizer

Screens (`SCREEN_AUDIT_252.csv`; the raw files are unchanged; each changed row's `evidence` starts with `[synth-normalized: ...]`):

- **R1** `oct31_impact` DELIVERABLE -> AT_RISK (12 rows of `screens-part-3.csv`). No item has green CI or product evidence, and the other two screen auditors applied this rule.
- **R2** DESIGN_ONLY -> AUTHORITY_REQUIRED when `authority_needed` names a new endpoint, an allow-list entry or a Founder decision (61 rows of parts 2 and 3). Part 1 already used this convention. DESIGN_ONLY is kept only where the authority is "none" (renderer-only: UI-003, 023, 077, 112, 126, 247, 252).
- **R3** BLOCKED -> AUTHORITY_REQUIRED where the only blocker is a Founder decision (FD-REL-1): UI-141, UI-144, UI-145.
- **R4** live PR state: UI-074 and UI-136 -> AUTHORITY_REQUIRED (PR #8 is dirty, 11 commits behind and edits protected `config/validation.json` and `config/trust-root-manifest.json`, so it needs a maintainer reseal; prs.csv PR-8). UI-051 stays PENDING_CI with its new head `0a60c14` and the 04:41Z scoped CLEAN. UI-206 gets #33's new head `b8d2f51`. The same rule moved UX-DEC-037 PENDING_REVIEW -> AUTHORITY_REQUIRED.
- **R5** merged-PR references added where a screen row lacked them: UI-037/046 (#4), UI-052 (#3), UI-060 (#9), UI-071 (#6 + #7).

Tasks: the status of each consolidated task is the synthesizer's choice from its source rows plus the live re-check; the raw statuses are kept in the `evidence` field (`[synth] consolidated from ...`). Live changes applied: #26, #33, #38, #42 moved to PENDING_CI (scoped CLEAN COMMENT reviews at their new heads, 04:41Z); #50 is BLOCKED (MEDIUM fail-open finding at `ba775b8`, 04:41Z); #11 and #16 stay PENDING_REVIEW (no review on their new heads); #13, #14 and #30 are closed.

All 87 field changes are listed in `master-work-inventory.json` -> `normalizations`.

## Critic corrections (completeness and honesty pass, 2026-10-19T05:10Z)

A separate critic recounted every file with scripts and re-read GitHub live (`pulls?state=all`, `pulls/N/reviews` for #1-#50, `commits/<sha>/check-runs`, `actions/runs` + `runs/<id>/jobs`). **No status class and no executive number changed.** Fixes:

- **Stale PR heads in record fields.** 4 PRs moved after the raw snapshot: #26 `ab9d26b`->`0a60c14`, #33 `d2fc1c6`->`b8d2f51`, #38 `c267497`->`d8a4fcc`, #42 `13888e4`->`1b4e6a3`. Rows that still showed the old head and its old verdict as "review@head" (for example `#42[OPEN@13888e4; review@head: CLEAN ...]`) now show the live head and its latest head-bound review, and keep the raw value labelled as belonging to the superseded head.
- **Superseded CLEAN claims.** 18 open PRs have an earlier CLEAN COMMENT bound to the current head that a later PRE-REVIEW "Not CLEAN; final verdict pending green both-OS CI" at the same head supersedes. Every row that quoted such a CLEAN now carries a `[critic 2026-10-19T05:10Z ...]` note in `review_result`.
- **UI-211**: the CLEAN exists only in PR #1's title (0 GitHub review objects, no V7 review record), now marked as an unverified claim. **PT-102**: a historic "smoke PASS" from the stale sealed `CANONICAL-STATUS.md` is now labelled NOT_RUN on v7. **PT-040**: heartbeat count drift (10 logs up to `b7aa3cc` at 04:12:46Z, not 9).
- **Cross-dimension sums removed.** `DEPENDENCY_MAP.md` / `dependency-map.json` gave each keystone a "blocked items" number that added tasks, screens, roles, labs, endpoints and workspaces together and double-counted overlapping screen groups (for example K-SBX 781). It is replaced by `reachByDimension`, deduplicated within each dimension and never summed (K-SBX: tasks 1; screens 113; workspaces 18; roles 599; labs 25; endpoints 17). The removed numbers are kept in `dependency-map.json` -> `criticCorrections`.
- `MASTER_WORK_INVENTORY.md` workspace table: a DUP column was added so that each row's status columns add up to its screen count (SC-01, SC-09, SC-15 and SC-17 contain duplicates).
- `master-work-inventory.json`: `items[]` re-projected from the corrected CSV; `definitions.itemsProjection` states that `title`/`prs` are truncated to 160 characters; `criticCorrections` lists all 120 field changes on 95 rows (61 screen, 19 UX-decision, 11 workspace and 4 task rows: PT-040, PT-048, PT-049, PT-102; 23 rows had stale heads, 72 rows got a superseded-CLEAN note) and the latest head-bound verdict of every open PR.
- New corroboration of K-CI: over the full run history (284 workflow runs, of which 81 are CI runs longer than 60 s), `validate (windows-latest)` has 79 failure, 2 cancelled and 0 success jobs, and no CI run has ever concluded success.

Re-verified unchanged: `SCREEN_AUDIT_252.csv` has exactly the 252 stale-baseline `design_id`s (same order, no duplicates, none missing) and equals the 252 `UI-*` rows of the master CSV; every per-status, per-dimension, per-workspace and per-part count in the `.md` files equals the CSV/JSON; 0 rows PRODUCT_VERIFIED; 0 rows CLEAN_NOT_MERGED; 0 empty `evidence` fields; live heads of all 38 open PRs equal the PR table; repo `private:false`; rulesets `[]`; `protected:false` on `v7/integration` and `master`; no `.circleci/` on any of 56 origin refs; every review object (146) is a COMMENT by one identity.

## Known limits

- **UNKNOWN_SOURCE** (Founder PC only, not in any git ref): the 252-screen design package `C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16`; UX-DEC-001..071 texts; `UASCO_COMPLETE_DESKTOP_UI_UX_IMPLEMENTATION_BLUEPRINT.md` (SC-01..SC-18); DEV-001..116 and REL-117..216 texts; Master V2 plan `V2-GAP-AND-QUEUE-2026-10-14.md`; `UASCO_NIHAI_TEK_SISTEM_MASTER_V2_DESKTOP_UX001-071_2026-10-14.md` (role source); V7 review records under `C:/Users/salim/Desktop/UASCO/audit/reviews`; `FOUNDER-AUTHORIZATIONS.jsonl`; the off-repo UASCO-LOOP-RECORD poller source; SV1-1 commit `3492387`. Design parity, UX-decision conformance and requirement coverage are therefore not measurable for any item.
- **NOT_RUN**: Windows validation has never been green on any head in the repository's history. The synthesizer ran no tests. Two auditors ran the Linux vitest suite locally at `e12dbdd` (not CI): 1513 of 1531 tests passed (frontend auditor, 03:10Z) and 1513 of 1540 passed with 3 files still failing after a rerun (backend auditor, 03:50-04:03Z: `v7-b10a-evidence`, `pkg-aut1-orchestrator`, `pkg-t3-omniroute-install-compat`). These are recorded as local evidence only. CI job logs could not be downloaded (proxy 403), so root causes of Windows failures are not confirmed.
- **Unverified**: the authenticity of `FD-PUBLIC-CI-2026-10-19` (recorded only inside PR #49); who made the repository public and when; whether self-hosted runner 21 is still registered (runners API 403); GitHub security_and_analysis settings; CircleCI Free plan limits and credits (no auditor verified them).
- **Judgement calls**: workspace membership of screens (derived from the stale backlog work packages plus title overrides, confidence MEDIUM); phase-to-code mapping (no V7 checkpoint references a phase); the keyword classes of AUTHORITY_REQUIRED screens in `DEPENDENCY_MAP.md`; the Oct-31 scope (M2 "operational Desktop", itself P50 with low confidence in the stale ETA document).
- **Drift**: GitHub state was changing during the audit (heads moved, PRs closed, reviews posted every hour). Values are as of 2026-10-19T04:45Z.
- **Side effects of the synthesizer**: one `git fetch origin` in the shared repository (updates remote-tracking refs only). No working-tree file outside `docs/inventory/2026-10-19/` was written; nothing was committed or pushed; no PR, label or review was changed.
