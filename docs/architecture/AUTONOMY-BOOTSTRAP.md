<!-- //TR: Bu belge UASCO otonomisinin tek seferlik Windows kurulumunu (scripts/bootstrap-uasco-autonomy.ps1), gizli pencereli görev sarmalayıcısını ve kararlı görev girişini tanımlar: ne kurulur, kurulumdan sonra ne kendiliğinden olur, hangi güvenlik özellikleri korunur, sınırlar ve kurulumun hangi durumda yeniden gerektiği. -->
# Autonomy bootstrap

The construction supervisor `UASCO-Autonomous-Supervisor` is installed once, from a normal Windows PowerShell window (not "Run as administrator"; no admin rights or UAC prompt are needed):

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<reviewed checkout>\scripts\bootstrap-uasco-autonomy.ps1" -Repo "<construction repository>"
```

After that, routine work needs no command from the Founder.

## What the bootstrap does

1. **Refuses unsafe runs.**
   - An elevated session: files would be owned by Administrators and the task would get the wrong token.
   - A session inside a packaged (MSIX) app, whose `%LOCALAPPDATA%` writes are virtualized.
   - A Global Stop file (`GLOBAL_STOP.json` or its `.prev`) that is present at all, whatever its content: clearing a Global Stop deletes the file, as in `automation/lib/global-stop.mjs`.
   - Any path with characters that could change the task command line: quotes, `%` (Task Scheduler expands `%VAR%`), backticks, brackets, wildcards, control characters, or a trailing separator, dot or space.
2. **Checks its own provenance.** The script, the entry and the wrapper must be tracked, unmodified files of a clean checkout. Each file's blob must equal the blob at the recorded commit, and no file may be flagged assume-unchanged or skip-worktree.
3. **Clones the reviewed control plane.** The plane is the default-branch commit, and that commit must be recorded in the durable queue as a governed merge (a CLOSED package's `mergedCommit`). It is cloned into `%LOCALAPPDATA%\UASCO\orchestrator\control\<commit12>` with the repository's Git isolation: empty global and system config, no hooks, no templates, no credential helper, no `ext` protocol. A plane directory left by an interrupted clone or checkout that is not the active plane (wrong HEAD, changes, a leftover `index.lock` or no repository at all) is not repaired in place: it is renamed to `<commit12>.broken-<time>` in the same directory (nothing is deleted) and cloned again, so the same command can simply be run again.
4. **Verifies the plane with its own library before installing anything.** The trust root must pass. The durable state is checked:
   - the state loads and validates;
   - the hash-chained transition log verifies;
   - Global Stop is not active;
   - no release is in the packaging, signing or Phase0 lane, unless the plane has the launcher and requires the final release audit.
5. **Installs dependencies.** They come from the reviewed lock (`npm ci` through the plane's own `ensure-dependencies.mjs`).
6. **Installs the stable entry and the hidden task wrapper.** Right after the provenance check, both files are copied into a staging directory under `bootstrap\` and each copy's Git blob id is compared with the verified commit blob again. Verification, activation and installation use only these staged copies, so a later change of the source checkout cannot reach the installation. The installed copies are checked against the same blob ids.
7. **Activates the plane.** This happens under the single-worker lock (`orchestrator.lock`): the `control\current` junction (a junction whose target was deleted is replaced as well), `control\CURRENT.json`, and a `CONTROL_PLANE_ACTIVATED` entry in the transition log. A provably stale lock (see below) is removed before the lock is taken, and the lease of a dead worker that is still recorded is released in the same transition, because no live worker can hold a lease while the single-worker lock is free.
8. **Registers the task.** The task is built once (a real CIM task object), registered, read back and compared. Its settings:
   - Principal: this user, Interactive, Limited, no stored password.
   - Triggers: at logon and every 15 minutes (repeating indefinitely).
   - Behaviour: single instance (`IgnoreNew`), no time limit, normal priority.
   - Action: `powershell.exe -WindowStyle Hidden -File bootstrap\uasco-supervisor-task.ps1`, so no console window opens on the desktop.
   - An existing task with this name counts as the bootstrap's own only if it runs this wrapper (or a launcher or orchestrator script of this control root); its `-Repo` and `-Node` values may differ and are replaced, so a moved repository or a reinstalled Node.js is repaired by running the same command again. Any other task with the name is a `TASK_NAME_CONFLICT`.
   - Before registering over an existing task, its definition is exported (`Export-ScheduledTask`) and kept as `bootstrap\previous-task-definition.xml`; an empty export stops the run (`PREVIOUS_TASK_EXPORT_FAILED`) before anything is changed.
   - Every Task Scheduler call goes through one controller seam (the real cmdlets). The tests replace it with a recording fake (`-TestMode -TaskControllerFixture`), so no test registers, starts, changes or deletes a real task.
9. **Confirms the first run.** It starts the task and judges only heartbeats written by the task process after `Start-ScheduledTask`, printing each state change while it waits:
   - a failure state, or a tick that exited non-zero, timed out or did no work (top-level status other than `TICK_DONE`), is `FIRST_RUN_FAILED`;
   - a finished tick with exit code 0 and status `TICK_DONE` is confirmed;
   - a delegation to the launcher is confirmed only by a fresh daemon heartbeat that reports a completed daemon tick with status `TICK_DONE` (`lastTick`);
   - a first tick that is still running waits up to 15 minutes. If the first tick (or the daemon's first tick) is still running then, the status is `INSTALLED_FIRST_TICK_PENDING`, not a confirmation; the entry writes the tick result into `BOOTSTRAP_INSTALLED.json` when it finishes (`INSTALLED` for exit code 0, otherwise `FIRST_RUN_FAILED`);
   - otherwise the result is `FIRST_RUN_NOT_CONFIRMED`.

   The entry settles only a pending record: `PENDING_FIRST_RUN` or `INSTALLED_FIRST_TICK_PENDING` becomes `INSTALLED` (or `FIRST_RUN_FAILED`) when the first tick or the first fresh daemon heartbeat reports its result, and a status the entry settled before the bootstrap finished is kept. Only `INSTALLED_FIRST_TICK_PENDING` stays installed, with the task running; the entry settles it later and no repeat is needed. A first run that ends as `FIRST_RUN_FAILED` or `FIRST_RUN_NOT_CONFIRMED` is a failed installation: it is rolled back as described below and the single command must be run again.

   **Failure and rollback.** If anything fails after the task has been registered, the bootstrap never leaves a runnable supervisor behind. The paths are: the read-back differs from what was registered (`TASK_NOT_AS_REGISTERED`), registration or its verification raises an error (`TASK_REGISTRATION_VERIFY_FAILED`), the installation record cannot be written (`BOOTSTRAP_RECORD_WRITE_FAILED`), the task cannot be started (`TASK_START_FAILED`), the task state or result cannot be read (`FIRST_RUN_STATE_UNREADABLE`), and a failed or unconfirmed first-run verdict (`FIRST_RUN_FAILED`, `FIRST_RUN_NOT_CONFIRMED`). Each of them, in order:
   1. stops the running task instance (`Stop-ScheduledTask`) when the task was started;
   2. terminates the supervisor processes of this control root that the run could have started: processes running the installed entry or wrapper (`bootstrap\uasco-supervisor-entry.mjs`, `bootstrap\uasco-supervisor-task.ps1`) or a `scripts\uasco-*.mjs` script under `control\`, plus their children. Other processes, including ones that only mention the control-root path, and the bootstrap itself are never touched;
   3. undoes the registration. A task that did not exist before the run is unregistered (if that fails, it is disabled). A task that existed before the run is **never deleted**: its exported definition is restored and then **kept disabled**, so the Founder re-enables it deliberately (if the restore fails, the new definition is disabled);
   4. accepts the result only if the task is then absent or `Disabled`, writes `BOOTSTRAP_INSTALLED.json` and `.ai/runtime/BOOTSTRAP_STATUS.json` with status `ROLLED_BACK_TASK_NOT_RUNNABLE` (otherwise `ROLLBACK_UNSAFE`) and the cause, the resulting task state and the steps under `firstRun.rollback`, and exits 1 with the cause as the refusal code (`ROLLBACK_UNSAFE` when the task could not be made safe).

   With the LV1 layer the same rollback also covers the watchdog task and an `-Upgrade` run: a failed watchdog registration or read-back (`WATCHDOG_TASK_REGISTRATION_FAILED`, `WATCHDOG_TASK_NOT_AS_REGISTERED`), a Global Stop that appears after the supervisor task was registered (`GLOBAL_STOP_ACTIVE`), a watchdog task that records no first run (`WATCHDOG_FIRST_RUN_NOT_CONFIRMED`) and an unexpected error after registration (`BOOTSTRAP_UNEXPECTED_ERROR`) stop the instance, undo the supervisor registration as above and stop and disable (never delete) the watchdog task. An upgrade disables the existing supervisor task while files change and re-enables it only if the run fails before the new task was registered; once a rollback has disabled or removed the task, the rolled-back state wins and the task is never re-enabled.

   The activated control plane (`control\current`, `CURRENT.json`, the `CONTROL_PLANE_ACTIVATED` transition) and the installed entry and wrapper are left in place: they are hash-chained evidence and are inert without a task. Running the same command again repairs the installation.
10. **Records the result.** It writes `BOOTSTRAP_INSTALLED.json` with the status, plane, entry and wrapper hashes, the task facts, the signer check and the limits, and mirrors a secret-free summary to `.ai/runtime/BOOTSTRAP_STATUS.json` in the repository.

`-ProbeTaskRegistration` registers a uniquely named, disabled task built by the same builder (its working directory is the existing `%LOCALAPPDATA%`, because the control root may not exist yet), reads it back, compares it and removes it. Nothing else is touched. `-TestMode` runs every step under a temporary `LOCALAPPDATA` with a fixture repository under `TEMP`, and writes the task definition to a file instead of registering it.

## What happens afterwards

On every trigger, the wrapper starts the stable entry (`scripts/uasco-supervisor-entry.mjs`). The entry:

1. **Resolves the plane.** It resolves `control\current`.
   - A missing junction is repaired only to the plane that `CURRENT.json` names, and only if that plane's HEAD equals the recorded commit and its trust root verifies. A pending `current.next` is used only when it points to that same plane.
   - If the junction points to a different plane than `CURRENT.json` (an interruption between the switch and the record), it is pointed back to the recorded plane when that plane is the bootstrap commit or a governed merge.
2. **Checks the plane's provenance.** The directory name must equal HEAD, `CURRENT.json` must agree with HEAD, and HEAD must be the bootstrap commit or a governed merge. The plane's trust root must verify before any plane code is imported, and the plane library must provide every function the entry uses; a missing one is reported as `BROKEN` with `PLANE_LIBRARY_SURFACE_MISSING`.
3. **Delegates when the plane is governed and newer.** If the plane contains a governed copy of the entry (from BS1 on), it delegates to that copy, so later entry fixes arrive through governed merges.
4. **Starts the daemon when the plane has the launcher.** If the plane contains the AUT2 launcher, the entry starts the daemon. Frozen time is counted only while the PC is awake: a long gap between checks (the PC slept) counts as one check interval, and the time already accumulated is kept. When the heartbeat has been frozen for the hang limit (14 hours of awake time) on two consecutive checks, the entry kills the process tree and the next trigger starts it cleanly. The first fresh daemon heartbeat that reports a completed daemon tick with status `TICK_DONE` also settles the first-run record (the heartbeat is read once more when the launcher ends). A launcher that ends after a governed self-upgrade or for Global Stop gives no verdict; a pending record becomes `FIRST_RUN_FAILED` only when the launcher ends with a non-zero code or is killed as hung without such a tick.

   Before it runs the plane (daemon, upgrade or tick), the entry removes a single-worker lock only when its holder is provably dead: its PID no longer exists, or the process now using that PID started after the lock (Windows reused the PID of a supervisor killed at logoff). The boot time is used only when the creation time of the process cannot be read; a live holder that started before its lock is never removed, even after a clock change. Locks of other hosts, unreadable locks and live holders are left alone; each removal is logged in `logs\entry-events.jsonl`.
5. **Runs the tick loop on the pre-launcher plane (AUT1B).** It runs the plane's `--tick` in a loop: every 15 minutes, with a hang backstop that kills the whole process tree and clears the dead tick's lock. It writes a clearly labelled pre-daemon `.ai/runtime/WATCHDOG_STATUS.json` for the passive routine; a tick that did no work (`ALREADY_RUNNING`, `LEASE_HELD`, `NO_CONTROL_STATE`, ...) is reported as unhealthy. While a tick runs, the entry checks the default branch every 15 seconds; as soon as it contains the launcher in a recorded governed merge, the tick's process tree is stopped, so the old plane does not go on to review further packages:
   - If the old tick starts a release action (packaging, signing or Phase0) while the default branch contains the launcher, recorded as a governed merge or not, the tick is stopped at once: the final dual release audit and `-SkipAutoStart` exist only on newer planes. A release that only waits in the lane does not cut a package merge or remediation; the safe-point rule applies until the first release action starts.
   - Otherwise it is stopped at the next safe point: no action other than a review is in flight (a merge or remediation is never cut), no git process runs in the tick's process tree (no lock file is left behind), and the durable state did not change while the process list was read. If the process list cannot be read, the tick is not stopped.
   - Merges that the old tick runs back to back right after the launcher merge (packages that were already reviewed CLEAN) can complete before a safe point occurs; this is disclosed, not prevented. Packages held for the dual review or the release audit are never touched by the old plane.
   - After the stop, a dependency installation the tick left half done (a review or remediation clone whose `node_modules` has no `.uasco-dependency-state.json`) is moved into `quarantine` in the control root (outside every clone, so the clone stays clean), and the new plane installs and verifies it again. An interrupted review is recovered by the new plane. Once the default branch contains the launcher, the old tick does not run again; the entry only performs one governed upgrade, all of whose conditions must hold:
   - the default branch is a governed merge;
   - a candidate directory left by an interrupted upgrade is renamed aside (never deleted) and cloned again;
   - it is a fast-forward of the plane;
   - the candidate's trust root verifies;
   - dependencies come from the identical lock;
   - the switch happens under the single-worker lock, with a `CONTROL_PLANE_UPGRADED` record.

   If any condition fails, it reports `UPGRADE_BLOCKED` and tries again at the next trigger. If the default branch cannot be resolved or the launcher probe cannot be evaluated, the old tick does not run either (`UPGRADE_BLOCKED`, fail-closed). One exception keeps the chain from stalling: if the AUT1B merge that moved the default branch to the launcher commit was interrupted before it was recorded (the package is still `REVIEW_CLEAN` with that commit as its reviewed commit), exactly one AUT1B tick runs to record it through its idempotent merge, and the watch above stops that tick as soon as the merge is recorded (at once if it starts a release action). No AUT1B tick runs while a release waits in the lane, not even this recovery tick; that case stays `UPGRADE_BLOCKED` (fail-closed) and needs a Founder decision. It can only arise if the release-audit hold failed.

From the AUT2 plane on, the daemon owns the heartbeat, the watchdog status and the governed self-upgrade.

Two kinds of held package keep the review and release guarantees across these plane changes:

- **`DUAL_REVIEW_ACTIVE`.** Packages after DR1 are held until this activation. Only an active DR1+ plane releases them, so they get the Claude and Codex reviews.
- **`RELEASE_AUDIT_ACTIVE`.** The release package is held until this activation. Only a DR2+ plane releases it, so the release is created, audited by both reviewers, packaged, signed through the loaded ssh-agent key and installed by Phase0 (`-SkipAutoStart`, `UASCO-Installed-Supervisor`) only on a plane that enforces all of that.

## Limits (disclosed, not claimed away)

- **Signed-in only.** The supervisor runs while the Founder is signed in; a locked screen is fine. After a reboot it resumes at the next sign-in, and it does not wake a sleeping PC. A pre-logon start would need S4U, which cannot use the DPAPI-protected ssh-agent key needed for secure local signing, or a stored password, which is not allowed.
- **Restart-on-failure.** Task Scheduler's restart-on-failure only covers a task that fails to launch. Real recovery comes from:
  - the independent `UASCO-Supervisor-Watchdog` task (from LV1, see docs/architecture/LIVENESS.md), which restarts a supervisor that is not running, frozen, hung, livelocked or asleep while work is eligible;
  - the launcher's restart backoff;
  - the entry's frozen-heartbeat kill and awake-time action backstop;
  - the 15-minute trigger.
- **Stopping.** Stop the supervisor with Global Stop (`.ai/runtime/GLOBAL_STOP.json`), not with Task Scheduler "End" or "Disable".
- **A failed installation is rolled back, not left running.** After any failure following the task registration (see "Failure and rollback" in step 9) no enabled task remains: a new task is removed or disabled, a pre-existing task is restored and left disabled (never deleted), and `ROLLBACK_UNSAFE` is reported when neither removal nor disabling succeeded. The activated plane, `control\current`, `CURRENT.json` and the installed entry and wrapper stay in place but are inert without a task. The bootstrap must be run again.
- **Founder decisions.** Founder decisions still need an answer, for example a package blocked at its review-cycle limit. The chain is fully automatic only while each package comes back CLEAN or is remediated within its cycles.
- **Installed copies.** The installed entry and wrapper are only replaced by a new bootstrap. From BS1 on, the governed plane copy of the entry is used instead, but only after the installed copy has resolved and checked the plane (see the contracts below).
- **Do not run `scripts/register-orchestrator-autostart.ps1`.** It switches `control\current` before it checks for a task-name conflict, so even a refused run changes the active plane. The bootstrap supersedes it.
- **No Claude sessions on the supervisor.** After the bootstrap, Claude sessions must not run `--tick` or `--daemon` themselves. Inside the Claude app, `%LOCALAPPDATA%` is virtualized; use the repository's `.ai/runtime` status files instead.

## When a new bootstrap is needed

Only when the installation is broken or intentionally removed:

- `BOOTSTRAP_STATUS.json` or the entry heartbeat reports `BROKEN` and the entry cannot repair it, for example when the plane directories are deleted;
- a future plane changes a contract that the installed entry relies on before it can delegate to the plane's governed copy: the `control\current` junction and `CURRENT.json` fields (`commit`, `path`), plane directories named by the first 12 characters of HEAD, the policy `roots.controlRoot`, `roots.stateFile` and `roots.transitionLog`, `scripts/verify-trust-root.mjs`, the plane library functions listed in `PLANE_LIBRARY_SURFACE` (entry), the governed-merge record (`CLOSED` with `mergedCommit`), or the launcher's command line (`--repo <path>`);
- the task was deleted;
- the last run ended as `ROLLED_BACK_TASK_NOT_RUNNABLE` or `ROLLBACK_UNSAFE` (a failed installation was rolled back; a pre-existing task, if any, is back in its old definition but disabled). With `ROLLBACK_UNSAFE` first check in Task Scheduler that `UASCO-Autonomous-Supervisor` is absent or disabled.
- a newer reviewed installed layer must be installed, for example LV1 (generation-2 entry and the watchdog task).

The bootstrap refuses to run while the supervisor is running, unless `-Upgrade` is given. Whenever the supervisor task already exists (an upgrade or a repair run), it writes an upgrade marker, which makes a generation-2 entry stop starting ticks (unless an action is in flight and must be recovered first) and a watchdog stand still. It then waits up to 30 minutes for a safe point, stops the supervisor there, and installs and restarts both tasks; the marker is removed after both tasks are registered and before the first run. If no safe point comes, it installs nothing (`SUPERVISOR_BUSY`); on a launcher plane it stops at once (`UPGRADE_LAUNCHER_PLANE_UNSUPPORTED`). If the bootstrap dies, the watchdog re-enables the supervisor task from the stale marker, except when no enabled watchdog task exists (the first LV1 installation, or a repair after the watchdog task was deleted or disabled): a bootstrap that dies after disabling the supervisor task and before registering the tasks then leaves it disabled until the same command is run again. A death during file installation can leave new and old installed files side by side until the command is run again. Only one bootstrap runs per control root (`BOOTSTRAP_ALREADY_RUNNING`). The installed generation-2 entry delegates only to a plane copy of the same or a newer generation, so a merged BS1 plane cannot downgrade it.

## Validation

The BS1 selftest scenarios run in bounded validation steps `tests-bs1-a` to `tests-bs1-f` (and the LV1 liveness selftest in `tests-lv1`) (the partition lives in `tests/support/bs1-shard.ts`; `tests/pkg-vs-validation-sharding.test.ts` is a mechanical guard that every scenario belongs to exactly one step and no test file is dropped from `tests`). The task registration, rollback and first-run-failure scenarios run only against the fake task controller with fixtures; no real scheduled task is registered, started, modified or deleted and no process outside the scenario's own dummy processes is touched.
