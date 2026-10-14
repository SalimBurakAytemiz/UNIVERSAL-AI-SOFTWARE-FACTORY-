<!-- //TR: Bu dosya UASCO'nun gözetimsiz inşa orkestratörünü tanımlar: kalıcı kuyruk, Task Scheduler ile kendiliğinden devam, sağlayıcı kotası otomasyonu, bağımlılık farkında hatlar, dar komut sözleşmeleri, güvenli imza sınırı, dürüst GitHub/cloud durumu ve Founder'a yalnız gerçekten yeni yetki sınırlarında başvurma. -->
# Unattended Orchestration

The construction work on this repository continues without a human operator. `scripts/uasco-orchestrator.mjs` is the repository-native supervisor, registered in Windows Task Scheduler as `UASCO-Autonomous-Supervisor`. The chain is Task Scheduler -> stable entry (`control\uasco-supervisor-entry.mjs`) -> narrow launcher (`scripts/uasco-supervisor-launcher.mjs`, loaded through the `control\current` link) -> durable loop (`uasco-orchestrator.mjs --daemon`). The Claude app routine is only an optional passive display: it runs no command at all and only reads `.ai/runtime/WATCHDOG_STATUS.json`, which the supervisor writes. It never runs reviews, remediation, merges, releases, signing, activation or repairs and is never part of the execution path. The supervisor works with every routine disabled.

## Supervisor daemon

