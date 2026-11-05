<!-- //TR: Factory V2 (8 Builder + 4 Reviewer + 3 Merge Preparer + 1 Exclusive Writer + 1 Supervisor) uygulamasının durum matrisi, kanıtı, canlı devir prosedürü ve açık engellerini kayıt altına alır; durumlar CONFIGURED/IMPLEMENTED/TESTED/DEPLOYED/ACTIVATED/VERIFIED olarak ayrıdır. -->
# UASCO Factory V2 — adaptive parallel factory

Code: `automation/factory-v2/` · Tests: `tests/factory-v2/` · Evidence: `docs/factory-v2/SHADOW-EVIDENCE-{8,12}.json`

## What the runtime discovery found

| Finding | Evidence |
|---|---|
| The live V4.1 factory is a Claude Cloud supervisor session that spawns `CLAUDE_REVIEWER` sessions with `create_session` and merges through `docs/planning/autonomy/executor.mjs` (FD-2026-11-03). | `list_sessions`: parent `session_015dYwazi7LHFCg3dABbSW2P`, reviewer children per PR |
| `MissionRunner` already supports `maxConcurrentRuns` 1..16, but the only constructor call (`apps/control-api/src/server.ts:306`) does not pass it, so the V7 in-app runner stays at 1. | `core/workos/runner.ts:243-248` |
| `roadmap/parallel-lanes.json` says `maxParallelLanes=1`; it is a protected file and a classification, not the runtime limit. | file header |
| `automation/factory-supervisor.mjs` (V6) is retired (exit 64). Not modified. | line 3 |
| `task-lease.mjs` + `task-lease-git-store.mjs` give atomic, fenced claims on git refs; origin has **no** `refs/uasco/claims/*` refs, i.e. the live loop does not use them yet. | `git ls-remote origin 'refs/uasco/*'` → empty |

## Components

| Module | Role |
|---|---|
| `topology.mjs` | 8+4+3+1+1 initial target, slot ids `builder-A..H`, `reviewer-R1..R4`, `preparer-1..3`; scales to 10/12/… (ceiling 32); writer and supervisor fixed at exactly 1 |
| `ownership.mjs` | Supervisor domain lease, writer lease, task leases on the existing task-lease state machine; `fence()` before every accepted side effect; SHADOW ref namespace `refs/uasco/factory-v2/shadow/` |
| `state-journal.mjs` | Append-only fsync'd JSONL, replayed on restart; allow-listed monotonic transitions; idempotency keys; journal-level fencing epoch rejects a stale Supervisor |
| `scheduler.mjs` | Ready tasks from the canonical `task-index.json` (deps done, no start gates, not owned by the live runtime), file-scope conflict avoidance, domain-preferred assignment |
| `review.mjs` | Risk-aware reviewer allocation (1 reviewer low risk, dual+ for security/cross-system/T2), verdicts bound to exact base+head SHA, self-review refused, prior blockers must be resolved, auth/rate-limit/model failure never CLEAN |
| `merge.mjs`, `merge-git.mjs` | 3 parallel preparers (readiness only), single writer under a fenced lease, CAS on the expected base, result SHA verified; blocked candidates don't stop the queue |
| `quota-governor.mjs` | Quota modes (NORMAL/HIGH/SESSION_LIMITED/EXHAUSTED/RECOVERING), backpressure with hysteresis, redirect to review/integration/CI triage, near-reset completable-work filter |
| `failures.mjs` | TEMPORARY / PERMANENT / AUTHORIZATION / SECURITY; bounded exponential retry; auth/security → BLOCKED |
| `supervisor.mjs` | Single authoritative engine; STANDBY without the lease; recovery leaves validly-owned work alone |
| `executors.mjs` | `LocalProcessExecutor` (real child processes in isolated worktrees) and `CloudSessionIntentExecutor` (durable spawn intents for model-backed Claude Cloud workers; the supervisor session runs `create_session` and binds the real session id) |
| `cutover.mjs` | Fenced handover: old owner signs and releases, new owner acquires; old owner is fenced afterwards |

## Status matrix

