<!-- //TR: MOB-7 ekran spesifikasyonu UI-104 Mobil Güvenli Profil (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): eşleşmiş cihazın kimliği, kapsamı (ilk sürümde yalnız MOBILE_READ), oturum süresi, sabitlenmiş TLS parmak izi ve "bu telefonun eşleşmesini kaldır" eylemi; kontrol token'ı telefonda yoktur. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-104 Mobile secure profile (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. Follows MOB-2 (`CONNECTIVITY-AND-PAIRING.md` sections 5.3-5.6) and ADR-MOB-001 section 5.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Shows what this phone is to the desktop: device label, device id, granted scope, session lifetime, pinned gateway fingerprint, app-lock setting, and the local cache state.
- Offers "Unpair this phone".
- Target function: security; inventory row `SCREEN_AUDIT_252.csv:105`.

## 2. Release and gating

| Item | Value |
|---|---|
| Release | R1 read-only candidate (MOB-17 server side, MOB-20 app side; D-MOB section 11) |
| Gate | pairing and device sessions exist (FA-MOB-4) over the TLS gateway (FA-MOB-3); nothing granted yet |

## 3. Authority dependency

FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-6; desktop-side device list and revocation FA-MOB-23. Storage library choice falls under FA-MOB-12. None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| Local Keystore-backed credential store | PROPOSED; first-party Kotlin TurboModule over Android Keystore preferred, react-native-keychain 10.0.0 only if New Architecture fit is confirmed | `TECH-VERSIONS.md` 3.10; ADR-MOB-001 section 5 (`ADR-MOB-001-REACT-NATIVE-ANDROID.md:118-120`) |
| Pinned SPKI fingerprint | from the pairing QR `fp` field | MOB-2 5.2, 5.3 |
| Session scope and expiry | issued by the gateway at pairing/refresh; no route name in MOB-3 (PROPOSED, owned by MOB-17) | MOB-2 5.4 |
| Device registry | projection of PROPOSED journal records `DEVICE_PAIRED`/`DEVICE_REVOKED` in the existing Work OS journal; not exposed to the phone in MOB-3 | MOB-2 5.6 |
| Journal state | `journal.state` in every MOB-3 envelope (from `journalHealth()`, `server.ts:119`) | MOB-3 3.2 |

## 5. Fields

| Field | Notes |
|---|---|
| Device label, `deviceId` | local copy from pairing |
| Scope | `MOBILE_READ` in release 1 (MOB-2 5.4). `MOBILE_STOP`/`MOBILE_APPROVE` shown only if ever issued |
| Session expires / refresh cap | proposed 15 min / 7 days (MOB-2 5.4, Q-7); server time |
| Gateway fingerprint | short SPKI hash; "Pinned at pairing" |
| Connection model | `LAN (A)` or `VPN/overlay (B)`; never "tunnel" or "relay" |
| Key storage | `HARDWARE-BACKED`, `TEE`, or `UNKNOWN` — never claimed without platform evidence (UNVERIFIED per device) |
| App lock | idle timeout (UI-174) |
| Cache | encrypted, age of last fetch, size |

Never shown or stored: the desktop control token (SC-1), the pairing secret, the session secret value, the private key.

## 6. Actions

| Action | Effect |
|---|---|
| Unpair this phone | deletes local keys and cache, sends a best-effort revoke; the desktop record is authoritative (MOB-2 5.5) |
| Wipe cache | deletes the encrypted STALE cache |
| Change idle timeout | local; opens UI-174 settings |

"Unpair this phone" (and the revoke it requests) is a **pairing-plane** action on the device registry (MOB-2 5.5-5.6, FA-MOB-4). It is not a session-plane action and not a run-control action: it never stops, approves or changes any mission or run.

No action raises scope. Revoking other devices, approve-key management and gateway enable live on the desktop only.

## 7. Step-up authentication points

- App unlock (UI-174) to open.
- Unpair and wipe: device authentication again before the irreversible local wipe.

## 8. Security conditions

SC-1, SC-7, SC-11, SC-17, SC-18, SC-20 (`FLAG_SECURE`), SC-21, SC-22, SC-24 (no tunnel/relay), SC-25, SC-26.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | reading Keystore | spinner |
| Empty | not paired | "This phone is not paired" → UI-173 |
| Error | Keystore read failure | "Credential unreadable"; app treats phone as unpaired (fail closed) |
| OFFLINE | gateway unreachable | local fields shown; session fields marked OFFLINE |
| STALE | last server confirmation old | STALE badge with age |
| UNAVAILABLE | gateway disabled on desktop | "Desktop gateway off" |
| Denied | 401 `DEVICE_REVOKED` / session reuse | local wipe, "This phone was removed on the desktop" |
| Expired | session expired, refresh failed | `REAUTH_REQUIRED` → UI-174 then refresh; refresh cap reached → re-pair (UI-173) |
| Key invalidated | new biometric enrolment / OS reset | local wipe, re-pair (MOB-2 section 9) |

## 10. UNVERIFIED and open

- Hardware backing per device; storage library choice (MOB-5/MOB-9).
- Session lifetimes (MOB-2 Q-7).
