# 72-hour continuous-operation endurance test — plan (design only)

Priority-6 deliverable. This is the **plan**; the test does **not** start here. The user's directive is
explicit: the 72 h run begins only **after all critical integrations are verified**. Entry gate below.

## 0. Entry gate — ALL must be true before the clock starts

| # | Precondition | How verified |
|---|---|---|
| 1 | Merge gate live on `v7/integration` | `.ai/runtime/INTEGRATION_BRANCH_PROTECTION.json` = PASS; both `validate (ubuntu/windows)` required, strict, enforce_admins (`MERGE-GATE-FIX.md`). |
| 2 | Windows CI < 600 s (or sharded) | latest `validate (windows-latest)` green on head SHA; no `VALIDATION_STEP_TIMEOUT`. |
| 3 | Atomic lease wired (FA-LEASE2) | FA-LEASE2 PR merged; orchestrator claims/renews/releases per-task leases; wiring tests green. |
| 4 | Canonical backlog activated | promoted `BACKLOG_CHECKPOINT.json` + `PRODUCTION_QUEUE.json` with ≥1 genuinely READY, authorized CLOUD task. |
| 5 | Next-step engine wired | `selectNext` drives dispatch; `AWAITING_LOCAL` proven non-blocking in the wired path. |

If any row fails, the endurance test is **NOT_READY** — report which row, do not start.

## 1. Objective

Prove Cloud + Local run in parallel, unattended, for 72 h without: duplicate ownership, silent halts,
unsafe merges, lease deadlock, or state-chain corruption — and that every halt is a correctly classified,
recoverable state rather than a hang.

## 2. Scenarios

- **S1 Steady parallel.** Cloud works independent CLOUD tasks while Local runs Windows validation/merge on
  its own. Assert: no task ever has two live owners; each task's git-ref has exactly one holder at a time.
- **S2 Hand-off.** Cloud finishes a task → `AWAITING_LOCAL`. Assert: Cloud auto-advances to the next
  independent READY task (no idle wait); Local picks up the hand-off.
- **S3 Lease expiry / recovery.** Kill a worker mid-task. Assert: lease expires, the survivor reclaims with
  `epoch+1`, the dead worker's stale `renew`/`release` fails closed, no double-execution.
- **S4 Review independence.** Feed a stale-SHA and a same-identity verdict. Assert: both REJECTED
  (`STALE_SHA`, `SAME_IDENTITY`); a valid independent CLEAN at the current head is accepted.
- **S5 Drain / authority / blocked.** Exhaust READY CLOUD work. Assert: `NO_READY_WORK` /
  `AUTHORITY_REQUIRED` / `BLOCKED` are reported distinctly and the system does not halt production of still-
  runnable independent tasks.
- **S6 Provider quota + transient faults.** Inject quota + transient errors. Assert: only the affected lane
  backs off; bounded retry; `RECOVERABLE_FAILURE` classified; no Founder escalation for transient faults.
- **S7 Merge-gate enforcement.** Attempt a merge with a pending/failed required check. Assert: blocked
  (HTTP 405 class), no premature merge (the PR #9 class is impossible).

## 3. Metrics (sampled ≥ every 5 min; persisted to a run ledger)

- Ownership: max concurrent holders per task (**must stay 1**); count of duplicate-start attempts rejected.
- Liveness: longest interval with runnable READY work but no `START`; count of unexplained idle periods
  (**target 0**).
- Throughput: tasks STARTED / handed-off / merged per environment per hour.
- Lease health: renew success rate; reclaim count; stale-token rejections; deadlocks (**must be 0**).
- Review integrity: verdicts accepted vs rejected by reason; any CLEAN accepted at a non-current SHA
  (**must be 0**).
- Safety: premature-merge attempts blocked; state-chain (`verifyTransitionLog`) breaks (**must be 0**);
  protected-path writes by a non-maintainer (**must be 0**).
- Resource: disk headroom (session allowance), memory, log/ledger growth rate.

## 4. Pass / fail

**PASS** iff over the full 72 h: max concurrent holders per task = 1; 0 unexplained halts (every idle period
maps to `NO_READY_WORK`/`AUTHORITY_REQUIRED`/`BLOCKED` with evidence); 0 lease deadlocks; 0 premature merges;
0 state-chain breaks; 0 CLEAN at a non-current SHA; 0 unauthorized protected-path writes; all injected
faults recovered within their bounded-retry budget.

**FAIL** on any single occurrence of the "must be 0" counters, or any silent halt. A fail stops the clock,
captures a compact evidence slice (not full logs), root-causes, and the 72 h restarts after the fix is
merged through the gate.

## 5. Harness notes

- Drive via the wired orchestrator tick loop; do not simulate the lease — use the real git-ref store.
- Scenarios S3–S7 are fault injections scheduled across the window, not all at once.
- Do not weaken any gate to make the run pass. A gate that blocks is a correct observation, not a defect to
  remove.
