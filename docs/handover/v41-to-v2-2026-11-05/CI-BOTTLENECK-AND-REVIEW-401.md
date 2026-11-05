<!-- //TR: V4.1 Koordinatör ölçümü (2026-11-05): Windows CI darboğazı ve OAuth 401 nedeniyle başarısız olan bağımsız review workflow'u için güvenli düzeltme önerisi. Zorunlu kontroller atlanmaz; karar Founder'ındır. -->
# Windows CI bottleneck and the review workflow (OAuth 401)

Measured 2026-11-05 ~19:20Z from the GitHub Actions API. Raw data: `ci-runs-2026-11-05.tsv` (100 runs since 12:00Z) and `ci-jobs-2026-11-05.tsv` (jobs of the last 40 CI runs).

## Measurements

| Job | n | Queue median | Queue max | Run median | Run max |
|---|---|---|---|---|---|
| validate-windows-shard (1..3) | 59 | 19.9 min | 62.0 min | 19.4 min | 56.9 min |
| validate (ubuntu-latest) | 40 | 8.4 min | 51.9 min | 10.6 min | 11.5 min |

- Every CI run needs **4 Windows jobs**: 3 shards plus the aggregate `validate (windows-latest)`. The aggregate also runs on `windows-latest`.
- At the time of measurement the queue held:
  - CI: 14 queued, 1 pending, 10 in progress;
  - UASCO Independent Review: 25 queued, 4 pending.
- Since 12:00Z the review workflow has 0 successful runs: 18 were cancelled (concurrency, superseded) and 1 was skipped.
- A required Windows result takes about **40–60 minutes per PR**: preflight, then shard queue (~20 min), then shard run (~20 min), then the aggregate.
- Each merge moves the base. The exact-HEAD/BASE review binding then forces a base merge and a full CI re-run on every queued PR. Base-merging 9 PRs at once means about 36 Windows jobs.

## What the coordinator changes now (no gate is weakened)

1. **Lazy base merges.** After each merge, only the next 1–2 PRs in merge order are base-merged and re-bound, not all of them. This cuts Windows load per merge from ~36 jobs to ~4–8.
2. **Serial queue order.** The PRs with the highest chance of passing CI first go first.

## Proposals that need the Founder (protected files or settings, not done by the coordinator)

| # | Proposal | Effect | Risk / note |
|---|---|---|---|
| P1 | (Checked, NOT recommended as-is.) Moving the aggregate `validate (windows-latest)` job to ubuntu. | Would free 1 of 4 Windows slots per run. | The aggregate is not a pure merger. It runs `secret-sanity` and the **bootstrap trust-kernel self-test** on Windows, and writes CI evidence with `--leg ${{ runner.os }}` (= Windows). Moving it would change what the Windows evidence leg proves. It needs a redesign, not a runner swap. |
| P2 | On `pull_request`, add `concurrency: {group: ci-${{ github.head_ref }}, cancel-in-progress: true}` to CI. | Stops superseded heads from occupying Windows runners. | Protected ci.yml. It cancels only runs of stale heads; required checks still run on the current head. |
| P3 | Larger or self-hosted Windows runners. A `validate-selfhosted.yml` already exists. | Removes the queue. | Cost or ops decision. |

## Review workflow (OAuth 401): safe fix proposal

The workflow `.github/workflows/uasco-independent-review.yml` uses a Claude OAuth token and a GitHub App key stored in the `uasco-review` environment.
- It is **not** one of the checks the executor merge gate requires. The executor uses CI plus the CLAUDE_REVIEWER VERDICT-BINDING.
- Its runs are now queued, pending, or cancelled. They hold job-queue slots on `ubuntu-latest`, and the cancelled ones still appear on every PR.

Evidence (Builder D's probe, branch `claude/builder-d-reviewer-oauth-probe` 47d6c4ba):
- All 130 executed ai-review runs since 2026-10-21 end the same way: `subtype success`, `is_error true`, 1 turn, $0, about 2 s after init, then "401 OAuth access token is invalid". This matches upstream issues anthropics/claude-code-action#1613/#1614.
- The probe reproduces the check in an isolated headless CLI. The token comes only from env or a hidden prompt, and every output line is redacted. The Founder can run it locally to tell an invalid token apart from an action-side defect before rotating.

Recommended, in order (all by the Founder; nobody pastes or transmits a token):
1. **Rotate the credential in place.** In GitHub, Settings → Environments → `uasco-review`, replace the expired Claude OAuth secret with a fresh one created by the Founder. No code change and no required-check change.
2. **Until then, disable only this workflow.** Use Actions → "UASCO Independent Review" → Disable workflow. This is reversible, and it stops the 25+ queued runs from competing for runner slots. The required checks (`validate (ubuntu-latest)`, `validate (windows-latest)`) are unaffected.
3. **Do not** remove it from the ruleset or rename checks to work around it. If it is ever made required, it must be fixed first (step 1).

The coordinator will not cancel runs, disable workflows, or edit rulesets without an explicit Founder instruction.
