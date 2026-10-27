<!-- //TR: Bu belge Lane A tarafından P0-REMAINDER-AUDIT (INV-17) için üretilmiş, kanıta dayalı bir denetimdir; üretim veya test kodu değiştirmez, hiçbir test kaydı yapmaz. Alan adları (a–g) İngilizce bırakılmıştır; makine-okunur karşılığı LANE-A-P0-REMAINDER-AUDIT.json dosyasıdır. -->
# LANE-A P0 remainder audit (INV-17)

Durum: **TESTED (Linux) kanıtı toplandı; INTEGRATED değil, PRODUCT_ACCEPTED değil.** Bu belge bir kabul/onay değildir; implementer onaylamaz.

## Kapsam ve yöntem

- Satırlar (19): UI-001, 005, 006, 007, 008, 009, 010, 011, 022, 026, 028, 030, 053, 076, 113, 115, 124, 125, 134 (docs/planning/BACKLOG_CHECKPOINT.json görevi `P0-REMAINDER-AUDIT`).
- Denetlenen taban: `origin/v7/integration` @ `459205c` (temiz ağaç). Denetim temeli (eski CSV): `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv`, temel commit `e12dbdd` (v7/integration'ın atasıdır; 1116 commit sonrası).
- **(a) Spec kaynağı notu:** orijinal ec105b7 tabanlı dosyalar (`SCREEN_TRACEABILITY_252_PLUS.csv`, `AUDIT_252_GAP_REPORT.md`; BACKLOG_CHECKPOINT'te `origin/v6/pkg-t4-…@9dbb708`) bu depoda YOKTUR ve ilgili uzak dal alınamadı; satır metni bunun yerine 2026-10-19 CSV'sinden (`requirement_ref`, `missing_functions`) alınmıştır. Tasarım paketi ve UX-DEC metinleri UNKNOWN_SOURCE'tur (`docs/inventory/2026-10-19/raw/ux-decisions.csv` yalnız kısa başlıklar taşır).
- **(c) Testler:** ilgili 28 test dosyası tek koşuda çalıştırıldı: `npx vitest run <28 dosya> --reporter=json` => **1444 geçti / 0 kaldı / 0 atlandı** (28 dosya). Çalıştırılan 28 dosya: `tests/v7-b4-desktop-shell.test.ts`, `tests/v7-b5-work-screens.test.ts`, `tests/v7-b6a-control-tower.test.ts`, `tests/v7-int-r3-desktop.test.ts`, `tests/v7-m1a-desktop.test.ts`, `tests/v7-ps1a-project-studio.test.ts`, `tests/v7-ps1b-project-studio-ui.test.ts`, `tests/v7-ps1b-relpath-canonical.test.ts`, `tests/v7-sbx8-agent-config.test.ts`, `tests/v7-ux-academy.test.ts`, `tests/v7-ux-executive.test.ts`, `tests/v7-ux-inbox.test.ts`, `tests/v7-ux-install.test.ts`, `tests/v7-ux-journey.test.ts`, `tests/v7-ux-matrix.test.ts`, `tests/v7-ux-operations.test.ts`, `tests/v7-ux-posture.test.ts`, `tests/v7-ux-queue.test.ts`, `tests/v7-ux-readiness.test.ts`, `tests/v7-ux-settings.test.ts`, `tests/v7-ux-shell.test.ts`, `tests/v7-ux-vp-visual-parity.test.ts`, `tests/v7-ux-wp-agents.test.ts`, `tests/v7-ux-wp-projects.test.ts`, `tests/v7-ux-wp-workos.test.ts`, `tests/v7-ux-wp2-cockpit.test.ts`, `tests/v7-ux-wp3-company.test.ts`, `tests/v7-ux-wp4-tower.test.ts`. Satır başına adı geçen testler bu koşunun sonucundan birebir başlık eşleşmesiyle alındı; hiçbir geçiş çıkarım değildir. Bir testin geçmesi, gerçek masaüstü derlemesinde çalıştığı anlamına gelmez: test sahte `ctx.api` veya sahte köprü kullanıyorsa kanıt yalnız renderer davranışıdır (bkz. UI-011).
- **(d) Birleşmiş PR kapsaması:** karar commit başlığına değil diff/kod kanıtına dayanır (`git log e12dbdd..origin/v7/integration -- <dosyalar>` + dosya:satır grep). CSV'deki PR sha'larının atalığı `git merge-base --is-ancestor` ile denetlendi; tek istisna #46 (`f5800aa`): v7/integration'ın atası DEĞİLDİR, ama aynı değişiklik #170 üzerinden (merge `dac391d` / commit `3a52348`, `459205c`'nin atası) girmiştir (+/- satırları özdeş, yalnız test, +176) — yani 'ported via #170, audited'. UI-010'un CSV satırı #46'yı değil #40@6089bc8 ve #44@153cf24'ü listeler; UI-022'ninki #46@f5800aa'yı listeler.
- **(f) Kanıt sınıfı** (INTEGRATED / PRODUCT_ACCEPTED'dan ayrıdır): CODE_PRESENT / TEST_PASS_LINUX / NOT_VERIFIED / SPEC_MISSING. Piksel/tasarım eşliği ve gerçek masaüstü uygulaması **NOT_VERIFIED_LOCAL_ONLY**'dir (referans tasarımlar depoda yok); tahmin edilmedi. Tarih veya durum uydurulmadı. a alanındaki 'PARAPHRASE:' ön eki, metnin kaynaktan birebir alıntı değil, özet/yeniden ifade olduğunu gösterir.

## Sayım (satır başına)

- Gerçek, kanıtlı kalan delta (UNKNOWN / NOT_VERIFIED_LOCAL_ONLY / SERVER_LIMIT dışında en az bir madde) olan satır: **12** — UI-005, UI-007, UI-008, UI-009, UI-011, UI-026, UI-030, UI-113, UI-115, UI-124, UI-125, UI-134.
- Bunlardan takip görevi veya engel kaydı olan: **11** satır — UI-005 (M), UI-007 (S, UI-124 ile paylaşılır), UI-008 (M), UI-009 (L), UI-011 (BLOCKED_ON_FOUNDER #242: COORD protected batch 4b, korumalı `apps/desktop/main.mjs` + `apps/control-api/src/server.ts`), UI-026 (S), UI-030 (S), UI-115 (M), UI-124 (M), UI-125 (S), UI-134 (S, UI-030 ile paylaşılır). Ayrı görev/engel sayısı: 9 (UI-007+UI-124 tek S görev, UI-030+UI-134 tek S görev).
- Delta var ama görev önerilemiyor (kaynak/anlam spec'te yok): **1** satır — UI-113 (blast-radius verisi hiçbir okuma modelinde yok; tasarımdaki anlamı depoda yok).
- Kod + Linux testleriyle kapsanmış görünen (kalan yalnız UNKNOWN / NOT_VERIFIED_LOCAL_ONLY / SERVER_LIMIT): **7** satır — UI-001, UI-006, UI-010, UI-022, UI-028, UI-053, UI-076.
- Spec metni depoda eksik olan (SPEC_MISSING: en az bir delta maddesi 'UNKNOWN / not in repo' diye işaretli veya f/e alanında SPEC_MISSING / 'UNKNOWN: which scopes…' gibi açık spec belirsizliği yazılı): **17** satır — UI-001, UI-005, UI-006, UI-007, UI-008, UI-009, UI-010, UI-011, UI-022, UI-026, UI-030, UI-076, UI-113, UI-115, UI-124, UI-125, UI-134 (15 satırın e maddesinde literal 'UNKNOWN: spec not in repo' geçer; UI-030 f alanında per-agent grid için SPEC_MISSING taşır; UI-124 e maddesinde 'UNKNOWN: which scopes the design means' taşır). Ek olarak 19 satırın TAMAMI için piksel/tasarım eşliği NOT_VERIFIED_LOCAL_ONLY'dir.
- Kanıt sınıfı (f): TEST_PASS_LINUX 15, CODE_PRESENT 4 (UI-005, UI-007 ve UI-124: davranışı çalıştıran test yok; UI-011: analiz adımı yalnız renderer'da, masaüstü derlemesinde BLOCKED), NOT_VERIFIED 0 (SPEC_MISSING satır sınıfı değil, madde düzeyinde kullanıldı: bkz. e).
- 'Canlı' tanımı: QUEUED, sunucunun aktif-işçi kümesinde (`core/workos/run-state.ts:24`) YOKTUR ve ayrı 'bekleyen (henüz çalışmıyor)' kovasıdır; renderer'ın canlı kümesinde (`work-core.js:28`) bulunması canlı bir işçi olduğu anlamına gelmez (bkz. UI-030 / UI-134).

## Özet tablo

| id | title (CSV) | route | f | gerçek delta | takip (size) |
|---|---|---|---|---|---|
| UI-001 | Kurucu Kontrol Paneli | #/home | TEST_PASS_LINUX | 0 | NONE (NONE) |
| UI-005 | Bildirim Akışı | shell-only (no route; routes.js has no notifications entry) | CODE_PRESENT | 1 | UI-005: Notification Feed view (history + filters) and behavioural she (M) |
| UI-006 | Karar & Onay Kutusu | #/inbox | TEST_PASS_LINUX | 0 | NONE (NONE) |
| UI-007 | Acil Durdur & Durum | shell (all routes) + #/tower | CODE_PRESENT | 1 | UI-007 + UI-124 (shared): behavioural test that drives #stopConfirm th (S) |
| UI-008 | Global Komut Paleti | shell-only (no route) | TEST_PASS_LINUX | 1 | UI-008: extend palette with confirmed command actions (resume, new pro (M) |
| UI-009 | Şirket & Ürün Portföyü | #/projects | TEST_PASS_LINUX | 2 | UI-009: decide Company/Product grouping source (data-model decision: c (L) |
| UI-010 | Yeni Proje Stüdyosu | #/projects | TEST_PASS_LINUX | 0 | NONE (NONE) |
| UI-011 | Proje Yolculuğu | #/journey (routes.js:27, component 'journey' via planned.js; CSV's #/projects is stale) | CODE_PRESENT | 1 | BLOCKED_ON_FOUNDER (#242): COORD protected batch 4b - allow-list + ser (BLOCKED) |
| UI-022 | Proje Kaynak & Git | #/projects (Project Studio workspace, tabs files / changes / delivery) | TEST_PASS_LINUX | 0 | NONE (NONE) |
| UI-026 | Görev Ayrıntı Inspector | #/work (apps/desktop/renderer/routes.js:19; inspector is an in-view panel in mission detail, no separate route) | TEST_PASS_LINUX | 3 | UI-026: show the task's linked runs in the inspector 'Run link' row (r (S) |
| UI-028 | 599 Uzman Rol Kataloğu | #/workforce (routes.js:20) | TEST_PASS_LINUX | 0 | NONE (NONE) |
| UI-030 | Aktif Worker Filosu | #/workforce (routes.js:20) | TEST_PASS_LINUX | 3 | UI-030: align fleet/live-run status set with the server active-worker  (S) |
| UI-053 | 2D Kontrol Kulesi | #/tower (routes.js:23) | TEST_PASS_LINUX | 0 | NONE (NONE) |
| UI-076 | Sistem Ayarları | #/settings (routes.js:39) | TEST_PASS_LINUX | 0 | NONE (NONE) |
| UI-113 | Onay Gerekiyor | #/inbox (routes.js:24) | TEST_PASS_LINUX | 1 | NONE (NONE) |
| UI-115 | Tasarım Sistemi | cross-cutting (no route of its own; routes.js:17-39 has no design-system route) | TEST_PASS_LINUX | 1 | UI-115: read-only Design System reference route (token swatches from s (M) |
| UI-124 | Acil Durdur Onayı ve Etki Alanı | #/tower (routes.js:23) plus the global top-bar Stop button, banner and dialog (every route) | CODE_PRESENT | 4 | B2-UI-124: Stop dialog shows live impact counts (active runs, blocked  (M) |
| UI-125 | Brownfield Repo İçe Aktarma | #/projects (routes.js:18); the same importPanel is also embedded in the project workspace (studio-workspace.js:10) | TEST_PASS_LINUX | 1 | UI-125: show agent-config quarantine evidence (count, truncated, store (S) |
| UI-134 | 599 Rol / Gerçek Worker Ayrımı | #/workforce (routes.js:20) | TEST_PASS_LINUX | 2 | Shared with UI-030 follow-up: align live-run status set with the serve (S) |

## Satır dışı (çapraz) bulgular

- UI-030 + UI-134: renderer 'canlı' durum kümesi (`work-core.js:28,:605` QUEUED/LEASED/STARTING/RUNNING/VERIFYING/REVIEWING) sunucunun aktif-işçi kümesiyle (`core/workos/run-state.ts:24` LEASED/RUNNING/CHECKPOINTING/VERIFYING) uyuşmuyor; STARTING ve REVIEWING `RunStatus` değil (`core/workos/types.ts:72-74`).
- UI-030: filo kartındaki heartbeat `heartbeatAt` okur (`work-core.js:523`) ama `GET /v1/work-runs` bunu göndermez; testler yalnız fixture'da taşıdığı için geçer.
- UI-026: denetçideki 'Run link' satırı sabit UNKNOWN (`views/work.js:315`, `tests/v7-b5-work-screens.test.ts:1071` ile sabitlenmiş) oysa hemen altındaki görev-koşu paneli bağları okuyor; `docs/ux/UI-026-TASK-INSPECTOR.md` 9-10. satırlar bayat.
- UI-125: sunucu içe aktarma yanıtı `agentConfigQuarantine` taşır (`server.ts:405`) ama başarı yolu yalnız 'Import request accepted' der (`studio-wizard.js:121`).
- Uç nokta kayması: CSV'de birçok satır `GET /v1/founder-attention` listeler; `api.attention()` artık `GET /v1/attention` okur (`api.js:57-59`) — b alanında güncel yol yazıldı.
- UI-011: analiz adımı / plan oluştur (`POST /v1/missions/:id/analysis/step|plan`) gerçek masaüstü derlemesinde ENGELLİ: `apps/desktop/main.mjs:159-168` POST_ROUTE_RES'te analiz girdisi yok ve `apps/control-api/src/server.ts` `routes/analysis.ts` kaydetmez; `tests/v7-b5-work-screens.test.ts:2802-2810` bunu kendisi doğrular ('not allow-listed yet' / 'not enabled in this build'). Gerekli: korumalı `main.mjs` allow-list girdisi + korumalı `server.ts` rota kaydı = `docs/authority-requests/LANE-A-analysis-allowlist.md` (STATUS OPEN) = COORD protected batch 4b (#242), Founder kararı. Bu PR korumalı dosyaya dokunmaz.
- UI-007 + UI-124: durdur akışı `#stopConfirm` tıklaması -> `ctx.stop` -> `window.uasco.stop` yolunu çalıştıran davranışsal test yok (yalnız kaynak-regex id listeleri); iki satır aynı S test görevini paylaşır (`tests/v7-ux-shell.test.ts`).
- UI-005 / UI-115 takipleri dondurulmuş kapsam olarak ROUTES sabitleme testlerini listeler (bkz. ilgili g alanları): yeni bir rota eklemek bu testleri bilerek değiştirir.

## Satır satır (a–g)

### UI-001 — Kurucu Kontrol Paneli

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-001 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/home; action_contract: read-only; links to routes; states: loading/empty/error/ok
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-001 (missing_functions)`: 2D/3D tower hero tile and design-parity ordering unverified (design package UNKNOWN_SOURCE); Delivery KPI still stale on v7 (fix only on PR#19); product verification on real desktop app + live backend not recorded
  - `docs/inventory/2026-10-19/raw/ux-decisions.csv UX-DEC-001 / UX-DEC-067`: PARAPHRASE: UX-DEC-001 'Açılış ve Founder Cockpit' (text UNKNOWN_SOURCE); UX-DEC-067 'Unified 2D/3D Campus/Control Tower' (missing: '3D/WebGL campus + GPU detection absent')
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id.; No docs/ux/UI-001 spec file.

**b. route / views / data bindings**
  - route: #/home
  - views: `apps/desktop/renderer/views/home.js`, `apps/desktop/renderer/shell.js`, `apps/desktop/renderer/routes.js (home route, line 17)`
  - GET /v1/cockpit (home.js:96 via api.cockpit, api.js:53)
  - GET /v1/projects (home.js:96 via api.projects, api.js:54; used only for the tenant chip, home.js:97)
  - Shell refresh (shell.js:116): GET /health, /v1/projects, /v1/cockpit, /v1/control/status, /v1/missions, /v1/attention (api.js:57-59, NOT the CSV's /v1/founder-attention), /v1/runs, then GET /v1/runs/:id/events
  - IPC uasco:stop / uasco:resume (main.mjs:319-320) only via the shell Stop/Resume controls

**c. tests (Linux, executed)**
  - `tests/v7-ux-wp2-cockpit.test.ts` — file PASS 23 / FAIL 0; tests: “binds each KPI to the cockpit read model and draws bars only from returned breakdowns; one sample gives no delta or sparkline”; “KPI drill-down navigates to the existing screen by click and by Enter/Space and is keyboard focusable”; “home area map shows an honest Delivery line, never a bogus 'Planned package' dash for component routes”; “a malformed cockpit payload shows the failed note (role=status) and no KPI is VERIFIED”; “every KPI shows an em-dash and UNAVAILABLE/DOGRULANMADI when /v1/cockpit returns 404, with no delta, sparkline polyline, bars or reference numbers”; “is accessible: single focusable h1, labelled KPI group, area cards are real links, orchestrator bars carry aria-labels”
  - `tests/v7-b4-desktop-shell.test.ts` — file PASS 52 / FAIL 0; tests: “mapCockpit follows the GET /v1/cockpit contract”; “emptyCockpit (404) carries no numbers anywhere”
  - note: v7-ux-wp2-cockpit.test.ts is the home test (23/23). v7-b4 only covers the shared cockpit mapper/shell statics. v7-ux-matrix / v7-ux-operations / v7-b5-work-screens (CSV by_module candidates) test other views and are not counted. No test asserts hero tile ordering vs design, a tower tile on Home, or a run on the real desktop app.

**d. merged since audit basis (e12dbdd)**
  - `d6cc46c (merged by 6d4c5ba, PR #19)` fix(desktop): Home area map shows honest Delivery status instead of stale planned package — CSV item 'Delivery KPI still stale': diff replaces the fallthrough map.planned line with case "delivery":return ctx.t("map.delivery") (home.js:61) plus locale keys; covered by test at tests/v7-ux-wp2-cockpit.test.ts:246.
  - `8807a2a (merged by 1394bf1, PR #36)` test+states: home - show failed note for malformed cockpit body — States item (error): diff adds state=ERROR when HTTP ok but projects+missions blocks are ERROR (home.js:99-100); not a CSV delta item, closes a silent-empty-screen gap.
  - `0fa9568` UI-251: Recovery Center panel for failed views and unreachable control API — No CSV delta item. Diff touches shell.js health tab (shell.js:80) and views/planned.js, not home.js.
  - `a874abf` UI-007: require explicit confirmation before Resume — No Home delta item. Diff touches shell.js:204 (resume button) and tower.js only.
  - covered_items:
    - Delivery KPI stale -> covered: home.js:61 case "delivery" returns map.delivery ('Read-only delivery and SRE status', locales/en.js:229); routes.js delivery entry has no plannedPackage (routes.js:22); test v7-ux-wp2-cockpit.test.ts:246 passes.
  - uncovered_items:
    - 2D/3D tower hero tile: home.js renders only an area card for tower (home.js:58) and an orchestrator panel; the 2D campus map lives on #/tower (tower.js:17) and 3D is explicitly absent (locales/en.js:446 tower.map.no3d). Whether the design needs a tower tile on Home is UNKNOWN: spec not in repo.
    - Design-parity ordering and real-app/live-backend run: not recordable here (Local-only).

**e. remaining delta**
  - UNKNOWN: spec not in repo - whether Home must carry a 2D/3D tower hero tile (CSV gap) and in which order; code evidence: no tower tile in home.js (only home.js:58 area card); 3D absent (locales/en.js:446).
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** TEST_PASS_LINUX for the shipped cockpit behaviour (KPIs, drill-down, honest 404/OFFLINE/malformed states, delivery line; 23/23 in v7-ux-wp2-cockpit). Hero-tile/ordering parity = SPEC_MISSING; design parity and real-app run = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** NONE — size NONE

### UI-005 — Bildirim Akışı

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-005 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route shell (all routes); action_contract: read-only; states: empty/error
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-005 (missing_functions)`: no dedicated Notification Feed route/history/filters; only shell notification toast + right task stream tabs; product verification on real desktop app + live backend not recorded
  - `docs/inventory/2026-10-19/raw/ux-decisions.csv UX-DEC-019`: PARAPHRASE: 'Öncelikli/tekrarsız bildirim merkezi' (prioritised / de-duplicated notification centre; text UNKNOWN_SOURCE; missing: 'dedup polish unverified')
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id. What 'history' and 'filters' must contain is not specified anywhere in the repo.; No docs/ux/UI-005 spec file.

**b. route / views / data bindings**
  - route: shell-only (no route; routes.js has no notifications entry)
  - views: `apps/desktop/renderer/shell.js (bell + right feed + bottom strip)`, `apps/desktop/renderer/index.html:33,45,49 (notifyBtn, feedMount, stripList)`
  - Bell count = cockpit approvals only (shell.js:47-48) from GET /v1/cockpit (shell.js:116, api.js:53); click navigates to #/inbox (shell.js:206)
  - Feed tab 'flow' = GET /v1/missions (api.js:55, shell.js:65-73, max 10 rows); tab 'health' = GET /health + cockpit orchestrator/workforce (shell.js:75-80); tab 'agenda' = cockpit approvals items (shell.js:82-90)
  - Bottom strip = GET /v1/runs then GET /v1/runs/:id/events (shell.js:122-123, 102-111)
  - GET /v1/attention is fetched in shell.refresh (shell.js:116,118 via api.js:57-59) but data.attention is not rendered in the feed

**c. tests (Linux, executed)**
  - `tests/v7-ux-shell.test.ts` — file PASS 29 / FAIL 0; tests: “the shell exposes openInspector (the entity-row entry point) and wires it into feed rows”; “shell.js shows the panel only through shouldShowApiRecovery; sources avoid innerHTML and the forbidden claim”
  - `tests/v7-b4-desktop-shell.test.ts` — file PASS 52 / FAIL 0; tests: “syncTabs updates feed tabs in place: the focused tab keeps identity and focus; selection and arrow keys work”
  - `tests/v7-ux-wp2-cockpit.test.ts` — file PASS 23 / FAIL 0; tests: “timeline items carry time, project attribution only when given, and a status pill”
  - note: No test renders the shell feed or the bell: tests/v7-ux-shell.test.ts mkShell mounts HOST_IDS without feedMount/notifyCount/stripList (line 166), so renderFeed/renderContext bell count/renderStrip are never executed in any of the 28 files (grep feedMount|renderFeed|notifyCount in tests/*.ts = none). The listed tests are source-text checks or generic helper checks (syncTabs, timelineItem). Only feed.tab.* / notify.* locale-key parity is covered (b4 i18n tests). v7-ux-matrix/operations/b5 (CSV by_module) do not test the shell feed.

**d. merged since audit basis (e12dbdd)**
  - `0fa9568` UI-251: Recovery Center panel for failed views and unreachable control API — Diff adds shouldShowApiRecovery + recoveryPanel in the shell 'health' feed tab (shell.js:79-80) so an unreachable API shows a recovery panel; does NOT add a notification route/history/filter (CSV gap).
  - `a874abf` UI-007: require explicit confirmation before Resume — Diff changes shell.js:204 only (resume button); unrelated to the notification feed.
  - covered_items:
    - (yok)
  - uncovered_items:
    - no dedicated Notification Feed route/history/filters: still true - routes.js has no notifications route (ROUTES list, routes.js:16-40); feed tabs are fixed flow/health/agenda (shell.js:16), capped to 10 rows (shell.js:69,86), no history or filter controls; closest existing event log is the separate #/audit view (routes.js audit entry), which is a run-event log, not a notification history.

**e. remaining delta**
  - No dedicated Notification Feed route with history and filters (routes.js:16-40 has none; shell.js:16 only flow/health/agenda tabs capped at 10 rows, shell.js:69,86). Requirement text is only the CSV gap + UX-DEC-019 short title; exact scope UNKNOWN: spec not in repo.
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** CODE_PRESENT (bell + 3-tab feed + event strip exist in shell.js) - not TEST_PASS_LINUX because no test executes renderFeed/bell. Dedicated feed with history/filters = SPEC_MISSING (and absent in code); design parity/real app = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** UI-005: Notification Feed view (history + filters) and behavioural shell tests for bell/feed - spec-first (needs Founder/design input for scope) | Frozen scope - existing exact ROUTES pins that break when routes.js gains an id: ALWAYS tests/v7-b4-desktop-shell.test.ts:75 and tests/v7-ps1b-project-studio-ui.test.ts:619 (full-array equality); slice(-15) pins when the id is appended or inserted inside the last 15 ids: tests/v7-ux-executive.test.ts:876, tests/v7-ux-journey.test.ts:564, tests/v7-ux-matrix.test.ts:1008, tests/v7-ux-operations.test.ts:1101, tests/v7-ux-posture.test.ts:1052, tests/v7-ux-queue.test.ts:911, tests/v7-ux-readiness.test.ts:1116; tail pins when the id is appended after 'settings' or lands in the last 6: tests/v7-ux-matrix.test.ts:1266 (slice(-4)) and tests/v7-ux-operations.test.ts:1201 (slice(-6)). Inserting before the last 15 ids touches only the first two. — size M; files: `apps/desktop/renderer/routes.js`, `apps/desktop/renderer/views/planned.js (component delegation)`, `apps/desktop/renderer/views/notifications.js (new)`, `apps/desktop/renderer/notifications-core.js (new)`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `tests/v7-ux-shell.test.ts`, `tests/v7-b4-desktop-shell.test.ts:75`, `tests/v7-ps1b-project-studio-ui.test.ts:619`, `tests/v7-ux-executive.test.ts:876`, `tests/v7-ux-journey.test.ts:564`, `tests/v7-ux-matrix.test.ts:1008`, `tests/v7-ux-operations.test.ts:1101`, `tests/v7-ux-posture.test.ts:1052`, `tests/v7-ux-queue.test.ts:911`, `tests/v7-ux-readiness.test.ts:1116`, `tests/v7-ux-matrix.test.ts:1266 (only if appended after settings)`, `tests/v7-ux-operations.test.ts:1201 (only if appended after settings)`

### UI-006 — Karar & Onay Kutusu

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-006 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/inbox; action_contract: POST /v1/missions/:id/transition (allowlisted); states: empty/pending/error
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-006 (missing_functions)`: decision-detail card parity vs design unverified; no bulk actions (by design); product verification on real desktop app + live backend not recorded
  - `docs/ux/UI-113-APPROVAL-REQUIRED.md`: PARAPHRASE: Per mission awaiting approval: risk level; pending transition with 'Irreversible' / 'High risk' flags; linked work run; waiting-since; 'If approved' / 'If rejected' text. Blast radius / impact is always shown as UNKNOWN, because the data has no such field.
  - `docs/inventory/2026-10-19/raw/ux-decisions.csv UX-DEC-019 / UX-DEC-020`: PARAPHRASE: UX-DEC-019 'Öncelikli/tekrarsız bildirim merkezi'; UX-DEC-020 'Kapsama bağlı Founder Approval' (texts UNKNOWN_SOURCE)
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id. The 'decision-detail card' content list from the design is not in the repo (docs/ux/UI-113 is the only in-repo behaviour spec and it says design match is unverified).

**b. route / views / data bindings**
  - route: #/inbox
  - views: `apps/desktop/renderer/views/inbox.js`, `apps/desktop/renderer/work-core.js (deriveInbox:585, requiresConfirm:45, buildTransitionRequest)`, `apps/desktop/renderer/work-actions.js (performTransition:10)`, `apps/desktop/renderer/approval-core.js`
  - GET /v1/cockpit (inbox.js:179 via api.cockpit)
  - GET /v1/attention (inbox.js:179 via api.attention, api.js:57-59; the CSV's /v1/founder-attention is no longer read here)
  - GET /v1/missions (inbox.js:179 via api.allMissions, api.js:70)
  - GET /v1/work-runs and GET /v1/work-runs/:id (inbox.js:179,187 via api.workRuns/workRunDetail, api.js:74,78)
  - POST /v1/missions/:id/transition (work-actions.js:25 via ctx.api.post; allow-listed at main.mjs:159; only from the click handler inbox.js:49; COMPLETE/AUTHORIZED need ctx.confirm, work-actions.js:15-21)

**c. tests (Linux, executed)**
  - `tests/v7-ux-inbox.test.ts` — file PASS 47 / FAIL 0; tests: “keeps the two real decision kinds in order and offers COMPLETE only for a PRODUCT_VERIFIED run”; “accept (COMPLETE) requires the confirm dialog before it POSTs the transition; the view itself never calls api.post”; “a NOT_VERIFIED run hides COMPLETE and explains why (never Verified without proof)”; “renders irreversible/high-risk text, run + status, <time datetime>, approve/reject text and UNKNOWN impact”; “performs no POST: buttons only focus the existing approval card; request list unchanged”; “renders each item in severity order with its kind, next action, reason and time (read-only, no write controls); the six kinds are separate counters”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “accept requires the confirm dialog then POSTs COMPLETE; reject needs a reason and goes to BLOCKED (REMEDIATING is not allowed from REPORTING)”; “derives the inbox from missions + runs: REPORTING+AWAITING_APPROVAL and FOUNDER_ATTENTION_REQUIRED only; nothing auto-approved”; “allows exactly the four fixed POST routes with strict mission ids”
  - note: tests/v7-ux-inbox.test.ts (47/47) is the inbox test; v7-b5-work-screens.test.ts (169/169) is mostly Work/Projects screens - only the 'Gelen Kutusu screen', inbox derivation and POST allow-list tests concern this row. v7-ux-executive/install/matrix/operations/posture/queue/readiness (CSV candidates) test other views and are not counted. Not covered: decision-card layout vs design, impact/blast-radius (always UNKNOWN by design), real approve/reject against a live backend.

**d. merged since audit basis (e12dbdd)**
  - `2e3e75f` UI-113: Approval-required state panel on #/inbox (renderer-only) — CSV item 'decision-detail card parity': diff adds the #inbox-required panel (inbox.js:140-176, approval-core.js) with risk, pending transition + irreversible/high-risk flags, linked run, waiting-since, if-approved/if-rejected, impact=UNKNOWN. It adds detail facts next to the card; it does not change decisionCard (inbox.js:45-59).
  - `325c09e, bbafa45, 74a6bfc` LANE-A: Founder attention queue UI on GET /v1/attention (+ #192 review fixes, re-verify LOWs) — Diff changes only the attention panel/summary of inbox.js (inbox.js:18-19,112-138) and api.attention; no change to decision cards or transition POST path.
  - `632a774` UI-105: route-titled, number-free loading skeleton — Diff adds inbox.js:198 skeleton re-export only (loading state).
  - `all other non-merge commits from `git log e12dbdd..origin/v7/integration` over the work-view files for this row (e.g. f32bcd1, a153c7f, 3b7b5ac, 2372ae5, 72510d4, 5ce69df, f382693, 4a2b749, bccc2bf, 88cfe35)` Work-view / run / task features — git diff e12dbdd..HEAD of work-core.js and work-actions.js contains no change to deriveInbox, buildTransitionRequest, requiresConfirm or performTransition (grep of the diff returned only import and new-function lines); they affect #/work, not the decision card.
  - covered_items:
    - Decision-detail facts (partial): inbox.js:140-176 + docs/ux/UI-113-APPROVAL-REQUIRED.md; tests 'UI-113 - Approval required panel on #/inbox' (9 tests) pass. Whether this equals the design's detail card is unknowable here.
  - uncovered_items:
    - Decision-detail card parity vs design: not measurable (design package UNKNOWN_SOURCE).
    - Bulk actions: absent by design (inbox.js:48-49 per-mission buttons only; inbox.noAuto locales/en.js:835 'Nothing is auto-approved').

**e. remaining delta**
  - UNKNOWN: spec not in repo - what the design's decision-detail card must show beyond inbox.js:45-59 + 140-176; impact/blast radius is a fixed UNKNOWN (inbox.js:162) because no read model has the field (docs/ux/UI-113-APPROVAL-REQUIRED.md).
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** TEST_PASS_LINUX for approve/reject/derive/confirm/honest-state behaviour (47/47 inbox + 5 inbox tests in b5). Detail-card design parity = SPEC_MISSING / NOT_VERIFIED_LOCAL_ONLY; real-app run = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** NONE — size NONE

### UI-007 — Acil Durdur & Durum

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-007 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route shell (all routes); action_contract: POST /v1/control/stop|resume via main-process confirm; states: stopped/running/error
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-007 (missing_functions)`: design parity unverified; resume confirmation flow not product-exercised; product verification on real desktop app + live backend not recorded
  - `docs/planning/BACKLOG_CHECKPOINT.json task UI-007 (status DONE, notes)`: Resume ... fires ctx.resume() immediately from both the shell banner button and the Control Tower button ... The fix reuses the existing ctx.confirm dialog. There is no IPC, endpoint or POST change.
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id.; The phrase 'via main-process confirm' (CSV action_contract) is not defined anywhere in the repo.

**b. route / views / data bindings**
  - route: shell (all routes) + #/tower
  - views: `apps/desktop/renderer/shell.js (stop banner/dialog: 50-56,196-204)`, `apps/desktop/renderer/views/tower.js (stopCard 60-62)`, `apps/desktop/renderer/resume-confirm.js`, `apps/desktop/renderer/control-tower/mount.js`, `apps/desktop/renderer/control-tower/render-svg.js`, `apps/desktop/renderer/app.js:30-32 (ctx.requestStop/stop/resume, ctx.confirm)`
  - GET /v1/control/status (api.js:56; shell.js:116, tower.js:16) -> banner/stopState
  - IPC uasco:stop (shell.js:203 -> app.js:31 -> main.mjs:319 -> POST /v1/control/stop) and uasco:resume (resume-confirm.js:12 -> app.js:32 -> main.mjs:320 -> POST /v1/control/resume)
  - tower.js:16 reads: /health, /v1/phase0, /v1/install, /v1/scheduler, /v1/agents, /v1/capabilities, /v1/adapters, /v1/retry, /v1/runs, /v1/attention, /v1/control/status, /v1/cockpit, /v1/roles, /v1/work-runs; run drill-down GET /v1/runs/:id/events and /logs (tower.js:50-53)

**c. tests (Linux, executed)**
  - `tests/v7-ux-shell.test.ts` — file PASS 29 / FAIL 0; tests: “confirm=true: resume called once only after the dialog resolves; re-entry guard blocks a second click”; “confirm=false: no resume and confirm.cancelled is announced”; “missing ctx.confirm: fails closed, no resume”; “STOP_ALL from the palette reuses the EXISTING stop dialog + confirmation and adds NO write/side-effect”
  - `tests/v7-ux-wp4-tower.test.ts` — file PASS 41 / FAIL 0; tests: “shows verified health and wires Stop/Resume buttons to the context”; “Resume is not called when confirm resolves false or ctx.confirm is missing (fail-closed)”; “marks a stopped system from /v1/control/status”; “marks the whole campus STOPPED with an alert overlay when cockpit.globalStop is active, and falls back to /v1/control/status when the cockpit is absent”
  - `tests/v7-b6a-control-tower.test.ts` — file PASS 14 / FAIL 0; tests: “draws the GLOBAL_STOP overlay only while stopped and escapes the reason”
  - `tests/v7-b4-desktop-shell.test.ts` — file PASS 52 / FAIL 0; tests: “has a role=alert element inside the top-bar actions next to ACIL DURDUR, shown on failure, cleared on retry/success, and still announced”
  - note: Resume confirmation is behaviourally tested for both entry points (shell banner and tower). Stop-dialog confirm -> ctx.stop -> window.uasco.stop and the visible stop-failure alert are only asserted by source-regex checks (b4 lines 355, 534-537), not by executing shell.js stopConfirm/renderStop (stopConfirm click never fired in any test). v7-ux-operations (CSV by_module) tests the separate #/operations view. No test of the banner show/hide on control state.

**d. merged since audit basis (e12dbdd)**
  - `a874abf` UI-007: require explicit confirmation before Resume (shell banner and Control Tower) — CSV item 'resume confirmation flow': diff adds resume-confirm.js (confirmAndResume: ctx.confirm must resolve true, fail-closed when ctx.confirm is absent, re-entry guard), rewires shell.js:204 and tower.js:62, adds resume.confirm.* locale keys and tests in v7-ux-shell.test.ts and v7-ux-wp4-tower.test.ts.
  - `f5ba397 (merged by a254634, PR #34)` test+states: tower (functional/negative/a11y) — Diff changes only the run drill-down in tower.js (loading text and logs error state, tower.js:50-53); stop/resume card (tower.js:60-62) unchanged.
  - `50f560e, eee87b3 (UI-194), 005b1b7, cb7c1c7 (UI-226), bbafa45` Tower retry fact, stage timeline, attention notes — Diffs change tower.js retryFact / renderTrace / attention panel (+attention-notes), via retry-core.js and trace-core.js; not the Stop/Resume card (tower.js:60-62).
  - `0fa9568` UI-251: Recovery Center panel — Adds recovery panel in shell health tab (shell.js:80); stop/resume controls unchanged.
  - covered_items:
    - resume confirmation flow: resume-confirm.js:3-14, shell.js:204, tower.js:62; tests v7-ux-shell 'UI-007 Resume confirmation in the shell stop banner' (3) and v7-ux-wp4-tower 'Resume is not called when confirm resolves false...' pass. Only the 'not product-exercised' part (real app) stays open.
  - uncovered_items:
    - Design parity and real-app/live-backend run of stop/resume: Local-only.
    - 'main-process confirm': both Stop (index.html:53 <dialog id=stopDialog>) and Resume (app.js:49 confirmDialog) confirm in the renderer; main.mjs:319-320 handlers add no second confirm (main.mjs uses dialog only for showOpenDialog/showSaveDialog, lines 287,311). Whether the design wants a native main-process dialog is UNKNOWN: spec not in repo.

**e. remaining delta**
  - Test gap (same as UI-124): the stop path #stopConfirm click -> ctx.stop -> window.uasco.stop has no behavioural test (grep finds #stopConfirm only in HOST_IDS id lists: tests/v7-ux-shell.test.ts:166 and tests/v7-b4-desktop-shell.test.ts:326; app.js:31 stop() is checked by source regex only). The stop-failure alert is untested the same way.
  - UNKNOWN: spec not in repo - CSV action_contract says 'via main-process confirm'; code confirms in the renderer only (index.html:53, app.js:49, resume-confirm.js:8) and main.mjs:319-320 performs no confirmation.
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** CODE_PRESENT for the stop path (#stopConfirm -> ctx.stop -> stop IPC is not exercised by any test; source-regex only). TEST_PASS_LINUX for the stop dialog open paths, resume confirmation fail-closed and stopped-state rendering. Design parity and real-app resume run = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** UI-007 + UI-124 (shared): behavioural test that drives #stopConfirm through ctx.stop to window.uasco.stop (success and failure alert) — size S; files: `tests/v7-ux-shell.test.ts`

### UI-008 — Global Komut Paleti

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-008 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route shell (all routes); action_contract: client-side nav; states: empty/results
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-008 (missing_functions)`: Ctrl+K is search/navigation only; no command palette actions (commands, run/stop, create); product verification on real desktop app + live backend not recorded
  - `apps/desktop/renderer/shell.js:129 (in-code TR design note)`: PARAPHRASE: UX WP-SHELL-REFINE: Ctrl+K komut paleti. Mevcut 'aramayla gezin' KALDIRILMAZ; üzerine gruplu bir EYLEMLER bölümü eklenir: her rota için 'git', geçerli seçim için Inspector aç ve global STOP_ALL.
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; No UX-DEC in docs/inventory/2026-10-19/raw/ux-decisions.csv has a palette/command title; which commands the design requires is UNKNOWN_SOURCE.; No docs/ux/UI-008 spec file.

**b. route / views / data bindings**
  - route: shell-only (no route)
  - views: `apps/desktop/renderer/shell.js (palette: 128-193, Ctrl+K handler 210)`, `apps/desktop/renderer/index.html:18-19 (searchInput combobox)`, `apps/desktop/renderer/model.js:134 (searchEntries)`
  - Client-side only: result entries come from shell state loaded by shell.refresh (shell.js:116): GET /v1/projects and GET /v1/missions (api.js:54-55); goto = ctx.navigate; inspect = createInspector (read via already allow-listed GETs); stopall = openStopDialog (shell.js:161,196)
  - No palette-specific endpoint or IPC; the palette itself writes nothing (test 'adds NO write/side-effect')

**c. tests (Linux, executed)**
  - `tests/v7-ux-shell.test.ts` — file PASS 29 / FAIL 0; tests: “empty palette (Ctrl+K / focus) lists the ACTIONS group: go-to-view for all 10 routes, open-inspector for the current selection, and global STOP_ALL”; “typing still navigates to real projects/missions (search-to-navigate preserved) under a Results group”; “arrow/enter keyboard navigation selects and runs an action (go-to-view navigates)”; “STOP_ALL from the palette reuses the EXISTING stop dialog + confirmation and adds NO write/side-effect”; “open-inspector action opens the drawer for the current selection and loads real detail via an allow-listed GET”; “palette.* and inspector.* keys are identical in TR and EN, and every static key used exists in both”
  - note: All six palette tests pass (29/29 file). The document-level Ctrl/Cmd+K keydown handler (shell.js:210) is not exercised: no ctrlKey/metaKey in any test; tests fire the input 'focus' event instead. Other CSV by_module files (v7-b4, b5, matrix, operations, wp2-cockpit) do not test the palette.

**d. merged since audit basis (e12dbdd)**
  - `0fa9568` UI-251: Recovery Center panel — Diff adds recovery panel to the health feed tab (shell.js:80); palette code (shell.js:128-193) unchanged.
  - `a874abf` UI-007: require explicit confirmation before Resume — Diff changes shell.js:204 resume button only; palette unchanged.
  - covered_items:
    - 'no command palette actions (commands, run/stop...)' is PARTLY stale already at the audit basis: palette actions goto (shell.js:136), inspect (138-139) and global STOP_ALL (140, pick at 161) were added by 14f8212 (2026-10-16), an ancestor of e12dbdd (git merge-base --is-ancestor 14f8212 e12dbdd = true), i.e. before the CSV audit; not a post-audit merge. Tests pass (v7-ux-shell, 6 palette tests).
  - uncovered_items:
    - No Resume / Create project / Start run / Create mission palette actions: actionEntries() (shell.js:135-142) emits only goto, inspect and stopall.

**e. remaining delta**
  - No create/run/resume commands in the palette: shell.js:135-142 actionEntries() = goto per route + inspect selection + STOP_ALL only (CSV gap 'create' and 'run'). Whether the design requires them is UNKNOWN: spec not in repo; any write command would have to reuse the existing confirm flows (work-actions.js, resume-confirm.js).
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** TEST_PASS_LINUX for navigate + inspect + STOP_ALL palette behaviour; create/run commands absent in code (SPEC_MISSING whether required); design parity/real app = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** UI-008: extend palette with confirmed command actions (resume, new project, start run) reusing existing confirm paths, plus a Ctrl+K keydown test - spec-first — size M; files: `apps/desktop/renderer/shell.js`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `tests/v7-ux-shell.test.ts`

### UI-009 — Şirket & Ürün Portföyü

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-009 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/projects; action_contract: GET /v1/projects; states: empty/list
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-009 (missing_functions / dependencies)`: PARAPHRASE: no Company/Product portfolio grouping or roll-ups; project portfolio KPIs only; ... | UI-081 Company OS for company grouping
  - `docs/inventory/2026-10-19/raw/ux-decisions.csv UX-DEC-044`: PARAPHRASE: 'Company Portfolio + çok ürün' (text UNKNOWN_SOURCE); missing: 'rich multi-product switcher partial'
  - `docs/planning/BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT notes`: UI-009 (company/product portfolio grouping) has a stated gap, but the shipped matrix rollup is a command-matrix rollup and /v1/projects grouping data was not checked.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id. The meaning of 'Company' and 'Product' relative to project / tenant / customerId / CRM account is not defined in the repo.; No docs/ux/UI-009 spec file.

**b. route / views / data bindings**
  - route: #/projects
  - views: `apps/desktop/renderer/views/projects.js`
  - GET /v1/projects (projects.js:162 via api.projects, api.js:54; mapped by model.js:78-82 mapProjects)
  - GET /v1/missions (projects.js:169 via api.allMissions, api.js:70) and GET /v1/work-runs (projects.js:169 via api.workRuns, api.js:74)
  - GET /v1/projects/:id/deliveries (projects.js:171 via api.deliveries, api.js:100) for the closure panel
  - POST /v1/projects (projects.js:26 via ctx.api.post; allow-listed main.mjs:159) from the legacy 'register repository' form

**c. tests (Linux, executed)**
  - `tests/v7-ux-wp-projects.test.ts` — file PASS 30 / FAIL 0; tests: “binds portfolio KPIs to the real reads: projects, distinct environments, total missions and only ACTIVE runs”; “aggregates the portfolio status strip by lifecycle category from real mission statuses only”; “renders dense project cards: real context facts, per-project mission distribution and the latest run via mission->project mapping”; “shows UNAVAILABLE em-dash KPIs, honest state notes and no project cards when every read 404s”; “treats a malformed /v1/projects payload as ERROR: em-dash KPIs, no cards, no verified pill, no invented numbers”; “preserves the open-project flow (selectProject + workspace) and the select button pressed state”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “renders the project list and the form; submit builds a validated body with an argv array and an idempotency key via the POST bridge only”
  - note: Tests cover the flat project portfolio (KPIs, per-project cards, closure checklist, honest states). No test asserts any company/product grouping or roll-up (none exists in code). v7-ps1b-project-studio-ui.test.ts (CSV candidate) tests the wizard/workspace (UI-010/022), and v7-ux-matrix.test.ts tests the separate #/matrix command-matrix rollup, which is not evidence for portfolio grouping and is not listed.

**d. merged since audit basis (e12dbdd)**
  - `6f5cd1e` UI-132: read-only project closure and handover checklist on #/projects — Adds closurePanel (projects.js:134-150,180) with per-project closure items; no grouping/rollup by company or product.
  - `69e0881 (via d704d2d/601361e/7209f51)` LANE-A: Project Intake (UI-126) — Diff adds import + call of intakePanel (projects.js:10,176) - a new create-from-idea entry; no grouping.
  - `632a774` UI-105: route-titled loading skeleton — Adds skeleton re-export (projects.js:183) only.
  - covered_items:
    - (yok)
  - uncovered_items:
    - no Company/Product portfolio grouping or roll-ups: still true. grep -inE 'compan|product|group|portfolio|customer' in projects.js returns 2 hits (projects.js:54 and :68, both ARIA role="group" wrappers, not data grouping) and none for company/product/portfolio/customer; projects are rendered as one flat list (projects.js:128). The only company-ish element is the per-card tenantId labelled 'Company (tenant)' (projects.js:88, locales/en.js:233). KPIs are project/environment/mission/active-run counts (projects.js:51-59).

**e. remaining delta**
  - UI: no Company/Product grouping or roll-ups on #/projects - flat list only (projects.js:128 prj.items.map(projectCard)); the 'Company (tenant)' fact is a per-card label (projects.js:88, locales/en.js:233). None of the merged commits since e12dbdd (6f5cd1e, 69e0881, 632a774) changes that.
  - Data: GET /v1/projects has NO company/product grouping field. Server returns the stored Project records filtered to ONE tenant (apps/control-api/src/server.ts:218 -> core/workos/store.ts:901 listProjects(scope) filters p.tenantId === scope.tenantId; scope is one fixed tenant per server, server.ts:180). Project fields (core/workos/types.ts:16-25): projectId, orgId, tenantId, customerId?, name, repository, environmentId, createdAt, createdBy, testCommand, template, projectType, techStack, targetOS, acceptanceCriteria, budget, devCommand - no companyId/productId; orgId/tenantId are constant for all rows of a response; customerId is optional at create (schemas.ts:24) and no renderer form sets it (grep customerId in apps/desktop/renderer = none). The renderer mapper keeps only tenantId and environmentId (model.js:80) and drops orgId/customerId/projectType. The CRM accounts read (/v1/company/accounts, server.ts:510) has no project link (core/company/crm.ts has no projectId) and company-core.js/company.js do not reference projects. The matrix rollup (matrix-core.js:128) groups by project (projectId/name/environmentId), not by company/product, so it is not portfolio-grouping evidence.
  - UNKNOWN: spec not in repo - what 'Company' and 'Product' must group by (tenant? customerId? CRM account? a new product entity) and which roll-ups are required (UX-DEC-044 text UNKNOWN_SOURCE).
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** TEST_PASS_LINUX for the flat project portfolio (KPIs, cards, closure, honest states; 30/30 wp-projects). Company/Product grouping = SPEC_MISSING and not implementable from current /v1/projects data (no grouping field); design parity/real app = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** UI-009: decide Company/Product grouping source (data-model decision: customerId vs CRM account link vs product entity), then add grouped portfolio + roll-ups on #/projects — size L; files: `apps/desktop/renderer/views/projects.js`, `apps/desktop/renderer/model.js (mapProjects)`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `tests/v7-ux-wp-projects.test.ts`, `apps/control-api/src/server.ts (protected: config/protected-paths.json and trust-root-manifest.json)`, `core/workos/types.ts, core/workos/store.ts, core/workos/schemas.ts (only if a new grouping field is added; not listed in config/protected-paths.json at 459205c, but a data-model/authority decision)`

### UI-010 — Yeni Proje Stüdyosu

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-010 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/projects; action_contract: POST /v1/projects; POST /v1/projects/:id/import; states: step/error/done
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-010 (missing_functions)`: wizard step set parity vs design unverified; product verification on real desktop app + live backend not recorded
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id. The wizard's step set / step order from the design is not in the repo.; No docs/ux/UI-010 spec file.

**b. route / views / data bindings**
  - route: #/projects
  - views: `apps/desktop/renderer/views/projects.js (wizardPanel/importPanel mount 177-178, intakePanel 176)`, `apps/desktop/renderer/views/studio-wizard.js (wizardPanel:78, importPanel:126, ideaPanel:50)`, `apps/desktop/renderer/views/studio-workspace.js`, `apps/desktop/renderer/project-core.js (buildWizardRequest, buildImportRequest, describeImportResult)`
  - POST /v1/projects (studio-wizard.js:22 via ctx.api.post; body built by project-core.js buildWizardRequest; allow-list main.mjs:159)
  - POST /v1/projects/:id/import (studio-wizard.js:119; path only from native dialog uasco pickImportPath via app.js native.pickImportPath; allow-list main.mjs:160,189)
  - POST /v1/missions (studio-wizard.js:43, first-mission 'idea' panel after creation)
  - GET /v1/projects (projects.js:162), GET /v1/missions, GET /v1/work-runs (projects.js:169)

**c. tests (Linux, executed)**
  - `tests/v7-ps1b-project-studio-ui.test.ts` — file PASS 169 / FAIL 0; tests: “renders the wizard with template choices (incl. empty), submit builds the argv-array body once and shows success without any auto-submit”; “shows validation errors without sending, keeps the draft, and reuses the idempotency key on retry”; “import: path comes only from the native dialog result, submit stays disabled until chosen, and the POST carries exactly {kind,path}”; “HTTP 4xx/5xx never marks success; a 201 without a valid prj_ id succeeds without a fabricated open-created shortcut”; “panel: a failed import shows the specific key, keeps the chosen path for retry and focuses the alert; 2xx still resets”; “rejects an empty objective without sending, then POSTs /v1/missions once for the new project and offers Open in Tasks”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “renders the project list and the form; submit builds a validated body with an argv array and an idempotency key via the POST bridge only”
  - note: Wizard form, import, validation/error/done states and the post-create first-mission panel are tested (169/169 in ps1b). The wizard is ONE form inside a <details> (studio-wizard.js:80-100), not a multi-step flow; the tests assert that form, so 'step' parity vs design is untested/unknowable. v7-ux-install.test.ts (CSV candidate) tests #/install, not the wizard; v7-m1a/settings/relpath cover other Studio parts.

**d. merged since audit basis (e12dbdd)**
  - `63b71f1` UI-125: show specific import rejection/failure codes (renderer-only) — Error state of the import half: diff adds describeImportResult (project-core.js:138-163) and uses it in studio-wizard.js:120-121; 6 tests pass.
  - `9358183 (+675a441 1-line fix)` LANE-A: Founder idea -> first mission panel in Project Studio wizard — 'done' state: diff adds ideaPanel/submitIdea (studio-wizard.js:36-64) shown after a project is created (studio-wizard.js:100); the wizard fields are unchanged.
  - `69e0881 (via d704d2d/601361e)` LANE-A: Project Intake (UI-126) — Adds a separate create-from-idea entry (projects.js:10,176); the wizard (projects.js:177) is unchanged.
  - `120eaf6, 0f8a77a, 3878b2f, a1b5611, 4d5ac2e, f4f3d76` First-delivery flow stepper / knowledge panel in Studio overview — Diff adds flowPanel/knowledgePanel imports + overviewTab panels (studio-workspace.js:12-14,76) and flow mappers in project-core.js:411+; no wizard change.
  - `c198d88, 0eacacb, 1dda6fc, 961ef4c, 145b9b8, 0bb67a5, a855323, bccc2bf` Run engine / running-product / setup-check / intake template readiness — Diff hunks only in project-core.js executor/product/readiness mappers (e.g. lines 192-243, 335-378) and studio-workspace.js product card; buildWizardRequest/wizard fields not touched.
  - `6f5cd1e, 632a774` UI-132 closure panel / UI-105 skeleton — projects.js closure panel and skeleton only; no wizard change.
  - covered_items:
    - (yok)
  - uncovered_items:
    - wizard step set parity vs design: not measurable (design package UNKNOWN_SOURCE).
    - real-app/live-backend product run: Local-only.

**e. remaining delta**
  - UNKNOWN: spec not in repo - design wizard step set/order (CSV states 'step/error/done'). Code: single-form wizard (studio-wizard.js:80-100) with error/done states (statusBlock studio-wizard.js:94, recordPost 23, openCreated 95) and no step indicator.
  - PR #46 (f5800aa) is not an ancestor of origin/v7/integration, but its identical change landed via PR #170: merge dac391d / commit 3a52348 (ancestor of 459205c; `git merge-base --is-ancestor f5800aa origin/v7/integration` returns 1, the same check for 3a52348 returns 0). Same subject and author date as f5800aa; the +/- lines of the two commits hash identically (sha256 of `git show -U0 | grep '^[+-]'`) and the change is test-only (tests/v7-ps1b-project-studio-ui.test.ts, +176), so it is part of the 169 ps1b tests counted here - ported via #170, audited. (The CSV row for UI-010 lists #40@6089bc8 and #44@153cf24, not #46.)
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** TEST_PASS_LINUX for create/import/error/done behaviour (169/169 ps1b). Step-set parity = SPEC_MISSING; design parity/real app = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** NONE — size NONE

### UI-011 — Proje Yolculuğu

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-011 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/projects; action_contract: read-only; states: -
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-011 (missing_functions)`: phase stepper is read-only (no phase actions); design parity unverified; product verification on real desktop app + live backend not recorded
  - `docs/inventory/2026-10-19/raw/ux-decisions.csv UX-DEC-063`: PARAPHRASE: 'Project Journey/Mission/Dependency Graph' (text UNKNOWN_SOURCE); missing: 'dependency DAG projection absent'
  - `apps/desktop/renderer/routes.js:6 (in-code TR note)`: PARAPHRASE: Proje Yolculuğu: seçili mission'ın otonom zinciri (pre-dev fazları, ekip koordinasyon ledger'ı, geliştirme -> bağımsız inceleme -> teslim) ... salt-okunur GET /v1/predev/:missionId + GET /v1/crew/:missionId ... Hiçbir faz/onay/verdict uydurulmaz
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id. Which phase actions the design wants on the stepper is not in the repo.; No docs/ux/UI-011 spec file.

**b. route / views / data bindings**
  - route: #/journey (routes.js:27, component 'journey' via planned.js; CSV's #/projects is stale)
  - views: `apps/desktop/renderer/views/journey.js`, `apps/desktop/renderer/journey-core.js`, `apps/desktop/renderer/views/predev-decisions.js`, `apps/desktop/renderer/predev-decisions-core.js`, `apps/desktop/renderer/views/analysis-step.js`, `apps/desktop/renderer/analysis-core.js`
  - GET /v1/missions (journey.js:218 via api.missions, api.js:55)
  - GET /v1/predev/:missionId (journey.js:230 via api.predev, api.js:157)
  - GET /v1/crew/:missionId (journey.js:231 via api.crew, api.js:158)
  - POST /v1/missions/:id/predev/start and /predev/artifacts/:artifactId/approve|reject (predev-decisions.js:23 via ctx.api.post; paths predev-decisions-core.js:19-20) - allow-listed (main.mjs:167-168, COORD protected batch 3b) and registered in server.ts
  - POST /v1/missions/:id/analysis/step and /analysis/plan (analysis-core.js:10-11, analysis-step.js) - renderer only: NOT in the desktop POST allow-list (apps/desktop/main.mjs:159-168 POST_ROUTE_RES has no analysis entry) and apps/control-api/src/server.ts registers no routes/analysis.ts, so in the real desktop build the step shows 'not enabled in this build'; GET executors only when a step is BLOCKED (journey.js:233)

**c. tests (Linux, executed)**
  - `tests/v7-ux-journey.test.ts` — file PASS 100 / FAIL 0; tests: “renders the autonomous chain: 5 pre-dev phases with real artifact states, current phase marked, downstream NOT_STARTED when there are no runs”; “dev -> review -> delivery: real versions, verdicts and a source-only delivery (NOT_VERIFIED); PRODUCT_VERIFIED is never shown”; “mission list failure shows an honest state (OFFLINE / UNAVAILABLE / ERROR); no data is fabricated”; “approve: empty/invalid evidence is a validation error and sends NOTHING; valid evidence POSTs exactly {evidenceRefs}; success re-reads and says what the server reports”; “not started: only a Start control; it POSTs {} to the canonical path and reports the server's phase; the mission list and predev are re-read afterwards”; “COMPLETE opens 'Create plan'; it posts {} once, shows the traceability and offers the plan in Tasks; a refusal is shown by its code and nothing is claimed”
  - `tests/v7-ux-shell.test.ts` — file PASS 29 / FAIL 0; tests: “journey: empty list adds one next-step block + button -> navigate('work') once, selection unchanged, no reads/writes”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “drives idea -> intake -> analysis -> plan -> mission/task -> run -> test result -> product -> delivery and records every step's status”
  - note: BLOCKED in the real desktop build for the analysis part: the cited b5 test (tests/v7-b5-work-screens.test.ts:2802-2810) itself asserts 'the step POST is not allow-listed yet' and 'not enabled in this build', and the v7-ux-journey analysis tests drive a fake ctx.api.post, so they prove renderer behaviour only. v7-ux-journey.test.ts (100/100) covers read models, rail/phase/crew/dev panels, pre-dev decisions and the analysis step. Not covered: any dependency-graph/DAG (none in code), design parity, real backend. The test 'journey.js and journey-core.js never write' still passes because writes live in predev-decisions.js / analysis-step.js, not journey.js.

**d. merged since audit basis (e12dbdd)**
  - `f8bf2eb` feat(ui): pre-dev Founder decisions in the Project Journey (start, approve with evidence, reject) — CSV item 'phase stepper is read-only (no phase actions)': diff adds decisionsPanel (predev-decisions.js) mounted at journey.js:138 with POST start/approve/reject; 17+5 tests pass.
  - `bec0d66` feat(ui): analysis step in the Journey (produce phase drafts, exact BLOCKED readiness, create the traced plan only after COMPLETE) — Same item: diff adds analysisPanel (analysis-step.js) mounted at journey.js:138 with POST analysis/step and analysis/plan; 4+14 tests pass.
  - `e177e3e` UI-106: journey/executive empty-state next step (renderer-only) — Empty-state: adds journey-empty-open-work button (journey.js:46-51); one test in v7-ux-shell.
  - covered_items:
    - pre-dev start/approve-with-evidence/reject: renderer (journey.js:138 -> predev-decisions.js) AND desktop allow-list (main.mjs:167-168) AND server routes (server.ts) exist; tested through the real buildServer in the COORD batch-3b cases (tests/support/protected-batch-3b.cases.ts) and the journey tests.
    - the rail itself stays read-only (journey.js:73 click only focuses the panel).
  - uncovered_items:
    - analysis step / create-plan: renderer-only (analysis-step.js, analysis-core.js); BLOCKED in the desktop build (no POST allow-list entry in main.mjs:159-168, no server route registration). CSV item 'no phase actions' is therefore only half closed: pre-dev yes, analysis no.
    - No actions on the develop/review/delivery stages inside the Journey (devPanel journey.js:206-214 is read-only; runs are started in #/work). Whether the design wants them: UNKNOWN: spec not in repo.
    - Dependency graph (UX-DEC-063 'dependency DAG projection absent'): no graph in journey.js (grep dependsOn|graph = none). Requirement text UNKNOWN_SOURCE.

**e. remaining delta**
  - BLOCKED: desktop POST allow-list entry for POST /v1/missions/:id/analysis/step|plan (protected apps/desktop/main.mjs) + server route registration of routes/analysis.ts (protected apps/control-api/src/server.ts). Request: docs/authority-requests/LANE-A-analysis-allowlist.md, STATUS OPEN = COORD protected batch 4b (#242), Founder decision. Until then the analysis step/create-plan cannot run in the desktop.
  - UNKNOWN: spec not in repo - whether the design needs phase actions on develop/review/delivery stages or a dependency graph in the Journey (journey.js:206-214 read-only; no graph code).
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** CODE_PRESENT for the analysis step / create-plan (renderer only; BLOCKED in the desktop build). TEST_PASS_LINUX for the read models, honest states and the pre-dev decisions (start/approve/reject are allow-listed and server-registered; 100/100 journey). Design parity/real app = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** BLOCKED_ON_FOUNDER (#242): COORD protected batch 4b - allow-list + server registration for the analysis routes (docs/authority-requests/LANE-A-analysis-allowlist.md STATUS OPEN); no Lane A renderer task until it lands — size BLOCKED; files: `apps/desktop/main.mjs (protected)`, `apps/control-api/src/server.ts (protected)`, `docs/authority-requests/LANE-A-analysis-allowlist.md`

### UI-022 — Proje Kaynak & Git

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-022 (requirement_ref)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/projects; action_contract: GET files/file/git; POST export; states: empty/error
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-022 (missing_functions)`: read-only browse; design parity unverified; product verification on real desktop app + live backend not recorded
  - `docs/planning/BACKLOG_CHECKPOINT.json (task P0-REMAINDER-AUDIT, INV-17)`: UNVERIFIED_STALE_BACKLOG ... several similar rows have since merged ... so what is still missing for any of the 19 cannot be said without a fresh per-screen audit.
  - spec_missing: Design package UNKNOWN_SOURCE (Founder PC: C:/Users/salim/Downloads/UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16); no image/Figma/PDF design file in the repo (BACKLOG_CHECKPOINT.json note on 'git ls-files has no PNG/SVG/JPG/PDF/Figma').; docs/planning/SCREEN_TRACEABILITY_252_PLUS.csv and AUDIT_252_GAP_REPORT.md (ec105b7 basis) are not on v7/integration (BACKLOG_CHECKPOINT.json P0-REMAINDER-AUDIT specFile: 'NOT on v7/integration').; UX-DEC-001..071 decision texts are UNKNOWN_SOURCE (only short stale titles in docs/inventory/2026-10-19/raw/ux-decisions.csv); no docs/ux/UI-xxx spec exists for this row id.; No docs/ux/UI-022 spec file.

**b. route / views / data bindings**
  - route: #/projects (Project Studio workspace, tabs files / changes / delivery)
  - views: `apps/desktop/renderer/views/studio-workspace.js (filesTab:174, changesTab:198, deliveryTab:263, submitExport:242, showExport:252)`, `apps/desktop/renderer/views/studio-wizard.js (importPanel)`, `apps/desktop/renderer/project-core.js (filesPath/filePath/gitLogPath/gitDiffPath/exportsPath, STUDIO_TABS:12)`
  - GET /v1/projects/:id/files[?path=] (studio-workspace.js:175 via api.projectFiles, api.js:93; server.ts:426)
  - GET /v1/projects/:id/file?path= (studio-workspace.js:188 via api.projectFile, api.js:94; server.ts:431)
  - GET /v1/projects/:id/git/log?limit=50 (studio-workspace.js:199 via api.gitLog, api.js:95; server.ts:436)
  - GET /v1/projects/:id/git/diff?from&to (studio-workspace.js:216 via api.gitDiff, api.js:96; server.ts:442)
  - GET /v1/deliveries?projectId=<id> (api.deliveries, api.js:100; path built by delivery-core.js:11 deliveriesPath; server.ts:331) and GET /v1/projects/:id/exports (studio-workspace.js:264 via api.projectExports, api.js:97; server.ts:459)
  - POST /v1/projects/:id/export (studio-workspace.js:246 via ctx.api.post; allow-list main.mjs:160); IPC showExport (studio-workspace.js:256, ids only)
  - GET /v1/projects/:id/devrun and POST .../devrun/start|stop|restart (Run tab, studio-workspace.js:122,150)

**c. tests (Linux, executed)**
  - `tests/v7-ps1b-project-studio-ui.test.ts` — file PASS 169 / FAIL 0; tests: “files tab: lists entries, navigates folders with validated relative paths, shows a redacted read-only viewer and never builds a traversal path”; “changes tab: lists git history, renders diff lines as text spans with +/- markers, and sends only validated hashes”; “delivery tab: export POSTs the fixed route, lists exports, and 'show in folder' passes ids only to the native call”; “allows exactly the Project Studio read routes with strict ids and canonical encoded paths”; “files tab: list 404 shows UNAVAILABLE with no entries; an empty list says so; a file read failure shows no fabricated content”; “changes tab: git log 404 and an empty log render honest notes with no commit table, no diff picker and no diff request”
  - `tests/v7-ps1b-relpath-canonical.test.ts` — file PASS 5 / FAIL 0; tests: “whenever validRelPath accepts a name, the built files/file path is accepted by main (single, nested, route groups)”
  - `tests/v7-ps1a-project-studio.test.ts` — file PASS 14 / FAIL 0; tests: “lists and reads files safely: traversal, symlink/junction escape, .git, binary and size limits; secrets redacted”; “links runs to their commits, diffs run commits read-only and bounds large diffs; exports with reports”
  - note: UI and bridge are tested with a fake DOM + real allow-list regexes; the server file/git/export logic IS tested through the real control-api in v7-ps1a (buildServer + app.inject: ps1a:15,47,52; files ps1a:305, git/diff/exports ps1a:338). v7-ux-install (CSV candidate) tests #/install and is not counted. Not covered: browse on a real repository in the desktop app, design parity.

**d. merged since audit basis (e12dbdd)**
  - `120eaf6, bccc2bf, 961ef4c, 1dda6fc, f4f3d76, 601361e` Flow stepper / product card / knowledge panel / #226 review fixes in Studio overview — git diff e12dbdd..HEAD of studio-workspace.js has hunks only at lines 12-14 (imports) and 55-76 (overviewTab); filesTab (174-195), changesTab (198-225) and deliveryTab (263-280) are unchanged, so no CSV delta item is affected.
  - `63b71f1` UI-125: specific import rejection/failure codes — Import error text in studio-wizard.js:120-121 / project-core.js:138-163; not the files/git/export browse.
  - `c198d88, 0eacacb, 0bb67a5, a855323, 3878b2f, 0f8a77a, a1b5611, 4d5ac2e, 145b9b8` Run engine / setup check / flow-detail mappers — project-core.js hunks (192-243, 335-378, 411+) for devrun/product/executor/flow mappers; filesPath/filePath/gitLogPath/gitDiffPath/exportsPath (project-core.js:74-91) unchanged.
  - covered_items:
    - (yok)
  - uncovered_items:
    - 'read-only browse': this is the declared contract (action_contract 'GET files/file/git; POST export'): file viewer is read-only (studio-workspace.js:187-192), diff between two chosen commits (198-225), export POST (242-250). Not a code gap unless the design adds editing - UNKNOWN: spec not in repo.
    - Design parity and real-app browse on a live backend: Local-only.

**e. remaining delta**
  - UNKNOWN: spec not in repo - whether the design wants more than the read-only file viewer / two-commit diff / export (studio-workspace.js:174-225, 242-280).
  - PR #46 (f5800aa) is not an ancestor of origin/v7/integration, but its identical change landed via PR #170: merge dac391d / commit 3a52348 (ancestor of 459205c; `git merge-base --is-ancestor f5800aa origin/v7/integration` returns 1, the same check for 3a52348 returns 0). Same subject and author date as f5800aa; the +/- lines of the two commits hash identically (sha256 of `git show -U0 | grep '^[+-]'`) and the change is test-only (tests/v7-ps1b-project-studio-ui.test.ts, +176), so it is part of the 169 ps1b tests counted here - ported via #170, audited. (The CSV row for UI-022 lists #46@f5800aa.)
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and the real desktop app + live backend product run (reference designs not in repo; Local-only).

**f. evidence class:** TEST_PASS_LINUX for files / git log / diff / export behaviour (ps1b 169/169, ps1a 14/14, relpath 5/5). Design parity = SPEC_MISSING; real-app browse = NOT_VERIFIED_LOCAL_ONLY.

**g. follow-up:** NONE — size NONE

### UI-026 — Görev Ayrıntı Inspector

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-026 column requirement_ref (basis e12dbdd)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/work; action_contract: GET /v1/missions/:id; /v1/work-runs/:id; states: -
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-026 column missing_functions (basis e12dbdd)`: mission + work-run detail exist; no dedicated task inspector route; parity unverified; product verification on real desktop app + live backend not recorded
  - `docs/ux/UI-026-TASK-INSPECTOR.md`: Assignee, due date, dependencies and description are not in the API and always show UNKNOWN.
  - `docs/ux/UI-026-TASK-INSPECTOR.md`: The run-to-task link does not exist server-side, so it shows UNKNOWN.
  - `docs/planning/BACKLOG_CHECKPOINT.json task UI-026 (status DONE)`: Inspector derived only from GET /v1/missions/:id and GET /v1/work-runs/:id, which are already allow-listed and read by the view; missing fields shown as UNKNOWN; no POST, no new endpoint, no new route.
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-001..071 texts and UASCO COMPLETE Desktop Blueprint (SC-01..SC-18) are UNKNOWN_SOURCE (not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); No per-field acceptance list for the inspector beyond the CSV note; docs/ux/UI-026 is the implementer's own delivery record, not an external spec

**b. route / views / data bindings**
  - route: #/work (apps/desktop/renderer/routes.js:19; inspector is an in-view panel in mission detail, no separate route)
  - views: `apps/desktop/renderer/views/work.js (taskList :336, taskInspector :298, detailPanel :351, render :372)`, `apps/desktop/renderer/work-core.js (deriveTaskInspector :609)`, `apps/desktop/renderer/views/task-runs.js (task-run panel under the inspector)`, `apps/desktop/renderer/views/task-status.js (task status controls under the inspector)`
  - GET /v1/missions/:id (api.js:71 missionDetail; called work.js:382)
  - GET /v1/work-runs?missionId= (api.js:72-75 workRuns; work.js:382) - feeds the inspector run count
  - GET /v1/work-runs/:id (api.js:78 workRunDetail; work.js:384)
  - GET /v1/tasks/:id/runs (task-runs.js:13-16 loadTaskRuns :13-16 via ctx.api.raw; work.js:388) - shown in the panel below the inspector, not inside it
  - POST /v1/tasks/:id/transition (task-status.js:21 via ctx.api.post; path work-core.js:177)
  - POST /v1/tasks/:id/runs and POST /v1/work-runs/:id/tasks/reconcile (task-runs.js:22, :32)

**c. tests (Linux, executed)**
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “opens read-only on click, shows API fields and UNKNOWN for missing ones, toggles closed, and sends no POST”; “run count is UNKNOWN when work-runs are unreadable; derive gives UNKNOWN for non-VERIFIED (incl. STALE) and EMPTY for a missing task”; “locales carry the same task-inspector keys in en and tr”; “offers only allowed targets, explains waiting dependencies, and posts one exact request”; “lists the linked runs for the selected task, offers unlinked mission runs, and sends nothing until the button is pressed”; “mission detail shows only state-machine-allowed transitions; AUTHORIZED/COMPLETE targets are marked as needing confirmation; Çalıştır enabled only for AUTHORIZED/PLANNED”
  - `tests/v7-ux-journey.test.ts` — file PASS 100 / FAIL 0; tests: “start run -> the link step offers every open task unchecked -> one checked task is linked -> the run card and both task inspectors show the same link”; “walks one task through the real routes: IN_PROGRESS, a cancelled DONE changes nothing, a confirmed DONE unlocks the dependent task, and the mission is not called complete”
  - note: The three 'UI-026 task inspector' tests use fake-DOM views with fixture data (b5:1053 onward); tests/v7-ux-journey.test.ts drives the inspector click against the real control-api in-process. Not covered: no test asserts the inspector's 'Run link' field against a linked run (the pinned expectation is UNKNOWN, v7-b5-work-screens.test.ts:1071); no real desktop app / live backend run. CSV-listed v7-ux-executive/install/matrix/operations/posture/queue/readiness and v7-ux-wp-workos do not reference the task inspector (grep taskInspector|taskInspect|deriveTaskInspector over tests/*.ts hits only v7-b5-work-screens and v7-ux-journey), so they are not listed.

**d. merged since audit basis (e12dbdd)**
  - `be2e47f` UI-026: read-only task detail inspector on #/work (renderer-only) — Adds taskInspector (work.js:298) and deriveTaskInspector (work-core.js:609): the 'no dedicated task inspector' CSV gap becomes an in-view panel; still no separate route (routes.js:19).
  - `3b7b5ac` COORD-TASK-UI: Desktop task status controls in mission detail — Diff adds dependsOn mapping to deriveTaskInspector (work-core.js:617) so the 'dependencies' row is real when the server sends dependsOn; also adds task-status.js controls below the inspector.
  - `a1b5611` LANE-A: task-run link in the task inspector and flow stepper — Diff adds taskRunsFor (work.js:346) and views/task-runs.js: linked runs per task are shown directly under the inspector, from GET /v1/tasks/:id/runs.
  - `b58f202 / 4a2b749 / f32bcd1 / a153c7f` task-run panel follow-rule, reconcile button, run->task link step, linked tasks on run card — Extend the task<->run link UI (task-runs.js, run-link.js, work.js run card); they affect the 'run link' aspect of the CSV note but not the inspector's own 'Run link' row.
  - `0567275` UI-025: read-only task and work-run timeline on #/work — Adds workTimeline (work.js:323) in the same mission detail; not an inspector item.
  - covered_items:
    - 'no dedicated task inspector': an inspector panel exists (work.js:298-321, opened via taskList buttons work.js:336-344); a dedicated route does not (by design, docs/ux/UI-026 'No route was added').
    - 'mission + work-run detail exist': GET /v1/missions/:id and GET /v1/work-runs/:id are read at work.js:382-384.
  - uncovered_items:
    - 'parity unverified' and 'product verification on real desktop app + live backend not recorded' (Local-only).
    - 'dedicated task inspector route' (kept absent).

**e. remaining delta**
  - work.js:315 renders the inspector 'Run link' row as a hard-coded UNKNOWN (pinned by tests/v7-b5-work-screens.test.ts:1071) although the task-run panel directly below the same inspector already reads the links (work.js:361, :388; task-runs.js:13-16) - the inspector contradicts the panel under it.
  - docs/ux/UI-026-TASK-INSPECTOR.md lines 9-10 are stale: they say dependencies are always UNKNOWN and the run-to-task link does not exist server-side, but work-core.js:617 shows real dependsOn and /v1/tasks/:id/runs is allow-listed (main.mjs:61).
  - Assignee, due date and description show UNKNOWN permanently (work-core.js:609 TASK_UNKNOWN_FIELDS); server WorkTask has only taskId/missionId/projectId/tenantId/title/status/dependsOn (core/workos/types.ts:41-43), so these need a server change; UNKNOWN: spec not in repo whether the design requires them.
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity with the 252 package and real desktop app + live backend run.

**f. evidence class:** TEST_PASS_LINUX (inspector behaviour: tests pass on Linux, 169/0 and 100/0); NOT_VERIFIED_LOCAL_ONLY for design parity and real desktop app; SPEC_MISSING for the design's field list

**g. follow-up:** UI-026: show the task's linked runs in the inspector 'Run link' row (replace pinned UNKNOWN) and refresh docs/ux/UI-026-TASK-INSPECTOR.md — size S; files: `apps/desktop/renderer/views/work.js`, `apps/desktop/renderer/work-core.js`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `tests/v7-b5-work-screens.test.ts`, `docs/ux/UI-026-TASK-INSPECTOR.md`

### UI-028 — 599 Uzman Rol Kataloğu

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-028 column requirement_ref (basis e12dbdd)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/workforce; action_contract: GET /v1/roles?limit&cursor; states: empty/list
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-028 column missing_functions (basis e12dbdd)`: design parity unverified; 599 is role-definition catalog not live agents (honest note present); product verification on real desktop app + live backend not recorded
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-028 column evidence`: stale issue: Role catalog: GET /v1/roles[/:roleId] exists, workforce.js shows counts; searchable 599-role catalog list not confirmed
  - `docs/planning/BACKLOG_CHECKPOINT.json task UI-028 (status DONE)`: Add previous/next paging to the #/workforce role-catalogue table so roles past the first 150 are reachable without a filter (renderer-only)
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-001..071 texts and UASCO COMPLETE Desktop Blueprint (SC-01..SC-18) are UNKNOWN_SOURCE (not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); docs/ux/UI-028-ROLE-CATALOG-PAGING.md is listed in the backlog task files but does not exist in docs/ux (ls)

**b. route / views / data bindings**
  - route: #/workforce (routes.js:20)
  - views: `apps/desktop/renderer/views/workforce.js (overview :103, filterBar :124, roleList :156 with DISPLAY_LIMIT=150 :37, detailPanel :212, catalogSection :269, render :276)`, `apps/desktop/renderer/workforce-taxonomy-core.js`
  - GET /v1/roles?limit=100[&cursor=...] looped up to 12 pages (api.js:120-131 roleCatalog; called workforce.js:277)
  - GET /v1/roles/:roleId (api.js:134 roleDetail; called workforce.js:284 only when a role is selected)
  - GET /v1/agents (api.js:104 agentCount; workforce.js:277)
  - GET /v1/cockpit (api.js:53; workforce.js:277)
  - GET /v1/work-runs (workforce.js:277)
  - GET /v1/roles/status-summary (api.js:203; workforce.js:277)

**c. tests (Linux, executed)**
  - `tests/v7-ux-wp-agents.test.ts` — file PASS 69 / FAIL 0; tests: “unfiltered 599-role catalogue: exactly one labelled pager, pages 1-4 in registry order with real ranges, no truncated note”; “150 roles or fewer (single cluster): no pager, no range note, the existing results note is unchanged”; “honest state: no pager or range for a 404, offline, malformed or partial catalogue, or a no-match search; no NaN/undefined in any range”; “api.roleCatalog paginates the whole live /v1/roles catalog complete-or-empty”; “api.roleCatalog returns an honest empty state when /v1/roles is unavailable (never a partial 599)”; “an empty (but readable) catalog says so honestly and shows zero stats instead of a table”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “separates registered roles (GET /v1/agents) from active workers and lists live runs; carries the 599 ≠ running note and the live /v1/roles role-catalog panel (UX WP-AGENTS, no stale planned panel)”
  - note: Tests use fake-DOM/fixture catalogues (599 generated rows); no test calls a real control-api /v1/roles. v7-int-r3-desktop is by_module only (canonical-count tests) and not listed. Not covered: design parity; real desktop app + live backend.

**d. merged since audit basis (e12dbdd)**
  - `798c7b4` UI-028: role catalogue paging (renderer-only) — Diff adds catState.page and the previous/next pager in roleList (workforce.js:156-181) - the backlog-recorded gap 'roles beyond the first 150 reachable only through filters' is closed.
  - `0bf8e69 / 0392cf7` UI-197: read-only cluster>guild role taxonomy on #/workforce — Adds taxonomySection (workforce.js:247) beside the catalogue; not a CSV item of UI-028.
  - `cba3ca8 / 33c6770` UI-133 identity card on role detail — Affects the role detail panel (workforce.js:191-210) only.
  - `4dcfab1` LANE-A: Agent Factory status panel in the role catalog — Adds factoryStatusPanel (workforce.js:14) with five separate counters; not a CSV item of UI-028.
  - covered_items:
    - 'searchable 599-role catalog list not confirmed' (CSV evidence stale issue): filterBar :124 + roleList :156 + pager (workforce.js:174-180), tested by 'UI-028 role catalogue paging' (4 pages of the 599 catalogue).
    - '599 is role-definition catalog not live agents (honest note present)': workforce.js:113, :286 (workforce.catalogNote) and :228.
    - action_contract 'GET /v1/roles?limit&cursor; states empty/list': api.js:120-131 and workforce.js:157/272.
  - uncovered_items:
    - 'design parity unverified' and 'product verification on real desktop app + live backend' (Local-only).

**e. remaining delta**
  - NOT_VERIFIED_LOCAL_ONLY: design parity (design package UNKNOWN_SOURCE) and real desktop app + live backend run for the catalogue.

**f. evidence class:** TEST_PASS_LINUX (catalogue, filters, paging, honest states: tests/v7-ux-wp-agents.test.ts 69/0); NOT_VERIFIED_LOCAL_ONLY for design parity and real desktop app

**g. follow-up:** NONE — size NONE

### UI-030 — Aktif Worker Filosu

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-030 column requirement_ref (basis e12dbdd)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/workforce; action_contract: GET /v1/cockpit; /v1/work-runs; states: empty
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-030 column missing_functions (basis e12dbdd)`: live runs list exists; no per-agent fleet grid; runtime status honestly UNKNOWN; product verification on real desktop app + live backend not recorded
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-030 column evidence`: stale issue: Active worker fleet: active runs via cockpit/work-runs; verify per-agent fleet grid
  - `docs/ux/UI-030-WORKER-FLEET.md`: one card per live (non-terminal) work run, as defined by the existing `liveRuns`
  - `docs/ux/UI-030-WORKER-FLEET.md`: PARAPHRASE: Design parity: NOT_VERIFIED. The design package is UNKNOWN_SOURCE.
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-001..071 texts and UASCO COMPLETE Desktop Blueprint (SC-01..SC-18) are UNKNOWN_SOURCE (not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); What 'per-agent fleet grid' means in the original spec is not in the repo; docs/ux/UI-030 re-scopes it to per-run cards

**b. route / views / data bindings**
  - route: #/workforce (routes.js:20)
  - views: `apps/desktop/renderer/views/workforce.js (fleetDetailPanel :54, fleetBody :70, liveRunsBody :39, render :276; fleet panel :295, live-runs panel :296)`, `apps/desktop/renderer/fleet-core.js (fleetGroups :10, fleetCard :24, fleetDetail :31)`, `apps/desktop/renderer/work-core.js (RUN_ACTIVE_STATES :28, liveRuns :605, mapWorkRun :511)`
  - GET /v1/work-runs (api.js:72-75 workRuns; workforce.js:277) - source of all fleet cards
  - GET /v1/cockpit (api.js:53; workforce.js:277) - workforce.activeWorkerRuns KPI shown at workforce.js:293-295
  - GET /v1/agents (api.js:104) and GET /v1/roles (api.js:120) for the registered-role panel

**c. tests (Linux, executed)**
  - `tests/v7-ux-wp-agents.test.ts` — file PASS 69 / FAIL 0; tests: “core groups only live runs by status bucket, drops terminal runs and keeps API order”; “core caps at 50 cards while bucket counts and total stay real”; “renders a labelled region, grouped list semantics, <time>, UNKNOWN fields and a keyboard-reachable mission link”; “read failure replaces the grid with the honest state note, never a 0; empty gives an explicit note”; “fleet cards use data-fleet-run-id so data-run-id stays unique to the live-runs table”; “toggle opens a detail panel with UNKNOWN telemetry, keeps data-fleet-detail-for unique, and toggles closed”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “separates registered roles (GET /v1/agents) from active workers and lists live runs; carries the 599 ≠ running note and the live /v1/roles role-catalog panel (UX WP-AGENTS, no stale planned panel)”
  - note: Fleet tests use fixture runs that carry heartbeatAt and statuses such as QUEUED/RUNNING (v7-ux-wp-agents.test.ts:611); none uses the real server WorkRun shape, so they cannot detect the status-set and heartbeat mismatches listed in e. No test covers a CHECKPOINTING run (grep CHECKPOINTING in tests/v7-ux-wp-agents.test.ts and v7-b5-work-screens.test.ts RUN_ACTIVE_STATES use at :406 only checks locale keys). No real desktop app/live backend run.

**d. merged since audit basis (e12dbdd)**
  - `2bb5c30` UI-030: Active worker fleet grid on #/workforce (renderer-only) — Diff adds fleet-core.js and the fleet panel (workforce.js:70-100, :295): replaces the CSV gap 'no per-agent fleet grid' with a per-RUN grid grouped by status.
  - `a994d4b` UI-030: fix data-run-id collision with live-run rows (B1) — DOM attribute rename only (data-fleet-run-id); no behaviour change to the CSV items.
  - `1da6811` UI-032: worker detail panel from the fleet grid — Adds fleetDetail (fleet-core.js:31) and panel workforce.js:54-68; telemetry is hard-coded null/UNKNOWN (fleet-core.js:34), i.e. the CSV 'runtime status honestly UNKNOWN' is kept.
  - `4dcfab1` LANE-A: Agent Factory status panel in the role catalog — Counters registered/implemented/tested/certified/running by guild (workforce.js:14-34) - catalog side; does not change the fleet grid.
  - covered_items:
    - 'live runs list exists': still rendered (workforce.js:39-52).
    - 'no per-agent fleet grid': partially - a per-run grid exists (workforce.js:70-100); a per-AGENT grid does not (see e).
    - 'runtime status honestly UNKNOWN': kept (workforce.js:54-68, fleet-core.js:34).
  - uncovered_items:
    - per-agent (not per-run) fleet
    - 'design parity unverified' and 'product verification on real desktop app + live backend' (Local-only)

**e. remaining delta**
  - Fleet/live filter mismatch: renderer liveRuns uses RUN_ACTIVE_STATES=[QUEUED,LEASED,STARTING,RUNNING,VERIFYING,REVIEWING] (work-core.js:28,:605; fleet-core.js:14) but the server WorkRun status set has no STARTING/REVIEWING (core/workos/types.ts:72-74) and counts LEASED/RUNNING/CHECKPOINTING/VERIFYING as active workers (core/workos/run-state.ts:24, store.ts:771), so CHECKPOINTING runs counted in the 'active worker runs' KPI (workforce.js:293-295) never appear in the fleet grid or live-runs table. docs/ux/UI-030 says 'live (non-terminal)', which the code does not implement.
  - QUEUED: it is in the renderer's live set (work-core.js:28) but NOT in the server's ACTIVE_WORKER_STATUSES (core/workos/run-state.ts:24) and not in LEASED_RUN_STATUSES (run-state.ts:22): it is in UNLEASED_RUN_STATUSES (run-state.ts:26), i.e. waiting for a lease, not a running worker. So QUEUED is a separate 'waiting' bucket, not a live worker: counting it in the 'live'/fleet set overstates active workers relative to the KPI. docs/ux/UI-030-WORKER-FLEET.md defines cards as 'live (non-terminal)', so whether queued runs belong on the fleet at all is a SPEC_MISSING choice; proposal: keep a labelled 'queued (not yet running)' bucket that is excluded from the active-worker count.
  - Last-heartbeat is always UNKNOWN against the real server: mapWorkRun reads heartbeatAt/lastHeartbeatAt/lease.heartbeatAt (work-core.js:523) but GET /v1/work-runs returns raw WorkRun (server.ts:320; fields leaseExpiresAt and updatedAt in core/workos/types.ts:137-141, no heartbeat field; grep -i heartbeat over core/workos/*.ts and apps/control-api/src/*.ts hits only runner.ts lease-heartbeat code/comments and one git-async.ts comment, no WorkRun field); updatedAt is not mapped (grep updatedAt work-core.js: no match) and fleetCard.updatedAt = heartbeatAt (fleet-core.js:25).
  - SERVER_LIMIT: no per-agent liveness/telemetry source exists (WorkRun has roleId but no agent/worker id or telemetry, core/workos/types.ts:137), so a per-agent fleet grid cannot be built renderer-only; the card shows run id + role only (workforce.js:73-90).
  - NOT_VERIFIED_LOCAL_ONLY: design parity and real desktop app + live backend run.

**f. evidence class:** TEST_PASS_LINUX (per-run fleet grid, caps, honest states: 69/0); NOT_VERIFIED_LOCAL_ONLY for design parity/real app; per-agent grid SPEC_MISSING + SERVER_LIMIT

**g. follow-up:** UI-030: align fleet/live-run status set with the server active-worker set (add CHECKPOINTING; drop STARTING/REVIEWING; keep QUEUED only as a separate, labelled 'queued (not yet running)' bucket that is not counted as a live worker - spec choice) and show updatedAt/leaseExpiresAt instead of the never-sent heartbeatAt — size S; files: `apps/desktop/renderer/work-core.js`, `apps/desktop/renderer/fleet-core.js`, `apps/desktop/renderer/views/workforce.js`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `tests/v7-ux-wp-agents.test.ts`, `docs/ux/UI-030-WORKER-FLEET.md`

### UI-053 — 2D Kontrol Kulesi

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-053 column requirement_ref (basis e12dbdd)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/tower; action_contract: view map; global stop/resume; states: map+accessible list
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-053 column missing_functions (basis e12dbdd)`: 2D ops map + accessible list; design parity unverified; product verification on real desktop app + live backend not recorded
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-053 column evidence`: stale:EXISTS (verify parity; stale issue: 2D ops map with list-view; design parity unverified)
  - `apps/desktop/renderer/control-tower/README.md`: The SVG campus and the list view are two renderings of one model. They must show the same districts, the same guild ids and the same counts
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-001..071 texts and UASCO COMPLETE Desktop Blueprint (SC-01..SC-18) are UNKNOWN_SOURCE (not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); No docs/ux/UI-053 spec exists (docs/ux holds only 17 files, none for UI-053)

**b. route / views / data bindings**
  - route: #/tower (routes.js:23)
  - views: `apps/desktop/renderer/views/tower.js (render :14; mountCampus :17; map panel :64; stop/resume card :60-62)`, `apps/desktop/renderer/control-tower/mount.js, render-svg.js (renderCampusSvg :57), list-view.js (renderCampusList :8), feed.js, model.js`, `apps/desktop/renderer/shell.js (global Stop banner)`
  - GET /v1/cockpit (api.js:53), GET /v1/control/status (api.js:56), GET /v1/roles?limit=100[&cursor] (api.js:106-109 roles), GET /v1/work-runs (api.js:72) - all four feed the map via buildCampusInput (tower.js:17)
  - GET /health (api.js:64), /v1/phase0, /v1/install, /v1/scheduler, /v1/agents, /v1/capabilities, /v1/adapters, /v1/retry via api.raw (tower.js:15)
  - GET /v1/runs (api.js:65), /v1/runs/:id/events and /logs (tower.js:~43-46)
  - IPC uasco:stop / uasco:resume (main.mjs:319-320; app.js:31-32; tower.js:62 requestStop + confirmAndResume)

**c. tests (Linux, executed)**
  - `tests/v7-ux-wp4-tower.test.ts` — file PASS 41 / FAIL 0; tests: “mounts a 10-cluster / 51-guild map and an equivalent list from the paged /v1/roles feed, cockpit global stop and work-runs”; “marks the whole campus STOPPED with an alert overlay when cockpit.globalStop is active, and falls back to /v1/control/status when the cockpit is absent”; “selects a guild by keyboard on the map and by click on the list with the same detail, and opens existing screens only”; “shows no clusters, guilds or counts when the role feed is absent (bridge rejects /v1/roles)”; “shows verified health and wires Stop/Resume buttons to the context”; “Resume is not called when confirm resolves false or ctx.confirm is missing (fail-closed)”
  - `tests/v7-b6a-control-tower.test.ts` — file PASS 14 / FAIL 0; tests: “builds 10 districts and 51 buildings from the canonical role registry (role-definitions.json)”; “shows no numbers for unknown values”; “shows identical ids and counts as the SVG (parity), including unavailable data”
  - note: Fixture/fake-DOM tests; the SVG is checked structurally (no screenshot/pixel comparison). Not covered: design parity, real desktop app + live backend, real GPU/low-GPU rendering. No test runs the map against the real control-api.

**d. merged since audit basis (e12dbdd)**
  - `a874abf` UI-007: require explicit confirmation before Resume (shell banner and Control Tower) — Diff adds resume-confirm.js and routes tower.js:62 resume button through confirmAndResume: affects the CSV action_contract 'global stop/resume' (resume now confirmed).
  - `005b1b7 / cb7c1c7` UI-226: read-only stage timeline in Control Tower run view — tower.js:29 renderTrace in the selected-run panel; not a map/list item.
  - `50f560e / eee87b3` UI-194 Tower retry fact honest states — tower.js:75 retryFact in the health panel; not a map/list item.
  - `bbafa45` LANE-A #192 review fixes (attention summary) — tower.js:58 attentionSummary for the blocked-work panel; not a map/list item.
  - `0fa9568` UI-251: Recovery Center panel for failed views — Diff touches shell.js (+4) and views/planned.js (+9); not a map/list item.
  - covered_items:
    - '2D ops map + accessible list': present before and after the audit (mount.js, render-svg.js, list-view.js); git log e12dbdd..HEAD -- apps/desktop/renderer/control-tower is empty, i.e. unchanged.
    - action_contract 'global stop/resume': tower.js:62 buttons + a874abf confirmation.
  - uncovered_items:
    - 'design parity unverified' and 'product verification on real desktop app + live backend' (Local-only).

**e. remaining delta**
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity of the 2D map (design package UNKNOWN_SOURCE) and real desktop app + live backend run.

**f. evidence class:** TEST_PASS_LINUX (2D map + equivalent list + Stop/Resume wiring: 41/0 and 14/0); NOT_VERIFIED_LOCAL_ONLY for design parity/real app

**g. follow-up:** NONE — size NONE

### UI-076 — Sistem Ayarları

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-076 column requirement_ref (basis e12dbdd)`: UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071; stale route #/settings; action_contract: change language/executors; states: default
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-076 column missing_functions (basis e12dbdd)`: Claude connection, read-only autonomy policy, version/security, language/executors present; many design sections absent (notifications, data, providers); product verification on real desktop app + live backend not recorded
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-076 column evidence`: stale:PARTIAL (extend existing view; stale issue: language + executor panel only; many sections absent)
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-001..071 texts and UASCO COMPLETE Desktop Blueprint (SC-01..SC-18) are UNKNOWN_SOURCE (not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); No docs/ux/UI-076 spec; the list of design sections (notifications, data, providers named only in the CSV note) has no content definition anywhere in the repo

**b. route / views / data bindings**
  - route: #/settings (routes.js:39)
  - views: `apps/desktop/renderer/views/settings.js (render :132; connectionPanel :34, governancePanel :57, appPanel :85, legendPanel :109, contrastPanel :122, language :146)`, `apps/desktop/renderer/views/executors-panel.js (enableLocalClaude :16, executorsPanel :26, routingPanel :74)`, `apps/desktop/renderer/views/setup-check.js (setupCheckPanel :25)`
  - GET /v1/system/executors (api.js:102; settings.js:134, executors-panel.js:27,:75)
  - GET /v1/control/status (api.js:56; settings.js:134)
  - GET /health (api.js:64; settings.js:134)
  - GET /v1/factory via ctx.api.raw (settings.js:134)
  - GET /v1/capabilities and GET /v1/adapters via ctx.api.raw (executors-panel.js:75)
  - POST /v1/system/executors/local-claude/enable (executors-panel.js:21 via ctx.api.post; path project-core.js:94, confirm dialog first)
  - language switch: ctx.i18n.setLang (settings.js:136), local only

**c. tests (Linux, executed)**
  - `tests/v7-ux-settings.test.ts` — file PASS 55 / FAIL 0; tests: “shows CONNECTED for a READY implementer and NOT_CONNECTED for a LOGIN_REQUIRED reviewer, with cost/personal guidance”; “reflects the real Global Stop autonomy switch and fail-closed gate, labelled read-only, with NO editable control”; “binds system + verified server identity + build/state to real data and shows the unsigned/fail-closed posture”; “language buttons are typed buttons in a labelled group with aria-pressed matching the active language, and click switches language”; “renders routes and both registries from the existing GETs only, with no POST and no promotion of registry values”; “is the first block of Settings, reads no extra path, and has complete Turkish text”
  - `tests/v7-ps1b-project-studio-ui.test.ts` — file PASS 169 / FAIL 0; tests: “renders LOCAL_CLAUDE states and FAKE as test-only; enable exists only for NOT_CONFIGURED and needs the accessible confirm”; “shows honest UNAVAILABLE when the backend has no executors route and renders no enable button”; “announces a failed enable request as an error and does not claim it was enabled”
  - note: v7-sbx8-agent-config.test.ts is listed in the CSV but tests server-side agent-config quarantine and builder refusal (titles 'SBX-8 E: ...'); it does not exercise the Settings view, so it is not counted. Fake-DOM tests only; no test or evidence for notifications/data sections (none exist). No real desktop app / live backend run.

**d. merged since audit basis (e12dbdd)**
  - `976d0d6` PQ-005: read-only provider & model routing view in Settings — Adds routingPanel (executors-panel.js:74): partially answers the CSV 'providers' absence with a read-only role/executor/model routing table and capability/adapter registries; no provider configuration.
  - `dc1da8d` feat(ui): Founder setup check in Settings — Adds setupCheckPanel (settings.js:138): CLI/sign-in/sandbox readiness; not one of the CSV-named missing sections.
  - `8006bab` PQ-004: theme contrast lab in Settings (read-only) — Adds contrastPanel (settings.js:122); extra section, not a CSV item.
  - `b6cc60c` UI-114: Settings state legend (renderer-only) — Adds legendPanel (settings.js:109); extra section, not a CSV item.
  - `0eacacb` feat(ui): align the run engine block with per-role readiness — Diff changes one hint-key line in executors-panel.js (CLI_SHIM_UNSUPPORTED hint) plus run-engine/project-core; no notifications/data section.
  - covered_items:
    - 'Claude connection, read-only autonomy policy, version/security, language/executors present': settings.js:34, :57, :85, :136-146 and executors-panel.js:26 (unchanged, tests pass).
    - 'providers' (partly): read-only routing view settings.js:141 -> executors-panel.js:74 (976d0d6).
  - uncovered_items:
    - 'notifications' section: no code (grep -i 'notif|retention|backup|privacy' over views/settings.js, executors-panel.js, setup-check.js: no match; the only notification surface is the shell bell shell.js:206 which navigates to #/inbox).
    - 'data' section: no code (same grep).
    - 'product verification on real desktop app + live backend' (Local-only).

**e. remaining delta**
  - UNKNOWN: spec not in repo - content of the design's 'notifications' settings section (no such section in views/settings.js; shell bell only links to #/inbox, shell.js:206).
  - UNKNOWN: spec not in repo - content of the design's 'data' settings section (no such section in views/settings.js).
  - UNKNOWN: spec not in repo - whether the design's 'providers' section needs more than the read-only routing/registry view (executors-panel.js:74-90); no provider configuration endpoint is allow-listed for the desktop.
  - NOT_VERIFIED_LOCAL_ONLY: design parity and real desktop app + live backend run.

**f. evidence class:** TEST_PASS_LINUX (existing sections: tests/v7-ux-settings.test.ts 55/0, ps1b 169/0); notifications/data sections SPEC_MISSING; NOT_VERIFIED_LOCAL_ONLY for design parity/real app

**g. follow-up:** NONE — size NONE

### UI-113 — Onay Gerekiyor

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-113 column requirement_ref (basis e12dbdd)`: UI-113; UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071 (UX-DEC texts UNKNOWN_SOURCE)
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-113 column missing_functions (basis e12dbdd)`: Approval-required is rendered as inbox approval cards with reason field + confirmed transition; no standalone approval-required state panel/blast-radius preview per design | design action_contract=existing view actions only; state_variants=loading/empty/error/denied via state kit
  - `docs/ux/UI-113-APPROVAL-REQUIRED.md`: Blast radius / impact is always shown as UNKNOWN, because the data has no such field.
  - `docs/planning/BACKLOG_CHECKPOINT.json task UI-113 (status DONE)`: Unknown blast radius is shown as UNKNOWN, never guessed.
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-001..071 texts and UASCO COMPLETE Desktop Blueprint (SC-01..SC-18) are UNKNOWN_SOURCE (not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); What the design's blast-radius preview shows (fields, source) is not defined anywhere in the repo

**b. route / views / data bindings**
  - route: #/inbox (routes.js:24)
  - views: `apps/desktop/renderer/views/inbox.js (requiredRow :142, requiredPanel :166, decisionCard :45, render :178)`, `apps/desktop/renderer/approval-core.js (deriveApprovalRequired, impact:UNKNOWN :45)`, `apps/desktop/renderer/work-actions.js (performTransition :10)`
  - GET /v1/cockpit (api.js:53; inbox.js:179) - approvals block
  - GET /v1/attention (api.js:58; inbox.js:179) - replaced /v1/founder-attention in 325c09e
  - GET /v1/missions (api.js:70 allMissions; inbox.js:179)
  - GET /v1/work-runs (inbox.js:179) and GET /v1/work-runs/:id (inbox.js:187)
  - POST /v1/missions/:id/transition (work-actions.js:25 via ctx.api.post; confirm dialog for high-risk targets, work-actions.js:14-20); the Approval-required panel itself makes no request (inbox.js:163-164 only focuses ap-card-<id>)

**c. tests (Linux, executed)**
  - `tests/v7-ux-inbox.test.ts` — file PASS 47 / FAIL 0; tests: “core: derives risk, run, age, approve/reject outcomes from existing transition rules; impact is UNKNOWN”; “renders irreversible/high-risk text, run + status, <time datetime>, approve/reject text and UNKNOWN impact”; “a cockpit approval whose mission/run is not readable shows UNKNOWN, not a guess”; “empty is explicit; OFFLINE / ERROR read failures use the honest state note, never a 0”; “performs no POST: buttons only focus the existing approval card; request list unchanged”; “accept (COMPLETE) requires the confirm dialog before it POSTs the transition; the view itself never calls api.post”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “mission detail shows only state-machine-allowed transitions; AUTHORIZED/COMPLETE targets are marked as needing confirmation; Çalıştır enabled only for AUTHORIZED/PLANNED”
  - note: Fake-DOM tests with fixtures. The CSV-listed v7-b5-work-screens file covers the shared transition rules (work-core/work-actions), not the Approval-required panel. No test for a blast-radius value other than UNKNOWN (none exists). Not covered: design parity; real desktop app + live backend.

**d. merged since audit basis (e12dbdd)**
  - `2e3e75f` UI-113: Approval-required state panel on #/inbox (renderer-only) — Diff adds approval-core.js and requiredPanel/requiredRow (inbox.js:142-176, mounted at :194): closes 'no standalone approval-required state panel'; the diff keeps impact as UNKNOWN (approval-core.js:45), so the blast-radius part is NOT closed.
  - `325c09e / bbafa45 / 74a6bfc` LANE-A founder attention queue UI + review fixes — Repoints the inbox attention source from /v1/founder-attention to /v1/attention (inbox.js:179, api.js:58); not an Approval-required item.
  - `72510d4 / f32bcd1` run expert choice / run->task link step — Both diffs touch work-actions.js/work.js (run expert option, run-link step); neither touches approval-core.js or inbox.js requiredRow, so the Approval-required derivation is unchanged.
  - covered_items:
    - 'no standalone approval-required state panel': inbox.js:166-176 (panel 'inbox-required', rendered at inbox.js:194) with risk/transition/run/waiting-since/if-approved/if-rejected rows (inbox.js:142-163).
    - 'approval cards with reason field + confirmed transition': decisionCard inbox.js:45-54 + performTransition work-actions.js:14-25 (unchanged).
  - uncovered_items:
    - 'blast-radius preview per design': row 'Blast radius / impact' is a constant UNKNOWN (inbox.js:162; approval-core.js:45).
    - 'design parity' and real-app verification (Local-only).

**e. remaining delta**
  - Blast-radius preview is not implemented: the 'impact' row is a hard-coded UNKNOWN (inbox.js:162, approval-core.js:45) and cockpit approval items carry only missionId/title/riskLevel (inbox.js:183-185), so no renderer-side source exists; needs a server impact field or a Founder-defined derivation (UNKNOWN: spec not in repo for what the preview shows).
  - NOT_VERIFIED_LOCAL_ONLY: design parity and real desktop app + live backend run.

**f. evidence class:** TEST_PASS_LINUX (standalone Approval-required panel + confirmed transitions: tests/v7-ux-inbox.test.ts 47/0); blast-radius preview CODE_PRESENT only as honest UNKNOWN; design parity NOT_VERIFIED_LOCAL_ONLY

**g. follow-up:** NONE — size NONE

### UI-115 — Tasarım Sistemi

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-115 column requirement_ref (basis e12dbdd)`: UI-115; UASCO COMPLETE Desktop Blueprint / UX-DEC-001..071 (UX-DEC texts UNKNOWN_SOURCE)
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-115 column missing_functions (basis e12dbdd)`: Component kit exists (h, panel, chip, statePill, kpiTile, badge, timelineItem); design-token parity with the 252 package UNKNOWN_SOURCE; no design-system reference screen | design action_contract=existing view actions only; state_variants=loading/empty/error/denied via state kit
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-115 column authority_needed (basis e12dbdd)`: Founder must supply design package to repo for parity
  - `docs/planning/BACKLOG_CHECKPOINT.json (design-reference blocker note, Founder directive POST-AUDIT SAFE RESUME 2026-10-20)`: no agent may produce design-accuracy, design-parity, visual-verification or Founder-design-approval claims.
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-001..071 texts and UASCO COMPLETE Desktop Blueprint (SC-01..SC-18) are UNKNOWN_SOURCE (not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); The 'approved reference palette' (NIHAI section-2 start palette) quoted in tests/v7-ux-vp-visual-parity.test.ts:1 is not in the repo; its values exist only as constants inside that test

**b. route / views / data bindings**
  - route: cross-cutting (no route of its own; routes.js:17-39 has no design-system route)
  - views: `apps/desktop/renderer/components.js (h :6, chip :16, statePill :26, missionPill :31, deltaBadge :39, miniBars :46, kpiTile :57, timelineItem :80, panel :87, stateNote :91, badge :94, statusPill :99, plannedPanel :101, verificationChip :110, viewSkeleton :115)`, `apps/desktop/renderer/styles.css (:root tokens :3-8)`, `apps/desktop/renderer/icons.js (ICON_NAMES :43)`, `apps/desktop/renderer/views/settings.js (legendPanel :109 lists the 14 PILL_KINDS; contrastPanel :122) - partial reference surfaces`
  - none (NONE in CSV; components.js/styles.css/icons.js make no API call)

**c. tests (Linux, executed)**
  - `tests/v7-ux-vp-visual-parity.test.ts` — file PASS 10 / FAIL 0; tests: “exact reference start values are kept for canvas/surface/elevated/border/focus/fg/muted/success/caution”; “key text/background token pairs meet WCAG AA (>=4.5:1) on the reconciled palette”; “shared card/KPI/panel surfaces reference tokens and carry no embedded hex”; “forced-colors neutralizes decorative shadows and the accent marker”
  - `tests/v7-ux-wp2-cockpit.test.ts` — file PASS 23 / FAIL 0; tests: “each status pill has an icon and its own text; the eleven distinct kinds never share a label or an icon path”; “pill kinds keep ERROR, UNAVAILABLE, OFFLINE and STALE distinct”; “timeline items carry time, project attribution only when given, and a status pill”; “renders a titled, aria-busy, number-free skeleton in tr and en without reading api/store/native”; “draws a signed delta and sparkline only from two or more real session samples, labelled as session”; “KPI drill-down navigates to the existing screen by click and by Enter/Space and is keyboard focusable”
  - `tests/v7-ux-settings.test.ts` — file PASS 55 / FAIL 0; tests: “structure: one dl, one dt/dd pair per PILL_KINDS entry in order, keyed by data-legend-kind”; “rows computed from the real styles.css :root tokens match an independent computation and none is UNKNOWN”
  - note: tests/v7-ux-shell.test.ts (the only CSV-listed file) tests the shell inspector, palette, recovery and resume confirm; none of its titles concern the component kit or tokens, so it is not listed. No test file is dedicated to components.js; the kit is exercised through views and the wp2-cockpit 'model and components' block. The reference palette is hard-coded in the visual-parity test, so it proves self-consistency, not parity with the missing package. Pixel parity / design parity is Local-only.

**d. merged since audit basis (e12dbdd)**
  - `632a774` UI-105: route-titled, number-free loading skeleton for all routes except home and tower — Diff adds viewSkeleton to the kit (components.js:115); extends the 'loading' state variant, not the parity/reference-screen gap.
  - `dc097df` feat(ui): UI-112 RECOVERING pill in renderer state kit — One new pill kind + icon (components.js PILL_ICON :23, icons.js); extends the state kit.
  - `0704039 (PR #20 cleanup-planned-scaffolding, merged via 97f839a)` Remove unused plannedPanel partial option and orphan locale keys — Diff removes the unused 'partial' option from plannedPanel (components.js:101); no new kit function. PR #20 named in the CSV as open is now merged.
  - `b6cc60c / 8006bab` UI-114 Settings state legend / PQ-004 theme contrast lab — Settings legendPanel (settings.js:109) and contrastPanel (settings.js:122) document pills and token contrast; they are partial reference surfaces, not a design-system screen.
  - covered_items:
    - 'Component kit exists (h, panel, chip, statePill, kpiTile, badge, timelineItem)': all seven still exported (components.js:6,87,16,26,57,94,80), plus missionPill, deltaBadge, miniBars, verificationChip, viewSkeleton.
    - state_variants 'loading/empty/error/denied via state kit': viewSkeleton (components.js:115), emptyNote :90, stateNote :91, DENIED/FAILED pills in PILL_ICON :23.
  - uncovered_items:
    - 'no design-system reference screen': still none (routes.js:17-39; grep -ril 'design-system|styleguide|component gallery' apps/desktop/renderer: no match).
    - 'design-token parity with the 252 package UNKNOWN_SOURCE': unresolved (package not in repo).

**e. remaining delta**
  - No design-system reference screen: routes.js:17-39 has no such route and grep for design-system/styleguide/component gallery under apps/desktop/renderer returns nothing; only the Settings legend (settings.js:109) and contrast lab (settings.js:122) document parts of the kit.
  - UNKNOWN: spec not in repo - design-token parity with the 252 package (styles.css:5-8 hex values are checked only against constants embedded in tests/v7-ux-vp-visual-parity.test.ts).
  - NOT_VERIFIED_LOCAL_ONLY: pixel/design parity and real desktop app render.

**f. evidence class:** TEST_PASS_LINUX (kit pieces and tokens: visual-parity 10/0, wp2-cockpit 23/0); design-token parity SPEC_MISSING; reference screen absent; NOT_VERIFIED_LOCAL_ONLY for pixel parity

**g. follow-up:** UI-115: read-only Design System reference route (token swatches from styles.css, the 14 state pills, kit samples) with no parity claim | Frozen scope - existing exact ROUTES pins that break when routes.js gains an id: ALWAYS tests/v7-b4-desktop-shell.test.ts:75 and tests/v7-ps1b-project-studio-ui.test.ts:619 (full-array equality); slice(-15) pins when the id is appended or inserted inside the last 15 ids: tests/v7-ux-executive.test.ts:876, tests/v7-ux-journey.test.ts:564, tests/v7-ux-matrix.test.ts:1008, tests/v7-ux-operations.test.ts:1101, tests/v7-ux-posture.test.ts:1052, tests/v7-ux-queue.test.ts:911, tests/v7-ux-readiness.test.ts:1116; tail pins when the id is appended after 'settings' or lands in the last 6: tests/v7-ux-matrix.test.ts:1266 (slice(-4)) and tests/v7-ux-operations.test.ts:1201 (slice(-6)). Inserting before the last 15 ids touches only the first two. — size M; files: `apps/desktop/renderer/routes.js`, `apps/desktop/renderer/views/planned.js`, `apps/desktop/renderer/views/design-system.js (new)`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `apps/desktop/renderer/styles.css`, `tests/v7-ux-vp-visual-parity.test.ts`, `tests/v7-b4-desktop-shell.test.ts:75`, `tests/v7-ps1b-project-studio-ui.test.ts:619`, `tests/v7-ux-executive.test.ts:876`, `tests/v7-ux-journey.test.ts:564`, `tests/v7-ux-matrix.test.ts:1008`, `tests/v7-ux-operations.test.ts:1101`, `tests/v7-ux-posture.test.ts:1052`, `tests/v7-ux-queue.test.ts:911`, `tests/v7-ux-readiness.test.ts:1116`, `tests/v7-ux-matrix.test.ts:1266 (only if appended after settings)`, `tests/v7-ux-operations.test.ts:1201 (only if appended after settings)`

### UI-124 — Acil Durdur Onayı ve Etki Alanı

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-124 column requirement_ref (basis e12dbdd)`: UI-124; Trust Kernel / UX-DEC-065 (UX-DEC texts UNKNOWN_SOURCE)
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-124 column missing_functions (basis e12dbdd)`: Global stop dialog + resume exist (stop/resume via dedicated IPC main.mjs:267-268); no per-scope stop or blast-radius/impact preview | design action_contract=existing view actions only; state_variants=loading/empty/error/denied via state kit
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-124 column authority_needed (basis e12dbdd)`: none for current; per-scope stop needs new endpoint + IPC (protected main.mjs)
  - `docs/planning/FOUNDER_BATCH_2_AUTHORITY_REQUIRED_2026-10-18.md row B2-UI-124`: Stop dialog shows live impact counts (active runs, blocked items)
  - `docs/planning/BACKLOG_CHECKPOINT.json task B2-UI-124`: PARAPHRASE: status AUTHORITY_REQUIRED; "No authorizedBy: not READY."
  - `docs/inventory/2026-10-19/raw/ux-decisions.csv row UX-DEC-065`: STOP_ALL dialog/IPC, approvals (inbox/queue), settings governance read-only
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-065 text is UNKNOWN_SOURCE (Founder PC, not in repo; ux-decisions.csv row 65); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); The meaning of 'per-scope' (which scopes: project, mission, run, guild?) is not defined anywhere in the repo

**b. route / views / data bindings**
  - route: #/tower (routes.js:23) plus the global top-bar Stop button, banner and dialog (every route)
  - views: `apps/desktop/renderer/index.html (stopDialog :53-58)`, `apps/desktop/renderer/shell.js (renderStop :50, openStopDialog :196, stopConfirm handler :203, resumeBtn :204, palette STOP_ALL :140/:161)`, `apps/desktop/renderer/app.js (stop :31, resume :32)`, `apps/desktop/renderer/resume-confirm.js (confirmAndResume)`, `apps/desktop/renderer/views/tower.js (stop card :60-62)`
  - GET /v1/control/status (api.js:56; shell.js:116, tower.js:15) - stop state/reason only
  - IPC uasco:stop -> POST /v1/control/stop with fixed reason 'Founder requested from UASCO Desktop' (app.js:31; main.mjs:319; server.ts:166)
  - IPC uasco:resume -> POST /v1/control/resume (app.js:32; main.mjs:320; server.ts:170)

**c. tests (Linux, executed)**
  - `tests/v7-ux-wp4-tower.test.ts` — file PASS 41 / FAIL 0; tests: “shows verified health and wires Stop/Resume buttons to the context”; “Resume is not called when confirm resolves false or ctx.confirm is missing (fail-closed)”
  - `tests/v7-ux-shell.test.ts` — file PASS 29 / FAIL 0; tests: “STOP_ALL from the palette reuses the EXISTING stop dialog + confirmation and adds NO write/side-effect”; “confirm=true: resume called once only after the dialog resolves; re-entry guard blocks a second click”; “confirm=false: no resume and confirm.cancelled is announced”; “missing ctx.confirm: fails closed, no resume”
  - `tests/v7-b4-desktop-shell.test.ts` — file PASS 52 / FAIL 0; tests: “has landmarks, a skip link targeting main, a live status region and an accessible stop dialog”; “has a role=alert element inside the top-bar actions next to ACIL DURDUR, shown on failure, cleared on retry/success, and still announced”
  - note: No test clicks #stopConfirm and asserts ctx.stop / window.uasco.stop is called (grep stopConfirm in tests: only id lists at v7-b4-desktop-shell.test.ts:326 and v7-ux-shell.test.ts:166); the dialog is only asserted to open (palette) and to exist (static). No test of an impact preview or per-scope stop, because neither exists. Not covered: real Electron IPC, real GLOBAL_STOP effect on running work, design parity.

**d. merged since audit basis (e12dbdd)**
  - `a874abf` UI-007: require explicit confirmation before Resume (shell banner and Control Tower) — Diff adds resume-confirm.js and wires shell.js:204 and tower.js:62: the CSV 'Global stop dialog + resume exist' part gets a resume confirmation; it does not add impact preview or per-scope stop.
  - `0fa9568` UI-251: Recovery Center panel for failed views and unreachable control API — shell.js +4 lines (recovery panel wiring); not a stop item.
  - `bbafa45 / 005b1b7 / cb7c1c7 / 50f560e / eee87b3` tower.js attention summary, stage timeline, retry fact — Other panels of tower.js; no change to the stop card.
  - covered_items:
    - 'Global stop dialog + resume exist': index.html:53-58, shell.js:196-203, app.js:31-32, main.mjs:319-320 (CSV cited :267-268, drifted), resume now confirmed (resume-confirm.js).
  - uncovered_items:
    - 'no per-scope stop': still only the global route (server.ts:166).
    - 'no blast-radius/impact preview': dialog body is static text (locales/en.js:151 stop.dialog.body; index.html:55).

**e. remaining delta**
  - Stop dialog has no impact/blast-radius preview: index.html:55 shows only the static stop.dialog.body text and shell.js:196-203 passes no data; the shell already holds cockpit and attention reads (shell.js:116 reads, :118 stores data.cockpit and data.attention) but renders none in the dialog. Backlog task B2-UI-124 (live impact counts) exists as AUTHORITY_REQUIRED, not READY.
  - No per-scope stop: the only stop path is the global one (main.mjs:319 -> POST /v1/control/stop, server.ts:166 writes the single GLOBAL_STOP.json); per-scope would need a new endpoint + IPC in protected main.mjs (CSV authority_needed). UNKNOWN: which scopes the design means.
  - Test gap: no test drives #stopConfirm -> ctx.stop -> window.uasco.stop (see c.note); only dialog open/exists and resume confirmation are tested.
  - (the stop-confirm test gap is shared with UI-007: one S test task, see UI-007 g)
  - NOT_VERIFIED_LOCAL_ONLY: design parity, real Electron IPC and real stop effect.

**f. evidence class:** CODE_PRESENT (global Stop dialog + confirmed Resume; resume confirmation and Stop wiring have passing Linux tests, but the stop-confirm to IPC path is untested); impact preview and per-scope stop ABSENT; design parity NOT_VERIFIED_LOCAL_ONLY

**g. follow-up:** B2-UI-124: Stop dialog shows live impact counts (active runs, blocked items; unreadable shown as an em dash) plus a test that #stopConfirm triggers ctx.stop (needs Founder authority; per-scope stop is a separate server+protected-IPC task) — size M; files: `apps/desktop/renderer/shell.js`, `apps/desktop/renderer/model.js`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `apps/desktop/renderer/styles.css`, `tests/v7-ux-shell.test.ts`

### UI-125 — Brownfield Repo İçe Aktarma

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-125 column requirement_ref (basis e12dbdd)`: UI-125; D04 / D116 (UX-DEC texts UNKNOWN_SOURCE)
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-125 column missing_functions (basis e12dbdd)`: importPanel performs brownfield import; design wizard step depth/parity UNKNOWN_SOURCE; never exercised against real repo in desktop app | design action_contract=existing view actions only; state_variants=loading/empty/error/denied via state kit
  - `docs/planning/BACKLOG_CHECKPOINT.json task UI-125 (status DONE)`: Gap: submitImport classifies the response with the generic describePostResult. A 400 IMPORT_REJECTED (path, source or ZIP problems) is shown as 'schema validation (HTTP 400). Check the fields'
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); D04 / D116 and UX-DEC texts are UNKNOWN_SOURCE (Founder PC, not in repo); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); The design's wizard step depth for brownfield import is not defined in the repo; no docs/ux/UI-125 file exists (backlog marks it optional)

**b. route / views / data bindings**
  - route: #/projects (routes.js:18); the same importPanel is also embedded in the project workspace (studio-workspace.js:10)
  - views: `apps/desktop/renderer/views/studio-wizard.js (pickImportPath :107, submitImport :115, importPanel :126)`, `apps/desktop/renderer/project-core.js (buildImportRequest :165, describeImportResult :147)`, `apps/desktop/renderer/views/projects.js (mount :178)`
  - GET /v1/projects (projects.js:162 ctx.api.projects) - project selector for the form
  - native file dialog via ctx.native.pickImportPath (studio-wizard.js:108-110; main.mjs uasco:pick-import-path :285) - the path never comes from typed text
  - POST /v1/projects/:id/import with exactly {kind,path} (studio-wizard.js:119 via ctx.api.post; path project-core.js:171; server.ts:388)

**c. tests (Linux, executed)**
  - `tests/v7-ps1b-project-studio-ui.test.ts` — file PASS 169 / FAIL 0; tests: “every closed-set rejection code maps to a static key that prints the exact code, never post.err.400”; “unknown safe codes get the generic code keys; missing or unsafe codes get a generic key without a code”; “422 specific reasons and the three 409 variants map to specific keys”; “panel: a failed import shows the specific key, keeps the chosen path for retry and focuses the alert; 2xx still resets”; “import: path comes only from the native dialog result, submit stays disabled until chosen, and the POST carries exactly {kind,path}”; “import: cancelling the dialog or a missing native bridge sends nothing; switching the type clears the chosen path”
  - note: Server-side import behaviour is tested elsewhere (tests/v7-sbx8-agent-config.test.ts 'API: POST /v1/projects/:id/import returns the quarantine evidence...', tests/v7-ps1a-project-studio.test.ts) but those are not desktop-screen tests and are not listed. All UI tests use a fake native dialog and fake api.post; no import against a real repo through the desktop app (CSV: 'never exercised against real repo').

**d. merged since audit basis (e12dbdd)**
  - `63b71f1` UI-125: show specific import rejection/failure codes (renderer-only) — Diff adds describeImportResult (project-core.js:147) and switches submitImport to it (studio-wizard.js:120): fixes the backlog-recorded misleading generic 400/422/409 messages; does not change wizard step depth.
  - `9358183 / 675a441` Founder idea -> first mission panel in the wizard; first-delivery wiring fixes — git log e12dbdd..HEAD -- views/studio-wizard.js lists only 63b71f1, 9358183 and 675a441; the other two add the idea panel and change how the created project id is stored (importDraft.projectId=id), not the import request or result handling.
  - covered_items:
    - 'importPanel performs brownfield import': importPanel studio-wizard.js:126-145 + POST import (studio-wizard.js:117) unchanged; error classification now specific (project-core.js:140-160).
  - uncovered_items:
    - 'design wizard step depth/parity UNKNOWN_SOURCE' (spec absent).
    - 'never exercised against real repo in desktop app' (Local-only).

**e. remaining delta**
  - The import success path ignores the server's quarantine evidence: POST /v1/projects/:id/import answers {project, import:{kind, headSha, agentConfigQuarantine?}} (server.ts:405) but submitImport only prints 'Import request accepted.' (studio-wizard.js:121, locales studio.import.done); grep -i quarantine in views/ and project-core.js hits only the failure key studio.import.err.quarantine, so imported repos whose agent-config files were quarantined are shown the same as clean imports (observed gap, not in the CSV text).
  - UNKNOWN: spec not in repo - the design's wizard step depth/parity for brownfield import.
  - NOT_VERIFIED_LOCAL_ONLY: import of a real repo through the real desktop app, and design parity.

**f. evidence class:** TEST_PASS_LINUX (import panel, native-dialog-only path, specific error codes: tests/v7-ps1b-project-studio-ui.test.ts 169/0); NOT_VERIFIED_LOCAL_ONLY for real-repo import and design parity; wizard depth SPEC_MISSING

**g. follow-up:** UI-125: show agent-config quarantine evidence (count, truncated, storedUnder) after a successful import — size S; files: `apps/desktop/renderer/views/studio-wizard.js`, `apps/desktop/renderer/project-core.js`, `apps/desktop/renderer/locales/en.js`, `apps/desktop/renderer/locales/tr.js`, `tests/v7-ps1b-project-studio-ui.test.ts`

### UI-134 — 599 Rol / Gerçek Worker Ayrımı

**a. spec sources**
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-134 column requirement_ref (basis e12dbdd)`: UI-134; UX-DEC-062 (UX-DEC texts UNKNOWN_SOURCE)
  - `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv row UI-134 column missing_functions (basis e12dbdd)`: 599-role catalog vs worker distinction shown (workforce.js '599'/'worker' refs); cluster->guild taxonomy only on PR #22; design matrix parity UNKNOWN_SOURCE | design action_contract=read-only today; mutating actions per POST allow-list only; state_variants=kind=matrix; empty/loading/error/denied states unverified
  - `docs/inventory/2026-10-19/raw/ux-decisions.csv row UX-DEC-062`: UX-DEC-062 - text UNKNOWN_SOURCE (Founder PC, not in repo); ... dedicated screens: UI-133,UI-134,UI-170
  - `apps/desktop/renderer/views/workforce.js:3`: 599 kayıt rol TANIMLARI kataloğudur; 599 canlı/aktif ajan DEĞİLDİR ve sertifikalı işçi DEĞİLDİR.
  - spec_missing: 252-screen design package UASCO_NEON_252_EKRAN_TAM_PAKET_2026-10-16 is UNKNOWN_SOURCE (Founder PC only; docs/inventory/2026-10-19/README.md:136); UX-DEC-062 text UNKNOWN_SOURCE (ux-decisions.csv row 63); ec105b7-basis SCREEN_TRACEABILITY_252_PLUS.csv / AUDIT_252_GAP_REPORT.md not in repo (BACKLOG P0-REMAINDER-AUDIT specFile points to unmerged branch v6/pkg-t4-...@9dbb708); 'kind=matrix' state variant (CSV) is not defined: which matrix (role x status? guild x counter?) is not in the repo

**b. route / views / data bindings**
  - route: #/workforce (routes.js:20)
  - views: `apps/desktop/renderer/views/workforce.js (catalogNote :286; registered vs active panels :288-294; overview semantics :113; detail notRuntime :228; factoryStatusPanel :14; taxonomySection :247; identityCard :191)`, `apps/desktop/renderer/workforce-taxonomy-core.js (buildTaxonomy :3)`, `apps/desktop/renderer/agent-factory-core.js (FACTORY_COUNTERS :4)`
  - GET /v1/roles?limit=100[&cursor] (api.js:120; workforce.js:277) - definitions (599)
  - GET /v1/agents (api.js:104) - registeredRoles/certified (canonical count)
  - GET /v1/cockpit (api.js:53) - workforce.activeWorkerRuns (real workers)
  - GET /v1/work-runs (workforce.js:277) - live runs / fleet
  - GET /v1/roles/status-summary (api.js:203; STATUS_SUMMARY_PATH agent-factory-core.js:2; server route apps/control-api/src/routes/role-status.ts:13) - five separate counters
  - GET /v1/roles/:roleId (api.js:134) on selection

**c. tests (Linux, executed)**
  - `tests/v7-ux-wp-agents.test.ts` — file PASS 69 / FAIL 0; tests: “renders an overview bound to the live catalog: real total, UNKNOWN runtime and 0 certified / NOT_EVALUATED, never implies active agents; keeps the honest KPI panels and drops the stale planned panel”; “renders the read-only tree from the live catalog with real totals”; “view shows a skipped note with numbers, and 'unclassified' (never 'empty') when nothing is classifiable”; “renders five separate counters, the target, a by-guild table and the basis; nothing is summed”; “English rendering shows the honest-semantics note in English and does not call role definitions live agents”; “when cockpit, agents and catalog all fail: em-dash counts, no VERIFIED claim, no role rows, no invented 599”
  - `tests/v7-int-r3-desktop.test.ts` — file PASS 7 / FAIL 0; tests: “workforce screen shows 599 registered, the certified count and 363 only as a LEGACY_REFERENCE_ONLY note”
  - `tests/v7-b5-work-screens.test.ts` — file PASS 169 / FAIL 0; tests: “separates registered roles (GET /v1/agents) from active workers and lists live runs; carries the 599 ≠ running note and the live /v1/roles role-catalog panel (UX WP-AGENTS, no stale planned panel)”
  - note: Fixture/fake-DOM tests. 'Denied' state: workforce reads are GET-only and api.js has no DENIED read state (grep DENIED api.js: no match), so no denied test exists; loading is covered only by the generic UI-105 skeleton test in tests/v7-ux-wp2-cockpit.test.ts (re-exports viewSkeleton from every covered view). Tests do not use the real server WorkRun shape (see e). Not covered: design matrix parity; real desktop app + live backend.

**d. merged since audit basis (e12dbdd)**
  - `0bf8e69 / 0392cf7 (PR #22, merged via 1b40c1b)` UI-197: read-only cluster>guild role taxonomy on #/workforce (+ remediation) — Diff adds taxonomySection (workforce.js:247) and buildTaxonomy (workforce-taxonomy-core.js:3): closes the CSV gap 'cluster->guild taxonomy only on PR #22'.
  - `4dcfab1` LANE-A: Agent Factory status panel in the role catalog — Diff adds factoryStatusPanel (workforce.js:14): five counters (registered/implemented/tested/certified/running) per guild kept separate and never summed - strengthens the 599-vs-worker distinction.
  - `cba3ca8 / 33c6770` UI-133 agent identity card (certified only with passing evaluation) — workforce.js:191-210: definition-vs-certified distinction on role detail.
  - `2bb5c30 / 1da6811` UI-030 fleet grid / UI-032 worker detail — Real-worker side of the distinction (per-run cards, telemetry UNKNOWN): workforce.js:54-100.
  - `798c7b4` UI-028 catalogue paging — Definition-side list paging; no change to the distinction itself.
  - covered_items:
    - '599-role catalog vs worker distinction shown': workforce.js:3 (header), :113, :228, :286, two separate KPI panels :288-294, factory counters :14-34, identity card :191-210.
    - 'cluster->guild taxonomy only on PR #22': now on v7/integration (workforce.js:247-267; tests 'UI-197 workforce taxonomy' 8 tests pass).
    - 'empty/error states unverified': covered by 'test+states workforce: negative' tests (9 tests, all pass).
  - uncovered_items:
    - 'design matrix parity UNKNOWN_SOURCE'.
    - 'denied' and real 'loading' state tests for this screen (no workforce-specific test; see c.note).

**e. remaining delta**
  - The 'real worker' side of the distinction disagrees with the server: the live-runs table and fleet use liveRuns (work-core.js:28,:605) = QUEUED/LEASED/STARTING/RUNNING/VERIFYING/REVIEWING while the 'Active worker runs' KPI (workforce.js:293-295) is the server count of LEASED/RUNNING/CHECKPOINTING/VERIFYING (core/workos/run-state.ts:24; store.ts:771) - same defect as UI-030, one shared fix.
  - QUEUED is a separate 'waiting' bucket, not a live worker (see UI-030 e: UNLEASED_RUN_STATUSES, core/workos/run-state.ts:26); the shared fix keeps it out of the 'real worker' count.
  - UNKNOWN: spec not in repo - what the design's 'matrix' presentation is; the nearest existing element is the by-guild five-counter table (workforce.js:22-24).
  - NOT_VERIFIED_LOCAL_ONLY: design matrix parity, and real desktop app + live backend run.

**f. evidence class:** TEST_PASS_LINUX (599-definition vs worker distinction, taxonomy, factory counters: tests/v7-ux-wp-agents.test.ts 69/0); design matrix parity NOT_VERIFIED_LOCAL_ONLY / SPEC_MISSING

**g. follow-up:** Shared with UI-030 follow-up: align live-run status set with the server active-worker set so the real-worker side of #/workforce matches the KPI — size S; files: `apps/desktop/renderer/work-core.js`, `apps/desktop/renderer/fleet-core.js`, `apps/desktop/renderer/views/workforce.js`, `tests/v7-ux-wp-agents.test.ts`
