<!-- //TR: LANE-C bilgi notu: C-PAR-1 testleri kayıtlı bir dosyaya taşındı; config/validation.json kaydı gerekmez (yalnız aşağıdaki VERIFY artığı için sözleşme değişikliği isteği kalır). -->
# LANE-C note: C-PAR-1 parallel-run regression tests live in the registered `tests/v7-relfx-c3-remediation.test.ts` (no registration needed)

Coordinator package C-PAR-1 (MissionRunner safe at `maxConcurrentRuns >= 2`). `tests/v7-b3a-runner.test.ts` is near the Windows 600 s step limit and is not grown; the three inverted audit repros live in one new file instead. `config/validation.json` is protected, so the registration is the coordinator's.

## Files
- `tests/v7-relfx-c3-remediation.test.ts` (step `tests-7`, measured 71 s on Windows in run 40261485904): the self-contained describe `LANE-C parallel runs: C-PAR-1 (+ #218 head probe)` at the end of the file (14 tests). The separate file `tests/v7-par-runner.test.ts` was removed, so `tests/pkg-vs-validation-sharding.test.ts` stays green without a `config/validation.json` change.
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
