<!-- //TR: Bu not merge-gate.mjs için kısa spesifikasyondur: girdiler, kararlar, gerekçe kodları, reviewer'ın göndermesi gereken VERDICT-BINDING satırı, modlar ve dürüst güven beyanı (aynı GitHub hesabı = yalnız süreç düzeyi). -->
# Cloud merge gate (CP-MERGE-GATE)

Authority: Founder directive 2026-10-20 "CLOUD PRODUCTION RECOVERY", section 4 (code-enforced merge gate inside the existing architecture, no protected-file or trust-root change). The gate is a decision module. It never calls GitHub and never merges; the coordinator gathers the evidence and performs the merge.

```
node docs/planning/merge-gate.mjs --evidence <file.json> [--mode process|strict] [--policy <file.json>]
node docs/planning/merge-gate.mjs --post-merge <file.json>
```

It prints exactly one JSON line: `{decision, expectedHeadSha, expectedBaseSha, reasons[], identityIndependence, trust, mode}`. The exit codes are 0 for `MERGE`, 2 for `BLOCK` and 3 for `INTERNAL_ERROR`, which is also fail-closed. The proof is `node docs/planning/merge-gate.proof.mjs`.

## Inputs
- **Evidence** (gathered by the coordinator with GitHub tools):
  - `pr {number,state,draft,merged,changed_files,head:{sha,ref},base:{ref,sha},user:{login}}`;
  - `currentBaseSha`, read just before merging;
  - `checkRuns [{name,status,conclusion,head_sha,app_slug,completed_at,workflowPath,workflowRunEvent}]`. `workflowPath` is the check suite's workflow run `path` (for example `.github/workflows/ci.yml`), and `workflowRunEvent` is that run's `event`;
  - `reviews [{id,user:{login},state,commit_id,body,submitted_at}]`;
  - `diffFiles [{filename, previous_filename?, status}]`, in the GitHub PR files API shape. `status` must be one of `added`, `modified`, `removed`, `renamed`, `copied`, `changed` or `unchanged`. `renamed` and `copied` must carry `previous_filename`. The old `ownDiffFiles` field is no longer accepted;
  - `protectedPaths {exactPaths,protectedPrefixes}`, the contents of `config/protected-paths.json`;
  - `rules []`, from `GET /repos/{o}/{r}/rules/branches/{base}`.
  - Optional: `implementerSessions []`. A verdict whose `reviewer-session` is in this list is rejected.
  - Any other field, such as `issueComments`, is ignored.
- **Policy** (`--policy`, optional): `{trustedReviewerLogins: [], expectedBaseRef: "v7/integration"}`. The `--mode` flag sets the mode.

