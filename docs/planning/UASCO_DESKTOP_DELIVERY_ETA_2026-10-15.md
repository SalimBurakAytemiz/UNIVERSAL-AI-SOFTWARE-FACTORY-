# UASCO Desktop delivery date / ETA analysis (2026-10-15)

- **Prepared:** 2026-10-15 ~04:30 TSİ (01:30Z).
- **Method:** measured data plus two independent read-only Opus estimators, one with a critical-path lens and one with a risk lens (workflow wf_5583018d-d40). The two lenses differ by at most ±3 h.
- **Data file:** `UASCO-recovery/product/eta2-measured-data.md`.
- **Development was not paused.** No merge, push, install or deploy was done.

> **Summary:**
> - **M0 (first installable, working .exe):** ~7–9 h left. P50 15 Oct 12:00 TSİ; most of the wait is the night and your real installation.
> - **M1 (first Desktop where you can develop real software):** ~1–1.5 days left. P50 16 Oct ~12:00 TSİ, P80 16 Oct ~22:00, P95 18 Oct.
> - **M2:** P50 ~31 Oct (low confidence).
> - **M3:** P50 UNKNOWN; realistic range Jan–Mar 2027.

---

## A) Current situation (verified)
- **Canonical repo:** `C:\Users\salim\Desktop\UASCO`.
  - Checkout: branch `v6/pkg-t4-…`, HEAD `217d42988d7b…` (old).
  - Local `master`: `312fb6d5e1ce…` (F10 chain merged, all governed reviews CLEAN).
  - `origin/master`: `061f78d…`. Nothing has been pushed.
- **Product work (Lane B):** sits in 4 separate lines of standalone clones under `C:\Users\salim\UASCO-wt\v2-*`, with 3 different starting points. **None of them is merged into the others yet.**

  | Line | Content | Status |
  |---|---|---|
  | **Desktop** | B4 shell → B5 work screens → B7 installer (`db0fb8d`) → PS-1B Project Studio UI | B4/B5/B7 CLEAN; PS-1B cycle 4 is being reviewed |
  | **Backend** | r2 (B1 Work OS, B2 cockpit, B9, B3A runner) → B3B live Claude mission → B3C security stage → PS-1A Project Studio backend | B3B/B3C CLEAN; PS-1A cycle 3 is being reviewed |
  | **Knowledge/registry** | B10A evidence → B11A Company OS → WFR-03 single role registry (`638c2d2`) → WFR-04a Skill Academy (`4577ed4`) | all CLEAN |
  | **Control Tower** | B6A 2D campus (`41232d8`) | CLEAN |

- **Desktop / packaging:**
  - Electron 44.4.5, obtained through the checksum-pinned `provision-electron.mjs`.
  - electron-builder **27.0.0-alpha.9**, an exact-pinned prerelease, because 26.x fails the npm audit.
  - NSIS installer, per-user, no admin rights. Build time is ~3 minutes.
  - The control API is compiled to JavaScript and started by the Electron main process with a token passed on stdin. User data lives in `%APPDATA%\UASCO`.
- **Existing .exe:** `UASCO-Setup-0.7.0-dev.1-win-x64.exe`, 110 MB, sha256 `302710d8…`, **unsigned**.
  - Tests in %TEMP% PASS: install, launch, `/health` VERIFIED, single instance, repair, uninstall, user data kept.
  - It **fails M0**: since B4, every IPC call breaks after hash navigation (the trustedSender bug), so every screen except the home page errors. The bug was found and fixed in PS-1B, but that fix is not in any installer yet.
  - Its backend is B1 only: no runner, Claude executor or Project Studio.
- **Engine-level proof:** in B3B, UASCO's own runner, using the real local Claude implementer and an independent Claude reviewer, took the task "implement add(a,b)" from AUTHORIZED to REPORTING/awaiting approval in **32 seconds**. Tests went from 1 to 0 failures and the review came back CLEAN.
- **Lane A (supervisor):**
  - SV1-2: governed CLEAN.
  - SV1-1 (`3492387`): independent review and step C in progress; governed freeze and review pending.
  - AS1: not started.
  - Supervisor: **off** (0 UASCO scheduled tasks).
  - **Effect on M0/M1: none.** Lane A is not on the first-Desktop path. It stays required for the persistent supervisor at M2.
