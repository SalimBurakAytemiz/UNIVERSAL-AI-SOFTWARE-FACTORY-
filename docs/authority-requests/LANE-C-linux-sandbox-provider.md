<!-- //TR: LANE-C yetki talebi: ücretsiz Linux sandbox sağlayıcısının (core/agents/linux-unshare-sandbox.ts) ExecutionGate'e kaydı korumalı server.ts içindedir; Windows tasarım notları ve sınırlamalar burada. -->
# LANE-C authority request: register the free Linux sandbox provider

## What was built (no protected file touched)
`core/agents/linux-unshare-sandbox.ts` implements the existing `SandboxProvider` contract (`core/workos/execution-gate.ts`) with util-linux `unshare` + `setpriv` only (no package, no dependency, no network, no cost):
- user + net + pid + ipc + uts + mount namespaces; `--kill-child=SIGKILL`; fresh `/proc`;
- root filesystem remounted read-only; only the run's working directory (and `TMPDIR` inside it) is writable;
- all capabilities dropped (`CapEff=0`), `no_new_privs`, so the project cannot remount rw;
- ulimits: CPU seconds (timeout + 5 s), address space (16 GiB default), file size (2 GiB blocks default);
- timeout kills the whole process tree (parent SIGKILL + pid-namespace teardown);
- env is exactly what the caller passes (the runner already passes `safeChildEnv`);
- `selfTest()` proves, with negative probes, pid-ns, scratch-writable, root-read-only, remount-denied, caps-dropped, no network interface, and tree-kill. Any failure => provider stays UNVERIFIED and `run()`/`spawn()` refuse (never host execution).

## Protected hook needed (coordinator applies)
`apps/control-api/src/server.ts` line `const executionGate=new ExecutionGate(opts.sandbox??null);`
```diff
-const executionGate=new ExecutionGate(opts.sandbox??null);
+const executionGate=new ExecutionGate(opts.sandbox??(process.platform==="linux"?new LinuxUnshareSandboxProvider():null));
```
plus `import {LinuxUnshareSandboxProvider} from "../../../core/agents/linux-unshare-sandbox.js";`. The gate still authorizes only after `selfTest()` passes, so a host that cannot isolate keeps today's behaviour (`SANDBOX_UNAVAILABLE`, tests `NOT_EXECUTED`). No config file or `config/validation.json` change is needed (tests live in the registered `tests/v7-int-r3-sbx-gate.test.ts`).

## Founder decision needed (not mine)
FD-REL-1 says project code runs only in a *verified* sandbox. Whether this provider counts as "verified" for the `sandboxProviderId` witness behind functional acceptance is the Founder's call. Honest limits to weigh:
- shares the host kernel; no seccomp filter; no cgroup memory/pids limit (ulimit only; no unprivileged cgroup delegation) => a fork bomb or memory hog is bounded only by ulimit and the timeout;
- needs unprivileged user namespaces. Ubuntu 24.04 GitHub runners restrict them via AppArmor, so there the provider will report `SELFTEST_NAMESPACES_UNAVAILABLE` and refuse; the positive/negative isolation tests then degrade to asserting the refusal. Positive proof was produced in the Linux cloud container (see PR body counts).
- `PRODUCT_VERIFIED` must still not be claimed from this alone.

## Windows design notes (provider stays NOT_IMPLEMENTED)
Reports `PLATFORM_NOT_LINUX_NOT_IMPLEMENTED`. A real Windows provider would need: a Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, active-process, memory and CPU-time limits) + a restricted token (or an AppContainer / low-integrity process) started by a small native helper, network denied by AppContainer without `internetClient` capability or a WFP filter, filesystem via explicit ACL on the workspace only. Node alone cannot create these without a native addon or helper binary (= new dependency / binary), so this needs an authority decision and can be marked implemented only after a self-test passes on `windows-latest`.

## Tests that prove it
`tests/v7-int-r3-sbx-gate.test.ts`, describe "LANE-C Linux unshare sandbox provider": host-exec refusal (missing primitives, wrong platform, not self-tested; marker file never created; gate => SELF_TEST_FAILED), self-test required on hosts that can isolate (bad provider cannot pass silently), project test command exit 0 and non-zero, network blocked (real host listener sees 0 connections), writes outside scratch blocked + caps dropped + remount denied + env not inherited, timeout kills the process tree, unsafe cwd / invalid argv refused. Mutation checks recorded in the PR.
