<!-- //TR: Ajan, otomasyon ve yonetisim durumu: bulut rutinleri/oturumlari, kiralama, birlestirme kapisi, inceleme bagimsizligi ve guvenlik durusu / Agent, automation and governance status -->

# Agent, automation and governance status, 2026-10-19

Sources: `raw/automation-governance.csv` (AG-001..034), `raw/qa-security.csv` (QS-001..033), `raw/ci.csv`, `raw/backlog-items.csv`, consolidated into the `PT-*` tasks of `master-work-inventory.csv`, plus the synthesizer's live re-check at 2026-10-19T04:45Z.

## What runs for real today and what does not

| Runs for real | Evidence |
|---|---|
| Hourly independent cloud reviewer routine | New COMMENT reviews at 04:41Z on #26, #33, #38, #42, #50 (session `session_01EQAoSLnjE4dY4FuUTghp2D`, Node v22.22.0, no dependencies, so validation NOT_RUN) |
| Hourly production heartbeat | 10 hourly logs on `uasco/production-reports` (`b7aa3cc` at heartbeat #10, 2026-10-19T04:12:46Z; the auditor read 9 up to `4b548d3` at about 03:55Z); READY 0, 0 tasks dispatched; reads a stale `QUEUE.json` from unmerged PR #15 (`ed5cfb9`) |
| Cloud orchestrator + child sessions | PRs #11-#50 authored by cloud sessions (orchestrator `session_01DmTHw4gBA3wvY1tKM9bk2e`); 14 `uasco-cloud-production` child sessions |
| GitHub-hosted CI on new heads | Real runs since the repo became public; ubuntu green on several heads, windows red everywhere |
| Diagnosis workflow on `ci/diagnose-shards` | Runs 39198024691..39199769202 (04:09-04:30Z) succeeded; diagnosis only, not validation |

| Does not run / not wired | Evidence |
|---|---|
| Cloud Development routine (implementer) | Fires hourly, stops BLOCKED every time: the canonical backlog exists only on PR #16 |
| Atomic task lease + verdict guard | Merged in PR #10 but imported only by its own store and test; no `refs/uasco/*` on origin; FA-LEASE2 D3 record absent |
| Coded merge gate | Only on PR #11; last reviewed head BLOCKED (self-attested verdict file, unbound `--apply` base); new head unreviewed |
| Branch protection / rulesets | `protected:false` on v7/integration and master; rulesets `[]` |
| Second approver identity | None; every review (141 at about 04:00Z, more since) by one identity, 0 APPROVED |
| Morning report routine | Fired, produced nothing (no repo access) |
| Local Windows Task Scheduler supervisor | Obsolete under the cloud-only decision; install state on the Founder PC UNKNOWN |

## Cloud automation tasks

| ID | Task | Status | Pri | Key evidence |
|---|---|---|---|---|
| PT-039 | Routine 'UASCO Cloud Development' (hourly cloud implementer) | BLOCKED | P1 | AG-001: list_triggers: trig_018vLbG82sUcp6ncPhRurka5 enabled, last_run 2026-10-19T03:29:07Z SUCCEEDED session cse_013X2PhKRAWgQimw71WHVm8i; result text 'BLOCKED. ... docs/planning/BACKLOG_CHECKPOINT.json does not exist … |
| PT-040 | Production heartbeat routine + CP-RECOVERY persistent scheduled executors | IN_PROGRESS | P2 | AG-003: git log origin/v7/integration..origin/uasco/production-reports: 9 commits 534f6ca (2026-10-18 22:12 +0300) .. 4b548d3 (2026-10-19 06:12 +0300); list_triggers last_run 2026-10-19T03:12:04Z SUCCEEDED cse_01Ahqf7fW… |
| PT-041 | Routine '05:00 TRT morning production report' (one-shot) | BLOCKED | P2 | AG-004: list_triggers: ended_reason run_once_fired, last_run 2026-10-19T02:00:20Z session cse_013iGGobqovUZcVfsDvSgSyC; result text: 'I couldn't produce the morning report, because this session has no access to the repo… |
| PT-042 | Orchestrator follow-up / safety-net reminder routines (session-bound) | IN_PROGRESS | P3 | AG-005: list_triggers (2026-10-19T03:55Z): 11 reminders with persistent_session_id session_01DmTHw4gBA3wvY1tKM9bk2e; 10 ended_reason run_once_fired or disabled, 1 enabled (trig_01NxpRpWAS4nAFW593jUxJut) |
| PT-043 | Disabled 'UASCO Cloud Development' probe routine (duplicate name) | OBSOLETE | P3 | AG-006: list_triggers: trig_017MW7Ln2JfbiasnumAp5cJU created 2026-10-17T15:44:44Z enabled=false, no last_run |
| PT-044 | Cloud orchestrator / cloud supervisor session (UASCO Master V2) | IN_PROGRESS | P1 | AG-007: list_sessions(mine): session_01DmTHw4gBA3wvY1tKM9bk2e status RUNNING, parent_session_id of 14 uasco-cloud-production sessions; git log --format=%(trailers:key=Claude-Session) per branch (this audit) |
| PT-045 | Cloud implementer / maintainer child-session fan-out | IN_PROGRESS | P1 | AG-008: list_sessions(mine) 2026-10-19T03:55Z: session_01Sp2zReUCe1QuT3K124eWjd (#12), session_01TvGkwYYYXjWLC4UgjFEzBw (#13), session_01MqLzoh3ux71DaMCChff3YM (#14), session_01CPwBs7vVpuxAyuRd1ahCy1 (#31), session_01Lt… |
| PT-046 | UASCO-LOOP-RECORD PR poller ('uasco-github-sync (deterministic)'; source off-repo) | INTEGRATED_NOT_VERIFIED | P2 | AG-009: gh api issues/{n}/comments: e.g. PR #48 'UASCO-LOOP-RECORD \\| commit cd3e861... \\| ubuntuCI failure \\| windowsCI failure \\| ... \\| by uasco-github-sync (deterministic)'; PR #4 2026-10-17T11:50Z '... windowsCI pe… |
| PT-047 | CP-ENGINE: cloud-first production engine contract + honest QUEUE.json + RECOVERY/DECISIONS docs (PR #15) | PENDING_CI | P2 | BL-CP-05: gh api pulls/15/reviews; diff of QUEUE.json between ed5cfb9 and 0ef069d is empty |
| PT-048 | CP-QUEUE persistent cloud task-queue manager (PR #17; first version #14 DUPLICATE, closed) | PENDING_CI | P2 | BL-CP-01: gh api pulls/14/reviews, pulls/17/reviews |
| PT-049 | CP-REPORT 60-minute production reporter (PR #18; first version #13 DUPLICATE, closed) | PENDING_CI | P2 | BL-CP-02: gh api pulls/13/reviews, pulls/18/reviews; origin/uasco/production-reports:docs/cloud-production/reports/PRODUCTION-LOG.md heartbeat #8 CORRECTION |
| PT-050 | CP-DISPATCH cloud next-task dispatcher with claim refs + lease record (PR #29) | PENDING_CI | P1 | BL-CP-04: gh api pulls/29/reviews |
| PT-051 | Canonical backlog checkpoint docs/planning/BACKLOG_CHECKPOINT.json (BACKLOG-SOURCE-REBASELINE, PR #16) | PENDING_REVIEW | P1 | BL-AUT-01: gh api pulls/16/reviews; git ls-tree origin/v7/integration docs -> no docs/planning |
| PT-052 | Next-step engine reference (selectNext auto-advance) + loop proof + backlog validator (PR #11) | PENDING_REVIEW | P1 | BL-AUT-02: git show origin/claude/autonomy-recovery-prep:docs/autonomy/README.md 'Evidence' |
| PT-053 | 72-hour continuous-operation endurance test | DESIGN_ONLY | P2 | BL-AUT-03: ENDURANCE-72H-TEST-PLAN.md section 0 entry gate |
| PT-054 | Local unattended orchestrator/supervisor stack (engine/state/executors/daemon; merged code) | INTEGRATED_NOT_VERIFIED | P2 | AG-016: scripts/uasco-orchestrator.mjs:1 ('--daemon kipinde Windows Task Scheduler'); scripts/register-orchestrator-autostart.ps1:1; automation/factory-supervisor.mjs:3 LEGACY_CODEX_REVIEW_PATH_RETIRED exit 64; git grep… |
| PT-055 | Activate the local unattended orchestrator on the Founder PC (Task Scheduler) | OBSOLETE | P3 | BL-AUT-04: relayed Founder request 2026-10-19; v6-planning UNATTENDED_EXECUTION_READINESS.md row 4 (no Task Scheduler task installed) |
| PT-056 | Lane A persistent supervisor SV1-1 -> AS1 -> bridge-merge -> live drill (source only on Founder PC) | AUTHORITY_REQUIRED | P2 | BL-AUT-05: UASCO_DESKTOP_DELIVERY_ETA_2026-10-15.md:42 'SV1-1 (3492387)'; git cat-file -t 3492387 -> not found |
| PT-057 | Anthropic Managed Agents PoC (API-key billed sessions) | OBSOLETE | P3 | BL-AUT-06: UASCO_MANAGED_AGENTS_COST_AUTH_2026-10-15.md 'KARAR BEKLENİYOR'; relayed Founder request 'Ek faturalandırma kesinlikle yasak' |
| PT-014 | Cloud Node 24 environment (.nvmrc + scripts/cloud-ensure-node24.sh, PR #21) | PENDING_CI | P1 | BL-CP-07: gh api pulls/21/reviews |

## Governance tasks (merge gate, lease, trust root)

| ID | Task | Status | Pri | Key evidence |
|---|---|---|---|---|
| PT-021 | Coded merge gate scripts/merge-via-gate.mjs + integration-branch protection helper (PR #11) | PENDING_REVIEW | P0 | AG-025: gh api pulls/11/reviews latest 2026-10-19T03:51Z (session_011cguGi1ZvrTuZbLds8T25M); docs/cloud-production/ci/public-ci/README.md §'Merge gate' on PR #49 |
| PT-022 | Merge-gate CI-context binding for the chosen CI provider (gate hard-codes GitHub validate contexts) | AUTHORITY_REQUIRED | P0 | BL-CI-03: git show origin/claude/autonomy-recovery-prep:docs/autonomy/MERGE-GATE-FIX.md (contexts hard-coded); git log 7c5e68b 'pin check-run app' |
| PT-023 | Branch protection / ruleset on v7/integration (required both-OS checks, no bypass, no force-push) | AUTHORITY_REQUIRED | P0 | live: rulesets API returns []; branches protected:false (raw pr-bottlenecks.md section 0). Rulesets are a Founder/admin action; on a private Free-plan repo they were recorded as unavailable (C6) / AG-026: gh api repos/.… |
| PT-024 | Second, distinct GitHub reviewer/approver identity (no self-approval; common-mode risk) | AUTHORITY_REQUIRED | P0 | AG-031: review-verdicts.csv (user.login and author_association of every review); commit c960949 message 'only collaborator: SalimBurakAytemiz'; PR #49 README 'Honest limit: a single GitHub identity cannot approve its ow… |
| PT-025 | Atomic per-task lease + SHA/session-bound verdict guard (PR #10, merged, imported only by tests) | MERGED_NOT_INTEGRATED | P0 | AG-019: git grep -l 'lib/task-lease.mjs' HEAD -- automation scripts apps core -> only automation/lib/task-lease-git-store.*; git ls-remote origin 'refs/uasco/*' -> empty (2026-10-19); git log --merges: e12dbdd 'Merge pu… |
| PT-026 | FA-LEASE2: wire lease + verdict guard into six protected files | AUTHORITY_REQUIRED | P0 | AG-021: git ls-tree -r origin/<all branches> -- audit/checkpoints \\| grep LEASE2 -> none; git show origin/claude/autonomy-recovery-prep:docs/autonomy/FA-LEASE2-AUTHORIZATION.DRAFT.json ('status': 'DRAFT_PROPOSAL_NOT_A_L… |
| PT-027 | CP-GOV Phase-0: separate-identity governance design + non-protected reference verifier (PR #31) | PENDING_CI | P1 | AG-028: git show origin/claude/cp-gov-scaffold:docs/cloud-production/governance/governance-verify.mjs:1; gh api pulls/31/reviews |
| PT-028 | CP-GOV Phase 1+: separate-identity seal/reseal, D3 issuance, KMS custody, M-of-N quorum | AUTHORITY_REQUIRED | P1 | AG-029: SEPARATE-IDENTITY-CLOUD-GOVERNANCE.md §B 'asymmetric key created and held only in a managed KMS/HSM (HSM protection level; e.g. GCP Cloud KMS HSM / AWS KMS / Azure Managed HSM)' and §C 'Founder hardware-token si… |
| PT-029 | Trust-root reseal authority per protected change + reseal serialization owner | AUTHORITY_REQUIRED | P0 | AG-032: git show origin/claude/public-cloud-ci:docs/cloud-production/ci/public-ci/AUTHORITY-FD-PUBLIC-CI-2026-10-19.md (scope: 4 files, PR #49 only, 9 conditions); 498e2eb trailer Claude-Session session_014aT3BaoZJEnuur… |
| PT-030 | Post-merge verification of already merged v7 PRs #1-#7, #9, #10 (merged with red Windows validate; no CLEAN bound to merged head) | NOT_STARTED | P1 | AG-034: gh api commits/<head>/check-runs for PRs #1-#7,#9,#10 (windows failure each); gh api pulls/9/reviews, gh api pulls/10/reviews; gh api issues/4/comments UASCO-LOOP-RECORD 'windowsCI pending \\| ... \\| result CLEAN' |
| PT-031 | DOC-TRUTH: stale sealed CANONICAL-STATUS.md and .ai state served by GET /v1/factory; release-gate seal currency | AUTHORITY_REQUIRED | P2 | BL-GOV-05: CANONICAL-STATUS.md 'Independent review' list; audit/reviews/V6-PKG-R3-ca21e83-c1.json CLEAN; tests/pkg-x1-execution-routing.test.ts + pkg-aut1-orchestrator.test.ts present on v7; apps/control-api/src/server.… |
| PT-032 | WFR-03 role-registry validation step (needs protected config/validation.json) | AUTHORITY_REQUIRED | P2 | BL-GOV-06: audit/checkpoints/V7-PKG-WFR03-2026-10-15.json status 'BLOCKED_ITEM: role-registry validation step not added' |
| PT-033 | Legacy configure-github-protection.mjs (targets main, no required checks) | OBSOLETE | P3 | AG-027: scripts/configure-github-protection.mjs:5-6 (main, required_status_checks:null, enforce_admins:false); gh api repo default_branch 'master' |
| PT-034 | Standalone node proofs of docs/** modules are outside canonical validation/CI | AUTHORITY_REQUIRED | P1 | QS-018: python scan: no 'docs/' path in any config/validation.json step command (@e12dbdd); heartbeat routine prompt: 'do not register tests in sealed config/validation.json' |
| PT-035 | Security: action gateway wired with permissive defaults (server.ts:156-167 tenant local; scope/data/budget/adapter = true; finance/legal writes skip approval class) | AUTHORITY_REQUIRED | P1 | phases-backlog summary topFindings (server.ts:165 permissive defaults; server.ts:156 tenant local); backend-data summary topFindings (server.ts:164-167; policy.ts:8-10,30-34) |

## Independent review

| ID | Task | Status | Pri | Key evidence |
|---|---|---|---|---|
| PT-036 | Governed CLAUDE_REVIEWER pipeline (review-pipeline / review-quorum / review-governance / reviewer broker) | INTEGRATED_NOT_VERIFIED | P1 | AG-022: git grep importers: review-pipeline <- automation/lib/orchestrator-executors.mjs, scripts/dual-review-selftest.mjs, scripts/orchestrator-selftest.mjs; scripts/claude-reviewer-broker.mjs:1 (isolated clean clone, … |
| PT-037 | Independent cloud reviewer routine + review coverage of the PR backlog | IN_PROGRESS | P0 | live: live 04:41Z: new scoped CLEAN COMMENT reviews on #26 @0a60c14, #33 @b8d2f51, #38 @d8a4fcc, #42 @1b4e6a3 and BLOCKED on #50 @ba775b8 (session_01EQAoSLnjE4dY4FuUTghp2D, Node v22.22.0, validation NOT_RUN) / AG-002: l… |
| PT-038 | Codex reviewer broker (retired review path) | OBSOLETE | P3 | AG-023: automation/factory-supervisor.mjs:2-3 (GOV2 retired, exit 64); tests/pkg-gov2-codex-retirement.test.ts:20 |

Self-approval check (relayed request: "Kod gelistiren ajan kendi PR'ini onaylamasin"): reviews come from sessions other than the implementer's (commit `Claude-Session` trailers differ), but they are posted by the same GitHub identity as the code, as COMMENT reviews. GitHub therefore enforces no independence, and nothing stops a merge without a review (#9 and #10 were merged without a CLEAN on their final head). PT-021, PT-023 and PT-024 are the fixes; all need Founder/admin action except the review of #11 itself.

## Security posture

| ID | Task | Status | Pri | Key evidence |
|---|---|---|---|---|
| PT-011 | Deregister old self-hosted runner 21 (public-repo risk: workflows can target it) | AUTHORITY_REQUIRED | P0 | CI-12: PR #49 README 'Self-hosted' bullet (runners API -> 403); runner still registered per that doc, not re-verified here |
| PT-012 | Repository visibility is PUBLIC: reconcile with the private-repo directive; exposure assessment | AUTHORITY_REQUIRED | P0 | live: live 04:37Z: gh api repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY- -> {private:false, visibility:public, updated_at 2026-10-19T03:07:17Z} / BL-CI-11: gh api repos/... --jq '.visibility,.private' = public,f… |
| PT-058 | Security stage with the real gitleaks binary never executed (tests always skipped) | IMPLEMENTED_NOT_TESTED | P2 | QS-008: tests/v7-b3c-security-stage.test.ts:441-444; .github/workflows/ci.yml (no gitleaks install) |
| PT-059 | secret-sanity baseline secret scanner | INTEGRATED_NOT_VERIFIED | P1 | QS-009: scripts/secret-sanity.mjs:1-10 (PRIVATE_KEY, AWS_ACCESS_KEY, GITHUB_TOKEN, ANTHROPIC_KEY, OPENAI_STYLE_KEY, BEARER_TOKEN patterns); 498e2eb commit msg 'secret-sanity PASS' |
| PT-060 | Dependency supply chain + npm audit gate + SBOM-lite + release supply-chain binding | INTEGRATED_NOT_VERIFIED | P1 | QS-010: scripts/dependency-supply-chain.mjs:1,5-10; git show origin/claude/autonomy-recovery-prep:docs/autonomy/MERGE-GATE-FIX.md §5; PR #49 comments 03:47Z/03:48Z |
| PT-061 | Trust-root / release-truth / release supply-chain / mechanical-closure validators | INTEGRATED_NOT_VERIFIED | P1 | QS-011: gh api pulls/49/reviews (condition 3: 'recomputed the sha256 ... node scripts/verify-trust-root.mjs gives TRUST_ROOT_VERIFY: PASS'); gh api pulls/8/reviews |
| PT-062 | EN/TR validation: //TR marker gate + renderer en/tr locale parity tests | INTEGRATED_NOT_VERIFIED | P2 | QS-012: git grep -l -iE 'locale.*parity\\|parity.*(en\\|tr)\\|Object.keys((en\\|tr))' origin/v7/integration -- tests (10 files); config/validation.json step 'tr' |
| PT-063 | GitHub-native security scanning (secret scanning + push protection, Dependabot, CodeQL) | NOT_STARTED | P1 | QS-013: gh api repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY- -> security_and_analysis: null (not readable by this integration, actual setting UNKNOWN); git ls-tree origin/v7/integration .github/workflows -> ci.… |
| PT-017 | Defect (local run): evidence redaction leaks /root (core/evidence/index.ts:292-296 masks only /home/* and /Users/*) | NOT_STARTED | P1 | raw/g-i-evidence.json failingAfterRerun[v7-b10a-evidence.test.ts]; backend-data summary topFindings (local run); relevant if a CircleCI/Linux job runs as root |

- The repository is public while the relayed directive says to keep it private (PT-012). Self-hosted runner 21 (`DESKTOP-G4U0679`, label `uasco-isolated`) is reported still registered (PR #49 README; runners API 403 here, so unverified). On a public repo a workflow from any branch could target it (PT-011).
- Only `.github/workflows/ci.yml` is a protected path, so any PR can add a new workflow file (PR #50 did, legitimately).
- secret-sanity and the npm-audit supply-chain gate run in the static CI phase; the real-gitleaks security stage tests are always skipped (`tests/v7-b3c-security-stage.test.ts:441-444`); GitHub-native secret scanning, Dependabot and CodeQL are not set up (PT-063).
- Local-run defect: evidence redaction leaks `/root` (PT-017); not protected, fixable in the cloud.

## Keystones in this area

- **K-GATE** (merge gate + ruleset + approver) and **K-LEASE** (FA-LEASE2 / CP-GOV) are both Founder-gated. CP-GOV Phase 1+ needs a managed KMS/HSM key and a Founder hardware token, which conflicts with the no-extra-billing rule (PT-028, NOT_DELIVERABLE as designed).
- **K-RESEAL**: the only cloud reseal precedent is the one-time `FD-PUBLIC-CI-2026-10-19` authority for PR #49, recorded only inside that PR; LOCAL-MAINTAINER-DELEGATION says Cloud must not receive reseal authority.
- **K-BACKLOG**: until a canonical backlog lands on v7/integration (PR #16, its `authorizedBy` strings confirmed by the Founder), the Cloud Development routine and the dispatcher (PR #29) have no input.
