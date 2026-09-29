# UASCO TAM ÜRÜN TESLİM — ANA (MASTER) ETA RAPORU — v3 (F1-F7 DÜZELTİLMİŞ, YERİNDE)

Tarih: 2026-10-16. Mod: SALT-OKUNUR sentez. Hiçbir kod/durum/çalışan iş değiştirilmedi, hiçbir şey push edilmedi, harcama yapılmadı (`origin/master` hâlâ **061f78d**, teyit edildi). Devam eden işler (UX WP2 Founder Cockpit premium, M1A-MODE) DURDURULMADI.

> **v3 BU DOSYANIN v2 SENTEZİNİ GEÇERSİZ KILAR (SUPERSEDES v2).** v2'nin ÖLÇÜMLERİ ve KANITI korunur (yeniden türetilmez). v3 = v2 + bağımsız eleştirmenin **F1–F7** rötuşları + Founder 2026-10-16 düzeltmesi. Yeni Master/mimari/ürün/kapsam OLUŞTURULMADI; mevcut rapor yerinde düzeltildi. **Ana başarı metriği artık doküman/paket sayısı değil, uçtan uca senaryonun GERÇEKTEN ÇALIŞMASIDIR.**

> DÜRÜSTLÜK KURALI (korunur): Hiçbir şey bir doküman/katalog kaydı andığı için "tamamlandı" sayılmaz. 599 rol = HEDEF yetkinlik kataloğu (eşzamanlı işçi değil; `role-definitions.json`=599, **0/599 değerlendirildi**, her kayıt `runtimeStatus:UNKNOWN / proficiencyStatus:NOT_EVALUATED`). 216 konu = uzlaştırılmış katalog, servis değil. Commit sayısı tamamlanma değildir. Hiçbir satır çıplak UNKNOWN bırakılmaz: her satır ya takvim aralığı ya "eng-süresi + <açık engel>" verir (F6 gereği P95'ler de dahil).

---

## (0a) BEŞ DOĞRUDAN YANIT (Founder'ın ana soruları) — reviewer-saat-sınırlı takvim

**İki tarih ASLA karıştırılmaz:**
**A = koordineli analiz + planlama + GERÇEK KAYNAK üretimi** (Claude uzman ekibiyle, kaynak düzeyi).
**B = AYNI zincir + GERÇEK TESTLER + ÇALIŞAN ürün + yetkili sunucuya DEPLOY + izleme** (B asla A gibi sunulmaz).

| # | Soru | P50 | P80 | P95 | Adlı kapı |
|---|---|---|---|---|---|
| **1** | İlk koordineli uzman ekip GERÇEKTEN ne zaman kullanılabilir? **(= A)** | **~28 Kas 2026** | ~2 Oca 2027 | ~1 Mar 2027 | Pre-dev backend kontrat tanımı (supervisor-owned, F2: 4/7/11 wd) |
| **2** | İlk web platformunu GERÇEK testlerden geçirip çalışır teslim? **(= B, test ucu)** | **~10 Şub 2027** (koşullu) | ~1 Nis 2027 | ~15 May 2027 | **FD-REL-1 yürütme-izolasyon KARARI** (Founder; gecikirse B birebir kayar) |
| **3** | Sunucu detaylarımla kendisi kurup yayınlar? **(= B, deploy ucu)** | **~25 Şub 2027** (koşullu) | ~15 Nis 2027 | ~1 Haz 2027 | Founder sunucu erişimi (sunucunun kendi auth/TLS/SSH/CI-secret'ı — **Authenticode DEĞİL**, bkz §6) |
| **4** | Canlı projeyi izleyip bakımını yapar? **(= B, ops ucu)** | **~15 Mar 2027** | ~1 May 2027 | ~15 Haz 2027 | Canlı deploy tamamlanması (SC-16 Ops/Recovery ~3-5 wd; run-ledger VAR) |
| **5** | TÜM onaylı Desktop tasarımı tamamen görünür? **(ALL-FINAL)** | **~5 Şub 2027** | ~3 Nis 2027 | **~Haz–Tem 2027** (F6: SC-05/06/14 backend kontratı + ~12-18 wd koşullu) | SC-05/06/14 backend owner/kontrat + 3D GPU/perf |

**A↔B farkı özeti:** A = fikir→BA→analiz→PO/PM→mimari→UX→koordineli KAYNAK kod→statik güvenlik→bağımsız inceleme→KAYNAK teslim. Omurga (üretim+inceleme+export) BUGÜN kurulu+açık; kalan çekirdek = BA/PO/PM/Mimari rollerini koordine+kullanılabilir yapmak. **B**, A'nın ürettiği projeyi GERÇEKTEN çalıştırır (test+preview), yetkili sunucuya kurar ve izler — bu yüzden B, A'nın mühendisliği + **açık yürütme-izolasyon kararı** + **Founder sunucu erişimi** ile sınırlıdır; bu iki insan/dış kapı throughput ile hızlanmaz. 2-3-4 numaralı yanıtlar B'nin alt uçlarıdır.

## (0b) ÖZET TABLOSU — TESLİM HEDEFLERİ (F1–F7 düzeltilmiş; bugün 2026-10-16; reviewer-saat-sınırlı takvim, Senaryo A)

| TESLİM | GERÇEK TAMAMLANMA DURUMU | KALAN İŞ | P50 | P80 | P95 | KRİTİK ENGEL |
|---|---|---|---|---|---|---|
| **İlk gerçek otonom UASCO (= A, kaynak)** | PARTIAL — üretim+bağımsız inceleme+export zinciri BUGÜN VAR, kurulu+açık (0.7.0-dev.1, T0). Çekirdek roller eksik: BA (C), PO/PM/SA (D), Mimari motoru (E), UX üretim (F). Koordinasyon çekirdeği (I) + implementer≠reviewer (G/J) VAR. | Pre-dev backend kontratları TANIMLA (F2: 4/7/11 wd); BA workspace, PO/PM Plan Studio, Mimari seçim motoru kur ve koordine et. | **~28 Kas 2026** (~25 wd, paylaşım-indirimli) | ~2 Oca 2027 (~41 wd) | ~1 Mar 2027 (~62 wd) | Pre-dev backend kontrat tanımı (supervisor-owned) + tek-reviewer serileştirme |
| **Bütün onaylı Desktop UI/UX (ALL-FINAL)** | PARTIAL — omurga güçlü; SC-05/06/14/18 backend-UNKNOWN; 3D yok. | İlk-kul Desktop → Buildable T4 → ALL-FINAL (kapılı 4 ekran + 3D). | İlk-kul **~6 Kas 2026**; Buildable T4 (F1-de-naive) **~13 Ara 2026**; ALL-FINAL **~5 Şub 2027** | İlk-kul ~15 Kas; T4 ~31 Oca; ALL-FINAL ~3 Nis 2027 | İlk-kul ~3 Ara; T4 ~13 Nis; ALL-FINAL **~Haz–Tem 2027** (F6 kontrat-koşullu) | SC-05/06/14 backend owner/kontrat + 3D GPU/perf (düşük) |
| **Web+backend+mobil yazılım fabrikası** | web+backend kaynak üretimi T1'de VAR; mobil build/test NOT_IMPLEMENTED/BLOCKED. | Mobil toolchain'i runner'a bağla; sonra build/test ÇALIŞTIRMA iki kapıda. | eng **~4 hf** + 2 kapı (F5) | eng **~6 hf** + 2 kapı | eng **~8 hf** + 2 kapı | Ortak kapı: (i) yürütme-izolasyon kararı + (ii) dış cihaz/host altyapısı (Android/iOS cihaz, macOS host, Appium) |
| **Sunucu yönetimi, auto-deploy, operasyon** | PARTIAL — CI yalnız doğrulama; run-ledger/audit/recovery IMPLEMENTED; server/deploy/auto-update YOK. | B8 CI-release (~4 wd), Ops/Recovery UI (SC-16 ~3-5 wd), SRE (SC-11), auto-deploy. | CI-release+Ops eng **~Ara 2026-Şub 2027**; auto-deploy = +Founder sunucu erişimi | aynı + sunucu erişimi | aynı + secure-update (installer imzalama) | **Founder sunucu/servis erişimi** (web-deploy için Authenticode GEREKMEZ, §6) |
| **Ticari satışa hazır UASCO** | NOT_IMPLEMENTED (~%90 kalan) — güvenilirlik backlog açık, müşteri izolasyonu kanıtlanmadı, imzalama yok. | Q-FIRSTEXE-MIN + Q-REL alt küme + Q-ISO kanıtlı + imza sertifikası + secure-update + ticari dağıtım. | M1 sonrası **2-4 ay** (~Ara 2026-Şub 2027) | **4-7 ay** (~Şub-May 2027) | **kontrat-koşullu**: T5 çekirdek eng ~7-9 ay + dış sertifika/anlaşma gecikmesi | Kod-imzalama sertifikası (SADECE installer dağıtımı, §6) + ticari anlaşma |
| **599 uzman + ileri kapsam** | PARTIAL katalog / NOT_IMPLEMENTED eval — 599 TARGET CLEAN, **0/3.594 eval**; eval infra yok. İleri hedeftir, ilk-kul ürünün ÖNÜNE konmaz. | WFR-06 eval infra + 27-rol pilot + 3.594 eval + 27.554 kapsama + drift. | **3-6 ay** (~Oca-Nis 2027) | **6-9 ay** (~Nis-Tem 2027) | **kontrat-koşullu**: eval-infra + token kotası açılırsa 12+ ay; açılmazsa UNKNOWN | Rol-değerlendirme hacmi (3.594 eval) + yürütme-izolasyon + token kotası |
| **Bütün nihai UASCO** | PARTIAL (~%90 kalan) — R-ROLES-EVAL uzun direk + 216-konu gövdesi + RE Lab + Skill Academy, hepsi yürütme-infra + token kotası kapısında. | Yukarıdakilerin tamamı + 216 konu implemente+kanıtlı + RE Lab + tam Skill Academy. | **6-12 ay** (~Nis-Eki 2027) | **12-18 ay** (~Eki 2027-Nis 2028) | **kontrat-koşullu**: dış deps + token kotası açıksa ~18-24 ay; kapalıysa UNKNOWN | 599-eval hacmi + yürütme-izolasyon + token kotası + dış deps |

> **Üç katmanlı dürüstlük:** (1) BUGÜN VAR = yalnız-üretim yarısı (fikir→kod→statik güvenlik→bağımsız inceleme→KAYNAK export; kurulu+açık). (2) A = BA/PO/PM/Mimari/UX koordine+kullanılabilir (kaynak düzeyi). (3) B = üretilen projenin testlerini + canlı preview'ını GÜVENLE çalıştırmak → açık yürütme-izolasyon kararına bağlı. Kendi temel-model geliştirmesi AYRI ileri kapsamdır, ilk UASCO'nun koşulu DEĞİLDİR.

---

## (1) T0 — BUGÜNKÜ GERÇEK DURUM (2026-10-16, yeniden doğrulandı)

- **Kurulu + açık (T0):** M1a installer BUILT ve KULLANICI-KURULU; `%APPDATA%/UASCO` aktif; UASCO 0.7.0-dev.1 açılmış. İlk installer **YAPILDI ve KURULDU** (`UASCO-wt/m1a-build/dist-installer/UASCO-Setup-0.7.0-dev.1-win-x64.exe`, ~110 MB).
- **Ürün ucu:** v2-m1a @ 2176741; çekirdek kaynak doğrulandı: `core/workos/{execution-gate,runner,devrun,risk-admission}.ts`, `apps/control-api/src/server.ts`, `registries/role-definitions.json`=**599** (teyit). UX WP1b token @ 6a9a577 CLEAN; WP2 DEVAM EDİYOR.
- **Yayın durumu:** `origin/master` hâlâ **061f78d** (teyit) — hiçbir şey push edilmedi; hiçbir şey READY/COMPLETE değil.
- **Korunan dürüst varlıklar:** fail-closed yürütme kapısı (`execution-gate.ts` — prod'da provider yok → her zaman BLOCKED), builder≠reviewer bağımsızlığı (`assertIndependentExecutors`), kanıt-bağlı kabul (accept-run sha256, uyuşmazlıkta 409), uydurma canlı veri YOKLUĞU.
- **Ölçülmüş throughput (v2'den; değişmedi):** implementasyon p50 14.2 / p80 30.7 dk (Opus p50 20), bağımsız inceleme p50 5.8 / p80 9.4 dk, CLEAN'e ort. ~1.8 döngü (güvenlik-kritik 2-3, son birkaçı 3-5), kanonik doğrulama 26-30 dk, governed freeze ~32 dk; ~15 paket ~7h akşam oturumunda CLEAN (2-5 paralel); incelemelerin 15/28'i BLOCKED (~%54).
- **Darboğazlar:** TEK governed CLAUDE_REVIEWER (serileştirilmiş; Codex emekli, GOV2), Founder-onay gecikmesi (10 dk-1.5h gündüz, ~8h gece), 6+ sınıflandırıcı takılması ~30h'de, IObit ~1.9 çekirdek yük.
- **CANLI AÇIK ENGEL (FD-REL-1-REJECT):** host üzerinde OS izolasyonu olmadan güvenilmeyen/AI-üretimi kod ÇALIŞTIRILAMAZ. Sandbox yöntemi GERÇEKTEN KARARSIZ. Hiçbir fiziksel makine/VM/VPS/Managed-Agents/ücretli infra ZORUNLU teslim koşulu DEĞİLDİR; açık güvenlik kararı olarak durur (§5).

---

## (2) İLK-RELEASE İÇİN GEREKLİ ROLLER — gerçek katalogdan (`role-definitions.json`)

599 rolün tamamı **çalışan uzman DEĞİLDİR**: her kayıt `runtimeStatus:UNKNOWN`, `proficiencyStatus:NOT_EVALUATED`, `allowedWorkerScope:[]`, `permissionGrants:[]`, tüm `evaluationSpecs` (EV-01/02/03...) `NOT_EXECUTED`. Yani katalog roller tanımlı ama **0/599 sertifikalı**. İlk ana sürüm için ileri sertifikasyon GEREKMEZ (Founder madde 3); aşağıdaki ~13 rol FONKSİYONEL olarak gereklidir. Görevler katalogdaki gerçek `responsibilities`/`specializationBoundaries`/`forbiddenActions`'tan alındı.

| # | Rol (katalog title / guild) | Görev-yürütme ödevi | Çıktı artefaktı | Koordinasyon arayüzü | Sorumluluk sınırı (forbiddenActions) | Katalog durumu |
|---|---|---|---|---|---|---|
| 1 | **Principal Business Analysis Architect** / G03 | İş-süreç ayrıştırma, domain invariant'ları, kabul örnekleri; "discovery vs assumption" | BA gereksinim paketi + kabul kriterleri (kanıta bağlı) | Founder idea'yı alır → PO/PM'e besler | Fabricated research; consent'siz müşteri-verisi; self-approval; unauthorized network/finansal/prod | tanımlı / NOT_EVALUATED |
| 2 | **Principal Requirements Engineer** / G03 | Sürümlenmiş paydaş invariant'ları, kabul testleri, iz bağları (trace links) | Gereksinim/iz matrisi, kabul-testi taslağı | BA↔Architect↔QA köprüsü | aynı (fabricated research, self-approval...) | tanımlı / NOT_EVALUATED |
| 3 | **Principal Product Manager** / G03 | Ürün-pazar uyum hipotezi, aktivasyon/retention metriği, kabul kriteri (PO rolü) | Ürün kapsamı + öncelik + kabul kriteri | BA'dan alır → Program Delivery'e | aynı | tanımlı / NOT_EVALUATED |
| 4 | **Principal Program Delivery Architect** / G02 | Milestone kabulü, sözleşmesel kontroller, teslim-risk burn-down, Dependency DAG + kritik yol (PM rolü) | İş-paketi planı, DAG/Gantt, ETA-güven | PM merkez: tüm rolleri sıralar, Founder'a plan sunar | **Invented delivery dates; silent scope growth**; self-approval | tanımlı / NOT_EVALUATED |
| 5 | **Principal Solution Architect** / G05 | Paydaş NFR izlenebilirliği, seçenek değerlendirmesi, rollback tasarımı, DDD sınırları + veri sahipliği | Mimari karar kaydı (ADR) + stack/infra seçimi + gerekçe | PM plan'ından alır → implementer'lara kontrat | **Architecture without data-backed tradeoffs; undocumented cross-domain coupling** | tanımlı / NOT_EVALUATED |
| 6 | **Principal Interaction Design Expert** / G04 | Focus/klavye/input/error durum makinesi, WCAG etkileşim desenleri | UX akış + ekran spec + a11y kriteri | Architect'ten alır → Frontend'e handoff | **Inaccessible interaction; copyrighted asset reuse** | tanımlı / NOT_EVALUATED |
| 7 | **Principal Backend Architect** / G08 | Servis ayrıştırma, veri modeli, auth sınırı, API kontratları; contract-first | Backend kaynak + API kontratı + auth sınırı | Architect kontratını uygular; DB + Frontend ile kontrat paylaşır | **Authz bypass; non-idempotent duplicate transactions**; self-approval | tanımlı / NOT_EVALUATED |
| 8 | **Principal React & Next.js Engineer** / G07 | React server/client state bütünlüğü, hydration, render performansı | Frontend kaynak (UI + state) | UX handoff + Backend API kontratı | **Client-side secrets; inaccessible critical UI** | tanımlı / NOT_EVALUATED |
| 9 | **Principal Database Architect** / G12 | Query tutarlılığı, migration provenance, index sağlığı, restore; ACID/izolasyon | Şema + migration + restore kanıtı | Backend Architect ile veri modeli kontratı | **Data loss from migration; untested restore** | tanımlı / NOT_EVALUATED |
| 10 | **Principal End-to-End Test Expert** / G26 | Uçtan uca çok-bileşen akış, fixture determinizmi, kritik-yol gözlemlenebilirlik | Test paketi + kabul kanıtı (assertion'lı) | Tüm implementer'lardan alır → Review'e | **Fake PASS; tests without assertions**; self-approval | tanımlı / NOT_EVALUATED |
| 11 | **Principal Application Security Architect** / G22 | Kod/DAST manuel doğrulama, proof-of-fix kalitesi, bileşen gözlemlenebilirlik | Güvenlik bulgu raporu + fix-kanıtı | Dev↔Review köprüsü, SOC | **Unscoped target scans; closed findings without fix proof** | tanımlı / NOT_EVALUATED |
| 12 | **Principal Secure Code Review Expert** / G22 + **Principal Independent Review Coordination Expert** / G51 | Güvenli kaynak incelemesi, taint/call-graph, regresyon kapsamı; **kapsam-sınırlı bağımsız Claude salt-okunur inceleme** + issue kapatma; builder/reviewer izolasyonu | CLEAN/BLOCKED kararı + değişmez kanıt (diffSHA bağlı) | **Bağımsız** (implementer'dan izole); Founder'a karar | **Self-granted privilege; fake green status; self-approval or evidence fabrication** | tanımlı / NOT_EVALUATED |
| 13 | **Principal DevOps Architect** / G20 | DevOps işletim modeli, platform sahipliği, build-to-prod tehdit modeli, DORA; yazılım tedarik-zinciri güveni | CI-release artefaktı (SBOM/SHA256SUMS), deploy planı | PM'den alır; sunucu erişimiyle deploy | **Unsigned provenance; review/CI gate bypass**; self-approval | tanımlı / NOT_EVALUATED |

> Not: Katalog "Product Owner" başlığını AYRI içermiyor; PO ödevi `Principal Product Manager` (G03) altında, PM ödevi `Principal Program Delivery Architect` (G02) altında karşılanır. Bağımsız reviewer için iki ayrı rol (Secure Code Review + Independent Review Coordination) birleştirilmiştir; builder≠reviewer izolasyonu runtime'da `assertIndependentExecutors` ile zorlanır.

---

## (3) REFERANS PROJE + 13-ADIM KABUL ZİNCİRİ

**Referans proje — "TaskHub"**: çok-kullanıcılı görev/kayıt yönetim web platformu. Frontend (React/Next), backend/REST API (Node + contract-first), ilişkisel DB (PostgreSQL), çok-kullanıcı auth + rol-tabanlı erişim, görev/kayıt CRUD + audit. Küçük ama tam yığın: FE + BE + API + DB. Kabul, her kapıda GERÇEK kanıt gerektirir (doküman/katalog kaydı IMPLEMENTED SAYILMAZ).

| # | Adım | Durum | Gerçek kanıt (kod) | Eksik implementasyon | Kabul koşulu | Eng-süre |
|---|---|---|---|---|---|---|
| 1 | Founder Fikir → Claude bağlantısı | PARTIAL | `core/workos/claude-profiles.ts`, `executor-setup.ts`; `server.ts:418` /v1/system/executors, :431 local-claude/enable | Paketli LOCAL_CLAUDE ilk-çalıştırma; first-run wizard | Fikir kaydı + Claude bağlı + provenance | 2/4/7 wd |
| 2 | İş Analizi (BA) | **NOT_IMPLEMENTED** | Renderer'da BA workspace yok; `mission-types.json` yalnız katalog | Backend kontrat + Intent→Draft→BA→Review→Freeze UI | BA-first build block: freeze olmadan build başlamaz | 6/10/16 wd (backend sonrası) |
| 3 | Yazılım Analizi / gereksinim | **NOT_IMPLEMENTED** | Mission/task store primitifleri var; gereksinim-iz motoru yok | Requirements/trace matris + kabul-testi bağları | Her gereksinim ize + kabul testine bağlı | (2 ile paylaşımlı) |
| 4 | PO/PM Planlama | **NOT_IMPLEMENTED** | PO/PM analiz-plan motoru + UI YOK; `playbooks-v2.json` katalog | 3-alternatif plan + DAG/Gantt + ETA-güven | 3 GERÇEK alternatif (kapsam/maliyet/güven) veya dürüst UNKNOWN | 7/11/17 wd |
| 5 | Mimari | **PARTIAL** | `technology-radar.json` + `-decision-criteria/-compatibility-rules/-version-policies` (bol katalog); bağlı seçim motoru YOK | Kataloğu otomatik mimari/stack seçim adımına bağla + UI | Data-backed tradeoff'lu ADR, Founder-görünür gerekçe | 6/9/14 wd |
| 6 | UI/UX | **NOT_IMPLEMENTED / BLOCKED** | SC-09 VR NOT_IMPLEMENTED; Figma connector BLOCKED; Playwright kurulu değil | UX akış/ekran + design-to-code (gated: Figma/VR) | a11y-geçer akış + ekran spec | ~1-2 hf (tool sonrası) |
| 7 | Koordineli Geliştirme | **PARTIAL→IMPLEMENTED** (motor-kanıtlı) | `core/workos/runner.ts` (24-durum), `project-studio.ts`, `executors.ts`, `devrun.ts`; `server.ts` projects/import/files/git-log/git-diff/export (186-408); B3B add(a,b) AUTHORIZED→REPORTING | 4-soy entegrasyon + kanonik doğrulama + paketli LOCAL_CLAUDE | Görev sınırı çiğnenmeden FE+BE+API+DB kaynağı üretilir (lease/runId izolasyon) | 2/4/8 wd |
| 8 | QA + Güvenlik | **PARTIAL** (statik VERIFIED) | `review-pipeline.mjs`; `core/workos/{outcomes,test-surface,secret-scan,security-tools}.ts`; trivy DB eksik → statik PARTIAL | Playwright/Newman/semgrep + trivy DB; SOC UI | Secret/SCA/SAST temiz + fix-kanıtı | 3/6/10 wd |
| 9 | Bağımsız Claude İnceleme | **PARTIAL→IMPLEMENTED** (VERIFIED) | `review-pipeline.mjs` + pkg-gov1/dr1; `assertIndependentExecutors`; accept-run sha256 409; `audit/reviews/*` | Dedike reviewer yüzeyi (SC-10) | diffSHA-bağlı CLEAN/BLOCKED; reviewer≠builder | 2/3/5 wd |
| 10 | Gerçek Testler | **BLOCKED** (K kapısı) | `execution-gate.ts` (prod'da provider yok → BLOCKED); `devrun.ts:240` SBX-GATE→BLOCKED; `risk-admission.ts` R3/R4 reddi | Doğrulanmış OS-izolasyon provider + FX-2 gerçek VERIFY | Projenin kendi testleri GERÇEKTEN çalışır, PASS kanıtı | **AÇIK ENGEL** (§5) + FX-2 ~3-5 wd |
| 11 | Build / Artefakt | **PARTIAL** | `.github/workflows/ci.yml` yalnız doğrulama; release/installer workflow yok | B8 CI-release slice (SBOM/SHA256SUMS) | İmzalı-olmayan artefakt + kanıt | ~3-5 wd (gh login'li) |
| 12 | Yetkili Sunucu Deploy | **NOT_IMPLEMENTED** (dış) | server/Jenkins/GitLab credential-BLOCKED | L auto-deploy slice (sunucunun kendi auth/TLS/SSH/CI ile) | Founder sunucuya kurulum/config/deploy çalışır (Authenticode GEREKMEZ, §6) | ~3-5 wd + **Founder sunucu erişimi** |
| 13 | İzleme / Bakım | **PARTIAL** | `automation/lib/run-ledger` + audit + run logs; `server.ts` control/status/retry/resume (112-139); SC-16 PARTIAL, SC-11 PLACEHOLDER | Ops/Recovery (SC-16), SRE dashboard (SC-11), secure auto-update | Canlı izleme + incident + güvenli güncelleme | 2-4 hf |

**Kabul gerçekliği:** 2-4 çekirdek roller eksik (eng ile kapanır); 5 kısmi; 6 kapalı; 7-8-9 motor-kanıtlı VAR (kaynak); **10 açık yürütme kararına bağlı**; 11-13 kısmi + dış (sunucu).

---

## (4) ENG-SÜRELERİ — pre-dev kontrat (F2), koordinasyon, test-infra, entegrasyon, inceleme, kabul

| Kalem | P50 | P80 | P95 | Not / açık bağımlılık |
|---|---|---|---|---|
| **Pre-dev backend kontrat tanımı (F2)** | **4 wd** | **7 wd** | **11 wd** | Supervisor-owned şema/kontrat tasarımı + inceleme (BA/PO/PM/Mimari backend'leri). ARTIK çıplak değil; A kritik-yolunun başıdır. |
| Rol koordinasyonu + UI entegrasyon | 6 wd | 10 wd | 15 wd | BA/PO/PM/Mimari kısmen paralel; tek reviewer + Founder onay SERİ. |
| Test-infra (Playwright/Newman/semgrep/trivy-DB) | 3 wd | 5 wd | 8 wd | Tool-install onayı gerekir; ÇALIŞTIRMA K kapısına bağlı. |
| Entegrasyon + stabilizasyon tamponu | kanonik doğrulama 26-30 dk/entegrasyon + freeze ~32 dk + 1-2 düzeltme döngüsü | | | Paketli-mod ilk kez → churn ORTA. |
| Bağımsız inceleme (paket başına) | p50 5.8 dk × ~1.8 döngü ≈ 10 dk reviewer | güv-kritik 3-5 döngü | | TEK reviewer darboğazı (serileştirme). |
| Kullanıcı (Founder) kabulü | 10 dk-1.5h gündüz | ~8h gece boşluğu | | Her merge/trust-root/entegrasyon/install kritik-yolda. |

---

## (5) AÇIK GÜVENLİK ENGELİ — yürütme-izolasyon (K); opsiyonlar + KOŞULLU eng (F4)

Host'ta OS izolasyonu olmadan güvenilmeyen/AI-üretimi kod ÇALIŞTIRILAMAZ (FD-REL-1-REJECT, canlı Founder kararı). Yöntem UNDECIDED. Hiçbir belirli infra "gerekli/onaylı" DEĞİL; aşağıdaki opsiyonlar + **karar-sonrası KOŞULLU eng** (yalnız wiring değil, provider sec+kur+self-test dahil, F4):

| Opsiyon | Ne gerektirir | Karar-sonrası KOŞULLU eng (sec+kur+self-test) | Risk |
|---|---|---|---|
| Host yürütme + AÇIK Founder politika değişikliği | Founder onayı (politika; R0-R2 interim) | ~1-2 wd (D-REL-1 wiring) + FX-2 ~3-5 wd | Düşük-izolasyon; yalnız açık politikayla |
| Native Windows AppContainer | AppContainer launcher implementasyonu | ~3-6 wd provider + self-test + FX-2 | Orta (platform-bağlı) |
| Anthropic Managed Agents (bulut) | PoC + billing/auth (UNKNOWN) | PoC ~1 hf + entegrasyon ~2-4 wd; billing açık | Orta; dış bağımlılık |
| Yerel VM / Hyper-V | Windows edition + BIOS virtualizasyon | ~2-4 wd + VM standup; donanım kapısı | Orta; donanım-bağlı |
| Ayrı fiziksel/uzak worker | Donanım/erişim (SUSPENDED) | UNKNOWN (mimari + erişim) | Orta-yüksek |

> Engel = **açık karar + (karar sonrası) koşullu eng**. Çıplak UNKNOWN değil. Hiçbir untrusted kod izolasyon olmadan çalıştırılmaz.

---

## (6) WEB-DEPLOY ↔ AUTHENTICODE AYRIMI — zorunlu olanı kanıtla (F8-tarzı)

İki FARKLI güvenlik gereksinimi; biri diğerine YANLIŞ bağlanmış:

- **(a) Üretilen web app'in Founder-sağladığı sunucuya deploy'u** → sunucunun KENDİ auth/TLS/SSH/CI-secret'ını kullanır (Founder-sağlar). **Windows Authenticode GEREKTİRMEZ.** Deploy, DevOps rolünün CI-release artefaktı + sunucu SSH/CI credential'ı ile yapılır. Zorunlu olan: Founder sunucu erişimi — kod-imzalama DEĞİL.
- **(b) Authenticode kod-imzalama** → YALNIZCA Windows UASCO installer'ının KENDİSİNİ dağıtmak için. Ticari/geniş dağıtımda SmartScreen/güven için gerekir; web-app sunucu deploy'uyla İLGİSİ YOK.

> Kanıt: web deploy adımı (zincir §3 adım 12) `server.ts` credential-BLOCKED'a bağlıdır (sunucu erişimi), `P-SIGNING-CERT`'e DEĞİL. `P-SIGNING-CERT` (T5) yalnız installer dağıtımı satırında görünür. v2'de bu iki gereksinim bazı satırlarda birbirine karışmıştı; v3 ayırır: **web-deploy için Authenticode zorunlu DEĞİLDİR.**

---

## (7) A vs B TARİHLERİ — reviewer-saat-sınırlı takvim modeli (F3)

**Temel birim wd** = tek-şerit üretken ajan+inceleme iş-günü çıktısı (~6-7h). wd ZATEN İÇERİR: inceleme döngüleri (~1.8), reviewer serileştirme, DPI/a11y geçişleri, kanonik doğrulama (26-30 dk), freeze (~32 dk), GÜNDÜZ onay beklemeleri.

**wd → takvim dönüşümü (F3, reviewer-saat-sınırlı):** naif "5 wd = 1 hafta" KULLANILMAZ. Gerçek sınırlayıcı: tek governed reviewer ~4-6 üretken inceleme-saati/gün + ~8h gece Founder-onay boşluğu (merge/trust-root/entegrasyon/install'u ertesi sabaha serileştirir) + sınıflandırıcı takılmaları (~1/5h) + her takvim günü aktif değil. Bu yüzden **etkin aktif wd/takvim-haftası ≈ 4.2 (P50) / 3.7 (P80) / 3.2 (P95)** (naif 5 değil; wd'nin zaten içerdiği gündüz-gecikmeyi çift-saymadan, gece-boşluğu+stall+günlük-olmayan kadansı ekler). Tüm manşet tarihler bu temelden türetildi; v2'nin temiz eşlemesine göre birkaç gün-hafta GEÇ.

**A (koordineli analiz+planlama+GERÇEK KAYNAK), Senaryo A:** iş paketleri (wd, paylaşım-indirimli): pre-dev kontrat 4/7/11 + BA 6/10/16 + PO/PM 7/11/17 + Mimari-motor 6/9/14 + koordinasyon/stabilizasyon 6/10/15. Naif P50 toplamı 29 → paylaşım indirimi (pre-dev kontrat ortak temel + SC-05/06 Inspector/Command-Center/KPI paylaşımı) ~%13 → **P50 ~25 wd / P80 ~41 / P95 ~62**. Takvim: **P50 ~28 Kas 2026, P80 ~2 Oca 2027, P95 ~1 Mar 2027.**

**B (+ gerçek testler + yetkili deploy + izleme):** B = A + **açık yürütme-izolasyon kararı** (Founder; UNKNOWN gecikme) + karar-sonrası koşullu provider standup (§5) + FX-2 gerçek VERIFY ~3-5 wd + L deploy ~3-5 wd (+ Founder sunucu erişimi) + Ops/SRE ~3-5 wd. B throughput'la DEĞİL, bu iki insan/dış kapıyla sınırlıdır. **Koşullu** (K kararı ~A penceresinde + hızlı opsiyon): B-test ucu **P50 ~10 Şub, P80 ~1 Nis, P95 ~15 May 2027**; deploy ucu **~25 Şub / ~15 Nis / ~1 Haz 2027**; ops ucu **~15 Mar / ~1 May / ~15 Haz 2027**. K kararı kayarsa B birebir kayar.

---

## (8) PREMİUM DESKTOP TAKVİMİ — AYRI (18 SC + 71 UX + 2D/3D, hiçbiri düşürülmedi)

Üç ayrı tarih (reviewer-saat takvim, F1-de-naive):

- **İLK-KULLANILABILIR Desktop** (WP1b+WP2+WP3+WP4; kapılı SC-05/06/14/18 + 3D HARİÇ) = P50 12 / P80 16 / P95 22 wd → **~6 Kas / ~15 Kas / ~3 Ara 2026**.
- **Buildable tam T4** (+ WP6/7/8 + SC-16 Ops + SC-17 onboarding + CC-DPI VR + a11y; kapılı SC + 3D + secure-update HARİÇ): **F1 DÜZELTMESİ** — v2'deki P50=40 wd, kapısız SC'lerin naif toplamına (2+3+0.5+3+4+4+4+2+4+3+0.5+4+3+3=40) TAM eşitti; oysa P80/P95 zaten paylaşım indirimini yansıtıyordu. v3: P50'ye de aynı paylaşım indirimi (WP1b token temeli + Inspector/Command-Center/KPI satırı SC'ler arası ortak) uygulandı → **de-naive P50 ~34 wd**, P80 56, P95 82. Takvim: **~13 Ara 2026 / ~31 Oca 2027 / ~13 Nis 2027.**
- **ALL-FINAL Desktop** (18 SC TAMAMI incl SC-05/06/14/18 + 71 UX + 3D WP5): Buildable T4 + kapılı 4 ekran (SC-05 6/10/16, SC-06 7/11/17, SC-14 7/11/17, SC-18 opsiyonel) + 3D (5/8/13) + backend kontratları. **P50 ~5 Şub 2027, P80 ~3 Nis 2027, P95 ~Haz–Tem 2027** (F6: artık çıplak UNKNOWN değil — "SC-05/06/14 backend kontrat tanımı + ~12-18 wd" koşullu span).

71 UX-DEC kaba kapsama: 13 IMPLEMENTED / 18 PARTIAL / 13 PLACEHOLDER (11'i SC-15 Company OS) / 27 NOT_IMPLEMENTED. SC bazında (durum, wd P50/P80/P95):

| ID | Ad | Durum | wd |
|---|---|---|---|
| SC-01 Global Shell | PARTIAL (omurga IMPL) | 2/3/5 |
| SC-02 Founder Cockpit (WP2, devam) | PARTIAL | 3/4/6 |
| SC-03 Projects | IMPLEMENTED | 0.5/1/2 |
| SC-04 Project Studio | PARTIAL | 3/5/8 |
| SC-05 Founder Command/BA | NOT_IMPL (BLOCKED backend) | IF-backend 6/10/16 |
| SC-06 Planning/Architecture | NOT_IMPL (BLOCKED backend) | IF-backend 7/11/17 |
| SC-07 Work OS (WP7) | PARTIAL (omurga IMPL) | 4/6/9 |
| SC-08 Workforce (WP6) | PARTIAL (backend hazır) | 4/6/9 |
| SC-09 Assurance/QA+SOC (WP8) | PARTIAL | 4/6/10 |
| SC-10 Independent Review (WP8) | PARTIAL | 2/3/5 |
| SC-11 Delivery/SRE (WP8) | PLACEHOLDER | 4/7/12 |
| SC-12 Tower 2D/3D | 2D unwired · 3D yok | 2D 3/5/7 · 3D 5/8/13 |
| SC-13 Inbox/Approvals | IMPLEMENTED | 0.5/1/2 |
| SC-14 Knowledge/Memory | NOT_IMPL (BLOCKED backend) | IF-backend 7/11/17 |
| SC-15 Company OS (WP3) | PLACEHOLDER · backend TAM | 4/6/9 |
| SC-16 Operations & Recovery | PARTIAL | 3/5/8 |
| SC-17 Settings/First-Run | PARTIAL | 3/5/8 |
| SC-18 RE Lab | NOT_IMPL (opsiyonel; BLOCKED) | UNKNOWN (opsiyonel) |
| **T4-AGG** buildable | PARTIAL | **~34/56/82 (F1-de-naive P50)** |

---

## (9) F1–F7 ÇÖZÜM NOTLARI

- **F1 (ORTA) — ÇÖZÜLDÜ:** Buildable T4 P50 artık naif toplam DEĞİL. v2'deki 40 wd kapısız SC naif toplamına eşitti; v3 paylaşım indirimini (WP1b token + ortak Inspector/Command-Center/KPI) P50'ye de uyguladı → **~34 wd**; §8'de açıkça "de-naive" etiketli; P80/P95 (56/82) zaten paylaşımı yansıtıyordu. Buildable T4 tarihi ~11 Ara'dan ~13 Ara'ya (reviewer takvimle) ayarlandı.
- **F2 (ORTA) — ÇÖZÜLDÜ:** Pre-dev backend kontrat tanımı artık somut eng-aralığı taşıyor: **4/7/11 wd** (§4, §0b), supervisor-owned şema/kontrat tasarımı + inceleme. A kritik-yolunun başı; P50 ~T0-sıfır varsayımı kaldırıldı — bu yüzden A P50 ~20 Kas'tan ~28 Kas'a kaydı.
- **F3 (ORTA) — ÇÖZÜLDÜ:** Tüm manşet tarihler artık reviewer-saat-sınırlı modelden türetildi (§7): etkin ~4.2/3.7/3.2 wd/hafta, naif 5 değil. Tek reviewer + ~8h gece onayı + stall takvime yansıtıldı; v2'ye göre tüm tarihler birkaç gün-hafta geç.
- **F4 (DÜŞÜK) — ÇÖZÜLDÜ:** §5'te her izolasyon opsiyonu karar-sonrası KOŞULLU eng taşıyor (yalnız wiring değil; provider sec+kur+self-test). Engel = açık karar + koşullu eng.
- **F5 (DÜŞÜK) — ÇÖZÜLDÜ:** Mobil fabrika satırı artık gerçek percentile ayrımı taşıyor (eng ~4/6/8 hf); iki ortak kapı (yürütme-izolasyon + dış cihaz/host) bir kez ortak-ek olarak yazıldı.
- **F6 (DÜŞÜK) — ÇÖZÜLDÜ:** ALL-FINAL P95 artık çıplak "UNKNOWN (kontrat)" değil; kontrat-koşullu span: **~Haz–Tem 2027 (SC-05/06/14 backend kontratı + ~12-18 wd)**. Ticari/nihai P95'ler de kontrat-koşullu span'e çevrildi.
- **F7 (DÜŞÜK) — ÇÖZÜLDÜ:** "T1 slice DONE" vs "hiçbir şey READY" gerilimi netleştirildi: implementer+reviewer çifti motor/KAYNAK düzeyinde kanıtlı (DONE) ama **merge/push edilmedi, ürün READY değil** (origin/master hâlâ 061f78d). §2 tablo rol-12 ve §3 adım-9 bu ayrımı taşır.

---

## (10) KAPASİTE SENARYOLARI A / B / C (v2'den korunur)

| Senaryo | Takvim çarpanı (A'ya göre) | Maliyet | Risk | Not |
|---|---|---|---|---|
| **A — mevcut gerçek kapasite** | 1.0× referans | Mevcut abonelik | ORTA | Sürdürülebilir ~8-10 pkg-eşdeğer/aktif-gün; gerçek sınır reviewer-zamanı ~4-6 saat/gün. Impl 2-5 paralel; inceleme/freeze/Founder SERİ. |
| **B — aynı abonelik, daha iyi dağıtım** | ~0.78× p50 / ~0.85× p80 | Düşük (yalnız sıralama) | DÜŞÜK-ORTA | Reviewer-hazır kuyruk, tek-sabah onay paketi, önceden dar allow-rule, gecelik %TEMP% provaları. ~1.3-1.4× üstünde tek reviewer+onay baskın. |
| **C — kapasite artışı (compute/kota + 2. reviewer)** | ~0.62× p50 / ~0.75× p80 IF ek harcama + yönetişim-onaylı 2. reviewer; yoksa B'ye çöker | API $ UNKNOWN; kota UNKNOWN | ORTA-YÜKSEK yönetişim (2. reviewer GOV2 garantisini riske atar) | Yalnız C inceleme darboğazını kırar. Hiçbir senaryo açık yürütme-izolasyon kararını, Founder-onay gecikmesini veya dış kapıları hareket ettirmez. |

> Ne B ne C, açık yürütme-izolasyon kararını, Founder-onay gecikmesini veya dış kapıları (sunucu/sertifika/mobil infra) hareket ettirmez. A'nın ÇEKİRDEK eng işi (BA/PO/PM/Mimari) B ile hızlanır; B (doğrulanmış-çalışan) açık karara bağlı kalır.

---

*Rapor sonu (v3). Salt-okunur sentez; hiçbir kod/durum değiştirilmedi, hiçbir şey push edilmedi (origin/master hâlâ 061f78d). Devam eden WP2/M1A DURDURULMADI. CLEAN iş yeniden-iş sayılmadı. v3, v2'nin tüm ölçümlerini korur; F1–F7'yi giderir; ana başarı metriği = uçtan uca senaryonun GERÇEKTEN ÇALIŞMASI. Hiçbir satır çıplak UNKNOWN değildir. Yeni Master otorite oluşturulmadı; mevcut planlama kayıtlarına (SC_GAP, eta2-measured-data, V2-GAP-AND-QUEUE, REL-LEDGER, eta-clusters, role-definitions.json) bağlıdır.*

---

## Bagimsiz elestirmen notlari v3

Rol: bagimsiz, SALT-OKUNUR gerceklik + sadakat elestirmeni. Tarih: 2026-10-16. Kapsam: v3 raporun (0)-(10) ana bolumleri DEGISTIRILMEDI; yalnizca bu bolum eklendi. Bagimsiz dogrulama yalnizca teslim kopyasindan yapildi: `origin/master` = **061f78d** (teyit edildi). Not: raporun atifta bulundugu urun-kod capalari (execution-gate.ts, runner.ts, devrun.ts, risk-admission.ts, role-definitions.json=599, server.ts satir 418/431/186-408/112-139) bu teslim worktree'inde (v6/pkg-t4) YOK — buradaki `apps/control-api/src/server.ts` yalnizca 91 satir ve anilan uclari icermiyor; capalar v2-m1a / `m1a-build` @ 2176741 worktree'ine dayaniyor (asagida AK-1).

### F1–F7 skorkarti

| # | Bulgu | Sonuc | Kanit (raporda) |
|---|---|---|---|
| **F1** | Buildable-T4 artik naif per-SC toplami degil; paylasim-indirimi gosterildi | **COZULDU** | §8 satir 160 + §9 F1: v2 P50=40, kapisiz SC naif toplamina (2+3+0.5+3+4+4+4+2+4+3+0.5+4+3+3=40, aritmetik teyit) TAM esitti; v3 ayni indirimi P50'ye de uyguladi → **~34 wd ("de-naive" etiketli)**, P80/P95 56/82. Dedup gerekcesi (WP1b token temeli + ortak Inspector/Command-Center/KPI) yazili. |
| **F2** | Pre-dev backend kontrat somut eng-araligi + kritik yolda | **COZULDU** | §4 satir 107: **4/7/11 wd**, supervisor-owned, "A kritik-yolunun basi". §0b satir 31, §9 F2. T0-sifir varsayimi kaldirildi → A P50 ~20 Kas'tan ~28 Kas'a kaydi (dogru yonde). |
| **F3** | Takvim tarihleri reviewer-saat-sinirli modelden, 5wd=1hafta DEGIL | **COZULDU** | §7 satir 147: etkin **4.2/3.7/3.2 wd/takvim-haftasi**, naif 5 degil; tek reviewer + ~8h gece onay + stall yansitildi. P80/P95'te dusuk etkin-wd takvimi dogru sekilde uzatiyor. |
| **F4** | Izolasyon opsiyonlari per-opsiyon kosullu eng | **COZULDU** | §5 tablo satir 120-126: her opsiyon "karar-sonrasi KOSULLU eng (sec+kur+self-test)" tasiyor; yalniz wiring degil. |
| **F5** | Mobil satir gercek percentile ayrimi | **COZULDU** | §0b satir 33: eng **~4/6/8 hf** (ayri P50/P80/P95); iki ortak kapi bir kez ortak-ek olarak yazildi. §9 F5. |
| **F6** | ALL-FINAL P95 kontrat-kosullu aralik, ciplak UNKNOWN degil | **COZULDU** | §0a/§0b/§8 satir 161 + §9 F6: **~Haz–Tem 2027 (SC-05/06/14 backend kontrati + ~12-18 wd)** span; ticari/nihai P95'ler de span'e cevrildi. |
| **F7** | Motor/kaynak-duzeyinde kanitli vs urun READY-degil ayrimi net | **COZULDU** | §9 F7 + §2 rol-12 + §3 adim-9: implementer+reviewer cifti motor/KAYNAK duzeyinde DONE, fakat merge/push YOK, urun READY DEGIL (origin/master hala 061f78d). Ayrim tutarli. |

### (a)–(j) skorkarti

| Kriter | Sonuc | Kanit |
|---|---|---|
| **(a)** TAM is akisi (BA/SW/PO/PM/Arch/UX/Dev/QA/Sec/Reviewer/DevOps) planli, sadece source-gen degil | **GECTI** | §2 13-rol tablosu tum fonksiyonlari kapsiyor; §3 13-adim zinciri BA(2)/SW(3)/PO-PM(4)/Arch(5)/UX(6)/Dev(7)/QA+Sec(8)/Review(9)/build(11)/deploy(12)/izleme(13). |
| **(b)** 599 isci olarak gosterilmemis; yalnizca ~10-14 gerekli rol | **GECTI** | §0 durustluk kurali + §2: 599=HEDEF katalog, 0/599 degerlendirildi; ~13 fonksiyonel rol, gorevler/sinirlar gercek `responsibilities`/`forbiddenActions`'tan. |
| **(c)** Tek somut referans web platform (FE+BE+API+DB) + 13-adim, her adim kanit-destekli (dok/katalog != IMPLEMENTED) | **GECTI (durust)** | §3 "TaskHub" React/Next + Node + PostgreSQL; her adimda "Gercek kanit (kod)" + "Kabul kosulu" + durum; NOT_IMPLEMENTED adimlar (2,3,4,6,10,12) durustce isaretli; "dokuman/katalog kaydi IMPLEMENTED SAYILMAZ" aciktan. (Uyari: kod capalari AK-1'e tabi.) |
| **(d)** IKI ayri tarih A vs B; A, B gibi sunulmamis | **GECTI** | §0a satir 13-15 acik A/B tanimi; tum tablolarda ayristirilmis; 2-3-4 numarali yanitlar B'nin alt uclari olarak etiketli. |
| **(e)** Guvenlik korunmus; acik engel + opsiyonlar + per-opsiyon kosullu eng; belirli infra dayatilmamis; untrusted kod izolasyonsuz calistirilmaz | **GECTI** | §5 + satir 51/128: "Hicbir untrusted kod izolasyon olmadan calistirilmaz"; "Hicbir belirli infra gerekli/onayli DEGIL". |
| **(f)** Web-app sunucu deploy'u Windows Authenticode'dan ayrilmis; yanlis bagimliliklar kaldirilmis; zorunlular kanitli | **GECTI** | §6: (a) web-deploy = sunucunun kendi auth/TLS/SSH/CI — Authenticode GEREKMEZ; (b) Authenticode yalniz installer dagitimi. Zincir §3 adim-12 credential-kapisina bagli, P-SIGNING-CERT'e degil. |
| **(g)** Tam Desktop (18 SC + 71 UX + 2D/3D) ayri tutulmus, sessizce dusurulmemis | **GECTI** | §8: 18 SC tablosu + 71 UX-DEC kirilimi (13/18/13/27) + 2D/3D (SC-12); hicbiri dusurulmedi. |
| **(h)** P50/P80/P95 olculmus throughput + tek reviewer + rework + entegrasyon temelli | **GECTI** | §1 satir 49 olculmus throughput (impl p50 14.2/p80 30.7 dk, inceleme p50 5.8, ~1.8 dongu); §7 wd tanimi inceleme dongulerini/serilestirmeyi/freeze'i icerir. |
| **(i)** 5 ust soru dogrudan tarihlerle yanitlanmis | **GECTI** | §0a tablo satir 1-5: her soru P50/P80/P95 tarih + adli kapi. |
| **(j)** Yapilmis-is yeniden-is sayilmamis; yeni Master/kapsam olusturulmamis | **GECTI** | satir 5/213: "Yeni Master otorite olusturulmadi", "CLEAN is yeniden-is sayilmadi"; mevcut kayitlara bagli. |

### Kalan somut duzeltmeler + siddet

- **AK-1 (DUSUK — sadakat/tekrar-uretilebilirlik):** §1/§2/§3'teki kod-kanit capalari (execution-gate.ts, runner.ts, role-definitions.json=599, server.ts:418/:431/186-408/112-139) teslim worktree'inde (v6/pkg-t4) dogrulanabilir DEGIL — buradaki server.ts 91 satir ve bu uclari icermiyor; capalar v2-m1a/`m1a-build` @ 2176741'e dayaniyor. Rapor bu worktree'i/commit'i bir kez aniyor fakat satir-numarali her capaya worktree yolunu bitisik yazmazsa kanit teslim kopyasindan yeniden uretilemez. Bagimsizca teyit edilebilen tek capa origin/master=061f78d. Oneri: satir-numarali capalara `m1a-build@2176741` on-eki eklensin. Correctness hatasi DEGIL.
- **AK-2 (DUSUK — ic tutarlilik):** Paylasim-indirimi iki farkli oranda uygulanmis (T4 icin ~%15: 40→34; A icin ~%13: 29→25) tek bir formul belirtilmeden. Her iki oran da ayri "ortak bilesen" gerekcesine dayaniyor ve makul; sadece tek bir indirim-formulu/gerekce satiri netlik artirir. Dusuk oncelik.
- **AK-3 (BILGI):** §7 etkin 4.2/3.7/3.2 wd/hafta: yuksek guvende (P80/P95) daha az etkin-wd/hafta → takvimi dogru sekilde uzatiyor; yon dogru, duzeltme gerekmez.

### Karar

**F1–F7: 7/7 COZULDU. (a)–(j): 10/10 GECTI.** Founder 2026-10-16 duzeltmeleri ve F1-F7 raporda gerceklen uygulanmis; aritmetik ic-tutarli (T4 naif 40 ve A naif 29 teyit). Bloke edici kalinti YOK; yalnizca iki DUSUK + bir BILGI notu. Bu rapor realism+fidelity acisindan KABUL edilebilir. Ana basari metrigi (uctan-uca senaryonun GERCEKTEN calismasi) ve A-vs-B / motor-kanitli-vs-READY ayrimlari durustce korunmus. Hicbir ana bolum degistirilmedi; hicbir kod/durum/push/harcama yapilmadi.
