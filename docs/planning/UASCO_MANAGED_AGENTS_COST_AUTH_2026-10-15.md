# UASCO — Anthropic Managed Agents: Maliyet, Yetkilendirme ve Faturalama Paketi

Karar kimliği: FD-MANAGED-AGENTS-POC-2026-10-15
Tarih: 2026-10-15
Durum: Founder karar paketi (KARAR BEKLENİYOR — bu belge harcama önerisi DEĞİLDİR)
Kapsam: Yalnızca RESMÎ Anthropic dokümantasyonu/fiyatlandırması/hukuki sayfaları üzerinden READ-ONLY araştırma. Oturum oluşturulmadı, anahtar bağlanmadı, hiçbir harcama yapılmadı, buluta hiçbir veri gönderilmedi.

> ÖNEMLİ: Founder, tahmini maliyet + harcama üst sınırı + exact izin kapsamı kendisine sunulmadan PoC'yi ÇALIŞTIRMAYACAKTIR. Bu belge o paketi sunar. Hiçbir satırı harcama veya bağlantı izni anlamına gelmez.

---

## 0. PoC tanımı (sabit, dar)

PoC = tek bir küçük sentetik görev:
1. Bir Managed Agents cloud oturumu oluştur (bir Linux sandbox).
2. UASCO tarafından yazılmış küçük bir `add()` fonksiyonu + bir birim testi oturumda çalıştır.
3. Küçük bir çıktı (test sonucu/artefakt) geri al.
4. Oturumu/dosyaları sil.

PoC'de gerçek müşteri verisi, kişisel veri veya gizli bilgi YOKTUR. Yalnızca sentetik, gizli olmayan test projesi kullanılır.

---

## 1. PoC maliyet tahmini (tek küçük görev)

### 1.1 Resmî fiyatlandırma temeli (hepsi 2026-10-15 doğrulandı)

Managed Agents iki boyutta faturalandırılır: (a) token'lar standart model fiyat tablosu oranlarından, (b) oturum çalışma süresi.
Kaynak: https://platform.claude.com/docs/en/about-claude/pricing (bölüm "Claude Managed Agents pricing"), doğrulama 2026-10-15.

- Oturum çalışma süresi (Session runtime): **0,08 USD / oturum-saati**, yalnızca "running" durumu milisaniye hassasiyetiyle sayılır. Idle (kullanıcı mesajı/araç onayı beklerken), yeniden zamanlama (rescheduling) ve terminated durumları SAYILMAZ. Kaynak: aynı sayfa, SKU "Session runtime". Doğrulama 2026-10-15.
- Bu çalışma süresi ücreti, Managed Agents kullanılırken kod yürütme (code execution) container-saat modelinin YERİNE geçer; çalışma süresinin ÜZERİNE ayrı bir container-saat ücreti eklenmez. Kaynak: aynı sayfa, "Note". Doğrulama 2026-10-15.
- Oturum içi web araması standart **10 USD / 1.000 arama** ile faturalanır (Batch API indirimi ve bulut-platform fiyatlandırması Managed Agents oturumlarına UYGULANMAZ). Kaynak: aynı sayfa. Doğrulama 2026-10-15.
- Değiştiriciler: `inference_geo` "us" sabitlenirse token'lar **1,1x** standart oran; `model.speed` "fast" ise fast-mode premium fiyatlandırma uygulanır. Kaynak: aynı sayfa, Managed Agents tokens alt bölümü. Doğrulama 2026-10-15.

Resmî çalışılmış örnek (doğrulama 2026-10-15, aynı sayfa):
- Opus 5.5 üzerinde 1 saatlik oturum, 50.000 girdi + 15.000 çıktı token = toplam **0,58 USD** (0,08 USD oturum çalışma süresi dahil).
- 40.000 cache-read token ile aynı örnek toplam **0,428 USD**.

Model token fiyatları (USD/MTok, doğrulama 2026-10-15, aynı sayfa):
- Haiku 5.5 (≤100k istem): girdi 0,10 / 5dk cache-write 0,125 / 1s cache-write 0,20 / cache-hit 0,01 / çıktı 0,50. (>100k istem: 0,50 / 0,625 / 1 / 0,05 / 2,50.)
- Sonnet 5.5: girdi 2 / çıktı 10, cache-hit 0,10.
- Opus 5.5: girdi 4 / çıktı 20, cache-hit 0,20.

