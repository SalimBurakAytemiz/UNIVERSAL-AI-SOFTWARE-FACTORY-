<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-27 00:12Z

Classification only. Nothing claimed, dispatched, merged, approved.
origin/v7/integration @ 459205ca.

## Counts
- Open PRs -> v7/integration: 11 (all draft, all claude/* heads)
- Production queue (uasco/production-queue): INTEGRATED 15, TESTED 1, IN_PROGRESS 0, CLAIMED 0
- STALE_NO_WORK: 0
- STALE_WITH_WORK: 0
- FRESH: 0
- Canonical backlog dispatch (dry run, --no-lease): outcome NO_ACTION, active 0

## STALE_* lines
(none: no IN_PROGRESS/CLAIMED tasks in PRODUCTION-QUEUE.json)

## Reclaimable (dispatch.mjs), 35 entries, all state MERGED_AWAITING_WRITEBACK
UI-002 UI-007 UI-125 UI-109 UI-146 UI-182 UI-233 UI-194 SEC-IMPORT-GUARD SEC-IMPORT-GUARD-2
UI-035 MOB-1..MOB-9 CP-DISPATCH-IMPL UI-030 UI-113 UI-132 UI-032 UI-026 UI-025 UI-133
UI-047 UI-201 UI-111 UI-114 UI-028 UI-106 UI-110 UI-105
Also: 2 backlog entries with MALFORMED_ID (taskId null).

## PR / CI / review (current head SHA; NONE = no such check run)
| PR | head | ubuntu | windows | UASCO Independent Review |
|----|------|--------|---------|------|
| 267 coord-b3a-bounded-tick-watchdog | f98d4677 | success | NONE (3 shards in progress) | NONE |
| 266 coord-relfx-c3-lease-fence | 254779c4 | success | success | NONE |
| 265 lane-c-ctx-1 | c7a33f84 | success | FAILURE (shard 2 failed) | NONE |
| 264 lane-c-rdy-2a | 54430beb | success | success | NONE |
| 263 lane-a-readiness-panel-1 | 49ead803 | success | success | NONE |
| 262 lane-b-readiness-route-1 | fced8160 | in progress | NONE (shards in progress) | NONE |
| 251 coord-protected-ci-tep1 | f40bea3b | success | success | NONE |
| 247 coord-protected-aut2-tmp-cleanup | 323c14f6 | success | success | NONE |
| 242 coord-protected-batch-4b-r2 | 8c5e768b | success | success | NONE |
| 231 lane-b-sbx-win-4 | c9a3e2d5 | success | FAILURE (shards 1,3 failed) | NONE |
| 66 e2e-desktop-verify | ffeaf795 | success | success (run dated 2026-10-19) | NONE |

Check runs came from the PR check-runs API (head commit). Head-SHA match for #66 not independently verified.

## Top blockers
1. PR #265: validate (windows-latest) FAILURE (shard 2).
2. PR #231: validate (windows-latest) FAILURE (shards 1, 3).
3. No PR has a "UASCO Independent Review" check run (NONE on all 11).
4. PRs #267 and #262: Windows/ubuntu validation still running at report time; result UNKNOWN.
5. 35 reclaimable tasks sit in MERGED_AWAITING_WRITEBACK (writeback not yet recorded); 2 backlog entries have malformed IDs.
