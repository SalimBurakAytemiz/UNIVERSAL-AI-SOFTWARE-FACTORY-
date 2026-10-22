<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-22 12:13Z

Classification only. Nothing claimed, dispatched, merged, approved or deleted.

## Counts
- Open PRs targeting v7/integration: 10 (9 draft, 2 non-draft: #195, #199; #66 old draft)
- Production queue (uasco/production-queue): 16 tasks = INTEGRATED 15, TESTED 1
- Queue tasks IN_PROGRESS/CLAIMED: 0
- Canonical backlog dry run (dispatch.mjs --owner heartbeat --no-lease, detached origin/v7/integration): outcome NO_ACTION, active 0
- Reclaimable (state MERGED_AWAITING_WRITEBACK): 35

## STALE_* lines
None. No IN_PROGRESS/CLAIMED queue task exists, so no FRESH/STALE_NO_WORK/STALE_WITH_WORK classification applies.

## Reclaimable (verbatim taskIds, all MERGED_AWAITING_WRITEBACK)
UI-002, UI-007, UI-125, UI-109, UI-146, UI-182, UI-233, UI-194, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, UI-035, MOB-1..MOB-9, CP-DISPATCH-IMPL, UI-030, UI-113, UI-132, UI-032, UI-026, UI-025, UI-133, UI-047, UI-201, UI-111, UI-114, UI-028, UI-106, UI-110, UI-105

## PR / CI / review (current head SHA)
| PR | head branch | head | ubuntu | windows | UASCO Independent Review |
|---|---|---|---|---|---|
| 210 | claude/lane-c-runner-lease-flake | 5c19174 | success | failure | NONE |
| 209 | claude/lane-c-eval-pipeline | d89778a | success | failure | NONE |
| 208 | claude/lane-c-runner-exports | 57706a1 | success | failure | NONE |
| 207 | claude/lane-b-run-readiness | a2eca9c | success | success | NONE |
| 199 | claude/coord-protected-batch-3b | ef39c31 | success | success | in_progress (since 08:27Z) |
| 197 | claude/lane-a-predev-decisions | 54b741c | success | success | NONE |
| 196 | claude/lane-a-attention-sections | c2d0697 | failure | failure | NONE |
| 195 | claude/coord-protected-batch-3 | 5e14558 | success | success | in_progress (since 07:01Z) |
| 192 | claude/lane-a-attention-ui | b58669f | failure | failure | NONE |
| 66 | claude/e2e-desktop-verify | ffeaf79 | success | success | NONE |

Note: windows failures on #208/#209/#210 include a failed validate-windows-shard; windows shards for #196/#192 also failed.

## Top blockers
1. #196 and #192: validate failing on both ubuntu and windows.
2. #208, #209, #210 (lane-c): validate (windows-latest) failing while ubuntu is green.
3. #195 and #199: UASCO Independent Review still in_progress (3.7 h and 5.2 h); founder-authority check waiting.
4. 35 merged branches awaiting backlog writeback (MERGED_AWAITING_WRITEBACK).
5. #66: stale since 2026-10-19, no UASCO Independent Review (NONE).
