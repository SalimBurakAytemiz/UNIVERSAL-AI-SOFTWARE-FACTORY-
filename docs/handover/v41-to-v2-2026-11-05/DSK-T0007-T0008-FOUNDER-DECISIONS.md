# DSK-T0007 / DSK-T0008 Founder karar önerileri (yalnız tasarım; kod/PR yok)

Taban: main `c1e91a26` (MAIN_PASS). Yazanlar: DSK-T0007 → builder P3 (session_015dYwb4pNEhbHTmdH9fjbgQ), DSK-T0008 → V2 (session_015dYwb57qx21P4wudU5xauD). Koordinatör: V4.1. Windows platform bilgileri [U] işaretliyse doğrulanmamış genel bilgidir; karar öncesi resmi dokümanla doğrulanmalıdır.

## DSK-T0007: Windows'ta güvenli test çalıştırma
**Bugün (repo kanıtı):**
- `stepVerify` (`core/workos/runner.ts:938`) testleri yalnız `ExecutionGate`'ten (`execution-gate.ts:31-51`) geçen ve `selfTest` sonucu tam olarak `{ok:true}` olan bir sağlayıcıyla çalıştırır.
- `defaultSandboxProvider` yalnız Linux'ta kayıtlıdır (`server.ts:300`); kurulu uygulamada sandbox seçeneği yoktur (`packaged-entry.ts:52-54`).
- Sonuç olarak Windows'ta testler `VERIFY_TESTS_NOT_EXECUTED` olur ve PRODUCT_VERIFIED mümkün değildir (`runner.ts:796-806`).
- WSL2 sağlayıcısı yalnız PR #231'de vardır (`wsl-unshare-sandbox.ts`). Proje içeriği bu VM'e kopyalanarak çalıştırılır; `/mnt/c` hiç bağlanmaz; `selfTest` kesin hata kodlarıyla reddeder. Ana dalda yoktur.
- Bulut sandbox ayrı bir izolasyon mekanizması değildir; uzaktaki Linux host üzerinde aynı Linux unshare izolasyonudur.

**Seçenekler:**
- A. Ayrı yerel kullanıcı: yetersiz.
- B. AppContainer + Job Object: en güçlü yerel seçenek, ama yeni bir native ikili ve yeni saldırı yüzeyi getirir.
- C. Windows Sandbox: Home sürümünde yok [U], otomasyonu zayıf.
- **D. WSL2: önerilen.** Ücretsiz, Home sürümünde de var [U], denetlenmiş Linux izolasyonunu yeniden kullanır.
- E. Docker Desktop: büyük şirketlerde lisans maliyeti var [U].
- F. Bulut: D-08 = 0 USD kuralı altında kapalı.

**Plan:**
- **T2:** #231 sağlayıcı dosyaları ile testler, ve selfTest nedeninin arayüzde gösterilmesi.
- **Korumalı:** `linux-unshare-sandbox.ts` dışa aktarımları; win32 için kayıt `server.ts:300` ve `packaged-entry.ts:54`'te.
- **CI:** Windows CI yalnız fail-closed davranışı kanıtlar. Pozitif izolasyon kanıtı, Founder PC'sinde bir kez yapılacak manuel kabul testidir (RW-004).

**Sorular:**
- Q1: Windows izolasyon sınırı WSL2 (#231 tasarımı) olsun mu?
- Q2: `server.ts` ve `packaged-entry.ts` değişikliği yapılsın mı?
- Q3: Kullanıcıdan WSL2 + distro kurulumu ve interop'un kapalı olması zorunlu tutulsun mu?
- Q4: CI yalnız fail-closed davranışı kanıtlasın, pozitif izolasyon kanıtı manuel kabul testiyle mi alınsın?
- Q5: Ücretli self-hosted Windows runner kullanılsın mı? (öneri: HAYIR)
- Q6: Docker hariç tutulsun mu? (öneri: EVET)
- Q7: Bulut sandbox kapalı kalsın mı? (öneri: EVET)
- Q8: v1'de Windows dev-run kapalı kalsın mı? (öneri: EVET)

## DSK-T0008: Masaüstünden gerçek kod üretimi
**Bugün (repo kanıtı):**
- Yalnız `LOCAL_CLAUDE` yürütücüsü var (`executors.ts:281`); başka sağlayıcı adaptörü yok.
- Etkinleştirme akışı: Ayarlar ekranındaki onay diyaloğu → `POST /v1/system/executors/local-claude/enable` (`server.ts:482`) → `executor-setup.ts:87`. CLI bulunmalı; `.cmd` shim reddedilir; provenance PASS olmalı.
- Runner kurulu uygulamada AÇIK (`packaged-entry.ts:59`), dev ortamında bayrağa bağlı (`server.ts:310`).
- İki ayrı Claude profili var: builder ve reviewer. UASCO bu profillere hiçbir zaman kendisi giriş yapmaz.
- Kod üretimi sandbox kapısından geçmez; testler Windows'ta çalıştırılmaz.

**Maliyet ve D-08:**
- **Kanıtlanabilen:** Alt sürece `ANTHROPIC_API_KEY` geçmiyor (`allowPaidApi=false`); profilde `apiKeyHelper` yok.
- **Kanıtlanamayan:** Kullanıcının hangi hesap türüyle giriş yaptığı (abonelik mi, ücretli Console/API mi), aboneliğin aşım ücreti ve Anthropic tarafındaki faturalama. Dolayısıyla "harcama yok" kodla garanti edilemez; yalnız "UASCO API anahtarı vermez" garanti edilir.
- **Önerilen güvenli varsayılan:** `allowPaidApi=false`; profilde yalnız abonelik girişi (`forceLoginMethod claudeai`, Claude Code dokümanıyla doğrulanacak); her koşuda onay; yalnız ölçülmüş veriyi gösteren kullanım paneli (bilinmeyen değer UNKNOWN); günlük koşu limiti.

**Plan:**
- **T2:** hazırlık sihirbazı, koşu onay diyaloğu, kullanım paneli, limit ayarı.
- **Korumalı/T3:** `claude-profiles.ts`; `server.ts` (onay token'ı ve limitin sunucuda uygulanması, kullanım için GET); `main.mjs` izin listesi; runner varsayılanı.
- **Kanıt:** CI'da yalnız FakeExecutors ve sahte CLI. Gerçek üretim kanıtı, kurulu Windows sürümünde Founder'ın çalıştıracağı manuel kontrol listesidir.

**Sorular:**
- Q1: v1'de yalnız LOCAL_CLAUDE ve kullanıcının kendi aboneliği mi?
- Q2: Yalnız abonelik girişi kabul edilsin mi (`forceLoginMethod claudeai`)?
- Q3: `allowPaidApi=false` korunsun mu?
- Q4: Her koşuda onay istensin mi?
- Q5: Günlük koşu limiti olsun mu, değeri ne olsun?
- Q6: Kurulu uygulamada runner varsayılan olarak AÇIK mı kalsın, yoksa kullanıcı açınca mı çalışsın?
- Q7: Sandbox yokken her teslimatın Founder kararına bağlı olması kabul mü?
- Q8: Release kanıtı manuel Founder kabul testi olsun mu?
