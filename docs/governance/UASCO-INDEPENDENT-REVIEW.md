<!-- //TR: Bu belge "UASCO Independent Review" zorunlu kontrolünün tasarımını, güven modelini, kalan riskleri ve Founder'ın GitHub'da yapması gereken kurulum adımlarını açıklar; kurulum tamamlanmadan kontrol hiçbir PR'ı geçirmez. -->
# UASCO Independent Review: GitHub-enforced Claude review

**Status:** PREPARED (branch `claude/uasco-independent-review`). It does nothing until the Founder completes the setup below and merges this change. That merge needs Founder authority because it changes `.github/workflows/` and `scripts/ci/`.

**Decision:** Founder, 2026-10-21. UASCO uses no human reviewer. A Claude Builder writes the change, a separate Claude Reviewer reviews it, and GitHub enforces the result as a required check.

```
Builder (cloud session) → PR → CI (ci.yml, Linux + 3 Windows shards) → UASCO Independent Review (this workflow)
  → required check "UASCO Independent Review" = success on the exact head SHA → authorized merge → next task
```

## How it works

The workflow is `.github/workflows/uasco-independent-review.yml`. It runs on `pull_request_target` (opened, synchronize, reopened, ready_for_review) for PRs into `v7/integration`, and on manual dispatch.

**On github.com, `pull_request_target` takes the workflow file, `GITHUB_REF` and `github.sha` from the repository's default branch, not from the PR's base branch.** The default branch must therefore be `v7/integration` (setup step 2). On any other default branch the `v7/integration`-only environments refuse every job, so the check never passes (fail-closed).

Draft PRs are skipped: a draft cannot be merged, and reviewing it would spend a review that the ready-for-review event repeats. Builders open drafts; the coordinator marks a PR ready for review once CI is green on its head, and that event starts the one review of that head.

| Job | Holds | Does |
|---|---|---|
| `scope` | reviewer App key (checks:write) | Creates the check **in_progress** on the PR head SHA. Decides whether Founder authority is needed: protected or CI-executed paths, or a re-review after this App already rejected the same head or the same tree (see "Re-review after a rejection"). |
| `founder-authority` | nothing | Runs only when scope said Founder authority is needed. Waits in the `uasco-founder-authority` environment until the Founder approves the deployment in the GitHub UI. |
| `collect` | read-only `GITHUB_TOKEN` | Waits (bounded, 100 min) for CI to finish on the same head SHA; a PR with a merge conflict (which gets no CI) ends early as `PR_MERGE_CONFLICT`. Collects evidence, the head tree and the prior-verdict record, and runs the deterministic pre-gate. Fetches the diff as `compare/<base SHA>...<head SHA>` (bound to SHAs, never to the PR's live base) and fails closed if its file list differs from the PR file list used for the protected-path decision (`DIFF_FILES_MISMATCH`). A red, incomplete, conflicted or too-large PR stops here, so no review tokens are spent. |
| `ai-review` | Claude OAuth token only | Skipped on a cancelled run. Checks out the trusted base at the exact SHA the verdict is bound to. Runs Claude Code with **read-only tools** (Read, Glob, Grep); shell, write and network tools are disabled. Inputs are in `uasco-review/review-input/` (not a dot-directory, so the deny rule for hidden files under `/home`, which also hides `.git/config`, does not hide them). The reviewer is given `verdict.schema.json` in an API-compatible form: the keywords the API's structured outputs do not support (`minLength`, `maxLength`, `minimum`, `maxItems` and the other length, range and array-size keywords) are dropped and stated in each field's description instead. The gate (`validateVerdict`) enforces the full schema itself: unknown keys, lengths, counts, ranges, patterns and enums; a verdict with a credential shape is replaced before its first upload and never published. A `reviewer-diagnose` step then records why the reviewer did or did not give a verdict, as one fixed code (see "Troubleshooting"). |
| `finish` | reviewer App key | Re-reads the PR head, the Founder approvals of this run, the App's own earlier verdicts on this head and tree (live, not from the evidence file) and the verdict, applies `review-gate.mjs`, and concludes the check **success** or **failure** with a checks-only token. The decision is made even on a cancelled run. It records `external_id` as `v2:<1 if a substantive negative verdict>:<head tree>:<digest prefix>`, written only by the App. A check is concluded once: finish never rewrites a check that is already completed (`CHECK_ALREADY_CONCLUDED`) or that belongs to another commit (`CHECK_HEAD_MISMATCH`), and it applies only the verdict of the run attempt that created the check (a re-run of `ai-review` alone produces a verdict that is never used). If the verdict could not be handed over, a placeholder records it as unreadable and negative. Uploads the evidence artifact (90 days). If `UASCO_REVIEW_SUBMIT_APPROVAL=true` and the check passed, a second token (pull requests write only) submits an APPROVE review pinned to the reviewed commit, after re-checking that the head has not moved. Never on a cancelled run. |

Artifacts are named per run attempt, and later jobs download them by the name the producing job recorded. "Re-run failed jobs" therefore finds the original artifacts, but it can only finish a check that is still in progress (for example after `finish` crashed before concluding), and always with that check's own verdict. A concluded check is never changed. To review again, use "Re-run all jobs" or the re-review path (step 9): that creates a new check, which sees the earlier record.

**Decision core** (`scripts/ci/uasco-review/review-gate.mjs`, pure, no I/O):
- **Reused merge-gate checks** (`docs/planning/merge-gate.mjs`): PR state, base ref, CI on the head SHA (only from `.github/workflows/ci.yml` runs by GitHub Actions, never a same-named job from another workflow), diff completeness, protected and CI-executed paths, ruleset presence. The merge gate's `BASE_DRIFT` is not used here: `pulls.base.sha` only moves on a head push, so it would fail every PR after any merge into the base. Instead the verdict and the diff are bound to the base tip read during the run, and up-to-date merging is enforced by the ruleset's strict mode (setup step 10).
- **Its own conditions:** success requires all of these:
  - a well-formed verdict with `result: CLEAN`;
  - `reviewedHeadSha` equal to the PR head and `reviewedBaseSha` equal to the base tip read in the run;
  - no BLOCKER finding, and no P0 or P1 finding;
  - every check PASS (security may be NOT_APPLICABLE; tests never);
  - a reviewer session that is not one of the PR's builder sessions (from the commits' `Claude-Session` trailers);
  - the head unchanged since the review;
  - Founder approval when protected or CI-executed paths changed, or when this App already gave a negative verdict on the same head or tree;
  - a known prior-verdict record (`PRIOR_VERDICT_UNKNOWN` otherwise);
  - no credential-shaped text in the verdict.