### 1.2 Sandbox-özel zaman ücreti

Managed Agents cloud sandbox'ları için ayrı bir sandbox-saati / container / disk / bellek fiyatı yayımlanmamıştır. Tek zaman tabanlı ücret 0,08 USD/oturum-saatidir.
Durum: **NOT_FOUND**. Kaynaklar kontrol edildi: https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference , .../environments , ve pricing sayfası. Doğrulama 2026-10-15.

### 1.3 PoC için tahmini maliyet (TAHMİN — ölçülmemiş, UNVERIFIED)

Varsayımlar (ölçüm değil, varsayım): ~10 dakika "running" (~0,013 USD çalışma süresi), ~10 model turu, her tur ~20k girdi + ~2k çıktı token, cache yok, web araması/kod yürütme aracı kullanılmıyorsa ek 0 USD.

| Model | Token maliyeti (~) | Çalışma süresi (~) | Toplam (~) |
|---|---|---|---|
| Haiku 5.5 | ~0,03 USD | ~0,013 USD | **~0,04 USD** |
| Sonnet 5.5 | ~0,60 USD | ~0,013 USD | **~0,61 USD** |
| Opus 5.5 | ~1,20 USD | ~0,013 USD | **~1,21 USD** |

Durum: **UNVERIFIED** (yayımlanmış oranlardan türetildi; tur sayısı, token boyutları ve süre varsayımdır). Kaynak oranları: https://platform.claude.com/docs/en/about-claude/pricing , doğrulama 2026-10-15.

Kalan belirsizlik (UNKNOWN): Managed Agents harness'ının (sistem istemi + yerleşik araç tanımları) token ek yükü fiyat sayfasında ölçülmemiştir; bu nedenle gerçek token sayısı tahminden sapabilir. Caching token maliyetini düşürür.

---

## 2. PoC için önerilen sabit (hard) harcama üst sınırı

Mekanizma: Managed Agents "budget" nesnesi oturum oluşturulurken ayarlanan SABİT bir USD üst sınırıdır.
Kaynak: https://platform.claude.com/docs/en/managed-agents/budgets , doğrulama 2026-10-15.

