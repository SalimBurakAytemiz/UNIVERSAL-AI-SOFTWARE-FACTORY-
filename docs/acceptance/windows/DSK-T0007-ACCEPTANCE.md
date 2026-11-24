# DSK-T0007 Windows acceptance (Founder, one machine, ~45 minutes)

Run on a real Windows 10 22H2+ / 11 machine with WSL 2 enabled (`wsl --status` shows default version 2).
Record every result as PASS / FAIL with a screenshot or the printed line. Any FAIL keeps real execution disabled.
No API key is used anywhere; sign-in is the Founder's own Claude subscription.

## Not yet available (must land before this run)
- Desktop "Install sandbox" button and its server route (calls `installSandbox`) — protected wiring, pending.
- The mission authorization form's submit (PR-1 shows a disabled preview) wired to `POST /v1/missions/<id>/authorization` — renderer change on top of the wiring PR, pending.
Until both exist, steps 1.1 and 4.2 cannot be performed from the UI.

## 0. Preconditions
1. `wsl -l -v` — note your existing distros. They must be unchanged at the end (step 7).
2. Install the UASCO desktop build from the PR that contains this file. Open it. Settings → AI executors shows the runner **Passive**.

## 1. Install the isolated sandbox (dedicated distro)
1. Settings → "Install sandbox" (calls `installSandbox`). Expected: downloads only these three pinned files (Ubuntu 24.04 WSL rootfs 20240423, Node v24.22.3 linux-x64, Claude Code 2.1.321 linux-x64), hash-verified, then `UASCO-Sandbox` appears in `wsl -l -v` as VERSION 2.
2. `wsl -d UASCO-Sandbox -u root --exec cat /etc/wsl.conf` → exactly: automount `enabled=false`, `mountFsTab=false`; interop `enabled=false`, `appendWindowsPath=false`.
3. `%APPDATA%\UASCO\control\.ai\runtime\WSL_SANDBOX.json` exists only after a successful install.

## 2. Negative isolation probes (automatic self-test)
1. Restart the app. Settings → Setup check → Sandbox row = **PASS** (provider `wsl2-uasco-v1`).
2. Confirm the self-test refuses when broken (each, then undo): (a) `wsl -d UASCO-Sandbox -u root --exec sh -c "sed -i s/enabled=false/enabled=true/ /etc/wsl.conf"` + `wsl --terminate UASCO-Sandbox` → Sandbox row BLOCKED (`WSL_CONF_MISMATCH`); restore with the install step. (b) `wsl --unregister UASCO-Sandbox` → BLOCKED (`DISTRO_MISSING`); reinstall.
3. In a run log (step 4) confirm the probe lines: `mnt_c=absent interop=absent windows_mounts=absent home_visible=no root_write=no work_write=yes direct_egress=blocked env_leak=no caps=dropped`.

## 3. Claude sign-in without exposing credentials
1. Setup check → implementer and reviewer rows show a login command. Run each in a new PowerShell, `/login` with your subscription, `/exit`.
2. Verify: no API key in any environment (`Get-ChildItem Env: | findstr /i ANTHROPIC` prints nothing); the credential file exists only under `%APPDATA%\UASCO\control\claude-profiles\<role>\` and is never shown in the UI or logs.

## 4. One authorized real model task
1. Create a small project with a test command (e.g. `node test.mjs` that checks a file) and a mission (risk R1).
2. Journey → Mission authorization: max risk R1, max runs 1, expires tomorrow → Record (P-B). State **LIVE**.
3. Settings → "Start runner" (confirm). Runner **Running**. Queue one run.
4. Expected: the run is leased; IMPLEMENT runs inside UASCO-Sandbox (task manager shows `wsl.exe`, not `claude.exe`, as the child of the app); code changes appear in the run workspace; tests run inside the sandbox (evidence `VERIFY_TESTS`, not `NOT_EXECUTED`); independent review runs; the run ends **AWAITING_APPROVAL**.
5. Approve or reject in Inbox. A second queued run of the same mission is **not** leased (AUTH_RUNS_EXHAUSTED).

## 5. Cancellation and Global Stop
1. Authorize again (max runs 2), queue a run, and while IMPLEMENT runs press **Emergency Stop**.
2. Expected within ~10 s: the run is CANCELLED; `wsl -d UASCO-Sandbox -u root --exec sh -c "pgrep -f /var/uasco/runs"` prints nothing; no new run starts until Resume.

## 6. No unauthorized network access
1. During a run, from Windows: `wsl -d UASCO-Sandbox -u root --exec sh -c "ls /var/uasco/runs/*/.egress.sock"` exists only while a run is active.
2. The run log/egress audit shows only CONNECTs to the allow-listed names (api.anthropic.com, claude.ai, console.anthropic.com, statsig.anthropic.com). Record any additional name the CLI needed: it is refused (403) and must be reviewed before being added.

## 7. Clean up and confirm
1. `wsl -l -v` — your original distros are unchanged; only `UASCO-Sandbox` was added.
2. Report: the build/PR SHA, each step's PASS/FAIL, and the screenshots. Only a full PASS lifts "real execution disabled".
