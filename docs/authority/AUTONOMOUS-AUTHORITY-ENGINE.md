<!-- //TR: Autonomous Authority Engine tasarimi, mevcut mekanizmalarla entegrasyonu, otomatik yetkilenen ve politika ile reddedilen siniflar, guven modeli, test kaniti ve DURUST hazirlik durumu (AUTONOMOUS_READY = false; uctan uca zincir NOT_VERIFIED) ve tek seferlik on kosullar. -->

# Autonomous Authority Engine (AAE)

**Founder decision:** FD-AUTONOMY-2026-10-19, "UASCO MASTER V2: Autonomous Authority, Zero Routine Approval & Governed Execution".
**Status:** `AUTONOMOUS_READY = false`. The engine and its tests exist. The genesis policy is **not sealed**, so every request is `BLOCKED_BY_POLICY:POLICY_NOT_SEALED`. The end-to-end chain is **NOT_VERIFIED** (see "Readiness").

## What it is
`core/authority/autonomous-authority.mjs`, with types in `.d.mts`, is the **single** policy decision point. It sits next to the existing `core/authority/approval.ts`. Every role uses the same code: Builder, Reviewer, Maintainer, Supervisor, Dispatcher, Cloud routine, Desktop/control-api and the merge gate. Pure functions:

| Function | Purpose |
|---|---|
| `decide(request, ctx)` | `AUTO_AUTHORIZED_BY_POLICY` or `BLOCKED_BY_POLICY` with concrete reasons, bound to class/repo/branch/base/task/headSha/principal/files by `requestDigest` |
| `verifyDecision(decision, request, ctx)` | **Recomputes** the decision from the sealed policy the verifier itself loaded. A decision object received from another session is never trusted, because a digest is not a signature |
| `evaluateProtectedChange(...)` | Structural checks for the two narrow protected classes: `TEST_REGISTRATION_APPEND` and `TRUST_ROOT_RESEAL`, the latter recomputing hashes from the real file bytes. `decide`/`evaluateMerge` never accept decision objects: they take the **inputs** (`protectedChanges`: class, file, base/head text read from git at the evaluated SHA) and recompute. A reseal can only cover narrow-class targets that were themselves recomputed as AUTO |
| `evaluateMerge(evidence, ctx)` | All merge conditions at once; any missing condition gives `BLOCKED` |
| `evaluateRequiredChecks(...)` | One canonical "both CI contexts success on this SHA from the pinned app" check |
| `loadSealedPolicy` / `policySealStatus` | The policy counts only if `config/autonomous-authority-policy.json` is listed in the SEALED trust-root manifest with matching bytes |
| `toCockpitRecord` | Read-only record for the Founder Cockpit / Approval Center: `AUTO_AUTHORIZED` instead of an approve button, `BLOCKED` with real reasons |

## Reused, not rewritten
| Concern | Existing code the engine uses |
|---|---|
| Founder approval records | `core/authority/approval.ts` `assertApprovalValid`: trusted approver id, action/target digest, expiry, revocation |
| Independent reviewer verdict | `automation/lib/lease-verdict.mjs` `verifyVerdict`: task + exact SHA + reviewer session ≠ implementer session + identity ≠ builder |
| Task ownership | `automation/lib/task-lease.mjs` lease records, an atomic git-ref claim/renew/expiry. The engine checks holder, task and expiry |
| Canonical JSON | `automation/lib/atomic-json.mjs` `stableStringify` |
| Protected paths | `config/protected-paths.json` exactPaths + protectedPrefixes (passed in; if missing, every path counts as protected) |

