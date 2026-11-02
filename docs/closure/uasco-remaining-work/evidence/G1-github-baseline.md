<!-- //TR: UASCO kapanış denetimi kanıt dosyası — G1 GitHub baseline (2026-11-02, salt-okunur denetçi çıktısı) -->
# G1 - GitHub Baseline (closure audit, Phase 1)

Repo: `SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-` (public, default branch `v7/integration`). Audit date 2026-11-02, queries run 02:45Z-03:00Z. Read-only: no push, comment, merge, label, PR, trigger or setting change; no test suite, no `npm install`.

Evidence tags: **[V]** verified by me from a primary source (cited), **[C]** claimed by a document/coordinator and not re-verified, **[E]** estimate with stated method, **UNKNOWN** not measurable. Ladder statements use PLANNED > DESIGNED > CODED > INTEGRATED > TESTED(unit) > VERIFIED_REAL_ENV > USABLE_BY_END_USER.

Primary sources: GitHub REST API (`https://api.github.com/repos/<repo>/...` through the agent proxy: pulls, issues, actions/runs, jobs, logs, artifacts, rulesets, branches), the `mcp__github__*` tools (PR check runs, job logs), local git (`/home/user/UNIVERSAL-AI-SOFTWARE-FACTORY-`, remote `origin` fetched), and a local `npm audit --package-lock-only` on a copy of the base lockfile. Raw API dumps are kept (not deliverables) in `/tmp/claude-0/-home-user-UNIVERSAL-AI-SOFTWARE-FACTORY-/2b112f87-31d8-5a52-96d5-8b4fa41b948c/scratchpad/closure-2026-11-02/g1raw/` (pulls_closed_*.json, runs_all_slim.json, jobs/, logs/, irjobs/, art_*.json, stale_table.tsv, pr_<n>.json).

---

## 1. Headline facts

