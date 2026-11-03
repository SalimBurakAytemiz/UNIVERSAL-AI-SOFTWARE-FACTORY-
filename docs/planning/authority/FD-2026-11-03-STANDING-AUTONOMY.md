<!-- //TR: Bu kayıt Founder'ın 2026-11-03 kalıcı otonomi kararını (rutin T0/T1/T2 geliştirme PR'ları için SHA başına D-31 onayının kaldırılması) ve istisnalarını kalıcı denetim kaydı olarak saklar; makine tarafından okunan karşılığı docs/planning/autonomy/standing-authority.json dosyasıdır. -->
# FD-2026-11-03-STANDING-AUTONOMY: standing Founder authority for routine development

- **Decision by:** Founder (repository owner), in the Claude Code cloud session `session_015dYwazi7LHFCg3dABbSW2P`, 2026-11-03.
- **Title of the decision:** "UASCO V4.1 — FOUNDER KALICI OTONOMİ YETKİSİ".
- **Status:** effective once this file is merged into `v7/integration`.
- **Machine-readable form:** `docs/planning/autonomy/standing-authority.json`. Enforced by `docs/planning/autonomy/autonomy.mjs` together with `docs/planning/merge-gate.mjs`.

## 1. What it grants
Standing, pre-granted Founder authority to **merge** T0, T1 and routine T2 software-development PRs into `v7/integration`. This covers:
- CLOUD-T tasks;
- application code;
- tests;
- bug and security fixes;
- normal product-development PRs.

It **replaces the per-SHA D-31 T2 approval** (V4.1 merge gate `D-31`) for these PRs.

A PR is auto-merged only when **all** of the following hold:
1. `docs/planning/merge-gate.mjs` (process mode) returns `MERGE` on evidence gathered just before the merge. In short:
   - the required checks `validate (ubuntu-latest)` and `validate (windows-latest)` are green from `ci.yml` on the exact head;
   - there is a binding `VERDICT-BINDING: verdict=CLEAN` PR review on the exact head and base, from an independent CLAUDE_REVIEWER session that is not the builder session;
   - no protected or CI-executed path is changed;
   - the ruleset is present;
   - there is no base drift.
2. The PR body names exactly one V4.1 task (`UASCO-TASK: <id>`). That task's tier is T0, T1 or T2, and it is not T3.
3. Every start and merge gate of that task, other than `D-31`, is listed as satisfied in the policy. Any other gate is a Founder decision.
4. The merge uses `expectedHeadSha`, so a head that moves after the check cannot be merged.

## 2. What still needs a separate Founder decision (`FOUNDER_REQUIRED`)
- Starting any paid service or spend. D-08 is 0 USD; no paid Anthropic API.
- Loosening GitHub security rules or widening any authority, including rulesets, branch protection and environment reviewers.
- Changing the trust-root or a protected governance rule. This covers:
  - any `config/protected-paths.json` path;
  - the merge-gate floor (`.github/workflows/`, `config/`, `prompts/`, `automation/lib/`, `scripts/validate-*`, `CLAUDE.md`, `AGENTS.md`);
  - CI-executed files (`package.json`, the lockfile, `scripts/ci/`, `scripts/ensure-dependencies.mjs`, `.npmrc`).
- Risky or hard-to-reverse operations in a real production environment.
- A new external account, credential or legal obligation.
- T3 tasks, and tasks whose V4.1 gates (for example D-03, D-29 or D-23) are not yet decided.

Normal coding, testing, security fixes, independent review and merges are **not** exceptions.

## 3. What it does not change
- Builder and reviewer stay separate sessions. The builder never self-declares CLEAN (CLAUDE.md).
- No check is bypassed, and no failed check is turned into a PASS.
- Required checks and rulesets are not removed.
- The first change to protected files keeps the existing approval and review rules. The `founder-authority` environment and the per-SHA Founder decision still apply to those changes.
- Honest trust level: the reviewer posts through the same GitHub account as the builder. The verdict is process-level, not identity-level (see `docs/planning/MERGE_GATE.md`).

## 4. Known limitation recorded with the decision
The repository workflow `UASCO Independent Review` still fails with `REVIEWER_AUTH_REJECTED`, because the `CLAUDE_CODE_OAUTH_TOKEN` subscription credential is rejected.
- claude-code-action v1.0.255 to v1.0.267 contain no authentication fix; they only bump CLI versions.
- The check is not required and is never bypassed.
- Until a working credential exists, the independent verdict comes from a separate read-only cloud reviewer session, bound to the exact SHA by the merge gate's rule (d).

## 5. Persistent loop state
The task-loop state survives quota and session interruptions. It is kept in `docs/planning/autonomy/STATE.json`, which is committed with each task's PR.

No claim of 24/7 operation is made: a hosted cloud executor is not yet configured (CLOUD-T0009, D-03).
