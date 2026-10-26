<!-- //TR: Lane A yetki talebi: gerçek Electron masaüstü uçtan uca testini (scripts/e2e/desktop-journey.e2e.mjs) Windows CI'da çalıştıran adımın taslağı; korumalı .github/workflows/windows-installer.yml bu yüzden yalnız diff olarak burada / Lane A authority request: draft of the Windows CI step for the real-Electron desktop journey E2E -->
# LANE-A-win-e2e: run the desktop journey E2E on Windows CI (A-WIN-E2E-1)

> **STATUS: OPEN (A-WIN-E2E-1 + A-WIN-E2E-2).** `.github/workflows/windows-installer.yml` is protected (FOUNDER class); this file carries the exact diff for the coordinator's transition package. Nothing here was applied.

## What exists (branch `claude/lane-a-win-e2e`, stacked on #226 `bccc2bf` + base `badb009`)
- `scripts/e2e/fake-backend.ts`: the real Control API (`buildServer`) in a temp data dir, FAKE executor, runner on, **no sandbox injected** (no verified sandbox => tests are honestly NOT_EXECUTED; nothing runs project code on the host), real token, 127.0.0.1 only. No real Claude, no network.
- `scripts/e2e/desktop-journey.e2e.mjs`: Playwright `_electron` drives the repo's Electron (`apps/desktop/main.mjs`, dev mode, isolated `--user-data-dir`). Steps (each asserts the on-screen state and takes a screenshot into `<out>/screenshots`, result in `<out>/report.json`):
  1 first-run wizard shown and skipped; 2 Settings "Ready to build?" rows (PASS/BLOCKED/UNKNOWN only); 3 idea -> intake (web-node default, "no task planned, no run started"); 4 analysis step says "not enabled" (GATED_4B); 5 task planned by hand; 6 mission Draft -> Preflight -> Authorized (confirmed); 7 run engine truth block before Start run; 8 start run; 9 run reaches AWAITING_APPROVAL (FAKE executor, CLEAN review); 10 test-result row is one of the honest kinds, never "passed" unless verified; 11 run linked to the task; 12 project workspace; 13 delivery prepared; 14 delivery accepted (NOT_VERIFIED acknowledged); 15 product card "not available to the desktop yet" (GATED_4B).
- Exit codes: `0` all steps passed, `1` a step failed, `3` BLOCKED (`BLOCKED:PLAYWRIGHT_MISSING | ELECTRON_BINARY_MISSING | NO_DISPLAY | BACKEND_NOT_STARTED | ELECTRON_LAUNCH_FAILED`). BLOCKED is never a pass.
- Electron: `automation/lib/electron-provision.mjs` `verifyProvisionedElectron` (the sealed binary from `scripts/provision-electron.mjs`) first, then `node_modules/electron`. Playwright: not a repo dependency; the script finds `playwright`/`playwright-core` (or `PLAYWRIGHT_MODULE_DIR`).

## Installed app vs dev mode
The packaged backend (`packaged-entry.ts`) cannot take a FAKE executor (programmatic injection only), so a full journey with FAKE needs **dev mode** (`main.mjs` + the fake backend). The installed app keeps its launch/repair/uninstall test (`scripts/installer-install-test.mjs`). This request therefore adds a dev-mode step to the same job (Electron is already provisioned there).

## Diff for `.github/workflows/windows-installer.yml`
Independent review (dba4270) findings B4, B8, B9, L8, L10 are folded in. Design: the E2E gets **its own job** (deps + `provision-electron` only, so it does not wait for the installer build and install test), it is **not** `continue-on-error` (a failing E2E fails the job), Playwright is installed from an **integrity-pinned tarball** into a separate prefix (lockfiles and the dependency seal untouched), artifacts go through a **separate upload** (nothing is nested in `delivery/`, so `sha256sum -- *` is unaffected), and the summary is written before the exit code is applied.

