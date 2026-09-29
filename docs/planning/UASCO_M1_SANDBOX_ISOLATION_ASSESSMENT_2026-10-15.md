# UASCO M1 Sandbox / İzolasyon Değerlendirmesi (D-REL-1 kararı sonrası)

- **Tarih:** 2026-10-15, yaklaşık 05:35 TSİ (02:35 UTC)
- **Rol:** sentez yazarı (supervisor tarafı). Ürün kodu yazılmadı. Sistem, ACL, registry, firewall ve özellik değişikliği yapılmadı. Hiçbir sandbox/kaçış probu çalıştırılmadı.
- **Founder kararı (2026-10-15):** AI tarafından üretilmiş veya güvenilmeyen proje kodu, ana Windows ortamında işletim sistemi izolasyonu olmadan çalıştırılmaz. Bu karar yönetici yetkisi, kurulum, sürücü veya güvenlik politikası değişikliği izni vermez.
- **Kanıt kaynakları:**
  - `C:/Users/salim/UASCO-recovery/product/sbx/SBX-00-host-capabilities.md` (sha256 `72a44a73ee71d3d42375e9094ff16aa2822fd181577076817aedd0b71dcc5c07`) ve `.json` (sha256 `32d4ebf341ba4c65510cfee3a040b65504b3c02b8feb5c125269119bffc6f8a4`). Ham kanıt ve SHA256SUMS: `sbx/raw/`.
  - İki bağımsız seçenek analizi: "izolasyon gücü" ve "en az kurulum / en hızlı güvenli teslim". Bu sentezin girdisi olarak verildi; ayrı dosya değil.
  - `C:/Users/salim/UASCO-recovery/product/eta2-measured-data.md` (ölçülmüş hız)
  - `C:/Users/salim/UASCO-wt/m1-spike/REHEARSAL-REPORT.md` (D-M1-01..10)
  - `C:/Users/salim/UASCO-recovery/product/rel/REL-FIRST-EXE-P0.md` ve `REL-WK-00-part2-rel117-168.md` (REL-FX-1..5, REL-168)
  - `C:/Users/salim/Desktop/UASCO/docs/planning/UASCO_DESKTOP_DELIVERY_ETA_2026-10-15.md` (önceki M1 tarihleri)
- **Bulunamayan kanıt:** Görev metni bir "spike" ve "escape test" kanıtından söz ediyordu. Ancak `UASCO-recovery/product/sbx/spike/SBX-01-spike-report.md` mevcut değil. 05:32 TSİ'de `UASCO-recovery` ve `UASCO-wt` altında `*SBX*`, `*escape*` ve `*appcontainer*` araması yapıldı; yalnız SBX-00 bulundu. **Bu yüzden bu belgedeki tüm negatif test sonuçları ÇALIŞTIRILMADI (INCONCLUSIVE) olarak işaretlidir.**

---

## 0) Yönetici özeti

1. **Seçilen yöntem: native Windows AppContainer (LPAC, sıfır capability) + Job Object + ayrı masaüstü.** Bu düzen "UASCO SBX broker" olarak adlandırıldı ve kontrollü çalışma kopyaları üzerinde çalışır. Neden bu yöntem:
   - Bu bilgisayar **Windows 10 Home 19045.6466**. Windows Sandbox ve Hyper-V bu sürümde yok. BIOS'ta VT-x **kapalı**. WSL, Docker ve VM ürünü kurulu değil.
   - Bu yüzden VM veya konteyner tabanlı her seçenek ücretli Pro yükseltmesi, BIOS değişikliği, yönetici yetkisi veya sürücü kurulumu gerektiriyor. Bunların hiçbiri verilen yetki kapsamında değil.
   - AppContainer ve Job Object API'leri Windows'un içinde hazır. Yönetici, kurulum ve yeniden başlatma gerektirmezler. Ağı yönetici yetkisi olmadan varsayılan olarak kapatırlar. Ayrıca Home sürümlü müşteri makinelerinde de çalışırlar.
2. **Hemen yapılacak, yetki gerektirmez: SBX-0 fail-closed kapısı.** `core/workos/runner.ts` VERIFY/REGRESSION (`runTests` 290-291, çağrı 410 ve 553) ve `core/workos/devrun.ts:272` artık host üzerinde süreç başlatmaz. Doğrulanmış sandbox yoksa sonuç `BLOCKED(SANDBOX_UNAVAILABLE)` olur; self-test başarısızsa `BLOCKED(SANDBOX_SELFTEST_FAILED)` olur. Uyarı verip devam eden bir yol yoktur. M0 installer, PS-1B c5, merge tool c5 ve REL-FX-1..5 bu karardan dolayı durmaz.
3. **Doğrulama durumu: yöntem henüz DOĞRULANMADI.** Spike ve negatif testler çalıştırılmadı (yukarıdaki not). Seçilen yöntem, negatif test paketinin tamamı (bölüm 4) `0 ESCAPED / 0 INCONCLUSIVE` sonucu verene kadar kabul edilmiş sayılmaz. O zamana kadar M1'de kod çalıştırma BLOCKED kalır.
4. **M1 ETA:** Önceki tahmin P50 16 Eki ~12:00, P80 16 Eki ~22:00, P95 18 Eki idi. Yeni tahmin:
   - **P50 16 Eki ~18:00 TSİ**
   - **P80 17 Eki ~20:00**
   - **P95 20 Eki ~12:00**

   Sandbox'ın payı yaklaşık +0,25 gün (P50), +1 gün (P80) ve +2 gün (P95). Gecikmenin bir kısmı rehearsal'da bulunan D-M1 kusurlarından geliyor. Güven düzeyi düşük-orta. Spike başarısız olursa, test ve önizleme içeren tam M1 Founder'ın korumalı bir değişikliği olmadan mümkün değildir; o durumda tarih **UNKNOWN** olur (bölüm 9).
