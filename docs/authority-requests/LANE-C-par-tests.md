<!-- //TR: LANE-C yetki talebi: C-PAR-1 regresyon testi dosyasının config/validation.json (korumalı) bir test parçasına kaydı koordinatör işidir. -->
# LANE-C authority request: register the C-PAR-1 parallel-run regression file (config/validation.json)

Coordinator package C-PAR-1 (MissionRunner safe at `maxConcurrentRuns >= 2`). `tests/v7-b3a-runner.test.ts` is near the Windows 600 s step limit and is not grown; the three inverted audit repros live in one new file instead. `config/validation.json` is protected, so the registration is the coordinator's.

## Files
- `tests/v7-par-runner.test.ts` (9 tests; the vitest file).
- `tests/v7-par-engine.mts` (helper, **not** a vitest file: `*.mts` is outside vitest's default include and outside `tsconfig.json`'s `tests/**/*.ts`). The PAR-04 test runs it in two separate `node --import tsx` processes and SIGKILLs the first one.

## Shard entry
Add `"tests/v7-par-runner.test.ts"` to the end of the `command` array of one existing shard (no new shard needed, no `platforms` filter: it must run on Windows too, the production platform). Measured wall time of the file alone on Linux: about 44 s (about 45 s against the unfixed base). The slowest cases are real time by design: PAR-05 about 14 s (a slow run of 8 s), PAR-04 about 20 s (an orphan child that sleeps 8 s). Expect more on Windows (three `tsx` start-ups, one PowerShell start for the process-start token). Pick the shard by its measured duration; `tests-3` is the one to avoid until the runner file split (#214) has landed.

```json
"command": ["node", "node_modules/vitest/vitest.mjs", "run", "<existing files of the chosen shard>", "tests/v7-par-runner.test.ts"]
```

`tests/ci-validation-shards.test.ts` (if it pins the shard file lists) needs the same one-line addition.

## What the file proves (each case FAILS on `fe08022`, PASSES on the fix; both runs recorded in the PR)
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
