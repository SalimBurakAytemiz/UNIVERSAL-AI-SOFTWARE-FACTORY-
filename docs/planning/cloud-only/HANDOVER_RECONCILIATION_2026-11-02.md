<!-- //TR: Bu belge 2026-11-02 cloud-only devir dosyalarının repo durumu ile mutabakatını, eksik kaynakları ve başlatılan ilk görevi kaydeder. -->
# Cloud-Only Devir Mutabakatı — 2026-11-02

## Girdiler

| Dosya | Durum | SHA-256 |
| --- | --- | --- |
| `UASCO_CLAUDE_DEVIR_TALIMATI.md` (14) | Okundu | — |
| `UASCO_BULUT_GECISI_VE_RISKLER.md` (12) | Okundu | — |
| `UASCO_BULUT_DEGISIKLIK_MATRISI.json` | Okundu; birebir kayıt: `CLOUD_ONLY_CHANGE_MATRIX.json` (`//TR` ve `sourceFile` alanları eklendi) | `18fe10a70f0a458722a48e735872cc205610e00b4b3f2eb514ccf855234cc872` (orijinal) |

Matris içeriği: 21 mevcut-Task override, 15 yeni Task (`CLOUD-T0001..0015`), 11 karar override'ı (D-03, D-07, D-08, D-12, D-19, D-23, D-24, D-26, D-28, D-29, D-31), 32 AC override. Durum alanı: `MERGE_ONLY_NOT_EXECUTION_SOURCE`.

## Eksik kaynaklar (gerçek engel — sessizce ikame edilmedi)

1. **`UASCO_V4_1_FINAL_CANDIDATE_PATCHED.zip` (241 Task) mevcut değil.** Ne bu oturuma yüklendi ne de repo'da (`v7/integration`, `uasco/production-queue`, `uasco/production-reports` dalları tarandı) bulunuyor. `UASCO-T0108`, `V4-T0002` vb. kimlikler repo'da yalnız `docs/closure/uasco-remaining-work/UASCO_REMAINING_WORK.json` içinde referans olarak geçiyor.
2. Talimat 14'te okunması istenen `00_BASLA_BURADAN`, `11_CLOUD_RUNTIME_ARCHITECTURE_AND_SECURITY`, `02_V4_1_EXECUTION_MATRIX.json`, `06_V4_1_FOUNDER_DECISION_CENTER.json` ve `verify.py` yüklenmedi.

Sonuç: 241-Task matrisine override birleştirmesi, 57 feature / 102 AC / 31 karar / 10 sim doğrulaması (`verify.py`) **YAPILAMADI**. 175-Task tabanlı bu matris nihai sürüm ilan edilmedi. Paket durumu: **NOT_VERIFIED** (READY_FOR_CODING bile değil; PRODUCT_READY değil).

## Repo durumu ile ilişkilendirme (VERIFIED, `git log origin/v7/integration` @ `16d3a92`)

- Kapanış raporundaki engel RW-001 (#293) çözüldü: #293, #291, #288, #292, #295, #294 `v7/integration`'a merge edildi.
- #231 (WSL2) açık/draft; matris gereği **AS-IS merge edilmez** (D-07). RW-004/RW-005/RW-011'deki Founder-PC WSL/gerçek E2E adımları cloud-only kural gereği CLOUD-T0002/T0011 + Founder `.exe` UAT ile değiştirilecek; bu yeniden sınıflandırma 241 matris gelince uygulanacak.
- `docs/closure/uasco-remaining-work/` bu PR'da değiştirilmedi (kanonik kopya `uasco/production-reports`).

## Başlatılan ilk görev: CLOUD-T0001

Gerekçe: matriste `dependsOn: []` olan, harici sır/bütçe/sağlayıcı gerektirmeyen ve korumalı yol (`config/protected-paths.json`) dokunmayan tek ilk dalga Task'ı. Founder D-01 onayı kapsamında; merge gate `D-31` (T2 review) ayrı Founder kararıdır ve bu PR ile atlanmaz.

| Alan | Değer |
| --- | --- |
| Hedef | `core/cloud/contracts.ts` (yeni), `tests/cloud-contracts.test.ts` (yeni) |
| İş | job id, tenant, imzalı kapsam (HMAC-SHA256, timing-safe), 24h timeout tavanı / 8h default, ≤3 retry, tenant-bazlı idempotency, yapılandırılmış olay akışı doğrulaması, artifact SHA, sır içermeyen audit kaydı; her belirsizlik fail-closed red |
| Done kriteri | Sözleşme testleri ve yetkisiz iş isteği reddi PASS |
| Kanıt | `vitest tests/cloud-contracts.test.ts` 23/23 PASS; `tsc --noEmit` PASS; `npm run validate` statik kapıları (registry…SECRET_SANITY) PASS (Node 24.22.2 / npm 11.21.1, bulut konteyner) |
| Tam suite | 3302 pass / 7 fail / 25 skip. 1 fail bu commit'e ait: `pkg-vs-validation-sharding` (yeni test dosyası henüz bir CI shard'ına kayıtlı değil). 6 fail bu commit'in import etmediği modüllerde, konteyner ortamına bağlı: `v7-int-r3-sbx-gate` ×4 (unshare sandbox), `pkg-t3-omniroute-install-compat` (NPM_ROOT_UNAVAILABLE), `pkg-aut1-orchestrator` (process-tree kill). Hosted CI'da yeniden doğrulanmalı. |
| Ortam | `dependency-supply-chain` (npm audit) bu konteynerin proxy'sinde `DEPENDENCY_AUDIT_INVALID_RESPONSE`; hosted CI'da koşar, burada PASS sayılmadı. |
| Bekleyen supervisor adımı | `config/validation.json` korumalı trust-root dosyası; builder değiştiremez. Supervisor `S-REG (R1 TEST_REGISTRATION_APPEND + TRUST_ROOT_RESEAL)` ile `tests/cloud-contracts.test.ts` bir vitest shard'ına eklenip reseal edilmeli (örnek: `c7a33f84`). Bu yapılmadan sharding testi ve CI kırmızı kalır. |

## Sonraki izinli adımlar (bağımlılık sırasıyla, Founder kararı gerekmeyenler)

- T0001 sonrası açılan: CLOUD-T0003 (job kuyruğu/signed dispatch/STOP) ve CLOUD-T0004 (Control API kimlik/TLS) — paralel yürütülebilir, dosya çakışması yok.
- Ardından: CLOUD-T0002 (T0001+T0003; gerçek sağlayıcı D-03'e bağlı), CLOUD-T0010 (T0003+T0004), CLOUD-T0014 (T0002).
- CLOUD-T0009 (altyapı sağlayıcısı/kapasite) bağımlılıksız ama D-03/D-08 Founder kararı olmadan gerçek kaynak açamaz.
- D-03 (bulut sandbox sağlayıcısı), D-08 (bütçe), D-29 (model credential) Founder kararı olmadan gerçek bulut kaynağı açılmaz.
