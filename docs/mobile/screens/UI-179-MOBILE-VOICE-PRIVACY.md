<!-- //TR: MOB-7 ekran spesifikasyonu UI-179 Mobil Ses Gizliliği ve İzin (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): ilk sürümde yoktur ve RECORD_AUDIO izni istenmez; ileride yalnız cihaz üzerinde konuşma tanıma, ses kaydı yok, transkript yerel kalır; ses hiçbir zaman onay veya STOP yolu değildir. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-179 Mobile voice privacy and permission (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. **Not in release 1**; release 1 requests no microphone permission at all.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- Explains, before any microphone use, exactly what voice does and does not do, and requests `RECORD_AUDIO` only after the Founder opts in.
- Target function F7; inventory row `SCREEN_AUDIT_252.csv:180` (no code, no voice feature).

## 2. Release and gating

| Item | Value |
|---|---|
| Release | **Not release 1** (SC-9 acceptance: no `RECORD_AUDIO` in the merged manifest). |
| Build package | MOB-28 |

## 3. Authority dependency

FA-MOB-16 (voice privacy). Draft creation behind it needs FA-MOB-17. FA-MOB-18 is **not** used (no LLM, no paid service, Founder decision for release 1). None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| Android permission state (`RECORD_AUDIO`) | platform, local | `TECH-VERSIONS.md` 3.15 |
| On-device recognizer availability (`isOnDeviceRecognitionAvailable`, API 31+) | platform, local | `TECH-VERSIONS.md` 3.15 |
| Data-routing rule `PII: ["LOCAL"]` | exists | `core/policy/data-routing.ts:10` |
| Server | **none**; this screen calls no route | — |

## 5. Fields (fixed text, not configurable)

| Statement shown | Source rule |
|---|---|
| "Speech is converted to text **on this phone only**. If that is not possible, voice is off." | SC-9 |
| "No audio is recorded or stored." | FA-MOB-16 |
| "Transcripts stay on this phone until you save a draft." | SC-9; `data-routing.ts:10` |
| "Voice can only create drafts. It cannot approve, run, STOP or RESUME anything." | SC-9, SC-10; MOB-4 AT-F3 |
| Permission state pill | `GRANTED` / `NOT GRANTED` / `PERMANENTLY DENIED` |
| Recognizer pill | `ON-DEVICE AVAILABLE` / `UNAVAILABLE` |

## 6. Actions

| Action | Effect |
|---|---|
| Enable voice drafts | system permission prompt for `RECORD_AUDIO`; only then UI-101 is reachable |
| Turn off voice | local switch off; app stops using the microphone; Android settings link to revoke the permission |
| Delete local transcripts | wipes unsaved transcripts |

No action here sends anything to the desktop.

## 7. Step-up authentication points

- App unlock (UI-174) before enabling voice.
- Enabling voice: device authentication again (proposed), so a borrowed unlocked phone cannot silently turn the microphone on. Exact mechanism UNVERIFIED (MOB-9).

## 8. Security conditions

SC-9, SC-10, SC-11, SC-16 (STT facts researched before build), SC-20, SC-25.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | reading permission/recognizer state | spinner, no toggles |
| Empty | never enabled | explanation + "Enable voice drafts" |
| Error | platform query failed | "Voice status unknown"; voice stays off |
| OFFLINE | no effect (screen is local) | — |
| STALE | n/a | — |
| UNAVAILABLE | no on-device recognizer, or release 1 build | "Voice is not available on this phone/build"; **fail closed** |
| Denied | permission refused or permanently denied | "Voice is off"; link to Android settings; no re-prompt loop |

## 10. UNVERIFIED and open

- On-device recognizer behaviour across vendors; minimum API level (D-MOB Q9).
- Whether enabling voice needs its own device-authentication step (proposed above).
