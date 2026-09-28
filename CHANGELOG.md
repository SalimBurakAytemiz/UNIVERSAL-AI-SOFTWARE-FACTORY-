<!-- //TR: Bu dosya V3 mekanik closure ve re-audit düzeltmelerini geçmiş sürümlerden ayrıştırarak kaydeder. -->
# Changelog

## 2026-09-29 — V6 Dual Execution Fabric (branch, merge held)

- Execution backend registry (`config/execution-backends.json`) with `LOCAL_CLAUDE` and `CLAUDE_CLOUD_SESSION` and routing modes `AUTO` (default), `LOCAL_ONLY`, `CLOUD_PREFERRED`, `CLOUD_ONLY`.
- Fail-closed routing engine (`automation/lib/execution-routing.mjs`): host-bound work stays local, private-key release signing is Founder-only, unknown availability counts as unavailable, fallback only where policy allows, otherwise queued; no invented billing or credit API.
- The supervisor routes before the builder, records execution provenance and runs a merge gate (independent non-producer CLEAN review, isolated branch) before every fast-forward merge.
- Cloud dispatch stays `NOT_CONFIGURED` until a documented Claude product method is approved; cloud execution is never faked.

## 2026-09-28 — V6 Phase0 Attempt 1 Fixes

- The first target-machine Phase0 attempt stopped at bootstrap; nothing was pushed.
- `validate-runtime-contracts.mjs` isolates its fixture from the installer's `UASCO_INSTALL_ID` and still asserts that an env/ledger mismatch is rejected.
- `install-report.mjs` imports `node:crypto`, so `INSTALL_REPORT.json` is written.
- The builder policy uses `acceptEdits` for edits inside the working directory only; the tool set stays Read/Edit/Write/Glob/Grep and shell, web, subagents and MCP stay denied.
- New reseal and release candidate; the previous ZIP and signature are superseded.

## 2026-09-28 — V6 Sealed Release Candidate

- PKGR-F1: the doc-truth validators rejected every sealed release although `install.ps1` validates inside the extract; they now follow the trust-root seal status with a fail-closed `SEALED` release-candidate mode (in-process trust-root re-verification, `SHA256SUMS.txt` bound to the sealed manifest, no signature anywhere in the tree, no PASS values).
- Protected release tools: `release-sha256sums.mjs`, deterministic `build-release-zip.mjs` and `verify-release-extract.mjs` (Windows Expand-Archive, unchanged artifact verifiers, optional reviewed-lock install and canonical validation in the fresh extract).
- Final trust-root reseal in the release-candidate commit. Next: SHA256SUMS, ZIP, fresh-extract verification, Founder signature, target-machine Phase0.

## 2026-09-28 — V6 Target-Machine Phase0 Prerequisites

- Every canonical validation script is protected by exact path in `config/protected-paths.json`, and mechanical closure fails if one is not (TRUST-F1).
- Windows preflight measures installed physical RAM (`Win32_PhysicalMemory`) with the 16 GB threshold unchanged; with the Windows Time service running, target preflight PASS (PKGA-F8).
- Live provider smoke PASS through the Claude builder and Codex reviewer brokers.
- Open P0/P1/P2 findings: 0. Next: final reseal, SHA256SUMS, external signature, final ZIP, fresh-extract verification, then target-machine Phase0.

## 2026-09-28 — V6 Dependency-Aware Environment Gate

- Reviewed `package-lock.json` generated on Node 24.19.0 / npm 11.17.0; pins corrected (typescript 5.9.0 did not exist) and bumped to clear all moderate+ advisories; `npm audit` 0 findings.
- Windows `npm.cmd` EINVAL fixed with a shell-free node + bundled npm-cli.js invocation; missing `.d.mts` declarations and Ajv NodeNext interop fixed; canonical validation 34/34 PASS on the target machine.
- Release supply-chain accepts only host-excluded, lock-optional platform packages with integrity, registry and license evidence.
- `.gitattributes` pins LF so Windows `autocrlf` clones keep committed digests; Electron smokes launch shell-free.
- Provider provenance accepts verified `STANDALONE_LAUNCHER` installs; the canonical Codex reviewer broker now runs on this machine.
- Explicit checksum-verified Electron provisioning step: the binary is bound file by file to the archive pinned by the locked `checksums.json`; Desktop and Control Tower smokes PASS.
- The `//TR` source scan skips the gitignored `.ai/cache/` machine cache.
- Every package was reviewed independently by Codex through a frozen milestone contract and review bundle; records are in `audit/reviews/`.

