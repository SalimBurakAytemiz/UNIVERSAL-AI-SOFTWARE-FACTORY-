<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-22 00:15Z

Classification only. Nothing claimed, dispatched, merged or approved.

## Counts
- Open PRs -> v7/integration: 17 (16 claude/*, 1 feature/ui074-providers); 7 draft
- dispatch.mjs (--no-lease, dry run, origin/v7/integration): outcome NO_ACTION, active=0
- Reclaimable: 37 total = 35 MERGED_AWAITING_WRITEBACK + 2 OPEN_PR (UI-110 #126, UI-105 #125)
- Production queue tasks IN_PROGRESS/CLAIMED: 0 (all TESTED or INTEGRATED)

## STALE_* lines
(none: no task is IN_PROGRESS or CLAIMED)

## PR / CI / review (current head; NONE = no such check; ubuntu/windows = validate (...))
| PR | branch | ubuntu | windows | UASCO review |
|----|--------|--------|---------|--------------|
| 153 | lane-c-predev-role-bindings (draft) | success | NONE (shards running) | NONE |
| 152 | lane-b-delivery-gates | success | NONE (shards running) | failure |
| 150 | lane-a-task-runs-ui | success | success | failure |
| 146 | win-installer-ci | success | success | in_progress |
| 141 | lane-a-contrast-lab (draft) | success | failure | NONE |
| 132 | pq-001 (draft) | failure | failure | NONE |
| 129 | pq-008 (draft) | failure | failure | NONE |
| 127 | pq-007 (draft) | failure | failure | NONE |
| 126 | ui-110 (draft) | failure | failure | NONE |
| 125 | ui-105 (draft) | failure | failure | NONE |
| 66 | e2e-desktop-verify (draft) | success | success | NONE |
| 46 | test-states-studio-workspace | failure | failure | NONE |
| 33 | l-scheduler-ui-buildscheduler | success | failure | NONE |
| 32 | l-domains-ui-domainpacks | failure | failure | NONE |
| 28 | l-routes-ui078 | failure | failure | NONE |
| 23 | l-tower-trace-ui226 | failure | failure | NONE |

Caveat: check runs listed by the API may include runs from older commits of the same PR (#141, #132, #129, #127, #126, #125: latest runs are from 2026-10-21 01:50-14:33Z). Treat red there as last-known, not re-verified on a fresh run.

## Top 5 blockers
1. UASCO Independent Review = failure on #150 and #152 (both otherwise ubuntu-green).
2. 6 draft PQ/UI PRs (#125, #126, #127, #129, #132) red on both validate jobs; last runs 2026-10-21.
3. 5 older PRs (#23, #28, #32, #46) red on both validate jobs; last runs 2026-10-18/19.
4. #33 and #141: ubuntu green, windows-latest failure.
5. 35 merged tasks still MERGED_AWAITING_WRITEBACK in the backlog; no writeback done (not this routine's job).

Unknowns: head committer age per branch not computed (no stale candidates).
