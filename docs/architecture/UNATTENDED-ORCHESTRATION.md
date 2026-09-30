<!-- //TR: Bu dosya UASCO'nun gözetimsiz inşa orkestratörünü tanımlar: kalıcı kuyruk, Task Scheduler ile kendiliğinden devam, sağlayıcı kotası otomasyonu, bağımlılık farkında hatlar, dar komut sözleşmeleri, güvenli imza sınırı, dürüst GitHub/cloud durumu ve Founder'a yalnız gerçekten yeni yetki sınırlarında başvurma. -->
# Unattended Orchestration

The construction work on this repository continues without a human operator. `scripts/uasco-orchestrator.mjs` is the repository-native supervisor. Windows Task Scheduler (`scripts/register-orchestrator-autostart.ps1`) runs it at logon and every 15 minutes, at user level, one instance at a time. The Claude app routine is no longer the primary mechanism; once the orchestrator is active, it is disabled.

## Loop

```
durable queue -> recover state -> next eligible package -> execution backend
-> Claude implementation -> deterministic validation -> checkpoint -> commit
-> frozen review bundle -> independent Codex review -> governed evaluation
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
  - a finished Codex run for the same bundle digest, cycle and prompt, whose output still matches its manifest hash, is adopted instead of calling Codex again. The governed decision is always re-derived from that unchanged output and the frozen bundle; a cached `governed-result.json` is never trusted. The adopted run is evaluated in a review tree prepared with git only (no dependency or provenance scripts), and the placed bundle must match the package's frozen bundle digest, base, reviewed commit and cycle. An unfinished call is repeated. Every provider call gets its own run directory;
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
- **Founder reset.** `--founder-manual-quota-reset codex` clears only the stale retryAfter and allows one immediate probe. The real result then restores normal backoff.
- **Other work continues.** While Codex is blocked, independent packages, releases and local work keep moving.

## Lanes and Founder decisions

Dependencies (`dependsOn`, `merge.after`) decide eligibility, so a blocker holds only its own lane. The frozen scope of a package whose review is pending is never changed.

`FOUNDER_DECISION_PENDING` is set only for genuinely new authority boundaries, and only on that item. Examples:
- a protected change outside the recorded authorization;
- a review cycle limit reached with open blockers;
- a reinstall over an accepted installation.

Everything else continues. Approved policy is persisted in `config/orchestrator-policy.json` `approvals` and never asked again. Transient failures back off (5 minutes doubling, up to 6 hours) and escalate after 5 attempts.

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
- **No Claude Code permission prompts.** The unattended path runs outside Claude Code: the builder runs through `claude-builder-broker.mjs` (tool-restricted, `acceptEdits` inside the worktree) and the reviewer through the read-only Codex broker.

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
3. **Signing** uses only the Windows OpenSSH agent. The contract passes the public key; the private key is never read, copied, logged or sent to Claude or Codex. If the agent is unavailable or the key is not loaded, the release waits in `WAITING_FOR_SECURE_SIGNER`, rechecked every 30 minutes, while other work continues.
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

The orchestrator is activated only after this package's independent review is CLEAN:
1. Create a control-plane clone of the reviewed commit under `%LOCALAPPDATA%\UASCO\orchestrator\control\` and install its reviewed dependencies.
2. Verify that clone's trust root.
3. Seed the `control` section from the current repository truth.
4. Register the scheduled task from that clone.

The control plane refuses to run if its own trust root does not verify.
