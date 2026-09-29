# TaskHub PRE_DEV Uçtan Uca Kanıt Belgesi (CORE-3)

> Durum: PRE-DEV fazı kanıtı. Rol: UASCO IMPLEMENTER (CLAUDE_BUILDER). Ayrı bir gözden geçiren bağımsız inceler; bu belge CLEAN ilan etmez.
> Çalışma kopyası: `C:/Users/salim/UASCO-wt/v2-core3`, dal `v7/core-taskhub-e2e`, taban commit `b0b83ddfa1e875d6fa878522610c9bea30c8f113`.

## 1. TaskHub nedir?

TaskHub, küçük ve orta ölçekli ekiplerin işi tek yerde görünür kılması için bir **görev-yönetimi web uygulaması** referans projesidir (gerçek bir müşteri projesi değildir; `TASKHUB_BRIEF.isReference=true`). Kapsam: bir **web arayüzü (UI)**, bir **backend API** ve kalıcılık için **ilişkisel bir veritabanı**; erişim **kimlik doğrulama** ile korunur. Yetenekler: kullanıcı oturumu, proje/görev oluşturma, görev **atama**, **durum** (todo/in-progress/done) / **öncelik** / **son tarih**, bir **ekip panosu** ve **workspace izolasyonu**.

Kaynak özet: `core/workos/predev/fixtures/taskhub-brief.ts` (`TASKHUB_BRIEF`).

## 2. Üretilen beş artefakt ve izlenebilirlik zinciri

Her artefakt, ilgili UASCO role-builder rolünün gerçek (uydurma olmayan) analizidir; yalnız özette/onaylı üst artefaktlarda olan gerçeklerden türetilmiştir. Özetin sessiz kaldığı yerler ilgili alanda açık `ASSUMPTION:`/`OPEN QUESTION:` maddeleri olarak işaretlenmiştir. Fixture'lar: `core/workos/predev/fixtures/taskhub/` (her tür bir dosya + `index.ts`).

### 2.1 Business Analysis (`business-analysis.ts`) — Business Analyst (UASCO-0022)
Beş iş hedefi (brief amaçlarından birebir türetildi):
- **G1** güvenli oturum açma · **G2** proje/görev oluşturma + atama · **G3** durum/öncelik/son tarih + kalıcılık · **G4** pano ilerleme · **G5** workspace izolasyonu.
- Dürüstlük: sayısal metrik bağlanmadığı için `successMetrics`/`risks` içinde açık varsayım/açık-soru; davet/rol akışı `assumptions` içinde açık soru.

### 2.2 Requirements (`requirements.ts`) — Requirements / SW-Analyst (UASCO-0023)
11 fonksiyonel (FR1–FR11) + 4 fonksiyonel-olmayan (NFR1–NFR4). `tracesTo` yalnız GERÇEK G-id'lerine:
- FR1,FR2 → G1 · FR3,FR4,FR5 → G2 · FR6,FR7,FR8,FR9 → G3 · FR10,FR11 → G4
- NFR1 → G1 · NFR2,NFR3 → G5 · NFR4 → G2,G3,G4
- Dürüstlük: tek/çok-atanan, öncelik ölçeği, tarayıcı sürümleri gibi boşluklar ilgili `acceptanceCriteria` içinde açık varsayım/açık-soru.

### 2.3 Plan (`plan.ts`) — PO/PM (UASCO-0019)
Kapsam SC1–SC6; iş paketleri WP1–WP6; `satisfies` yalnız GERÇEK requirement id'lerine ve **tam kapsama** (her FR/NFR ≥1 WP):
- WP1 → FR1,FR2,NFR1 · WP2 → NFR2,NFR3 · WP3 → FR3,FR4,FR5 · WP4 → FR6,FR7,FR8,FR9 · WP5 → FR10,FR11 · WP6 → NFR4
- `dependsOn` çözülebilir ve döngüsüz: WP1←WP2←WP3←{WP4,WP6}, WP4←WP5. Milestones MS1–MS3 yalnız var olan WP id'lerine.

### 2.4 Architecture (`architecture.ts`) — Architect (UASCO-0043)
Altı bileşen CMP1–CMP6; `covers` ile Plan kapsamının **tamamı** kapsanır:
- CMP1 AuthService → SC1 · CMP2 AuthorizationGuard → SC2 · CMP3 ProjectTaskApi → SC3 · CMP4 TaskDomainStore → SC4 · CMP5 BoardViewService → SC5 · CMP6 WebClient → SC6
- techChoices: ilişkisel DB (PostgreSQL), HTTP backend API, sunucu tarafı parola hash, responsive SPA — her biri gerekçe + değerlendirilen alternatiflerle. Ölçek/HA hedefi bağlanmadığı için `risks` içinde açık soru/varsayım.

### 2.5 UX Spec (`ux-spec.ts`) — UX Designer (UASCO-0031)
Ekranlar SCR1–SCR5, akışlar FL1–FL3, bileşenler UC1–UC5; yalnız onaylı Plan/Requirements yeteneklerinden. `a11yNotes` klavye gezinme, aria-live, renk-tek-başına-değil + WCAG düzeyi/RTL için açık soru/varsayım.

