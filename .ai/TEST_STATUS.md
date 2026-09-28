<!-- //TR: Bu dosya V6 audit/remediation worktree üzerinde geçerli test gerçeğini target-machine ve dependency-aware doğrulamalardan ayrı tutar. -->
# Test Status

Paste 1/2/3/4 bounded source validatorları, repo-geneli config→runtime enforcement sweep ve full dependency-free source regression PASS vermiştir.

Dependency-aware canonical doğrulama target Windows makinesinde (win32 10.0.19045 x64, Node v24.19.0, npm 11.17.0, git 2.55.0, PowerShell 5.1.19041.6456) reviewed lock ile izole klonlarda çalıştırılmıştır: `34/34 PASS`. Bu, runtime schema conformance (Ajv 2020-12), dependency supply-chain + `npm audit` (0 bulgu), release supply-chain/SBOM-lite, TypeScript typecheck ve Vitest adımlarını kapsar. Broad dependency-free selftest suite `25/25 PASS`. Desktop ve Control Tower smoke'ları açık temin edilen Electron binary ile bu makinede PASS vermiştir. Live provider smoke (`scripts/provider-smoke.mjs`, Claude builder ve Codex reviewer broker'ları, `STANDALONE_LAUNCHER`) 2026-09-28'de PASS vermiştir. Target preflight, PKG-G fiziksel RAM ölçümü ve Windows Time servisinin başlatılmasından sonra PASS vermiştir.

Trust-root bu release-candidate commit'inde mühürlüdür; doc-truth validator'ları `SEALED` modda trust-root'u süreç içinde yeniden doğrular. PKG-R1 kuru çalıştırmasında mühürlü bir export'tan üretilen ZIP'in taze extract'inde reviewed-lock kurulumu ve kanonik doğrulama 34/34 PASS vermiştir. İlk target-machine Phase0 denemesi (`f0a4f0a` imzalı ZIP) bootstrap'ta kanonik doğrulama hatasıyla durdu; PHASE0-F1/F2/F3 PKG-R3 ile düzeltildi ve düzeltmeler scratch kuru çalıştırmalarında doğrulandı. Bu durum target-machine Phase0 acceptance, SHA256SUMS, final ZIP veya release authenticity PASS anlamına gelmez.

- `SOURCE_LEVEL_CLOSURE = FALSE`
- `DEPENDENCY_AWARE_VALIDATION = PASS_TARGET_WINDOWS_NODE24_NPM11`
- `LIVE_PROVIDER_SMOKE = PASS`
- `TARGET_PREFLIGHT = PASS`
- `FINAL_TRUST_ROOT_SEAL = SEALED_RELEASE_CANDIDATE`
- `FINAL_SHA256SUMS = PACKAGING_STAGE_OUTSIDE_GIT`
- `FINAL_RELEASE_AUTHENTICITY = EXTERNAL_DETACHED_SIGNATURE_REQUIRED`
- `TARGET_MACHINE_PHASE0 = PENDING`
