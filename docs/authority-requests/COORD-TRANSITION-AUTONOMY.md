<!-- //TR: Koordinatör yetki paketi (tek geçiş PR'ı): "korunan yola her dokunuş Founder ister" kuralını, test edilmiş, risk sınıflı otomatik yetkilendirmeyle değiştirir. Rutin ve içerikten doğrulanan önceden yetkili değişiklikler Founder'sız birleşebilir; yüksek riskli değişiklikler ayrı Founder yetkisinde kalır. GitHub'ın gerçekte neyi zorladığı ve Founder'ın ücretsiz seçenekleri burada açıkça yazılıdır. -->
<!-- //TR: Bu belge bir yetki kaydı DEĞİLDİR; Founder'ın bu PR'ı bir kez onaylaması geçişi yürürlüğe koyar. Sahte başarı üretilmez: reviewer kimlik hatası CLEAN sayılmaz, GitHub'ın zorlamadığı bir şey zorlanıyormuş gibi yazılmaz. -->
# COORD-TRANSITION-AUTONOMY: risk-classified automatic merge authority

**Status:** PREPARED on branch `claude/coord-transition-autonomy`. Founder directive of 2026-10-26 ("AUTONOMOUS MERGE REFORM"). This is the one transition PR: the Founder approves it once; afterwards routine and pre-authorized PRs need no Founder.

**Why this PR itself needs the Founder.** The UASCO Independent Review runs on `pull_request_target` from the default branch, so this PR is judged by the old rules. It changes `scripts/ci/uasco-review/` (CI-executed), `config/` (protected) and the gate itself, so it needs the `uasco-founder-authority` approval. The reviewer credential is currently rejected (`REVIEWER_AUTH_REJECTED` on the runs read on 2026-10-26), so it cannot get a CLEAN check either. It therefore needs a Founder merge. The new rules apply only after it is merged into `v7/integration`.

## What becomes automatic (no Founder approval)

