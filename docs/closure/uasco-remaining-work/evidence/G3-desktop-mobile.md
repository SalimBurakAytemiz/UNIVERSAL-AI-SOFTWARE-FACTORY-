<!-- //TR: UASCO kapanış denetimi kanıt dosyası — G3 Desktop ve Mobile denetimi (2026-11-02, salt-okunur denetçi çıktısı) -->
# G3 - Phase 4 modules A (Desktop) and F (Mobile Companion): evidence report

Audit target: `v7/integration` @ `0b71650fa88b9802968562c63ca33f8b56e9648b` (merge of #290, 2026-10-27T11:34:54Z). Report date 2026-11-02. Read-only audit: nothing was pushed, commented, merged or changed; no vitest, no npm install. Auditor: G3 subagent.

Evidence tags: **[V]** = I checked it against a primary source in this session (file:line, API, node script); **[C]** = a document or another session says so, not re-verified; **[E]** = my inference (method stated). COORD-VERIFIED 2026-11-02 facts are cited as such.

Ladder: PLANNED > DESIGNED > CODED > INTEGRATED > TESTED(unit) > VERIFIED_REAL_ENV > USABLE_BY_END_USER. Each row gives the highest level I can PROVE. A test that needs an unavailable environment is NOT_RUN_ENV_UNAVAILABLE, never PASS.

---

## 0. Bottom line (read this first)

| # | Finding | Level / status | Evidence |
|---|---|---|---|
| 1 | The Windows desktop app builds, installs, launches, repairs and uninstalls on a **GitHub-hosted windows-latest** runner at HEAD. This is the strongest real-environment proof in module A. | VERIFIED_REAL_ENV (CI only; silent install into %TEMP%; no shortcuts) | [V] Windows Installer run 40497319565 (run #181), job 122165934119, success, 2026-10-27T11:35:42Z-11:41:03Z, head_sha 0b71650; job log steps below |
| 2 | **No end user can use it yet.** No signed build, 0 GitHub releases, 0 tags, no Founder-PC record for `0.7.0-dev.3`, and the installed app can never run project code (`SANDBOX_UNAVAILABLE` by construction). | Not USABLE_BY_END_USER | [V] releases `[]`, tags `[]` (GitHub API); `apps/control-api/src/packaged-entry.ts:54` ("sandbox option DOES NOT EXIST: project code execution is always SANDBOX_UNAVAILABLE"); `installer/electron-builder.json:15` `sign:false` |
| 3 | The renderer is wired to **real** Control API routes: all 73 distinct `/v1/...` paths the renderer references resolve to registered server routes. The views are not fixture-fed in production; fixtures exist only in tests. But 10 of the 23 routes (home, projects, work, workforce, assurance (mixed), delivery, tower, inbox, company, settings) are rendered in tests only through a fake bridge (their server routes have separate tests), and real-Electron proof is Linux-only and builder-recorded. | INTEGRATED + TESTED(unit); real-Electron = CLAIMED (Linux) | [V] route cross-check script (section 3.2); [C] `docs/authority-requests/COORD-FIRST-DELIVERY-WIRING.md:80`, `docs/authority-requests/LANE-A-win-e2e.md:81` |
| 4 | Three Founder-named features **do not exist in code**: single command field, smart revision, voice. A pure command-intake core exists but is wired to nothing. | Command intake core = CODED+TESTED(unit), unwired; revision = PLANNED; voice (desktop) = PLANNED, voice (mobile) = DESIGNED | [V] `git grep` over `apps/` (0 hits for speech/microphone/voice/revision-route); `core/mission/command-intake.ts` (77 lines) imported only by `tests/mission-state.test.ts:4` |
| 5 | A real, user-visible defect remains at HEAD: **"Export delivery package" always fails** in the installed app (AUD-022 still open). | CODED but broken | [V] simulation with the real `scrubText`/`sanitizePostBody` extracted from `apps/desktop/main.mjs`: server path becomes `[path]` (section 2.6) |
| 6 | **Mobile Companion = documents plus a 548-line pure-TypeScript read-only core.** No React Native project, no Android build, no APK, no `/v1/mobile/*` route, no gateway. The core's test file is the only test file in the repo that CI does not run. | Docs = DESIGNED; core = TESTED(unit, local); app = PLANNED/DESIGNED; nothing INTEGRATED | [V] section 4 |
| 7 | The prior audit (2026-10-20) is partly out of date: CI now builds and installs the installer (workflow added 2026-10-21), `apps/mobile/` now exists, and the P0 token-gate bypass (AUD-004) is fixed on base. Most P1/P2 desktop findings are still open. | see section 2.7 | [V] re-verification table |

---

## 1. Scope and method

Commands and sources used (all read-only):
- `git -C audit-wt ...` (ls-files, grep, log) on the checkout at 0b71650; file reads of `apps/desktop/*`, `apps/control-api/src/*`, `installer/*`, `scripts/build-installer.mjs`, `scripts/installer-install-test.mjs`, `.github/workflows/*`, `config/validation.json`, `docs/mobile/*`, `apps/mobile/*`.
- GitHub MCP read-only: `list_workflow_runs windows-installer.yml`, `list_workflow_jobs` (runs 40497319565 and 40497319498), `list_workflow_run_artifacts`, `get_job_logs` (tail), `list_releases`, `list_tags`.
- Small node scripts in `scratchpad/g3tmp/` (route extraction and cross-check, test-call counting, scrubber simulation, locale parity, CI-registration check). No test suite was run.
- Secondary sources (kept as [C]): prior audit v1.0 files `03`, `06`, `09 MASTER FINDINGS.json`; `docs/inventory/2026-10-19/*`; `docs/lanes/*`; `docs/authority-requests/*`; coordinator notes `COORD-STATE.md`, `G1-github-baseline.md`; production queue at `pqw` (ledger commit 3074ec2).

Inventory (all [V], counted at 0b71650):

| Item | Count |
|---|---|
| `apps/desktop` tracked files | 120 (main.mjs 375 lines, preload.mjs 14, backend-error.html 31, renderer 117 files = 115 + the 2 locale dictionaries) |
| Renderer JS excluding the 2 locale dictionaries | 105 files, 13,604 lines (of which 44 view files = 6,648 lines); CSS 866 lines |
| Locales | `en.js` and `tr.js` 3,548 lines each, 3,545 keys each, 0 keys only in one of them (imported and compared) |
| Hash routes in `routes.js` | 23 (8 Factory areas: home, projects, work, workforce, assurance, delivery, tower, inbox; 14 more: company, academy, journey, executive, queue, readiness, posture, matrix, operations, install, audit, domains, integrations, scheduler; plus settings) |
| Control API | 105 `app.get/post` registrations (74 in `server.ts`, 31 in `routes/*.ts`), `server.ts` 795 lines |
| Desktop IPC | 9 `ipcMain.handle` handlers = 9 preload functions (`apiGet`, `apiPost`, `stop`, `resume`, `retryBlocked`, `pickImportPath`, `openPreview`, `showExport`, `exportDelivery`) |
| Desktop allow-list | GET: 12 fixed paths + 34 anchored regex constants + `control-boundary.mjs desktopGetPathAllowed`; POST: 18 anchored patterns (some with alternation), body must be a plain JSON object of at most 32,768 bytes |
| Package | `0.7.0-dev.3` (`package.json:4`), Electron 44.9.3, electron-builder 27.0.0-alpha.9 (prerelease) |
| `apps/mobile` | 6 files, 548 lines TypeScript (4 source files 349 lines + 1 test 199 lines) + README; 2 commits (0c212ce 2026-10-21, 3d2e1d3 2026-10-21) |
| `docs/mobile` | 8 design files 2,280 lines + 20 screen specs (3,946 lines in total with screens) |
| Tests (static `it(`/`test(` call-site count, not executed) | 124 test files, about 3,073 call sites repo-wide [E, regex]; 41 desktop/installer/UX-family files with about 1,737 call sites [E] |

---

## 2. Module A - Desktop

### 2.1 Real-environment evidence that exists (the facts everything else rests on)

**Windows Installer workflow** (`.github/workflows/windows-installer.yml`, added in a9fdca4 on 2026-10-21; PR path filter in bcccde1 2026-10-22). Runs on every push to `v7/integration`, on packaging-input PRs, and on `workflow_dispatch`. It is NOT a required check (comment in the file) [V].

- 181 runs in total [V] (`total_count` 181). Latest run 40497319565 on HEAD 0b71650: conclusion success [V]. Breakdown from the coordinator baseline G1: push 112 success / 11 cancelled; pull_request 55 success / 2 cancelled / 1 failure [C].
- Job steps all success [V]: checkout, setup-node 24, `ensure-dependencies`, `provision-electron` (sealed Electron), `npm run dist:win` (11:36:50-11:38:48, build `durationMs` 117,499), "Real install / launch / repair / uninstall test" (11:38:48-11:40:53), collect, upload.
- Build output [V, job log `installer-built`]: `UASCO-Setup-0.7.0-dev.3-win-x64.exe`, 111,335,800 bytes, sha256 `3ef48b56f6721d75c83e53c3c45da27e4a0c20b9346d8dada2ccd31fd13fa344`, `signed:false`, "NONE (unsigned development build; SmartScreen warnings expected)", electronVersion 44.9.3, unpacked app 2,763 files / 19,245,812 bytes.
- Artifact [V]: `uasco-windows-installer-40497319565-1`, id 12730997533, 111,344,297 bytes, zip digest `sha256:2418e1e4a2809e00153acbf43b46c30a222a36fc9178c0845d6483f05af55945`, not expired, expires 2026-11-26T11:40:54Z (30-day retention, so it disappears unless someone downloads it). It holds the exe, BUILD-SUMMARY.json, INSTALL-TEST-REPORT.json, INSTALL-TEST.log, SHA256SUMS.txt, SOURCE_SHA.txt (6 files). I did not download or open the zip.
- What the install test did on the runner [V, job log rows]:
  - `install-refused-insufficient-space`: exit code 3, 671 ms, install directory not created.
  - `silent-install` (`/S /UASCO_TEST_NO_SHORTCUTS --no-desktop-shortcut /D=%TEMP%\...\install\UASCO`): exit 0, 70,837 ms, `UASCO.exe` present, HKCU uninstall key `c08a2cf2-0094-569e-be97-c685aa0f7e0b` written (DisplayVersion 0.7.0-dev.3), 1,654 installed files.
  - `launch-0-default-flags-from-temp` (sandbox on, no flags): exit 0 in 2,625 ms, marker `controlApi:HEALTHY`, `serverIdentity:VERIFIED`, backend port closed after quit, backend log has 0 stray 64-hex strings (token not logged), `rendererIpcRejected:false`.
  - `launch-1` with `--no-sandbox`, `unpacked-payload-sandboxed-launch`, `launch-2-after-repair`: all exit 0 and HEALTHY/VERIFIED.
  - `single-instance`: second instance exits 0 in 170 ms and starts no second backend.
  - `install-dir-unchanged-after-launch`: unchanged (no write into the install directory).
  - `repair-reinstall-same-version`: exit 0 in 28,436 ms.
  - `silent-uninstall --keep-shortcuts`: exit 0, install directory removed, user data kept, uninstall key and install key removed, no stray updater copy.
- What the test does NOT prove [V from the script `scripts/installer-install-test.mjs` and the log]:
  - shortcuts are never created (`UASCO_TEST_NO_SHORTCUTS`; every `shortcuts` row is false);
  - the NSIS wizard pages, directory chooser and the "delete my data" checkbox are never driven (silent mode only);
  - upgrade from an older version and downgrade are never run (repair = same version);
  - the app is launched with `UASCO_SMOKE=1`: the marker is written on the renderer's `did-finish-load` and the app quits 500 ms later (`main.mjs:367-369`). So a document load plus a clean IPC-sender check (`UNTRUSTED_IPC_SENDER` absent from stderr) is proven; rendered screens, data fetched through IPC and user interaction are not.
  - the install location is `%TEMP%`, not `%LOCALAPPDATA%\Programs\UASCO`.

**Full CI at HEAD** [V]: CI run 40497319498 (push, 0b71650): `validate (ubuntu-latest)` success; `validate-windows-shard (1)`, `(2)`, `(3)` success; `validate (windows-latest)` aggregator success. So the desktop and renderer unit tests ran green on windows-latest as well as ubuntu at HEAD.

**Releases** [V]: `list_releases` = `[]`, `list_tags` = `[]`. The only installer that exists is the 30-day CI artifact above.

**Founder-PC / user-machine evidence** [C, stale]: `docs/inventory/2026-10-19/raw/requirements-sources.md:104` says the Founder installed `0.7.0-dev.1`; `raw/release-deploy.csv:2` says a `0.7.0-dev.2` exe was built on the Founder PC 2026-10-16 (marked STALE). `git grep -E "0\.7\.0-dev\.[23]" -- audit docs` finds no checkpoint/install record for dev.2 or dev.3. Therefore a real-user-machine run of the current version = **UNKNOWN / no record**.

### 2.2 Feature ladder (module A)

Legend for "Real wiring": R = renderer reaches a registered server route through the IPC bridge and a test drives that against the real `buildServer`; F = only a fake bridge in the renderer test (the server route has its own separate tests); N = no route.

| # | Feature | Highest level PROVEN | Evidence (files, tests, CI) | Gaps / work needed |
|---|---|---|---|---|
| A1 | **Windows app** (Electron shell + packaged backend, main.mjs, preload, packaged-entry.ts) | VERIFIED_REAL_ENV (GitHub-hosted windows-latest, launch + health only). Not USABLE_BY_END_USER. | [V] main.mjs 375 lines; CI run 40497319565 launch rows; tests `v7-b7-installer` (36), `v7-b4-desktop-shell` (38), `v7-int-r3-desktop` (9), `v7-m1a-desktop` (18), `v7-m1a-mode` (10), `pkg-c-lf-electron-smoke` (5) all registered in `config/validation.json` and green on both OSes at HEAD [V CI] | No run on a user's own machine for dev.3; installed app cannot run project code (A-GAP-1); no crash/restart handling (A-GAP-10); PATH not passed to the backend (A-GAP-12). |
| A2 | **Installer build** (`scripts/build-installer.mjs` 318 lines, `installer/electron-builder.json`, `uasco-installer.nsh` 232 lines, `windows-installer.yml`) | VERIFIED_REAL_ENV (CI) | [V] run 40497319565; artifact 12730997533; `BUILD_VARIANTS` release/test identities (`UASCO_BUILD_VARIANT=test`); stage-only mode; `tests/v7-b7-installer.test.ts` | Unsigned (`sign:false`); no release/tag; no SBOM or provenance attestation (workflow `permissions: contents: read` only); `electron-builder 27.0.0-alpha.9` prerelease; the same dev build is the only target; NSIS bundle downloaded at build time (log shows `nsis-bundle-3.12.tar.gz` download). |
| A3 | **Install / repair** (silent) | VERIFIED_REAL_ENV (CI, %TEMP%, test switches) | [V] rows above | Interactive wizard, shortcuts, default `%LOCALAPPDATA%\Programs\UASCO`, SmartScreen behaviour, non-ASCII/space paths, OneDrive-redirected profile: NOT_RUN. |
| A4 | **Uninstall + data handling** | VERIFIED_REAL_ENV for silent uninstall keeping data | [V] `silent-uninstall` row: dir removed, data kept; `deleteAppDataOnUninstall:false` (`electron-builder.json:28`) | "Delete my data" path never exercised; data directory ACLs unchecked. |
| A5 | **Start** (launch, single instance, backend start, identity handshake) | VERIFIED_REAL_ENV (CI, headless smoke) | [V] `launch-*` and `single-instance` rows; `main.mjs:329` single-instance lock; `main.mjs:257` challenge-proof | Founder-PC start of dev.3 UNKNOWN. |
| A6 | **Update** (auto-update, safe upgrade, rollback) | Auto-update = PLANNED (nothing coded). Manual "run a newer installer" = CODED (NSIS `--updated` hook) but never executed. | [V] no `autoUpdater`/`electron-updater` anywhere in code; `publish:null` (`electron-builder.json:9`); `verifyUpdateCodeSignature:false` (:16); `docs/installer/README.md:62-66`; CI test only does same-version repair | Need an update channel with signed artifacts, an upgrade dev.N to dev.N+1 test on Windows, a journal backup before upgrade, a downgrade policy (AUD-081 [C]). |
| A7 | **UI shell** (topbar, nav 23 routes, context bar, always-visible STOP, dialogs, a11y, EN/TR, hash routing, 15 s refresh) | TESTED(unit) + INTEGRATED. Real-Electron render proof only Linux [C]. | [V] `index.html`, `app.js` (REFRESH_MS 15000), `shell.js`, `nav.js`, `routes.js`; `tests/v7-ux-shell` (29), `v7-b4-desktop-shell` (38), `v7-ux-vp-visual-parity` (10); locale parity 3,545/3,545 [V] | Windows render of real screens NOT_RUN; visual parity vs design only unit-tested. |
| A8 | **Founder Cockpit** (`views/home.js`: KPI tiles for projects, missions, approvals, alerts, evidence, workforce; area map; orchestrator panel) | INTEGRATED + TESTED(unit). Real wiring: F in the renderer test. | [V] reads `GET /v1/cockpit` + `GET /v1/projects` (route registered); honest states (UNAVAILABLE shows an em dash); `tests/v7-ux-wp2-cockpit` (23) | It is a read-only dashboard. It is not a command cockpit. No real populated-data Windows run. |
| A9 | **Single command field** (Founder types an order, system drafts a mission) | UI: PLANNED (screen UI-004 "Kurucu Komut Merkezi" is AUTHORITY_REQUIRED, UI NO / API NO [C]). Core: CODED + TESTED(unit) (PQ-011, `core/mission/command-intake.ts`, 77 lines, pure, output always DRAFT, never authorizes). Not INTEGRATED. | [V] `git grep intakeCommand` hits only the core file and `tests/mission-state.test.ts`; no import in `apps/**`; no route; `index.html` has no command input. What exists instead: a global search/palette (`shell.js:136-166`: go-to-route, inspect, stop-all, search projects/missions) and the "Fikirden basla" idea-intake form (`views/intake.js` posting `POST /v1/intakes`, which is INTEGRATED + TESTED and recorded as passing on real Electron/Linux [C]) | Need: a route that calls `intakeCommand`, a protected allow-list entry (main.mjs/server.ts are protected), a command bar component, tests; Founder decision on what the command may do. |
| A10 | **Voice** (speech input) | Desktop: PLANNED. Mobile: DESIGNED (UI-101, UI-179, UI-250; SC-9; "NOT in release 1"). | [V] `git grep -i -E "speech|getUserMedia|MediaRecorder|microphone|\bvoice\b" -- apps` = 0 hits; `main.mjs:363` denies every permission request and check (so microphone would be blocked) | Needs Founder privacy decision, a main.mjs permission change (protected), an STT choice, tests. |
| A11 | **Tasks** (Work screen: missions, plan by hand, task status, task-run link, run start, runs) | INTEGRATED + TESTED(unit). Real wiring R for several flows. Real Electron (Linux) = CLAIMED. | [V] `views/work.js` 418 lines, `work-core.js` 641, `task-status.js`, `task-runs.js`; routes `POST /v1/missions`, `/transition`, `/plan`, `/runs`, `POST /v1/tasks/:id/transition`, `/runs` registered; tests `v7-b5-work-screens` (180), `v7-ux-wp-workos` (41), server `v7-b1-workos` (170). [C] first-delivery real Electron E2E "3 consecutive runs PASS 12/12" (Linux, Electron 44.4.5) `COORD-FIRST-DELIVERY-WIRING.md:80`; [C] desktop-journey E2E base mode "PASS 17 / NOT_VERIFIED 2 / NOT_EXECUTED 2 of 21, twice" and "PASS 20/20" on a local post-#242 composition, Linux xvfb, root, `--no-sandbox` (`LANE-A-win-e2e.md:81`) | The journey E2E has never run on Windows, never in CI (A-GAP-9); the post-#242 composition that includes the task-status-done step "was NOT run" [C]. A real run needs executor + sandbox (A-GAP-1). |
| A12 | **Agents views** (`views/workforce.js` 366 lines; 599-role catalog, role detail, readiness summary, active worker runs) | INTEGRATED + TESTED(unit). Wiring F (plus real-store tests in `v7-ux-wp-agents`). | [V] `registries/role-definitions.json` 599 roles, `role-execution-profiles.json` 599, `registries/agents.json` 363 entries; routes `/v1/agents`, `/v1/roles`, `/v1/roles/:id`, `/v1/roles/status-summary` registered; the view states "599 role definitions are not 599 live agents" (workforce.js header); tests `v7-ux-wp-agents` (113), `v7-wfr03-role-registry` (122) | No live agent runtime exists to display beyond work-runs; PR #292 (A2a tools panel, 43776e1) and #291 (role context route, 4b4eee0) are open and CI-blocked by the base-wide dependency audit (COORD-VERIFIED). |
| A13 | **Planning** (pre-dev decisions, analysis step/plan, plan by hand, Project Studio: import git/zip, files, git log/diff, dev-run, exports) | INTEGRATED + TESTED(unit). Real-server evidence on Linux (renderer to real `buildServer`, bridge applies main.mjs gates): `docs/lanes/LANE-A-UI-011-EVIDENCE.md` (6 tests in `tests/v7-ux-journey.test.ts`, 108 total). | [V] routes registered by #242 (779c840): `analysis/step`, `analysis/plan`, `product/start|stop`, `predev/start`, `predev/artifacts/:id/approve|reject`; `tests/v7-ux-journey` (108, REALSERVER), `v7-ps1b-project-studio-ui` (193), `v7-ps1a-*` server (41) | The analysis step has never produced a real draft: no AI builder was invoked, LOCAL_CLAUDE `enabled:false` in every test; DRAFT_READY to COMPLETE only exercised through fake routes [C: LANE-A-UI011-EVIDENCE "What stays NOT_EXECUTED"]. `GET /v1/predev/:missionId` always NOT_STARTED unless a producer ran. |
| A14 | **Change** (change requests, impact, diff review) | Read-only git diff/log viewer = INTEGRATED. Change-request / impact workflow = PLANNED. | [V] `GET /v1/projects/:id/git/log|diff` used by `project-core.js`; no change-request route in `control-api` | Founder-visible change flow absent. |
| A15 | **Smart revision** (UI-015 "Akilli Revizyon Studyosu") | PLANNED | [C] screen audit: UI-015 AUTHORITY_REQUIRED, UI NO / API NO; [V] no revision route in `control-api`; the only code mention of revision is the project-memory kind label `REVISION` (`core/knowledge/project-memory-types.ts:2`) | Entire feature: design, route, UI, tests. |
| A16 | **Final approval** | INTEGRATED + TESTED(unit); real wiring R for pre-dev approvals. End-to-end approve of a real delivery = NOT_EXECUTED in any real env. | [V] (a) pre-dev artifact approve/reject with evidence refs (`views/predev-decisions.js`, `predev-decisions-core.js`; server rule: approver is the server actor; `routes/predev-decisions.ts` 139 lines); (b) inbox decision for REPORTING + AWAITING_APPROVAL runs, mission to COMPLETE with an explicit confirm dialog (`work-core.js:24` `HIGH_RISK_TARGETS`, `inbox.js`, `confirmAction` in `app.js`); (c) delivery prepare/accept requiring a NOT_VERIFIED acknowledgement (`views/delivery-panel.js`); tests `v7-ux-journey` (108), `v7-ux-inbox` (47), `v7-ux-queue` (48), `v7-m1a-c2-delivery` (11) | UI-016 "Nihai Analiz Onayi" PARTIAL [C]. Approval attestations: constant-ALLOW action gateway and no nonce (AUD-015 [C], not re-verified). Reaching REPORTING needs a successful run, which needs the sandbox (A-GAP-1). |
| A17 | **Reports** (return summary, executive ledger, audit trail, delivery card, evidence) | INTEGRATED + TESTED(unit); real-server tests for executive/operations/audit/readiness/posture. | [V] `views/return-summary.js`, `executive.js`, `audit.js`, `delivery.js`; tests `v7-ux-executive` (60, REALSERVER), `v7-ux-operations` (115, REALSERVER), `v7-ux-readiness` (45), `v7-ux-posture` (63) | Only export artifact is the delivery ZIP, which is broken (A-GAP-2). No PDF/CSV/Markdown report export; UI-162/UI-242 (report designer/editor) AUTHORITY_REQUIRED [C]. |
| A18 | **Notifications** | In-app only: bell + count, feed tabs, inbox "alerts and notifications", derived from polled reads. INTEGRATED + TESTED(unit). | [V] `index.html` `notifyBtn`/`notifyCount`; `views/inbox.js`; no OS toast: `git grep -i notification -- apps/desktop apps/control-api` hits only locale strings; permission handler denies all (`main.mjs:363`) | No OS-level, email or push notification; UI-077 "Bildirim ve Ses Ayarlari" DESIGN_ONLY [C]. |
| A19 | **Local operation** | VERIFIED_REAL_ENV (CI) for the local backend: random free loopback port, token on stdin, identity challenge, port closed after quit | [V] `main.mjs:13-14` (packaged: 32 random bytes per launch, never written), `main.mjs:343-355` start/health loop, `packaged-entry.ts` (reads token from stdin line 1, `listen 127.0.0.1`), CI rows; data under `%APPDATA%\UASCO` (userData) | Local data at rest is plain files (AUD-053 [C]); journal hash chain unkeyed (AUD-047 [C]). |
| A20 | **Remote operation** | NOT_IMPLEMENTED. Remote repositories refused (`REMOTE_REPO_NOT_SUPPORTED_YET`); no remote desktop mode; the phone gateway is DESIGNED only; renderer CSP and navigation guards block any non-local origin. | [V] locale keys `run.reason.REMOTE_REPO_NOT_SUPPORTED_YET`, `studio.import.err.remote`; server binds 127.0.0.1 (`packaged-entry.ts` listen host; `/health bindHost:"127.0.0.1"`); `main.mjs:365` | Needs Founder decision (FA-MOB-3/4 gateway; remote repos). |
| A21 | **Security** (CSP, IPC allow-list, token, window hardening) | TESTED(unit) + partly VERIFIED_REAL_ENV (token not logged, trusted sender accepted on installed file URL, CI). Details in 2.5. | [V] see 2.5 | Fuses/asar/debug switches/safeStorage/crash handlers: open (2.5, 2.6). |
| A22 | Supporting views (all INTEGRATED + TESTED(unit)): projects/studio, assurance, delivery, tower (2D only, no 3D), inbox, company OS (6 read-only lists), academy, journey, executive, queue, readiness, posture, matrix, operations, install, audit, domains, integrations, scheduler, settings (executors, setup check, theme contrast, provider routing), first-run, recovery center | see 3.1 for per-route table | [V] | Company writes (`invoices/:id/issue|void`, `contracts/:id/transition`, `opportunities/:id/stage`) exist in the API but have no UI path (25 server route paths are never referenced by the renderer, 3.2). |

### 2.3 Per-route view of the 23 hash routes (wiring and test depth)

"Real-server test" = a test file imports `buildServer` and drives the renderer module against it (REALSERVER in my scan). "Fake bridge" = the renderer test supplies canned data; the corresponding server route has its own separate test. Counts are static `it(`/`test(` call sites [E].

| Route | View | Reads (real routes) | Writes | Tests that exercise it | Depth |
|---|---|---|---|---|---|
| home | home.js | /v1/cockpit, /v1/projects | - | v7-ux-wp2-cockpit 23 | fake bridge |
| projects | projects.js, studio-wizard.js, studio-workspace.js, intake.js | projects, files, file, git/log, git/diff, devrun, exports, system/executors, intakes | projects, import, devrun start/stop/restart, export, intakes; IPC import/preview/show-export | v7-ps1b-project-studio-ui 193, v7-ux-wp-projects 30; server v7-ps1a-* 41 | fake bridge + server tests |
| work | work.js, work-actions.js, task-status.js, task-runs.js | missions, mission detail, work-runs, evidence, tasks, task runs | missions, transition, plan, runs, task transition, task runs, reconcile | v7-b5-work-screens 180, v7-ux-wp-workos 41; server v7-b1-workos 170 | fake bridge + server tests; Linux real Electron [C] |
| workforce | workforce.js | agents, roles (paged), role detail, status-summary, cockpit, work-runs | - | v7-ux-wp-agents 113 (real store in 4 places), v7-wfr03-role-registry 122 | fake bridge + real role store |
| assurance | assurance.js | reviews, review detail, evidence, work-runs | - | v7-ux-wp-qasec 74, v7-ux-reviews-api 20 (REALSERVER), v7-ux-posture 63 | mixed |
| delivery | delivery.js, delivery-panel.js | health, control/status, attention, work-runs, deliveries | delivery prepare/accept; IPC export | v7-ux-delivery 16, v7-m1a-c2-delivery 11, v7-m1a-desktop 18 | fake bridge |
| tower | tower.js + control-tower/* (2D SVG, no 3D) | cockpit, control, roles pages, work-runs | - | v7-b6a-control-tower 14, v7-ux-wp4-tower 44 | fake bridge |
| inbox | inbox.js | attention, missions, work-runs | mission transition | v7-ux-inbox 47 | fake bridge |
| company | company.js | /v1/company/{accounts,contacts,opportunities,invoices,payments,contracts} | none from UI | v7-ux-wp3-company 31, v7-ux-company-allowlist 8 | fake bridge |
| academy | academy.js | /v1/academy | - | v7-ux-academy 31 (REALSERVER) | real-server |
| journey | journey.js, analysis-step.js, predev-decisions.js, product-card.js | predev, crew, missions | predev start/approve/reject, analysis step/plan, product start/stop | v7-ux-journey 108 (REALSERVER) | real-server |
| executive | executive.js | cockpit, missions, work-runs, attention | - | v7-ux-executive 60 (REALSERVER) | real-server |
| queue | queue.js | attention, missions, work-runs | - | v7-ux-queue 48 (REALSERVER) | real-server |
| readiness | readiness.js | work-runs, reviews, cockpit, missions | - | v7-ux-readiness 45 (REALSERVER) | real-server |
| posture | posture.js | work-runs, reviews, cockpit | - | v7-ux-posture 63 (REALSERVER) | real-server |
| matrix | matrix.js | projects, missions, work-runs, cockpit | - | v7-ux-matrix 79 (REALSERVER) | real-server |
| operations | operations.js | control, runs, attention | stop/resume/retry via IPC | v7-ux-operations 115 (REALSERVER) | real-server |
| install | install.js | /v1/install, /v1/phase0 | - | v7-ux-install 27 (REALSERVER) | real-server (packaged app: install/phase0 stay PENDING by design, `build-installer.mjs` `PACKAGED_RUNTIME_READ_EXCLUSIONS`) |
| audit | audit.js | runs, run events, evidence | - | via v7-ux-operations | real-server |
| domains, integrations, scheduler | domains.js, integrations.js, scheduler.js | domains, capabilities, adapters, fabrics, scheduler | - | via v7-ux-matrix / v7-ux-posture | real-server (indirect) |
| settings | settings.js, executors-panel.js, setup-check.js | system/executors | executors/local-claude/enable | v7-ux-settings 55, v7-ps1b | fake bridge |

### 2.4 What "usable by an end user" would require (and what is missing today)

For the Founder's first real flow (idea to delivered product) on the installed Windows app:
1. Install a signed build that is not a 30-day CI artifact - missing (A-GAP-3).
2. Open app, create project/intake - works in CI smoke up to document load; Linux real Electron [C] covers intake, plan, task transitions.
3. Enable `LOCAL_CLAUDE` (opt-in, needs the Claude CLI and its provenance capture) - the packaged backend environment has no `PATH` (`main.mjs:21`; pinned by `tests/v7-b7-installer.test.ts:183` `expect(s.options.env.PATH).toBeUndefined()`), and the executor setup default looks the CLI up through `process.env.PATH` (`core/workos/executor-setup.ts:30`) [V code; effect in a packaged run UNKNOWN].
4. Run the mission and verify it - `packaged-entry.ts:54` says project-code execution is always `SANDBOX_UNAVAILABLE` in the installed app. The sandbox provider PR #231 is Founder-tier, `dirty`, and its Windows aggregator failed on head (G1 [C]; COORD-VERIFIED lists it open).
5. Approve and export the delivery - export fails (A-GAP-2).
So today the loop dead-ends at step 4, and step 5 is independently broken.

### 2.5 Security detail (all [V] unless marked)

- **Renderer CSP** (`renderer/index.html:7`): `default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:`. No inline script/style/handler in `index.html` (0 matches for `<script>`, `style=`, `onclick=`). `base-uri` and `form-action` are not set (they do not fall back to `default-src`); LOW.
- **No HTML injection sinks**: `git grep -E "innerHTML|outerHTML|insertAdjacentHTML|document.write|eval\(|new Function\(" -- apps/desktop/renderer` (excluding the `locales/` dictionaries) = 0 hits across the 105 renderer JS files. The Control Tower SVG string is turned into DOM by `control-tower/markup.js` (createElementNS), per its README.
- **Token**: renderer never references the token (0 hits for `control-token` / `UASCO_CONTROL_TOKEN` in renderer). Packaged mode: 32 random bytes per launch (`main.mjs:14`), delivered to the backend only on stdin line 1 (`main.mjs` `child.stdin.write(token+"\n")`, `packaged-entry.ts` `readFirstLine`), redacted from backend log by `logBackend`, and the install test counts stray 64-hex strings in the backend log: 0 in 4 launches (CI log). Dev mode still takes the token from the environment.
- **Control API gate**: `server.ts:125-131` (API-001/AUD-004, commit d6d39d2 on 2026-10-26): Host check first (421), only the exact raw path `/health` skips the token, everything else needs the token (403, or 503 when no token is configured). The prior audit's P0 AUD-004 is therefore fixed on base [V code; I did not run its tests]. `/health` returns a challenge proof only.
- **Window hardening** (`main.mjs:362-366`): `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`, `allowRunningInsecureContent:false`, `webviewTag:false`, `devTools:false`, `navigateOnDragDrop:false`; permission request and check handlers return false; `setWindowOpenHandler` deny; `will-navigate`, `will-redirect`, `will-attach-webview` prevented.
- **IPC**: every one of the 9 handlers calls `requireTrustedSender` (`main.mjs:283-284`; accepts only the renderer file URL, fragment ignored, `~` short-path fix). GET allow-list is exact/anchored; POST allow-list has 18 anchored patterns and a 32 KB plain-object body check; import paths must have been issued by the main-process file dialog (cap 8) and match their kind; export path must resolve inside `<data>/exports`; delivery export re-hashes the bytes in main and re-verifies the written copy; preview opens only `http://127.0.0.1:<port>/` taken from the backend's own dev-run state in the default browser. Error bodies are scrubbed of token and absolute paths (`scrubText`, `main.mjs:~266`).
- **Open items** [V]: no Electron fuses and `asar:false` (`electron-builder.json:6`; install dir is user-writable; `RunAsNode` must stay on because the backend runs via `ELECTRON_RUN_AS_NODE`, `main.mjs` `backendLaunchSpec`); the app does not refuse `--remote-debugging-port` or `--inspect`; no `safeStorage`/DPAPI (and `v7-b7-installer.test.ts:194` pins the absence); unsigned; no `render-process-gone` / `child-process-gone` / crash reporter; backend `exit` handler only logs (`main.mjs:350`), no restart.

### 2.6 Verified defects and risks found at HEAD

1. **AUD-022 still present - "Export delivery package" always fails** [V by simulation]. `ipcMain.handle("uasco:export-delivery")` (`main.mjs:310`) calls `apiPost` (:275), whose body passes through `sanitizePostBody` (:270) and `scrubText`, which replaces any `X:\...` or `/home|tmp|Users...` path with `[path]`. `deliveryExportCheck` (:240) then calls `realpathSync(body.path)` on `"[path]"` and returns `DELIVERY_ARTIFACT_MISSING`. I extracted the real functions from HEAD `main.mjs` and fed a Windows path (`C:\Users\Founder\AppData\Roaming\UASCO\workos\deliveries\run_x\h.zip`) and a POSIX path: both came back as `[path]`. Existing tests do not combine the two (`tests/v7-m1a-desktop.test.ts:402-422` feeds `deliveryExportCheck` an unscrubbed body; `tests/v7-b5-work-screens.test.ts:76-88` and `v7-b1-workos.test.ts:3128` test the scrubber on other bodies). `main.mjs` is a protected file, so the fix needs a Founder-granted change.
2. **Packaged app cannot execute project code** (`packaged-entry.ts:54`, by design until a verified sandbox exists).
3. **No backend supervision**: if the packaged backend exits after startup it is only logged; views then show UNAVAILABLE.
4. **PATH absent from the packaged backend env** (above); effect on Claude CLI discovery UNKNOWN (AUD-115).
5. **Scrubber false positive** noted by Lane A [C]: `scrubText` rewrites a PowerShell `Env:\NAME` fragment because its drive-letter pattern matches `v:\...`; harmless today, would corrupt any shown `loginCommand`.
6. **Base-wide CI failure** [COORD-VERIFIED]: `dependency-supply-chain` fails with 11 moderate advisories (glob/minimatch under electron-builder 27.0.0-alpha.9); the fix branch is not pushed. Until it lands no UI PR (#292, #291) can merge.
7. **Test registration**: of 124 test files, 123 are listed in `config/validation.json` steps; the only unregistered file is `apps/mobile/src/core/monitoring.test.ts` [V, scripted check]. All 36 desktop-family test files (by name pattern) are registered.

### 2.7 Re-verification of prior-audit (v1.0, 2026-10-20) claims relevant to module A

| Prior finding | Prior claim | Status at 0b71650 | Evidence |
|---|---|---|---|
| UASCO-AUD-021 (P1) | CI never builds the installer; builder-recorded dev.1 only; no release | **Partly superseded**: CI builds and installs it on every base push (181 runs). Still true: unsigned, no release, no tag, no SBOM/provenance, no Founder-PC record for dev.3 | [V] workflow a9fdca4; run 40497319565; releases/tags empty |
| AUD-004 (P0) | Control API token bypass | **Fixed on base** (d6d39d2, 2026-10-26) | [V] `server.ts:125-131` |
| AUD-022 (P1) | Export delivery always fails | **Still open** | [V] 2.6 #1 |
| AUD-044 (P2) | asar off, no fuses, debug switches accepted | **Still open** | [V] `electron-builder.json:6`; grep fuses = 0 |
| AUD-045 (P2) | Electron 44.4.5 not latest; builder is alpha | **Partly changed**: Electron now 44.9.3; electron-builder still `27.0.0-alpha.9`; currency of 44.9.3 UNKNOWN (cannot check upstream here) | [V] `package.json`; CI log |
| AUD-058 (P2) | Backend lifecycle start/stop only, no crash handlers | **Still open** | [V] grep for `render-process-gone`/`child-process-gone`/`crashReporter` in main.mjs = 0 |
| AUD-081 (P2) | No updater, upgrade never executed, no rollback | **Still open** | [V] 2.2 A6 |
| AUD-006 (P0) | No desktop E2E in CI | **Still open**: base now has `scripts/e2e/desktop-journey.e2e.mjs` and `fake-backend.ts`, but no workflow runs them (`ci.yml` has no electron/e2e step; the draft workflow is `docs/authority-requests/LANE-A-desktop-journey-e2e.yml.txt`; "Desktop E2E" workflow exists only on #66, Founder-held) | [V] `.github/workflows/` = ci.yml, uasco-independent-review.yml, windows-installer.yml |
| AUD-030 (P1) | No mobile code at all | **Partly changed**: `apps/mobile/` exists (pure TS core). App still absent | [V] section 4 |
| AUD-115 (LOW confidence) | Packaged PATH | Code facts confirmed (PATH omitted and pinned by a test); runtime effect UNKNOWN | [V code] |
| AUD-053/047 (at-rest data, journal chain), AUD-015 (approval attestation), AUD-023 (torn-tail repair not reachable from the app), AUD-114 (uninstall data test is only a regex) | as stated in prior audit | Not re-verified here. AUD-023 consistent with the route list: `/v1/system/workos/journal/repair-torn-tail` is registered but not referenced by the renderer and not in the desktop allow-list [V]. AUD-114 partly changed: a real silent uninstall that keeps data now runs in CI [V]. | [C]/[V] as noted |

---

## 3. Wiring analysis details

### 3.1 How I tested "real route wired" (method)
`scratchpad/g3tmp/routes.mjs` extracted server route registrations; `scratchpad/g3tmp/rend.mjs` extracted every `/v1/...` or `/health` string literal from the renderer files (excluding the `locales/` directory), normalised ids to `:p`, and matched against the server table.

### 3.2 Result [V]
- Renderer distinct API paths: 73. Matched to a registered server route: 73 (6 were flagged by my regex because of template literals, nested generics in `app.get<...>` or dynamic suffixes; I confirmed each by name: `/v1/reviews`, `/v1/roles`, `/v1/runs/:runId/events`, predev approve/reject, `git/diff`, `memory`).
- Server route paths the renderer never references (25): `/v1/academy/:id`, `/v1/company/contracts/:id/transition`, `/v1/company/invoices/:id/issue|void`, `/v1/company/opportunities/:id/stage`, `/v1/control/stop|resume|retry-blocked` (reached through the three IPC functions instead), `/v1/founder-attention` (retired source), `/v1/missions/:id/predev/produce`, `/v1/missions/:id/tasks`, `/v1/projects/:id/file`, `/v1/projects/:id/memory/...`, `/v1/reviews/:id`, `/v1/run-summaries`, `/v1/runs/:id/logs`, `/v1/system/workos/journal/repair-torn-tail`, `/v1/tasks/:id`, `/v1/work-runs/:id/delivery/export` (IPC only). Several of these are used through differently-built paths (e.g. `readFile`, memory) so this list is an upper bound of unused routes [E].
- Consequence for the strict rule: renderer screens are not fed by fixtures in production; each reads through `window.uasco.apiGet` to a real route. They still fall short of USABLE_BY_END_USER because the writes that matter (run, deliver) are gated by the sandbox and executor, and the only full-stack Electron proof is on Linux and recorded by builders.

---

## 4. Module F - Mobile Companion

### 4.1 What exists [V]

| Layer | What is in the repository | Size |
|---|---|---|
| Design documents | `docs/mobile/` ADR-MOB-001 (React Native + TypeScript, Android only), API-CONTRACT (9 PROPOSED read-only GET routes), APPROVAL-AND-STOP, CONNECTIVITY-AND-PAIRING, SECURITY-CONDITIONS (26 conditions SC-1..SC-26, counted), TECH-VERSIONS, TEST-AND-BUILD ("DESIGN ONLY / NOT ENABLED"), THREAT-MODEL | 8 files, 2,280 lines |
| Screen specs | `docs/mobile/screens/` UI-097..UI-104, UI-144, UI-173..UI-180, UI-249, UI-250, F8 (MOB-6, MOB-7) | 20 files, 1,666 lines |
| Code | `apps/mobile/src/core/{types,stale-cache,monitoring-store,view-models}.ts` plus `monitoring.test.ts` (35 `it` cases in 5 `describe` blocks) and README | 548 lines |
| Code facts | pure TypeScript, no React Native or any dependency, no fetch/WebSocket/storage, injected `MonitoringReader`; all 9 routes are `NOT_CONNECTED` in `ROUTE_CONNECTION`; states LOADING/EMPTY/ERROR/OFFLINE/STALE/UNAVAILABLE/DENIED; cached data dropped on DEVICE_REVOKED/REAUTH_REQUIRED/PIN_MISMATCH (PQ-008-R1) | - |
| Absent | `package.json` and lockfile contain no `react`, `react-native` or `expo` (0 matches); no `AndroidManifest`, gradle, metro, eas, `.kt/.java/.swift/.tsx` file outside knowledge/docs; no `/v1/mobile` route in `apps/control-api` or `core` (the 9 path strings appear only in `apps/mobile/src/core/types.ts`); no mobile CI job; no APK; no signing key; no GitHub release | - |

### 4.2 Backlog state [V, `docs/planning/BACKLOG_CHECKPOINT.json`]
- MOB-1..MOB-9: 9 tasks DONE (owner CLOUD), documents only.
- MOB-11..MOB-31: 21 tasks AUTHORITY_REQUIRED, owner FOUNDER on 21/21, `protectedEdit:true` on 17 of 21 (MOB-14, MOB-21, MOB-30, MOB-31 are the four without). MOB-0 and MOB-10 are not task rows.
- Production queue [V, `pqw` PRODUCTION-QUEUE.json]: PQ-008 (mobile monitoring core, PR #159) and PQ-008-R1 (repair, 3d2e1d3) status INTEGRATED, meaning merged into the integration branch with local unit tests; its own acceptance text says "Status at most TESTED (local)" and its testFile line says "CI registration pending".
- Founder decisions: FA-MOB-1..FA-MOB-23 are referenced in the docs; none is recorded as granted in the repository [E: grep found references only; no grant record located].

### 4.3 Feature ladder (13 required features)

| # | Feature | Highest level PROVEN | Evidence | Work needed |
|---|---|---|---|---|
| F1 | Architecture decision (RN + TS, Android-only, sideload APK) | DESIGNED | ADR-MOB-001; `knowledge/technologies/react-native.json` has 15 NOT_CERTIFIED and 0 CERTIFIED facets [V] | Founder acceptance (FA-MOB-1/10/11/12/14); technology certification (SC-16). |
| F2 | API contract (9 read-only routes) | DESIGNED | API-CONTRACT.md section 4.1-4.9; 0 routes in control-api [V] | MOB-16 (protected), FA-MOB-5/6; token model must hold (AUD-004 fixed on base). |
| F3 | Pairing, device sessions, TLS gateway | DESIGNED | CONNECTIVITY-AND-PAIRING.md; control plane is loopback HTTP only (`packaged-entry.ts` listen 127.0.0.1) [V] | MOB-17/18/19 (protected, risk 5 on some), FA-MOB-2/3/4/21/23. |
| F4 | Monitoring (summary, runs, timeline, reports, ops) | CODED + TESTED(unit, local) as a pure state core; not INTEGRATED | `apps/mobile/src/core/*`; 35 tests; not in CI steps [V] | Real reader over the future gateway; UI (MOB-21/26). |
| F5 | Project and agent status | DESIGNED (core covers the data rules for workers/projects views) | UI-102, UI-103 specs; core view-models | MOB-16, MOB-21. |
| F6 | Notifications (in-app feed; push) | DESIGNED | [V] API-CONTRACT 4.8-4.9 (`GET /v1/mobile/notifications`); [C] TECH-VERSIONS push rows "NOT in release 1" (prior audit) | MOB-22 (feed), MOB-27 (push), FA-MOB-15. |
| F7 | Remote approval (signed, single use) | DESIGNED, BLOCKED by approval-attestation hardening (AUD-015 [C], PT-035 [C]) | [V] APPROVAL-AND-STOP.md exists (272 lines) | MOB-23/24 after the approval fix. |
| F8 | STOP from the phone | DESIGNED | APPROVAL-AND-STOP.md section 5; UI-176 | MOB-25; FA-MOB-8. |
| F9 | RESUME from the phone | NOT_APPLICABLE (excluded by Founder decision per docs) | [C] APPROVAL-AND-STOP.md section 6 as cited by the prior audit; I did not re-read that section | none. |
| F10 | Voice drafts (on-device STT) | DESIGNED | UI-101, UI-179, UI-250; SC-9 | MOB-28; FA-MOB-16/17 (privacy). |
| F11 | Biometric lock / Keystore signing | DESIGNED | UI-174; ADR section 5 | MOB-20, MOB-24. |
| F12 | APK build / mobile CI / device lab | DESIGNED ("DESIGN ONLY / NOT ENABLED") | TEST-AND-BUILD.md; `.github/workflows/` has no mobile job [V] | MOB-13/14 (protected workflow), MOB-30/31, FA-MOB-13/20. |
| F13 | Release and distribution | DESIGNED | TEST-AND-BUILD.md section 9 (Founder-held signing key, sideload, no store) | MOB-30, FA-MOB-20. |

Counts for 13 features: DESIGNED 11 (F1-F3, F5-F8, F10-F13), CODED+TESTED(unit, local, not in CI) 1 (F4), NOT_APPLICABLE 1 (F9). INTEGRATED 0, VERIFIED_REAL_ENV 0, USABLE_BY_END_USER 0.

### 4.4 Mobile-specific risks and facts
- **Not CI-run** [V]: `config/validation.json` has 0 `apps/mobile` entries; the file is the single unregistered test file out of 124. `tsconfig.json` includes `apps/**/*.ts`, so the code is type-checked by the `typecheck` step [V]. The coordinator's local full-suite count of 124 files [C: `COORD-STATE.md`] equals the count that includes this file, so it probably ran there [E].
- **Unreachable by design today**: the Control API listens on 127.0.0.1 only; the phone has no network path to it; when the PC or app is off the design allows only a STALE cache (CONNECTIVITY-AND-PAIRING section 8 [C]).
- **Security preconditions**: 26 conditions PROPOSED only (AUD-052 [C]); `react-native.json` not certified [V]; approvals not yet single-use (AUD-015 [C]).
- **Prior-audit statement "Of the 13 features, 0 implemented"** is now off by one: F4 has a local unit-tested core, still not integrated.

---

## 5. Prioritised gaps (work needed)

| ID | Module | Pri | Gap | Evidence |
|---|---|---|---|---|
| G3-A-01 | A | P0 | The installed app can never run project code (`SANDBOX_UNAVAILABLE`); the idea-to-delivery loop cannot complete for a user. Needs a verified sandbox provider (Founder-tier #231 dirty, Windows aggregator FAIL on head) and its packaged wiring | `packaged-entry.ts:54`; G1/COORD-VERIFIED #231 |
| G3-A-02 | A | P1 | "Export delivery package" always fails (scrubber over-redacts the server path); fix in protected `main.mjs` plus a combined test | section 2.6 #1; `main.mjs:240,270,275,310` |
| G3-A-03 | A | P1 | No signed release: unsigned (`sign:false`), 0 releases, 0 tags, 30-day CI artifact only, no SBOM/provenance; needs Founder decision on certificate type/custody and a release workflow | releases/tags `[]`; `electron-builder.json:15`; workflow permissions |
| G3-A-04 | A | P1 | No record of a real run on a user machine for dev.3; wizard, shortcuts, default install dir, SmartScreen, upgrade/downgrade, delete-data never exercised; Founder-PC pilot pending | section 2.1 |
| G3-A-05 | A | P1 | No update path (no updater, upgrade never executed, no journal backup/rollback) | `electron-builder.json:9,16`; CI repair = same version |
| G3-A-06 | A | P1 | Real-Electron desktop E2E is not in CI and has never run on Windows (draft workflow not applied; #66 Founder-held) | `.github/workflows/`; `docs/authority-requests/LANE-A-win-e2e.md` |
| G3-A-07 | A | P1 | Single command field not built; `command-intake` core (PQ-011) unwired; needs route + protected allow-list + UI + tests | `core/mission/command-intake.ts`; grep |
| G3-A-08 | A | P2 | Smart revision absent (UI-015 PLANNED) | grep; screen audit [C] |
| G3-A-09 | A | P2 | Voice absent on desktop; media permission denied at shell level; needs privacy decision + protected main.mjs change | `main.mjs:363` |
| G3-A-10 | A | P2 | Packaged backend lifecycle: no restart, no crash/render-process-gone handlers, no IPC timeouts | `main.mjs:350` |
| G3-A-11 | A | P2 | Code integrity: no Electron fuses, `asar:false`, debug switches not refused, no DPAPI/safeStorage | `electron-builder.json:6`; grep |
| G3-A-12 | A | P2 | PATH not passed to the packaged backend; Claude CLI discovery in the installed app unproven | `main.mjs:21`; `tests/v7-b7-installer.test.ts:183`; `executor-setup.ts:30` |
| G3-A-13 | A | P2 | No real analysis or AI-builder run ever executed in a real environment (LOCAL_CLAUDE disabled in all tests) | `LANE-A-UI-011-EVIDENCE.md` [C] |
| G3-A-14 | A | P2 | Base-wide dependency-audit failure blocks all PRs incl. #292 (renderer) and #291 | COORD-VERIFIED 2026-11-02 |
| G3-A-15 | A | P2 | Ten routes (home, projects, work, workforce, assurance (mixed), delivery, tower, inbox, company, settings) have no renderer-to-real-server test; only fake-bridge renderer tests plus separate server-route tests | section 2.3 |
| G3-A-16 | A | P2 | No OS notifications, email, push or report export beyond the delivery ZIP | grep |
| G3-A-17 | A | P3 | Remote operation unsupported (remote repos, gateway); Company OS writes have no UI; torn-tail repair not reachable from the app (AUD-023) | section 3.2 |
| G3-A-18 | A | P3 | Local data at rest unencrypted, journal chain unkeyed; no BitLocker check (prior audit, not re-verified) | AUD-053/047 [C] |
| G3-F-01 | F | P1 | No mobile app: no React Native/Android project, no APK, no mobile CI; only a 548-line pure-TS core | section 4.1 |
| G3-F-02 | F | P1 | No `/v1/mobile/*` routes and no phone-reachable gateway; control plane is loopback-only | grep; `packaged-entry.ts` |
| G3-F-03 | F | P1 | 21 coding tasks MOB-11..31 are AUTHORITY_REQUIRED (17 protected); FA-MOB-1..23 Founder decisions open | BACKLOG_CHECKPOINT [V] |
| G3-F-04 | F | P1 | Remote approval/STOP depend on approval-attestation hardening (single-use, nonce, lifetime) | AUD-015 [C] |
| G3-F-05 | F | P2 | The mobile core test is the only test file not registered in CI; add it to a `config/validation.json` step (protected config) | scripted check [V] |
| G3-F-06 | F | P2 | Security conditions SC-1..26 PROPOSED; React Native not certified (0 of 15 facets) | `react-native.json` [V] |
| G3-F-07 | F | P3 | Voice, biometrics, push: design only; privacy and key-custody decisions | docs/mobile |

---

## 6. Unverifiable or not run (honest list)

- Any run of the app on a real user's Windows machine for dev.3, interactive wizard, shortcuts, SmartScreen, upgrade/downgrade, delete-data: NOT_RUN_ENV_UNAVAILABLE (no Windows host; no record).
- Real Electron journey on Windows and in CI: NOT_RUN_ENV_UNAVAILABLE. Linux real-Electron results are [C] from builder documents; I did not re-run them.
- Installer zip contents: not downloaded; the log lines and checksums are what I saw.
- Test suites: not executed (instruction). Test counts are static call-site counts [E]; the coordinator's full-suite figure (3,251 pass / 10 fail / 24 skip over 124 files, 7 failures identical on base and environment-only) is [C] from `COORD-STATE.md`.
- Whether Electron 44.9.3 is the current patch release: UNKNOWN.
- Effect of the missing PATH on Claude CLI discovery inside a packaged run: UNKNOWN.
- Approval-gateway policy (AUD-015), at-rest encryption (AUD-053), journal chain (AUD-047): not re-verified here.
- Founder decisions FA-MOB-1..23: no grant records found; I cannot prove none exists outside the repository.
