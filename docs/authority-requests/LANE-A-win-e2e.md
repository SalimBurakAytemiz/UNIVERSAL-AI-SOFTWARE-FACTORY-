<!-- //TR: Lane A yetki talebi: gerçek Electron masaüstü uçtan uca testini (scripts/e2e/desktop-journey.e2e.mjs) Windows CI'da KENDİ workflow dosyasında (.github/workflows/desktop-journey-e2e.yml) çalıştıran taslağın açıklaması; korumalı .github/ yolu bu yüzden taslak docs/authority-requests/LANE-A-desktop-journey-e2e.yml.txt olarak burada / Lane A authority request: the real-Electron desktop journey E2E in its own workflow file -->
# LANE-A-win-e2e: run the desktop journey E2E on Windows CI in its own workflow (A-WIN-E2E-1)

> **STATUS: OPEN (A-WIN-E2E-1 + A-WIN-E2E-2).** `.github/workflows/` is protected (FOUNDER class); the new workflow file is carried as a draft for the coordinator's transition package. Nothing here was applied.

## What exists (branch `claude/lane-a-win-e2e`)
- `scripts/e2e/fake-backend.ts`: the real Control API (`buildServer`) in a temp data dir, FAKE executor, runner on, **no sandbox injected** (no verified sandbox => tests are honestly NOT_EXECUTED; nothing runs project code on the host), real token, 127.0.0.1 only. No real Claude, no network.
- `scripts/e2e/desktop-journey.e2e.mjs`: Playwright `_electron` drives the repo's Electron (`apps/desktop/main.mjs`, dev mode, isolated `--user-data-dir`). A fixed denominator of **16 planned steps**, each with a kind. Each step asserts the on-screen state, takes a screenshot into `<out>/screenshots`; the result is `<out>/report.json`. The temporary app data dir is a fresh `mkdtemp` `<out>/data-XXXXXX` (an existing `<out>/data` is never touched) and is removed on exit, also on SIGINT (130) / SIGTERM (143).