```diff
@@ pull_request.paths (add)
+      - scripts/e2e/**
+      - apps/desktop/**
+      - apps/control-api/src/**
+      - core/workos/**
+      - core/agents/**
@@ jobs (new job, after `installer`; same action pins as the installer job)
+  desktop-e2e:
+    name: desktop journey E2E (windows-latest)
+    runs-on: windows-latest
+    timeout-minutes: 15
+    env:
+      CI: "true"
+    steps:
+      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
+        with:
+          persist-credentials: false
+      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
+        with:
+          node-version: 24
+          cache: npm
+      - run: node scripts/ensure-dependencies.mjs
+      - run: node scripts/provision-electron.mjs
+      - name: Install Playwright (pinned tarball, integrity-checked, outside the repo tree)
+        shell: bash
+        run: |
+          set -euo pipefail
+          mkdir -p "$RUNNER_TEMP/pw-pack" "$RUNNER_TEMP/pw"
+          (cd "$RUNNER_TEMP/pw-pack" && npm pack playwright-core@1.56.1 --json > pack.json)
+          got=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].integrity)' "$RUNNER_TEMP/pw-pack/pack.json")
+          want=$(tr -d '\r\n' < scripts/e2e/playwright-core.integrity)
+          if [ "$got" != "$want" ]; then echo "::error::playwright-core integrity mismatch: got $got"; exit 1; fi
+          npm install --no-save --no-package-lock --ignore-scripts --prefix "$RUNNER_TEMP/pw" "$RUNNER_TEMP/pw-pack/playwright-core-1.56.1.tgz"
+      - name: Desktop journey E2E (real Electron, FAKE executor, dev mode)
+        shell: bash
+        env:
+          PLAYWRIGHT_MODULE_DIR: ${{ runner.temp }}/pw/node_modules
+        run: |
+          set -o pipefail
+          mkdir -p "$RUNNER_TEMP/e2e"
+          rc=0
+          node scripts/e2e/desktop-journey.e2e.mjs --out "$RUNNER_TEMP/e2e/run" 2>&1 | tee "$RUNNER_TEMP/e2e/E2E.log" || rc=${PIPESTATUS[0]}
+          result=$(sed -n 's/^RESULT \([^ ]*\).*/\1/p' "$RUNNER_TEMP/e2e/E2E.log" | tail -n 1)
+          {
+            echo '### Desktop journey E2E'
+            echo "exit=$rc result=${result:-NONE}"
+            echo '```'
+            grep -E '^(PASS|FAIL|NOT_VERIFIED|BLOCKED|RESULT)' "$RUNNER_TEMP/e2e/E2E.log" || true
+            echo '```'
+          } >> "$GITHUB_STEP_SUMMARY"
+          if [ "$rc" -ne 0 ]; then echo "::error::desktop journey E2E failed (exit $rc, result ${result:-NONE})"; exit "$rc"; fi
+          if [ "$result" != "PASS" ] && [ "$result" != "PASS_WITH_NOT_VERIFIED" ]; then echo "::error::desktop journey E2E result ${result:-NONE} is not a pass"; exit 1; fi
+      - name: Upload E2E report and screenshots
+        if: always()
+        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
+        with:
+          name: uasco-desktop-e2e-${{ github.run_id }}-${{ github.run_attempt }}
+          path: ${{ runner.temp }}/e2e
+          retention-days: 30
+          if-no-files-found: warn
```
Notes for the coordinator:
- The installer job and its `Collect delivery files` step are NOT changed (no directory is added to `delivery/`, so `sha256sum -- *` keeps hashing regular files only and `SOURCE_SHA.txt` is still written).
- `CI=true` makes the script accept only the sealed `provision-electron` binary (no `node_modules/electron` fallback) and `PLAYWRIGHT_MODULE_DIR` makes it load Playwright only from the integrity-checked prefix; both choices and the Playwright/Electron source and version are written to `report.json`.
- Exit codes: `0` pass (also `PASS_WITH_NOT_VERIFIED` while 4b is gated), `1` a step or the startup failed, `3` BLOCKED (only a missing precondition checked before anything is started), `4` NOT_VERIFIED with `--require-post-4b`. Add `--require-post-4b` to the command once batch 4b is merged.
- `scripts/e2e/playwright-core.integrity` holds the sha512 of the `playwright-core@1.56.1` tarball (`npm view playwright-core@1.56.1 dist.integrity`, equal to `npm pack` on this machine); bump both together.
- Linux CI (not requested here) would run the same script under `xvfb-run -a`.

## Before / after batch 4b (A-WIN-E2E-2)
The script probes the **real allow-list inside the running app** (`window.uasco.apiGet/apiPost` of a non-existent run/mission id; `INVALID_API_PATH` = not admitted, anything else = admitted; nothing is changed) in step `detect-routes` and records `mode` in `report.json`.
- Not admitted: steps `analysis` and `product` check the honest "not enabled / not available to the desktop yet" display and are recorded as **NOT_VERIFIED:GATED_4B** (never PASS of the post-4b assertion).
- Admitted: `analysis` must show the server's exact BLOCKED readiness (`data-analysis-blocker` codes; never a draft/complete/plan, no "Create plan"); `product` must offer Start, show the server's exact sandbox refusal after confirmation, keep the card out of RUNNING/STARTING, show no address/Stop, and no dev-run workspace may exist on the host.
- Summary counts PASS / NOT_VERIFIED / FAIL separately; result `PASS`, `PASS_WITH_NOT_VERIFIED` (exit 0), `FAIL` (exit 1), `BLOCKED:<code>` (exit 3); `--require-post-4b` turns any NOT_VERIFIED into a failure (exit 4): use it once 4b is merged.

> **SUPERSEDED (coordinator decision).** The sanitizer change below is NOT requested any more: Lane B changes `routes/analysis.ts` so every evaluated step (BLOCKED / REJECTED / BUILDER_FAILED / ...) answers **200** with the full step body, which `classifyAnalysisStep` already accepts. No protected change is needed. The evidence is kept as is. After Lane B pushes the route fix, re-run the journey on the composition WITHOUT the main.mjs patch (expected PASS 16 / NOT_VERIFIED 0 / FAIL 0).
> **4b pin flip:** `docs/authority-requests/LANE-A-4b-journey-pin.diff` is the exact diff for `tests/v7-b5-work-screens.test.ts` (the "A-FLOW-GAP-2 Journey end to end" pin) for the 4b commit; verified 165/165 on the composition without the main.mjs patch (4b + lane-b + lane-c; fake server answers analysis step 200 BLOCKED, product start 409 SANDBOX_UNAVAILABLE).

### FINDING (protected `apps/desktop/main.mjs`): the BLOCKED readiness never reaches the UI
On the composition (4b `fee6cef` + `63d4c1c` + `771e1d3`) with the real routes admitted, step `analysis` FAILED: the UI said "The server answered, but the answer could not be read". Cause: `sanitizePostBody` (main.mjs line ~270) reduces every `status>=400` body to `error/code/reason/message`, so the 409 `ANALYSIS_BLOCKED` answer loses `blocker`/`blockers` and the renderer correctly refuses to claim anything. Server body (verified with curl): `{"status":"BLOCKED","blocker":"PROVIDER_PROVENANCE_NOT_READY","blockers":["PROVIDER_PROVENANCE_NOT_READY","implementer:CLAUDE_PROFILE_LOGIN_REQUIRED","reviewer:CLAUDE_PROFILE_LOGIN_REQUIRED"],"founderAction":"...","readiness":{...},"error":"ANALYSIS_BLOCKED"}`. Requested protected change (codes only; free text `founderAction` and `readiness` stay out):
```diff
--- a/apps/desktop/main.mjs
+++ b/apps/desktop/main.mjs
@@ function sanitizePostBody(status,parsed){
-  if(status>=400){const out={};for(const k of ["error","code","reason","message"])if(typeof parsed[k]==="string")out[k]=scrubText(parsed[k]);return out}
+  if(status>=400){const out={};for(const k of ["error","code","reason","message"])if(typeof parsed[k]==="string")out[k]=scrubText(parsed[k]);
+    // //TR: 409 ANALYSIS_BLOCKED hazırlık kodlarını taşır; yalnız kod dizileri geçer (serbest metin founderAction/readiness geçmez).
+    if(status===409&&parsed.error==="ANALYSIS_BLOCKED"){if(typeof parsed.blocker==="string")out.blocker=scrubText(parsed.blocker,160);if(Array.isArray(parsed.blockers))out.blockers=parsed.blockers.filter(x=>typeof x==="string").slice(0,50).map(x=>scrubText(x,160))}
+    return out}
```
Test pin to add next to the existing `sanitizePostBody` test in `tests/v7-b5-work-screens.test.ts` (line ~84): `expect(sanitizePostBody(409,{error:"ANALYSIS_BLOCKED",blocker:"X",blockers:["a","b",5],founderAction:"free text",readiness:{}})).toEqual({error:"ANALYSIS_BLOCKED",blocker:"X",blockers:["a","b"]})`, a 409 with another error code keeps only the four keys, and 51+ blockers are cut to 50. With this one change applied locally on the composition (not pushed), `analysis` PASSES with the server's exact codes (see the Linux composition result below).

### Product refusal on a host without a sandbox provider
With no verified provider (this E2E injects none) the server refuses Start with the plain 409 `SANDBOX_UNAVAILABLE` (the execution gate answers before the bridge check); the UI shows it as `Refused (SANDBOX_UNAVAILABLE)`. `DEVRUN_SANDBOX_UNAVAILABLE:<reason>` appears only when a verified provider exists but cannot bridge a loopback port; that case is covered by the unit tests, not reachable in this E2E without injecting a sandbox. The step accepts either code and fails for anything else.

## Linux result (this sandbox, real Electron 44.9.3 under xvfb-run, root, `--no-sandbox`)
- Base mode (routes not admitted): `PASS 14 / NOT_VERIFIED 2 (analysis, product: GATED_4B) / FAIL 0`, result `PASS_WITH_NOT_VERIFIED`.
- Composition (local only, not pushed: this branch + 4b `fee6cef` + `63d4c1c` + `771e1d3`; both merge conflicts in test files kept both sides; `devrun.ts`/remediation test took the lane-b side): without the main.mjs change above `analysis` FAILS (finding); with it (composition commit `5b85947`, the unpushed main.mjs patch on top of `2ddbfd4`) `PASS 16 / NOT_VERIFIED 0 / FAIL 0`, twice.
- No display => `BLOCKED:NO_DISPLAY`, exit 3 (checked).
- On the composition `tests/v7-b5-work-screens.test.ts` + `tests/v7-b1-workos.test.ts`: 295 passed / 1 failed. The one failure is #226's own end-to-end test pin that asserts the two routes are blocked (`expected [] to include 'POST /v1/missions/msn_...analysis/step'`); it must flip when 4b lands (the blocked list becomes empty, the analysis/product steps go through the admitted path).

## NOT_EXECUTED
- Windows (the script has never run on Windows: `--import tsx`, `Open workspace` role lookup, `--user-data-dir` and the sealed Electron path are Linux-verified only), the installed app, a real Claude CLI, a verified sandbox (so the test row stays NOT_EXECUTED:SANDBOX_UNAVAILABLE; the EXECUTED path is covered by unit tests, not by this E2E), the real B-RUN-1 / analysis routes (still GATED_4B).
