<!-- //TR: Bu dosya bir TALEPTIR, yetki kaydi DEGILDIR; hicbir yetki vermez. FA-LEASE2 icin Founder'dan istenecek karari, korunan dosya kapsamini ve merge yolunu tarif eder; onay, founderAuthorization JSON'u veya verilmis yetki icermez. -->

# REQUEST: FA-LEASE2 (not an authority record; grants nothing)

**Status: OPEN REQUEST. Nothing in this file is granted, approved or applied.**

This directory otherwise holds only Founder decision records (`D-…`, `FD-…`). This file is not one of them.
It asks the Founder for a decision. It records no approval, contains no `founderAuthorization` data, and
nobody may cite it as `authorizedBy`. A grant exists only when the Founder issues it through a channel an
agent cannot produce (see `FD-2026-10-19-MAX-CLOUD-PRODUCTION.md`, "The record proves nothing on its own").
All agents share one GitHub identity, so an agent-written "approval" proves nothing.

This request supersedes the request content of PR #11 (`claude/autonomy-recovery-prep`, head `c4fcb8f`):
`docs/autonomy/FA-LEASE2-AUTHORIZATION-REQUEST.md` and `docs/autonomy/FA-LEASE2-CHANGE-SCOPE.md`, merged and
refreshed here. Everything else in #11 is not carried over. That includes its
`FA-LEASE2-AUTHORIZATION.DRAFT.json`, whose captured "approval" has no evidential value.

