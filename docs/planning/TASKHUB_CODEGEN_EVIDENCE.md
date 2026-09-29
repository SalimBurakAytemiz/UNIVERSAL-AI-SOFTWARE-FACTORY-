<!-- //TR: CORE-4 TaskHub code-gen kanıt dokümanı (CLAUDE_BUILDER rol çıktısı; not clean, ayrı reviewer onaylar). -->

# TaskHub Code-Gen Kanıt Dokümanı (CORE-4)

Rol: UASCO IMPLEMENTER (CLAUDE_BUILDER). Bu doküman BUILD/EXECUTING (kaynak üretim) fazının
kanıtıdır. Üretilen kod **çalıştırılmadı / test edilmedi / önizlenmedi** (FD-REL-1). Durum
**SOURCE_GENERATION_COMPLETE**, **PRODUCT_VERIFIED DEĞİL**. CLEAN beyanı yoktur; ayrı bir
reviewer bağımsız inceleyecektir.

- Worktree: `C:/Users/salim/UASCO-wt/v2-core4`
- Dal: `v7/core-taskhub-codegen`
- Taban commit (base): `4bf378be56718ff97e1c8407b5f7299efd0a9c58`
- Model: `claude-opus-4-8`

## 1. Üretilen dikey dilim (STEP 1)

Üretilen kaynak, bir RUN ÇIKTISIDIR (UASCO ürün kodu değil). Yükleyici:
`tests/fixtures/taskhub-generated/slice.ts` (SALT VERİ; üretilen metin kendi yığın
geleneklerini izler, `//TR` taşımaz, sır taşımaz). Dosya -> gerçeklediği Architecture
bileşeni (CMP) ve Requirements (FR/NFR) iz düşümü:

| Üretilen dosya | CMP | Requirements | Rol |
| --- | --- | --- | --- |
| `db/migrations/0001_init.sql` | CMP4 | FR3, FR4, FR6-FR9, NFR1, NFR2, NFR3 | PostgreSQL şeması + migration: workspaces/users/memberships/sessions/projects/tasks; status/priority ENUM, FK ile workspace izolasyonu, `password_hash` (NFR1). |
| `src/db.ts` | CMP4 | FR9 | node-postgres pool + parametreli query yardımcıları. |
| `src/auth.ts` | CMP1 | FR1, FR2, NFR1 | AuthService: login/logout/session, bcrypt hash/verify (düz metin parola yok). |
| `src/authorization.ts` | CMP2 | NFR2, NFR3 | AuthorizationGuard: `assertWorkspaceMember` / `workspaceOfProject`, tenant izolasyonu. |
| `src/tasks.repo.ts` | CMP4 | FR4, FR6-FR9 | TaskDomainStore: görev kalıcılığı, status/priority enum doğrulaması, due-date opsiyonel. |
| `src/tasks.routes.ts` | CMP3 | FR3, FR4, FR5, NFR2, NFR3 | ProjectTaskApi: proje/görev CRUD + atama; `requireSession` auth + workspace yetki guard'ları. |
| `src/board.ts` | CMP5 | FR10, FR11 | BoardViewService: görevleri duruma göre gruplar, sütun başına sayı. |
| `src/server.ts` | CMP3 | FR1, FR2, FR10, FR11 | Express app: auth + authorization + task router kompozisyonu. |
| `web/TaskBoard.tsx` | CMP6 | NFR4, FR10, FR11 | Tek ekran (SCR4 pano): board API'sini tüketen React bileşeni. |
| `web/taskboard.css` | CMP6 | NFR4 | Responsive pano stilleri (mobil genişlikte tek sütuna yığılma). |
| `package.json` | CMP3 | - | Gerçek çalışma bağımlılıkları: express, pg, bcrypt, react (uydurma kütüphane yok). |
| `tests/tasks.api.test.ts` | CMP4 | FR6, FR7, FR10, FR11 | Teslim edilen dilim testi — KAYNAK olarak gönderilir, UASCO'da ÇALIŞTIRILMAZ. |

Her CMP1..CMP6 bileşeni en az bir üretilen dosyaca gerçeklenir (testçe doğrulanır).
Güvenlik/yetki gerçekten koddadır: workspace üyelik guard'ı (NFR2/NFR3), bcrypt parola
hash'i (NFR1), tek-atanan aynı-workspace kısıtı (FR5).

## 2. Deterministik teslim artefaktı (STEP 2 — GERÇEK paketleme)

Üretilen dilim gerçek ürün kod yolundan geçirildi (yeniden yazılmadı):
`ProjectStudio.prepareRunDelivery` (M1A-MODE). Test
`tests/v7-core-predev-taskhub-codegen.test.ts`, dilimi gerçek `FakeExecutors.implement` üzerinden
run workspace'ine yazdırır, gerçek `MissionRunner` ile çalıştırır (ExecutionGate(null)) ve
`/v1/work-runs/:id/delivery/prepare` API'si ile gerçek teslim kodunu çağırır.

Gözlemlenen artefakt (örnek koşu; runId/sourceCommit koşuya özeldir):

- `runId`: `run_0c6061cc27b81bb4d9b5a270`
- `sourceCommit`: `f1a57e38b3db6577231e1ee45f91e9a14765d71c`
- `treeSha`: `584e6bf3889a123f70e38073349cbf7823d710a1`
- `exportArtifactHash` (arşiv baytlarının SHA-256): `aabe836ab207a1f7d84039b4690603955b36521789a40c8ff895a9fa2f465308`
- `artifactPath`: `deliveries/run_0c6061cc27b81bb4d9b5a270/aabe836ab207a1f7d84039b4690603955b36521789a40c8ff895a9fa2f465308.zip`
- Boyut: 30634 bayt

Determinizm ve bağlanma (testçe doğrulanır):

