# UASCO — İlk Kurulabilir Desktop Sürümü: Kurulum Talimatı (2026-10-15)

Bu, M0 değil: M1a'nın bağımsız incelemeden geçmiş birleşik yetenekleridir (gerçek kod üretimi, proje yönetimi, statik analiz, Claude bağlantısı, bağımsız review, kaynak dışa aktarma) tek kurulabilir Desktop'ta. Tam F2 değildir.

## Artefakt kimliği

| Alan | Değer |
|---|---|
| Kesin yol | `C:\Users\salim\UASCO-wt\rel-f2first-build\dist-installer\UASCO-Setup-0.7.0-dev.1-win-x64.exe` |
| SHA-256 | `fb5897f30a2f0ad5c3d2720290eedc9591f3ad4be9700e8f9c0b5f90a2c9d332` |
| Boyut | 110.661.427 bayt |
| Sürüm | 0.7.0-dev.1 |
| Uygulama kimliği | com.uasco.desktop · productName UASCO |
| Kaynak commit | `2176741811fa0121bc29610264b9e2f0300e7229` (M1A-MODE c2, bağımsız review CLEAN) |
| İmza | İmzasız (NotSigned) — kişisel geliştirme sürümü |
| Bağımsız artefakt review | **CLEAN** (wf_7b0cbc14-316): 2203 dosya köken doğrulandı, bağımsız yeniden derleme bire bir, gizli bilgi yok, çalıştırma kapısı fail-closed |

## Kurulum adımları

1. **Hash doğrulaması.** Git Bash'te şu komut yukarıdaki SHA-256 ile birebir aynı değeri vermeli:

```bash
sha256sum "C:/Users/salim/UASCO-wt/rel-f2first-build/dist-installer/UASCO-Setup-0.7.0-dev.1-win-x64.exe"
```

2. Dosyaya çift tıklayın. İmzasız olduğu için SmartScreen uyarısı çıkarsa **"Ek bilgi" → "Yine de çalıştır"**. Yönetici yetkisi gerekmez (kullanıcı kurulumu).
3. Kurulum klasörünü seçin (varsayılan veya SSD'de normal bir klasör; **%TEMP% kullanmayın**).
4. UASCO Desktop'ı açın. İlk açılışta Ayarlar'dan Claude bağlantısını yapılandırın (aşağıya bakın).
5. Kaldırma: Ayarlar → Uygulamalar → UASCO. Kullanıcı verileri `%APPDATA%\UASCO` altında ayrı tutulur.

## Claude bağlantısı (AI yetenekleri için)
- Ayarlar'da UASCO'ya özel iki Claude profili görünür (implementer + bağımsız reviewer). Kişisel Claude profiliniz otomatik kullanılmaz.
- AI özelliklerini kullanmak için Ayarlar'da gösterilen giriş komutuyla bu profillere **bir kez** giriş yaparsınız.
- Giriş yapılmazsa uygulama yine açılır; AI işlevleri dürüstçe **BLOCKED / NOT_CONNECTED** görünür.
- (Not: Tam otomatik "hesap bağla" sihirbazı sonraki güncellemede gelecek; bu sürümde bağlantı Ayarlar üzerinden yapılır.)

## Bu sürümde NE ÇALIŞIR
- Kurulum, açılış, gezinme, gerçek Work OS backend bağlantısı.
- Proje oluşturma ve yönetimi (Project Studio).
- **AI ile gerçek kaynak kod üretimi** (Claude bağlandıktan sonra; kod üreten AI host'ta komut çalıştırmaz, yalnız çalışma alanında dosya düzenler).
- Bağımsız Claude review (salt okunur reviewer).
- Statik güvenlik taraması (gitleaks/trivy; makinenizde kurulu değillerse PARTIAL/NOT_INSTALLED gösterir).
- Üretilen gerçek kaynağın deterministik, hash'li paketle dışa aktarımı.

## Bu sürümde NE ÇALIŞMAZ (dürüst durum)
- **Üretilen kodun testlerinin çalıştırılması** ve **canlı önizleme**: **NOT_EXECUTED / NOT_VERIFIED** görünür. Sebep: güvenilmeyen/AI kodu, doğrulanmış bir izolasyon ortamı olmadan Windows host'unuzda çalıştırılmaz (FD-REL-1 güvenlik kararınız). Bu, sonraki adımda ayrıca değerlendireceğimiz konu.
- Bu yüzden görevler ürün düzeyinde **COMPLETE / PRODUCT_VERIFIED** olmaz; yalnız **SOURCE_GENERATION_COMPLETE** (kaynak üretildi, test edilmedi) durumuna ulaşır.
- Bu sürüm **tam F2 / tam yazılım fabrikası değildir** ve öyle sunulmaz.

## Güvenlik
- Mevcut güvenlik kontrolleri kaldırılmadı: çalıştırma kapısı fail-closed, builder araç-politikası sandbox'ı, reviewer izolasyonu, Trust Kernel.
- İmzasız; kod imzalama ve güvenli otomatik güncelleme sonraki iş paketi.
- Otomatik güncelleme yok; güncellemeler doğrulanmış yeni installer ile gelir.

## İlk kurulumdan sonra
Kod çalıştırma ve canlı önizleme yöntemini birlikte değerlendireceğiz (host'ta izinli çalıştırma mı, yoksa izole bir yol mu). Bu karar bu teslimi geciktirmedi.
