<!-- //TR: Local Windows maintainer'a acikca devredilen gorevler: branch protection uygulama, CI/supply-chain dogrulamasi, trust-root re-seal ve FA-LEASE2 yetki kaydinin olusturulmasi. Cloud bu islemleri YAPMAZ; bu dosya devir ve kesin komut referansidir. -->

# Local maintainer — delegated tasks (Cloud does NOT perform these)

Per the standing authority boundary, the following are **explicitly delegated to the Local Windows maintainer**
(and, for authority records, the Founder). Cloud prepares code and PRs only; it is **not** granted admin,
re-seal, or merge authority. Each task below names the exact artifact and command.

## D1 — Apply the integration-branch merge gate (Priority 1)
**Why:** `v7/integration` currently has no required-status-check gate; PR #9 merged while Windows CI was still
running. The fix script is prepared and non-protected; **applying** it needs an admin `gh` token (Cloud has none).

```
# Local, authenticated gh with admin on the private repo:
UASCO_INTEGRATION_BRANCH=v7/integration node scripts/configure-integration-branch-protection.mjs
# Expect: .ai/runtime/INTEGRATION_BRANCH_PROTECTION.json status = PASS
# Verify:
gh api repos/<owner>/<repo>/branches/v7%2Fintegration/protection \
  --jq '{strict:.required_status_checks.strict, contexts:.required_status_checks.contexts, admins:.enforce_admins.enabled}'
# Expect: strict:true, contexts:["validate (ubuntu-latest)","validate (windows-latest)"], admins:true
```
If `gh`/admin is unavailable, the branch stays `LOCAL_ONLY` and the coded gate `merge-via-gate.mjs` remains
the enforcer — it must refuse to merge unless both required checks are `success` on the exact head SHA.

## D2 — Complete CI / supply-chain validation that Cloud cannot (Priority 1/3)
**Why:** Cloud CI fails only at `DEPENDENCY_AUDIT_INVALID_RESPONSE` — `npm audit` against `registry.npmjs.org`
with network overrides denied; the cloud runner has no such egress. This is environmental, red on the base
branch too (`e12dbdd`/`55bcede`), and this bundle changes no dependency files.

```
# Local (real network):
node scripts/run-validation.mjs      # must reach PASS including dependency-supply-chain
# Windows runner: confirm validate (windows-latest) green on the head SHA, no 600s VALIDATION_STEP_TIMEOUT
```
For PR #11 (docs-only prep bundle) this is the only remaining red; everything else passes. For the future
FA-LEASE2 wiring PR, run the full suite on both platforms behind the D1 gate.

## D3 — Create the FA-LEASE2 Founder authority record (Priority 2) — governance
**Why:** The builder may touch protected files **only** when a Founder authority record lists them
(`orchestrator-executors.mjs` `authorizedProtectedFiles` reads `checkpoint.founderAuthorization.protectedFiles`).
Cloud must not author its own authorization. Use the draft as the content source, decide via the existing
procedure, then commit + seal the real record.

```
# Local/Founder, existing governance procedure (as FA-LEASE1 was decided):
#  1. Review docs/autonomy/FA-LEASE2-CHANGE-SCOPE.md and FA-LEASE2-AUTHORIZATION.DRAFT.json.
#  2. Record the decision (AskUserQuestion in a Local session) as:
#       audit/checkpoints/V7-PKG-LEASE2-AUTHORIZATION-2026-10-18.json
#     mirroring V7-PKG-LEASE1-AUTHORIZATION-2026-10-18.json, with the six protectedFiles and the excludeds.
#  3. Commit it, then (when the wiring PR exists) re-seal (D4).
```
The record must exist **before** any protected-file edit. Cloud will not start wiring until it is in place.

## D4 — Trust-root re-seal after the FA-LEASE2 wiring PR (Priority 2) — maintainer-only
**Why:** Editing the six sealed protected files breaks the trust-root seal; re-sealing is maintainer-only.
**Cloud is not granted this authority.**

```
# Local maintainer only, on the FA-LEASE2 wiring PR head, after the six files are edited by the builder:
node scripts/generate-trust-root.mjs           # regenerates config/trust-root-manifest.json (SEALED)
node scripts/verify-trust-root.mjs             # expect TRUST_ROOT_VERIFY: PASS
# If the re-seal creates a new commit/SHA, refresh test + independent-review + CI evidence for the new SHA.
```

## D5 — Merge (Priority 1) — Local coded gate
Merge to `v7/integration` stays the Local coded gate (`merge-via-gate.mjs`): merge only when both required CI
checks are `success` on the exact head SHA, the governed CLAUDE_REVIEWER verdict is CLEAN and SHA-bound, and
there is no conflict. Cloud does not merge.

## What Cloud continues to do (within current authority, no new grant)
- Prepare code, tests, and PRs on feature branches (done: PR #11).
- Prepare the FA-LEASE2 wiring **after** D3 exists — on a new branch, editing only the six listed files, with
  the wiring acceptance tests under `tests/`, then hand off to D2/D4/D5.
- Never apply D1, never run D4 re-seal, never merge (D5), never create the D3 record itself.