- **Aynı girdi -> aynı çıktı**: aynı koşu yeniden paketlenince baytlar ve `exportArtifactHash`
  birebir aynıdır (yeni journal kaydı yok, `recorded:false`). Dosya silinip TAZE bir
  `ProjectStudio` örneğiyle yeniden kurulduğunda da baytlar birebir aynıdır
  (`prepareRunDelivery(...) === art`). Arşiv sıralı, sabit zaman damgası (0), sabit modlar,
  sıkıştırmasız üretildiği için deterministiktir.
- **Bağlanma**: artefakt `runId` + `sourceCommit` (= `run.headSha`) + `exportArtifactHash`'e
  bağlıdır; `artifactPath` hash'i taşır.
- Teslim artefaktı üretilen gerçek dosyaları `source/taskhub/...` altında taşır
  (ör. `source/taskhub/src/auth.ts`, `source/taskhub/db/migrations/0001_init.sql`).
- Paketleme sırasında **yalnız git** çalıştı; üretilen kodun hiçbir süreci (node / paket
  script) başlatılmadı (`cp.spawn` hiç çağrılmadı, `cp.spawnSync` yalnız `git`).

Not: `exportArtifactHash` mutlak bir sabit değildir; FakeExecutors commit'inin
sourceCommit'i koşu meta verisine bağlı olduğundan koşular arası değişebilir. Doğrulanan şey
"aynı girdi -> birebir aynı bayt/hash" determinizmidir.

## 3. Secret / statik güvenlik taraması (STEP 2 — GERÇEK tarama, dürüst)

- **GERÇEK secret-scan (ürün modülü `core/workos/secret-scan`)**: üretilen kaynağın her
  satırı `findSecretKinds` ile ve sentetik bir diff `scanDiffForSecrets` ile tarandı:
  **0 bulgu**. Ayrıca `prepareRunDelivery` arşivin tamamını kendi secret taramasından
  geçirir (bulgu olsaydı 409 EXPORT_BLOCKED_SECRET ile dosya yazılmazdı) — paketleme başarılı.
- **GERÇEK static-security (`core/workos/security-tools`)**: `discoverSecurityTools` ile
  araçlar PATH üzerinden keşfedildi ve durum DÜRÜSTÇE kaydedildi (sahte PASS yok):

  | Araç | Durum | Sürüm | Not |
  | --- | --- | --- | --- |
  | gitleaks | INSTALLED | 8.30.1 | Üretilen kaynağın eklenen-satır akışı üzerinde GERÇEK çalıştı: **CLEAN, 0 bulgu**. |
  | trivy | INSTALLED | 0.75.0 | Yerel zafiyet DB'si **MISSING** (asla indirilmez) -> **PARTIAL** (TRIVY_DB_UNAVAILABLE). |
  | semgrep | NOT_INSTALLED | - | SAST sabit boşluk (TOOL_NOT_INSTALLED). |

  `evaluateSecurityPolicy` sonucu: durum **PARTIAL**, `blockReason: null` (secret yok),
  `gaps: [SCA:TRIVY_DB_UNAVAILABLE, SAST:TOOL_NOT_INSTALLED, SBOM:NOT_IMPLEMENTED]`.
  builtin secret hits = 0. (Araçların yokluğunda bu bölüm NOT_INSTALLED olarak dürüstçe
  raporlanır; sahte PASS üretilmez.)

## 4. Durum ekseni ve yürütme kapısı (STEP 2/3 — sınır)

- Koşu durumu: **SOURCE_GENERATION_COMPLETE** (`sourceGenerationOf` = SOURCE_GENERATION_COMPLETE).
- Ürün doğrulama: **NOT_VERIFIED**, neden `NOT_EXECUTED:SANDBOX_UNAVAILABLE`
  (`productVerificationOf`); mission COMPLETE değil (`completionEvidence` =
  `COMPLETION_PRODUCT_NOT_VERIFIED`); `testsExecuted: false`.
- **Execution gate** (`ExecutionGate(null)`): kayıtlı sağlayıcı yok (`registered:false`).
  Her yürütme türü için **BLOCKED(SANDBOX_UNAVAILABLE)** / `NO_VERIFIED_PROVIDER`:
  `RUNNER_VERIFY_TESTS`, `RUNNER_REGRESSION_TESTS`, `STUDIO_DEVRUN`. `status()` = UNAVAILABLE.
  Üretilen kod için herhangi bir çalıştırma/önizleme/test denemesi yapılmadı; kapı
  zayıflatılmadı.

## 5. Sınır beyanı (FD-REL-1)

Bu, GERÇEK paketleme + tarama yollarından geçirilmiş ÜRETİLEN KAYNAKTIR. Kod
**çalıştırılmadı / test edilmedi / önizlenmedi**. Durum **SOURCE_GENERATION_COMPLETE**,
**PRODUCT_VERIFIED DEĞİL**. Sahte PASS yoktur. CLEAN beyanı yoktur (ayrı reviewer onaylar).

## 6. Değişen dosyalar

- `tests/fixtures/taskhub-generated/slice.ts` (yeni; üretilen dilim verisi + manifest — korumasız)
- `tests/v7-core-predev-taskhub-codegen.test.ts` (yeni; gerçek yolları süren UASCO testi — korumasız)
- `config/validation.json` (korumalı; yeni test tek "tests" adımının SONUNA eklendi)
- `config/trust-root-manifest.json` (korumalı; EN SON yeniden mühürlendi)

Yetkili korumalı değişiklikler yalnız `config/validation.json` + `config/trust-root-manifest.json`.
`execution-gate.ts`, `builder-execution-policy.json`, `environment-policy.json`,
`automation/lib/**`, `apps/control-api/src/server.ts`, `prompts/` dokunulmadı.
