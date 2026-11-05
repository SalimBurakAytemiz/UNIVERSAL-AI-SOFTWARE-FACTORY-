# Throughput policy (V4.1 → V2 canonical handover record)

Source: Founder directive "THROUGHPUT CONTROL / EXECUTE NOW" (2026-11-05). V4.1 is the only live authority; V2 inherits this policy unchanged after the signed handover.

## Rules
1. **Integration window ≤ 2 PRs.** Only the next 1–2 ready PRs are base-merged onto current main; other PRs trigger no new CI. When a merge succeeds, a slot frees up and the next ready PR is taken.
2. **Single merge writer.** Merge only through the executor `merge` gate: CI PASS + CLEAN VERDICT-BINDING bound to the exact HEAD/BASE. No standing-authority expansion; Founder-tier PRs are never merged automatically.
3. **New PR rate ≤ merge rate.** Builders do not open PRs; a PR is opened only with a coordinator "PR-PERMIT" issued when a merge frees capacity. Priority: shrink the backlog.
4. **No lost code.** Every commit is pushed to the builder's own branch or a HELD branch and recorded by SHA (held-branches.json).
5. **Pre-PR automatic gate** (the coordinator's base-merge script runs it on every push): `tsc --noEmit`, `validate-tr-comments`, `validate-architecture`, `validate-registries` (lint equivalent), `pkg-vs-validation-sharding` (test-file registration), `vitest related`. Required Windows CI and the independent CLEAN gate are never removed.
6. **DONE = merged + verify-main PASS.** Having written the code does not count as DONE.
7. **Builder distribution (dynamic, by bottleneck):** delivery G, I · CI/test (Windows) D, A · integration/review fixes C, H · independent product E, F (no PRs).
8. **Metrics every 5 merges:** new PRs, merged PRs, total open PRs, median delivery time (created→merged), CI queue / Windows wait, completed product features. (`metrics.tsv`)

## Baseline (2026-11-05 ~20:56Z, last 3h)
| metric | value |
|---|---|
| new PRs | 14 |
| merged PRs | 2 (#362, #392) |
| total open PRs | 52 |
| median delivery time (merged) | 2.5 h |
| Windows job queue median / max | 19.9 / 66.2 min; run median 20.4 min |
| ubuntu job queue median / max | 11.7 / 60.2 min |
| active CI runs / stale SHA | 32 / 0 |

Structural limit: binding to the exact base forces every merge to restart the next PR's base merge + full CI (~40–60 min) + re-bind. So at most ~1–1.5 merges/hour with serial merging; this limit is not loosened.

## Comparison after 5 merges (2026-11-05 23:03Z; 2.1 hours since the directive)
| metric | baseline (previous 3 h) | after 5 merges (2.1 h) |
|---|---|---|
| new PRs | 14 | **0** (1 PR #405 was opened just before the directive; no new PR after the directive) |
| merged PRs | 2 | **5** (#360, #391, #378, #404, #405; each verify-main MAIN_RUNNING) |
| total open PRs | 52 | **47** |
| median delivery time (created→merged) | 2.5 h | 3.7 h (older PRs being drained) |
| Windows job queue median / max | 19.9 / 66.2 min | **0.1 / 0.3 min** |
| Windows job run time (median) | 20.4 min | 20.3 min |
| CI runs / failures | 85 / 3 | 30 / 0 |
| merge interval | — | ~30 min (21:04, 21:36, 22:08, 22:34, 23:01) |

Completed product changes (merged + main verified): #405 Project Studio wizard sends environmentId (real 400 bug fixed), #404 Assurance shows the newest runs first and states the cut, #360 V3-T1016 quota-resumable. #391 (API validator QA) and #378 (test-surface protection) are quality/safety work.
Finding: the Windows queue wait dropped to nearly zero; the limit is now Windows run time (~20 min) + re-bind per merge; the pace of ~2 merges/hour is limited by the exact-base binding (not loosened).