5. **Gereken Founder izinleri:** yönetici yetkisi, kurulum, BIOS, firewall veya politika değişikliği gerekmiyor. Gerekenler yalnızca şunlar (tam metin bölüm 11'de):
   - `uasco.sbx.` önekli, kullanıcıya ait AppContainer profillerinin oluşturulup silinmesi
   - `%LOCALAPPDATA%\UASCO\sbx\` kökünün oluşturulması ve yalnız orada AppContainer SID ACE'leri eklenmesi
   - mevcut `node.exe` ve npm dosyalarının bu köke kopyalanması
   - launcher'ın sistemde zaten bulunan `csc.exe` ile derlenmesi
   - spike ve negatif testlerin bu bilgisayarda çalıştırılması
   - FA-V2-PRODUCT kapsamının SBX paketleri için teyidi
6. **Ayrı ve yüksek öncelikli host riskleri (sandbox bunları çözmez):**
   - (a) Bilgisayar KB5071959 (Kasım 2025) sonrası güvenlik yaması almamış. Tüketici ESU 13 Eki 2026'da bitti. Aynı çekirdeği paylaşan her sandbox yalnızca çekirdek yamaları kadar güçlüdür.
   - (b) Codex'ten kalan `CodexSandboxUsers` grubunun 2 hesabı **etkin**. Grup `.claude` (kimlik bilgileri dahil), tarayıcı profilleri ve UASCO depoları üzerinde okuma/çalıştırma (RX) yetkisine sahip.

   Her ikisi de Founder'ın kendisinin yapacağı yönetici işlemleridir (bölüm 11, D-SBX-H1/H2).

> **Dürüstlük notu:** Bu karar gelmeden önce, M1 rehearsal'ı (yaklaşık 01:18-02:25 UTC) o zamanki yetkiyle host üzerinde iki şey çalıştırdı:
> - bir LOCAL_CLAUDE live-smoke görevinin testleri (`src/add.js`, `return a + b;`)
> - yerleşik bir şablonun dev-run'ı (web-node, port 62194)
>
> Bundan sonra üretilmiş kodun host üzerinde çalıştırılması planlanmayacak.

---

## 1) Host yetenekleri (salt okunur bulgular)

Kaynak: SBX-00. Hiçbir şey değiştirilmedi, yönetici yetkisi gerekmedi. Gizli dosyaların içeriği okunmadı; yalnız varlık ve ACL bilgisi toplandı.

| Konu | Bulgu |
|---|---|
| Sürüm | Windows 10 Home (EditionID `Core`, SKU 101), 22H2, build **10.0.19045.6466**, x64. En son toplu güncelleme KB5071959: 11 Kas 2025 tarihli, ESU'ya kayıtlı olmayan cihazlar için çıkan band dışı güncelleme (kurulum tarihi 2026-10-11). |
| CPU / RAM / disk | i7-9700 (8 çekirdek / 8 iş parçacığı). 16,0 GiB RAM; inceleme anında boş 5,7-6,2 GiB. C: 603 GB boş, E: 1551 GB boş. |
| Sanallaştırma | SLAT=Yes, VMMonitorModeExtensions=Yes, **VirtualizationFirmwareEnabled=False** (BIOS'ta VT-x kapalı). HypervisorPresent=False, VBS=0. |
| Windows Sandbox | **YOK.** `Containers-DisposableClientVM` bu sürümde bulunmuyor (NOT_PRESENT_ON_EDITION), `WindowsSandbox.exe` de yok. |
| Hyper-V | **YOK** (`Microsoft-Hyper-V*` NOT_PRESENT_ON_EDITION). |
| WSL / VMP / HVP | Hepsi Disabled. `wsl --status` exit 50, `wsl -l -v` exit 1; dağıtım yok. |
| Docker, Podman, VirtualBox, VMware, QEMU, Vagrant, Multipass | PATH'te değiller. 61 uninstall kaydında da yoklar. vmcompute, vmms, LxssManager ve Docker servisleri de yok. |
| Uzak worker | Bulunamadı (`.ssh` yok, docker context yok). |
| AppContainer + Job API | **VAR, yönetici gerekmiyor.** `userenv.dll` şu fonksiyonları sağlıyor: `CreateAppContainerProfile`, `DeriveAppContainerSidFromAppContainerName`, `DeleteAppContainerProfile`, `GetAppContainerFolderPath`. `kernel32.dll` şunları sağlıyor: `CreateJobObjectW`, `SetInformationJobObject`, `AssignProcessToJobObject`, `InitializeProcThreadAttributeList`, `UpdateProcThreadAttribute`. Sistemle gelen `csc.exe` (.NET Fx 4.x, Framework64) mevcut. |
| Ağ | Firewall üç profilde de ON. Sıfır capability'li yeni bir AppContainer'ın internet, LAN ve loopback erişimi varsayılan olarak kapalıdır. Adres bazlı izin listesi ise yönetici yetkisi ister. |
| Toolchain | node v24.20.0, npm/npx 11.19.0. `C:\Program Files\nodejs` dizininin DACL'ı korumalı ve **AppContainer ACE'si içermiyor**, yani sandbox host'taki node.exe'yi çalıştıramaz; UASCO'ya ait bir kopya gerekir. git 2.56.0: AC için RX miras olarak var. python 3.13.14 bir Store alias'ı; AC'den kullanılamaz. |
| Token | salim, Medium IL. Administrators SID var ama UAC tarafından filtrelenmiş (IsAdmin=False). |
| Korunan konumların AC erişimi | Şu konumların üst seviyesinde ve ilk alt seviyesinde ALL APPLICATION PACKAGES veya ALL RESTRICTED APPLICATION PACKAGES ACE'si **yok**: USERPROFILE, Desktop, `.claude`, `.gitconfig`, Chrome/Edge/Mozilla profilleri, `Desktop\UASCO`, `UASCO-recovery`, `UASCO-wt`, `%TEMP%`. Daha derin seviyeler **kontrol edilmedi** ve negatif testlerle kanıtlanması gerekir. |

### Anomaliler (sandbox seçiminden bağımsız host riskleri)

| ID | Önem | Bulgu | Gereken |
|---|---|---|---|
| A1 | **HIGH** | `CodexSandboxUsers` grubunda iki **ETKİN** hesap var: `CodexSandboxOffline` (SID -1003) ve `CodexSandboxOnline` (-1004). Grubun USERPROFILE altındaki 38 alt öğe üzerinde açık RX yetkisi var: `.claude`, Desktop, Documents, Downloads ve `UASCO-recovery` bunlardan bazıları. Ayrıca `.gitconfig` ve `UASCO-wt` üzerinde de RX var. Bu yetki `.claude\.credentials.json` dosyasına, Chrome/Edge/Firefox profillerine ve `Desktop\UASCO`'ya miras olarak geçiyor. Grubun `%TEMP%` üzerinde Modify yetkisi var. Ek olarak `%USERPROFILE%\.sbx-denybin` dizini ve `openai.codex` AC profili duruyor. Codex her rolde yasak olduğu halde bu artıklar hâlâ aktif. | Founder'ın yönetici olarak temizlemesi (D-SBX-H2) |
| A2 | MEDIUM | Bu makineye ait olmayan, çözümlenemeyen bir SID (`S-1-5-21-4255099410-…-1232994424`) `%TEMP%` üzerinde Modify yetkisine sahip. Büyük olasılıkla PRO kurtarmasından kaldı. | Founder temizliği |
| A3 | INFO | Claude Desktop AppContainer'ı (`anthropicpbc.claude`) `C:\Users\salim\AppData` üzerinde FullControl yetkisine sahip; yetki Local, Roaming ve Temp'e miras olarak geçiyor. | Bilgi |
| A4 | MEDIUM | `E:\pro_yedek_20261008` yedeğinde Authenticated Users Modify yetkisine sahip (E:\ kökünden miras). Yedeğe dokunulmadı. | Founder kararı |
| A5 | LOW | Var olmayan bir AC SID için öksüz bir loopback muafiyeti duruyor. | Founder temizliği (yönetici) |
| A6 | INFO | BIOS'ta VT-x kapalı. VM tabanlı her yol fiziksel bir firmware değişikliği gerektirir. | Bilgi |
| A7 | INFO | `Program Files\nodejs` dizininde AC ACE'si yok, bu yüzden sandbox için runtime kopyası gerekiyor. | SBX tasarımına dahil |
| A8 | INFO | `%APPDATA%\Mozilla` dizininin sahibi BUILTIN\Administrators. | Bilgi |

---

## 2) Seçenek karşılaştırması (iki analizin sentezi)

İki analizde puanlar farklı ölçütlerle verildi:
- **İzolasyon puanı** (0-10): %70 izolasyon gücü ve %30 bu host üzerinde doğrulanabilirlik. Uygulanabilirlik puanı etkilemez.
- **Teslim puanı** (0-10): en az kurulum ve en hızlı güvenli teslim. Founder'ın 4-8 numaralı şartlarından birini karşılamayan seçenek düşürülür.

| Seçenek | İzolasyon | Teslim | Bu host'ta hazır mı? | Yönetici / reboot | Ağ varsayılan kapalı | Kaynak sınırları | Önizleme | M1 etkisi (tahmin) | Karar |
|---|---|---|---|---|---|---|---|---|---|
| **M1a fail-closed kapı (hiç çalıştırma yok)** | 10 (çalıştırma yok) | 8,2 | Evet (yalnız kod) | Hayır / hayır | Yok (çalıştırma yok) | Yok | **Yok** | ~0,25-0,5 gün | **ŞİMDİ (SBX-0)**. Şart 8'in zorunlu varsayılanı. Testlerin çalıştırılmasını ve önizlemeyi sağlamaz. |
| **AppContainer (LPAC) + Job + ayrı masaüstü** | 7 (aynı çekirdek) | **8,6** | **Evet, sistemle geliyor** | **Hayır / hayır** | **Evet**, sıfır capability ile internet, LAN ve loopback kapalı (WFP), yönetici gerekmez. Adres bazlı izin listesi yok. | Job: CPU hard cap, bellek, süreç sayısı, süre, kill-on-close. Disk için yalnız watchdog. | Statik önizleme mümkün. HMR için spike veya BLOCKED. | Ölçülmüş hızla +0,25 gün (P50) / +1 gün (P80) / +2 gün (P95); bölüm 9 | **SEÇİLDİ (M1)** |
| Hyper-V VM | 9,2 | 2,5 | **Hayır**: Home sürümü, VT-x kapalı | Evet / evet | Evet (vSwitch yok) | Güçlü | Evet | Ücretli Pro + BIOS sonrası +3-6 gün | Yedek seçenek (a) |
| Windows Sandbox | 9 | 2,8 | **Hayır**: Home'da yok | Evet / evet | `.wsb` dosyasında Networking=Disable; izin listesi yok | Zayıf (yalnız MemoryInMB; tek örnek) | Zayıf | Pro + BIOS sonrası +2-5 gün | Yedek seçenek (a) |
| VirtualBox / VMware VM | 7,8 | 4,3 | Hayır | Evet (**çekirdek sürücüsü**) / evet | Evet (NIC yok) | Güçlü (sabit boyutlu VDI) | Evet | BIOS ve sürücü onayı sonrası +3-6 gün | Yedek seçenek (b). Sürücü kurulumu verilen yetkiye dahil değil. |
| Geçici uzak worker (GitHub runner, Codespaces, bulut VM) | 8 | 4,4 | Hayır (mevcut worker yok) | Hayır | GitHub runner'larda **hayır**; bulut VM'de security group ile evet | Runner boyutu, timeout | Zayıf | Hesap varsa +1-3 gün, yoksa +3-6 gün | Yedek seçenek (c). **Müşteri kodu makineden çıkar**, ücretli/üretim yetkisi gerekir. |
| Docker / Podman (WSL2 üzerinde) | 6,5 | 3,6 | Hayır | Evet / evet | `--network none` | İyi | Evet | +3-7 gün | Reddedildi: birden çok korumalı kurulum, ayrıcalıklı daemon, lisans |
| WSL2 "sertleştirilmiş" | 5 | 2,2 | Hayır | Evet / evet | **Hayır**: Win10'da host'un zorladığı bir engel yok; iptables guest root'un kontrolünde | VM geneli | Evet | +2-5 gün | **Reddedildi**: şart 4 ve 5'i karşılamıyor. Guest root, drvfs ile `C:` sürücüsünü yeniden bağlayabilir. |
| Ayrı düşük yetkili Windows kullanıcısı | 4 | 1,8 | Hayır (hesap için yönetici gerekir) | Evet | **Hayır** | Job uygulanabilir | Evet | +2-3 gün | **Reddedildi**: ağ açık, parola saklamak gerekir, ACL kayması riski var (A1 bunun canlı örneği) |
| Restricted token / Low IL | 2 | 1 | Evet | Hayır | **Hayır** | Job uygulanabilir | Evet | +1-2 gün | **Reddedildi**: Low IL kullanıcı dosyalarını OKUYABİLİR (varsayılan politika yalnız NO_WRITE_UP). Yalnızca ek katman olarak kullanılabilir. |

**Puanlardaki fark nereden geliyor:** İzolasyon analizinde VM seçenekleri en yüksek puanı alıyor, çünkü ayrı bir çekirdek kullanıyorlar. Teslim analizinde ise bu host'ta hiçbiri kullanılabilir değil, çünkü ücretli yükseltme, BIOS, yönetici veya sürücü gerektiriyorlar. AppContainer, her iki analizde de ilk dört içinde olan ve **verilen yetkiyle hemen uygulanabilen tek** OS izolasyon seçeneğidir. VM'e göre zayıf noktası, çekirdeği host ile paylaşmasıdır (R1).

**Kaynaklar (seçenek analizlerinden):**
- Microsoft Learn, Windows Sandbox: yalnız Pro, Enterprise ve Education sürümlerinde. Ağ varsayılan olarak açık. Tek örnek çalışır.
- AppContainer isolation ve Implementing an AppContainer.
- Old New Thing 20220502: S-1-15-2-2 = LPAC.
- Chromium `app_container_test.cc`.
- Loopback isolation (hh780593).
- Job Objects; JOBOBJECT_BASIC_UI_RESTRICTIONS; JOBOBJECT_CPU_RATE_CONTROL_INFORMATION.
- Mandatory Integrity Control.
- WSL config: `networkingMode` ve `firewall` ayarları Win11 22H2 ve sonrası içindir.
- Docker Desktop lisansı.
- KB5071959 (19045.6466).
- Tüketici ESU bitişi: 13 Eki 2026.

Tam URL'ler seçenek analizlerinin `sources` listesinde. Bu sentez sırasında web'e yeniden erişilmedi.

---

## 3) Seçilen yöntem ve mimari: UASCO SBX broker

### 3.1 Bileşenler

```
UASCO control-api (host, Medium IL; güvenilen kod)
  └─ SandboxProvider (yeni arayüz)        ← runner.ts VERIFY/REGRESSION, devrun.ts
       ├─ verify(): self-test, launcher hash'i, profil, runtime hash'i → SANDBOX_VERIFIED | BLOCKED
       ├─ prepareWorkingCopy(): kontrollü kopya (.git yok, reparse noktası yok)
       ├─ fetchDeps(): host tarafı `npm ci --ignore-scripts` (yalnız izinli registry)
       ├─ run(argv, limits): uasco-sbx-launcher.exe → AppContainer(LPAC) + Job + ayrı masaüstü
       └─ collectOutputs(): reparse-safe kopyalama, boyut ve tür kontrolü
uasco-sbx-launcher.exe (sistemdeki csc.exe ile derlenir, SHA-256 sabitlenir)
  └─ node.exe (UASCO'ya ait kopya, hash'i sabit) ve test/build süreçleri; hepsi job içinde
```

### 3.2 Launcher, AppContainer, Job ve masaüstü

- **Profil:** her çalıştırma için rastgele bir AC adı kullanılır: `uasco.sbx.run.<128-bit hex>`. Profil `CreateAppContainerProfile` ile oluşturulur ve çalıştırma bitince `DeleteAppContainerProfile` ile silinir. Başlangıçta bir temizleyici, artık kalmış `uasco.sbx.*` profillerini siler.
- **Token:** `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` sıfır capability ile verilir. Ayrıca `PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY` ile **LPAC** kullanılır, böylece ALL APPLICATION PACKAGES okuma yüzeyi düşer.
  - LPAC node, npm veya test runner'larını bozarsa normal AC'ye **yalnız** bir AC-okunabilir-yol denetimi geçtikten sonra dönülür. Bu geçiş SBX-1 spike'ında karara bağlanır.
- **Job Object:** süreç askıda (suspended) oluşturulur, `AssignProcessToJobObject` ile job'a atanır, sonra devam ettirilir. Uygulanan sınırlar:
  - `JOB_OBJECT_LIMIT_JOB_MEMORY` ve `PROCESS_MEMORY`
  - `JOBOBJECT_CPU_RATE_CONTROL` (HARD_CAP)
  - `ACTIVE_PROCESS` (süreç sayısı sınırı)
  - `JOB_TIME` ve broker'ın duvar saati zaman aşımı
  - `KILL_ON_JOB_CLOSE`
  - `DIE_ON_UNHANDLED_EXCEPTION`
  - `BREAKAWAY_OK` ve `SILENT_BREAKAWAY_OK` **ayarlanmaz**
  - UI kısıtlamaları: HANDLES, READCLIPBOARD, WRITECLIPBOARD, GLOBALATOMS, DESKTOP, DISPLAYSETTINGS, SYSTEMPARAMETERS, EXITWINDOWS
- **Masaüstü:** süreç ayrı bir masaüstünde başlatılır (`CreateDesktop`, `STARTUPINFO.lpDesktop`). Böylece kullanıcının masaüstünün ekran görüntüsü alınamaz ve girişleri izlenemez.
- **Ortam değişkenleri:** açık ve temizlenmiş bir ortam bloğu verilir. HOME, USERPROFILE, APPDATA, LOCALAPPDATA ve TEMP yalnız çalışma kopyasını ve AC profil dizinini gösterir. Token, anahtar ve `ANTHROPIC_*` değişkenleri geçmez. `NODE_OPTIONS` ve proxy değişkenleri yoktur.
- **Handle'lar:** `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` ile yalnız stdio pipe'ları aktarılır.
- **Bütünlük:** launcher'ın, node.exe kopyasının ve npm dizininin SHA-256 değerleri broker'da sabitlenir. Uyuşmazlık olursa sonuç `BLOCKED(SANDBOX_SELFTEST_FAILED)` olur.

### 3.3 Çalışma kopyası modeli (şart 7)

- Normal geliştirme klasörleri (`Desktop\UASCO`, `UASCO-wt\*`, müşteri projeleri) sandbox'a **hiçbir şekilde bağlanmaz**.
- Kök dizin: `%LOCALAPPDATA%\UASCO\sbx\`. Alt dizinler:
  - `runtime\`: yalnız o çalıştırmanın AC SID'ine RX
  - `work\<runId>\`: yalnız o AC SID'ine Modify
  - `out\<runId>\`: broker'a ait, AC erişemez
- **İçeri kopyalama:** broker, run'ın taze clone'undan dosyaları kopyalar. **`.git` dizini kopyalanmaz.** Reparse noktaları ve hardlink'ler reddedilir. Boyut ve dosya sayısı sınırı vardır.
- **Dışarı kopyalama:** `FILE_FLAG_OPEN_REPARSE_POINT` kullanılır. Reparse noktası veya hardlink varsa reddedilir. Yollar yeniden doğrulanır. Yalnız beklenen çıktılar alınır: test raporu ve statik önizleme için `dist/`.
- **Host git:** sandbox'ın yazdığı ağaçta host git **asla çalıştırılmaz**. Commit'i, builder'ın workspace'inden mevcut `automation/lib/git-isolation.mjs` yolu yapar. Bu yol şunları zaten ayarlıyor: `core.hooksPath` boş bir dizine, `credential.helper=` boş, `protocol.ext.allow=never`, `GIT_CONFIG_NOSYSTEM=1`.
  - **Bulgu (kod okumasıyla; çalıştırılarak doğrulanmadı):** `isolatedGitArgs` şunları ayarlamıyor: `-c core.fsmonitor=false`, filter/textconv/diff.external etkisizleştirme, `core.sshCommand`, `core.pager`, `core.editor`.
  - Builder'ın Write aracı workspace içindeki `.git/config` dosyasına yazabiliyorsa, host git hook dışından komut çalıştırabilir. Builder'ın `.git` altına yazıp yazamadığı **UNKNOWN**.
  - SBX-3 kapsamına alındı ve negatif test N-15 olarak eklendi.
- **Bağımlılık getirme (ağın tek yetkili yolu):** broker sandbox **dışında** şu komutu çalıştırır: `npm ci --ignore-scripts --registry=https://registry.npmjs.org/ --userconfig=<broker npmrc>`. Projenin `.npmrc` dosyası yok sayılır. Lockfile'daki her `resolved` URL'si izin listesine göre ve her `integrity` değeri kontrol edilir. git, file ve http tarball bağımlılıkları reddedilir. Bu adım proje kodu **çalıştırmaz**.
  - Lifecycle script'leri (`npm rebuild`), build ve test **sandbox içinde ve çevrimdışı** çalışır.
- **Desteklenen toolchain (M1):** node/npm/npx (kopya runtime ile). Python, go, cargo, dotnet, mvn ve gradle M1'de `BLOCKED(TOOLCHAIN_NOT_SANDBOXED)` olur. Gömülü bir Python kopyası ayrı bir Founder kararıdır.

### 3.4 Önizleme stratejisi

- **M1: statik önizleme.** Build sandbox içinde çalışır. Broker `dist/` çıktısını reparse-safe biçimde dışarı kopyalar. Electron bunu özel bir protokolle ayrı bir partition'da sunar. Partition ayarları:
  - `sandbox:true`, `contextIsolation:true`
  - nodeIntegration ve preload yok
  - `webRequest` ile diğer tüm origin'ler engellenir
  - navigation, `window.open` ve izinler reddedilir
  - sıkı CSP
- **HMR dev sunucusu: M1'de BLOCKED.** Host'tan AC içindeki bir dinleyiciye loopback ile bağlanmak için `CheckNetIsolation -is` muafiyeti gerekir; bu yönetici yetkisi isteyen korumalı bir değişikliktir. İleride bir named-pipe köprüsü spike'ı yapılabilir (SBX-7, M1.1).
- **Sonuç:** M1 tanımındaki "önizleme aç" maddesi statik önizlemeyle karşılanır. Canlı yeniden yükleme (hot reload) M1'de yoktur.

### 3.5 Fail-closed davranışı (şart 8)

| Durum | Sonuç | Host'ta süreç başlatılır mı? |
|---|---|---|
| Provider yok, launcher yok veya hash uyuşmuyor | `BLOCKED(SANDBOX_UNAVAILABLE)` | **Hayır** |
| Başlangıç self-test'i veya kanarya deny probu başarısız | `BLOCKED(SANDBOX_SELFTEST_FAILED)` | **Hayır** |
| Run sırasında bir job sınırı aşıldı | Run step FAILED (`SANDBOX_LIMIT_EXCEEDED`); job öldürülür | Hayır |
| Desteklenmeyen toolchain | `BLOCKED(TOOLCHAIN_NOT_SANDBOXED)` | Hayır |

Uyarı gösterip devam eden bir yol, "yine de çalıştır" seçeneği veya host'a geri dönüş yoktur. Bir test, VERIFY, REGRESSION, retry ve devrun yollarının hiçbirinin `runProcess` veya `cp.spawn` ile host'ta süreç başlatmadığını kanıtlar.

### 3.6 Builder ve reviewer Claude araç sınırları (değişmiyor)

- **Builder (LOCAL_CLAUDE):** `config/builder-execution-policy.json` kapsamında yalnız `Read, Edit, Write, Glob, Grep` kullanabilir; `permissionMode: acceptEdits`. `Bash`, `WebFetch`, `WebSearch`, `NotebookEdit`, `Agent`, `Skill` ve `mcp__*` yasaktır. `highRiskRequiresOsSandbox: true`.
- **Reviewer:** `--tools Read,Grep,Glob`; Edit, Write, Bash ve Web yasaktır (`core/workos/executors.ts:208`).
- **Codex:** hiçbir rolde kullanılmaz.
- **Açık nokta:** builder'ın Edit/Write araçlarının cwd dışına yazmayı reddettiği bu belgede doğrulanmadı (**UNKNOWN**). Bu SBX-4'e negatif test N-16 olarak eklendi. Builder Claude CLI'ı host'ta çalışır, çünkü kimliği doğrulanmış bir araçtır. Proje kodu **çalıştırmaz**.

---

## 4) Negatif test sonuçları

**Durum:** Hiçbir prob ÇALIŞTIRILMADI. Spike raporu (`SBX-01`) yok ve probları çalıştırmak için gereken AC profili oluşturma izni (P-SBX-1) henüz verilmedi. Bu yüzden tüm satırlar **INCONCLUSIVE**.

Kabul kuralı:
- Herhangi bir satır **ESCAPED** çıkarsa, düzeltilip yeniden test edilene kadar bu yöntem **KABUL EDİLEMEZ** ve kod çalıştırma BLOCKED kalır.
- **INCONCLUSIVE** satırlar da kabul için yeterli değildir.
- Her prob yalnız açma veya listeleme denemesi yapar. İçerik okunmaz, yazdırılmaz, hash'lenmez.
- Pozitif kontroller aynı probu sandbox dışındaki Medium IL bir kontrol sürecinden, **yalnız UASCO'ya ait sahte (dummy) dosyalara** karşı çalıştırır. Gerçek gizli dosyalar kullanılmaz. Amaç, probun gerçekten çalıştığını ve sonucun boş (vacuous) olmadığını göstermektir.

| ID | Deneme (sandbox içinden) | Beklenen | Gözlenen | Sonuç |
|---|---|---|---|---|
| N-01 | `%USERPROFILE%\.claude` ve `.claude\.credentials.json` için açma/listeleme | ACCESS_DENIED | NOT RUN | INCONCLUSIVE |
| N-02 | `%USERPROFILE%\.gitconfig` ve `.ssh` (yok) için açma | DENIED / NOT_FOUND, içerik yok | NOT RUN | INCONCLUSIVE |
| N-03 | Chrome ve Edge `User Data`, `%APPDATA%\Mozilla` için listeleme/açma | DENIED | NOT RUN | INCONCLUSIVE |
| N-04 | `Desktop\UASCO` (Trust Kernel config/audit), `UASCO-recovery\FOUNDER-AUTHORIZATIONS.jsonl` | DENIED | NOT RUN | INCONCLUSIVE |
| N-05 | `UASCO-wt\*` (başka bir clone ve diğer projeler), Documents, Downloads, `%TEMP%` | DENIED | NOT RUN | INCONCLUSIVE |
| N-06 | `E:\` ve `E:\pro_yedek_20261008` için yalnız listeleme denemesi | DENIED | NOT RUN | INCONCLUSIVE |
| N-07 | Yukarıdaki tüm konumlara, `C:\ProgramData`'ya ve `C:\Users\Public`'e dosya **yazma** | DENIED | NOT RUN | INCONCLUSIVE |
| N-08 | HKCU `...\Run` yazma, Startup klasörü, zamanlanmış görev (COM), `Win32_Process.Create` (WMI; job'dan kaçış yolu), `CredEnumerate`. LPAC altında HKCU\Software okuma. | DENIED / boş | NOT RUN | INCONCLUSIVE |
| N-09 | TCP bağlantısı: 127.0.0.1 ve ::1 (UASCO Fastify control-API portu ve host'taki test dinleyicisi). Ayrıca sandbox'ın kendi dinleyicisine host'tan bağlantı. | FAIL (iki yönde de) | NOT RUN | INCONCLUSIVE |
| N-10 | LAN ağ geçidi, bir genel IP, `\\127.0.0.1\c$` (SMB/UNC) | FAIL | NOT RUN | INCONCLUSIVE |
| N-11 | DNS sızıntısı: rastgele bir nonce adı sorgulanır, sonra host'ta `Get-DnsClientCache` ile bu adın **olmadığı** kontrol edilir | Sorgu başarısız, cache'te kayıt yok | NOT RUN | INCONCLUSIVE |
| N-12 | `OpenProcess`: broker, Electron, explorer, claude | DENIED | NOT RUN | INCONCLUSIVE |
| N-13 | Pano okuma/yazma, kullanıcı masaüstünde GetDC/BitBlt, `SwitchDesktop`, host pencerelerine mesaj gönderme | ENGELLENDİ | NOT RUN | INCONCLUSIVE |
| N-14 | `CREATE_BREAKAWAY_FROM_JOB`. Fork bombası, bellek doldurma, CPU döngüsü, zaman aşımından uzun uyku, disk doldurma. | Sınır uygulanır, job öldürülür. Job kapandıktan sonra **hiçbir süreç kalmaz**. | NOT RUN | INCONCLUSIVE |
| N-15 | Çalışma kopyasına junction, symlink veya host dosyasına hardlink yerleştirip dışarı kopyalama. Builder workspace'inde `.git/config` ile fsmonitor/filter yerleştirilmesi (host git). | Reddedilir / çalışmaz | NOT RUN | INCONCLUSIVE |
| N-16 | Builder'ın Write aracıyla cwd dışına yazma (builder sınırı; sandbox dışı) | DENIED | NOT RUN | INCONCLUSIVE |
| N-17 | Named pipe'ları listeleme ve açma; AC SID'ine ACL verilmemiş UASCO pipe'ına bağlanma; top+1 seviyesinin altında AC tarafından okunabilir artıklar | DENIED / yok | NOT RUN | INCONCLUSIVE |
| N-18 | Eksik profil, değiştirilmiş launcher veya node hash'i | `BLOCKED(SANDBOX_SELFTEST_FAILED)`, host'ta süreç başlatılmaz | NOT RUN | INCONCLUSIVE |
| N-19 | Broker'ın çökmesi veya çıkması | Job kill-on-close; öksüz süreç kalmaz | NOT RUN | INCONCLUSIVE |
| P-01..P-05 | Pozitif kontroller (Medium IL kontrol süreci, yalnız dummy dosyalar ve UASCO'nun kendi dinleyicisi) | Probların gerçekten erişebildiği gösterilir | NOT RUN | INCONCLUSIVE |

### Açık kalan riskler

| ID | Önem | Risk | Telafi edici kontrol / karar |
|---|---|---|---|
| R1 | **HIGH** | Çekirdek host ile paylaşılıyor ve host Kasım 2025'ten beri yamasız (19045.6466, ESU 13 Eki 2026'da bitti). Kasım 2025'ten sonra düzeltilmiş bir çekirdek veya AppContainer kaçış açığı bu sınırı aşar. | LPAC, job sınırları, her çalıştırmada silinen profil, sandbox'ın yalnız gerektiğinde çalışması. **Founder kararı D-SBX-H1 (yama veya Windows 11).** |
| R2 | HIGH | Sonuçların host'a geri taşınması: reparse noktaları, hardlink'ler, kötü niyetli `.git` içeriği | Reparse-safe kopyalama, `.git` sandbox'a girmez, host git sandbox'ın yazdığı ağaçta çalışmaz (N-15) |
| R3 | MEDIUM | Yönetici yetkisi olmadan adres bazlı egress izin listesi kurulamaz | Sandbox içinde ağ tamamen kapalı. Yetkili erişim yalnız broker'ın `npm ci --ignore-scripts` adımıyla. |
| R4 | MEDIUM | Yöneticisiz sert disk kotası yok | IO-accounting yoklaması ve boyut watchdog'u job'u öldürür. Yoklama aralığında kısa bir aşım olabilir. |
| R5 | MEDIUM | Top+1 seviyesinin altında AC tarafından okunabilir nesneler (NULL-DACL pipe veya section) | N-17 ve seviye denetimi |
| R6 | MEDIUM | node, npm veya test runner'ları LPAC ile uyumsuz olabilir (**UNKNOWN**) | SBX-1 spike. Normal AC'ye yalnız denetimden sonra dönülür. |
| R7 | MEDIUM | Host git'te fsmonitor/filter etkisizleştirmesi eksik (bölüm 3.3) | SBX-3 |
| R8 | LOW | gitleaks ve trivy güvenilmeyen içerik üzerinde host'ta çalışıyor (yalnız ayrıştırma, proje kodu çalıştırmıyor) | Kabul edilmiş artık risk. İleride sandbox'a taşınabilir. |
| R9 | INFO | Broker yeni ve güvenilen bir koddur | Güvenlik açısından kritik paket. Bağımsız Claude review'unda 2-3 döngü bekleniyor. |

---

## 5) Ağ politikası

- **Varsayılan: tamamen kapalı.** AC token'ında sıfır capability vardır: `internetClient`, `internetClientServer` ve `privateNetworkClientServer` yok. WFP; internet, LAN, loopback (UASCO control API dahil), gelen bağlantılar ve SMB/UNC erişimini yönetici yetkisi olmadan engeller. Bu engel N-09, N-10 ve N-11 ile kanıtlanacak.
- **Yetkili adres mekanizması (şart 5):**
  - Ağ erişimi sandbox içinde **hiçbir zaman açılmaz**.
  - Yetkili erişimi broker sağlar, sandbox dışında ve proje kodu çalıştırmadan. M1'deki tek izinli adres `https://registry.npmjs.org/`; tek izinli işlem `npm ci --ignore-scripts`.
  - Görev kapsamı lockfile'dır: listedeki her `resolved` URL izin listesinde olmalı ve `integrity` değeri doğrulanmalıdır.
  - İzin listesine yeni bir adres eklemek ayrı bir Founder kararıdır ve görev bazında kaydedilir.
- **Kullanılmayan yöntemler** (her biri yönetici yetkisi veya korumalı bir değişiklik gerektirdiği için):
  - sandbox içine `internetClient` capability'si vermek
  - `CheckNetIsolation` ile loopback muafiyeti eklemek
  - firewall kuralı eklemek
  - filtreleyen bir proxy kurmak
- İkinci bir "yalnız internetClient capability'li AC" içinde fetch çalıştırmak bir seçenek olarak duruyor. M1'de gerekmiyor.

---

## 6) Kaynak sınırları

| Kaynak | Mekanizma | Önerilen M1 varsayılanı (tahmin; ölçülmedi) | Ölçüm |
|---|---|---|---|
| CPU | `JOBOBJECT_CPU_RATE_CONTROL` HARD_CAP | %50 (8 mantıksal çekirdeğin 4'ü kadar). IObit tek başına yaklaşık 1,9 çekirdek kullanıyor. | NOT RUN |
| RAM | JobMemoryLimit ve ProcessMemoryLimit | Job 2 GiB, süreç başına 1,5 GiB (boş RAM 5,7-6,2 GiB) | NOT RUN |
| Süreç sayısı | ActiveProcessLimit | 32 | NOT RUN |
| Süre | PerJobUserTimeLimit ve broker duvar saati | Mevcut `testTimeoutMs` değerleri. Devrun build için 10 dk. | NOT RUN |
| Disk | Broker watchdog (IO-accounting yazma byte'ları ve dizin boyutu) | Run başına 2 GiB, 1-2 sn yoklama. C:'de 603 GB boş. | NOT RUN |
| Kaçış | `BREAKAWAY_OK` ve `SILENT_BREAKAWAY_OK` yok, KILL_ON_JOB_CLOSE, WMI erişimi yok (N-08) | Zorunlu | NOT RUN |

Sınırların etkinliği N-14 ve N-19 ile ölçülecek. Ölçülmüş bir değer **yok**. Varsayılanlar SBX-4 sonuçlarına göre ayarlanacak.

---

## 7) Yeni kurulum / sistem değişikliği gereksinimleri

**Seçilen yöntem şunları GEREKTİRMEZ:** yönetici yetkisi veya UAC yükseltmesi, kurulum, sürücü, Windows özelliği açma, reboot, BIOS değişikliği, sürüm yükseltmesi, firewall/WFP kuralı, loopback muafiyeti, grup politikası, `Program Files` ya da `System32` altında değişiklik, kullanıcı hesabı oluşturma.

**Gerektirdiği kullanıcı düzeyindeki değişiklikler (tam etki):**

| # | Değişiklik | Nereye dokunur | Etki | Geri alma |
|---|---|---|---|---|
| C1 | AppContainer profillerinin oluşturulup silinmesi (adlar `uasco.sbx.` önekli) | `HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Mappings\<SID>` ve `%LOCALAPPDATA%\Packages\<moniker>\` | Kullanıcıya özel bir kayıt ve bir boş profil dizini. Diğer 115 AC profiline dokunulmaz. | `DeleteAppContainerProfile(<moniker>)` (yönetici gerekmez). Ardından Mappings altında `uasco.sbx.` önekli kayıt kalmadığı doğrulanır. |
| C2 | UASCO'ya ait sandbox kökü | `%LOCALAPPDATA%\UASCO\sbx\` (`runtime\`, `work\`, `out\`, `bin\`) | Yeni dizinler. ACE'ler **yalnız bu kökün altında** ve yalnız ilgili AC SID'i için eklenir. Başka hiçbir yolun ACL'ı değişmez. | Dizin silinir; ACE'ler dizinle birlikte gider. |
| C3 | Runtime kopyası | `C:\Program Files\nodejs\node.exe` (v24.20.0) ve `node_modules\npm` → `sbx\runtime\` | Dosya kopyası (yaklaşık 100 MB düzeyinde; **ölçülmedi**). İndirme yok. SHA-256 sabitlenir. | Dizin silinir. |
| C4 | Launcher derlemesi | Sistemdeki `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` → `sbx\bin\uasco-sbx-launcher.exe` | Yeni bir exe. Hash'i sabitlenir ve kaynağı repoda tutulur. | Dosya silinir. |
| C5 | Spike ve negatif test çalıştırma | Bu bilgisayar | Korunan konumlara **yalnız açma denemesi** yapılır, içerik okunmaz. DNS nonce sorgusu denemesi yapılır (ağ kapalı olduğu için başarısız olması beklenir). | Değişiklik bırakmaz. Artık kalan profil ve dizinler C1/C2 adımlarıyla silinir. |

**Ürün paketleme notu:** Müşteri makinelerinde node kurulu olmayabilir. M1'de runtime, Founder makinesindeki node kopyalanarak sağlanır. Installer'a bir node runtime'ı paketlenmesi (MIT lisanslı) M1 sonrası ayrı bir karardır. `ELECTRON_RUN_AS_NODE` kullanılmaz: `environment-policy.json` bu değişkeni açıkça reddediyor ve RunAsNode fuse'u devre dışı bırakılmalı.

**Geri alma planı (tamamı):**
1. UASCO'da sandbox provider kapatılır, kod çalıştırma BLOCKED'a döner.
2. Tüm `uasco.sbx.*` profilleri için `DeleteAppContainerProfile` çalıştırılır.
3. `%LOCALAPPDATA%\UASCO\sbx\` silinir.
4. HKCU Mappings altında `uasco.sbx.` kaydı kalmadığı ve `%LOCALAPPDATA%\Packages` altında `uasco.sbx.*` dizini kalmadığı doğrulanır.
5. Commit'ler geri alınır (revert).

Sistem, firewall veya politika durumu hiç değişmediği için başka bir geri alma adımı yoktur.

**EXACT izin kapsamı (onaylanacak metin):** bölüm 11, P-SBX-1 … P-SBX-6.

---

## 8) Ürün entegrasyon paketleri

Bütün paketler FA-V2-PRODUCT kapsamında. Implementer Claude'dur; bağımsız reviewer ayrı bir Claude'dur; Codex yoktur. Korumalı dosya listesi `config/protected-paths.json`'dan alındı: `apps/control-api/src/server.ts`, `config/builder-execution-policy.json`, `config/environment-policy.json`, `config/validation.json` (v2-ps1a @9cb8aa1). `apps/desktop/main.mjs` korumalı olarak REL-FIRST-EXE-P0'da belirtiliyor; entegre tip üzerinde yeniden kontrol edilecek. `core/workos/*.ts` korumalı değil.

| Paket | Kapsam | Korumalı dosyalar (FA) | Kabul testleri ve REL eşlemesi | Bağımlılık | Beklenen döngü |
|---|---|---|---|---|---|
| **SBX-0** fail-closed kapı (M1a) | `SandboxProvider` arayüzü, `NullProvider` (her zaman BLOCKED); runner.ts `runTests` (290-291; 410, 553) ve devrun.ts:272 bu arayüzden geçer. Desktop'ta dürüst BLOCKED etiketi. | `config/validation.json` (yeni test); durum route'u eklenirse `server.ts` | "Provider yok → VERIFY/REGRESSION/devrun BLOCKED(SANDBOX_UNAVAILABLE), `runProcess`/`spawn` çağrılmaz" (spy). Retry ve regresyon yollarında host'a geri dönüş yok. REL-168 (ara), REL-GAP-009, REL-AT-034 (kısmi). | REL-FX-1'den sonra (runner.ts ve server.ts paylaşılıyor) veya doğrudan entegre tip | 1-2 |
| **SBX-1** spike (ürün dışı, scratch'te) | Launcher prototipi, LPAC ile node/npm test çalıştırma, temel problar N-01, 07, 09, 11, 12, 14 ve pozitif kontroller | Yok | Rapor: `UASCO-recovery/product/sbx/spike/SBX-01-spike-report.md`. LPAC uyumluluk kararı. 0 ESCAPED. | **P-SBX-1..5** | 1 + review |
| **SBX-2** launcher ve broker | C# launcher (csc), AC profil yaşam döngüsü ve temizleyici, LPAC, Job sınırları, ayrı masaüstü, ortam/handle listesi, hash sabitleme, `verify()` self-test | `config/validation.json`; `config/environment-policy.json` (sandbox ortamı için gerekirse) | N-08, N-12, N-13, N-14, N-18, N-19. REL-AT-048 (kaynak sınırı), REL-WK-07f, REL-168. | SBX-1 PASS | 2-3 (güvenlik açısından kritik) |
| **SBX-3** çalışma kopyası ve bağımlılık getirme | İçeri/dışarı kopyalama (`.git` yok, reparse-safe). `npm ci --ignore-scripts` ile host fetch, lockfile URL ve integrity doğrulaması. `isolatedGitArgs` sertleştirmesi: fsmonitor, filter, textconv, `diff.external`, `core.sshCommand`, pager, editor. | `config/validation.json` | N-15, N-07 (çalışma kopyası dışına yazma). REL-AT-024, REL-AT-020 (containment). | SBX-1 (SBX-2 ile paralel) | 2-3 |
| **SBX-4** negatif test paketi ve başlangıç self-test'i | N-01 … N-19 ve P-01..05. Self-test başarısız olursa `BLOCKED(SANDBOX_SELFTEST_FAILED)`. Kanıt bir run evidence kaydı olur. | `config/validation.json` | **REL-168 (Network Egress Isolation Proof)**, REL-AT-034, REL-AT-024, REL-AT-048 | SBX-2, SBX-3 | 2-3 |
| **SBX-5** runner/devrun entegrasyonu ve paketleme | `AppContainerProvider` VERIFY/REGRESSION'a bağlanır. Statik önizleme build'i sandbox içinde çalışır. `build-installer.mjs` launcher kaynağını ve runtime-kopyalama adımını paketler (D-M1-01 dersi: staging listesi). REL-FX-3 güncellenir: R0-R2 de `SANDBOX_VERIFIED` ister; R3/R4 reddedilmeye devam eder. | `server.ts` (durum ve admission), `config/validation.json` | Paketlenmiş uygulamada self-test PASS. PS-AT-001'in test adımı sandbox içinde çalışır. REL-126, REL-AT-020, REL-AT-021. | SBX-2..4, entegre tip, REL-FX-2 (VERIFY çakışması) | 2-3 |
| **SBX-6** statik önizleme partition'ı | Electron özel protokolü, sandbox'lı partition, webRequest engeli, CSP, navigation, window.open ve izinlerin reddi | `apps/desktop/main.mjs` | "Önizleme dış origin'e istek gönderemez, preload/node erişimi yok", PS-AT-001 önizleme adımı | SBX-0 (önizleme API'si). SBX-2 ile paralel. | 1-2 |
| **SBX-7** (M1.1, ertelendi) HMR named-pipe köprüsü | AC içindeki shim ile broker'a ait pipe arasında köprü. Önce AC içi loopback doğrulanır. | `apps/desktop/main.mjs`, `server.ts` | Canlı önizleme, N-09 hâlâ CONTAINED | SBX-5 | 2 + spike |

**M1'deki sıralama:**
- REL-FX-1/3/4/2 (çalışıyor) → entegre tip.
- SBX-0, REL-FX-1'den sonra hemen.
- SBX-1, P-SBX izinleri gelir gelmez ve entegrasyondan bağımsız olarak.
- SBX-2 ve SBX-3 paralel → SBX-4 → SBX-5. SBX-5, REL-FX-2'nin VERIFY değişikliğinden sonra gelir.
- SBX-6, SBX-2 ile paralel.
- REL-FX-5 (EXE manifest) installer build adımında.
- Son adım B12 PS-AT-001: paketlenmiş uygulamada self-test PASS ve testler sandbox içinde.

---

## 9) M1 güncel ETA

**Önceki plan (karar ve rehearsal öncesi):** P50 16 Eki ~12:00, P80 16 Eki ~22:00, P95 18 Eki.

**Ölçülmüş girdiler (eta2-measured-data.md):**
- Implementation p50 14,2 dk, p80 30,7 dk (Opus için p50 20,3 dk)
- Review p50 5,8 dk, p80 9,4 dk
- Güvenlik açısından kritik paketler 2-3 döngü; son paketlerde PS-1A 3, PS-1B 5, merge tool 5 döngü sürdü
- Tam validasyon 26-30 dk. Rehearsal'da yük altında ardışık adımlar yaklaşık 56 dk sürdü; bs1-d (669 sn) ve bs1-f (755 sn) 600 sn sınırını aştı (D-M1-09).
- Founder onay gecikmesi 10 dk-1,5 sa; gece duraklaması yaklaşık 8 sa

**Varsayım (ölçülmedi):** freeze, odaklı validasyon, review ve kuyruk dahil bir döngünün duvar saati süresi **P50 ~1,5 sa, P80 ~2,5 sa**.

| Adım (kritik yol) | P50 bitiş | P80 bitiş |
|---|---|---|
| P-SBX izinleri (Founder) | 15 Eki 09:00 | 15 Eki 12:00 |
| SBX-1 spike + review | 15 Eki 11:00 | 15 Eki 15:00 |
| Merge tool c5 CLEAN + Founder live-merge onayı + D-M1-10 kararları | 15 Eki 10:00 | 15 Eki 13:00 |
| Entegrasyon + D-M1-05/06/07 düzeltmeleri | 15 Eki 14:00 | 15 Eki 17:00 |
| D-M1-01..04 (paketlenmiş mod) | 15 Eki 16:00 | 15 Eki 20:00 |
| REL-FX-1..4 CLEAN + entegre | 15 Eki 17:00 | 15 Eki 21:00 |
| SBX-0 | 15 Eki 13:00 | 15 Eki 16:00 |
| SBX-2 ve SBX-3 (3 / 4 döngü) | 15 Eki 15:30 | 16 Eki 01:00 |
| SBX-4 (2 / 3 döngü) | 15 Eki 18:30 | 16 Eki 08:30 |
| SBX-5 ve SBX-6 (2 / 3 döngü) | 15 Eki 21:30 | 16 Eki 16:00 |
| Tam validasyon + installer (REL-FX-5) + %TEMP% kurulum testi + artifact review | 16 Eki 00:00 | 16 Eki 21:00 |
| Founder'ın gerçek kurulumu (gece duraklaması) | 16 Eki 09:00 | 17 Eki 09:00 |
| B12 PS-AT-001 + paketlenmiş modda negatif paket + review + 1 (P80'de 2) düzeltme döngüsü | **16 Eki ~18:00** | **17 Eki ~20:00** |

| | Yeni | Önceki | Fark | Bu farkın sandbox kısmı (tahmin) |
|---|---|---|---|---|
| **P50** | **16 Eki 2026 ~18:00 TSİ** | 16 Eki ~12:00 | +6 sa | ~+4-6 sa |
| **P80** | **17 Eki 2026 ~20:00 TSİ** | 16 Eki ~22:00 | +22 sa | ~+12-16 sa |
| **P95** | **20 Eki 2026 ~12:00 TSİ** | 18 Eki | +2 gün | ~+1,5 gün |

**P95'i belirleyen senaryolar:**
- LPAC node ile çalışmaz; normal AC'ye geçiş ve derin ACL denetimi gerekir (+0,5 gün).
- Bir prob ESCAPED çıkar ve yeniden tasarım gerekir (+1 gün).
- Auto-mode classifier AC profili oluşturmayı veya ACL değişikliğini reddeder ve Founder'ın elle işlem yapması gerekir. Son 30 saatte 6'dan fazla classifier reddi oldu.
- Hafta sonu Founder gecikmesi.
- Haftalık kota dolar (kota sınırı UNKNOWN).

**Spike başarısız olursa** (AC yolu negatif paketi geçemezse): test çalıştırma ve önizleme içeren tam M1 tanımı, Founder'ın korumalı bir değişikliği (bölüm 10, yedek seçenekler a/b/c) olmadan **karşılanamaz**. Bu durumda tarih **UNKNOWN** olur; VM yolu satın alma veya BIOS değişikliğinden sonra +3-6 gün sürer. Bu arada "M1a" (bölüm 10) teslim edilebilir.

**Güven: düşük-orta.**
- Sandbox kodu bu repoda ilk kez yazılacak ve native Win32 içeriyor.
- Spike çalıştırılmadı.
- Döngü başına duvar saati süresi bir varsayım.
- Seçenek analizleri insan-iş-günü birimiyle +3,5 / +4,5 / +6,5 iş günü öngörüyordu; bu değerler ölçülmemişti ve ölçülmüş ajan hızına uygulanmadı. Onları P95'in ötesindeki kötümser bir sınır olarak okuyun.

**M0 / ilk kurulabilir UASCO.exe:** Bu karardan etkilenmez, çünkü M0'da kod çalıştırma özelliği yok. Release candidate build'i ve artifact review'u çalışıyor. Önceki plandaki P50 (15 Eki ~12:00) bu belgede yeniden ölçülmedi.

---

## 10) Daha hızlı güvenli alternatifler

| Alternatif | Ne sağlar | Neyi SAĞLAMAZ | Ne zaman (tahmin) |
|---|---|---|---|
| **M1a: çalıştırmasız ara sürüm** (SBX-0 + entegre tip) | Paketlenmiş uygulamada şunlar çalışır: proje oluşturma, Claude'un gerçek kod geliştirmesi, statik güvenlik taraması (gitleaks), bağımsız Claude review, export. Kod çalıştırma riski sıfır. | Test çalıştırma (QA), önizleme, functionalAcceptance VERIFIED. **M1 tanımını tam karşılamaz**; çıktı "test edilmedi" etiketi taşır. Run'ın VERIFY'da durması mı yoksa yalnız statik review ile ilerlemesi mi gerektiği bir karar (D-SBX-6). | P50 ~16 Eki öğleden önce (yaklaşık sandbox'sız M1 yolu) |
| **Statik önizleme olmadan M1** (SBX-6 sonraya kalır) | Testler sandbox içinde çalışır | "Önizleme aç" maddesi | SBX-6 kritik yolda olmadığından kazanç küçük (~0-2 sa) |
| **Uzak worker** (GitHub-hosted runner, Codespaces, bulut VM) | Kod host'ta hiç çalışmaz | **Müşteri kodu makineden çıkar** (Founder'ın müşteri verisi önceliğiyle çelişir). GitHub runner'larında egress varsayılan olarak açık. Host'ta token saklanır; ücretli/üretim yetkisi gerekir. Mevcut bir altyapı değil. | Hesap varsa +1-3 gün. **Önerilmez.** |
| **Yedek seçenek (a): Hyper-V veya Windows Sandbox** | En güçlü izolasyon (ayrı çekirdek) | Ücretli Pro yükseltmesi (geri alınamaz), BIOS'ta VT-x, yönetici yetkisi, reboot. Home sürümlü müşteri makinelerinde çalışmaz. | Onaylardan sonra +3-6 gün |
| **Yedek seçenek (b): VirtualBox/VMware** | Güçlü izolasyon | Çekirdek sürücüsü kurulumu (verilen yetki kapsamında değil), BIOS, yönetici. 16 GB RAM'de bellek baskısı. | Onaylardan sonra +3-6 gün |

Reddedilen seçenekler: WSL2 ve Docker-on-WSL2 (Win10'da ağ engeli guest'in kontrolünde), ayrı yerel kullanıcı (ağ açık), yalnız Low IL (kullanıcı dosyalarını okuyabilir).

---

## 11) Founder'dan beklenen kararlar (her biri ayrı)

### Sandbox'ı kurmak için gereken izinler (yönetici yetkisi gerektirmez)

- **P-SBX-1:** "UASCO'nun, yalnız `salim` kullanıcısı için, adı `uasco.sbx.` ile başlayan AppContainer profillerini `CreateAppContainerProfile` ile oluşturmasına ve `DeleteAppContainerProfile` ile silmesine izin veriyorum. Bu profillere hiçbir capability (internetClient, privateNetwork dahil) verilmeyecek. Başka AppContainer profillerine dokunulmayacak."
- **P-SBX-2:** "UASCO'nun `%LOCALAPPDATA%\UASCO\sbx\` dizinini oluşturmasına izin veriyorum. UASCO, yalnız bu dizinin altında ve yalnız ilgili `uasco.sbx.*` AppContainer SID'i için ACE ekleyebilir. Başka hiçbir dosya, dizin veya registry anahtarının ACL'ı değiştirilmeyecek."
- **P-SBX-3:** "Mevcut `C:\Program Files\nodejs\node.exe` (v24.20.0) ve `node_modules\npm` dosyalarının `%LOCALAPPDATA%\UASCO\sbx\runtime\` altına kopyalanmasına izin veriyorum. Kopyaların SHA-256 değerleri sabitlenecek. İndirme yapılmayacak ve `Program Files` değiştirilmeyecek."
- **P-SBX-4:** "Sistemde zaten bulunan `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` ile repodaki kaynaktan `uasco-sbx-launcher.exe` derlenmesine izin veriyorum. Çıktı `%LOCALAPPDATA%\UASCO\sbx\bin\` altında olacak ve hash'i sabitlenecek."
- **P-SBX-5:** "SBX-1 spike'ının ve negatif test paketinin bu bilgisayarda çalıştırılmasına izin veriyorum. Sandbox içinden şu konumlara yalnız açma/listeleme denemesi yapılacak; içerik okunmayacak, yazdırılmayacak, hash'lenmeyecek: `.claude`, `.gitconfig`, tarayıcı profilleri, `Desktop\UASCO`, `UASCO-recovery`, `UASCO-wt`, `E:\`. Pozitif kontroller yalnız UASCO'ya ait sahte dosyalarla yapılacak. `E:\pro_yedek_20261008` dizinine sandbox dışından hiç dokunulmayacak."
- **P-SBX-6 (D-REL-3 ile birlikte):** "FA-V2-PRODUCT kapsamının SBX-0..SBX-6 paketleri için şu korumalı dosyaları kapsadığını teyit ediyorum: `config/validation.json`, `apps/control-api/src/server.ts`, `apps/desktop/main.mjs` ve gerekirse `config/environment-policy.json`. `config/builder-execution-policy.json` dosyası değiştirilmeyecek."

### Ürün ve kapsam kararları

- **D-REL-1 (kapanış kaydı):** "Üretilmiş kod, R0-R4 risk seviyelerinin tümünde yalnız doğrulanmış sandbox içinde çalışır. Sandbox yoksa sonuç `BLOCKED` olur. R3/R4 ayrıca reddedilmeye devam eder."
- **D-SBX-6:** M1a ara sürümünde, sandbox yokken bir run'ın ne yapacağı:
  - (i) VERIFY'da `BLOCKED` olarak durur. **Önerilen ve güvenli varsayılan budur.**
  - (ii) Yalnız statik güvenlik taraması ve Claude review ile `AWAITING_APPROVAL`'a ilerler; çıktı "test çalıştırılmadı / NOT_VERIFIED" etiketini taşır ve COMPLETE "doğrulanmış" olarak gösterilmez.
- **D-SBX-7:** M1'de önizleme yalnız statik olacak; HMR dev sunucusu M1.1'e ertelenecek (SBX-7).
- **D-SBX-8:** M1'de yalnız node/npm toolchain'i desteklenecek. Python ve diğerleri `BLOCKED(TOOLCHAIN_NOT_SANDBOXED)` olacak. Gömülü Python kopyası ayrı bir karardır.
- **D-SBX-9:** Ağ izin listesi M1'de yalnız `https://registry.npmjs.org/` adresinden oluşacak ve yalnız broker'ın `npm ci --ignore-scripts` adımında kullanılacak. Yeni bir adres her seferinde ayrı bir Founder kararı gerektirir.

### Host güvenliği (Founder'ın kendisinin yapacağı yönetici işlemleri; sandbox'tan bağımsız)

- **D-SBX-H1 (HIGH):** İşletim sistemi yaması. Bilgisayar Windows 10 Home 19045.6466 sürümünde ve ESU 13 Eki 2026'da bitti. Seçenek: Windows 11'e yükseltme. i7-9700 desteklenen bir işlemci ailesi; TPM/PTT durumu **UNKNOWN**. Bu, Founder'ın yürüteceği ayrı bir değişikliktir ve UASCO bunu yapmaz.
- **D-SBX-H2 (HIGH):** Codex artıklarının (A1) temizliği. İçerik:
  - `CodexSandboxOffline` ve `CodexSandboxOnline` hesaplarının devre dışı bırakılması veya silinmesi
  - `CodexSandboxUsers` grubunun USERPROFILE altındaki açık ACE'lerinin kaldırılması
  - `%USERPROFILE%\.sbx-denybin` ve `openai.codex` AC profilinin kaldırılması

  Yönetici yetkisi gerekir. Geri alma için önce `icacls /save` ile ACL yedeği alınması önerilir.
- **D-SBX-H3 (MEDIUM):** `%TEMP%` üzerindeki öksüz SID Modify ACE'sinin (A2) kaldırılması.
- **D-SBX-H4 (MEDIUM):** `E:\pro_yedek_20261008` yedeğinde Authenticated Users Modify yetkisinin (A4) daraltılması veya bilinçli olarak kabul edilmesi.
- **D-SBX-H5 (LOW):** Öksüz loopback muafiyetinin (A5) kaldırılması.

### Bu belgede istenmeyen ve verilmemesi gerekenler

Yönetici veya UAC yükseltmesi, BIOS'ta VT-x açılması, Pro yükseltmesi, Hyper-V/Windows Sandbox/WSL özelliklerinin açılması, VirtualBox/Docker/sürücü kurulumu, firewall veya `CheckNetIsolation` değişiklikleri, sandbox'a `internetClient` capability'si verilmesi, uzak worker veya bulut hesabı, host üzerinde sandbox'sız kod çalıştırma.

---

**Durum özeti:** SBX-0 hemen başlayabilir. SBX-1..6 için P-SBX-1..6 izinleri gerekir. Negatif test paketi 0 ESCAPED ve 0 INCONCLUSIVE sonucunu verene kadar M1'de kod çalıştırma BLOCKED kalır. Bu belgede hiçbir şey çalıştırılmadı, kurulmadı veya değiştirilmedi.

---

## 12) Bağımsız eleştirmen notları (completeness critic)

- **Tarih:** 2026-10-15 ~05:45 TSİ. **Rol:** bağımsız tamlık eleştirmeni. Bölüm 0-11 değiştirilmedi; bu bölüm yalnız eklendi.
- **Yöntem:** salt okunur kod okuması: `UASCO-wt/v2-ps1a` @9cb8aa1 ve `UASCO-wt/v2-ps1b` @abfbf2c. Ek olarak `driverquery` çalıştırıldı ve `~/.claude/settings.json` içinde yalnız anahtar adları arandı (içerik okunmadı).
- **Çalıştırılmayanlar:** hiçbir prob, test veya kod çalıştırılmadı; sistemde değişiklik yapılmadı.
- **Kanıt durumu:** `sbx/spike/` dizini 05:45'te de **yok**. SBX-00 hash'leri (`72a44a73…`, `32d4ebf3…`) yeniden hesaplandı ve belgedeki değerlerle **eşleşti**.
- **Sonuç:** belge ESCAPED sonuç gizlemiyor. Tüm satırlar dürüstçe INCONCLUSIVE işaretli. Ancak aşağıdaki boşluklar var; bazı ifadeler kanıtın ötesine geçiyor.

### 12.1 Somut boşluklar

| ID | Önem | Boşluk | Kanıt (kod/satır) | Kapsaması gereken paket |
|---|---|---|---|---|
| C-01 | **CRITICAL** | **LOCAL_CLAUDE builder, proje içeriğinden gelen komutları host'ta, sandbox dışında çalıştırabilir.**<br>- Broker'ın Claude CLI argümanları yalnız `-p --permission-mode --tools --disallowedTools --output-format`. `--setting-sources`, `--strict-mcp-config`, `--no-session-persistence` ve `--disable-slash-commands` **yok**.<br>- Builder'ın cwd'si, içe aktarılmış (git/ZIP) müşteri projesinin klonu.<br>- Import yolunda `.claude/`, `.mcp.json`, `CLAUDE.md` ve `CLAUDE.local.md` için ret veya nötralize etme **yok**.<br>- Proje `.claude/settings.json` dosyası komut çalıştırabilen alanlar içerebilir: `hooks`, `apiKeyHelper`, `statusLine`, `env`, `permissions.allow` (ör. `Read(//c/Users/salim/.claude/**)`), `additionalDirectories`, `enableAllProjectMcpServers`. Claude Code belgelerine göre `-p` modunda workspace trust diyaloğu atlanır. **Bu davranış bu belgede çalıştırılarak doğrulanmadı.**<br>- Sonuç: güvenilmeyen proje içeriği host'ta Medium IL ile süreç başlatabilir ve kimlik bilgilerini okuyabilir. Bu, D-REL-1'in doğrudan ihlalidir.<br>- Bölüm 3.6'daki "Builder … proje kodu çalıştırmaz" ifadesi bu yüzden **fazla iddialı**. | `scripts/claude-builder-broker.mjs:5,8` (korumalı dosya; `config/protected-paths.json:65`)<br>`core/workos/project-studio.ts:105-140` (import)<br>`core/workos/executors.ts:161` (builder cwd = workspace) | **Yeni paket SBX-8, "builder confinement"; M1 blocker.** İçeriği:<br>- Broker'a `--setting-sources` (proje/local kaynakları hariç), `--strict-mcp-config`, `--no-session-persistence` ve `--disable-slash-commands` eklenmesi<br>- Founder'ın kişisel `~/.claude` kurulumundan ayrı, UASCO'ya özel bir `CLAUDE_CONFIG_DIR` profili<br>- Import ve builder çıktısında `.claude/**`, `.mcp.json` ve `CLAUDE*.md` için ret veya karantina kuralı<br>- Negatif testler N-16b..e: proje hook'u çalışmaz, proje `permissions.allow` kuralı uygulanmaz, `.claude/.credentials.json` Read ile okunamaz, `.mcp.json` sunucusu başlamaz<br>- Broker korumalı dosya olduğu için **P-SBX-6'ya `scripts/claude-builder-broker.mjs` eklenmeli**. P-SBX-6 şu an bu dosyayı kapsamıyor. |
| C-02 | **CRITICAL** | **Reviewer da aynı yüzeye açık.**<br>- Builder `.claude/settings.json` yazabilir; `commitBuilderOutput` yalnız `.git` iç dosyalarını denetler, `.claude/**` için ret yok.<br>- Bu dosya commit'e girer; reviewer'ın temiz klonunda proje ayarı olarak yüklenir.<br>- `executors.ts:208` reviewer yolunda `--strict-mcp-config` ve `--setting-sources` **yok**.<br>- `automation/lib/claude-reviewer.mjs:8` yolunda `--strict-mcp-config` var ama `--setting-sources` **yok**. | `core/workos/executors.ts:208`<br>`automation/lib/claude-reviewer.mjs:8`<br>`core/workos/builder-output.ts:81-94` | SBX-8, iki reviewer yolu dahil. Ek negatif test: builder'ın yazdığı `.claude/settings.json` hook'u reviewer'da çalışmaz. |
| C-03 | HIGH | **Builder, Founder'ın kişisel Claude kurulumunu devralıyor.**<br>- `~/.claude/settings.json` iki `hooks` bloğu içeriyor (örneğin context-mode eklentisi).<br>- `--setting-sources` olmadığı için bu hook'lar ve eklentiler builder ile reviewer oturumlarında da çalışır.<br>- Kişisel izin kuralları ve hafıza (memory) da devralınır.<br>- Prompt injection altında Read aracının cwd dışına çıkıp çıkamayacağı bu kurallara bağlı. Belgede **UNKNOWN** olarak kalıyor (N-16 yalnız Write'ı kapsıyor). | `~/.claude/settings.json` (yalnız anahtar adları görüldü) | SBX-8. Builder'ın Docker/AC içinde çalıştırılması M1'de gerekmiyor, ama **ayrı bir config profili zorunlu olmalı**. AC + `internetClient` içinde builder çalıştırma M1.1 için savunma derinliği seçeneği olarak kaydedilmeli. |
| C-04 | HIGH | **Önizleme şu an Founder'ın varsayılan tarayıcısında açılıyor.**<br>- PS-1B c5 (`main.mjs:191-205`) önizlemeyi bilinçli olarak `shell.openExternal` ile açıyor.<br>- Bu durumda üretilmiş JS, Founder'ın gerçek tarayıcı profilinde çalışır. Bunun sonuçları:<br>&nbsp;&nbsp;- 127.0.0.1 çerezleri portlar arasında paylaşılır<br>&nbsp;&nbsp;- oturum açık sitelere CSRF yapılabilir<br>&nbsp;&nbsp;- tarayıcı eklentileri sayfaya erişir<br>&nbsp;&nbsp;- tarayıcıdan localhost servislerine, control API dahil, istek atılabilir<br>- Bölüm 3.4 Electron partition'ı öneriyor ama bu çelişkiyi ve PS-1B kararının tersine çevrilmesini **hiç anmıyor**.<br>- Ayrıca `requireTrustedSender`'ın önizleme webContents'ini dışladığı ve özel protokolün yalnız önizleme partition'ında kaydedildiği doğrulanmadı.<br>- Electron sürümünün yama güncelliği de değerlendirilmedi: renderer RCE + sandbox kaçışı zinciri Medium IL'e çıkar. | `apps/desktop/main.mjs:123-139, 191, 201-205, 254-256` | SBX-6 kapsamına açıkça eklenmeli: `openExternal` kaldırılır veya yalnız statik, ağsız bir partition kullanılır; `requireTrustedSender` önizleme kaynağını reddeder; Electron sürümü için minimum yama kapısı konur.<br>PS-1B ile çakıştığı için D-SBX-7'ye ek Founder kararı gerekir. SBX-0 devrun'u BLOCK ettiği sürece risk pasif. |
| C-05 | HIGH | **npm fetch'te "projenin `.npmrc`'si yok sayılır" denmiş, ama mekanizma tanımlı değil.**<br>- npm, `--userconfig` verilse bile `<prefix>/.npmrc` proje config'ini **okur**.<br>- Bu dosyayla ayarlanabilecekler: `script-shell`, `git`, `node-options`, `cafile`, proxy, `foreground-scripts`, `install-links`, `audit`.<br>- Lockfile'daki `link:true` ve `workspaces` girdileri host'ta junction oluşturur.<br>- Saldırgan tarafından yayımlanmış registry tarball'ları host'ta açılır (node-tar'ın Windows yol aşımı CVE geçmişi var). Integrity kontrolü yalnız kaynağın registry olduğunu kanıtlar, içeriğin iyi huylu olduğunu kanıtlamaz.<br>- `npm ci` varsayılan olarak `audit` isteği gönderir. | Bölüm 3.3, 5 | SBX-3 kapsamı genişletilmeli:<br>- `npm ci` yalnız `package.json` ve `package-lock.json` içeren temiz bir staging dizininde çalışır<br>- `--no-audit --no-fund --no-update-notifier`, ayrı `--globalconfig` ve `--cache`; `npm_config_*` ortam değişkenleri temizlenir<br>- `link:true`, `file:` ve `workspaces` reddedilir<br>- Tercihen fetch'in kendisi yalnız `internetClient` capability'li ayrı bir AC içinde çalışır; yönetici gerekmez<br>- Yeni negatif test N-21: kötü niyetli proje `.npmrc` dosyası etkisizdir |
| C-06 | MEDIUM | **İçe aktarılan mevcut repoda host git doğrudan kaynak repo üzerinde çalışıyor.**<br>- `importGitInto`, kaynağın `.git/config` dosyasını okuyan komutlar çalıştırıyor: `rev-parse` ve `clone --no-local` (upload-pack kaynakta çalışır).<br>- `isolatedGitArgs` `core.fsmonitor=false` ayarlamıyor. Bu komutların fsmonitor, `include.path`, alternates veya `gitdir:` yönlendirmesini tetikleyip tetiklemediği **doğrulanmadı**.<br>- Bölüm 3.3 ve R7 yalnız builder workspace'ini ele alıyor; **import yolu hiç anılmıyor**. | `core/workos/project-studio.ts:105-111`<br>`automation/lib/git-isolation.mjs` (`isolatedGitArgs`) | SBX-3: `-c core.fsmonitor=false` ve ilgili ayarlar tüm host git çağrılarına eklenir; kaynak repo için `safe.directory` ve config kısıtlamaları uygulanır.<br>N-15b: kaynak `.git/config` dosyasında fsmonitor, sshCommand, `include.path` ve alternates bulunsa da import sırasında hiçbir komut çalışmaz. |
| C-07 | MEDIUM | **Belgedeki "builder'ın `.git` yazımı UNKNOWN" ifadesi kısmen yanlış.**<br>- Mevcut `gitControlDigest`, engine git çağrısından **önce** `.git` değişikliğini yakalıyor (`BUILDER_TOUCHED_GIT_INTERNALS`).<br>- Ancak digest `objects/` ve `index`'i **dışarıda bırakıyor**. Bu yüzden `objects/info/alternates`, sahte pack, commit-graph ve multi-pack-index dosyaları algılanmıyor.<br>- Host git bu dosyaları ayrıştırır ve Studio git görünümü run `objects` dizinini alternate olarak kullanır. | `core/workos/builder-output.ts:14-26, 81-83`<br>`project-studio.ts:225` | SBX-3: `objects/info/*` ve `objects` altındaki pack dışı meta dosyalar digest'e alınır veya engine'in temiz bir `objects` kopyasıyla çalışması sağlanır. N-15c. |
| C-08 | MEDIUM | **Sandbox'tan host'a dönen çıktıları host ayrıştırıyor.**<br>- Host, sandbox'tan gelen test raporlarını (JSON/JUnit XML) ve stdout loglarını ayrıştırıyor.<br>- Değerlendirilmemiş riskler: XXE ve "billion laughs" saldırıları, ANSI/terminal kaçış dizileri, log injection, evidence kayıtlarına sahte "PASS" satırı yazılması. | Bölüm 3.3 `collectOutputs` (yalnız boyut ve tür kontrolü var) | SBX-3/SBX-5:<br>- yalnız şemalı JSON kabul edilir, XML yok<br>- kontrol karakterleri temizlenir<br>- test sonucu yalnız job çıkış kodundan ve broker'ın kendi sayacından türetilir; sandbox'ın yazdığı metin sonuç olarak kabul edilmez |
| C-09 | MEDIUM | **Negatif test listesinde müşteri verisi ve çapraz-run konumları eksik.**<br>- `%APPDATA%\UASCO` (paketlenmiş userData: Work OS journal'ı, başka projelerin export ZIP'leri, backend logları) listede yok.<br>- `%LOCALAPPDATA%\UASCO\sbx\work\<başka runId>`, `out\`, broker npmrc/cache ve `.ai/runtime` de yok.<br>- Eşzamanlı iki run'ın birbirinin AC SID'ine erişememesi testi yok.<br>- Süreç listesi ve komut satırı sızıntısı testi yok (`NtQuerySystemInformation`, WMI sorgusu). | Bölüm 4, N-04/N-05 | SBX-4: N-04 genişletilir ve yeni testler eklenir: N-22 (çapraz-run), N-23 (süreç ve komut satırı enumerasyonu). |
| C-10 | MEDIUM | **Host'ta üçüncü taraf çekirdek sürücüleri yüklü.**<br>- Yüklü sürücüler: `iobit_monitor_server2021` (2021), `AscFileFilter` ve `AscRegistryFilter` (IObit). Bunlar R1'in paylaşılan çekirdek yüzeyini büyütüyor.<br>- Belgede device nesnelerinin LPAC'tan açılabilirliği test edilmiyor. | `driverquery` (05:44) | SBX-4: N-24, LPAC'tan `\\.\` ve `\GLOBAL??` altındaki üçüncü taraf device nesnelerini açma denemesi; beklenen sonuç DENIED.<br>D-SBX-H1'e not: IObit sürücülerinin gerekliliği Founder tarafından değerlendirilmeli. |
| C-11 | MEDIUM | **Disk sınırı uygulanmıyor, yalnız izleniyor (R4); yarış penceresi küçümsenmiş.**<br>- 1-2 sn'lik yoklama aralığında SSD'de birkaç GB yazılabilir.<br>- Sparse dosyalar ve milyonlarca küçük dosya (MFT büyümesi) bayt sayacına yansımaz.<br>- Watchdog'un AC profil dizinini (`%LOCALAPPDATA%\Packages\<moniker>`, AC'nin kendi yazabildiği yer) ve AC registry depolamasını kapsadığı belirtilmemiş.<br>- C: sistem diski dolarsa Work OS journal yazımı ve host uygulamaları etkilenir. | Bölüm 6, R4 | SBX-2: daha kısa yoklama aralığı ve dosya sayısı sınırı; ayrılan alan (allocation size) üzerinden ölçüm; profil dizini dahil; job I/O hız sınırı (`JobObjectIoRateControlInformation`, yönetici gerektirip gerektirmediği **UNKNOWN**). Aşımda run FAILED ve sonraki run'lar için temizlik doğrulaması. |
| C-12 | HIGH | **Fail-closed kablolaması eksik tanımlı.**<br>- Self-test'in **her uygulama açılışında ve her run'dan önce** çalışacağı, sonucunun önbelleğe alınmayacağı ve zorunlu olduğu yazılı değil.<br>- Self-test'in bir config veya ortam değişkeniyle (test/smoke modu) atlanamayacağı yazılı değil.<br>- Paketlenmiş build'de varsayılanın `NullProvider` olduğu ve sağlayıcı seçiminin korumalı config'ten geldiği yazılı değil.<br>- OS build/UBR değişirse (Windows güncellemesi, Win11 yükseltmesi) tam N-paketi yeniden geçene kadar BLOCKED kalınacağı (**yeniden sertifikasyon**) yazılı değil.<br>- AC ağ engeli Windows Firewall ve BFE servisine dayanır. Üçüncü taraf bir güvenlik yazılımı (IObit) veya kapatılmış bir MpsSvc bu engeli düşürebilir. Self-test'in her açılışta N-09/N-10 kanaryasını çalıştırması şart.<br>- Run sonrası "job'da süreç kalmadı" kontrolü başarısız olursa sonraki run'ların BLOCK edileceği yazılı değil.<br>- SBX-0 için spy testi yalnız bilinen yolları kapsıyor. `runner.ts`/`devrun.ts` dosyalarında sağlayıcı dışında `cp.spawn`/`runProcess` kullanımını yasaklayan statik bir kontrol yok. | Bölüm 3.5, SBX-0, SBX-4 | SBX-0: statik yasak testi.<br>SBX-4/SBX-5: açılış ve run öncesi kanarya (dosya-deny, loopback-deny, job sınırı) + OS build/UBR'ye ve launcher/node hash'ine bağlı sertifika kaydı; uyuşmazlıkta BLOCKED.<br>Yeni negatif test N-25: firewall servisi durumu değişince self-test FAIL verir. |
| C-13 | MEDIUM | **Windows Home ve müşteri makineleri için iddia fazla iddialı.**<br>- Bölüm 0'da "Home sürümlü müşteri makinelerinde de çalışırlar" deniyor. Oysa:<br>&nbsp;&nbsp;- runtime, `C:\Program Files\nodejs` kopyasına dayanıyor; node kurulu olmayan müşteri makinesinde sonuç BLOCKED olur<br>&nbsp;&nbsp;- launcher kurulumda `csc.exe` ile derlenen imzasız bir exe<br>&nbsp;&nbsp;- Win11'de Smart App Control veya Defender ML imzasız launcher'ı engelleyebilir; sonuç fail-closed ama kullanılamaz<br>&nbsp;&nbsp;- Founder node'u güncellerse hash değişir; yeniden sabitleme (re-pin) akışı tanımlı değil<br>- LPAC altında node'un `lpacCryptoServices` gibi capability'lere ihtiyaç duyma olasılığı ve her eklenen capability için ayrı karar kaydı belirtilmemiş.<br>- Win10 EOS olduğu için güncelleme kaynaklı kırılma olasılığı düşük. Ama önerilen D-SBX-H1 (Win11) **tam yeniden sertifikasyon** gerektirir ve bunun ETA'ya etkisi yazılmamış. | Bölüm 0 madde 1; 3.2; 7 (C3, C4) | SBX-5: imzalı veya hash'i sabitlenmiş, önceden derlenmiş launcher ve paketlenmiş runtime kararı (M1 sonrasına ertelenecekse "M1 sandbox yalnız Founder makinesinde" açıkça yazılmalı) + node re-pin akışı.<br>SBX-1: LPAC capability kararlarının kaydı. |
| C-14 | HIGH (yönetişim) | **D-REL-1 kapsamı belirsiz.** UASCO'nun kendi kodu da Claude tarafından üretiliyor. Supervisor validasyonu (`npm test`/vitest), smoke script'leri ve M0 installer build'i (npm/electron-builder bağımlılıkları) host'ta çalışıyor. Belge bunun D-REL-1 kapsamında olup olmadığını **hiç tartışmıyor**. | Bölüm 0, 11 | Yeni karar D-SBX-10: UASCO self-build validasyonu (kendi repo, bağımsız review, korumalı kapılar) D-REL-1 kapsamı dışında mı, yoksa sandbox'a mı taşınacak? Founder'ın "M0'ı durdurma" talimatıyla uyumlu bir öneri: açık istisna kaydı + bağımlılık lockfile/integrity kapısı. |
| C-15 | LOW | **Run başına runtime ACE'si eklemek ACL yığılmasına yol açar.** `runtime\` dizinine her run için AC SID ACE'si eklenip çıkarılıyor. Bu, eşzamanlı run'larda yarış durumu ve broker çökerse öksüz ACE yığılması (A5'e benzer) üretir. | Bölüm 3.3 | SBX-2: yönetici gerektirmeyen `DeriveCapabilitySidsFromName` ile sabit bir UASCO capability SID'i; ACE `runtime\` dizinine bir kez eklenir. |
| C-16 | LOW | `git archive` export, ağaç içindeki `.gitattributes` `export-subst`/`export-ignore` girdilerini işliyor. gitleaks ve trivy güvenilmeyen içeriği host'ta ayrıştırıyor (R8 kabul edilmiş). Trivy'nin arşiv (JAR/ZIP) analizörleri ve symlink izleme davranışı değerlendirilmemiş. | `project-studio.ts:341`; R8 | SBX-3 notu. M1.1'de tarayıcıların sandbox'a taşınması. |

### 12.2 Fazla iddialı veya eksik ifadeler

- **Bölüm 0 madde 1 ve bölüm 5.** "Ağı yönetici olmadan kapatırlar" ve "WFP … engeller" kesin dille yazılmış. Bunlar bu host'ta doğrulanmadı ve firewall servisine bağlı (C-12). Kesin dil yerine "beklenen, N-09/10/11 ile kanıtlanacak" demek gerekir.
- **Bölüm 3.6.** "Builder … proje kodu çalıştırmaz" ifadesi Claude CLI'ın proje ayar dosyalarından komut çalıştırabilmesi nedeniyle doğru değil (C-01/C-02).
- **Bölüm 3.3, R7.** Builder `.git` riski fazla gösterilmiş: digest mevcut (C-07). Import yolu riski ise hiç gösterilmemiş (C-06).
- **P-SBX-6.** `config/builder-execution-policy.json` değişmeyecek deniyor. Ancak korumalı `scripts/claude-builder-broker.mjs` dosyasının değişmesi gerekiyor ve izin metninde yok (C-01).
- **Bölüm 4.** "0 ESCAPED / 0 INCONCLUSIVE" kabul ölçütü doğru. Ancak test listesi C-01/02/05/06/07/09/10/12 eklenmeden tamam sayılmamalı.

### 12.3 ETA hesabı (bölüm 9) üzerine

- **Hafta sonu bağımlılığı yazılmamış.** 15 Eki Perşembe; 17-18 Eki hafta sonu. P80 yolu Founder'ın 17 Eki **Cumartesi** 09:00'da gerçek kurulum yapmasını varsayıyor. Bu varsayım yazılı değil. Founder hafta sonu müsait değilse P80 ≈ **19 Eki Pzt ~20:00** olur (tahmin, ölçülmedi).
- **Tablo iç tutarlılığı.** SBX-0 "REL-FX-1'den sonra" deniyor ve 13:00'te bitiyor; ama "REL-FX-1..4 CLEAN + entegre" satırı 17:00. REL-FX-1'in tek başına ne zaman biteceği belirtilmemiş. Merge tool satırı (10:00) da sıra dışı listelenmiş.
- **Paralellik ve validasyon kuyruğu.** Ölçülmüş verilere göre tam validasyon 26-30 dk, yük altında ~56 dk. Plan SBX-2 ∥ SBX-3 ve SBX-5 ∥ SBX-6 paralelliğini ve REL-FX hattıyla eşzamanlılığı varsayıyor. Döngü başına 1,5 sa (P50) varsayımı paylaşılan validasyon kuyruğunu tam yansıtmıyor olabilir.
- **Yeni boşlukların etkisi.** SBX-8 (2-3 güvenlik-kritik döngü + korumalı dosya için Founder FA'sı) ve SBX-3/SBX-4 genişlemeleri (+1-2 döngü) eklenmeli. Bu iş, P50 ve P80 yollarındaki gece duraklamasına sığabilir. Bunun için üç koşul gerekir:
  - (i) broker FA'sı 15 Eki gündüz verilir
  - (ii) gözetimsiz gece hattı çalışır
  - (iii) kota dolmaz
- **Eleştirmen tahmini** (ölçülmedi; üç koşul sağlanırsa):
  - P50 ≈ 16 Eki 18:00-21:00
  - P80 ≈ 17 Eki ~20:00 (hafta sonu müsaitliği varsa), aksi halde 19 Eki
  - P95 ≈ 21 Eki ~12:00
- **P95'in koşullu olduğu belirtilmemiş.** Belgedeki P95 **spike başarısına koşullu**. Spike başarısız olursa tarih UNKNOWN. Bu koşul, olasılığıyla birlikte, P95 satırında açıkça yazılmalı.

### 12.4 Eleştirmen kararı

**Belge, seçilen yöntem (AppContainer/LPAC + Job) açısından makul.** Ancak M1 için **eksik**:
- **C-01/C-02** sandbox'tan bağımsız bir host-yürütme yolu. D-REL-1'in doğrudan konusu ve M1 blocker. SBX-8 paketi ve P-SBX-6 genişletmesi olmadan M1 kabul edilemez.
- **C-04, C-05, C-12 ve C-14** de M1 kabulünden önce kapatılmalı veya açık Founder kararıyla kayda geçmeli.

Bu notlar CLEAN beyanı değildir. Hiçbir prob çalıştırılmadı.