- **Fail-closed:** everything else concludes failure, with fixed reason codes.

**Evidence:**
- **Check run:** written by the App, bound to the head SHA. Its `external_id` and summary carry the sha256 digest of the canonical decision record.
- **Artifacts:** `uasco-review-input-<attempt>`, `uasco-review-verdict-<attempt>` and `uasco-review-evidence-<attempt>` hold `evidence.json`, `verdict.json`, `reviewer-diagnostics.json`, `decision.json`, the diff and the reviewer instructions. Anyone can recompute the digest from the decision record.

## Why the Builder cannot fake or alter the check

1. **App pinning:** the required check must be pinned in the ruleset to the reviewer App. Builders act through the shared account and the Claude GitHub App. A commit status, or a check from any other App, including a same-named job in a workflow added by a PR (GitHub Actions), does not satisfy it. **Never choose "any source"** for this check.
2. **Environment restriction:** the App private key and the Claude OAuth token exist only as secrets of the `uasco-review` environment, whose deployment branch policy allows **only `v7/integration`**. A workflow added or changed in a PR, or dispatched on a builder branch, cannot read them.
3. **Trusted code only:** `pull_request_target` runs the workflow and scripts from the default branch, which must be `v7/integration`. A PR cannot change how it is reviewed. Changing the review system itself is a change to `.github/workflows/` and `scripts/ci/`, which the merge gate classes as protected and CI-executed, so the review check itself requires Founder authority for it.
4. **No PR code runs:** every checkout is trusted default-branch code (`github.sha`, or in `ai-review` the base SHA read during the run) with `persist-credentials: false`. The diff is fetched through the API as text.
5. **Key separation:** the LLM job never holds the App key. A prompt injection in the diff can at most make the verdict wrong; it cannot write a check. The deterministic gate still requires green CI on the same SHA.
6. **Stale reviews:** a new commit has a new head SHA and therefore no review check. The required check is missing until that exact commit is reviewed again. A commit pushed during a review makes that run conclude `STALE_HEAD`, and the concurrency group cancels the old run before it spends a review.
7. **Diff bound to SHAs:** the reviewed diff is `compare/<base SHA>...<head SHA>`. It must describe the same change as the PR file list used for the protected-path decision, on both sides: the same new paths, and every rename or copy with the same source path (git-quoted names are decoded). Moving the PR's base to another branch during a run, or a protected file renamed away that the file list shows only by its new name, makes it fail (`DIFF_FILES_MISMATCH`). The commit list (implementer sessions, prior verdicts) must be complete and end at the head (`COMMITS_UNVERIFIED`; GitHub lists at most 250 commits).
8. **Re-review after a rejection:** a substantive negative verdict (BLOCKED or INCONCLUSIVE, a BLOCKER or P0/P1 finding, a failed check, a negative verdict rejected for credential-shaped text, or a run refused only because such a record already exists) is recorded by the App in the check's `external_id` together with the head tree. If the decision is lost, the raw verdict still sets the record. A later run on the same head, or on any commit currently in the PR with the same tree (for example an empty commit), needs the Founder's approval in `uasco-founder-authority`. The lookup selects exactly those commits by tree; more than 50 of them, an unknown tree, or a failed lookup leaves the re-review to the Founder. An earlier check of this App on that content that never concluded (force-cancelled, or a crash before the conclusion) counts the same way, because its verdict was never recorded. A partial re-run cannot change a concluded check. A negative verdict refused only for its form (for example an invisible character) still counts as negative. Limits are listed under "Limits and residual risks".

