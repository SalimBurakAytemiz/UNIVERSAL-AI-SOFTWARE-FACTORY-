<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-22 09:15Z

Classification only. Nothing claimed, dispatched, merged or approved.

## Counts
- Open PRs targeting v7/integration: 9 (7 draft, 2 ready)
- dispatch.mjs (--owner heartbeat --no-lease): outcome NO_ACTION, no task dispatchable
- Reclaimable list: 36, all MERGED_AWAITING_WRITEBACK (e.g. UI-002, UI-007, UI-125, UI-109, UI-146, UI-182, UI-233, UI-194, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, UI-035, MOB-1..MOB-4 ...)
- Production queue: 16 tasks: INTEGRATED 15, TESTED 1
- IN_PROGRESS / CLAIMED tasks: 0

## STALE_* lines
None. No IN_PROGRESS or CLAIMED task in PRODUCTION-QUEUE.json, so there is nothing to classify FRESH / STALE_NO_WORK / STALE_WITH_WORK.

## PR / CI / review (current head SHA)
| PR | Head branch | Draft | ubuntu | windows | UASCO Independent Review |
|----|-------------|-------|--------|---------|--------------------------|
| 203 | claude/lane-c-reviewer-limits | y | success | success | NONE |
| 201 | claude/lane-c-workspace-archive | y | success | IN_PROGRESS (shards running) | NONE |
| 200 | claude/lane-b-run-summaries | y | IN_PROGRESS | IN_PROGRESS | NONE |
| 199 | claude/coord-protected-batch-3b | n | success | success | IN_PROGRESS |
| 197 | claude/lane-a-predev-decisions | y | success | success | NONE |
| 196 | claude/lane-a-attention-sections | y | failure | failure | NONE |
| 195 | claude/coord-protected-batch-3 | n | success | success | IN_PROGRESS |
| 192 | claude/lane-a-attention-ui | y | failure | failure | NONE |
| 66 | claude/e2e-desktop-verify | y | success | success | NONE |

Notes: #199 and #195 have founder-authority job in "waiting" state. #66 checks date from 2026-10-19 (head ffeaf79); it is old and has no review/shard checks.

## Top blockers
1. #196 red on head c2d0697: ubuntu, windows (shards 1 and 3 failed).
2. #192 red on head b58669f: ubuntu, windows (shard 1 failed).
3. #199 and #195: founder-authority job waiting; UASCO Independent Review still in progress.
4. 36 merged claims awaiting write-back in the canonical backlog (no dispatchable work until written back).
5. #66 CI evidence is 3 days old and not refreshed; #201 and #200 windows validation still running.

Missing data: none beyond the NONE entries above (no such check present on the head).
