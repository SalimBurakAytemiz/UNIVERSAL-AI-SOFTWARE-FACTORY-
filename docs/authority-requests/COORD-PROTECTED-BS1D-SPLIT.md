<!-- //TR: Koordinatör korunan paket isteği: Windows doğrulama adımı tests-bs1-d'nin 600 sn sınırında öldürülmesini, sınırı yükseltmeden ilk-çalıştırma-hatası (FRF) senaryosunu yeni tests-bs1-g adımına ayırarak giderir; ölçümleri, dokunulan korunan dosyaları ve değişmeyenleri tek Founder kararında toplar. -->
# COORD-PROTECTED-BS1D-SPLIT: move the first-run-failure BS1 scenario out of `tests-bs1-d` into a new step `tests-bs1-g`

**Status:** BUILT on local branch `claude/coord-protected-bs1d-split` (base `origin/v7/integration` b55c776). Not pushed, not merged. This is a coordinator protected batch: it changes trust-root files (`config/validation.json`, `scripts/phase0-acceptance.mjs`) and reseals `config/trust-root-manifest.json`. **Only the Founder merges it, through the protected-PR auto-merge.** It is not marked CLEAN; the governed CLAUDE_REVIEWER review is still to run.

## Problem (measured)

The Windows validation step `tests-bs1-d` (`tests/pkg-bs1-autonomy-bootstrap-d.test.ts`, partition `BS1_PARTITION["d"]`) is killed at the fixed 600 s per-step limit (`scripts/run-validation.mjs`, `timeoutMs:600000`) on slow GitHub-hosted runners:

- 21 shard-2 jobs on 2026-10-22: the median was 316 s and the slowest passing run took 445 s. There were 3 timeouts that day: the b55c776 push (run 39767530552, BS1 total 591.4 s, killed at 600.088 s), PR #208 attempt 2 and PR #209.
- The step's critical path is the template build plus group 2/2. Group 2/2 is the single scenario `bootstrap-task-first-run-failure-stops-and-rolls-back-the-task` (FRF), which is 71-83 % of the step in every run. Group 1/2 is `bootstrap-task-registration-succeeds-or-rolls-back-without-a-runnable-task` (REG). Until now both groups ran in parallel in one step.

## Change

| File | Protected | Change |
|---|---|---|
| `tests/support/bs1-shard.ts` | no | Adds shard `g` to `Bs1Shard`. FRF moves from `d` to `g` as its only group, and `d` keeps only the REG group. No scenario is added, dropped or renamed. |
| `tests/pkg-bs1-autonomy-bootstrap-g.test.ts` | no (new) | A byte-for-byte mirror of the `d` file with the shard letter changed (`runBs1Shard("g")`, `BS1_PARTITION["g"]`). It has the same PASS condition and the same honest `SKIP NOT_WINDOWS` path. |
| `config/validation.json` | **yes** | New step `tests-bs1-g` right after `tests-bs1-f`. It has the same command shape (`node node_modules/vitest/vitest.mjs run tests/pkg-bs1-autonomy-bootstrap-g.test.ts`), `requiresDependencies: true` and `platforms: ["win32"]`. It also adds `shardPlan.win32.assign["tests-bs1-g"] = 2`, and the shardPlan `//TR` text now cites the measurement. |
| `scripts/phase0-acceptance.mjs` | **yes** | `tests-bs1-g` is added to the step ids that phase0 acceptance requires as PASS. Without this, FRF would silently stop being required by acceptance, because it used to be required through `tests-bs1-d`. |
| `config/trust-root-manifest.json` | **yes** (seal) | Resealed. Only the hash lines of the two protected files above change, plus `generatedAt`. |
| `tests/pkg-vs-validation-sharding.test.ts` | no | `WIN32_ONLY_STEPS` gains `tests-bs1-g` (seven Windows-only steps become eight). A new pin checks that FRF runs alone in shard `g`, never in the same step as REG, and that the `tests-bs1-<k>` steps match the `BS1_PARTITION` shards one to one. The phase0 pin now also requires every Windows-only step, so acceptance coverage cannot silently drop when a scenario moves to a new step. |
| `tests/support/local-worker.cases.ts` | no | The `LOCAL_PRIMARY` step count goes from 15 to 16, because the plan must list every canonical step in order. |
| `scripts/local-worker/test-plan.json` | no | Adds `tests-bs1-g` (LOCAL_PRIMARY, GitHub-hosted fallback), bumps the plan version to `2026-10-22.2`, sets `tests-bs1-d` to 246.0 s and `tests-bs1-g` to 337.4 s, and adds a `measurements.bs1Split` note on how both values were derived (see below). |
| `scripts/local-worker/README.md` | no | "15 test steps" becomes "16 test steps". |
| `docs/architecture/AUTONOMY-BOOTSTRAP.md` | no | "`tests-bs1-a` to `tests-bs1-f`" becomes "`tests-bs1-a` to `tests-bs1-g`". |

