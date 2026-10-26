<!-- //TR: LANE-C yetki talebi: yeni test dosyasının config/validation.json (korumalı) bir parçasına kaydı ve Lane A/B için API alanları koordinatör işidir. -->
# LANE-C authority request: C-IMPL-WIN-1, real implementer readiness on Windows

## Registration (coordinator, protected `config/validation.json`)
New file `tests/v7-lane-c-claude-readiness.test.ts` (18 tests, about 3 s on Linux, no process of its own except `node -e` fakes, no `platforms` filter: the Windows detection is simulated with `path.win32` and injected `isFile`/`env`, so it must also run on Linux CI). Add the exact path to the `command` array of one existing shard. `tests/pkg-vs-validation-sharding.test.ts` is red until then.

## What Lane A/B can read (additive; no state value changed)
`GET /v1/system/executors` already returns `executors: ExecutorSetup.status()`. `LOCAL_CLAUDE` keeps `state` (`READY | NOT_CONFIGURED | PROVENANCE_MISSING | CLI_NOT_FOUND`, the desktop maps these) and gains:
- `cli`: `{state: FOUND | NOT_FOUND | SHIM_UNSUPPORTED, path, kind: EXECUTABLE | CMD | BAT | null, source: PATH | WELL_KNOWN | null, pathDir, searched[], founderAction}`. A `.cmd`/`.bat` launcher (the usual npm install) is `SHIM_UNSUPPORTED` and `state` stays `CLI_NOT_FOUND`.
- `readiness.implementer` and `readiness.reviewer`: `{ready, blockers[], blocker, founderAction, profile: READY | LOGIN_REQUIRED | REFUSED, loginCommand, loginHint}`. `blockers` are in setup order: `CLAUDE_CLI_NOT_FOUND | CLAUDE_CLI_SHIM_UNSUPPORTED`, then a launcher code (`PROVIDER_PROVENANCE_NOT_READY | CLAUDE_PACKAGE_PROVENANCE_REQUIRED | CLAUDE_CLI_NOT_FOUND | CLAUDE_LAUNCHER_PROVENANCE_CHANGED`), then `CLAUDE_PROFILE_LOGIN_REQUIRED | CLAUDE_PROFILE_REFUSED:<reason>`. `loginCommand` is the Founder's own PowerShell command; UASCO never signs in for them.
- Enabling the executor can now answer `reason: "CLI_SHIM_UNSUPPORTED"` (besides `CLI_NOT_FOUND`, `PROVENANCE_CAPTURE_FAILED`). The desktop shows an unknown reason as its raw code until a locale string exists (Lane A: `exec.hint.*`).

## What a run does now (exact reason, no process started, no waiting)
Implementer: profile check first (unchanged `CLAUDE_PROFILE_LOGIN_REQUIRED` / `CLAUDE_PROFILE_REFUSED:*`), then the launcher proof: the run is BLOCKED with `PROVIDER_PROVENANCE_NOT_READY`, `CLAUDE_PACKAGE_PROVENANCE_REQUIRED`, `CLAUDE_CLI_NOT_FOUND` or `CLAUDE_LAUNCHER_PROVENANCE_CHANGED` before the broker starts. Reviewer: the same codes as `invalidReason` (FAILED, not BLOCKED: `runner.ts` maps only the `CLAUDE_PROFILE_` prefix to BLOCKED; I did not touch `runner.ts` here to keep #224 clean). An expired sign-in (credential file present, the CLI prints its own login error at the start of a line) is `CLAUDE_PROFILE_LOGIN_EXPIRED` for both, BLOCKED, never retried.

## NOT_VERIFIED
- No real Claude CLI, no real login, no Windows host: the Windows folders (`%USERPROFILE%\.local\bin`, `%USERPROFILE%\.claude\local`, `%APPDATA%\npm`), the `PATHEXT` behaviour of `where` and the CLI's sign-in error wording (`Invalid API key`, `Please run /login`, `OAuth token has expired`, ...) are from documentation and memory, simulated in tests.
- The install command in the Founder text (`irm https://claude.ai/install.ps1 | iex`) is Anthropic's published one at the time of writing; the text tells the Founder to check the current instructions.
- `scripts/capture-provider-provenance.mjs` (protected) resolves the launcher with `where claude` and starts it without a shell; this package works around it only by putting the CLI folder first on the capture's PATH, and reports `.cmd`/`.bat` honestly instead of working around them. Fixing the capture to accept a `.cmd` launcher would be a protected change.
- Mutants: `docs/lanes/LANE-C-impl-win-mutants.json` and `.mjs` (29, all KILLED).
