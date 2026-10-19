<!-- //TR: Roadmap (149 faz) ve tum backlog/gereksinim belgelerinin kaynak kaydi; tarih/sha, guncel mi bayat mi, hangi isleri tanimladigi ve belgeler arasi celiskiler (2026-10-19 envanteri, kapsam D+P). -->

# Requirements and backlog source register (scope D + P)

- **Audit time:** 2026-10-19 ~03:47 UTC. Auditor: independent inventory subagent (read-only; no commit, no push).
- **Canonical code:** `origin/v7/integration @ e12dbdd` (worktree `/home/user/uasco-inventory`). `origin/master @ 061f78d` is an ancestor. Nothing has merged since PR #10 (2026-10-18T05:09Z).
- **Companion files:** `phases.csv` has 149 rows, one per roadmap phase (`PH-000`..`PH-148`). `backlog-items.csv` has 56 rows, one per distinct backlog task that no screen row or phase row already covers.
- **Rule used:** a contract, registry row, design document or planning CSV is **not** an implementation. A merged module is **not** an integrated function. A route or endpoint is **not** product verification. No phase and no backlog item is `PRODUCT_VERIFIED`.

## 1. Results

### 1.1 Phases (`phases.csv`, 149 rows)

| Status | Count | Meaning in this scope |
|---|---|---|
| DESIGN_ONLY | 100 | Only the phase contract, plus at most spec docs or registry rows and their consistency validators. There is no runtime code for the capability. |
| IN_PROGRESS | 33 | Merged code implements part of the capability, and at least part of it is wired into the app or the construction automation. The phase contract is not closed. Nobody is necessarily assigned. |
| MERGED_NOT_INTEGRATED | 9 | A merged module exists, but no product path imports it (only tests or scripts do). Phases 14, 23, 29, 30, 32, 36, 38, 63, 104. |
| INTEGRATED_NOT_VERIFIED | 3 | The core capability is merged and served by the control API and desktop. There is no phase evidence and no product verification. Phases 19 Mission OS, 26 global stop/resume, 45 Evidence Bus. |
| AUTHORITY_REQUIRED | 4 | The next step is a Founder or risk decision. Phase 0 (signature + target machine), 44 (sandbox isolation decision FD-REL-1), 147 (contract names the retired Codex review), 148 (risk-5 production). |
| PRODUCT_VERIFIED / CLEAN / MERGED as phase | 0 | All 149 contracts and all 34 review packages are `PLANNED`. No `phase-NNN-evidence.json` exists anywhere, and no phase review was ever run. |

- **Connected:** ui_connected is YES for 10 phases and PARTIAL for 18. api_connected is YES for 12 and PARTIAL for 22.
- **Oct 31:** DELIVERABLE 0, AT_RISK 36, NOT_DELIVERABLE 4, NONE 109. Oct 31 is the M2 "operational Desktop" target, P50 with low confidence, per `UASCO_DESKTOP_DELIVERY_ETA_2026-10-15.md` section D. AT_RISK means partial code behind the shipped desktop or in M2 scope. NONE means outside the M2 scope.
- **Formal gate:** every phase from 1 to 148 is formally blocked by `entryCriteria[0]`, because Phase 0 is not closed. `audit/KNOWN-TARGET-MACHINE-PENDING.md` says that without a target-machine `PHASE0_ACCEPTANCE.json` CLEAN, the autonomous roadmap build must not start.
- **No link to V7 work:** all V7 product work (Lane B, 27 V7 checkpoints) was built **outside** the phase system. Zero V7 checkpoints reference a roadmap phase (`grep -E "[Pp]hase[ -]?[0-9]" audit/checkpoints/V7-*.json` finds nothing). Every phase-to-code mapping in `phases.csv` is therefore auditor judgement, with confidence stated per row.

### 1.2 Backlog items (`backlog-items.csv`, 56 rows)

