# UASCO Tam M1 — Desteklenen İzolasyon Teknolojileriyle Entegrasyon Planı

- Tarih: 2026-10-15
- Rol: Founder için sentez yazarı (supervisor tarafı; ürün kodu implementer'ı DEĞİL)
- Mod: SALT OKUNUR analiz ve planlama. Hiçbir sandbox launcher, escape testi veya izolasyon negatif testi yazılmadı/tasarlanmadı/çalıştırılmadı.
- Founder kararı dayanağı: D-SBX-SUPPORTED-ISOLATION-2026-10-15 (ve öncesi), FD-REL-1-REJECT-HOST-EXEC-2026-10-15.
- Karantinadaki `UASCO-recovery/quarantine/sbx1a-partial-20261015` okunmadı, kullanılmadı, referans alınmadı.

> UYARI: Bu belgedeki hiçbir izolasyon sınırı DOĞRULANMIŞ değildir. Bağımsız negatif test paketi (harici güvenlik uzmanı) 0 ESCAPED / 0 INCONCLUSIVE döndürene kadar INT-R3 kapısı fail-closed kalır. "Güçlü izolasyon" ifadeleri tasarım hedefidir, kanıt değildir.

---

## 0) Yönetici Özeti

- **Seçilen yol (PRIMARY):** Founder'ın ana PC'sine HİÇBİR değişiklik yapmayan, **ayrı/yedek fiziksel bir makineyi kısıtlı bir uzak worker (remote worker)** olarak kullanmak. Her iki bağımsız analiz de bu adayı birinci sıraya koydu (securityFirst skoru 9/10, leastChange skoru 8/10).
- **Özel launcher gerekiyor mu? HAYIR.** Custom AppContainer launcher tamamen masadan kalktı (3 güvenlik sınıflandırıcı durdurması, D-SBX-SUPPORTED-ISOLATION madde 1). Seçilen yol yalnızca mevcut, resmî desteklenen işletim sistemi özelliklerini (normal Windows/Linux + Node/npm + kısıtlı SSH/WinRM kanalı) kullanır. UASCO tarafında yazılacak olan, yalnızca mevcut INT-R3 `ExecutionGate`'e programatik olarak enjekte edilen ince bir `SandboxProvider` taşıma (transport) istemcisidir — launcher/escape kodu değil.
- **Gereken Founder izinleri (hepsi ayrı onay + geri alma gerektirir):**
  1. Yedek fiziksel makine tahsisi (mevcut bir PC'nin yeniden kullanımı veya ucuz mini-PC/NUC alımı).
  2. İzole ağ segmenti (kendi VLAN/subnet veya küçük switch; gateway'siz).
  3. Worker üzerinde tek, kimliği doğrulanmış, varsayılan-kapalı kanal (SSH/WinRM) kurulumu.
  4. Harici bağımsız güvenlik uzmanının negatif paketi çalıştırması için görevlendirme/sözleşme.
  - Ana PC'de: admin/elevation YOK, BIOS/firmware değişikliği YOK, edition upgrade YOK, firewall/policy değişikliği YOK, VM oluşturma YOK. Mevcut onaylar GENİŞLETİLMEZ.
- **Tam M1 ETA (en olası yol = fiziksel worker; 2026-10-15'ten itibaren):**
  - **P50: 2026-10-18**
  - **P80: 2026-10-21**
  - **P95: 2026-10-27**
  - Reddedilen custom-launcher planına (P50 16 Eki / P80 17 Eki / P95 20 Eki) kıyasla fark: **+~1.5 gün (P50) / +~3 gün (P80) / +~6 gün (P95)**. Fark sürücüsü ağırlıklı olarak harici uzman planlaması ve donanım/kanal kurulumudur. Güven: düşük-orta.
  - **KOŞUL:** Founder hiçbir donanım ve hiçbir ana-PC değişikliğine izin vermezse, tam M1 yürütme ETA'sı **UNKNOWN**'dır ve kapı süresiz fail-closed kalır; A/B/C/M1a yine de devam eder.
- **Founder öncelik sırası korunur:** Bu plan A (M0 install), B (REL-FX), C (M1a) veya mevcut yetki içindeki hiçbir işi BLOKLAMAZ. Yalnızca tam M1'in güvenilmeyen-kod yürütmesi, doğrulanmış sağlayıcı + geçmiş self-test + harici negatif paket geçene kadar BLOCKED(SANDBOX_UNAVAILABLE)/NOT_EXECUTED (runner) ve 409 (devrun) kalır.

---

## 1) Host Doğrulaması (Salt Okunur)

Kaynak: SBX-03-supported-isolation-facts.md (pure LF, 8903 bytes, sha256 `6F911046969DD30901E084EC9FE01DB7BCAB1A3A7FA8F56AB9B1AADAD35F8DB4`). SBX-00'a göre karşılaştırmalı doğrulama; hiçbir komut elevated çalıştırılmadı.

| Alan | Durum | Not |
|---|---|---|
| Edition / build | Windows 10 **Home** (Core), 22H2, build 10.0.19045.6466 (UBR 6466), 64-bit | SBX-00'a göre değişmedi |
| CPU | Intel i7-9700, 8C/8T; SLAT + VMMonitorModeExtensions = True | Win11 CPU listesinde (Coffee Lake Refresh, 9. nesil) |
| VT-x (firmware) | **KAPALI** (VirtualizationFirmwareEnabled=False; systeminfo "Virtualization Enabled In Firmware: No") | CPU yetenekli ama BIOS'ta kapalı |
| Hyper-V | Home'da **YOK** (Win32_OptionalFeature'da özellik yok; Pro upgrade + VT-x gerekir); HypervisorPlatform=Disabled | SBX-00 ile aynı |
| Windows Sandbox | Home'da **YOK** (Containers-DisposableClientVM Home'da yok, sadece devre dışı değil) | Pro/Enterprise/Education özelliği |
| WSL | Kurulu/etkin değil (wsl.exe inbox var ama feature Disabled, VMP Disabled, distro yok). WSL2 = VMP+VT-x gerektirir; WSL1 güvenlik sınırı değil | SBX-00 ile aynı |
| Win11 uygunluğu | CPU GEÇER ama makine şu an uygun DEĞİL | Engeller: Legacy BIOS (UEFI değil), Secure Boot off/uygulanamaz, TPM 2.0 algılanmadı. TPM/Secure Boot kesin durumu admin olmadan **UNKNOWN**; okunabilen tüm sinyaller negatif |
| 3. taraf VM | Yok (docker/podman/VBoxManage/vmrun/qemu/vagrant/kubectl/multipass PATH'te yok) | node v24.20.0 / npm 11.19.0 Program Files'ta mevcut (M1 toolchain, D-SBX-8) |
| Remote worker | Yapılandırılmamış (sadece inbox OpenSSH client; ~/.ssh config/known_hosts yok; az/aws/gcloud/terraform yok) | SBX-00 ile aynı |
| Firmware boot mode | **Legacy BIOS** (firmware_type=Legacy; PEFirmwareType değeri yok) | NET-NEW tespit (SBX-00'da yoktu) |
| TPM / Secure Boot | TPM PnP cihazı yok; MicrosoftTpm namespace elevation gerektirir = UNKNOWN; SecureBoot\State kayıt anahtarı yok (Legacy) | NET-NEW; kesin durum admin olmadan UNKNOWN |
| Disk / RAM | C: 594 GB boş, E: 1551 GB boş, RAM ~16 GiB | C: 603→594 GB normal kullanım |
| Yama durumu | Son yama Kas 2025; tüketici ESU 2026-10-13'te bitti. QFE InstalledOn 2026-10-11 okunuyor ama build aynı (19045.6466) = yalnızca tarih tutarsızlığı, duruş değişikliği değil | Ana PC yamasız risk |

**Sonuç:** Yerel hipervizöre dayalı HİÇBİR desteklenen izolasyon teknolojisi bu host'ta şu an mevcut DEĞİL. Her yerel seçenek en az bir BIOS VT-x etkinleştirmesi (firmware değişikliği) ve çoğu ayrıca ücretli edition upgrade gerektirir. Ana PC'yi HİÇ değiştirmeyen tek yollar: ayrı fiziksel makine veya bulut worker.

---

## 2) Desteklenen İzolasyon Teknolojileri Karşılaştırması (İki Analizin Sentezi)

İki bağımsız mercek kullanıldı:
- **securityFirst:** gerçek izolasyon gücü (ayrı kernel > paylaşılan kernel; ayrı fiziksel makine en iyisi) + UASCO escape testi YAZMADAN bağımsız doğrulanabilirlik.
- **leastChange:** en az değişiklik / doğrulanmış M1'e en hızlı yol; install/admin/BIOS/ücret/reboot cezalandırılır, Founder kapılarını (ağ varsayılan-kapalı, kaynak limiti, dev klasörlerinin full-write mount'u yok, fail-closed, bağımsız harici negatif doğrulama) yapısal karşılayamayan seçenek düşürülür.

Ortak sert önkoşul: **bu host'ta hiçbir aday şu an mevcut değil.**

| # | Teknoloji | Bu host'ta mevcut? | securityFirst skoru | leastChange skoru | İzolasyon gücü (güvenilmeyen koda karşı) | Ağ varsayılan-kapalı | Kaynak limiti | Bağımsız doğrulanabilirlik |
|---|---|---|---|---|---|---|---|---|
| 6 | **Yedek fiziksel makine (kısıtlı remote worker)** | Hayır (ayrı donanım gerekir) | **9** | **8** | En yüksek: fiziksel ayrı kernel + ayrı donanım; ana PC'nin dosya/profil/kimlik/Trust Kernel'ine erişim yok | En güçlü (fiziksel/router zorunlu) | Tüm-makine sert sınır + opsiyonel job/cgroup | En güçlü (fiziksel ayrım harici uzmanca önemsizce denetlenebilir) |
| 1 | Hyper-V client VM (Type-1, Microsoft) | Hayır (Home'da yok; Pro upgrade + VT-x) | 8.5 | 6 | Yüksek: donanım-sanallaştırma sınırı; MSRC Hyper-V bug bounty | Güçlü (vSwitch yok / private + Hyper-V firewall) | Güçlü (per-VM vCPU/RAM/VHDX) | İyi (Microsoft track record + harici uzman) |
| 2 | Windows Sandbox (Containers-DisposableClientVM) | Hayır (Home'da yok) | 8 | — | Yüksek: Hyper-V tabanlı atılabilir masaüstü | **Varsayılan AÇIK** (.wsb ile Networking=Disable zorunlu) | Zayıf (sadece MemoryInMB; tek örnek) | İyi (Microsoft Hyper-V tabanı + harici uzman) |
| 7 | Bulut / ephemeral remote worker (GitHub runner, Codespaces, cloud VM) | Hayır (hesap + fatura) | 7 | 7 | Yüksek per-job VM; ama sınır 3. tarafça işletiliyor | **Varsayılan AÇIK** (egress; D-SBX-9 offline modeliyle çelişir) | Sabit runner boyutu + timeout | Kısmi (sağlayıcı iddiası + egress testi; off-premises) |
| 5 | VirtualBox / VMware Workstation (3. taraf Type-2) | Hayır (BIOS VT-x + ring-0 sürücü) | 6.5 | 5 | Yüksek-ish: ayrı guest kernel; ama 3. taraf ring-0 sürücüsü ana PC yüzeyini genişletir. **Edition upgrade GEREKMEZ (Home'da çalışır)** | Güçlü (NIC yok / host-only) | Güçlü (per-VM) | Orta (olgun satıcı ama host kernel sürücüsü ekstra yüzey) |
| 4 | Olgun container runtime (Docker Desktop / Podman) | Hayır (önce WSL2/Hyper-V backend) | 5 | düşük | **Zayıf**: paylaşılan backend VM kernel; Microsoft düşmanca çok-kiracılık için ÖNERMEZ | İyi (--network none) ama backend VM katmanında da tutulmalı | İyi (cgroups CPU/mem/pids) | Zayıf (kernel paylaşımı doğrulanmalı; Docker lisans riski) |
| 3 | WSL2 (mirrored networking + firewall) | Hayır (Win11 + VT-x + VMP) | 4.5 | — | Düşük-orta: guest root in-guest firewall/iptables kontrol eder, drvfs ile host C: remount edebilir; Microsoft WSL'i güvenlik sınırı SAYMAZ | Kısmi, yalnız Win11 (Win10 host-zorunlu deny yok) | VM geneli (.wslconfig), per-run değil | Zayıf (satıcı sınır iddiası yok) |

**Sentez sonucu:** İki mercek de aynı birinciyi veriyor: **yedek fiziksel makine.** Her iki eksende de kazanıyor (en güçlü + en kolay bağımsız doğrulanabilir izolasyon VE ana PC'de SIFIR ayrıcalıklı değişiklik). Hyper-V güçlü ikinci ama ana PC'ye ücretli + firmware + admin değişikliği dayatır. WSL2, paylaşılan-kernel container ve bulut runner, güvenilmeyen M1 kodu için izolasyon SINIRI olarak ÖNERİLMEZ (gerekçeler: Microsoft'un WSL = sınır değil duruşu; düşmanca koda container önerilmemesi; bulutta varsayılan-açık egress + tescilli kodun şirket dışına çıkması, D-SBX-9 ile çelişir).

Kaynaklar: Microsoft Learn (Windows Sandbox, WSL networking/FAQ, Windows security servicing criteria, Azure hypervisor), Docker Desktop lisans, GitHub-hosted runners, PCWorld Win11 CPU listesi; ayrıca SBX-00, SBX-03 ve UASCO_M1_SANDBOX_ISOLATION_ASSESSMENT_2026-10-15 (yerel).

---

## 3) Önerilen Yol ve Neden

**PRIMARY: Yedek fiziksel makine, kısıtlı remote worker (securityFirst 9 / leastChange 8).**

Verilen mercek altında iki nedenle kazanır:
1. **İzolasyon gücü + bağımsız doğrulanabilirlik:** Fiziksel olarak ayrı kernel VE donanım. Harici uzman, UASCO'nun hiç escape testi yazmasına gerek kalmadan ayrımı önemsizce denetleyebilir. Hiçbir satıcı "sınır" iddiasına güven sıçraması gerekmez.
2. **Ana PC'ye sıfır ayrıcalıklı değişiklik:** Ana PC tam da `.claude` kimlik bilgilerini, UASCO depolarını, Trust Kernel'i ve hâlâ canlı CodexSandboxUsers/orphaned-ACL risklerini (A1/A2) barındıran ve Kas 2025'ten beri yamasız (ESU 2026-10-13'te bitti, R1) makinedir. Bu seçenek o makineye dokunmaz. Geri alma en temiz olanıdır: worker'ı kapat/yeniden imajla; ana PC'de geri alınacak hiçbir şey yok.

**En güçlü aday ile verilen yetki içinde kalan aday arasındaki fark:** Bu durumda ikisi ÇAKIŞIYOR — en güçlü aday (fiziksel worker) aynı zamanda ana PC'ye hiçbir ayrıcalıklı değişiklik gerektirmeyen tek yüksek-izolasyon seçeneğidir. Tek yeni yetki, Founder'ın onaylaması gereken ayrı donanım + izole ağ + tek kanaldır; ana PC'nin admin/BIOS/edition/firewall/policy'si değişmez ve mevcut onaylar genişletilmez.

**ÖZEL LAUNCHER YOK:** UASCO ne launcher ne escape test ne izolasyon negatif testi yazar. Yalnızca mevcut INT-R3 kapısına programatik enjekte edilen ince bir transport istemcisi (`SandboxProvider`) yazılır (bkz. §4).

**FALLBACK sırası (yalnız Founder donanıma izin vermezse):**
- **1. Fallback — Hyper-V client VM (securityFirst 8.5):** Açık Founder onay+geri alma paketi arkasında: ücretli Win10/Win11 Pro upgrade + BIOS VT-x + admin + reboot (+ Win11'e geçişte Legacy→UEFI+GPT, Secure Boot, TPM 2.0/Intel PTT). Olgun, Microsoft-destekli, ayrı-kernel sınır; MSRC bug bounty ile dışarıdan doğrulanabilir. Ana PC'ye ücretli+firmware+admin dayatması ve yamasız fiziksel host paylaşımı nedeniyle fiziksel worker'ın altında.
- **2. Fallback — VirtualBox/VMware (securityFirst 6.5):** Home'da edition upgrade olmadan çalışır ama BIOS VT-x + 3. taraf ring-0 kernel sürücüsü gerektirir (kendi onay+geri alma'sı).
- **ÖNERİLMEZ:** WSL2, paylaşılan-kernel container, bulut runner — güvenilmeyen M1 kodu için izolasyon sınırı olarak kullanılmaz (§2 gerekçeleri).

Her durumda INT-R3 kapısı, harici negatif paket geçene kadar fail-closed kalır.

---

## 4) SandboxProvider Entegrasyonu (launcher/escape kodu YAZILMADAN tarif)

Mevcut INT-R3 adayı `core/workos/execution-gate.ts` (worktree v2-int-r3; INT-R3 CLEAN @ 6aa7267) zaten fail-closed yürütme kapısını içeriyor. Aşağıdaki tarif yalnızca mevcut arayüze nasıl bağlanılacağıdır; kod yazılmadı.

### 4.1 Mevcut kapı sözleşmesi (okunan gerçek arayüz)
```
interface SandboxProvider {
  readonly id: string;
  selfTest(): Promise<{ok: boolean; detail?: string}>;
  run(argv: string[], opts: SandboxRunOptions): Promise<ProcResult>;
  spawn(command: string, args: string[], opts: SpawnOptions): ChildProcess;
}
interface SandboxRunOptions { cwd: string; env; timeoutMs: number; input?: string; shouldAbort?: () => boolean }
type ProjectExecutionKind = "RUNNER_VERIFY_TESTS" | "RUNNER_REGRESSION_TESTS" | "STUDIO_DEVRUN";
```
- Sağlayıcı **yalnızca programatik** olarak `ExecutionGate` kurucusu üzerinden verilebilir. env, config dosyası, journal, API gövdesi veya masaüstü ayarı sağlayıcı kaydedemez/taklit edemez. `null`/eksik/geçersiz = `NO_VERIFIED_PROVIDER` = BLOCKED.
- `selfTest()` süreç (kapı örneği) başına bir kez çalışır; **yalnızca açık `{ok: true}`** geçer. Hata/zaman aşımı/başka değer fail-closed'dur (`SELF_TEST_FAILED` / `SELF_TEST_ERROR`).
- `runner.ts`: sağlayıcı yoksa test HİÇ çalıştırılmaz; kanıt `*_NOT_EXECUTED` yazılır (PASS/FAILED değil), run BLOCKED olur, **yeniden deneme bütçesi tüketilmez, remediation yok** (FD-REL-1-REJECT-HOST-EXEC).
- `devrun.ts`: sağlayıcı yoksa dev komutu hiç başlatılmaz; durum BLOCKED/SANDBOX_UNAVAILABLE yazılır ve **409** döner. Yalnızca gerçek bir `ExecutionGate` örneği kabul edilir; başka her değer sağlayıcısız kapıdır.

### 4.2 Fiziksel worker sağlayıcısının bağlanması (tasarım, kod değil)
- **id:** `remote-worker-<host>`.
- **selfTest():** Harici sahipli negatif/canary "deny-probe"u worker ÜZERİNDE çalıştırır; ana PC dosya/profil/kimlik/Trust Kernel erişimi YOK, ağ varsayılan-kapalı tutuluyor ve limitler uygulanıyor doğrulanır. Yalnız açık `{ok:true}` kaydolur; aksi halde kapı fail-closed kalır. (Bu probe'u UASCO YAZMAZ — harici uzman sahibidir; bu yüzden §5.)
- **run(argv, opts):**
  - **Taşıma:** worker'a kısıtlı, kimliği doğrulanmış SSH/WinRM kanalı.
  - **Çalışma kopyası GİRİŞ:** host tarafında hazırlanan staging dizini kanaldan worker'daki **her-run için yeni (per-run) bir dizine KOPYALANIR** — Founder dev klasörlerinin yazılabilir mount'u ASLA değil; `.git` hariç; reparse-point/hardlink reddedilir.
  - **Yürütme:** `argv` (ör. `npm test` / dev komutu) worker tarafında, `opts.timeoutMs` worker tarafında zorlanarak çalıştırılır. `opts.shouldAbort` ile iptal köprülenir.
  - **ÇIKIŞ / sonuç yakalama:** yalnızca yakalanan stdout/stderr + çıkış kodu `ProcResult` olarak geri döner. **`executedTestCount` sağlayıcı tarafından DEĞİL, runner tarafından bu yakalanan test çıktısı ayrıştırılarak türetilir** (kapı sonuç-içeriğine agnostik kalır). Sonuç ana PC tarafında kapı kabul etmeden önce yeniden doğrulanır (kötücül çıktıya karşı son hat).
- **spawn(command, args, opts):** Aynı kanalı Studio devrun için destekler (uzun ömürlü süreç; tek kontrollü port SSH reverse-tunnel/tek firewall kuralı ile geri açılır).
- **Önizleme (devrun):** M1'de yalnız statik önizleme (`dist/` geri kopyalanır). Canlı HMR ek ağ yüzeyi açtığı için M1'de **BLOCKED kalır**.
- **Bağımlılıklar:** D-SBX-9 gereği host tarafında `npm ci --ignore-scripts` ile temiz staging dizininde önceden hazırlanır; worker'ın kendisi outbound erişim gerektirmez.

Bu bir **transport tasarımıdır**; hiçbir launcher veya escape kodu yazılmadı.

---

## 5) Negatif Test Sahipliği

- **İlke:** UASCO escape/negatif testi YAZMAZ ve çalıştırmaz (D-SBX-SUPPORTED-ISOLATION). Sandbox negatif testleri mevcut politika nedeniyle UASCO tarafından yapılamaz; eksik testler **bağımsız güvenlik doğrulamasına** yönlendirilir. Sınıflandırıcıyı aşma girişimi yok; bir durdurma olursa o adım durdurulur ve aynen raporlanır.
- **Seçilen teknolojinin olgunluğu:** Fiziksel ayrım, satıcı "sınır" iddiasına ihtiyaç duymayan, bir harici uzmanın önemsizce denetleyebileceği en nesnel izolasyondur. (Fallback Hyper-V için: Microsoft hipervizör track record + MSRC Hyper-V bug bounty harici doğrulanabilirliği taşır.)
- **Sahip:** Harici bağımsız güvenlik uzmanı negatif/escape paketini **doğrudan fiziksel worker üzerinde** çalıştırır ve imzalar. Kapsam (en az): (a) worker'dan ana PC dosya/profil/tarayıcı/kimlik/Trust Kernel erişiminin KAPALI olduğu; (b) ağın varsayılan-kapalı tutulduğu ve kod tarafından açılamadığı; (c) CPU/RAM/disk/süre/süreç limitlerinin uygulandığı; (d) kanalın tek yönlü/kimliği doğrulanmış kaldığı; (e) `selfTest` canary'sinin gerçekten fail-closed olduğu.
- **Kabul eşiği:** Harici paket **0 ESCAPED / 0 INCONCLUSIVE** döndürmeden hiçbir sağlayıcı "doğrulanmış" sayılmaz; kapı o ana kadar BLOCKED kalır.
- **UNKNOWN:** Harici uzmanın görevlendirme takvimi henüz belirlenmedi (Founder kararı §10); bu P95'in baskın riskidir.

---

## 6) Yeni Kurulum / Sistem Değişikliği (seçenek başına tam etki + geri alma + EXACT izin kapsamı)

> Hiçbiri şu an uygulanmadı. Hiçbir mevcut onay genişletilmedi.

### Seçenek 6 — Fiziksel worker (PRIMARY)
- **Ana PC etkisi:** YOK (admin/BIOS/edition/firewall/policy değişikliği yok).
- **Yeni öğeler:** (1) ayrı fiziksel makine; (2) izole ağ segmenti (kendi VLAN/subnet, gateway yok veya küçük switch); (3) worker üzerinde tek kimliği-doğrulanmış SSH/WinRM kanalı + UASCO runner agent.
- **EXACT izin kapsamı:** Yalnız worker ve ağ segmenti; ana PC dokunulmaz. Setup+rollback tümüyle yedek kutuda.
- **Geri alma:** En temiz. Worker'ı kapat/yeniden imajla. Ana PC'de geri alınacak hiçbir şey yok.
- **Artık risk:** Ağ gerçekten segmente değilse yanal hareket (dedicated switch/VLAN + paylaşılmayan kimlik ile azalt); worker her-run yeniden imajlanmalı (disposable); tescilli kod Founder'a ait on-prem donanımda kalır (3. tarafa gitmez — buluta göre gizlilik artısı).

### Seçenek 1 — Hyper-V VM (1. Fallback)
- **Ana PC etkisi:** AĞIR. Win10 Home→Pro **ücretli upgrade** (Win10'da kalır, Win11 ameliyatından kaçınır) + **BIOS VT-x etkinleştir** (firmware) + admin + feature enable + **reboot**. (Win11 Pro yolu daha kötü: Legacy BIOS + TPM/Secure Boot yok ⇒ ayrıca UEFI/GPT dönüşümü.)
- **EXACT izin kapsamı:** Edition upgrade + BIOS VT-x + Hyper-V feature + reboot — her biri ayrı Founder onayı; mevcut onaylar genişletilmez.
- **Geri alma:** Guest: checkpoint geri al / VM sil. Host: Hyper-V feature devre dışı, Home'a geri dön, VT-x'i kapat — **çok adımlı firmware+lisans geri alma**; ücretli Pro upgrade ve herhangi bir Win11 UEFI/GPT/Secure Boot/TPM dönüşümü etkin olarak tek yönlüdür ve kendi geri alma planını gerektirir.
- **Artık risk:** Hipervizör escape (nadir, satıcı-yamalı) + switch/firewall misconfig; ana PC'yi ücretli edition + VT-x açık tutar (ana-PC saldırı yüzeyini genişletir); yamasız fiziksel host paylaşılır (blast radius disposable guest'e sınırlı).

### Seçenek 5 — VirtualBox/VMware (2. Fallback)
- **Ana PC etkisi:** Orta. Ürün + **kernel sürücü** kurulumu (admin) + **BIOS VT-x** (64-bit guest için zorunlu; Node v24 guest 64-bit) + reboot. **Edition upgrade gerekmez (Home'da çalışır).**
- **EXACT izin kapsamı:** Kernel-sürücü kurulumu + BIOS VT-x — ayrı Founder onayı; ileride Hyper-V etkinleştirilirse çakışabilir.
- **Geri alma:** Guest: snapshot geri al / VM sil. Host: ürün + kernel sürücü kaldır, VT-x kapat — Founder onaylı; edition upgrade'den temiz.
- **Artık risk:** 3. taraf ring-0 sürücü = ana-PC saldırı yüzeyi + bakım yükü; guest-additions/shared-folder misconfig; yamasız host.

### Seçenek 7 — Bulut worker (izolasyon sınırı olarak ÖNERİLMEZ)
- **Ana PC etkisi:** YOK. Ama bulut hesabı + fatura + egress politikası gerekir ve **güvenilmeyen + tescilli kod şirket dışına 3. tarafa çıkar.**
- **Geri alma:** Trivial (job gönderimini durdur / proje sil) ama zaten gönderilen veri geri çağrılamaz.
- **Artık risk:** Varsayılan-açık egress (D-SBX-9 offline modeliyle çelişir); IP/kimlik ifşası; satıcı güveni.

---

## 7) Maliyet ve Zaman Etkisi (Founder madde 11)

| Seçenek | Parasal maliyet | Kurulum zamanı | Provider wiring | M1'e kattığı net (yaklaşık) |
|---|---|---|---|---|
| 6 Fiziksel worker (PRIMARY) | Sahip olunan PC: $0; alınırsa ucuz mini-PC/NUC bir kerelik | ~0.5–1 gün (imaj + ağ + kanal) | ~1–1.5 gün | +~1.5 gün (P50) baz yol; donanım lead-time + harici uzman planı baskın |
| 1 Hyper-V VM (1. Fallback) | ~US$99 Pro lisansı (Win11 yolunda ek firmware işçiliği) | BIOS+admin+reboot+template birkaç saat | ~1–2 gün | Fiziksel worker'a yakın ama ana-PC onayları gecikme riski |
| 5 VirtualBox/VMware (2. Fallback) | Yazılım $0 (kişisel); VMware ticari şartları doğrulanmalı | BIOS + sürücü kurulumu + template birkaç saat | ~1–2 gün | Fiziksel worker'a yakın; sürücü onayı gecikme riski |
| 7 Bulut worker | Abonelik + dakika/compute + depolama (tekrarlayan) | Hesap varsa saatler | ~1–3 gün (hesap varsa), +3–6 gün (yoksa) | Stand-up en hızlı ama egress/gizlilik politikası reddi riski |

- **Switch maliyeti (reddedilen custom-launcher'a kıyasla):** +~1.5 gün (P50) / +~3 gün (P80) / +~6 gün (P95). Delta sürücüleri: (1) yedek makine tedariki/kurulumu (veya fallback'te ücretli Pro upgrade ~US$99 + BIOS + reboot + olası Win11 firmware dönüşümü); (2) **harici uzmanın negatif paketi çalıştırıp imzalaması** (UASCO çalıştıramadığı için P95'in baskın riski); (3) provider wiring (~1–1.5 gün).
- **UNKNOWN:** Harici uzmanın takvimi ve (varsa) ücreti; bulut için tam tekrarlayan maliyet; Founder donanıma/ana-PC değişikliğine izin vermezse tam-M1 yürütme maliyeti/zamanı **UNKNOWN**.

---

## 8) Tam M1 ETA (P50/P80/P95)

**En olası yol (fiziksel worker), 2026-10-15'ten itibaren:**
- **P50: 2026-10-18**
- **P80: 2026-10-21**
- **P95: 2026-10-27**

**Varsayımlar (ölçülü veriye dayalı):**
- Ölçülen implementasyon: p50 14.2 dk / p80 30.7 dk (Opus p50 20.3 dk); review p50 5.8 / p80 9.4 dk; güvenlik-kritik 2–3 döngü (son dönem 3–5); tam validation 26–30 dk (eta2-measured-data.md).
- M1 rehearsal D-M1-01..10 (REHEARSAL-REPORT.md) kapsandı.
- Provider wiring ~1–1.5 gün; self-test harness + transport dahil.
- Kritik yol = donanım kurulumu + provider wiring + **harici negatif paket takvimi** (UASCO çalıştırmaz).

**Seçenek başı fark (P50 bazına göre):**
- Hyper-V 1. Fallback: ~eşit işçilik ama ana-PC onay/BIOS/reboot beklemesi takvimi +0–2 gün kaydırabilir.
- VirtualBox 2. Fallback: benzer; sürücü onayı bekleme riski.
- Bulut: stand-up daha hızlı olabilir ama egress/gizlilik politikası doğrulaması ve off-premises reddi P80/P95'i belirsizleştirir.

**Güven: düşük-orta.** Baskın belirsizlik harici uzman planlamasıdır.

> **KOŞULLU UNKNOWN:** Founder hiçbir donanım ve hiçbir ana-PC değişikliğine izin vermezse, tam-M1 güvenilmeyen-kod yürütme ETA'sı **UNKNOWN**'dır ve kapı süresiz fail-closed kalır; A/B/C/M1a yine de ilerler.

---

## 9) Öncelik A–E ile Hizalama ve Bu Hafta Yapılabilecekler (hepsi mevcut yetki içinde)

Founder öncelik sırası: A) M0 gerçek Windows kurulumu; B) REL-FX güvenilirlik düzeltmeleri; C) M1a entegrasyonu + doğrulanmış teslim; D) Mevcut OS/VM teknolojisiyle sandbox entegrasyonu; E) Bağımsız güvenlik doğrulaması sonrası tam M1.

- **A — M0 (ŞU AN hazır):** M0 READY_FOR_FOUNDER_INSTALL. Bu plan M0'ı bloklamaz. Founder'a sunulacak M0 install paketi (exact installer path, SHA-256, kaynak commit, bağımsız review sonucu, güvenli Windows kurulum talimatları) ayrı M0 teslim belgesinde verilir — bu plan onun önüne geçmez.
- **B — REL-FX (cycle 4):** Structural acknowledgement gate döngüsü devam ediyor. FX-1..5 bağımsız doğrulama zorunluluğu ve REL-FX güvenlik kapıları HAFİFLETİLMEDEN sürer. REL-FX c3 reviewer raporunun değerlendirdiği daha sağlam disabled-test tasarımı (test sözdizimi analizi + korunan test envanteri + bağımsız kabul senaryoları), yalnızca dosya adı/metin desenine dayanmayan yaklaşım olarak benimsenir; sürekli yeni metin deseni ekleme yaklaşımından uzaklaşılır.
- **C — M1a:** M1a geliştirme + bağımsız review devam eder. INT-R3 adayı CLEAN (6aa7267) fail-closed execution-gate ile. Güvenilmeyen kod çalıştırma / dinamik test / canlı önizleme sandbox doğrulanana kadar BLOCKED kalır.
- **D — Sandbox entegrasyonu (bu plan):** Mevcut yetki içinde HEMEN yapılabilecekler: (i) `SandboxProvider` transport arayüzü hazırlığı — kod iskeleti/tasarım, launcher/escape kodu YOK; (ii) host tarafı `npm ci --ignore-scripts` staging akışının tasarımı (D-SBX-9); (iii) harici güvenlik paketi kapsam dokümanının hazırlanması (UASCO testi yazmadan). Donanım/ağ/kanal kurulumu Founder onayına bağlıdır.
- **E — Tam M1:** Yalnızca harici negatif paket 0 ESCAPED/0 INCONCLUSIVE döndükten + verified provider kaydı + geçmiş self-test sonrası. O ana kadar gate fail-closed.

**Korunan yapılar:** Mevcut worktree düzeni, checkpoint'ler, Trust Kernel, yetki mekanizmaları ve bağımsız Claude reviewer düzeni korunur. Tek bir sandbox engeli yüzünden UASCO geliştirmesi durdurulmaz; güvenlik sınırları aşılmadan izinli işler (A/B/C/D-hazırlık) sürer.

---

## 10) Founder'dan Beklenen Kararlar (her biri ayrı, tam metin)

Aşağıdaki kararların her biri bağımsızdır; onay olmadan ilgili iş ilerlemez ve hiçbir mevcut onay genişletilmez.

**KARAR-1 (PRIMARY yol — donanım):**
"Tam M1'in güvenilmeyen/AI-üretimi kod yürütmesi için izolasyon sınırı olarak AYRI BİR FİZİKSEL MAKİNEYİ (yedek PC veya ucuz mini-PC/NUC) kısıtlı remote worker olarak tahsis etmeyi onaylıyorum. Bu, ana PC'de hiçbir admin/BIOS/edition/firewall/policy değişikliği gerektirmez."
- [ ] Onaylıyorum  [ ] Reddediyorum

**KARAR-2 (izole ağ):**
"Worker için izole bir ağ segmenti (kendi VLAN/subnet veya küçük switch, gateway'siz) kurulmasını onaylıyorum. Bağımlılıklar host tarafında `npm ci --ignore-scripts` ile önceden hazırlanacak; worker'ın kendisi outbound erişim gerektirmez (D-SBX-9)."
- [ ] Onaylıyorum  [ ] Reddediyorum

**KARAR-3 (kısıtlı kanal):**
"Worker üzerinde tek, kimliği-doğrulanmış, varsayılan-kapalı bir SSH/WinRM kanalı ve UASCO runner agent kurulmasını onaylıyorum. Sonuçlar ana PC tarafında yeniden doğrulanacak."
- [ ] Onaylıyorum  [ ] Reddediyorum

**KARAR-4 (bağımsız güvenlik doğrulaması):**
"Harici bağımsız bir güvenlik uzmanının negatif/escape paketini doğrudan worker üzerinde çalıştırıp imzalamasını görevlendiriyorum. UASCO escape/negatif testi YAZMAZ. Paket 0 ESCAPED / 0 INCONCLUSIVE döndürene kadar INT-R3 kapısı fail-closed kalacak."
- [ ] Onaylıyorum  [ ] Reddediyorum  — Takvim/uzman: __________ (şu an UNKNOWN)

**KARAR-5 (FALLBACK — yalnız KARAR-1 reddedilirse):**
"Donanım yerine ana PC üzerinde Hyper-V yolunu tercih ediyorum ve şu ayrıcalıklı değişiklikleri ayrı ayrı onaylıyorum: (a) ücretli Win10 Home→Pro upgrade; (b) BIOS'ta VT-x etkinleştirme; (c) Hyper-V feature + reboot. Geri alma planını (feature kaldır, Home'a dön, VT-x kapat; ücretli upgrade tek yönlü) kabul ediyorum."
- [ ] Onaylıyorum (a) [ ] (b) [ ] (c)  [ ] Reddediyorum
- İkincil fallback (VirtualBox/VMware, edition upgrade'siz ama ring-0 sürücü + BIOS VT-x): [ ] Onaylıyorum  [ ] Reddediyorum

**KARAR-6 (durma onayı):**
"KARAR-1..5'in hiçbirini onaylamazsam, tam-M1 yürütmesinin süresiz BLOCKED kalacağını ve ETA'nın UNKNOWN olacağını; buna karşın A (M0 install), B (REL-FX), C (M1a) ve D-hazırlık işlerinin mevcut yetki içinde devam edeceğini anlıyorum."
- [ ] Anladım/Onaylıyorum

---

### Ekler ve kaynaklar
- Yerel: `C:/Users/salim/UASCO-recovery/product/sbx/SBX-03-supported-isolation-facts.md` (sha256 6F911046…), `SBX-00-host-capabilities.md`, `UASCO_M1_SANDBOX_ISOLATION_ASSESSMENT_2026-10-15.md`, `UASCO_M1_SANDBOX_APPROVAL_PACKET_2026-10-15.md`.
- Gate kodu: `core/workos/execution-gate.ts`, `runner.ts`, `devrun.ts` (worktree v2-int-r3; INT-R3 CLEAN @ 6aa7267).
- ETA verisi: `UASCO-recovery/product/eta2-measured-data.md`, `UASCO-wt/m1-spike/REHEARSAL-REPORT.md`.
- Harici: Microsoft Learn (Windows Sandbox; WSL networking/FAQ; Windows security servicing criteria; Azure hypervisor), Docker Desktop lisans, GitHub-hosted runners, PCWorld Win11 CPU listesi.

> Tekrar: Hiçbir izolasyon sınırı bu belgede DOĞRULANMIŞ değildir; doğrulama, bağımsız negatif paket geçene kadar yoktur. Hiçbir sınıflandırıcı-durduran adım yeniden denenmedi/yeniden ifade edilmedi/bölünmedi; karantinadaki sbx1a-partial launcher okunmadı/kullanılmadı/referans alınmadı.

---

## 11) Bağımsız eleştirmen notları

- Rol: tamamlanmışlık/aşırı-iddia eleştirmeni (bağımsız). Mod: SALT OKUNUR. Hiçbir launcher/escape/izolasyon-negatif testi yazılmadı, tasarlanmadı, çalıştırılmadı; hiçbir sınıflandırıcı-durduran adım denenmedi; karantinadaki `sbx1a-partial-20261015` okunmadı/referans alınmadı.
- Doğrulama tabanı: plan metni; `UASCO-recovery/product/sbx` kanıtı (SBX-00/SBX-03, external security package, SHA256SUMS); `eta2-measured-data.md`; `core/workos/execution-gate.ts` ve `audit/checkpoints/V7-PKG-INT-R3-2026-10-15.json` (worktree v2-int-r3, HEAD 6aa7267).
- Önce teyit edilen (boşluk YOK): (a) Windows Sandbox = Pro/Enterprise/Education özelliği, Home'da yok — DOĞRU; WSL2 ağ-izolasyonu (mirrored/Hyper-V firewall) Win11'e özgü — DOĞRU; i7-9700 (9. nesil Coffee Lake Refresh) Win11 CPU listesinde — DOĞRU; VirtualBox/VMware edition upgrade gerektirmez ama 64-bit guest için VT-x gerekir — DOĞRU. (c) Fail-closed garantisi ve "harici negatif paket 0 ESCAPED/0 INCONCLUSIVE dönmeden VERIFIED yok" kuralı §0/§4.1/§5/§8/§9-E boyunca tutarlı — korunuyor. (§4.1'de alıntılanan `SandboxProvider` arayüzü gerçek koda (6aa7267, satır 15-20) BİREBİR uyuyor.)

Aşağıdaki boşluklar somut; her biri için şiddet ve değişmesi gereken bölüm verilmiştir.

### N-1 (YÜKSEK, kanıtla çelişki — kriter g): INT-R3 "CLEAN" iddiası YANLIŞ
Plan §4 (satır 104), §9-C (satır 222) ve Ekler (satır 263) "INT-R3 CLEAN @ 6aa7267" diyor. Gerçekte commit 6aa7267 mesajı açıkça "(... ; not clean)" ve checkpoint kaydı `audit/checkpoints/V7-PKG-INT-R3-2026-10-15.json` durumu `IMPLEMENTED_NOT_REVIEWED (not clean)` ve "Bağımsız reviewer incelemesine kadar durum 'not clean'dir." olarak yazıyor. Bu, doğrulanmamış bir durumu DOĞRULANMIŞ gibi sunar — belgenin kendi fail-closed/overstatement disiplinini ihlal eder.
- Değişmeli: §4 girişi, §9-C, Ekler. "CLEAN" yerine "INT-R3 entegrasyon ADAYI, IMPLEMENTED_NOT_REVIEWED (not clean) @ 6aa7267; bağımsız review beklemede" yazılmalı.

### N-2 (ORTA-YÜKSEK, kriter b): `selfTest()` sözleşmesi negatif-test içeriğini ZORUNLU kılıyor; plan bunu UASCO'dan dışarı aldığını açıkça ayırmıyor
Gerçek arayüz dosyası (execution-gate.ts, satır 13) sağlayıcının "CPU/RAM/disk/süre/süreç sınırlarını uyguladığını `selfTest()` içinde negatif testlerle kanıtlamak zorundadır" diyor. Plan §4.2 deny-probe'un harici-sahipli olduğunu ve "UASCO YAZMAZ" dediğini belirtiyor; ancak arayüzün kendi sözleşmesi negatif-test içeriğini `selfTest()`'in İÇİNE koyuyor. Bir uygulayıcı, planı okuyup `selfTest()`'in izolasyon-kanıt mantığını UASCO'nun yazması gerektiği sonucuna varabilir — bu tam da üç kez sınıflandırıcı durduran iş türüdür. Plan, `selfTest()`'in negatif-kanıt üretiminin tümüyle harici-sahipli olduğunu, UASCO tarafının yalnızca harici imzalı/kimliği-doğrulanabilir sonucu OKUYUP geçirdiğini (yeniden implemente etmediğini) ve kanıt üretiminin UASCO'da olmadığını açıkça yazmalı.
- Değişmeli: §4.2 (`selfTest()` maddesi) ve §4.1 sözleşme notu.

### N-3 (YÜKSEK, kriter f): ETA kritik yolu ÖLÇÜLMEMİŞ bir girdiye dayanıyor; P50/P80/P95 aşırı iyimser
§8 P50=18 Eki / P80=21 Eki / P95=27 Eki dağılımını "ölçülü veriye dayalı" varsayımlarla (impl p50 14.2 dk, review 5.8 dk, validation 26-30 dk — eta2-measured-data) kuruyor. Fakat planın kendi kritik yolu (§3, §5, §7, §8) = donanım tedariki + harici güvenlik laboratuvarı SÖZLEŞMESİ + yürütme + imza. Bu girdiler ölçülmedi; §5 ve §7 takvimi açıkça UNKNOWN sayıyor ve external security package §6 bunu "dış ticari karar" diyor. Bir güvenlik laboratuvarını bulmak+sözleşmelemek tek başına günler-haftalar olabilir; P50=3 gün ve hatta P95=12 gün için nesnel dayanak yok. "Düşük-orta güven" ibaresi somut dağılım yayınlamayı meşrulaştırmıyor; ölçülen ajan hızı bu kritik yolu KISITLAMIYOR.
- Değişmeli: §0, §7, §8. Harici-doğrulama takvimi bağlanana kadar ETA, sahte kesinlikte bir P50/P80/P95 yerine "harici-uzman takvimine koşullu; baz-çizgi UNKNOWN; takvim girince yeniden hesaplanacak" olarak sunulmalı. Ölçülen hız yalnızca provider-wiring alt-kalemine atfedilmeli.

### N-4 (ORTA, kriter f): Hafta sonu + Founder/sınıflandırıcı gecikmesi ETA'ya işlenmemiş
2026-10-15 Perşembe; P50 2026-10-18 PAZAR'a düşüyor ve 17-18 Eki (Cmt/Paz) P50 penceresinin içinde. Plan dört AYRI Founder onayı istiyor (KARAR-1..4); ölçülen Founder gecikmesi 10 dk-1.5 s ve gece ~8 s duraklama, sınıflandırıcı reddi ise 30 saatte 6+ (her biri Founder eylemi) — bunların hiçbiri ETA varsayımlarına eklenmemiş. En az bir onay/ret turunun hafta sonuna denk gelmesi olası.
- Değişmeli: §8 varsayımlar. Hafta sonu, çok-onay serisi ve sınıflandırıcı-ret gecikmesi açıkça modellenmeli.

### N-5 (ORTA, kriter d/e): devrun reverse-tunnel / "tek firewall kuralı" ana-PC "firewall değişikliği YOK" ile çelişebilir
§4.2 spawn maddesi önizleme/devrun için "tek kontrollü port SSH reverse-tunnel/tek firewall kuralı ile geri açılır" diyor. §0 ve §6 (Seçenek 6) ise ana PC'de "firewall/policy değişikliği YOK" diye garanti veriyor. Portun/kuralın hangi makinede (ana PC mi, worker mı) olduğu belirsiz; ana PC tarafında bir dinleme portu veya firewall kuralı gerekiyorsa bu doğrudan çelişkidir ve güvenilmeyen worker'dan ana PC'ye bir giriş yüzeyi açar.
- Değişmeli: §4.2 ve §0/§6. Önizleme kanalının yönü kesinleştirilmeli (tercihen host→worker, worker→host DEĞİL); ana PC'de herhangi bir kural/port gerekirse bu açık bir Founder izin kalemi (KARAR) olarak listelenmeli; aksi halde M1 önizlemesi bu gerekçeyle de BLOCKED kalır.

### N-6 (ORTA, kriter d/e): Dual-homed ana PC yanal-hareket yüzeyi eksik/iyimser anlatılıyor
Fiziksel-worker yolunda ana PC, kanalı sürebilmek için hem ana ağda hem izole segmentte bulunan köprü makinedir ve staging'i worker'a O gönderir, sonucu O yeniden doğrular. Bu köprü, "ana PC'ye sıfır etki / en temiz geri alma" anlatısını zayıflatan ASIL yanal-hareket yoludur. §6 bunu yalnızca "ağ gerçekten segmente değilse yanal hareket" diye hafifçe geçiyor; §3 madde 2 ise ana PC'nin dokunulmadığını vurgularken köprü rolünü hiç anmıyor.
- Değişmeli: §6 (Seçenek 6 artık risk) ve §3 madde 2. Ana PC'nin iki-ağlı köprü rolü, kimlik/anahtar ayrımı ve bunun gizlilik/egress dengesine etkisi dürüstçe yazılmalı (kanıt ayrımını harici uzman §5-(a)/(d) zaten test ediyor; bu, anlatının değil riskin açıklığı sorunudur).

### N-7 (ORTA-YÜKSEK, kriter g): M0 "ŞU AN hazır / READY_FOR_FOUNDER_INSTALL" ölçülen kanıtla örtüşmüyor
§9-A M0'ı "ŞU AN hazır" ve "READY_FOR_FOUNDER_INSTALL" ilan ediyor. Ancak `eta2-measured-data.md`'ye göre M0 en hızlı yol: (1) PS-1B c3 CLEAN — HÂLÂ ÇALIŞIYOR; (2) installer'ı PS-1B ucundan YENİDEN DERLE; (3) temp kurulum testi + artefaktın bağımsız review'u; (4) Founder kurar. Üstelik mevcut `UASCO-Setup-0.7.0-dev.1` exe'de trustedSender hatası var (hash navigasyonundan sonra tüm IPC başarısız = ev-dışı her rota hata verir) ve runner/Claude executor/Project Studio/security stage/evidence/company OS/cockpit İÇERMİYOR. Founder önceliği A tam da M0 kurulumu olduğundan bu fazla-iddia yüksek etkili.
- Değişmeli: §9-A. "READY" yerine kalan M0 kritik işi (PS-1B c3 CLEAN, rebuild, temp-test, bağımsız review) ve mevcut exe'nin bilinen kusurları açıkça listelenmeli; exact installer path/SHA-256/kaynak commit/review sonucu "ayrı M0 belgesinde" erteleniyorsa bu belge "henüz üretilmedi (UNKNOWN)" diye işaretlenmeli ki A önceliği hazırmış gibi görünmesin.

### Kapanış
- Yapısal güvenlik duruşu (desteklenen izolasyonu tercih, özel launcher'ın masadan kalkması, fail-closed, harici negatif paket zorunluluğu, karantinaya dokunmama) SAĞLAM ve korunmalı. Yukarıdaki boşlukların hiçbiri sandbox güvenlik sınırını gevşetmeyi önermez.
- En kritik iki düzeltme N-1 (yanlış CLEAN iddiası) ve N-3 (sahte-kesin ETA). Bunlar düzeltilmeden belge, doğrulanmamış durumu doğrulanmış ve ölçülmemiş takvimi ölçülmüş gibi sunduğu için küresel CLEAN/READY olarak işaretlenmemeli.
