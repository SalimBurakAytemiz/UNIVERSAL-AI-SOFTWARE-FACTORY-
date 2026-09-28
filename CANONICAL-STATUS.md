<!-- //TR: Bu dosya recovery baseline üzerinde yeniden kurulan V6 canonical candidate'ın gerçek source/audit durumunu final seal ve target-machine doğrulamasından ayrı olarak sabitler. -->
# Canonical Status — V6 Audit/Remediation Candidate

## Current authority

Bu çalışma ağacı doğrulanmış recovery baseline üzerinde V6 düzeltmelerinin fiziksel olarak yeniden uygulanıp bounded regression/checkpoint'lerle kanıtlandığı **construction/control repository candidate** durumundadır.

Bu dosya `IMPLEMENTED`, `CERTIFIED`, installation-ready, runtime-ready veya production-ready anlamına gelmez.

`SPECIFICATION != IMPLEMENTATION != TEST != EVIDENCE != RUNTIME_VERIFICATION != PRODUCTION_VERIFICATION`

`REGISTERED != KNOWN != SKILLED != CERTIFIED != CURRENT != AUTHORIZED != VERIFIED`

## Current source facts

- Phase contract: 149 (`Phase 0 + Phase 1..148`).
- Coherent review package: 34 (`Phase 1..148`); Phase 0 ayrı bootstrap/trust gate.
- Delivery tiers: 14 CORE / 2 HIGH / 18 MEDIUM.
- Paste 1: `COMPLETE_SOURCE`.
- Paste 2: `COMPLETE_SOURCE_ENVIRONMENT_GATES_PENDING` (34/34 source control).
- Paste 3: `COMPLETE_SOURCE` (15/15 source control).
- Paste 4A: `COMPLETE_SOURCE`.
- Paste 4B: `COMPLETE_SOURCE`.
- Paste 4C: `COMPLETE_SOURCE`.
- Paste 4D: `COMPLETE_SOURCE`.
- Paste 4 overall: `COMPLETE_SOURCE`.
- Repo-wide config/runtime enforcement sweep: `COMPLETE_SOURCE`.
- Full dependency-free source regression: `PASS`.
- Dependency-aware environment gate (`DEPENDENCY_AWARE_ENVIRONMENT_GATE_REVIEWED_LOCK`): `PASS` on the target Windows machine (win32 10.0.19045 x64, Node v24.19.0, npm 11.17.0). Canonical validation 34/34 PASS including runtime schema conformance (Ajv 2020-12), dependency supply-chain with `npm audit` (0 findings), release supply-chain/SBOM-lite, TypeScript typecheck and Vitest.
- Reviewed lock: `package-lock.json` (sha256 `96c4bc98998dae6a2d2f18396b4eeb129db68b8364039496c02086673a2cd2c4`), 188 entries, registry.npmjs.org only, sha512 integrity, no lifecycle scripts executed.
- Dependency-aware package findings closed: PKGA-F1..F10, PKGC-F1, F-PKGE-001, PKGE-F2, TRUST-F1, PKGR-F1, F-PKGR1-001. Durable LOW backlog: F-PKGE-002 (P3, unused manifest `exeSha256`), F-PKGR-001 (P3, `validate-paste2-closure.mjs` prints a literal `finalTrustRootSeal` report value).
- First target-machine Phase0 attempt (signed ZIP of `f0a4f0a`, `C:\UASCO`, install `INSTALL-1790622848674`): stopped at bootstrap because the canonical validation failed inside `install.ps1`; nothing was pushed. Found and closed by `V6-PKG-R3-PHASE0-FIXES-AND-RESEAL` (Founder-approved): PHASE0-F1 (P1) `validate-runtime-contracts.mjs` fixture inherited the installer's `UASCO_INSTALL_ID` and now isolates it while still asserting that an env/ledger mismatch is rejected; PHASE0-F2 (P2) `install-report.mjs` lacked the `node:crypto` import; PHASE0-F3 (P1) the builder policy `dontAsk` mode denied every edit, so the builder boundary smoke could never pass and the builder could not work. The policy now uses `acceptEdits` for edits inside the working directory only, with the tool set still limited to Read/Edit/Write/Glob/Grep and Bash, web, subagents, notebooks, skills and MCP denied; a read or write outside the working directory is refused by the tool permission. The `f0a4f0a` ZIP and its signature are superseded; the new ZIP needs a new Founder signature.
- Open P0/P1/P2 findings: 0 (`ZERO_OPEN_P0P1P2_PENDING_PACKAGING_SIGNATURE_AND_TARGET_PHASE0`). This is not source-level closure; packaging, the Founder signature and target-machine Phase0 remain.
- `PKGR-F1` closed by `V6-PKG-R1-RELEASE-MODE-AND-PACKAGING-TOOLS` (Founder decision: sealed mode): `install.ps1` runs the canonical validation inside the extracted artifact, and the doc-truth validators rejected every sealed release. The mode now follows `config/trust-root-manifest.json` `sealStatus`: pre-seal rules are unchanged; in `SEALED` mode the trust root is re-verified in-process, `SHA256SUMS.txt` must be bound to the sealed manifest, a release signature may not exist anywhere in the tree, and the final values below never say PASS. Unknown seal status fails.
- `TRUST-F1` closed by `V6-PKG-F-PROTECT-VALIDATION-SCRIPTS` (Founder decision: exact path list + rule): the 28 canonical validation scripts that were unprotected are listed as exact paths in `config/protected-paths.json`, `matchesPrefix` keeps its directory semantics, and `scripts/validate-mechanical-closure.mjs` fails with `validation-script-not-protected:` if any canonical validation script is not protected.
- `PKGA-F8` closed: `V6-PKG-G-PREFLIGHT-PHYSICAL-MEMORY` makes preflight measure installed physical RAM on Windows (`Win32_PhysicalMemory`, used only when numeric and not below `os.totalmem()`; the 16 GB threshold is unchanged), and the Founder started the Windows Time service. Target preflight: `PASS` (memory 16.00 GB physical, `w32tm /query /status` PASS).

