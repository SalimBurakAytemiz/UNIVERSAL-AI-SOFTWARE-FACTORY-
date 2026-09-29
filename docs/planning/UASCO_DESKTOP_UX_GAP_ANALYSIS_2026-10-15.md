# UASCO Desktop UX Fark Analizi ve Premium Hedef Planı

- Tarih: 2026-10-15
- Kapsam: SALT OKUNUR denetim + planlama (bu görevde KOD DEĞİŞİKLİĞİ YOK)
- Denetlenen renderer: `C:/Users/salim/UASCO-wt/v2-m1a/apps/desktop/renderer` @ commit `2176741` (denetim oturumunda HEAD olarak doğrulandı)
- Not: Aktif v6 worktree'nin HEAD'i `217d429` (farklı dal/worktree). Bu rapor, denetim oturumunda okunan v2-m1a renderer dosyalarını referans alır.
- Hedef görünüm kaynağı: tasarım referans görseli (1.webp) YALNIZCA yapısal olarak okundu. Referanstaki tüm örnek veriler (Alex Chen, Healthcare Platform, 12 proje, 47 ajan, %96.8, zaman çizelgesi olayları) MOCKUP'tır ve asla gerçek veri olarak üretilmeyecektir.
- Veri dürüstlüğü ilkesi: Gerçek API verisi yoksa doğru durumlar EMPTY / UNAVAILABLE / NOT_CONNECTED / STALE / DOGRULANMADI'dır. SAHTE/CANLI görünümlü demo veri YASAK.
- Sınır: İkinci UASCO uygulaması / ikinci repo / paralel veri otoritesi YOK. Çalışan Work OS, Trust Kernel, Project Memory, Claude bağlantısı, QA ve Delivery sözleşmeleri KORUNUR. Uygulama yeniden yazılmaz.

---

## Yönetici Özeti (TL;DR)

Onaylı tasarım (UX-DEC-001..071) %100 onaylıdır; ancak uygulama/entegrasyon/test ÖLÇÜLMEMİŞTİR (UX-DEC-060 dürüstlük notu). Denetim, operasyonel omurganın gerçekten bağlı ve dürüst olduğunu, premium görsel dilin ve ~40 kurumsal/Company-OS/journey ekranının ise asıl açık olduğunu gösterir.

- Omurga SAĞLAM ve DÜRÜST (bağlı, uydurma veri yok): Founder Cockpit KPI'ları, Fabrika Haritası, Projeler/Project Studio, Görevler/Work OS, Güvence QA Evidence, Gelen Kutusu/Onaylar, ACİL DURDUR, Aktivite paneli, Ayarlar/Yürütücüler, Global arama (Ctrl+K), Proje Switcher. Veri dürüstlüğü model katmanında (`model.js classifyFailure`) zorlanıyor; renderer'da hiçbir uydurma/hardcoded canlı veri bulunmadı.
- EN YÜKSEK DEĞERLİ AÇIK (backend var, renderer tüketmiyor):
  1. Company OS: backend B11A (CRM/Finance/Legal) `control-api server.ts:458-535` tamamen uygulanmış; renderer B7 "planlı" stub gösteriyor.
  2. 599-rol kataloğu gezinme: backend `/v1/roles` (`server.ts:541-566`) var; renderer workforce yalnızca sayıları gösteriyor.
- Control Tower: route eski Day-0 düz görünümü (`tower.js`) render ediyor; premium 2D kampüs modülü (`control-tower/`) VAR ama README'ye göre shell'e BAĞLI DEĞİL; 3D/GPU-fallback hiç YOK.
- Inspector ve Command Center referans UX'teki ayrı yüzeyler olarak kurulmamış.
- Teslimat&SRE üst ekranı B6 placeholder (teslim paketleme Project Studio içinde çalışıyor).

Kaba kapsama (71 karar): ~13 IMPLEMENTED, ~18 PARTIAL, ~13 PLACEHOLDER, ~27 NOT_IMPLEMENTED. Tasarım onaylı; uygulama ölçülmedi.

---

## A) Fark Analizi — Gerçek Desktop vs Onaylı UX (UX-DEC-001..071 kapsama özeti)

Durum etiketleri: IMPLEMENTED (renderer'da bağlı, işlevsel, dürüst) / PARTIAL (kısmi) / PLACEHOLDER (dürüst "planlı" stub) / NOT_IMPLEMENTED (renderer'da yok) / NOT_VERIFIED (onaylı ama ölçülmemiş). Not: tüm UX-DEC öğeleri target-design facet'inde NOT_VERIFIED'dir; aşağıdaki durum, impl-status kanıtına göre renderer gerçekliğidir.

