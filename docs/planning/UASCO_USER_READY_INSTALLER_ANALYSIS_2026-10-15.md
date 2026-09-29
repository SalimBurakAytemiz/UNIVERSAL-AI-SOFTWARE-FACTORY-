# UASCO — USER_READY_INSTALLER Teslim Analizi (A–G)

- **Karar:** FD-PRODUCT-DELIVERY-MODEL-2026-10-15 — UASCO son kullanıcıya tek bir `UASCO Setup.exe` ile kurulan, açılan ve kullanılan Windows masaüstü ürünü olarak teslim edilecek. Kullanıcıdan git/npm/Node/Python/terminal/manuel backend/derleme beklenmeyecek.
- **Hazırlayan:** supervisor (Claude). Salt okunur analiz; mevcut kanıtlara dayanır. Yeni özellik işi başlatılmadı; M1A-MODE c2 sürüyor.
- **Dayanak kanıt:** INT-R4 CLEAN (`2bdf9b0`), M0 release decision (`a49f0a84…`), REL-WK-00 first-EXE P0 (`product/rel/REL-FIRST-EXE-P0.md`), rehearsal (D-M1-01..10), isolation plan + physical-worker paketi, M1A-MODE c1/c2.
- **Korunan:** Master V2, 216 başlık, 71 UX, 599 hedef, tek repo, tek Desktop, tüm güvenlik kuralları, tamamlanan kanıtlar.

## Terminoloji
- **SOURCE_GENERATION_COMPLETE:** AI gerçek kaynak kod üretti + statik güvenlik taraması + bağımsız Claude review CLEAN. Testler çalışmadı.
- **PRODUCT_VERIFIED:** Üretilen kod doğrulanmış bir sandbox içinde gerçekten test edildi. **M1a'da imkânsız.**
- **USER_READY_INSTALLER:** Son kullanıcıya verilecek ilk gerçek sürümün kabul kapısı (Delivery/Assurance sözleşmesinin parçası, yeni sistem değil).

---

## A) M0/M1a ile USER_READY_INSTALLER arasındaki işlevsel eksikler

