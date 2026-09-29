# UASCO — AUDIT 252 GAP REPORT (FD-NIHAI-252 §9)

- **Generated:** 2026-10-16
- **Basis:** read-only repository audit clone `ec105b7`; 6 slice CSVs x 42 = **252** design rows (UI-001..UI-252), concatenated to `SCREEN_TRACEABILITY_252_PLUS.csv`.
- **Nature:** mapping/traceability only. No screenshots, no pixel-parity run, no live tests executed. All `*_test`, `design_parity`, `reviewer`, `evidence_path` fields are `NOT_EXECUTED` / `NOT_VERIFIED`. Nothing is `VERIFIED`.
- **Slice integrity:** all 6 slices present (slice-0..slice-5), 42 rows each, 252 distinct contiguous ids, no missing slice.

## Status totals (252)

| Status | Count | Share |
|---|---:|---:|
| MISSING | 124 | 49.2% |
| PARTIAL | 79 | 31.3% |
| UNAPPROVED | 20 | 7.9% |
| BLOCKED | 14 | 5.6% |
| NOT_APPLICABLE | 7 | 2.8% |
| EXISTS (binding only) | 5 | 2.0% |
| DUPLICATE | 3 | 1.2% |
| CONFLICT | 0 | 0.0% |

Priority mix: **P0 = 43, P1 = 122, P2 = 87**.

## MISSING — 124 screens

Designed screens with **no renderer implementation** (most need a new view and/or a desktop GET/POST allow-list entry on an existing or new `/v1` endpoint). Full list in the traceability CSV (`status=MISSING`). Distribution by work package:

| Package | MISSING |
|---|---:|
| WP-COMPANY (Company OS / CRM / finance) | 29 |
| WP-WORKOS (missions / analysis studios) | 22 |
| WP-MOBILE-COMPANION | 11 |
| WP-AGENTS (workforce / roles) | 10 |
| WP-DELIVERY (release / SRE / installer) | 10 |
| WP-KNOWLEDGE-EVIDENCE (provenance / memory) | 10 (10/10 — entirely unbuilt) |
| WP-QA-SEC | 7 |
| WP-SETTINGS | 7 |
| WP-MISC (cross-cutting governance) | 7 |
| WP-SHELL / FIRSTRUN / COCKPIT / PROJECTS / TOWER / INBOX / STATE | 11 combined |

Two packages are **fully unbuilt**: WP-KNOWLEDGE-EVIDENCE (10/10) and effectively WP-COMPANY (29 MISSING + 3 UNAPPROVED + 1 DUPLICATE of 33 — `#/company` route is a `planned.js` placeholder; CRM/finance backend exists in `core/company/*` but has no desktop GET allow-list entry or renderer view).

## DUPLICATE — 3

| Id | Title | Duplicate of | Resolution |
|---|---|---|---|
| UI-152 | Installer First Run Sihirbazı | UI-002 (first open & setup) | In-app first-run is renderer (UI-002); installer-level wizard belongs to the installer task, not a separate renderer screen. |
| UI-185 | Bütçe Kotası Blokajı | UI-196 (budget overrun safe run) | Same function; merge into one budget-gate state. |
| UI-245 | Klavye Komut Paleti ve Global Search | UI-008 (Global Komut Paleti) | Same capability; Ctrl+K focuses `searchInput` (shell.js:158). Build one full command palette, not two. |

## CONFLICT — 0

No row was classified CONFLICT in any slice. (No two screens assert contradictory requirements/behaviour in the audited data.)

## NOT_APPLICABLE — 7 (with parent screen)

These are not standalone screens; they are inspector/drawer panels or state variants of a parent. Implement as states/sub-panels of the parent, not as new routes.

