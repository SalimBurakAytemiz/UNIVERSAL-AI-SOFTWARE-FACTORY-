<!-- //TR: Founder'ın Windows kabul akışı için tek sayfa adım listesi (Türkçe + English); yeni yetki yok, yalnız doküman; komutlar Founder'ın kendi makinesinde çalıştırılır -->
# Windows kabul: tek sayfa adım listesi / Windows acceptance: one-page steps

> UNVERIFIED_WSL: bu adımlar henüz gerçek bir Windows makinesinde koşulmadı; ilk koşu sizinki. / These steps have not yet been run on a real Windows host; the first run is yours. Hiçbir komut kişisel Claude hesabınızı kopyalamaz. / Nothing here copies your personal Claude account.

## Türkçe

1. **WSL2 + dağıtım** (yönetici PowerShell): `wsl --install -d Ubuntu`, yeniden başlatın, Linux kullanıcısı oluşturun (**root DEĞİL**: sandbox süreç sınırı root'ta uygulanamaz ve kabul reddedilir). Kontrol: `wsl -d Ubuntu -- id -u` sıfırdan farklı olmalı; `wsl -l -v` VERSION sütunu `2`.
2. **Dağıtım paketleri:** `wsl -d Ubuntu -u root -- sh -c "apt-get update && apt-get install -y nodejs util-linux coreutils procps findutils bash tar perl"` (`perl` AF_VSOCK engelini kurar; Linux `node` `/usr` altında olmalı).
3. **`/etc/wsl.conf`** (interop ve Windows PATH kapalı): `wsl -d Ubuntu -u root -- nano /etc/wsl.conf` ve şunu yazın:
   ```
   [interop]
   enabled=false
   appendWindowsPath=false
   ```
   Sonra `wsl --shutdown` ve dağıtımı yeniden başlatın.
4. **Ortam değişkeni:** `setx UASCO_WSL_DISTRO Ubuntu`, yeni bir PowerShell açın.
5. **Yerel Claude CLI** (`.cmd` kısayolu DEĞİL): PowerShell'de `irm https://claude.ai/install.ps1 | iex` (Anthropic'in güncel yönergesini kontrol edin); `claude.exe` yolda olmalı.
6. **İki profil girişi** (implementer ve reviewer ayrı): uygulamanın/kit'in gösterdiği komutu yeni bir PowerShell'de çalıştırın: `$env:CLAUDE_CONFIG_DIR='<profil klasörü>'; claude`, içeride `/login`, giriş yapın, `/exit`. İki profil için ayrı ayrı.
7. **Kit:** depo klasöründe (Node 24+, `npm ci` yapılmış): `node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu` (kurulu uygulama için ek olarak `--control-root "<uygulama veri klasörü>"`).
8. **Sonuç:** tablodaki her satır PASS / FAIL / SKIP. Hepsi PASS ve SHA biliniyorsa `ACCEPTED`. FAIL satırının altında yapmanız gereken tam komut yazar. SKIP asla PASS değildir. `artifacts/runtime/acceptance/*.json` dosyasını koordinatöre gönderin.