| # | step | kind |
|---|------|------|
| 1 | first-run-dialog | FUNCTIONAL |
| 2 | detect-routes (probes the real allow-list inside the app) | FUNCTIONAL |
| 3 | setup-check (six rows; SANDBOX row cross-checked against the server's `/v1/system/executors`) | FUNCTIONAL |
| 4 | intake-idea | FUNCTIONAL |
| 5 | analysis | GATED_ASSERTED |
| 6 | plan-task-by-hand | FUNCTIONAL |
| 7 | authorize-mission (timeline AND the server's mission status AUTHORIZED) | FUNCTIONAL |
| 8 | run-engine-truth | FUNCTIONAL |
| 9 | start-run | FUNCTIONAL |
| 10 | run-reaches-review | FUNCTIONAL |
| 11 | test-result-honest (expectation derived from the server's `GET /v1/work-runs/:id`; the UI kind/reason must equal it) | NOT_EXECUTED_ASSERTED |
| 12 | link-run-to-task | FUNCTIONAL |
| 13 | open-project-workspace | FUNCTIONAL |
| 14 | delivery-prepare | FUNCTIONAL |
| 15 | delivery-accept (NOT_VERIFIED acknowledged) | FUNCTIONAL |
| 16 | product | GATED_ASSERTED |

- A startup failure (backend/Electron did not come up) is reported **separately** in `report.json` `startup` (backend log tail and Electron main-process stdout/stderr tail), not as a 17th step; it makes the result `FAIL` (exit 1).
- Exit codes: `0` pass or `PASS_WITH_NOT_VERIFIED`, `1` a step or the startup failed, `3` BLOCKED (**only** `PLAYWRIGHT_MISSING`, `ELECTRON_BINARY_MISSING`, `NO_DISPLAY`: missing preconditions checked before anything is started), `4` NOT_VERIFIED with `--require-post-4b`. BLOCKED is never a pass.
- Electron: `automation/lib/electron-provision.mjs` `verifyProvisionedElectron` (the sealed binary from `scripts/provision-electron.mjs`) first, then `node_modules/electron` (not with `CI=true`). `report.json` `electron` carries `source`, `path`, `version` (from `dist/version`, Electron 44.x here) and `provisionError`. Playwright is not a repo dependency; the script finds `playwright`/`playwright-core` (or `PLAYWRIGHT_MODULE_DIR`).

## Installed app vs dev mode
The packaged backend (`packaged-entry.ts`) cannot take a FAKE executor (programmatic injection only), so the full journey needs **dev mode** (`main.mjs` + the fake backend). The installed app keeps its launch/repair/uninstall test (`scripts/installer-install-test.mjs`, `windows-installer.yml`, unchanged). The journey therefore runs in **its own workflow file**, not in the installer's.

## New workflow file: `.github/workflows/desktop-journey-e2e.yml`
Draft (exact content, ready to add): `docs/authority-requests/LANE-A-desktop-journey-e2e.yml.txt`. `windows-installer.yml` is **not changed at all** (the earlier idea of adding a job and 5 workflow-level path globs there is withdrawn: those globs would have run the 60-minute installer job on every renderer/control-api/workos PR).
- Own `paths` filter: `scripts/e2e/**`, `scripts/ensure-dependencies.mjs`, `scripts/provision-electron.mjs`, `automation/lib/**`, `apps/desktop/**`, `apps/control-api/src/**`, `core/**`, `registries/**`, `config/**`, `roadmap/review-packages.json`, `tsconfig.json`, `package.json`, `package-lock.json`, the workflow itself. `pull_request` types `[opened, synchronize, reopened, ready_for_review]` and a job-level `if: github.event_name != 'pull_request' || github.event.pull_request.draft != true`, so a Draft PR uses no Windows slot. The `push` trigger on `v7/integration` has **no** `paths` on purpose: it is a post-merge canary that runs once after every merge even when a path filter would have missed it. Also `workflow_dispatch`.
- **Advisory: not a required status check; rulesets, merge-gate REQUIRED_CONTEXTS and the review gate are unchanged.**
- `permissions: contents: read`; concurrency group per PR/ref (older PR run is cancelled); `timeout-minutes: 15`; actions pinned to the same SHAs as `windows-installer.yml` (checkout `11bd7190...`, setup-node `49933ea5...`, upload-artifact `ea165f8d...`); `CI=true`.
- Not `continue-on-error`: a failing E2E fails the job. Playwright is installed from an **integrity-pinned tarball** (`scripts/e2e/playwright-core.integrity`, sha512 of `playwright-core@1.56.1`) into a separate prefix; lockfiles and the dependency seal are untouched. The summary is written before the exit code is applied.
- Artifact upload: `${{ runner.temp }}/e2e` **excluding** `${{ runner.temp }}/e2e/run/data-*` (the temporary app data dir is never uploaded).
- The cross-check reads of the server (executors, missions, work-run) are made **from Node straight to `http://127.0.0.1:<port>` with the control token**, not through `window.uasco.apiGet` / the `main.mjs` bridge, so a lying bridge cannot satisfy them. Without a verified sandbox the server must say exactly `NOT_VERIFIED` / `NOT_EXECUTED:SANDBOX_UNAVAILABLE` with `testsExecuted=false`, and the delivery card's productVerification axis must equal the work-run's.
- Electron main-process output is captured **from process start** (`electron -r scripts/e2e/main-log-hook.cjs`, file `<out>/electron-main.log`; Chromium's own log file does not carry the main process's `console.*`) and its tail goes into `report.json` `startup.electronLog`.
- `CI=true` makes the script accept only the sealed `provision-electron` binary and `PLAYWRIGHT_MODULE_DIR` makes it load Playwright only from the integrity-checked prefix.
- Add `--require-post-4b` to the command once batch 4b is merged.
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
