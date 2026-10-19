<!-- //TR: Founder'in PR #49 icin verdigi UCUNCU tek seferlik, dar kapsamli korunan-dosya yetkisinin kaydi (FD-PUBLIC-CI-2026-10-19-C). Yalniz scripts/liveness-selftest.mjs 101. satir fikstur degisikligi + o dosyanin manifest hash'inin yenilenmesi; yalniz PR #49; FD-PUBLIC-CI-2026-10-19 kaydindaki 9 kosul aynen gecerlidir. Kesin degisiklik apply-fd-public-ci-c.mjs icindedir. -->

# Authority record: FD-PUBLIC-CI-2026-10-19-C

- **Granted by:** the Founder on 2026-10-19, in builder session `session_01DmTHw4gBA3wvY1tKM9bk2e`. The grant was the answer to an explicit authority question: "Evet, yetki C (Önerilen)". The question stated that the maintainer session needs the Founder to state this authority there directly; a builder relay is not authority.
- **Scope:** one time, **PR #49 only**, not transferable.
- **Files allowed to change (only these):**
  - `scripts/liveness-selftest.mjs`, **line 101 only** (one fixture value);
  - `config/trust-root-manifest.json` (reseal; exactly the `sha256` of `scripts/liveness-selftest.mjs` plus `generatedAt` may change).
- **Conditions:** all 9 conditions of `AUTHORITY-FD-PUBLIC-CI-2026-10-19.md` apply unchanged:
  - a separate maintainer session applies the change;
  - a separate Opus reviewer reviews the full diff and the seal;
  - no merge without real Windows and Linux CI PASS;
  - no sensitive logs in public artifacts;
  - no other protected file is touched.
- **Product code:** unchanged. `scripts/uasco-liveness.mjs` and `scripts/uasco-supervisor-watchdog.mjs` are not touched.

## Why: a Windows PID-reuse fixture race, intermittent on GitHub-hosted runners
After the BS1 fix (1410c3b), Windows CI passes 47 of 48 validation steps. The only failure is `tests-lv1`, `LIVENESS_SELFTEST: FAIL 21/22`, in scenario `watchdog-stops-when-its-task-is-disabled-before-or-during-a-recovery`, case d. The watchdog returned `UPGRADE_IN_PROGRESS` with `starts:1, stops:0`.

- **Cause:**
  - Case d writes a "dead bootstrap" upgrade marker. It uses the PID of a just-exited `node -e` (line 95) with `startedAt = now` (line 101).
  - The scenario's four parallel worlds then start many processes. On Windows, one of them can be given that freed PID.
  - `upgradeMarkerState` then sees a live owner. Its creation time falls inside the 5 s owner-creation tolerance (`created > started+5000` ⇒ `PID_REUSED`), so the marker is classified LIVE, and the watchdog correctly defers (`UPGRADE_IN_PROGRESS`).
  - The old self-hosted desktop did not show this, because other processes took the freed PID first.
- **Evidence (diagnosis-only branch `ci/diagnose-elevation` @4812093, never merged, `windows-latest`):**
  - Unchanged selftest: run 1 FAIL 21/22 (same scenario), run 2 PASS 22/22. Counting PR #49 run 39218763275, it failed 2 of 3 times.
  - Diagnostic copy with only line 101 changed to `startedAt: past(1)`: PASS 22/22 in 3 of 3 runs.
  - The post-validation `bootstrap-kernel-selftest.mjs` passes.
- **Fix:** line 101 sets the dead marker's `startedAt` to `past(1)`, one minute ago. This is realistic, because a bootstrap writes its marker after it starts. Any process that reuses the PID is then created more than 5 s after the marker and is classified `PID_REUSED` (STALE). A dead PID that is not reused stays `BOOTSTRAP_EXITED` (STALE), as before. The scenario's assertions are unchanged.

## Application
Run `node docs/cloud-production/ci/public-ci/apply-fd-public-ci-c.mjs --i-am-the-maintainer`. The anchor must occur exactly once, and exactly line 101 must change; otherwise nothing is written.

Then run `node scripts/generate-trust-root.mjs` and verify the manifest diff. It must be exactly the `scripts/liveness-selftest.mjs` `sha256` plus `generatedAt`; otherwise revert and STOP.

Also run `node --check scripts/liveness-selftest.mjs` and `node scripts/verify-trust-root.mjs`.
