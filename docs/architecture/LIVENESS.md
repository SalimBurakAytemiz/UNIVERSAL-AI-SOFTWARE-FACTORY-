<!-- //TR: Bu belge UASCO'nun LV1 canlılık katmanını tanımlar: iki katmanlı denetim (UASCO-Autonomous-Supervisor ve bağımsız UASCO-Supervisor-Watchdog), kalp atışı, bayatlık ve ilerlemesizlik tespiti, iş koruyan döngü, uyanma alanları, eylem emniyet kesicisi, ölü lease bırakma, kurtarma, fırtına koruması, yükseltme bootstrap'ı, testler ve LV2'ye bırakılan düzlem kodu işleri. -->
# Liveness (LV1)

UASCO runs as two independent scheduled tasks for the signed-in user:

| Task | Runs | Owns | Never touches |
|---|---|---|---|
| `UASCO-Autonomous-Supervisor` | at logon and every 15 minutes (IgnoreNew), hidden PowerShell wrapper, stable entry `bootstrap\uasco-supervisor-entry.mjs` (generation 2) | the single-worker lock `orchestrator.lock`, the durable lease, the transition log (through the control plane) | the watchdog's lock |
| `UASCO-Supervisor-Watchdog` | at logon and every 5 minutes (IgnoreNew, 15-minute limit), windowless `wscript.exe` wrapper, `bootstrap\uasco-supervisor-watchdog.mjs` | its own lock `watchdog\watchdog.lock` and `watchdog\WATCHDOG_STATE.json` | the lease and the transition log; it never takes the single-worker lock (it removes it only when its holder is provably dead, with the entry's own rule) |

Both tasks use this user's Interactive token at Limited run level, with no stored password. They run only while the user is signed in; a locked screen is fine. They do not wake a sleeping PC. Thresholds live in `config/liveness-policy.json`, and the installed copy embeds the same values (`LIVENESS_POLICY`; the selftest checks that they are equal). Progress age, action-backstop age and watchdog staleness are measured in awake time: a gap longer than three polling intervals (sleep or hibernation) counts as one interval. The heartbeat age is wall-clock time. After a PC sleep the heartbeat therefore looks stale, which is why the first watchdog run after a suspend takes no destructive step.

## Supervisor heartbeat

A worker thread in the entry process writes `.ai/runtime/SUPERVISOR_HEARTBEAT.json` atomically every 20 s. It writes a mirror to `liveness\SUPERVISOR_HEARTBEAT.json` under the control root, and every field change is written within 50 ms. The file keeps its timestamp current even while the main thread is blocked.

Fields:
- `processId`, `startedAt`, `heartbeatAt`, `entryGeneration`;
- `state`: `RUNNING`, `WAITING`, `SLEEPING`, `BLOCKED` or `RECOVERING`, plus the entry `phase`;
- `activeLane`: `STARTUP`, `TICK`, `LAUNCHER` or null;
- `activePackage`: the durable in-flight marker;
- `activeChildProcess`: pid, kind, start and limit;
- `nextWakeAt`, `wakeReason`, `blockedLanes`, `providerRetryAt`, `dependencyWakeCondition`;
- `eligibleWorkCount`, `blockedWorkCount`;
- `lastProgressAt` and `lastProgressTransitionId`: the last transition that is neither lease bookkeeping (`LEASE_*`) nor an action start (`*_STARTED`);
- `lastTransitionId`: the last transition of any type;
- `mainThread`: `{lastBeatAt, busy}`.

The main thread stamps a shared-memory clock every 5 s. Before a step that can block the main thread synchronously, it declares that step with a budget: trust-root verification 600 s, plane library 300 s, governed upgrade 7200 s, lease recovery and process listing 300/120 s. The watchdog reaches one of three judgements:
- **stale** if the heartbeat is older than 180 s;
- **main thread hung** if the heartbeat is fresh but the main thread has not stamped for longer than its declared budget (or 180 s without one);
- **fresh** otherwise.

## Work-conserving loop (pre-launcher planes)

After every AUT1B tick the entry reloads the durable state and asks the plane's own engine (`nextAction` with a skip set, once per target) for eligible work. It then decides as follows (`planNext`, a pure function):

- **Eligible work and the tick made progress:** the next tick starts at once (`RUNNING`). After 24 immediate ticks it pauses for 30 s (`RECOVERING`).
- **Eligible work but no progress:** retry after 60 s, doubling up to 15 minutes (`RECOVERING`, `NO_PROGRESS_WITH_ELIGIBLE_WORK`). The entry never sleeps while work is eligible.
- **Lease held by a dead worker:** the entry takes the single-worker lock and releases the lease in a hash-chained `LEASE_RELEASED_DEAD_WORKER` transition, then retries at once. If another live worker holds the lock, it retries with backoff. It does the same at entry start (after a reboot or a kill), so a killed tick's lease does not block work for its 240-minute TTL. In-flight markers are left to the plane's own recovery.
- **No eligible work:** the entry sleeps until the earliest real wake time: a package or release `notBefore`, or a provider `retryAfter`. Holds (`notBefore` 9999) are not wake times. The sleep is capped at 15 minutes (a periodic probe) and lasts at least 30 s. The state is `WAITING` when work exists but is blocked, and `SLEEPING` when nothing is open. A quota-blocked provider blocks only its own lanes: independent work stays eligible.
- **During the sleep:** the loop checks every 30 s. A Global Stop, or any change of the durable state that makes work eligible (for example a Founder decision), wakes it within those 30 s. The sleep ends at the wall-clock deadline (after a PC sleep) or the monotonic deadline (after a backward clock change), whichever comes first.
- **Every decision** is logged as `LOOP_PLAN` in `logs\entry-events.jsonl`, which rotates at 5 MB.

## Action backstop

The control plane bounds its own children. The entry's backstop only catches a tick that is hung as a whole. The entry's own tick watch (Git queries and, when needed, a process list, every 15 s) is declared as the busy section `TICK_WATCH` with the default budget, so a slow Git call there is not mistaken for an unresponsive main thread. While a tick runs, the entry reads the durable in-flight marker every 30 s and accumulates the action's awake time; the accumulation survives an entry restart. The contract limits are REVIEW 240, MERGE 120, REMEDIATE 360, IMPLEMENT 360, PACKAGE 240, SIGN 120, PHASE0 300 and AUDIT 240 minutes. When a limit is exceeded:

- if no Git process runs in the tick's tree (a safe point), the entry writes evidence to `liveness\evidence\` (the marker, awake minutes, and a redacted process tree) and kills the tick tree;
- at 1.5× the limit, it does so even while Git runs;
- if the process list cannot be read, only the hard limit applies.

After a backstop kill or a tick timeout, the entry:
1. removes orphaned processes of this control root (processes whose parent died);
2. reconciles Git locks while no Git process runs. If it killed something, it uses a fresh process list taken after the kill and removes locks older than the kill time. Otherwise it uses the same list and removes locks older than the tick kill. At the start of every entry iteration (before any hand-over to the launcher) without a worker lock, locks older than 2 minutes are removed;
3. releases the dead lease;
4. continues the loop at once. After repeated kills it retries with backoff.

Node puts non-detached children in a kill-on-close job object, so killing the tick kills its Node-spawned tree; the orphan sweep covers detached or reparented processes.

## Watchdog

Each run classifies the supervisor:

| Class | Condition | Action |
|---|---|---|
| `STOPPED` | Global Stop file present | none |
| `TASK_MISSING` / `SUPERVISOR_TASK_DISABLED` | task absent or disabled | none (reported; a bootstrap is needed) |
| `SUPERVISOR_BLOCKED` | last state `BLOCKED` (broken plane, upgrade blocked, fatal tick) | none; the 15-minute trigger re-runs the entry |
| `SUPERVISOR_NOT_RUNNING` | task not running | start |
| `SUPERVISOR_STALE` | task running, heartbeat stale or main thread hung, or no readable heartbeat while the task has run for 10 minutes (a stale or unreadable heartbeat is re-read once after a short delay) | restart |
| `WORKER_LIVELOCK` | eligible work, `RUNNING`/`RECOVERING`, no progress for 480 awake minutes; the clock runs only while both hold, and a legitimate wait resets it | restart |
| `WORK_CONSERVATION_VIOLATION` | `SLEEPING`/`WAITING` with eligible work on two consecutive runs | restart |
| `LEGIT_WAITING` / `HEALTHY` / `SUPERVISOR_STARTING` | otherwise | none |

Before classifying, the watchdog reads the upgrade marker (`bootstrap\UPGRADE_IN_PROGRESS.json`):
- while the bootstrap that wrote it runs, the watchdog does nothing (`UPGRADE_IN_PROGRESS`);
- the bootstrap counts as running only while its PID exists and that process is not newer than the marker; a PID reused by a newer process makes the marker stale (`PID_REUSED`);
- if that bootstrap died (window closed, crash), the marker is unreadable, or the marker is older than 3 hours, the watchdog re-enables a supervisor task left disabled and then deletes the marker. Both steps happen only while the marker is unchanged (same PID and start time), so a marker that a new bootstrap wrote in the meantime is left alone. The marker is deleted only when the task is enabled again (or was never disabled); if re-enabling fails, the marker stays and the next run retries.

The watchdog never restarts a generation-1 entry (`ENTRY_GENERATION_UNSUPPORTED`), because that entry writes no liveness heartbeat; it only starts one that is not running. This is not recorded as a failure (no `lastFailure`). When the watchdog writes the status document itself (no usable document exists), it reports `overallHealth` `UNKNOWN` and `supervisorHealth` `ENTRY_GENERATION_UNSUPPORTED`; an existing producer document is left as it is, or marked `STATUS_DOCUMENT_STALE` once past its limit.

Recovery runs these steps:
1. Write the recovery into the watchdog state first. If that write fails, nothing destructive happens.
2. Stop the task and wait for it to leave `Running` (restart only).
3. Restart only: kill the supervisor processes of this control root that survived the stop, with their trees, roots first. These are node or PowerShell processes running the entry, the wrapper, the launcher or the tick; the bootstrap's `--verify-install`/`--activate` runs and a manual `--status` are excluded. A start never kills a supervisor with a live parent, because a trigger may have just started it.
4. Kill orphaned processes. An orphan's parent is dead (or its parent PID was reused after it started), its command line contains this control root as a path, and it started after the failed supervisor did. The process list is taken again after a restart kill, and each target is checked against the list it was chosen from, taken just before the kill.
5. Reconcile Git locks, only if the process list shows no Git process on the machine. After a kill, a fresh list is taken after the kill time and locks older than the kill are removed. In a restart without a kill, the task stop is the kill: the list was taken after the stop, so locks older than the stop are removed. In a start, only locks older than 2 minutes are removed.
6. Clear a provably stale `orchestrator.lock` with the entry's own rule.
7. Check that the watchdog task is still enabled and that no upgrade bootstrap is running; stop if either check fails.
8. Start the task and wait up to 120 s for a fresh heartbeat from a new process. Otherwise the outcome is `RECOVERY_UNCONFIRMED`.

A watchdog run exits on its own after 14 minutes, so a hung external command cannot hold its lock forever.

Evidence goes to `watchdog\evidence\`. The watchdog never commits, reviews, merges or signs anything; duplicate work is prevented by the plane's lock, lease and idempotent in-flight recovery.

Recoveries are limited in two ways:
- **Storm guard:** at most 3 recoveries per rolling hour, spaced 5, 10, 20, 40 and 60 minutes apart. A legitimate wait (quota, dependency, hold) never counts.
- **Suspend grace:** the first run after a gap longer than three intervals (the PC slept) takes no destructive step.

A second watchdog started while one runs exits at once with `WATCHDOG_ALREADY_RUNNING`.

Supervision is two-way. Every 10 minutes the entry checks the watchdog's last run. If it is older than 20 awake minutes and the task exists, is enabled and is not running, the entry starts it. The entry never enables a disabled watchdog: a disabled watchdog task is a deliberate decision (an operator, or the bootstrap after a task definition that did not read back as registered). A missing watchdog task is reported.

A fixture repository or control root under `%TEMP%` can never reach the real Task Scheduler. The watchdog refuses TEMP roots unless it runs in test mode with an injected controller under TEMP; the entry uses no controller there. Task control accepts only the two fixed task names.

## Status documents

- `.ai/runtime/SUPERVISOR_STATUS.json`: written by the entry every 30 s and at every phase change.
- `.ai/runtime/WATCHDOG_STATUS.json`: written by the entry in the pre-launcher era. It keeps the previous passive fields (`schemaVersion` `pre-daemon-entry-1.0.0`, `overallHealth`, `supervisor`, `queue`, `providers`) and adds `livenessSchema` and the liveness fields:
  - `supervisorHealth`, `heartbeatAge`, `progressAge`, `currentState`;
  - `eligibleWorkCount`, `blockedWorkCount`, `activePackage`, `activeLane`;
  - `nextWakeAt`, `wakeReason`, `lastRecoveryAt`, `recoveryCount`, `lastFailure`, `providerState`.

  The watchdog writes `WATCHDOG_STATUS.json` itself, with `producer` set to the watchdog, when it attempts or refuses a recovery (except for an unsupported generation-1 entry), or finds the task missing, disabled or unreadable. A crash, a failed run, a refused lock (another computer's lock written after the last boot, or a lock file that cannot be created; exit code 75, nothing else is done) or the 14-minute deadline is also appended to `watchdog\watchdog-events.jsonl` under the control root, because the windowless wrapper discards the watchdog's output. It merges its fields over the existing document and keeps that document's schema, `staleAfterSeconds`, `observer` and queue fields, so the passive routine keeps reading it.

  If the document is only older than its limit (10 minutes, or the document's own `staleAfterSeconds` if that is larger) and the supervisor looks healthy (for example a daemon that stopped refreshing it), the watchdog keeps the producer's time stamp, health and reasons. It adds `STATUS_DOCUMENT_STALE` to the reasons once and its own observations under `watchdog`, so a stale document is never refreshed as healthy. Without a usable document (missing, not a JSON object, or without a readable time stamp) it writes a full document of its own.

## Installation and upgrade

LV1 is installed by the reviewed bootstrap, run once from a normal PowerShell window:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<reviewed LV1 checkout>\scripts\bootstrap-uasco-autonomy.ps1" -Repo "<construction repository>" -Upgrade
```

It follows the same provenance, trust-root and durable-state checks as BS1, then:

0. **Runs alone.** A second bootstrap for the same control root stops at once (`BOOTSTRAP_ALREADY_RUNNING`, a named mutex released when the process ends).
1. **Quiesces an existing installation (the supervisor task already exists: an upgrade or a repair run).**
   - Writes the upgrade marker with its own PID and start time:
     - a generation-2 entry starts no new tick while the marker is live (`WAITING`/`UPGRADE_QUIESCE`, rechecked every 5 s), so the safe point comes at its next tick boundary. Exception: while an action is in flight (a killed tick), the entry first runs the tick that recovers it;
     - a watchdog does nothing while the marker is live.
   - Stops a running watchdog instance (started before the marker) and ends its processes, then writes the marker again (the stopped watchdog may have removed it). The watchdog task stays enabled.
   - On a launcher plane (the AUT2 daemon runs) there is no safe point; the bootstrap stops at once with `UPGRADE_LAUNCHER_PLANE_UNSUPPORTED` and installs nothing (a launcher-aware upgrade is deferred to LV2).
   - Waits up to 30 minutes for a safe point. This also happens when the task is not running but supervisor processes of this control root remain. A safe point (`Resolve-UpgradeSafePoint`) means:
     - no tick or launcher process and no in-flight action; and
     - a generation-2 heartbeat in its sleep phase (`SLEEPING`/`WAITING`/`RECOVERING`, no child, at least 60 s before the next wake), or a generation-1 entry `SLEEPING` at least 60 s before its next iteration, or a blocked or exited entry.
   - If no safe point comes, it stops with `SUPERVISOR_BUSY` and installs nothing.
   - Disables the supervisor task, so that its own 15-minute trigger cannot start an entry while files are replaced, then stops it.
   - Takes one process list. If it shows a tick or launcher process, or an action is in flight, it stops with `SUPERVISOR_BUSY`. Otherwise it ends the wrapper and the entry from that same list; a node child the entry started after the list ends with it.
   - Re-checks Global Stop, and that the marker is still its own (`UPGRADE_MARKER_LOST` otherwise: another bootstrap or a watchdog heal after a long pause replaced or removed it).
2. **Installs files.** The liveness library, the watchdog, its wrapper, the supervisor wrapper and the entry, in that order with the entry last. Each is staged and blob-verified.
3. **Activation.** Skipped when the plane is already the active master commit. Activation refuses if any supervisor process appeared.
4. **Registers both tasks.** It checks the marker ownership once more, then registers the supervisor task again, which re-creates it enabled. The watchdog task is registered enabled, with its first periodic run 20 minutes later, so that it stays installed even if the window is closed. The marker is then deleted (`UPGRADE_MARKER_REMOVED`), before the first run: a live marker would keep the new entry in `UPGRADE_QUIESCE` and the first-run check would never see a tick. After the supervisor's first-run verdict the bootstrap starts the watchdog and confirms its first run from the watchdog's own state record within 5 minutes (`WATCHDOG_FIRST_RUN_CONFIRMED`).

Every exit path (failure, exception, Ctrl+C) re-enables the supervisor task and deletes the upgrade marker if it is still its own, through a `finally` block. If the bootstrap dies abruptly (window closed), the marker stays behind with a dead PID, and the watchdog re-enables the supervisor task at its next run. A bootstrap that dies while files are being installed can leave new and old installed files side by side (the entry is installed last); the supervisor then runs with them until the same command is run again. Exception: when no enabled watchdog task exists (the first LV1 installation, or a repair after the watchdog task was deleted or disabled), a bootstrap that dies between disabling the supervisor task and registering the tasks leaves the supervisor disabled until the command is run again.

## Tests

`scripts/liveness-selftest.mjs` has 22 scenarios and takes about 70 s. Eleven of them run real supervisor-stub processes under an injected task controller in TEMP:
- a killed supervisor is restarted (with restart verification and a stale-lock clear);
- a supervisor that survives the task stop is killed by the watchdog;
- a frozen supervisor is restarted and its detached orphan swept;
- a hung main thread is restarted while a declared busy section is respected;
- a livelock is recovered only with eligible work, also in `RECOVERING` backoff;
- a worker whose progress id changes is never treated as livelocked;
- work that becomes eligible after a long legitimate wait starts the no-progress clock afresh;
- a supervisor sleeping with eligible work is recovered on the second run;
- a quota wait causes no recovery storm;
- of two concurrent watchdogs, one recovers once;
- the storm guard, suspend grace, Global Stop, missing, disabled and blocked tasks are honoured;
- an unconfirmed restart is reported as `RECOVERY_UNCONFIRMED`, even while the old heartbeat is still fresh;
- a watchdog whose task is disabled before or during a recovery neither stops nor starts the supervisor;
- a watchdog does nothing during a live upgrade, heals a supervisor task left disabled by a dead upgrade (without calling Enable on an enabled task, keeping the marker when re-enabling fails, and treating a reused bootstrap PID as dead), never restarts a generation-1 entry but starts one that is not running, and reports it as `UNKNOWN` rather than as a failure;
- an upgrade marker written during a recovery stops the restart, also when the run began on a dead bootstrap's marker whose heal is still pending;
- a failed run, a crash and a refused lock are recorded in the watchdog event log (the 14-minute deadline record uses the same helper and is not exercised);
- a stale producer document is not refreshed as healthy and is marked stale only once; a document that is not an object is replaced; a document within its own `staleAfterSeconds` is left alone;
- after a restart kill a fresh process list is taken (an orphan created after the first list is swept) and the Git-lock check after a kill uses a fresh list (a Git process started after the orphan sweep is seen and the lock is kept; that world hides the machine's other Git processes from the watchdog, so the check is deterministic); a task stop counts as a kill for the Git-lock check (the evidence records the stop time; the lock removal itself is checked only when no other Git process runs on the machine);
- TEMP roots are refused.

Unit and integration checks cover:
- the policy equality, the classification and planning tables, and the work view with the plane's real engine;
- awake-time accounting and the heartbeat thread under a blocked main thread, its prompt write of a field change, and its error reporting;
- the upgrade marker states, including a reused PID, the marker identity check, and the rule that the entry quiesces only while no action is in flight;
- the instance lock;
- the action backstop with a real Git-named child (soft limit, hard limit, evidence);
- dead-lease release on a real hash-chained state (refused while a live worker holds the lock, under Global Stop, or over an unverified log);
- the two-way watchdog check, the orphan filter and Git-lock reconciliation;
- the bootstrap's safe-point function, extracted from the PowerShell AST.

`scripts/bootstrap-autonomy-selftest.mjs` adds an end-to-end entry scenario on a real pre-launcher plane:
- a dead lock and lease are recovered at start;
- a quota-only queue plans a bounded WAITING, and the heartbeat and status sampled during that wait carry the real values;
- eligible work never sleeps; the RECOVERING heartbeat is sampled and checked;
- a stale watchdog is started through an injected controller;
- a running entry starts no tick once an upgrade marker appears, keeps its wake time ahead while it waits, its heartbeat is a safe point for the bootstrap's own function, and it resumes when the marker is removed;
- a second entry is refused;
- a tick timeout records the post-kill recovery. It also covers the watchdog task definition, the wscript command line round-trip, and generation-aware delegation.

## Deferred to LV2 (control-plane code, governed merge only)

The installed layer cannot change control-plane code: the plane runs only reviewed commits. The following therefore needs a governed package:
- an explicit timeout in every command contract and broker (Claude builder/reviewer, Codex, validation, Vitest, npm, Git, release, Phase0), with evidence capture and a `RETRYABLE_STALL` outcome with bounded retries;
- Claude quota detected on stdout as a provider wait;
- in-tick heartbeats and wake fields from the AUT2 daemon, and liveness fields in the daemon-era `WATCHDOG_STATUS.json`;
- liveness in launcher (AUT2) mode. In LV1 the entry reports the launcher as `RUNNING`/`LAUNCHER` without work fields. Livelock and work conservation therefore do not apply there; only a dead entry, a frozen heartbeat (entry or daemon) or a hung main thread is detected;
- a launcher-aware upgrade safe point. With the AUT2 daemon running, the bootstrap stops at once with `UPGRADE_LAUNCHER_PLANE_UNSUPPORTED` and changes nothing;
- kill and hang tests of individual Claude or Codex children. They belong with the per-child timeouts.

Until then, the action backstop is the outer bound of a hung child.

## Limits

- The watchdog runs through Windows Script Host so that no console window flashes every 5 minutes. If Windows Script Host is disabled or VBScript is removed by a future Windows version:
  - the bootstrap reports `WATCHDOG_FIRST_RUN_NOT_CONFIRMED`;
  - the entry reports the stale watchdog in `SUPERVISOR_STATUS.json`;
  - the supervisor keeps working without its watchdog.
- Failure transitions count as progress. An action that keeps failing is therefore not a livelock; the plane's own cycle limits and backoff handle it, and the status shows it. A real livelock (no transition at all while work is eligible) is restarted at most 3 times an hour, and the status keeps reporting it.
- Each kill target is checked against the process list it was chosen from, taken just before the kill (the creation time must match). A PID reused between that list and the kill (milliseconds), or a descendant reused right after its root died, is a theoretical residual risk; Windows does not reuse PIDs that fast in practice.
- The watchdog re-reads the upgrade marker right before it re-enables the task and right before it deletes the marker. A bootstrap that writes its marker in the few milliseconds between that re-read and the delete loses it only until it writes the marker again after stopping the watchdog; the upgrade then continues. This call-site re-check has no deterministic test; the identity check itself is tested, also on a marker written by the bootstrap's own functions.
- A bootstrap paused for more than 3 hours (for example a sleeping PC) counts as dead; the watchdog may then re-enable the supervisor task and delete the marker, and the resumed bootstrap stops at its next ownership check.
- An instance lock (entry or watchdog) carrying another host name is left alone, unless it was written before the last boot: its holder cannot be alive then (for example after the PC was renamed), so it is judged by the normal liveness rule. The entry applies the same rule when it clears a provably stale single-worker lock (`orchestrator.lock`): a lock is removed only when its holder PID is gone or belongs to a process newer than the lock; when the holder is alive and its creation time cannot be read (CIM, then Get-Process), the lock is kept and the next run retries. An unreadable lock counts as held for 20 minutes; one that cannot be read or removed at all makes every run skip (`LOCK_CONTENDED`, exit code 0, no record).
- Two starters that both find the same stale instance lock at the same moment can both run. The lock is removed only if its content is unchanged, and the single-worker lock still prevents two ticks.
- A sleeping, shut-down or signed-out PC runs nothing. Work resumes at the next sign-in, and no destructive step happens in the first watchdog run after sleep.
