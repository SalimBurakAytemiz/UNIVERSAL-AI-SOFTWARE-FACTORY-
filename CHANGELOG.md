<!-- //TR: Bu dosya V3 mekanik closure ve re-audit düzeltmelerini geçmiş sürümlerden ayrıştırarak kaydeder. -->
# Changelog

## 2026-10-12 — V6 PKG-GOV2 Codex review retired completely; governed CLAUDE_REVIEWER is the only reviewer (branch)

- Founder decisions D-GOV2-1..6: Codex review removed from UASCO governance; only the governed, independent, isolated, read-only `CLAUDE_REVIEWER` reviews (fresh process, clean clone, exact commit and bundle digest, producer != reviewer identity). Tests and quality gates are preserved; nothing converts UNKNOWN/NOT_TESTED/BLOCKED/FAIL into PASS/CLEAN.
- Code: execution routing uses an independent reviewer identity that must differ from all producers; provenance requires Claude only (Codex informational); the legacy product supervisor, start-full-auto, register-autostart, control-api and install autostart are retired fail-closed (`LEGACY_CODEX_REVIEW_PATH_RETIRED`); with no active gate nothing is reviewed or merged (`REVIEW_GATE_NOT_ACTIVATED`, legacy branches `LEGACY_GATE_RETIRED`); Codex scheduling/quota fallback removed; a recorded valid historical Codex BLOCKED for the same bundle digest and cycle is still honoured.
- Config/prompts/docs: legacy Codex reviewer config and superseded dual keys labelled retired (values pinned by GOV1 kept, open decision D-GOV2-OPEN-1); `CODEX.md` -> `REVIEWER-RULES.md`, `prompts/CODEX-FROZEN-BUNDLE-REVIEW.txt` -> `prompts/GOVERNED-FROZEN-BUNDLE-REVIEW.txt`; docs name the governed `CLAUDE_REVIEWER`, Codex narrative marked as history. Trust root resealed.
- Deferred (WI-8, D-GOV2-5): `CODEX_OR_CERTIFIED_INDEPENDENT_REVIEWER` data enums, roadmap contracts and playbooks. Record: `audit/checkpoints/V6-PKG-GOV2-CODEX-REVIEW-RETIREMENT-2026-10-12.json` (review NOT_REVIEWED, no CLEAN claimed).

## 2026-10-06 — V6 PKG-GOV1 independent governed CLAUDE_REVIEWER is the required review gate (branch)

- Founder governance change 2026-10-06 ('REMOVE CODEX FROM THE REQUIRED REVIEW GATE', protected files authorized): explicit policy activation `config/orchestrator-policy.json` `reviewGate` (`CLAUDE_ONLY`, `required: ["claude"]`, `codexRequired: false`, release audit quorum `CLAUDE_FULL_REPO_REVIEW_CLEAN`); once the durable state carries the Founder record `control.finalization.reviewGovernance.model = CLAUDE_ONLY`, the engine records `control.reviewGate` with a hash-chained `REVIEW_GATE_ACTIVATED` transition, after which every open package revision and the final release audit require exactly one independent governed `CLAUDE_REVIEWER` review (Codex never scheduled; Claude CLEAN plus deterministic gates merges, Claude BLOCKED remediates with attributed findings, malformed output follows the format retry, Claude quota is a provider wait; a Codex-only CLEAN is not sufficient; the merge, packaging, signing and Phase0 gates re-derive the Claude evidence bound to the frozen bundle and also require the committed policy key); already recorded Claude results waiting for Codex are reconciled (`REVIEW_GATE_RECONCILED`), a recorded valid Codex BLOCKED is still honoured, historical Codex records, evidence and markers are kept unchanged (`historicalCodexReviews`), and without the activation the previous gate is unchanged. Tests: `tests/pkg-gov1-claude-only-review-gate.test.ts` with the `gov1-*` scenarios of `scripts/dual-review-selftest.mjs` and `scripts/release-audit-selftest.mjs`. Orchestrator-built revisions (execution provenance from the same provider as the reviewer) pass the execution merge gate under CLAUDE_ONLY on identity, process, workspace and session-order separation of `CLAUDE_BUILDER` and the canonical `CLAUDE_REVIEWER` evidence instead of on provider, so a Claude BLOCKED, then the orchestrator remediation, then a Claude CLEAN merges (real-executor regression scenario); the gate takes effect in the running supervisor only after a supervisor-level bootstrap to a control plane that contains it. The activation then releases the bootstrap supervisor's `CLAUDE_ONLY_GOVERNANCE_ACTIVE` transition holds (and does so again on any later tick while such holds remain) as one hash-chained `ACTIVATION_HOLD_RELEASED` transition with a `holdReleased` record: `notBefore` returns to the recorded previous value, an earlier `DUAL_REVIEW_ACTIVE` hold is superseded, an earlier `RELEASE_AUDIT_ACTIVE` hold counts as satisfied only with an active release audit and is otherwise put back, other holds, closed packages, Global Stop and pending Founder decisions are respected, and the released review packages are scheduled for the Claude reviewer only.