The coordinator merges a PR itself, bound to its head, when all of these hold on that exact head and base. "Bound to its head" means the merge API call carries `sha` = the head SHA that was checked, so GitHub refuses the merge once the head has moved. The coordinator never arms GitHub auto-merge, because an armed auto-merge is not bound to any head (see "GitHub reality").
- **CI:** `validate (ubuntu-latest)` and `validate (windows-latest)` are success on the head, from `.github/workflows/ci.yml`. A CI result that is not bound to a head SHA does not count.
- **Independent verification:** a CLEAN verdict bound to the head and base. Either the UASCO reviewer App check, or a process review that is recorded as an explicitly independent session (never a builder's own session). No FAIL verdict from any reviewer may exist on the same head: a later PASS never outvotes it.
- **Risk tier ROUTINE or PREAUTHORIZED** (computed per file by `docs/planning/merge-risk.mjs`; the PR takes the highest tier):
  - **ROUTINE:** product code, frontend/backend wiring in unprotected files, tests, docs: anything that is neither protected, CI-executed nor high-risk.
  - **PREAUTHORIZED:** a protected file whose change has exactly one of these shapes, verified from its base and head text at the exact SHAs (`core/authority/autonomous-authority.mjs` `evaluateProtectedChange`; grammars in `core/authority/protected-change-grammar.mjs`):
    - `ROUTE_REGISTRATION_APPEND` on `apps/control-api/src/server.ts`: only added lines. They may be route imports from `./routes/`, named imports from `core/` (never sandbox, authority or execution-gate code), `registerXxxRoutes(app,laneDeps);`, or `registerXxxRoutes(app,{...laneDeps,<new key>:()=><expression>});`, plus `// ` comments and blank lines.
      - The expression is exactly one lazy expression: identifiers, `.`/`?.` property chains, calls, `new A.B(...)`, `??`, object and array literals and inner `()=>` arrows. It has no literals, operators, assignments, quotes or reserved words, and no top-level comma, so it cannot add or override object keys or run anything eagerly. It must also be free of the deny tokens, matched in any letter case (process, require/import, child_process, spawn, exec (case-sensitive, so `getExecutors` stays usable), eval, Function, fetch, http, sandbox, ExecutionGate, acceptUnenforced, addHook, app., listen, env, token, secret, password, 0.0.0.0, ::, unlink, rm(, writeFile, `cp.`, fork, fastify, globals and prototypes).
      - Every name an added import binds is new: it occurs nowhere in the base file, is not a JS, Node or TypeScript global (`process`, `JSON`, `URL`, ...), and is bound once.
      - Registrations sit in the registration block after `const laneDeps=`, are imported, are registered once, and never override a laneDeps key.
    - `DESKTOP_ALLOWLIST_APPEND` on `apps/desktop/main.mjs`: changes only inside the `B4-ALLOWLIST` and `B5-POST-ALLOWLIST` regions. Allowed are new `const NAME_RE=/^...$/;` declarations whose pattern is a strict anchored path (`\/` plus a lower-case literal, a `prefix_[0-9a-f]{24}` id or a `(?:a|b)` choice; no flags, `.`, `*`, `+`, `?`, `[^`, back-references), arrays that only append such names or patterns, and comments. Functions, query rules, the exact-route Set, existing patterns and Electron security settings never change in this class.
    - In both text classes, an added line (comments included) may not contain a CR, U+2028 or U+2029 (JavaScript ends a line there, so the rest of a "comment" would run as code), other control characters, or invisible format and bidi characters. An added comment carries no tool directive: no `@` (so no `@ts-nocheck`, `@ts-ignore`), no eslint, istanbul, c8, v8, prettier or similar directive, no `///` or `//#` line.
    - `TEST_REGISTRATION_APPEND` on `config/validation.json`: new `tests/*.test.ts` files that exist at the head, added to existing `tests`/`tests-N` steps. Every existing entry, step, command prefix and `shardPlan` stays unchanged.
    - `TRUST_ROOT_RESEAL` on `config/trust-root-manifest.json`: only the sha256 of files that are themselves ROUTINE or PREAUTHORIZED in the same PR, recomputed from the head bytes, plus `generatedAt`. No entry is added or removed, and the seal stays `SEALED`.
- **No conflict, no prior negative verdict** on the same content.

**What the structural gate does not judge.** A pre-authorized `server.ts` registration wires a new `./routes/<name>.js` module, and an allow-list entry opens a path to code behind it. Those route modules and handlers are ROUTINE files: they run inside the control-api process with the Fastify `app` and the shared `laneDeps`. The grammar only guarantees the shape of the protected file's change; its deny tokens are defence in depth. What a newly wired route or allow-listed path actually does is judged by the independent CLEAN verdict and by CI, not by the structural gate. The Founder approves this knowingly with this transition PR.

The coordinator follows `docs/planning/pr-controller.mjs` `nextActions(state)` per PR:
- it marks a draft ready for review once its CI is green;
- it sends a conflict, a CI failure or review findings back to the PR's own lane, on the same PR;
- after a base change, it updates only the PRs the change affects;
- it re-requests verification for a stale head;
- it blocks on a reviewer auth failure, which is never read as CLEAN;
- it merges the PR itself with `MERGE_HEAD` (merge API, `sha` = head SHA) only when everything above holds;
- it never arms GitHub auto-merge, and it disarms an armed auto-merge (`DISABLE_AUTO_MERGE`) on every run unless the caller proves it was armed on the current head (`autoMergeArmedHead`, the PR head at the latest `auto_merge_enabled` timeline event, that is, the arm is newer than the head's `ci.yml` run). Only the Founder arms auto-merge, and an arm on a head counts only for that head;
- after a merge, it verifies the merge (`verifyPostMerge`, which now accepts proven auto-merge chains) before the lane takes its next task.

**The remaining window, stated honestly.** The controller acts when it runs. Between a push to a PR whose auto-merge is armed and the controller's next run, GitHub can merge the new head on the two `validate` checks alone. The controller closes this window only for its own merges (they are head-bound). For an arm, the window stays open until the next run. To keep it small, the coordinator runs the controller on every `synchronize` event it sees, and the lanes never push to a PR with an armed auto-merge without disarming it first.

A failure in one PR never produces an action for another PR.

## What stays with the Founder (risk tier FOUNDER)

These always need Founder authority: in the review, the Founder's `uasco-founder-authority` environment approval; for the merge, the Founder merges the PR personally or arms auto-merge personally on its final head. The controller has no input that stands for a Founder approval, so it ends every FOUNDER-tier or prior-negative PR at `FOUNDER_REQUIRED`. The FOUNDER tier covers:
- weakening any security gate, removing or weakening CI validation;
- secrets;
- permission expansion;
- paid services and production;
- dependency and CI-definition changes: `package.json`, the lockfile, `.npmrc`, `.github/**`, `scripts/ci/**`, `scripts/run-validation.mjs*`, `scripts/validate-*`, `tsconfig*`, `vitest.config.*`, `config/**` beyond the two pre-authorized targets, `prompts/**`;
- the trust-root scripts;
- sandbox and Electron security surfaces: `core/sandbox/**`, the Linux sandbox provider, the execution gate, the desktop preload, the renderer `index.html`/`app.js`;
- the security gates that admit or redact host work: `core/workos/risk-admission.ts`, `core/workos/secret-scan.ts`, `scripts/local-worker/sandbox.mjs` (high-risk set only; they are not sealed, so open lane PRs that touch them are not broken by a trust-root mismatch);
- the authority and gate machinery itself: the merge gate, its classifier and controller, their proofs, `core/authority/**`, `tests/review-governance.test.ts`, the authority and merge-risk case files, and the review system;
- the recorded authority terms: this document, `docs/planning/MERGE_GATE.md` and `docs/governance/UASCO-INDEPENDENT-REVIEW.md`;
- `CLAUDE.md` and `AGENTS.md`;
- any removed or renamed protected file, a case-only rename included;
- any deleted test file, and any test file renamed away (a case-only rename included);
- a file name that is not canonical, such as an NTFS alias (`main.mjs.`, `main.mjs `, `x:stream`, `PROGRA~1`), `./x` or `a//b`;
- any pre-authorized target whose contents are missing or do not match its class (fail-closed);
- a re-review after a negative verdict on the same content, including a PASS on a head that also has a FAIL verdict.

**Rules the coordinator and the lanes follow, which GitHub cannot enforce.** The coordinator and the lanes never approve `uasco-founder-authority` deployments, never arm GitHub auto-merge, and never change rulesets, environments, environment protection rules, variables or secrets. Every actor uses the Founder's GitHub account (repository permission admin; ruleset bypass actors none), so an environment approval, an auto-merge arm or a merge by that account is not identity-distinct: GitHub records the same login for the Founder and for automation.

The gate files are FOUNDER-tier by both lists: the high-risk set in `merge-risk.mjs`, and `config/protected-paths.json` (exact paths plus the `core/authority/` and `scripts/ci/uasco-review/` prefixes), which also seals them in the trust root. No PR can widen its own authorization.

## GitHub reality (what GitHub enforces, and what it does not)

As read on 2026-10-26 (read-only map; environment rules and repository variables could not be read from this session, proxy 403):
- The `v7/integration` ruleset requires only the two `validate` contexts (integration 15368). Strict up-to-date mode is off; last-push approval is off. The "UASCO Independent Review" App check is **not** a required check, so GitHub auto-merge does not wait for it.
- **An armed auto-merge is not bound to a head.** It survives pushes by the shared account and merges any later head that passes the two `validate` checks. #218, read-only on 2026-10-26 (`issues/218/timeline`, `commits/16f47821/check-runs`): `auto_merge_enabled` at 04:34:08Z on head `a2ed5c11`; the shared account pushed merge commit `16f47821` (05:13:31Z); no `auto_merge_disabled` event followed; GitHub merged `16f47821` at 05:35:28Z although the "UASCO Independent Review" check on `16f47821` was failure. #212, #219, #222 and #223 show the same sequence in their timelines (arm at 04:34Z to 05:12Z, a push by the shared account at about 05:13Z, merge of the pushed head without a disarm). This is why the coordinator merges head-bound and never arms auto-merge.
- The reviewer credential is rejected: recent runs that reached the reviewer ended `VERDICT_MISSING, REVIEWER_AUTH_REJECTED`. The check concludes failure; the workflow run itself concludes success, so a controller must read the check run, never the workflow run conclusion.
- **Merging and arming are process controls.** Every builder, the coordinator and the Founder act through the Founder's GitHub account. GitHub cannot tell them apart, so nothing in GitHub stops that account from merging or arming auto-merge on any PR. The risk tiers, the controller's head-bound merge and the review check keep FOUNDER-tier changes out of the coordinator's own merges. They cannot stop GitHub from merging a later head of a PR whose auto-merge is armed (the window described above), and they are process-level until the steps below make the App check GitHub-enforced.
- This automation has not tested any write to rulesets, environments or variables, and it does not assume it holds that authority.

## The Founder's free options to make it GitHub-enforced

1. **Refresh the reviewer token:** run `claude setup-token` and store the result as the `CLAUDE_CODE_OAUTH_TOKEN` secret of the `uasco-review` environment. Then re-run a review and confirm a passing "UASCO Independent Review" check.
2. **Require the App check:** in the `v7/integration` ruleset, add the required status check "UASCO Independent Review" pinned to the uasco-reviewer App (never "any source"). From then on, GitHub waits for the App's success on the exact head before any merge, an armed auto-merge included, which closes the window above. FOUNDER-tier PRs then cannot merge without the `uasco-founder-authority` approval. That approval is not identity-enforced: the shared account can approve the environment, so "only the Founder approves it" stays a process rule (see the rules above). Do this only after step 1 works; otherwise every PR is blocked.
3. Optionally, turn on strict up-to-date mode, which forces a new CI run and review after every base change. This is slower and is not needed for the risk model.

These steps cost nothing and keep everything inside the existing GitHub setup.

## Files in this change

- `docs/planning/merge-risk.mjs` (+ `.d.mts`, `.proof.mjs` mutation proof): the per-file classifier, the floors and the one canonical matcher.
- `core/authority/autonomous-authority.mjs` (+ `.d.mts`) and `core/authority/protected-change-grammar.mjs` (+ `.d.mts`): the two new narrow classes, and test registration extended to every `tests`/`tests-N` step.
- `docs/planning/merge-gate.mjs` (+ proof): per-file tiers, optional `fileContents`, `riskTier`/`riskClasses`, and auto-merge-chain `verifyPostMerge`.
- `scripts/ci/uasco-review/{github,run,review-gate}.mjs`, `REVIEWER-PROMPT.md` and the proof: SHA-bound contents, the tier in the check and in `context.md`, and `HIGH_RISK_PATH` as an authority code. `.github/workflows/uasco-independent-review.yml` is unchanged.
- `docs/planning/pr-controller.mjs` (+ `.d.mts`): the per-PR action plan, with the head-bound merge.
- `tests/support/merge-risk.cases.ts` (real #225 batch 4a, batch 4b, #214 and 9f0018d diffs as fixtures), `tests/support/pr-controller.cases.ts`, run from the registered `tests/review-governance.test.ts`.
- `config/protected-paths.json` and the trust-root reseal.

## Deviations from the design text, and why

- **The positive 4a fixture** is the registration and allow-list part of #225 batch 4a. Its sandbox hook, and its desktop `QUERY_RULES` object and `listQueryAllowed` call inside a function, are FOUNDER by the design's own negatives, so the full 4a diffs are negative fixtures.
- **Test registration** accepts only top-level `tests/*.test.ts` files: CI's sharding test runs only those.
- **Head existence of a newly registered test** comes from the PR file list, or from `headFiles`. In the review workflow, a test that already existed but was unregistered therefore stays FOUNDER (fail-closed).
- **Reseal entry count** is unchanged in every case: a new file under a sealed prefix is itself FOUNDER-tier.
- **`MERGE_HEAD` replaces `ENABLE_AUTO_MERGE`.** The design named `ENABLE_AUTO_MERGE`. GitHub auto-merge is not bound to the head it was armed on (#218), so arming it would let any later head merge on the `validate` checks alone. The coordinator therefore merges itself with the head SHA in the call, which is still automatic and is no slower, because the controller only acts once CI is already green. The action carries `headSha`.
- **Two controller actions were added:**
  - `DISABLE_AUTO_MERGE`: an armed auto-merge that is not proven armed on the current head is disarmed first, on every tier;
  - `REMEDIATE_REVIEW`: a negative verdict goes back to the lane.
- **No Founder-approval input.** An earlier draft accepted a caller-supplied `founderApprovedHead`. It is removed: on the shared account no record can tell a Founder approval from automation. FOUNDER tier and prior negative always end at `FOUNDER_REQUIRED`, and the Founder merges or arms personally.
- **`autoMergeArmedHead`** is the one new input. It only ever prevents a disarm (of an arm on the current head), never causes a merge.
- **A FAIL on the head blocks any PASS on the same head.** `REMEDIATE_REVIEW` for the lane, and `FOUNDER_REQUIRED` when a PASS also exists there.
- **CI must be bound to the head.** A `ciRequired` without `headSha` is `WAIT_CI` (`CI_HEAD_UNKNOWN`). A state without a valid PR number is `STATE_MALFORMED`.
- **Verdict on an older base.** A PASS bound to an older base still counts when the caller's `baseDelta` shows the base change does not touch the PR. This is a name intersection only, not an import graph. High-risk, protected and CI-executed base files always count as affecting the PR, and an empty PR file list or an empty delta counts as affecting it. This implements "update only the affected PRs".
- **More high-risk files than the design listed:** the three authority documents (also exact paths in `config/protected-paths.json`, so they are sealed) and the security gates `core/workos/risk-admission.ts`, `core/workos/secret-scan.ts`, `scripts/local-worker/sandbox.mjs` (high-risk set only).
