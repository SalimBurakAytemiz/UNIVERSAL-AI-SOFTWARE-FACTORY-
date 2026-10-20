<!-- //TR: MOB-7 ekran spesifikasyonu UI-176 Mobil STOP_ALL Güvenli Akışı (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): MOB-4'e uyar; STOP onaylardan ayrı değerlendirilir (FA-MOB-8), her işlemde biyometrik step-up ve zorunlu gerekçe ister, güvenli tarafta kalır, yalnız yerel Work OS ve dev-run'ları durdurur, Cloud üretimini durdurmaz; RESUME asla telefonda yoktur. İlk sürümde yalnız STOP durumu okunur. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-176 Mobile STOP_ALL safe flow (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. Follows `APPROVAL-AND-STOP.md` (MOB-4) sections 5-6: STOP is evaluated **separately from approvals**, is step-up authenticated, is fail-safe, and the phone **never RESUMEs**. Release 1 shows STOP **state only**.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Show whether GLOBAL_STOP is active, and (only after FA-MOB-8) let the Founder activate it from the phone.
- Target function F9; inventory row `SCREEN_AUDIT_252.csv:177`. Desktop analog: stop dialog (`apps/desktop/renderer/shell.js:196-202`) calling `POST /v1/control/stop` (`server.ts:142-145`).

## 2. Release and gating

| Part | Release | Gate |
|---|---|---|
| STOP state (read) | R1 candidate | FA-MOB-5 read set (`GET /v1/mobile/ops`) |
| STOP action | **Not release 1** (SC-25); MOB-25 | FA-MOB-8; **does not** need the PT-035 fix (MOB-4 5.3) |
| RESUME | **never on the phone** (Founder decision; MOB-4 section 6) | none: no `MOBILE_RESUME` scope or route exists in any phase |

## 3. Authority dependency

State: FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4 (`MOBILE_READ`), FA-MOB-5, FA-MOB-6. Action adds FA-MOB-4 scope `MOBILE_STOP`, FA-MOB-8, FA-MOB-9, FA-MOB-12. FA-MOB-7 is **not** required (FD-b). None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| `GET /v1/mobile/ops` → `globalStop {active, reason}`, `journal`, `blocked` | PROPOSED | MOB-3 4.7 |
| Underlying `GET /v1/control/status` | exists | `server.ts:120` |
| `POST /v1/mobile/control/stop` | PROPOSED thin wrapper over the same `activateGlobalStop` logic | MOB-4 5.1; MOB-3 5.1 |
| Desktop STOP today | token only, optional reason, actor `FOUNDER_CONTROL_TOWER`, stops all dev-runs | `server.ts:142-145` |

## 5. Fields

| Field | Notes |
|---|---|
| STOP state | `ACTIVE` / `NOT ACTIVE` / `—`; shown ACTIVE only after the server confirms (MOB-4 5.2) |
| Stop reason | untrusted text with provenance (SC-10) |
| Journal state | `OK`, `TORN_TAIL`, `TAMPERED` surfaced, never hidden (MOB-3 4.7) |
| Blast radius (fixed text) | "Halts local Work OS writes and dev-runs on your PC. **Does not stop Cloud production or cloud routines.**" (SC-6; `CLOUD_MIGRATION_MANIFEST.md:22`) |
| Resume line (fixed text) | "Resume only on the desktop." Text only, no control |
| Reason input | **required**, length-limited, never parsed (SC-6, SC-10) |

## 6. Actions

| Action | Rule |
|---|---|
| Refresh state | pull |
| **STOP ALL** (later) | confirm screen with blast radius → required reason → step-up → signed request with single-use server nonce; actor `MOBILE_DEVICE:<deviceId>` |
| Cancel | nothing sent |

No RESUME, retry-blocked, per-project stop or journal repair. Voice and notifications cannot trigger STOP (SC-8, SC-9). The desktop dialog text "You can lift it with Resume" (`apps/desktop/renderer/locales/en.js:151`) must **not** be reused on the phone.

## 7. Step-up authentication points

- App unlock (UI-174) for the state view.
- **Per STOP:** class-strong biometric with the STOP key; no device-credential fallback proposed (MOB-4 5.1; Q-4 open). No "armed for N minutes".

## 8. Security conditions

SC-1, SC-3 (`/v1/control/resume` excluded), SC-6, SC-7 (never queued: "STOP NOT SENT"), SC-8, SC-9, SC-10, SC-17, SC-18, SC-20 (obscured-touch rejection on the STOP button), SC-25, SC-26.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | fetch / STOP in flight | STOP button disabled |
| Empty | n/a (state always has a value or `—`) | — |
| Error | 500 / unknown | "STOP state unknown"; after an attempt: **"STOP NOT CONFIRMED"**, never "stopped" |
| OFFLINE | network down | "STOP NOT SENT"; button disabled; nothing queued |
| STALE | cached state | STALE badge with age; the phone never claims a current STOP from cache |
| UNAVAILABLE | release 1 action, or grant missing | state visible; action shows "STOP from the desktop" |
| Denied | 403 `MOBILE_SCOPE_INSUFFICIENT`; 401 `DEVICE_REVOKED`; step-up failed/cancelled; empty reason; 429 rate limit | fixed text, nothing sent |
| Expired | STOP nonce or step-up expired before submit | re-request; old nonce never reused |
| Already stopped | STOP active | idempotent; shows ACTIVE with reason; no resume control |
| Degraded | 503 `DESKTOP_DEGRADED` | "Desktop degraded"; STOP state from `/ops` still shown where served |

Fail-safe rule: an unreadable stop file already counts as stopped on the server (`server.ts:163`); the phone must never show the reverse.

## 10. UNVERIFIED and open

- Per-scope STOP (MOB-4 Q-10); STOP before any approval release (MOB-4 Q-11).
- STOP rate-limit numbers (PROPOSED).
