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
- **Atomic, auditable transitions.** Every transition is first appended to the hash-chained `orchestrator-transitions.jsonl`, then written atomically. A tick refuses to run if the log chain or the state link is broken.
- **One active worker.** A process lock (`acquireProcessLock`) and a lease with heartbeat guarantee it. An expired lease is taken over and logged as stale.
- **Idempotent actions.** An interrupted action is recovered by re-planning, because the executors never redo completed work:
  - a completed Codex run for the same bundle digest and cycle is adopted instead of calling Codex again; if the worker died after the call finished but before governed evaluation, the unchanged output is evaluated without a new call, while an unfinished call is repeated;
  - a merge whose target is already the default branch is recognized as done;
  - a complete release directory is adopted;
  - valid signatures are verified and adopted instead of signing again;
  - a finished install for the same ZIP is adopted.

## Provider quota

A usage-limit response is captured verbatim. `environment-block.json` records the parsed retry time; the package is marked `REVIEW_PENDING_PROVIDER_QUOTA`.

- **No retries consumed.** No review cycle, format retry or remediation retry is used.
- **Retry timing.** At the retry time the next review is the single controlled probe. If the provider message has no time, the policy backoff applies: 30 minutes, doubling up to 6 hours.
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
  - git read-only inspection, fast-forward `update-ref` with the expected old value, review/implementation clones, package commits;
  - the fixed list of repository node scripts;
  - `tar` extraction, `Expand-Archive`, `install.ps1` with the approved remote;
  - `gh` status reads;
  - `ssh-keygen -Y sign/verify` and `ssh-add -l`.
- **Denied by construction.** There is no contract for arbitrary PowerShell, cmd or Bash, deletion, force push, credential export or policy changes. Unknown contracts, unknown arguments and paths outside the roots fail closed.
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
4. **Phase0.** The previous `C:\UASCO` is preserved as `C:\UASCO-failed-attempt-<n>-<time>` with a `FAILED_ATTEMPT.json`. The signed ZIP is extracted and `install.ps1 -RemoteUrl <approved private repo>` runs. The result comes only from the signed `PHASE0_ACCEPTANCE.json`: `CLEAN_LOCAL_ONLY` stays `CLEAN_LOCAL_ONLY`. A reinstall over an accepted installation needs a Founder decision.

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
