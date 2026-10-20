<!-- //TR: MOB-6 ekran şartnamesi F8 Mobil Raporlar (yalnız tasarım, ETKİN DEĞİL): inceleme kararları ve kanıt bütünlüğü sayıları yalnız okunur gösterilir, CI durumu UNKNOWN'dır. F8'in envanterde mobil ekran kimliği yoktur; yeni bir envanter kimliği ÖNERİLİR (PROPOSED), burada atanmaz. Veri ÖNERİLEN /v1/mobile/reports rotasından gelir (mevcut /v1/reviews, /v1/evidence, cockpit.evidence). Yazma, onay, STOP veya RESUME yoktur. -->

# F8: Mobile Reports (no inventory screen ID)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB section 5 row F8 and section 11.
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`).

## 0. Inventory ID: none (request a new one, PROPOSED)

- F8 reports have **no mobile screen ID** in `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv`. D-MOB section 11 records this as a GAP ("F8 reports (MOB-26) ... have no mobile screen ID"), and D-MOB Q23 asks whether new IDs should be created.
- **Request (PROPOSED):** the inventory owner assigns a new mobile screen ID for "Mobile Reports (F8)". This file does not pick or reserve a number and does not edit the inventory. Until an ID exists, this spec is referred to as `F8-MOBILE-REPORTS`.

## 1. Purpose

Answer "is the work that was done actually checked?": review verdicts per run, evidence integrity counts, and an honest CI status, all read-only.

## 2. Target function and release

- **Function:** F8 CI/QA/Security (D-MOB section 5).
- **Release:** R1 candidate, read-only monitoring, **conditional**: MOB-3 Q-2 asks whether reports belong in R1 while CI is `UNKNOWN` and no screen ID exists.
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. CI status additionally needs FA-MOB-19 (not in R1). **Build package:** MOB-26.

## 3. Data source

| Source | Status | Upstream evidence |
|---|---|---|
| `GET /v1/mobile/reports?missionId&runId&cursor&limit` | **PROPOSED** (MOB-3 4.6) | — |
| upstream `GET /v1/reviews` | exists | `server.ts:637-649` (`REVIEWS_MAX=500` at `:606` per MOB-3) |
| upstream `GET /v1/evidence` | exists | `server.ts:440-453` |
| upstream `cockpit.evidence` | exists | `cockpitEvidence` `server.ts:724-727` |
| CI / GitHub Actions status | **does not exist** (D-MOB F8; no GitHub client) | `ci.state` always `UNKNOWN` |

## 4. Fields

| Field | Upstream | Rule |
|---|---|---|
| `reviews.byVerdict` | `reviewsByVerdict` `server.ts:647` | count map; `—` if unavailable |
| `reviews.runsByReviewState` | `runsByReviewState` `server.ts:647` | count map |
| `reviews.items[]: reviewId, runId, verdict, at` | `reviewRecord` `server.ts:643`, sorted `:644` | ids and verdict codes only |
| truncation notice | `truncated` `server.ts:647`; `page.truncated` (MOB-3 3.4) | "list capped" banner |
| server notice | `REVIEWS_NOTICE` `server.ts:646` | fixed string |
| `evidence.total/verified/mismatch/missing/unverifiable` | `server.ts:725` | nulls on `ERROR` (`:726`) shown as `—` |
| `ci.state` | none | `UNKNOWN`, never "passing" |
| never shown | evidence bodies, redacted log tails (`server.ts:437` comment), file paths | MOB-3 4.6, SC-3 |

## 5. Actions (all read-only)

| Action | Effect |
|---|---|
| Refresh (pull / focus) | re-fetch `reports`, respecting the 6/min bucket (MOB-3 3.6) |
| Filter by mission / run | `missionId` / `runId` query (UI-180 scope applies) |
| Load more | next `cursor` |
| Tap review | open the run in UI-099 |

No re-review, accept delivery, rerun, export or "mark verified" control.

## 6. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | first fetch | skeleton tiles |
| Empty | no reviews / no evidence | "No reviews yet"; counts `—` unless the server says `0` with `VERIFIED` |
| Error | 400 `INVALID_*`, 500 | fixed code |
| OFFLINE | network failure | OFFLINE banner, STALE cache (UI-177) |
| STALE | cached copy | STALE badge and age |
| UNAVAILABLE | evidence source missing in the installed app (D-MOB F8) | `—` with UNAVAILABLE pill |
| Unknown | CI | `UNKNOWN` pill with "CI is not visible from the desktop" |
| Denied | 401/403 (MOB-3 3.5) | UI-249 |
| Expired | 401 `MOBILE_SESSION_EXPIRED` | silent refresh, else UI-249 |
| Rate limited | 429 `MOBILE_RATE_LIMITED` | back off for `Retry-After` |

## 7. Desktop reuse (honest-state rules)

- Counterparts: `apps/desktop/renderer/views/assurance.js`, `apps/desktop/renderer/views/readiness.js`, `apps/desktop/renderer/readiness-core.js`, `apps/desktop/renderer/audit-core.js` (read-only reference). Renderer reads: `api.js:66` (evidence list), `api.js:155` (reviews).
- `model.js:4` `MISSING="—"`; pill `NOT_VERIFIED` vs `VERIFIED` kept distinct (`model.js:112`).

## 8. Not on this screen

CI logs, PR text, diffs, evidence files, audit trail events (`/v1/runs/:runId/events`, SC-3).

## 9. UNVERIFIED and open questions

- New inventory ID for F8: requested, PROPOSED (D-MOB Q23).
- MOB-3 Q-2 (reports in R1 at all) and D-MOB Q11 / FA-MOB-19 (CI source).
- Cost of evidence re-hash per request (`server.ts:437`): **UNVERIFIED**; MOB-3 proposes a 30 s memo.
