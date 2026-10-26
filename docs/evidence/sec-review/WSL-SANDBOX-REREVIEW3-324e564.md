# WSL2 sandbox provider: round-3 security re-review (324e564 = Lane B 6bb4624 + Lane C e0720b7)

Coordinator independent review: 4 agents (prior-finding verification, seccomp/abort sweep, dev-run bridge + acceptance kit, adversarial refutation of every HIGH). Read-only; reviewers pushed nothing.

**Verdict: BLOCKERS** (1 HIGH adversarially confirmed, 3 MEDIUM).

## Reviewer verdict: BLOCKERS

Task B (fresh adversarial sweep of the seccomp wrapper + abort/kill/cleanup in 55248fc..6bb4624). Seccomp BPF decoded instruction-by-instruction and found correct in most respects: it loads seccomp_data.arch FIRST (offset 4) and RET_KILL_PROCESS on mismatch, so the i386 int-0x80 socketcall(102) path is killed (not bypassed); socket/socketpair numbers are right on x86_64 (41/53) and aarch64 (198/199); AF_VSOCK (family 40, args[0]) -> EAFNOSUPPORT; NO_NEW_PRIVS (prctl 38) is set before PR_SET_SECCOMP (prctl 22, mode 2); the sock_fprog packing is correct; the filter survives exec into the untrusted command and is installed in the process that execs it; all three paths (probe/run/dev-run) wrap the command via stageSandbox line 327; and it fails closed (exit 125) if perl/seccomp is absent, which the VSOCK/TOOLS probes also catch. BUT one NEW HIGH: the filter is a syscall filter and does not cover io_uring. io_uring_setup (nr 425) is ALLOWED, and IORING_OP_SOCKET creates an AF_VSOCK socket bypassing the filter - REPRODUCED on this kernel under a byte-identical copy of the exact filter (fd created; direct socket(40) blocked in the same run). connect(42) and the x32 nr|0x40000000 path are also unguarded. The in-sandbox VSOCK probe only tests the direct socket() syscall, so selfTest passes and the gate reports AVAILABLE while untrusted code retains a vsock->Windows-host (hvsocket) escape vector - exactly what the claimed HIGH fix was meant to close, and a violation of the threat-model invariant. The round-2 abort/kill/cleanup items I re-checked are all FIXED (du exit-code check, immediate abort killTree + abort selfTest probe, pgid-reuse cmdline guard, stale-sweep >=6.5h + live-process skip, rc read-back, fail-closed pgrep). Verdict BLOCKERS on the io_uring AF_VSOCK bypass. Minimal fix: deny io_uring_setup (425) and reject x32 (nr & 0x40000000) in the BPF, and have the VSOCK probe exercise the io_uring path. Worktree clean at 324e564.

Tests: npx vitest run tests/v7-int-r3-sbx-gate.test.ts (Node 24). All LANE-B WSL provider tests PASS (96 pass incl. B-SBX-WIN-3 NEW-VSOCK-NETNS-BYPASS and the REAL-probes-on-Linux test). The 4 consistent failures are all LANE-C Linux-unshare real-isolation tests (unshare/pivot_root canary + host-fs-invisible + PATH-shim) which require namespace support this nested container lacks - environmental, not the WSL provider under review; the du/rc unit test at line 784 failed once then passed on rerun (timing flake). Reproduction harness built with gcc (iou_socket.c raw io_uring) and perl (seccomp_wrap.pl, verified byte-identical to SECCOMP_PL source) under /tmp/claude-0/-home-user-UNIVERSAL-AI-SOFTWARE-FACTORY-/2b112f87-31d8-5a52-96d5-8b4fa41b948c/scratchpad/rvsbx3-tools-taskB. Worktree clean at 324e564, no tracked files modified.

