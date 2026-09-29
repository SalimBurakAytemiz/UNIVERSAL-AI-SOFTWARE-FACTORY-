# UASCO Desktop — SC-01..SC-18 Ekran Sözleşmesi Fark Raporu ve Sınırlı Paket Yol Haritası

- Tarih: 2026-10-15
- Kapsam: READ-ONLY analiz. Hiçbir kod değiştirilmedi; üretilmiş/güvenilmeyen proje kodu çalıştırılmadı; Founder gerçek UASCO kurulumuna ve `%APPDATA%/UASCO`'ya dokunulmadı.
- Onaylı tasarım kaynağı (DESIGN SPEC, komut değil): `UASCO_COMPLETE_DESKTOP_UI_UX_IMPLEMENTATION_BLUEPRINT.md` (bölüm 3 SC-01..SC-18, bölüm 5 akışlar, bölüm 7 UX-DEC-001..071 eşleme, bölüm 8 veri/aksiyon/telemetry, bölüm 9 kalite kapısı).
- Gerçek renderer: commit 2176741, `C:/Users/salim/UASCO-wt/v2-m1a/apps/desktop/renderer/` (app.js, nav.js, routes.js, state.js, model.js, components.js, views/*.js, control-tower/*).
- Gerçek backend: `C:/Users/salim/UASCO-wt/v2-m1a/apps/control-api/src/server.ts` (`/v1/*` rotaları, satır no ile atıf).
- Önceki denetim (kanıtı yeniden kullanıldı, sıfırdan tekrar edilmedi): `docs/planning/UASCO_DESKTOP_UX_GAP_ANALYSIS_2026-10-15.md`.

> Dürüstlük notu: Tüm UX-DEC öğeleri target-design facet'inde onaylı ama ÖLÇÜLMEMİŞ (UX-DEC-060). Aşağıdaki durum etiketleri renderer gerçekliğini (impl-status kanıtı) yansıtır, ürün doğrulamasını (PRODUCT_VERIFIED) değil. Renderer taramasında uydurma/hardcoded canlı veri BULUNMADI (grep: Alex/47 ajan/12 proje/%96.8/mock/dummy = sonuç yok); honesty model katmanında zorlanıyor (`model.js classifyFailure`, `api.js mapCockpit/emptyCockpit`). Bu dürüstlük KORUNMALIDIR.

---

## 0. Yürütme özeti (TL;DR)

- Operasyonel omurga SAĞLAM ve DÜRÜST: Founder Cockpit KPI, Projeler, Görevler/Work OS, Güvence QA Evidence, Gelen Kutusu/Onaylar, ACİL DURDUR (STOP_ALL), Aktivite paneli, Ayarlar/Yürütücüler, Global arama. Hepsi gerçek `/v1/*` rotalarını tüketiyor, uydurma veri yok.
- EN YÜKSEK DEĞERLİ AÇIK (backend VAR, renderer tüketMİYOR):
  1. **SC-15 Company OS** — backend `/v1/company/*` (server.ts:458-535) tam uygulanmış; renderer `company` rotası `view:"planned"` B7 stub (routes.js). En yüksek değerli hızlı kazanım.
  2. **SC-08 Workforce 599-rol kataloğu** — backend `/v1/roles` (server.ts:541) + `/v1/roles/:roleId` (557) VAR; renderer workforce.js yalnız `/v1/agents` sayımı gösteriyor.
  3. **SC-12 Control Tower 2D kampüs** — premium modül (`renderer/control-tower/render-svg.js`, `model.js buildCampusModel`, `list-view.js`) VAR ama renderer'ın hiçbir yerinden import EDİLMİYOR (grep: sonuç yok); `tower` rotası eski Day-0 `tower.js`'i render ediyor.
- 3D/WebGL/three.js KODU YOK; GPU algılama / 2D-fallback anahtarı YOK (SC-12 3D = NOT_IMPLEMENTED). 3D ilk .exe kapsamına DAHİL DEĞİL.
- Premium neon görsel dil PARTIAL: tek `styles.css` + tek `:root` var; tipografi/spacing/elevation/radius token ölçekleri ve Inter yerel bundle eksik (WP1b devam ediyor).
- 71 UX-DEC kaba kapsama: **13 IMPLEMENTED / 18 PARTIAL / 13 PLACEHOLDER / 27 NOT_IMPLEMENTED** (deterministik join ile doğrulandı; önceki denetimle birebir uyumlu).

---

## 1. Backend `/v1/*` rota envanteri (server.ts, commit 2176741 — ekranların ihtiyaç duyduğu)

| Rota | Satır | Not |
|---|---|---|
| `/v1/cockpit` | 573 (handler), 633 | B2 tek okuma otoritesi; eksik kaynak için sayı uydurmaz (UNAVAILABLE/null) |
| `/v1/projects` (GET/POST) | 186 / 187 | portföy + oluştur |
| `/v1/projects/:id/{devrun,files,file,git/log,git/diff}` | 373 / 374 / 379 / 384 / 390 | proje studio |
| `/v1/missions` (GET api.js / POST) | 203 | Work OS |
| `/v1/work-runs`, `/v1/work-runs/:id` | api.js:47,49 | görev koşuları |
| `/v1/evidence`, `/v1/evidence/:evidenceId` | 432 / 446 | QA/kanıt |
| `/v1/agents` | 102 | legacy 363 + 599 özet (LEGACY_REFERENCE_ONLY) |
| `/v1/roles`, `/v1/roles/:roleId` | 541 / 557 | kanonik 599 rol, sayfalı; bozuk kayıtta 503 (uydurmaz) |
| `/v1/company/accounts,contacts,opportunities,invoices,payments,contracts` | 458-523 | B11A CRM/Finance/Legal tam |
| `/v1/control/status,stop,resume,retry-blocked` | 112 / 134 / 138 / 139 | STOP_ALL + resume |
| `/v1/founder-attention`, `/v1/retry` | 114 / 113 | onay/dikkat kuyruğu |
| `/v1/runs`, `/v1/runs/:runId/events,logs` | 116 / 121 / 125,129 | aktivite/koşu |
| `/v1/system/executors`, `/v1/system/.../local-claude/enable` | 418 / 431 | yürütücü/provider |
| `/v1/phase0`, `/v1/install`, `/v1/scheduler`, `/v1/factory` | 98 / 99 / 100 / 97 | sistem/kurulum |
| Güvenlik kapısı | 92-93 | `/v1/*` için control-token zorunlu; token yoksa 503, yanlışsa 403 |

UNKNOWN (server.ts'te doğrulanmadı): Business Analysis / Plan Studio / SRE / Release-gate / Knowledge-Memory / RE-Lab için ayrı backend sözleşmeleri. Bu ekranlar için "backend UNKNOWN" olarak işaretlendi — Claude owner/contract bulmadan endpoint icat etmemeli (blueprint §8 kuralı).

---

## 2. Renderer rota tablosu (routes.js, commit 2176741)

8 Factory alanı + Company OS + Settings:

| route | view | durum | plannedPackage |
|---|---|---|---|
| home | home.js | gerçek | — |
| projects | projects.js | gerçek | — |
| work | work.js | gerçek | — |
| workforce | workforce.js | gerçek (sığ) | B3 |
| assurance | assurance.js | gerçek | — |
| delivery | planned | PLACEHOLDER | B6 |
| tower | tower.js | gerçek (legacy Day-0) | — |
| inbox | inbox.js | gerçek | — |
| company | planned | PLACEHOLDER | B7 |
| settings | settings.js | gerçek (sığ) | — |

---

## 3. SC-01..SC-18 — durum, kanıt, fark, iş paketi, öncelik

Durum etiketleri: IMPLEMENTED (bağlı/işlevsel/dürüst) · PARTIAL · PLACEHOLDER (dürüst "planlı" stub) · NOT_IMPLEMENTED · NOT_VERIFIED (ölçülmemiş). Her SC için backend "VAR (satır)" / UNKNOWN belirtilir.

### SC-01 — Global Desktop Shell (P0) — Durum: PARTIAL (omurga IMPLEMENTED)
- Kanıt: `routes.js` 8 Factory + Company OS + Settings; `nav.js syncNav` in-place sol nav; `shell.js` (13KB) üst çubuk/context; `app.js`; `i18n.js` + `locales/tr.js|en.js` TR/EN; STOP_ALL → `/v1/control/stop` (134) / `resume` (138); scope = `store.projectId` (api.js). Backend VAR: `/v1/control/status` (112), `/v1/cockpit` (573).
- Fark (hedef = premium neon, tam bağlam): (a) Company+project+environment bar derinliği kısmi (tenant/environment/policyVersion/asOf görünür bağlam eksik); (b) Ctrl+K yalnız nav araması — birleşik **Command Center** YOK; (c) design token derinliği eksik (WP1b); (d) scope değişiminde inspector/search/websocket invalidation kanıtı yüzeye çıkmıyor.
- İş paketi: **WP1b** (token) + **WP7** (Command Center/Ctrl+K konsol) + Shell context-bar polish. Dosyalar: `shell.js`, `nav.js`, `app.js`, `styles.css`, yeni `command-center.js`. Protected: yok (renderer-only; trust-root'a dokunmaz). Backend: mevcut `/v1/control/*`, `/v1/cockpit`. Kabul: UIUX-AT-002,003,004,005,006,007 + AT-041..050 (DPI/zoom). Testler: 1280/1366/1920/4K × %100/125/200/400, TR overflow, keyboard/focus, VR.
- Öncelik: P0. Bağımlılık: WP1b.

### SC-02 — Founder Cockpit / Home (P0) — Durum: PARTIAL
- Kanıt: `views/home.js:56-62` yalnız `ctx.api.cockpit()` → `/v1/cockpit` (573/633); `components.js:25-37` `kpiTile` VERIFIED/STALE dışı '—'; honesty `api.js mapCockpit/emptyCockpit` + `model.js classifyFailure`. Uydurma veri yok (blueprint "Alex/12 proje/47 ajan/%96.8" demo değerleri renderer'da YOK).
- Fark: premium görsel (gauge/hero/delta/neon glow) yok; KPI drill-down sığ; onboarding (UX-DEC-002) YOK; cockpit 2D operasyon alanı / düşük-GPU fallback (UX-DEC-010/AT-010) YOK; sesli komut (UX-DEC-007) YOK.
- İş paketi: **WP2** Cockpit premium KPI. Dosyalar: `home.js`, `components.js`, `styles.css`. Protected: yok. Backend: `/v1/cockpit` (VAR). Kabul: UIUX-AT-008 (mock yok), AT-009 (risk drilldown→kaynak), AT-010 (2D fallback). Testler: gauge aria-label + numeric fallback, reduce-motion, DPI matrisi, fabricated-data taraması negatif, VR (light/dark).
- Öncelik: P0. Bağımlılık: WP1b → WP2.

### SC-03 — Projects / Portfolio (P0) — Durum: IMPLEMENTED
- Kanıt: `views/projects.js` → `/v1/projects` (186) GET + POST (187); create/import scoped projectId; `forms.js`. Honest EMPTY/DENIED.
- Fark: Product Discovery (023) / MVP seçimi (024) / zengin portföy filtreleri eksik; import validation vs accepted-source ayrımı yüzeyi derinleşmeli.
- İş paketi: küçük polish + (P2) Discovery/MVP (SC-05 ile). Dosyalar: `projects.js`, `forms.js`. Backend: `/v1/projects` (VAR). Kabul: UIUX-AT-011 (gerçek projectId, sahte toast yok), AT-012 (import ayrımı). Testler: DPI, TR, a11y, VR.
- Öncelik: P0 (zaten karşılanıyor); genişleme P2.

### SC-04 — Project Journey / Studio (P0) — Durum: PARTIAL
- Kanıt: `views/studio-workspace.js` (27KB), `studio-wizard.js` (12KB), `project-core.js` (20.8KB), `delivery-core.js`; `/v1/projects/:id/{devrun,files,file,git/log,git/diff}` (373-390). Teslim paketleme studio içinde çalışıyor.
- Fark: 7-adım yaşam döngüsü (INTAKE→DISCOVERY→TEAM/PLAN→BUILD→ASSURE→DELIVER→OPERATE) kapı/owner/evidence olarak görsel değil; pre-dev adımları (BA/Discovery/Plan — SC-05/06) YOK; docked tek-proje Inspector yok (SC-07/Task Inspector ile ortak).
- İş paketi: Journey lifecycle görseli + kapı rozetleri (orta). Dosyalar: `studio-workspace.js`, yeni `journey.js`. Backend: mevcut proje rotaları; pre-dev için UNKNOWN. Kabul: UIUX-AT-013 (7 adım lifecycle/gate/owner/evidence). Testler: DPI, TR, a11y, VR.
- Öncelik: P1 (P0 sözleşme; lifecycle görseli P1, pre-dev P2).

### SC-05 — Founder Command / BA / Revision (P0) — Durum: NOT_IMPLEMENTED
- Kanıt: renderer'da BA workspace, sesli taslak/transkript, toplu revizyon stüdyosu YOK. Backend UNKNOWN.
- Fark: Intent→Draft→BA→Review→Freeze akışının tamamı; approved/draft/conflict göstergeleri.
- İş paketi: büyük; backend sözleşmesi netleşmeden UI icat edilemez (§8). Dosyalar: yeni Project Journey pre-dev ekranları. Backend: UNKNOWN (önce owner/contract). Kabul: UIUX-AT-014 (BA-first build block), AT-015 (revision batch target/version binding). 
- Öncelik: P2 (gated: backend UNKNOWN). Ses tek başına ödeme/deploy/yetki vermez invariantı korunmalı.

### SC-06 — Planning / Architecture Studio (P1) — Durum: NOT_IMPLEMENTED
- Kanıt: 3-alternatif plan / DAG-Gantt / ETA-confidence ekranı YOK. Backend UNKNOWN.
- Fark: plan karşılaştırma + kapsamlı Founder kararı + görev grafı; ETA ölçülmemişse UNKNOWN (sahte tarih yok).
- İş paketi: büyük. Backend UNKNOWN. Kabul: UIUX-AT-016 (3 alternatif gerçek scope/cost/confidence veya UNKNOWN).
- Öncelik: P2 (gated).

### SC-07 — Missions / Work OS (P0) — Durum: PARTIAL (omurga IMPLEMENTED)
- Kanıt: `views/work.js` (16.8KB), `work-core.js` (23KB), `work-actions.js`; `/v1/missions` (203), `/v1/missions/:id` (api.js:44), `/v1/work-runs` + `/:id` (api.js:47,49). Board/backlog/kanban + scope/araç limitleri + R0-R4 legend.
- Fark: DAG/Timeline sekmeleri eksik; docked **Task Inspector** (requirements→branch→diff→CI→QA→review→evidence, 10 sekme — UX-DEC-017) YOK; problemli görev yüzeyi (defects) sığ.
- İş paketi: **WP7** (docked Inspector) + DAG/Timeline. Dosyalar: `work.js`, `work-core.js`, yeni `inspector.js`. Backend: mevcut missions/work-runs/evidence. Kabul: UIUX-AT-017 (mission graph Work OS ID tutarlı), AT-018 (checkpoint/crash/resume dürüst stale UI). Testler: DPI, a11y focus-trap, reduce-motion, VR.
- Öncelik: P1 (omurga P0 karşılanıyor; Inspector/DAG P1).

### SC-08 — Agents / Workforce (P0) — Durum: PARTIAL · HIZLI KAZANIM
- Kanıt: `views/workforce.js` (4.1KB) → `/v1/agents` (102) `agentCount`; sayılar var. Backend VAR ama tüketilMİYOR: `/v1/roles` (541, sayfalı, guildId/clusterId/q filtreli), `/v1/roles/:roleId` (557, tam RoleDefinition).
- Fark: 599-rol katalog gezinme + 51-guild/cluster navigasyon + 4 fleet view (Grid/Table/Guild-Tree/Operations) + 10-sekme rol Inspector YOK. target(599)/certified/leased/running AYRIMI görsel değil.
- İş paketi: **WP6** Workforce katalog. Dosyalar: `workforce.js`, yeni `workforce-catalog.js`, `workforce-inspector.js`. Protected: yok. Backend: `/v1/roles`, `/v1/roles/:roleId` (VAR). Kabul: UIUX-AT-019 (599 rol ≠ 599 worker), AT-020 (proje/global worker izolasyonu, runId/tenant). Testler: EMPTY/PERMISSION_DENIED/STALE per tab, heartbeat≠progress, DPI, a11y, VR.
- Öncelik: P1 (yüksek değer, backend hazır).

### SC-09 — Assurance / QA + Security (P0) — Durum: PARTIAL
- Kanıt: `views/assurance.js:59-70` QA Evidence → `/v1/evidence` (432), `/v1/evidence/:id` (446); NOT_EXECUTED≠PASS dürüstlüğü.
- Fark: ayrı **Security SOC** yüzeyi (scan/finding/severity/remediation) YOK; Visual Regression YOK; Device Lab YOK; sadece evidence verification sayımı.
- İş paketi: **WP8** (Security SOC + VR) içinde. Dosyalar: `assurance.js`, yeni `security.js`, `visual-regression.js`. Backend: `/v1/evidence` (VAR); security scan API UNKNOWN. Kabul: UIUX-AT-021 (test run exact commit/suite/env/datetime/result), AT-022 (not-run≠PASS), AT-023 (visual diff baseline identity). Testler: NOT_INSTALLED/BLOCKED/NOT_RUN/FAILED/FLAKY/PASS, DPI, a11y, VR.
- Öncelik: P1 (QA Evidence omurgası P0 var; SOC/VR P1).

### SC-10 — Independent Review / Evidence (P0) — Durum: PARTIAL
- Kanıt: evidence center kısmen (`/v1/evidence`); kayıtlar var. Ayrı read-only reviewer yüzeyi (diffSHA/reviewer model/decision/findings) YOK.
- Fark: commit/diff/finding/resolution + CLEAN/REVIEW_BLOCKED görünümü; rapordan work-task/exact-commit navigasyonu.
- İş paketi: **WP8** (Claude review yüzeyi). Dosyalar: yeni `review.js`. Backend: `/v1/evidence` + review ledger (audit/reviews/*). Kabul: UIUX-AT-024 (reviewer read-only, exact commit bound), AT-025 (M1a zip NOT_VERIFIED), AT-026 (onay≠PRODUCT_VERIFIED). Testler: DPI, a11y, VR.
- Öncelik: P1.

### SC-11 — Delivery / Release + SRE (P0/P1) — Durum: PLACEHOLDER
- Kanıt: `routes.js` delivery → `view:"planned"` B6; `views/delivery-panel.js` (9KB) + `delivery-core.js` var ama üst-ekran stub; paketleme Project Studio içinde çalışıyor. SRE boyutu tamamen YOK.
- Fark: üst düzey Release & SRE dashboard (artifact/package list, environment status, release gates, rollback, incident link); prepared/built/deployed/smoke/accepted AYRIMI.
- İş paketi: **WP8**. Dosyalar: yeni `delivery.js` (üst ekran). Backend: runs/evidence kısmi; release-gate/SRE API UNKNOWN. Kabul: UIUX-AT-027 (B6 sahte healthy üretim gösteremez), AT-028 (SHA/source-SHA/signing/review evidence). Testler: DPI, a11y, VR; NOT_IMPLEMENTED≠NOT_CONNECTED ayrımı.
- Öncelik: P1 (B6 dürüst placeholder kalmalı; gerçek panel ancak kanıtlı API+test ile).

### SC-12 — Control Tower 2D / 3D (P1) — Durum: legacy PARTIAL · 2D NOT_IMPLEMENTED (unwired) · 3D NOT_IMPLEMENTED
- Kanıt: `views/tower.js` (5.4KB) eski Day-0 düz görünüm (`/v1/phase0` 98, `/v1/install` 99, `/v1/scheduler` 100, `/v1/control/*`). Premium 2D kampüs modülü VAR: `renderer/control-tower/render-svg.js` (navy/cyan neon, bg0 #07142c, cyan #22d3ee), `model.js buildCampusModel`, `list-view.js` erişilebilir tablo — ANCAK grep ile doğrulandı: renderer'ın hiçbir yerinde import EDİLMİYOR (sonuç yok). WebGL/three.js/3D KODU YOK; GPU algılama/2D-fallback YOK.
- Fark: 2D kampüs mount + erişilebilir liste fallback + `/v1/roles`/guild/cluster catalog beslemesi; sonra 3D + GPU algılama + otomatik 2D fallback. Hareket eden avatar ≠ canlı worker; runtime sayısı uydurulmaz.
- İş paketi: **WP4** (2D bağlama, ilk .exe kapsamında) + **WP5** (3D, ilk .exe DIŞI). Dosyalar: `tower.js` veya yeni `control-tower` rotası; mevcut `control-tower/*` modülleri import; `routes.js`. Protected: yok. Backend: `/v1/roles` + `/v1/cockpit.globalStop` (VAR). Kabul: UIUX-AT-029 (3D guild click = 2D ile aynı scoped inspector), AT-030 (3D/reduce-motion fallback kritik aksiyon kaybı yok), AT-010 (düşük-GPU 2D eşit semantik). Testler: GPU-kapalı zorunlu fallback, reduce-motion, forced-colors, DPI, VR, perf bütçesi.
- Öncelik: WP4 P1 (hızlı kazanım, modül hazır); WP5 P1 ama ilk .exe sonrası.

### SC-13 — Inbox / Alerts + Approvals (P0) — Durum: IMPLEMENTED
- Kanıt: `views/inbox.js` (5.8KB) → `/v1/founder-attention` (114); approvals state ayrımı; auto-approve YOK.
- Fark: kritik/yüksek/rutin sekme + TTL/blast-radius/target-digest görünür derinliği; bildirim dedup polish.
- İş paketi: küçük polish. Dosyalar: `inbox.js`. Backend: `/v1/founder-attention`, `/v1/control/retry-blocked` (139). Kabul: UIUX-AT-031 (expired/revoked replay engelli), AT-032 (dedup: tek incident tek kart). Testler: DPI, a11y, VR.
- Öncelik: P0 (karşılanıyor); polish P1.

### SC-14 — Knowledge / Project Memory (P1) — Durum: NOT_IMPLEMENTED
- Kanıt: renderer yüzeyi YOK (knowledge graph, Source Inspector, Conversation Import, provenance). Backend UNKNOWN.
- Fark: original vs AI-inference vs accepted-decision ayrımı; çatışma/supersession inspector; cross-tenant sızma yok.
- İş paketi: büyük. Backend UNKNOWN. Not: UX-DEC-070, Document Center'ın yerini almaz. 
- Öncelik: P2 (gated).

### SC-15 — Company OS / CRM / Finance / Legal (P1) — Durum: PLACEHOLDER (renderer) · backend TAM · EN YÜKSEK DEĞERLİ HIZLI KAZANIM
- Kanıt: `routes.js` company → `view:"planned"` B7 stub. Backend B11A TAM: `/v1/company/accounts` (458, listAccounts), `contacts` (464/467), `opportunities` (472/475 + `/:id/stage` 480), `invoices` (485/488 + `/issue` 494 + `/void` 499), `payments` (504/507), `contracts` (515/518 + `/:id/transition` 523).
- Fark: 5 iş grubu + domain ekran sözleşmesi (Overview→Records→Inspector→Workflow→Approvals→Evidence) YOK. Taslak invoice PAID görünmez; teklif ≠ imza invariantı korunmalı.
- İş paketi: **WP3** Company OS wiring (CRM/Finance/Legal). Dosyalar: `routes.js` (company → gerçek view), yeni `views/company.js` + `company-core.js`. Protected: yok (renderer-only; backend owner API'si tüketilir, icat edilmez). Backend: `/v1/company/*` (VAR, 458-535). Kabul: UIUX-AT-033 benzeri source distinction; draft/issued/paid + draft/signed ayrımı; backend yoksa UNAVAILABLE. Testler: tenant izolasyonu, permission-filtered, hiçbir counterfeit ERP/finans kaydı, DPI, a11y tablo gezinme, VR.
- Öncelik: P1 (yüksek değer, backend hazır). İlk .exe'de WP3 olarak önerilir.

### SC-16 — Operations & Recovery (P0) — Durum: PARTIAL
- Kanıt: legacy `tower.js` + `/v1/control/status` (112), `/v1/retry` (113), `/v1/founder-attention` (114), `/v1/control/retry-blocked` (139), `/v1/control/resume` (138). Global Stop/Resume + attention + retryable görünür.
- Fark: ayrı Ops/Recovery ekranı (health, queues, retry/failover, checkpoint, incident timeline, postmortem, RPO/RTO, fencing token) YOK. Recovery success ≠ task success; STOP_ALL backendde UI'dan bağımsız (korunuyor).
- İş paketi: Ops yüzeyi (orta). Dosyalar: yeni `operations.js`. Backend: mevcut control/retry rotaları; SRE/checkpoint detay UNKNOWN. Kabul: UIUX-AT-018 (checkpoint/resume dürüst), UX71-AT-001..050 (kaynakta korunur). Testler: OFFLINE/RECOVERING/RECOVERY_FAILED/STALLED, DPI, a11y, VR.
- Öncelik: P1 (STOP_ALL/attention P0 karşılanıyor; Ops/SRE derinliği P1).

### SC-17 — Settings / Provider / Installation (P0) — Durum: PARTIAL
- Kanıt: `views/settings.js` (1.5KB) + `views/executors-panel.js` (4.9KB) → `/v1/system/executors` (418), `/v1/install` (99), `/v1/phase0` (98), `.../local-claude/enable` (431).
- Fark: first-run guided onboarding (system doctor→Claude login→test→ready — UX-DEC-057/002) YOK; ayrı implementer/reviewer profilleri yüzeyi kısmi; Provider Hub derinliği kısmi; Language Lock/ses/a11y (UX-DEC-058) kısmi. Kişisel Claude profiline otomatik erişim yok invariantı korunmalı; başarısız bağlantı açılışı engellemez.
- İş paketi: Settings/Onboarding derinleştirme (orta). Dosyalar: `settings.js`, `executors-panel.js`, yeni `onboarding.js`. Backend: mevcut system/install rotaları. Kabul: UIUX-AT-037 (ayrı profil, personal fallback yok), AT-038 (secrets asla gösterilmez/loglanmaz), AT-001 (clean installer). Testler: NOT_CONNECTED/UNSUPPORTED/NOT_INSTALLED/LICENSE_REQUIRED, DPI, a11y, VR.
- Öncelik: P1 (yürütücü/provider temel var; onboarding/doctor P1).

### SC-18 — RE / Authorized Analysis Lab (P2) — Durum: NOT_IMPLEMENTED (opsiyonel)
- Kanıt: RE Lab yüzeyi YOK. Backend/adapter UNKNOWN. Adapter yoksa ana app çalışır invariantı (absence ile) sağlanıyor.
- Fark: optional RE case/tabs; source/lisans/authorization; Ghidra/JADX/REA plugin; static analysis + export/handoff.
- İş paketi: opsiyonel, en düşük öncelik. Backend UNKNOWN. Kabul: UIUX-AT-039 (REA yoksa core kullanılabilir), AT-040 (yetkisiz hedef denied).
- Öncelik: P2 (opsiyonel; yetkisiz RE yapılmaz).

---

## 4. UX-DEC-001..071 kapsama özeti

### 4.1 Genel (71 karar, deterministik join — renderer gerçekliği)
- **IMPLEMENTED: 13** · **PARTIAL: 18** · **PLACEHOLDER: 13** · **NOT_IMPLEMENTED: 27** (toplam 71).
- PLACEHOLDER'ların 11'i SC-15 Company OS domain kararları (044-056); backend hazır olduğu için WP3 ile hızla IMPLEMENTED'a taşınabilir.

### 4.2 Fonksiyonel ekran-başına kapsama (SC sözleşmesinin "UX kaynak bağlantıları" listesine göre; kararlar ekranlar arası örtüşür)
| SC | İlgili karar | IMPL | PART | PLACE | NOTIMP |
|---|---|---|---|---|---|
| SC-01 | 8 | 6 | 2 | 0 | 0 |
| SC-02 | 9 | 6 | 3 | 0 | 0 |
| SC-03 | 6 | 2 | 0 | 0 | 4 |
| SC-04 | 13 | 3 | 2 | 0 | 8 |
| SC-05 | 7 | 0 | 0 | 0 | 7 |
| SC-06 | 6 | 2 | 0 | 0 | 4 |
| SC-07 | 8 | 3 | 3 | 0 | 2 |
| SC-08 | 7 | 0 | 4 | 1 | 2 |
| SC-09 | 8 | 1 | 4 | 0 | 3 |
| SC-10 | 6 | 1 | 3 | 0 | 2 |
| SC-11 | 6 | 0 | 4 | 2 | 0 |
| SC-12 | 7 | 2 | 5 | 0 | 0 |
| SC-13 | 5 | 2 | 2 | 0 | 1 |
| SC-14 | 5 | 0 | 0 | 1 | 4 |
| SC-15 | 12 | 1 | 0 | 10 | 1 |
| SC-16 | 5 | 0 | 2 | 2 | 1 |
| SC-17 | 7 | 0 | 5 | 0 | 2 |
| SC-18 | 4 | 0 | 3 | 0 | 1 |

### 4.3 Blueprint §7 literal eşleme notu
Blueprint §7 kararların 44'ünü SC-01'e (global shell catch-all) eşliyor; bu, ayrı ekranı olmayan governance/platform kararları içindir. Yukarıdaki 4.2 tablosu daha kullanışlı fonksiyonel dağılımı verir. UX-DEC-060 (Final Scope Freeze/Master Spec/Repo Audit) hiçbir ekran sözleşmesine özel bağlanmaz (meta/governance); §7'de SC-01.

---

## 5. Sınırlı paket yol haritası (bağımlılık sıralı, P0→P2)

Varsayım: tek Claude builder lane; tek governed CLAUDE_REVIEWER kapısı (GOV1/GOV2, Codex yok); protected trust-root değişikliği yok; backend rotaları (Company OS, roles) mevcut/stabil; renderer-only değişiklikler. WP1b (design tokens) devam ediyor; üzerine inşa edilir.

| WP | Kapsam | SC | Öncelik | Bağımlılık | Hızlı kazanım? |
|---|---|---|---|---|---|
| WP1b | Design token derinliği (fs/space/radius/elevation ölçekleri + Inter yerel bundle) | SC-01 | P0 | — (devam ediyor) | temel |
| WP2 | Cockpit premium KPI (gauge/hero/delta/drill-down, honest '—') | SC-02 | P0 | WP1b | — |
| WP3 | Company OS wiring (CRM/Finance/Legal → `/v1/company/*`) | SC-15 | P0/P1 | — (backend hazır) | **EVET (en yüksek değer)** |
| WP4 | Control Tower 2D kampüs bağlama + liste fallback + `/v1/roles` catalog beslemesi | SC-12 | P1 | WP1b (token) | **EVET (modül hazır)** |
| WP6 | Workforce 599-rol katalog + 4 view + 10-tab Inspector (`/v1/roles`) | SC-08 | P1 | — (backend hazır) | **EVET** |
| WP7 | Birleşik docked Inspector + Command Center (Ctrl+K konsol) | SC-01, SC-07 | P1 | WP1b | — |
| WP5 | Control Tower 3D + GPU algılama + 2D fallback anahtarı | SC-12 | P1 | WP4 | — (ilk .exe DIŞI) |
| WP8 | Delivery&SRE üst ekranı + Security SOC + Claude review yüzeyi | SC-11, SC-09, SC-10 | P1 | WP1b | kısmi |
| (P2) | Journey lifecycle görseli / Ops yüzeyi / Settings-Onboarding | SC-04, SC-16, SC-17 | P1/P2 | WP1b | — |
| (P2) | BA/Plan Studio / Knowledge Center / RE Lab (backend UNKNOWN) | SC-05,06,14,18 | P2 | backend owner/contract | — (gated) |

Her WP'nin bağımsız Claude review (read-only, exact commit) + VR/DPI(100/125/200/400%, 1280/1366/1920/4K)/TR-overflow/keyboard-a11y/reduce-motion/forced-colors kabul koşulu vardır; honesty (fabricated-data taraması negatif, state ayrımı) zorunludur.

Bağımlılık grafiği (metin): WP1b → {WP2, WP4, WP7, WP8}; WP3 ve WP6 bağımsız (backend hazır, token'dan etkilenir ama bloklamaz); WP4 → WP5. İlk .exe kritik yolu: **WP1b → WP2** paralel/ardışık **WP3**, sonra **WP4** (tek lane'de ardışık).

---

## 6. İlk güncellenmiş UASCO.exe — kapsam ve ETA (P50/P80/P95)

Kapsam (talep): **premium Founder Cockpit (WP2) + Global Shell polish (WP1b) + hızlı-kazanım gerçek-veri bağlamaları (WP3 Company OS + WP6/WP4 kataloğu) + Control Tower 2D (WP4)**. **3D (WP5) HARİÇ.**

İlk .exe için önerilen minimal kritik yol = **WP1b + WP2 + WP3 + WP4** (gerekirse WP6 kataloğu ikinci artıma). Ham iş (tek lane): WP1b kalan ~1-2 + WP2 2-3 + WP3 3-5 + WP4 3-4 = **~9.5-14.5 iş günü ham**, üzerine review/VR/DPI/a11y döngüleri + build/imza + Founder onay tamponu.

Önceki denetimin kendi H-1 bulgusu, G bölümündeki P50=8'in tek-lane ham tabanla (9.5) matematiksel çeliştiğini tespit etti. Bu rapor düzeltilmiş, dürüst tahmini benimser:

- **P50 ≈ 12 iş günü** (~2.5 takvim haftası)
- **P80 ≈ 16 iş günü** (~3.5 takvim haftası)
- **P95 ≈ 22 iş günü** (~4.5 takvim haftası)

(Yani P50 ≥ ham alt sınır + review/build/onay tamponu; tek lane varsayımıyla tutarlı.)

UNKNOWN kapılar (gerçekleşirse P80/P95'e kayar, dürüstçe işaretli):
- Windows kod imzalama / installer ortamı hazır DEĞİLSE: **+2-4 iş günü** (UNKNOWN).
- Founder onay kuyruğu gecikmesi (protected trust-root veya scope onayı gerekirse): UNKNOWN.
- Company OS backend rotaları beklenenden farklıysa / catalog read-model 2D'yi beslemek için ek backend iş gerektiriyorsa: UNKNOWN.
- Governed review (GOV1/GOV2) tur sayısı > 1 ise her tur +1-2 gün.

---

## 7. Korunacak sınırlar ve dürüstlük teyidi (beyan)

- Tek Windows Desktop / tek repo; ikinci app veya ikinci otorite YOK.
- KORUNUR (yeniden yazılmaz): Work OS, Trust Kernel, Project Memory, Claude bağlantısı, QA/Güvence, Delivery. App rewrite YOK; tüm WP'ler renderer-only ek/bağlama ve mevcut owner API tüketimi.
- SAHTE VERİ YOK: KPI/worker/mission/test/review/invoice yalnız gerçek owner + zaman + state; veri yoksa EMPTY/UNAVAILABLE/NOT_VERIFIED/'—'. Role(599) ≠ live worker; NOT_RUN ≠ PASS; onay ≠ PRODUCT_VERIFIED; taslak invoice ≠ PAID.
- 3D asla gerçek veri olmadan "çalışıyor" gösterilmez; GPU yoksa/reduce-motion'da 2D eşit işlevli fallback zorunlu; 3D/2D salt-okunur projeksiyon, ikinci komut otoritesi değil; STOP_ALL backend seviyesinde UI'dan bağımsız.
- TEST profil izolasyonu korunur (Founder gerçek kurulumuna / `%APPDATA%/UASCO`'ya dokunulmaz).
- Sınırlı, bağımsız review'lu paketler; her WP governed CLAUDE_REVIEWER (Codex yok) kapısından geçer.
- Protected trust-root: bu WP'ler trust-root'a dokunmaz; FA-V2-PRODUCT protected-dosya listesi supervisor-owned'dır (burada tam liste UNKNOWN) — herhangi bir örtüşme çıkarsa normal build modunda değiştirilemez, Founder onayı gerekir.
- Blueprint §8 kuralı: Claude gerçek owner/contract bulmadan endpoint/entity adı icat etmez; backend UNKNOWN ekranlar (SC-05/06/14/18 ve SRE/security-scan) için UI, sözleşme netleşene kadar üretilmez.
