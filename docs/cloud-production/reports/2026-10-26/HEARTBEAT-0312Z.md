<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-26 03:12Z

Classification only. Nothing claimed, dispatched, merged, approved or deleted.

## Counts
- Open PRs targeting v7/integration: 14 (claude/* heads: 14; drafts: 9)
- Canonical backlog dispatch (--owner heartbeat --no-lease, dry run on origin/v7/integration): outcome NO_ACTION, active 0
- Reclaimable (state MERGED_AWAITING_WRITEBACK): 37 (UI-002, UI-007, UI-025, UI-026, UI-028, UI-030, UI-032, UI-035, UI-047, UI-105, UI-106, UI-109, UI-110, UI-111, UI-113, UI-114, UI-125, UI-132, UI-133, UI-146, UI-182, UI-194, UI-201, UI-233, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, MOB-1..MOB-9, CP-DISPATCH-IMPL)
- Production queue (uasco/production-queue): 16 tasks, status INTEGRATED 15, TESTED 1.

## Production queue recovery
- IN_PROGRESS / CLAIMED tasks: 0
- FRESH: 0; STALE_NO_WORK: 0; STALE_WITH_WORK: 0
- (no STALE_* lines)

## PR / CI / review (current head SHA)
Missing = NONE. "validate (windows-latest)" is the aggregate job; windows shard state noted where the aggregate is missing.

| PR | head | ubuntu | windows | UASCO Independent Review |
|----|------|--------|---------|--------------------------|
| 223 lane-b-flow-wiring | c7cbec6 | failure | NONE (shards: 1 fail, 2 ok, 3 running) | NONE |
| 222 lane-b-flow-1 | 9e35d2b | failure | failure | NONE |
| 221 coord-protected-lv1-unblock | 51c9ced | success | NONE (3 shards running) | in_progress |
| 220 coord-sec-deps-electron-fastify | 41b3bab | success | failure | failure |
| 219 lane-b-p3-rest-test | 8d3e670 | failure | failure | NONE |
| 218 lane-c-runner-head-predicate | a2ed5c1 | failure | failure | NONE |
| 214 coord-protected-runner-test-split | 07cd588 | failure | failure | failure |
| 212 lane-c-eval-tester | 7aaa37e | failure | failure | NONE |
| 211 coord-protected-bs1d-split | a08e322 | failure | failure | failure |
| 199 coord-protected-batch-3b | 024f252 | failure | failure | failure |
| 197 lane-a-predev-decisions | 54b741c | success | success | NONE |
| 196 lane-a-attention-sections | c2d0697 | failure | failure | NONE |
| 192 lane-a-attention-ui | b58669f | failure | failure | NONE |
| 66 e2e-desktop-verify | ffeaf79 | success | success | NONE |

## Top 5 blockers
1. Base CI red: ubuntu validate fails on 9 of 14 PRs (cause not investigated; PR #220/#221 titles say base is red from npm advisories; #221 ubuntu is now green).
2. Windows validate fails on 10 of 14 PRs; shard 1 fails consistently (cause not investigated).
3. UASCO Independent Review concluded failure on #220, #214, #211, #199 (reason not read).
4. #221 (unblocks base CI per its title): review and windows shards still running at report time.
5. 37 merged tasks await write-back (MERGED_AWAITING_WRITEBACK) in the canonical backlog.
