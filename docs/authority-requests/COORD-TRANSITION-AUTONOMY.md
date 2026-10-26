<!-- //TR: Koordinatör yetki paketi (tek geçiş PR'ı): "korunan yola her dokunuş Founder ister" kuralını, test edilmiş, risk sınıflı otomatik yetkilendirmeyle değiştirir. Rutin ve içerikten doğrulanan önceden yetkili değişiklikler Founder'sız birleşebilir; yüksek riskli değişiklikler ayrı Founder yetkisinde kalır. GitHub'ın gerçekte neyi zorladığı ve Founder'ın ücretsiz seçenekleri burada açıkça yazılıdır. -->
<!-- //TR: Bu belge bir yetki kaydı DEĞİLDİR; Founder'ın bu PR'ı bir kez onaylaması geçişi yürürlüğe koyar. Sahte başarı üretilmez: reviewer kimlik hatası CLEAN sayılmaz, GitHub'ın zorlamadığı bir şey zorlanıyormuş gibi yazılmaz. -->
# COORD-TRANSITION-AUTONOMY: risk-classified automatic merge authority

**Status:** PREPARED on branch `claude/coord-transition-autonomy`. Founder directive of 2026-10-26 ("AUTONOMOUS MERGE REFORM"). This is the one transition PR: the Founder approves it once; afterwards routine and pre-authorized PRs need no Founder.

**Why this PR itself needs the Founder.** The UASCO Independent Review runs on `pull_request_target` from the default branch, so this PR is judged by the old rules. It changes `scripts/ci/uasco-review/` (CI-executed), `config/` (protected) and the gate itself, so it needs the `uasco-founder-authority` approval. The reviewer credential is currently rejected (`REVIEWER_AUTH_REJECTED` on the runs read on 2026-10-26), so it cannot get a CLEAN check either. It therefore needs a Founder merge. The new rules apply only after it is merged into `v7/integration`.

## What becomes automatic (no Founder approval)