- **Missing tools and permissions:**
  - There is no signing certificate (external).
  - Playwright, Newman, Appium and semgrep are not installed (each needs a tool-install approval).
  - The trivy vulnerability database is missing, so security coverage shows **PARTIAL**.
  - IObit UninstallMonitor uses ~1.9 cores continuously, so validation steps come close to the 600 s limit.

## B) M0: first installable .exe
- **Acceptance:**
  - You install the rebuilt unsigned .exe per-user, and it opens from the desktop shortcut with the sandbox on.
  - **Every** navigation route works without IPC errors.
  - The packaged backend (`/health` and the B1 API) is live.
  - Features that aren't there yet are shown honestly as UNAVAILABLE.
  - Uninstall is clean.
  - The independent review is tied to the artifact's sha256.
- **Remaining work:**
  1. PS-1B cycle 4 CLEAN (running).
  2. Rebuild the installer from the PS-1B tip (~3 min).
  3. %TEMP% install plus a walk through every route.
  4. Independent review of the artifact.
  5. **You** install it for real (and run a sandboxed launch from the real install directory).
- **Effort:** 0.8–1.7 agent-hours (3–4 h if the real-directory launch needs a fix). Everything else is waiting for you.
- **ETA:**

  | Scenario | Date (TSİ) |
  |---|---|
  | Optimistic | 15 Oct 10:15 |
  | Realistic | 15 Oct 10:45–14:15 |
  | Pessimistic | 15 Oct 18:00 – 16 Oct 14:00 |
  | **P50** | **15 Oct ~12:00** |
  | **P80** | **15 Oct ~16:00–17:00** |
  | **P95** | **16 Oct ~12:00–14:00** |

  **Confidence: medium.**
- **Blockers:** the PS-1B verdict; the night; the sandboxed real-directory launch, which has never been tried.

## C) M1: first usable Desktop (software factory)
- **Acceptance (PS-AT-001), all from the installed UASCO.exe:**
  - create a project (from a template or by import);
  - Claude implementer writes code;
  - the project's own tests run, plus gitleaks/trivy;
  - an independent Claude review is done;
  - you open a live preview;
  - you take the output as a ZIP with README and reports.

  In M1, "QA" means the project's test command plus the security stage. A Playwright/Appium lab is not part of M1.
- **Remaining work:**
  1. PS-1A cycle 3 CLEAN (security-critical, so a cycle 4 is about 40% likely).
  2. Merge tool cycle 4 CLEAN, then **your approval of a hash-pinned live merge**. Alternatively you run the merges manually (the F10 precedent took ~1.25 h).
  3. Merge the 4 lines into one tip. Expected conflicts are mechanical: validation.json, manifest, package-lock and CHANGELOG.
  4. Integration review, then full canonical validation (30–45 min).
  5. Rebuild the installer from the integrated tip, %TEMP% test, artifact review.
  6. Test LOCAL_CLAUDE in packaged mode: finding the CLI from a GUI launch, capturing provenance into userData, the enable flow. This has **never been run**; expect 1–2 fix cycles.
  7. You install it for real.
  8. Run PS-AT-001 end to end, and have the evidence reviewed.
  9. Any first-EXE P0 items that REL-WK-00 names (that crosswalk is still running, so the count is UNKNOWN).
- **Effort:** 7–9 agent-hours realistic (14–18 pessimistic). Critical-path wall time is 10–18 h. Token use is about 5–15M across 5–8 rounds.
- **ETA:**

  | Scenario | Date (TSİ) |
  |---|---|
  | Optimistic | 15 Oct 14:00–21:00 |
  | Realistic | 15 Oct 20:00 – 16 Oct 18:00 |
  | Pessimistic | 17 Oct 12:00 – 19 Oct 08:00 |
  | **P50** | **16 Oct ~03:00–12:00** |
  | **P80** | **16 Oct ~17:00–22:00** |
  | **P95** | **18 Oct ~14:00–20:00** |

  **Confidence: low–medium.** The open questions are merge-tool convergence, packaged-mode behaviour, the REL-P0 count and the weekly quota.
- **M0 versus M1:** M0 is only a working shell: navigation and a backend connection. M1 lets you build software inside it with an agent. M1 additionally needs the merge of the 4 lines, the runner, security, Project Studio, a working Claude executor in packaged mode, and the PS-AT-001 acceptance test.