| Alan | M0 | M1a (c2) | USER_READY hedefi | Eksik |
|---|---|---|---|---|
| Kurulum + açılış | ✓ (kanıtlı) | ✓ | ✓ | Gerçek kullanıcı makinesinde kurulum henüz sizce yapılmadı |
| Backend sağlığı | ✓ gerçek Work OS | ✓ | ✓ | — |
| Setup Wizard (ilk açılış) | yok | kısmi (Ayarlar) | tam sihirbazı | **Hesap/izin/sağlayıcı sihirbazı yok** |
| AI sağlayıcı bağlantısı | yok | profil var ama **CLI + login gerekli** | masaüstünden bağlanma | **Login bir teknik adım (CLI); sihirbaza taşınmalı** |
| Proje oluştur → gereksinim | ✓ UI | ✓ | ✓ | — |
| AI ile gerçek kod üretimi | yok | ✓ (login sonrası) | ✓ | Claude CLI + login şart |
| Güvenli ortamda test | yok | **BLOCKED (sandbox yok)** | ✓ | **Doğrulanmış sandbox yok** |
| Bağımsız review | yok | ✓ (login sonrası) | ✓ | — |
| Gerçek artefakt teslimi | yok | ✓ (c2 per-run, hash'li) | ✓ | — (c2 CLEAN bekliyor) |
| Canlı önizleme | yok | **BLOCKED** | sonraki sürüm | İlk sürümde kapsam dışı |
| Kapat/yeniden aç | kısmi | — | ✓ | Kurulu uygulamada doğrulanmadı |
| Güncelleme/kaldırma | kaldırma ✓ | — | ✓ güncelleme | **Güvenli güncelleme kanalı yok** |

**Özet:** En büyük iki işlevsel eksik: (1) **güvenli test ortamı (sandbox) yok** → "test et" adımı ve PRODUCT_VERIFIED imkânsız; (2) **AI sağlayıcı bağlantısı hâlâ teknik bir adım** (Claude CLI kurulumu + login) → madde 5'e aykırı.

---

## B) Installer'a alınması gereken bağımlılıklar

| Bağımlılık | Şu an | USER_READY için |
|---|---|---|
| Electron + Node runtime | ✓ installer'da (Electron 44.4.5, backend ELECTRON_RUN_AS_NODE ile) | ✓ yeterli |
| Uygulama kodu + yapılandırmalar | ✓ (INT-R4'te staging listesi D-M1-01 ile düzeltildi) | ✓ |
| **Claude Code CLI** (AI sağlayıcı) | **harici; kullanıcı kurup login olmalı** | **KARAR gerekli:** (a) CLI'ı bundle'la + sihirbazda uygulama içi login, ya da (b) sihirbazda yönlendirmeli kurulum. Bundle + otomatik login lisans/kimlik bilgisi onayı ister |
| **gitleaks + trivy** (statik güvenlik) | harici; yoksa NOT_INSTALLED/PARTIAL | installer'a çevrimdışı bundle (MIT/Apache) |
| **Sandbox worker runtime** | **yok** | **Bundle edilemez** — ayrı fiziksel/VM worker (FD-M1-ISOLATION). İlk sürümde test ortamı buna bağlı |
| Kod imzalama sertifikası | yok | ticari sürüm için ayrı (madde 15) |

---

## C) Gerçek proje geliştirme + test akışının eksik parçaları (madde 8 akışı)

Akış: **proje → gereksinim → AI kod → güvenli test → bağımsız review → sonuç → çıktı**

| Adım | Durum |
|---|---|
| proje oluştur | ✓ |
| gereksinim | ✓ |
| AI ile gerçek kod | ✓ (Claude CLI + login sonrası; sihirbaz gerekli) |
| **güvenli ortamda test** | ✗ **doğrulanmış sandbox yok** → tek büyük boşluk |
| bağımsız review | ✓ (login sonrası) |
| sonuçları göster | ✓ (NOT_VERIFIED etiketli) |
| gerçek çıktı al | ✓ (c2 per-run artefakt, hash'li; CLEAN bekliyor) |

**Sonuç:** Tek kritik eksik, güvenli test ortamı. O olmadan madde 8'in "test et" adımı ve madde 9'un "tam yazılım fabrikası" tanımı karşılanamaz.

---

## D) İlk teslimi engelleyen zorunlu güvenlik kapıları

1. **Doğrulanmış sandbox izolasyonu** (FD-REL-1-REJECT): güvenilmeyen/AI kodu host'ta çalışamaz. Ayrı fiziksel worker seçildi (D-M1-ISOLATION); donanım + kurulum sizde.
2. **Bağımsız negatif güvenlik doğrulaması** (dış uzman/laboratuvar): dosya/ağ/kimlik/süreç/host izolasyonu 0 ESCAPED olmadan "tam yazılım fabrikası" teslim sayılmaz.
3. **REL-FX güvenilirlik kapıları** (FX-1..5): kanıta bağlı COMPLETE, test-değişikliği onayı, risk reddi, kurtarma, installer kimlik kaydı — bağımsız review zorunlu (REL-FX CLEAN).
4. **Müşteri veri izolasyonu + Trust Kernel** — korunuyor; çalıştırma izolasyonu sandbox'a bağlı.
5. **Kod imzalama + güvenli güncelleme kanalı** (madde 14/15) — ticari genel sürüm için; ilk kişisel sürümde imzasız + SmartScreen uyarısı kabul edilebilir, ama güncelleme kanalı imza/bütünlük/geri alma ister.

---

## E) Son kullanıcıdan teknik işlem istemeden kurulum

- **Zaten çözülmüş:** Node/Electron runtime bundle; backend otomatik başlar; kullanıcı git/npm/derleme yapmaz; kullanıcı verisi userData altında ayrık.
- **Kalan tek teknik adım — AI sağlayıcı girişi:** Şu an `claude` CLI + ayrı profile login gerekiyor. USER_READY için bu **Setup Wizard içine** alınmalı: uygulama içi OAuth/login ya da rehberli kurulum, UASCO profiline (kişisel profil asla otomatik değil). Bu, "sıfır teknik adım" için en kritik UX işi.
- **Yetki gerektiren adımlar:** yalnız açık izinle (madde 6) — ör. güvenlik tarayıcı bundle'ının yerleştirilmesi installer içinde; sandbox worker bağlantısı ise ayrı makinede, sizin kurduğunuz.

---

## F) İlk kullanılabilir ve güvenli UASCO.exe — kritik yol ve ETA

İki ayrı sürümü **ayırmak** gerekiyor (madde 9/10/13):

### F1. "Kaynak üreten" erken sürüm (test ortamı YOK)
- Kapsar: kurulum, açılış, Setup Wizard, AI sağlayıcı bağlantısı, proje → gereksinim → **AI gerçek kod** → bağımsız review → **NOT_VERIFIED** kaynak teslimi.
- Kapsamaz: güvenli test, canlı önizleme, PRODUCT_VERIFIED. Bunlar **açıkça sonraki sürüm** (madde 13; UNAVAILABLE diye normalleştirilmeyecek — "bu sürümde yok, test ortamı sürümünde gelecek" diye etiketlenecek).
- Kritik yol: M1A-MODE c2 CLEAN → Setup Wizard + AI-login UX paketi → USER_READY_INSTALLER kabul kapısı (madde 12 kanıtları) → bağımsız artefakt review.
- **ETA (ölçülü): P50 18 Eki, P80 20 Eki, P95 23 Eki.** Güven: orta. Varsayım: Setup Wizard/login UX 2-3 review turu; hafta sonu + onay gecikmeleri dahil.
- **Not:** Bu sürüm madde 8'in "test et" adımını içermez; bu yüzden **"tam kullanılabilir yazılım fabrikası" değildir.** Size erken sürüm olarak sunulabilir ama son kullanıcıya "tamamlanmış UASCO" denmez (madde 10).

### F2. "Gerçekten kullanılabilir ve güvenli" tam sürüm (madde 8+9 eksiksiz)
- Ek olarak: doğrulanmış sandbox (ayrı fiziksel worker) + bağımsız negatif güvenlik doğrulaması + PRODUCT_VERIFIED akışı + güvenli güncelleme kanalı.
- Kritik yol iki UNKNOWN'a bağlı: (a) worker donanımının hazır olması, (b) bağımsız uzmanın negatif testleri tamamlaması.
- **ETA: UNKNOWN.** Donanım + uzman takvimi girince hesaplanır. Donanım ~1 gün, uzman ~1-2 gün başlarsa, en erken gerçekçi ~24-28 Eki; bu bir taahhüt değil.

---

## G) Teslim sonrası 216 başlıklı kapsamın güncelleme/geliştirme sırası

1. **İlk sürüm (F1 veya F2) teslim** → güvenli güncelleme kanalı devreye (madde 14: imza, bütünlük, uyumluluk, geri alma, kullanıcı yetkisi).
2. **Sonraki güncellemeler sırası** (REL-WK-00 ve kuyruktan):
   - Önce F1 ise: sandbox test ortamı + PRODUCT_VERIFIED (F2'yi tamamlayan) güncellemesi.
   - Sonra REL-WK-00 first-EXE P0 artığı + canlı önizleme.
   - Sonra 216 başlığın kalanı (TEK_BIRLESIK C topics, REL-117..216, WFR-04b.., REA-WK-02..) — her biri bağımsız review + USER_READY regresyon kapısından geçerek, aynı Desktop'a güncelleme olarak.
   - 599 uzman değerlendirmesi ve Company/Knowledge/Control Tower ileri modülleri sürümlenmiş güncellemeler olarak.
3. Her güncelleme aynı güvenlik kapılarına tabi; hiçbir vaat edilen özellik "UNAVAILABLE" ile normalleştirilmez — ya çalışır ya da açık biçimde "sonraki sürüm" kapsamındadır.

---

## Master ile uzlaştırma ve güncellenen kabul kriterleri

- **Tek repo/Desktop/Trust Kernel korunuyor.** USER_READY_INSTALLER, mevcut Delivery + Assurance sözleşmelerine eklenen bir kabul kapısıdır; yeni uygulama değil.
- **B12/PS-AT-001** kabul testi, madde 12'nin 12 kanıtını içerecek şekilde genişletilecek (temiz Windows kurulum, açılış, backend sağlık, sihirbaz, sağlayıcı bağlantısı, gerçek proje+kod, güvenli çalıştırma+test [F2'de], bağımsız review, artefakt, kapat/aç, güncelleme+kaldırma, installer SHA-256 + kaynak commit + bağımsız artefakt review).
- **71 UX kararı** korunur; Setup Wizard ve AI-login akışı bu UX seti içinde somutlaştırılır.
- **Test izolasyonu (madde 16):** otomatik testler yalnız "UASCO Test" kimliğiyle çalışır; gerçek kullanıcı kurulumunu asla değiştirmez/temizlemez (M1A-MODE c2 kapsamında).

## Sizden beklenen kararlar
- **K-1 (AI sağlayıcı):** Claude CLI'ı installer'a bundle edip uygulama içi login mi (lisans/kimlik onayı gerekir), yoksa Setup Wizard'da rehberli kurulum mu?
- **K-2 (ilk sürüm tanımı):** İlk teslim F1 (kaynak üreten, test ortamsız, "erken sürüm" etiketli) mi olsun, yoksa doğrudan F2 (tam, güvenli) beklenecek mi?
- **K-3:** Güvenli güncelleme kanalı ve kod imzalama ne zaman devreye alınsın (ilk sürümde mi, sonraki güncellemede mi)?
