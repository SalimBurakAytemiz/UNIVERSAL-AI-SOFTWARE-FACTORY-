<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-21 06:13Z

Classification only. Nothing claimed, dispatched, merged or approved.

## Counts
- Open PRs targeting v7/integration: 16 (15 with a claude/ head, 1 feature/ui074-providers). 10 are drafts.
- Production queue (16 entries): TESTED 10, QUEUED 4 (PQ-003, PQ-004, PQ-011, PQ-012), WAITING_BASE 1 (PQ-005), HOLD_CAPACITY 1 (PQ-006).
- IN_PROGRESS / CLAIMED: 0.

## STALE_* lines
None. No queue task is IN_PROGRESS or CLAIMED, so there is nothing to classify as FRESH, STALE_NO_WORK or STALE_WITH_WORK.

## Canonical backlog (dispatch.mjs --owner heartbeat --no-lease, dry run)
- outcome NO_ACTION, active 0, nothing dispatchable.
- Reclaimable: 36 entries.
  - 34 MERGED_AWAITING_WRITEBACK: UI-002, UI-007, UI-125, UI-109, UI-146, UI-182, UI-233, UI-194, UI-035, UI-030, UI-113, UI-132, UI-032, UI-026, UI-025, UI-133, UI-047, UI-201, UI-111, UI-114, UI-028, UI-106, SEC-IMPORT-GUARD, SEC-IMPORT-GUARD-2, CP-DISPATCH-IMPL, MOB-1..MOB-9.
  - 2 OPEN_PR: UI-110, UI-105.
- Two backlog rows report MALFORMED_ID (id is null).
- MOB-11..MOB-31 and the B2-* tasks need new authority; they are not dispatchable.

## PR / CI / review table
Conclusions are on each PR's current head SHA. UI = "UASCO Independent Review". NONE means the check is missing.

| PR | Head branch | ubuntu | windows | UI |
|----|-------------|--------|---------|----|
| 133 | claude/pq-002 (draft) | failure | failure | NONE |
| 132 | claude/pq-001 (draft) | failure | failure | NONE |
| 131 | claude/uasco-independent-review | success | success | NONE |
| 130 | claude/pq-010 (draft) | failure | failure | NONE |
| 129 | claude/pq-008 (draft) | failure | failure | NONE |
| 128 | claude/pq-009 | success | success | NONE |
| 127 | claude/pq-007 (draft) | failure | failure | NONE |
| 126 | claude/ui-110 (draft) | failure | failure | NONE |
| 125 | claude/ui-105 (draft) | failure | failure | NONE |
| 66 | claude/e2e-desktop-verify (draft) | success | success | NONE |
| 46 | claude/test-states-studio-workspace | failure | failure | NONE |
| 33 | claude/l-scheduler-ui-buildscheduler | success | failure | NONE |
| 32 | claude/l-domains-ui-domainpacks | failure | failure | NONE |
| 28 | claude/l-routes-ui078 | failure | failure | NONE |
| 23 | claude/l-tower-trace-ui226 | failure | failure | NONE |

- PR 8 (feature/ui074-providers) has no claude/ head and was not checked.
- "validate (windows-latest)" is an aggregate job. On PRs 133, 132, 130 and 129 it failed about 8 s after the shards finished.
- PRs 133, 132, 130 and 129 each had windows shard 1 fail within about 1 min. On 133, 132 and 129 ubuntu failed within about 30 s.
- PRs 46, 33, 32, 28 and 23 have runs from 2026-10-18/19 that failed in 3 s or less. Those are stale runs.

## Top 5 blockers
1. CI red on 11 of 15 claude/ PRs (ubuntu or windows). Seven of them are queue-TESTED tasks: PQ-001 (132), PQ-002 (133), PQ-007 (127), PQ-008 (129), PQ-010 (130), UI-110 (126), UI-105 (125). Queue status TESTED conflicts with the red CI on the current head. The cause is not diagnosed here.
2. "UASCO Independent Review" is NONE on every PR. PR 131, which adds it, is documented as prepared and not active.
3. 34 merged tasks await writeback in the canonical backlog (MERGED_AWAITING_WRITEBACK).
4. Windows aggregate failures on 133, 132, 130, 129 and 33 follow a shard-1 failure. Check shard logs before rerunning.
5. PRs 46, 32, 28 and 23 have only old failed runs (2026-10-18/19), so their current CI state is unverified. PR 8 was not checked.
