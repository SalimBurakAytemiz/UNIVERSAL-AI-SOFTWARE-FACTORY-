<!-- //TR: Lane B yetki talebi: Windows için WSL2 sandbox sağlayıcısının (core/sandbox/wsl-unshare-sandbox.ts) ExecutionGate'e kaydı korumalı server.ts içindedir; Lane C'den üç dışa aktarma ve Founder'ın WSL kurulum adımları burada -->
# LANE-B authority request: register the free Windows (WSL2) sandbox provider — B-SBX-WIN-1

## STATUS
Code and tests on branch `claude/lane-b-sbx-win-1` (branch only, no PR yet). Tested on Linux with an injected fake `wsl.exe`; **never run against a real WSL2 here (NOT_EXECUTED)**. The real selfTest case only runs on win32 with `UASCO_WSL_DISTRO` set and WSL present; elsewhere it is reported SKIPPED, never PASS.

## What it is
`WslUnshareSandboxProvider` (`core/sandbox/wsl-unshare-sandbox.ts`, `core/sandbox/wsl-tar.ts`; no dependency, no Docker, nothing paid, nothing executed on the Windows host). The project test command runs inside the Linux provider's own isolation (`unshare` + `pivot_root` + dropped capabilities, the script lives in `core/agents/linux-unshare-sandbox.ts` and is **not copied**) launched through `wsl.exe -d <distro> --exec`.
- **Copy in, never bind-mount:** the project directory is turned into a plain ustar archive in Node (regular files and directories only; symbolic links and special files are skipped and reported; limits 20 000 files / 256 MiB / 64 MiB per file / depth 40; unsafe names refuse) and extracted into a fresh WSL `/tmp/uasco-sbx-XXXXXX/work` (WSL ext4, not `/mnt/c`). Results are not copied back (stdout/stderr/exit code only).
- **No fragile quoting through wsl.exe:** scripts and the quoted command line are written to WSL as files through `tee` (stdin); `wsl.exe` only ever receives simple tokens. Env values are POSIX-quoted into `run.sh`; Windows-only variables and any value that looks like a Windows path are dropped; `PATH` is fixed.
- **Timeout/abort:** WSL side `timeout --signal=KILL --kill-after=3` around `unshare --kill-child=SIGKILL` (the whole pid namespace dies); Windows side `taskkill /T /F` on `wsl.exe`; then `pkill -KILL -f <scratch>` and `rm -rf <scratch>` in every case.
- **Windows host paths** in argv are refused; the host `process.execPath` (what the runner passes for `node`) is translated to `node` inside WSL.
- `spawn()` (Studio dev-run) is not supported in v1: it throws `SANDBOX_REFUSED: SPAWN_NOT_SUPPORTED_IN_WSL_V1`.

## Fail-closed selfTest (any failure → unavailable with an exact code, never a host fallback)
Reason codes: `PLATFORM_NOT_WIN32`, `WSL_EXE_MISSING`, `WSL_NOT_AVAILABLE`, `WSL_DISTRO_NOT_CONFIGURED`, `WSL_DISTRO_MISSING`, `WSL_VERSION_NOT_2`, `LINUX_ISOLATION_EXPORTS_MISSING`, `INTEROP_ENABLED`, `WSL_TOOLS_MISSING`, `NO_NEW_ROOT_MOUNTPOINT` (`/mnt` is never used as the new root), `SCRATCH_CREATE_FAILED`, `PROBE_FAILED`, and `PROBE_<KEY>` for each negative probe run **inside** the sandbox: `MNT_C` (no `/mnt/c`), `DRVFS` (no drvfs/9p/`/mnt/x` mounts in mountinfo), `INTEROP_FILE` (no `WSLInterop` binfmt entry), `PE_EXEC_RC` (an MZ file cannot be executed: 126/127), `UNIX_PATH_SOCKETS` (no path unix sockets), `WSL_RUNTIME_DIRS` (no `/run/WSL`, `/mnt/wslg`, X11), `RW_usr`/`RW_etc`/`RW_bin` (read-only root), `WORK` (writable `/work`), `NET_IFACES` (no interface except `lo`, as the Linux provider). Outside the sandbox it also reads `/proc/sys/fs/binfmt_misc/WSLInterop` (+ `-late`): present and enabled → `INTEROP_ENABLED`. The exact reason is `provider.lastSelfTest.detail`; `ExecutionGate` itself only shows `SELF_TEST_FAILED`.

