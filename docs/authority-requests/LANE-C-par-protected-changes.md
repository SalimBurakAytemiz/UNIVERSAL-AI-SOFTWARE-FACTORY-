<!-- //TR: LANE-C yetki talebi (koordinatör): C-PAR-1 için iki KORUMALI dosyada tek satırlık değişiklikler; bu dalda değiştirilmedi. -->
# LANE-C authority request: two one-line changes in protected files (C-PAR-1, #224)

Both files are in `config/protected-paths.json`; Lane C does not change them. Both changes are additive and fail-safe: until they land, behaviour is exactly the one described under "Without it".

## 1. `apps/control-api/src/server.ts`: `onClose` must await `MissionRunner.stop()`
Current line (the `onClose` hook): `app.addHook("onClose",async()=>{workRunner?.stop()});`
Requested line: `app.addHook("onClose",async()=>{await workRunner?.stop()});`

`stop()` now returns a Promise that resolves when the in-flight drives have aborted their writer groups and settled; it never cancels a run (the next engine takes it over after the lease expires). The exit/SIGINT/SIGTERM/SIGHUP kill hooks stay installed until it resolves.
Without it: on POSIX the still-installed exit hook kills the writer groups when the process exits (the desktop shell closes stdin, `app.close()` resolves, `process.exit(0)`); on Windows (no process groups, no forwarding) the 250 ms abort poll may not fire before exit, so the writer child can outlive the backend until the next takeover.

## 2. `scripts/claude-builder-broker.mjs`: forward the lease marker to the Claude child
`safeChildEnv` drops every variable that is not allow-listed, including `UASCO_WRITER_RUN` and `UASCO_WRITER_LEASE`. In `main()`, the last `cp.spawnSync(prov.claude.resolvedPath, args, {... env ...})` should receive the two variables when present in `process.env`:
`const mark = Object.fromEntries(["UASCO_WRITER_RUN", "UASCO_WRITER_LEASE"].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));` and `env: {...env, ...mark}`.
Without it: a descendant of the Claude CLI that calls `setsid` is found at takeover only by the Linux cwd heuristic (not at all on Windows/macOS); during the step itself (timeout, abort, stop(), signal forwarding) everything that stays in the broker's process group is still killed, but a leftover of the real Claude child after a NORMAL IMPLEMENT carries no marker, so it is neither group-killed (the leader-less group proof needs a marked member) nor swept: it is stopped only at takeover (recorded-pgid kill while the leader lives, or the cwd rule below `work/` on Linux). Tests: none possible in Lane C (protected); the engine side is pinned by `TK-1` / `R2-10` (the FAKE executor forwards the marker unchanged).
