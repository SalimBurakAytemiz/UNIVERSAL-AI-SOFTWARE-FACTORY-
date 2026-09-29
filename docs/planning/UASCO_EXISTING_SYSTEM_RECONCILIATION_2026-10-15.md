# UASCO — Mevcut Sistem Uzlaştırma ve İlk Kullanılabilir .exe (2026-10-15)

- **Karar:** FD-REFOCUS-EXISTING-SYSTEM-2026-10-15 — mevcut Claude Code ajanları, dev araçları, QA, Security ve bağımsız review ile UASCO'yu tamamla ve kurulabilir .exe olarak teslim et. Ek fiziksel makine, Hyper-V, VPS, Managed Agents, yeni API faturalaması, harici güvenlik laboratuvarı **zorunlu teslimat şartı değil**.
- Bu belge salt okunurdur; gerçek koda (v2-m1a @ `2176741`, M1A-MODE c2 CLEAN) dayanır. Yeni altyapı önerilmiyor.

## 1. Mevcut mimarinin ZATEN karşıladıkları (yeni altyapı olmadan)

| Yetenek | Durum | Kanıt |
|---|---|---|
| Kurulabilir .exe, açılış | **Var** | INT-R4 + M1A-MODE paketli kabul: normal klasöre kurulum, sandbox açık başlatma, health VERIFIED |
| İlk açılış sihirbazı + rehberli Claude bağlantısı | **Kısmen var** | Ayarlar profil durumu + login komutu; Setup Wizard paketi planlı (K-1) |
| Proje oluştur → gereksinim | **Var** | Studio UI + Work OS |
| **AI ile gerçek kaynak kod üretimi** | **Var, ZATEN kapsanmış** | Builder `CLAUDE_TOOL_POLICY_SANDBOX`: yalnız Read/Edit/Write, `denyHostShell: true`, Bash/Web/MCP **yasak**. Yani kod üretimi host'ta komut çalıştırmaz, yalnız çalışma alanında dosya düzenler. |
| Bağımsız Claude review | **Var** | Reviewer salt okunur (Read/Glob/Grep), ayrı CLAUDE_CONFIG_DIR |
| Statik güvenlik taraması | **Var** | gitleaks/trivy yalnız dosya okur |
| Gerçek kaynak çıktısının teslimi | **Var** | M1A-MODE c2 deterministik per-run teslim artefaktı (runId+sourceCommit+exportArtifactHash), Desktop'tan alınır |
| Dürüst durum modeli | **Var** | SOURCE_GENERATION_COMPLETE ≠ PRODUCT_VERIFIED; COMPLETE için PRODUCT_VERIFIED şart |

**Sonuç:** İlk kullanılabilir akışın **büyük kısmı mevcut sistemle, ek altyapı olmadan teslim edilebilir durumda:** kur → aç → Claude bağla → proje oluştur → **AI gerçek kod üretir** → bağımsız review → statik güvenlik → gerçek kaynak çıktısını al.

## 2. Son görüşmelerde eklenenlerin Master ile karşılaştırması (dürüst)

