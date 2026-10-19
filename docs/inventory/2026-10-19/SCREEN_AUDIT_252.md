<!-- //TR: 252 ekran denetimi (normalize): durum dagilimi, calisma alanina gore kirilim, PR bekleyen ve tam bagli ekranlar, normalizasyon kaydi / 252-screen audit: status distribution, by workspace, normalization log -->

# 252-screen audit (normalized), 2026-10-19

Source rows: `raw/screens-part-1.csv` (UI-001..084), `raw/screens-part-2.csv` (UI-085..168), `raw/screens-part-3.csv` (UI-169..252), measured against `v7/integration @ e12dbdd`. IDs come from the STALE_BASELINE v6 `SCREEN_TRACEABILITY_252_PLUS.csv`; the design package itself is UNKNOWN_SOURCE, so **design parity is not measured for any screen**. `SCREEN_AUDIT_252.csv` has exactly 252 rows and the 25 record fields.

## Headline

- Working today (INTEGRATED_NOT_VERIFIED + PRODUCT_VERIFIED): **85**; product-verified: **0**.
- Fully wired on v7 (UI and API both YES): **23**. Integrated but PARTIAL: 62.
- On open PRs awaiting CI: 9. AUTHORITY_REQUIRED: 145. Renderer-only DESIGN_ONLY: 7. DUPLICATE: 6.
- No code at all (UI and API both NO): 131.
- Oct 31 impact: AT_RISK 105, NOT_DELIVERABLE 128, NONE 19. DELIVERABLE is 0 because nothing has green CI or product evidence.

## Status distribution: raw auditors vs normalized

| Status | Raw (3 auditors) | Normalized |
|---|---|---|
| DESIGN_ONLY | 68 | 7 |
| PENDING_REVIEW | 2 | 0 |
| PENDING_CI | 9 | 9 |
| INTEGRATED_NOT_VERIFIED | 85 | 85 |
| BLOCKED | 3 | 0 |
| AUTHORITY_REQUIRED | 79 | 145 |
| DUPLICATE | 6 | 6 |

Normalization rules R1-R5 are defined in `README.md`. The biggest change is R2 (61 rows): parts 2 and 3 recorded screens without code that need a new protected endpoint or a Founder decision as DESIGN_ONLY, while part 1 recorded them as AUTHORITY_REQUIRED. One convention is now applied to all 252.

## By source part (normalized)

| Part | Rows | INV | PENDING_CI | AUTH | DESIGN | DUP |
|---|---|---|---|---|---|---|
| screens-part-1.csv | 84 | 33 | 6 | 41 | 3 | 1 |
| screens-part-2.csv | 84 | 26 | 1 | 54 | 2 | 1 |
| screens-part-3.csv | 84 | 26 | 2 | 50 | 2 | 4 |

## By workspace (normalized screen status; membership is an auditor derivation, confidence MEDIUM)

| SC | Workspace | Screens | INV | PENDING_CI | AUTH | DESIGN | DUP |
|---|---|---|---|---|---|---|---|
| SC-01 | SC-01 Global Desktop Shell | 22 | 16 | 0 | 2 | 3 | 1 |
| SC-02 | SC-02 Founder Cockpit / Home | 4 | 3 | 0 | 0 | 1 | 0 |
| SC-03 | SC-03 Projects / Portfolio | 8 | 6 | 0 | 1 | 1 | 0 |
| SC-04 | SC-04 Project Journey / Studio | 2 | 2 | 0 | 0 | 0 | 0 |
| SC-05 | SC-05 Founder Command / BA / Revision | 6 | 0 | 0 | 6 | 0 | 0 |
| SC-06 | SC-06 Planning / Architecture Studio | 8 | 1 | 0 | 7 | 0 | 0 |
| SC-07 | SC-07 Missions / Work OS | 9 | 4 | 0 | 4 | 1 | 0 |
| SC-08 | SC-08 Agents / Workforce (+ Skill Academy) | 20 | 10 | 2 | 8 | 0 | 0 |
| SC-09 | SC-09 Assurance / QA + Security | 30 | 5 | 1 | 23 | 0 | 1 |
| SC-10 | SC-10 Independent Review / Evidence | 8 | 2 | 4 | 2 | 0 | 0 |
| SC-11 | SC-11 Delivery / Release + SRE | 14 | 6 | 0 | 8 | 0 | 0 |
| SC-12 | SC-12 Control Tower 2D / 3D | 8 | 6 | 1 | 1 | 0 | 0 |
| SC-13 | SC-13 Inbox / Alerts + Approvals | 7 | 5 | 0 | 2 | 0 | 0 |
| SC-14 | SC-14 Knowledge / Project Memory | 12 | 0 | 0 | 12 | 0 | 0 |
| SC-15 | SC-15 Company OS / CRM / Finance / Legal | 34 | 6 | 0 | 25 | 0 | 3 |
| SC-16 | SC-16 Operations & Recovery | 12 | 6 | 0 | 6 | 0 | 0 |
| SC-17 | SC-17 Settings / Provider / Installation | 29 | 7 | 1 | 19 | 1 | 1 |
| SC-18 | SC-18 RE / Authorized Analysis Lab (optional) | 1 | 0 | 0 | 1 | 0 | 0 |
| MOBILE (no SC) | Mobile companion (no Desktop SC) | 18 | 0 | 0 | 18 | 0 | 0 |