## Bootstrap and Founder setup (GitHub UI; nothing here is done by an agent)

Do the steps in this order. Steps 1–6 can be done before any merge.

1. **Keep master protected when the default branch changes.** Settings → Rules → Rulesets → `UASCO-MASTER-PROTECTION` → Target branches: remove "Default branch", then "Add target" → "Include by pattern" → `master` → "Save changes". (Today it targets `~DEFAULT_BRANCH`; without this step master would lose its protection in step 2.)
2. **Make `v7/integration` the default branch.** Settings → General → Default branch → switch icon → `v7/integration` → "Update" → confirm. Afterwards new PRs default to `v7/integration`, and `pull_request_target`, `schedule` and `workflow_dispatch` use the `v7/integration` copy of each workflow.
3. **Allow this workflow's events (required before 2026-11-02).** GitHub's default policy blocks `pull_request_target` in public repositories from 2026-11-02. Settings → Actions → Policies: create a policy, enforcement Active, targeting only `.github/workflows/uasco-independent-review.yml`, event allowlist `pull_request_target` and `workflow_dispatch`. Do not apply this narrow allowlist to all workflows, or `ci.yml` stops running. (The screen is new; labels may differ slightly.)
4. **Reviewer App permissions** (Settings → Developer settings → GitHub Apps → UASCO Reviewer → Permissions & events → Repository permissions), then accept the updated permissions on the installation (Settings → GitHub Apps → UASCO Reviewer → "Review request" → "Accept new permissions"):
   - Checks: Read and write.
   - Commit statuses: Read and write. Needed only so the ruleset can choose this App as the check's source; the workflow never mints a token with it.
   - Pull requests: Read and write (for the APPROVE review).
   - Contents: Read and write. Needed only so GitHub counts the App's approval as one from a reviewer with write access; the workflow never mints a token with it. Residual risk: the App key could mint a contents token; it is only reachable from `uasco-review` deployments on `v7/integration`.
   - Metadata: Read.
5. **Environments and variables** (already done by the Founder on 2026-10-21; keep as is): `uasco-review` (deployment branches `v7/integration` only; secrets `UASCO_REVIEW_APP_PRIVATE_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`; variable `UASCO_REVIEW_APP_CLIENT_ID`), `uasco-founder-authority` (required reviewer: the Founder; deployment branches `v7/integration` only; no secrets), repository variables `UASCO_FOUNDER_LOGIN`, `UASCO_REVIEW_SUBMIT_APPROVAL=true`, optional `UASCO_REVIEW_MODEL`.
6. **Actions may not approve PRs.** Settings → Actions → General → Workflow permissions: confirm that "Allow GitHub Actions to create and approve pull requests" is **unticked**. Until the pin in step 10 is verified, this is the barrier that keeps a workflow's `GITHUB_TOKEN` from approving.
7. **Bootstrap merges.** The workflow cannot review itself or #128 before it exists on `v7/integration`, and `require_last_push_approval` blocks every PR pushed by the shared account until another identity approves. So, once:
   - Settings → Rules → Rulesets → `UASCO-V7-INTEGRATION-PROTECTION` → "Require a pull request before merging" → untick "Require approval of the most recent reviewable push" → "Save changes".
   - Merge #128 ("Merge pull request" → "Create a merge commit" → "Confirm merge"), then this PR the same way.
   - Tick "Require approval of the most recent reviewable push" again → "Save changes". Keep the window short: while it is off, any green PR could be merged.
