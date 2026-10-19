<!-- //TR: PR, review, CI ve birlestirme darbogazlari: 50 PR canli durumu, CI ve inceleme gercekleri, birlestirme sirasi ve en cok PR acan mudahaleler / PR, review, CI and merge bottlenecks -->

# PR, review, CI and merge bottlenecks, 2026-10-19

Sources: `raw/prs.csv` (#1-#48, read 04:20-04:30Z), `raw/review-verdicts.csv` (#1-#50), `raw/pr-bottlenecks.md`, `raw/ci.csv`, plus the synthesizer's live re-read at 2026-10-19T04:45Z (`gh api pulls?state=open`, `pulls/N/reviews` for the moved heads, `commits/<sha>/check-runs` for `e12dbdd`, `498e2eb`, `ba775b8`).

## Status of all 50 PRs (live)

| Status | All 50 | Open 38 |
|---|---|---|
| PENDING_REVIEW | 2 | 2 |
| PENDING_CI | 33 | 33 |
| MERGED_NOT_INTEGRATED | 1 | 0 |
| INTEGRATED_NOT_VERIFIED | 8 | 0 |
| BLOCKED | 2 | 2 |
| AUTHORITY_REQUIRED | 1 | 1 |
| DUPLICATE | 2 | 0 |
| OBSOLETE | 1 | 0 |

- Merged: 9 (#1-#7, #9, #10). Closed unmerged: 3 (#13, #14 DUPLICATE; #30 OBSOLETE). Open: 38.
- **CLEAN_NOT_MERGED: 0.** Every 2026-10-19 CLAUDE_REVIEWER pre-review ends "Final verdict pending: ... green validate (ubuntu-latest) and validate (windows-latest) on the final head SHA. Not CLEAN." Scoped CLEAN COMMENT reviews are code-review plus targeted tests only.
- Earlier "CLEAN" COMMENT reviews bound to the same current heads exist on 18 open PRs (#12, #15, #17, #18, #19, #21, #29, #31, #32 from 2026-10-18T15:10Z to 2026-10-19T02:41Z; #34, #37, #39, #40, #44, #45, #46, #47, #48 at 00:24-00:38Z). Each is **superseded** by the later 03:46-03:55Z PRE-REVIEW "NO_BLOCKERS ... Not CLEAN" at that head, so none of them is a final verdict. Raw auditor fields that still quote them now carry a `[critic 2026-10-19T05:10Z ...]` annotation in `master-work-inventory.csv` / `SCREEN_AUDIT_252.csv` (list in `master-work-inventory.json` -> `criticCorrections`).
- Code awaiting CI or review: **35** open PRs (PENDING_CI 33, PENDING_REVIEW 2). Blocked: #49 (red CI on both OSes at its head; protected reseal authority unverified) and #50 (BLOCKED review). Authority: #8 (dirty, 11 commits behind, protected config edits need a maintainer reseal).
- Changes since `raw/prs.csv`: at 04:41Z the hourly reviewer posted scoped CLEAN COMMENT reviews on #26 `0a60c14`, #33 `b8d2f51`, #38 `d8a4fcc`, #42 `1b4e6a3` (now PENDING_CI) and BLOCKED on #50 `ba775b8` (MEDIUM: `finish()` exits 0 when routes are NOT_VERIFIED, and PASS on zero routes). #11 `60cc112` and #16 `3c2bfee` still have no review on their new heads.

## All PRs

CI columns are the check-run conclusions on the current head: from `raw/review-verdicts.csv`, replaced by the synthesizer's live `commits/<sha>/check-runs` read for #11, #16, #26, #33, #38, #42, #49 and #50. "startup-death" = the runner died in 2-5 s during the Actions quota outage and no test executed.

| PR | Title | State | Head | Status (live) | Latest verdict | CI ubuntu | CI windows | Work item(s) |
|---|---|---|---|---|---|---|---|---|
| #1 | UI-211 Human-Approval Queue (#/queue) | merged | 44777ad | INTEGRATED_NOT_VERIFIED | NONE_ON_GITHUB | success 348s; success 277s | failure 694s; failure 666s | UI-211 |
| #2 | CI-green: POSIX process-leak fix + 4 test/script corrections | merged | 4f1e1f7 | INTEGRATED_NOT_VERIFIED | NONE_ON_GITHUB | success 353s; success 346s | failure 693s; failure 714s | PT-008 |
| #3 | UI-227 Quality Gate & Release Readiness (#/readiness) | merged | f08268b | INTEGRATED_NOT_VERIFIED | NONE_ON_GITHUB | success 356s; success 346s | failure 743s; failure 681s | UI-227, UI-052 |
| #4 | UI-037+046 Assurance Command Center & Security Posture (#/posture) | merged | 8896e01 | INTEGRATED_NOT_VERIFIED | NONE_ON_GITHUB | success 357s; success 286s | failure 747s; failure 682s | UI-037, UI-046 |
| #5 | UI-205 Multi-Project Command Matrix (#/matrix) | merged | 2a5e509 | INTEGRATED_NOT_VERIFIED | NONE_ON_GITHUB | success 360s; success 303s | failure 690s; failure 681s | UI-205 |
| #6 | UI-071 Operations & Recovery runbook (SC-16) | merged | 993ed8d | INTEGRATED_NOT_VERIFIED | NONE_ON_GITHUB | success 371s; success 334s | failure 676s; failure 705s | UI-071, UI-186 |
| #7 | UI-071 fix: honest latest-run selection (false-all-clear remediation) | merged | bb8ef58 | INTEGRATED_NOT_VERIFIED | NONE_ON_GITHUB | failure 634s; success 362s | failure 693s; failure 715s | UI-071, UI-186 |
| #8 | UI-074 Provider Hub (routing/health, read-only) | open | 76c9a57 | AUTHORITY_REQUIRED | INCONCLUSIVE@76c9a57 | success 369s; failure 641s | failure 721s; failure 660s | UI-074, UI-136, UX-DEC-037 |
| #9 | UI-248 First-run install verification (#/install) | merged | 6db12a5 | INTEGRATED_NOT_VERIFIED | BLOCKED@9f0018d | success 370s; success 366s | failure 697s; failure 701s | UI-248, UI-060 |
| #10 | pkg-lease1: atomic cross-environment task lease + SHA/session-bound v… | merged | 9469494 | MERGED_NOT_INTEGRATED | INCONCLUSIVE@a77e082 | success 373s; success 364s | failure 693s; failure 696s | PT-025 |
| #11 | Autonomy-recovery prep: merge-via-gate, branch-protection script, FA-… | open | 60cc112 | PENDING_REVIEW | PRE-REVIEW BLOCKED @7c5e68b; head 60cc112 unreviewed | success x2 @60cc112 (live check-runs 03:51-04:05Z) | failure x2 @60cc112 (live check-runs, 04:02-04:13Z) | PT-021, PT-052, PT-026 |
| #12 | CP-CI: cloud CI-equivalent evidence shaper (fail-closed, not a verdic… | open | 2dc718f | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 2s | PT-013 |
| #13 | CP-REPORT first version (superseded) | closed-unmerged | b08e319 | DUPLICATE | PRE-REVIEW BLOCKED@b08e319 | startup-death 3s; startup-death 4s | startup-death 2s; startup-death 4s | PT-049 |
| #14 | CP-QUEUE first version (superseded) | closed-unmerged | 86b6648 | DUPLICATE | PRE-REVIEW BLOCKED@86b6648 | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 4s | PT-048 |
| #15 | Cloud-first production engine docs + honest QUEUE.json | open | ed5cfb9 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 4s | PT-047 |
| #16 | docs(planning): canonical BACKLOG_CHECKPOINT.json | open | 3c2bfee | PENDING_REVIEW | PRE-REVIEW BLOCKED @2810759; head 3c2bfee unreviewed | success x2 @3c2bfee (live check-runs 03:51-04:05Z) | failure x2 @3c2bfee (live check-runs, 04:02-04:13Z) | PT-051 |
| #17 | CP-QUEUE remediation: fail-closed queue validator (supersedes #14) | open | d9843ce | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 2s; startup-death 3s | startup-death 2s; startup-death 3s | PT-048 |
| #18 | CP-REPORT remediation: fail-closed 60-min reporter (supersedes #13) | open | d3fa735 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 2s; startup-death 2s | startup-death 2s; startup-death 3s | PT-049 |
| #19 | Home shows true Delivery state (remove stale 'Planned package: -') | open | d6cc46c | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 4s | UI-001, UI-236 |
| #20 | Remove unused plannedPanel 'partial' scaffolding + orphan locale keys | open | 0704039 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 4s | startup-death 3s; startup-death 2s | PT-103 |
| #21 | chore(cloud): .nvmrc + Node 24 setup script | open | 7be0977 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 2s | PT-014 |
| #22 | UI-197 read-only cluster->guild role taxonomy (#/workforce) | open | 0392cf7 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 2s | startup-death 3s; startup-death 3s | UI-197, UI-029 |
| #23 | UI-226 read-only per-stage timeline in Control Tower run view | open | a94c838 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 3s | UI-226 |
| #24 | UI-049 Assurance Reviews panel (independent review verdicts) | open | 2238a68 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 3s | UI-049 |
| #25 | UI-050 evidence lineage mission->run->evidence (stacked on #24) | open | adc6da7 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 2s; startup-death 2s | UI-050 |
| #26 | UI-051 per-run test report, NOT_EXECUTED unless recorded (stacked on … | open | 0a60c14 | PENDING_CI | scoped CLEAN COMMENT @0a60c14 (04:41Z) | success x2 @0a60c14 (live check-runs 03:51-04:05Z) | failure x2 @0a60c14 (live check-runs, 04:02-04:13Z) | UI-051 |
| #27 | UI-070 read-only Audit Trail route (#/audit) | open | 326f04b | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 2s; startup-death 3s | UI-070, UI-163 |
| #28 | UI-078 read-only Extensions & Integrations route (stacked on #27) | open | 2f77502 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 3s | UI-078 |
| #29 | CP-DISPATCH-IMPL cloud next-task dispatcher with claim refs + lease r… | open | 539d88d | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 5s | PT-050 |
| #30 | ci(self-hosted): UASCO-CI runner + smoke + validate workflow | closed-unmerged | c960949 | OBSOLETE | BLOCKED@539d9f1 | startup-death 3s; startup-death 2s | startup-death 4s; startup-death 4s | PT-010 |
| #31 | CP-GOV scaffold: separate-identity governance verifier (proposal, sta… | open | 0ef069d | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 2s | startup-death 3s; startup-death 3s | PT-027 |
| #32 | UI-DOMAIN-PACKS Domain Packs (#/domains, read-only) | open | d5debe4 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 3s | PT-107 |
| #33 | UI-BUILD-SCHEDULER Build Scheduler (#/scheduler, read-only) | open | b8d2f51 | PENDING_CI | scoped CLEAN COMMENT @b8d2f51 (04:41Z) | success x2 @b8d2f51 (live check-runs 03:51-04:05Z) | failure x2 @b8d2f51 (live check-runs, 04:02-04:13Z) | UI-206 |
| #34 | test+states: tower (functional/negative/a11y) | open | f5ba397 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 2s; startup-death 2s | PT-064 |
| #35 | test+states: executors-panel | open | caa39e8 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 2s | startup-death 3s; startup-death 3s | PT-065 |
| #36 | test+states: home | open | 8807a2a | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 3s | PT-066 |
| #37 | test+states: firstrun | open | 08f40c1 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 2s | PT-067 |
| #38 | test+states: academy | open | d8a4fcc | PENDING_CI | scoped CLEAN COMMENT @d8a4fcc (04:41Z) | success x2 @d8a4fcc (live check-runs 03:51-04:05Z) | failure x2 @d8a4fcc (live check-runs, 04:02-04:13Z) | PT-068 |
| #39 | test+states: inbox | open | a8e1927 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 4s; startup-death 5s | PT-069 |
| #40 | test+states: projects | open | 6089bc8 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 3s | PT-070 |
| #41 | test+states: assurance | open | 22bdac8 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 2s | startup-death 3s; startup-death 3s | PT-071 |
| #42 | test+states: settings | open | 1b4e6a3 | PENDING_CI | scoped CLEAN COMMENT @1b4e6a3 (04:41Z) | success x2 @1b4e6a3 (live check-runs 03:51-04:05Z) | failure x2 @1b4e6a3 (live check-runs, 04:02-04:13Z) | PT-072 |
| #43 | test+states: company | open | 9d94114 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 2s; startup-death 3s | PT-073 |
| #44 | test+states: studio-wizard | open | 153cf24 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 4s; startup-death 2s | startup-death 5s; startup-death 5s | PT-074 |
| #45 | test+states: delivery | open | 5b031a3 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 2s; startup-death 2s | startup-death 2s; startup-death 3s | PT-075 |
| #46 | test+states: studio-workspace | open | f5800aa | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 2s | PT-076 |
| #47 | test+states: work | open | 386f21a | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 3s; startup-death 3s | startup-death 3s; startup-death 2s | PT-077 |
| #48 | test+states: workforce | open | cd3e861 | PENDING_CI | PRE-REVIEW NO_BLOCKERS (explicitly not CLEAN; final ve… | startup-death 2s; startup-death 3s | startup-death 3s; startup-death 2s | PT-078 |
| #49 | ci(public): GitHub-hosted Cloud CI, ordered test shards + SHA-bound e… | open | 498e2eb | BLOCKED | INCONCLUSIVE @498e2eb (CI then failed both OS) | failure @498e2eb (03:47:59Z) | failure @498e2eb (03:45:52Z) | PT-003, PT-006, PT-001, PT-002 |
| #50 | test(e2e): real Desktop + real Control API route verification harness | open | ba775b8 | BLOCKED | BLOCKED @ba775b8 (04:41Z; MEDIUM fail-open exit) | validate success x2; desktop-e2e success @ba775b8 | validate failure x2; desktop-e2e success @ba775b8 | PT-015 |

## CI facts that gate every merge

1. **`validate (windows-latest)` has never been green** on any PR head or on `v7/integration`. All 9 merged PRs went in with Windows red on their head. Critic re-check 2026-10-19T05:10Z over the whole run history (`gh api actions/runs?page=1..3`, 284 runs; `actions/runs/<id>/jobs` for the 81 CI runs longer than 60 s): `validate (windows-latest)` 79 failure + 2 cancelled, 0 success; `validate (ubuntu-latest)` 52 success, 29 failure; no CI run has ever concluded success.
2. `e12dbdd` (v7 head): real run 2026-10-18T05:09-05:21Z failed on both OSes (run 39099588440); every later run on it died in 2-4 s (GitHub Free quota 2000/2000 exhausted ~13:30Z on 10-18).
3. The repository became **public** (re-read 04:37Z). Since about 03:12-03:36Z on 10-19, new heads get real ~11-minute runs at $0: ubuntu passes on #11, #16, #26, #33, #38, #42, #50; windows fails on all of them.
4. PR #49 (8 ordered shards + SHA-bound `CI_EVIDENCE.json` + protected reseal) failed on both OSes at `498e2eb` (windows 03:45:52Z, ubuntu 03:47:59Z). Diagnosis runs on `ci/diagnose-shards`: every shard passes alone on ubuntu (so the Linux failure is a hang from earlier steps' state), and 9 Windows steps fail in isolation.
5. PR #50's `desktop-e2e` passed on ubuntu and windows (03:42-03:44Z) in an empty-data deterministic environment; that is a route-render check, not product verification, and the review found it fails open.
6. CircleCI: not connected; no `.circleci/config.yml` on any ref. The coded gate (PR #11) hard-codes the GitHub contexts `validate (ubuntu-latest)` and `validate (windows-latest)` from app `github-actions`, so CircleCI results cannot pass it without a reviewed governance change (PT-022).

## The relayed request's first-delivery items: what the evidence shows today

| # | Requested evidence | Current evidence (synthesizer re-check 2026-10-19T04:45Z) | Status |
|---|---|---|---|
| 1 | Windows Cloud CI run | CircleCI: none (not connected, no `.circleci/` on any ref). GitHub-hosted `validate (windows-latest)` runs for real on new heads (e.g. run 39197225804 on #11 `60cc112`, job on runner `GitHub Actions 1000002383`, label `windows-latest`) but **fails on every head**; never green in repo history | No passing Windows evidence |
| 2 | Linux Cloud CI run | CircleCI: none. GitHub-hosted `validate (ubuntu-latest)` success on #11 `60cc112`, #16 `3c2bfee`, #26 `0a60c14`, #33 `b8d2f51`, #38 `d8a4fcc`, #42 `1b4e6a3`, #50 `ba775b8` (live check-runs 03:42-04:05Z). v7 head `e12dbdd` and #49 `498e2eb` failed on ubuntu | Linux passes on 7 PR heads, not on v7 head |
| 3 | Both results bound to the GitHub SHA | Check runs are recorded per commit SHA (`commits/<sha>/check-runs`). #49's `CI_EVIDENCE.json` binds the merge-ref sha and `UASCO_HEAD_SHA=498e2eb` (on a failing run). No head has both OSes green, so no matching pair exists | Not achieved |
| 4 | Free credit consumption | GitHub-hosted: `actions/runs/39197225804/timing` -> billable UBUNTU 0 ms, WINDOWS 0 ms (public repo), run duration 688 s. CircleCI: 0 credits used (not connected); CircleCI Free limits UNVERIFIED | $0 so far; CircleCI unknown |
| 5 | Real changes needed for the merge gate | PT-021 (land #11 after re-review of `60cc112`), PT-022 (bind gate contexts to the chosen CI provider: CircleCI contexts are rejected today), PT-023 (ruleset), PT-024 (second approver), PT-029 (reseal owner for protected `ci.yml`/`validation.json`) | All open; 4 need Founder/admin |
| 6 | CI running without the local PC | The runs above executed on GitHub-hosted runners (runner group `GitHub Actions`), not on self-hosted runner 21. Runner 21 is reported still registered (unverified, API 403) and should be removed (PT-011) | Hosted runs exist; runner cleanup pending |

## Review facts

- Every review object on #1-#50 (141 counted by the agents auditor at about 04:00Z, plus 5 posted at 04:41Z) is a COMMENT review by the single identity `SalimBurakAytemiz`; 0 APPROVED. Independence is session-level only (different Claude sessions, same GitHub identity).
- #1-#7 have no GitHub review object; their "local CLEAN" claims have no V7 review record in the repo. #9 was merged with its last verdict BLOCKED @`9f0018d` and #10 with INCONCLUSIVE @`a77e082`, neither on the merged head (PT-030).
- Reviewer routine runs on Node v22.22.0 without dependencies, so canonical validation and Windows are NOT_RUN in every review.

## Merge-order constraints

| Constraint | Order |
|---|---|
| CI vehicle first | #49 (or the CircleCI equivalent, PT-007) after the Founder visibility/CI decision; every pre-review requires it |
| Assurance stack | #24 -> #25 -> #26 -> #41 |
| Route cluster (conflict degree 15 each: `routes.js`, `planned.js`, `api.js`, locales, 8 exact-order route tests) | #27 -> #28 -> #32 -> #33 -> #8, one at a time with a rebase between; #8 also needs a rebase onto `e12dbdd` and a maintainer reseal |
| Docs stack | #15 -> #31 (or close #15 as subsumed; #31 contains its 5 commits) |
| Small renderer pairs | #19 -> #20 (locale resolution) -> #36; #23 -> #34; #22 -> #48 |
| Studio test appends | #35 -> #44 -> #46 |
| Isolated (any order once green) | #11, #12, #16, #17, #18, #21, #29, #37, #38, #39, #40, #42, #43, #45, #47 |
| Superseded | #13 -> #18 and #14 -> #17 (closed); #30 -> #49 (closed) |

Hot files across open PRs: locales `en.js`/`tr.js` (13 PRs), `styles.css` (10), `api.js` (8), `tests/v7-ps1b-project-studio-ui.test.ts` (8), `routes.js` (6); 102 overlapping PR pairs (`raw/pr-bottlenecks.md` section 4).

## Single interventions that unblock the most PRs

| # | Intervention | PRs unblocked | Owner |
|---|---|---:|---|
| 1 | Founder decision on visibility + CI provider (PT-012, PT-007), then a real green both-OS validate on a head every PR can merge (PT-001/003/004/005) | 36 open + all future | Founder, then cloud implementers |
| 2 | Enforced merge gate: #11 re-review and land (PT-021), CI-context binding (PT-022), ruleset on v7/integration (PT-023) | all merges | Founder/admin + reviewer |
| 3 | Second approver identity (PT-024) | all merges (removes self-approval) | Founder |
| 4 | Re-review the 2 unreviewed moved heads (#11 `60cc112`, #16 `3c2bfee`) and fix #50's fail-open exit | 3 | reviewer routine, implementer |
| 5 | One rebase owner for the route cluster #27 -> #28 -> #32 -> #33 -> #8 | 5 | supervisor |
| 6 | Maintainer reseal for #8 after rebase (PT-029) | 1 (+ any protected change) | Founder-authorized maintainer |
| 7 | Founder confirmation of authority strings (#16 `authorizedBy`, #15 Decision 3) and FA-LEASE2 D3 record (PT-026) | 3 + dispatch safety | Founder |