**Zincir:** Brief → BA goals(G*) → Requirements tracesTo(G*) → Plan satisfies(FR/NFR*) + scope(SC*) → Architecture covers(SC*) → UX (onaylı üstlerden). İzlenebilirlik GERÇEK doğrulayıcılarca zorlanır (taklit edilmez).

## 3. Çalıştırılan GERÇEK ürün modülleri (yeniden yazılmadı / stub'lanmadı)

- **Driver:** `core/workos/predev/driver.ts` → `PreDevDriver` (`start`, `produceCurrentPhase`, `buildMissionContext`, `approveAndAdvance`). Yalnız `BuilderPort` enjekte edildi; `produce(kind)` STEP-1 fixture'ını JSON metni olarak döndürür.
- **Doğrulayıcılar:** `core/workos/predev/validators.ts` → `validateArtifactContent` (yapı + izlenebilirlik; sabit hata kodları).
- **Store / journal:** `core/workos/store.ts` → `WorkOsStore` (hash-zincirli journal): `openPreDevSequence`, `recordPreDevArtifact`, `transitionPreDevArtifact`, `advancePreDevPhase`, `preDevReadModel`, `journalHealth`.
- **Rol şablonları:** `core/workos/predev/role-prompts.ts` (`composeRolePrompt`/`getRolePrompt`) driver içinden kullanıldı.

Test: `tests/v7-core-predev-taskhub-e2e.test.ts` (5 test). Birlikte geçen mevcut testler: `tests/v7-core-predev-driver.test.ts`, `tests/v7-core-predev-contracts.test.ts` → **3 dosya / 26 test PASS**.

## 4. Nihai pre-dev durumu ve artefakt geçişleri

Taze mission (DRAFT→PREFLIGHT→AUTHORIZED) üzerinde dizi açıldı ve beş faz sürüldü. Her fazda:
`produceCurrentPhase` (GERÇEK validate + **DRAFT** kayıt) → `advancePreDevPhase` APPROVED olmadan **reddedilir** (`PREDEV_PHASE_ARTIFACT_NOT_APPROVED`) → `approveAndAdvance`: submit(**recorder** `implementer@local.invalid`) → approve(**bağımsız approver** `reviewer@local.invalid`, boş-olmayan evidenceRefs) → advance.

| Faz | Artefakt | Kayıt (recorder) | Onay (approver) | Faz sonucu |
|-----|----------|------------------|-----------------|------------|
| BUSINESS_ANALYSIS | BusinessAnalysis | DRAFT | → APPROVED | → REQUIREMENTS |
| REQUIREMENTS | Requirements | DRAFT | → APPROVED | → PLANNING |
| PLANNING | Plan | DRAFT | → APPROVED | → ARCHITECTURE |
| ARCHITECTURE | Architecture | DRAFT | → APPROVED | → UX_DESIGN |
| UX_DESIGN | UxSpec | DRAFT | → APPROVED | → **PRE_DEV_COMPLETE** |

**Nihai durum:** `phase = PRE_DEV_COMPLETE`, beş artefakt da `APPROVED` (UX_DESIGN artefaktı UxSpec onaylı). Mission durumu pre-dev katmanınca değişmedi (`AUTHORIZED` korundu).

Ek doğrulanan GERÇEK yollar:
- **Negatif yol:** `tracesTo=["G999"]` ile bilerek bozulmuş Requirements varyantı GERÇEK doğrulayıcıca `REQ_TRACEABILITY_BROKEN` ile **REJECTED**; hiçbir şey kaydedilmedi, faz ilerlemedi, `journalHealth = OK`; sonra genuine fixture ile kurtarıldı ve ilerledi.
- **Yalnız-onaylı üst bağlam:** alt rol DRAFT üstü görmez; APPROVED sonrası görür (Architecture bağlamı tam olarak BusinessAnalysis+Requirements+Plan onaylı içeriklerini taşır).
- **Journal replay eşitliği:** aynı journal üzerinden taze `WorkOsStore` birebir aynı okuma modelini yeniden kurdu (`journalHealth = OK`).

## 5. Dürüst sınır beyanı

- İçerik, UASCO role-builder çıktısıdır (gerçek yapay zeka analizi) ve **GERÇEK ürün kodundan** (driver/validator/store/journal) geçirilmiştir; doğrulayıcılar hiçbir noktada atlanmamıştır.
- Bu **yalnız PRE-DEV fazıdır**. Üretilen kodun (generated-code) oluşturulması ve onun test/preview yürütmesi **sonraki fazlardır** ve **FD-REL-1** ile kapılıdır.
- **Hiçbir şey `PRODUCT_VERIFIED` olarak işaretlenmemiştir.** Hiçbir rol `CERTIFIED` yapılmamıştır; artefakt onayları yalnız bu referans pre-dev dizisinin iç izlenebilirlik/bağımsız-onay kapılarını gösterir.
- Yetkili protected değişiklikler yalnız `config/validation.json` + `config/trust-root-manifest.json`; fixture'lar ve test korumasız yollardadır.