## 2026-10-06 — V6 PKG-Q2 a stated retry time just passed means now, not tomorrow (branch)

- Founder decision 2026-10-06 ('Q2 onay', protected file authorized): `parseRetryAfter` (`automation/lib/review-pipeline.mjs`) treats a date-less stated time-of-day (`try again at 12:52 PM`, and likewise the Claude CLI `resets 12:52pm`) that is at most 10 minutes in the past, boundary included, as a retry 2 minutes from now instead of the same time on the next day; a time further in the past still rolls to the next day, a future time stays today, an explicit date is unchanged and unrecognised text still returns null. Before, Codex's `try again at 12:52 PM` read at 12:52:06 was stored as a retry 24 hours later (a false stall on 2026-10-06). Tests: `tests/pkg-q2-retry-time-grace.test.ts` (the incident, 0 and 3 minutes past, exactly 10 minutes, 10 minutes and 1 second, 1 hour past, a future time, explicit dates, the `resets` form, unrecognised text); restoring the old rollover makes them fail. Details in `audit/checkpoints/V6-PKG-Q2-RETRY-TIME-GRACE-2026-10-06.json`.

## 2026-10-06 — V6 PKG-Q1 Claude limit messages detected as a provider wait (branch)

- Founder decision 2026-10-06 (protected file authorized): `detectQuotaBlock` (`automation/lib/review-pipeline.mjs`) recognises the Claude CLI limit message that the CLI prints on stdout with a non-zero exit code (for example `You've hit your session limit · resets 1:10am (Europe/Istanbul)`), and stderr messages with a word between "your" and "limit". Before, such a builder round was classified as an environment error, retried five times and escalated to a Founder decision (`RECOVERABLE_RETRIES_EXHAUSTED`, seen on PKG-AUT2 on 2026-10-05) although only the provider limit had to pass. Only short CLI limit lines at the start of a stdout line count; a successful call (exit code 0 with other output) is never a quota block. The retry time keeps coming from the existing `parseRetryAfter` (`resets 1:10am` in local time).
- Tests: `tests/pkg-q1-claude-limit-detection.test.ts` (Claude session, weekly and epoch limit messages on stdout, existing stderr forms, and negative cases: a successful review that quotes a limit message, an unrelated non-zero exit, prose mentioning a rate limit).

## 2026-10-13 — V6 PKG-LV1 re-applied onto BS1R (branch `v6/pkg-lv1-liveness-watchdog-f9`, append-only)

- Founder decision 2026-10-13: the LV1 liveness package (1f52358..5e9a610, 17 commits) is re-applied as ONE squashed commit onto `V6-PKG-BS1R-AUTONOMY-BOOTSTRAP` ef0f3bb, with both sides integrated by a single 3-way merge: the BS1R rollback of every post-registration failure (and its tests) is kept, and so is LV1's watchdog, work-conserving entry and `-Upgrade`. An upgrade that fails or is rolled back never re-enables a task the rollback disabled or removed (rolled-back state wins); the liveness test file is assigned to the new validation step `tests-lv1`.
- The 2026-10-02 LV1 entry below is the original text and describes the original (pre-BS1R) revision. Status: pending governed review; NOT CLEAN; validation evidence pending the freeze.

## 2026-10-13 — V6 PKG-BS1R autonomy bootstrap remediation (branch, append-only)

- Founder decision 2026-10-13: package `V6-PKG-BS1R-AUTONOMY-BOOTSTRAP` supersedes `V6-PKG-BS1-AUTONOMY-BOOTSTRAP`, whose governed review was BLOCKED at the review-cycle limit; BS1's records and review evidence stay untouched. BS1R is built on the BS1 cycle-3 tree (d851a4f) and is reviewed against the DR2 base 22bbbad.
- Scope: the verified rollback of every post-registration failure (task stopped, control-root processes stopped, pre-existing task restored and kept disabled, `ROLLED_BACK_TASK_NOT_RUNNABLE` / `ROLLBACK_UNSAFE`), the narrowed process match, the two terminating-error paths, and the validation sharding (`tests-bs1-a`..`e`) are unchanged; this package adds the operator documentation of that behaviour (`docs/architecture/AUTONOMY-BOOTSTRAP.md`) and a new checkpoint `audit/checkpoints/V6-PKG-BS1R-AUTONOMY-BOOTSTRAP-2026-10-13.json` that records the reviewed revision, the Founder authorizations, the digests, the test topology and the mutation evidence. No code, test or timeout changed.
- Status: pending governed review; NOT CLEAN; validation evidence pending the freeze.

