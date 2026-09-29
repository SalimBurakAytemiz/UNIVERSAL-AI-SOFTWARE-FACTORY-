# UASCO M1 Sandbox: Onay Paketi (2026-10-15)

- **Hazırlayan:** supervisor (Claude). Bu belge bir karar talebidir; hiçbir izin kullanılmadı, hiçbir sistem değişikliği yapılmadı.
- **Dayanak rapor:** `docs/planning/UASCO_M1_SANDBOX_ISOLATION_ASSESSMENT_2026-10-15.md` (sha256 `d7282fb93dbe2d6104ddc8411d51c4788be085c68d2440fc103d02ebc0a7193c`). Bölüm 12'de bağımsız eleştirmen notları var.
- **Founder kararı:** FD-REL-1-REJECT-HOST-EXEC-2026-10-15. AI'ın ürettiği kod ya da güvenilmeyen proje kodu, doğrulanmış OS izolasyonu olmadan çalıştırılmaz. Sandbox yoksa çalıştırma BLOCKED olur.

## A. Kısa bulgular

1. **Bilgisayar:** Windows 10 Home 19045.6466.
   - Windows Sandbox ve Hyper-V bu sürümde yok.
   - BIOS'ta VT-x kapalı.
   - WSL, Docker ve VM kurulu değil.
   - Bu yüzden VM ya da konteyner kullanan her yol şunlardan birini veya birkaçını gerektirir: ücretli Pro yükseltmesi, BIOS değişikliği, yönetici yetkisi, sürücü kurulumu.
2. **Seçilen yöntem:** Windows'un kendi AppContainer (LPAC, sıfır capability) + Job Object + ayrı masaüstü mekanizması, yani "UASCO SBX broker".
   - Yönetici, kurulum ve yeniden başlatma gerekmez.
   - Ağ varsayılan olarak kapalıdır.
   - CPU, RAM, süreç sayısı ve süre için sert sınır konur. Disk yalnız izlenir.
   - **Henüz doğrulanmadı.** Deneme (spike) aşamasında model güvenlik sınıflandırıcısı ajanı durdurdu ve ajan yeniden denemedi. Sistemde hiçbir artık kalmadı; doğrulandı.
3. **Kritik yeni bulgu (C-01/C-02), sandbox'tan bağımsız:**
   - LOCAL_CLAUDE builder ve reviewer, Claude CLI'ı proje klasöründe çalıştırıyor. CLI, projedeki `.claude/settings.json` dosyasını yükleyebiliyor; bu dosyadaki hooks, `apiKeyHelper` ve MCP ayarları komut çalıştırabilir.
   - Yani içe aktarılan güvenilmeyen bir proje, bilgisayarınızda kod çalıştırabilir. Bu, D-REL-1'in doğrudan ihlali olur.
   - Builder'ın yazdığı `.claude` dosyaları reviewer'a da ulaşabiliyor.
   - Kapatmak için SBX-8 "builder confinement" paketi gerekiyor. Bu paket korumalı `scripts/claude-builder-broker.mjs` dosyasını değiştirir, bu yüzden FA gerekir.
