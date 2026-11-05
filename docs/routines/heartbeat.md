<!-- //TR: Bu karar kaydı UASCO-T0116 kapsamında bulut heartbeat rutininin (trig_01QEwrSwCvd8UCbKFn97MiHh) kapalı kalmasını, gerekçesini, tüketicilerini, doğrulanamayan canlı durumu ve geri alma adımlarını belgeler. -->
# Heartbeat routine: decision record (UASCO-T0116)

- Task: UASCO-T0116 "Heartbeat kararı" (V3-F047, AC V3-AC-F047-1, remaining-work item RW-019 / G6-02)
- Work: "Heartbeat'i kapat ya da günlüğe indir". Done when: "Kapatıldı veya günlük/olay güdümlü; tüketicisi belgeli."
- Decision date: 2026-11-04. Base: `origin/v7/integration` @ e417bd5.

## Decision

**CLOSE.** The heartbeat routine stays disabled (`enabled=false`). It is not moved to a daily schedule.
When someone needs a status snapshot, the coordinator produces one on demand.
For a single run of the old routine, use one manual `fire_trigger` call (see Rollback). It does not need to be re-enabled.

## What "heartbeat" means here

This record covers exactly one thing: the Claude Code cloud routine (scheduled trigger) below.

| Field | Value | Source |
|---|---|---|
| Trigger | `trig_01QEwrSwCvd8UCbKFn97MiHh`, created via `meta_mcp` (an agent can disable it; not `http_api`) | G6 §agents table; COORD-CLOSURE-LOG |
| Schedule history | `11 * * * *` (hourly, 2026-10-18) → `11 */3 * * *` (every 3 h) | automation-governance.csv AG-003; G6 |
| Original purpose | "UASCO cloud production heartbeat": hourly dispatch, recovery of abandoned claims (> 6 h, no PR), and a production log | AG-003; CLOUD_MIGRATION_MANIFEST L1, "Recovery" |
| Later prompt | Report-only recovery classification: "you dispatch nothing" | G6 §summary ("Dispatch is dead…") |
| Output | Direct pushes of `docs/cloud-production/reports/PRODUCTION-LOG.md` to the non-merging branch `uasco/production-reports` | AG-003; G1 §253; G6 |
| Last report | commit `52e826ce`, 2026-11-02T03:12:19Z | G6 §271; UASCO_REMAINING_WORK.md B.1 |
| Disabled | 2026-11-02T05:16:43Z by the coordinator (`enabled=false`) | UASCO_REMAINING_WORK.md B.2 / L table ("list_triggers ≈06:00Z VERIFIED"); G9 row 1 |

These other things are also called "heartbeat" in the repo. They are separate systems, and this decision does not affect them:

- Work OS store-lock heartbeat (`core/workos/*`, `tests/support/workos-store-lock.cases.ts`).
- Task-lease and orchestrator liveness: `automation/lib/task-lease.mjs`, `automation/lib/orchestrator-*.mjs`, `scripts/uasco-liveness.mjs`, `scripts/uasco-supervisor-watchdog.mjs`, `config/liveness-policy.json`. These belong to the local orchestration product feature, which has a 15-minute daemon heartbeat. CLOUD_MIGRATION_MANIFEST L1 says "the local loop stays a product feature".
- Worker-fleet heartbeat fields in the desktop renderer (`apps/desktop/renderer/fleet-core.js`, `work-core.js`, `views/workforce.js`, `views/work.js`).
- Cloud job queue heartbeats (`apps/control-api/src/cloud/jobs.ts`).

## Reasons (evidence)

1. **No consumer.** The routine wrote 90 report commits between 2026-10-18 and 2026-11-02. No automation reads the branch. Sources:
   - G6 §120: "not consumed by any other automation I could find".
   - G6 §156: "90 reports, no consumer found".
   - UASCO_REMAINING_WORK.md §357, which recommends "DISABLE veya günlük".
   - A repo search on 2026-11-04 (`grep -rn "production-reports"` outside `docs/closure/`) finds only inventory and closure documents, no code.
2. **Its dispatch role is gone.**
   - The dispatch path was never exercised: the queue had 0 READY tasks (AG-003).
   - The later prompt says "you dispatch nothing", and all 16 queue tasks are INTEGRATED or TESTED (G6).
   - All builder and dispatch routines are disabled: the controller, Lane A/B/C ticks and both Production Builders (L table, ≈06:00Z 2026-11-02).