**Not duplicated:**
- The merge gate (#11 `merge-via-gate.mjs`) keeps ancestry, conflict and verdict-provenance resolution. On integration it calls `evaluateMerge`/`evaluateRequiredChecks` for the policy layer.
- The dispatcher (#29) keeps task selection. It asks `decide({actionClass:"NEXT_TASK_CLAIM"})` and claims through `task-lease`.
- CP-GOV (#31) stays the separate-identity verifier.

## Auto-authorized (only via a grant in the sealed policy)
The 15 routine classes are:
`REQUIREMENT_ANALYSIS`, `ARCHITECTURE_DESIGN`, `SOURCE_CHANGE`, `TEST_CHANGE`, `FAILURE_REPAIR`, `BRANCH_CREATE`, `FEATURE_BRANCH_PUSH`, `PR_UPDATE`, `REVIEW_DISPATCH`, `CI_FAILURE_REPAIR`, `EVIDENCE_ARCHIVE`, `GOVERNED_MERGE`, `NEXT_TASK_CLAIM`, `TASK_RECOVERY`, `STATUS_REPORT`.

Plus two narrow protected classes: `TEST_REGISTRATION_APPEND` (pure append of new, existing test files to the last tests shard) and `TRUST_ROOT_RESEAL` (hash updates only, for authorized files, computed from the real bytes).

Each grant is limited by:
- role (BUILDER / REVIEWER / MAINTAINER / SUPERVISOR / DISPATCHER / REPORTER);
- branch pattern (`claude/*`, never `master`);
- base (`v7/integration`);
- path scope;
- `maxRisk` ≤ 3;
- a validity window, plus revocation;
- task-lease ownership for task-bound classes;
- for recovery: a bounded retry budget (≤ 5, deterministic exponential backoff) and a required checkpoint.

## Always `BLOCKED_BY_POLICY` (a policy cannot grant these; a grant that tries makes the policy invalid)
`SPEND`, `NEW_PAID_SERVICE`, `LEGAL_FINANCIAL_AUTHORITY`, `PRODUCTION_CHANGE`, `DESTRUCTIVE`, `IRREVERSIBLE`, `EXTERNAL_SYSTEM_ACCESS`, `SECRET_TRANSFER`, `POLICY_CHANGE`, `SECURITY_GATE_CHANGE`, `GITHUB_REVIEW_APPROVE`, `MASTER_CHANGE`, `FORCE_PUSH`, `BRANCH_PROTECTION_CHANGE`.

Also blocked:
- Any change touching the policy core: the policy file, `core/authority/**`, the engine's tests, `lease-verdict`, `task-lease`, `review-governance`, `merge-via-gate`, `protected-paths.json`, `action-policy.json`, `run-validation.mjs` and `.github/workflows/**`. The policy can never widen its own authority.
- A request from an agent with role `FOUNDER` or a founder identity.
- A protected path not covered by a recomputed narrow-class decision on the same SHA, for that class's single target file.
- A non-canonical path (`./x`, `a//b`, `a/./b`, `..`, backslash, leading/trailing `/` or whitespace) or an NTFS alias (a segment ending in `.` or a space, `:` streams, `~1` short names). Policy-core, protected-path and grant `paths`/`pathsDeny` matching is case-insensitive.

These go to Founder exception handling: `BLOCKED_BY_POLICY` with evidence. Independent tasks continue.

## Merge conditions (all at once, otherwise `BLOCKED`)
1. The current head equals the evaluated SHA.
2. The base is `v7/integration`, and the branch is up to date: the caller verifies with git that the base tip is an ancestor of the head (`pr.upToDate`). Unknown counts as not up to date.
3. The PR is not a draft and is mergeable.
4. Both `validate (ubuntu-latest)` and `validate (windows-latest)` from `github-actions` are completed/success on that SHA. PENDING, FAILURE, CANCELLED, missing, another app or another SHA all block.
5. `verifyVerdict` passes: CLEAN, same task and SHA, independent session and identity.
6. The merging session is not the implementer. The implementer is **bound to the atomic lease**: the expected implementer must be the lease holder, the merger must not be the lease holder, and the lease must not be expired at evaluation time. A spoofed `implementerSessionId` cannot make a self-review look independent. The implementer (or its supervisor) must keep renewing the lease heartbeat through `task-lease` until the merge; an expired lease blocks the merge, and a dead implementer is handled by `TASK_RECOVERY`, not by merging over its lease.
7. The trust root is verified.
8. Every protected path is authorized by a narrow-class decision on that SHA, and no policy-core path is touched.
9. There are no open blocking findings. Only `P2`, `P3`, `NIT` and `INFO` are non-blocking; any other or unknown severity blocks until resolved.
10. The lease is consistent with the task and head.
11. **GitHub branch protection is actually active** and requires both contexts.
12. There is no self-APPROVED review. COMMENTED never counts as approval, and bots never approve.
13. The merge itself is a `GOVERNED_MERGE` request that `decide` authorizes (role, grant, path scope) for the same SHA, branch, base, task, merging session and file list.

## Trust model (honest)
- **Authority comes from bytes in the trust root, not from chat.** Every session loads the sealed policy itself and recomputes the decision. This fixes the PR #49 stall, where a maintainer correctly refused authority relayed as a peer message: it can now verify a narrow-class change on its own.
- **Caller-supplied facts:** the engine is pure and does no I/O. `changedFiles`, `riskLevel`, CI check runs, branch protection, `upToDate` and the base/head texts are facts the calling session must read itself from git and the GitHub API, never from another session's message. `decide` cannot detect a caller that lies about its own inputs; that is why every consumer recomputes and the merge gate gathers its own evidence.
- **Gaps:**
  - The trust root is a SHA-256 manifest guarded by protected-path rules, independent review and CI. It is **not** a cryptographic Founder signature. CP-GOV phase 1 (KMS/genesis key) is still open.
  - All sessions share one GitHub identity, so GitHub cannot enforce a distinct approver. Independence is enforced at session/identity level by `verifyVerdict`, and by branch protection once it is applied.

## Readiness: real state
| Prerequisite | State |
|---|---|
| Engine + types + 28 tests (24 AAE scenarios incl. the 18 required + 4 existing), mutation-checked (13 targeted mutants after review a3d7eea: 12 killed; the survivor is a redundant class→target guard already enforced in `evaluateProtectedChange`) | DONE in this PR (Linux local). The Windows run comes with CI |
| Genesis: seal `config/autonomous-authority-policy.json` (= `docs/authority/autonomous-authority-policy.proposed.json`) in the trust root | **Needs one Founder genesis act**: a protected config file + manifest reseal by a separate maintainer, typed by the Founder in that maintainer session. This is the last manual approval; afterwards the narrow classes self-serve |
| Add the engine files to `config/protected-paths.json` exactPaths | Same genesis reseal |
| PR #49 (sharded CI) merged; this branch rebased by merge | Pending (#49 waits on the record-B maintainer step) |
| GitHub branch protection / ruleset on `v7/integration` with both contexts (the proposed ruleset has `strict: false`; the engine enforces up-to-date itself) | **Founder/admin action.** This session's GitHub integration cannot write protection (403). Until it exists, every auto-merge is `BLOCKED_BY_POLICY:BRANCH_PROTECTION_NOT_ACTIVE`, by design |
| Wiring: merge gate (#11), dispatcher (#29), supervisor, control-api `GET /v1/authority/decisions` + Cockpit view | After #49/#11/#29 merge. The control-api route and the desktop GET allow-list are protected (`server.ts`, `main.mjs`) |
| End-to-end chain (Founder-authorized task → policy decision → builder → independent reviewer → real CI → safe merge → next task) | **NOT_VERIFIED**. It cannot run before genesis + branch protection + #49 |