## What is NOT changed

- No timeout is raised. The 600 s per-step limit (`timeoutMs:600000`), the 90 min shard job limit, the vitest test and hook budgets and the selftest's own timeouts are all unchanged. `scripts/run-validation.mjs`, `scripts/validate-shards.mjs` and `.github/workflows/ci.yml` are untouched, and so is the shard count of 3.
- No scenario is dropped or skipped. `checkBs1Partition` still proves that each of the selftest's scenarios is assigned exactly once, and FRF is still required to print `"...": "PASS"` on Windows.
- No step is removed, and no assertion or coverage check is loosened. The pins change only where the step list really grew.
- The protected selftest `scripts/bootstrap-autonomy-selftest.mjs` is not changed.

## Measurements behind the shard choice

Source: the 12 most recent successful `ci.yml` runs on 2026-10-22, 39749776531 through 39764945894. Shard job wall times come from the Actions jobs API. Per-step durations come from the `ci-evidence` table in each run's `validate (windows-latest)` job log, read with `get_job_logs`. The BS1 group timings are the `BS1_TIMING` lines of the same runs' shard-2 jobs.

Current Windows shard job wall times (s):

| | Shard 1 | Shard 2 | Shard 3 |
|---|---|---|---|
| Median | 1132 | 1155 | 1446 |
| Min | 823 | 811 | 1137 |
| Max | 1275 | 1346 | 1615 |

Shard 2 currently holds `tests-6`, `tests-bs1-d`, `tests-bs1-e`, `tests-bs1-f` and `tests-lv1`.

The former `tests-bs1-d`, broken into parts (12 runs, s):

| | Median | Range |
|---|---|---|
| Template build | 25.7 | 18.1-38.4 |
| REG group | 201.1 | 124.6-236.9 |
| FRF group | 293.1 | 182.8-409.5 |
| Step overhead (step minus BS1 total) | 4.1 | 3.0-7.9 |
| Whole step | 326.4 | 203.9-451.3 |

The model gives the new `tests-bs1-d` as template + REG group + overhead, which is 232.4 s at the median and 278.7 s at the maximum. The new `tests-bs1-g` is template + FRF group + overhead, which is 326.4 s at the median and 451.3 s at the maximum.

Per-run model of the shard jobs: each option moves the measured times by the modelled difference. All values are in seconds.

| Option | Shard medians (1/2/3) | Median per-run makespan | Worst makespan | Spread of medians | Stdev of medians |
|---|---|---|---|---|---|
| Current | 1132 / 1155 / 1446 | 1446 | 1615 | 314 | 143 |
| **`tests-bs1-g` → shard 2 (chosen)** | 1132 / 1381 / 1446 | 1494 | 1625 | 314 | 135 |
| `tests-bs1-g` → shard 1 | 1414 / 1060 / 1446 | 1499 | 1619 | 386 | 175 |
| `tests-bs1-g` → shard 3 | 1132 / 1060 / 1719 | 1719 | 1931 | 659 | 295 |