| prior finding | status |
|---|---|
| NEW-VSOCK-NETNS-BYPASS (round-2 HIGH) | PARTIAL |
| B2-DU-EXIT-IGNORED (round-2 MEDIUM) | FIXED |
| NEW-ABORT-WAITS-FOR-PIPE-CLOSE (round-2 MEDIUM) | FIXED |
| B2-PGID-KILL-REUSE (round-2 LOW) | FIXED |
| B2-STALE-SWEEP-INFLIGHT (round-2 LOW) | FIXED |
| B2-RC-FILE-UNUSED (round-2 LOW) | FIXED |
| B2-PGREP-VERIFY-FAIL-OPEN (round-2 LOW) | FIXED |

### HIGH VSOCK-IOURING-BYPASS: io_uring (IORING_OP_SOCKET) creates an AF_VSOCK socket despite the seccomp filter; io_uring_setup is not denied and the VSOCK probe only tests the direct socket() syscall, so the provider reports AVAILABLE with a live vsock->Windows-host vector

- file: `core/sandbox/wsl-unshare-sandbox.ts`:148
- verified: REPRODUCED: on this 6.18 x86_64 kernel (io_uring_disabled=0, AF_VSOCK creatable), running ./iou_socket 40 1 0 under a byte-identical copy of SECCOMP_PL (verified diff-IDENTICAL to source lines 149-159): direct perl socket(S,40,1,0) -> EAFNOSUPPORT errno 97 (blocked), AF_INET socket ok, but io_uring IORING_OP_SOCKET created AF_VSOCK fd=4 with the filter active and io_uring_setup(425) ALLOWED. The existing test tests/v7-int-r3-sbx-gate.test.ts:1036 (NEW-VSOCK-NETNS-BYPASS) only checks the direct socket()/socketpair() syscall, so the io_uring path is entirely untested and selfTest/AVAILABLE stay green. SECONDARY (CODE_READING): the BPF has no nr&0x40000000 x32 guard, so x32 socket(AF_VSOCK) on a CONFIG_X86_X32_ABI kernel also bypasses (not reproduced here: no 32-bit toolchain). Dependency (UNVERIFIED_WSL): IORING_OP_SOCKET needs kernel >=5.19 - current WSL2 6.6 default qualifies; legacy WSL2 5.15 lacks opcode 45 (but the filter incompleteness and probe blindness are proven regardless, and connect/sendmsg bypass and io_uring_setup availability hold on all io_uring kernels).
- path: core/sandbox/wsl-unshare-sandbox.ts
- fix: The seccomp BPF (SECCOMP_PL, lines 148-160) only intercepts the socket(41/198) and socketpair(53/199) syscalls for family 40. Add to the filter, after the arch==x86_64/aarch64 check: (1) reject x32 syscalls - load nr, if (nr & 0x40000000) RET KILL_PROCESS (closes x32 socket = 41|0x40000000 on CONFIG_X86_X32_ABI kernels); (2) deny io_uring_setup - JEQ nr==425 (same number on x86_64 and the aarch64/generic table) -> RET ERRNO ENOSYS(38) or KILL. The sandbox never needs io_uring, so denying io_uring_setup is the robust fix (connect/sendmsg stay unfiltered, but with no AF_VSOCK fd obtainable they cannot reach the host). Also extend the in-sandbox VSOCK probe (line 178) to attempt an io_uring IORING_OP_SOCKET AF_VSOCK create and require it to fail, so selfTest exercises the real coverage. Update the residual-risk doc. Attack path: untrusted test/dev-run code calls io_uring_setup(425) [ALLOWED by filter] -> submits IORING_OP_SOCKET{domain=AF_VSOCK,type=SOCK_STREAM} [not a syscall; seccomp not consulted] -> gets an AF_VSOCK fd -> connect(fd, {AF_VSOCK, VMADDR_CID_HOST=2, port}) [connect nr 42 not filtered] -> reaches a Hyper-V hvsocket listener on the Founder's Windows host, while provider.selfTest() passed (VSOCK=blocked) and ExecutionGate reports AVAILABLE.

