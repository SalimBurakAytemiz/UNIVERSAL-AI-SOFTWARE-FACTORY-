<!-- //TR: MOB-7 ekran spesifikasyonu UI-100 Mobil Bildirimler (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): ilk sürümde yalnız uygulama içi çekme (pull) akışı, FCM yok, push yok (MOB-3, MOB-8); bildirim içerik taşımaz ve hiçbir onay, STOP veya eylem başlatmaz. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-100 Mobile notifications (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. Release 1 is **pull-only, in-app**: no FCM, no push token, no background sender (`API-CONTRACT.md` section 4.9; `TEST-AND-BUILD.md` section 9).

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- An in-app feed of fixed-kind events (STOP active, journal degraded, run failed, awaiting Founder) that links to the read screen holding the detail.
- Target function F6; inventory row `SCREEN_AUDIT_252.csv:101`. Desktop analog: the bell count from cockpit approvals (`apps/desktop/renderer/shell.js:47-48`).

## 2. Release and gating

| Part | Release | Gate |
|---|---|---|
| In-app feed, foreground pull | R1 read-only candidate (MOB-22) | FA-MOB-1..6 transport/read grants; nothing granted yet |
| Push (any provider) | **Not release 1**; Founder: no FCM in the first release | FA-MOB-15 (MOB-27) |

## 3. Authority dependency

R1 feed: FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4 (`MOBILE_READ` only), FA-MOB-5, FA-MOB-6. Push later: FA-MOB-15. None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| `GET /v1/mobile/notifications?cursor&limit` | PROPOSED; derived from `summary`, `runs`, `ops` inputs | MOB-3 4.9 |
| `GET /v1/mobile/changes?since&limit` | PROPOSED; names of changed projections only, polled ≥ 15 s, foreground only | MOB-3 4.8, 3.6 |
| Underlying existing reads | `GET /v1/control/status` (`server.ts:120`), `GET /v1/founder-attention` (`:122`), `GET /v1/runs` (`:124`), `GET /v1/cockpit` (`:728-731`) | MOB-3 4.7 |
| Audit file `control-api-events.jsonl` | exists (`server.ts:78`) but is **not** served | MOB-3 4.9 |

## 5. Fields (per item)

| Field | Notes |
|---|---|
| `notificationId` | PROPOSED; durability open (MOB-3 Q-8) |
| `at` | server time |
| `kind` | fixed enum, e.g. `GLOBAL_STOP_ACTIVE`, `JOURNAL_DEGRADED`, `RUN_FAILED`, `AWAITING_FOUNDER` |
| `severity` | fixed enum |
| `ref {route, id}` | resolved by the app through read routes |

No free text in the item. Titles shown after resolving `ref` are untrusted text with provenance (SC-10).

## 6. Actions

- **Open** → navigates to the read screen named by `ref` (an `AWAITING_FOUNDER` item opens a read view; in release 1 approval screens are UNAVAILABLE).
- **Refresh** (pull).
- Mark-as-read is local UI state only, never sent (no write route in R1, SC-25).
- **No action buttons on any notification**: no approve, reject, STOP, retry or reply (SC-8, MOB-4 AT-F3).

## 7. Step-up authentication points

- App unlock (UI-174) before the feed renders. No other step-up: the screen cannot act.
- Later push (FA-MOB-15): tapping a system notification opens the app behind the lock; lock-screen visibility private (SC-8).

## 8. Security conditions

SC-1, SC-2, SC-7 (encrypted STALE cache, no queue), SC-8 (content-free; dormant in R1; absence check: no push SDK, no `google-services.json`), SC-10, SC-11, SC-18, SC-19 (bounded, side-effect-free), SC-24, SC-25.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | first fetch | skeleton |
| Empty | zero items | "No notifications" |
| Error | 500 / 503 `DESKTOP_DEGRADED` | `—` plus fixed code |
| OFFLINE | network failure | cached feed greyed, OFFLINE pill |
| STALE | desktop unreachable, cache shown | STALE badge with age of last fetch; no claim of "no new events" |
| UNAVAILABLE | gateway disabled, route absent | "Notifications unavailable"; never `0` |
| Denied | 401 `DEVICE_REVOKED` / `MOBILE_SESSION_EXPIRED`; 404 | revoked → wipe and re-pair; expired → silent refresh, then UI-174 re-auth |
| Rate limited | 429 `MOBILE_RATE_LIMITED` | back off per `Retry-After` |
| Invalid cursor | 400 `INVALID_SINCE` / `INVALID_CURSOR` | full refresh |

The app must say plainly that it **does not alert in the background** in release 1, so silence is never read as "all clear".

## 10. UNVERIFIED and open

- Durable vs recomputed ids (MOB-3 Q-8); polling numbers (MOB-3 Q-4).
- Push provider choice (D-MOB Q8 answered for R1 only: no FCM).