## 2026-10-13 — V6 PKG-BS1 review cycles 2-3: task rollback and validation sharding (branch, append-only)

- Cycle-1 governed review finding F-BS1-CLAUDE-C1-001 (P2): a read-back mismatch after `Register-ScheduledTask` only logged and exited, leaving the supervisor task enabled on top of an activated control plane. The governed evaluator rejected it as INADMISSIBLE_BLOCKER (confidence 0.78 < 0.8); the Founder accepted it as a real security risk on 2026-10-13 and approved remediation (review-cycle limit 2 lifted for this package).
- Remediation: every failure after registration (read-back mismatch, registration/verification error, record-write failure, start failure, unreadable task state, failed or unconfirmed first run) stops the instance, terminates the entry/wrapper/launcher processes of this control root (never other processes or the bootstrap itself), restores a pre-existing task's exported definition and keeps it disabled (never deletes it) or unregisters the task the run created, records `ROLLED_BACK_TASK_NOT_RUNNABLE` or `ROLLBACK_UNSAFE` and exits 1. The activated control plane is left in place, inert without a task. Task Scheduler calls go through one controller seam; tests use a recording fake (`-TestMode -TaskControllerFixture`) and register, start, change or delete no real task. `docs/architecture/AUTONOMY-BOOTSTRAP.md` documents the semantics.
- Validation sharding (Founder decision 2026-10-13): the `tests` step is split into bounded steps `tests-bs1-a`..`e` with a mechanical coverage guard (`tests/pkg-vs-validation-sharding.test.ts`); no test was removed or weakened and no timeout changed.
- Status: governed review of cycle 3 is pending; the package is NOT CLEAN and nothing here is a review result.

## 2026-10-02 — V6 PKG-LV1 self-recovering liveness: independent watchdog and work-conserving entry (branch)

