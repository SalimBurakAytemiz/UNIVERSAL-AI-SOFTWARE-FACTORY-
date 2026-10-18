# Merge-Gate Fix — why PR #9 merged with Windows CI unfinished, and the fix

**Status:** prepared (code + spec). The code change (`scripts/configure-integration-branch-protection.mjs`) is non-protected and reviewable here; **applying** branch protection is a Local/admin `gh api` action (flagged). The Windows-timeout remedy touches sealed `config/validation.json` + the sharding guard → **Local re-seal + governance** (not applied here).

## 1. Root cause (verified)
- The only protection helper, `scripts/configure-github-protection.mjs`, protects **`main`** with `required_status_checks: null` and `enforce_admins: false`. It never touches **`v7/integration`** — the branch PRs actually merge into.
- Therefore `v7/integration` has **no required-status-check gate**: a merge can be performed while `validate (ubuntu-latest)` / `validate (windows-latest)` are **pending, failed, cancelled, or missing**.
- Evidence: PR #9 (`6db12a5`) merged at **04:38:25Z** while `windows-latest validate` was still running (it started 04:31, finished **04:43:21 → failure**: a 600 s tests-step timeout). Ubuntu had gone green at 04:37; the merge took ubuntu-green as sufficient. Nothing blocked it.

## 2. Fix — gate `v7/integration` on required CI (prepared)
`scripts/configure-integration-branch-protection.mjs` (new, non-protected) sets, for `v7/integration`:
- `required_status_checks: { strict: true, contexts: ["validate (ubuntu-latest)", "validate (windows-latest)"] }` — **both** platform checks must be **success** on the PR head before merge; pending/failed/cancelled/missing ⇒ merge blocked.
- `strict: true` — the PR branch must be **up to date with base**; a new base commit (or a new head SHA) requires the checks to be green **again on the current SHA**, so **stale green evidence is invalidated when the SHA changes** (your "SHA değişince eski kanıt geçersiz" requirement, enforced natively).
- `enforce_admins: true` — even an admin/maintainer **cannot** merge while a required check is not green → the PR-#9 class of premature merge becomes **impossible**.
- `required_pull_request_reviews.dismiss_stale_reviews: true` — a new push **dismisses** prior approvals, so old review evidence does not carry to a new SHA.
- Force-push and deletion stay disabled; no test, timeout, or security rule is weakened — this only **adds** a gate.

**Apply (Local/admin, private origin + authenticated `gh`):**
```
UASCO_INTEGRATION_BRANCH=v7/integration node scripts/configure-integration-branch-protection.mjs
# writes .ai/runtime/INTEGRATION_BRANCH_PROTECTION.json; status PASS when configured
```
If `gh`/admin is unavailable it reports `LOCAL_ONLY` and the coded gate `merge-via-gate.mjs` (Local) remains the enforcer — which must itself refuse to merge unless both required checks are `success` on the exact head SHA. **Do not grant Cloud this admin/re-seal authority.**

## 3. Verification (how to prove merge is impossible when checks aren't green)
After applying, confirm with:
```
gh api repos/<owner>/<repo>/branches/v7%2Fintegration/protection \
  --jq '{strict:.required_status_checks.strict, contexts:.required_status_checks.contexts, admins:.enforce_admins.enabled}'
```
Expect `strict:true`, both `validate (...)` contexts, `admins:true`. Then an attempted merge with a pending/failed check returns HTTP 405 "required status checks" — i.e. impossible. (`scripts/verify-remote-protection.mjs` — a protected, existing verifier — should be extended under governance to assert these integration-branch invariants too.)

## 4. Windows 600 s timeout — analysis + guard-consistent remedy (NOT applied; sealed + governance)
- Cause: the single `tests` step runs the whole v7 vitest suite; on the slower Windows runner it exceeds the fixed **600 s per-step cap** (`run-validation.mjs`, guarded unchanged by `tests/pkg-vs-validation-sharding.test.ts`), and `run-validation.mjs` kills it (`VALIDATION_STEP_TIMEOUT durationMs=600155`). Ubuntu finishes in time; Windows does not. The suite grows every package, so this will recur and worsen.
- **Do not** raise the 600 s cap (guarded control) or drop/skip tests. Two guard-consistent options, both requiring a change to the sealed `config/validation.json` + the sharding guard assertions + a **maintainer re-seal**:
  1. **Split the `tests` step into time-budgeted shards** (e.g. `tests-heavy` for the long suites — `v7-b3a-runner`, `v7-ps1a`, `v7-relfx-c4`, `v7-b10a` — and `tests` for the rest), each well under 600 s on Windows. The sharding guard currently *requires a single `tests` step for v7 files*; it must be updated to allow the named split while still asserting every `tests/v7-*.test.ts` runs in exactly one vitest step (no coverage loss). This is an EXPLICIT_GOVERNANCE_CHANGE.
  2. Keep one step but reduce the heaviest suites' runtime (fixture/timeout tuning) so the Windows total stays < 600 s. Lower blast radius, but fragile as the suite grows.
- Recommendation: option 1 (durable). Prepare the guard update + shard split as its own reviewed, re-sealed PR.
