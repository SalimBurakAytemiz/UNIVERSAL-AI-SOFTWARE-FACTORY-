# UASCO — UNATTENDED EXECUTION READINESS (7/24 Otonom Çalışma Gerçeklik Kapısı)

**Tarih:** 2026-10-16 · **Kaynak talimat:** FD-NIHAI-252-2026-10-16 §6/§10 + paket `10_KAPSAM_KAPATMA/UASCO_7_24_OTONOM_CALISMA_GERCEKLIK_KONTROLU.md`
**Statü kuralı:** Bir madde kanıtla doğrulanmadan `UNATTENDED_READY` yazılmaz. Bu belge salt gözlemdir; hiçbir altyapı satın alınmadı/kurulmadı, hiçbir secret taşınmadı.

## 0. NET CEVAP (dürüst)

**UNATTENDED_READY = HAYIR.** Şu an **7/24 kesintisiz, bilgisayardan bağımsız** otonom yürütme **YOK**.

Mevcut gerçek model: **"Gözetimli yerel yürütme" (attended local execution).** UASCO geliştirme döngüsü (KOD → TEST → BAĞIMSIZ REVIEW → CLEAN → CHECKPOINT → SIRADAKİ) **bu Claude oturumu açık ve bilgisayar açıkken** otomatik, siz "devam" demeden akar. **Bilgisayar kapanır/uyur veya bu oturum kapanırsa yerel işlemler DURUR.** Kaldığı yerden otomatik devam eden, önceden yetkilendirilmiş, sürekli açık bir **uzak runner yoktur.**

Bu, güvenlik kilidini kaldırmak için bir gerekçe değildir; gerçek durumun dürüst raporudur.

## 1. Kanıtlı kontrol listesi (bu makinede, 2026-10-16)

| # | Kontrol | Durum | Kanıt |
|---|---|---|---|
| 1 | Kanonik repo konumu + HEAD + clean/dirty | **DOĞRULANDI** | `C:\Users\salim\Desktop\UASCO`, dal `v6/pkg-t4-powershell-safety-and-verifier-differential`, HEAD `217d429`. Worktree **dirty** (untracked: `audit/reviews/*`, `.claude/`, `docs/planning/`). Aktif ürün teslim hattı ayrı klonlarda (`C:\Users\salim\UASCO-wt\v2-*`), M1A-MODE CLEAN `2176741` tabanlı; master'a henüz merge edilmedi. |
| 2 | Yürütme ortamı: yerel PC mi, uzak runner mı? | **YEREL PC** | Claude Code bu Windows masaüstü uygulamasında (salim kullanıcısı, Win10 Home) çalışıyor. `tasklist`: yalnız bu oturumun `claude.exe`/`node.exe` süreçleri; kalıcı bağımsız runner süreci yok. |
| 3 | Uzak runner sözleşmesi/abonelik/süreklilik/bütçe/kota | **YOK** | Yetkilendirilmiş, sürekli açık bir VPS/VDS/bulut runner **bulunmuyor**. Böyle bir hesap/abonelik/bütçe tanımlı değil. (Satın alma/kurma Founder onayına bağlı — yapılmadı.) |
| 4 | Yerel zamanlanmış görev (watchdog) kurulu mu? | **HAYIR (bu makinede)** | `schtasks /query` içinde UASCO/construction/supervisor/watchdog görevi **yok**. Kod tabanında BS1/LV1 otonomi bootstrap + watchdog paketleri MEVCUT ama bu (salim) makineye kurulu/çalışır değil (bkz. PRO→salim kurtarma, memory `uasco-windows-recovery-20261012`). **Kurulsa bile Task Scheduler yalnız PC açıkken çalışır — kapalıyken yine durur.** |
| 5 | Implementer Claude ≠ salt-okunur bağımsız reviewer; exact SHA salt okunur | **DOĞRULANDI** | Her paket ayrı klon + ayrı ajan: implementer commit üretir, bağımsız reviewer kendi detached klonunda exact SHA'yı inceler. Son kanıt: CORE pre-dev `e7aa64d` CLEAN (reviewer klonu `rv-predev`, ağ yok). |
| 6 | İş kuyruğu + checkpoint recovery "devam"sız otomatik işliyor mu? | **KISMEN (oturuma bağlı)** | Oturum-içi workflow pipeline'ı CLEAN→sıradaki işi otomatik başlatıyor (kanıt: bu oturumda CORE pre-dev→CORE-2 ve WP4 c2→c3 otomatik zincirlendi). ANCAK bu **bu oturum canlıyken** geçerli; oturum/PC kapanınca kuyruk ilerlemez. Kalıcı dış kuyruk + otomatik resume **yok**. |
| 7 | Secrets şifreli/scoped, logda düz metin değil, egress kapı kontrollü | **KISMEN (kod seviyesinde var)** | Kodda fail-closed execution-gate, builder tool-policy sandbox (denyHostShell), reviewer salt-okunur izolasyon, secret-sanity taraması mevcut. Unattended işletim için ayrı bir secret-broker/sealed-credential servisi **çalışır durumda değil** (runner olmadığı için gerekmedi). |
| 8 | Push/prod/harcama/protected-path/sistem/gerçek kullanıcı verisi korunuyor; fail-closed izin testi | **DOĞRULANDI (korumalar aktif)** | Push devre dışı (`PUSH_DISABLED`), protected-paths + trust-root manifest zorlanıyor, FA-V2-PRODUCT dışı korumalı değişiklik reddediliyor, kurulu `%APPDATA%\UASCO`'ya dokunulmuyor. Bu korumalar unattended'da da kaldırılmayacak. |
| 9 | Sağlayıcı limiti/oturum kesintisi için bounded retry/backoff/recovery + alert; sınırsız 7/24 sözü yok | **KISMEN** | Kodda kota/limit sınıflandırma + bounded retry paketleri (Q1/Q2/AUT2) var. Fakat bunları çalıştıran kesintisiz runner olmadığından **7/24 süreklilik garanti edilmiyor** ve edilmeyecek. |
| 10 | Son günlük rapor doğru HEAD + gerçek test/screenshot/review + açık blokaj + sıradaki READY | **VAR** | Günlük yönetici özeti + `CHECKPOINT-2026-10-14-authz.md` olay günlüğü + bu belge. |

