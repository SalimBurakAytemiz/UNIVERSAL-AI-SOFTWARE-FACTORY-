<!-- //TR: Public repo uzerinde tam Cloud CI (ucretsiz standart GitHub-hosted ubuntu-latest + windows-latest; self-hosted/larger/ucretli runner YOK). 600 sn sorunu kapsam azaltmadan sirali test kabuklariyla cozulur; korunan dosyalar (ci.yml, config/validation.json, scripts/phase0-acceptance.mjs, trust-root manifest) YALNIZ acik Founder/maintainer yetkisiyle reseal edilir. Bu belge kaniti, uygulanacak korunan degisikligi, branch ruleset onerisini ve kalan riskleri durustce kaydeder. -->

# Public-repo Cloud CI (GitHub-hosted, $0)

## Evidence (GitHub API, 2026-10-19)
- **Visibility:** `GET /repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-` → `"visibility": "public"`, `"private": false` (unauthenticated read returns 200). Standard GitHub-hosted runners are free for public repos, so `ci.yml` (`ubuntu-latest` + `windows-latest`, Node 24) is usable again without billing.
- **Why CI was red before the quota ran out:** every CI run on `v7/integration` and on the PRs died after about 11 minutes. Example: run 39099588440 @e12dbdd.
  - Linux: `VALIDATION_STEP_TIMEOUT tests killed at the fixed per-step limit (durationMs=600034)`.
  - Windows: same line, `durationMs=600204`.
  - Every static validator, the supply-chain checks (including real-network `npm audit`) and the self-tests ran **PASS** first. The single `tests` step (110 vitest files) exceeds the hardcoded 600 s per-step cap (`scripts/run-validation.mjs`, protected, unchanged).
- **Local measurement:** Linux, 4 vCPU, Node 24.22.0, @e12dbdd.
  - The unsharded `tests` step takes 253 s wall-clock. The per-file sum is 635 s; the slowest file is `v7-b3c-security-stage` at 84 s.
  - GitHub Windows runs the same files about 2–3.5× slower (`v7-relfx-c4` takes 73 s there against 21 s locally).
  - Three failures appear only in this sandbox, all environment-specific: it runs as root (`/root` path check), has no global npm root, and the container's process-group kill behaves differently. The GitHub runs had shown no failing test in the tail, so these must be confirmed or refuted on the real runners.
- **Self-hosted:** nothing on `v7/integration` targets a self-hosted runner. The old runner `DESKTOP-G4U0679` (runner_id 21) is still registered, which is a **public-repo risk**: fork PRs can bring their own workflow file. The Founder must remove it; this session cannot (runners API → 403).

## The fix (no coverage reduction)
1. **Sharding:** `config/validation.json` `tests` is split into **8 ordered, contiguous steps**: `tests`, `tests-2` … `tests-8`. The plan is `test-shard-plan.json`.
   - The concatenation of the shards equals today's list **byte for byte**, order included.
   - Each shard's measured file sum is 71–91 s, against the 600 s cap.
   - New test files are appended to the **last** shard.
   - The 600 s cap stays unchanged.
2. **Shard-aware invariants:** non-protected, already in this PR.
   - `tests/support/validation-test-shards.ts` holds `logicalTestFiles` and `checkTestShards`.
   - The INT-R4 rule and the B5/PS-1B order and adjacency rules now check the logical list, so they mean exactly the same thing whether the step is single or split.
   - `pkg-vs` additionally requires:
     - shards are named `tests`, `tests-2`, …, `tests-N`, in order and contiguous;
     - no shard is platform-filtered;
     - no shard passes a CLI flag (such as `--shard` or `-t`) that could silently filter tests;
     - every vitest step is either a shard or one of the 7 allowlisted Windows-only steps;
     - `phase0-acceptance` requires **every** shard to PASS.
   - Mutation tests are included.
