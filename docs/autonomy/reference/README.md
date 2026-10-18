<!-- //TR: next-step engine referans/oneri uygulamasi ve yurutulebilir kaniti; korunan cekirdege baglanmamistir (baglama = FA-LEASE2). -->

# Next-step engine — reference / proposal (NOT wired)

`next-step-engine.mjs` is the Priority-4 "auto-advance" mechanism and the Priority-5 single-ownership
enforcer, as a **reference implementation**. It is intentionally **not** imported by any protected
orchestrator file — wiring it in is gated by `../FA-LEASE2-AUTHORIZATION-REQUEST.md`.

## What it does

`selectNext(backlog, {store, owner, now, ttlMs, headSha?})` always returns one classified outcome and never
hangs, never crashes on a store failure, and never lets a Local hand-off block independent work:

- `START` — the first selectable task was atomically claimed (`claim()` GRANTED).
- `NO_READY_WORK` — nothing this worker may start now (all remaining selectable tasks are leased elsewhere,
  or everything is `AWAITING_LOCAL`/`DONE`/`BLOCKED`/`DRAFT_NOT_READY`/LOCAL-owned).
- `AUTHORITY_REQUIRED` — only FOUNDER-owned or un-`authorizedBy` CLOUD work remains.
- `BLOCKED` — every remaining READY CLOUD task waits on an unfinished dependency.
- `RECOVERABLE_FAILURE` — the lease store threw; retry later, nothing was claimed.

**Selectable ⇔** `status==="READY" && owner==="CLOUD" && authorizedBy && every dependsOn is DONE && not
leased to another owner`. Priority = numeric `priority` asc, then array order.

Atomicity comes **only** from the merged lease store (`automation/lib/task-lease.mjs` over the git-ref store),
never from this module — it holds no lock and keeps no state. Single ownership (Priority 5) is the lease's
`createIfAbsent`/CAS: a second owner on a held task gets `NO_READY_WORK`, never a duplicate start, and Cloud +
Local share the same git-ref store so arbitration is cross-environment.

## Proof

`proof.mjs` runs the engine against the **real merged** lease + git-ref store in throwaway temp git repos.

```
# Node 24 required (repo engines: node>=24)
<node24>/node docs/autonomy/reference/proof.mjs
# => SUMMARY: 65 passed, 0 failed ; RESULT: ALL CHECKS PASS ; EXIT=0
```

Re-verified from this committed path on 2026-10-18: 65/65 PASS. The proof creates and deletes its own temp
repos; it writes nothing into the working tree and claims no lease in the real repo.

`loop-proof.mjs` is the **end-to-end** proof of the P0 success criterion: it drives the orchestrator loop
over the real engine + real leases — `selectNext` → `START` → "Cloud finished, hand to Local"
(status→`AWAITING_LOCAL`, release the Cloud lease) → `selectNext` again — and asserts Cloud auto-advances
`T1 → T2 → T3`, that a Local hand-off never blocks the next independent task, that a dependent task recovers
only once Local marks its dependency `DONE`, that two Cloud workers never take the same task (P5), and that the
terminal state is an honest `AUTHORITY_REQUIRED` rather than a hang.

```
<node24>/node docs/autonomy/reference/loop-proof.mjs
# => SUMMARY: 19 passed, 0 failed ; RESULT: ALL CHECKS PASS ; EXIT=0
```

## On wiring (FA-LEASE2 only)

When authorized, the engine moves into `automation/lib/` and its import becomes `./task-lease.mjs`; the
orchestrator calls `selectNext` before dispatching `IMPLEMENT`/`REMEDIATE`. Until then this stays a reviewed
reference with a passing proof — not production behavior.