## Reviewer verdict: NO_BLOCKERS

All three round-2 PARTIAL items (LC-1/LC-3/LC-4) and the round-2 NEW HIGH (NEW-VSOCK-NETNS-BYPASS) are FIXED, each with concrete code lines and a test that pins it; 14 defect-reintroducing mutants were re-applied and all KILLED (including VSOCK seccomp reproduced on a real vsock-capable kernel, and the immediate-abort-kill caught by the real Linux abort probe). Every prior HIGH is either FIXED or UNVERIFIED_WSL with a sound fail-closed default (seccomp install failure or non-enforcement both drive selfTest to fail closed via exit 125 and/or PROBE_VSOCK; VSOCK=open is caught by the probe). The gate now follows the provider via isVerified() so AVAILABLE is never reported after a negative probe fails (test 998). The MEDIUM/LOW items are FIXED except B2-INTEROP-TOCTOU-AND-ABORT-LATENCY (PARTIAL: abort-latency fixed, interop point-in-time window + taskkill-no-fallback remain documented fail-closed residuals). The full test file is green (100 passed/2 win32-skips/0 failed) and the REAL probes-on-Linux test actually ran (Lane C exports present), confirming no regression of the 14 round-2 FIXED items. One LOW test-quality finding: mock test 1013's firstKill<runReturned assertion is vacuous (matches the kill.sh staging tee), though the behaviour is pinned by the real probe. Tree clean at 324e564. Verdict: NO_BLOCKERS."

Tests: tests/v7-int-r3-sbx-gate.test.ts full run with a sandbox-bindable node: 100 passed | 2 skipped | 0 failed (2 skips are both win32-only REAL WSL tests, correctly skipped on Linux). REAL probes-on-Linux test (line 1088) RAN 13.6s (Lane C isolation exports present; not skipped) and passed. Under the task-specified node24 PATH the same file is 96 passed | 4 failed | 2 skipped; the 4 failures are the Lane-C Linux PROVIDER tests only (exitCode 127) because node24 lives under /tmp, outside the sandbox-bindable /usr|/bin|/sbin tree the Lane-C provider binds — unrelated to the WSL fixes; the WSL B-SBX-WIN-3 tests and the WSL REAL-probes test passed under node24 too. 14 defect-reintroducing mutants applied+reverted, all KILLED: VSOCK_PROBE, VSOCK_SECCOMP(real,vsock-capable kernel), GATE_STALE, DU_EXIT, PE_LOCALE, PE_INCONCL, ABORT_PROBE_OFF, ABORT_IMMEDIATE(killed via real PROBE_ABORT_TREE_SURVIVED), PGREP_FAILOPEN, KILL_GUARD, SWEEP_INFLIGHT, RC_READBACK, CLEANUP_DEVERIFY, PARITY_SUPERVISOR. git status clean at 324e564; no leftover scratch dirs.

| prior finding | status |
|---|---|
| LC-1 (HIGH, round-2 PARTIAL): abort selfTest probe + teardown proof | FIXED |
| LC-3 (round-2 PARTIAL): abort kills Linux tree immediately; runner resolves after kill | FIXED |
| LC-4 (round-2 PARTIAL): scratch removal, stale sweep, work-size | FIXED |
| NEW-VSOCK-NETNS-BYPASS (HIGH, round-2 NEW) | FIXED |
| NEW-GATE-STALE-AVAILABLE / B2-GATE-STALE-AVAILABLE (MEDIUM) | FIXED |
| B2-DU-EXIT-IGNORED (MEDIUM) | FIXED |
| B2-PE-PROBE-LOCALE (MEDIUM) | FIXED |
| NEW-ABORT-WAITS-FOR-PIPE-CLOSE (MEDIUM) | FIXED |
| NEW-PROBE-SCRIPT-UNPINNED (MEDIUM) | FIXED |
| B2-PGREP-VERIFY-FAIL-OPEN (LOW) | FIXED |
| B2-PGID-KILL-REUSE (LOW) | FIXED |
| B2-STALE-SWEEP-INFLIGHT (LOW) | FIXED |
| B2-INTEROP-TOCTOU-AND-ABORT-LATENCY (LOW) | PARTIAL |
| B2-RC-FILE-UNUSED (LOW) | FIXED |
| NEW-CLEANUP-SURVIVOR-CHECK-BLIND (LOW) | FIXED |
| NEW-PROBE-PARITY-RESIDUAL (LOW) | FIXED |
| NEW-DOC-STALE-RESIDUALS (LOW) | FIXED |
| Round-2 14 FIXED items (regression spot-check) | FIXED |

