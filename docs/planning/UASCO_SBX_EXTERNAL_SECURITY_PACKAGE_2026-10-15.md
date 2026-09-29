# UASCO SBX: Bağımsız Güvenlik Uzmanı / Laboratuvar Paketi (2026-10-15)

- **Hazırlayan:** supervisor (Claude). Bu belge iş tanımı ve kabul sözleşmesidir. Uygulama kodu, saldırı yöntemi veya test içeriği **içermez**.
- **Dayanak:** Founder kararları FD-REL-1-REJECT-HOST-EXEC-2026-10-15, D-SBX1-PATH-CONDITIONS-2026-10-15 (koşul 5 ve 6), P-SBX-1..5, FA-SBX-2026-10-15.
- **Teknik referans:** `docs/planning/UASCO_M1_SANDBOX_ISOLATION_ASSESSMENT_2026-10-15.md` (sha256 `d7282fb9…`), bölüm 3 (mimari), 4 (negatif test kategorileri), 5 (ağ), 6 (kaynak sınırları), 12 (eleştirmen boşlukları C-01..C-16).

## 1. Neden dış uzman

- UASCO'nun Claude ajanları sandbox launcher'ını ve negatif izolasyon testlerini yazmaya üç kez başladı. Üçünde de model güvenlik sınıflandırıcısı durdurdu:
  - SBX-1 spike
  - negatif test talimatları
  - SBX-1a launcher kaynağı
- Founder koşulu 4 gereği bu sınır hiçbir biçimde dolanılmaz: yeniden ifade edilmez, parçalara bölünmez, başka bir ajana verilmez.
- Bu nedenle launcher'ın sağlanması ve negatif izolasyon doğrulaması bağımsız bir insan uzmana veya yetkili bir güvenlik laboratuvarına bırakılır.
- Yarım kalan launcher dosyası karantinada tutuluyor ve **kullanılmayacak**: `UASCO-recovery/quarantine/sbx1a-partial-20261015/` (README-DO-NOT-USE).

## 2. Ortam

- **Hedef makine:** Windows 10 Home 22H2, build 10.0.19045.6466, x64.
  - i7-9700, 16 GiB RAM.
  - BIOS'ta VT-x kapalı. Hyper-V ve Windows Sandbox yok.
  - Son güvenlik güncellemesi Kasım 2025; ESU sona erdi (bkz. H1).
- **Çalıştırılacak iş yükü:** Node.js v24.20.0 ve npm 11.19.0.
  - Kopyaları `%LOCALAPPDATA%\UASCO\sbx\runtime\` altında hazır.
  - `node.exe` sha256: `5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5`
- **Sandbox kökü:** `%LOCALAPPDATA%\UASCO\sbx\` (`bin\`, `runtime\`, `work\`).
- **Bilinen host riskleri** (uzmanın raporunda dikkate alınmalı):
  - Eksik çekirdek yamaları.
  - Codex'ten kalan `CodexSandbox*` hesapları ve ACE'leri.
  - `%TEMP%` üzerindeki öksüz SID.
  - IObit sürücüleri.
  - Ayrıntı: değerlendirme raporunun 1. bölümü ve C-10.

## 3. İstenen teslimatlar

### D1: İzolasyon katmanı
İki yoldan biri seçilir:
- **(a)** Uzmanın yazdığı veya incelediği bir launcher. Gereksinimler değerlendirme raporunun 3.1-3.5, 5 ve 6. bölümlerinde: sıfır yetenekli AppContainer/LPAC, Job Object sınırları, ayrı masaüstü, minimal ortam, kontrollü çalışma kopyası.
- **(b)** Bakımı süren, tanınmış bir izolasyon aracı veya VM tabanlı bir yol. Yönetici yetkisi, sürücü, BIOS ya da Pro yükseltmesi gerektiriyorsa **ayrıca Founder onayı gerekir**; bu paket o izni vermez.

Her iki yolda da P-SBX-1..5 kapsamı aşılmaz: yönetici yetkisi yok, capability yok, ACL değişiklikleri yalnız sandbox kökünde.

### D2: Negatif izolasyon doğrulaması
Testleri uzman tasarlar ve çalıştırır. En az şu kategoriler kapsanmalı. Değerlendirme raporunun 4. ve 12. bölümleri asgari kontrol listesi olarak kullanılır.
1. Host dosya sistemi ve kullanıcı profili
2. Kimlik bilgileri: Claude, git, SSH, tarayıcı oturumları
3. UASCO Trust Kernel kayıtları ve kanonik repo
4. Başka projeler ve başka run'lar arasında yatay erişim
5. Ağ: internet, LAN, loopback, isim çözümleme
6. Süreç ve host: süreç oluşturma sınırı, job dışına çıkma, başka süreçlere erişim, kalıcılık
7. Kullanıcı oturumu ve UI
8. Kaynak sınırları: CPU, RAM, disk, süre, süreç sayısı
9. Fail-closed davranışı: sandbox yoksa veya self-test başarısızsa çalıştırma BLOCKED olmalı

### D3: Kanıt
- **Her test için:** test kimliği, kategori, amaç, beklenen sonuç, gözlenen sonuç (hata kodlarıyla), hüküm (CONTAINED / ESCAPED / INCONCLUSIVE), zaman damgası.
- **Ortam parmak izi:** OS build ve UBR, launcher ikilisi ve kaynak sha256, `node.exe` sha256, test paketi sha256.
- **Rapor:** imzalı veya kimliği doğrulanabilir bir dış rapor. Gizli dosya içerikleri rapora konmaz.

## 4. UASCO ile entegrasyon sözleşmesi
Ürün tarafını UASCO, kendi implementer + bağımsız reviewer düzeniyle yazar.
- **Komut arayüzü:** `run` (profil adı, çalışma dizini, runtime dizini, limitler, zaman aşımı, komut), `cleanup`, `selftest`.
- **Çıktı:** stdout'a tek satırlık JSON sonuç. Alanlar: sonuç durumu, çıkış kodu, limit ihlali türü, süre, kanarya sonuçları.
- **Hash sabitleme:** UASCO ikilinin sha256'sını korumalı bir yapılandırmaya sabitler. Uyuşmazlıkta sonuç `BLOCKED(SANDBOX_UNAVAILABLE)` olur.
- **Self-test:** her uygulama açılışında ve her run'dan önce çalışır (C-12). Başarısızsa `BLOCKED(SANDBOX_SELFTEST_FAILED)`.
- **Yeniden sertifikasyon:** OS build veya UBR, launcher hash'i ya da node hash'i değişirse D2 paketi yeniden geçene kadar BLOCKED.

## 5. Kabul kuralları (M1 FULL READY kapısı)
1. D2'nin her kategorisinde **0 ESCAPED ve 0 INCONCLUSIVE**.
2. UASCO'nun bağımsız Claude reviewer'ı D3 kanıtını tutarlılık açısından inceler. Bu inceleme kanıtı doğrular; testin yerine geçmez.
3. Founder açık onay verir.
4. Bunlardan biri eksikse M1 FULL READY işaretlenmez (Founder koşulu 6). M1a ara sürümü bu kapıdan bağımsızdır, ama kod çalıştırma içermez.

## 6. Founder'dan beklenen
- Uzman veya laboratuvar seçimi ve sözleşmesi. Bu bir dış ticari karardır; UASCO yapmaz.
- D1 için (b) yolu seçilirse ilgili kurulum veya sistem değişikliği onayı.
- Host riskleri H1-H5 için yönetici işlemlerine karar.
