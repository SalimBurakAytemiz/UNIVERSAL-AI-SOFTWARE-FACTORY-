<!-- //TR: Bu belge UASCO Windows kurulum paketinin (imzasız geliştirme sürümü) nasıl üretildiğini, kurulduğunu, onarıldığını/yükseltildiğini, kaldırıldığını, verilerin nerede tutulduğunu ve yalnız otomatik testlerde kullanılan anahtarları açıklar. -->
# UASCO Windows installer (unsigned development build)

> **Unsigned.** `UASCO-Setup-<version>-win-x64.exe` has **no Authenticode signature**. Windows SmartScreen
> ("Windows protected your PC") warnings are expected; choose *More info → Run anyway* only for a build you
> produced yourself or received from the Founder's own build machine. The welcome page of the installer says
> the same in Turkish and English.

## Build

Prerequisites (all already part of the repository's governed toolchain):

1. `node scripts/ensure-dependencies.mjs` – reviewed lock, sealed `node_modules` (includes the exact-pinned
   devDependency `electron-builder`).
2. `node scripts/provision-electron.mjs` – the **only** way Electron is obtained: the checksum-pinned Electron
   zip is verified against the reviewed `node_modules/electron/checksums.json` and extracted to
   `.ai/cache/electron/<version>-win32-x64/dist`.
3. `npm run dist:win` (= `node scripts/build-installer.mjs`).

What `scripts/build-installer.mjs` does:

| Step | Detail |
|---|---|
| verify | `assertInstalledDependencyState` + `verifyProvisionedElectron` (archive-bound); its `dist` directory becomes electron-builder's `electronDist`, so electron-builder never downloads Electron. |
| backend | `tsc -p tsconfig.build.json` compiles `apps/control-api/src/**` (+ imported `core/**`) to JavaScript. `tsconfig.build.json` extends the protected `tsconfig.json` without changing it. |
| stage | `apps/desktop/{main.mjs,preload.mjs,backend-error.html,renderer/**}`, the relative-import closure of `automation/lib/*.mjs`, read-only data (`registries/{agents,capabilities,execution-fabrics,tool-adapters,domain-packs}.json`, `roadmap/review-packages.json`) and the runtime dependency closure of `fastify`, `ajv`, `ajv-formats` resolved from the reviewed `package-lock.json` (no dev tooling). |
| icon | An original icon (white "U" on blue, amber dot) is generated as a multi-size ICO; no third-party logo. |
| package | electron-builder with `installer/electron-builder.json` + `installer/nsis/uasco-installer.nsh`. Build-time helper downloads: electron-builder's checksum-pinned `nsis` and `7zip` toolsets from `electron-userland/electron-builder-binaries` (FA-V2-PRODUCT approval). Cache: `<build>/eb-cache`. |

Outputs live **outside the repository tree** because `.gitignore` is a protected file: by default the sibling
directory `<repo>-build/` (override with `UASCO_BUILD_OUT_DIR`, which must not be inside the repo):

```
<repo>-build/
  app/                      staged application (resources/app)
  resources/                icon.ico, uasco-installer.nsh
  dist-installer/
    UASCO-Setup-<version>-win-x64.exe
    BUILD-SUMMARY.json      size, sha256, versions, signed=false
    win-unpacked/           unpacked payload (same files the installer installs)
  eb-cache/                 electron-builder toolsets
```

`npm run dist:win:stage` only stages the app (no installer).

## Install

* Assisted (not one-click) **per-user** installer: no administrator rights (`perMachine=false`,
  `allowElevation=false`, `requestedExecutionLevel=asInvoker`). The install-mode page defaults to
  "only for me".
* The installation directory can be changed (e.g. a path on an SSD). Default:
  `%LOCALAPPDATA%\Programs\UASCO`.
* Pre-install checks (`installer/nsis/uasco-installer.nsh`), run after the directory page (and in `.onInit`
  for silent installs):
  * target drive must exist and be reachable;
  * free space must be at least the unpacked application size + 256 MB margin; otherwise a Turkish/English
    message is shown and nothing is installed (silent: exit code 3);
  * a network drive (UNC path or `DRIVE_REMOTE`) produces a warning with a choice to continue.
* Shortcuts: Desktop and Start menu, both named **UASCO** (AppUserModelID `com.uasco.desktop`).
* Silent install: `UASCO-Setup-<version>-win-x64.exe /S /D=C:\Path\To\UASCO` (`/D` must be last, no quotes).

## Repair / upgrade

* **Repair** = run the installer of the same version again (same directory is detected from
  `HKCU\Software\<app-guid>\InstallLocation`).
* **Upgrade** = run a newer installer. The previous version's uninstaller is invoked with `--updated`;
  user data is never touched in that path.

## Uninstall

* *Settings → Apps → UASCO* or `<install dir>\Uninstall UASCO.exe`.
* The uninstaller shows a page with the checkbox **"Kullanıcı verilerini de sil / Also delete user data
  (%APPDATA%\UASCO)"**, **unchecked by default**: program files are removed, user data is kept.
* Silent uninstall keeps user data: `"<install dir>\Uninstall UASCO.exe" /S`. Deleting data silently requires the
  explicit electron-builder flag `--delete-app-data`.

## Where data lives

Program files are only in the install directory; the running app never writes there (verified by hashing the
install directory before/after launches, see the B7 checkpoint). All mutable data is under Electron's
`app.getPath("userData")` = `%APPDATA%\UASCO`:

| Path | Content | Replaces (dev mode, repo-relative) |
|---|---|---|
| `%APPDATA%\UASCO\runtime\` | Control API runtime dir: `GLOBAL_STOP.json`, `control-api-events.jsonl` (audit), scheduler/retry state if ever present | `.ai/runtime/` |
| `%APPDATA%\UASCO\runtime\GLOBAL_STOP.json` | Global Stop flag | `.ai/runtime/GLOBAL_STOP.json` |
| `%APPDATA%\UASCO\runtime\DESKTOP_SMOKE_READY.json` | only when `UASCO_SMOKE=1` | `.ai/runtime/DESKTOP_SMOKE_READY.json` |
| `%APPDATA%\UASCO\workos\` | Work OS journal/snapshot (`UASCO_DATA_DIR`) | `.ai/workos/` |
| `%APPDATA%\UASCO\logs\control-api.log` | backend stdout/stderr (+ `.1` rotation at 5 MB); the session token is redacted | console |
| `%APPDATA%\UASCO\` (other) | Chromium profile data (Local Storage, caches, …) | Electron default |

The backend's working directory is the read-only `resources\app` folder; it only reads the shipped registry
files there.

## Backend lifecycle and secrets

* On launch (packaged mode only) the main process picks a free loopback port, generates a fresh 32-byte random
  control token, starts `resources\app\apps\control-api\src\packaged-entry.js` with `UASCO.exe` in Node mode
  (`ELECTRON_RUN_AS_NODE=1`, minimal environment allow-list, no shell) and writes the token as the first line
  of the child's **stdin**. The token is never on the command line, in the environment, on disk or in logs,
  and never reaches the renderer. Nothing is persisted, so `safeStorage` is not needed.
* The window loads only after `/health` proves the server identity with the challenge HMAC; if that fails
  within 30 s the window shows the static page **"Arka uç başlatılamadı"**.
* On quit the backend's stdin is closed (it shuts down cleanly), with a forced kill after 3 s. If the app process
  dies, the closed stdin pipe makes the backend exit by itself.
* Single instance: a second launch focuses the existing window and exits.
* Dev mode (`npm run dev`, `npm run desktop`) is unchanged: token/port from the environment, backend via `tsx`.

## Test-only switches (automated tests only)

Used by `scripts/installer-install-test.mjs` so a real test install never creates shortcuts on the Founder's
Desktop/Start menu and never touches a real installation:

| Switch | Effect |
|---|---|
| `/UASCO_TEST_NO_SHORTCUTS` (installer) | Desktop/Start-menu shortcut targets are redirected into the installer's temporary `$PLUGINSDIR` (deleted on exit). Used together with electron-builder's `--no-desktop-shortcut`. |
| `/UASCO_TEST_REQUIRE_MB=<n>` (installer) | Raises the required free space to `<n>` MB to exercise the refusal path. |
| `--keep-shortcuts` (uninstaller, electron-builder flag) | Uninstaller does not touch shortcut paths. |

`node scripts/installer-install-test.mjs <installer.exe> [<win-unpacked dir>]` installs only under `%TEMP%`,
refuses to run if a UASCO uninstall entry already exists in HKCU, launches with an isolated `--user-data-dir`,
and records registry/shortcut state before and after.

Known environment limitation (recorded in the checkpoint): on the build machine Chromium's sandboxed child
processes cannot start from binaries located under `%TEMP%` (GPU process crash `0x80000003`), so the `%TEMP%`
install is additionally launched with `--no-sandbox` for the test only; the identical payload starts with the
sandbox enabled from the build directory. A normal install location (`%LOCALAPPDATA%\Programs\UASCO`) is not
affected by this test-only flag.

## Other notes

* electron-builder's installer normally keeps a copy of itself in `%LOCALAPPDATA%\<app>-updater` for its
  auto-updater; UASCO has no auto-updater, so the include redirects that copy under `%LOCALAPPDATA%\Temp` and
  deletes it at the end of the install.
* `asar` is disabled so the backend can run from plain files with the install directory as working directory.
* The Electron `RunAsNode` fuse stays enabled (required for the packaged backend).