8. **First real run.** The coordinator merges `v7/integration` into one queue PR and marks it ready for review. Confirm in the PR: the "UASCO Independent Review" check appears from the App, and after a CLEAN verdict the App's APPROVE makes the merge box show the PR as approved (`reviewDecision` APPROVED). If the APPROVE does not count, revisit step 4 (Contents permission).
9. **Re-review path:** "Run workflow" on the UASCO Independent Review workflow (Actions tab) with the PR number. It works once step 2 is done.
10. **Ruleset (last, only after step 8 showed a real check from the App).** In `UASCO-V7-INTEGRATION-PROTECTION`:
   - "Require status checks to pass" → "Add checks" → `UASCO Independent Review` → choose the UASCO Reviewer App as its source. Never "any source".
   - **Verify the pin** after saving: `GET /repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-/rules/branches/v7/integration` must list, under `required_status_checks`, `{"context": "UASCO Independent Review", "integration_id": <the App ID shown on the App's settings page, not the client ID>}`. If `integration_id` is missing, is 15368 (GitHub Actions) or is the Claude App's id, the pin is wrong: fix it before relying on the check.
   - Tick "Require branches to be up to date before merging". Each merge then forces the next PR to be updated, which means new CI and a new review on the new head.
11. **Release PRs one at a time.** Under strict mode, mark the next queue PR ready only after the previous one merged and `v7/integration` was merged into it. This avoids wasted reviews and keeps the shared GITHUB_TOKEN rate limit and runner pool free.

## Cost

- **Claude:** uses the Founder's Claude Max subscription through `CLAUDE_CODE_OAUTH_TOKEN` (`anthropics/claude-code-action`, input `claude_code_oauth_token`). No paid API key is required. Reviews count against the subscription's usage limits.
  - **Spending control:** the review runs only after CI is green, never for red, incomplete, conflicted, too-large, draft or fork PRs, and never on a cancelled run.
  - **Alternative:** an `ANTHROPIC_API_KEY` (pay per token at current API list prices) can replace the OAuth token. It is not needed.
- **GitHub Actions:** standard GitHub-hosted runners, free for this public repository. `collect` waits on a runner while CI runs, up to 100 min per push.

## Troubleshooting: the reviewer gave no verdict

<!-- //TR: Reviewer karar üretmediğinde (ör. VERDICT_MISSING) nedeni gösteren sabit teşhis kodları ve her birinin çözümü; kod önce yürütme kaydının izinli listedeki tipli alanlarından (HTTP durumu, hata türü, anahtar kaynağı), ancak bunlar karar vermezse sabit metin desenlerinden belirlenir; hiçbir metin kopyalanmaz; teşhis yalnız ek blokaj nedenidir, kontrolü asla geçirmez. -->
The reviewer's full output stays hidden (`show_full_output` is off: it can hold PR content or secrets). Instead the `reviewer-diagnose` step in `ai-review` reads the action's execution file (at most 4 MiB) in memory and writes only a fixed-shape record to `uasco-verdict/reviewer-diagnostics.json`, plus one fixed line in the job summary (`UASCO reviewer diagnosis: <code>`). No text of that output is copied anywhere. The step never fails the job.

The record has exactly these keys, in this order (`REVIEWER_DIAGNOSTIC_KEYS` in `scripts/ci/uasco-review/review-gate.mjs`):

| Key | Value | Source |
|---|---|---|
| `code` | one of the codes below | the classification |
| `isError` | boolean | last `result` message, `is_error === true` |
| `numTurns`, `durationMs` | integer 0..10^12 or `null` | last `result` message, `num_turns`, `duration_ms` |
| `modelUsed` | boolean | last `result` message: non-empty `modelUsage` or a cost above 0 |
| `apiErrorStatus` | integer 100..599 or `null` | last `result` message, `api_error_status`; any other value (text, fraction, huge or negative number) is `null` |
| `errorKind` | allow-listed enum, `"OTHER"` or `null` | `error` of the last `assistant` message of that turn (SDK `SDKAssistantMessageError`) |
| `terminalReason` | allow-listed enum, `"OTHER"` or `null` | last `result` message, `terminal_reason` (SDK `TerminalReason`) |
| `apiKeySource` | allow-listed enum, `"OTHER"` or `null` | `apiKeySource` of the last `system`/`init` message (SDK `ApiKeySource`) |
| `apiError` | allow-listed enum, `"OTHER"` or `null` | last `result` message, `api_error` (CLI result schema) |
| `apiErrorOrigin` | `"first_party"`, `"OTHER"` or `null` | last `result` message, `api_error_origin` (CLI result schema) |