## Independent review

Codex (OpenAI, separate from the Anthropic builder) reviewed each package against a frozen milestone contract and review bundle, invoked by the orchestrator through a read-only process boundary; results are schema-validated and governed with the supervisor rules.

- `V6-PKG-A-DEPENDENCY-REVIEWED-LOCK` @ `3ed8533`: `CLEAN`.
- `V6-PKG-C-LF-AND-ELECTRON-SMOKE` @ `2eae284`: `CLEAN`.
- `V6-PKG-D-STANDALONE-LAUNCHER-PROVENANCE` @ `8315b9a`: cycle 1 `ENVIRONMENT_BLOCKED` (missing validation-environment evidence, remediated), cycle 2 `CLEAN`.
- `V6-PKG-E-ELECTRON-PROVISIONING` @ `baa2532`: cycle 1 `BLOCKED` (F-PKGE-001 archive-to-executable binding, remediated), cycle 2 `CLEAN`; first reviews through the canonical `scripts/codex-reviewer-broker.mjs`.
- `V6-PKG-E2-TR-SCAN-SKIPS-MACHINE-CACHE` @ `492ea21`: `CLEAN`.
- `V6-PKG-B-CURRENT-TRUTH-SYNC` @ `646ee76`: `CLEAN`.
- `V6-PKG-F-PROTECT-VALIDATION-SCRIPTS` @ `5fa231b`: first output `REJECTED` (reviewer JSON failed the schema), two reviewer-quota `ENVIRONMENT_BLOCKED` attempts that consumed no cycle, then the single format-correction retry `CLEAN`.
- `V6-PKG-G-PREFLIGHT-PHYSICAL-MEMORY` @ `a82c6f4`: `CLEAN`.
- `V6-PKG-H-CURRENT-TRUTH-CORRECTION` @ `eaed1bd`: `CLEAN`.
- `V6-PKG-R1-RELEASE-MODE-AND-PACKAGING-TOOLS` @ `89bc44c`: cycle 1 `BLOCKED` (F-PKGR1-001 nested release signature, remediated); @ `a7ed306`: cycle 2 `CLEAN`.
- `V6-PKG-R2-RELEASE-CANDIDATE-RESEAL` @ `f0a4f0a`: `CLEAN` (superseded release candidate).
- `V6-PKG-R3-PHASE0-FIXES-AND-RESEAL` @ `ca21e83`: release candidate (fixes plus reseal); independent review pending (reviewer quota).
- `V6-PKG-X1-DUAL-EXECUTION-FABRIC`: this commit on its own branch on top of `ca21e83`; reviewed after PKG-R3; merge held until the `ca21e83` release completes target-machine Phase0 (Founder decision), so the release candidate is not disturbed.

