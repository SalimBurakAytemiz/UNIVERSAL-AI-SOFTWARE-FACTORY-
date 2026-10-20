<!-- //TR: MOB-7 ekran spesifikasyonu UI-250 Mobil Sesli Komut ve Bekleyen Taslak (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): ilk sürümde yoktur; "sesli komut" yalnız bekleyen etkisiz taslak demektir; taslak hiçbir zaman çalıştırılmaz, onaylanmaz veya STOP göndermez; terfi yalnız step-up ile ve testCommand olmadan yapılır. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-250 Mobile voice command and pending draft (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. **Not in release 1.** A "voice command" here is only a **pending draft**: it is never executed, never an approval and never a STOP.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Lists the Founder's pending drafts (voice or typed) and lets the Founder discard one or promote it to an inert mission DRAFT.
- Target function F7; inventory row `SCREEN_AUDIT_252.csv:251` (stale UNAPPROVED, no code).

## 2. Release and gating

| Item | Value |
|---|---|
| Release | **Not release 1** (SC-25: no draft route on the R1 allow-list). |
| Build package | MOB-28 |

## 3. Authority dependency

FA-MOB-17 (draft endpoints; promotion only through step-up; `testCommand` forbidden), FA-MOB-16 (voice origin), plus FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-6. The scope a session needs for draft writes is **PROPOSED, not in D-MOB** (MOB-2 5.4 names only `MOBILE_READ`, `MOBILE_STOP`, `MOBILE_APPROVE`). None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| `GET /v1/mobile/drafts` | PROPOSED | D-MOB `:146`; MOB-3 5.1 |
| `POST /v1/mobile/drafts/:id/promote` | PROPOSED; step-up; `testCommand` forbidden | D-MOB `:146`, FA-MOB-17 |
| Promotion target | an inert mission DRAFT; today `POST /v1/missions` (`server.ts:211`) creates status `DRAFT` and copies any `testCommand` (`core/workos/store.ts:548`; schema `core/workos/schemas.ts:36-40`), so the phone must never call it directly | MOB-3 5.1 |

## 5. Fields (per draft)

| Field | Notes |
|---|---|
| `draftId`, `createdAt` | PROPOSED; server time |
| `title`, `note` | untrusted text, provenance "voice" or "typed" (SC-10) |
| `state` | `PENDING`, `PROMOTED`, `DISCARDED` (PROPOSED enum) |
| `projectId` | chosen from a read list; `—` when none |
| Promoted mission id | after promotion; mission starts as DRAFT and needs every normal desktop step |

No `testCommand`, `riskLevel` override, run, approve or STOP field.

## 6. Actions

| Action | Effect |
|---|---|
| Open | read the draft |
| Discard | PROPOSED; inert |
| **Promote to mission DRAFT** | PROPOSED; creates an inert DRAFT only; preflight, authorization and runs stay desktop decisions |

The draft text is never parsed for intent. A draft saying "approve mission X" or "STOP everything" stays text (SC-9, SC-10). There is no "run now" or "execute" control.

## 7. Step-up authentication points

- App unlock (UI-174).
- **Promote:** device step-up (class-strong biometric proposed) per promotion; failed or cancelled step-up sends nothing.

## 8. Security conditions

SC-3 (`testCommand` excluded), SC-4/SC-5 (promotion is not an approval), SC-7 (no offline queue), SC-9, SC-10, SC-18 (actor `MOBILE_DEVICE:<deviceId>` on draft records), SC-19, SC-25.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | fetch | skeleton |
| Empty | no drafts | "No pending drafts" |
| Error | 500, 503 `DESKTOP_DEGRADED` | fixed code |
| OFFLINE | network down | list greyed; Promote/Discard disabled; nothing queued |
| STALE | cached list | STALE badge with age; read-only |
| UNAVAILABLE | release 1, route absent | "Drafts are not available on mobile" |
| Denied | 403 scope; 404; 401 `DEVICE_REVOKED`; step-up failed; payload with `testCommand` rejected (400) | fixed text, nothing changed |
| Expired | promotion step-up window passed before submit | re-authenticate; nothing sent |
| GLOBAL_STOP | 423 on promote (`server.ts:188` applies to Work OS writes) | "Promotion blocked while STOP is active" |

## 10. UNVERIFIED and open

- Draft storage location (must be the single existing store; MOB-4 Q-1 / MOB-2 Q-1).
- Draft write scope name (PROPOSED, not in D-MOB).
