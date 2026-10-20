<!-- //TR: MOB-6 ekran şartnamesi UI-249 Mobil Companion Session Sürdürme (yalnız tasarım, ETKİN DEĞİL): burada "sürdürme", mobil uygulama oturumunun yeniden açılması demektir (MOB-2'ye göre cihaz anahtarıyla token yenileme veya yeniden eşleştirme). Bu, çalıştırma RESUME (POST /v1/control/resume) DEĞİLDİR; o masaüstünde kalır. Ekran hiçbir yazma, onay, STOP veya RESUME eylemi sunmaz. -->

# UI-249: Mobile Companion Session Resume (Mobil Companion Session Sürdürme)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, pairing, session, refresh route or listener exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB section 11 row UI-249 (security; build MOB-17, MOB-20).
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`).
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:250` (AUTHORITY_REQUIRED, stale UNAPPROVED, `action_contract=TBD`).

## 1. What "resume" means here (and what it does not)

- **It means:** re-opening the mobile app session after the app was backgrounded, killed, the phone rebooted, the access session expired, or the desktop backend restarted (live sessions are memory-only, MOB-2 5.6). The phone either refreshes its device session with its Keystore device key, or, if that is impossible, sends the Founder to re-pair on the desktop (MOB-2 5.1, 5.4, 5.5).
- **It does NOT mean run RESUME.** Clearing GLOBAL_STOP and restarting the supervisor is `POST /v1/control/resume` (`apps/control-api/src/server.ts:146`). That stays **desktop-only** in every phase (FD-2026-10-20-MOB-PHASE0; MOB-4 section 6; MOB-3 5.1). This screen has no control, link or wording that resumes runs. Its labels use "Reconnect" / "Sign in again" / "Pair again", never "Resume".

## 2. Target function and release

- **Function:** security / session shell (D-MOB section 11).
- **Release:** R1 (needed by every read screen).
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4 (sessions, refresh, revocation), FA-MOB-6, FA-MOB-9, FA-MOB-23 (desktop pairing/device UI for re-pair). **Build packages:** MOB-17, MOB-20.

## 3. Data source

| Source | Status | Evidence |
|---|---|---|
| device-session refresh (signed with the device key) | **PROPOSED** behaviour (MOB-2 5.4); **no route name** is defined in MOB-3 or MOB-2. The name is left to MOB-17 under FA-MOB-4 | — |
| re-pairing (QR + pinned TLS + desktop confirmation) | **PROPOSED** (MOB-2 5.1-5.3); layout belongs to UI-173 (MOB-7) | — |
| first read after resume: `GET /v1/mobile/summary` | **PROPOSED** (MOB-3 4.1) | upstream `server.ts:728-731` |
| app lock before any of this | UI-174 (MOB-7); ADR section 5 | — |

## 4. Fields

| Field | Source | Rule |
|---|---|---|
| paired desktop label | local pairing record (Keystore-protected, ADR section 5) | no address shown beyond the label and last octets (PROPOSED) |
| device label, key fingerprint (short) | local device key | for comparison with the desktop device list |
| session status | phone classification of MOB-3 3.5 / MOB-2 section 9 | `CONNECTING`, `REFRESHING`, `REAUTH_REQUIRED`, `DEVICE_REVOKED`, `PIN_MISMATCH`, `UNREACHABLE` |
| absolute session cap | MOB-2 5.4 (proposed 7 days) | "re-confirm on the desktop after <date>" |
| last sync time | STALE cache (UI-177) | age |

No token, session id, secret, control token or certificate body is ever displayed or logged (SC-1, SC-21).

## 5. Actions (all read-only with respect to the factory)

| Action | Effect |
|---|---|
| Reconnect | one refresh attempt with the device key, then one read |
| Show cached data | open UI-177 STALE views |
| Pair again | open the pairing scanner (UI-173, MOB-7); the Founder confirms on the desktop |
| Unpair this phone | local wipe of key and cache plus best-effort revoke (MOB-2 5.5); affects only this device's own credential, no factory state |

"Revoke" on this screen = **device revocation per MOB-2 §5.5**: a registry (pairing) action whose effect also ends every live session of this device. The phone sends a best-effort request (same action as "Unpair this phone" on UI-104, MOB-7); the desktop `DEVICE_REVOKED` registry record (MOB-2 §5.6) is authoritative. Not run control; not RESUME. Separately, session rotation on refresh (MOB-2 §5.4-5.5: each refresh issues a new session and invalidates the old one) is **not** a revoke.

No approve, STOP, RESUME, retry or any `/v1/control/*` call. Nothing is queued while disconnected (SC-7).

## 6. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | refresh in flight | "Reconnecting…"; cached data visible with STALE |
| Empty | no pairing on this phone | "Not paired"; pair path only |
| Error | unexpected refresh response | treated as deny (MOB-2 section 9 rule); "Sign in again" |
| OFFLINE | network failure | OFFLINE banner, STALE cache (UI-177); retry offered |
| STALE | showing cache | STALE badge and age |
| UNAVAILABLE | 503 `GATEWAY_NOT_READY` (MOB-3 3.5) or desktop app closed | "The desktop app must be open" (MOB-2 section 8) |
| Denied | 401 `DEVICE_REVOKED`, `MOBILE_SIGNATURE_INVALID`, `CONTROL_TOKEN_NOT_ACCEPTED` | revoked: wipe session and cache, pair-again only (MOB-2 section 9) |
| Expired | 401 `MOBILE_SESSION_EXPIRED`; absolute cap reached | silent refresh; at the cap: re-confirm on the desktop |
| Clock skew | 401 `MOBILE_CLOCK_SKEW` | "Check the phone's time", then retry |
| Pin mismatch | `PIN_MISMATCH` | hard stop, no "continue", re-pair only |
| Key invalidated | Keystore key lost (new biometric, OS reset) | local wipe, re-pair (MOB-2 section 9) |

## 7. Desktop reuse

- `apps/desktop/renderer/resume-confirm.js` is the desktop confirmation for run RESUME (clearing GLOBAL_STOP). It is explicitly **not** a counterpart of this screen.
- `apps/desktop/renderer/recovery-core.js` (UI-251, control API unreachable) is a read-only reference for one rule: show only allow-listed state, never error text, stack, path or token.
- Honest-state rules as `apps/desktop/renderer/model.js:2-4` (contract states, `—`).

## 8. Not on this screen

Run RESUME, GLOBAL_STOP control, pairing QR layout (UI-173), biometric lock layout (UI-174), device management on the desktop (FA-MOB-23).

## 9. UNVERIFIED and open questions

- Session lifetimes (15 min access, 7 day cap) are proposals (MOB-2 5.4; Founder Q-7).
- Refresh route name and shape: not specified anywhere yet.
- Keystore hardware backing per device: **UNVERIFIED** (SC-21, RR-2).
