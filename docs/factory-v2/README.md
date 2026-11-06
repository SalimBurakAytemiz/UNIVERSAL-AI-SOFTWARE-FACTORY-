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
| Integration bridge (sync, manifest, CAS authority, reconcile, handover, rollback) | IMPLEMENTED · TESTED (shared bare origin + two clones) | `bridge.test.mjs` |
| Live read-only sync against real V4.1 state | VERIFIED (read-only) | see below |
| Live cutover, live activation (A18) | **NOT DONE**, V4.1 stays authoritative | see blockers |

Overall: **PARTIALLY COMPLETE**.

## Integration bridge (one UASCO execution system)

Code: `bridge.mjs`, `ref-doc-store.mjs`, `github-writer.mjs`; tests: `tests/factory-v2/bridge.test.mjs`.

- **Single authority record** `refs/uasco/authority/uasco-v7` on origin. Each version is a commit whose parent is the previous version. Updates are compare-and-swap (`push --force-with-lease=<ref>:<expected>`), so atomicity comes from the shared server, not from local locks. An absent record means V4.1 is authoritative.
- **Phases** (deterministic, CAS-guarded, epoch only increases): `V41_AUTHORITATIVE → HANDOVER_PREPARED → V41_DRAINED → V2_AUTHORITATIVE`; `rollback` returns to `V41_AUTHORITATIVE` from any phase with a new epoch.
  - `prepare` requires all four acceptance gates (`reviewClean`, `ciPassed`, `founderAuthorization`, `migrationAcceptance`, each with evidence). It publishes the immutable manifest `refs/uasco/handover/uasco-v7/v<N>`.
  - `drainAck` is written by the V4.1 owner. It must match the manifest digest and list the stopped builder sessions and a disposition per in-flight task (`COMPLETED` / `FENCED`).
  - `commit` re-checks every open PR head against the manifest (`MANIFEST_STALE` otherwise). It refuses any `RECONCILE_UNRESOLVED` item and names only the prepared candidate session.
- **Read-only sync**: `bridge snapshot` reads `STATE.json` and `task-index.json` at the exact `origin/v7/integration` SHA, plus open and merged PRs from the GitHub API. It writes nothing.
- **Reconciliation**:
  - Tasks in `STATE.done` or with a task-index DONE status are imported as VERIFIED and never rebuilt.
  - Every open PR with a `UASCO-TASK:` line becomes its own work item (`TASK#prN`) at its exact head/base SHA, adopted and not rebuilt. Its canonical task stays blocked as `AWAITING_ADOPTED_PRS`.
  - Stacked PRs are tracked but never auto-merged.
  - A merged increment PR is evidence, not completion.
  - An in-flight task with no open PR needs an explicit drain disposition.
  - PRs without a governed task line are left untouched.
  - The plan is applied to the V2 journal idempotently (keyed by manifest digest), so a restart re-imports nothing.
- **Gate in the Supervisor**: LIVE mode refuses a non-shared lease store and stays STANDBY unless the authority record names its session at the current epoch. It re-checks before every dispatch and before every merge write. A rollback revokes it on the next tick.
- **Global exclusivity**: in LIVE mode the Supervisor, Writer and task leases use `createRemoteLeaseStore` (origin `refs/uasco/claims/*`). Tested across two independent clones of one shared origin.
- **Live writer**: `github-writer.mjs` performs no git writes of its own. It calls the governed `docs/planning/autonomy/executor.mjs merge`. `FOUNDER_REQUIRED` and `BLOCK` are never treated as merged.

### Live read-only sync result (this session, base `a01c37d`)

Authority: V4.1 (no record on origin). 41 done tasks imported, 10 open PRs. Seven PRs carry a governed task line and are adopted at their exact head SHAs; #340 is stacked on another branch and is tracked but never auto-merged; #282, #340 and #341 have no governed task line and are left untouched. Without a V4.1 drain disposition, 5 in-flight tasks stay UNRESOLVED (CLOUD-T0008, UASCO-T0045, CLOUD-T0010, CLOUD-T0015, UASCO-T0062), so `commit` would be refused. This is the intended fail-closed behaviour.

## Handover security (Founder directive on PR #347)

