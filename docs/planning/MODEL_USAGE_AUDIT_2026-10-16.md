# UASCO — MODEL_USAGE_AUDIT (2026-10-16)

**Kapsam:** Salt-okunur denetim. Hiçbir dosya değiştirilmedi, sistem başlatılmadı, yeni/ücretli model çağrısı yapılmadı. Yeni subagent başlatılmadı; kanıt yalnız mevcut log/journal/config'ten toplandı.
**Kanıt kuralı:** Promptta/katalogda yalnız ADI geçen model GERÇEK kullanım kanıtı sayılmadı (rule 5). Kanıtlanamayan hiçbir maddeye PASS verilmedi.
**İki ayrı bağlam ayrıştırıldı:** (A) UASCO'yu GELİŞTİREN araç (Claude Code oturumu + workflow subagent'ları); (B) UASCO ÜRÜNÜ'nün kendi yapılandırılmış Claude kullanımı (builder/reviewer broker'ları).

---

## 0. Yönetici özeti (kanıt temelli)

- **Ürün hiçbir builder modelini pinlemiyor:** `config/automation.json` → builder `"modelId": "ACCOUNT_DEFAULT_OR_CLI_CONFIG"`. Yani ürün, bağlı Claude hesabının/CLI'nin varsayılan modelini kullanır; repoda sabit model ID yok.
- **Ürün aktif reviewer modeli pinli:** `reviewers.claude.model = "claude-opus-5"` (Anthropic/claude), `fallbackModel: null`. Codex reviewer **RETIRED** (`activeReviewer:false`, GOV2 2026-10-12).
- **Gerçek (bağımsız) runtime kanıtı sınırlı:** workflow journal'larında model ID'leri yalnız `result` yük içinde (ajanların KENDİ bildirdiği alan + ortam-kataloğu yankısı) geçiyor; harness düzeyinde "bu ajan şu modelde koştu" alanı YOK. Rule 5 gereği bunları runtime KANITI saymıyorum.
- **Dört modelin sınıflandırması:** Opus-sınıfı ve Sonnet-sınıfı modeller geliştirmede fiilen ÇALIŞTIRILDI (paketler gerçek üretimle CLEAN bitti); **Haiku 5.5 ve Fable 5.1 hiç yönlendirilmedi/kullanılmadı**. Hiçbir modelin EXACT 5-aile ID'si bağımsız logla kanıtlanamıyor.
- **Maliyet:** Harici haftalık hesap kotası ölçeri ve model-başı maliyet buradan OKUNAMIYOR → maliyet ÖLÇÜLMEDİ (uydurulmadı).

---

## 1. Model sınıflandırması (CONFIGURED / PROVEN-USED / AVAILABLE-UNUSED / ACCESS-UNVERIFIED)

| Model | Ortamda beyan | Üründe yapılandırma | Geliştirmede fiili kullanım kanıtı | Sınıf | Son kullanım kanıtı |
|---|---|---|---|---|---|
| **Opus** (kat. `claude-opus-5-5`; oturum `claude-opus-4-8`; ürün reviewer `claude-opus-5`) | EVET (katalog + bu oturum "Opus 4.8" beyan) | Reviewer PIN=`claude-opus-5`; builder=ACCOUNT_DEFAULT | **Opus-sınıfı fiilen çalıştı**: bu orkestratör oturumu + `model:'opus'` subagent'ları onlarca paketi gerçek üretimle CLEAN bitirdi | **PROVEN-USED (opus-sınıfı)** — exact ID bağımsız kanıtlı DEĞİL | Bugün (16 Eki) sürekli; en son CORE-6/CORE-7/WP-* paketleri |
| **Sonnet 5.5** (`claude-sonnet-5-5`) | EVET | Pin YOK (builder account-default olabilir) | **Sonnet-sınıfı fiilen çalıştı**: `model:'sonnet'` subagent'ları (252-audit eşleyicileri, WP-PROJECTS eşleyicileri) gerçek çıktı üretti; self-report `claude-sonnet-5-5` | **PROVEN-USED (sonnet-sınıfı)** — exact ID yalnız self-report | 252-audit + WP eşleyicileri (16 Eki) |
| **Haiku 5.5** (`claude-haiku-5-5`) | EVET | Pin YOK | Hiçbir workflow'da `haiku` yönlendirilmedi; journal'da yalnız 2 yankı (prompt-mention) | **AVAILABLE-DECLARED, UNUSED** · erişim UNVERIFIED | Kullanım kanıtı YOK |
| **Fable 5.1** (`claude-fable-5-1`) | EVET | Pin YOK | Hiçbir yerde yok (journal'da 0 kez); hiç yönlendirilmedi | **AVAILABLE-DECLARED, UNUSED** · erişim UNVERIFIED | Kullanım kanıtı YOK |

**Not (ortam tutarsızlığı, dürüst gözlem):** Ortam kataloğu en güncel olarak Claude 5 ailesini (`...5-5`, `fable-5-1`) listeliyor, AMA bu oturumun beyan edilen modeli `claude-opus-4-8`. Journal'daki `claude-opus-5-5` yalnız katalog-yankısı olarak görünüyor (her journal'da tekrar) → runtime kanıtı DEĞİL. Bu yüzden "Opus tam olarak 5-5 mi 4-8 mi koştu" bağımsız olarak KANITLANAMIYOR; yalnız "opus-sınıfı bir model fiilen çalıştı" kanıtlı.

