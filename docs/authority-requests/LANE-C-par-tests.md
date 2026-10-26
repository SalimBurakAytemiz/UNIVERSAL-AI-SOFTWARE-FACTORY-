<!-- //TR: LANE-C bilgi notu: C-PAR-1 testleri kayıtlı bir dosyaya taşındı; config/validation.json kaydı gerekmez (yalnız aşağıdaki VERIFY artığı için sözleşme değişikliği isteği kalır). -->
# LANE-C note: C-PAR-1 parallel-run regression tests live in the registered `tests/v7-relfx-c3-remediation.test.ts` (no registration needed)

Coordinator package C-PAR-1 (MissionRunner safe at `maxConcurrentRuns >= 2`). `tests/v7-b3a-runner.test.ts` is near the Windows 600 s step limit and is not grown; the three inverted audit repros live in one new file instead. `config/validation.json` is protected, so the registration is the coordinator's.

## Files
- `tests/v7-relfx-c3-remediation.test.ts` (step `tests-7`, measured 71 s on Windows in run 40261485904): the self-contained describe `LANE-C parallel runs: heartbeat and scheduling` at the end of the file (PAR-03/05, the #218 head probe, and the #224 review-round-1 heartbeat/scheduling tests).
- `tests/v7-relfx-1-completion.test.ts` (step `tests-6`): the self-contained describe `C-PAR-1 review round 1 (#224): writer reaping, identity and durability` (the PAR-04 reaping tests; they start real child processes).
- `tests/support/par.ts` (support module, **not** a test file): the shared fixtures of both blocks (setup, slow-git model, process helpers). The separate file `tests/v7-par-runner.test.ts` was removed, so `tests/pkg-vs-validation-sharding.test.ts` stays green without a `config/validation.json` change.
- `tests/v7-par-engine.mts` (helper, **not** a vitest file: `*.mts` is outside vitest's default include and outside `tsconfig.json`'s `tests/**/*.ts`). The PAR-04 test runs it in two separate `node --import tsx` processes and SIGKILLs the first one.
- The "slow git" model no longer uses a module-wide `vi.mock("node:child_process")` (it would have affected the host file's other tests): the block installs `vi.spyOn` on the default `child_process` export object (the very object `git-isolation.mjs` and `runner.ts` call through) in its own `beforeEach` and restores it in its own `afterEach`.

## Cost
Measured on Linux for the 14 tests: about 50 s, of which about 34 s is real time by design (PAR-05 about 14 s, a slow run of 8 s; PAR-04 about 20 s, an orphan child that sleeps 8 s; the PAR-03 cases 3 s each). Expect more on Windows (three `tsx` start-ups, one PowerShell start for the process-start token); tests-7 has more than 500 s of headroom there.

## What the file proves (each case FAILS on `fe08022`, PASSES on the fix; both runs recorded in the PR). Added with the #218 merge: the repository HEAD probe the runner runs in its WORKSPACE step is #218's one decision procedure driven ASYNCHRONOUSLY (`repositoryHeadAsync`), so a slow probe cannot starve another run's lease; the readiness/Lane B caller keeps the synchronous driver (`repositoryHead`)
1. PAR-03: a slow git clone in run A (3 s, TTL 2 s) no longer fences run B (`fenced = []`, B implementer calls 1, aborted 0).
2. PAR-03: a stalled event loop (p99 above TTL/6) refuses the second claim, never the first.
3. PAR-05: with the production tick interval (2 s), C's implementer starts within one tick of A reaching `AWAITING_APPROVAL` while B is still in IMPLEMENT.
4. PAR-04: after a SIGKILLed engine, the surviving implementer child is stopped at takeover: `ORPHAN.txt` absent, work HEAD equals `run.headSha`, run completes.
5. PAR-04: `guardWorkspace` fences a mutation when the owner record is missing, unreadable or of another lease; VERIFY refuses a workspace whose HEAD moved (`WORKSPACE_DIVERGED`) instead of silently repairing it.
6. PAR-03: `span()` renews every owned lease before and after a synchronous span (throttled to TTL/10).
7. PAR-03: the real `monitorEventLoopDelay` sampler reports a 700 ms stall after a long healthy period (a single stall is not buried in a long window).
8. PAR-04: takeover fails closed (`RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE`) when the previous writer is of unknown state, and never signals a process whose recorded start time does not match.

## Residual (not fixed in C-PAR-1; needs a contract change outside Lane C)
The PAR-04 tracking covers the children the runner starts itself: the implementer, the reviewer and the workspace-mutating `git` processes. The VERIFY test process is not tracked: it runs inside the sandbox provider with `cwd = runs/<id>/work`, and `SandboxRunOptions` (`core/workos/execution-gate.ts`) has no `onSpawn`. If the engine dies during VERIFY, a detached test group can keep writing into `work` while a new engine takes over and starts a second run in the same directory.
Request (either one closes it):
1. Add `onSpawn?: (child: {pid: number; pgid: number | null}) => void` to `SandboxRunOptions` and forward it in each provider's `runProcess` call (`core/agents/linux-unshare-sandbox.ts` `exec`, Lane B's WSL provider). Lane C then wraps `runTests` in the existing `withChild`, so the group is recorded and killed at takeover like every other writer.
2. Or run the VERIFY tests in the scan clone (as REGRESSION already does), so no test process ever has `work` as its cwd.

## #218 merge (C-PAR-1 branch)
`core/workos/runner.ts` had two conflict hunks with `claude/lane-c-runner-head-predicate`. Resolution keeps both behaviours: `runGitAsync` (with an optional timeout) and the owner-record helpers from C-PAR-1, `repositoryHead` / `RepositoryHead` / `GIT_PROBE_ENV` from #218. The decision procedure is now ONE generator (`headDecision`); `repositoryHead` (sync, unchanged contract and outputs, for readiness.ts) and `repositoryHeadAsync` (runner WORKSPACE step) are two thin drivers that apply the same env allow-list (`gitProbeEnv`: fixed names + `GIT_NO_LAZY_FETCH`, never `process.env`, never the runner's own policy env), the same `-c protocol.allow=never` prefix, the same ceiling and the same shared deadline. Tests: both drivers give the same verdict on 8 repository shapes x 4 planted environments; a planted `GIT_DIR` in the engine process cannot change a run's `baseSha`; a slow probe (3 s, TTL 2 s) leaves the other run unfenced; the async driver keeps the event loop ticking while the sync driver blocks it.

## #224 review round 1 (REVIEW-0baa72f): finding -> fix -> the test that fails without it
All tests run on the fix head; the mutant list `docs/lanes/LANE-C-par-review-mutants.json` (33 mutants, harness `LANE-C-par-review-mutants.mjs`) re-introduces each defect and the named test kills it.

| Finding | Fix | Test (host) |
|---|---|---|
| HB-1 (HIGH) production implementer path starves other runs | `commitBuilderOutputAsync` (engine commit on `runGitAsync`, `span`, `onSpawn`); `ExecContext.span` | `HB-1: the production implementer path ...` (tests-7) |
| PAR04-GSTOP-NO-REAP (HIGH) GLOBAL_STOP takeover never reaps | `reapPriorWriter` before `cancelLeased` | `PAR04-GSTOP-NO-REAP` (tests-6) |
| TK-2 / EXHAUSTED-NO-REAP: budget-exhausted takeover never reaps | reap before the exhausted failure; note names the stopped group | `TK-2 / PAR04-EXHAUSTED-NO-REAP` (tests-6) |
| TK-3 EPERM on a reused pid fails closed at cap 1 | start token compared before the EPERM verdict; boot id recorded | `TK-3` (tests-6) |
| TK-4 owner file not atomic / not durable; write failure fails the step | `writeJsonAtomic` + `.prev`; record older than the boot or from another boot = no writer; step-start write failure = RETRY `OWNER_RECORD_WRITE_FAILED` | three `TK-4` tests (tests-6) |
| TK-1 setsid descendant escapes the group kill | per-lease env marker (`UASCO_WRITER_RUN/LEASE`) + `/proc` environ/cwd sweep; survivors = `WORKSPACE_WRITER_ALIVE` | `TK-1` (tests-6) |
| TK-5 SIGINT/SIGTERM/SIGHUP no longer stops the writer | `installTerminationForwarding` kills the recorded groups | `TK-5` (tests-6) |
| TK-6 / TK-8 macOS locale-dependent `ps`; Windows kill is two steps | `ps` absolute path with pinned TZ/locale; ONE PowerShell call that re-checks the start time | `TK-6 / TK-8` (tests-6, command construction only) |
| TK-7 leaderless group | killed only when boot and member start times prove it is the recorded writer's | `TK-7` (tests-6, Linux) |
| HB-2 per-file reads and callbacks hold the loop | `renewAllOwned` in the `git show` callback and the range callback; async `rmUnderRun` | `HB-2` (tests-7) |
| HB-3 drift sentinel | sentinel does not depend on the histogram's dropped first sample | `HB-3` (tests-7) |
| stop() neither aborts nor awaits | `stop(): Promise<void>`: abort, no new step, await drives, run stays un-cancelled (`ENGINE_STOPPING`) | `STOP-NO-ABORT-NO-AWAIT` (tests-7) |
| LOW pins M3, M9, M5, M7, M10, M11 | tests only | `TEST-PAR05-REFILL`, `TEST-SELF-TAKEOVER`, `TEST-PAR04-DEFENCES` x4 (M5, M10, M11 in tests-7; M7 in tests-6) |

Not covered here (see the PR; round-2 additions follow below): Windows paths run nowhere in this environment; the VERIFY test process is found only by the cwd sweep (the sandbox mount namespace may hide the cwd); TK-8 is a construction test, not a Windows run; the engine-commit git `onSpawn` tracking has no kill test; the `renewAllOwned` call in the gitleaks range callback (HB-2) has no test of its own (the per-file `git show` renewal is the pinned part).

## #224 review round 2 (own adversarial pass on the round-1 fix, 4 lenses + skeptics): defect -> fix -> the test that fails without it
Mutants R1..R11 in `docs/lanes/LANE-C-par-review-mutants.json` re-introduce each defect (46 mutants in total).

| Defect found in the round-1 fix | Fix | Test (host) |
|---|---|---|
| R2-1 MEDIUM: `stop()` removed the exit/SIGINT/SIGTERM/SIGHUP kill hooks before the writer groups were dead, and the only production caller does not await it | hooks are released only after the drives settled (`stop()` captures the release function) | `R2-1` (tests-7) |
| R2-2 MEDIUM: a forwarded SIGTERM/SIGINT/SIGHUP killed the writer behind the runner's back; with another signal listener the live drive recorded `IMPLEMENT_FAILED` (terminal FAILED) | `writer-guard` raises a `terminating` flag; a halted engine records only DONE/REMEDIATE and GLOBAL_STOP cancels, never FAILED/BLOCKED/RETRY/LEASE_LOST | `R2-2` (tests-7, real handler via `process.emit("SIGHUP")` with a second listener) |
| R2-3 LOW: `stop()` then `start()` while draining reset `stopping`; the abort poll never fired or the abort became a terminal `LEASE_LOST` cancel | `stopEpoch` counter: a drive/step that began before a `stop()` stays halted | `R2-3` (tests-7) |
| R2-4 LOW: an owner-record write failure on the engine commit's ~10 git children became a permanent `BUILDER_*` block | `SPAWN_RECORD_FAILED` in the commit => transient result => `RETRY_SCHEDULED` | `R2-4/5` (tests-7) |
| R2-5 LOW: commit git children carried no lease marker; on Windows/macOS each triggered a PowerShell/`ps` identity call | `extraEnv: ctx.writerEnv`; children are reported `short: true` (no identity lookup) | `R2-4/5` (tests-7; the identity skip is Windows/macOS-only and not exercised on Linux) |
| R2-7 LOW: a leaderless group (recycled group id) passed the proof because recycled groups also start after the recorded leader | the proof additionally requires a member carrying `UASCO_WRITER_LEASE=<recorded lease>` | `TK-7` case (b2) (tests-6) |
| R2-8 LOW: the sweep signalled each process once, so a descendant forked after the snapshot survived | rescan and re-kill until a scan is clean or the deadline | `R2-8` (tests-6, deterministic scan sequence) |
| R2-9 LOW: `runDir` was compared lexically; a symlinked data dir disabled the cwd sweep | `runDir` and its realpath are both compared | `R2-9` (tests-6) |
| R2-10 LOW: escaped descendants were swept only at takeover, not after timeout/abort/retry | after every implementer child the step's own lease marker is swept before the next step (`WORKSPACE_WRITER_ALIVE` if one survives) | `R2-10` (tests-6) |
| R2-11 LOW: the owner-record refresh at the end of `reapPriorWriter` was unguarded, so a disk error could turn an emergency cancel into `FAILED` | the refresh failure is noted, not thrown | `R2-11` (tests-6) |
| tests: fixed ORPHAN window (6 s) raced engine start-up under load; vacuous `ORPHAN2/3.txt` assertions; leaks on failure; TK-1 not platform-aware; M5 leaked a fake pgid; SELF-TAKEOVER passed vacuously | the orphan waits for a `release` file the test writes after proving the writer dead; cleanup in `afterEach`/`finally`; fail fast when engine 1 exits; Linux guards; impossible pgid + untrack; positive scenario assertion | the existing tests, rewritten |

## Requests to the coordinator (both files are protected; NOT changed here)
1. `apps/control-api/src/server.ts` (the `onClose` hook, currently `app.addHook("onClose",async()=>{workRunner?.stop()});`) should await the new Promise: `app.addHook("onClose",async()=>{await workRunner?.stop()});`. Without it the desktop shutdown path (`stdin` end -> `app.close()` -> `process.exit`) never waits for the aborted drives; on POSIX the kept exit hook still kills the writer groups, on Windows (no forwarding) the 250 ms abort poll may not fire before exit.
2. `scripts/claude-builder-broker.mjs` rebuilds the claude child environment with `safeChildEnv`, which drops `UASCO_WRITER_RUN` / `UASCO_WRITER_LEASE`. To let the lease sweep find `setsid` descendants of the claude CLI, `main()` should copy those two variables (when present in `process.env`) into the `env` of the final `cp.spawnSync(prov.claude.resolvedPath, ...)`. Until then those descendants are found only by the Linux cwd heuristic and not at all on Windows/macOS; the group kill still covers everything that stays in the broker's process group.

## Known residuals after round 2
- The cwd heuristic can SIGKILL an unrelated same-user process whose cwd is inside a run directory at takeover (for example an editor opened by the Founder in `runs/<id>/work`); the lease marker is the precise mechanism, the cwd rule exists for the unmarked VERIFY process.
- A graceful SIGTERM/SIGINT handled by another listener leaves the run leased (by design) until the next engine's takeover.
