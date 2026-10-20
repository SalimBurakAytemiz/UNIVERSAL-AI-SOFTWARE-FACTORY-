<!-- //TR: MOB-7 ekran spesifikasyonu UI-175 Mobil Kritik Onay Ayrıntısı (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): ilk sürümde yoktur; PT-035 ve FA-MOB-7 olmadan açılmaz; karar yalnız MOB-4 sunucu challenge + cihaz imzası + her işlemde biyometrik doğrulama ile verilir; serbest metin veya ses onay sayılmaz. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-175 Mobile critical approval detail (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. **Not in release 1.** Blocked on PT-035 and the grants in `docs/mobile/APPROVAL-AND-STOP.md` section 9. The only decision path is the signed challenge of MOB-4 sections 4.2-4.4.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Shows one inbox item exactly as the server describes it and lets the Founder sign APPROVE or REJECT for a class the Founder allowed on mobile.
- Target function F5; inventory row `SCREEN_AUDIT_252.csv:176`. The desktop analog is the inbox transition (`POST /v1/missions/:id/transition`, `server.ts:221`), which the phone never calls (MOB-3 section 5.1).

## 2. Release and gating

| Item | Value |
|---|---|
| Release | **Not release 1** (SC-25). |
| Hard precondition | PT-035 fixed (`server.ts:164-167`): today every write is classed `MUTATION` with an all-true context (`:165-166`), so a signature would guard nothing (MOB-4 section 2). |
| Build packages | MOB-23, MOB-24 |

## 3. Authority dependency

FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4 (`MOBILE_APPROVE`), FA-MOB-6, FA-MOB-7, FA-MOB-9, FA-MOB-12; approve-key registration as "FA-MOB-23 extended" (PROPOSED, not in D-MOB). Only rows of the MOB-4 4.6 matrix the Founder marks under FA-MOB-7 can ever show controls; the default for every row is DESKTOP-ONLY.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| `POST /v1/mobile/approvals/challenge` | PROPOSED | MOB-4 4.2; MOB-3 5.1 |
| `POST /v1/mobile/approvals/:itemId/decision` | PROPOSED; body `{challengeId, decision, signature, reason?}`, never `to` | MOB-4 4.3 |
| Item context (read) | PROPOSED `GET /v1/mobile/inbox`; run detail `GET /v1/mobile/runs/:runId` (PROPOSED) | MOB-3 4.4, 4.10 |
| Today's attestation type | no nonce, signature or device binding | `core/authority/approval.ts:2-10` |

## 5. Fields

| Field | Source | Notes |
|---|---|---|
| `display.title`, `display.summary`, `display.provenance` | challenge (PROPOSED) | **not signed, not authority** (MOB-4 4.2); shown in a distinct untrusted-text region (SC-10) |
| `decisionClass` | challenge | fixed enum; DESKTOP-ONLY classes never reach this screen (403 `CLASS_DESKTOP_ONLY`) |
| `expectedStatus`, `headSha` | challenge | shown read-only so the Founder sees what is being decided |
| `actionDigest`, `itemDigest` | challenge | shown as short fingerprints |
| `expiresAt` | challenge, **server time** | countdown; client cannot extend it (AT-R3) |
| `riskLevel` | `server.ts:683` via inbox | `—` when missing |

## 6. Actions

| Action | Rule |
|---|---|
| Request challenge | on open; one open challenge per item per device (MOB-4 4.2) |
| **Sign APPROVE** / **Sign REJECT** | two separate buttons; each signs the canonical payload of MOB-4 4.3 with the approve key; REJECT is signed too |
| Reason (optional) | free text, stored with provenance, **never changes the decision** (SC-10) |
| Cancel | discards the challenge locally; nothing sent |

There is **no** text, voice, notification, long-press or "approve all" path. Typing "approve" in the reason does nothing (SC-9, SC-10).

## 7. Step-up authentication points

- App unlock (UI-174) to open the screen.
- **Per decision:** class-strong biometric through BiometricPrompt with a `CryptoObject` bound to the approve key; validity one operation; no "approve for N minutes" (MOB-4 4.1, AT-S1). Device-credential fallback is open (MOB-4 Q-4).

## 8. Security conditions

SC-1, SC-3, SC-4 (all bindings), SC-5, SC-7, SC-9, SC-10, SC-14, SC-17, SC-18 (actor `MOBILE_DEVICE:<deviceId>`), SC-20 (`FLAG_SECURE`, obscured-touch rejection), SC-21 (approve key separate from session key), SC-25, SC-26.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | challenge request in flight | buttons disabled |
| Empty | item no longer in inbox | "Already decided or withdrawn"; back to UI-098 |
| Error | 500, 503 `DESKTOP_DEGRADED` | fixed code; "Decision NOT sent" |
| OFFLINE | network failure | buttons disabled; **never queued** (SC-7) |
| STALE | cached item only | read-only, no challenge, no buttons |
| UNAVAILABLE | release 1 or grant missing | "Decide on the desktop" — **release-1 state** |
| Denied | 403 `CLASS_DESKTOP_ONLY` / `MOBILE_SCOPE_INSUFFICIENT`; 401 `DEVICE_REVOKED`; signature invalid; biometric failed or cancelled | fixed text, nothing applied |
| **Expired** | server time ≥ `expiresAt`; challenge superseded or consumed | "Challenge expired"; offer re-request, never re-sign the old one (AT-D1) |
| Conflict (stale item) | 409: `expectedStatus`, `itemDigest` or `headSha` changed | "The item changed. Nothing was applied." Challenge consumed as STALE (MOB-4 4.4 step 6) |
| GLOBAL_STOP | 423 | "Approvals blocked while STOP is active" |
| Applied | server outcome `APPLIED` | shown only after the server confirms |

## 10. UNVERIFIED and open

- Keystore/StrongBox/BiometricPrompt behaviour and key attestation checks: UNVERIFIED (MOB-9, MOB-4 Q-9).
- Challenge lifetime (Q-3), canonical JSON (Q-2), desktop second confirmation (Q-6), cancel window (Q-7).