---

## 2. Runtime kanıtının niteliği (rule 5 titizliği)

- 80 workflow journal'ı tarandı (515 satır). Model ID'leri **yalnız `type:"result"` satırlarının içinde** bulundu; **harness düzeyinde top-level `model` alanı YOK**.
- `result` içindeki ID'ler iki kaynaktan: (a) ajanın yapı­landırılmış çıktısında KENDİ bildirdiği `model` alanı; (b) ajanın sistem-promptundaki ortam-kataloğunun metne yansıması. İkisi de rule 5 gereği **bağımsız runtime kanıtı sayılmaz**.
- **Fiili kullanım için kabul edilen kanıt:** (i) benim workflow dispatch'im (`model:'opus'/'sonnet'` — gerçek istek) + (ii) paketin gerçek kod/test üretimiyle CLEAN tamamlanması (bir modelin fiilen çalıştığının dolaylı ama somut kanıtı). Bu, "opus-sınıfı" ve "sonnet-sınıfı" kullanımını kanıtlar; EXACT 5-aile build string'ini kanıtlamaz.

---

## 3. Otomatik yönlendirme / subagent / paralel / fallback / kota / maliyet mekanizmaları

**Yapılandırılmış (kanıt: repo config):**
- **OmniRoute gateway** — `config/omniroute-policy.json`: yerel gateway `http://127.0.0.1:20128/v1`, identity/license/integrity ile exact-version pinli kurulum, yalnız 127.0.0.1/localhost/::1 host'ları, redirect=ERROR, timeout 10s. (Kurulu/aktif-yönlendiriyor mu — bağımsız runtime kanıtı YOK; T3 uyumluluk testi geçmişte vardı.)
- **Execution-backends** — `config/execution-backends.json`: modlar AUTO/LOCAL_ONLY/CLOUD_PREFERRED/CLOUD_ONLY; backend'ler LOCAL_CLAUDE + CLAUDE_CLOUD_SESSION; fail-closed (`unknownAvailabilityIsUnavailable:true`, sınıflandırılmamış görev LOCAL_ONLY); host'a bağlı işler LOCAL_ONLY; **"belgelenmiş dispatch yöntemi yapılandırılmadan cloud yürütmesi taklit edilmez"** → CLAUDE_CLOUD_SESSION fiilen UNAVAILABLE, etkin backend LOCAL_CLAUDE. cloudToLocal fallback tanımlı.
- **Kota/maliyet/retry** — `automation/lib/context-budget.mjs`, `retry-authority.mjs`, `failure-classifier.mjs`, `config/orchestrator-policy.json`: bağlam bütçesi, sınırlı retry/backoff, kota/limit sınıflandırma mekanizmaları MEVCUT.
- **GELİŞTİRME orkestrasyonu** (benim workflow'larım) ürünün OmniRoute/execution-backends yönlendirmesini KULLANMIYOR; Workflow aracının kendi model dispatch'ini (`model:'opus'/'sonnet'`, paralel pipeline/parallel) kullanıyor. Yani ürünün yönlendirme/fallback/kota politikası YAPILANDIRILMIŞ ama geliştirme akışımda EGZERSİZ EDİLMEDİ.

**Maliyet:** model-başı maliyet ve harici haftalık kota ölçeri bu ortamdan okunamıyor → **NOT-MEASURABLE** (uydurulmadı). Workflow'lar subagent_token toplamı raporluyor (~300–420k/paket) ama model-başı maliyet/kota değil.

---

## 4. Implementer ↔ Independent Reviewer izolasyonu (rule 4; Codex yok)

**Geliştirmede (kanıtlı):** her paket ayrı CLAUDE_BUILDER implementer + ayrı CLAUDE_REVIEWER reviewer; ayrı klon, reviewer salt-okunur, "independence" alanı her review'da ("kodu yazmadım; kendi klonum; ağ yok"). **Hiçbir geliştirme review'ında Codex kullanılmadı.** ✓

**Üründe (kanıt: `v2-masterint @ b19a7ef` config/automation.json):**
- builder: `CLAUDE_BUILDER`, ANTHROPIC/claude, broker `claude-builder-broker.mjs`, sandbox `builder-execution-policy.json` (yalnız Read/Edit/Write/Glob/Grep; shell/web/MCP kapalı; `requireBoundarySmoke`).
- aktif reviewer: `reviewers.claude` = `CLAUDE_REVIEWER`, ANTHROPIC/claude, broker `claude-reviewer-broker.mjs`, model `claude-opus-5`, separation `PROCESS_SESSION_CONTEXT_AND_WORKTREE_SEPARATED_FROM_CLAUDE_BUILDER`, auth `CURRENTLY_AUTHENTICATED_CLAUDE_CODE_NO_API_KEY`.
- Codex: `RETIRED_HISTORICAL_ONLY`, `activeReviewer:false` (GOV2). codex-reviewer-broker.mjs diskte mevcut ama etkin DEĞİL.

**BULGU (governance divergence, PASS DEĞİL):** Şu an checkout'lu kanonik branch **`v6/pkg-t4 @ 217d429`** GOV2 ÖNCESİdir: orada `automation.json` reviewer'ı hâlâ **AKTİF Codex** (provider OPENAI, underlyingTool codex, review-pipeline.mjs codex-reviewer-broker'ı referanslıyor). Yani kanonik checkout, GOV2 (Claude-only) ve Founder rule-4 ile ÇELİŞİYOR çünkü GOV2 bu branch'e merge edilmemiş. Ürün teslim hattı (`b19a7ef`) GOV2-uyumlu; kanonik master hattı değil. **Öneri (bu denetimde uygulanmadı — salt rapor):** GOV2 Claude-only reviewer sözleşmesini kanonik hatta birleştirmek / `v6/pkg-t4`'ü etkin reviewer olarak kullanmamak.

---

## 5. Eksik modeller neden kullanılmıyor (dürüst teşhis)

- **Haiku 5.5 / Fable 5.1:** teknik erişim engeli KANITLANMADI; sebep **yönlendirme/dispatch tercihi** — geliştirme akışımda kaliteli muhakeme için `opus`, toplu/mekanik eşleme için `sonnet` yönlendirdim; `haiku`/`fable`'a hiç iş yönlendirilmedi ve ürün bunları pinlemiyor. Dolayısıyla "kullanılmıyor" = yapılandırma/yönlendirme seçimi, abonelik/erişim arızası DEĞİL — ama **erişim de kanıtlanmadı** (hiç denenmedi) → erişim: UNVERIFIED (ne PASS ne FAIL).
- **Opus 5.5 exact ID:** ortam oturumu 4.8 beyan ederken katalog 5.5 listeliyor; hangi exact build'in koştuğu bağımsız logla ayırt edilemiyor → exact-ID: UNVERIFIED (opus-sınıfı kullanım ise PROVEN).
- **Ürün canlı builder/reviewer (claude-opus-5):** CONFIGURED; ancak canlı ürün-review'ı fiilen çalıştırılmadı (geliştirme review'ları benim workflow Claude reviewer'larımla yapıldı) → ürün-reviewer-modeli: CONFIGURED, PROVEN-EXECUTED DEĞİL.

---

## 6. Son kullanım kanıtı + maliyet (model-başı)

| Model | Son kullanım kanıtı | Maliyet |
|---|---|---|
| Opus-sınıfı | 2026-10-16, süregelen; en son CORE-6/CORE-7/WP-SHELL-REFINE/WP-ACADEMY implementer+reviewer ajanları (workflow journal'ları, CLEAN sonuçlar) | NOT-MEASURABLE (model-başı maliyet/kota ölçeri okunamıyor) |
| Sonnet-sınıfı | 2026-10-16, 252-audit + WP-PROJECTS/WP-WORKOS eşleyici subagent'ları | NOT-MEASURABLE |
| Haiku 5.5 | YOK | — |
| Fable 5.1 | YOK | — |

---

## 7. Sonuç (kanıtsız PASS verilmedi)

- **PROVEN-USED:** opus-sınıfı + sonnet-sınıfı (geliştirme araç katmanı). Exact 5-aile build string'i bağımsız kanıtlı DEĞİL.
- **CONFIGURED (ürün):** builder=ACCOUNT_DEFAULT (claude); aktif reviewer=CLAUDE_REVIEWER model `claude-opus-5`; OmniRoute + execution-backends + context-budget + retry-authority yönlendirme/kota mekanizmaları.
- **AVAILABLE-DECLARED, UNUSED:** Haiku 5.5, Fable 5.1 (erişim UNVERIFIED).
- **NO-ACCESS:** hiçbir model için "erişim yok" KANITLANMADI (dolayısıyla bu sınıfa kesin atama yapılmadı).
- **İzolasyon + Codex:** geliştirmede implementer≠reviewer izolasyonu ve Codex-yokluğu KANITLI; ürün hattı (b19a7ef) GOV2 Claude-only; **kanonik `v6/pkg-t4` checkout'u hâlâ Codex-aktif (açık governance bulgusu).**
- **Maliyet:** NOT-MEASURABLE (uydurulmadı).

**Verimlilik tavsiyesi (yalnız rapor, uygulanmadı):** uygun görevlerde bulk/mekanik işleri `sonnet`/`haiku`'ya, derin muhakemeyi `opus`'a yönlendiren açık bir dispatch politikası netleştirilebilir; ancak gereksiz model çağrısı yaratmadan. Haiku/Fable'a iş yönlendirmeden önce erişim küçük, tek seferlik bir probe ile doğrulanabilir (Founder onayıyla, ücret oluşturmadan mümkünse).
