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
2. The PR body names exactly one V4.1 task (`UASCO-TASK: <id>`). The line must be outside code fences and HTML comments. That task's tier is T0, T1 or T2, and it is not T3.
3. The declared task is actionable. Its matrix status is not `SPLIT`, `BLOCKED`, `DEFERRED` or `UNVERIFIABLE`, it does not run `LOCAL`, and every dependency is merged. A dependency counts as merged if the matrix says so, or if a base `STATE.json` entry for it is verified: that entry's PR must be merged into the base ref and must declare the task in its single `UASCO-TASK:` line. Only a PR with no such line may instead declare it as the first word of its title. Unverified or unreadable entries are ignored. The check matches the base by branch name, so a later revert is not detected (process-level). If any of these fails, the result is `FOUNDER_REQUIRED`. Fixes to tasks already delivered stay routine. Every start and merge gate of that task, other than `D-31`, is listed as satisfied in the policy. `D-01` is satisfied by the Founder's D-01 approval recorded in `docs/planning/cloud-only/HANDOVER_RECONCILIATION_2026-11-02.md`. Any other gate is a Founder decision.
4. The PR does not touch the authority's own definition, checked by both `filename` and `previous_filename`. These paths are `docs/planning/autonomy/**` (except `STATE.json`), `docs/planning/authority/**`, `docs/planning/v41/**`, `docs/planning/cloud-only/**` (the D-01 basis), `.claude/**` (agent and skill files that drive the loop), `docs/planning/merge-gate.mjs`, `docs/planning/merge-gate.proof.mjs` and `docs/planning/MERGE_GATE.md`. Touching any of them is `FOUNDER_REQUIRED:GOVERNANCE_PATH`, so no PR can widen this authority on its own.
5. The builder session id or ids are passed to `decide` (`--implementer-session`). A CLEAN verdict carrying a builder session is rejected (`VERDICT_REVIEWER_IS_IMPLEMENTER_SESSION`). Without these ids, `decide` blocks. `reviewer-session=` is free text posted through the same GitHub account, so this check catches only honest mislabelling. It cannot stop a builder that invents a session id or quotes a reviewer's; that limit is part of the process-level trust in §3.
6. The review that merge-gate accepts carries exactly one line `AUTONOMY-EXCEPTIONS: none` (see §2a). That review is the latest valid CLEAN binding on the exact head and base. It must come from a trusted reviewer login or, in process mode, the PR author, must have state COMMENTED or APPROVED, and must not carry a builder session. Every qualifying CLEAN review must carry its own readable attestation line, and that includes a DISMISSED review that holds a CLEAN binding. Exceptions are collected from all of them, so no later or foreign review can erase one. Editing or dismissing a review through the shared account is a same-account action, and §3 treats it as process-level. If any exception is listed, the result is `FOUNDER_REQUIRED`. If the line is missing from the selected review, the result is `BLOCK`. If any line in any qualifying review mentions `AUTONOMY-EXCEPTIONS` but is not exactly one well-formed plain line, the result is `BLOCK` (`REVIEWER_ATTESTATION_MALFORMED`). That covers wrong case, a space after a comma, invisible characters, several lines, and a line that is quoted or fenced. A line counts as mentioning the token if the two words appear with up to 8 non-alphanumeric characters between them, after this normalisation: NFKC, removal of invisible characters, numeric character references decoded, `&amp;` decoded and other named entities replaced by a space (up to three rounds, for double escaping), and common Cyrillic and Greek look-alike letters folded. The test runs both with and without inline HTML tags of up to 200 characters removed, so stripping can only add detections. Two encodings are not detected: tags whose attribute values contain `>`, and escaped tags such as `&lt;i&gt;`. A look-alike outside that fold table is not detected. Within one review, such a self-contradiction is reviewer misconduct, and catching it is process-level.
7. Trust inputs come from the base, never from the PR: `config/protected-paths.json`, the policy and the task index are read at the base SHA. The local `autonomy.mjs`, `merge-gate.mjs`, policy and index must be byte-identical to the base blobs, otherwise `decide` blocks. The base is re-read last, and if it moved, `decide` blocks. This byte-identity check is run by the local `autonomy.mjs` itself, so it holds only when the executor runs an unmodified base checkout. That is a process-level guarantee, not a cryptographic one.
8. The merge is performed by `docs/planning/autonomy/executor.mjs merge`, and only on `AUTO_MERGE`. It merges once with `expectedHeadSha`, so a head that moves after the check cannot be merged, and it never retries a refused merge. It then verifies that the merge commit's parents are exactly (base, head) and that the base ref contains the merge. `executor.mjs verify-main` reports the push runs of `ci.yml` and `windows-installer.yml` on the merge commit as PASS, RUNNING or FAIL. A failure is attached to the merged task for the next builder. Running the executor from an unmodified base checkout remains a process-level step (§1.7).

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

