<!-- //TR: Bu belge Founder'ın 2026-10-01 çift bağımsız inceleme talimatının (CLAUDE_REVIEWER + CODEX_REVIEWER) uygulamasını tanımlar: bağımsızlık, kimlikler, yeter sayı, bulgu birleştirme, remediation, kota, etkinleştirme ve testler. -->
# Dual independent review

Every governed review package frozen after the activation commit is reviewed by two independent reviewers: `CLAUDE_REVIEWER` and `CODEX_REVIEWER`. Producer and reviewer are always different identities; the builder never reviews its own work.

```
CLAUDE_BUILDER -> deterministic validation -> checkpoint -> implementation commit -> frozen review bundle
  -> CLAUDE_REVIEWER review   (own clean review clone, same frozen bundle and prompt)
  -> CODEX_REVIEWER review    (own clean review clone, same frozen bundle and prompt)
  -> quorum -> remediation (findings of both, with attribution) -> re-review by both -> integration gate
```

## Independence of CLAUDE_REVIEWER

- **Separate process and session.** `scripts/claude-reviewer-broker.mjs` starts a new `claude -p` process for every review. It never passes `--continue`, `--resume` or a session id, and runs with `--no-session-persistence`. Builder session variables are not inherited: the child gets the minimal provider environment of `config/environment-policy.json`.
- **Isolated input.** The reviewer runs in its own clean review clone at the exact reviewed commit, with the frozen bundle and prompt placed by the supervisor. The precheck verifies the base, the reviewed commit, the recomputed bundle digest, the contract digest and the changed files before the call.
- **Read-only and narrower than the builder.** `config/reviewer-execution-policy.json` sets restricted mode, which removes command-running tools, ignores user/project/local settings and confines file tools to the review clone. It allows only `Read`, `Glob` and `Grep`. Edits, writes, shell, web, subagents, skills and MCP are denied. After the call, the supervisor rejects the result if the review clone changed (`REVIEW_WORKTREE_MODIFIED_BY_REVIEWER`).
- **Input verification without commands.** The Claude reviewer cannot run git or hash commands. Before the call, the supervisor performs the deterministic STEP 1 checks (recomputed bundle and contract digests, both commits, changed files against `git diff --name-only`) and stops on any failure. It then places three read-only inputs in the ignored `.ai/cache/review/reviewer-input/` directory of the review clone: `precheck.json`, `diff.patch` (the exact `base..reviewed` diff) and `changed-files.txt`. Their hashes go into the run manifest. The reviewer verifies what it can by reading (identity fields, checkpoint requirements, diff against `changedFiles`) and returns `REVIEW_INPUT_INVALID` on any contradiction. The Codex reviewer still verifies STEP 1 itself; its contract is unchanged. The first live run without these inputs returned `ENVIRONMENT_BLOCKED`, which is why they exist.
- **Reviewer code comes from the control plane.** The broker, its policy and the system prompt (`prompts/CLAUDE-REVIEWER-SYSTEM.md`) are taken from the running, reviewed control plane (`node.claudeReviewer` contract), not from the package under review.
- **Adversarial prompt.** Both reviewers get the same frozen review prompt. The Claude reviewer additionally gets a system prompt that defines its role and an adversarial checklist (correctness, regressions, trust boundaries, fail-open behavior, provenance, evidence spoofing, races, restart/idempotency, quota, permissions, injection, traversal, credentials, signing keys, Git, release integrity, test gaps, false CLEAN, stale state, Windows, supply chain).

## Identities and provenance

`config/automation.json` declares `builder.identity = CLAUDE_BUILDER` and `reviewers.claude.identity = CLAUDE_REVIEWER` / `reviewers.codex.identity = CODEX_REVIEWER`. Each run manifest records:
- the reviewer identity, provider, tool and process boundary (`CANONICAL_CLAUDE_REVIEWER_BROKER` or `CANONICAL_CODEX_REVIEWER_BROKER`);
- base and reviewed commit, bundle digest and prompt digest;
- launcher provenance, broker/policy/system-prompt digests, the configured model and the observed model/session;
- start and finish time, exit code and output digests.

