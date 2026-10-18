<!-- //TR: CLOUD-FIRST uretimin kalici/yeniden-baslatilabilir olmasini saglayan zamanlanmis yurutucu (routine) tasarimi: cloud oturumu bittiginde uretim guvenli bicimde yeniden baslar. Supervisor-owned .ai/runtime/ durumuna DOKUNMAZ; ayri, korunmayan cloud-production katmanidir. -->

# Cloud production persistence & recovery

Goal (directive #12): when this cloud session ends, production **safely restarts** via a persistent task queue (`QUEUE.json`, committed) and scheduled executors — no human machine required.

## Scheduled executors (claude-code-remote routines)

| Routine | Cadence | Fires into | Job |
|---|---|---|---|
| **Continuous-dispatch / recovery** | hourly | a fresh cloud session | Read `QUEUE.json` from `v7/integration` (or this branch until merged); for each READY task with no live lease and no open PR, dispatch an implementer; re-arm. Idempotent — never double-dispatches a task that holds a lease or already has a PR. |
| **60-minute production report** | hourly | this engine's reporting session | Run `report.mjs` (CP-REPORT) over real `gh`/`git` facts; append to the persistent report log; surface new PRs, active implementers, failures, bottlenecks. |

Both are **additive and idempotent**: they re-derive state from Git + GitHub + the lease refs, hold no authority of their own, and spawn only implementers (which cannot merge/reseal/approve). Stopping either leaves the repository and the lease state consistent.

## Restart invariants

- **Source of truth on restart** = Git (`v7/integration` + open PRs) + the atomic-lease refs, never in-session memory. A restarted dispatcher reconstructs the world from those.
- **Single ownership survives restart**: a task's lease ref outlives the session, so a restart never re-dispatches a held task.
- **No supervisor-state mutation**: the recovery layer never writes `.ai/runtime/` (supervisor-owned, protected). It is a parallel, non-protected layer.
- **Fail-closed**: a malformed/absent queue → dispatch nothing (report BLOCKED), never invent tasks.

## What recovery deliberately does NOT do

- It does not merge, reseal, or approve — those remain authorized-operator actions.
- It does not activate FA-LEASE2 wiring (protected; needs the Founder D3 record).
- It does not restore GitHub Actions (admin-owned billing/runners).
