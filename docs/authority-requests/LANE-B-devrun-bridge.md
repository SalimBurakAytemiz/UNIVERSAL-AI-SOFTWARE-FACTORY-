<!-- //TR: Lane B yetki talebi (B-RUN-1): teslim edilen ürünün sandbox içinde çalıştırılması ve tek portluk 127.0.0.1 köprüsü; server.ts kaydı, Electron izin listesi ve Lane C için metin farkı -->
# LANE-B-devrun-bridge: running the delivered product (sandbox only, one bridged port)

## Security model (established from core/workos/devrun.ts on v7/integration)
- Before this change: `DevRunManager.start` already refuses without a verified provider (`ExecutionGate.authorize("STUDIO_DEVRUN")` -> 409 `SANDBOX_UNAVAILABLE`, state BLOCKED, nothing spawned) and starts the product through `gate.provider.spawn(...)` with `safeChildEnv`, `HOST=127.0.0.1`, a fresh clone of the managed repo (never `repository.path`). There was no host fallback.
- Gap: the real Linux provider runs in its own network namespace (`--net`), so the product's `127.0.0.1:PORT` was invisible to the host: the preview probe could never succeed, and no bridge existed.
- Rule kept: no uncontrolled execution on the host, no run before isolation is verified. A provider that isolates the network may host a product ONLY with a provider bridge.