### LOW NEW-R3-01-ABORT-MOCK-ASSERTION-VACUOUS: Mock test 1013 'firstKill < runReturned' is vacuous: endsWith('/ctl/kill.sh') matches the kill.sh staging tee, not its execution

- file: `None`:1023
- verified: REPRODUCED
- path: tests/v7-int-r3-sbx-gate.test.ts
- fix: In test 1013 match the kill.sh EXECUTION only, e.g. seq.findIndex(a => a === '/bin/sh /tmp/uasco-sbx-AbC123/ctl/kill.sh'), so removing abortWith's immediate killTree (371-375) makes this test fail. The underlying behaviour is still pinned by the REAL abort probe, so this is test quality only, not a security gap.

### Adversarial check of VSOCK-IOURING-BYPASS: refuted=False, severity=HIGH

NOT REFUTED. The attack path is real at 324e564 and the core sandbox-boundary violation is REPRODUCED on this exact Linux kernel (6.18 x86_64, io_uring_disabled=0, /dev/vsock present).

REPRODUCED: I extracted the byte-identical SECCOMP_PL from core/sandbox/wsl-unshare-sandbox.ts:148-162 via node eval (729 bytes) and ran a raw io_uring C program (IORING_OP_SOCKET=opcode 45, io_uring_setup=__NR 425, confirmed from /usr/include) under `perl -e <SECCOMP_PL> -- ./iou_socket 40 1 0` (the exact wrapper invocation the provider uses at :327). Result with the filter ACTIVE: DIRECT_SOCKET(AF_VSOCK)=fail errno=97(EAFNOSUPPORT) [filter blocks the direct path], DIRECT_AF_INET=ok, IO_URING_SETUP=ok [425 ALLOWED by filter], IO_URING_SOCKET=CREATED fd=4 [AF_VSOCK socket obtained despite the filter]. Baseline without the filter shows the same io_uring success, confirming the kernel supports the opcode.

CODE_READING (confirmed by reading the BPF): the filter at wsl-unshare-sandbox.ts:154 loads arch(off4), kills non-x86_64/aarch64, loads nr(off0), and only branches on socket(41/198) and socketpair(53/199); for those with domain(off16)==40 it returns ERRNO 97, else RET_ALLOW. io_uring_setup(425), connect(42) and sendmsg are never inspected. The Linux isolation layer that wraps every command explicitly carries NO seccomp (core/agents/linux-unshare-sandbox.ts:1 "seccomp ve cgroup yok"), so SECCOMP_PL is the SOLE vsock defense. grep over core/ and tests/ shows zero io_uring handling: no io_uring_setup denial and no io_uring_disabled sysctl check, so there is no fail-closed default that prevents this.

PROBE/TEST BLINDNESS confirmed: the in-sandbox VSOCK probe (wsl-unshare-sandbox.ts:178) tests only perl `socket(S,40,1,0)`, and evaluateProbe keys solely on VSOCK=blocked; the existing test tests/v7-int-r3-sbx-gate.test.ts:1036 (NEW-VSOCK-NETNS-BYPASS, line 1038 payload) only exercises direct socket()/socketpair(). The io_uring path is entirely untested, so selfTest() returns VSOCK=blocked and ExecutionGate reports AVAILABLE while an AF_VSOCK fd is obtainable.