## D) M2: operational Desktop
- **Scope:**
  - **Persistent supervisor:** SV1-1 freeze and governed review → AS1 → bridge-merge to local master → real tasks and a live drill.
  - **Desktop surfaces:** Knowledge/Project Memory UI, Operations/Recovery, Agent Fleet + the 599-registry UI, Company OS UI waves, Control Tower 3D.
  - **QA lab:** Playwright/Newman, which needs tool-install approval.
  - **Delivery:** B8 CI release workflow, push.
  - **Reliability:** P0/P1 reliability gates (REL-WK-01..06).
  - **Installer:** upgrade/repair tests.
  - **Signing:** external.
- **Effort:** ~50–150 agent-hours, spread over parallel lanes.
- **ETA:**

  | Scenario | Date |
  |---|---|
  | Optimistic | ~21–22 Oct |
  | Realistic | 26 Oct – 6 Nov |
  | Pessimistic | 20 Nov – 10 Dec |
  | **P50** | **~31 Oct** (low confidence) |
  | **P80** | **~10–12 Nov** (very low confidence) |
  | **P95** | **UNKNOWN**: the REL backlog size, the operational acceptance threshold, the weekly quota and the signing lead time are not measured |

## E) M3: full target (216 topics + 599 roles)
- **Optimistic:** ~6–7 weeks (~26 Nov – 1 Dec).
- **Realistic:** 2.5–5 months (Jan–Mar 2027).
- **Pessimistic:** 6–9+ months.
- **P50/P80/P95: UNKNOWN.** Not a single eval has been run yet (0 of 3,594), so the per-eval cost and the token use are unmeasured, and the weekly quota is unknown. Some items are blocked externally and cannot be closed by time alone: mobile devices, macOS/Linux hosts, the signing certificate, regulated-domain certification, and the missing 599-role blueprint archive. The first measurement will come from the 27-role pilot.

## F) Critical path and dependency graph
```
M0:  PS-1B c4 review ─► installer rebuild (PS-1B tip) ─► %TEMP% install + route walk ─► artifact review ─► [FOUNDER] real install
M1:  PS-1A c3/c4 review ─┐
     PS-1B c4 review ────┤
     merge tool c4 review ─► [FOUNDER] live-merge approval / manual merge ─► 4-line integration ─► integration review ─► full validation
                                                                           ─► installer rebuild ─► packaged LOCAL_CLAUDE test + fixes
                                                                           ─► [FOUNDER] real install ─► PS-AT-001 E2E ─► evidence review
     (in parallel: REL-WK-00 first-EXE P0 list → any P0 packages are added onto this path)
M2:  M1 ─► Lane A (SV1-1 freeze/governed → AS1 → bridge → bootstrap+drill) ║ B8 CI ║ QA lab ║ UI waves ║ REL-WK-01..06 ║ signing (external)
M3:  M2 ─► WFR-04b..12 (eval infrastructure → 27-role pilot → 3,594 evals) ║ REA-WK-02..09 ║ remaining REL/TEK topics
```

## G) Actual development speed over the last 7/14 days
- **Product line (v7) commits:** 0 before 14 Oct; 11 on 14 Oct; 21 so far on 15 Oct. Lane A (v6): 7 on 12 Oct, 37 on 13 Oct, 26 on 14 Oct. The older peak on 10-06/07 (226 + 56 commits) was the V6 era, before the Windows reinstall.
- **Agent measurements:**
  - Implementation: n=31, p50 14.2 min, p80 30.7 min.
  - Independent review: n=28, p50 5.8 min, p80 9.4 min.
  - **15 of 28 reviews came back BLOCKED.** The average is ~1.8 cycles to CLEAN, and 2–3 cycles for security-critical packages.
- **Throughput:** about **15 product packages reviewed CLEAN in ~7 hours**, with 2–5 agents in parallel. Sustained, that's about 8–12 packages per day.
- **Serial bottlenecks:**
  - full validation: 26–30 min (45 min under load);
  - governed freeze: 32 min;
  - governed review: 10 min.

