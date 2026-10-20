<!-- //TR: MOB-7 ekran spesifikasyonu UI-101 Mobil Sesli Taslak (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): ilk sürümde yoktur; ses yalnız cihaz üzerinde metne çevrilir ve yalnız etkisiz taslak üretir; ses asla çalıştırmaz, onaylamaz veya STOP göndermez; testCommand yasaktır. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-101 Mobile voice draft (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. **Not in release 1.** Voice produces **drafts only**; it never executes, approves or STOPs (SC-9, SC-10).

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Lets the Founder dictate a short idea that becomes an **inert draft** (title + note) for later review on the desktop.
- Target function F7; inventory row `SCREEN_AUDIT_252.csv:102` ("voice capture is an unapproved behavior").
- Permission and privacy are UI-179; the pending-draft list and promotion are UI-250.

## 2. Release and gating

| Item | Value |
|---|---|
| Release | **Not release 1.** Founder: voice stays in the architecture and needs its own grant. Release 1 must ship no `RECORD_AUDIO` permission (SC-9 acceptance). |
| Build package | MOB-28 |

## 3. Authority dependency

FA-MOB-16 (voice privacy: `RECORD_AUDIO`, on-device STT only, no audio storage, transcripts LOCAL) and FA-MOB-17 (draft endpoints, promotion only through step-up, `testCommand` forbidden), plus transport/session grants FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-6. FA-MOB-18 (paid LLM assistant) is **not** used. None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| On-device speech recognizer | PROPOSED; `createOnDeviceSpeechRecognizer` needs API 31+; the platform recognizer "is likely to stream audio to remote servers" unless on-device is used | `TECH-VERSIONS.md` 3.15 (VERIFIED source quote) |
| `POST /v1/mobile/drafts` | PROPOSED; creates an inert draft | D-MOB F7 (`D-2026-10-20-MOBILE-ANDROID.md:146`); MOB-3 5.1 |
| Existing `POST /v1/missions` | exists (`server.ts:211`) and accepts `testCommand` (`core/workos/schemas.ts:36-40`); **never called from the phone** | MOB-3 5.1 |
| `POST /v1/founder/commands` | **does not exist** | D-MOB `:146` |

## 5. Fields

| Field | Notes |
|---|---|
| Live transcript | local only; untrusted PII (`core/policy/data-routing.ts:9`, `PII: ["LOCAL"]`) |
| Editable draft title / note | typed edit allowed before saving; length caps per MOB-3 3.4 |
| Provenance label | "Voice draft — not an instruction" on every draft |
| STT mode pill | `ON-DEVICE` or `UNAVAILABLE`; never "cloud" |

There is **no** `testCommand`, risk level, project-run, approve or target-state field.

## 6. Actions

| Action | Effect |
|---|---|
| Hold to talk | on-device STT; audio never stored or sent |
| Save as draft | PROPOSED `POST /v1/mobile/drafts`; result is an inert draft, nothing runs |
| Discard | local transcript erased |

Spoken words such as "approve", "stop", "resume" or "run" are text in the draft. They are never matched to a command (SC-10). The screen has no STOP or approve button.

## 7. Step-up authentication points

- App unlock (UI-174).
- Saving a draft: no step-up (inert). **Promotion** of a draft is step-up and lives in UI-250.

## 8. Security conditions

SC-3 (no mission create with `testCommand`), SC-7 (no offline queue: a draft not saved is not sent later), SC-9, SC-10, SC-11, SC-18, SC-20 (`FLAG_SECURE`), SC-25 (absent in R1).

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | recognizer starting | "Preparing on-device recognition" |
| Empty | nothing recognized | "Nothing heard"; no draft created |
| Error | recognizer error, 500 | fixed text; transcript kept locally until discarded |
| OFFLINE | network down | dictation still local; **Save disabled**, not queued |
| STALE | n/a for capture; draft list staleness is UI-250 | — |
| UNAVAILABLE | on-device STT not available (API < 31 or no model) | **fail closed**: feature disabled, no cloud fallback (SC-9) |
| Denied | `RECORD_AUDIO` refused (UI-179); 403/404 drafts route; 401 `DEVICE_REVOKED` | fixed text; no capture |

## 10. UNVERIFIED and open

- On-device recognizer quality and offline model availability per device: UNVERIFIED.
- Minimum Android version (D-MOB Q9; ADR-MOB-001 Q6).
