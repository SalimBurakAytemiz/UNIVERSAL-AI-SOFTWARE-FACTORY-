<!-- //TR: Founder'in PR #49 icin verdigi IKINCI tek seferlik, dar kapsamli korunan-dosya yetkisinin kaydi (FD-PUBLIC-CI-2026-10-19-B). Yalniz uc korunan dosya + trust-root manifest reseal; yalniz PR #49; onceki FD-PUBLIC-CI-2026-10-19 kayitindaki 9 kosul aynen gecerlidir. Kesin degisiklikler apply-fd-public-ci-b.mjs icindedir. -->

# Authority record: FD-PUBLIC-CI-2026-10-19-B

- **Granted by:** the Founder on 2026-10-19, in builder session `session_01DmTHw4gBA3wvY1tKM9bk2e`. The grant was the answer to an explicit authority question: "Evet, 3 dosya + manifest (Önerilen)".
- **Scope:** one time, **PR #49 only**, not transferable.
- **Files allowed to change (only these):**
  - `scripts/build-release-zip.mjs`
  - `scripts/verify-release-extract.mjs`
  - `scripts/bootstrap-uasco-autonomy.ps1`
  - `config/trust-root-manifest.json` (reseal; exactly these 3 `sha256` values plus `generatedAt` may change)
- **Conditions:** all 9 conditions of `AUTHORITY-FD-PUBLIC-CI-2026-10-19.md` apply unchanged:
  - a separate maintainer session applies the change;
  - a separate Opus reviewer reviews the full diff and the seal;
  - no merge without real Windows and Linux CI PASS;
  - no sensitive logs in public artifacts;
  - no other protected file is touched.

## Why: diagnosed pre-existing failures, all hidden behind the old 600 s timeout
1. **Linux hang in `tests-2`.**
   - **Cause:** `scripts/build-release-zip.mjs` `fail()` calls `process.exit(1)` right after heavy file hashing. The process then deadlocks in Node 24 shutdown.
   - **Evidence:**
     - The stuck process has 3 threads. The main thread is in `futex(FUTEX_WAIT_BITSET, <tid of V8Worker>)`, which is a `pthread_join`. The V8 platform worker is parked on its condition variable.
     - Repro on `ci/diagnose-shards`: the stall occurs only when the full shard 1 ran before `tests-2`, intermittently (2 of 8 runs; it occurred in every pre-#49 Linux run).
     - A/B with an unprotected copy that ends via `process.exitCode` + natural exit: **0 of 16** stalls.
   - **Fix:** `fail()` sets `exitCode=1` and throws `ReleaseFail`; the body runs inside `main()` with a top-level catch. The exit code and messages are unchanged.
2. **Windows `PSModulePath` inheritance**, which affects `pkg-r1`, BS1 shards a/c/d/e/f and a T4 scenario.
   - **Cause:** GitHub runs Windows steps in pwsh 7, which prepends PS7 module folders to `PSModulePath`. Every Windows PowerShell 5.1 child then cannot load its in-box `Microsoft.PowerShell.Utility`/`Archive`, so `Get-FileHash` and `Expand-Archive` are "not recognized".
   - **This is a product bug:** the same failure happens when the Founder starts UASCO from pwsh 7. The repo had no `PSModulePath` handling.
   - **Fix:**
     - `verify-release-extract.mjs` gives its 5.1 children an environment without `PSModulePath`, so 5.1 builds its own default.
     - `bootstrap-uasco-autonomy.ps1` restores the 5.1 default module path at start, in Desktop edition only.
     - The unprotected `verify-artifact.ps1` gets the same restore in the builder's non-protected commit.

## Application
Run `node docs/cloud-production/ci/public-ci/apply-fd-public-ci-b.mjs --i-am-the-maintainer`. Every anchor must occur exactly once, otherwise nothing is written. Then run `node scripts/generate-trust-root.mjs` and verify the manifest diff: exactly 3 `sha256` values plus `generatedAt`, else revert and STOP. Dry run on scratch copies: anchors matched, `node --check` OK, the pwsh parser reports 0 errors for the `.ps1`, and the failure path still exits 1 with the same message.
