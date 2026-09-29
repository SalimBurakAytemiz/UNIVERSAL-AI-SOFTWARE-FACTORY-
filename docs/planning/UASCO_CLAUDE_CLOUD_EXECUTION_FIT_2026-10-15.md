# UASCO — Claude Resmi Bulut Yürütme Ortamı Uygunluk Raporu

- Founder kararı: **FD-CLOUD-EXECUTION-RESEARCH-2026-10-15**
- Mod: **SALT-OKUNUR araştırma** (yalnızca resmi Anthropic/Claude dokümantasyonu). Bulut oturumu açılmadı, görev gönderilmedi, hesap-kimlikli hiçbir işlem yapılmadı, ücretli kaynak harcanmadı.
- Doğrulama tarihi: **2026-10-15** (tüm teknik iddialar bu tarihe bağlıdır)
- Kanıt dosyası: `cloud-research-evidence.json` (ham, atıflı iddialar)
- Uyarı: Model bilgisi eski olabilir; aşağıdaki iddialar **yalnızca atıfı verilen resmi dokümana** dayanır. Resmi dokümanda doğrulanamayan her şey **UNVERIFIED** veya **NOT_FOUND** olarak işaretlenmiştir ve varsayılmamıştır.
- Tarayıcı otomasyonu, özel/belgelenmemiş uç noktalar ve kısıtlama atlatma yolları **desteklenen yol olarak sunulmamıştır** ve sunulmayacaktır.

## Üç kategorinin ayrımı (asla karıştırılmaz)

Rapor boyunca şu üç şey kesin ayrı tutulur:

- **(i) Claude Code LOCAL** — kullanıcı makinesinde yerel komut yürütme / yerel sandbox.
- **(ii) Anthropic CLOUD-hosted Claude Code oturumları** — "Claude Code on the web" / "cloud sessions" (claude.ai/code), yönetilen bulut oturumları.
- **(iii) Anthropic API tarafında barındırılan sandbox** — code-execution / bash tool + Claude Agent SDK + "Managed Agents" sunucu-barındırmalı sandbox.

Her kategori için "UASCO (üçüncü taraf uygulama) bunu programatik olarak resmi şartlar altında sürebilir mi?" ayrı yanıtlanmıştır.

---

## A) Claude resmi bulut sandbox ne sunuyor (tam olarak)

### (ii) Claude Code cloud sessions
- Resmi ürün: "Claude Code on the web", artık "cloud sessions" adıyla; tarayıcıda claude.ai/code. Oturum kullanıcı makinesi yerine bulut altyapısında koşar ve dizüstü kapandıktan sonra da çalışmaya devam eder. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/claude-code-on-the-web (2026-10-15)
- Her oturum, kullanıcının makinesinden ve diğer oturumlardan ayrı, **Anthropic tarafından yönetilen izole bir sanal makinede (VM)** çalışır. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/claude-code-on-the-web#security-and-isolation (2026-10-15)
  - Dokümanlar hipervizör/çekirdek teknolojisini **isimlendirmiyor** → izolasyon gücü resmi metinle **UNKNOWN**.