3. **Its output is unreliable.** The AG-003 audit found that the routine:
   - read QUEUE.json from an unmerged PR branch, and so reported closed PRs #13 and #14 as active;
   - reported merged PRs as unmerged;
   - logged "Active implementer sessions: UNKNOWN" on every run;
   - did not use `docs/cloud-production/report.mjs` (CP-REPORT).

   G6 also found two silent gaps of 77.4 h and 138.0 h.
4. **Cost and noise.**
   - Each run costs about $0.37 (n=1, measured: G6 §24, §199).
   - Every report push triggered a full CI run (AG-003: runs 39193619224, 39188878062, 39184319260).
   - The two report branches hold 37.3% of all commits since 2026-10-17 (G7 §83).
5. **A daily schedule would not fix 1–3.** Running daily cuts cost and noise but still produces reports nobody reads, about stale queue state. An event-driven trigger (on PR merge or claim) does not exist in this repo. Building one is a new feature, which is outside T0116.

## Consumers and the effect on each

| Consumer | What it relied on | Effect of CLOSE |
|---|---|---|
| Coordinator session (human reader) | Ad-hoc reading of `PRODUCTION-LOG.md` on `uasco/production-reports` | None in practice. Status now lives in the canonical closure report (`docs/closure/uasco-remaining-work/`), the review ledger and the PR list. The coordinator writes a snapshot on demand. |
| Founder | The same branch, if opened manually | Same as the coordinator row. One run is available on request (Rollback, option 1). |
| UASCO Cloud Development routine `trig_018vLbG82sUcp6ncPhRurka5` | Its prompt calls the heartbeat the "primary dispatcher" and says "no --claim while heartbeat owns dispatch" (G5 §22, §167; G6) | None at run time: the Founder disabled this routine at 2026-11-02T05:40:11Z (L table). If it is ever re-enabled, its prompt must stop citing the heartbeat first. That belongs to T0117 (routine prompt versioning). |
| Abandoned-claim recovery (CLOUD_MIGRATION_MANIFEST "Recovery", step 2b) | Heartbeat resumed a claim older than 6 h with no PR | No automatic recovery exists any more; claims are recovered manually by the coordinator. `docs/cloud-production/CLOUD_MIGRATION_MANIFEST.md` L1 and "Recovery" still describe the heartbeat as the recovery path. That text is now stale. Correcting it is a follow-up, because the file is outside this task's target set. |
| GitHub Actions CI | Every report push triggered CI | Fewer wasted CI runs. Nothing depends on those runs. |
| `docs/cloud-production/report.mjs` (CP-REPORT) | Not used by the heartbeat (AG-003) | None. |

## Live state: what is verified and what is not

- **VERIFIED (2026-11-02):** `enabled=false` at 05:16:43Z, and still disabled at about 06:00Z. The source is `list_triggers` as recorded in the closure report. A later `list_triggers` call, made after 05:40Z, showed all 11 routines with `enabled=false` (G9 row 1).
- **UNVERIFIED (2026-11-04):** the routine's current state. Trigger state cannot be read from the repository, and this record was written without `list_triggers` or `get_trigger` access. Before this record is relied on, an operator must run `get_trigger trig_01QEwrSwCvd8UCbKFn97MiHh` and confirm `enabled=false`. If it is enabled, disable it with `update_trigger trig_01QEwrSwCvd8UCbKFn97MiHh enabled=false`. This is allowed because the routine was created via `meta_mcp`.
- **UNVERIFIED:** the routine's exact current prompt text. It is not stored in the repository. Versioning it is T0117 (RW-020).

## Rollback

All rollback options are trigger API calls. No repository change is needed.

1. **One run, no schedule change:** `fire_trigger trig_01QEwrSwCvd8UCbKFn97MiHh`.
2. **Restore the previous schedule:** `update_trigger trig_01QEwrSwCvd8UCbKFn97MiHh enabled=true`. The stored cron is `11 */3 * * *`. It runs the prompt stored in the trigger, which is unversioned (see above).
3. **Daily instead:** `update_trigger trig_01QEwrSwCvd8UCbKFn97MiHh cron_expression="23 4 * * *" enabled=true`. That is 04:23 UTC daily, outside the 06:00–09:00 PT busy window.

Before option 2 or 3, also check two things:
- Is a consumer actually named? If not, the reasons above still hold.
- Does the stored prompt still read QUEUE.json from an unmerged branch? See reason 3.

To undo this decision record itself, revert the commit that adds `docs/routines/heartbeat.md`.
