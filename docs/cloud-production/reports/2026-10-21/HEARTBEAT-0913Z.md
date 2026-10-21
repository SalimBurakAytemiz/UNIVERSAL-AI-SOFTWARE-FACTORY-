<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-21 09:13Z

Classification only. Nothing claimed, dispatched, merged or approved.
Base: v7/integration@a910883d5e37823bcf133834529826de8eef3f9a

## Counts
- Open PRs targeting v7/integration: 24 (23 with head `claude/*`, 1 `feature/ui074-providers` #8, not table-listed). Drafts: 17.
- Production queue (uasco/production-queue): 16 tasks = TESTED 14, QUEUED 1 (PQ-003), WAITING_BASE 1 (PQ-005).
- Queue tasks IN_PROGRESS / CLAIMED: 0.
- dispatch.mjs (--owner heartbeat --no-lease, dry run): outcome NO_ACTION, active 0.
- dispatch reclaimable: 37 = 35 MERGED_AWAITING_WRITEBACK, 2 OPEN_PR (UI-110 #126, UI-105 #125).
  MERGED_AWAITING_WRITEBACK: UI-002, UI-007, UI-125, UI-109, UI-146, UI-182, UI-233, UI-194, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, UI-035, MOB-1..MOB-9, CP-DISPATCH-IMPL, UI-030, UI-113, UI-132, UI-032, UI-026, UI-025, UI-133, UI-047, UI-201, UI-111, UI-114, UI-028, UI-106.
- dispatch also reports 2 MALFORMED_ID backlog entries (id missing).

## STALE_* lines
None (no IN_PROGRESS/CLAIMED queue task, so FRESH / STALE_NO_WORK / STALE_WITH_WORK = 0 / 0 / 0).

## PR / CI / review (head SHA CI; ubuntu / windows / UASCO Independent Review)
| PR | branch | draft | ubuntu | windows | review |
|---|---|---|---|---|---|
| 141 | claude/lane-a-contrast-lab | Y | failure | failure | NONE |
| 140 | claude/lane-a-task-selector | Y | failure | failure | NONE |
| 139 | claude/lane-b-plan | Y | failure | failure | NONE |
| 138 | claude/lane-c-role-resolver | Y | failure | failure | NONE |
| 137 | claude/lane-b-intake | Y | failure | failure | NONE |
| 136 | claude/lane-a-idea-first-mission | Y | failure | failure | NONE |
| 135 | claude/pq-006 | Y | failure | failure | NONE |
| 134 | claude/pq-011 | Y | failure | failure | NONE |
| 133 | claude/pq-002 | Y | failure | failure | NONE |
| 132 | claude/pq-001 | Y | failure | failure | NONE |
| 131 | claude/uasco-independent-review | N | success | success | NONE |
| 130 | claude/pq-010 | Y | failure | failure | NONE |
| 129 | claude/pq-008 | Y | failure | failure | NONE |
| 128 | claude/pq-009 | N | success | success | NONE |
| 127 | claude/pq-007 | Y | failure | failure | NONE |
| 126 | claude/ui-110 | Y | failure | failure | NONE |
| 125 | claude/ui-105 | Y | failure | failure | NONE |
| 66 | claude/e2e-desktop-verify | Y | success | success | NONE |
| 46 | claude/test-states-studio-workspace | N | failure | failure | NONE |
| 33 | claude/l-scheduler-ui-buildscheduler | N | success | failure | NONE |
| 32 | claude/l-domains-ui-domainpacks | N | failure | failure | NONE |
| 28 | claude/l-routes-ui078 | N | failure | failure | NONE |
| 23 | claude/l-tower-trace-ui226 | N | failure | failure | NONE |

Note: for the PQ/LANE PRs the "validate (windows-latest)" aggregate fails within ~10 s of the shards finishing, with windows shard (1) failing in ~1 min. Failure cause not inspected (job logs not read): UNKNOWN.

## Top 5 blockers
1. 18 of 23 claude/* PRs have red "validate (ubuntu-latest)"; the ubuntu job fails in ~20-30 s on every recent head (PRs #125-#141), suggesting one shared cause. Cause UNKNOWN (not inspected).
2. "UASCO Independent Review" check is absent (NONE) on all 23 PRs; #131 (the check's own PR, prepared not active) is not yet merged. Merge lane is Founder-suspended.
3. Windows shard (1) fails on 13 PRs in ~1 min while shards 2/3 mostly pass; aggregate validate (windows-latest) then fails.
4. 35 reclaimable tasks sit in MERGED_AWAITING_WRITEBACK (merged work not yet written back to backlog); 2 more reclaimables have open PRs. 2 backlog entries have MALFORMED_ID.
5. PQ-003 QUEUED and PQ-005 WAITING_BASE have no branch/PR; dispatch authority for them rests with the production-queue builders.
