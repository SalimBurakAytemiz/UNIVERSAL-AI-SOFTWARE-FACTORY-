<!-- //TR: MOB-6 ekran şartnamesi UI-177 Mobil Ağ Kesintisi / Çevrimdışı (yalnız tasarım, ETKİN DEĞİL): masaüstüne ulaşılamadığında yalnız ADR-MOB-001'deki şifreli salt okunur STALE önbellek, son eşitleme zamanıyla gösterilir. Çevrimdışı yazma kuyruğu YOKTUR; önbellek dışında ikinci bir depo yoktur ve hiçbir istek sonradan gönderilmek üzere saklanmaz. Envanterdeki "offline queue" notu SC-7 ile çelişir ve uygulanmaz. -->

# UI-177: Mobile Network Loss / Offline (Mobil Ağ Kesintisi / Çevrimdışı)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener, cache or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB section 11 row UI-177 (F9).
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`).
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:178` (AUTHORITY_REQUIRED; design note `action_contract=offline queue; state_variants=offline/reconnect`).

## 1. Purpose

Tell the Founder honestly that the desktop cannot be reached, why (as far as the phone can tell), and what the last known state was, without pretending the data is current and without accepting any action for later.

## 2. Target function and release

- **Function:** F9 Ops/recovery, read part (D-MOB section 5); a cross-cutting state used by every R1 screen.
- **Release:** R1, read-only monitoring.
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. **Build package:** MOB-21.

## 3. Offline model: no write queue, no second store

- **No offline write queue.** Nothing is queued, persisted or replayed for later sending: no approvals, no STOP, no drafts, no requests of any kind (SC-7; MOB-2 5.7; ADR section 5). R1 has no write route to queue in the first place (SC-25, MOB-3 section 5).
- **The inventory note is not adopted.** The `offline queue` design note at `SCREEN_AUDIT_252.csv:178` conflicts with SC-7 (D-MOB section 11; THREAT-MODEL RR-13). This spec replaces it with "cached STALE reads only". Founder confirmation is still open (D-MOB Q22).
- **Only one local store:** the encrypted, read-only STALE cache of ADR-MOB-001 section 5 (Keystore-held key, excluded from backup, wiped on unpair or revocation). No second database, outbox, journal or file is introduced.
- Cache contents are GET response envelopes (MOB-3 3.2) keyed by route and filter, with their fetch time. Nothing else is written.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| STALE cache of previously fetched `/v1/mobile/*` envelopes | **PROPOSED** (ADR section 5) | — |
| reachability probe = the next normal read (`GET /v1/mobile/summary` or `changes`) | **PROPOSED** (MOB-3 4.1, 4.8) | no `/health` on the gateway (MOB-3 3.1, SC-2) |

The phone never contacts any other host or a fallback route (MOB-2 section 9 rule).

## 5. Fields

| Field | Source | Rule |
|---|---|---|
| reason | phone-side classification (MOB-2 section 9): `UNREACHABLE`, `PIN_MISMATCH`, `DESKTOP_DEGRADED`, `DEVICE_REVOKED`, `REAUTH_REQUIRED` | fixed code + fixed text |
| `lastSyncAt` per screen | cache entry fetch time | relative age ("12 min ago") and absolute time |
| cached values | cached envelope `data` | each with STALE badge; no recomputation, no extrapolation |
| `journal.state` at last sync | cached envelope (MOB-3 3.2) | labelled "at last sync" |
| desktop availability note | MOB-2 section 8 | "The desktop app must be open on the PC (backend exits when it closes)" |

## 6. Actions (all read-only)

| Action | Effect |
|---|---|
| Retry now | one read request to the paired address only; no queue |
| Browse cached screens | navigation inside the cache; every screen shows STALE |
| Open UI-249 | when the reason is credential-related |

Write-shaped controls do not exist in R1 (SC-25). SC-7 acceptance test 1 still applies: with the network down nothing is persisted for replay.

## 7. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | retry in progress | spinner on the banner; cached data stays visible |
| Empty | offline with no cache (first launch, after wipe) | "No data yet. Connect on the same network as the desktop." |
| Error | cache unreadable or key invalidated (MOB-2 section 9) | wipe cache, show re-pair path (UI-249) |
| OFFLINE | network failure / timeout / refused | OFFLINE banner + STALE cache |
| STALE | any cached view | STALE badge and age on every block |
| UNAVAILABLE | a cached block was already `UNAVAILABLE` | keep `—`, never fill in |
| Denied | `DEVICE_REVOKED` | cache wiped (MOB-2 5.5), UI-249 |
| Expired | `REAUTH_REQUIRED` | UI-249 |
| Pin mismatch | `PIN_MISMATCH` | hard stop, no retry to that host, re-pair only (MOB-2 section 9) |

## 8. Desktop reuse (honest-state rules)

- `classifyFailure` maps network errors to `OFFLINE` (`apps/desktop/renderer/model.js:15`); chip kinds include `OFFLINE` and `STALE` (`model.js:3`).
- Desktop counterpart for the cache pattern: `apps/desktop/renderer/state.js:5` keeps an in-memory `cache` and `lastRefreshAt`. The phone rule is stricter and exact: one read-only STALE cache as in `docs/mobile/ADR-MOB-001-REACT-NATIVE-ANDROID.md` section 5 (encrypted with a Keystore-held key, excluded from backup, wiped on unpair or revocation), no write queue, no second store (SC-7).

## 9. UNVERIFIED and open questions

- Cache library and encryption API: **UNVERIFIED**, deferred to MOB-9 / TECH-VERSIONS.
- Maximum cache age before cached views are hidden: not set; PROPOSED as an open question.
- D-MOB Q22 (no offline queue) and Q2 (headless mode) stay open.