## Screens on open PRs awaiting CI (9)

| Screen | Title | SC | PRs | Head |
|---|---|---|---|---|
| UI-029 | 51 Guild & Departman | SC-08 | #22 | #22@0392cf7 |
| UI-049 | Claude Bağımsız Review | SC-10 | #24 | #24@2238a68 |
| UI-050 | Kanıt & Denetim Grafiği | SC-10 | #25 | #25@adc6da7 |
| UI-051 | Test Çalıştırma Raporu | SC-09 | #26 | #26@0a60c14 |
| UI-070 | Audit Trail | SC-10 | #27 | #27@326f04b |
| UI-078 | Eklenti & Entegrasyon | SC-17 | #28 | #28@2f77502 |
| UI-163 | Denetim Olayı Ayrıntı Kaydı | SC-10 | #27, #28 | #27@326f04b |
| UI-197 | Uzman Rol Genomu ve Taksonomi | SC-08 | #22, #48 | #22@0392cf7 |
| UI-226 | Observability Trace Waterfall | SC-12 | #23 | #23@a94c838 |

## Fully wired integrated screens (23)

| Screen | Title | SC | Route/ref |
|---|---|---|---|
| UI-001 | Kurucu Kontrol Paneli | SC-02 | UI-001 (#/home) |
| UI-006 | Karar & Onay Kutusu | SC-13 | UI-006 (#/inbox) |
| UI-007 | Acil Durdur & Durum | SC-01 | UI-007 (#/tower) |
| UI-010 | Yeni Proje Stüdyosu | SC-03 | UI-010 (#/projects) |
| UI-011 | Proje Yolculuğu | SC-04 | UI-011 (#/journey) |
| UI-022 | Proje Kaynak & Git | SC-04 | UI-022 (#/projects) |
| UI-028 | 599 Uzman Rol Kataloğu | SC-08 | UI-028 (#/workforce) |
| UI-032 | Ajan Ayrıntısı | SC-08 | UI-032 (#/workforce) |
| UI-035 | Öğrenme & Deneyim Merkezi | SC-08 | UI-035 (#/academy) |
| UI-037 | Güvence Komuta Merkezi | SC-09 | UI-037 (#/assurance, #/posture) |
| UI-046 | Security Posture | SC-09 | UI-046 (#/posture) |
| UI-052 | Release Quality Gates | SC-11 | UI-052 (#/readiness) |
| UI-053 | 2D Kontrol Kulesi | SC-12 | UI-053 (#/tower) |
| UI-055 | Release & Paketler | SC-11 | UI-055 (#/delivery, #/projects) |
| UI-071 | Operasyon & Kurtarma | SC-16 | UI-071 (#/operations, #/tower) |
| UI-081 | Company OS Genel Bakış | SC-15 | UI-081 (#/company) |
| UI-201 | Öğrenme Kanıt Kütüphanesi | SC-08 | #/academy |
| UI-205 | Çoklu Proje Komuta Matrisi | SC-02 | #/matrix |
| UI-208 | Otonom Round ve Checkpoint Günlüğü | SC-12 | #/tower |
| UI-211 | İnsan Onayı Bekleyen İş Kuyruğu | SC-13 | #/queue |
| UI-227 | Kalite Kapısı ve Release Readiness | SC-09 | #/readiness |
| UI-236 | Kurucu Yönetim Özeti ve İcra Defteri | SC-02 | #/executive |
| UI-248 | Desktop First-Run Kurulum Doğrulama | SC-17 | #/install |

Integrated but PARTIAL (62): UI-002, UI-005, UI-008, UI-009, UI-016, UI-017, UI-025, UI-026, UI-027, UI-030, UI-033, UI-058, UI-060, UI-061, UI-062, UI-076, UI-083, UI-085, UI-087, UI-089, UI-105, UI-106, UI-107, UI-108, UI-109, UI-110, UI-111, UI-113, UI-114, UI-115, UI-116, UI-124, UI-125, UI-132, UI-133, UI-134, UI-135, UI-137, UI-140, UI-146, UI-148, UI-156, UI-161, UI-181, UI-182, UI-186, UI-187, UI-188, UI-191, UI-194, UI-203, UI-206, UI-209, UI-210, UI-220, UI-221, UI-222, UI-231, UI-233, UI-241, UI-246, UI-251.

## Renderer-only DESIGN_ONLY screens (7)

| Screen | Title | Authority needed |
|---|---|---|
| UI-003 | Dönüş Özeti | none if renderer-only (client last-seen) |
| UI-023 | Görev Kanban Panosu | none if renderer-only |
| UI-077 | Bildirim & Ses Ayarları | none if local prefs |
| UI-112 | Toparlanıyor | none |
| UI-126 | Project Intake Kaynak Tutarlılığı | none known |
| UI-247 | Windows Çoklu Monitör ve DPI Önizleme | None |
| UI-252 | UI Bileşen Envanteri ve Acceptance Lab | None |

## Duplicates (6)

| Screen | Title | Evidence |
|---|---|---|
| UI-047 | Security Bulgu Detayı | stale:NOT_APPLICABLE (fold into parent; stale issue: detail panel of UI-046; evidence detail exists in assuran |
| UI-152 | Installer First Run Sihirbazı | stale:DUPLICATE (v6 9dbb708 SCREEN_TRACEABILITY_252_PLUS.csv; repo_implementation=none) \| route: none register |
| UI-171 | Şirket Hedef OKR Bağıntı Haritası | stale:MISSING (v6 9dbb708 SCREEN_TRACEABILITY_252_PLUS.csv; repo_implementation=none; stale route=(none); view |
| UI-185 | Bütçe Kotası Blokajı | stale:DUPLICATE (v6 9dbb708 SCREEN_TRACEABILITY_252_PLUS.csv; repo_implementation=none; stale route=(none); vi |
| UI-235 | Strateji ve OKR Hedef İlişkisi | stale:MISSING (v6 9dbb708 SCREEN_TRACEABILITY_252_PLUS.csv; repo_implementation=ABSENT; stale route=(none); vi |
| UI-245 | Klavye Komut Paleti ve Global Search | stale:DUPLICATE (v6 9dbb708 SCREEN_TRACEABILITY_252_PLUS.csv; repo_implementation=PARTIAL; stale route=shell ( |

## Authority classes among the 145 AUTHORITY_REQUIRED screens (keyword classification, overlapping)

- Protected endpoint / allow-list / backend needed: 114
- Live execution (FD-REL-1 sandbox): 18
- Paid resources / cost authority: 10
- Mobile companion: 18
- A Founder or risk decision is named: 68

## Normalization log (status, oct31 and PR-reference changes; all field changes are in the JSON)

| Screen | Rule | Field | From | To |
|---|---|---|---|---|
| UI-046 | R5 | prs | none | #4 (merged 232d2b4; #/posture) |
| UI-052 | R5 | prs | none | #3 (merged 25ddda5 rebase; #/readiness) |
| UI-060 | R5 | prs | none | #9 (merged 55bcede; #/install) |
| UI-071 | R5 | prs | none | #6 + #7 (merged a5e2a68, cd4b104; #/operations; one work it… |
| UI-074 | R4 | status | PENDING_REVIEW | AUTHORITY_REQUIRED |
| UI-086 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-088 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-090 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-091 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-092 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-093 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-094 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-095 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-096 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-097 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-098 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-099 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-100 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-102 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-103 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-104 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-117 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-121 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-123 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-127 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-128 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-129 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-130 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-131 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-136 | R4 | status | PENDING_REVIEW | AUTHORITY_REQUIRED |
| UI-139 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-141 | R3 | status | BLOCKED | AUTHORITY_REQUIRED |
| UI-142 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-144 | R3 | status | BLOCKED | AUTHORITY_REQUIRED |
| UI-145 | R3 | status | BLOCKED | AUTHORITY_REQUIRED |
| UI-151 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-153 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-154 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-157 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-158 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-159 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-160 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-162 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-166 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-167 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-168 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-174 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-175 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-176 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-177 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-178 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-179 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-180 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-184 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-187 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-188 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-190 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-192 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-196 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-197 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-200 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-201 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-205 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-208 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-211 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-214 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-215 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-216 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-217 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-226 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-227 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-228 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-229 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-230 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-236 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-237 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-238 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-239 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-242 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-243 | R2 | status | DESIGN_ONLY | AUTHORITY_REQUIRED |
| UI-246 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
| UI-248 | R1 | oct31_impact | DELIVERABLE | AT_RISK |