- **Durable loop.** The daemon holds the orchestrator process lock for its whole life. Each iteration re-verifies the control-plane trust root, checks Global Stop and runs one tick (`createTick` in `automation/lib/orchestrator-daemon.mjs`, shared with `--tick`).
- **WAITING.** Between ticks the daemon sleeps until the nearest of: ready queued work (no sleep), a provider `retryAfter`, a package or release `notBefore` (dependency backoff, signer re-check), an installed-autostart registration retry, or the periodic heartbeat (15 minutes). Sleep never exceeds 60 minutes. Founder-pending items never wake it.
- **Early wake.** Touching `%LOCALAPPDATA%\UASCO\orchestrator\supervisor\WAKE` or activating Global Stop ends the sleep at once. A tick that makes no progress is retried after 60 seconds instead of spinning.
- **Heartbeat.** `supervisor\SUPERVISOR_HEARTBEAT.json` records the worker, pid, state (`STARTING`, `RUNNING`, `WAITING`, `STOPPED`), the next wake time and its reason. It is refreshed at least every minute while waiting; a running tick may take up to the tick limit.
- **Exit codes.** 0: clean stop (Global Stop). 2: fatal trust or configuration error, not restarted. 3: another worker already holds the lock. Anything else is a crash.
- **Launcher.** It starts only the fixed daemon command, without a shell, and appends its output to a bounded log in `logs\`. A crashed daemon is restarted after 5, 15, 60, 300, then 600 seconds; the delay resets after 10 healthy minutes. After 6 restarts in an hour the launcher exits and leaves recovery to the next periodic trigger. Clean stops, fatal errors and "already running" are not restarted.
- **Scheduled task.** The action runs `node control\uasco-supervisor-entry.mjs --repo <repo>` with the `control` directory as working directory, so no part of the action depends on the `control\current` link existing at that moment. Triggers: logon of the current user and a periodic heartbeat every 15 minutes. Settings: single instance (`IgnoreNew`), no execution time limit, restart on failure 3 times at 1-minute intervals, user level (`Limited`), no stored password. A startup trigger is added only when the registration runs elevated, as an S4U task without a stored password; otherwise it is reported as not applicable. The registration refuses to overwrite a same-named task that belongs to another program.
- **Installed system.** Phase0 runs `install.ps1 -SkipAutoStart`; the installed system's own autostart is then registered under `UASCO-Installed-Supervisor`, so it can never replace the construction supervisor's task. The registration is its own lane on the release (`autostart`): a failed registration keeps the accepted installation (`PHASE0_DONE`, dependents unlocked) and is retried by an `AUTOSTART` action after 5, 10, 20, ... minutes. The retry runs only the installed copy's registration script for the accepted release; it never extracts, reinstalls or moves the installation. After `phase0.maxAutostartRegistrationAttempts` (5) failed attempts the lane becomes `REGISTRATION_BLOCKED_RETRIES_EXHAUSTED`, which is visible in the control state and in the watchdog status (`phase0.installedAutostart`) and is not retried again.
- **Passive watchdog status.** The supervisor writes `.ai/runtime/WATCHDOG_STATUS.json` atomically with every heartbeat: supervisor state and heartbeat age, current master, active package, implementation and review queue counts, blocked lanes, Codex and Claude quota/retry, signer, Phase0, last successful action, next scheduled action, pending Founder decisions and an overall health (`HEALTHY`, `WAITING_PROVIDER`, `FOUNDER_DECISION_REQUIRED`, `STOPPED`, `UNHEALTHY`). It performs the discovery itself with read-only contracts: default-branch and branch heads, `git worktree list`, the scheduled-task state of `UASCO-Autonomous-Supervisor` and `UASCO-Installed-Supervisor` (a fixed, locale-independent `Get-ScheduledTask` query), the verified transition log and provider retry state. Discovery is refreshed every 5 minutes and after each tick; a failed probe is reported as `UNAVAILABLE`, never guessed. Writing the file never blocks execution.
- **Governed self-upgrade.** The scheduled task starts the supervisor through the fixed link `%LOCALAPPDATA%\UASCO\orchestrator\control\current` (created by the registration script), reached through the stable entry `control\uasco-supervisor-entry.mjs`. After a tick that merged a package, and at daemon start, the supervisor checks whether the default-branch tip is a governed-CLEAN fast-forward merge recorded in the control state, descends from the running plane and changes a protected control-plane file (the running plane's sealed manifest). Only then it prepares `control\<commit>` through exact contracts (local clone, detached checkout, the reviewed lock — copied offline from the running plane when identical — and `verify-trust-root`), switches the link to it, records `control\CURRENT.json` and a `CONTROL_PLANE_UPGRADED` transition, and exits with code 4; the launcher does not restart the old plane and the next scheduled trigger starts the new one. A plane whose sealed trust root does not verify is never activated, the previous plane is kept for rollback, and Global Stop or an action in flight postpones the switch (Founder decision 2026-10-01). Global Stop is checked twice: from a snapshot when the upgrade is planned, and again live after the final `verify-trust-root` command, immediately before the first filesystem change. If it is active then, the upgrade returns `DEFERRED` and changes nothing (no link, entry, journal or record change); the next authorized check repeats it. An upgrade without a live stop check is refused.
- **Crash-safe link switch.** Windows cannot rename a directory link over an existing one, so the switch has a short window in which `control\current` is absent. The switch stages `current.next`, writes the journal `control\SWITCH.json` atomically (previous and new target and the record to write), moves the old link to `current.prev`, moves `current.next` to `current`, and only then writes `CURRENT.json` and removes the journal. If the final move fails, it is rolled back in place. Every start of the scheduled task first runs the recovery in the stable entry. If `current` is missing or dangling, the entry restores the plane that was running before the interrupted switch (`current.prev`, the journal's previous target or the `CURRENT.json` record); the staged plane is used only when there was no previous plane. That plane then repeats the upgrade. If `current` is healthy but a journal remains, the record is finalized from the journal. Real directories are never deleted, and with no candidate the entry fails without inventing a link. Each recovered daemon re-verifies its own sealed trust root before it acts. The daemon's upgrade check runs the same recovery as defense in depth.
- **Crash adoption.** A review whose provider call finished is adopted (or evaluated) instead of calling the reviewer provider again. A committed builder round is recognised from git itself, before the implementation clone is reset to the base. The clean clone's HEAD (or, if there is no clone or its HEAD is the base, the package branch tip) is adopted only if its single parent is exactly the round's base, its committer is the orchestrator identity and its subject is that package's, mode's and cycle's round subject. An adopted round needs no second builder call or commit and starts no extra review cycle. The round marker only records the start time and is written atomically; a crash before or during its write, or a torn marker, does not affect adoption. A clean clone whose HEAD is not recognised is not adopted and not deleted; it is renamed and kept as evidence.

## Loop

```
durable queue -> recover state -> next eligible package -> execution backend
-> Claude implementation -> deterministic validation -> checkpoint -> commit
-> frozen review bundle -> independent review gate (one CLAUDE_REVIEWER once the PKG-GOV1 gate is active) -> governed evaluation
-> CLEAN: fast-forward (when policy allows), evidence, continue
-> BLOCKED: package-scoped remediation -> regression -> commit -> new bundle -> re-review
-> PROVIDER QUOTA: environment block + retryAfter -> other independent work -> retry at due time
-> next package / release -> SHA256SUMS -> deterministic ZIP -> fresh extract -> signing -> Phase0
```

## Durable state and recovery

- `ORCHESTRATOR_STATE.json` `control` section (version 2.0.0) is authoritative for recovery. It records:
  - packages: kind, status, branch, base, implementation and review commits, cycle, frozen bundle digest, review evidence, merge policy, execution backend and provenance, next action, blocked reason, and classification;
  - releases, providers (status and retryAfter), Phase0 attempts, and GitHub status.
- **Atomic, auditable transitions.** Every transition is first appended to the hash-chained `orchestrator-transitions.jsonl`, then written atomically. The log is strictly linear: each entry is the previous entry's seq + 1 and links to its hash, so replayed, duplicated or out-of-sequence entries are rejected. If the process dies between the append and the state write, the next transition links to that last entry and names it in `recoveredFrom`/`voids`, so the unapplied entry stays auditable and the chain never forks. A tick refuses to run if the chain, a reconciliation entry or the state link is broken.
- **One active worker.** A process lock (`acquireProcessLock`) and a lease with heartbeat guarantee it. An expired lease is taken over and logged as stale.
- **Idempotent actions.** An interrupted action is recovered by re-planning, because the executors never redo completed work:
  - a finished reviewer run (historically Codex; now `CLAUDE_REVIEWER`) for the same bundle digest, cycle and prompt, whose output still matches its manifest hash, is adopted instead of calling the provider again. The governed decision is always re-derived from that unchanged output and the frozen bundle; a cached `governed-result.json` is never trusted. The adopted run is evaluated in a review tree prepared with git only (no dependency or provenance scripts), and the placed bundle must match the package's frozen bundle digest, base, reviewed commit and cycle. An unfinished call is repeated. Every provider call gets its own run directory;
  - a merge whose target is already the default branch is recognized as done. The merge gate re-derives the governed decision from the recorded reviewer output and frozen bundle, not from the stored `governed` field, and requires that evidence to be for the package's exact frozen bundle (digest, base, reviewed commit, cycle) before any git operation;
  - a release is adopted only when its release directory is intact (ZIP and `SHA256SUMS.txt` match the packaging record). The signing handoff (ZIP, sidecar, `SHA256SUMS.txt`, packaging record) is checked file by file, and missing or altered copies are repaired from the verified release directory. The packaging record is written last. An incomplete earlier signing folder is preserved as `-incomplete-<time>` before a rebuild;
  - each signature is verified and adopted on its own; only missing or invalid signatures are created, and an invalid one is kept as `.invalid-<time>`;
  - a finished install for the same ZIP is adopted only if its acceptance verifies (see Phase0 below).
- **Interrupted builder rounds.** If a quota stop or crash left uncommitted edits in the implementation clone, the clone is renamed to `.partial-<time>` with a record of its status, never deleted, and the round is retried in a fresh clone.
- **Queued work keeps its type.** When no execution backend is available, a remediation is queued as a remediation. It resumes with the same findings, frozen contract and ledger at the next cycle.
- **Format correction.** A rejected reviewer output is stored separately from the last valid review. The correction prompt carries that exact output and its rejection reason, and only a run made with the correction prompt is adopted.

## Provider quota

A usage-limit response is captured verbatim. `environment-block.json` records the parsed retry time; the package is marked `REVIEW_PENDING_PROVIDER_QUOTA`.

- **No retries consumed.** No review cycle, format retry or remediation retry is used.
- **Retry timing.** At the retry time the next review is the single controlled probe. A provider retry time is used only when it is valid and in the future; with no time, or an invalid or stale one, the policy backoff applies: 30 minutes, doubling up to 6 hours. A continuing quota response therefore never causes another call in the same tick.
- **Founder reset.** `--founder-manual-quota-reset codex` (legacy provider state only; Codex is never scheduled) (or `claude`, `claudeReviewer`) clears only the stale retryAfter of that provider state and allows one immediate probe. The real result then restores normal backoff.
- **Other work continues.** While a reviewer provider is blocked, independent packages, releases and local work keep moving.

## Lanes and Founder decisions

Dependencies (`dependsOn`, `merge.after`) decide eligibility, so a blocker holds only its own lane. The frozen scope of a package whose review is pending is never changed.

`FOUNDER_DECISION_PENDING` is set only for genuinely new authority boundaries, and only on that item. Examples:
- a protected change outside the recorded authorization;
- a review cycle limit reached with open blockers;
- a reinstall over an accepted installation.

Everything else continues. Approved policy is persisted in `config/orchestrator-policy.json` `approvals` and never asked again. Transient failures back off (5 minutes doubling, up to 6 hours) and escalate after 5 attempts.

## Dual independent review

History (superseded by PKG-GOV1/PKG-GOV2; no longer the active gate): from the `DUAL_REVIEW_REQUIRED` activation commit, every review package needs a CLEAN result from both `CLAUDE_REVIEWER` and `CODEX_REVIEWER` on the same frozen bundle; each reviewer is a separate action with its own quota state, its own clean review clone and its own evidence, and any valid BLOCKED goes to remediation with the findings of both. See `docs/architecture/DUAL-INDEPENDENT-REVIEW.md`. A release candidate is additionally audited as a whole by both reviewers (`CLAUDE_FULL_REPO_REVIEW`, `CODEX_FULL_REPO_REVIEW`) before packaging, signing and Phase0.

Founder governance change 2026-10-06 (PKG-GOV1): once the `CLAUDE_ONLY` review gate of `config/orchestrator-policy.json` `reviewGate` is activated in the durable state (hash-chained `REVIEW_GATE_ACTIVATED`), the required gate is one independent governed `CLAUDE_REVIEWER` review per package revision (merge rule: deterministic gates PASS and `CLAUDE_REVIEWER` CLEAN bound to the frozen bundle) and one governed `CLAUDE_FULL_REPO_REVIEW` for the release audit. Codex is no longer required or scheduled, and Codex review is retired entirely by PKG-GOV2 (no Codex reviewer path exists; with no active gate a review is blocked as `REVIEW_GATE_NOT_ACTIVATED`, never falls back to Codex); historical Codex evidence and markers are kept unchanged. See "Claude-only review gate (PKG-GOV1)" in `docs/architecture/DUAL-INDEPENDENT-REVIEW.md`.

## Command contracts

`automation/lib/command-contracts.mjs` is the only way the orchestrator runs commands.

- **Fixed programs, validated parameters, no shell.** Every contract has a fixed program and typed parameters (commit SHA, allowed ref or branch, basename, absolute path under a policy root, fixed sets).
- **Contracts:**
  - git read-only inspection, fast-forward `update-ref` with the expected old value, review/implementation clones, package commits; every Git contract runs with the repository Git isolation (`automation/lib/git-isolation.mjs`: no host global/system config, hooks or credential helpers) and additionally drops `GIT_CONFIG_PARAMETERS` and disables automatic commit/tag signing, so injected Git configuration cannot start hooks, signers or helpers;
  - the fixed list of repository node scripts;
  - `tar` extraction, `Expand-Archive`, `install.ps1` with the approved remote;
  - `gh` status reads;
  - `ssh-keygen -Y sign/verify` and `ssh-add -l`.
- **Denied by construction.** There is no contract for arbitrary PowerShell, cmd or Bash, deletion, force push, credential export or policy changes. Unknown contracts, unknown arguments and paths outside the roots fail closed.
- **Global Stop at every step.** Global Stop is checked before each action of a tick and before each command. Long commands run under a monitor that polls the stop signal; when it appears, the whole command tree is terminated (`taskkill /T /F` from System32 on Windows). An action cut short by the stop is not applied; its in-flight marker is recovered idempotently on the next run.
- **Trusted protected-path policy.** Builder changes are classified against the verified control plane's `config/protected-paths.json`, never the copy the builder could edit. Unauthorized protected edits, including edits to that policy, are rejected before any worktree code runs.
- **Isolated Git.** Git contracts run with the same isolation as every other production Git process (`automation/lib/git-isolation.mjs`): no host global or system config, no repository hooks, no credential helper.
- **No Claude Code permission prompts.** The unattended path runs outside Claude Code: the builder runs through `claude-builder-broker.mjs` (tool-restricted, `acceptEdits` inside the worktree) and the reviewer through its read-only broker (`claude-reviewer-broker.mjs` for the required `CLAUDE_REVIEWER` once the PKG-GOV1 gate is active; historically only, the Codex broker for reviews under the earlier gates, which is retired and fail-closed).

## Execution backends

Work is routed by `docs/architecture/EXECUTION-BACKENDS.md` in `AUTO` mode.

The Claude CLI exposes an official `--cloud` option. Cloud sessions work from the GitHub repository, but remote pushes are not allowed while branch protection is unavailable. `CLAUDE_CLOUD_SESSION` therefore stays `NOT_CONFIGURED`, and work falls back to `LOCAL_CLAUDE`. Cloud execution is never faked.

## Release, signing and Phase0

1. **Release candidate.** A CLEAN package flagged `release` creates a release from its reviewed sealed commit. A new release supersedes older, not-yet-installed releases with a `SUPERSEDED.json` record; nothing is deleted.
2. **Packaging:**
   - `git archive` export;
   - `verify-trust-root`;
   - `release-sha256sums`;
   - deterministic `build-release-zip` (a second build must be byte-identical);
   - `verify-release-extract --with-validation`;
   - a check that the entry count matches the tracked files;
   - a copy to `%USERPROFILE%\Desktop\UASCO-release-<commit>`.
3. **Signing** uses only the Windows OpenSSH agent. The contract passes the public key; the private key is never read, copied, logged or sent to Claude. If the agent is unavailable or the key is not loaded, the release waits in `WAITING_FOR_SECURE_SIGNER`, rechecked every 30 minutes, while other work continues.
4. **Phase0.** The previous `C:\UASCO` is preserved as `C:\UASCO-failed-attempt-<n>-<time>` with a `FAILED_ATTEMPT.json`. The signed ZIP is extracted and `install.ps1 -RemoteUrl <approved private repo>` runs. Phase0 is accepted only when all of these hold:
   - `PHASE0_ACCEPTANCE.json` passes the control plane's trusted verifier (`verifyPhase0ForControl`: schema, Ed25519 signature, and binding to the installation's installId, source commit, trust-root digest and runtime inputs);
   - its trust-root digest equals the signed release's;
   - `INSTALL_STEPS.json` exists and no step failed;
   - for a fresh install, the installer exited with 0.

   A missing, unsigned, altered or stale report fails. `CLEAN_LOCAL_ONLY` stays `CLEAN_LOCAL_ONLY`. A finished install that does not verify is preserved as a failed attempt instead of being accepted. A reinstall over an accepted installation needs a Founder decision.

## GitHub

Once a day the orchestrator records:
- the authenticated account and whether it matches the expected owner;
- the repository, its visibility and remote URL;
- the branch-protection state (for example `UNAVAILABLE_PLAN_LIMIT`).

Construction-repository pushes stay queued while the remote-protection policy does not allow them. There is no force push.

## Activation

The supervisor is installed once by `scripts/bootstrap-uasco-autonomy.ps1`, run from a normal Windows PowerShell window; no administrator rights are needed (see `docs/architecture/AUTONOMY-BOOTSTRAP.md`).

- **What the bootstrap does.** It clones the governed default-branch commit into `%LOCALAPPDATA%\UASCO\orchestrator\control\<commit12>` with Git isolation. It verifies the trust root and the durable queue with that plane's own library, keeping the queue, pending decisions and quota state as they are, and installs the reviewed dependencies. It activates the plane under the single-worker lock (`CONTROL_PLANE_ACTIVATED`) and registers `UASCO-Autonomous-Supervisor`, which runs the hidden wrapper and the stable entry. It then confirms the first run from the task process itself.
- **From the AUT1B plane to the launcher plane.** The stable entry performs the one governed upgrade from the pre-launcher AUT1B plane to the first governed plane that contains the launcher. From then on, the daemon's own governed self-upgrade switches planes.
- **`scripts/register-orchestrator-autostart.ps1` is superseded by the bootstrap and must not be run.** It switches `control\current` before its task-name conflict check, so even a run that ends in `TASK_NAME_CONFLICT` changes the active plane. Its elevated `-IncludeStartupTrigger` path registers an S4U task, which cannot use the ssh-agent signing key.
- **Self-check.** `uasco-orchestrator.mjs --self-check --with-provider-smoke` remains available as a diagnostic. Without `--with-provider-smoke`, the invocation check is reported as `NOT_TESTED`, never as PASS.

The control plane refuses to run if its own trust root does not verify. `--status` also reports the supervisor heartbeat, its health, the lock and the next wake.
