<!-- //TR: MOB-6 ekran şartnamesi UI-097 Mobil Ana Sayfa (yalnız tasarım, ETKİN DEĞİL): GLOBAL_STOP durumu, journal sağlığı, proje/görev/çalışan/kanıt sayıları ve onay bekleyen sayısı yalnız okunur gösterilir; veri ÖNERİLEN GET /v1/mobile/summary rotasından gelir, o da mevcut /v1/cockpit ve /v1/control/status kaynaklarına dayanır. Onay, STOP veya RESUME eylemi yoktur; hiçbir yetki vermez. -->

# UI-097: Mobile Home (Mobil Ana Sayfa)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6 (`docs/planning/BACKLOG_CHECKPOINT.json`, entry `MOB-6`). **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md` (docs only, `docs/mobile/**`). **Scope record:** `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md` (cited as D-MOB), section 11 row UI-097.
- **Inputs:** `docs/mobile/API-CONTRACT.md` (MOB-3), `docs/mobile/ADR-MOB-001-REACT-NATIVE-ANDROID.md` (ADR), `docs/mobile/CONNECTIVITY-AND-PAIRING.md` (MOB-2), `docs/mobile/SECURITY-CONDITIONS.md` (SC-*), `docs/mobile/APPROVAL-AND-STOP.md` (MOB-4).
- **Evidence convention:** `server.ts` = `apps/control-api/src/server.ts`; `store.ts` = `core/workos/store.ts`; `model.js`, `api.js` = `apps/desktop/renderer/*`. Line numbers re-read on `origin/v7/integration` at `7ee55d9`. Anything not re-read is **UNVERIFIED**.
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:98` (AUTHORITY_REQUIRED, no route, `action_contract=TBD; state_variants=TBD`).

## 1. Purpose

First screen after unlock. One glance answers: is the factory stopped, is the journal healthy, how much work exists, and is anything waiting for the Founder on the desktop.

## 2. Target function and release

- **Function:** F1 Dashboard (D-MOB section 5).
- **Release:** R1, read-only monitoring.
- **Gating grants (D-MOB section 9, none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. **Build packages:** MOB-16, MOB-21 (D-MOB section 11).
- The approval-waiting count is shown as a number only. Acting on it needs PT-035 fixed (`server.ts:164-167`) and FA-MOB-7, so it is not part of R1 (SC-5, MOB-4 section 2).

## 3. Data source

| Source | Status | Evidence |
|---|---|---|
| `GET /v1/mobile/summary` | **PROPOSED** (MOB-3 section 4.1), does not exist | — |
| upstream `GET /v1/cockpit` | exists (desktop loopback only) | `server.ts:728-731` |
| upstream `GET /v1/control/status` | exists (desktop loopback only) | `server.ts:120` |

The phone never calls the upstream routes; they show that every field projects an existing read.

## 4. Fields

| Field (MOB-3 name) | Display | Upstream evidence | Missing / failed |
|---|---|---|---|
| `globalStop.active`, `globalStop.reason` | STOP banner, fixed reason code | `cockpitStop` `server.ts:674` | unsafe stop file is shown as active (`server.ts:674`), never hidden |
| `globalStop.scopeNotice` | "local Work OS and dev-runs only, not Cloud production" | MOB-3 4.1 (SC-6) | always shown with the banner |
| `journal.state` | health pill: OK, ABSENT, TORN_TAIL, TAMPERED, UNAVAILABLE | `journalHealth` `store.ts:134-140`; `server.ts:119-120` | `UNAVAILABLE` pill |
| `projects.count` | count tile | `cockpitWorkos` `server.ts:675-688` | `—` with `UNAVAILABLE` when no journal (`server.ts:676-678`) |
| `missions.total`, `missions.byStatus` | tile + status chips | `server.ts:675-688` | `—` |
| `awaitingApproval.count` | "N waiting, decide on the desktop" | **DERIVED**: no upstream count field; computed as the length of `awaitingApproval.items` (`server.ts:683`), as the desktop does client-side (`apps/desktop/renderer/model.js:54-55`); items are missions in PREFLIGHT or FOUNDER_ATTENTION_REQUIRED | `—`; **no items, no titles, no buttons** in R1 (MOB-3 4.1, Q-1) |
| `workforce.activeWorkerRuns`, `workforce.canonicalRoles` | tile | `cockpitWorkforce` `server.ts:710-722` | `—` with block state |
| `orchestrator.state`, `orchestrator.asOf` | small status line | `server.ts:689-706`; STALE on expired lease `:703-704` | probably `UNAVAILABLE` in the installed app (**UNVERIFIED**, D-MOB section 5) |
| `evidence.total/verified/mismatch/missing/unverifiable` | evidence tile | `cockpitEvidence` `server.ts:724-727` | nulls on `ERROR` (`server.ts:726`) shown as `—` |
| `runsByStatus` | tile | not served today (D-MOB F1 gap) | always `UNKNOWN` in R1, never `0` |
| `generatedAt` | "as of" time | envelope (MOB-3 3.2); cockpit `generatedAt` `server.ts:729` | `—` |

## 5. Actions (all read-only)

| Action | Effect |
|---|---|
| Pull to refresh / screen focus | re-issue `GET /v1/mobile/summary` (with `If-None-Match`, MOB-3 3.4) |
| Tap a tile | navigate to UI-099 (missions/runs), UI-102 (workers), UI-103 (projects), UI-178 (alarms), F8 reports (PROPOSED id) |
| Tap the scope chip | open UI-180 (client-side filter only) |

No approve, reject, STOP, RESUME, retry or repair control is rendered (SC-25). The STOP banner is status only; RESUME stays desktop-only (FD; MOB-4 section 6).

## 6. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | first fetch, no cache | skeleton tiles; no numbers |
| Empty | journal `ABSENT` (no projects yet) | "No work yet on the desktop"; tiles show `—` |
| Error | 500 `INTERNAL_ERROR`, malformed envelope | `—` everywhere plus fixed error code |
| OFFLINE | network failure (phone-local, ADR section 5) | OFFLINE banner; switch to the STALE cache (UI-177) |
| STALE | cached copy, or a server block marked `STALE` | values plus STALE badge and age |
| UNAVAILABLE | block source missing | `—` with `UNAVAILABLE` pill, never `0` |
| Denied | 401 `MOBILE_SESSION_INVALID`, `DEVICE_REVOKED`, 403 `MOBILE_SCOPE_INSUFFICIENT` (MOB-3 3.5) | no data; go to UI-249 (revoked: cache wiped, MOB-2 section 9) |
| Expired | 401 `MOBILE_SESSION_EXPIRED` | silent refresh per MOB-2 5.4; on failure UI-249 |
| Desktop degraded | 503 `DESKTOP_DEGRADED` (journal TAMPERED/UNAVAILABLE) | red health pill, STALE cache only |

## 7. Desktop reuse (honest-state rules)

- Counterpart: `apps/desktop/renderer/views/home.js` and the cockpit mapper in `model.js` (read-only reuse of rules, no coupling decided: D-MOB Q21).
- `model.js:1-4`: missing data is `—` (`MISSING`), never a number; `CONTRACT_STATES` at `model.js:2`; `classifyFailure` maps 404/501 to `UNAVAILABLE` and network errors to `OFFLINE` (`model.js:12-17`).

## 8. Not on this screen

Approval items and their action descriptors (F5, MOB-7), STOP control (UI-176, MOB-7), notification feed (UI-100, MOB-7), Project Memory (none exists, D-MOB section 4).

## 9. UNVERIFIED and open questions

- Orchestrator block state in the installed app: **UNVERIFIED**.
- MOB-3 Q-1 (count-only approval tile), Q-7 (exposing `journal.seq`).