Budget nesnesinin doğrulanmış davranışı:
- Liste maliyetini (model token'ları liste oranından + web aramaları 10 USD/1.000 + çalışma süresi 0,08 USD/saat) kapsar.
- Tutar, sentlik tam sayı dizgesidir (örn. "125" = 1,25 USD), sıfırdan büyük olmalı, tek para birimi USD.
- Oturum oluşturulurken ayarlanır; var olan bir oturuma SONRADAN eklenemez (budget'sız oluşturulan oturuma eklemek 400 döndürür).
- Üst sınır model istekleri ARASINDA zorlanır; harcama en fazla bir istek/thread kadar aşabilir (overshoot ≤ 1 istek).
- Üst sınıra ulaşan oturum `stop_reason: budget_reached` ile idle'a geçer; terminate edilmez. Üst sınırı değiştirmek, tüketilen liste maliyetinin kesinlikle üzerinde bir değer gerektirir. Budget kaldırma tek yönlüdür.

Önerilen PoC sabit üst sınırı: **"100" (= 1,00 USD)**.
Gerekçe: Sonnet 5.5 en kötü durumunu (~0,61 USD) marjla kapsar, Opus worst-case'i (~1,21 USD) aşarsa budget_reached ile durur, overshoot en fazla tek istektir. Haiku worst-case (~0,04 USD) için fazlasıyla yeterli.
Not: Bu bir harcama ÖNERİSİ değildir; nihai üst sınır ve model seçimi, herhangi bir oturum oluşturulmadan ÖNCE Founder onayı gerektirir.

---

## 3. PoC için Founder'ın vereceği EXACT izin kapsamı

Founder onayı verirse, kapsam yalnızca şunlarla sınırlıdır:

1. Endpoint'ler (yalnızca bunlar):
   - `POST https://api.anthropic.com/v1/sessions` — tek bir Managed Agents oturumu oluştur (budget nesnesi "100" ile, beta header `anthropic-beta: managed-agents-2026-04-01`).
   - İlgili oturum durum/okuma çağrıları (durum izleme) ve tek görev gönderimi.
   - Oturum/dosya silme çağrısı (temizlik).
   Kaynaklar: https://platform.claude.com/docs/en/managed-agents/overview , https://platform.claude.com/docs/en/managed-agents/onboarding.md , doğrulama 2026-10-15.
2. İçerik: TEK bir sentetik, gizli olmayan kod parçacığı (UASCO-yazımı `add()` + birim test). Başka proje, repo veya dosya YÜKLENMEZ.
3. Oturum sayısı: TEK oturum. Toplu/paralel oturum yok.
4. Veri sınırı: Müşteri verisi YOK, kişisel veri YOK, üretim/gizli artefakt YOK. Yalnızca sentetik test.
5. Ağ: Managed Agents API ile oluşturulan ortamda networking alanı belirtilmezse VARSAYILAN kısıtsız (unrestricted) ağ olur; Console ise Limited'dan başlar. PoC için ortam ağı mümkünse Limited/kapalı seçilmelidir. Kaynak: https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference , .../environments , doğrulama 2026-10-15.
6. Anahtar işleme: Console API anahtarı YALNIZCA ortam değişkeni/güvenli store üzerinden kullanılır; log'lara, context'e, rapora veya commit'e ASLA yazılmaz. Anahtar değeri hiçbir yanıtta tekrarlanmaz.
7. Veri saklama uyarısı (karar için önemli): Managed Agents, Zero Data Retention (ZDR) ve HIPAA BAA kapsamında DEĞİLDİR. Oturum geçmişi, sandbox durumu ve çıktılar silinene kadar sunucu tarafında saklanır. Oturum ve yüklenen dosyalar API ile silinebilir. Kaynak: https://platform.claude.com/docs/en/managed-agents/overview , doğrulama 2026-10-15.

Sandbox gerçekleri (doğrulama 2026-10-15): Her oturum kendi taze Linux sandbox'ını alır (Ubuntu 24.04, x86_64, ≤8 GB bellek, ≤10 GB disk); oturumlar dosya sistemi durumunu paylaşmaz; ortamlar arşivlenene/silinene kadar kalıcıdır. Kaynak: https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference .

---

## 4. Kimlik doğrulama (auth) yöntemleri tablosu

| Yöntem | Resmî olarak destekleniyor mu? | Son-kullanıcı teknik yükü | Resmî kaynak (doğrulama 2026-10-15) |
|---|---|---|---|
| Kendi Console API anahtarı (BYOK, `sk-ant-api...`; `Authorization: Bearer` veya legacy `x-api-key`) | EVET — destekleniyor | Geliştirici/org admin anahtarı Console'da oluşturur ve saklar; son-kullanıcının adımı YOK (geliştirici için yük). Anahtar süresi dolabilir (3s/1g/7g/30g/özel/Never; dolmuşsa 401). | https://platform.claude.com/docs/en/manage-claude/authentication.md |
| Managed Agents (aynı anahtar + beta header) | EVET — destekleniyor (beta, `managed-agents-2026-04-01`) | Geliştirici API anahtarı ile; tüm API hesaplarında varsayılan açık. | https://platform.claude.com/docs/en/managed-agents/onboarding.md ; https://platform.claude.com/docs/en/managed-agents/overview |
| Uygulama-içi OAuth / "Anthropic hesabını bağla" (son-kullanıcı API faturasını kendisi yetkilendirir, Console anahtarı oluşturmadan) | **NOT_FOUND** (böyle resmî bir ürün/endpoint bulunamadı) | Yok — mevcut değil. Not: llms.txt indeksi ve auth/WIF/App Attest/Vaults sayfaları tarandı; kapsamlı crawl değil. | https://platform.claude.com/docs/en/manage-claude/authentication.md (negatif sonuç) |
| Claude.ai abonelik girişi (Free/Pro/Max) ile 3. taraf uygulamayı çalıştırma | **YASAK** (3. taraflar için desteklenmiyor) | Uygulanamaz. Üçüncü taraflar claude.ai login sunamaz, kullanıcı adına Free/Pro/Max kimlik bilgilerini yönlendiremez, claude.ai kimlik bilgisi/oturum token'ı toplayamaz/saklayamaz/aracılık edemez. | https://code.claude.com/docs/en/legal-and-compliance.md |
| Workload Identity Federation (WIF) (IdP OIDC JWT → kısa ömürlü `sk-ant-oat01-...` service account token) | EVET — destekleniyor (workload/service account için) | YÜKSEK: org admin IdP + Console kaynaklarını (service account, federation issuer, federation rule) kurar. Son-kullanıcı (insan) için uygulanabilirliği UNVERIFIED. | https://platform.claude.com/docs/en/manage-claude/workload-identity-federation.md |
| App Attest (iOS/macOS cihaz token'ı, cihazdan doğrudan API) | EVET ama yalnızca iOS/macOS, DEVELOPER'a faturalanır | Windows masaüstü desteği yok (belgelenmemiş). Fiziksel cihaz gerekir; token Messages API ile sınırlı, 1 saat. | https://platform.claude.com/docs/en/manage-claude/app-attest.md |
| Vaults (Managed Agents — son-kullanıcı başına 3. taraf servis kimlik bilgileri, Anthropic API auth'u DEĞİL) | EVET — destekleniyor (3. taraf creds için; Anthropic faturasını yetkilendirmez) | Uygulama OAuth akışını çalıştırıp token saklar; Claude'a hâlâ geliştiricinin API anahtarıyla kimlik doğrulanır. | https://platform.claude.com/docs/en/managed-agents/vaults.md |
| Cloud sağlayıcı kimlik bilgileri (Bedrock / Google Cloud / Foundry) | EVET — hukuki sayfada son-kullanıcı creds yolu olarak anılıyor | Her son-kullanıcı kendi 3P sağlayıcı kimlik bilgisiyle; sağlayıcı anlaşması altında faturalanır. Mekanik UNVERIFIED (sağlayıcı sayfaları çekilmedi). | https://code.claude.com/docs/en/legal-and-compliance.md |

UASCO için pratik sonuç: Son-kullanıcıya API anahtarı oluşturtmadan, uygulama-içi tek-tık Anthropic-hesap-bağlama RESMÎ bir yol olarak BULUNAMADI (NOT_FOUND). Varsayılan desteklenen yol, geliştiricinin/kullanıcının kendi Console API anahtarıdır (BYOK). Abonelik girişiyle 3. taraf uygulama çalıştırmak YASAK.

---

## 5. Abonelik vs. API ayrımı (yeniden ifade)

Claude ücretli abonelikleri (Pro/Max/Team/Enterprise) ve Anthropic API/Console AYRI ürünlerdir ve AYRI faturalanır.
- "A paid Claude subscription enhances your chat experience, and the Claude API is billed separately." Kaynak: https://support.claude.com/en/articles/9876003 , doğrulama 2026-10-15.
- Max ve Team planları Claude API için aylık kredi içerir (Max 5x 100 USD, Max 20x 200 USD, Team havuzlanmış ≤500 USD). Bu krediler Claude API, Managed Agents, Agent SDK ve playground'u kapsar; Claude Code'u, Claude app'lerindeki ekstra kullanımı veya Bedrock/Google Cloud/Foundry/Claude Platform on AWS'yi KAPSAMAZ. Free, Pro ve Enterprise uygun değildir. Kaynak: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers , doğrulama 2026-10-15.
- Sonuç: Managed Agents, API (Console) faturalamasına ihtiyaç duyar; bir Claude aboneliğine faturalanamaz. (Managed Agents ön koşulu beta header'lı bir Claude API anahtarıdır; abonelik API kullanımını içermez.) Kaynaklar: https://platform.claude.com/docs/en/managed-agents/overview + https://support.claude.com/en/articles/9876003 , doğrulama 2026-10-15. Not: "abonelik kullanılamaz" diye açık bir yasak metni yoktur; bu belgelenmiş bir gereksinimdir (API anahtarı), açık bir yasak değil.

---

## 6. Gelecekteki ISV modeli için ticari kullanım-bazlı faturalama seçenekleri

| Seçenek | Ne anlama gelir | Anthropic anlaşması gerekir mi? | Kaynak (doğrulama 2026-10-15) |
|---|---|---|---|
| (1) BYOK — her son-kullanıcı kendi anahtarı/kimlik bilgisiyle, doğrudan kendisine faturalanır | Müşteriler ürün içinde kendi Anthropic API anahtarı / Claude abonelik kimlik bilgisi / 3P sağlayıcı kimlik bilgisiyle kimlik doğrular; kullanım doğrudan o son-kullanıcıya faturalanır. UASCO kullanımı ödemez/yeniden satmaz/aracılık etmez. | Hayır (belgelenmiş, izin verilen model) | https://code.claude.com/docs/en/legal-and-compliance |
| Müşteri kendi anahtarlarını provision eder (secrets manager/machine image) | Kullanım anahtar sahibine, kendi Anthropic anlaşması altında faturalanır; yeniden satılmaz/aracılık edilmez. | Hayır (izin verilen) | https://code.claude.com/docs/en/legal-and-compliance |
| (2) Merkezî ISV faturalama — UASCO öder, kullanımı kendi müşterilerine ölçer/yeniden satar | Commercial Terms D.4: "Customer may not resell the Services except as expressly approved by Anthropic." Merkezî metering/yeniden satış bir resale sorusudur. | EVET — Anthropic'in yazılı onayı gerekir (sales üzerinden; prosedür belgelenmemiş) | https://www.anthropic.com/legal/commercial-terms (özet-fetch; birebir doğrulanmalı) |
| Agent SDK ürünleri | Commercial Terms'e tabidir. Önceden onaylanmadıkça 3. taraflar claude.ai login veya kendi rate limit'lerini sunamaz. "Powered by Claude"/"Claude Agent" denebilir; "Claude Code" marka adı kullanılamaz. | Abonelik-tabanlı auth/rate-limit için EVET ("unless previously approved") | https://code.claude.com/docs/en/agent-sdk/overview |
| Claude Platform on AWS | Anthropic işletir, AWS Marketplace üzerinden faturalanır; Claude Consumption Units (saatlik), aylık arrears AWS faturası. ISV yeniden satış/müşteriye metering belgelenmemiş. | Reseller/ISV terimleri belgelenmemiş | https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws |
| Bedrock / Google Cloud (partner bulutları) | Bulut sağlayıcı faturalar; Max/Team API kredileri burada geçerli DEĞİL. ISV yeniden satış mekaniği belgelenmemiş. | Belgelenmemiş | https://platform.claude.com/docs/en/about-claude/pricing |
| Claude Marketplace | Kurumlar taahhütlü Anthropic harcamasının bir kısmını Claude-destekli yazılım almak için kullanabilir; ISV'ler ürün listelemek için başvurur. "live today" (23 Eyl 2026 resmî yazısı). | Başvuru/listeleme gerekir; faturalama tarafı/komisyon resmî yazıda belirtilmemiş (UNVERIFIED/CONFLICTING) | https://claude.com/blog/claude-marketplace |
| Enterprise/volume anlaşması | Özel rate limit, hacim indirimi, özel şartlar; sales@anthropic.com veya claude.com/contact-sales. | EVET — ticari anlaşma | https://platform.claude.com/docs/en/about-claude/pricing |

Metering araçları (doğrulama 2026-10-15):
- Workspaces: API kullanımını proje/ortam/ekip bazında ayırır, merkezî faturalama altında; org başına varsayılan ≤100 workspace, per-workspace harcama/rate limit ayarlanabilir. Per-müşteri faturalama DEĞİLDİR. Kaynak: https://platform.claude.com/docs/en/manage-claude/workspaces .
- Console cost/usage raporu model/tarih/API-key/workspace bazında gruplanabilir; "Currently, it's not possible to break down usage or cost by individual users." Kaynak: https://support.claude.com/en/articles/9534590 .
- `metadata.user_id` (Messages API): son-kullanıcı için opak kimlik (≤512 karakter, PII yok); kötüye kullanım tespiti için; faturalama atfı olarak belgelenmemiş. Kaynak: https://platform.claude.com/docs/en/api/messages .

ISV sonucu: Resmî, incelenen dokümanlarda Claude API için bir reseller/distributor/white-label/platform-billing programı BULUNAMADI (NOT_FOUND). Merkezî-faturalama/metering-to-customers modeli Anthropic'in yazılı onayını (Commercial Terms D.4) gerektirir ve benimsenmeden önce hukuki inceleme ister.

---

## 7. UNKNOWNS (açık belirsizlikler — varsayılmadı)

1. Managed Agents için yayımlanmış per-sandbox-saati/per-container oranı YOK; tek zaman ücreti 0,08 USD/oturum-saati; milisaniye ötesi minimum faturalama artışı belirtilmemiş. (NOT_FOUND)
2. Sandbox idle timeout ve otomatik expiry belgelenmemiş; dokümanlar yalnızca "silinene/arşivlenene kadar kalıcı" diyor.
3. Managed Agents harness token ek yükü (sistem istemi + yerleşik araç tanımları) ölçülmemiş; PoC token tahmini varsayımdır.
4. Yeni API kullanıcılarına verilen ücretsiz kredi miktarı ve son kullanım tarihi yayımlanmamış. (NOT_FOUND)
5. Managed Agents için kurumsal/hacim indirimleri kamuya açık değil; tek yol sales.
6. Bedrock/Vertex/Foundry üzerinde Managed Agents davranışı/fiyatı kısmen kapsanmış; oradaki fiyat kontrol edilmedi.
7. Max/Team aylık API kredi miktar ve şartları support.claude.com/en/articles/9876003 üzerinde bulunamadı (ayrı api-credits sayfasında miktarlar var; şart sayfası credit-terms çekilmedi).
8. claude.com/pricing özet-fetch ile okundu, birebir alıntı doğrulanmadı; birincil kaynak platform pricing sayfasıdır.
9. Uygulama-içi OAuth / "Anthropic hesabını bağla" son-kullanıcı akışı için resmî yol BULUNAMADI (negatif sonuç; kapsamlı crawl değil). sales doğrulayabilir.
10. WIF'in insan son-kullanıcıya uygulanabilirliği UNVERIFIED (dokümanlar workload/service account etrafında).
11. App Attest yalnızca iOS/macOS; resmî Windows masaüstü eşdeğeri yok.
12. Commercial Terms (yürürlük 17 Haz 2025) özet-fetch ile okundu; D.4 resale onay mekanizması belgelenmemiş; birebir doğrulama gerekir. Reseller/partner/marketplace programları tam incelenmedi.
13. Claude Marketplace faturalama tarafı/komisyon resmî yazıda yok (UNVERIFIED); availability "live today" vs. limited-preview CONFLICTING.
14. Claude Partner Network ISV/Technology track kriterleri resmî sayfada yok (NOT_FOUND).
15. Managed Agents'ın WIF token'ını doğrudan kabul edip etmediği Managed-Agents yüzeyi için doğrulanmadı (çıkarım).
16. Canlı doğrulama yapılmadı: oturum oluşturulmadı, anahtar kullanılmadı, veri gönderilmedi. Tüm rakamlar 2026-10-15'te çekilen resmî sayfalardan; resmî fiyat sayfası değişebilir.
17. "Bulutta test" ve "canlı önizleme" ayrı ayrı resmî destek doğrulaması bu paketin kapsamı dışında kaldı (ayrı facet). Managed Agents sandbox'ında birim test çalıştırmak code execution/sandbox üzerinden mümkündür; "canlı önizleme" (ör. çalışan web önizlemesi) için resmî destek bu belgede DOĞRULANMADI — UNKNOWN.

---

## 8. Karar notu

Bu belge bir harcama önerisi DEĞİLDİR. Founder aşağıdakilere karar verir: (a) PoC'nin çalıştırılıp çalıştırılmayacağı, (b) sabit üst sınır (öneri: "100" = 1,00 USD), (c) model seçimi (en ucuz: Haiku 5.5), (d) Bölüm 3'teki exact izin kapsamının onayı. Onay olmadan hiçbir oturum oluşturulmaz, hiçbir anahtar bağlanmaz, buluta hiçbir veri gönderilmez.
