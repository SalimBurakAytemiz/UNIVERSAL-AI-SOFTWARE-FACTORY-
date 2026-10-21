<!-- //TR: Bu belge Founder'in bir ozellik kapsamini TEK SEFERDE onaylamasini (scope grant) ve bu kapsamin icinde Coordinator'in her PR icin ayri Founder onayi olmadan neleri yapabilecegini tanimlayan bir YONETISIM ONERISIDIR; hicbir kapiyi gevsetmez, Founder merge edene kadar etkisizdir. -->
# Coordinator scope grants (PROPOSAL)

**Status:** PROPOSED. It changes no enforcement: not `config/protected-paths.json`, workflows, rulesets, CODEOWNERS, the review gate, secrets or the trust root. It takes effect only when the Founder merges it. Even then no grant is active until a second Founder-merged change sets one to `ACTIVE`.

**Founder request (2026-10-21):** fewer needless Founder approvals in normal product development; API/UI integrations inside a pre-approved feature scope managed by the Coordinator; out-of-scope changes to protected files still need separate approval; the control token, tenant isolation, Global Stop, audit records, secret protection, trust-root verification and required CI tests are not removed.

## The rule

The Founder approves a feature scope **once**, as a scope grant in `docs/authority-grants/<GRANT-ID>.json`. A grant only **records a statement the Founder made** (quote, date, channel). The Coordinator and builders never write, infer or extend an approval. A grant is usable only while `status` is `ACTIVE` and `now <= expiresAt`.

## Inside an ACTIVE grant, without per-PR Founder approval

1. Apply exactly the listed protected-file changes (`scope.protectedFiles`, each with its `allowedChange`) on an authority branch.
2. Reseal the trust root only for those files (`allowTrustRootReseal: true`), using the existing `scripts/generate-trust-root.mjs`. The manifest diff may add, remove or change only entries of listed files; `generatedAt` may change.
3. Open the PR (subject to the capacity rule below), drive CI, and remediate review findings, all inside the grant.

## Founder-only, always

- **Merge.** Until the Independent Review App check (UASCO Independent Review) is a required check and passing on GitHub, there is no auto-merge; the Founder merges.
- Any protected change outside the grant: an unlisted file, or a change beyond its `allowedChange`.
- The never-delegable paths below.
- Ruleset, permission, secret or workflow changes.
- Production, payment or risk-5 actions.
- Weakening any gate: control token, tenant isolation, Global Stop, audit, secret protection, trust-root verification, required CI tests.

## Never-delegable paths (a violation even if a grant lists them)

`config/protected-paths.json`; `config/trust-root-manifest.json` unless `allowTrustRootReseal` is `true`; everything under `.github/`; `CODEOWNERS`, `docs/CODEOWNERS`, `.github/CODEOWNERS`; `scripts/ci/uasco-review/**`; `scripts/generate-trust-root.mjs`; `scripts/verify-trust-root.mjs`; `config/environment-policy.json`; `config/builder-execution-policy.json`; this file; `docs/authority-grants/**` (a grant cannot edit grants).

## What stays unchanged

Control token, tenant isolation, Global Stop, audit records, secret protection, trust-root verification (`verify-trust-root` must pass on every PR) and the required CI tests are not touched by this proposal and cannot be touched by any grant. Global Stop overrides every grant.

## Expiry and revocation

- **Expiry.** A grant ends at `expiresAt` (UTC). After that the check reports `GRANT_EXPIRED`. There is no auto-renewal; extending needs a new Founder statement in a Founder-merged change.
- **Revocation.** The Founder revokes by saying so in the session or by merging a change that sets `status` to `REVOKED`. The Coordinator stops new protected changes at once and holds open PRs for ordinary Founder review. Anything already merged stays; revocation does not rewrite history.
- Any status other than `ACTIVE` (`PROPOSED`, `REVOKED`, `EXPIRED`) reports `GRANT_NOT_ACTIVE`.

## PR capacity

At the open-PR capacity limit, work continues **branch-only** with tests and commits; the PR opens when a slot frees. Capacity never justifies an early merge, bundling out-of-scope changes, or skipping a gate.

## Mechanical check

```
node scripts/check-scope-grant.mjs <grant.json> <baseRef> <headRef> [--assume-active-for-dry-run]
```

Prints `SCOPE_GRANT_CHECK: PASS` (exit 0) or `SCOPE_GRANT_CHECK: FAIL <codes>` (exit 1). The pure evaluator is `evaluateScopeGrant` in `core/authority/scope-grant.mjs`. Fixed codes:

| Code | Meaning |
| --- | --- |
| `GRANT_INVALID` | malformed grant, policy, file list, manifest or clock |
| `GRANT_NOT_ACTIVE` / `GRANT_EXPIRED` | status is not `ACTIVE` / `now > expiresAt` |
| `PROTECTED_CHANGE_OUTSIDE_GRANT` | a protected file changed that the grant does not list |
| `NEVER_DELEGABLE_PATH` | a never-delegable path changed or is listed |
| `RESEAL_OUTSIDE_GRANT` | a manifest entry for a non-granted file changed |

Notes: the protected policy is read from `<baseRef>` (a PR cannot shrink its own protected set); run the check with the grant as merged on the base branch, never with a grant file from the PR under check; renames list both paths. A `PROPOSED` grant fails unless `--assume-active-for-dry-run` is passed; a dry run is evidence for the Founder and **not** an authorization.

Limits, stated honestly: the check validates scope, not hashes (`verify-trust-root` still checks them). It is **not** wired into CI, because that needs a `.github/` change, which is Founder-only. The evaluator sits in `core/authority/` because `automation/lib/` is a protected prefix, so a new file there would need a trust-root reseal. Until the Founder approves wiring or promotion, the Coordinator runs it as a pre-flight and pastes the output into the PR.

## First example grant: FIRST-DELIVERY-WIRING (PROPOSED)

`docs/authority-grants/FIRST-DELIVERY-WIRING.json` records the Founder's 2026-10-21 statement approving, in principle, the first-delivery integration of `docs/authority-requests/COORD-FIRST-DELIVERY-WIRING.md`.

| Protected file | Allowed change |
| --- | --- |
| `apps/control-api/src/server.ts` | register intake, plan, flow and task route modules with the existing deps |
| `apps/desktop/main.mjs` | exact anchored GET/POST allow-list entries for the first-delivery paths in the B4/B5 blocks |

Trust-root reseal is allowed for those two entries only. Expires `2026-11-21T00:00:00Z`.

## Founder steps to adopt

1. Merge this proposal. The rule exists; no grant is active.
2. To use the example grant, merge a change that sets its `status` to `ACTIVE`.
3. Optionally approve a follow-up that wires the check into CI.
