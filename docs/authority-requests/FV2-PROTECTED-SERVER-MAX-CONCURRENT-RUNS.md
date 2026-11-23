<!-- //TR: Factory V2 korumalı değişiklik talebi: uygulama içi V7 MissionRunner eşzamanlılığını açmak için apps/control-api/src/server.ts'te tek satırlık bağlama ve trust-root yeniden mühürleme; ayrı Founder yetki kapsamıdır, bu dalda UYGULANMADI. -->
# FV2 protected request: in-app MissionRunner concurrency (`server.ts`)

**Status:** prepared, not applied. Needs Founder protected-path authority, in a PR separate from the Factory V2 PR.

## Why
`MissionRunner` already supports `maxConcurrentRuns` 1..16 (`core/workos/runner.ts:51,242`; any other value is refused with `RUNNER_MAX_CONCURRENT_RUNS_INVALID`). The only constructor call, `apps/control-api/src/server.ts:306-307`, never passes it, so the in-app V7 runner always runs at 1. This is independent of the cloud factory (Factory V2 runs Claude Cloud sessions, not this runner).

## Exact change
See `FV2-PROTECTED-SERVER-MAX-CONCURRENT-RUNS.diff` (2 lines):
1. `BuildServerOptions.runner`: add `"maxConcurrentRuns"` to the picked `RunnerOptions`.
2. `getRunner()`: pass `maxConcurrentRuns: r.maxConcurrentRuns ?? Number(UASCO_WORKOS_MAX_CONCURRENT_RUNS)`.
   - When the variable is unset the value is `undefined`, and the runner keeps its default of 1. Today's behaviour is unchanged.
   - A malformed value (`abc`, `0`, `17`, `2.5`) makes the runner constructor throw. The server then audits `WORKOS_RUNNER_NOT_STARTED` and does not start a runner, so a bad value never silently falls back to 1 (fail-closed).

## Also required in the same protected PR
- **Trust-root reseal.** `config/trust-root-manifest.json` pins `apps/control-api/src/server.ts`.
  - Current sha256: `23aa0d0b37b893e340ac490781ced3d6da8101428e3ff5f0f384cf460f668fc7`.
  - sha256 after applying this diff on `5356c94`: `a65e002dc27dfacd939b0c359cc25a43ef22b56ccee4bc5dc489b1323a159ed0`. Recompute this at apply time if `server.ts` has changed in the meantime.
- **Tests (to add with the change):**
  - unset → 1 (no behaviour change)
  - `UASCO_WORKOS_MAX_CONCURRENT_RUNS=8` → 8 owned runs overlap
  - invalid values → `WORKOS_RUNNER_NOT_STARTED`
  - `opts.runner.maxConcurrentRuns` overrides the environment variable

## Evidence so far
The diff applied cleanly in a temporary worktree of `5356c94` and `tsc --noEmit` passed. The worktree was then removed; no protected file in this branch was modified.
