<!-- //TR: MOB-7 ekran spesifikasyonu UI-173 Mobil Güvenli Cihaz Eşleştirme (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): MOB-2 ve ADR-MOB-001'e birebir uyar; masaüstünde başlatılan tek kullanımlık QR, QR'daki SPKI parmak iziyle TLS sabitleme, Keystore'da üretilen dışa aktarılamaz cihaz anahtarı ve masaüstünde onay; açık tünel veya relay yok. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-173 Mobile secure device pairing (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. Follows `CONNECTIVITY-AND-PAIRING.md` (MOB-2) section 5 and `ADR-MOB-001-REACT-NATIVE-ANDROID.md` exactly. No open tunnel, no relay, no second backend.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Phone side of pairing: scan the desktop QR, pin the gateway key, create the device key, show the pairing code, and wait for the Founder to confirm **on the desktop**.
- Target function: security; inventory row `SCREEN_AUDIT_252.csv:174` (no client, no pairing).
- Desktop side ("Pair a phone", device list) is a desktop screen under FA-MOB-23, not specified here.

## 2. Release and gating

| Item | Value |
|---|---|
| Release | R1 prerequisite (model A, same LAN). Model B uses the same flow over the user's overlay address (MOB-2 section 7). |
| Build packages | MOB-17 (server), MOB-19 (desktop UI), MOB-20 (app) |
| Today | both listeners bind `127.0.0.1` only (`server.ts:736-739` per D-MOB `:87`); a phone cannot reach the API |

## 3. Authority dependency

FA-MOB-1, FA-MOB-2 (connectivity A/B), FA-MOB-3 (TLS gateway listener), FA-MOB-4 (pairing, registry, sessions, revocation), FA-MOB-6, FA-MOB-21 (host/firewall), FA-MOB-23 (desktop QR UI), FA-MOB-12 (QR/camera library admission). None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| QR `uasco-pair:v1?id&s&n&h&p&fp&exp` | PROPOSED | MOB-2 5.2 |
| Pairing claim (HMAC proof over `pairingId`, nonce, device public key, fingerprint) | PROPOSED; no route name in MOB-3 (MOB-17 owns it) | MOB-2 5.1 step 5 |
| Device key | Android Keystore, non-exportable; hardware backing per device UNVERIFIED | MOB-2 5.1 step 4; `TECH-VERSIONS.md` 3.10 |
| QR scanner | candidate react-native-camera-kit 18.0.1 or vision-camera 5.2.3; QR support UNVERIFIED | `TECH-VERSIONS.md` 3.14 |

## 5. Fields

| Field | Notes |
|---|---|
| Camera viewfinder | one-shot read; payload treated as untrusted input |
| Gateway host:port | from QR; must equal the bound gateway address |
| Fingerprint | short SPKI hash for comparison with the desktop |
| Pairing code | 6-8 chars derived from the secret, compared with the desktop (MOB-2 5.1 step 2) |
| Countdown | from `exp`; server clock authoritative |
| Device label | typed by the Founder; untrusted text (SC-10) |

The QR and this screen carry no control token, session token, project data or Founder identity (MOB-2 5.2).

## 6. Actions

| Action | Effect |
|---|---|
| Scan QR | parse; reject unknown version, missing field, expiry beyond skew |
| Connect | TLS to `h:p`, **pin `fp`**; any mismatch aborts before application data (MOB-2 5.3) |
| Send claim | after key generation; secret never sent in clear |
| Cancel | erase parsed payload and generated key |

No "trust anyway", no plain-HTTP fallback, no manual host entry that skips the pin, no deep link or intent that starts or completes pairing (SC-20).

## 7. Step-up authentication points

- Before key generation: device authentication (so the key is created by the phone's owner).
- **Desktop confirmation** (physical presence) is the authorising step; a phone tap never completes pairing (MOB-2 5.1 step 6).
- After success: UI-174 app-lock setup is mandatory before the first read.

## 8. Security conditions

SC-1, SC-2, SC-11, SC-17, SC-18, SC-20, SC-21, SC-22, SC-23, SC-24, SC-26.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | camera starting / TLS / waiting for desktop | step indicator; waiting shows the pairing code |
| Empty | no QR in view | "Point at the QR on the desktop" |
| Error | Keystore key generation failed | `PAIRING_FAILED`, nothing stored |
| OFFLINE | host unreachable on this network | `UNREACHABLE`; never tries another host |
| STALE | n/a | — |
| UNAVAILABLE | gateway disabled / not authorised | "Enable the mobile gateway on the desktop" |
| Denied | camera permission refused; `PIN_MISMATCH` (hard stop, no continue); desktop declined (`PAIRING_REJECTED`); attempt limit (`PAIRING_LOCKED`) | fixed text per MOB-2 section 9 |
| **Expired** | QR `exp` passed, record consumed or burned | `PAIRING_FAILED`: "Start again on the desktop" |
| Degraded | journal tampered / torn tail | `DESKTOP_DEGRADED` or "pairing unavailable (read-only journal)" |

## 10. UNVERIFIED and open

- Network Security Config vs custom trust manager for IP-literal pinning (MOB-2 5.3).
- QR TTL and failed-claim limit (MOB-2 Q-7); QR library choice (MOB-5).