| Threat | Control | Evidence |
|---|---|---|
| A caller types `actor: "<V4.1 session>"` | `actor` is never identity. Every transition carries an ed25519 envelope signed by a key registered for that role and session. Public keys come only from `docs/planning/authority/FACTORY-V2-ROLE-KEYS.json` at an exact canonical commit (governance path, Founder-merged). | `security.test.mjs` §1 |
| A registry writer forges, edits or rewinds the record | Each envelope is bound to the digest of the previous core state, forming a hash chain from the V4.1 genesis, and every reader re-verifies the whole chain. On a forged or edited record, V2 refuses and V4.1 halts; only a V41_OWNER or FOUNDER key can `resetInvalid`. On a rewind, a V2 holder that remembers its epoch stops. | §4, `resetInvalid` |
| Replay or alteration of a relayed approval | An envelope signs `prev`, the action, the domain, the payload digest and an expiry. | §6 |
| Text-only acceptance evidence | `gate-verifier.mjs` checks source, SHA, scope and authority from live GitHub and canonical git: a merged PR in canonical history, factory scope, a trusted-login `VERDICT-BINDING` CLEAN at the exact head and base, the required CI contexts from `github-actions`, a Founder `AUTHORIZES:` line under `docs/planning/authority/` naming domain, candidate and manifest version, and a successful `ci.yml` push run for the merge commit. | §2 (17 negative cases) |
| Unauthorized rollback | Only `V41_OWNER` or `FOUNDER` keys may roll back. | §3 |
| Caller-supplied freshness | `commit()` takes no freshness arguments. It reads the canonical SHA, open PRs and the STATE.json digest itself (`live-sources.mjs`). | §7 |
| V4.1 keeps merging after the handover | The canonical `executor.mjs` checks `v41-guard.mjs` before its only write. The patch is prepared in `docs/authority-requests/FV2-PROTECTED-EXECUTOR-AUTHORITY-FENCE.*` and needs Founder approval. | §5 (applies the patch, zero writes) |
| The V4.1 session cannot change its designated branch | No impersonating session is created. V4.1 signs its drain acknowledgement offline with its own key (`bridge sign-drain`); anyone relays it (`bridge relay-drain`); it cannot be altered. | §6 |
| A force-push, deletion or history rewrite of the registry branch | Our writes are plain fast-forward pushes. The registry branch must be protected server-side (`non_fast_forward` and `deletion` rules), and the code checks this through the GitHub rules API. Without it, `prepare` and `commit` are refused, and the guard refuses every merge once authority exists. Authority history is read from a dedicated per-domain file, so lease traffic never grows it. Only rules from active rulesets with no bypass actors count (`bypass_actors: []`, `current_user_can_bypass: "never"`). | `security.test.mjs` "review of af184254" |
| `uasco/registry-probe*` reused as the live store | The PROBE keyring loader refuses any non-`probe-` domain. The live domain uses only the canonical keyring and the `uasco/registry` branch. | `probe-scenario.mjs` |

## Live cutover runbook

1. Merge this change through the normal path: CLAUDE_REVIEWER review, required CI, and Founder approval. It is not a single V4.1 task, so `autonomy.mjs` returns FOUNDER_REQUIRED.
2. V2 session: `node automation/factory-v2/cli.mjs bridge snapshot --to <v2 session id> --out m.json`, then `bridge prepare --manifest m.json --gates gates.json` (gate evidence: review id, CI run, Founder decision id, this test run).
3. V4.1 session: stop new dispatch and merges (it checks `v41MayDispatch()`), then write `drain.json` with a disposition per in-flight task, `builderSessionsStopped` and `implementerSessions`. Then run `bridge ack --manifest m.json --drain drain.json`.
4. V2 session: `bridge commit --manifest m.json --session <v2 session id>`, then start `FactorySupervisor` in LIVE mode with `createRemoteLeaseStore` and `authority: (s, e) => bridge.assertV2(s, e)`, and apply the plan.
5. Spawn 8 Builder sessions and up to 4 Reviewer sessions from the spawn intents (`create_session`, tags `uasco-factory-v2`, `slot:*`), bind their real session ids, and verify overlap with `list_sessions` (A18).
6. Rollback: `bridge rollback --reason ...`. V2 is revoked on its next tick and V4.1 resumes from `STATE.json`.

## Blockers (exact)

The authoritative and current list is [`CUTOVER-ACCEPTANCE.md`](CUTOVER-ACCEPTANCE.md). It covers the signed handover conditions and the Founder's single-control-session model, with the status and evidence for each.

The earlier `refs/uasco/*` HTTP 403 blocker is resolved: the shared registry lives on the ruleset-protected branch `uasco/registry` (see `PROTECTED-REGISTRY-EVIDENCE.json`). The protected `server.ts` change is PR #354, and the V4.1 merge fence is PR #355.

V4.1 ownership is preserved. No live authority record or task lease exists on origin; only `probe/` sections do.

## Commands

```bash
node automation/factory-v2/cli.mjs plan          # read-only 8-way plan over the canonical backlog, live-owned tasks excluded
node automation/factory-v2/cli.mjs evidence --out /tmp/e.json   # SHADOW run with real processes in a temp repo
npx vitest run tests/factory-v2
```