The typed fields are read only as own properties with these names. An absent or `null` field is `null`; any value that is not a member of the field's allow-list (an unknown member, text, a number, an object) becomes `"OTHER"`, so no text can pass through. The allow-lists (`REVIEWER_TYPED_ALLOW_LISTS`) are copied from `@anthropic-ai/claude-agent-sdk` 0.3.304 `sdk.d.ts` (identical in 0.3.306) and, for the internal `api_error` and `api_error_origin` fields, from the result schema of the pinned Claude Code CLI 2.1.304 (identical in 2.1.306).

The code is decided from the typed fields first, only for a run whose record says `is_error`, in this order: `oauth_org_not_allowed`; `account_on_hold`, `verification_required` or `billing_error`; `invalid_credential_header` without a status; status 401; status 403; `authentication_failed` without status or `api_error` and with `apiKeySource` `none`. When none of these applies, the fixed text patterns of CLI and API error messages decide exactly as before (auth, then model, then quota, then a run that used the model, then schema, then unclassified). The text-only `REVIEWER_AUTH_REJECTED` is therefore weaker evidence than the typed codes.

Only when no verdict was delivered (`VERDICT_MISSING`, or the `VERDICT_UNREADABLE` placeholder) does `finish` add the code after the other blocking reasons, with its remedy in the check summary. A delivered verdict (CLEAN or negative, malformed, or rejected for credential-shaped text) is never annotated: its decision, reasons and digest stay exactly as without a diagnosis. A diagnosis can only add a reason: it never removes one and never turns a failure into success. An unknown or malformed code is ignored. A missing verdict is not a rejection, so the next review needs no Founder approval.