## H) Reasons for the delay and the plan to speed up delivery
**Why there's no usable .exe yet:**
1. Product work was built in 4 separate clone lines and hasn't been merged. The LLM integrator was denied by the classifier, and the deterministic merge tool came back BLOCKED in cycles 1–3. That's the right outcome for security, but it took time.
2. The installer went CLEAN only at ~02:54 today, and the routing bug was found after that.
3. A real install and any live-merge approval need you.
4. Agent capacity was partly spent on work that isn't on the Desktop path: WFR, REA, REL and SV1-1.

**Speed-up plan:**
- No scope is removed. Security gates and independent review are unchanged; only the order changes.
- M0 is decoupled from integration.
- Overnight work is staged ahead (rehearsals and spikes).
- Your approvals go into a single morning packet.
- CPU and agent capacity move to the M1 path.

## I) Open blockers
| P | Item | Effect |
|---|---|---|
| P0 | Lines not merged (merge tool c4 verdict + your approval) | M1 |
| P0 | Existing .exe has the trustedSender bug; the rebuild waits on PS-1B c4 | M0 |
| P1 | PS-1A c3 security review (cross-tenant / 8.3 alias history) | M1 |
| P1 | Packaged-mode LOCAL_CLAUDE and the real-directory sandboxed launch never tested | M0/M1 |
| P1 | REL-WK-00 first-EXE P0 list not yet out | M1 (unknown) |
| P2 | WFR-03 validator needs a protected-paths authorization | M2 |
| P2 | IObit load (validation steps near 600 s); trivy DB missing (security PARTIAL); Playwright etc. not installed | M1 quality / M2 |
| P3 | Unsigned installer (SmartScreen warning); certificate is external | release |

## J) Concrete delivery targets for the next 7 days
| Day | Target |
|---|---|
| 15 Oct | M0: the rebuilt .exe is installed on your computer and every screen opens. Merge-tool decision. 4-line integration + full validation. |
| 16 Oct | M1: the integrated .exe; Claude develops code in packaged mode; PS-AT-001 E2E with evidence. |
| 17 Oct | M1 fixes, if needed. REL-WK-00 P0 packages. SV1-1 governed freeze + review (on a quiet machine). |
| 18–19 Oct | AS1 + bridge-merge rehearsal. B8 CI release workflow (draft). Playwright/QA-lab tool-install approval package. |
| 20–21 Oct | Supervisor live drill (with your approval). Knowledge/Operations UI waves begin. WFR-04b eval infrastructure. |

## K) Earliest possible date for the first .exe, and why
- **Earliest realistic: 15 Oct ~10:15–12:00 TSİ (P50 12:00).**
- The agent side can be ready by about 05:15–07:15. The rest is your night's sleep and the installation itself, which only you can do.
- If PS-1B cycle 4 is CLEAN, this date holds. If it needs one more cycle, or the real-directory launch needs a fix, it slips to 15 Oct evening or 16 Oct.

---

### The 5 most important concrete items blocking delivery today
1. The merge tool's cycle-4 independent review, then your hash-pinned live-merge approval (or manual merges). Without it the 4 lines stay separate.
2. The PS-1B cycle-4 review verdict. The rebuilt, correct .exe waits on it.
3. The PS-1A cycle-3 security review. It must be CLEAN before integration.
4. The packaged-mode Claude executor and the real-directory sandboxed launch have never been tested.
5. The steps only you can take (real install, merge approval), on top of the night pause and classifier stalls.

### The 5 most effective changes to speed up delivery
1. **Decouple M0:** build and test the .exe from the PS-1B tip as soon as it's CLEAN, so in the morning you only install it.
2. **Single morning approval packet:** a hash-pinned live-merge approval (or a ready manual merge script), the real install command, the SV1-1 freeze window, and the pending protected-paths authorization, all in one session.
3. **Overnight integration rehearsal:** merge the 4 lines in a %TEMP% clean clone without any live writes, resolve the conflicts in advance, and run the 30-minute validation ahead of time.
4. **Front-load the riskiest unknown:** a %TEMP% spike for the packaged-mode Claude executor and the sandboxed launch.
5. **Move capacity and CPU to the Desktop path:** don't start new WFR-04b, REA-WK-02 or the SV1-1 governed freeze until M1. If you can pause IObit UninstallMonitor during validation, the 600 s timeout risk goes away.