A PR may be auto-merged by the coordinator when all of these hold on its exact head and base:
- **CI:** `validate (ubuntu-latest)` and `validate (windows-latest)` are success on the head, from `.github/workflows/ci.yml`.
- **Independent verification:** a CLEAN verdict bound to the head and base. Either the UASCO reviewer App check, or a process review that is recorded as an explicitly independent session (never a builder's own session).
- **Risk tier ROUTINE or PREAUTHORIZED** (computed per file by `docs/planning/merge-risk.mjs`; the PR takes the highest tier):
  - **ROUTINE:** product code, frontend/backend wiring in unprotected files, tests, docs: anything that is neither protected, CI-executed nor high-risk.
  - **PREAUTHORIZED:** a protected file whose change has exactly one of these shapes, verified from its base and head text at the exact SHAs (`core/authority/autonomous-authority.mjs` `evaluateProtectedChange`; grammars in `core/authority/protected-change-grammar.mjs`):
    - `ROUTE_REGISTRATION_APPEND` on `apps/control-api/src/server.ts`: only added lines. They may be route imports from `./routes/`, named imports from `core/` (never sandbox, authority or execution-gate code), `registerXxxRoutes(app,laneDeps);`, or `registerXxxRoutes(app,{...laneDeps,<new key>:()=><expression>});`, plus comments and blank lines. The expression must be balanced and free of quotes, assignments and the deny tokens (process, require/import, child_process, spawn, exec, eval, Function, fetch, http, sandbox, ExecutionGate, acceptUnenforced, addHook, app., listen, env, token, secret, password, 0.0.0.0, ::, unlink, rm(, writeFile, globals and prototypes). Registrations sit in the registration block after `const laneDeps=`, are imported, are registered once, and never override a laneDeps key.
    - `DESKTOP_ALLOWLIST_APPEND` on `apps/desktop/main.mjs`: changes only inside the `B4-ALLOWLIST` and `B5-POST-ALLOWLIST` regions. Allowed are new `const NAME_RE=/^...$/;` declarations whose pattern is a strict anchored path (`\/` plus a lower-case literal, a `prefix_[0-9a-f]{24}` id or a `(?:a|b)` choice; no flags, `.`, `*`, `+`, `?`, `[^`, back-references), arrays that only append such names or patterns, and comments. Functions, query rules, the exact-route Set, existing patterns and Electron security settings never change in this class.
    - `TEST_REGISTRATION_APPEND` on `config/validation.json`: new `tests/*.test.ts` files that exist at the head, added to existing `tests`/`tests-N` steps. Every existing entry, step, command prefix and `shardPlan` stays unchanged.
    - `TRUST_ROOT_RESEAL` on `config/trust-root-manifest.json`: only the sha256 of files that are themselves ROUTINE or PREAUTHORIZED in the same PR, recomputed from the head bytes, plus `generatedAt`. No entry is added or removed, and the seal stays `SEALED`.
- **No conflict, no prior negative verdict** on the same content.

The coordinator follows `docs/planning/pr-controller.mjs` `nextActions(state)` per PR:
- it marks a draft ready for review once its CI is green;
- it sends a conflict, a CI failure or review findings back to the PR's own lane, on the same PR;
- after a base change, it updates only the PRs the change affects;
- it re-requests verification for a stale head;
- it blocks on a reviewer auth failure, which is never read as CLEAN;
- it enables auto-merge only when everything above holds;
- it disables an armed auto-merge as soon as any of it stops holding;
- after a merge, it verifies the merge (`verifyPostMerge`, which now accepts proven auto-merge chains) before the lane takes its next task.

A failure in one PR never produces an action for another PR.

## What stays with the Founder (risk tier FOUNDER)

These always need Founder authority (the `uasco-founder-authority` approval in the review, or the Founder's own merge):
- weakening any security gate, removing or weakening CI validation;
- secrets;
- permission expansion;
- paid services and production;
- dependency and CI-definition changes: `package.json`, the lockfile, `.npmrc`, `.github/**`, `scripts/ci/**`, `scripts/run-validation.mjs*`, `scripts/validate-*`, `tsconfig*`, `vitest.config.*`, `config/**` beyond the two pre-authorized targets, `prompts/**`;
- the trust-root scripts;
- sandbox and Electron security surfaces: `core/sandbox/**`, the Linux sandbox provider, the execution gate, the desktop preload, the renderer `index.html`/`app.js`;
- the authority and gate machinery itself: the merge gate, its classifier and controller, their proofs, `core/authority/**`, `tests/review-governance.test.ts`, the authority and merge-risk case files, and the review system;
- `CLAUDE.md` and `AGENTS.md`;
- any removed or renamed protected file;
- any deleted test file;
- any pre-authorized target whose contents are missing or do not match its class (fail-closed);
- a re-review after a negative verdict on the same content.

The gate files are FOUNDER-tier by both lists: the high-risk set in `merge-risk.mjs`, and `config/protected-paths.json` (exact paths plus the `core/authority/` and `scripts/ci/uasco-review/` prefixes), which also seals them in the trust root. No PR can widen its own authorization.

## GitHub reality (what GitHub enforces, and what it does not)

As read on 2026-10-26 (read-only map; environment rules and repository variables could not be read from this session, proxy 403):
- The `v7/integration` ruleset requires only the two `validate` contexts (integration 15368). Strict up-to-date mode is off; last-push approval is off. The "UASCO Independent Review" App check is **not** a required check, so GitHub auto-merge does not wait for it.
- The reviewer credential is rejected: recent runs that reached the reviewer ended `VERDICT_MISSING, REVIEWER_AUTH_REJECTED`. The check concludes failure; the workflow run itself concludes success, so a controller must read the check run, never the workflow run conclusion.
- **Auto-merge enablement is a coordinator process control.** Every builder, the coordinator and the Founder act through the Founder's GitHub account. GitHub cannot tell them apart, so nothing in GitHub stops that account from enabling auto-merge on any PR. The risk tiers, the controller and the review check are what keep FOUNDER-tier changes out, and they are process-level until the steps below make the App check GitHub-enforced.
- This automation has not tested any write to rulesets, environments or variables, and it does not assume it holds that authority.

## The Founder's free options to make it GitHub-enforced

1. **Refresh the reviewer token:** run `claude setup-token` and store the result as the `CLAUDE_CODE_OAUTH_TOKEN` secret of the `uasco-review` environment. Then re-run a review and confirm a passing "UASCO Independent Review" check.
2. **Require the App check:** in the `v7/integration` ruleset, add the required status check "UASCO Independent Review" pinned to the uasco-reviewer App (never "any source"). From then on, GitHub auto-merge waits for the App's success on the exact head. FOUNDER-tier PRs then cannot merge without the `uasco-founder-authority` approval, even if auto-merge is enabled. Do this only after step 1 works; otherwise every PR is blocked.
3. Optionally, turn on strict up-to-date mode, which forces a new CI run and review after every base change. This is slower and is not needed for the risk model.

These steps cost nothing and keep everything inside the existing GitHub setup.

## Files in this change

- `docs/planning/merge-risk.mjs` (+ `.d.mts`, `.proof.mjs` mutation proof): the per-file classifier, the floors and the one canonical matcher.
- `core/authority/autonomous-authority.mjs` (+ `.d.mts`) and `core/authority/protected-change-grammar.mjs` (+ `.d.mts`): the two new narrow classes, and test registration extended to every `tests`/`tests-N` step.
- `docs/planning/merge-gate.mjs` (+ proof): per-file tiers, optional `fileContents`, `riskTier`/`riskClasses`, and auto-merge-chain `verifyPostMerge`.
- `scripts/ci/uasco-review/{github,run,review-gate}.mjs`, `REVIEWER-PROMPT.md` and the proof: SHA-bound contents, the tier in the check and in `context.md`, and `HIGH_RISK_PATH` as an authority code. `.github/workflows/uasco-independent-review.yml` is unchanged.
- `docs/planning/pr-controller.mjs` (+ `.d.mts`): the per-PR action plan.
- `tests/support/merge-risk.cases.ts` (real #225 batch 4a, batch 4b, #214 and 9f0018d diffs as fixtures), `tests/support/pr-controller.cases.ts`, run from the registered `tests/review-governance.test.ts`.
- `config/protected-paths.json` and the trust-root reseal.

## Deviations from the design text, and why

- **The positive 4a fixture** is the registration and allow-list part of #225 batch 4a. Its sandbox hook, and its desktop `QUERY_RULES` object and `listQueryAllowed` call inside a function, are FOUNDER by the design's own negatives, so the full 4a diffs are negative fixtures.
- **Test registration** accepts only top-level `tests/*.test.ts` files: CI's sharding test runs only those.
- **Head existence of a newly registered test** comes from the PR file list, or from `headFiles`. In the review workflow, a test that already existed but was unregistered therefore stays FOUNDER (fail-closed).
- **Reseal entry count** is unchanged in every case: a new file under a sealed prefix is itself FOUNDER-tier.
- **Two controller actions were added:**
  - `DISABLE_AUTO_MERGE`: GitHub enforces only the `validate` checks, so an armed auto-merge on an ineligible PR must be disarmed;
  - `REMEDIATE_REVIEW`: a negative verdict goes back to the lane.