- VM boyutu: **4 vCPU, 16 GB RAM, 30 GB disk**. VM'e shell erişimi yok; her komutu Claude çalıştırır. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/cloud-environments (2026-10-15)
- Ağ erişimi varsayılan sınırlı; seviyeler: Trusted (varsayılan allowlist), Full, None, Custom. None'da bile Claude Code Anthropic API'ye ulaşabilir (veri API çağrılarıyla VM'den çıkabilir). [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/cloud-environments (2026-10-15)
- GitHub kimlik bilgileri Anthropic sunucularında şifreli kalır, VM'e **girmez**; git/GitHub işlemleri sunucu-tarafı proxy üzerinden gider. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/claude-code-on-the-web#github-authentication-options (2026-10-15)
- GA: launch yazısındaki güncelleme notuna göre cloud sessions **23 Eylül 2026**'da Pro/Max/Team ve bazı Enterprise için GA oldu. (Blog gövdesi Ekim 2025 tarihli ve "research preview" diyor → çelişki; doküman sayfasında GA tarihi yok.) [OFFICIALLY_SUPPORTED, çelişkili] — https://claude.com/blog/claude-code-on-the-web (2026-10-15)

### (iii) Managed Agents (API-hosted sandbox)
- Anthropic, yönetilen bir bulut sandbox içinde ajan harness'ını kendisi koşar; ajan bash, dosya işlemleri, web search/fetch, MCP araçları çalıştırabilir. **Beta** ama tüm API hesaplarında varsayılan açık. [REQUIRES_API_ACCESS] — https://platform.claude.com/docs/en/managed-agents/overview (2026-10-15)
- İzolasyon: her oturum kendi izole, "fresh Linux container"ı. Dokümanlar **container** diyor, VM/hipervizör sınırı tarif etmiyor → izolasyon gücü resmi metinle **UNKNOWN**. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/environments (2026-10-15)
- Sandbox özellikleri: Ubuntu 24.04 LTS x86_64, ≤8 GB RAM, ≤10 GB disk; Python 3.10-3.13, Node 20-22, Go, Rust, Java 21, Ruby, PHP 8.3, git, Playwright+Chromium, Postgres/Redis binary'leri (sunucular varsayılan kapalı). Oturum idle olunca dosya sistemi checkpoint'lenir. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference (2026-10-15)
- Ağ: API ile oluşturulan ortamda alan atlanırsa varsayılan **unrestricted**. Güvenli kullanım için `limited` + açık `allowed_hosts` önerilir; `limited` + boş liste hiçbir şeye izin vermez. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/environments (2026-10-15)
- **ZDR / HIPAA BAA kapsamı yok.** Oturum geçmişi, sandbox durumu ve çıktılar sunucu tarafında saklanır (API ile silinebilir). [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/overview (2026-10-15)

### (iii) code-execution tool + Bash tool
- code-execution tool **GA** (Claude API + AWS; Foundry yalnız Hosted-on-Anthropic ile GA). Python/bash'i sandbox container'da koşar. Container: Linux x86_64, Python 3.11, 5 GiB RAM, 5 GiB disk, 1 CPU. **İnternet tamamen kapalı, hiçbir giden ağ isteği yok**, runtime'da paket kurulamaz. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool (2026-10-15)
- Bash tool (`bash_20250124`) bir **CLIENT** aracıdır: komutları Claude DEĞİL, çağıran uygulama kendi host'unda çalıştırır. **Anthropic-barındırmalı sandbox değildir.** [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool (2026-10-15)
  - Anthropic'in kendi rehberi: bash oturumunu izole bir ortamda (container/VM) en az ayrıcalıklı kullanıcıyla koş, her komutu güvenilmez gir. → Bash tool tek başına **izolasyon sınırı değildir** (FD-REL-1-REJECT ile birebir ilgili). [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool (2026-10-15)

---

## B) UASCO Desktop'tan doğrudan resmi entegrasyon mümkün mü?

| Kategori | UASCO (üçüncü taraf) doğrudan programatik sürebilir mi? | Dayanak |
|---|---|---|
| (ii) Claude Code cloud sessions | **HAYIR** (resmi, desteklenen yol yok) | Aşağıdaki iki engel |
| (iii) Managed Agents | **EVET** (tek resmi, belgeli programatik yol) | POST /v1/sessions akışı |
| (iii) code-execution tool | EVET ama **LIVE PREVIEW yok, internet yok** | Container kısıtları |

### (ii) Claude Code cloud sessions — neden HAYIR
1. **Abonelik-login zorunlu, API key yetmez.** `--cloud` ve `--teleport` claude.ai girişi ister; Console API key yeterli değildir ("API key authentication is not sufficient"). [SUBSCRIPTION_ONLY] — https://code.claude.com/docs/en/claude-code-on-the-web#unable-to-get-organization-uuid (2026-10-15)
2. **Üçüncü taraf claude.ai kimlik bilgisi/oturum token'ı toplayamaz/aracılık edemez**, uygulamasının içinde claude.ai login sunamaz. [NOT_USABLE_BY_THIRD_PARTY] — https://code.claude.com/docs/en/legal-and-compliance (2026-10-15)
3. Üçüncü tarafın kendi kodundan keyfi bir cloud session yaratıp süreceği **public API/SDK bulunamadı**. [NOT_FOUND] — https://code.claude.com/docs/en/claude-code-on-the-web (2026-10-15)
   - Routine `fire` endpoint'i var ama "yalnızca claude.ai kullanıcılarına açık, Claude Platform API yüzeyinin parçası değil" ve per-routine token claude.ai hesabına bağlı → UASCO entegrasyon yolu değildir. [NOT_USABLE_BY_THIRD_PARTY] — https://code.claude.com/docs/en/routines (2026-10-15)

**Tek meşru (ii) deseni:** son kullanıcı, değiştirilmemiş Claude Code binary'sine **kendi** aboneliğiyle giriş yapar (platform barındırsa bile). Yani kullanıcı kendi makinesinde kendi login'iyle `claude --cloud` çalıştırabilir; UASCO backend'i bunu kullanıcı adına süremez. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/legal-and-compliance (2026-10-15)

### (iii) Managed Agents — neden EVET (tek resmi programatik yol)
- Üçüncü taraf backend POST https://api.anthropic.com/v1/sessions ile (agent ID + environment_id, `x-api-key`, `anthropic-beta: managed-agents-2026-04-01`) oturum yaratır; `user.message` event'leriyle görev verir; SSE stream'den çıktıyı okur; `user.interrupt` ile keser. [REQUIRES_API_ACCESS] — https://platform.claude.com/docs/en/managed-agents/sessions , https://platform.claude.com/docs/en/managed-agents/overview (2026-10-15)
- Bu, Claude Code cloud sessions'tan **ayrı bir üründür**; aynı altyapı olup olmadığı resmi olarak **UNVERIFIED**. [UNVERIFIED] — https://platform.claude.com/docs/en/managed-agents/sessions (2026-10-15)

---

## C) Mümkünse hangi API/SDK + kimlik doğrulama?

**Yalnızca (iii) Managed Agents** UASCO için meşru programatik adaydır.

- **Auth:** Claude API key, `x-api-key` veya `Authorization: Bearer`. Paylaşımlı/otomatik iş yükleri için **service-account key** önerilir; çok-workspace key'de `anthropic-workspace-id` gerekir. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/manage-claude/authentication (2026-10-15)
- **Workload Identity Federation** API key ile aynı erişimi verir; üretimde platform-kimliği (AWS/GCP/Azure/CI/K8s) varsa önerilir — ancak UASCO Windows Desktop senaryosu için **doküman yok (UNKNOWN)**. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/manage-claude/authentication (2026-10-15)
- **Oturum yaşam döngüsü:**
  - Yarat: POST /v1/sessions (opsiyonel `initial_events`, ≤50). Yaratım sandbox provizyonunu başlatır, ilk `user.message` gelene dek iş yapmaz. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/sessions (2026-10-15)
  - Görev/steer: POST /v1/sessions/{id}/events (`user.message`). [OFFICIALLY_SUPPORTED] — aynı sayfa (2026-10-15)
  - Durum: GET /v1/sessions/{id} → idle/running/rescheduling/terminated. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/session-operations (2026-10-15)
  - Canlı çıktı: GET /v1/sessions/{id}/events/stream?beta=true (SSE; açılmadan önce event gönderme). Kalıcı geçmiş: GET .../events. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/events-and-streaming (2026-10-15)
  - İptal: `user.interrupt` event'i (ayrı kill/cancel endpoint'i **NOT_FOUND**; çalışan oturum arşivlenemez/silinemez, önce interrupt + idle beklenir). [NOT_FOUND] — https://platform.claude.com/docs/en/managed-agents/session-operations (2026-10-15)
  - **Bütçe:** oluştururken `budget` (type limit, `max_list_cost` cent string, USD); cap'te `budget_reached` ile durur. Yalnızca yaratımda eklenir. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/sessions (2026-10-15)
- **Rate limit:** create 300/dk, read 1200/dk (org başına). [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/reference#rate-limits (2026-10-15)

---

## D) Kod yürütme, QA, canlı önizleme ve gerçek çıktı teslimi nasıl olurdu?

(Managed Agents temelli, (iii) üzerinden.)

- **Kod yürütme + QA (test):** ajan sandbox container'da bash/testleri koşar; `limited` ağ + açık `allowed_hosts` ile paket indirir. Gerçek test kanıtı SSE event'lerinden (span.model_request_end token kullanımı dahil) ve kalıcı event geçmişinden alınır. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/events-and-streaming (2026-10-15)
- **Girdi dosyaları:** Files API ile yüklenir, `resources` ile `/mnt/session/uploads/` altına salt-okunur mount edilir (≤500 dosya). [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/files (2026-10-15)
- **Gerçek çıktı teslimi (artifact):** ajan `/mnt/session/outputs/` altına yazar → Files API ile session-scoped listelenir (GET /v1/files?scope_id=sesn_...) ve indirilir (GET /v1/files/{id}/content). Oturum silinince dosya sistemi kalıcı silinir → **önce indir**. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/managed-agents/files , https://platform.claude.com/docs/en/managed-agents/session-operations (2026-10-15)
- **CANLI ÖNİZLEME (LIVE PREVIEW):** **NOT_FOUND / UNKNOWN.** Ne Managed Agents ne cloud sessions ne de code-execution tool dokümanlarında, sandbox içindeki web sunucusunu/portu bir tarayıcıya veya dış değerlendiriciye açan belgelenmiş bir özellik yok. [NOT_FOUND] — https://platform.claude.com/docs/en/managed-agents/environments , https://code.claude.com/docs/en/cloud-environments (2026-10-15)
  - Sonuç: FD-PRODUCT-DELIVERY-MODEL'deki **LIVE PREVIEW** adımı resmi bulut yollarıyla **karşılanamıyor** (yayımlanmış dokümana göre). Bu, F2'nin önündeki en net boşluktur.

---

## E) Sandbox güvenlik gereksinimlerimiz karşılanıyor mu, ne eksik?

| UASCO gereksinimi | Durum | Not / dayanak |
|---|---|---|
| Host üzerinde AI kodu OS-izolasyonsuz çalışmasın (FD-REL-1-REJECT) | **Karşılanır (iii bulut)** | Managed Agents kodu Anthropic container'ında koşar; UASCO host'una değmez — https://platform.claude.com/docs/en/managed-agents/environments (2026-10-15) |
| İzolasyon gücü (çekirdek/VM sınırı, escape direnci) | **UNKNOWN / UNVERIFIED** | Managed Agents yalnız "container"; cloud sessions "VM" ama hipervizör isimsiz; Trust Center / secure-deployment / security sayfaları çekilmedi — https://platform.claude.com/docs/en/managed-agents/secure-deployment , https://trust.anthropic.com (2026-10-15) |
| Bağımsız negatif güvenlik doğrulaması (item 12) | **KARŞILANMAZ (resmi kanıt yok)** | Escape-test kanıtı / üçüncü taraf sertifikasyon fetch edilen sayfalarda yok → UASCO'nun kendi bağımsız negatif doğrulamasını yine de yapması gerekir |
| Müşteri verisi izolasyonu | **Kısmi** | Files API **workspace-scoped**, oturum/kullanıcı-scoped değil → her tenant için ayrı workspace şart (org başına ≤100 workspace) — https://platform.claude.com/docs/en/build-with-claude/files#workspace-scoped-access (2026-10-15) |
| ZDR / regüle veri | **KARŞILANMAZ** | Managed Agents ZDR/HIPAA kapsamı yok; cloud sessions ZDR org'larda kullanılamaz — https://platform.claude.com/docs/en/managed-agents/overview , https://code.claude.com/docs/en/legal-and-compliance (2026-10-15) |
| Veri saklama/eğitim politikası | **UNKNOWN** | data-usage / zero-data-retention sayfaları fetch edilmedi (2026-10-15) |
| Ağ dışına sızma riski | **Yönetilebilir** | `limited`+allowed_hosts zorunlu kılınmalı; "per host, per operation değil" uyarısı — https://platform.claude.com/docs/en/managed-agents/environments (2026-10-15) |

**Eksikler (özet):** izolasyon teknolojisi ve escape-test kanıtı UNKNOWN; bağımsız negatif güvenlik doğrulaması resmi olarak kapatılamıyor (UASCO kendi yapmalı); ZDR yok; saklama/eğitim politikası fetch edilmedi; LIVE PREVIEW yok.

---

## F) F2, kullanıcı PC'sinde ek yerel sanallaştırma olmadan teslim edilebilir mi?

- **Yürütme/test tarafı: EVET (koşullu).** Managed Agents ile AI kodu Anthropic bulut container'ında koşar; kullanıcı Windows PC'sinde Hyper-V/WSL2/Windows Sandbox/Docker/yerel VM **gerekmez**. UASCO Desktop yalnızca HTTPS ile API'yi sürer (OS-agnostik, Windows rehberi yok ama engel de yok). [OFFICIALLY_SUPPORTED, Windows rehberi UNKNOWN] — https://platform.claude.com/docs/en/managed-agents/overview (2026-10-15)
- **ANCAK iki sert blokör nedeniyle F2 tam akışı yerel sanallaştırma olmadan bugün KISMEN teslim edilebilir (PARTIAL):**
  1. **LIVE PREVIEW** resmi bulut yollarında NOT_FOUND → F2'nin "canlı önizleme" adımı karşılanamıyor.
  2. **Bağımsız negatif güvenlik doğrulaması** için resmi izolasyon kanıtı yok → "PRODUCT_VERIFIED" güvenlik şartı resmi dokümanla kapatılamıyor.
- Not: (ii) cloud sessions yolu kullanıcının **kendi** claude.ai login'iyle (UASCO aracılık etmeden) F2'yi yerel sanallaştırmasız sürebilir; ama bu UASCO'nun programatik sürdüğü bir yol değildir ve yine LIVE PREVIEW boşluğu durur.

**Sonuç F:** Yerel sanallaştırma olmadan **kod yürütme+test** evet; **tam F2 akışı (… → LIVE PREVIEW → bağımsız inceleme → gerçek çıktı)** bugün **PARTIAL** — LIVE PREVIEW ve bağımsız izolasyon kanıtı eksik.

---

## G) Founder aboneliği dışında ek maliyet

- **Managed Agents:** token list-cost'un ötesinde sandbox-saat/oturum ücreti **belgelerde yok** → ek maliyet **NOT_FOUND / UNKNOWN** (pricing sayfası çekilmedi). Model maliyeti token-bazlı; oturum `budget` ile cap konabilir. [NOT_FOUND] — https://platform.claude.com/docs/en/managed-agents/sessions (2026-10-15)
- **Cloud sessions / routines:** bulut VM için ayrı ücret yok; plan kullanım limitlerinden düşer ve tüm Claude/Claude Code kullanımıyla rate limit paylaşır. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/claude-code-on-the-web (2026-10-15)
- **code-execution / Files API:** Files API işlemleri ücretsiz; Messages'ta kullanılan dosya içeriği input token olarak faturalanır. [OFFICIALLY_SUPPORTED] — https://platform.claude.com/docs/en/build-with-claude/files (2026-10-15)

**Uyarı:** Managed Agents, abonelik (Pro/Max) değil **API Console** kullanımıdır → Founder aboneliğinin "dahil" kotası bunu kapsamaz; ayrı API harcaması doğar (tutar UNKNOWN).

---

## H) Lisans/dağıtım uygunluğu (ilk kişisel F2 ve ticari UASCO)

- **İlk kişisel F2 (Founder kendi kullanımı):** Founder kendi claude.ai aboneliğiyle değiştirilmemiş Claude Code binary'sine giriş yapıp `claude --cloud` koşabilir — resmi, meşru desen. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/legal-and-compliance (2026-10-15)
- **Ticari UASCO (son kullanıcılar için):**
  - claude.ai login/abonelik kimlik bilgisiyle **üçüncü taraf aracılığı YASAK** → cloud sessions ticari backend olamaz. [NOT_USABLE_BY_THIRD_PARTY] — https://code.claude.com/docs/en/legal-and-compliance (2026-10-15)
  - Ürün içinde Claude Code çalıştırmak/önkurmak Commercial Terms'e tabidir: binary değiştirilemez; Claude kullanımı yeniden satılamaz/aracılık edilemez; **her son kullanıcı kendi API key/abonelik/sağlayıcı kimliğiyle** doğrular; Anthropic/Claude Code adı/logosu ürün adında olamaz. [OFFICIALLY_SUPPORTED] — https://code.claude.com/docs/en/legal-and-compliance (2026-10-15)
  - Commercial Terms (17 Haz 2025): müşteriler kendi son kullanıcıları için ürün kurabilir (A.1/D.2/D.3) ama **yeniden satış ve rakip ürün yasak** (D.4). [OFFICIALLY_SUPPORTED / kısmen NOT_USABLE_BY_THIRD_PARTY] — https://www.anthropic.com/legal/commercial-terms (2026-10-15)
  - **Managed Agents ile ticari çok-tenant:** UASCO kendi API key'iyle API üzerinden ürün sunabilir (Commercial Terms genel izin verir); ama multi-tenant servis-özel şartlar ve Usage Policy tam okunmadı → **hukuk incelemesi gerekli (UNVERIFIED)**. [UNVERIFIED] — https://www.anthropic.com/legal/aup (fetch edilmedi) (2026-10-15)

**Sonuç H:** Kişisel F2 için (ii) kullanıcı-login yolu uygundur. Ticari UASCO için tek meşru taban **(iii) API-key tabanlı Managed Agents**'tır; cloud sessions ticari backend olarak **uygun değildir**. Her iki ticari yol da Commercial Terms + Usage Policy **hukuk onayı** gerektirir (UNVERIFIED).

---

## I) Kalan entegrasyon iş paketleri + P50/P80/P95 ETA

Dürüst ilke: doğrulanmamış gerçeklere veya dış bağımlılığa (Anthropic legal/pricing) bağlı kalemler **UNKNOWN** işaretlidir; tahmin verilmez.

| # | İş paketi | ETA (P50 / P80 / P95) |
|---|---|---|
| WP-1 | Managed Agents PoC: session yarat → user.message → SSE oku → outputs indir (UASCO CLAUDE_CONFIG_DIR broker) | 2g / 4g / 6g |
| WP-2 | SandboxProvider adaptörü: Managed Agents'ı doğrulanmış provider olarak bağla; doğrulama başarısızsa fail-closed BLOCKED(SANDBOX_UNAVAILABLE) korunur | 3g / 5g / 8g |
| WP-3 | Work OS sahipliği: task id, permission, budget (budget_reached), checkpoint eşleme Work OS runner'a | 3g / 6g / 9g |
| WP-4 | Implementer/reviewer ayrımı: ayrı salt-okunur reviewer oturumu/pipeline, gerçek test kanıtı toplama | 3g / 6g / 10g |
| WP-5 | Müşteri izolasyonu: tenant başına workspace + Files API scope stratejisi | 2g / 4g / 7g |
| WP-6 | **LIVE PREVIEW** çözümü | **UNKNOWN** (resmi destek NOT_FOUND; dış bağımlılık) |
| WP-7 | **Bağımsız negatif güvenlik doğrulaması (item 12)** | **UNKNOWN** (resmi izolasyon kanıtı yok; UASCO kendi test tasarımına + Anthropic yanıtına bağlı) |
| WP-8 | **Hukuk onayı** (ticari multi-tenant, Usage Policy, routine token duruşu) | **UNKNOWN** (Anthropic legal/sales dış bağımlılık) |
| WP-9 | **Maliyet modeli** (Managed Agents sandbox/oturum ücreti) | **UNKNOWN** (pricing belgesiz) |

**Genel F2 ETA:** Yürütme+test çekirdeği (WP-1..WP-5) P50 ~2 hafta / P80 ~3,5 hafta / P95 ~5 hafta mühendislik. **Tam F2 ETA = UNKNOWN**, çünkü WP-6/WP-7/WP-8 dış bağımlılık ve doğrulanmamış gerçeklerle gated.

---

## J) Desteklenmeyen veya doğrulanamayan özellikler

- Üçüncü tarafın keyfi **Claude Code cloud session** yaratıp sürmesi → **NOT_FOUND** — https://code.claude.com/docs/en/claude-code-on-the-web (2026-10-15)
- Cloud session transcript/diff/çıktı/artifact'ı **HTTP API ile okuma** → **NOT_FOUND** — https://platform.claude.com/docs/en/api/claude-code/routines-fire (2026-10-15)
- Bulut VM / sandbox'tan **canlı önizleme URL'i / inbound port** → **NOT_FOUND** — https://code.claude.com/docs/en/cloud-environments , https://platform.claude.com/docs/en/managed-agents/environments (2026-10-15)
- code-execution container'da internet / listening server / preview → **NOT_FOUND** (internet "tamamen kapalı") — https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool (2026-10-15)
- Managed Agents için ayrı hard-kill/cancel endpoint'i → **NOT_FOUND** — https://platform.claude.com/docs/en/managed-agents/session-operations (2026-10-15)
- Bulut sandbox izolasyon gücü / escape direnci / sertifikasyon → **UNVERIFIED** — https://platform.claude.com/docs/en/managed-agents/secure-deployment , https://trust.anthropic.com (2026-10-15)
- Managed Agents ↔ cloud sessions aynı ürün/altyapı mı → **UNVERIFIED** (2026-10-15)
- Routine fire token'ının üçüncü tarafça kullanımının ToS duruşu → **UNVERIFIED** — https://code.claude.com/docs/en/legal-and-compliance (2026-10-15)
- Managed Agents pricing / sandbox-saat ücreti → **NOT_FOUND** (2026-10-15)
- Agent SDK GA/beta durumu → **NOT_FOUND** — https://code.claude.com/docs/en/agent-sdk/overview (2026-10-15)
- Windows Desktop'tan bulut sürme için Windows-özel resmi rehber → **UNKNOWN** (2026-10-15)

**Uyarı:** tarayıcı otomasyonu, özel/belgelenmemiş uç noktalar veya kısıtlama atlatma yolları bu raporda **desteklenen çözüm olarak sunulmamıştır**; yukarıdaki NOT_FOUND kalemleri için "alternatif bulut" önerilmez.

---

## K) Mevcut güvenlik kararlarını koruyan en iyi mimari

Önerilen taban: **(iii) Managed Agents'ı doğrulanmış bir SandboxProvider olarak bağlayan, Work OS'un sahip olduğu fail-closed bir yürütme kapısı.**

- **Fail-closed SandboxProvider (`core/workos/execution-gate.ts` sözleşmesi):** Managed Agents bir provider implementasyonu olarak eklenir. Provider "doğrulanmış" sayılması için: (a) API key + beta header ile canlı session yaratılabildiği, (b) `limited`+allowed_hosts ağının etkin olduğu, (c) outputs/event kanıtının geri alınabildiği **ispatlanmalı**; aksi halde kapı `BLOCKED(SANDBOX_UNAVAILABLE)` döner ve host'ta hiçbir şey koşmaz. (Not: bu modül mevcut çalışma ağacında bulunamadı; sözleşme Founder kararından alınmıştır — bulunduğu dal doğrulanmalı.)
- **Work OS sahipliği:** task id'leri, permission'lar, `budget` (budget_reached), checkpoint'ler Work OS'ta tutulur; Managed Agents session id/budget/stream'ine 1:1 eşlenir. Anthropic tarafı yalnız yürütme sağlayıcısıdır, otorite değildir.
- **Implementer vs reviewer ayrımı:** implementer ayrı bir UASCO CLAUDE_CONFIG_DIR broker'ıyla; reviewer ayrı, salt-okunur bir oturum/pipeline. İkisi aynı session'ı paylaşmaz.
- **PRODUCT_VERIFIED yalnız gerçek kanıtla:** test, bulut sandbox'ta **gerçekten** koşar; kanıt SSE event geçmişi + `/mnt/session/outputs/` artifact indirmesiyle toplanır. Kanıt yoksa PRODUCT_VERIFIED verilmez.
- **Bağımsız negatif güvenlik doğrulaması (item 12):** resmi izolasyon kanıtı UNKNOWN olduğundan, bulut yolu **item 12'yi kaldırmaz** — UASCO kendi bağımsız negatif doğrulamasını (ağ sızıntısı, workspace sınırı, budget kaçağı testleri) yine çalıştırır ve kapı bunu zorunlu tutar.
- **Müşteri verisi izolasyonu:** Files API workspace-scoped olduğundan **tenant başına ayrı workspace**; end-user'dan gelen file_id asla kabul edilmez.
- **Setup Wizard login / kişisel profil asla otomatik değil:** Managed Agents API-key tabanlı olduğundan kişisel claude.ai profili süreçte **hiç kullanılmaz**; (ii) yolu seçilirse login yalnız kullanıcının kendi elinden geçer.

### SandboxProvider-fit alt bölümü
- Resmi bir bulut yolu (Managed Agents) **fail-closed kapıyı karşılayabilir**: provider doğrulanamazsa BLOCKED korunur; doğrulanırsa gerçek test bulut sandbox'ta koşar ve kanıt geri alınır → **PRODUCT_VERIFIED teknik olarak mümkün**.
- **Ancak item 12 (bağımsız negatif güvenlik doğrulaması) resmi dokümanla kapatılamaz** (izolasyon kanıtı UNKNOWN). Dolayısıyla bulut yolu kapıyı **besler ama item 12'yi yine zorunlu kılar**; LIVE PREVIEW boşluğu (NOT_FOUND) ayrıca çözülmeden tam F2 "PRODUCT_VERIFIED" ilan edilemez.

---

## A–D Seçenek Karşılaştırma Tablosu

Seçenekler: **A** = Claude resmi bulut (Managed Agents / cloud sessions), **B** = yerel sandbox (kullanıcı PC'sinde WSL2/Docker/VM), **C** = mevcut altyapıda uzak worker (self-hosted), **D** = yalnız kaçınılmazsa dış VPS.

| Kriter | A: Claude resmi bulut | B: Yerel sandbox | C: Mevcut-altyapı uzak worker | D: Dış VPS |
|---|---|---|---|---|
| Resmi destek | **Managed Agents EVET (beta)**; cloud sessions sadece kullanıcı-login | Yerel Bash sandbox macOS/Linux/WSL2; **native Windows izolasyonsuz** | Managed/CC self-hosted EVET (beta) | Resmi "ürün" değil; genel altyapı |
| Windows Desktop entegrasyonu | HTTPS API, OS-agnostik (Windows rehberi UNKNOWN) | Windows'ta WSL2/VM gerektirir (Founder istemiyor) | Worker Linux host ister | VPS ayrı makine (Founder istemiyor) |
| Ek host kurulumu | **YOK** | **VAR** (WSL2/Docker/VM) | Linux host işletmek | VPS işletmek |
| Gerçek izolasyon | VM (cloud sessions) / container (MA); **güç UNKNOWN** | OS-enforced (native Windows'ta YOK) | Müşterinin sorumluluğu | Müşterinin sorumluluğu |
| Terminal + preview | Yürütme EVET; **LIVE PREVIEW NOT_FOUND** | Tam yerel kontrol, preview mümkün | Yürütme worker'da; preview belirsiz | Tam kontrol, preview mümkün |
| Maliyet / kota | MA: token + **sandbox ücreti UNKNOWN**; cloud sessions plan kotası | Donanım/elektrik; ek bulut yok | Mevcut host maliyeti | VPS ücreti |
| Müşteri veri güvenliği | Workspace-scoped; **ZDR yok** | Veri PC'den çıkmaz | Veri Anthropic kontrol düzleminden geçer | Veri VPS'te |
| Ticari uygunluk | **MA: EVET (hukuk onayı gerekli)**; cloud sessions backend: HAYIR | Uygun ama izolasyon riski | Beta; uygun | Uygun ama Founder istemiyor |
| Geliştirme/entegrasyon süresi | Orta (WP-1..WP-5 ~2-5 hafta) | Düşük-orta ama Windows izolasyon problemi | Yüksek (host işletme) | Yüksek |
| F2 ETA etkisi | **En hızlı yol ama LIVE PREVIEW+item12 gated** | Founder kısıtını ihlal (yerel sanallaştırma) | Founder kısıtını zorlar | Founder kısıtını ihlal |

**Tavsiye:** A (Managed Agents) tek resmi, Founder'ın "ek yerel sanallaştırma yok / ikinci makine yok / VPS yok" kısıtlarına uyan programatik yoldur; fail-closed SandboxProvider olarak bağlanmalıdır. Ancak **LIVE PREVIEW (NOT_FOUND)**, **bağımsız izolasyon kanıtı (UNVERIFIED)**, **pricing (UNKNOWN)** ve **ticari/Usage-Policy hukuk onayı (UNVERIFIED)** kapatılmadan tam F2 "PRODUCT_VERIFIED" ilan edilemez. Cloud sessions (ii) yalnızca Founder'ın kendi kişisel F2'si için (kendi login'iyle) uygundur, UASCO backend yolu değildir.

---

*Rapor FD-CLOUD-EXECUTION-RESEARCH-2026-10-15 kapsamında, yalnızca resmi dokümantasyona dayanılarak, salt-okunur modda üretildi. Doğrulama tarihi 2026-10-15. UNKNOWN/NOT_FOUND/UNVERIFIED kalemleri varsayıma kapatılmamıştır.*

---

## L) Bağımsız eleştirmen notları

- Rol: **tamlık + aşırı-iddia eleştirmeni** (bağımsız, SALT-OKUNUR). FD-CLOUD-EXECUTION-RESEARCH-2026-10-15 kapsamında. Doğrulama tarihi **2026-10-15**.
- Bu bölüm A–K'yi değiştirmez; yalnızca eklenir. Her madde: **önem** + **hangi bölüm değişmeli**.
- Önem ölçeği: KRİTİK > YÜKSEK > ORTA > DÜŞÜK.

### Bağımsız olarak doğrulanan çekirdek (rapor burada DOĞRU)
- **Managed Agents** iddiaları resmi `managed-agents/overview` sayfasından birebir doğrulandı: `status: beta`, `betaHeader: managed-agents-2026-04-01`, "enabled by default for all API accounts", "not currently eligible for Zero Data Retention or HIPAA BAA", POST ile oturum + SSE stream + steer/interrupt. Sayfada **fiyat yok** (G'deki NOT_FOUND doğru). — https://platform.claude.com/docs/en/managed-agents/overview (2026-10-15)
- **Cloud sessions** iddiaları resmi `claude-code-on-the-web` sayfasından birebir doğrulandı: "available on Pro, Max, and Team ... Enterprise users with premium seats", "API key authentication is not sufficient", "there's no separate charge for the cloud VM", üçüncü-taraf public oturum API'si yok. — https://code.claude.com/docs/en/claude-code-on-the-web (2026-10-15)
- Kural **(c)** abonelik≠API faturalama (G/§132), kural **(e)** bypass/tarayıcı-otomasyonu desteklenen gibi sunulmamış (§8, §183), kural **(h)** fail-closed + item 12 korunmuş — bu üç kural raporda doğru ele alınmış (tek istisna: aşağıdaki L-2 "kod yok" uyarısı).

### Tespit edilen boşluklar ve aşırı-iddialar

**L-1 — [YÜKSEK] Commercial Terms atıf bütünlüğü çelişkisi.** H (§142), Commercial Terms A.1/D.2/D.3/D.4 maddelerini **[OFFICIALLY_SUPPORTED]** etiketi ve doğrudan `anthropic.com/legal/commercial-terms` URL'i ile sunuyor; oysa kanıt JSON'un kendi `gaps` listesi "Commercial Terms ... **not fetched directly**; claims rely on quotes inside the Claude Code legal page" diyor. İkinci-el alıntı, doğrudan-doğrulanmış gibi gösterilmiş — kural (a) ve (d) ihlali. **Değişmeli: H bölümü + A–D tablosu "Ticari uygunluk" satırı** → bu madde-seviyesi iddialar SECOND-HAND/UNVERIFIED'e indirilmeli ya da sayfa gerçekten çekilip gap kaldırılmalı.

**L-2 — [YÜKSEK] K önerisinin dayandığı fail-closed kapı kodda YOK.** `core/workos/execution-gate.ts` yalnızca planlama dokümanlarında geçiyor; çalışma ağacında **`core/workos/` dizini dahi yok** (doğrulandı: `core/` altında action-gateway/authority/capabilities/competency/decision/knowledge/mission/policy/qa/resources var, workos yok). Rapor bunu bir dipnotla kabul ediyor, ama tüm K mimarisi ("Work OS'un sahip olduğu fail-closed kapı", "SandboxProvider adaptörü") inşa edilmemiş bir sözleşmeye dayanıyor ve WP-2 var olan bir modülü "bağla" diye varsayıyor. **Değişmeli: K bölümü** → "mevcut kod tabanında Work OS / execution-gate katmanı YOKTUR; bu hedef-mimaridir, mevcut durum değil" başa alınmalı; **I bölümüne** "execution-gate + SandboxProvider soyutlamasının sıfırdan inşası" diye ayrı bir WP eklenmeli (WP-2 yalnızca adaptörü değil, taşıyıcı katmanı da kapsamalı).

**L-3 — [ORTA] Resmi SELF-HOSTED yol raporda görünmüyor (tamlık boşluğu).** Kanıt hem **Managed Agents self-hosted sandbox** (worker müşteri host'unda `/bin/bash`, araç I/O yine Anthropic kontrol-düzleminden geçer) hem **Claude Code self-hosted environments**'ı belgeliyor. İkisi de Founder'ın "ikinci makine/VPS yok" kısıtı ve **FD-REL-1** için doğrudan kritik: worker Windows host'unda koşarsa araç yürütmesi **host'a döner ve OS izolasyonu olmaz** — yani bu yol seçilirse FD-REL-1-REJECT ihlal edilir. Rapor B/C/K'de bu seçeneği hiç tartışmıyor; A–D tablosundaki "C: mevcut-altyapı uzak worker" satırı resmi self-hosted ürüne bağlanmamış, risk uyarısı yok. **Değişmeli: A bölümü + A–D tablosu "C" sütunu** → resmi self-hosted Managed Agents/CC environment yolu, kontrol-düzlemi veri-akışı ve "worker'ı host'ta koşturmak OS-izolasyonsuzdur (FD-REL-1 ihlali)" uyarısı eklenmeli.

**L-4 — [ORTA] Files API kapsam modeli karıştırılmış.** E (§105) ve K (§196) "Files API **workspace-scoped**, oturum/kullanıcı-scoped değil" diyerek tenant başına ayrı workspace'i tek gerekçe yapıyor; atıf `build-with-claude/files` (code-execution faseti). Fakat Managed Agents faseti, oturum çıktılarının `/mnt/session/outputs/` → `GET /v1/files?scope_id=sesn_...` ile **OTURUM-scoped** listelendiğini belgeliyor. İki ayrı model (yüklenen GİRDİ dosyaları = workspace-scoped; MA oturum ÇIKTILARI = session-scoped) tek "workspace-scoped" iddiasına indirgenmiş — kategori (iii) içinde hafif konflasyon. **Değişmeli: E + K müşteri-izolasyon satırları** → girdi-upload (workspace) ile MA oturum-çıktısı (session) kapsamları ayrılmalı; "end-user file_id asla kabul edilmez" kuralı korunur, gerekçe netleştirilir.

**L-5 — [ORTA] ETA toplamı, parçaların toplamından iyimser.** I'de WP-1..WP-5 **P80 toplamı 4+5+6+6+4 = 25 gün (~5 hafta)**, **P95 toplamı 6+8+9+10+7 = 40 gün (~8 hafta)**; ama genel rollup "P80 ~3,5 hafta / P95 ~5 hafta" diyor. Paralelleştirme veya çoklu-geliştirici varsayımı yazılmamış → tek geliştirici + sıralı akışta rollup gerçekçi değil (kural g). **Değişmeli: I bölümü rollup satırı** → ya per-WP toplamıyla uyumlu (P80 ~5 hafta, P95 ~8 hafta) olmalı ya da açık paralellik/kişi-sayısı varsayımı belirtilmeli.

**L-6 — [ORTA] GA tarihi, çelişkili tek kaynağa "OFFICIALLY_SUPPORTED" ile dayandırılmış.** A (§31) cloud sessions GA'yı "23 Eylül 2026" diye blog güncelleme notundan alıyor; aynı blog gövdesi "research preview / Ekim 2025" diyor ve docs sayfasında GA tarihi yok (bağımsız doğrulandı: `claude-code-on-the-web` sayfasında GA tarihi geçmiyor). Çelişkili tek kaynaktan türetilen tarih `[OFFICIALLY_SUPPORTED, çelişkili]` değil **UNVERIFIED** olmalı. **Değişmeli: A bölümü** → GA tarihi UNVERIFIED'e indirilmeli (karar bu tarihe bağlı değil, yani etkisiz; yine de etiket düzeltilmeli).

**L-7 — [DÜŞÜK-ORTA] E tablosunda FD-REL-1 satırı iç tutarsız.** "Host üzerinde OS-izolasyonsuz çalışmasın" gereksinimi "**Karşılanır (iii bulut)**" işaretli; hemen altındaki "izolasyon gücü" satırı **UNKNOWN**. Gereksinim OS-izolasyon etrafında tanımlı olduğundan "kod UASCO host'una değmez" doğru, ama "OS-izolasyon gücü karşılanır" değil. **Değişmeli: E tablosu FD-REL-1 satırı** → "Host-dışı: Karşılanır; **izolasyon gücü: UNKNOWN** (bkz. item 12)" olarak nitelendirilmeli; mevcut "Karşılanır" mutlak okunuşu item 12 gerekçesini zayıflatıyor.

**L-8 — [DÜŞÜK] "Tek resmi programatik yol" ifadesi niteleme olmadan aşırı okunabilir.** B/C, Managed Agents'ı "tek resmi, belgeli programatik yol" diyor. Agent SDK de resmi programatik yoldur — ama geliştirici-barındırmalı, Anthropic-hosted sandbox değil. İddia "üçüncü tarafın **bulut-sandbox'lı** yürütmeyi programatik sürmesi" için doğru; niteleme eklenmezse "tek programatik yol" genel olarak yanlış okunabilir. **Değişmeli: B ve C** → "tek resmi, **Anthropic-barındırmalı** programatik yol" olarak netleştirilmeli.

**L-9 — [DÜŞÜK] A–D karşılaştırma tablosu inline atıfsız teknik iddialar taşıyor.** "native Windows izolasyonsuz", "ZDR yok", "sandbox ücreti UNKNOWN" gibi hücreler gövdede atıflı olsa da tablo tek başına okunduğunda kural (a) ihlali gibi görünür. **Değişmeli: A–D tablosu** → en az bir dipnotla ilgili gövde bölümlerine (A/E/G/H) referans verilmeli.

### Özet
- **En önemli iki düzeltme:** L-1 (Commercial Terms atıfını ikinci-el olarak işaretle veya sayfayı gerçekten çek) ve L-2 (K'nin dayandığı execution-gate/Work OS katmanının kodda var olmadığını başa al + WP ekle).
- Raporun çekirdek teknik yapısı (kategori ayrımı, Managed Agents = üçüncü-taraf için tek Anthropic-barındırmalı programatik yol, cloud sessions backend olamaz, LIVE PREVIEW NOT_FOUND, ZDR yok, izolasyon gücü UNKNOWN, item 12 kaldırılamaz) **bağımsız olarak sağlam** bulundu.
- Founder güvenlik kararları (FD-REL-1-REJECT, fail-closed SandboxProvider, item 12 bağımsız negatif doğrulama) **korunmuş**; tek uyarı: bu kararların öngördüğü kod katmanı (L-2) henüz mevcut değil.

*(L bölümü — bağımsız eleştirmen, salt-okunur, 2026-10-15. A–K değiştirilmedi.)*