Line anchors below are against `origin/v7/integration @ 1d34db7`. They were re-verified on 2026-10-20. All
nine lease and target modules are blob-identical between `e12dbdd` (where #11 anchored them) and this base:

| File | Blob (e12dbdd = base) | Lines |
|---|---|---|
| `automation/lib/orchestrator-engine.mjs` | `03b5867fd4` | 202 |
| `automation/lib/orchestrator-state.mjs` | `fdb6773d55` | 66 |
| `automation/lib/orchestrator-executors.mjs` | `062b34dfb9` | 215 |
| `automation/lib/review-pipeline.mjs` | `5ec9b01554` | 147 |
| `automation/lib/review-quorum.mjs` | `5c1462b583` | 70 |
| `config/execution-backends.json` | `aaa9c4ac08` | 78 |
| `automation/lib/task-lease.mjs` | `b67321b6e4` | 35 |
| `automation/lib/task-lease-git-store.mjs` | `85334b2999` | 33 |
| `automation/lib/lease-verdict.mjs` | `2554166969` | 16 |

`config/validation.json` (`2e1e5efb9c` → `ce17a50dfe`) and `config/trust-root-manifest.json`
(`2243551624` → `cff748e7f2`) **have changed** since `e12dbdd`. Their edits must be prepared against the
base current at wiring time, not against any anchor in this file.

## 1. Backlog facts (canonical `docs/planning/BACKLOG_CHECKPOINT.json` on the base)

- `pkg-lease1-wiring`: `status: BLOCKED`, `owner: FOUNDER`, `requiresNewAuthority: true`, `riskLevel: 4`,
  `dependsOn: ["pkg-lease1"]`. It has no `authorizedBy` field, so it is effectively `authorizedBy = null`.
  It is not READY and no agent may start it.
- `pkg-lease1` (FA-LEASE1, PR #10 → `e12dbdd`) delivered the **mechanism only**: `task-lease.mjs`,
  `task-lease-git-store.mjs`, `lease-verdict.mjs` and `tests/uasco-atomic-lease.test.ts`. Nothing wires it
  in, and the remote store (live `refs/uasco/claims/*`) is not activated.
- **D-2026-10-19-A is not FA-LEASE2-equivalent.** It covers only independent, renderer-only, non-protected
  UI tasks. Their ownership is the temporary create-only branch-ref claim of `docs/planning/dispatch.mjs
  --claim`. The backlog `_doc` says verbatim that this is "not FA-LEASE2-equivalent; FA-LEASE2/refs/uasco
  stay unwired". The decision also excludes every protected file, the trust root and any authority
  expansion. It cannot be stretched to cover this work.
- The backlog notes also list items to settle at wiring time: epoch fencing on a same-owner re-claim, and
  taking the implementer/`SAME_IDENTITY` session id from supervisor-owned state, never self-reported.

## 2. Why a second authority (FA-LEASE1 is not enough)

FA-LEASE1 authorized **creating** inert modules. FA-LEASE2 would **edit the protected orchestrator core** so
that it acquires, renews and releases per-task leases and enforces the verdict guard. That changes how task
ownership works at runtime, so it needs its own Founder decision.

Current model (verified on the base): a **single global-worker** lease in `orchestrator-state.mjs`
(`acquireLease`/`heartbeat`/`releaseLease`, lines 60–66, validated at line 23). It works on one machine and
one filesystem, and covers the whole orchestrator, not individual tasks. It cannot arbitrate per-task
ownership across Cloud and Local.

The per-task lease is **additive**. The global-worker lease is not removed or changed.

## 3. Exact protected files the wiring would touch

Every file below is protected. `config/protected-paths.json` covers the prefixes `automation/lib/` (line 144)
and `config/` (line 156), with `governanceChangeMode: EXPLICIT_GOVERNANCE_CHANGE_ONLY` and
`normalBuilderMayModifyProtectedPaths: false`. The merge-gate floor in rule e covers the same prefixes.

| # | File | Kind of change |
|---|---|---|
| 1 | `automation/lib/orchestrator-engine.mjs` | claim/renew/release around dispatch; skip held targets |
| 2 | `automation/lib/orchestrator-state.mjs` | validate `control.packages[id].claim`; token-free log entries |
| 3 | `automation/lib/orchestrator-executors.mjs` | lease around `builderRound`; verdict guard in CLEAN evidence |
| 4 | `automation/lib/review-pipeline.mjs` | session-id pair + taskId + reviewedSha binding |
| 5 | `automation/lib/review-quorum.mjs` | CLEAN requires bound headSha == current head |
| 6 | `config/execution-backends.json` | declarative `lease` block and `verdictBinding` |
| 7 | `config/validation.json` | **limited**: register the new wiring test files in the existing test steps only |
| 8 | `config/trust-root-manifest.json` | **one reseal**: only the sha256 entries of files 1–7, plus `generatedAt` |

**Differences from #11 (stated explicitly):**

- #11 listed only files 1–6. Its claim that "`tests/` … stay modifiable by the normal builder" is true for
  the test files themselves, but `config/validation.json` lists test files explicitly (for example
  `tests/uasco-atomic-lease.test.ts` at line 316). New wiring tests therefore run in canonical validation
  only once they are registered there, which is a protected edit. File 7 is added for that reason, limited
  to adding entries: no step removed, reordered, weakened or re-grouped.
- #11 mentioned the manifest only as an exclusion ("except the Local re-seal"). Here it is named as file 8,
  limited to one reseal.
- #11 cited `docs/autonomy/reference/*` (the `selectNext` reference engine and proofs),
  `docs/autonomy/MERGE-GATE-FIX.md` and `scripts/merge-via-gate.mjs`. **None of these exist on the base.**
  The proof figures #11 quotes (65/65, 19/19, 18/18) are not re-verified here and are not evidence. The live
  merge gate is `docs/planning/merge-gate.mjs` (section 6).
- All other anchors from #11 are confirmed unchanged on the base (section 4).

## 4. Line-anchored change scope (re-verified on the base)

### 4.1 `automation/lib/orchestrator-engine.mjs`
- **Claim:** in `runTick` (line 186), line 194 sets `target.inFlight={action,workerId,…}`. Before
  dispatching, call `claim(leaseStore,{taskId:a.packageId??a.releaseKey, environment, workerId, sessionId,
  headSha, now, ttlMs})`. `GRANTED` → proceed. `HELD` → skip this target and continue the tick, never
  double-dispatch. Add `leaseStore` to the `runTick` parameters.
- **Renewal:** in the loop at lines 191–200, call `renew()` while an action is in flight. On `LOST`, stop
  advancing that target and never apply a stale outcome.
- **Release:** in the terminal transitions of `applyOutcome` (lines 79–84) and in `founder()` (line 59),
  release the lease on `CLOSED`/`MERGED`, on a Founder-decision terminal, and on hand-off.
- **Selection:** in `nextAction` (lines 30–55), skip targets that another environment holds, so an
  `AWAITING_LOCAL` hand-off never blocks an independent READY task.
- **Unchanged:** the Global-Stop path (lines 188, 192, 196), the hash-chained persist and the planner
  semantics.

### 4.2 `automation/lib/orchestrator-state.mjs`
- **`validateControl`** (lines 11–25): add optional `control.packages[id].claim` validation via
  `isValidLeaseRecord`. A malformed record → `CONTROL_INVALID:PACKAGE_CLAIM:<id>`, fail-closed. Leave
  line 23 as it is.
- **`commitTransition`** (line 32): log only the `taskId`/`epoch`/`expiresAt` of a lease event, **never the
  token**.
- **Unchanged:** `acquireLease`/`heartbeat`/`releaseLease` (lines 60–66), the log verifier and
  `recoverInFlight`.

### 4.3 `automation/lib/orchestrator-executors.mjs`
- **`builderRound`** (lines 171–213): claim → periodic renew → release, and pin `newHead` (line 204). On
  `LOST`, abort **before** the commit step (`git.addPaths` / commit at line 203), fail-closed.
- **`verifyCleanEvidence`** (lines 87–88): also call `verifyVerdict(…)` from `lease-verdict.mjs`.
  `STALE_SHA`/`NOT_INDEPENDENT`/`SAME_IDENTITY`/`TASK_MISMATCH` → a specific denial reason, in addition to
  the existing bundle-digest binding.
- **`claudeOnlyExecutionMergeDenial`** (lines 24–35): add an explicit `reviewerSessionId !==
  implementerSessionId` check on top of the existing checks (lines 30–32). Keep every existing denial.
- **Reseal path** (line 199): `scripts/generate-trust-root.mjs` runs only inside the `LOCAL_CLAUDE` builder
  round, when a sealed protected file is touched. Neither this path nor its condition changes.
- **Unchanged:** the FF-only merge (`git.updateRefFF`, line 106).

### 4.4 `automation/lib/review-pipeline.mjs`
- The reviewer record (line 75) and `governReviewText` (lines 101–111) gain the implementer/reviewer
  session-id pair, plus taskId and reviewedSha binding. This sits next to the existing provider-separation
  checks (lines 108–109).
- **`rederiveGovernedFromEvidence`** (lines 113–120): re-derive that binding from persisted evidence and
  fail-closed on a mismatch.

### 4.5 `automation/lib/review-quorum.mjs`
- **`reviewSatisfiesGate`** (line 25) / **`currentGate`** (line 30): add a precondition that the CLEAN's
  bound `headSha` equals the current `p.reviewCommit`. This is additive and creates no new CLEAN path.
  `computeReviewAggregate`, `honouredBlockers` and `aggregateFindings` stay unchanged.

### 4.6 `config/execution-backends.json`
- Add a top-level `lease` block: `{store:"GIT_REF", refNamespace:"refs/uasco/claims/", ttlMs,
  heartbeatIntervalMs, remoteStore:{status:"NOT_ACTIVATED", activationRequiresFounder:true}}`.
- Extend `pipeline` (lines 72–77) with a declarative `verdictBinding`.
- **Unchanged:** `mayMutateDefaultBranch:false`, `dispatch.status:NOT_CONFIGURED`,
  `producerMayReviewOwnOutput:false` (line 75) and `mergeRequiresGovernedResult:"CLEAN"` (line 76).

### 4.7 `config/validation.json` (limited)
- Only add the new `tests/…` wiring test paths to the existing test step lists. Nothing else.

### 4.8 `config/trust-root-manifest.json` (single reseal)
- One reseal with `scripts/generate-trust-root.mjs`. The resulting diff may contain only the hash entries
  of files 1–7 and `generatedAt`. Any other manifest change voids the reseal.

## 5. Invariants and security impact

- **No new authority, no weakening.** Every change adds a fail-closed path (`HELD`, `LOST`, `STALE_SHA`,
  `NOT_INDEPENDENT`, `SAME_IDENTITY`, `TASK_MISMATCH`) or additive state. No test, validation step, policy
  or gate is removed or weakened.
- **Token confidentiality.** The lease token never enters the transition log, the review bundle or any
  committed evidence. A test asserts this.
- **Reseal stays outside Cloud.** No change moves the reseal to the Cloud backend.
- **Remote store excluded.** The code ships with `remoteStore.status:"NOT_ACTIVATED"`. Live
  `refs/uasco/claims/*` on origin stays out of scope (open question 3).
- **Required wiring tests** (under `tests/`): claim-before-dispatch, renew-on-tick, release-on-terminal,
  HELD-skip-advances, LOST-aborts-before-commit, verdict rejections and token-not-in-log. The existing
  `tests/uasco-atomic-lease.test.ts` must stay green. Full `node scripts/run-validation.mjs` must pass on
  both CI platforms. A fresh isolated governed CLAUDE_REVIEWER review must run on the exact commit and
  bundle digest.
- **Rollout** (from the backlog notes): wiring PR → independent review → reseal → merge → dark launch
  (log-only) → enforce.

## 6. Merge path

- Every change to `v7/integration` merges only on a merge-gate **MERGE** verdict from
  `docs/planning/merge-gate.mjs` (see `docs/planning/MERGE_GATE.md`).
- **An agent can never merge protected-path changes.** `MERGE_GATE.md` rule e blocks any diff that touches
  a protected path (floor: `automation/lib/`, `config/`, …): "There is no authority-record bypass." An
  FA-LEASE2 grant therefore does **not** let any agent merge the wiring PR. **The Founder performs that
  merge personally.**
- **Ordering:** the wiring PR follows PR #69 (CI-PARALLEL). #69 also modifies `config/validation.json` and
  `config/trust-root-manifest.json` (plus `config/protected-paths.json`, `.github/workflows/ci.yml` and
  `scripts/run-validation.mjs`). The wiring PR rebases on whatever #69 leaves and reseals once, after that.
- This request PR itself is docs-only, touches no protected path, and grants nothing.

## 7. Exact Founder decision text (proposed; NOT issued)

The Founder may issue the following sentence, verbatim, through a channel an agent cannot produce. Until
then it has no effect:

> "I grant FA-LEASE2 solely to prepare a change wiring the merged per-task lease into
> `automation/lib/orchestrator-engine.mjs`, `automation/lib/orchestrator-state.mjs`,
> `automation/lib/orchestrator-executors.mjs`, `automation/lib/review-pipeline.mjs`,
> `automation/lib/review-quorum.mjs` and `config/execution-backends.json`, with limited edits to
> `config/validation.json` that only register the new wiring tests, and a single trust-root reseal of
> `config/trust-root-manifest.json` limited to those files' hashes plus `generatedAt`, as specified in
> `docs/planning/authority/REQUEST-FA-LEASE2-2026-10-20.md`; this grants no merge authority, no remote-store
> activation and no other protected-file change."

## 8. Open questions for the Founder

1. **Who reseals?** A Local maintainer on the Windows machine, or a separate maintainer session distinct
   from the implementer and the reviewer? The implementer session must not reseal its own change.
2. **Ordering.** Confirm that the wiring PR waits for #69 (CI-PARALLEL) to merge or close. Confirm how it
   is serialized against `RESEAL-SERIALIZATION` (backlog: `BLOCKED`, owner `LOCAL`, the structural
   one-reseal-per-cycle bottleneck on `config/validation.json`), and against any other open sealed-line PR.
3. **Remote store.** Does activating live `refs/uasco/claims/*` on origin stay excluded from FA-LEASE2 and
   become a separate Founder decision after the dark launch? This request assumes yes.
