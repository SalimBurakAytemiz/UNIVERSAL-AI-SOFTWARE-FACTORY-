# FA-LEASE2 — Authority Request: wire the atomic per-task lease into the orchestrator core

**Status: REQUEST — NOT APPLIED.** This document asks the Founder/Local maintainer to authorize a scoped
change to protected trust-root files. No protected file is edited by this branch. The design below is a
reviewable proposal, not an executed change. Applying it requires (1) Founder authority record `FA-LEASE2`,
and (2) a Local maintainer trust-root re-seal of the changed protected files (Cloud must NOT receive re-seal
authority — see §7).

The reference implementation that this wiring would call is proven and committed **outside** protected scope
at `docs/autonomy/reference/next-step-engine.mjs` (+ `proof.mjs`, 65/65 PASS). It is NOT imported by any
protected file yet; that import is exactly the change this request gates.

---

## 1. Why a second authority (FA-LEASE1 is not enough)

`FA-LEASE1` (2026-10-18) covered **creating** the lease mechanism as standalone modules and merging them
(PR #10 → `e12dbdd`). Those modules are inert — they are called by tests and the reference proof only:

| Module | Lines | Role | Wired into orchestrator? |
|---|---|---|---|
| `automation/lib/task-lease.mjs` | 35 | per-task CAS state machine (`claim`/`renew`/`release`) | **no** |
| `automation/lib/task-lease-git-store.mjs` | 33 | git-ref `createIfAbsent`/`cas`/`remove` store | **no** |
| `automation/lib/lease-verdict.mjs` | 16 | verdict guard (`verifyVerdict`: task+SHA+independent identity) | **no** |

`FA-LEASE2` is the separate, higher-blast-radius step of **editing the protected orchestrator core** to
actually acquire/renew/release per-task leases and to enforce the verdict guard. That changes how task
ownership works at runtime, so it is a distinct Founder decision.

## 2. Current ownership model (verified, `e12dbdd`) — and the gap

The orchestrator today has a **single global-worker** lease, held as a field inside
`ORCHESTRATOR_STATE.json`'s `control` block:

- `orchestrator-state.mjs` → `acquireLease(control,{workerId,now,ttlMs})` / `heartbeat` / `releaseLease`.
  Semantics: exactly one `workerId` drives the whole orchestrator; a second worker is rejected
  (`LEASE_HELD`) until the holder's `expiresAt` passes, then the lease is treated as stale and taken over.
- Atomicity comes only from the single-file atomic write + the hash-chained transition log. It is **one
  machine, one filesystem** — it cannot arbitrate ownership across the Cloud (Linux) and Local (Windows)
  environments, and it is **whole-orchestrator**, not **per task**.

**Gap:** Cloud and Local cannot safely run in parallel on *different* tasks, because there is no per-task,
cross-environment, atomic owner. Two environments can each believe a task is theirs (Priority 5). The merged
`task-lease.mjs` closes this — but only once it is wired in.

The two leases are **complementary, not a replacement**: the global-worker lease still answers "who drives
this orchestrator instance"; the per-task lease answers "which environment owns task T right now". FA-LEASE2
adds the second without removing the first.

## 3. Exact protected files in scope (and nothing else)

Each is protected via `config/protected-paths.json` (`automation/lib/` prefix, or `config/` prefix).
`normalBuilderMayModifyProtectedPaths:false` ⇒ all require FA-LEASE2 + Local re-seal.

| # | Protected file | Lines | Planned change |
|---|---|---|---|
| 1 | `automation/lib/orchestrator-state.mjs` | 66 | add per-task lease helpers that delegate to `task-lease.mjs` over the git-ref store, keyed by package/task id; keep the existing global-worker lease untouched. |
| 2 | `automation/lib/orchestrator-engine.mjs` | 202 | in `nextAction`/`runTick`, before dispatching `IMPLEMENT`/`REMEDIATE`, `claim()` the per-task lease; `renew()` on tick heartbeat; `release()` on terminal/hand-off. Apply the next-step precedence so an `AWAITING_LOCAL` hand-off never blocks an independent READY task; classify `NO_READY_WORK`/`AUTHORITY_REQUIRED`/`BLOCKED`/`RECOVERABLE_FAILURE`. |
| 3 | `automation/lib/orchestrator-executors.mjs` | 215 | the implement/remediate executor pins the acting `headSha` into the lease record and renews the lease across long runs; releases on completion/failure. |
| 4 | `automation/lib/review-pipeline.mjs` | 147 | bind each reviewer verdict through `lease-verdict.verifyVerdict` (expected taskId + current headSha + independent session/builder identity); reject `STALE_SHA`/`NOT_INDEPENDENT`/`SAME_IDENTITY`/`TASK_MISMATCH`. |
| 5 | `automation/lib/review-quorum.mjs` | 70 | the CLEAN aggregate additionally requires the verdict's reviewed SHA to equal the current head, so a re-based/new head **invalidates** prior CLEAN (SHA-change ⇒ evidence void). |
| 6 | `config/execution-backends.json` | 78 | add a `lease` block: git-ref namespace (`refs/uasco/claims/`), `ttlMs`, heartbeat interval, and the independent-review identity config the verdict guard reads. |

No other protected file is touched. `scripts/`, `tests/`, `docs/` are not in scope and stay modifiable by the
normal builder.

## 4. The wiring contract (reviewable, not applied)

1. **Selection.** `selectNext(backlog,{store,owner,now,ttlMs,headSha})` chooses the next task and atomically
   claims it; only `status==="READY" && owner==="CLOUD" && authorizedBy && all deps DONE && not leased
   elsewhere` is selectable. First `GRANTED` → `START`. (Proven: `docs/autonomy/reference/proof.mjs`.)
2. **Single ownership (P5).** A task's git-ref is `createIfAbsent`; exactly one caller wins. A second owner
   on a held task gets `NO_READY_WORK`, never a duplicate start. Cloud and Local use the **same** git-ref
   store, so the arbitration is cross-environment.
3. **Renewal/recovery.** `renew()` keeps ownership (stable token); an expired lease is reclaimed with
   `epoch+1` by the CAS winner only; a stale holder's `renew`/`release` fails closed (`LOST`/`NOOP`).
4. **Independent review.** The verdict is accepted only if it is for this task, at the current head SHA, by a
   session and builder identity distinct from the implementer. Any SHA move voids it.
5. **No hang.** Every non-start outcome is classified; an `AWAITING_LOCAL` hand-off yields `NO_READY_WORK`
   for that task but never blocks other independent tasks (Priority 4).

## 5. What must NOT change under FA-LEASE2

- No weakening of any test, validation step, or security/governance rule. The verdict guard only **adds**
  rejection paths; it never accepts something the current pipeline rejects.
- No change to the merge gate, the re-seal flow, or the global-stop path.
- The historical/governed review-gate logic (`CLAUDE_ONLY`, quorum, blocker honouring) is preserved; the SHA
  binding is an **additional** precondition on CLEAN, not a replacement for quorum.

## 6. Validation plan for the applied change (to run on the FA-LEASE2 PR, pre-merge)

- Unit: existing `tests/uasco-atomic-lease.test.ts` (lease state machine) stays green; add orchestrator
  wiring tests (claim-before-dispatch, renew-on-tick, release-on-terminal, AWAITING_LOCAL non-blocking,
  stale-verdict rejection) — all under non-protected `tests/`.
- Re-run the reference proof semantics against the wired path.
- Full `node scripts/run-validation.mjs` on both CI platforms via the merge gate (`v7/integration` protection
  from `docs/autonomy/MERGE-GATE-FIX.md`), with the Windows-600 s sharding caveat tracked separately.
- Fresh isolated governed CLAUDE_REVIEWER review of the exact commit + bundle digest.

## 7. Authority boundary (explicit)

- **Founder** authorizes FA-LEASE2 (editing the six protected files for this purpose only).
- **Local maintainer** performs the trust-root re-seal of the changed protected files using the official
  maintainer-only `scripts/generate-trust-root.mjs`. **Cloud does not run re-seal and is not granted re-seal
  authority.**
- Cloud's role under FA-LEASE2: prepare the code + tests on a feature branch and open the PR; it does **not**
  self-apply, self-seal, or self-declare CLEAN.

---

**Requested decision:** grant `FA-LEASE2` for the six files in §3 under the contract in §4–§5, so Cloud may
prepare the wiring PR for Local validation, re-seal, and the governed independent review.
