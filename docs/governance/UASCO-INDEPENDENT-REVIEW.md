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
| `ai-review` | Claude OAuth token only | Skipped on a cancelled run. Checks out the trusted base at the exact SHA the verdict is bound to. Runs Claude Code with **read-only tools** (Read, Glob, Grep); shell, write and network tools are disabled. Inputs are in `uasco-review/review-input/` (not a dot-directory, so the deny rule for hidden files under `/home`, which also hides `.git/config`, does not hide them). The JSON verdict is validated against `verdict.schema.json`; a verdict with a credential shape is replaced before its first upload and never published. A `reviewer-diagnose` step then records why the reviewer did or did not give a verdict, as one fixed code (see "Troubleshooting"). |
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

<!-- //TR: Reviewer karar üretmediğinde (ör. VERDICT_MISSING) nedeni gösteren sabit teşhis kodları ve her birinin çözümü; teşhis yalnız ek blokaj nedenidir, kontrolü asla geçirmez. -->
The reviewer's full output stays hidden (`show_full_output` is off: it can hold PR content or secrets). Instead the `reviewer-diagnose` step in `ai-review` reads the last `result` message of the action's execution file (at most 4 MiB) in memory and writes only `{code, isError, turns, durationMs, modelUsed}` to `uasco-verdict/reviewer-diagnostics.json`, plus one fixed line in the job summary. No text of that output is copied anywhere. The step never fails the job.

When the verdict did not pass (missing, unreadable, malformed or negative), `finish` adds the code after the other blocking reasons, and the check summary shows its remedy. A diagnosis can only add a reason: it never removes one, never changes a valid CLEAN verdict's decision, and never turns a failure into success. An unknown or malformed code is ignored. A missing verdict is not a rejection, so the next review needs no Founder approval.

| Code | Meaning | Remedy |
|---|---|---|
| `REVIEWER_AUTH_REJECTED` | The credential was rejected (invalid key, expired or revoked OAuth token, 401, "please run /login"). | Regenerate the reviewer token (`claude setup-token`) into the `uasco-review` environment secret `CLAUDE_CODE_OAUTH_TOKEN`, then start a new review. |
| `REVIEWER_MODEL_UNAVAILABLE` | The requested model was not found or is not available to the credential. | Correct or clear the repository variable `UASCO_REVIEW_MODEL`, then start a new review. |
| `REVIEWER_QUOTA_OR_RATE_LIMIT` | Usage limit, quota, credit balance, rate limit (429) or overload (529). | Wait until the limit resets, then start a new review. |
| `REVIEWER_NO_STRUCTURED_OUTPUT` | The reviewer ran but returned no schema-valid verdict (for example it reached its turn limit). | Start a new review; if it repeats, split the PR. |
| `REVIEWER_ERROR_UNCLASSIFIED` | An error that matches none of the above. | Check the `ai-review` job log of the run, then start a new review. |
| `REVIEWER_OUTPUT_UNREADABLE` | The execution file was missing, empty, oversized, malformed or had no `result` message (the reviewer may not have started). | Check the `ai-review` job log of the run, then start a new review. |
| `REVIEWER_OK` | The reviewer returned structured output. Never a blocking reason. | None. |

"Start a new review" means "Re-run all jobs" or "Run workflow" with the PR number (a concluded check is never changed). The classification only uses fixed text patterns of CLI and API error messages, and only when the record says the run ended in an error; it explains a failure, it does not make the reviewer succeed.

## Limits and residual risks (honest)

- **Same-account identity:** the Founder and the agents share one GitHub account. The Founder-authority step is only as strong as the Claude GitHub App's permissions: it should not have Administration, Environments, Secrets or Deployments write. A builder with the account's token could still open PRs, but cannot produce the App's check.
- **Model judgement:** the verdict is an LLM judgement on untrusted input. Deterministic gates bound what a wrong verdict can pass (green CI on the same SHA, protected paths, SHA binding, re-review after a rejection needs the Founder). They cannot make the judgement itself correct.
- **Trivially different content:** the re-review rule matches the same head or the same tree of a commit currently in the PR. A new commit with any real change (even one character) is new content and is reviewed again without the Founder. An amend or force-push that drops the rejected commit is also reviewed again without the Founder, even with an identical tree: GitHub offers no lookup of checks by tree, only by commit. A run cancelled before any verdict exists (`DECISION_MISSING` without a verdict) is not a rejection; a run that never concluded its check at all leaves the next review of that content to the Founder.
- **Earlier approvals:** a later failure on the same head does not dismiss an APPROVE the App gave earlier on that head. That needs the same content to pass once and then fail, which only a re-roll can produce, and a re-roll needs the Founder.
- **Rate limits:** the run waits out a GitHub rate limit, but at most 2 min per wait and 3 min in total in the 10-minute jobs (15 min in `collect`). A longer limit fails the run closed: the check concludes failure, or stays in progress if `finish` itself cannot reach GitHub, which leaves the next review of that head to the Founder. Releasing PRs one at a time (step 11) keeps the shared `GITHUB_TOKEN` budget free.
- **Size:** GitHub's diff endpoints stop at 300 files (and refuse very large diffs); such PRs fail as `DIFF_TOO_LARGE_FOR_REVIEW` and must be split. A diff over 600 KB is not reviewed either.
- **Not executed here:** a real GitHub run of this workflow, App-pinned ruleset enforcement, the APPROVE counting toward `require_last_push_approval`, and the claude-code-action call. Verified offline only: `node scripts/ci/uasco-review/review-gate.proof.mjs` covers the pure gate, the workflow's static trust boundaries (including the reviewer's file-deny rules against its own inputs) and the real `run.mjs` phases against a local mock GitHub API.