## 2026-09-20 — V3 Mechanically Closed / Re-Audited

- V2 re-audit P0 bulguları source starter seviyesinde kapatıldı.
- Builder tool-policy sandbox + boundary canary, Action Broker, Git metadata guard, per-worktree dependency tree, package lifecycle guard eklendi/sertleştirildi.
- Codex prior-blocker omission, moving-goalpost causal proof, stable finding fingerprint, accepted-debt/waiver ledger ve governed signed attestation eklendi.
- V3 re-auditte bulunan yeni bypass kapatıldı: current BLOCKER yalnız `OPEN` olabilir; aynı cycle içinde `RESOLVED/DOWNGRADED/DUPLICATE` ile CLEAN üretilemez.
- 258/258 technical agent primary technology mapping taşıyor; 363-role semantic validator genişletildi.
- 22 physical domain pack seed profile eklendi.
- Technology universe 415, depth assignments 6114, schema 152.
- Evidence key Windows ACL hardening, provider-specific env policy, exact launcher provenance, filesystem boundary, secret/supply-chain baseline ve remote protection refresh eklendi.
- Source re-audit sonucu: yeni source-level P0 mekanik blocker bulunmadı; target-machine Phase0 hâlâ zorunlu.

## 2026-09-20 — Mechanically-Closed V2

- 149 phase contract'ın generic deliverable/validation/evidence/review/exit alanları phase-specific hale getirildi.
- One-click installer step ledger + INSTALL_REPORT eklendi.
- Control API/Control Tower install state ve package retry görünürlüğü eklendi.
- Dependency-free mechanical kernel self-test canonical validation zincirine eklendi.
- Phase0 acceptance mechanical self-test, review-package scheduler ve install ledger'i fail-closed kontrol ediyor.
- Mechanical closure validator install/report/selftest/review-package wiring'i çapraz doğruluyor.
- Latest mechanical red-team audit + fix ledger + Installation GO checklist canonical artifact'e eklendi.


## 2026-09-20 — Full Woven Canonical Starter

- 363 stable agent korunuyor.
- 363 canonical V2 agent genome yeniden üretildi.
- 363 agent evaluation contract oluşturuldu.
- 40 department technical charter oluşturuldu.
- 425 gerçek engineering/business skill içeren V2 skill ontology oluşturuldu.
- 393 seed technology profile içeren Technology Knowledge Graph oluşturuldu.
- Her teknoloji için ayrı knowledge-unit contract dosyası oluşturuldu.
- 194 tool/provider adapter kayıtlı.
- Multi-pack competency model eklendi.
- 12 eksenli agent↔technology depth modeli eklendi.
- Specialist→Lead→Principal→Head→Council→Independent review graph eklendi.
- Dynamic Unknown Technology Discovery lifecycle eklendi.
- 149 roadmap phase'ın tamamına entry/deliverable/test/evidence/review/exit contract eklendi.
- Schema baseline strict `additionalProperties:false` hale getirildi; toplam 141 schema.
- Role semantic validator eklendi.
- Woven model validator eklendi.
- Flutter/React Native/iOS generic Android inheritance hataları canonical V2 matrix'te kaldırıldı.
- Action Gateway, approval binding, DLP ve competency certification Day-0 runtime skeleton'ları eklendi.
- CI ilk private commit öncesi lockfile üretimi modeline göre sertleştirildi.

## Truth

Bu sürüm full runtime implementation iddiası taşımaz.
`REGISTERED != KNOWN != SKILLED != CERTIFIED != CURRENT != AUTHORIZED != VERIFIED`.
