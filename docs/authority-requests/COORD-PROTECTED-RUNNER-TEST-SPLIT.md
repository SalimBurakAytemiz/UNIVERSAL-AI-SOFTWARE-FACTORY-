<!-- //TR: Koordinatör korunan paket isteği: Windows doğrulama adımı tests-3'ün 600 sn sınırında öldürülmesini, sınırı yükseltmeden mission runner test dosyasını iki dosyaya bölüp ikisini aynı adımda paralel çalıştırarak giderir; ölçümleri, dokunulan korunan dosyaları ve değişmeyenleri tek Founder kararında toplar. -->
# COORD-PROTECTED-RUNNER-TEST-SPLIT: run the two halves of the mission runner test file in parallel inside `tests-3`

**Status:** BUILT on branch `claude/coord-protected-runner-test-split`, on top of Lane C's `claude/lane-c-runner-test-split` @ 509556f (base `origin/v7/integration` e691ca0). This is a coordinator protected batch: it changes a trust-root file (`config/validation.json`) and reseals `config/trust-root-manifest.json`. **Only the Founder merges it, through the protected-PR auto-merge.** It is not marked CLEAN; the governed CLAUDE_REVIEWER review is still to run.

## Problem (measured)

The Windows validation step `tests-3` (Windows shard 3) is killed at the fixed 600 s per-step limit (`scripts/run-validation.mjs`, `timeoutMs:600000`) on slow GitHub-hosted runners:

- PR #210 (5c19174) shard 3: `VALIDATION_STEP_TIMEOUT tests-3 killed at the fixed per-step limit (durationMs=600115)`.
- In a passing Windows run (PR #209 d32828b), `tests-3` was `v7-b3a-c3-builder-commit` 35 s + `v7-b3a-recovery-budget` 37 s + `v7-b3a-runner.test.ts` 428 s. The runner file alone took 411-428 s on Windows, against about 94 s on Linux. Those runs had 51 tests in the file. At base e691ca0 it has 57; the 6 tests added since take about 10 % of the file's Linux time.
- The #210 review found no hang. On the slow runs every file ran about 1.3-1.6x slower (c3-builder-commit 35 → 47-56 s, recovery-budget 37-38 → 50-59 s). A slowdown of about 1.4-1.46x is enough to push the 51-test runner file past 600 s on its own, and less for the 57-test file.

vitest runs the files of one step in parallel (on a 4-vCPU `windows-latest` runner, `maxWorkers` defaults to `availableParallelism() - 1` = 3). The step's duration is therefore roughly that of its slowest file. Moving the runner file into its own step would not shorten it. What helps is splitting the file.

## Change

| File | Protected | Change |
|---|---|---|
| `tests/v7-b3a-runner.test.ts` | no | Lane C (509556f) keeps the run state table, mission runner engine, claim cap and control API tests here. Linux: about 48.9 s. |
| `tests/v7-b3a-runner-limits-archive.test.ts` | no (new) | Lane C (509556f) moves the bound role TaskLimits, run workspace archive + prune and runner export tests here. Linux: about 48.5 s. The split is mechanical: the 64 blocks (7 `describe`, 57 tests including one `it.skipIf`) are byte-identical and appear exactly once across the two files (Lane C's commit message says 63 titles; it misses the `it.skipIf` test), and no test is added, removed, renamed or changed. The shared helper header is copied verbatim, with unused imports pruned per file. |
| `config/validation.json` | **yes** | `tests-3` lists the new file right after `tests/v7-b3a-runner.test.ts`. Nothing else in the file changes: no step is added, the shard assignment (`tests-3` → shard 3) is unchanged, and so are the command shape and `requiresDependencies: true`. |
| `config/trust-root-manifest.json` | **yes** (seal) | Resealed. Only the hash line of `config/validation.json` and `generatedAt` change. |

`docs/cloud-production/ci/public-ci/test-shard-plan.json` is not changed. It is the measured snapshot behind the original 8-way split (it has its own `sourceCommit` and `measuredOn`), no test reads it, and it already differs from `config/validation.json` in `tests-2`.

## What is NOT changed

- No timeout is raised. The 600 s per-step limit (`timeoutMs:600000`), the 90 min shard job limit and the vitest test and hook budgets are all unchanged. `scripts/run-validation.mjs`, `scripts/validate-shards.mjs`, `scripts/phase0-acceptance.mjs` and `.github/workflows/ci.yml` are untouched. The step list, the shard count of 3 and the shard assignments are unchanged.
- No test is dropped, skipped or loosened. Every `tests/*.test.ts` file is still in exactly one step (the `pkg-vs-validation-sharding` coverage pin), and both runner files run in `tests-3` on both Linux and Windows.

## Expected effect (not yet measured on Windows)

Scaling the 51-test Windows time of 411-428 s by the 6 newer tests (about +10 %) gives about 450-470 s for the 57-test file as one file. If both halves slow down alike, each takes about half of that, 225-240 s, and they run in parallel with the two smaller files. The step should then take about 230-250 s on a normal runner, and about 360-390 s at the worst per-file slowdown seen (1.6x), against 600 s. These are estimates, not measurements. This PR's own Windows shard 3 run is the first measurement. It is evidence only for that one run. The `tests-3` duration in the next Windows CI runs is what to check after merge.

Total Windows runner time grows only slightly: no step and no vitest process are added, but one more vitest worker starts and imports its modules, and the copied helper setup now runs in both files.

## Checks run (Linux, builder sandbox)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `validate-tr-comments` | `TR_VALIDATION: PASS` |
| `secret-sanity` | `SECRET_SANITY: PASS` |
| `verify-trust-root` | `TRUST_ROOT_VERIFY: PASS` after the reseal (373 files, the same count as base). With the base manifest it reports `HASH_MISMATCH`, as expected. |
| Pinning vitest files: `pkg-vs-validation-sharding`, `ci-validation-shards`, `pkg-f-validation-scripts-protected`, `review-governance` | 4 files, 118/118 pass |
| Validators that read `config/validation.json`: mechanical-closure, runtime-resilience, config-runtime-enforcement, registries, architecture | all exit 0 |
| The `tests-3` command, run on its own | Base e691ca0 (3 files): 70/70 pass, vitest duration 135.0 s, wall 135 s. This branch (4 files): 70/70 pass, vitest duration 66.5 s, wall 67 s. These are single runs in the same sandbox, one after the other. |

Mutation checks were run on a copy of the branch against `pkg-vs-validation-sharding` and `ci-validation-shards`. All 4 mutations were killed:

| Mutation | Result |
|---|---|
| The new file is left out of `tests-3` | 2 failing tests |
| The new file is also listed in `tests-2` | 1 failing test |
| `tests/v7-b3a-runner.test.ts` is left out of `tests-3` | 2 failing tests |
| The base manifest is kept (no reseal) | `verify-trust-root` reports `HASH_MISMATCH` |

## Merge

This needs the Founder's protected-PR auto-merge. The builder does not merge it or declare it CLEAN.
