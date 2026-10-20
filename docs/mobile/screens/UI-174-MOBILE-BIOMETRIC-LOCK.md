<!-- //TR: MOB-7 ekran spesifikasyonu UI-174 Mobil Biyometrik Kilit (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): MOB-2 ve ADR-MOB-001'e birebir uyar; ilk sürümde uygulama kilidi yalnız okumayı korur, hiçbir şey imzalamaz; Keystore ve BiometricPrompt TECH-VERSIONS.md kaydına göre; biyometrik veri uygulamaya veya sunucuya gelmez. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-174 Mobile biometric lock (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. Follows `ADR-MOB-001-REACT-NATIVE-ANDROID.md` section 5 (`:118-122`) and `TECH-VERSIONS.md` 3.10. In release 1 the lock **protects reading only; it signs nothing**.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Gate that opens the app (cold start and after the idle period) with device authentication: biometric, or device credential where allowed.
- Also the shared step-up surface later used by UI-175 (approve) and UI-176 (STOP), each with its own key and rules.
- Target function: security; inventory row `SCREEN_AUDIT_252.csv:175`.

## 2. Release and gating

| Use | Release | Gate |
|---|---|---|
| App unlock (read gate) | R1 candidate (MOB-20) | FA-MOB-1, FA-MOB-4, FA-MOB-12 (storage/biometric library) |
| Approve-key use (per decision) | later | FA-MOB-7, PT-035 (MOB-4 4.1) |
| STOP-key use (per action) | later | FA-MOB-8 (MOB-4 5.1) |

## 3. Authority dependency

FA-MOB-1, FA-MOB-4, FA-MOB-12; later FA-MOB-7 and FA-MOB-8 as above. None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| Android BiometricPrompt | platform; API semantics UNVERIFIED (MOB-9) | ADR-MOB-001 section 2 item 7 (`:47`) |
| Keystore key with `setUserAuthenticationRequired` | PROPOSED, first-party Kotlin TurboModule preferred | `TECH-VERSIONS.md` 3.10 |
| Server | **none**; unlock is local. The server only sees the later effect (a valid session refresh) | MOB-2 5.4 |

EncryptedSharedPreferences is **not** used (deprecated, `TECH-VERSIONS.md` 3.15).

## 5. Fields

| Field | Notes |
|---|---|
| Lock prompt | system BiometricPrompt UI; the app never sees biometric data |
| Reason line | fixed text "Unlock UASCO Companion" |
| Idle timeout | configurable, proposed default 5 min (UNVERIFIED value; SC-21 says "configurable idle period") |
| Method pill | `BIOMETRIC STRONG`, `DEVICE CREDENTIAL`, `NONE ENROLLED` |

## 6. Actions

| Action | Effect |
|---|---|
| Unlock | releases the Keystore-protected session credential and cache key |
| Use device credential | allowed for app unlock only; for approve/STOP it is open (MOB-4 Q-4) |
| Lock now | clears in-memory credential and decrypted cache |

## 7. Step-up authentication points

This screen **is** the step-up surface:

- Cold start, return after idle, and every session refresh that needs the device key.
- UI-104 unpair/wipe, UI-179 enabling voice, UI-250 promote (proposed).
- Later: UI-175 per decision (approve key, `CryptoObject`, one operation) and UI-176 per STOP. These keys are **separate** from the session key (SC-21; MOB-4 4.1).

## 8. Security conditions

SC-1, SC-4 (later, approve key), SC-6 (later, STOP step-up), SC-7 (cache key gated), SC-20 (`FLAG_SECURE` on the app when locked), SC-21, SC-25 (in R1 the lock signs nothing).

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | prompt starting | blank secure frame |
| Empty | no lock enrolled on the device | "Set a screen lock in Android settings"; app stays locked (**fail closed**) |
| Error | prompt error / hardware unavailable | "Unlock unavailable"; app stays locked |
| OFFLINE | no effect (local) | unlock works; data screens then show OFFLINE |
| STALE | n/a | — |
| UNAVAILABLE | no biometric hardware | device credential for unlock only; approve/STOP UNAVAILABLE |
| Denied | too many failures (system lockout) | stays locked; no bypass |
| Expired | idle timeout reached | re-lock |
| Key invalidated | new biometric enrolment | approve/session keys invalid → local wipe and re-pair (MOB-2 section 9) |

## 10. UNVERIFIED and open

- BiometricPrompt/Keystore behaviour per device; StrongBox presence (MOB-4 Q-9).
- Idle-timeout default; device-credential fallback for step-up (MOB-4 Q-4).