| Id | Title | Parent | Kind |
|---|---|---|---|
| UI-032 | Ajan Ayrıntısı | UI-030 / UI-028 (workforce list) | inspector drawer (no per-agent route) |
| UI-047 | Security Bulgu Detayı | UI-046 | detail panel (assurance.js) |
| UI-077 | Bildirim & Ses Ayarları | UI-076 (Settings) | settings subtab |
| UI-182 | Kaynak Commit SHA Değişti | delivery-panel (studio) | accept/export state variant |
| UI-183 | Onay Süresi Doldu / Yetki İptal | UI-175 (inbox approval) | approval state variant |
| UI-186 | Kurtarma Başarısız / Güvenli Dur | UI-209 (supervisor recovery, tower) | recovery state variant |
| UI-188 | Onaysız Production Deploy Engeli | delivery (B6 placeholder) | deploy-block state variant |

## BLOCKED — 14 (with gating Founder decision)

| Gate (Founder decision required) | Screens | n |
|---|---|---:|
| **FD-REL-1** — live preview / live test & device execution | UI-040, UI-041, UI-042, UI-043, UI-141, UI-144, UI-145, UI-223 | 8 |
| **Real deployment authority** — no deploy backend; prod deploy is Founder-gated | UI-057, UI-149, UI-150 | 3 |
| **3D GPU capability** — 3D not implemented ("3B yok"); GPU-gated enrichment of 2D | UI-054, UI-187 | 2 |
| **External paid device-farm capability** | UI-225 | 1 |

All BLOCKED screens stay BLOCKED until the named decision is granted; work routes to other safe packages meanwhile.

## UNAPPROVED — 20 (behaviour not yet a Founder-approved decision)

These propose behaviours outside current approved scope and must not be built until a Founder decision exists (identity/multi-tenant, secrets, mobile remote relay, offensive security, spend authority, permanent deletion, self-modifying agents, mic/voice capture):

UI-079, UI-101, UI-118, UI-119, UI-120, UI-122, UI-173, UI-193, UI-195, UI-202, UI-204, UI-212, UI-218, UI-219, UI-224, UI-234, UI-240, UI-244, UI-249, UI-250.

Representative gates: Enterprise SSO/federation (UI-118) needs external IdP + IAM design; tenant switch/data-reset (UI-120) and tenant deletion (UI-244) are destructive; secret broker/rotation (UI-122, UI-219) conflicts with the no-secrets-in-context rule; procurement/spend (UI-234) is paid authority; red-team scope (UI-218) is new offensive-security authority; mobile companion relay (UI-249, UI-250) assumes remote execution that does not exist (do not assume local ops continue when the PC is off).

## NEW screen candidates (unique ids proposed)

**0 new ids proposed beyond UI-001..UI-252.** Honest finding: the audit did not surface a capability that lacks any design id. The 252-screen package already incorporates the added design views (64 rows flagged `is_new=True` in `252_EKRAN_ENVANTERI.csv`; 188 pre-existing). All 10 implemented app routes (`routemap.json`) are represented in the design set. The 124 MISSING items are **unbuilt implementations of already-designed screens**, not missing designs. Reverse-gap note: several backend capabilities (`core/company/*`, supervisor-side traceability in `automation/lib/milestone-contract.mjs` + `review-pipeline.mjs`) have no renderer surface, but these are covered by existing MISSING design ids (e.g. UI-085 CRM, UI-127 trace matrix), so no new id is required — only new views/endpoints + allow-list entries.

## Screens addressing no known requirement — 10

Screens whose `source`/`issue` cite no `UX-DEC-*`, development `D##`, or reliability `REL###` item (they reference only `ENT-*` enterprise groups or Trust Kernel, which are outside the enumerated requirement families):

UI-118, UI-121, UI-123, UI-132, UI-136, UI-161, UI-162, UI-164, UI-181, UI-185.

These should either be tied to an explicit requirement id or confirmed as design proposals before implementation.

---
*Counts cross-checked against the per-slice distribution summary supplied with the task; EXISTS/PARTIAL/MISSING/BLOCKED/NOT_APPLICABLE/UNAPPROVED/DUPLICATE/CONFLICT all reconcile exactly.*
