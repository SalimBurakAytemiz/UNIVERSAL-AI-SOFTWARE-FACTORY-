<!-- //TR: FA-LEASE2 icin alti korunan dosyanin NIHAI kesin degisiklik kapsami, fonksiyon/satir dayanaklari ve guvenlik etkileri; korunan dosyalara dokunulmaz, bu yalniz incelenebilir spesifikasyondur. Uygulama Founder yetki kaydi + Local re-seal sonrasidir. -->

# FA-LEASE2 — final change scope for the six protected files

Companion to `FA-LEASE2-AUTHORIZATION-REQUEST.md`. This is the **precise, line-anchored** change
specification, the **security impact** per file, and the **invariants** the applied change must hold. **No
protected file is edited by this branch** — this is a reviewable spec. Applying it requires the Founder
authority record (`FA-LEASE2-AUTHORIZATION.DRAFT.json`, created for real via governance by Local/Founder) and
a Local trust-root re-seal. Line numbers are against `v7/integration @ e12dbdd`.

## Design invariant: the per-task lease is ADDITIVE

The orchestrator today has a **global single-worker** lease in `orchestrator-state.mjs`
(`acquireLease`/`heartbeat`/`releaseLease`, `control.lease`, lines 60–66, validated at line 23): one
`workerId` drives one orchestrator instance. FA-LEASE2 **adds** a **per-task** lease
(`automation/lib/task-lease.mjs` over the git-ref store) answering a different question — *which environment
owns task T right now* — so Cloud and Local can run different tasks in parallel. The global-worker lease is
**not removed or changed**. Every change below only **adds** fail-closed checks or additive state.

## Per-file change scope

### 1. `automation/lib/orchestrator-engine.mjs` (202 lines)
- **Claim site — `runTick`, line 194** (where `target.inFlight={action,workerId,startedAt}` is set and
  persisted as `${a.type}_STARTED`): before dispatching the executor, call
  `claim(leaseStore,{taskId:a.packageId??a.releaseKey, environment, workerId, sessionId, headSha, now, ttlMs})`.
  `GRANTED` → proceed; `HELD` → skip this target (another environment owns it) and continue the tick (never
  double-dispatch). Add `leaseStore` to the `runTick` parameter object alongside `executors/persist/policy/workerId`.
- **Renewal — `runTick` loop (lines 191–200)**: `renew()` the active task's lease each iteration while its
  action is in flight; on `LOST` (takeover after expiry) stop advancing that target without applying a stale outcome.
- **Release — `applyOutcome` terminal transitions (lines 79–84, and `founder()` at 59)**: `release()` the
  task lease when the package/release reaches `CLOSED`/`MERGED` or a Founder-decision terminal, and on hand-off.
- **Selection — `nextAction` (lines 30–55)**: consult the task lease to skip a target already held by another
  environment, mirroring the reference `selectNext` precedence (`docs/autonomy/reference/next-step-engine.mjs`),
  so Cloud auto-advances to an independent task instead of contending.
- **Unchanged:** Global-Stop path (188, 192, 196), the hash-chained persist, provider-quota lanes, the
  dependency planner semantics.

### 2. `automation/lib/orchestrator-state.mjs` (66 lines)
- **`validateControl` (lines 11–25)**: add optional validation of `control.packages[id].claim` — when present
  it must satisfy the `isValidLeaseRecord` shape (import from `task-lease.mjs`); a malformed claim record →
  `CONTROL_INVALID:PACKAGE_CLAIM:<id>` (fail-closed). The existing `control.lease` check (line 23) is untouched.
- **`commitTransition` (lines 32–40)**: the transition event records lease claim/renew/release for a task by
  `taskId`, `epoch`, `expiresAt` **only** — never the raw `token` (token confidentiality, see Security §T).
- **Unchanged:** the global-worker `acquireLease`/`heartbeat`/`releaseLease` (60–66), the log verifier
  (`verifyTransitionLog`), `recoverInFlight`.

### 3. `automation/lib/orchestrator-executors.mjs` (215 lines)
- **`builderRound` (lines 171–213)** — the IMPLEMENT/REMEDIATE executor: wrap the builder run with
  `claim` → periodic `renew` → `release`; pin the acting head (`newHead`, line 204) into the lease record so
  the verdict guard can bind to it. On `renew` → `LOST` mid-round (another env reclaimed after expiry), abort
  **before** `git.commitAll` (line 203) — fail-closed, no commit under a lost lease.
- **`verifyCleanEvidence` (lines 87–88)**: additionally call
  `verifyVerdict(verdict,{expectedTaskId:p.id, expectedHeadSha:p.reviewCommit, implementerSessionId, builderIdentity})`
  (`automation/lib/lease-verdict.mjs`); a `STALE_SHA`/`NOT_INDEPENDENT`/`SAME_IDENTITY`/`TASK_MISMATCH` verdict
  becomes a specific `NOT_FF` reason. This is **in addition** to the existing bundle-digest binding.
- **`claudeOnlyExecutionMergeDenial` (lines 24–35)**: strengthen the independence proof with the explicit
  `reviewerSessionId !== implementerSessionId` from the lease/evidence (today it is identity + workspace +
  session-order at lines 30–32); keep all existing denials.
