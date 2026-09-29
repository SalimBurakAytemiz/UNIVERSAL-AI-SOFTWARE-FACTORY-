# UASCO — Güncellenmiş Kurulabilir Desktop (0.7.0-dev.2) · Kurulum Talimatı (2026-10-16)

Bu, kurduğunuz 0.7.0-dev.1'in **güncellenmiş** sürümüdür: premium Desktop (Founder Cockpit, Kontrol Kulesi 2D, canlı roller, canlı Company OS, gerçek Delivery, premium Projeler) + kanıtlanmış pre-dev→kod-üretim otonom zinciri backend'i, tek kurulabilir Desktop'ta. Bağımsız artefakt review'dan **CLEAN** geçti. Tam F2 değildir.

## Artefakt kimliği

| Alan | Değer |
|---|---|
| Kesin yol | `C:\Users\salim\UASCO-wt\v2-masterint-build\dist-installer\UASCO-Setup-0.7.0-dev.2-win-x64.exe` |
| SHA-256 | `72708db0e82a0546f6ef63b2e97619c93b3ce52e127ccb3ac784f285d9cc40f9` |
| Boyut | 110.698.471 bayt |
| Sürüm | 0.7.0-dev.2 (önceki: 0.7.0-dev.1) |
| Uygulama kimliği | com.uasco.desktop · productName UASCO |
| Kaynak commit | `b19a7ef9f67a3b0af7ca0a7f272db72638cb806a` (master-entegrasyon `0414d45` + sürüm) |
| İmza | İmzasız (NotSigned) — kişisel geliştirme sürümü |
| Bağımsız artefakt review | **CLEAN** (wf_d870dbcd-c26): 1117 unpacked dosya bağımsız yeniden derlemede **bire bir aynı**, köken temiz, gizli bilgi yok, çalıştırma kapısı fail-closed, release kimliği doğru |

## Kurulum adımları

1. **Hash doğrulaması** (Git Bash) — aşağıdaki değerle birebir aynı olmalı:

```bash
sha256sum "C:/Users/salim/UASCO-wt/v2-masterint-build/dist-installer/UASCO-Setup-0.7.0-dev.2-win-x64.exe"
```

2. Dosyaya çift tıklayın. İmzasız olduğu için SmartScreen çıkarsa **"Ek bilgi" → "Yine de çalıştır"**. Yönetici yetkisi gerekmez (kullanıcı kurulumu).
3. Bu, 0.7.0-dev.1 ile **aynı uygulama kimliğini** (com.uasco.desktop, `%LOCALAPPDATA%\Programs\UASCO`) kullanır; mevcut kurulumun üzerine güncelleme olarak kurulur. Kullanıcı verisi `%APPDATA%\UASCO` korunur.
4. UASCO Desktop'ı açın.
5. Kaldırma: Ayarlar → Uygulamalar → UASCO.

## Bu güncellemede NE YENİ (dev.1 → dev.2)

- **Premium Founder Cockpit** (onayladığınız neon referans estetiği; KPI kartları, aktivite zaman çizelgesi, status pills).
- **Kontrol Kulesi 2D** operasyon haritası — **canlı rol kataloğu** verisine bağlı (3D GPU-gated/yok; 2D + erişilebilir liste).
- **Canlı Company OS** görünümü (CRM/Finans/Hukuk — gerçek `/v1/company/*`).
- **Gerçek Delivery & SRE** görünümü (release readiness gerçek veriden; gerçek deploy + canlı SRE dürüstçe **BLOCKED**, sahte buton/metrik yok).
- **Premium Projeler/Portföy/Studio** (portföy özeti, proje yolculuğu, çoklu-proje matrisi — hepsi gerçek backend'e bağlı).
- **Backend otonom zinciri:** tipli PRE_DEV sözleşmeleri + doğrulayıcılar + sürücü + rol-prompt'ları + TaskHub referansı — gerçek bir web+backend+API+DB projesini analiz→kod-üretim→paketleme→tarama zincirinden kaynak seviyesinde geçirdi (kanıt: `TASKHUB_PREDEV_E2E_EVIDENCE.md`, `TASKHUB_CODEGEN_EVIDENCE.md`).

## Bu sürümde NE ÇALIŞIR
- Kurulum, açılış, premium gezinme, gerçek Work OS backend bağlantısı, ACİL DURDUR, Ctrl+K arama.
- Proje oluşturma/yönetimi (Project Studio), **AI ile gerçek kaynak kod üretimi** (Claude bağlı; kod üreten AI host'ta komut çalıştırmaz), bağımsız Claude review, statik güvenlik taraması, üretilen gerçek kaynağın deterministik hash'li dışa aktarımı.
- Canlı veri + dürüst boş/UNAVAILABLE durumlar (sahte veri yok).

## Bu sürümde NE ÇALIŞMAZ (dürüst durum — değişmedi)
- **Üretilen kodun testlerinin çalıştırılması + canlı önizleme:** **NOT_EXECUTED / NOT_VERIFIED**. Sebep: FD-REL-1 güvenlik kararınız — güvenilmeyen/AI kodu doğrulanmış izolasyon olmadan host'ta çalışmaz; çalıştırma kapısı fail-closed `BLOCKED(SANDBOX_UNAVAILABLE)`. Görevler ürün düzeyinde **COMPLETE/PRODUCT_VERIFIED** olmaz; yalnız **SOURCE_GENERATION_COMPLETE**.
- 252 ekranın ~124'ü hâlâ **tasarlı ama inşa edilmemiş** (P0 çekirdeği önceliklendiriliyor).
- Tam premium 3D, kod imzalama/otomatik güncelleme, 7/24 uzaktan çalışma yok.
- **Tam F2 / tam yazılım fabrikası değildir** ve öyle sunulmaz.

## Güvenlik
- Mevcut kontroller kaldırılmadı: çalıştırma kapısı fail-closed (sandbox sağlayıcısı gönderilmiyor), builder araç-politikası sandbox'ı, reviewer izolasyonu, Trust Kernel, supply-chain mühürleri. Bağımsız artefakt review bunları doğruladı.
- İmzasız; otomatik güncelleme yok; güncellemeler doğrulanmış yeni installer ile gelir.