The governed evaluation of a Claude review requires all of the following:
- a builder identity different from the reviewer;
- an Anthropic Claude reviewer;
- `independenceStatus = SUFFICIENT`;
- an observed model equal to the configured model (or a dated release of it).

The Codex checks are unchanged. Evidence is re-derived with the reviewer identity at the merge gate; Codex evidence can never stand in for the Claude review or the other way round.

## Quorum

| CLAUDE_REVIEWER | CODEX_REVIEWER | Aggregate |
|---|---|---|
| CLEAN | CLEAN | CLEAN (`dualReviewClean`) |
| CLEAN | BLOCKED | BLOCKED |
| BLOCKED | CLEAN | BLOCKED |
| BLOCKED | BLOCKED | BLOCKED |
| INVALID (format retries exhausted) | any | REVIEW_INVALID -> Founder decision, never CLEAN |
| quota / unavailable | any | pending; no CLEAN is fabricated |

A BLOCKED result waits for the other reviewer while that reviewer can still run. If the other reviewer is quota-blocked, remediation starts with the findings available, so the queue does not stall. No reviewer can overrule another's valid finding.

## Findings and remediation

Findings of both reviewers are aggregated. They are merged only when file, symbol and category are identical. Each provider's attribution and independent evidence is kept. The builder receives these governed findings only. The next cycle's ledger contains both reviewers' governed ledgers with provider-namespaced ids (`F-CLAUDE.*`, `F-CODEX.*`), and both reviewers see it unchanged.

A remediation commit or a refrozen bundle makes both gates stale: the gate is keyed by bundle digest and cycle, so both reviewers review the new revision. The two-cycle limit applies per package revision, not per reviewer.

## Quota and retries

- **Separate quota states.** `providers.claudeReviewer` (Claude reviewer), `providers.codex` (Codex reviewer) and `providers.claude` (builder) are tracked separately.
- **Retry timing.** A usage-limit response becomes provider-block evidence (`environment-block.json` with the reviewer identity). It consumes no review cycle and no format retry, and is retried automatically at the provider's stated time or after the policy backoff. Claude CLI formats (`…|<epoch>`, `resets 3pm`) are parsed.
- **Independent progress.** Unrelated work and the other reviewer continue meanwhile.

## Order, restart and duplicates

Reviews run sequentially within a tick, after the commit is immutable and the bundle digest is recorded. Parallel execution is not used: it would not change the inputs, but sequential execution keeps a single worker, a single in-flight marker and simple recovery. A finished provider call is adopted by reviewer identity, bundle digest, cycle and prompt instead of calling the provider again, so restarts never duplicate a reviewer run.

## Activation and history

- **When it switches on.** `DUAL_REVIEW_REQUIRED` is activated once, when the supervisor first runs a control plane whose policy sets `review.dualReviewRequired`. The activation and the control-plane commit are recorded as `control.dualReview` and a `DUAL_REVIEW_ACTIVATED` transition.
- **Historical evidence.** Packages closed earlier keep their Codex-only CLEAN evidence, which stays valid.
- **Open packages.** An open package that is already Codex-CLEAN on its current bundle keeps that result and receives the missing Claude review before it can merge.
- **Held packages.** A package that must not be reviewed or merged before activation carries `hold: {until: "DUAL_REVIEW_ACTIVE"}` and a far-future `notBefore`. Every older plane skips a package with a future `notBefore` for every action, and a DR1+ engine never acts on a held package. The activating plane releases these holds in the same tick (`ACTIVATION_HOLD_RELEASED` in the transition log), so such a package is reviewed by both reviewers from the start. A hold for another activation (for example `RELEASE_AUDIT_ACTIVE`) is left untouched.

## Model and authentication

The reviewer uses the currently authenticated Claude Code installation. No API key is introduced. The model is pinned in `reviewers.claude.model` to the exact id observed from the installation. There is no fallback unless one is explicitly configured, so the reviewer identity never changes silently. An unavailable model fails closed.

## Not covered here

The final release closure audit — `CLAUDE_FULL_REPO_REVIEW` plus `CODEX_FULL_REPO_REVIEW` of the same immutable candidate, both CLEAN — is the follow-up package PKG-DR2.