Review records live in `audit/reviews/`. They are unsigned because the Phase0 evidence signing key is not initialized yet.

## Execution backends

`V6-PKG-X1-DUAL-EXECUTION-FABRIC` adds a dual execution fabric (`docs/architecture/EXECUTION-BACKENDS.md`). There are two backends: `LOCAL_CLAUDE`, the existing path, and `CLAUDE_CLOUD_SESSION`. The routing mode defaults to `AUTO`.

- Host-bound work stays local: ACL, Task Scheduler, Phase0, install validation, hardware, local credentials and devices, evidence keys, release packaging.
- Release signing with the private key is Founder-only.
- Signing keys and local credentials are never cloud inputs.
- Cloud work goes to isolated run branches and passes the same validation, evidence, independent Codex review and merge gate.
- The cloud dispatch is `NOT_CONFIGURED` until a documented Claude product method exists and is approved. Until then, work routes to `LOCAL_CLAUDE` or is queued, and cloud execution is never claimed.

## Environment/runtime gates

Sıradaki gate: `RELEASE_PACKAGING_SIGNATURE_THEN_TARGET_MACHINE_PHASE0`.

Sıra: final trust-root reseal (this release-candidate commit) -> export exactly this commit with `git archive` -> `scripts/release-sha256sums.mjs` -> `scripts/build-release-zip.mjs` (deterministic) -> `scripts/verify-release-extract.mjs --with-validation` on a fresh extract -> Founder detached signature over the verified ZIP and its `SHA256SUMS.txt` with the Founder's external key -> `scripts/install.ps1` target-machine Phase0 on a fresh extract of the signed ZIP. `install.ps1` starts with `verify-artifact.ps1`, which requires `SHA256SUMS.txt`, so Phase0 cannot run before packaging. The trust root is sealed in this commit; any later change to a protected file needs a new reseal and review before packaging.

- runtime schema conformance: `PASS`
- release supply-chain: `PASS`
- TypeScript/Vitest dependency-aware validation: `PASS`
- provider provenance on this machine: `PASS` (Claude and Codex `STANDALONE_LAUNCHER`)
- Desktop / Control Tower smoke on this machine: `PASS` (Electron binary provisioned by the explicit checksum-verified step)
- live provider smoke: `PASS` (2026-09-28, `scripts/provider-smoke.mjs` through `claude-builder-broker.mjs` and `codex-reviewer-broker.mjs`, both `STANDALONE_LAUNCHER`; report hash recorded in the PKG-H checkpoint; not Phase0 acceptance)
- target preflight: `PASS` (after PKG-G and the Windows Time service start)
- target Windows Phase0: `PENDING`

## Closure truth

`SOURCE_LEVEL_CLOSURE = FALSE`

`FINAL_TRUST_ROOT_SEAL = SEALED_RELEASE_CANDIDATE`

`FINAL_SHA256SUMS = PACKAGING_STAGE_OUTSIDE_GIT`

`FINAL_RELEASE_AUTHENTICITY = EXTERNAL_DETACHED_SIGNATURE_REQUIRED`

`FINAL_ZIP = PACKAGING_STAGE_OUTSIDE_GIT`

`TARGET_MACHINE_PHASE0 = PENDING`

Source/static PASS yalnız ilgili bounded validator'ın kanıtıdır; target-machine veya production verification yerine geçmez.