## Needed from Lane C (read-only file for me): three exports
`core/agents/linux-unshare-sandbox.ts` keeps its isolation script and flags module-private. Please export them unchanged (same pattern as C-RUNNER-EXPORTS):
```diff
-const NS_FLAGS = [...];
-const HELPER_PATH = "...";
-const SETUP = [ ... ].join("\n");
+const NS_FLAGS = [...]; export const LINUX_SANDBOX_NS_FLAGS = NS_FLAGS;
+const HELPER_PATH = "..."; export const LINUX_SANDBOX_HELPER_PATH = HELPER_PATH;
+const SETUP = [ ... ].join("\n"); export const LINUX_SANDBOX_SETUP = SETUP;
```
Until they exist the WSL provider answers `LINUX_ISOLATION_EXPORTS_MISSING` (a test pins this and flips automatically once they exist).

## Protected hook (coordinator applies in batch 4, ONLY after the exports and this branch are on `v7/integration`)
`apps/control-api/src/server.ts` line 274:
```diff
-const executionGate=new ExecutionGate(opts.sandbox??null);
+const executionGate=new ExecutionGate(opts.sandbox??(process.platform==="linux"?new LinuxUnshareSandboxProvider():process.platform==="win32"?new WslUnshareSandboxProvider():null));
```
plus `import {WslUnshareSandboxProvider} from "../../../core/sandbox/wsl-unshare-sandbox.js";` (and the Linux import from LANE-C-linux-sandbox-provider.md). The gate authorizes only after `selfTest()` passes, so a host without a correctly configured WSL keeps today's behaviour (`SANDBOX_UNAVAILABLE`, tests `NOT_EXECUTED`). The distro comes from `UASCO_WSL_DISTRO` (never auto-picked).

## FOUNDER_ACTION_REQUIRED (Windows host, once)
1. Install WSL2 and one distro: `wsl --install -d Ubuntu` (Windows 10 2004+/11); confirm `wsl -l -v` shows VERSION 2.
2. Inside the distro install what the sandbox needs: `sudo apt-get update && sudo apt-get install -y util-linux coreutils tar procps nodejs` (`unshare`, `setpriv`, `mount`, `pivot_root`, `timeout`, `tar`, `pkill`, `node`; **node must live under `/usr`**, e.g. the apt/NodeSource package — an nvm/home install is not visible in the sandbox).
3. Disable Windows interop and the Windows PATH in `/etc/wsl.conf` of that distro, then `wsl --shutdown`:
```
[interop]
enabled=false
appendWindowsPath=false
```
4. Optional but recommended: also set `[automount] enabled=false` (no `/mnt/c` at all). The selfTest passes either way as long as the sandbox itself cannot see drives.
5. Set the user environment variable `UASCO_WSL_DISTRO` to the distro name (for example `Ubuntu`) for the Control API process.
6. Verify on that machine: `npx vitest run tests/v7-int-r3-sbx-gate.test.ts -t "REAL WSL"` must show PASSED (not skipped).

## Residual risks (documented, not fixed)
- WSL2 is a Hyper-V utility VM (a kernel boundary from Windows) but the sandbox inside it still shares the WSL kernel with other WSL processes; no seccomp, no cgroup limits (ulimit + timeout only), `/work` is bounded only by the copy-in cap and the timeout.
- Interop is the known escape from a Linux mount namespace (`binfmt_misc` `WSLInterop` carries the `F` flag); it is checked outside and inside, but a distro whose interop is switched on later is only caught at the next process start (selfTest runs once per process).
- v1 copies the project in but not results out; the runner currently reads the test outcome from stdout/exit code only.
- `PRODUCT_VERIFIED` must not be claimed from this alone; whether it counts as a verified sandbox (FD-REL-1) is the Founder's call.

## Evidence
`npx vitest run tests/v7-int-r3-sbx-gate.test.ts -t "LANE-B WSL"`: 29 passed + 1 real-WSL case skipped on Linux (describe "LANE-B WSL unshare sandbox provider"): every reason code above, each negative probe (bad value and missing key), argument/script construction, copy-in contents (no symlink, no host path, no `/mnt/`), env filtering, argv translation, timeout, cleanup, spawn refusal. 12 mutations (interop check, probe leniency, `/mnt` root, argv translation, env filter, cleanup, verified gate, KILL signal, WSL version, unsafe names, quoting, home guard) each failed a test.
