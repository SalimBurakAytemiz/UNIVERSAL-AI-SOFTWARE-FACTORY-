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
- `V6-PKG-R2-RELEASE-CANDIDATE-RESEAL`: this release-candidate commit; reviewed after it is committed.

Review records live in `audit/reviews/`. They are unsigned because the Phase0 evidence signing key is not initialized yet.

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
