<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-22 21:12Z

Classification only. Nothing claimed, dispatched, merged or approved.

## Counts
- Open PRs -> v7/integration: 11 (claude/* heads: 11; drafts: 7)
- Production queue tasks: 16 (INTEGRATED 15, TESTED 1 [PQ-007], IN_PROGRESS 0, CLAIMED 0)
- dispatch.mjs (DRY_RUN, owner heartbeat, no lease): outcome NO_ACTION, active 0, reclaimable 35 (all MERGED_AWAITING_WRITEBACK: UI-002/007/125/109/146/182/233/194/035/030/113/132/032/026/025/133/047/201/111/114/028/106/110/105, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, MOB-1..9, CP-DISPATCH-IMPL)
- Notes: 2 MALFORMED_ID entries in the canonical backlog

## STALE_* lines
None. No production-queue task is IN_PROGRESS or CLAIMED, so there is nothing to classify FRESH / STALE_NO_WORK / STALE_WITH_WORK.

## PR / CI / review (current head SHA)
validate-u = validate (ubuntu-latest), validate-w = validate (windows-latest), review = UASCO Independent Review. NONE = check missing. (RUN) = running.

| PR | Head branch | Head SHA | Draft | validate-u | validate-w | review |
|---|---|---|---|---|---|---|
| 220 | coord-sec-deps-electron-fastify | 41b3baba | no | success | failure | failure |
| 219 | lane-b-p3-rest-test | 8d3e670c | yes | failure | failure | NONE |
| 218 | lane-c-runner-head-predicate | a2ed5c11 | yes | failure | (RUN: shards 2,3; shard 1 failure) | NONE |
| 214 | coord-protected-runner-test-split | 07cd588d | no | failure | failure | failure |
| 212 | lane-c-eval-tester | 7aaa37ea | yes | failure | failure | NONE |
| 211 | coord-protected-bs1d-split | a08e3225 | no | failure | failure | failure |
| 199 | coord-protected-batch-3b | 024f252e | no | failure | failure | failure |
| 197 | lane-a-predev-decisions | 54b74123 | yes | success | success | NONE |
| 196 | lane-a-attention-sections | c2d0697c | yes | failure | failure | NONE |
| 192 | lane-a-attention-ui | b58669f0 | yes | failure | failure | NONE |
| 66 | e2e-desktop-verify | ffeaf795 | yes | success | success | NONE |

## Top blockers
1. Base CI is red (per PR #220 title): validate (ubuntu-latest) fails on 8 of 11 PRs; PR #220 (electron/fastify advisories) is the likely fix and it is itself red on validate-windows and review.
2. validate (windows-latest) fails on 8 of 11 PRs, always together with validate-windows-shard (1) failing (shards 2/3 mostly pass).
3. UASCO Independent Review = failure on all 4 PRs that ran it (#220, #214, #211, #199).
4. Four non-draft protected-path PRs (#220, #214, #211, #199) are red on all three tracked checks.
5. 35 MERGED_AWAITING_WRITEBACK claims remain reclaimable in the canonical backlog (writeback pending; heartbeat did not touch them).

## UNKNOWN
Head committer ages: not applicable (no IN_PROGRESS/CLAIMED queue tasks). Failure root causes were not investigated (classification only).