NETNS IS NOT A BACKSTOP: I ran socket(40,1,0) inside the exact NS_FLAGS set (--user --map-root-user --net --pid --ipc --uts --mount --fork, core/agents/linux-unshare-sandbox.ts:24) — NS_AF_VSOCK=creatable fd=3. So --net does not isolate AF_VSOCK, matching the author's own comment at :147; the whole reason SECCOMP_PL exists is defeated by the io_uring path.

Could not refute via any fail-closed default: io_uring_setup is allowed under no_new_privs + user-ns + caps-dropped (reproduced), the isolation layer has no seccomp, and the code never consults kernel.io_uring_disabled. UNVERIFIED_WSL (correctly scoped by the finding and, crucially, NOT enforced by the code so they cannot be claimed as defenses): whether a given WSL2 kernel permits io_uring (Microsoft default 6.6 ships io_uring_disabled=0 and opcode 45; legacy 5.15 lacks the opcode), and whether a live hvsocket listener exists on the Founder's Windows host for the terminal connect() hop. The x32 secondary (no `nr & 0x40000000` guard in the BPF, so x32 socket(AF_VSOCK)=41|0x40000000 falls through to RET_ALLOW on CONFIG_X86_X32_ABI) is CODE_READING only — no 32-bit toolchain here, matching the reviewer.