4. **Önizleme riski (C-04):** PS-1B, önizlemeyi varsayılan tarayıcınızda açıyor (`shell.openExternal`). Bu durumda üretilmiş JS gerçek tarayıcı profilinizde, oturumlarınızla birlikte çalışır. M1 için önizlemenin izole bir Electron bölmesine alınması öneriliyor.
5. **Host riskleri** (sandbox'tan bağımsız; yönetici işlemi olduğu için yalnızca siz yapabilirsiniz):
   - Son güvenlik yaması Kasım 2025 (KB5071959). Windows 10 tüketici ESU 13 Eki 2026'da bitti. AppContainer çekirdeği host ile paylaştığı için gücü çekirdek yamalarına bağlıdır.
   - Codex'ten kalan `CodexSandboxOffline` ve `CodexSandboxOnline` hesapları **etkin**. Bağlı oldukları grubun `.claude` (kimlik bilgileri dahil), tarayıcı profilleri ve UASCO depoları üzerinde okuma yetkisi var.

## B. Onaylanacak izinler (yönetici yetkisi gerektirmez)

- **P-SBX-1:** "UASCO'nun, yalnız `salim` kullanıcısı için, adı `uasco.sbx.` ile başlayan AppContainer profillerini `CreateAppContainerProfile` ile oluşturmasına ve `DeleteAppContainerProfile` ile silmesine izin veriyorum. Bu profillere hiçbir capability (internetClient, privateNetwork dahil) verilmeyecek. Başka AppContainer profillerine dokunulmayacak."
- **P-SBX-2:** "UASCO'nun `%LOCALAPPDATA%\UASCO\sbx\` dizinini oluşturmasına izin veriyorum. UASCO yalnız bu dizinin altında ve yalnız ilgili `uasco.sbx.*` AppContainer SID'i için ACE ekleyebilir. Başka hiçbir dosya, dizin veya registry anahtarının ACL'ı değiştirilmeyecek."
- **P-SBX-3:** "Mevcut `C:\Program Files\nodejs\node.exe` (v24.20.0) ve `node_modules\npm` dosyalarının `%LOCALAPPDATA%\UASCO\sbx\runtime\` altına kopyalanmasına izin veriyorum. Kopyaların SHA-256 değerleri sabitlenecek. İndirme yapılmayacak ve `Program Files` değiştirilmeyecek."
- **P-SBX-4:** "Sistemde zaten bulunan `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` ile repodaki kaynaktan `uasco-sbx-launcher.exe` derlenmesine izin veriyorum. Çıktı `%LOCALAPPDATA%\UASCO\sbx\bin\` altında olacak ve hash'i sabitlenecek."
- **P-SBX-5:** "SBX-1 spike'ının ve negatif test paketinin bu bilgisayarda çalıştırılmasına izin veriyorum. Sandbox içinden şu konumlara yalnız açma/listeleme denemesi yapılacak; içerik okunmayacak, yazdırılmayacak, hash'lenmeyecek: `.claude`, `.gitconfig`, tarayıcı profilleri, `Desktop\UASCO`, `UASCO-recovery`, `UASCO-wt`, `%APPDATA%\UASCO`, `E:\`. Pozitif kontroller yalnız UASCO'ya ait sahte dosyalarla yapılacak. `E:\pro_yedek_20261008` dizinine sandbox dışından hiç dokunulmayacak."
- **P-SBX-6 (FA-SBX-2026-10-15, korumalı dosyalar):** "SBX-0..SBX-8 paketleri için şu korumalı dosyaların değiştirilmesine izin veriyorum: `scripts/claude-builder-broker.mjs` (SBX-8 builder confinement), `apps/desktop/main.mjs` (SBX-6 önizleme bölmesi), `apps/control-api/src/server.ts`, `config/validation.json` (test ekleme), `config/trust-root-manifest.json` (yalnız reseal). Şunlar değiştirilmeyecek: `config/builder-execution-policy.json`, `config/environment-policy.json`, `automation/lib/**` (`claude-reviewer.mjs` ve `git-isolation.mjs` dahil; ürün yolunda gereken sertleştirme `core/workos` içindeki çağrı noktalarında yapılacak)."

## C. Ürün ve kapsam kararları

- **D-REL-1 (kapanış kaydı):** "Üretilmiş kod, R0-R4 risk seviyelerinin tümünde yalnız doğrulanmış sandbox içinde çalışır. Sandbox yoksa sonuç BLOCKED olur. R3/R4 ayrıca reddedilmeye devam eder."
- **D-SBX-6:** Sandbox yokken bir run ne yapacak?
  - (i) VERIFY'da BLOCKED olarak durur. **Önerilen budur.**
  - (ii) Yalnız statik tarama ve review ile ilerler; çıktı "test çalıştırılmadı / NOT_VERIFIED" etiketini taşır.
- **D-SBX-7 (genişletildi):** "M1'de önizleme yalnız statiktir ve izole bir Electron bölmesinde (ayrı partition, preload/node yok, dış istek yok) açılır. Varsayılan tarayıcıda açılmaz. HMR dev sunucusu M1.1'e ertelenir." Bu karar, PS-1B'nin `openExternal` seçimini tersine çevirir.
- **D-SBX-8:** M1'de yalnız node/npm desteklenir. Python ve diğerleri `BLOCKED(TOOLCHAIN_NOT_SANDBOXED)` olur.
- **D-SBX-9:** Ağ izni yalnız `https://registry.npmjs.org/` içindir ve yalnız broker'ın host tarafındaki `npm ci --ignore-scripts` adımında kullanılır: temiz bir staging dizini, `--no-audit`, proje `.npmrc` dosyası yok. Sandbox içinde ağ hiç yoktur. Her yeni adres ayrı bir karar gerektirir.
- **D-SBX-10 (önemli, yönetişim):** UASCO'nun kendi geliştirmesi D-REL-1 kapsamında mı?
  - (a) **Önerilen:** UASCO'nun kendi repo geliştirmesi D-REL-1 dışında kalır ve host'ta testlerini ve build'ini çalıştırmaya devam eder. Koşullar: Claude implementer + bağımsız Claude reviewer, korumalı kapılar, incelenmiş lockfile, FA-V2-PRODUCT. D-REL-1, fabrikanın ürettiği, müşteriye ait ve içe aktarılan proje kodu için geçerlidir. Bugün M0'ı ve PS-1B/merge tool/REL-FX işlerini sürdürmemizi istemeniz bu yorumla uyumlu; yine de açık kaydınızı istiyorum.
  - (b) UASCO'nun kendi testleri de sandbox'a alınır. Bu durumda sandbox hazır olana kadar geliştirme durur.
- **D-SBX-11:** Builder ve reviewer için Claude yapılandırması.
  - (a) M1 asgarisi: `--setting-sources user`, `--strict-mcp-config`, `--disable-slash-commands`, `--no-session-persistence`. Ayrıca içe aktarma ve builder çıktısında `.claude/**`, `.mcp.json` ve `CLAUDE*.md` reddedilir veya karantinaya alınır.
  - (b) **Daha güçlü:** UASCO'ya ayrılmış bir Claude yapılandırma profili (`CLAUDE_CONFIG_DIR`). Bu durumda kişisel hook, izin ve hafızanız builder/reviewer oturumlarına geçmez. Profil için bir kez sizin giriş yapmanız gerekir.

## D. Host güvenliği (yönetici işlemi olduğu için yalnızca siz yapabilirsiniz; UASCO bunları yapmaz)

- **H1 (HIGH):** Güvenlik yamaları. Son yama Kasım 2025, Windows 10 ESU bitti. Seçenek: Windows 11'e yükseltme. İşlemci uyumlu; TPM durumu UNKNOWN. Yükseltme olursa sandbox'ın yeniden sertifikasyonu gerekir.
- **H2 (HIGH):** Codex artıklarının temizliği: `CodexSandboxOffline` ve `CodexSandboxOnline` hesapları, `CodexSandboxUsers` grubunun ACE'leri, `.sbx-denybin` ve `openai.codex` AC profili. Önce `icacls /save` ile yedek alınmalı.
- **H3 (MEDIUM):** `%TEMP%` üzerindeki öksüz SID'in Modify ACE'si.
- **H4 (MEDIUM):** `E:\pro_yedek_20261008` üzerindeki Authenticated Users Modify yetkisi.
- **H5 (LOW):** Öksüz loopback muafiyeti.

İsterseniz bunların her biri için kesin komutları ve geri alma adımlarını ayrı bir belgede hazırlarım; bu komutları siz çalıştırırsınız.

## E. İstenmeyen / verilmemesi gerekenler

Yönetici veya UAC yükseltmesi, BIOS'ta VT-x açılması, Pro yükseltmesi, Hyper-V/Windows Sandbox/WSL özelliklerinin açılması, VirtualBox/Docker veya sürücü kurulumu, firewall ya da `CheckNetIsolation` değişiklikleri, sandbox'a `internetClient` capability'si verilmesi, uzak worker veya bulut hesabı, host üzerinde sandbox'sız kod çalıştırma.

## F. Geri alma (P-SBX-1..5 için, yönetici gerekmez)

1. Sandbox provider kapatılır ve çalıştırma BLOCKED'a döner.
2. Tüm `uasco.sbx.*` profilleri için `DeleteAppContainerProfile` çalıştırılır.
3. `%LOCALAPPDATA%\UASCO\sbx\` silinir.
4. HKCU AppContainer Mappings ve `%LOCALAPPDATA%\Packages` altında `uasco.sbx.*` kaydı kalmadığı doğrulanır.
5. Commit'ler geri alınır (revert).

## G. M1 ETA

Bu tahminin koşulları: onaylar 15 Eki öğlene kadar gelir, spike sınıflandırıcıya takılmadan çalışır ve 0 ESCAPED sonucunu verir, hafta sonu kurulum mümkündür.

| | Supervisor tahmini | Sentez raporu | Eleştirmen |
|---|---|---|---|
| P50 | **17 Eki Cuma ~20:00** | 16 Eki ~18:00 | 16 Eki 18:00-21:00 |
| P80 | **19 Eki Pzt ~20:00** | 17 Eki ~20:00 | 17 Eki (hafta sonu yoksa 19 Eki) |
| P95 | **22 Eki** | 20 Eki ~12:00 | 21 Eki ~12:00 |

- **Supervisor tahmini neden daha temkinli:**
  - SBX-8 paketi eklendi.
  - Ölçülmüş geçmişimizde adversarial güvenlik paketleri 3-5 review döngüsü sürdü (PS-1B 5, merge tool 5+). Rapor 2-3 döngü varsaydı.
- **Spike başarısız olursa** tarih UNKNOWN olur. VM yolu BIOS, Pro ve kurulum onaylarından sonra +3-6 gün sürer.
- **M1a (çalıştırmasız ara sürüm):** P50 16 Eki ~12:00, P80 16 Eki ~22:00. M1 tanımını karşılamaz.
