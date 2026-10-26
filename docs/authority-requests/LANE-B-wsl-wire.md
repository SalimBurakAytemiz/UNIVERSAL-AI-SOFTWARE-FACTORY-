<!-- //TR: Lane B yetki talebi (B-WSL-WIRE-1): Windows'ta varsayılan sandbox sağlayıcısının bağlanması; server.ts değişikliği KORUMALI olduğu için yalnız metin diff'i. -->
# LANE-B-wsl-wire: the Windows Desktop gets the WSL2 provider by default (B-WSL-WIRE-1)

## Gap
`apps/control-api/src/server.ts:289` `defaultSandboxProvider` returns `null` unless `process.platform === "linux"`. On the Windows Desktop the gate is therefore always `SANDBOX_UNAVAILABLE` (tests `NOT_EXECUTED`, product start refused) even after the WSL2 provider (PR #231) merges: the provider is never constructed.

## Unprotected part (this branch)
- `core/sandbox/select-provider.ts`: `defaultSandboxProviderFor({platform?})` — `linux` -> `LinuxUnshareSandboxProvider` with default options (as today), `win32` -> `WslUnshareSandboxProvider` with default options, any other platform -> `null`, constructor throw -> `null` (`NO_VERIFIED_PROVIDER`, server start does not crash). No environment variable, config or request body chooses or alters the provider (SBX-GATE rule); the only parameters are test factories. Nothing runs until `selfTest()` passes (the gate asks it).
- `core/sandbox/wsl-unshare-sandbox.ts`: distro discovery (below).
- Tests: `tests/v7-int-r3-sbx-gate.test.ts` ("B-WSL-WIRE-1 selector", "B-WSL-WIRE-1 distro discovery").

## Protected part: exact server.ts diff (text only; NOT applied by Lane B)
```diff
-import {LinuxUnshareSandboxProvider} from "../../../core/agents/linux-unshare-sandbox.js";
+import {defaultSandboxProviderFor} from "../../../core/sandbox/select-provider.js";
@@ line 289
-const defaultSandboxProvider=():SandboxProvider|null=>{if(process.platform!=="linux")return null;try{return new LinuxUnshareSandboxProvider()}catch{return null}};
+const defaultSandboxProvider=():SandboxProvider|null=>defaultSandboxProviderFor();
```
`LinuxUnshareSandboxProvider` is not used anywhere else in `server.ts` (grep: only the import and line 289), so the import is replaced, not kept. The `// //TR:` comment at line 288 stays accurate except "yalnız linux'ta"; suggested replacement: `opts.sandbox yoksa platforma göre tek seçici (core/sandbox/select-provider.ts): linux -> Linux unshare, win32 -> WSL2, diğer -> null; env/config/gövde sağlayıcı seçemez; kurucu hata atarsa null`.

### Reseal note
`apps/control-api/src/server.ts` is a protected trust-root file: after applying the diff the trust-root manifest must be resealed (`config/trust-root-manifest.json` hash for `server.ts`). `core/sandbox/select-provider.ts` is a new unprotected file with a `//TR:` first line; the architecture validator, TR validator and secret-sanity pass with it. The existing pins that mention the `defaultSandboxProvider` line (b5 allow-list/registration pins in the protected batch) must be re-checked by whoever applies the line.

## Host input the WSL provider needs, and how it is found without user input
- **Distro name** (required). Order: (1) `UASCO_WSL_DISTRO` in the Founder's process environment, if set (an invalid value is refused, never replaced by discovery); (2) otherwise, with no input at all, `selfTest()` runs `wsl.exe -l -v` and takes the **default distro** (the row marked `*`), only if it is **WSL 2** and not a `docker-desktop*` / `rancher-desktop*` / `podman*` internal distro and its name matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. If the default is v1, an internal distro, absent or oddly named, the provider stays unavailable (`WSL_DISTRO_NOT_CONFIGURED`). The chosen distro still has to pass every selfTest proof (interop off, tools present, isolation probes, cleanup), so a wrong default fails closed. A request body can never choose it.
- **User / path**: none. Commands run through `wsl.exe --exec` as the distro's default user (root is refused by the process-limit probe: `PROBE_PROCESS_LIMIT_NOT_ENFORCED`); the scratch directory is `/tmp/uasco-sbx-XXXXXX` inside the distro; `wsl.exe` is resolved by the OS (`wslBinary` option is test-only).
- **Prerequisites the Founder sees as a failed selfTest, not as a crash**: WSL 2 installed with a distro, `/etc/wsl.conf` with `[interop] enabled=false` and `appendWindowsPath=false`, a Linux `node`, util-linux/coreutils/procps/perl. `docs/acceptance/windows/FOUNDER-STEPS.md` lists the exact steps.

## Not executed
- A real Windows host / real `wsl.exe` (UNVERIFIED_WSL). The selector and discovery are tested with fake runners and a fake `wsl -l -v`.
