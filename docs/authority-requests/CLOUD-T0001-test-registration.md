<!-- //TR: CLOUD-T0001 yetki talebi (S-REG): yeni bulut sözleşme testi tests/v7-cloud-contracts.test.ts CI'da yalnız config/validation.json tests-8 adımına eklenince koşar; bu korumalı değişiklik Founder T2 onayı (D-31) olmadan merge edilmez. -->
# CLOUD-T0001 yetki talebi: test kaydı (S-REG)

Durum: `CODE_COMPLETE_PROTECTED_CHANGE_PENDING_FOUNDER_T2`. Korumalı commit dalda hazırdır. **Merge edilmez.**

## Talep edilen iki korumalı değişiklik

1. **TEST_REGISTRATION_APPEND** (`config/validation.json`): `tests-8` adımının `command` dizisinin sonuna `"tests/v7-cloud-contracts.test.ts"` eklenir. Başka değişiklik yoktur.
2. **TRUST_ROOT_RESEAL** (`config/trust-root-manifest.json`): `scripts/generate-trust-root.mjs` ile yeniden mühürlenir. Değişen yalnız `generatedAt` ve `config/validation.json` sha256 değeridir (`74f6cd1e…22fd492c`). `verify-trust-root` PASS verir.

Korumasız eşlik eden değişiklik: `tests/v7-ps1b-project-studio-ui.test.ts` ve `tests/v7-b5-work-screens.test.ts` sıralama korumaları `cloud` ailesini kabul eder. Bu, `c7a33f84` (core-role) ile aynı türden bir değişikliktir; başka assertion değişmez.

## Yetki

- Bu PR'daki bu değişikliği **FD-10 "R1 PREAUTHORIZED" ön yetkisine dayanarak yapılmış saymıyoruz.** Kapanış raporu FD-10'u `DONE_BUT_UNVERIFIED` olarak işaretliyor; `UASCO_REMAINING_WORK` hâlâ "Founder: TEST_REGISTRATION_APPEND tier" istiyor.
- Merge için gerekenler:
  - Founder T2 onayı (D-31 paketi ya da bu PR için açık onay).
  - SHA'ya bağlı bağımsız review.
  - Hosted CI PASS.
- Reseal, `config/trust-root-manifest.json`'a dokunan başka bir PR'dan önce merge edilirse, ikinci PR'ın eklemesi ve reseal'ı gerçek head byte'larıyla yeniden hesaplanır.

## Doğrulama (bulut konteyneri, Node 24.22.2)

`pkg-vs-validation-sharding`, `ci-validation-shards`, `v7-ps1b-project-studio-ui`, `v7-b5-work-screens`, `v7-cloud-contracts` ve `pkg-f-validation-scripts-protected` testleri: 486/486 PASS. `verify-trust-root` PASS.
