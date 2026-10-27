<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-27 03:12Z

Classification only. Nothing claimed, dispatched, merged or approved.
origin/v7/integration = d0b3cf5e.

## Counts
- Open PRs targeting v7/integration: 10 (all draft, all head branches claude/*)
- Production queue (uasco/production-queue): 16 tasks = 15 INTEGRATED, 1 TESTED (PQ-007). IN_PROGRESS/CLAIMED: 0
- Canonical backlog dispatch (dry run, owner heartbeat, no lease): outcome NO_ACTION, active 0
- Reclaimable: 36, all state MERGED_AWAITING_WRITEBACK (UI-002, UI-007, UI-125, UI-109, UI-146, UI-182, UI-233, UI-194, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, UI-035, MOB-1..MOB-9, CP-DISPATCH-IMPL, UI-030, UI-113, UI-132, UI-032, UI-026, UI-025, UI-133, UI-047, UI-201, UI-111, UI-114, UI-028, UI-106, UI-110, UI-105)

## STALE_* lines
none (no IN_PROGRESS or CLAIMED production-queue task; FRESH 0, STALE_NO_WORK 0, STALE_WITH_WORK 0)

## PR / CI / review (current head SHA)
Cols: ubuntu / windows aggregate / UASCO Independent Review. NONE = check missing.

| PR | head branch | head | ubuntu | windows | review |
|---|---|---|---|---|---|
| 276 | claude/lane-b-next-1 | 4b62348 | success | failure (shard 1 failed) | NONE |
| 275 | claude/coord-par05-refill-lease | 57556ca | success | NONE (3 shards in_progress) | NONE |
| 273 | claude/lane-a-runstate-1 | 02bcebf | success | success | NONE |
| 265 | claude/lane-c-ctx-1 | d45c47b | NONE | NONE | NONE |
| 264 | claude/lane-c-rdy-2a | ae8ff39 | NONE | NONE | NONE |
| 251 | claude/coord-protected-ci-tep1 | f40bea3 | success | success | NONE |
| 247 | claude/coord-protected-aut2-tmp-cleanup | 323c14f | success | success | NONE |
| 242 | claude/coord-protected-batch-4b-r2 | 53726f3 | success | failure | NONE |
| 231 | claude/lane-b-sbx-win-4 | c9a3e2d | success | failure (shards 1,3 failed) | NONE |
| 66 | claude/e2e-desktop-verify | ffeaf79 | success | success | NONE |

Notes: 265/264 only have skipped scope/ai-review/collect checks (validate not run on head). PR 66 results date from 2026-10-19.

## Top blockers
1. No PR has a UASCO Independent Review check on its head (10/10 NONE).
2. Windows validate red on #276, #242, #231.
3. #265 and #264 have no validate run on head (possibly not triggered).
4. #275 windows shards still in progress.
5. 36 reclaimable claims stuck in MERGED_AWAITING_WRITEBACK; PQ-007 stays TESTED, not INTEGRATED.