SEVERITY: HIGH is correct for the threat model (untrusted AI-generated commands on the Founder's Windows host inside WSL2; any vsock/hvsocket reach to the host is CRITICAL/HIGH). This is the same vsock-to-host escape class as the direct-socket VSOCK finding already rated HIGH, via a syscall path the sole mitigation misses and selfTest cannot see. Not raised to CRITICAL only because the terminal host-compromise step (a reachable hvsocket service) and io_uring kernel enablement remain UNVERIFIED_WSL.

MINIMAL FIX (sound as proposed): in SECCOMP_PL, after the arch gate and the nr load, add `I(0x15,<k>,0,425)` -> RET_KILL_PROCESS (or ERRNO ENOSYS) to deny io_uring_setup (same number 425 on x86_64 and the aarch64/generic table, so one check covers both arches), plus an `nr & 0x40000000` x32 guard -> RET_KILL. The sandbox never needs io_uring, so denying io_uring_setup is robust (connect/sendmsg stay unfiltered but no AF_VSOCK fd is obtainable). Also extend the in-sandbox probe (:178) and the test (:1036) to attempt an io_uring IORING_OP_SOCKET AF_VSOCK create and require it to fail, and update the residual-risk doc. file:line: core/sandbox/wsl-unshare-sandbox.ts:154 (BPF), :178 (probe), tests/v7-int-r3-sbx-gate.test.ts:1036 (test). verified=REPRODUCED (filter bypass + io_uring_setup allowed + AF_VSOCK fd via io_uring); netns-non-isolation REPRODUCED; connect/probe/test gaps CODE_READING; WSL2 kernel + hvsocket listener + x32 = UNVERIFIED_WSL. Worktree left clean at 324e564 (scratch only under rvsbx3-tools-iou).

## Reviewer verdict: NO_BLOCKERS

Task C covered b28ee7e (B-RUN-1), 154f8b9 (B-RUN-WIN-1) and 55248fc (B-ACCEPT-WIN-1) as they stand at 324e564. I found no new CRITICAL or HIGH issue in these commits.

B-RUN-1:
- The routes are not live yet: registration in server.ts is still only an authority request.
- Once registered, they sit behind the global x-uasco-control-token and Host hook, and apply GLOBAL_STOP (423), then action policy (403), then the empty-body check (400).
- run_<24hex> ids are validated and the run and its project are resolved within the tenant scope. Start needs SOURCE_GENERATION_COMPLETE and a 40-hex headSha, and the product runs that exact delivered commit (it is checked out and compared).
- Both bridges listen only on 127.0.0.1, one port, and the tests confirm ::1 and external addresses are refused.
- Each relay connects only to 127.0.0.1 on the same port inside the target netns. A target sharing the host netns is refused (BRIDGE_TARGET_NOT_ISOLATED / exit 97), which keeps WSL root loopback (Windows loopback under mirrored networking) out of reach.
- I found no reverse path from the sandbox to the Windows host's localhost. Previews open in the external browser, and the control API needs a header token that a cross-origin page cannot send.
- Logs are bounded: 256 KB ring, 16 KB tail, redacted.

B-RUN-WIN-1:
- nsenter is confined to the sandbox userns and netns. The relay itself runs without the cap-drop/seccomp wrapper (C-7).
- Normal stop does tear the Linux side down: the timeout pgid is killed, which ends the pid ns through --kill-child, then pkill and pgrep verify and the scratch dir is removed.

Gaps (MEDIUM/LOW):
- C-1: a running product is not stopped when the provider de-verifies mid-run (reproduced).
- C-5: teardown failure and API-crash orphans are not reported, and recover() cannot reach the Linux side.
- C-6: the relay's netns check does not pin the netns recorded at bridge start.
- C-9: no limit on concurrent dev-runs across projects.

B-ACCEPT-WIN-1:
- It never installs anything or changes settings. It only prints fix commands and runs only the repo's own vitest REAL WSL tests.
- It does not print credentials, only profile state and CLI path.
- SKIP and missing tests are never counted as PASS.
- C-2: ACCEPTED is still issued for a dirty, unknown-state or --sha-only tree, so the evidence is not truly SHA-bound (reproduced).
- C-3: WSL_PRODUCT_BRIDGE can PASS without teardown being asserted.
- C-4: the interop runtime row is PASS when the read did not run (reproduced).

Still UNVERIFIED_WSL: real wsl.exe and nsenter behaviour inside WSL2, what killing wsl.exe does on the Linux side, and the kit's first real run. The seccomp wrapper itself belongs to the B-SBX-WIN-3 round-3 reviewers and is not assessed here.

Tests: I ran the tests with Node 24 (v24.22.1) in my own clone of 324e564 at rvsbx3-tools-C/clone (removed afterwards). Another reviewer was mutating the shared worktree while I worked: I saw a temporary `if (false)` at wsl-unshare-sandbox.ts:498 (HEAD has `if (rc !== "0")`), and it was reverted shortly after. Files: tests/v7-int-r3-sbx-gate.test.ts, tests/v7-ps1a-c2-remediation.test.ts, tests/v7-b1-workos.test.ts and tests/v7-lane-c-linux-sandbox-exports.test.ts: 242 tests, 232 passed, 6 failed, 4 skipped (the 4 include the 2 REAL WSL tests). All 6 failures are real-Linux-provider tests (LANE-C provider v2 x4, C-SBX-LO-1 x2). They fail with exit 127 or LOOPBACK_PROBE_NODE_UNAVAILABLE because process.execPath (scratchpad node24) is not inside the sandbox-visible tree; this is the environment, not the B-RUN/B-ACCEPT code. With system Node 22, 7 Lane C provider tests fail instead (also environment; running as root). Every B-RUN-1, B-RUN-WIN-1 and acceptance-kit test that ran passed. Also run: kit-poc.mjs (fake deps, reproduces C-2 and C-4) and a temporary de-verify vitest (1/1, reproduces C-1). Shared worktree: git status is clean at 324e564.

### MEDIUM C-1: A running dev-run stays RUNNING and bridged after the provider marks itself unverified

- file: `core/workos/devrun.ts`:300
- verified: REPRODUCED: a private vitest (in my own clone at 324e564, deleted afterwards) used a fake HOST provider with isVerified(). After flipping it to false, gate.status() was UNAVAILABLE, the view stayed {status:RUNNING, preview:AVAILABLE}, and fetch on the port still returned 200.
- path: core/workos/devrun.ts
- fix: After start, the gate's verified state is never checked again. Add a per-run watch (reuse the ensureStopWatch interval): if executionGate.status() is UNAVAILABLE or provider.isVerified?.() === false, call stopDetailed(id, "SANDBOX_DEVERIFIED") on every active run. Separately, WslUnshareSandboxProvider.bridge() should refuse new connections while this.verified is false. Attack path: the product is started; later a concurrent run() sees INTEROP_ENABLED or CLEANUP_FAILED and sets verified=false; the gate reports UNAVAILABLE, but the product keeps running for up to devMaxMs (6 h), is still exposed on 127.0.0.1:<port>, and the UI still shows preview AVAILABLE.

### MEDIUM C-2: Acceptance kit reports ACCEPTED for a dirty, unknown-state or unverified-SHA tree, so the evidence is not bound to the code that ran

- file: `docs/acceptance/windows/founder-acceptance.mjs`:124
- verified: REPRODUCED: a fake-deps PoC (rvsbx3-tools-C/scripts/kit-poc.mjs) gave DIRTY: ACCEPTED {dirty:true}, DIRTY_UNKNOWN: ACCEPTED {dirty:null}, SHA_ARG: ACCEPTED {shaSource:ARGUMENT}.
- path: docs/acceptance/windows/founder-acceptance.mjs
- fix: verdictOf/runAcceptance (lines 124-127, 148) should add a blocking reason when repo.dirty !== false (DIRTY_TREE or DIRTY_UNKNOWN) and when shaSource !== "GIT" (SHA_UNVERIFIED), unless --sha is checked against a signed build manifest of the installed tree. Also record git status --porcelain --ignored for node_modules/vitest, or a lockfile hash. Attack path: modify the provider or test file locally (or let a builder leave edits), run the kit; it prints ACCEPTED and writes evidence naming HEAD's SHA, although the modified code is what ran. Same result with git missing plus --sha <any 40 hex>.

### MEDIUM C-3: WSL_PRODUCT_BRIDGE can be PASS even though Linux-side teardown is never checked

- file: `tests/v7-int-r3-sbx-gate.test.ts`:954
- verified: CODE_READING (the real run itself is UNVERIFIED_WSL)
- path: tests/v7-int-r3-sbx-gate.test.ts
- fix: The README and the test title say "stop tears the Linux tree down", but the REAL WSL product test (lines 954-969) never asserts it. In finally it only runs taskkill and awaits child.sandboxTeardown. It does not check p.isVerified(), p.lastSelfTest (CLEANUP_<code>), a pgrep for the scratch dir, or that the scratch dir is gone. It also bypasses DevRunManager.stop(), which is the real product path. Fix: after teardown, assert p.isVerified() === true, run wsl pgrep -f uasco-sbx and expect exit 1, run test ! -e <S> and expect 0, and drive start/stop through DevRunManager. Effect: if cleanup leaves a listener behind or fails, the kit still records PASS and ACCEPTED for that step.

### LOW C-4: Preflight WSL_INTEROP_RUNTIME is PASS when the read never ran, and WSLInterop-late is ignored

- file: `docs/acceptance/windows/founder-acceptance.mjs`:89
- verified: REPRODUCED: PoC with bm={code:null} gives WSL_INTEROP_RUNTIME PASS 'WSLInterop handler not registered'.
- path: docs/acceptance/windows/founder-acceptance.mjs
- fix: Any non-zero exit counts as 'handler not registered' and becomes PASS. That includes code null from a wsl.exe spawn error or the 60 s kill. Fix: use one sh -c that checks both /proc/sys/fs/binfmt_misc/WSLInterop and WSLInterop-late, with distinct exit codes for absent, disabled and enabled. PASS only on an explicit absent or disabled result with exit 0; anything else is FAIL(INCONCLUSIVE). The overall verdict still depends on the real selfTest, so this row alone cannot flip it to ACCEPTED.

### LOW C-5: Stop reports STOPPED even when Linux-side teardown failed; after an API crash the WSL sandbox is never torn down

- file: `core/sandbox/wsl-unshare-sandbox.ts`:390
- verified: CODE_READING; what wsl.exe termination does on the Linux side is UNVERIFIED_WSL
- path: core/sandbox/wsl-unshare-sandbox.ts
- fix: sandboxTeardown always resolves undefined. On a cleanup failure (PROCESS_SURVIVED, PGREP_FAILED, SCRATCH_NOT_REMOVED) only the provider is de-verified. onExit has already written STOPPED and the stop route returns success. Fix: resolve sandboxTeardown with the cleanup code and have DevRunManager record it (for example STOP_INCOMPLETE:<code>, which also blocks restart). Persist S in devrun state.json so that recover() after an API restart runs the provider teardown for that scratch dir; today recover() only taskkills the Windows wsl.exe pid, and sweepStale skips directories younger than about 6.5 h or with live processes. A surviving product stays network-isolated with no bridge, but it can run for up to devMaxMs (6 h).

### LOW C-6: WSL relay.sh checks that the target netns differs from its own, not that it is the sandbox's netns recorded at bridge start

- file: `core/sandbox/wsl-unshare-sandbox.ts`:226
- verified: CODE_READING
- path: core/sandbox/wsl-unshare-sandbox.ts
- fix: In bridge(), read /proc/<target>/ns/net once and pass it to relay.sh as $3. relay.sh then requires equality (as startNsenterBridge does with `target`, devrun-bridge.ts:68) and also checks that /proc/<pid>/cmdline contains S. Attack path: the sandbox's unshare exits and its pid is reused, before wsl.exe's exit reaches Windows, by a process in another non-root netns (for example another project's sandbox). The next connection to 127.0.0.1:<port> is then relayed into that other netns. This does not reach the Windows host: an equal netns gives exit 97.

### LOW C-7: Bridge relays run without the dropped-caps/seccomp wrapper (full caps in the sandbox userns; host mount and pid ns); the Linux relay also inherits the whole API-server environment

- file: `core/workos/devrun-bridge.ts`:70
- verified: CODE_READING
- path: core/workos/devrun-bridge.ts
- fix: nsenter -U --preserve-credentials -n gives the relay every capability in the sandbox user namespace, and it runs without NO_NEW_PRIVS or the seccomp filter. The WSL relay.sh (wsl-unshare-sandbox.ts:233) is the same. The relay is confined to the sandbox netns and its code is fixed. The sandbox cannot address it (separate pid ns) and can only send bytes over one TCP connection, so no reverse path was found. Hardening: exec the relay through setpriv --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all plus the same seccomp wrapper, and spawn it with an explicit minimal env (no API-server env).

### LOW C-8: Product stop route returns 409 for its own delivery run while that run is STARTING

- file: `apps/control-api/src/routes/product-run.ts`:49
- verified: CODE_READING
- path: apps/control-api/src/routes/product-run.ts
- fix: deliveryRunId is set only after clone and checkout (devrun.ts, after the head check), so during STARTING `cur.deliveryRunId !== runId` returns PRODUCT_RUN_NOT_THIS_DELIVERY. Set st.deliveryRunId = link.runId on the STARTING placeholder (with headSha pending). The generic /v1/projects/:id/devrun/stop and GLOBAL_STOP still work.

### LOW C-9: No limit on concurrent dev-runs across projects

- file: `core/workos/devrun.ts`:286
- verified: CODE_READING
- path: core/workos/devrun.ts
- fix: Only one dev-run per project is enforced. N projects give N concurrent WSL sandboxes, each for up to 6 h with nproc 4096 and 16 GiB address space, plus up to 32 wsl.exe relays per bridge. Add a manager-wide maximum (for example 2) and refuse with 409 DEVRUN_CAPACITY.