## What B-RUN-1 adds (all in Lane B files)
- `core/workos/devrun-bridge.ts`: `providerNetwork` (HOST for test doubles, ISOLATED for `linux-unshare-v2`/`wsl-unshare-v1` or when the provider declares `network`), `bridgeSupport(provider)` (exact reason or a starter) and `startNsenterBridge`.
- Bridge = host listener on **127.0.0.1:<port> only**; each connection spawns a fixed relay `nsenter -U --preserve-credentials -n -t <sandbox pid> node -e RELAY <port>` that connects to `127.0.0.1:<same port>` inside the sandbox netns. Direction is host -> sandbox only; nothing in the sandbox can reach the host. Safeguards: netns of the target must differ from the host's (else refuse `BRIDGE_TARGET_NOT_ISOLATED`, which would expose host loopback), re-checked per connection (pid reuse/exit), max 32 connections, 120 s idle timeout, closed on stop/exit.
- `DevRunManager.start(project, link?)`: refusal `DEVRUN_SANDBOX_UNAVAILABLE` (409, `reason` = exact code) BEFORE clone/spawn when the provider cannot be bridged; state BLOCKED `DEVRUN_SANDBOX_UNAVAILABLE:<reason>`. With `link {runId, headSha}` the product runs the DELIVERED commit (not repo HEAD; missing -> `DEVRUN_DELIVERY_HEAD_MISSING`) and the state records `deliveryRunId`, `bridged`.
- `apps/control-api/src/routes/product-run.ts`: `GET /v1/work-runs/run_<24hex>/product`, `POST .../product/start`, `POST .../product/stop` (empty body; Global Stop 423; policy 403; run must have SOURCE_GENERATION_COMPLETE + a delivered commit; stop never closes another run's product).
- Reason codes: `SANDBOX_LOOPBACK_NOT_VERIFIED:<code|NOT_REPORTED>`, `NSENTER_MISSING`, `BRIDGE_PLATFORM_NOT_LINUX`, `PROVIDER_HAS_NO_BRIDGE:<id>` (providers without bridge()), `DEVRUN_BRIDGE_FAILED:<code>`.

## Registration diff (apps/control-api/src/server.ts, protected)
```diff
+import {registerProductRunRoutes} from "./routes/product-run.js";
 ...
+registerProductRunRoutes(app,{...laneDeps,devruns:getDevRuns});
```
(`getDevRuns` is the existing lazy DevRunManager factory; `laneDeps` is the existing RouteDeps object.)

## Electron allow-list (apps/desktop/main.mjs, protected)
- GET `/^\/v1\/work-runs\/run_[0-9a-f]{24}\/product$/` (no query)
- POST `/^\/v1\/work-runs\/run_[0-9a-f]{24}\/product\/(?:start|stop)$/` (empty body)

## Lane C dependencies (text, for the coordinator to route)
1. C-SBX-LO-1 (loopback in the Linux sandbox): the bridge needs `provider.capabilities.loopback === true` (set by selfTest after proving 127.0.0.1 listen+connect with `lo` up). Until it is merged, a real Linux product run is REFUSED with `SANDBOX_LOOPBACK_NOT_VERIFIED:NOT_REPORTED`, never run unbridged.
2. Optional hardening (no behaviour change needed): declare the isolation explicitly instead of by id in `LinuxUnshareSandboxProvider`:
```diff
 export class LinuxUnshareSandboxProvider implements SandboxProvider {
   readonly id = LINUX_SANDBOX_ID;
+  readonly network = "ISOLATED" as const;
```
3. Known limit (Lane C file): `spawn()` hardcodes `args(cwd, 600_000, ...)`, so RLIMIT_CPU is ~605 s of CPU time; a long-lived dev server idle most of the time is fine, a busy one is killed. A `spawn` timeout option would remove it.
4. Host requirements for the Linux bridge: `nsenter` (util-linux) and unprivileged user namespaces; verified on this host as an unprivileged user (uid 65534) joining the sandbox netns with `nsenter -U --preserve-credentials -n`.

## Windows / WSL (B-RUN-WIN-1, UNVERIFIED_WSL: needs the Founder's real run)
- `SandboxProvider` gets an optional `spawnAsync` (core/workos/execution-gate.ts); `DevRunManager` uses it when present (WSL needs async prep: interop re-check, copy-in, staging). Sync `spawn()` of the WSL provider stays unsupported. The returned process (`wsl.exe -d <distro> --exec /bin/sh <S>/ctl/run.sh`) carries `sandboxTeardown`; on exit/stop/crash the Linux timeout process group is killed (`kill -KILL -- -pgid`), `pkill`/`pgrep` verify, scratch is removed, and DevRunManager waits for it. A stop that arrives while spawnAsync is still preparing kills the process it returns.
- Same isolation as `run()` (same setup.sh/NS_FLAGS, env filter, no host path in any wsl.exe argv); the dev lifetime is bounded by `timeout --signal=KILL` (default 6 h, `devMaxMs`). Interop is re-checked on every start.
- Bridge: Windows listener on **127.0.0.1:<port> only** (no 0.0.0.0, no WSL localhost forwarding); each connection runs `wsl.exe -d <distro> --exec /bin/sh <S>/ctl/relay.sh <pid> <port>`; `relay.sh` (outside the sandbox, inside WSL) checks pid/port are digits, the pid exists and its netns differs from its own (exit 98/96/97), then `nsenter -U --preserve-credentials -n -t <pid> <node> relay.js <port>` connects to 127.0.0.1:<port> inside the sandbox netns. The target pid is the `unshare` process (child of the `timeout` pid file) found with `pgrep -P`. `node` must be an absolute non-/mnt path found in WSL (selfTest `WSL_TOOLS_MISSING` otherwise); the distro also needs `nsenter` and `readlink`.
- Not verifiable here: real `wsl.exe` stdio/exit behaviour, `nsenter -U` inside WSL2's kernel, taskkill/teardown timing, `pgrep -P` target selection. The real-WSL test (win32 + UASCO_WSL_DISTRO) starts the web-node product, fetches 200 through the bridged port and tears down; it is SKIPPED everywhere else.

## Evidence
Tests: tests/v7-ps1a-c2-remediation.test.ts describe "LANE-B product run: provider bridge (B-RUN-1)" (fake-provider refusals, bridge happy path, tied delivery, netns guard, real netns bridge, real Linux provider) and tests/v7-b1-workos.test.ts describe "LANE-B product run routes (B-RUN-1)". The two REAL tests are SKIPPED unless `ip`+`nsenter` exist / selfTest passes with proven loopback; on this host they were verified once with a temporary `ip` stub and the patched provider from C-SBX-LO-1 (not committed).