- Founder request 2026-10-02 (true self-recovering continuous execution): two-layer supervision. A new independent scheduled task `UASCO-Supervisor-Watchdog` (this user, Interactive, Limited, no stored password; logon + every 5 minutes; IgnoreNew; 15-minute limit; windowless wscript wrapper; own lock, never the worker lease or lock) restarts a supervisor that is not running or whose heartbeat or main thread is frozen; on pre-launcher planes it also restarts one that makes no progress for 8 awake hours while work is eligible, or that sleeps while work is eligible. Each recovery records evidence. At most 3 recoveries an hour with growing spacing, no destructive step right after sleep, Global Stop and legitimate waits untouched.
- Stable entry generation 2 (`scripts/uasco-supervisor-entry.mjs` with `scripts/uasco-liveness.mjs`): a worker-thread heartbeat `.ai/runtime/SUPERVISOR_HEARTBEAT.json` (state, active lane, package and child, wake time and reason, blocked lanes, provider retry times, dependency wake conditions, last progress); single-instance lock; a work-conserving loop on the plane's own engine (never sleeps with eligible work; a quota-blocked provider blocks only its lanes; bounded waits with wake reasons); dead-lease release under the single-worker lock (also at start, after a reboot); an awake-time action backstop with evidence, orphan sweep and Git-lock reconciliation; liveness fields in `WATCHDOG_STATUS.json` and `SUPERVISOR_STATUS.json`; restarts a stale watchdog; delegates only to a plane entry of the same or a newer generation.
- Bootstrap `-Upgrade`: runs alone per control root; writes an owned upgrade marker (the generation-2 entry starts no new tick unless an in-flight action must be recovered first, the watchdog stands still, a dead bootstrap's disabled supervisor task is re-enabled by the watchdog, except when no enabled watchdog task exists (the first LV1 installation, or a repair after the watchdog task was deleted or disabled), a reused PID counts as dead), waits for a safe point (no tick, no in-flight action, sleeping/waiting heartbeat) before it stops the running supervisor, checks that the marker is still its own before installing and registering, removes it before the first run, installs both tasks and confirms both first runs; otherwise it changes nothing (`SUPERVISOR_BUSY`; `UPGRADE_LAUNCHER_PLANE_UNSUPPORTED` at once on a launcher plane).
- Tests: `scripts/liveness-selftest.mjs` (22 scenarios, 11 with real supervisor processes: kill, freeze, hung main thread, livelock, sleeping with eligible work, quota wait without a storm, duplicate watchdog, storm guard, suspend grace, Global Stop, backstop at safe point and hard limit, dead lease on a real hash-chained state, safe-point decisions) and a generation-2 end-to-end entry scenario in the bootstrap selftest. Control-plane timeouts per child (`RETRYABLE_STALL`), per-child kill tests, launcher-mode liveness and a launcher-aware upgrade safe point are deferred to LV2 (governed plane code); see docs/architecture/LIVENESS.md.
- Evidence: fresh-clone canonical validation PASS on fd65ac3 (35 files, 183 tests; vitest 446 s of the 600 s step limit), tsc and the broad suite PASS; liveness selftest 22/22; 104/104 mutation checks caught; eight independent adversarial review rounds (every confirmed finding fixed or disclosed); the cycle-1 pre-activation CLAUDE_REVIEWER review was CLEAN with six advisories (three fixed in cycle 2, three disclosed); real Task Scheduler probes of both task definitions. Details in `audit/checkpoints/V6-PKG-LV1-LIVENESS-WATCHDOG-2026-10-02.json`.

## 2026-10-02 — V6 PKG-BS1 one-time autonomy bootstrap (branch)

- Founder request 2026-10-02: a single reviewed one-time bootstrap installs `UASCO-Autonomous-Supervisor`; afterwards routine work needs no Founder command.
- `scripts/bootstrap-uasco-autonomy.ps1` runs in a normal (not elevated) PowerShell: it clones the governed default-branch plane with Git isolation, verifies the trust root and the durable queue with that plane's library, installs reviewed dependencies, activates the plane under the single-worker lock (`CONTROL_PLANE_ACTIVATED`), and registers the task (this user, Interactive, Limited, no stored password, logon + every 15 minutes, hidden window). It confirms the first run from the task process and records `BOOTSTRAP_INSTALLED.json`, mirrored to `.ai/runtime/BOOTSTRAP_STATUS.json`.
- `scripts/uasco-supervisor-entry.mjs`, the stable task entry, and `scripts/uasco-supervisor-task.ps1`, the hidden wrapper: link self-repair, plane provenance and trust root before any import, delegation to a governed plane entry or the AUT2 launcher with a frozen-heartbeat kill, an AUT1B tick loop with tree kill and lock cleanup, and one governed upgrade to the first launcher plane. Once the default branch has the launcher, the old tick is never run again.
- Bootstrap selftest (19 scenarios, 67/67 mutation checks caught) with a real task-registration probe, a design critique by four independent lenses, two pre-activation CLAUDE_REVIEWER rounds and seven adversarial verification rounds of the implementation (every confirmed finding fixed; residual behaviour disclosed in docs/architecture/AUTONOMY-BOOTSTRAP.md); the release package is held until `RELEASE_AUDIT_ACTIVE`.

## 2026-10-01 — V6 PKG-DR2 final dual full-repository release audit (branch)

- Founder directive 2026-10-01, final release section: a release candidate is packaged, signed and installed only after `CLAUDE_FULL_REPO_REVIEW` and `CODEX_FULL_REPO_REVIEW` of the same immutable candidate are both CLEAN.
- New release states `AUDIT_PENDING` and `AUDIT_BLOCKED`; actions `AUDIT_FREEZE` and `AUDIT` (one per reviewer, own clean clones, same frozen full-tree bundle); the audit base is a deterministic unsigned empty-tree commit so every tracked file is in scope; the packaging, signing and Phase0 gates re-derive both audit evidences with their identities.
- Same quota, format, restart and attribution rules as package review; a blocked audit stops only the release lane; a new candidate starts a fresh audit.
- Pre-review remediation from an advisory Claude reviewer run: signing and Phase0 also refuse an unaudited release, the audit base identity is pinned in the environment, an `AUDIT_BLOCKED` release is a watchdog health reason, and the Claude reviewer prompt reminds that schema objects allow no extra properties.
- Release-audit activation: the first DR2+ tick records `RELEASE_AUDIT_ACTIVATED` once and releases packages held until `RELEASE_AUDIT_ACTIVE`, so the release package is merged only by a plane that enforces the audit.
- Release-audit selftest 13/13 with 10/10 mutation checks; orchestrator selftest follows the audit policy; trust root resealed.

## 2026-10-01 — V6 PKG-DR1 dual independent review (branch)

- Founder directive 2026-10-01: every governed review package frozen after the activation commit is reviewed by `CLAUDE_REVIEWER` and `CODEX_REVIEWER`; integration requires both CLEAN on the same frozen bundle, any valid BLOCKED blocks, malformed output is never CLEAN and a quota block produces no result and consumes no cycle.
- `CLAUDE_REVIEWER` is a separate Claude process and session (restricted mode, read-only tools, no MCP, no session persistence, pinned model, reviewer system prompt) in its own clean review clone, started from the reviewed control plane; its identity is separate from `CLAUDE_BUILDER` and its evidence is re-derived with that identity at the merge gate.
- Findings of both reviewers are aggregated with provider attribution; a new commit or bundle makes both gates stale; separate quota states for the Claude reviewer, the Codex reviewer and the builder; historical Codex-only CLEAN evidence stays valid and open packages get the Claude review in addition.
- The Claude reviewer has no command execution: the supervisor gives it its deterministic STEP 1 precheck, the exact diff and the changed-file list as read-only inputs in its review clone (found by the first live advisory run, which returned ENVIRONMENT_BLOCKED without them).
- Pre-review remediation from an advisory Claude reviewer run of this package: a historical Codex-only CLEAN seeds the Codex gate only while the package is still REVIEW_CLEAN for the same cycle and bundle, and the Founder manual quota reset also accepts the `claudeReviewer` provider state.
- Activation holds: a package held until `DUAL_REVIEW_ACTIVE` (hold plus far-future `notBefore`, honoured by every older plane for every action) is released only by the activating DR1+ plane, so it can never be reviewed or merged with Codex alone.
- Dual-review selftest 20/20 with mutation checks; trust root resealed.
- Cycle-1 review remediation (F-DR1-001..003):
  - The next-cycle ledger merges entries only when their canonical fingerprint is identical and keeps the retest obligations of both, so distinct blockers on the same file, symbol and category are never dropped.
  - A revision committed after activation replaces a `CODEX_ONLY_HISTORICAL` marker with `DUAL`; the old marker is kept bound to its revision, so scheduling and the merge gate need both reviewers.
  - A pending reviewer whose provider is quota-blocked no longer delays remediation of a valid BLOCKED; CLEAN still needs every required reviewer.
  - The selftest now has 23 scenarios.

## 2026-10-01 — V6 PKG-M1 provenance test timeout (branch, maintenance)

- The process-spawning case "keeps a launcher with a non-matching version output LAUNCHER_ONLY and BLOCKED" in `tests/pkg-d-standalone-provenance.test.ts` runs with a 120 s per-test limit instead of vitest's 5 s default (its own capture process may take up to 60 s); assertions and provenance semantics are unchanged.

## 2026-09-29 — V6 PKG-R4 Phase0 git-baseline native probes (branch)

- The second target-machine Phase0 attempt (release `ca21e83`) stopped at git-baseline: under `$ErrorActionPreference="Stop"` Windows PowerShell 5.1 turned the redirected stderr of `git remote get-url origin` on a fresh repository into a terminating NativeCommandError (PHASE0-F4); nothing was pushed.
- `scripts/init-private-git.ps1` now runs the origin and `gh repo view` probes with a scoped `Continue` restored in `finally` and decides only by the exit code; the probe output is discarded; every privacy refusal, Git isolation, the push check and the remote SHA verification are unchanged. Trust root resealed in the same commit.
- Regression on Windows PowerShell 5.1 with a real temporary repository and a local bare remote (negative control, fresh push with SHA verification, set-url rerun, refusal without the override); the original script fails it.
- Status documents record the chain this package sits on: PKG-AUT1B cycle 2 CLEAN and merged; PKG-T2 closed without merge and succeeded by PKG-T2B (Founder decision); the chain re-frozen on PKG-D1 (source-map-js 1.2.2), with PKG-T2B, PKG-T1, PKG-T3 and PKG-T4 reviewed CLEAN on it, PKG-AUT2 cycle 1 BLOCKED at `fc530eb` (F-AUT2-001..004) and cycle 2 `99b1f0a` CLEAN, and PKG-D2 (shell-quote 1.11.0) CLEAN by the governed CLAUDE_REVIEWER, all merged into local master; PKG-R4 cycle 1 BLOCKED by the governed CLAUDE_REVIEWER (F-R4-REVIEW-001, these status lines), cycle 2 pending.

## 2026-09-29 — V6 Autonomy Hardening: UASCO-Autonomous-Supervisor (branch)

- The repository-native supervisor runs as a durable daemon: Task Scheduler (`UASCO-Autonomous-Supervisor`: logon, periodic heartbeat, restart on failure, single instance, no time limit, user level, no stored password; startup only for an elevated S4U registration) -> narrow launcher -> `uasco-orchestrator.mjs --daemon`.
- Between ticks the daemon waits in `WAITING` until the nearest of ready work, provider retry, dependency backoff or the heartbeat; the wake file and Global Stop end the sleep; an atomic heartbeat records its state; `--self-check` verifies an activation.
- A committed builder round is adopted after a crash (no second builder call or commit); Git command contracts run with the repository Git isolation; Phase0 registers the installed system's autostart as `UASCO-Installed-Supervisor`.
- The supervisor maintains `.ai/runtime/WATCHDOG_STATUS.json` atomically (supervisor state, heartbeat, master, active package, queue counts, blocked lanes, Codex quota, signer, Phase0, last and next action, Founder decisions, overall health) from its own read-only discovery of git refs, worktrees, scheduled tasks, the transition log and provider retry state; the Claude app routine runs no command and only reads that file (Founder directive 2026-09-30).
- A wake request that arrives while a tick runs is no longer lost; Git contract isolation now comes from PKG-AUT1B cycle 2.
- Governed self-upgrade (Founder decision 2026-10-01): the supervisor switches the scheduled task's `control\current` link to a newer control plane only for a governed-CLEAN fast-forward merge that changes the control plane and whose sealed trust root verifies; the previous plane is kept.
- Tests A-L, N plus lifecycle with real processes (autonomy-hardening selftest 17/17); the Claude app routine is a passive display only.
- Review cycle-1 remediation (F-AUT2-001..004):
  - A committed builder round is recognised from git before the implementation clone is reset: single parent equal to the base, the orchestrator committer and the round subject. A crash before or during the round-marker write, or a torn marker, no longer causes a second builder call. The marker is written atomically.
  - The scheduled task runs a stable entry, `control\uasco-supervisor-entry.mjs`. It repairs an interrupted `control\current` switch, which is journaled in `SWITCH.json` with the old link kept as `current.prev`, and then loads the launcher through the link.
  - Global Stop is rechecked live right before activation, and an upgrade is `DEFERRED` while it is active.
  - A failed installed-autostart registration is retried on its own lane (bounded backoff, `AUTOSTART` action, no reinstall). It becomes `REGISTRATION_BLOCKED_RETRIES_EXHAUSTED` after 5 attempts, and the accepted installation is kept.
  - New regression scenarios: autonomy-hardening selftest F-AUT2-001/002/003, plus the executor-integration Phase0 registration scenario.

## 2026-09-29 — V6 PowerShell Safety and Verifier Differential Tests (branch)

- Every PowerShell script is parsed with the Windows PowerShell 5.1 parser (no errors, no Invoke-Expression) and checked against safety rules (no EncodedCommand, DownloadString/DownloadFile or persistent Set-ExecutionPolicy; entry scripts stop on error; web requests only where allowlisted and without redirects).
- Differential test of the two install-time artifact verifiers: both reject content tamper, a missing file, a manifest without the lockfile and an unsafe path; an unlisted file is rejected by the Node verifier (the PowerShell verifier does not check it; recorded as LOW finding F-T4-001).
- Positive control for the parse-error and Invoke-Expression detectors: synthetic scripts written to a temporary directory (a syntax error, Invoke-Expression, the iex alias) must be reported by the same parser detector that scans the real scripts, and a compliant script must report nothing; a blinded detector now fails the selftest (F-CLAUDE-T4-C1-001).
- Safety rules take compliance evidence only from parsed code (F-T4-C1-001, F-T4-C1-002): the PowerShell 5.1 parser now also returns each command with its parameters and argument values and each assignment. A web request in the allowlisted script needs a real `-MaximumRedirection` parameter whose value is the integer literal `0`, so `01`, `0x0`, `$x`, `'0'`, a comment, or text inside another parameter's string no longer count. `Set-ExecutionPolicy` needs a real `-Scope Process` parameter. An entry script needs an unconditional top-level `$ErrorActionPreference = "Stop"` (or `'Stop'`); an assignment in a comment, a string or a function body no longer counts. Request or policy names that appear only in comments or strings are reported. The prohibited-text rules (EncodedCommand, DownloadString/DownloadFile, pipe to Invoke-Expression) still scan the raw source, so they still catch code passed to child shells as strings. A new regression scenario runs the Codex reproductions, variants from the same family and positive controls for EncodedCommand, DownloadString/DownloadFile and pipe to Invoke-Expression (all must be reported), plus compliant controls (none may be reported); the selftest now reports PASS 7/7.

## 2026-09-29 — V6 OmniRoute Install Compatibility Test (branch)

- Read-only verification of the installed OmniRoute against config/omniroute-policy.json on the target machine (identity, license, repository, Node engines range, launcher location, local-only endpoint); OmniRoute is not started and a stopped endpoint is reported as NOT_RUNNING; machines without OmniRoute skip honestly.
- F-T3-003: a failure of the selftest's own `npm root -g` measurement (non-zero exit, unresolvable or unspawnable npm, timeout, signal, or output that is not exactly one absolute existing directory) now reports `FAIL NPM_ROOT_UNAVAILABLE` with a non-zero exit instead of `SKIP NOT_INSTALLED`; the honest skip is kept only for a working npm whose resolved global root has no OmniRoute package.

## 2026-09-29 — V6 Windows Crash/Resume Tests (branch)

- Real child processes on the target Windows machine prove process-lock takeover after a kill, a single winner among concurrent invocations, fail-closed unreadable/foreign-host locks, orchestrator resume after a worker is killed mid-action (lease expiry, in-flight recovery, no duplicate provider call) and auditable recovery from a corrupted state file.

## 2026-09-29 — V6 Orchestrator Executor Integration Tests (branch)

- The unattended orchestrator executors are exercised against real temporary git repositories: fast-forward merge with CLEAN evidence (non-FF, missing, mismatched and BLOCKED evidence refused), adoption of completed reviews, releases, signatures and installations without provider or script calls, signer waits, Phase0 guards and builder-round rejection of out-of-scope, unauthorized protected and trust-manifest edits.

## 2026-09-29 — V6 Unattended Orchestration (branch, activation after review)

- Repository-native unattended supervisor `scripts/uasco-orchestrator.mjs` under Windows Task Scheduler (`scripts/register-orchestrator-autostart.ps1`, user level, single instance).
- Durable `control` state with a hash-chained transition log, lease/heartbeat, in-flight recovery and idempotent executors (no duplicate reviews, merges, packaging or signing after a restart).
- Codex quota automation: verbatim evidence, parsed retry time, no cycle consumption, one controlled probe at the due time, Founder manual reset support, independent work continues.
- Narrow command contracts, review pipeline moved into reviewed code, dependency-aware lanes, Founder decisions scoped to the affected item.
- Release packaging, ssh-agent-only signing (`WAITING_FOR_SECURE_SIGNER` until the key is loaded) and Phase0 with preserved failed attempts; honest GitHub and cloud status.

## 2026-09-29 — V6 Dual Execution Fabric (branch, merge held)

- Execution backend registry (`config/execution-backends.json`) with `LOCAL_CLAUDE` and `CLAUDE_CLOUD_SESSION` and routing modes `AUTO` (default), `LOCAL_ONLY`, `CLOUD_PREFERRED`, `CLOUD_ONLY`.
- Fail-closed routing engine (`automation/lib/execution-routing.mjs`): host-bound work stays local, private-key release signing is Founder-only, unknown availability counts as unavailable, fallback only where policy allows, otherwise queued; no invented billing or credit API.
- The supervisor routes before the builder, records execution provenance and runs a merge gate (independent non-producer CLEAN review, isolated branch) before every fast-forward merge.
- Cloud dispatch stays `NOT_CONFIGURED` until a documented Claude product method is approved; cloud execution is never faked.

## 2026-09-28 — V6 Phase0 Attempt 1 Fixes

- The first target-machine Phase0 attempt stopped at bootstrap; nothing was pushed.
- `validate-runtime-contracts.mjs` isolates its fixture from the installer's `UASCO_INSTALL_ID` and still asserts that an env/ledger mismatch is rejected.
- `install-report.mjs` imports `node:crypto`, so `INSTALL_REPORT.json` is written.
- The builder policy uses `acceptEdits` for edits inside the working directory only; the tool set stays Read/Edit/Write/Glob/Grep and shell, web, subagents and MCP stay denied.
- New reseal and release candidate; the previous ZIP and signature are superseded.

## 2026-09-28 — V6 Sealed Release Candidate

- PKGR-F1: the doc-truth validators rejected every sealed release although `install.ps1` validates inside the extract; they now follow the trust-root seal status with a fail-closed `SEALED` release-candidate mode (in-process trust-root re-verification, `SHA256SUMS.txt` bound to the sealed manifest, no signature anywhere in the tree, no PASS values).
- Protected release tools: `release-sha256sums.mjs`, deterministic `build-release-zip.mjs` and `verify-release-extract.mjs` (Windows Expand-Archive, unchanged artifact verifiers, optional reviewed-lock install and canonical validation in the fresh extract).
- Final trust-root reseal in the release-candidate commit. Next: SHA256SUMS, ZIP, fresh-extract verification, Founder signature, target-machine Phase0.

## 2026-09-28 — V6 Target-Machine Phase0 Prerequisites

- Every canonical validation script is protected by exact path in `config/protected-paths.json`, and mechanical closure fails if one is not (TRUST-F1).
- Windows preflight measures installed physical RAM (`Win32_PhysicalMemory`) with the 16 GB threshold unchanged; with the Windows Time service running, target preflight PASS (PKGA-F8).
- Live provider smoke PASS through the Claude builder and Codex reviewer brokers.
- Open P0/P1/P2 findings: 0. Next: final reseal, SHA256SUMS, external signature, final ZIP, fresh-extract verification, then target-machine Phase0.

## 2026-09-28 — V6 Dependency-Aware Environment Gate

- Reviewed `package-lock.json` generated on Node 24.19.0 / npm 11.17.0; pins corrected (typescript 5.9.0 did not exist) and bumped to clear all moderate+ advisories; `npm audit` 0 findings.
- Windows `npm.cmd` EINVAL fixed with a shell-free node + bundled npm-cli.js invocation; missing `.d.mts` declarations and Ajv NodeNext interop fixed; canonical validation 34/34 PASS on the target machine.
- Release supply-chain accepts only host-excluded, lock-optional platform packages with integrity, registry and license evidence.
- `.gitattributes` pins LF so Windows `autocrlf` clones keep committed digests; Electron smokes launch shell-free.
- Provider provenance accepts verified `STANDALONE_LAUNCHER` installs; the canonical Codex reviewer broker now runs on this machine.
- Explicit checksum-verified Electron provisioning step: the binary is bound file by file to the archive pinned by the locked `checksums.json`; Desktop and Control Tower smokes PASS.
- The `//TR` source scan skips the gitignored `.ai/cache/` machine cache.
- Every package was reviewed independently by Codex through a frozen milestone contract and review bundle; records are in `audit/reviews/`.

## 2026-09-20 — V3 Mechanically Closed / Re-Audited

- V2 re-audit P0 bulguları source starter seviyesinde kapatıldı.
- Builder tool-policy sandbox + boundary canary, Action Broker, Git metadata guard, per-worktree dependency tree, package lifecycle guard eklendi/sertleştirildi.
- Codex prior-blocker omission, moving-goalpost causal proof, stable finding fingerprint, accepted-debt/waiver ledger ve governed signed attestation eklendi.
- V3 re-auditte bulunan yeni bypass kapatıldı: current BLOCKER yalnız `OPEN` olabilir; aynı cycle içinde `RESOLVED/DOWNGRADED/DUPLICATE` ile CLEAN üretilemez.
- 258/258 technical agent primary technology mapping taşıyor; 363-role semantic validator genişletildi.
- 22 physical domain pack seed profile eklendi.
- Technology universe 415, depth assignments 6114, schema 152.
- Evidence key Windows ACL hardening, provider-specific env policy, exact launcher provenance, filesystem boundary, secret/supply-chain baseline ve remote protection refresh eklendi.
- Source re-audit sonucu: yeni source-level P0 mekanik blocker bulunmadı; target-machine Phase0 hâlâ zorunlu.

## 2026-09-20 — Mechanically-Closed V2

- 149 phase contract'ın generic deliverable/validation/evidence/review/exit alanları phase-specific hale getirildi.
- One-click installer step ledger + INSTALL_REPORT eklendi.
- Control API/Control Tower install state ve package retry görünürlüğü eklendi.
- Dependency-free mechanical kernel self-test canonical validation zincirine eklendi.
- Phase0 acceptance mechanical self-test, review-package scheduler ve install ledger'i fail-closed kontrol ediyor.
- Mechanical closure validator install/report/selftest/review-package wiring'i çapraz doğruluyor.
- Latest mechanical red-team audit + fix ledger + Installation GO checklist canonical artifact'e eklendi.


## 2026-09-20 — Full Woven Canonical Starter

- 363 stable agent korunuyor.
- 363 canonical V2 agent genome yeniden üretildi.
- 363 agent evaluation contract oluşturuldu.
- 40 department technical charter oluşturuldu.
- 425 gerçek engineering/business skill içeren V2 skill ontology oluşturuldu.
- 393 seed technology profile içeren Technology Knowledge Graph oluşturuldu.
- Her teknoloji için ayrı knowledge-unit contract dosyası oluşturuldu.
- 194 tool/provider adapter kayıtlı.
- Multi-pack competency model eklendi.
- 12 eksenli agent↔technology depth modeli eklendi.
- Specialist→Lead→Principal→Head→Council→Independent review graph eklendi.
- Dynamic Unknown Technology Discovery lifecycle eklendi.
- 149 roadmap phase'ın tamamına entry/deliverable/test/evidence/review/exit contract eklendi.
- Schema baseline strict `additionalProperties:false` hale getirildi; toplam 141 schema.
- Role semantic validator eklendi.
- Woven model validator eklendi.
- Flutter/React Native/iOS generic Android inheritance hataları canonical V2 matrix'te kaldırıldı.
- Action Gateway, approval binding, DLP ve competency certification Day-0 runtime skeleton'ları eklendi.
- CI ilk private commit öncesi lockfile üretimi modeline göre sertleştirildi.

## Truth

Bu sürüm full runtime implementation iddiası taşımaz.
`REGISTERED != KNOWN != SKILLED != CERTIFIED != CURRENT != AUTHORIZED != VERIFIED`.
