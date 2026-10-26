<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-26 06:15Z (recovery classification only)

Fetch OK. origin/v7/integration = b77abe1. Nothing claimed, merged, approved or changed.

## Counts
- Open PRs -> v7/integration: 9 (8 draft, 1 ready: #223)
- Production queue (uasco/production-queue): 16 tasks = 15 INTEGRATED, 1 TESTED, 0 IN_PROGRESS, 0 CLAIMED
- Queue STALE_* lines: none (no IN_PROGRESS/CLAIMED task: FRESH 0, STALE_NO_WORK 0, STALE_WITH_WORK 0)
- Canonical backlog dispatch (dry run, --no-lease, no claim): outcome NO_ACTION, active 0
  - 2 entries have MALFORMED_ID (taskId null) -> data defect in backlog
  - reclaimable: 37, all MERGED_AWAITING_WRITEBACK (UI-002/007/125/109/146/182/233/194/035/030/113/132/032/026/025/133/047/201/111/114/028/106/110/105, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, MOB-1..9, CP-DISPATCH-IMPL). Writeback pending, not resumed.

## Open claude/* PRs: CI on current head
Review = "UASCO Independent Review". Windows is reported as "validate (windows-latest)"; where absent, shard states in note.

| PR | Head | validate ubuntu | validate windows | UASCO Independent Review | Note |
|----|------|-----------------|------------------|--------------------------|------|
| #229 lane-c-flow-analysis-1 | 771e1d3 | success | NONE | NONE | windows shards 1,2 success, 3 in progress |
| #228 lane-c-impl-win-1 | 68b2ec6 | success | NONE | NONE | shards 2 success, 1 success, 3 in progress |
| #227 lane-b-product-analysis | 11c895d | failure | failure | NONE | shard 3 failure |
| #226 lane-a-flow-gap-2 | d8bb804 | success | success | NONE | all green |
| #224 lane-c-par-1 | c0259b7 | failure | failure | NONE | shard 1 failure |
| #223 lane-b-flow-wiring | 555c2c6 | success | NONE | failure | windows shards 1 success, 2,3 in progress |
| #196 lane-a-attention-sections | 84a11c3 | failure | failure | NONE | shard 1 failure |
| #192 lane-a-attention-ui | b58669f | NONE | failure | NONE | last run 2026-10-22; windows failure |
| #66 e2e-desktop-verify | ffeaf79 | success | success | NONE | last run 2026-10-19 |

Note: several PR heads carry check runs from earlier runs mixed with newer ones; the table uses the check runs the API returned for the head SHA. Windows-shard CI still running on #229, #228, #223.

## Top 5 blockers
1. #223 (only non-draft PR): UASCO Independent Review = failure; Windows validation still running.
2. #227: ubuntu and windows validate failing (windows shard 3).
3. #224: ubuntu and windows validate failing (windows shard 1).
4. #196 / #192: validate failing (windows); #192 and #66 CI results are days old (2026-10-22 / 2026-10-19).
5. Backlog hygiene: 37 MERGED_AWAITING_WRITEBACK claims and 2 MALFORMED_ID entries; nothing is dispatchable (NO_ACTION).
