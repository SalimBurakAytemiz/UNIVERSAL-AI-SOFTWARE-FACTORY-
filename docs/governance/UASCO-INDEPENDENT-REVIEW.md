<!-- //TR: Bu belge "UASCO Independent Review" zorunlu kontrolünün tasarımını, güven modelini, kalan riskleri ve Founder'ın GitHub'da yapması gereken kurulum adımlarını açıklar; kurulum tamamlanmadan kontrol hiçbir PR'ı geçirmez. -->
# UASCO Independent Review: GitHub-enforced Claude review

**Status:** PREPARED (branch `claude/uasco-independent-review`). It does nothing until the Founder completes the setup below and merges this change; that merge needs Founder authority because it changes `.github/workflows/` and `scripts/ci/`.

**Decision:** Founder, 2026-10-21. UASCO uses no human reviewer. A Claude Builder writes the change, a separate Claude Reviewer reviews it, and GitHub enforces the result as a required check.

```
Builder (cloud session) → PR → CI (ci.yml, Linux + 3 Windows shards) → UASCO Independent Review (this workflow)
  → required check "UASCO Independent Review" = success on the exact head SHA → authorized merge → next task
```

## How it works

The workflow is `.github/workflows/uasco-independent-review.yml`. It runs on `pull_request_target` (opened, synchronize, reopened, ready_for_review) against `v7/integration`, and on manual dispatch.

| Job | Holds | Does |
|---|---|---|
| `scope` | reviewer App key (checks:write) | Creates the check **in_progress** on the PR head SHA; decides whether protected or CI-executed paths need Founder authority. |
| `founder-authority` | nothing | Runs only for protected/CI-executed paths. Waits in the `uasco-founder-authority` environment until the Founder approves the deployment in the GitHub UI. |
| `collect` | read-only `GITHUB_TOKEN` | Waits (bounded, 100 min) for CI to finish on the same head SHA. Collects evidence and runs the deterministic pre-gate. A red or incomplete PR stops here, so no review tokens are spent. |
| `ai-review` | Claude OAuth token only | Runs Claude Code with **read-only tools** (Read, Glob, Grep). Shell, write and network tools are disabled. Input is the diff and context as data, plus the trusted base checkout. Output is a JSON verdict validated against `verdict.schema.json`. |
| `finish` | reviewer App key | Re-reads the PR head, the Founder approvals of this run and the verdict, applies `review-gate.mjs`, and concludes the check **success** or **failure**. Uploads the evidence artifact (90 days). |

**Decision core** (`scripts/ci/uasco-review/review-gate.mjs`, pure, no I/O):
- **Reused merge-gate checks:** it reuses `docs/planning/merge-gate.mjs` for:
  - PR state;
  - base drift;
  - CI on the head SHA, only from `.github/workflows/ci.yml` runs by GitHub Actions, never a same-named job from another workflow;
  - diff completeness;
  - protected and CI-executed paths;
  - ruleset presence.
- **Its own conditions:** success requires all of these:
  - a well-formed verdict with `result: CLEAN`;
  - `reviewedHeadSha` equal to the PR head;
  - `reviewedBaseSha` equal to the current base;
  - no BLOCKER finding, and no P0 or P1 finding;
  - every check PASS (security may be NOT_APPLICABLE; tests never);
  - a reviewer session that is not one of the PR's builder sessions (from the commits' `Claude-Session` trailers);
  - the head unchanged since the review;
  - Founder approval when protected or CI-executed paths changed;
  - no credential-shaped text in the verdict.
- **Fail-closed:** everything else concludes failure, with fixed reason codes.

**Evidence:**
- **Check run:** written by the App, bound to the head SHA. Its `external_id` and summary carry the sha256 digest of the canonical decision record.
- **Artifacts:** `uasco-review-input`, `uasco-review-verdict` and `uasco-review-evidence` hold `evidence.json`, `verdict.json`, `decision.json`, the diff and the reviewer instructions. Anyone can recompute the digest from the decision record.

## Why the Builder cannot fake or alter the check

1. **App pinning:** the required check must be pinned in the ruleset to the reviewer App's `integration_id`.
   - Builders act through the shared account and the Claude GitHub App. A commit status, or a check from any other App, including a same-named job in a workflow added by a PR (GitHub Actions, integration 15368), does not satisfy it.
2. **Environment restriction:** the App private key and the Claude OAuth token exist only as secrets of the `uasco-review` environment.
   - Its deployment branch policy must allow **only `v7/integration`**.
   - A workflow added or changed in a PR, or dispatched on a builder branch, cannot read them.