| UX-DEC | Ad | Renderer durumu | Kanonik paket | Kanıt / Not |
|---|---|---|---|---|
| 001 | Açılış ve Founder Cockpit | IMPLEMENTED | cockpit | home.js:56-62; sadece ctx.api.cockpit(); premium polish eksik |
| 002 | İsteğe bağlı onboarding + güvenli demo | NOT_IMPLEMENTED | cockpit/Onboarding | renderer'da onboarding overlay yok |
| 003 | Bağlama dayalı rehberlik | PARTIAL | cockpit/Kurucu Gündemi | activity rail "Kurucu Gündemi" sekmesi var; inline rehber kartları yok |
| 004 | Kanıtlı KPI/durum göstergeleri | IMPLEMENTED | cockpit/KPI | components.js:25-37; VERIFIED/STALE dışı '—'; drill-down sığ |
| 005 | Kurucuya özel KPI önceliklendirme | IMPLEMENTED | cockpit/KPI | 4 KPI + workforce ikilisi; özelleştirme yok |
| 006 | Dev→QA→Security→Claude→Release zinciri | PARTIAL | Missions/Assurance/Delivery | kapılar ayrı ekranlarda var; birleşik zincir görseli yok |
| 007 | Sesli kurucu komutu + güvenli taslak | NOT_IMPLEMENTED | Founder Command/Voice | ses arayüzü yok |
| 008 | Uzakta geçen süre + dönüş özeti | IMPLEMENTED | cockpit/Activity Rail | shell.js feed/strip; PAUSED_OFFLINE dürüstlüğü |
| 009 | Business Analysis (dev öncesi) | NOT_IMPLEMENTED | Project Journey/BA | BA workspace yok |
| 010 | BA sunum katmanları | NOT_IMPLEMENTED | Project Journey/BA | yok |
| 011 | Toplu gereksinim revizyon stüdyosu | NOT_IMPLEMENTED | Requirements Studio | yok |
| 012 | BA onayı + gereksinim dondurma | NOT_IMPLEMENTED | Requirements Freeze | yok |
| 013 | Plan Studio / yol haritası / sprint / maliyet | NOT_IMPLEMENTED | Plan Studio | yok |
| 014 | Kontrollü yeniden planlama | NOT_IMPLEMENTED | Plan Studio | yok |
| 015 | Onaylı kapsamda otonom development | IMPLEMENTED | Missions/Work OS | work.js; scope/araç limitleri görünür |
| 016 | AI ekiplerinin canlı görev görünümü | PARTIAL | AI Workforce/Agent Fleet | workforce.js; sayı var, canlı fleet derinliği yok |
| 017 | Task Inspector + kanıt inceleme | NOT_IMPLEMENTED | Missions/Task Inspector | docked Inspector yok; detay inline |
| 018 | P0-P3 hata yönetimi + bounded recovery | PARTIAL | Assurance/Defects | R0-R4 legend work.js'te; defect yüzeyi yok |
| 019 | Öncelikli/tekrarsız bildirim merkezi | IMPLEMENTED | Inbox/Decisions | inbox.js; auto-approve yok |
| 020 | Kapsama bağlı Founder Approval | IMPLEMENTED | Decision/Founder Approval | inbox approvals; state ayrımı |
| 021 | Work OS + ops. Jira/Trello | IMPLEMENTED | Missions/Work OS | board/backlog/kanban; harici bağlantı opsiyonel |
| 022 | Governed AI Scrum Master | NOT_IMPLEMENTED | Missions/Work OS | yok |
| 023 | Product Discovery + pazar araştırması | NOT_IMPLEMENTED | Project Journey/Discovery | yok |
| 024 | MVP seçenekleri + kurucu seçimi | NOT_IMPLEMENTED | MVP Studio | yok |
| 025 | UX Prototype Studio | NOT_IMPLEMENTED | UX Prototype Studio | yok |
| 026 | Tasarım-kod piksel/davranış tutarlılığı | NOT_IMPLEMENTED | Assurance/Visual Regression | yok |
| 027 | QA Evidence Center | IMPLEMENTED | Assurance/QA Evidence | assurance.js:59-70; verification chip'leri dürüst |
| 028 | Sanal cihaz + bulut test altyapısı | NOT_IMPLEMENTED | Assurance/Device Lab | yok |
| 029 | Canlı sanal cihaz oturumu | NOT_IMPLEMENTED | Assurance/Device Lab | yok |
| 030 | Security scanning + incident | PARTIAL | Assurance/Security SOC | güvenlik yalnızca evidence verification sayımı |
| 031 | Security remediation + Claude review | PARTIAL | Assurance/Claude Review | kayıtlar var; ayrı read-only review yüzeyi yok |
| 032 | Yetkili geçmiş konuşma aktarımı | NOT_IMPLEMENTED | Knowledge/Conversation Import | yok |
| 033 | Corporate Project Memory + bilgi grafiği | NOT_IMPLEMENTED | Knowledge/Project Memory | renderer yüzeyi yok (backend UNKNOWN) |
| 034 | Agent Decision Trace + Evidence/Audit | NOT_IMPLEMENTED | Evidence & Audit | evidence center kısmen; decision trace yok |
| 035 | Agent Permission Center | NOT_IMPLEMENTED | Trust Kernel/Permission Center | effective-permission inspector yok |
| 036 | FinOps (token/compute gider) | NOT_IMPLEMENTED | Company OS/FinOps | renderer yüzeyi yok |
| 037 | Provider Hub + AI bağlantıları | PARTIAL | Trust Kernel/Provider Hub | executors-panel yürütücü/sağlık durumu gösteriyor; tam hub yok |
| 038 | Release & Delivery | PARTIAL | Delivery/Release Control | teslim akışı studio içinde çalışıyor; üst ekran B6 placeholder |
| 039 | SRE gözlemleme/incident/toparlanma | PLACEHOLDER | Delivery/SRE | routes.js:9 planned B6 |
| 040 | Experience & Self-Learning | NOT_IMPLEMENTED | Experience/Self-Learning | yok |
| 041 | AI Workforce rol kataloğu + gerçek worker | PARTIAL | AI Workforce/Command Center | 4 katman ayrımı kısmi; katalog gezinme yok |
| 042 | Departmanlar arası Handoff Center | NOT_IMPLEMENTED | Missions/Handoff Center | yok |
| 043 | Workflow Continuity + checkpoint/reconcile | NOT_IMPLEMENTED | Autonomous Op & Recovery | run resume kısmen; ayrı continuity yüzeyi yok |
| 044 | Company Portfolio + çok ürün | IMPLEMENTED | Projects/Portfolio | projects.js + project-switcher; zengin switcher yok |
| 045 | Product Commercialization/lisans/satış | PLACEHOLDER | Company OS/Commercialization | company stub (B7) |
| 046 | Brand/Website/SEO/Marketing | NOT_IMPLEMENTED | Company OS/Marketing | yok |
| 047 | Intelligent CRM + satış hunisi | PLACEHOLDER | Company OS/CRM | backend var (server.ts:458-483), renderer stub |
| 048 | Customer Success/Support/SLA | PLACEHOLDER | Company OS/Customer Success | company stub |
| 049 | Company Finance/Billing/Revenue | PLACEHOLDER | Company OS/Finance | backend var (server.ts:485-513), renderer stub |
| 050 | Corporate Legal/Compliance/Contracts | PLACEHOLDER | Company OS/Legal | backend var (server.ts:515-535), renderer stub |
| 051 | Vendor/Procurement/Subscription | PLACEHOLDER | Company OS/Procurement | company stub (backend UNKNOWN) |
| 052 | Corporate Strategy/OKR/Investment | PLACEHOLDER | Company OS/Strategy & OKR | company stub |
| 053 | People Operations/Talent | PLACEHOLDER | Company OS/People Operations | company stub |
| 054 | Corporate Communications/Email/Calendar | PLACEHOLDER | Company OS/Communications | company stub |
| 055 | Enterprise Document/Records/Assets | PLACEHOLDER | Company OS/Document Center | company stub |
| 056 | Enterprise Backup/DR/Continuity | PLACEHOLDER | Company OS/Backup & Recovery | company stub |
| 057 | Universal Installer/Env Doctor | PARTIAL | System/Installer & Env Doctor | tower install facts + executors; staged wizard yok |
| 058 | Global Language/Voice/A11y | PARTIAL | Global Experience Center | settings TR/EN + reduce-motion; ses/dil merkezi yok |
| 059 | Unified Desktop + E2E + kabul | IMPLEMENTED (çekirdek) | Unified Desktop Shell | tek shell + Ctrl+K; command center/E2E journey eksik |
| 060 | Scope Freeze/Master Spec/Traceability | NOT_IMPLEMENTED | Governance/Master Spec | governance view yok |
| 061 | Desktop IA: 8 Factory + Company OS | IMPLEMENTED | Unified Desktop/IA | home.js:29-44; nav + context bar var, Company OS stub |
| 062 | AI Workforce/Guild/Runtime Command Center | PARTIAL | AI Workforce/Command Center | 4 view/10-tab inspector yok |
| 063 | Project Journey/Mission/Dependency Graph | IMPLEMENTED (kısmi) | Project Journey/Mission CC | List/Kanban var; DAG/Timeline projeksiyonları eksik |
| 064 | Enterprise Company OS Workspaces | PLACEHOLDER | Company OS | backend var, renderer stub (en yüksek değerli açık) |
| 065 | Unified Trust Kernel/Approval Control | PARTIAL | Trust Kernel/Trust Center | ACİL DURDUR + approval var; birleşik Trust Center yok |
| 066 | Installer/Env/Topology/Recovery CC | PARTIAL | System/Operations CC | tower Day-0 facts; birleşik ops merkezi yok |
| 067 | Unified 2D/3D Campus/Control Tower | PARTIAL | Control Tower/Visual CC | legacy flat view; 2D modülü BAĞLI DEĞİL; 3D YOK |
| 068 | Unified QA/Security/Review/Release CC | PARTIAL | Assurance/Release Assurance CC | QA bağlı; birleşik komut merkezi yok |
| 069 | Global Experience/Language/Voice/A11y CC | PARTIAL | Global Experience Center | settings kısmi |
| 070 | Unified Knowledge/Memory/Provenance | NOT_IMPLEMENTED | Knowledge Center | yok |
| 071 | Birleşik Otonom Operasyon ve Kurtarma | PARTIAL | Autonomous Op & Recovery CC | AUT1 kontrol düzlemi backend; renderer tower kısmi |