## 2. "7/24 masaüstümü açmadan yönetmek" için NE gerekir (seçenekler + izin ihtiyacı)

Amacınız ("yalnız UASCO Desktop'ı açıp işleri yönetmek; günlük terminal/Git istemiyorum") iki ayrı katmana ayrılır:

**A. Uygulama kullanımı (zaten hedefte, terminal gerektirmez):** UASCO Desktop'tan proje açma, komut verme, onay, kanıt görüntüleme — bu, kurulu `.exe` + ilerleyen UX paketleriyle sağlanıyor; sizden terminal/Git istemiyor. Bu katman **yerelde, PC açıkken** çalışır.

**B. Siz yokken / PC kapalıyken sürekli geliştirme (gerçek 7/24):** Bu **yalnızca** sürekli açık, yetkilendirilmiş bir uzak yürütme ortamıyla mümkün. Seçenekler ve her birinin **sizden gerektirdiği onay**:

| Seçenek | Ne sağlar | Gerektirdiği Founder onayı (verilmedi) | Güvenlik notu |
|---|---|---|---|
| 1. Yerel Task Scheduler watchdog (BS1/LV1) kur | PC **açıkken** oturum düşse bile otomatik yeniden başlatma/resume | Sadece yerel görev kurulumu (host ayarı) — düşük; harcama yok | PC kapalıyken yine durur; gerçek 7/24 DEĞİL |
| 2. Sizin kontrolünüzdeki sürekli açık bir makine (ör. ikinci PC / mini-PC) | PC'niz kapalıyken de yerel-izole yürütme | Cihaz + kurulum onayı; harcama sizde | FD-REL-1 izolasyon kararınızla uyumlu kurulmalı |
| 3. Yetkilendirilmiş bulut runner (VPS/VDS veya resmi Claude bulut yürütme) | Gerçek 7/24, cihazdan bağımsız | **Ücretli hizmet + hesap + secret taşıma + veri işleme onayı** — hepsi size bağlı, verilmedi | Bağımsız güvenlik doğrulaması + tenant izolasyonu şart |

**Not:** Seçenek 3 ayrıca **FD-REL-1 güvenli-yürütme-izolasyonu** kararınızla ve (dağıtım yapılacaksa) **sunucu erişim yetkinizle** kesişir. Bunlar hâlâ açık Founder kapılarıdır; ben izinsiz VPS satın almam, secret taşımam, yeni ücretli hesap açmam.

## 3. Şimdi ne yapıyorum (izin beklemeden, güvenli)

- Gözetimli yerel modda **sürekli otonom akış** devam ediyor: paketler CLEAN oldukça checkpoint + sıradaki işi otomatik başlatıyorum; sizden rutin "devam" beklemiyorum.
- Her commit/test/review/checkpoint loglanıyor; günlük kısa yönetici özeti veriyorum.
- 7/24 için **hiçbir şeyi "kurulu ve çalışıyor" diye göstermiyorum.**

## 4. Sizden karar (yalnızca siz isterseniz; hiçbiri teslimi bloke etmez)

7/24'ü gerçekten istiyorsanız yukarıdaki **Seçenek 1 / 2 / 3**'ten birini açıkça onaylayın. Onaylamazsanız, gözetimli yerel modda tam hızda ilerlemeye devam ederim; yalnız PC kapalıyken duraklar, açılınca checkpoint'ten sürdürürüm. Bu belge, gerçek bir runner kurulup kanıtlanana kadar `UNATTENDED_READY` yazılmayacağının taahhüdüdür.