| Status | Count | Examples |
|---|---|---|
| AUTHORITY_REQUIRED | 16 | Merge-gate CI contexts (BL-CI-03); public visibility (BL-CI-11); second identity (BL-GOV-01); FA-LEASE2 (BL-GOV-02); DOC-TRUTH (BL-GOV-05); WFR-03 validator (BL-GOV-06); SV1-1 (BL-AUT-05); 7 B2 test gaps and B2-SBOM (BL-QA-01..08); pre-dev backend contract (BL-PD-01) |
| DESIGN_ONLY | 16 | DEV-001..116 (1 row) and the 14 reliability bands REL-117..216, whose texts are not in the repo; 72 h endurance plan |
| PENDING_CI | 7 | Each has a CLEAN COMMENT verdict bound to its current head but no CI: #12, #15, #17, #18, #21, #29, #31 |
| PENDING_REVIEW | 6 | #11 merge gate and next-step engine, #16 canonical backlog, #20 cleanup, #49 shards and reseal, #50 desktop-e2e |
| OBSOLETE | 4 | Self-hosted runner #30 (closed); npm-audit egress workaround; local AUT1 activation; Managed Agents PoC (paid) |
| NOT_STARTED | 3 | CircleCI (no `.circleci/` on any remote ref); requeue of the 40-PR backlog; LOW advisories |
| IN_PROGRESS | 2 | Hosted CI restoration (only on new heads); hourly heartbeat routine |
| BLOCKED | 2 | v7/integration branch protection; reseal serialization |

All 56 backlog rows are NO for ui_connected, api_connected and product_verified. For Oct 31: AT_RISK 18, NOT_DELIVERABLE 17, NONE 21, DELIVERABLE 0.

## 2. Source register

Currency labels:
- **CURRENT:** matches the code or reality at audit time.
- **STALE:** superseded or wrong in places.
- **STALE_BASELINE:** the v6 planning export. Used only as an ID source.
- **OBSOLETE:** superseded by a later Founder decision.
- **UNKNOWN_SOURCE:** the file is on the Founder PC and not in any git ref.

### 2.1 On `origin/v7/integration @ e12dbdd`

| # | Source | Last commit | Currency | Work items it defines | Inventory mapping |
|---|---|---|---|---|---|
| S1 | `ROADMAP.md` (485 lines, periods A-P) | c692a4f 2026-09-23 | CURRENT as phase-ID source; carries no status | Phase 0..148, exits `PHASE_NNN_VERIFIED` | PH-000..PH-148 |
| S2 | `roadmap/contracts/phase-000..148.json` (149), `registries/phase-contracts-index.json` | 56b3b3f 2026-09-23 | CURRENT as requirements. All `state: PLANNED`. All 149 name "independent Codex package review" | Deliverables, mandatory failure cases, artifacts, risk, allowed paths | PH-* `missing_functions` |
| S3 | `roadmap/review-packages.json` (34 packages, 14 CORE/2 HIGH/18 MEDIUM, all PLANNED); `build-waves`, `critical-path`, `dependency-graph`, `parallel-lanes` (`SERIAL_ONLY_MAX_PARALLEL_LANES_1`), `scheduler-state.template` (all PENDING) | 2026-09-23 | CURRENT as plan; never executed | PKG-001..034 | PH `screen_role_phase_ref` / priority |
| S4 | `CANONICAL-STATUS.md` (sealed) | ace022d 2026-10-14 | STALE in places (see C3, C19) | V6 gates: packaging, signature, target Phase0 | PH-000, BL-GOV-05 |
| S5 | `COMPLETENESS-BASELINE.md` (38 fabrics/systems + P2 regulated packs) | ace022d 2026-10-14 (V3-era content) | CURRENT as scope, no status | Labs 1-25, common systems 26-38 | Folded into phases 38-104 (labs). No separate rows (dedup) |
| S6 | `DEFINITION-OF-DONE.md` | ace022d 2026-10-14 | CURRENT | Closure criteria: governed CLAUDE_REVIEWER on bundle digest, post-merge verification | Basis for "no phase closed" |
| S7 | `registries/implementation-reality.json` | c692a4f 2026-09-23 | STALE (pre-V7), still true that "all final roadmap phases" are not implemented | Starter runtime list and registeredNotImplemented list | PH evidence |
| S8 | `audit/CURRENT-AUDIT-STATE.json`, `audit/KNOWN-TARGET-MACHINE-PENDING.md` | cd6d6e9 2026-10-06 | STALE for V7. The pending list is still open | Target-machine pending items | PH-000, PH-030 |
| S9 | `audit/checkpoints/*.json`: 103 total (76 V6, 27 V7 dated 2026-10-14..18) | various | CURRENT as evidence records. V7 ones say NOT CLEAN at write time | V6 packages, V7 B0..B11, PS-1A/1B, SBX-8, RELFX, M1A, INT-R3/R4, LEASE1 | PH evidence |
| S10 | `audit/reviews/*.json`: 25 V6 Codex-era records, all `UNSIGNED_EVIDENCE_KEY_NOT_INIT` | 2026-09/10 | CURRENT. **No V7 review records in the repo** | Package verdicts (R3 CLEAN, AUT1/T1/T3 c1 BLOCKED, ...) | PH review_result |
| S11 | `.ai/MASTER_STATE.json`, `CURRENT_PHASE.md`, `CURRENT_MILESTONE.md`, `NEXT_ACTIONS.md` | f0a4f0a/b070dcb 2026-09-28/29 | STALE, yet still served live by `GET /v1/factory` (server.ts:105) | V6 next actions 1-10 | PH-000, BL-AUT-04, BL-GOV-05 |
| S12 | `docs/architecture/*.md` (21 specs, 6-215 lines) | 2026-09-23..10-14 | CURRENT as design. Mostly 6-21 line stubs | Lab and fabric designs | DESIGN_ONLY notes |
| S13 | `docs/closure/*.md` (9) + duplicates in `audit/history/*` | 2026-09-23 | STALE (historical V2/V3 audits) | Historical findings | none |
| S14 | `docs/governance/*` (3), `docs/adr/ADR-0001` (2026-10-15), `docs/installer/README.md` (2026-10-15), `docs/tr/FOUNDER-OPERASYON-REHBERI.md` (2026-09-23, stale) | | Mixed | Policies, installer | PH-033/087/094, PH-102 |
| S15 | `registries/role-definitions.json` (599 RoleDefinitions, WFR-03); `organization/agents` (363); `organization/departments` (40); `domain-packs/*.json` (22) | 2026-09-23..10-15 | CURRENT as catalog | Roles and domains (catalog, not runtime) | PH-009/010/105-123 notes |