3. **Trusted code only:** `pull_request_target` runs the workflow and scripts from the base branch.
   - A PR cannot change how it is reviewed.
   - Changing the review system itself is a change to `.github/workflows/` and `scripts/ci/`. The merge gate classes these as protected and CI-executed, and the review check itself requires Founder authority for them.
4. **No PR code runs:** every checkout is `github.sha` (the base commit) with `persist-credentials: false`. The diff is fetched through the API as text.
5. **Key separation:** the LLM job never holds the App key. A prompt injection in the diff can at most make the verdict wrong; it cannot write a check.
   - The deterministic gate still requires green CI on the same SHA.
   - Verdict text with credential shapes is rejected and never published.
6. **Stale reviews:** a new commit has a new head SHA and therefore no review check. The required check is missing until that exact commit is reviewed again. A commit pushed during a review makes that run conclude `STALE_HEAD`.

## Founder setup (GitHub UI; nothing here is done by an agent)

1. **Create a GitHub App**, for example "UASCO Reviewer" (Settings → Developer settings → GitHub Apps).
   - **Repository permissions:** Checks read & write; Pull requests read (or read & write if step 6 is used); Contents read; Metadata read.
   - **Webhook:** off.
   - **Installation:** install it only on this repository. Generate a private key.
2. **Create environment `uasco-review`** (Settings → Environments).
   - Deployment branches: **Selected branches → `v7/integration` only**.
   - **Environment secrets:**
     - `UASCO_REVIEW_APP_PRIVATE_KEY`: the App's private key PEM;
     - `CLAUDE_CODE_OAUTH_TOKEN`: from `claude setup-token` on the Founder's machine, logged in with the Claude Max account.
   - **Environment variable:** `UASCO_REVIEW_APP_CLIENT_ID`, the App's client ID.
3. **Create environment `uasco-founder-authority`**.
   - Required reviewer: the Founder.
   - Deployment branches: `v7/integration` only.
   - No secrets.
4. **Set repository variables:**
   - `UASCO_FOUNDER_LOGIN` = `SalimBurakAytemiz`;
   - optional `UASCO_REVIEW_MODEL`: a model alias for the reviewer; unset means the action default.
5. **Check the Claude GitHub App's permissions.** It is the GitHub App the builders push with. It should not have Administration, Environments, Secrets or Deployments write. Otherwise a builder could approve the Founder environment or change protections through the API.
6. **Approvals (optional, `UASCO_REVIEW_SUBMIT_APPROVAL=true`):** when the check passes, the App also submits an APPROVE review pinned to the reviewed commit.
   - This is what satisfies `require_last_push_approval` and a required-approvals count without a human. The App is a different actor from the pushing account.
   - `dismiss_stale_reviews_on_push` removes it on the next push.
7. **Merge this change** (Founder authority), then confirm the workflow runs on an open PR and posts the check.
8. **Ruleset (last):** in `UASCO-V7-INTEGRATION-PROTECTION` add the required status check **`UASCO Independent Review`** and select the reviewer App as its source.
   - Add it only after step 7 shows a real check from the App. Adding it earlier blocks every PR.

## Cost

- **Claude:** uses the Founder's Claude Max subscription through `CLAUDE_CODE_OAUTH_TOKEN` (`anthropics/claude-code-action`, input `claude_code_oauth_token`). No paid API key is required. Reviews count against the subscription's usage limits.
  - **Spending control:** the review runs only after CI is green, and never for red, incomplete or fork PRs.
  - **Alternative:** an `ANTHROPIC_API_KEY` (pay per token at current API list prices) can replace the OAuth token. It is not needed.
- **GitHub Actions:** standard GitHub-hosted runners, free for this public repository. `collect` waits on a runner while CI runs, up to 100 min per push.

## Limits and residual risks (honest)

- **Same-account identity:** the Founder and the agents share one GitHub account.
  - The Founder-authority step is only as strong as point 5 of the setup.
  - A builder with the account's token could still open PRs, but cannot produce the App's check.
- **Model judgement:** the verdict is an LLM judgement on untrusted input. Deterministic gates bound what a wrong verdict can pass: green CI on the same SHA, protected paths, SHA binding. They cannot make the judgement itself correct.
- **Size limit:** a diff over 600 KB is not reviewed (`DIFF_TOO_LARGE_FOR_REVIEW`, failure).
- **Not executed here:** a real GitHub run of this workflow, App-pinned ruleset enforcement and the claude-code-action call. Verified offline only: `node scripts/ci/uasco-review/review-gate.proof.mjs` covers the pure gate, the workflow's static trust boundaries and the real `run.mjs` phases against a local mock GitHub API.