Shards 1 and 2 tie on makespan, within 5 s at the median and 6 s at the worst. Shard 2 keeps the three shards better balanced, with the smallest spread and stdev, and it leaves shard 1 unchanged. Shard 3 is clearly worst. The chosen option makes shard 2 the critical path in 5 of 12 modelled runs, compared with 1 of 12 today.

## Honest limits of this fix (read before approving)

1. **The FRF step is not shorter by construction.** Group 2/2 was already FRF alone, so `tests-bs1-g` (template + FRF) has the same work as the old step's critical path. The model value of 326.4 s median and 451.3 s max is an upper bound, because it was measured while REG ran in parallel on the same runner. The only expected gain for FRF is that REG's concurrent CPU and disk load is removed. That gain is not measured. The earlier note that the split "roughly halves the critical path" is not supported by these numbers: only `tests-bs1-d` gets clearly shorter (326 → about 232 s at the median, 451 → about 279 s at the maximum).
2. **Total Windows runner time grows** by about one template build, one REG group and one vitest start, which is about 232 s at the median, because REG and FRF no longer overlap. The median Windows makespan is modelled to rise from 1446 to about 1494 s.
3. **What to verify after merge:** read `BS1_TIMING shard=g` and the `tests-bs1-g` duration in the next Windows CI runs. If `tests-bs1-g` still comes close to 600 s on slow runners, the next lever is inside the FRF scenario itself, in the protected selftest. That lever is a separate Founder decision. A further split is not possible, because FRF is a single scenario.
4. The local worker values for `tests-bs1-d` (246.0 s) and `tests-bs1-g` (337.4 s) are derived from the same run as the plan's other steps (39362844293). They are not yet measured as separate steps.

## Checks run (Linux, builder sandbox)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `validate-tr-comments` | `TR_VALIDATION: PASS` |
| `secret-sanity` | `SECRET_SANITY: PASS` |
| `verify-trust-root` | `HASH_MISMATCH` on `config/validation.json` and `scripts/phase0-acceptance.mjs` before the reseal (as expected); `TRUST_ROOT_VERIFY: PASS` after it, with 373 files, the same count as base |
| Pinning vitest files: `pkg-vs-validation-sharding`, `ci-validation-shards` (which includes the local worker cases), `pkg-f-validation-scripts-protected`, `review-governance` | all pass |
| BS1 `a` to `g` | every shard is SKIPPED with `NOT_WINDOWS` (the honest SKIP path), and the `a` rules test passes |
| Validators that read `config/validation.json`: mechanical-closure, runtime-resilience, paste2-closure, paste4c-doc-truth, config-runtime-enforcement, registries, architecture | all PASS |
| Canonical steps on Linux | `dependency-supply-chain` fails with `DEPENDENCY_AUDIT_INVALID_RESPONSE`, because the npm advisory endpoint is not reachable from the sandbox, and `release-supply-chain` then fails because it lacks that step's inputs. `tests`, `tests-2` and `tests-5` show exactly the same failing tests on base b55c776 and on this branch: the AUT1 orchestrator selftest, the OmniRoute `NPM_ROOT_UNAVAILABLE` check and the `unshare` sandbox gate, all of which are environment-only. Every other test step passes. On this branch `tests-2` has one more passing test, the new pin. |

Mutation checks were run on a copy of the branch against `pkg-vs-validation-sharding` and `ci-validation-shards`. All 11 mutations were killed:

| Mutation | Failing tests |
|---|---|
| Drop the step | 10 |
| Drop the step and its assignment | 9 |
| Leave the step unassigned | 1 |
| FRF in both `d` and `g` | 2 |
| FRF dropped from both | 2 |
| `g` file left out of the step | 2 |
| Step runs the `d` file instead | 2 |
| phase0 acceptance drops `tests-bs1-g` | 1 |
| FRF moved back into `d` | 1 |
| Local plan is missing `tests-bs1-g` | 5 |
| `g` test runs shard `d` | 1 |

## Merge

This needs the Founder's protected-PR auto-merge. The builder does not push, merge or declare it CLEAN.
