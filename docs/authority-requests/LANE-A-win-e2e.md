<!-- //TR: Lane A yetki talebi: gerçek Electron masaüstü uçtan uca testini (scripts/e2e/desktop-journey.e2e.mjs) Windows CI'da çalıştıran adımın taslağı; korumalı .github/workflows/windows-installer.yml bu yüzden yalnız diff olarak burada / Lane A authority request: draft of the Windows CI step for the real-Electron desktop journey E2E -->
# LANE-A-win-e2e: run the desktop journey E2E on Windows CI (A-WIN-E2E-1)

> **STATUS: OPEN.** `.github/workflows/windows-installer.yml` is protected (FOUNDER class); this file carries the exact diff for the coordinator's transition package. Nothing here was applied.

## What exists (branch `claude/lane-a-win-e2e`, stacked on #226 `bccc2bf` + base `badb009`)
- `scripts/e2e/fake-backend.ts`: the real Control API (`buildServer`) in a temp data dir, FAKE executor, runner on, **no sandbox injected** (no verified sandbox => tests are honestly NOT_EXECUTED; nothing runs project code on the host), real token, 127.0.0.1 only. No real Claude, no network.
- `scripts/e2e/desktop-journey.e2e.mjs`: Playwright `_electron` drives the repo's Electron (`apps/desktop/main.mjs`, dev mode, isolated `--user-data-dir`). Steps (each asserts the on-screen state and takes a screenshot into `<out>/screenshots`, result in `<out>/report.json`):
  1 first-run wizard shown and skipped; 2 Settings "Ready to build?" rows (PASS/BLOCKED/UNKNOWN only); 3 idea -> intake (web-node default, "no task planned, no run started"); 4 analysis step says "not enabled" (GATED_4B); 5 task planned by hand; 6 mission Draft -> Preflight -> Authorized (confirmed); 7 run engine truth block before Start run; 8 start run; 9 run reaches AWAITING_APPROVAL (FAKE executor, CLEAN review); 10 test-result row is one of the honest kinds, never "passed" unless verified; 11 run linked to the task; 12 project workspace; 13 delivery prepared; 14 delivery accepted (NOT_VERIFIED acknowledged); 15 product card "not available to the desktop yet" (GATED_4B).
- Exit codes: `0` all steps passed, `1` a step failed, `3` BLOCKED (`BLOCKED:PLAYWRIGHT_MISSING | ELECTRON_BINARY_MISSING | NO_DISPLAY | BACKEND_NOT_STARTED | ELECTRON_LAUNCH_FAILED`). BLOCKED is never a pass.
- Electron: `automation/lib/electron-provision.mjs` `verifyProvisionedElectron` (the sealed binary from `scripts/provision-electron.mjs`) first, then `node_modules/electron`. Playwright: not a repo dependency; the script finds `playwright`/`playwright-core` (or `PLAYWRIGHT_MODULE_DIR`).

## Installed app vs dev mode
The packaged backend (`packaged-entry.ts`) cannot take a FAKE executor (programmatic injection only), so a full journey with FAKE needs **dev mode** (`main.mjs` + the fake backend). The installed app keeps its launch/repair/uninstall test (`scripts/installer-install-test.mjs`). This request therefore adds a dev-mode step to the same job (Electron is already provisioned there).

## Diff for `.github/workflows/windows-installer.yml`
Playwright is installed into a separate prefix so the reviewed-lock tree seal (`assertInstalledDependencyState`) and `package.json`/`package-lock.json` are untouched. Pin = the Playwright version used on Linux for this work (1.56.1).

```diff
@@ pull_request.paths
       - package-lock.json
       - tsconfig.build.json
+      - scripts/e2e/**
@@ steps (after "Real install / launch / repair / uninstall test", before "Collect delivery files")
+      - name: Desktop journey E2E (real Electron, FAKE executor, dev mode)
+        shell: bash
+        env:
+          PLAYWRIGHT_MODULE_DIR: ${{ runner.temp }}/pw/node_modules
+        run: |
+          set -o pipefail
+          npm install --no-save --no-package-lock --ignore-scripts --prefix "$RUNNER_TEMP/pw" playwright-core@1.56.1
+          mkdir -p "$RUNNER_TEMP/e2e"
+          node scripts/e2e/desktop-journey.e2e.mjs --out "$RUNNER_TEMP/e2e" 2>&1 | tee "$RUNNER_TEMP/e2e/E2E.log"
+          { echo '### Desktop journey E2E'; grep -E '^(PASS|FAIL|BLOCKED|RESULT)' "$RUNNER_TEMP/e2e/E2E.log"; } >> "$GITHUB_STEP_SUMMARY"
@@ "Collect delivery files"
           for f in "$out"/UASCO-Setup-*.exe "$out/BUILD-SUMMARY.json" "$out/INSTALL-TEST-REPORT.json" "$out/INSTALL-TEST.log"; do
             if [ -f "$f" ]; then cp "$f" "$RUNNER_TEMP/delivery/"; fi
           done
+          if [ -d "$RUNNER_TEMP/e2e" ]; then mkdir -p "$RUNNER_TEMP/delivery/e2e" && cp -r "$RUNNER_TEMP/e2e/report.json" "$RUNNER_TEMP/e2e/E2E.log" "$RUNNER_TEMP/e2e/screenshots" "$RUNNER_TEMP/delivery/e2e/" 2>/dev/null || true; fi
```
Notes for the coordinator:
- The step fails the job on exit 1 and on exit 3 (BLOCKED is not a pass). If you want a burn-in period, add `continue-on-error: true` to the E2E step only, and remove it after a green Windows run.
- `windows-latest` has an interactive desktop, so no `xvfb` is needed; on Linux CI use `xvfb-run -a node scripts/e2e/desktop-journey.e2e.mjs`.
- `npm install --prefix` needs the registry (the E2E step is the only step that does); it is `--ignore-scripts`.

## Linux result (this sandbox, real Electron 44.9.3 under xvfb-run, root, `--no-sandbox`)
15/15 steps PASS; no display => `BLOCKED:NO_DISPLAY` exit 3 (checked). See the report in the branch handoff.

## NOT_EXECUTED
- Windows (the script has never run on Windows: `--import tsx`, `Open workspace` role lookup, `--user-data-dir` and the sealed Electron path are Linux-verified only), the installed app, a real Claude CLI, a verified sandbox (so the test row stays NOT_EXECUTED:SANDBOX_UNAVAILABLE; the EXECUTED path is covered by unit tests, not by this E2E), the real B-RUN-1 / analysis routes (still GATED_4B).