Enforced by code: the paths and governance paths in §1.4, and the tier, gates, status, execution location and dependencies **of the task the PR declares**. The `UASCO-TASK:` line is written by the builder, and code cannot see whether the diff stays inside that task. The reviewer attests to that (§2a, `TASK_SCOPE_MISMATCH`), so this check is process-level. Code cannot see whether application code starts spending, creates an account or credential, or performs a production operation. Those exceptions are enforced by the reviewer's attestation (§2a), so their trust is process-level.

## 2a. Reviewer contract
The independent CLAUDE_REVIEWER session posts one PR review with event COMMENT. Besides its findings and the `VERDICT-BINDING` line, the review contains exactly one line at column 0:
- `AUTONOMY-EXCEPTIONS: none` if the diff starts no spend or paid API, needs no new external account, credential or legal obligation, performs or enables no risky or irreversible production operation, and widens no authority or security rule;
- otherwise `AUTONOMY-EXCEPTIONS: <CODE>[,<CODE>...]`, using `PAID_SPEND`, `NEW_ACCOUNT_OR_CREDENTIAL`, `PRODUCTION_RISK`, `AUTHORITY_WIDENING`, `LEGAL` or `TASK_SCOPE_MISMATCH`. Use `TASK_SCOPE_MISMATCH` when the diff does work outside the declared task, or work that needs a higher tier or an undecided gate.

The reviewer must not write the token anywhere else in the review, not even quoted or in prose. Any other mention makes the review MALFORMED, which fails closed.

## 3. What it does not change
- Builder and reviewer stay separate sessions. The builder never self-declares CLEAN (CLAUDE.md).
- No check is bypassed, and no failed check is turned into a PASS.
- Required checks and rulesets are not removed.
- The first change to protected files keeps the existing approval and review rules. The `founder-authority` environment and the per-SHA Founder decision still apply to those changes.
- Honest trust level: the reviewer posts through the same GitHub account as the builder. The verdict is process-level, not identity-level (see `docs/planning/MERGE_GATE.md`).

## 4. Known limitation recorded with the decision
The repository workflow `UASCO Independent Review` still fails with `REVIEWER_AUTH_REJECTED`, because the `CLAUDE_CODE_OAUTH_TOKEN` subscription credential is rejected.
- Observed 2026-11-03 from `git log v1.0.254..v1.0.267` of anthropics/claude-code-action: the 14 commits are CLI and SDK version bumps, a Bun bump, a docs change and "Pin the PR version a run checks out" (#1915). None of them touches authentication. This is an observation, not a vendor statement.
- The check is not required and is never bypassed.
- Until a working credential exists, the independent verdict comes from a separate read-only cloud reviewer session, bound to the exact SHA by the merge gate's rule (d).

## 5. Persistent loop state
The task-loop state survives quota and session interruptions. It is kept in `docs/planning/autonomy/STATE.json`, which is committed with each task's PR. `STATE.json` is not a governance path. A routine PR can therefore mark tasks done and unlock dependent tasks in `next`, but every merge is still gated by §1.

No claim of 24/7 operation is made: a hosted cloud executor is not yet configured (CLOUD-T0009, D-03).