Kapsama özeti: IMPLEMENTED ~13, PARTIAL ~18, PLACEHOLDER ~13, NOT_IMPLEMENTED ~27 (toplam 71).

---

## B) Eksik + Kısmi Ekranların Listesi (ekran -> durum -> eksik -> kanonik paket)

Öncelik sırasıyla değer/çaba dengesine göre (yüksek değerli, backend'i hazır olanlar önce):

1. Company OS (`company` route) -> PLACEHOLDER (B7 stub) -> MAJOR: backend B11A (CRM/Finance/Legal) tam, renderer tüketmiyor; 5 iş grubu + domain ekran sözleşmesi (Overview->Records->Inspector->Workflow->Approvals->Evidence) eksik -> **B11A**
2. AI İş Gücü / Agent Fleet (`workforce`) -> PARTIAL -> 599-rol katalog gezinme (`/v1/roles` backend var), Guild/cluster navigasyon, 4 fleet view (Grid/Table/Guild-Tree/Operations), 10-tab Inspector eksik -> **WFR-03 / B3**
3. Control Tower (`tower`) -> PARTIAL (legacy Day-0) -> premium 2D kampüs modülü BAĞLI DEĞİL; 3D + GPU/2D-fallback YOK; catalog beslemesi bağlı değil -> **B6A**
4. Control Tower 2D kampüs -> NOT_IMPLEMENTED (modül var, unwired) -> `control-tower/` import+mount + erişilebilir liste fallback + catalog data contract beslemesi -> **B6A**
5. Control Tower 3D (GPU) -> NOT_IMPLEMENTED -> WebGL/3D sahne + GPU algılama + 2D fallback anahtarı -> **B6A**
6. Inspector (sağ-docked bağlamsal detay) -> NOT_IMPLEMENTED -> seçili varlık için kapsamlı sekmeli Inspector (EMPTY/DENIED/STALE) -> **B6A**
7. Teslimat & SRE üst ekranı (`delivery`) -> PLACEHOLDER (B6) -> üst düzey Release & SRE dashboard; SRE boyutu tamamen yok -> **B6**
8. Güvenlik SOC (Assurance) -> PARTIAL -> ayrı güvenlik tarama/incident yüzeyi yok; sadece evidence verification sayımı -> **B4**
9. Claude Independent Review yüzeyi -> PARTIAL -> ayrı read-only review kayıt yüzeyi (commit/diff/finding) -> **B4 (Claude review)**
10. Command Center (Ctrl+K konsolu) -> NOT_IMPLEMENTED -> birleşik komut paleti + hızlı aksiyonlar; şu an sadece nav araması -> **B6A**
11. Task Inspector -> NOT_IMPLEMENTED -> Requirements/Runs/Logs/Checkpoints/Git/QA/Security/Claude/Cost/Audit sekmeleri -> **Missions**
12. Business Analysis / Plan Studio / Requirements Studio+Freeze -> NOT_IMPLEMENTED -> Project Journey pre-dev ekranları -> **Project Journey**
13. Product Discovery / MVP Studio / UX Prototype Studio -> NOT_IMPLEMENTED -> keşif/MVP/prototip ekranları -> **Project Journey**
14. Device Lab + canlı cihaz oturumu + Visual Regression -> NOT_IMPLEMENTED -> **Assurance (Device Lab / Visual Regression)**
15. Knowledge Center (Project Memory, graph, Conversation Import, provenance) -> NOT_IMPLEMENTED -> **Knowledge Center**
16. Trust Center (Identity/Permission/Provider/Secrets birleşik) -> PARTIAL -> **Trust Kernel**
17. Permission Center / Effective Permissions Inspector -> NOT_IMPLEMENTED -> **Trust Kernel**
18. FinOps -> NOT_IMPLEMENTED -> **Company OS/FinOps**
19. Provider Hub -> PARTIAL (executors-panel) -> **Trust Kernel/Provider Hub**
20. Installer / Environment Doctor / System Operations CC -> PARTIAL -> **System**
21. Global Experience Center (dil kategorileri + Language Lock + ses onayı + a11y) -> PARTIAL -> **Global Experience**
22. Handoff Center / Workflow Continuity / Self-Learning / Scrum Master -> NOT_IMPLEMENTED -> **Missions / Autonomous Op / Experience**
23. Governance / Master Spec / Traceability -> NOT_IMPLEMENTED -> **Governance**
24. Premium neon görsel dil (navy/cyan) -> PARTIAL -> tasarım token derinliği (type/spacing/elevation/radius scale, gauge, premium KPI) eksik -> **cockpit / design-system**

---

## C) Founder Cockpit'i Premium Hedefe Taşıma İşleri (gerçek veri + neon görsel, SAHTE VERİ YOK)

Cockpit yapısal olarak onaylı STRUCTURE ile eşleşiyor ve dürüstçe UNAVAILABLE/DOGRULANMADI. Hedef delta SADECE: (a) premium neon-navy görsel cilası, (b) backend varsa gerçek-veri bağlama, (c) derinlik (Control Tower 2D/3D, Company OS, Inspector, Command Center, Project Switcher).

### C.1 Tasarım sistemi token derinleştirme (design-system faceti)
Mevcut: tek `styles.css` + tek `:root` (DS-04 IMPLEMENTED), deep-navy palet (DS-01), neon cyan glow (DS-02), semantik durum renkleri (DS-03) VAR. Eksik olanlar genişletilecek (YENİDEN YAZILMAYACAK):
- DS-06 Typografik ölçek token'ları (--fs-*): şu an ~30 hardcoded rem literal. Ekle: display/h1/h2/body/caption/mono + line-height/weight token'ları.
- DS-07 Spacing ölçeği (--space-1..8): 4/8px ritim token'ları; literal paddingleri refactor.
- DS-08 Radius ölçeği (--radius-xs/sm/md/lg/pill): şu an tek token + ~8 ad hoc değer.
- DS-09 Elevation/shadow token'ları (--elev-rest/raised/overlay): ambient drop shadow + neon rim; ~10 dağınık glow literalini değiştir.
- DS-05 Inter fontu: adlandırılmış ama bundle/@font-face yok; CSP img/style 'self' uzak fontu bloke ediyor -> Inter'i yerel bundle et (premium görünüm aslında teslim edilmiyor).
- DS-02 tiered glow + per-state (ok/warn/danger) glow token'ları.

### C.2 KPI kartları premium (UX-DEC-004/005)
- Mevcut `kpiTile` (components.js:25-37) icon chip + tabular-nums değer + state chip + hint + sparkline; VERIFIED/STALE dışı '—'. KORU.
- Ekle: imzalı delta (↑/↓ renkli), premium gauge/radial component (DS-11, accessible SVG: role=img + aria-label + numeric fallback, reduce-motion/forced-colors), hero stat varyantı, hover'da açıklanabilir hesaplama -> Inspector drill-down.
- KRİTİK: tüm değerler yalnızca `ctx.api.cockpit()` kaynağından; kaynak yoksa em-dash/UNAVAILABLE. Referans mockup sayıları (12/47/%96.8) ASLA gösterilmez. `mapCockpit` (model.js:44-62) + `emptyCockpit` korunur.

### C.3 Gerçek-veri bağlama (backend hazır olan yerlerde)
- Company OS: `/v1/company` CRM/Finance/Legal rotalarını (server.ts:458-535) tüket -> en yüksek değerli bağlama.
- Workforce: `/v1/roles` (server.ts:541-566) paginated katalog + rol detay bağla.
- Activity rail: `/v1/runs` son olayları (zaten bağlı) + PAUSED_OFFLINE/HOST_UNAVAILABLE dürüstlüğü korunur.

### C.4 Dürüstlük invariantı (değiştirilemez)
`model.js classifyFailure` (404/501->UNAVAILABLE, ECONNREFUSED/BRIDGE->OFFLINE), `app.js` createElement/textContent-only (innerHTML yok), tek data gate `api.js` preload bridge. Premium cila bu invariantı DELMEZ. Verified/estimated/demo/unknown/stale görsel olarak AYRI render; drill-down kaynak event/test zorunlu.

---

## D) 2D/3D Control Tower Entegrasyon Planı (GPU yoksa erişilebilir 2D fallback)

Mevcut durum:
- `tower` route eski Day-0 düz görünümü render ediyor (`tower.js:6-41`): health/phase0/install/scheduler/registry + Global Stop/Resume + attention + run/event/log.
- Premium 2D kampüs modülü VAR ama UNWIRED: `apps/desktop/renderer/control-tower/render-svg.js` (navy/cyan neon palet, bg0 #07142c, cyan #22d3ee), `model.js buildCampusModel`, `list-view.js` erişilebilir tablo. README: "not wired into the shell yet". Hiçbir view/app/routes `control-tower/` import etmiyor.
- 3D/WebGL/three.js KODU YOK; GPU algılama/2D-fallback anahtarı YOK.

Entegrasyon planı (B6A, 3 aşama):

**D.1 2D kampüs bağlama (öncelik, bağımsız değer):**
- `control-tower/` modülünü `tower` route'una (veya yeni `control-tower` route) import+mount.
- Her guild için bina (Geliştirme/QA&Test Lab/Güvenlik SOC/Ürün&Araştırma/Veri Platformu/Müşteri&CRM/Finans&Operasyon/Yayın&SRE), merkezi network küresi, neon light-trail, per-building agent·task rozetleri.
- Erişilebilir liste fallback (`list-view.js`) her zaman mevcut; keyboard/screenreader; reduce-motion farkında.
- Data contract: README'de tanımlı `cockpit.globalStop` + catalog clusters/guilds/roles + runs. ANCAK catalog route beslemesi henüz bağlı değil -> catalog read-model'i (`/v1/roles` + guild/cluster) 2D modele bağla. 3D/2D salt-okunur projeksiyon; ikinci otorite değil; runtime sayısı UYDURULMAZ.

**D.2 GPU algılama + 3D anahtarı:**
- `canvas.getContext('webgl2'/'webgl')` + `WEBGL_debug_renderer_info` ile yetenek tespiti; `prefers-reduced-motion` ve düşük güç modunda otomatik 2D'ye düş.
- Kullanıcı tercihi override (Rendering & Accessibility ayarı: Auto / Force 2D / Force 3D).

**D.3 3D kampüs (GPU varsa):**
- İzometrik parlayan şehir; LOD/clustering; view-only projeksiyon. RUNNING yalnızca geçerli lease + taze runtime ile. DEMO/ESTIMATED/ACTUAL asla karıştırılmaz.
- GPU yoksa/uygun değilse tam işlevli 2D operations map 3D ile EŞİT (no-GPU'da eşit işlev).

Veri dürüstlüğü: 3D görsel bir projeksiyon; komut otoritesi değil. STOP_ALL backend seviyesinde, UI'dan bağımsız kalır.

---

## E) Mevcut Çalışan Yeteneklerin Güvenli Korunması

Aşağıdaki sözleşmeler/yüzeyler DEĞİŞMEZ; genişletme additive olur, yeniden yazım YOK:

- Work OS / Missions (B5): mission tablo, R0-R4 risk legend, transition + high-risk confirm, run timeline, COMPLETE yalnızca PRODUCT_VERIFIED run'da. `server.ts:199-266` sözleşmesi korunur.
- Trust Kernel: ACİL DURDUR/STOP_ALL (`shell.js` + `POST /v1/control/stop|resume`), kill-switch backend seviyesinde. Protected trust-root normal build modunda DEĞİŞMEZ (CLAUDE.md Builder Contract).
- Project Memory / Knowledge: kanonik kimlik, tenant izolasyonu; AI-türetilmiş veri SOURCE_VERIFIED/FOUNDER_APPROVED'dan görsel olarak ayrı.
- Claude bağlantısı / yürütücüler: `executors-panel.js` READY/NOT_CONFIGURED/PROVENANCE_MISSING/CLI_NOT_FOUND; FAKE executor test-only; secret/token gösterilmez. Claude read-only review; implementasyon/merge yok; Codex Review YASAK (GOV2).
- QA / Evidence (B4): verification chip'leri, logTail text-only, unverifiable asla VERIFIED. Mock test başarısı asla gerçek entegrasyon sayılmaz.
- Delivery (B6A): iki eksenli (sourceGeneration/productVerification); hash-verified export; acceptance testlerin çalışmadığını açıkça belirtir.
- Data-honesty katmanı (`model.js classifyFailure`): çekirdek invariant; tüm view'larda tutar.
- Tek shell / tek repo / tek veri otoritesi: ikinci app/repo/veri otoritesi oluşturulmaz.

Koruma mekanizması: her iş paketi yalnızca renderer tüketim katmanına dokunur; backend sözleşmeleri (`control-api server.ts`) yeni rotalar gerekmedikçe değişmez. FA-V2-PRODUCT altındaki korumalı dosyalar: trust-root ve supervisor-owned runtime state (tam dosya listesi UNKNOWN — supervisor frozen contract'ından alınmalı; builder bunları normal modda değiştirmez).

---

## F) Her İş İçin Tahmini Süre + Kabul Testi + Bağımsız Review Koşulu

Varsayımlar (hepsi değişirse süre değişir): tek Claude builder lane; governed CLAUDE_REVIEWER (GOV1/GOV2) tek kapı; Codex yok; protected trust-root değişikliği yok; backend rotaları (Company OS, roles) mevcut ve stabil; süreler iş günü (business day). UNKNOWN: Founder onay gecikmeleri, Windows imza/build ortamı hazırlığı.

| İş | Tahmini süre | Kabul testi | Bağımsız review koşulu + VR/DPI/A11y |
|---|---|---|---|
| WP1 Tasarım token derinliği (fs/space/radius/elevation + Inter bundle) | 1.5–2.5 gün | Tüm literaller token'a bağlı; görsel regression baseline üretildi; light+dark render | CLAUDE_REVIEWER: innerHTML yok, token-only diff; VR snapshot (light/dark), DPI 100/150/200%, forced-colors + reduce-motion geçer |
| WP2 Cockpit premium KPI (gauge, delta, hero, drill-down) | 2–3 gün | KPI yalnızca cockpit() kaynağından; mock sayı yok; '—' korunur; gauge aria-label + numeric fallback | Reviewer: fabricated-data taraması negatif; gauge a11y (role=img, screenreader); DPI matrisi; reduce-motion |
| WP3 Company OS renderer wiring (CRM/Finance/Legal) | 3–5 gün | `/v1/company` rotaları tüketilir; draft vs real/signed/settled ayrı; backend yoksa UNAVAILABLE | Reviewer: hiçbir counterfeit ERP/finans kaydı; tenant izolasyonu; permission-filtered; VR + DPI + a11y tablo gezinme |
| WP4 Control Tower 2D kampüs bağlama + liste fallback + catalog besleme | 3–4 gün | 2D kampüs mount; liste fallback keyboard+SR ile tam işlevli; runtime sayısı uydurulmaz | Reviewer: salt-okunur projeksiyon kanıtı; RUNNING lease gerektirir; reduce-motion; VR; DPI; forced-colors |
| WP5 Control Tower 3D + GPU algılama + 2D fallback | 4–6 gün | GPU yoksa/reduce-motion'da otomatik 2D; 3D view-only; DEMO/ESTIMATED/ACTUAL karışmaz | Reviewer: fallback zorunlu testi (GPU kapalı); 2D eşit işlev; a11y; DPI; perf bütçesi |
| WP6 Workforce 599-rol katalog + 4 view + 10-tab Inspector | 4–6 gün | `/v1/roles` paginated + rol detay; target/defined/certified/leased/running AYRI; heartbeat≠progress | Reviewer: katalog sayısı ≠ aktif worker; EMPTY/PERMISSION_DENIED/STALE per tab; VR; DPI; a11y |
| WP7 Birleşik Inspector (sağ-docked) + Command Center (Ctrl+K konsol) | 3–4 gün | Inspector seçili varlık için kapsamlı; EMPTY/DENIED; Command Center quick actions | Reviewer: izin-farkında; mock aksiyon yok; a11y focus-trap; DPI; reduce-motion |
| WP8 Teslimat&SRE üst ekranı (B6) + Security SOC + Claude review yüzeyi | 4–6 gün | prepared/built/deployed/smoke/accepted AYRI; tarama yoksa clean label yok; review read-only | Reviewer: P0 gate WAIVE edilmez; stale evidence; no fake LIVE; VR; DPI; a11y |
| WP9 Project Journey (BA/Plan/Requirements/Discovery/MVP/Prototype) | 8–12 gün | Her ekran onay kapısı ayrı; onay ≠ yürütme; estimated vs actual ayrı | Reviewer: approval authority ayrımı; no fabricated market/cost; VR; DPI; a11y |
| WP10 Knowledge Center + Trust/Permission Center + FinOps + System Ops + Global Experience + Governance | 10–15 gün | Her biri dürüst durum sözleşmesi; secret değeri gösterilmez; CANDIDATE≠VERIFIED | Reviewer: permission explainer doğru; no fake CERTIFIED; VR; DPI; a11y |

Genel bağımsız review koşulu (hepsi için): governed CLAUDE_REVIEWER gate'ten geçmeden CLEAN ilan edilmez; Claude self-declare CLEAN yapamaz; her paket için commit SHA + kanıt zinciri + VR snapshot (light/dark) + DPI matrisi (100/150/200%, 1366×768→4K) + a11y (keyboard, screenreader, forced-colors, reduce-motion) kanıtı zorunlu. Codex kullanılmaz (GOV2).

---

## G) İlk Güncellenmiş Windows .exe Teslimi ETA (P50/P80/P95)

İlk güncellenmiş .exe kapsamı = **WP1 (token) + WP2 (Cockpit premium) + WP3 (Company OS wiring) + WP4 (Control Tower 2D bağlama)** — yani premium görsel dil + ilk yüksek-değerli gerçek-veri bağlama + 2D kampüs. (3D/WP5 ilk exe'ye dahil DEĞİL; sonraki artımda.)

Varsayımlar: tek builder lane, tek governed review gate, Windows imzalı build ortamı HAZIR (UNKNOWN ise +2–4 gün), protected trust-root değişikliği yok, backend rotaları stabil, Founder onay gecikmesi minimal.

- Çalışma toplamı (WP1+2+3+4): ~9.5–14.5 iş günü ham + review/VR/DPI/a11y + build/imza + onay tamponu.
- **P50: 8 iş günü** (~1.5 takvim haftası)
- **P80: 12 iş günü** (~2.5 takvim haftası)
- **P95: 18 iş günü** (~3.5 takvim haftası)

UNKNOWN riskler (gerçekleşirse P80/P95'e kayar): Windows kod imzalama/installer ortamı hazır değilse, Company OS backend rotaları beklenenden farklıysa, catalog read-model 2D'yi beslemek için ek backend iş gerektiriyorsa, Founder onay kuyruğu gecikirse.

---

## P0 / P1 / P2 Önceliklendirilmiş Sınırlı İş Paketleri

Her paket: kapsam / kanonik bağlama / korumalı dosyalar (FA-V2-PRODUCT) / kabul testi / bağımsız review koşulu / VR+DPI+a11y doğrulama.

### P0 (ilk güncellenmiş exe için kritik yol)

**P0-1 — Premium tasarım token katmanı (WP1)**
- Kapsam: `styles.css` `:root`'a type/spacing/radius/elevation/glow ölçek token'ları ekle; literalleri token'a refactor; Inter'i yerel @font-face ile bundle et (CSP uyumlu).
- Kanonik bağlama: cockpit / design-system (DS-05..09).
- Korumalı dosyalar: yok (yalnızca renderer stil katmanı). FA-V2-PRODUCT trust-root'a dokunmaz.
- Kabul testi: tüm görsel literaller token'a bağlı; light+dark render bozulmaz; mevcut class yapısı korunur.
- Bağımsız review: innerHTML yok invariantı korunur; token-only diff; CLEAN gate.
- VR+DPI+a11y: light/dark VR baseline; 100/150/200% DPI, 1366×768→4K; forced-colors + reduce-motion geçer.

**P0-2 — Founder Cockpit premium KPI + gauge (WP2)**
- Kapsam: `kpiTile` genişlet (delta, gauge, hero), accessible SVG gauge component; drill-down Inspector tetiği. Veri yalnızca `ctx.api.cockpit()`.
- Kanonik bağlama: cockpit/KPI (UX-DEC-004/005).
- Korumalı dosyalar: `model.js` honesty fonksiyonları (classifyFailure/mapCockpit/emptyCockpit) DEĞİŞMEZ — yalnızca okunur.
- Kabul testi: mock sayı yok; VERIFIED/STALE dışı '—'; gauge numeric fallback.
- Bağımsız review: fabricated-data taraması negatif; gauge a11y.
- VR+DPI+a11y: gauge role=img/aria-label; reduce-motion gauge animasyonunu kapatır; DPI matrisi.

**P0-3 — Company OS renderer wiring (WP3)**
- Kapsam: `company` route'u `planned` stub'tan gerçek view'a çevir; `/v1/company` CRM/Finance/Legal (server.ts:458-535) tüket; 5 iş grubu iskeleti + domain ekran sözleşmesi; backend yoksa UNAVAILABLE.
- Kanonik bağlama: B11A / UX-DEC-064 (ve 047/049/050).
- Korumalı dosyalar: `control-api server.ts` rotaları DEĞİŞMEZ (yalnızca tüketilir); yeni backend rotası yok.
- Kabul testi: draft vs sent/signed/settled ayrı; tenant izolasyonu; counterfeit kayıt yok.
- Bağımsız review: permission-filtered; no fake data; kanonik kimlik korunur.
- VR+DPI+a11y: tablo keyboard gezinme; DPI matrisi; forced-colors.

**P0-4 — Control Tower 2D kampüs bağlama (WP4)**
- Kapsam: `control-tower/` modülünü shell'e mount (tower veya yeni route); erişilebilir liste fallback; catalog read-model beslemesi (`/v1/roles` + guild/cluster + cockpit.globalStop + runs).
- Kanonik bağlama: B6A / UX-DEC-067.
- Korumalı dosyalar: `control-tower/` modülü additive wiring; STOP_ALL backend otoritesi değişmez.
- Kabul testi: 2D mount; liste fallback tam işlevli; runtime sayısı uydurulmaz; salt-okunur projeksiyon.
- Bağımsız review: RUNNING lease gerektirir; DEMO/ESTIMATED/ACTUAL ayrı.
- VR+DPI+a11y: keyboard+SR liste; reduce-motion neon pulse kapanır; DPI; forced-colors.

### P1 (ikinci artım — derinlik ve runtime)

**P1-1 — Control Tower 3D + GPU algılama + 2D fallback (WP5)** — B6A / UX-DEC-067. Korumalı: yok (renderer). Kabul: GPU yoksa otomatik 2D eşit işlev. Review: fallback zorunlu testi. VR/DPI/a11y + perf bütçesi.

**P1-2 — AI Workforce 599-rol katalog + 4 view + 10-tab Inspector (WP6)** — WFR-03/B3 / UX-DEC-016/041/062. Korumalı: `/v1/roles` rotaları değişmez. Kabul: katalog≠aktif worker; heartbeat≠progress. Review: per-tab EMPTY/DENIED/STALE.

**P1-3 — Birleşik Inspector + Command Center (WP7)** — B6A / UX-DEC-017/059/062. Korumalı: yok. Kabul: izin-farkında; mock aksiyon yok. Review: focus-trap a11y.

**P1-4 — Teslimat&SRE + Security SOC + Claude review yüzeyi (WP8)** — B6/B4 / UX-DEC-038/039/030/031/068. Korumalı: QA/Delivery sözleşmeleri değişmez. Kabul: aşama durumları ayrı; tarama yoksa clean yok. Review: P0 gate WAIVE edilmez.

### P2 (kurumsal genişleme)

**P2-1 — Project Journey ekranları (WP9)** — Project Journey / UX-DEC-009..014/023..026. Kabul: onay≠yürütme; estimated vs actual ayrı.

**P2-2 — Knowledge/Trust/Permission/FinOps/System Ops/Global Experience/Governance (WP10)** — çok paket / UX-DEC-032..037/040/042/043/046/052..058/060/065/066/069..071. Kabul: secret gösterilmez; CANDIDATE≠VERIFIED; no fake CERTIFIED.

---

## Bağımlılık Grafiği (metin)

```
P0-1 (tasarım token) ──┬──> P0-2 (Cockpit premium KPI/gauge)
                       ├──> P0-3 (Company OS wiring) [görsel token'a bağlı; backend hazır]
                       └──> P0-4 (Control Tower 2D bağlama)

P0-4 (2D kampüs + catalog besleme) ──> P1-1 (3D + GPU fallback) [2D fallback'e bağımlı]
P0-4 (catalog read-model) ──────────> P1-2 (Workforce katalog) [paylaşılan catalog read-model]

P0-2 (drill-down tetiği) ──> P1-3 (birleşik Inspector + Command Center)
P0-1, P0-2 ──────────────> P1-4 (Teslimat&SRE + Security SOC + Claude review)

P1-3 (Inspector) ──> P2-1 (Project Journey) ──> P2-2 (Knowledge/Trust/FinOps/System/Governance)
P1-4 ────────────> P2-2

İlk güncellenmiş .exe = P0-1 + P0-2 + P0-3 + P0-4 (P1/P2 sonraki artımlar).
Kritik yol: P0-1 -> P0-4 -> (P1-1 / P1-2).
Değiştirilemez sınır (tüm düğümler): backend sözleşmeleri (control-api server.ts), model.js honesty katmanı, STOP_ALL backend otoritesi, tek-shell/tek-repo/tek-veri-otoritesi, protected trust-root (FA-V2-PRODUCT) korunur.
```

---

## Dürüstlük ve Sınır Teyidi

- Tasarım hedefi KÜÇÜLTÜLMEDİ; premium neon-navy + Control Tower 2D/3D + Company OS + Inspector + Command Center tam kapsamda planlandı (UASCO'nun kendi özgün, üretime hazır eşdeğeri; 1:1 lisanslı kopya değil).
- Sahte çalışan ekran inşa edilmeyecek; placeholder'lar kanonik paketlere bağlandı (Teslimat&SRE -> B6; Company OS -> B11A; Control Tower -> B6A).
- İkinci app/repo/veri otoritesi yok.
- UNKNOWN işaretli: FA-V2-PRODUCT korumalı dosyaların tam listesi (frozen contract'tan alınmalı); Windows kod imzalama/installer ortamının hazırlık durumu; Company OS dışı domain (Marketing/Procurement/Strategy/People/Comms/Docs/Backup) için backend varlığı; catalog read-model'in 2D kampüsü beslemek için ek backend gerektirip gerektirmediği.
- Bu görevde kod değişikliği yapılmadı, uygulama başlatılmadı, veri dizinlerine dokunulmadı (%APPDATA%/UASCO ve %APPDATA%/UASCO Test'e temas yok).

---

## H) Bagimsiz elestirmen notlari

Bagimsiz, SALT OKUNUR tamlik + butunluk denetimi. A-G bolumleri DEGISTIRILMEDI. Asagidaki bulgular, raporun kendi kanitlarina ve dogrulanan renderer/ backend gerceklerine karsi capraz kontrol sonucudur. Dogrulanan olgular (bu denetimde bizzat teyit edildi): v2-m1a HEAD = `2176741`; `control-tower/` modulu VAR ve shell'e BAGLI DEGIL (README "not wired into the shell yet", renderer'da `control-tower` import'u YOK); renderer'da WebGL/three.js/3D KODU YOK; `/v1/company` CRM/Finance/Legal rotalari (`server.ts:458-535`) VAR; `/v1/roles` rotasi (`server.ts:541+`) VAR ve kayit bozuksa 503 doner (sayi uydurmaz); renderer `company`=`planned` B7 stub, `delivery`=`planned` B6; `classifyFailure/mapCockpit/emptyCockpit` honesty fonksiyonlari ve `kpiTile` VAR; UX-DEC tablosu tam 71 satir (001..071, eksik/tekrar YOK); 8 Factory nav alani teyit (home/projects/work/workforce/assurance/delivery/tower/inbox). Bu yonleriyle raporun kanit butunlugu SAGLAM. Ancak asagidaki somut bosluklar giderilmeden plan "temiz" sayilmamalidir.

**H-1 [YUKSEK — G bolumu degismeli] ETA, kendi ham is tahminiyle celisiyor (matematiksel tutarsizlik).**
G bolumu ilk exe kapsamini WP1+WP2+WP3+WP4 olarak tanimliyor ve ham toplami "~9.5–14.5 is gunu" diyor; UZERINE review/VR/DPI/a11y + build/imza + onay tamponu ekleneceğini soyluyor. Buna ragmen P50 = 8 is gunu veriyor. Varsayim acikca "tek Claude builder lane" (paralellik YOK; F bolumu). Tek lane'de P50, ham toplamin alt sinirindan (9.5) kucuk OLAMAZ; tamponlar eklendiginde daha da yukselir. Dolayisiyla P50=8 / P80=12 iyimser ve kendi iç verisiyle tutarsiz. Checklist (g) "ETA durust" ihlali. GEREKLI DEGISIKLIK (G): P50 >= ham_alt_sinir + review/build/onay tamponu olacak sekilde yeniden turetilsin (or. P50 >= ~12, P80 >= ~16, P95 >= ~22 is gunu mertebesinde) VEYA paralel lane varsayimi acikca belirtilip dependency grafigiyle gerekcelendirilsin. Mevcut haliyle headline ETA yaniltici.

**H-2 [YUKSEK — Baslik notu + E + G degismeli] Denetim lane'i ile teslim lane'i ayri; uzlasma kanit-bagi YOK.**
Rapor v2-m1a@`2176741` renderer'ini denetliyor (satir 5-6), ama aktif teslim dali v6@`217d429`. Rapor bu farki durustce ACIKLIYOR fakat iki renderer'in esdeğerligini gosteren hicbir kanit-bagi (diff/hash/dosya listesi) sunmuyor. Tum satir-numarali kanitlar (`home.js:56`, `components.js:25-37`, `server.ts:458-535`, `control-tower/`) v2-m1a'ya ait; v6'da bu dosyalar kaymis/degismis olabilir. Checklist (b)/(h) tek-otorite ilkesiyle dogrudan celismez ama is paketleri v6'da uygulanacaksa kabul testleri yanlis hedefe nisan alabilir. GEREKLI DEGISIKLIK: Baslik notuna veya E bolumune bir "lane uzlasma gecidi" eklensin — WP baslamadan once v2-m1a↔v6 renderer diff'i alinip (a) ayni ise teyit, (b) farkli ise kanit satir-numaralari v6'ya yeniden eslenmeli. Aksi halde G'deki ETA da yanlis kod tabanina dayanir.

**H-3 [YUKSEK — F + P2 bolumleri degismeli] WP9 ve WP10 sinirli-kapsam (bounded scope) ilkesini ihlal ediyor.**
Checklist (f) her paket icin "bounded scope" sart kosuyor. WP10 tek pakette 7 ayri yuzeyi topluyor (Knowledge + Trust/Permission + FinOps + System Ops + Global Experience + Governance) 10-15 gun; WP9 ise 6 pre-dev ekranini (BA/Plan/Requirements/Discovery/MVP/Prototype) 8-12 gun olarak paketliyor. Bunlar tek "is paketi" degil, birer programdir; tek review gecidinden "CLEAN" cikmalari pratikte imkansiz ve kapsam sessizce genisleme riski tasir (CLAUDE.md "silently broaden scope" yasagi). GEREKLI DEGISIKLIK (F/P2): WP9 ve WP10 her biri tek yuzey = tek sinirli paket olacak sekilde bolunsun; her alt-paket kendi kabul testi + review + VR/DPI/a11y + net kapsam siniri alsin.

**H-4 [YUKSEK — (a)/(g) ihlali; F + Honesty bolumu degismeli] UNKNOWN-backend ekranlar icin "placeholder" riski ve sahte ETA.**
Rapor, Company OS disi domainler (Marketing/Procurement/Strategy/People/Comms/Docs/Backup) ve Project Journey (BA/Plan/Discovery/MVP/Prototype) icin backend varligini UNKNOWN isaretliyor (dogru). Ancak F tablosunda WP9'a 8-12, WP10'a 10-15 is gunu gibi somut aralik tahminleri veriliyor ve kabul testleri ekranlarin "insa edilecegini" varsayiyor. Backend yoksa bu ekranlar ya insa edilemez ya da checklist (a)'nin yasakladigi "daha sik placeholder" olur. GEREKLI DEGISIKLIK: (i) Her UNKNOWN-backend ekrani icin on-kosul eklensin — "gercek backend/work-package bagi yoksa yalnizca NOT_CONNECTED/UNAVAILABLE yuzeyi gosterilir, etkilesimli stub INSA EDILMEZ"; (ii) WP9/WP10 sure tahminleri backend teyit edilene kadar UNKNOWN (gated) olarak isaretlensin, gun-araligi verilmesin. Su an checklist (a) kismen ve (g) kismen ihlal.

**H-5 [ORTA — B + F bolumu degismeli] Project Switcher zenginlestirmesi plana baglanmamis.**
Checklist (d) "Project Switcher"i acikca talep ediyor. Rapor UX-DEC-044'te "zengin switcher yok" diyor ve TL;DR'da Project Switcher'i IMPLEMENTED (cekirdek) sayiyor, ama hicbir WP (P0-P2) Project Switcher zenginlestirmesini SAHIPLENMIYOR. Sessizce dusurulmus bir derinlik ogesi. GEREKLI DEGISIKLIK: B listesine + F tablosuna ya acik bir "Project Switcher enrichment" paketi eklensin ya da gerekcesiyle acikca ERTELENDI (deferred) yazilsin.

**H-6 [ORTA — Baslik/A notu degismeli] Kanit, belirtilen kanit dizininde (product/ux) committed degil — bagimsiz tekrar-uretilebilirlik zayif.**
`C:/Users/salim/UASCO-recovery/product/ux` yalnizca raporun kendisi + `.sha256` iceriyor; raporun dayandigi per-UX-DEC "impl-status kaniti" ve "target-design facet NOT_VERIFIED" degerlendirmeleri bu dizinde committed artefakt olarak YOK. Kanit tek kaynagi v2-m1a renderer'i (denetim disi worktree). (Hafifletici: bu denetimde H-girisindeki olgular bizzat renderer/backend'e karsi teyit edildi ve dogru cikti.) GEREKLI DEGISIKLIK: Baslik/A notuna kanit kaynagi acikca ("evidence = renderer@2176741 + control-api server.ts") yazilsin veya facet kanit dosyalari product/ux altina committed edilsin ki ucuncu taraf raporu bagimsiz dogrulayabilsin.

**H-7 [ORTA-DUSUK — F genel maddesi netlesmeli] Tek-reviewer bagimsizligi (GOV2 artigi).**
Checklist (f) "bagimsiz review" istiyor. GOV2 ile Codex emekliye ayrildi; "bagimsiz review" artik yalnizca governed CLAUDE_REVIEWER. Rapor bunu yonetisime uygun uyguluyor (dogru) ama ayni model ailesinin builder+reviewer olmasi artik tek bagimsizlik gecidi — bu bir artik-risk. GEREKLI DEGISIKLIK: F genel review maddesine builder≠reviewer oturum/baglam izolasyonu ve kanit-zinciri sarti acikca yazilsin; bu bir blocker degil, netlik notu.

**H-8 [DUSUK — A/B bolumu netlik] "8 Factory alani" acik eslenmemis + iki farkli "8'li" karisabilir.**
8 Factory nav alani (home/projects/work/workforce/assurance/delivery/tower/inbox) tabloda ortulu olarak kapsaniyor ama hicbir yerde "8 Factory alani → durum → WP" acik eslemesi yok; ayrica D.1'deki 8 guild binasi (Gelistirme/QA/Guvenlik SOC/...) FARKLI bir 8'lidir ve okuru yaniltabilir. GEREKLI DEGISIKLIK: B bolumune 8 nav alanini tek tek listeleyen kisa bir esleme eklensin; D.1'deki "8 bina"nin nav alani olmadigi bir cumleyle belirtilsin.

**H-9 [DUSUK — Yonetici Ozeti/A degismeli] Kapsama sayilari "~" ile belirsiz; tam sayi mevcut.**
Tam 71-satirlik tabloda kesin tally mumkun: IMPLEMENTED(saf) 11, IMPLEMENTED(kismi/cekirdek) 2, PARTIAL 18, PLACEHOLDER 13, NOT_IMPLEMENTED 27. Rapor "~13 IMPLEMENTED" diyerek 11 saf + 2 nitelikli'yi birlestiriyor. GEREKLI DEGISIKLIK: "~" kaldirilip kesin sayilar yazilsin; "IMPLEMENTED 13" yerine "11 saf + 2 nitelikli (kismi/cekirdek)" ayrimi verilsin.

**Olumlu teyitler (degistirilmesi gerekmeyen, checklist karsiligi):** (b) calisan sozlesmeler (Work OS, Trust Kernel, Project Memory, Claude baglantisi, QA, Delivery) E bolumunde acikca KORUNUYOR, uygulama yeniden yazilmiyor — UYUMLU. (c) 71 UX-DEC'in tamami tabloda, eksik/sessiz dusurme YOK — UYUMLU. (d) 8 Factory + Company OS + Inspector + Command Center + 2D/3D Control Tower plandadir (Project Switcher derinligi haric: H-5). (e) 3D icin GPU algilama + erisilebilir 2D fallback (D.2/D.3, WP5) var; gorsel referans 1:1/lisansli degil, UASCO'nun ozgun esdegeri hedefleniyor — UYUMLU. (h) ikinci app/repo/veri otoritesi YOK, tek shell/tek repo ilkesi korunuyor — UYUMLU.

**Ozet onceliklendirme (en kritik -> en dusuk):** H-1 (ETA matematigi, G), H-2 (lane uzlasmasi, baslik/E/G), H-3 (WP9/WP10 sinirli kapsam, F/P2), H-4 (UNKNOWN-backend placeholder + sahte ETA, F/Honesty), H-5 (Project Switcher, B/F), H-6 (kanit committed degil, baslik/A), H-7 (tek-reviewer, F), H-8 (8 Factory esleme, A/B), H-9 (kesin kapsama sayilari, Ozet/A). H-1, H-3, H-4 giderilmeden plan uygulanabilir/"temiz" sayilmamalidir.