| Capability | Status | Evidence |
|---|---|---|
| 8 Builder slots, overlapping real execution | IMPLEMENTED · TESTED (local processes) | A1: max overlap 8, 8 distinct PIDs; `SHADOW-EVIDENCE-8.json` |
| 4 independent Reviewer slots | IMPLEMENTED · TESTED (local processes) | max reviewer overlap 4, 4 distinct slots |
| 3 Merge Preparers | IMPLEMENTED · TESTED | A3: overlap 3 |
| 1 Exclusive Merge Writer | IMPLEMENTED · TESTED | A4: second writer HELD; CAS refuses a moved base |
| 1 Supervisor, split-brain safe | IMPLEMENTED · TESTED | A5: STANDBY, stale-epoch journal write refused |
| Lease fencing, crash recovery, worktree isolation | IMPLEMENTED · TESTED | A6, A7, A8 |
| Review/CI integrity, blocked-task isolation, negative injection | IMPLEMENTED · TESTED | A9, A10, A11, A17 |
| Quota governor / backpressure | IMPLEMENTED · TESTED (simulated telemetry) | A12. Real weekly-quota telemetry is not exposed to this session, so the 31% figure is a user snapshot, not a measurement |
| Scaling 8 → 10 → 12 | IMPLEMENTED · TESTED (simulated + local 12-process run) | A13; `SHADOW-EVIDENCE-12.json` (12 concurrent) |
| E2E task → build → review → prepare → merge → post-merge verify | TESTED (local repo, local check standing in for CI) | A14 |
| Coexistence with V4.1 | TESTED | A15: isolated namespace; live-owned tasks excluded |
| Handover | TESTED (local) | A16 |
| Model-backed Builders/Reviewers as Claude Cloud sessions | IMPLEMENTED (intent bridge), **not ACTIVATED** | needs live cutover |
| Live cutover, live activation (A18) | **NOT DONE** | see blockers |

Overall: **PARTIALLY COMPLETE**.

## Live cutover procedure (needs the V4.1 supervisor session to take part)

1. Merge this change through the normal V4.1 path (CLAUDE_REVIEWER review + required CI + `executor.mjs`).
2. V4.1 supervisor session: finish or checkpoint its current merge; stop starting new builders; write its in-flight list (task, PR, head SHA, builder session) into `STATE.json` `inFlight`.
3. New supervisor session starts `FactorySupervisor` in `LIVE` mode with domain `uasco-v7`, using `createRemoteRefStore` against origin (first live use of `refs/uasco/claims/*`). It takes the domain lease and excludes every `inFlight` task, so nothing in flight is claimed twice.
4. The V4.1 session keeps driving its in-flight PRs to merge/close (drain), then exits. New dispatches come only from the lease holder.
5. The new supervisor spawns 8 Builder sessions (one `create_session` per spawn intent, tags `uasco-factory-v2`, `slot:builder-X`), binds each real session id, and reviewers per review intent (fresh, read-only, never the builder).
6. Verify the topology with `list_sessions` (8 builder sessions running at once) and record session ids and overlapping timestamps as A18 evidence.
7. Rollback: release the domain lease; the V4.1 loop resumes from `STATE.json`. Leases expire on their own if a session dies.

## Blockers (exact)

1. **Live cutover needs the V4.1 session to take part.** This session is not the live owner. Stopping the V4.1 session's dispatch from outside would disrupt it, which the directive forbids. Steps 2 and 4 must be done by that session or by the Founder.
2. **Protected path: `apps/control-api/src/server.ts`.** The in-app V7 MissionRunner stays at concurrency 1 until the constructor passes `maxConcurrentRuns`. The change below needs Founder authorization (PROTECTED_PATH):
   ```diff
   -    leaseTtlMs:r.leaseTtlMs,maxRemediations:r.maxRemediations,
   +    leaseTtlMs:r.leaseTtlMs,maxConcurrentRuns:r.maxConcurrentRuns??(Number(process.env.UASCO_WORKOS_MAX_CONCURRENT_RUNS)||1),maxRemediations:r.maxRemediations,
   ```
3. **No real quota telemetry.** The governor accepts telemetry, but no authorized usage API is exposed to this session. Its decisions run on reported numbers and are labelled as estimates.
4. **Live claim refs.** `createRemoteRefStore` pushes `refs/uasco/claims/*` to origin. That is a first live use and part of the cutover, not done here.

## Commands

```bash
node automation/factory-v2/cli.mjs plan          # read-only 8-way plan over the canonical backlog, live-owned tasks excluded
node automation/factory-v2/cli.mjs evidence --out /tmp/e.json   # SHADOW run with real processes in a temp repo
npx vitest run tests/factory-v2
```