3. **CI workflow** (`ci.proposed.yml` → `.github/workflows/ci.yml`). Check names are unchanged: `validate (ubuntu-latest)`, `validate (windows-latest)`. Changes:
   - `push` runs only on `master` and `v7/integration`; `pull_request` and `workflow_dispatch` run anywhere. This ends the duplicate push+PR runs and the CI runs on report branches.
   - `concurrency` cancels superseded PR runs only. Integration-branch runs are never cancelled, so every merge commit keeps its evidence.
   - `timeout-minutes: 90`.
   - `scripts/ci/ci-evidence.mjs --require` runs on `if: always()`. It writes `CI_EVIDENCE.json` bound to `GITHUB_SHA` and the PR head SHA, plus the run id/attempt and `RUNNER_ENVIRONMENT`, which proves `github-hosted`. It fails closed.
   - Artifact upload uses a pinned `upload-artifact` v4.6.2 SHA, `include-hidden-files`, and **14-day retention** to bound artifact storage. The npm cache stays the setup-node default.
   - The artifact contains **only** `CI_EVIDENCE.json`: step id, status and duration, plus the SHA binding. No stdout/stderr, no step logs and no `VALIDATION_REPORT.json` go into a public artifact (Founder condition 7).
   - Pinned checkout/setup-node SHAs, `persist-credentials: false` and `permissions: contents: read` are unchanged.
4. **Acceptance:** `scripts/phase0-acceptance.mjs` gets `"tests-2"` … `"tests-8"` added to its required-step list. The change is strictly stronger.

### Protected part = explicit authority required
`ci.yml`, `config/validation.json`, `scripts/phase0-acceptance.mjs` and `config/trust-root-manifest.json` are trust-root files. `normalBuilderMayModifyProtectedPaths: false`, and the builder session's edit attempt was refused by the permission layer. The change is applied **only** as a maintainer trust-root reseal under an explicit Founder authority id, following the same precedent as b337463 and a77e082:
1. Copy `ci.proposed.yml` → `.github/workflows/ci.yml`, keeping its `//TR` header line updated.
2. Replace the `tests` step with the 8 shard steps from `test-shard-plan.json`, keeping `requiresDependencies: true` and the canonical `node node_modules/vitest/vitest.mjs run` prefix.
3. Add the 7 shard ids to the `phase0-acceptance` list, right after `"tests"`.
4. Run `node scripts/generate-trust-root.mjs`. Exactly 3 manifest hashes may change: `ci.yml`, `validation.json` and `phase0-acceptance.mjs`. Anything else means STOP.
5. Run validation locally, push, and have the CI pilot run on the PR, then the independent review of the exact head SHA.

## Branch protection (public repo → rulesets available)
`ruleset-v7-integration.proposed.json` sets up:
- no bypass actors, so admins are also bound;
- deletion and force-push (`non_fast_forward`) blocked;
- PR required, with stale approvals dismissed and threads resolved;
- both canonical contexts from GitHub Actions (`integration_id` 15368) required.

`strict` is off so 37 PRs don't need to re-run CI after every merge. The integration-branch push run catches semantic conflicts immediately.

This session's GitHub integration cannot read or write branch protection (`403 Resource not accessible by integration`). **Apply as Founder/admin after the pilot is green on both OSes:** `gh api -X POST repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-/rulesets --input <(jq 'del(."//TR")' ruleset-v7-integration.proposed.json)`.

`master`'s current release policy is unchanged; no `master` rule is proposed here.

**Honest limit:** a single GitHub identity cannot approve its own PR, so the approval count is 0. The SHA-bound independent review stays a process control: a separate reviewer session, the verdict bound to the SHA, and `merge-via-gate`. GitHub can only enforce it with a second identity or GitHub App (CP-GOV / separate-identity governance, AUTHORITY_REQUIRED).

## Merge gate
The required contexts and app slug (`validate (ubuntu-latest)`, `validate (windows-latest)`, `github-actions`) are the ones `scripts/merge-via-gate.mjs` (PR #11, `runs.every`, fail-closed) already expects. No gate change is needed for the GitHub-hosted path. The CircleCI plan is superseded and not needed.

## PR queue after the pilot
1. This PR goes green and gets an independent review CLEAN on its exact SHA, then a governed merge.
2. Every open PR merges `v7/integration` (no rebase or force), gets CI on both OSes, an independent review of the new head SHA and remediation, then merges. Old INCONCLUSIVE verdicts never count as CLEAN.
3. Order:
   - Protected-file PRs first, one at a time (#8 touches `validation.json` and the manifest).
   - Then governance/CI (#11, #12, #17, #18, #29, #31).
   - Then independent UI/test PRs (#19–#28, #32–#48), which are parallel-safe and conflict-free with each other except for stacked pairs (#25←#24, #26←#25, #28←#27).
