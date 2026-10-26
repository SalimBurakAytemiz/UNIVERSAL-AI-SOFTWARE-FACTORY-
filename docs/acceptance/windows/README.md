<!-- //TR: Founder'ın Windows kabul kiti kullanım kılavuzu (Türkçe + English); betik ana makine ayarını değiştirmez, yalnız okur ve deponun kendi testlerini çalıştırır -->
# Windows kabul kiti / Windows acceptance kit

## Türkçe

**Amaç:** 31 Ekim kanıtı gerçek Windows makinenizde alınır. Bu kit, bunu tek komuta indirir ve dürüst bir rapor verir.

**Çalıştırma** (depo klasöründe veya kurulu uygulamanın klasöründe, PowerShell):

```powershell
node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu
```

- `--distro`: WSL2 dağıtım adı (veya `UASCO_WSL_DISTRO` ortam değişkeni).
- `--control-root`: uygulamanın veri klasörü (Claude profilleri orada aranır; git deposu içinde olamaz). Kurulu uygulama için bu klasörü verin.
- `--sha <40 hex>`: yalnız git olmayan kurulu klasörde, derlemenin SHA'sı. Verilmezse kanıt SHA'ya bağlı olmaz ve sonuç KABUL EDİLMEZ olur.
- `--with-claude`: isteğe bağlı gerçek-kod halkası (tek mission koşusu, kendi Claude profilleriniz; varsayılan kapalı).
- `--out`: kanıt klasörü (varsayılan `artifacts/runtime/acceptance/`).
- Önkoşul: Node 24+ ve `npm ci` yapılmış depo (kit hiçbir şey kurmaz).

**Ne yapar:**
1. **Salt-okunur ön kontrol:** WSL dağıtımı var mı ve sürüm 2 mi; `/etc/wsl.conf` içinde `[interop] enabled=false` ve `appendWindowsPath=false` var mı; çalışma anında interop kapalı mı; dağıtımda Linux `node` var mı; Claude CLI yerel kurulum mu (`.cmd` kısayolu değil); implementer ve reviewer Claude profilleri giriş yapmış mı.
2. **Deponun kendi gerçek-WSL testleri** (`UASCO_WSL_DISTRO` ile): sağlayıcı selfTest'i (tüm negatif sondalar) + sandbox içinde node testi; üretilen web-node ürününün `spawnAsync` + köprü ile başlaması, `127.0.0.1` portundan 200 dönmesi ve durdurmada Linux tarafının temizlenmesi. Depo testleri dışında hiçbir şey çalıştırılmaz.
3. **Tek tablo:** her kontrol PASS / FAIL / BLOCKED:<kod> / SKIP(neden). Gerçek-WSL satırlarından biri **FİKİR → ÇALIŞAN ÜRÜN** zinciridir. **SKIP ve BLOCKED asla PASS sayılmaz.** Tüm kontroller PASS ve SHA biliniyorsa sonuç `ACCEPTED`, aksi halde `NOT_ACCEPTED` (çıkış kodu 1). SHA'ya bağlı JSON kanıt dosyası yazılır (`evidenceSha256` ile).
4. **Hata olursa** her başarısız önkoşul için sizin çalıştıracağınız tam komut yazılır. Kit hiçbir ayarı kendisi değiştirmez.

**Sonra:** kanıt JSON dosyasını koordinatöre gönderin. Bu kit "ürün doğrulandı" demez; yalnız bu makinede bu SHA için kontrollerin sonucunu kaydeder.

## English

**Purpose:** the 31 Oct proof is taken on your real Windows host. This kit makes it one command with an honest report.

**Run** (from the repo folder or the installed app's folder, PowerShell):

```powershell
node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu
```

- `--distro`: the WSL2 distro name (or the `UASCO_WSL_DISTRO` environment variable).
- `--control-root`: the app's data folder (Claude profiles are looked up there; it must not be inside a git checkout). Pass it for an installed app.
- `--sha <40 hex>`: only for an installed folder without git, the build SHA. Without it the evidence is not SHA-bound and the result is NOT_ACCEPTED.
- `--with-claude`: optional real-code ring (ONE mission run with your own Claude profiles; off by default).
- `--out`: evidence folder (default `artifacts/runtime/acceptance/`).
- Requirements: Node 24+ and a checkout with `npm ci` done (the kit installs nothing).

**What it does:**
1. **Read-only preflight:** the WSL distro exists and is version 2; `/etc/wsl.conf` has `[interop] enabled=false` and `appendWindowsPath=false`; interop is off at runtime; Linux `node` exists in the distro; the Claude CLI is a native install (not a `.cmd` shim); the implementer and reviewer Claude profiles are logged in.
2. **The repo's own real-WSL tests** (with `UASCO_WSL_DISTRO`): the provider selfTest (all negative probes) plus a node test inside the sandbox; the generated web-node product started with `spawnAsync` + the bridge, answering 200 on `127.0.0.1`, and the Linux side torn down on stop. Nothing outside the repo's tests is executed.
3. **One table:** each check is PASS / FAIL / BLOCKED:<code> / SKIP(reason). One of the real-WSL rows is the **IDEA → RUNNING PRODUCT** chain. **SKIP and BLOCKED are never a PASS.** The result is `ACCEPTED` only if every check passes and the SHA is known; otherwise `NOT_ACCEPTED` (exit code 1). A SHA-bound JSON evidence file is written (with `evidenceSha256`).
4. **On failure** the exact command you must run is printed for every failed precondition. The kit never changes any setting itself.

**Next:** send the evidence JSON to the coordinator. The kit does not claim "product verified"; it only records the check results on this host for this SHA.

### Notes
- The Claude CLI and profile checks reuse Lane C's `detectClaudeCli` / `claudeProfileStatus` from `core/workos/claude-profiles.ts`; if the checkout does not export them yet the check is SKIP, not PASS.
- UNVERIFIED_WSL: the kit itself has only been exercised with injected fakes on Linux; the first real run is yours.
