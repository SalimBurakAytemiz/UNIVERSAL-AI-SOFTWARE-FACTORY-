<!-- //TR: UASCO heartbeat raporu -->
# UASCO heartbeat 2026-10-21 12:16Z (classification only)

v7/integration @ a910883d5e37. Open PRs -> v7/integration: 24 (claude/*: 23, other: 1 = #8 feature/ui074-providers). 20 draft, 4 ready (#131, #128, #46 ... see table; draft flag per list).

## Canonical backlog (dispatch.mjs --no-lease, DRY_RUN)
- outcome NO_ACTION, active 0.
- Reclaimable: 37 total = 35 MERGED_AWAITING_WRITEBACK + 2 OPEN_PR (UI-110, UI-105).
- MERGED_AWAITING_WRITEBACK: UI-002 UI-007 UI-125 UI-109 UI-146 UI-182 UI-233 UI-194 SEC-IMPORT-GUARD SEC-IMPORT-GUARD-2 UI-035 MOB-1..MOB-9 CP-DISPATCH-IMPL UI-030 UI-113 UI-132 UI-032 UI-026 UI-025 UI-133 UI-047 UI-201 UI-111 UI-114 UI-028 UI-106
- 2 backlog rows have MALFORMED_ID (null taskId).

## Production queue (uasco/production-queue)
- Tasks with IN_PROGRESS/CLAIMED: 0. STALE_* lines: none (nothing FRESH, STALE_NO_WORK or STALE_WITH_WORK).
- Statuses seen: TESTED (PQ-001,002,004,006,007,008,008-R1,009,010,011,012,013, UI-105, UI-110), QUEUED (PQ-003), WAITING_BASE (PQ-005).

## PR / CI / review (claude/* heads)
Columns: ubuntu / windows = "validate (...)" conclusion; Review = "UASCO Independent Review" (NONE on every PR; check is "prepared, not active" per #131). Check runs read as returned for PR head; head SHA match not separately verified.

| PR | branch | ubuntu | windows | Review |
|---|---|---|---|---|
| 141 | lane-a-contrast-lab | failure | failure | NONE |
| 140 | lane-a-task-selector | failure | failure | NONE |
| 139 | lane-b-plan | failure | failure | NONE |
| 138 | lane-c-role-resolver | failure | failure | NONE |
| 137 | lane-b-intake | failure | failure | NONE |
| 136 | lane-a-idea-first-mission | failure | failure | NONE |
| 135 | pq-006 | failure | failure | NONE |
| 134 | pq-011 | failure | failure | NONE |
| 133 | pq-002 | failure | failure | NONE |
| 132 | pq-001 | failure | failure | NONE |
| 131 | uasco-independent-review | success | success | NONE |
| 130 | pq-010 | failure | failure | NONE |
| 129 | pq-008 | failure | failure | NONE |
| 128 | pq-009 | success | success | NONE |
| 127 | pq-007 | failure | failure | NONE |
| 126 | ui-110 | failure | failure | NONE |
| 125 | ui-105 | failure | failure | NONE |
| 66 | e2e-desktop-verify | success | success | NONE |
| 46 | test-states-studio-workspace | failure | failure | NONE |
| 33 | l-scheduler-ui-buildscheduler | success | failure | NONE |
| 32 | l-domains-ui-domainpacks | failure | failure | NONE |
| 28 | l-routes-ui078 | failure | failure | NONE |
| 23 | l-tower-trace-ui226 | failure | failure | NONE |

(#8 feature/ui074-providers not claude/*, not checked.)
Note: PRs 139-141 etc. each also show validate-windows-shard (1) failing; shards 2/3 mostly success. PR numbers 126,125,127,... mapping follows call order; #46/#32/#28/#23 failures are 2026-10-18/19 runs (old).

## Top blockers
1. 18 of 23 claude/* PRs have validate (ubuntu-latest) failing; ubuntu jobs fail in ~20-30 s (same pattern on all recent PRs, suggests a shared early-stage failure, cause NOT investigated).
2. validate (windows-latest) fails in ~8 s on the same PRs; validate-windows-shard (1) fails ~1 min after start, shards 2/3 pass.
3. UASCO Independent Review is NONE everywhere (not active), so no PR has independent review evidence.
4. 35 tasks stuck in MERGED_AWAITING_WRITEBACK (queue/backlog writeback not applied).
5. Only #131, #128, #66 are green on both validate jobs.