## MERGE only if all of these hold (otherwise BLOCK)
| # | Condition | Reason codes |
|---|---|---|
| a | The PR is open, not a draft, not merged, and `base.ref` equals `expectedBaseRef`. | `PR_NOT_OPEN`, `PR_DRAFT`, `PR_ALREADY_MERGED`, `BASE_REF_MISMATCH` |
| b | The head and base SHAs are 40/64 lowercase hex, and `currentBaseSha == pr.base.sha`. | `EVIDENCE_MALFORMED:<field>`, `BASE_DRIFT` |
| c | For `validate (ubuntu-latest)` and `validate (windows-latest)`, take the runs with `head_sha == pr.head.sha`, `app_slug == github-actions`, `workflowPath == .github/workflows/ci.yml` and `workflowRunEvent` in `pull_request`, `push` or `workflow_dispatch`. The workflow check matters because any workflow file can name a job `validate (...)`; `ci.yml` itself is trusted only because a diff under `.github/workflows/` is `PROTECTED_PATH`. None may be unfinished, and the latest completed run must be `success`. If runs tie on `completed_at`, all of them must be `success`. | `CHECK_MISSING:<ctx>` (with `CHECK_ON_OTHER_SHA:<ctx>` or `CHECK_FROM_OTHER_APP:<ctx>` or `CHECK_PROVENANCE_MISMATCH:<ctx>` as hints), `CHECK_PENDING:<ctx>`, `CHECK_FAILED:<ctx>`, `CHECK_MALFORMED:<ctx>` |
| d | The verdict is a binding CLEAN PR **review** (see below) on `commit_id == pr.head.sha`. **Every non-CLEAN item on the head blocks** until a strictly later valid CLEAN **from the same login** clears it. If the item's `reviewer-session` is known, the clearing CLEAN must carry the same session too, because a session id is only text and any account can quote it. Non-CLEAN items are: a non-CLEAN verdict; a malformed, ambiguous or mismatched binding; and a `CHANGES_REQUESTED` review from any author, with or without a binding. An item is never cleared if it is at or after the latest CLEAN, comes from a deleted or ghost account (`user: null`), or has an unusable time; a maintainer clears it by dismissing the review. | `VERDICT_MISSING`, `VERDICT_ONLY_ON_OTHER_COMMIT`, `VERDICT_NOT_CLEAN`, `VERDICT_HEAD_MISMATCH`, `VERDICT_BASE_MISMATCH`, `VERDICT_BINDING_MALFORMED`, `VERDICT_BINDING_AMBIGUOUS`, `VERDICT_REVIEW_STATE_INVALID`, `VERDICT_REVIEWER_IS_IMPLEMENTER_SESSION`, `VERDICT_SUPERSEDED_BY_LATER_REVIEW`, `VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER`, `REVIEW_CHANGES_REQUESTED` |
| e | No `diffFiles` entry touches a protected path, under any status. Both `filename` and `previous_filename` are checked, so renaming a protected file away, renaming onto a protected path, removing one or copying one all block. Paths are compared case-insensitively, with `\` turned into `/` and `.`/`..` resolved. A built-in floor always applies, whatever `protectedPaths` says: the exact files `CLAUDE.md` and `AGENTS.md`, and the prefixes `.github/workflows/`, `automation/lib/`, `scripts/validate-`, `scripts/run-validation.mjs`, `config/` and `prompts/`. There is no authority-record bypass. | `PROTECTED_PATH`, `DIFF_INCOMPLETE` (`diffFiles.length != pr.changed_files`; more than 3000 files, which is the most the PR files API lists; or a repeated normalised `filename`, or a repeated normalised `previous_filename`. A `filename` may equal another entry's `previous_filename`, because a rename plus a re-added file is legitimate), `EVIDENCE_MALFORMED:pr.changed_files`, `EVIDENCE_MALFORMED:diffFiles` (unknown or missing status, `renamed`/`copied` without `previous_filename`) |
| e2 | No `diffFiles` entry, by `filename` or `previous_filename`, touches a file that CI executes from the PR head but `config/protected-paths.json` does not protect. These are `scripts/ensure-dependencies.mjs` (`ensure-dependencies`), `package.json` (`npm-manifest`), `package-lock.json` (`npm-lockfile`) and anything under `scripts/ci/` (`ci-scripts`), `npm-shrinkwrap.json` (`npm-shrinkwrap`), `.npmrc` (`npmrc`), and, as defence in depth because they are already protected in config, `scripts/secret-sanity.mjs` (`secret-sanity`) and `scripts/bootstrap-kernel-selftest.mjs` (`bootstrap-kernel-selftest`). Through them a PR could make `validate` pass vacuously. Dependency and CI-script changes therefore need an explicit Founder authority path: a future authority-record mechanism, **not implemented here**. Until it exists, this gate blocks them, and such a PR has to be merged outside this gate under a recorded Founder decision. | `CI_EXECUTED_PATH:<category>` |
| f | `rules` holds `deletion`, `non_fast_forward`, `pull_request` and `required_status_checks`, and the status-check rule lists both contexts. In strict mode, `pull_request.required_approving_review_count` must also be at least 1. | `RULESET_MISSING:<rule>`, `RULESET_MISSING:required_status_checks:<ctx>`, `RULESET_MISSING:required_approving_review_count` |
| g | Strict mode needs `identityIndependence == DISTINCT_ACCOUNT`. | `REVIEWER_NOT_INDEPENDENT_IDENTITY` |

Other codes: `POLICY_MALFORMED:mode`, `ARG_INVALID[:--mode]`, `ARG_MISSING:--evidence`, `EVIDENCE_UNREADABLE`, `EVIDENCE_UNPARSEABLE`, `POLICY_UNREADABLE`, `POLICY_UNPARSEABLE`, `POLICY_MALFORMED`, `INTERNAL_ERROR`.

**No echo.** Every output string is either a fixed code from this file or a SHA that passed validation. Review bodies, logins, titles, refs, comments, argv values and exception messages never reach stdout or stderr. The proof scans every output for planted markers to check this.

## The binding line the reviewer must post
The reviewer posts it in a PR **review** body (state `COMMENTED` or `APPROVED`), never in an issue comment. It is one line, exactly:

```
VERDICT-BINDING: verdict=CLEAN head=<pr head sha> base=<current base sha> reviewer-session=<id>
```

- `verdict` is `[A-Z_]+`. Only `CLEAN` passes, and any other value blocks the merge if it is at the same time or later.
- `reviewer-session` is `[A-Za-z0-9._:-]{1,128}`.
- A body with more than one `VERDICT-BINDING` line is `AMBIGUOUS`.
- The line must start at column 0 with exactly `VERDICT-BINDING: `. Any other line that mentions `verdict-binding` (in any case, indented, or with trailing text) is `MALFORMED`.
- Invisible characters are every character in `\p{Cf}` (format controls) or `\p{Default_Ignorable_Code_Point}`. This set includes the earlier hand list and U+061C.
  - Any line that contains one of these and mentions `verdict-binding` once they are removed is `MALFORMED`. This holds wherever the line is, including inside a code fence or a quote.
  - Invisible characters are never removed before the fence and quote checks.
- Quoted lines (starting with `>` or `&gt;`) and lines inside code fences never count as bindings.
- A fence opens with a run of 3 or more `` ` `` or `~`. It closes only with a run of the same character that is at least as long and has nothing after it, so `~~~` never closes a `` ``` `` fence.
- Free text and JSON elsewhere in the body are ignored.
- A verdict on an older commit is void.
- `UASCO-LOOP-RECORD ... result CLEAN` issue comments never count.

**Whose reviews count.**
- In process mode, a review counts if it comes from the PR author's account or from a login in `trustedReviewerLogins`.
- In strict mode, only trusted logins other than the PR author count.
- Binding lines in reviews from anyone else are ignored, so an outsider cannot pass the gate.
- The one exception is `CHANGES_REQUESTED`: it blocks from any author, and the cure is dismissing the review.

## Modes and the trust statement
- **Identity.** `identityIndependence` is `DISTINCT_ACCOUNT` only when the verdict author is not the PR author and is in `trustedReviewerLogins`. Otherwise it is `SAME_ACCOUNT`.
- **`process` (default).** `SAME_ACCOUNT` is allowed, and the output says `trust: "PROCESS_ONLY_SAME_ACCOUNT"`.
  - This is a process check only. It proves that a well-formed binding exists for this exact head and base, on green CI, under the required ruleset.
  - It does **not** prove that an independent reviewer wrote it. The builder session runs under the same GitHub account and could post the same line.
  - **No forgery resistance is claimed for same-account verdicts.**
- **`strict`.** `SAME_ACCOUNT` gives BLOCK `REVIEWER_NOT_INDEPENDENT_IDENTITY`. On success the output says `trust: "DISTINCT_TRUSTED_ACCOUNT"`.
  - Even then, the gate only proves that a different GitHub identity posted the line. It does not prove that the reviewer was a fresh, isolated process.
- **`trust`** is `NONE` on any outcome other than MERGE.

### OWNER_ACTION (needed before strict mode can pass)
1. Create a second GitHub identity for the reviewer, either a separate account or a GitHub App, whose credentials the builder sessions do not hold. Give it review permission on the repo.
2. Add `required_approving_review_count: 1` to the `pull_request` rule of the `v7/integration` ruleset, and have the reviewer identity submit the binding line in an `APPROVED` review.
3. Run the gate with `--mode strict --policy <file>`, where the policy file has `{"trustedReviewerLogins":["<reviewer login>"]}`.

Until this is done, only process mode can pass, and it carries `PROCESS_ONLY_SAME_ACCOUNT`.

## How the coordinator uses it
1. **Gather the evidence** with GitHub tools:
   - the PR (`pull_request_read`);
   - the check runs for the head SHA, with `app.slug` mapped to `app_slug`;
   - the PR reviews (not issue comments);
   - the PR file list, as `diffFiles` (`filename`, `previous_filename`, `status`);
  - for each check run, its check suite's workflow run, which gives `path` as `workflowPath` and `event` as `workflowRunEvent`;
   - `config/protected-paths.json` from the base;
   - the branch rules for `v7/integration`.

   Read `currentBaseSha` (the base branch head) last, just before step 2.
2. **Run the gate:** `node docs/planning/merge-gate.mjs --evidence ev.json [--mode strict --policy pol.json]`.
3. **Merge only if the exit code is 0 and `decision == "MERGE"`.** Call the merge API with `merge_method: "merge"` and `sha: expectedHeadSha`, so GitHub refuses the merge if the head moved. Any other result: do nothing, and report the reason codes.
4. **Verify after the merge:**
   - Read the merge commit and the new base head.
   - Run `node docs/planning/merge-gate.mjs --post-merge pm.json` with `{mergeCommitSha, mergeCommitParents, newBaseHead, expectedBaseSha, expectedHeadSha}`.
   - It requires `parents == [expectedBaseSha, expectedHeadSha]` and `newBaseHead == mergeCommitSha`.
   - `MISMATCH` (exit 2) means the merge was not the evaluated one. Stop and escalate; do not merge anything else.

## Limitations
- The gate trusts the evidence file as gathered. A coordinator that fabricates the evidence defeats it. The ruleset's own `required_status_checks` and `pull_request` rules are the server-side backstop.
- There is a time-of-check to time-of-use window between step 2 and step 3. The `sha` parameter covers a head move, but not a base move; a base move after the gate runs is caught only afterwards, by `verifyPostMerge`.

## Reused from PR #11 (`claude/autonomy-recovery-prep`)
- **From `scripts/merge-via-gate.mjs`:**
  - the shape of a pure `evaluateMergeGate` decision function;
  - the two required contexts and the `github-actions` app filter;
  - the "one success must not mask a sibling failure or pending run" rule (here: any unfinished run blocks, and the latest completed run must succeed);
  - binding to the live PR head and base;
  - the merge being guarded by an expected head SHA.

  Not reused: `lease-verdict.verifyVerdict`, an unsigned local file under `automation/lib`, replaced here by the review-bound line; the `gh`/`git` CLI side; and the `redactCliText` echo, since nothing is echoed here.
- **From `MERGE-GATE-FIX.md`:** the root cause, that `v7/integration` lacked a required-check gate, which is why the ruleset presence check (f) exists.