| Code | Typed trigger (or text) | Meaning | Remedy |
|---|---|---|---|
| `REVIEWER_AUTH_HTTP_401` | `apiErrorStatus` 401 (usually with `errorKind` `authentication_failed`) | The request reached the Anthropic API and the credential was refused with HTTP 401. A revoked or wrongly stored token gives this too; for a `claude setup-token` OAuth token in claude-code-action it is the open upstream issue anthropics/claude-code-action#1613. | Regenerating the setup-token did not fix #1613, so another regeneration is not expected to help. The alternatives are Founder decisions: a Console API key (`ANTHROPIC_API_KEY`, billed per token) or workload identity federation. No secret value is needed for the diagnosis. Then start a new review. |
| `REVIEWER_AUTH_HTTP_403` | `apiErrorStatus` 403 | The credential was recognised but this request is not allowed (for example no entitlement to Claude Code or to the model in `UASCO_REVIEW_MODEL`). | A new token does not change an entitlement. Check the account's plan and access, or correct or clear `UASCO_REVIEW_MODEL`, then start a new review. |
| `REVIEWER_OAUTH_ORG_DISABLED` | `errorKind` `oauth_org_not_allowed` (any status) | The account's organization disabled Claude subscription (OAuth) access for Claude Code. | A new token cannot fix it. An organization admin enables the access, or the Founder decides on a Console API key; then start a new review. |
| `REVIEWER_CREDENTIAL_MALFORMED` | `apiError` `invalid_credential_header` and no status | The CLI rejected the credential locally: it is not a valid HTTP header value, so no request was sent (for example a line break or space copied into the secret). | Store `CLAUDE_CODE_OAUTH_TOKEN` again from standard input without surrounding whitespace (`gh secret set CLAUDE_CODE_OAUTH_TOKEN --env uasco-review`), then start a new review. |
| `REVIEWER_NOT_LOGGED_IN` | `errorKind` `authentication_failed`, no status, no `apiError`, `apiKeySource` `none` | No usable credential reached the CLI: authentication failed before any HTTP response, with no API key in use. | Check that the `uasco-review` environment defines `CLAUDE_CODE_OAUTH_TOKEN` and that `ai-review` runs in it (the value is never needed for the diagnosis), then start a new review. |
| `REVIEWER_ACCOUNT_BLOCKED` | `errorKind` `account_on_hold`, `verification_required` or `billing_error` (any status) | The account is on hold, needs organization verification, or has a billing problem. | A new token cannot fix it. The account owner resolves it in the Claude or Anthropic Console account settings, then start a new review. |
| `REVIEWER_AUTH_REJECTED` | text only: an authentication-related error text, no typed rule applied | Some auth-family failure (invalid key, expired or revoked OAuth token, "please run /login"), not proven by a typed field. | If the token was not regenerated yet, store a new one (`claude setup-token`) into the `uasco-review` environment secret `CLAUDE_CODE_OAUTH_TOKEN`, then start a new review. |
| `REVIEWER_MODEL_UNAVAILABLE` | text | The requested model was not found or is not available to the credential. | Correct or clear the repository variable `UASCO_REVIEW_MODEL`, then start a new review. |
| `REVIEWER_QUOTA_OR_RATE_LIMIT` | text | Usage limit, quota, credit balance, rate limit (429) or overload (529). | Wait until the limit resets, then start a new review. |
| `REVIEWER_SCHEMA_REJECTED` | text | The API refused the verdict schema passed with `--json-schema` (for example an immediate 400 `invalid_request_error`, with no model usage). Matched only on an error, after the three text causes above, and never for a run that used the model. | Fix the schema in `scripts/ci/uasco-review` (`verdict.schema.json`) and merge the fix (the workflow runs from the default branch); no credential change is needed. Then start a new review. |
| `REVIEWER_NO_STRUCTURED_OUTPUT` | no error, or a run that used the model | The reviewer ran but returned no schema-valid verdict (for example it reached its turn limit). | Start a new review; if it repeats, split the PR. |
| `REVIEWER_ERROR_UNCLASSIFIED` | an error matching none of the above | An error that matches none of the above (the record's typed fields still show what is known). | Check the `ai-review` job log of the run, then start a new review. |
| `REVIEWER_OUTPUT_UNREADABLE` | no usable record | The execution file was missing, empty, oversized, malformed or had no `result` message (the reviewer may not have started). | Check the `ai-review` job log of the run, then start a new review. |
| `REVIEWER_OK` | no error and structured output | The reviewer returned structured output. Never a blocking reason. | None. |

"Start a new review" means "Re-run all jobs" or "Run workflow" with the PR number (a concluded check is never changed). The classification explains a failure; it does not make the reviewer succeed. No remedy ever asks for a secret value.

## Limits and residual risks (honest)

- **Same-account identity:** the Founder and the agents share one GitHub account. The Founder-authority step is only as strong as the Claude GitHub App's permissions: it should not have Administration, Environments, Secrets or Deployments write. A builder with the account's token could still open PRs, but cannot produce the App's check.
- **Model judgement:** the verdict is an LLM judgement on untrusted input. Deterministic gates bound what a wrong verdict can pass (green CI on the same SHA, protected paths, SHA binding, re-review after a rejection needs the Founder). They cannot make the judgement itself correct.
- **Trivially different content:** the re-review rule matches the same head or the same tree of a commit currently in the PR. A new commit with any real change (even one character) is new content and is reviewed again without the Founder. An amend or force-push that drops the rejected commit is also reviewed again without the Founder, even with an identical tree: GitHub offers no lookup of checks by tree, only by commit. A run cancelled before any verdict exists (`DECISION_MISSING` without a verdict) is not a rejection; a run that never concluded its check at all leaves the next review of that content to the Founder.
- **Earlier approvals:** a later failure on the same head does not dismiss an APPROVE the App gave earlier on that head. That needs the same content to pass once and then fail, which only a re-roll can produce, and a re-roll needs the Founder.
- **Rate limits:** the run waits out a GitHub rate limit, but at most 2 min per wait and 3 min in total in the 10-minute jobs (15 min in `collect`). A longer limit fails the run closed: the check concludes failure, or stays in progress if `finish` itself cannot reach GitHub, which leaves the next review of that head to the Founder. Releasing PRs one at a time (step 11) keeps the shared `GITHUB_TOKEN` budget free.
- **Size:** GitHub's diff endpoints stop at 300 files (and refuse very large diffs); such PRs fail as `DIFF_TOO_LARGE_FOR_REVIEW` and must be split. A diff over 600 KB is not reviewed either.
- **Not executed here:** a real GitHub run of this workflow, App-pinned ruleset enforcement, the APPROVE counting toward `require_last_push_approval`, and the claude-code-action call. Verified offline only: `node scripts/ci/uasco-review/review-gate.proof.mjs` covers the pure gate, the workflow's static trust boundaries (including the reviewer's file-deny rules against its own inputs) and the real `run.mjs` phases against a local mock GitHub API.