- **Reseal (line 199)**: `generate-trust-root.mjs` is invoked **only** here, inside the `LOCAL_CLAUDE`
  builder round, when a sealed protected file is touched. FA-LEASE2 does **not** move this to Cloud and does
  **not** change the condition — the Cloud backend cannot reach this path (Security §R).
- **Unchanged:** merge (`git.updateRefFF`, line 106) stays FF-only behind CLEAN evidence; packaging/sign/phase0.

### 4. `automation/lib/review-pipeline.mjs` (147 lines)
- **Reviewer record (line 75) + `governReviewText` (lines 101–111)**: thread `implementerSessionId` (from the
  task lease at bundle-build time) and `reviewerSessionId` (from the run manifest) into the independence
  checks, enforcing the session pair via `lease-verdict`. Today independence is identity + provider +
  workspace + session-order (lines 108–109); this adds the explicit **session-id pair + taskId + reviewedSha**
  binding.
- **`rederiveGovernedFromEvidence` (lines 113–120)**: re-derive that binding from persisted evidence and
  fail-closed on any mismatch (so a recorded CLEAN cannot be replayed against a different task or SHA).
- **Unchanged:** the provider-separation gate (108–109), schema validation, quota detection.

### 5. `automation/lib/review-quorum.mjs` (70 lines)
- **`reviewSatisfiesGate` (line 25) / `currentGate` (line 30)**: the gate already stales on `bundleDigest`/
  `cycle` (which track `reviewedCommit`, line 29 comment). Add an explicit assertion that the recorded CLEAN's
  bound `headSha` equals the current `p.reviewCommit`, so a re-based head (new SHA) voids CLEAN at the quorum
  layer too. Additive precondition — it never creates a new CLEAN path.
- **Unchanged:** `computeReviewAggregate` quorum math, `honouredBlockers`, `aggregateFindings`.

### 6. `config/execution-backends.json` (78 lines)
- Add a top-level `lease` block: `{ store:"GIT_REF", refNamespace:"refs/uasco/claims/", ttlMs, heartbeatIntervalMs,
  remoteStore:{ status:"NOT_ACTIVATED", activationRequiresFounder:true } }`.
- Extend `pipeline` (lines 72–77) with a declarative
  `verdictBinding:{ bindsTaskId:true, bindsReviewedSha:true, requiresReviewerSessionDistinctFromImplementer:true }`
  (enforcement lives in code §3/§4; this records the contract).
- **Unchanged:** `backends.CLAUDE_CLOUD_SESSION.mayMutateDefaultBranch:false`,
  `dispatch.status:NOT_CONFIGURED`, `cloudForbiddenDataClasses`, `pipeline.producerMayReviewOwnOutput:false`,
  `mergeRequiresGovernedResult:"CLEAN"`.

## Security impact

- **§A No new authority.** Every change adds a fail-closed check (`HELD`, `STALE_SHA`, `NOT_INDEPENDENT`,
  `SAME_IDENTITY`, `TASK_MISMATCH`, `LOST`) or additive state (`control.packages[id].claim`). None removes or
  weakens an existing gate, test, or validation step.
- **§T Token confidentiality.** The lease token (`${sessionId}:${epoch}:${uuid}`) must never be written to the
  hash-chained transition log, the review bundle, or any committed evidence — only `taskId`/`epoch`/`expiresAt`
  summaries. (New invariant for the applied change; enforced in §2 and asserted by a test.)
- **§R Reseal stays Local-only.** No change moves `generate-trust-root.mjs` to Cloud. The builder invokes it
  only inside the `LOCAL_CLAUDE` backend round; the `CLAUDE_CLOUD_SESSION` backend cannot reach it
  (`dispatch.status:NOT_CONFIGURED`, `mayMutateDefaultBranch:false`).
- **§M Merge boundary.** Cloud cannot mutate the default branch; merge remains the Local coded gate
  (`merge-via-gate.mjs` / executors `merge`, FF-only behind verified CLEAN evidence). FA-LEASE2 does not grant
  Cloud merge authority.
- **§X Remote store activation is excluded.** Creating live `refs/uasco/claims/*` on origin is a separate
  runtime step requiring Founder approval (as in FA-LEASE1). FA-LEASE2 authorizes only the **code**; the
  remote store stays `NOT_ACTIVATED`.

## Explicitly excluded from FA-LEASE2 (mirrors FA-LEASE1)
- Creating live `refs/uasco/claims/*` on origin (remote-store activation).
- Any merge to master/default beyond the existing coded gate; force-push; release; signing.
- Granting Cloud trust-root re-seal or merge authority.
- Editing `config/trust-root-manifest.json` except the Local re-seal.

## Validation the applied FA-LEASE2 PR must pass (pre-merge)
- New wiring tests under non-protected `tests/` (claim-before-dispatch, renew-on-tick, release-on-terminal,
  `HELD`-skip-advances, `LOST`-aborts-before-commit, verdict `STALE_SHA`/`NOT_INDEPENDENT` rejection,
  token-not-in-log) — all green; plus the existing `tests/uasco-atomic-lease.test.ts` (18/18) and the
  reference `proof.mjs` (65/65) / `loop-proof.mjs` (19/19) semantics preserved.
- Full `node scripts/run-validation.mjs` on both CI platforms behind the integration merge gate
  (`MERGE-GATE-FIX.md`), supply-chain audit completed on Local.
- Fresh isolated governed CLAUDE_REVIEWER review of the exact commit + bundle digest; Local trust-root re-seal.