| Satır | FAIL ise |
|---|---|
| WSL_DISTRO / WSL_VERSION_2 | adım 1 |
| WSL_CONF / WSL_INTEROP_RUNTIME | adım 3 (+ `wsl --shutdown`) |
| WSL_NODE | adım 2 |
| CLAUDE_CLI | adım 5 |
| CLAUDE_PROFILE_* | adım 6 |
| WSL_SELFTEST_AND_RUN | `selfTest` bir `PROBE_*` / `INTEROP_*` kodu verir; kodu koordinatöre gönderin (ör. `PROBE_PROCESS_LIMIT_NOT_ENFORCED` = root kullanıcı, `PROBE_VSOCK` = seccomp sarmalayıcısı çalışmadı) |
| WSL_PRODUCT_BRIDGE | ürün başlamadı / köprü 200 vermedi; JSON dosyasını gönderin |
| IDEA_TO_RUNNING_PRODUCT | **FİKİR → ÇALIŞAN ÜRÜN** zinciri (intake → plan → sahte koşu → testler WSL sandbox'ında → teslim → ürünü başlat → `127.0.0.1` HTTP 200 → durdur). `PASS` = zincir sonuna kadar koştu ve port kapandı. `BLOCKED:<kod>` = zincir bir önkoşulda durdu (ör. `SANDBOX_UNAVAILABLE:SELF_TEST_FAILED`, `DEVRUN_SANDBOX_UNAVAILABLE:...`); kodu okuyup ilgili adımı düzeltin, BLOCKED asla PASS değildir. `FAIL` = bir adım yanlış sonuç verdi; JSON'u gönderin |

## English

1. **WSL2 + distro** (admin PowerShell): `wsl --install -d Ubuntu`, reboot, create a Linux user (**not root**: the sandbox's process limit cannot be enforced for root and the provider is refused). Check: `wsl -d Ubuntu -- id -u` must be non-zero; `wsl -l -v` shows VERSION `2`.
2. **Distro packages:** `wsl -d Ubuntu -u root -- sh -c "apt-get update && apt-get install -y nodejs util-linux coreutils procps findutils bash tar perl"` (`perl` installs the AF_VSOCK block; Linux `node` must live under `/usr`).
3. **`/etc/wsl.conf`** (interop and Windows PATH off): `wsl -d Ubuntu -u root -- nano /etc/wsl.conf` and write:
   ```
   [interop]
   enabled=false
   appendWindowsPath=false
   ```
   then `wsl --shutdown` and start the distro again.
4. **Environment variable:** `setx UASCO_WSL_DISTRO Ubuntu`, open a new PowerShell.
5. **Native Claude CLI** (NOT a `.cmd` shim): in PowerShell `irm https://claude.ai/install.ps1 | iex` (check Anthropic's current instructions); `claude.exe` must be on the path.
6. **Two profile logins** (implementer and reviewer are separate): run the command the app/kit shows in a new PowerShell: `$env:CLAUDE_CONFIG_DIR='<profile folder>'; claude`, type `/login` inside, sign in, `/exit`. Once per profile.
7. **The kit:** in the repo folder (Node 24+, `npm ci` done): `node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu` (for an installed app also `--control-root "<the app's data folder>"`).
8. **Result:** every row is PASS / FAIL / SKIP. All PASS with a known SHA gives `ACCEPTED`. Under each FAIL the exact command to run is printed. A SKIP is never a PASS. Send `artifacts/runtime/acceptance/*.json` to the coordinator.

| Row | If FAIL |
|---|---|
| WSL_DISTRO / WSL_VERSION_2 | step 1 |
| WSL_CONF / WSL_INTEROP_RUNTIME | step 3 (+ `wsl --shutdown`) |
| WSL_NODE | step 2 |
| CLAUDE_CLI | step 5 |
| CLAUDE_PROFILE_* | step 6 |
| WSL_SELFTEST_AND_RUN | `selfTest` reports a `PROBE_*` / `INTEROP_*` code; send the code to the coordinator (for example `PROBE_PROCESS_LIMIT_NOT_ENFORCED` = root user, `PROBE_VSOCK` = the seccomp wrapper did not work) |
| WSL_PRODUCT_BRIDGE | the product did not start / the bridge did not answer 200; send the JSON file |
| IDEA_TO_RUNNING_PRODUCT | the **IDEA → RUNNING PRODUCT** chain (intake → plan → fake run → tests in the WSL sandbox → delivery → product start → `127.0.0.1` HTTP 200 → stop). `PASS` = the chain ran to the end and the port closed. `BLOCKED:<code>` = the chain stopped at a precondition (for example `SANDBOX_UNAVAILABLE:SELF_TEST_FAILED`, `DEVRUN_SANDBOX_UNAVAILABLE:...`); read the code and fix that step; BLOCKED is never a PASS. `FAIL` = a step returned a wrong result; send the JSON |
