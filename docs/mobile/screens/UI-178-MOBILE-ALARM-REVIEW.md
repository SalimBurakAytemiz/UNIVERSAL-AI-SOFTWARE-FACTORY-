<!-- //TR: MOB-6 ekran şartnamesi UI-178 Mobil Ajan Alarm ve Olay İnceleme (yalnız tasarım, ETKİN DEĞİL): GLOBAL_STOP, journal bozulması, başarısız run ve kurucu dikkat gerektiren durumlar sabit tür kodlarıyla yalnız okunur listelenir; veri ÖNERİLEN /v1/mobile/notifications ve /v1/mobile/ops rotalarından gelir. Alarmı onaylama, yeniden deneme, STOP, RESUME veya onarım eylemi yoktur. -->

# UI-178: Mobile Agent Alarm and Event Review (Mobil Ajan Alarm ve Olay İnceleme)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB section 11 row UI-178 (F3/F9, build MOB-22).
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`).
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:179` (AUTHORITY_REQUIRED; `action_contract=review alarm/event; state_variants=alarm/empty`; desktop analog inbox founder-attention + tower run events).

## 1. Purpose

List the conditions that need the Founder's attention (STOP active, journal degraded, failed or blocked work) so they can be reviewed on the phone and acted on at the desktop. "Review" means read, not acknowledge.

## 2. Target function and release

- **Function:** F3 Agents/workers + F9 Ops/recovery read part (D-MOB section 5); in-app feed part of F6.
- **Release:** R1, read-only monitoring, in-app pull only. No FCM, no push (FD; SC-8 dormant).
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. **Build package:** MOB-22. Push (FA-MOB-15, MOB-27) is not part of this screen.

## 3. Data source

| Source | Status | Upstream evidence |
|---|---|---|
| `GET /v1/mobile/notifications?cursor&limit` | **PROPOSED** (MOB-3 4.9); no existing route | derived from summary/runs/ops inputs; `control-api-events.jsonl` (`server.ts:78`) is **not** served |
| `GET /v1/mobile/ops` | **PROPOSED** (MOB-3 4.7) | `/v1/control/status` `server.ts:120`; `/v1/runs` `server.ts:124-128`; `/v1/founder-attention` `server.ts:122` |
| `GET /v1/mobile/changes?since` | **PROPOSED** (MOB-3 4.8), optional | `lastSeq` `store.ts:131` (not exposed today) |

## 4. Fields

| Field | Upstream | Rule |
|---|---|---|
| item `notificationId`, `at` | MOB-3 4.9 | id durability open (Q-8) |
| item `kind` | fixed enum (MOB-3 4.9): `GLOBAL_STOP_ACTIVE`, `JOURNAL_DEGRADED`, `RUN_FAILED`, `AWAITING_FOUNDER` | fixed localised text per kind; no free text |
| item `severity` | MOB-3 4.9 | colour + text, never colour alone |
| item `ref.route`, `ref.id` | MOB-3 4.9 | tap resolves through the read routes |
| `globalStop.active`, `reason` | `/v1/control/status` `server.ts:120` | status only |
| `journal.state`, `reason` | `workosHealth` `server.ts:119` | `TAMPERED` shown as `TAMPERED`, not hidden (MOB-3 4.7) |
| `blocked.count`, `blocked.kinds` | `/v1/founder-attention` `server.ts:122` | kind codes only; `retryable` flags omitted (MOB-3 4.7) |
| `supervisorRuns.count`, `latest[]` | `/v1/runs` `server.ts:124-128` | id and status only |

## 5. Actions (all read-only)

| Action | Effect |
|---|---|
| Refresh (pull / focus) | re-fetch `notifications` and `ops` |
| Filter by kind / severity | client-side |
| Load more | next `cursor` |
| Tap item | navigate via `ref` to UI-099 / UI-102 / UI-097 |

No acknowledge, dismiss, mute, retry-blocked (`server.ts:147-152`), STOP (`server.ts:142-145`), RESUME (`server.ts:146`, desktop-only), or journal repair (`server.ts:661`). A server-side "acknowledged" mark would be a write; a phone-side "seen" mark would be a second store beside the STALE cache (SC-7). Both are out of R1.

## 6. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | first fetch | skeleton list |
| Empty | no alarm | "No alarms" plus STOP and journal pills (empty is not "all good" if those are `UNAVAILABLE`) |
| Error | 500, unknown `kind` | fixed code; unknown kind shown as `UNKNOWN`, never dropped |
| OFFLINE | network failure | OFFLINE banner, STALE cache (UI-177) |
| STALE | cached list | STALE badge and age; "alarms may have changed" |
| UNAVAILABLE | a source missing | `—` with UNAVAILABLE pill |
| Denied | 401/403 (MOB-3 3.5) | no data, UI-249 |
| Expired | 401 `MOBILE_SESSION_EXPIRED` | silent refresh, else UI-249 |
| Rate limited | 429 `MOBILE_RATE_LIMITED` | back off for `Retry-After` |

## 7. Desktop reuse (honest-state rules)

- Counterparts: `apps/desktop/renderer/views/inbox.js`, `apps/desktop/renderer/views/tower.js`, `apps/desktop/renderer/operations-core.js` (read-only reference). Renderer reads: `api.js:50` (control status), `api.js:51` (founder attention), `api.js:53` (runs).
- Pill kinds `BLOCKED`, `DENIED`, `UNAVAILABLE`, `STALE`, `OFFLINE` exist at `apps/desktop/renderer/model.js:112`.

## 8. Not on this screen

Push notifications (UI-100 push part, MOB-7), STOP flow (UI-176, MOB-7), raw run events and logs (SC-3).

## 9. UNVERIFIED and open questions

- MOB-3 Q-8: notifications recomputed per request or durable journal ids.
- Whether "seen" state is wanted at all (would need a Founder decision against SC-7).