| # | Fact | Tag | Evidence |
|---|------|-----|----------|
| 1 | v7/integration HEAD is `0b71650fa88b9802968562c63ca33f8b56e9648b` (merge of #290, committed 2026-10-27T11:34:54Z). Nothing has landed since: 135.4 h without a merge at 03:00Z. | V | `GET /branches/v7%2Fintegration` -> sha 0b71650...; `git log -1 origin/v7/integration` = 2026-10-27T14:34:54+03:00; last `merged_at` over all 259 merged PRs = 2026-10-27T11:34:55Z |
| 2 | 292 PRs exist in total: 8 open, 259 merged, 25 closed unmerged. No GitHub issues exist (0 issues; all 292 numbers are PRs). | V | `GET /pulls?state=closed` x3 pages = 284; `GET /issues?state=all` = 292 items, 0 without `pull_request`; numbers 1..292 minus the 8 open all appear in the closed set |
| 3 | **None of the 8 open PRs is merge-ready today.** 5 of 8 have merge conflicts (`mergeable_state: dirty`), 1 is draft+clean+green-but-stale-and-review-incomplete, 1 is red on both required checks, 1 is a 2-week-old Founder-held draft. | V | `GET /pulls/<n>` for all 8 (section 3) |
| 4 | **Base-wide CI failure is real and reproducible on HEAD's own lockfile.** `npm audit --package-lock-only` on `package.json`+`package-lock.json` copied from 0b71650 returns 11 moderate (0 high/critical), the same count as CI's `DEPENDENCY_AUDIT_BLOCKERS:11`; the gate runs `npm audit --audit-level=moderate` (`scripts/dependency-supply-chain.mjs:7`). Any new CI run on a branch with the current lockfile fails the `dependency-supply-chain` step on Linux and on Windows shard 1. | V | CI run 41377356505 jobs 125060393796 (ubuntu) and 125060393976 (shard 1) log tail: `FAIL dependency-supply-chain`, `DEPENDENCY_AUDIT_BLOCKERS:11`; local audit output (glob, minimatch, @electron/asar, @electron/universal, app-builder-lib, dmg-builder, ejs, electron-builder, electron-builder-squirrel-windows, filelist, jake) |
| 5 | The same step passed on base on 2026-10-27 (push CI 40497319498 on 0b71650 was green; its audit step ran inside the 11:50Z-12:16Z job window), so the advisories appeared after about 2026-10-27T12:00Z (exact publication time UNKNOWN). #292 does not touch `package*.json` (6 files, all renderer/test), so the failure is not caused by the PR. | V | run 40497319498 conclusion success; `GET /pulls/292/files` |
| 6 | The dep-audit fix branch `claude/coord-dep-audit-glob-minimatch` is **not on origin** (API 404 at ~02:55Z; not in the 354-branch list). It exists, if at all, only in the coordinator's local clone. | V | `GET /branches/claude%2Fcoord-dep-audit-glob-minimatch` returned no branch; `api_branches.txt` |
| 7 | Actions is idle: 0 queued, 0 in_progress, 1 stale `waiting` run (39687649214, UASCO Independent Review on `claude/sec-vitest-4-1-12`, stuck on the `founder-authority` job since 2026-10-21T22:36Z, about 11 days). | V | `GET /actions/runs?status=queued|in_progress|waiting` at 02:58:24Z |
| 8 | No workflow run was created between 2026-10-27T11:42:20Z and 2026-11-02T02:22:13Z; the first run after the gap is #292's CI. | V | `runs_all_slim.json` (1740 runs, newest-before-gap 40498137134) |
| 9 | Latest Windows Installer run (push on HEAD 0b71650) = 40497319565, success, produced artifact `uasco-windows-installer-40497319565-1` (111,344,297 B), not expired, expires 2026-11-26T11:40:54Z. | V | `GET /actions/runs/40497319565/artifacts` |
| 10 | 354 remote branches on GitHub (337 `claude/*`). 58 `claude/*` branches are stale (no open PR and not merged into v7/integration); 10 further non-`claude/*` branches are unmerged. | V | `GET /branches` x4 pages = 354; `git branch -r --no-merged origin/v7/integration` (details section 7) |

---

## 2. Base HEAD, required checks, ruleset

**HEAD CI (push, 0b71650)** [V]: CI run `40497319498`, event push, attempt 1, created 2026-10-27T11:35:42Z, jobs started 11:50:13Z (14.5 min queue), finished 12:16:47Z; conclusion **success**. Jobs: `validate (ubuntu-latest)` success 11:50:13-11:59:50; `validate-windows-shard (1/2/3)` success (finish 12:12:18 / 12:16:19 / 12:07:19); aggregator `validate (windows-latest)` success 12:16:22-12:16:47. Artifacts: ci-evidence-Linux/Windows + 3 validation-shard JSON, all live, expire 2026-11-10. Windows Installer run `40497319565` on the same SHA: success (installer job 11:35:45-11:41:03, 5.3 min). Today's CI state of HEAD itself is **UNKNOWN** (not re-run) but section 1 fact 4 shows it would fail the dependency gate.

**Recent push CI on v7/integration (all attempt 1)** [V]: 0b71650 success; ecdbaf9 (#289) **failure** (Windows shards 1,2: "Test timed out in 5000ms" in `v7-core-role-context`, "engine 1 never reached implementing" in `v7-relfx-1-completion`); 5e8fc50 and 8894a2f cancelled [E: push runs are not cancelled in progress by `ci.yml`, but a pending run is cancelled when a newer run enters the same concurrency group]; 6d83469 success; 401a4d2 **failure** (Windows shard 2); 0318222 success; b1c18ad success. So 2 of the last 8 base pushes (plus 2 cancelled) were red on Windows timing tests; the next merge went ahead without a re-run.

**Rulesets** [V] (`GET /rulesets`, `GET /rulesets/25433316`, `GET /rules/branches/v7%2Fintegration`; classic branch-protection endpoint returns 403):

| Ruleset | Target | Rules | Notes |
|---|---|---|---|
| 25433316 `UASCO-V7-INTEGRATION-PROTECTION` (active, updated 2026-10-21T22:04:42Z) | `refs/heads/v7/integration` | deletion; non_fast_forward; pull_request (required approvals **0**, dismiss stale on push true, thread resolution true, code-owner false, **last-push approval false**); required_status_checks (`validate (ubuntu-latest)`, `validate (windows-latest)`, integration 15368 = GitHub Actions; **strict/up-to-date = false**) | `bypass_actors: []` |
| 25435619 `UASCO-MASTER-PROTECTION` (active) | `refs/heads/master` | same shape, thread resolution false | `bypass_actors: []` |

Consequences [V]: GitHub itself enforces only "PR + two green checks"; it does **not** enforce approvals, up-to-date-ness, the coordinator's merge gate, independent review or ledger. The earlier coordinator note "last-push approval TRUE (re-enabled)" [C, task #65] is no longer the live state (false since the 2026-10-21T22:04Z ruleset update, consistent with the Founder auto-merge grant [C]).

---

## 3. Open pull requests (8)

All base `v7/integration`; every head SHA below equals the coordinator-listed SHA and the `origin/<branch>` tip [V]. "ahead/behind" is `git rev-list --count` against `origin/v7/integration` (0b71650). `mergeable_state` from `GET /pulls/<n>`. Age at 2026-11-02.

| PR | Title (short) | Lane / owner | Head | Draft | mergeable_state | ahead/behind | Size (files, +/-) | Created / last update (PR age at 2026-11-02) |
|----|---------------|--------------|------|-------|-----------------|--------------|-------------------|-------------------|
| #292 | A2a Tools panel: TOOL_READY counts with denominators | Lane A (`claude/lane-a-tools-panel-1`) | `43776e1` | no | **blocked** (mergeable=true) | +8 / -0 | 6 files, +269/-2 | 2026-11-02T02:22Z (6 d) |
| #291 | LANE-B: GET /v1/roles/:roleId/context (B2) + #287 LOWs | Lane B (`claude/lane-b-role-context-1`) | `4b4eee0` | yes | clean | +4 / -6 | 3 files, +134/-4 | 2026-10-27T11:18Z (6 d) |
| #288 | C-RDY-2b: entity readiness audit, role PROFILED via resolveRoleContext | Lane C (`claude/lane-c-rdy-2b`) | `612d6b1` | yes | **dirty** | +6 / -9 | 5 files, +522/-32 | 2026-10-27T11:07Z (6 d) |
| #282 | C-PAR03-DIAG-1: Windows PAR-03 LOCK_TIMEOUT names its blocking phase | Lane C (`claude/lane-c-par03-diag-1`) | `658095e` | yes | **dirty** | +8 / -31 | 8 files, +1562/-29 | 2026-10-27T10:30Z (6 d) |
| #251 | COORD PROTECTED CI-TEP1: Linux preflight + shard reuse | COORD (`claude/coord-protected-ci-tep1`) | `f40bea3` | yes | **dirty** | +2 / -235 | 4 files, +228/-35 | 2026-10-26T17:47Z (7 d) |
| #247 | [FOUNDER-TIER] COORD PROTECTED: aut2 selftest temp cleanup + trust-root reseal | COORD (`claude/coord-protected-aut2-tmp-cleanup`) | `323c14f` | yes | **dirty** | +2 / -171 | 3 files, +16/-6 | 2026-10-26T19:11Z (7 d) |
| #231 | [FOUNDER-TIER] LANE-B+C sandbox: WSL2 provider (WIN-4) etc. | Lane B+C (`claude/lane-b-sbx-win-4`) | `c9a3e2d` | yes | **dirty** | +65 / -138 | 42 files, +3820/-86 | 2026-10-26T21:44Z (7 d) |
| #66 | E2E-DESKTOP: fail-closed SHA-bound real Electron verification | COORD/Founder-held (`claude/e2e-desktop-verify`) | `ffeaf79` | yes | clean (rebaseable=false) | +3 / -1171 | 4 files, +160/-0 | 2026-10-20T14:43Z (14 d) |

**Required checks on the CURRENT head SHA** (check runs from `pull_request_read get_check_runs`; "windows" = aggregator job `validate (windows-latest)`) [V]:

| PR | validate (ubuntu-latest) | validate (windows-latest) | Run / notes |
|----|--------------------------|---------------------------|-------------|
| #292 | **FAILURE** 02:22:42Z, job 125060393796 (dependency-supply-chain FAIL) | **FAILURE** 02:47:56Z, job 125067314453 (shard 1 job 125060393976 FAIL on same audit step, 11 blockers; shards 2 (job ...094108) and 3 (...393960) success) | CI run 41377356505, attempt 1. Independent Review run 41377354649: success (ai-review job skipped) |
| #291 | success (job 122158704926, done 2026-10-27T11:28Z) | success (job 122168834957, done 11:43Z) | CI run 40495176576; installer run 40495176466 success. 6 commits stale vs base: not re-run since |
| #288 | success (job 122153983981, 11:18Z) | success (job 122163190408, 11:29Z) | CI run 40493787515 on a head that no longer merges (dirty) |
| #282 | **ABSENT - no CI run exists on `658095e`** | **ABSENT** | Only Independent Review run 40488984206 (all jobs skipped). Consistent with the PR being unmergeable (GitHub does not start `pull_request` workflows for conflicting PRs) [E: inference; the CI trigger in `ci.yml` has no draft or path filter]. Last CI on the branch: run 40463536670 @ d641841 FAILURE (shard 1: PAR-03 assertion "reloadMs delay must not leak into lockWaitMs: expected 170.7 to be less than 100") |
| #251 | success (job 121703380996) | success (job 121716699143) | CI run 40356402804, attempt 2 (full re-run), 2026-10-26; preflight success |
| #247 | success (job 121774172398) | success (job 121788443360) | CI run 40380233794, 2026-10-26 |
| #231 | success (job 121855409115) | **FAILURE** (job 121866087854) | CI run 40403559608: shard 1 FAIL (`v7-relfx-c3-remediation` "Test timed out in 120000ms"), shard 3 FAIL (`pkg-bs1-autonomy-bootstrap-c` "BS1_DE_ELEVATED shard=c ... elevated github-hosted runner"), shard 2 success |
| #66 | success (job 118333526530) | success (job 118333526180) | CI run 39332399101 on 2026-10-19 (pre-sharding monolithic Windows job, 51 min); Desktop E2E run 39332399125 success (ubuntu + windows) |

Reviews/comments on the PRs (data only): #66 has two COMMENTED reviews on `ffeaf79` (2026-10-19 pre-review "NO_BLOCKERS", 2026-10-20 independent cloud review "CLEAN for the diff", base noted stale); #231, #247, #251 each carry coordinator decision notes (comments 1, 3, 1); #292/#291/#288/#282 have 0 reviews/comments on GitHub (the coordinator's review verdicts live in the ledger, not on the PRs). No PR has auto-merge enabled, none has labels [V].

**Protected-path exposure from the file lists** [V]: #251 touches `.github/workflows/ci.yml`, `config/trust-root-manifest.json`, `scripts/validate-shards.mjs`; #247 touches `config/trust-root-manifest.json`; #231 touches `config/trust-root-manifest.json` and `apps/control-api/src/server.ts`; #66 adds `.github/workflows/desktop-e2e.yml`. #292, #291, #288, #282 touch none of `.github/**`, `package*.json`, `scripts/ci/**`, `scripts/ensure-dependencies.mjs`, nor any file listed in the trust-root manifest (#291 and #288 change `scripts/build-installer.mjs`, which is not in the manifest).

### Classification proposal

| PR | Proposal | Reason | What would change it |
|----|----------|--------|----------------------|
| #292 | **BLOCKED** (depends on external action) | Both required checks FAIL on the current head because of the base-wide dependency audit [V]; PR itself is non-protected renderer code and 0 commits behind. Coordinator delta review NO_BLOCKERS (ledger 47d46b0) [C]. | Dep fix lands (needs `package.json`/lockfile = protected CI-executed files; Founder authority pending [C]) and CI is re-run -> becomes MERGE_CANDIDATE. |
| #291 | **BLOCKED** | Draft; packaging lens still pending and route lens "NO_BLOCKERS 4 LOW" [C]. Required checks are green but dated 2026-10-27 and head is 6 commits behind; a fresh CI run would hit the dependency gate [V mechanism]. | Packaging review closes, dep fix lands, branch re-validated -> MERGE_CANDIDATE. |
| #288 | **BLOCKED** | `dirty` (conflicts, 9 behind) [V]; review verdict BLOCKERS 2 MEDIUM + 14 LOW with repair pending [C]; draft. | Repair round + base merge + review delta. |
| #282 | **BLOCKED** (SUPERSEDED_CANDIDATE if the Founder prefers pause) | `dirty`, 31 behind, no CI on head [V]; delta review BLOCKERS 1M+2L, last round pending [C]. Diagnostics-only value (names the PAR-03 blocking phase); branch is preserved either way. | Final repair + base merge, or Founder closes it. |
| #251 | **REQUIRES_EXTERNAL_ACTION** | Protected `ci.yml`/trust-root/`validate-shards.mjs`, Founder-held; `dirty`, 235 behind [V]; cross-attempt shard-reuse benefit "UNVERIFIED (fail-closed)" [C]. Needs rebase and reseal after the Founder decision. | Founder decision + reseal. |
| #247 | **REQUIRES_EXTERNAL_ACTION** | Founder-tier trust-root change; CI green on head [V] but `dirty` (171 behind) so the green is stale. | Founder decision + rebase + reseal. |
| #231 | **REQUIRES_EXTERNAL_ACTION** (also BLOCKED) | Founder-tier; touches trust-root manifest and `server.ts`; 65 commits / 42 files; `dirty` (138 behind); Windows aggregator FAILURE on head (two Windows-timing/elevation test failures) [V]. | Founder decision, base merge, green Windows CI. |
| #66 | **REQUIRES_EXTERNAL_ACTION** (SUPERSEDED_CANDIDATE to be assessed) | Founder-held since 2026-10-20; adds a protected workflow; none of its 4 files exists on base [V]; 1171 commits behind but conflict-free. Base already carries a different desktop E2E harness (`scripts/e2e/desktop-journey.e2e.mjs` from #234) [V existence]; functional overlap not verified. | Founder decision FD-E2E-DESKTOP-66 [C]. |

Merge-ready today: **0 of 8**. After the dep fix: #292 (best), then #291.

---

## 4. Merged / closed pull requests

All figures [V] from `GET /pulls?state=closed&per_page=100` pages 1-3 (284 records); a PR is "merged" when `merged_at != null`.

| Day (UTC) | Merged | Closed unmerged |
|-----------|-------:|----------------:|
| 2026-10-17 | 7 | 0 |
| 2026-10-18 | 2 | 0 |
| 2026-10-19 | 40 | 3 |
| 2026-10-20 | 59 | 6 |
| 2026-10-21 | 17 | 1 |
| 2026-10-22 | 60 | 14 |
| 2026-10-23, 24, 25 | 0 | 0 |
| 2026-10-26 | 46 | 1 |
| 2026-10-27 | 28 | 0 |
| 2026-10-28 .. 2026-11-02 | 0 | 0 |
| **Total** | **259** | **25** |

- Last 14 days (created/merged on or after 2026-10-19T02:46Z): **250 merged** (Oct 19: 40, Oct 20: 59, Oct 21: 17, Oct 22: 60, Oct 26: 46, Oct 27: 28) and **25 closed unmerged**. The other 9 merged PRs are 2026-10-17/18.
- Inflation caveat [V]: 259 "merged PRs" collapse to **170 distinct merge events** (merged_at clustered within 10 s), because wave PRs auto-close their member PRs (largest cluster: 24 PRs at 2026-10-19T22:48:25Z; 12 timestamps carry >=3 PRs). On the base branch there are 155 first-parent "Merge pull request #N" commits plus 211 other first-parent commits (squash-style wave/base merges); 1517 commits total, 1187 since 2026-10-19T02:46Z.
- PR lifetime (created to merged) over 259 merged PRs: median 1.93 h, p90 23.8 h, max 97.8 h [V computed]; last 14 d: median 2.00 h, p90 25.3 h.
- Longest merge gap on record: 82.3 h (2026-10-22T18:54:53Z to 2026-10-26T05:10:58Z); current gap 135.4 h (since 2026-10-27T11:34:55Z) is the longest ever.
- Labels on PRs: only `uasco-needs-fix` (9 closed PRs); none on open PRs.
- The 25 closed-unmerged PRs are #8, 11, 13, 14, 23, 28, 30, 32, 33, 46, 50, 68, 104, 114, 116, 125, 126, 127, 129, 132, 141, 142, 154, 171, 197. Titles show supersession (wave PRs rebuilt as other waves, lane PRs replaced by later lane PRs); I did not individually verify each supersession.

## 5. Issues and labels

- Issues: **0 open, 0 closed** (all 292 `/issues` items carry `pull_request`). `open_issues_count` = 8 (the 8 open PRs). Issue tracking is not used; work tracking lives in the queue/ledger files [C].
- Repository labels (12) [V]: accessibility, bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, uasco-needs-fix, wontfix (+ default set). Only `uasco-needs-fix` is used (9 PRs, all closed).

---

## 6. GitHub Actions

### 6.1 Workflows

`GET /actions/workflows` -> 8 registered [V]. Only 3 workflow files exist on base (`git ls-tree 0b71650 .github/workflows/` -> `ci.yml`, `uasco-independent-review.yml`, `windows-installer.yml`) [V]; the other 5 are registered from historical branches/PRs.

| Workflow (id) | File | On base? | Runs all-time | Runs last 14 d | State |
|---|---|---|--:|--:|---|
| CI (367360086) | ci.yml | yes | 1037 | 787 | active |
| UASCO Independent Review (391742626) | uasco-independent-review.yml | yes | 504 | 504 | active |
| Windows Installer (392249696) | windows-installer.yml | yes | 181 | 181 | active |
| Desktop E2E (388986189) | desktop-e2e.yml | no (only on PR #66 branch) | 4 | 4 | active |
| Diagnose Windows elevation for BS1 (389108282) | diagnose-elevation.yml | no (`ci/diagnose-elevation`) | 4 | 4 | active |
| Diagnose canonical test steps (388988743) | diagnose-shards.yml | no (`ci/diagnose-shards`) | 1 | 1 | active |
| UASCO Self Hosted Runner Test (388794673) | self-hosted-smoke.yml | no | 3 (2 success, 1 failure) | 0 | active |
| validate-selfhosted.yml (388798838) | validate-selfhosted.yml | no | 1 (failure) | 0 | active |

Two historical diagnostic workflow names ("Diagnose runCommand hang" 1 run, "Diagnose tests-2 hang after earlier steps" 4 runs) no longer appear in the registered list. Total all-time: 1740 runs (matches `total_count`).

### 6.2 Runs in the last 14 days (created >= 2026-10-19T02:46Z): 1486

| Workflow | Total | success | failure | cancelled | skipped | other |
|---|--:|--:|--:|--:|--:|--:|
| CI | 787 | 431 | 190 | 166 | - | - |
| UASCO Independent Review | 504 | 179 | 2 | 23 | 299 | 1 waiting (stale) |
| Windows Installer | 181 | 167 | 1 | 13 | - | - |
| Desktop E2E | 4 | 4 | - | - | - | - |
| Diagnose Windows elevation | 4 | 4 | - | - | - | - |
| Diagnose tests-2 hang | 4 | 4 | - | - | - | - |
| Diagnose canonical test steps | 1 | - | 1 | - | - | - |
| Diagnose runCommand hang | 1 | 1 | - | - | - | - |

By event: pull_request 642, push 335, pull_request_target 501, workflow_dispatch 8. By calendar day (created): Oct 16: 2, Oct 17: 38, Oct 18: 175, Oct 19: 192, Oct 20: 98, Oct 21: 119, Oct 22: 460, Oct 23-25: 0, Oct 26: 419, Oct 27: 234, Oct 28-Nov 1: 0, Nov 2: 2. The 216 runs created before 2026-10-19 are 215 failures (CI bring-up: 91 pull_request + 123 push CI runs failed on both OS jobs, plus 1 validate-selfhosted) and 1 success (Self Hosted Runner Test); they lie outside the 14-day window, which starts at 2026-10-19T02:46Z (calendar days Oct 19-Nov 2 hold 1524 runs, 38 of them before the window start). The IR figure includes run 41377354649 (completed success 02:49:06Z after my first sample).

CI split [V]: pull_request 336 success / 127 failure / 117 cancelled; push 95 / 58 / 49; workflow_dispatch 0 / 5 / 0. Pass rate of non-cancelled runs: PR 336/463 = **72.6%**, push 95/153 = **62.1%** (each PR run is a distinct head SHA, so this is the final-attempt pass rate per SHA). Week 1 (Oct 19-25): 259 success / 141 failure / 104 cancelled of 504; week 2 (Oct 26-Nov 2): 172 / 49 / 62 of 283.

### 6.3 Currently queued / in progress

At 02:58:24Z [V]: **queued 0, in_progress 0, requested 0, pending 0, waiting 1** (`39687649214`, see section 1 fact 7; `founder-authority` job waiting on an environment approval since 2026-10-21T22:36:17Z, never resolved). Earlier at 02:48Z, run 41377354649 (Independent Review, #292) was in progress and has since completed success (ai-review skipped).

### 6.4 CI duration (pull_request event, run wall-clock = `updated_at - run_started_at`) [V computed, n shown]

| Population | n | median | p90 | p10 | max |
|---|--:|--:|--:|--:|--:|
| PR runs completed in last 14 d (all conclusions) | 580 | 24.7 min | 51.9 min | 9.2 | 77.1 |
| PR runs, success only (last 14 d) | 336 | **26.9 min** | **54.2 min** | 21.3 | 77.1 |
| push runs completed (14 d) | 202 | 23.2 | 49.7 | 2.9 | 82.8 |
| push runs, success only | 95 | 29.7 | 54.2 | 21.6 | 82.8 |

The "all conclusions" figures are pulled down by fast failures and cancellations; success-only is the meaningful latency. Wall-clock of a run restarts at `run_started_at` of the latest attempt, so re-run time is under-counted [E]. Total CI wall-clock in 14 d: 347.4 h (success 241.6 h, failure 72.1 h, cancelled 33.8 h); this is workflow wall-clock, **not** billed runner minutes (runner minutes UNKNOWN; public repo, standard hosted runners, so no Actions billing is expected [E]).

### 6.5 Re-runs (run_attempt > 1)

[V] 47 runs have more than one attempt (45 in the window): 44 at attempt 2, 2 at attempt 3, 1 at attempt 4; 46 are CI, 1 is Independent Review; extra attempts total 51 (49 in window). Latest-attempt outcomes: 24 success, 17 failure, 6 cancelled. Earlier attempts' conclusions were not retrieved (attempt endpoints not queried), so how many re-runs turned red into green is UNKNOWN beyond "24 re-run runs ended green".

### 6.6 Why CI fails (190 failed CI runs in the window; 194 failed runs across all workflows in the window)

Job-level facts from `GET /actions/runs/<id>/jobs` for all 194 failed runs [V]:

| Rank | Failed job (by name) | Count |
|--:|---|--:|
| 1 | CI `validate (windows-latest)` (aggregator or pre-shard single job) | 185 of 190 failed CI runs |
| 2 | CI `validate-windows-shard (N)` | 141 job failures (shard 1: 77, shard 3: 35, shard 2: 29) |
| 3 | CI `validate (ubuntu-latest)` | 73 |
| 4 | UASCO Independent Review `scope` (step `actions/create-github-app-token`) | 2 (2026-10-21) |
| 5 | Windows Installer `installer (windows-latest)` (step `scripts/ensure-dependencies.mjs`) | 1 (run 39713948551, 2026-10-22T02:54Z, branch `claude/lane-a-scheduler`); plus 1 Diagnose-canonical-steps run with 9 failed `diag tests-*` jobs |

The frequent failing *steps* are follow-ons: `CI evidence (SHA-bound, fail-closed)` 139+67 and `Require every Windows shard job to succeed` 117 fail because an upstream validation step failed.

Root-cause classes per failed CI run **[E]** (method: for each failed validate job I downloaded the job log and grepped for `FAIL <ms> <step>`, `DEPENDENCY_AUDIT_BLOCKERS`, vitest `FAIL <file>`, `TIMEOUT`, `tests-lv1`; precedence audit > lv1 > Linux step > Windows test > timeout; 277 failed jobs, 4 logs returned BlobNotFound):

| Rank | Class | Runs | When | Notes |
|--:|---|--:|---|---|
| 1 | Windows failure with no discriminating signature (mostly pre-sharding monolithic job on 2026-10-19, hangs/timeouts) | 59 | Oct 19: 44, Oct 22: 8 | Root cause UNKNOWN from logs |
| 2 | **dependency-supply-chain audit blockers** (npm advisories: vite Oct 21-22 with 1-2 blockers, 3 on Oct 26, 11 glob/minimatch on Nov 2) | 47 | Oct 21: 25, Oct 22: 12, Oct 26: 9, Nov 2: 1 | External drift of the live advisory DB; 98 failed jobs (51 Linux + 47 Windows shard 1) |
| 3 | Windows shard test failures on timing-sensitive tests (`v7-relfx-c3-remediation`, `v7-relfx-1-completion`, `v7-b3a-runner` BOUNDED_TICK_TIMEOUT, `v7-ps1a-c2-remediation`, `pkg-aut2`, `pkg-bs1-bootstrap-c` ...) | 41 | Oct 26: 18, Oct 27: 9, Oct 22: 8 | per-test timeouts of 5 s / 30 s / 120 s, lock-wait asserts |
| 4 | Linux validate step failures (`tests-7` 4, `tests-5` 3, `secret-sanity` 4, `paste4d-release-truth` 2, `tests-8`, `tests-2`) | 25 | Oct 19: 13 | real test/secret-scan failures in lane branches |
| 5 | Windows `tests-lv1` / `pkg-lv1-liveness` liveness flake (the FD-LV1 item) | 13 | Oct 19-22 | 18 job occurrences incl. pre-shard |
| - | Aggregator-only failure (attempt-scoped shard artifacts) | 5 | | matches the COORD-001 finding [C] |

Reading: roughly one third of failed runs are Windows timing/flake (classes 3+5 = 54 runs, 28%), one quarter are the dependency gate (47, 25%, rising to 100% of runs *today*), and about a third have an unknown cause (mostly the pre-sharding era). The single most damaging current item is class 2.

### 6.7 Windows Installer

[V] 181 runs: push 112 success / 11 cancelled; pull_request 55 success / 2 cancelled / 1 failure. **Latest run 40497319565** (push, v7/integration, 0b71650, 2026-10-27T11:35:42Z): success, job `installer (windows-latest)` 11:35:45-11:41:03; steps incl. `Build installer (npm run dist:win)`, `Real install / launch / repair / uninstall test`, `Upload installer` all success. **It produced an artifact**: `uasco-windows-installer-40497319565-1`, 111,344,297 B (~106 MiB), created 2026-10-27T11:40:59Z, expires 2026-11-26T11:40:54Z (retention 30 d). Of 173 installer artifacts, ~17.5 GiB total, all live, expiring 2026-11-20..26.

Ladder for the installer: CODED + INTEGRATED + **VERIFIED_REAL_ENV for the CI step** (the workflow reports a real install/launch/repair/uninstall test passing on a GitHub-hosted `windows-latest` runner; I verified the step conclusion, not the test's depth). **Not** shown to be USABLE_BY_END_USER: no code-signing step is present in `windows-installer.yml` (grep for `sign|CSC` -> no match), the artifact is a CI artifact (not a release), and no human run on a Founder PC is evidenced [C pending item "local Windows test worker Founder-PC pilot"].

### 6.8 Independent Review workflow (cloud reviewer)

[V] From job lists of all 504 runs: `ai-review` job success **58**, skipped 423, cancelled 22; `scope` failure 2 (GitHub-App token step); the `ai-review` job (anthropics/claude-code-action) ran across 54 distinct branches between 2026-10-21T14:44Z and 2026-10-27T11:42Z, never since. The review verdict content was not evaluated. On #292 today `ai-review` is skipped. `founder-authority` job success 24, skipped 467, waiting 1.

### 6.9 Artifact retention (evidence at risk)

[V] 3248 artifacts, 0 expired, ~17.5 GiB live. CI evidence (`ci-evidence-Linux` 688, `ci-evidence-Windows` 490, plus `validation-shard-*`) has 14-day retention: 193 artifacts expire on 2026-11-02, 275 on 11-03, 279 on 11-04, 749 on 11-05, 734 on 11-09, 393 on 11-10, 4 on 11-16. By 2026-11-10 every SHA-bound CI evidence artifact for the whole Oct 19-27 merge history is gone, including those for HEAD 0b71650 (expire 2026-11-10T11:59-12:16Z). Review evidence/input/verdict artifacts (448) live until 2027-01-19..31; installers until 2026-11-20..26. The coordinator's "post-merge VERIFIED" statements [C] therefore cannot be re-checked against GitHub after 2026-11-10 unless digests are preserved elsewhere.

---

## 7. Branches

[V] `GET /branches` x4 pages = **354** branches: `claude/*` 337, `feature/*` 6, `ci/*` 3, `v7/*` 3, `uasco/*` 3, `test/*` 1, `master` 1. Local `refs/remotes/origin/*` has 581 refs, of which 227 are `origin/pr/*` mirror refs that are not GitHub branches (the other 354 match the API list exactly); the local `auditmirror` remote is excluded.

`git branch -r --merged/--no-merged origin/v7/integration` over the 354: 278 merged (ancestors), **76 not merged**.

| Group | Count | Detail |
|---|--:|---|
| `claude/*` merged into v7/integration | 271 | ancestor of HEAD |
| `claude/*` not merged | 66 | 8 are the open-PR heads, **58 are stale** (no open PR) |
| non-`claude/*` not merged | 10 | `ci/diagnose-elevation`, `ci/diagnose-shards`, `feature/ci-green-fixes`, `feature/ui074-providers`, `feature/ui205-matrix`, `feature/ui227-readiness`, `test/uasco-runner-smoke`, `uasco/wip/pq-001`, plus the two live coordinator branches `uasco/production-queue` (199 ahead, tip 2026-11-02T02:52Z, ledger) and `uasco/production-reports` (91 ahead, tip 2026-10-27) |

**The 58 stale `claude/*` branches** (`stale_table.tsv`): tip dates Oct 18: 3, Oct 19: 9, Oct 20: 3, Oct 21: 10, Oct 22: 10, Oct 26: 19, Oct 27: 4 (all at least 6 days old).
- 22 once had a PR: 16 closed-unmerged (#11, 23, 28, 30, 32, 33, 46, 50, 68, 104, 114, 116, 141, 142, 154, 171) and 6 whose PR was merged but the tip is not an ancestor (#158, 160, 162, 164, 172, 174; squash/wave style).
- 36 never had a PR: lane-b 14, lane-a 4, lane-c 3, rtest-20261019-a/b/c probes 3, and 12 `coord-*` (coord-eval 3, coord-intake 2, coord-intel-v1, coord-par-repros, coord-protected-batch-4b, coord-ps1a-bridge-port, coord-reviewer-typed-diagnostics, coord-scope-grants, coord-transition-autonomy).
- `git cherry origin/v7/integration <branch>`: **16 branches have every commit patch-equivalent to something already on base** (plus=0; safe deletion candidates after a human check) and **42 carry unmerged work** (276 non-equivalent commits in total; an upper bound because squash merges break patch-ids). Largest: `claude/coord-intel-v1` 113 commits (Intel V1 tip 21b3569, "CHECKLIST_PASSED, unpublished" [C]), `claude/lane-b-sbx-win-4-startup` 42, `claude/lane-b-eval-flow-l2` 10, `claude/lane-b-accept-claude-1` 10, `claude/lane-b-sbx-win-3` 9, `claude/lane-b-accept-e2e-1` 8, `claude/coord-par-repros` 6, `claude/lane-c-sbx-lo-1` 6.
- Discrepancy [V]: coordinator cites `claude/lane-c-fsmon-central-authreq-1` at `c917235`; the branch tip is `0eb03c7` (2026-10-27T11:02Z, child of c917235, "version-safe empty value" amendment). The Founder authority request should reference 0eb03c7.
- No branch was created or deleted by me; the only branch tips newer than 2026-10-27T11:35Z are `claude/lane-a-tools-panel-1` (2026-11-02T02:18Z) and `uasco/production-queue` (2026-11-02T02:52Z).

---

## 8. Cross-check of COORD-VERIFIED statements

| Statement | Result |
|---|---|
| No commit on v7/integration after 0b71650 | **Confirmed** [V] |
| Open PRs (8) with listed head SHAs | **Confirmed** [V], all 8 SHAs equal |
| #292 pushed 43776e1 at 02:18Z | **Confirmed** [V]: ref committed 2026-11-02T02:18:33Z, PR updated 02:22:24Z, CI created 02:22:14Z |
| Heartbeat report last written 2026-10-27 09:14Z | **Consistent** [V]: `uasco/production-reports` tip committed 2026-10-27T12:15:03+03:00 (09:15:03Z) |
| Nothing ran during the usage-limit window | **Confirmed** for GitHub: zero workflow runs between 2026-10-27T11:42:20Z and 2026-11-02T02:22:13Z [V]; session/limit claims are outside this phase |
| Base-wide CI failure `DEPENDENCY_AUDIT_BLOCKERS:11` (glob / minimatch via electron-builder) | **Confirmed and reproduced** locally on HEAD's lockfile [V] (11 moderate; advisory titles "Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal", "minimatch has potential denial of service via globparts amplification"; lock has glob 13.0.6, minimatch 10.2.6, both dev); the advisory *version ranges* in the statement were not independently re-derived |
| Coordinator is validating an `overrides` fix on `claude/coord-dep-audit-glob-minimatch` | **Branch not on origin** [V]; cannot be reviewed from GitHub |
| 8 open PRs' "review/CI" narrative (#288 BLOCKERS 2M+14L, #282 BLOCKERS 1M+2L, #291 route lens NO_BLOCKERS, #292 NO_BLOCKERS) | **Not verifiable on GitHub** [C]: no review/comment on those PRs |

---

## 9. Gaps / remaining work (for the master list)

| ID hint | Module | Prio | Item | Evidence |
|---|---|---|---|---|
| GH-DEPAUDIT | CI / dependency-supply-chain | P0 | Every CI run is red on Linux + Windows shard 1 until glob/minimatch advisories are overridden; fix needs protected `package*.json`; fix branch not pushed | run 41377356505; local npm audit 11 moderate; `scripts/dependency-supply-chain.mjs:7` |
| GH-MERGEIDLE | Merge pipeline | P1 | 0 merges for 135 h (longest gap ever); 0/8 open PRs merge-ready | PR table section 3 |
| GH-WINFLAKE | CI / Windows | P1 | 54 of 190 failed CI runs are Windows timing/liveness flakes; PR pass rate 72.6%, push 62.1%; 2 of last 8 base pushes red on Windows tests; FD-LV1 and shard-timing hardening still Founder-gated | section 6.6, push CI list |
| GH-CONFLICTS | Open PRs | P2 | #288, #282, #251, #247, #231 have merge conflicts (9-235 commits behind); #66 is 1171 behind | `GET /pulls/<n>` mergeable_state, git ahead/behind |
| GH-EVIDENCE-EXPIRY | Evidence retention | P2 | All SHA-bound CI evidence artifacts for the Oct 19-27 history expire 2026-11-02..16 (HEAD's on 11-10); installers 11-20..26; no digest manifest preserved | section 6.9 |
| GH-RULESET | Governance | P2 | Ruleset requires 0 approvals, no up-to-date, no last-push approval, no bypass actors: GitHub does not enforce the review/gate process; merge safety rests on supervisor discipline | ruleset 25433316 |
| GH-IR-IDLE | Independent review | P2 | `ai-review` ran 58 times (54 branches) between Oct 21 and Oct 27 and has not run since; 1 run stuck `waiting` for about 11 days; 2 GitHub-App token failures | section 6.8; run 39687649214 |
| GH-INSTALLER | Installer | P2 | One verified CI-built installer (106 MiB, expires 2026-11-26); no signing step; no release; not shown end-user usable | section 6.7 |
| GH-BRANCHES | Repo hygiene | P3 | 58 stale `claude/*` (36 never had a PR; 42 hold unmerged commits incl. `coord-intel-v1` 113) + 10 non-claude unmerged; 16 branches fully patch-equivalent to base | `stale_table.tsv` |
| GH-DIAGWF | Workflow hygiene | P3 | 5 of 8 registered workflows have no file on base (Desktop E2E, 2 diagnose, 2 self-hosted); 12 repo labels, only 1 used; issues unused | section 6.1, 5 |
| GH-FSMON-REF | Founder request | P3 | `claude/lane-c-fsmon-central-authreq-1` tip is 0eb03c7, not the c917235 cited in the Founder-pending list | section 7 |
| GH-CIWASTE | CI cost | P3 | 14 d: 787 CI runs, 347 wall-hours; 166 cancelled (33.8 h), 190 failed (72.1 h); 51 extra attempts | section 6.4 |

## 10. Unverifiable from this phase

- Billed Actions minutes/cost and runner-minute totals (not exposed; public repo).
- Content/depth of the Windows installer's "Real install / launch / repair / uninstall test" and whether any human has run the installer.
- Ledger/queue verdicts (review states, `NO_BLOCKERS`/`BLOCKERS` counts), because they are not on the PRs.
- Whether the dep-fix `overrides` (glob 14.0.3, minimatch 11.0.3) actually clears the audit and keeps `electron-builder` working (branch not on origin; I did not run `npm install`).
- Root cause of the 59 "no signature" Windows failures (44 on 2026-10-19 pre-sharding) and of the Windows timing flakes (only the symptom is in the logs).
- Whether rulesets can be bypassed by the repo owner/admin (API shows no bypass actors; org-level or admin behaviour not visible; classic branch protection returns 403).
- Attempt-by-attempt outcomes of re-runs (attempt endpoints not queried).

## 11. Reproduction (read-only)

```
R=https://api.github.com/repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-
curl -s "$R/pulls?state=closed&per_page=100&page=1..3"        # 284 closed PRs, merged_at != null = 259
curl -s "$R/pulls/<n>"                                         # mergeable_state, draft, labels
curl -s "$R/actions/runs?per_page=100&page=N&created=YYYY-MM-DD"   # per-day slices (1740 runs)
curl -s "$R/actions/runs/<id>/jobs"                            # failed-job causes; /actions/jobs/<id>/logs for logs
curl -s "$R/rulesets/25433316" ; curl -s "$R/rules/branches/v7%2Fintegration"
curl -s "$R/actions/artifacts?per_page=100&page=N"             # 3248 artifacts
git branch -r --no-merged origin/v7/integration                # 76 (354 branches)
npm audit --package-lock-only --json   # on copy of package.json + package-lock.json from 0b71650 -> 11 moderate
```