### 2.2 Open or closed PR branches (read with `git show`)

| # | Source | Branch @ sha (date) | Currency | Work items | Mapping |
|---|---|---|---|---|---|
| S16 | `docs/planning/BACKLOG_CHECKPOINT.json` (45 tasks), `README.md`, `STATUS_2026-10-18.md`, `FOUNDER_BATCH_APPROVAL_2026-10-18.md`, `FOUNDER_BATCH_2_AUTHORITY_REQUIRED_2026-10-18.md` | claude/pensive-mayer-16pnt2 @2810759, PR #16 (2026-10-18) | **Most recent canonical backlog**, but NOT merged. Review INCONCLUSIVE. STATUS doc was overtaken within hours (C11) | 45 tasks. Screen tasks (UI-*, L-* lanes, B2-UI-*) go to the screens inventory. Infra, governance and test tasks are in BL-* | BL-AUT-01, BL-GOV-*, BL-QA-* |
| S17 | `docs/autonomy/*` (README, MERGE-GATE-FIX, FA-LEASE2 request/scope/draft, LOCAL-MAINTAINER-DELEGATION, ENDURANCE-72H, backlog-drafts, reference engine) | claude/autonomy-recovery-prep @7c5e68b, PR #11 (2026-10-18) | CURRENT drafts. Label `uasco-needs-fix`. Review INCONCLUSIVE | P1-P6: merge gate, lease wiring, backlog, next-step engine, single ownership, 72 h test | BL-CI-03/04/05, BL-GOV-02, BL-AUT-02/03 |
| S18 | `docs/cloud-production/{README,RECOVERY,QUEUE.json,DECISIONS-2026-10-18}.md` and governance scaffold | claude/cloud-production-engine @ed5cfb9 (PR #15); claude/cp-gov-scaffold @0ef069d (PR #31). QUEUE.json is identical in both | CURRENT, but QUEUE.json does not know about the 2026-10-19 CI changes | CP-QUEUE/REPORT/CI/DISPATCH/RECOVERY/GOV, FA-LEASE2, BACKLOG-SOURCE-REBASELINE, ACTIONS-CI-RESTORE, FEATURE-BACKLOG-GATED | BL-CP-*, BL-GOV-03 |
| S19 | `docs/cloud-production/ci/SELF-HOSTED-CI.md` | claude/ci-selfhosted-integration @c960949, PR #30, **closed unmerged** 2026-10-19T03:24:58Z | OBSOLETE (Founder 2026-10-19: no local runner) | Self-hosted runner | BL-CI-09 |
| S20 | `docs/cloud-production/ci/public-ci/*` (AUTHORITY-FD-PUBLIC-CI-2026-10-19, README, `ci.proposed.yml`, 8-shard plan, ruleset proposal) | claude/public-cloud-ci @498e2eb, PR #49 (2026-10-19, created after the prs.json snapshot) | CURRENT, but conflicts with the relayed request (C23) | Test sharding, SHA-bound `CI_EVIDENCE.json`, ruleset, protected reseal of 4 files | BL-CI-06, BL-CI-11 |
| S21 | `docs/planning/DISPATCH.md` + `dispatch.mjs` | claude/cp-dispatch-impl @539d88d, PR #29 | CURRENT | Dispatcher | BL-CP-04 |
| S22 | `docs/cloud-production/reports/PRODUCTION-LOG.md` | uasco/production-reports @4b548d3 (heartbeat #9, 2026-10-19T03:12Z) | CURRENT status log. Contains errors (C9) | none (reporting) | BL-CP-06 |
| S23 | `scripts/e2e/desktop-e2e.mjs`, `.github/workflows/desktop-e2e.yml` | claude/e2e-desktop-product-verification @ba775b8, PR #50 (2026-10-19) | CURRENT | Route-level desktop E2E harness | BL-QA-09 |

### 2.3 STALE_BASELINE export: `docs/planning` of `origin/v6/pkg-t4-…-4js0ph @ 9dbb708`

Commit 9dbb708 is "WIP: uncommitted changes, moved to the cloud". It carries its parent's timestamp (2026-09-29), but the documents themselves are dated 2026-10-15..17, so the commit dates are unreliable. Most documents point to Founder-PC paths (`C:/Users/salim/...`) and local clones (`UASCO-wt/v2-*`). **None of them is used as current status.**

| Document (content date) | Defines | Currency |
|---|---|---|
| `SCREEN_TRACEABILITY_252_PLUS.csv` + `AUDIT_252_EXECUTIVE_SUMMARY.md` + `AUDIT_252_GAP_REPORT.md` (2026-10-16, basis ec105b7) | UI-001..UI-252 rows | STALE_BASELINE, ID source for the screens inventory |
| `SCREEN_TRACEABILITY_REBASELINE_2026-10-16.md` | Header-count correction against local trunk 6f4f53e | STALE |
| `REQUIREMENT_TO_UI_CROSSWALK.csv` (287 rows) | UX-DEC-001..071 (71), DEV-001..116 (116, placeholder text), REL-117..216 (100, bands A-N, placeholder text). 206 UNMAPPED, 54 PARTIAL, 27 COVERED | ID source only. Texts are UNKNOWN_SOURCE. Gives BL-REQ-DEV and BL-REQ-REL-A..N |
| `BACKLOG_CHECKPOINT.json` (2026-10-16, 16 WP packages, head ec105b7) | WP-SHELL..WP-MISC screen packages | STALE. Superseded by S16 |
| `PRODUCTION_QUEUE.json` (2026-10-17) | done/active/queue (UI-074 active, UI-248, UI-016, WP gaps); gate = PC path `merge-via-gate.mjs` | STALE |
| `UASCO_FULL_PRODUCT_DELIVERY_MASTER_ETA_2026-10-15.md` (v3, 2026-10-16) | Five delivery targets A/B; 13-step acceptance chain; 13 first-release roles; F2 pre-dev contract; isolation options K; SC-01..18 calendar; 599 roles / 0 of 3,594 evals | STALE. Steps folded into PH-019/021-024/044/047/088/101/102 and BL-PD-01 |
| `UASCO_DESKTOP_DELIVERY_ETA_2026-10-15.md` | M0/M1/M2 (**Oct 31 P50, low confidence**) / M3; Lane A SV1-1/AS1; B8 CI release; REL-WK-00..06; WFR-04b..12; REA-WK-02..09 | STALE. Defines the Oct-31 scope used for `oct31_impact` |
| `UASCO_DAILY_STATUS.md` (2026-10-16/17) | Oct-31 tracking; "30 CLEAN of 31 reviews" (C10) | STALE |
| `UASCO_SC_GAP_AND_ROADMAP_2026-10-15.md`, `UASCO_DESKTOP_UX_GAP_ANALYSIS_2026-10-15.md` (+sha256), `VISUAL_PARITY_REPORT.md` | SC-01..SC-18 screen contracts, UX gaps, code-level visual parity | STALE (screens scope). Design source UNKNOWN_SOURCE |
| `UASCO_M1_SANDBOX_ISOLATION_ASSESSMENT`, `UASCO_M1_SUPPORTED_ISOLATION_PLAN` (SBX-0..SBX-11 table lines 324-331), `UASCO_M1_SANDBOX_APPROVAL_PACKET`, `UASCO_M1_PHYSICAL_WORKER_PERMISSION_PACKAGE`, `UASCO_SBX_EXTERNAL_SECURITY_PACKAGE` (all 2026-10-15) | Sandbox packages SBX-0..11, FD-REL-1, physical-worker option, external security lab | STALE. SBX-0 and SBX-8 are merged, SBX-1..7 are absent. Folded into PH-044 (AUTHORITY_REQUIRED). The physical worker or VM conflicts with the 2026-10-19 "no new VM / local runner" request |
| `UASCO_MANAGED_AGENTS_COST_AUTH` (+sha256), `UASCO_MANAGED_AGENTS_POC_PLAN`, `UASCO_CLAUDE_CLOUD_EXECUTION_FIT` (+sha256) (2026-10-15) | Managed Agents PoC (paid API), cloud-fit research | OBSOLETE for spend (BL-AUT-06). Cloud sessions are now used instead |
| `HYBRID_CLOUD_PILOT_PREP_2026-10-16`, `HYBRID_GITHUB_CLOUD_APPROVAL_PACKAGE` (2026-10-17), `CLOUD_ROUTINE_CONFIGS` (2026-10-17), `UASCO_CLOUD_ROUTINE_CONFIGS_REVIEWED_V2` (2026-10-17) | Hybrid pilot, routines A/B | STALE. Superseded by S18 (MAXIMUM CLOUD PARALLEL 2026-10-18) |
| `UNATTENDED_EXECUTION_READINESS.md` (2026-10-16) | "UNATTENDED_READY = NO" checklist, options 1-3 | STALE but still true: no 72 h proof (BL-AUT-03) |
| `UASCO_EXISTING_SYSTEM_RECONCILIATION_2026-10-15`, `UASCO_USER_READY_INSTALLER_ANALYSIS_2026-10-15` (A-G), `UASCO_FIRST_EXE_INSTALL_2026-10-15`, `UASCO_UPDATED_EXE_INSTALL_2026-10-16` | First EXE M0/M1 and installer analysis. The Founder installed 0.7.0-dev.1 ("kurduğunuz 0.7.0-dev.1") | STALE. Evidence only of installation, not of verification. PH-102 |
| `MODEL_USAGE_AUDIT_2026-10-16.md` | Which models were really used (per-call model UNKNOWN) | STALE. PH-031 note |
| `TASKHUB_PREDEV_E2E_EVIDENCE.md` (CORE-3), `TASKHUB_CODEGEN_EVIDENCE.md` (CORE-4) | Builder-authored pre-dev and code-gen chain evidence. The generated code was "not run / not tested" | STALE. PH-021/049/146 notes |

### 2.4 UNKNOWN_SOURCE (Founder PC only; not in any git ref)

| Item | Referenced by | What is missing |
|---|---|---|
| Master V2 plan `C:/Users/salim/UASCO-recovery/product/V2-GAP-AND-QUEUE-2026-10-14.md` (planSha256 `51006c7f…`) | `audit/checkpoints/V7-PKG-B0-PRODUCT-AUTHORIZATION-2026-10-14.json` | Lane B package definitions B0-B11; "216 başlık / 71 UX / 599 hedef" |
| 252-screen design package `C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16` (incl. `10_KAPSAM_KAPATMA/…`), UX-DEC-001..071 texts, `UASCO_COMPLETE_DESKTOP_UI_UX_IMPLEMENTATION_BLUEPRINT.md` (SC-01..18) | AUDIT_252, SC_GAP, crosswalk | Design content and parity reference |
| `UASCO_DESKTOP_116_GELISTIRME_UX_AKIS_ENTEGRASYON_EKI`, `UASCO_GUVENILIRLIK_TAM_KAPSAM_117_216_ENTEGRASYON`, `ux-71-decision-crosswalk.csv` | Crosswalk `requirement_source` column | Texts of DEV-001..116 and REL-117..216 |
| `product/rel/REL-FIRST-EXE-P0.md`, `REL-WK-00-part2-rel117-168.md` | USER_READY_INSTALLER_ANALYSIS line 11 | REL-WK work-package contents |
| `eta2-measured-data.md`, `CHECKPOINT-2026-10-14-authz.md`, `cloud-research-evidence.json` | ETA docs, DAILY_STATUS, CLOUD_EXECUTION_FIT | Measurement and decision evidence |
| V7 review records `C:/Users/salim/Desktop/UASCO/audit/reviews` and PC `governed-review/merge-via-gate.mjs` | PRODUCTION_QUEUE.json gate line | Proof of the V7 package CLEAN claims |
| SV1-1 commit `3492387` and local clones `UASCO-wt/v2-*` | DESKTOP_DELIVERY_ETA:42 | Lane A supervisor source (`git cat-file -t 3492387` fails) |

## 3. Contradictions between documents (and between documents and reality)

| # | Contradiction | Evidence |
|---|---|---|
| C1 | Phase 147 is titled "Comprehensive Codex independent review", and all 149 contracts name "independent Codex package review". Codex review was retired. | `grep -l Codex roadmap/contracts/*.json` gives 149; `V6-PKG-GOV2-CODEX-REVIEW-RETIREMENT-2026-10-12`; CLAUDE.md |
| C2 | Phase 10 is "363 Agent Technical Genome" (organization/agents = 363), but the product catalog is 599 RoleDefinitions (WFR-03), served by `GET /v1/roles`, and Master V2 says "599 hedef". | `registries/role-definitions.json` counts 599; server.ts:549,565 |
| C3 | CANONICAL-STATUS.md says the R3 review is "pending (reviewer quota)", X1 is "merge held" and AUT1 is "on its own branch". In fact `audit/reviews/V6-PKG-R3-ca21e83-c1.json` is CLEAN, X1 c2 is CLEAN, and X1 and AUT1 tests exist on v7/integration. | CANONICAL-STATUS.md "Independent review"; canonical backlog DOC-TRUTH-CANONICAL-STATUS |
| C4 | `GET /v1/factory` serves `.ai/MASTER_STATE.json` (2026-09-28: `currentPhase 0`, `V6_AUDIT_REMEDIATION_IN_PROGRESS`), so the running app shows V6 state. | server.ts:105 |
| C5 | The phase entry criteria and KNOWN-TARGET-MACHINE-PENDING forbid the roadmap build before Phase 0 CLEAN. Lane B (FA-V2-PRODUCT) built and merged the whole V7 product anyway, with zero phase linkage. | 27 V7 checkpoints contain no phase reference |
| C6 | MERGE-GATE-FIX.md and LOCAL-MAINTAINER-DELEGATION D1 assume `gh api` can protect v7/integration. CANONICAL-STATUS and NEXT_ACTIONS record protection as unavailable on the GitHub Free private plan. A paid plan conflicts with the no-billing rule. | BL-CI-05 |
| C7 | `merge-via-gate.mjs` (PR #11) only accepts `validate (ubuntu-latest)` and `validate (windows-latest)` from a pinned GitHub check-run app. The 2026-10-19 Founder request names CircleCI. As written, the gate can never pass with CircleCI results. | BL-CI-03 |
| C8 | SELF-HOSTED-CI.md (PR #30, 2026-10-19) puts a runner on the Founder PC, which the 2026-10-19 request forbids. PR #30 is now closed. | BL-CI-09 |
| C9 | PRODUCTION-LOG heartbeat #8 says "closed PRs #1-#7, #9, #10 report merged=false". prs.json reports merged=true, and git history has merge commits for #1, #4, #6, #7, #9 and #10. Heartbeat #7 also miscounted open PRs (pagination; corrected in #8). | origin/uasco/production-reports @4b548d3; `git log --first-parent origin/v7/integration` |
| C10 | DAILY_STATUS claims "31 review results, 30 CLEAN" and "~27 CLEAN packages". The repo holds no V7 review record, and every V7 checkpoint says NOT CLEAN or review pending. | `ls audit/reviews` (25 V6 only) |
| C11 | STATUS_2026-10-18 (PR #16) says the final deltas of #17, #18 and #29 were not re-reviewed. GitHub shows CLEAN COMMENT reviews bound to those exact heads: d9843ce 17:43Z, d3fa735 17:42Z, 539d88d 17:42Z and 02:41Z. | `gh api pulls/{17,18,29}/reviews` |
| C12 | PR #19 has conflicting verdicts on the same head d6cc46c: CLEAN at 15:39Z, INCONCLUSIVE at 15:40Z, then "no blocker - not CLEAN" at 16:36Z. | `gh api pulls/19/reviews` |
| C13 | FOUNDER_BATCH_APPROVAL_2026-10-18 says in its header "Founder APPROVED all four lanes (in-session)", while its body says "Nothing below is READY; approval = Founder writes APPROVED". The `authorizedBy` values cite in-session messages with no durable authority record. | PR #16 docs |
| C14 | `implementation-reality.json` lists action-gateway and vault-dlp as registeredNotImplemented. Starter `core/action-gateway/policy.ts` and `core/policy/dlp.ts` exist, and the gateway is wired with permissive defaults (server.ts:165 sets scope, data, budget and adapter gates to true). | PH-004 |
| C15 | Phase contracts are template-generated. Unrelated phases share identical artifacts and failure cases: 70 and 111, 73 and 90, 42 and 56, 84 and 131, 14 and 136, 122 and 142, 95 and 144, 101 and 145, 6 and 133/134. Contract specificity is weak. | `roadmap/contracts/phase-*.json` `requiredArtifacts` |
| C16 | DAILY_STATUS (2026-10-16) says the Oct-31 critical path is "largely DONE at source level". Since then nothing has merged (CI dead until 2026-10-19, 40 open PRs), and M2 was itself only P50 with low confidence. | BL-CI-10 |
| C17 | AUDIT_252 uses basis ec105b7. The rebaseline names local trunk v7/ux-journey @6f4f53e. The current canonical code is origin v7/integration @e12dbdd. The screen baselines refer to three different trunks. | v6-planning headers |
| C18 | CLOUD_ROUTINE_CONFIGS.md says the routines were verified and cost "no extra charge". The reviewed V2 says it is a template that proves nothing. Only the PRODUCTION-LOG heartbeats show that a routine runs. | BL-CP-06 |
| C19 | CANONICAL-STATUS says "CLAUDE_CLOUD_SESSION NOT_CONFIGURED; cloud execution never claimed". Cloud sessions in fact produce PRs #11-#50 and hourly heartbeats. | prs.json; PRODUCTION-LOG |
| C20 | The Master ETA marks step 9 (independent review) "PARTIAL→IMPLEMENTED (VERIFIED)". Every GitHub review is a COMMENT under the single identity SalimBurakAytemiz, so the common-mode risk of Phase 18 stays open. | BL-GOV-01 |
| C21 | The crosswalk lists DEV and REL items with placeholder text only. The canonical requirement texts are not in the repo, so they cannot be deduplicated against phases or screens. | BL-REQ-* |
| C22 | The known session facts say "Actions quota exhausted; no usable CI". At audit time hosted CI **runs again** on new heads, because the repository is public. Only PR #50 ba775b8 has a green validate(ubuntu) plus desktop-e2e on both OS, with validate(windows) still running at 03:52Z. e12dbdd and the older PR heads still have no green run. | `gh api commits/ba775b8/check-runs` |
| C23 | **The repository visibility is PUBLIC** (`gh api repos/...`: `visibility=public`, `private=false`). The relayed Founder request says "Mevcut GitHub private repository korunacak" and chooses CircleCI. PR #49 states that the public repo "supersedes #30 and the CircleCI plan". No repo record authorizes the visibility change. FD-PUBLIC-CI-2026-10-19 covers only 4 protected files for PR #49. | BL-CI-11 |
| C24 | LOCAL-MAINTAINER-DELEGATION and FA-LEASE2 say Cloud must not receive re-seal authority. PR #49 contains a "Cloud maintainer trust-root reseal" commit (498e2eb) under FD-PUBLIC-CI-2026-10-19. It was authored in a different Claude session (`session_014aT3B…`) from the builder, but that separation and the authority itself are recorded only inside the PR. | `git show 498e2eb`; `AUTHORITY-FD-PUBLIC-CI-2026-10-19.md` |
| C25 | PR #49's body says the protected files are "NOT in this PR yet". Its file list does include `.github/workflows/ci.yml`, `config/validation.json`, `scripts/phase0-acceptance.mjs` and `config/trust-root-manifest.json`, because the later reseal commit 498e2eb added them (b516722 only added the authority doc). The PR body is stale against its own head. The first sharded runs on 498e2eb FAILED on both OS (windows 03:45:52Z, ubuntu 03:47:59Z). | `gh api pulls/49/files`; `git show --stat 498e2eb b516722`; `gh api commits/498e2eb/check-runs` |

## 4. Dedup decisions (one record per real work item)

- **Merged into PH-000:** RELEASE-SIGNATURE-PHASE0 (canonical backlog), NEXT_ACTIONS 2-7, and KNOWN-TARGET-MACHINE-PENDING (Task Scheduler, remote privacy, real merge/push).
- **Merged into PH-044:** FD-REL-1-GATED-SET (its non-screen part), SBX-0..SBX-11, the M1 physical-worker package and the isolation options K.
- **Merged into PH-014:** WFR-04b..12 (eval infrastructure, 27-role pilot, 3,594 evals).
- **Merged into PH-102:** B8 CI release workflow, installer code-signing certificate, and server deploy (Master ETA step 12).
- **Merged into PH-055 / PH-078:** the QA-lab tools Playwright and Newman.
- **One work item each, with the old PR marked DUPLICATE inside the row:** #13 with #18 (CP-REPORT) and #14 with #17 (CP-QUEUE).
- **One row (BL-CI-06):** "retarget ci.yml to stop quota burn" and the Windows-600 s sharding item, because PR #49 does both.
- **Merged into BL-AUT-01:** P0-REMAINDER-AUDIT, P1-P2-BACKLOG-AUDIT and SCREEN-EVIDENCE-DEBT. Their per-screen work, including the test+states PRs #34-#48, belongs to the screens inventory.
- **Excluded here as screen work:** HOME-DELIVERY-STATE (#19), B2-UI-023/124/246, UI-016/004/027/220, WP-COMPANY-WRITE and UI-074 (#8). They are counted in `screens-part-*.csv`.
- **Grouped as requirement sets, not individual tasks:** DEV-001..116 is 1 row and REL-117..216 is 14 band rows, because the texts are unknown. REL-WK-01..06 is folded into the bands.
- **Mentioned only, not counted:** TEK topics and REA-WK-02..09. No definition exists in any accessible source.

## 5. Overlap with other raw files (for the consolidator; do not add counts across these)

- **`labs.csv` vs phases.** F-LAB-01..25 (execution fabrics) map onto these phases: 44, 55-76, 81, 83, 84, 87-105, 110, 115-123, 126 and 131. Count a lab and its phases as the same work.
- **Classification differences.** For mobile, cloud, payment, IoT, XR and game labs, `labs.csv` uses AUTHORITY_REQUIRED, while `phases.csv` uses DESIGN_ONLY and lists the authority in `authority_needed`. The reason: these phases have no code at all, and authority would only be the next step after design. Reconcile to one class per merged item.
- **Roles and UX decisions.** `roles.csv` (363/599 roles) and `ux-decisions.csv` (UX-DEC-001..071) cover what PH-009/PH-010 and the crosswalk UX rows reference. No UX-DEC row is repeated in `backlog-items.csv`.
- **Screens.** Screen rows (`screens-part-*.csv`, `frontend.csv`, `workspaces.csv`) carry the UI-* backlog, the L-* lanes and PRs #8, #19, #22-#28, #32-#48. In `backlog-items.csv`, PRs #34-#48 appear only inside BL-CI-10, the merge-queue item.

## 6. Top blockers (owner)

1. **Repository visibility.** The repo is public, contrary to the private-repo requirement. Only the Founder can confirm or revert (BL-CI-11).
2. **No green Windows+Linux CI on any merged or reviewed head.** Run 39099588440 on e12dbdd FAILED on both OS. PR #49 attributes this to the 600 s tests-step timeout, which I could not verify because the log blob is blocked. Hosted CI runs again only on new heads. CircleCI is not started.
3. **The merge gate is not accepting anything:** it exists only on PR #11, its contexts are fixed to GitHub Actions job names, branch protection is unavailable on the private Free plan, and there is no second reviewer identity.
4. **FA-LEASE2 is unwired:** it needs a sealed D3 record. CP-GOV (PR #31) is the authorized path but has not merged.
5. **Phase 0 is not closed:** the Founder's detached signature and a target-machine `install.ps1` run are missing. This formally gates all 148 later phases.
6. **Sandbox isolation (FD-REL-1):** no verified provider exists, so project tests and previews are never executed. The options either conflict with the 2026-10-19 rules (VM or physical worker; Managed Agents spend) or need FA-SBX protected work (AppContainer SBX-2..7).
7. **The requirement texts for 216 Master V2 topics, 71 UX decisions and the 252-screen design are UNKNOWN_SOURCE** (Founder PC only).