| Öğe | Nereden geldi | Zorunlu mu? |
|---|---|---|
| FD-REL-1-REJECT (AI/güvenilmeyen kodu host'ta OS izolasyonu olmadan çalıştırma) | **Sizin kararınız** (bu görüşme serisi, 2026-10-15) — gerçek bir Founder güvenlik kararı | Geçerli bir güvenlik kontrolü; izinsiz kaldırmam |
| Ayrı fiziksel worker | Benim FD-REL-1 için **önerdiğim uygulama** | **Zorunlu değil** — siz onaylamadınız; askıya alındı |
| Managed Agents / bulut | Benim araştırdığım aday | **Zorunlu değil** — PoC durduruldu, harcama yok |
| Harici güvenlik laboratuvarı | Benim önerdiğim doğrulama | **Zorunlu değil** — yalnız "tam yazılım fabrikası" iddiası için gerekliydi |

Bu ağır çözümlerin hiçbirini yeni bir teslimat engeli olarak dayatmıyorum. Önceden mevcut Master'da yoklardı.

## 3. Tek gerçek, kanıtlı karar noktası

Mevcut sistemde güvenilmeyen/AI-üretimi kodun **gerçekten çalıştığı tek yer** iki adımdır:
1. **Üretilen projenin testlerini çalıştırma** (runner VERIFY/REGRESSION).
2. **Canlı önizleme** (Studio dev-run — `devrun.ts` `gate.provider.spawn`).

Kod kanıtı: her ikisi de `execution-gate.ts`'ten geçer; **doğrulanmış sandbox sağlayıcısı olmadığından üretimde her zaman BLOCKED(SANDBOX_UNAVAILABLE)** döner — host'ta asla çalışmaz. Bu kapı, **sizin kendi** FD-REL-1 kararınızı uygular.

**Çelişki (bunu size taşımam gerçek bir zorunluluk):** İki Founder kararınız şu an çatışıyor —
- **FD-USER-READY (F2-direct):** ilk sürümde güvenli **test ve canlı önizleme çalışmalı**.
- **FD-REL-1 + FD-REFOCUS:** AI kodu host'ta izolasyonsuz çalışmasın **ve** izolasyon için ek altyapı zorunlu olmasın.

Bu makinede yerleşik OS izolasyonu yok (Windows 10 Home, VT-x kapalı, Hyper-V/Sandbox yok — doğrulandı). Dolayısıyla "ek altyapı olmadan" **ve** "güvenli test/önizleme çalışsın" aynı anda mümkün değil. Mevcut araçlarla seçenekler:

- **Seçenek 1 — Şimdi teslim edilebilir (önerilen):** İlk gerçek kullanılabilir UASCO.exe'yi, üretilen kodun **test ve önizleme çalıştırması hariç** her şey çalışır halde teslim et. Bu iki adım dürüstçe **NOT_EXECUTED / NOT_VERIFIED** görünür (M1A-MODE modeli bunu zaten yapıyor). Kullanıcı: kurar, açar, Claude bağlar, proje oluşturur, **AI gerçek kod üretir**, bağımsız review + statik güvenlik alır, **gerçek kaynak çıktısını indirir**. Ek altyapı yok, güvenlik kontrolü kaldırılmaz. Sonraki güncellemede test+önizleme eklenir.
- **Seçenek 2 — Sizin açık onayınızla:** Üretilen kodun testlerini/önizlemesini **host'ta çalıştırmayı** kabul edersiniz (FD-REL-1'i gevşetir). Risk: güvenilmeyen/AI kodu izolasyon olmadan sizin makinenizde çalışır. Bunu izinsiz yapmam; kararı ve riski size bırakırım.
- **Seçenek 3 — Ek altyapı:** fiziksel worker / bulut / VM. Siz bunları zorunlu istemediğiniz için **önermiyorum**.

## 4. Önerilen plan (mevcut sistemle, ilk .exe'yi teslim)

1. M1A-MODE c2 (CLEAN, `2176741`) → entegre tip.
2. Setup Wizard + rehberli Claude bağlantısı (K-1) + USER_READY_INSTALLER kabul kapısının **çalıştırma gerektirmeyen** maddeleri.
3. Installer'ı üret (imzasız, kaynak commit + SHA-256 + bağımsız artefakt review).
4. Size tek live-merge onay paketi + kurulum talimatı.
5. Test+önizleme çalıştırması: Seçenek 1'de NOT_VERIFIED etiketli; sonraki güncellemede ele alınır.

## 5. Değişmeyenler
- Geçerli güvenlik kontrolleri (execution gate, builder tool-policy, reviewer izolasyonu, Trust Kernel, fail-closed) **kaldırılmadı**.
- Çalışan işler korunuyor: M1A-MODE CLEAN, INT-R4, QA, reviewer, installer, Desktop.
- Yeni altyapı araştırması ve harcamalı PoC **durduruldu**; hiçbir harcama/bağlantı olmadı.
