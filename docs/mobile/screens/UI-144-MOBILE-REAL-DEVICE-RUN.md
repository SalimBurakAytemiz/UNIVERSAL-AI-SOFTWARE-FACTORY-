<!-- //TR: MOB-7 ekran spesifikasyonu UI-144 Mobil Gerçek Cihaz Koşusu (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): yalnız laboratuvar ekranıdır; FA-MOB-22 verilmedikçe v1 kapsamı dışındadır; ücretli cihaz çiftliği veya yeni harici hesap kullanılmaz; hiçbir onay, STOP veya üretim eylemi içermez. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-144 Mobile real-device run (DESIGN ONLY / NOT ENABLED, LAB ONLY)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change, dependency or paid service. **Lab-only. Out of v1 unless FA-MOB-22 is granted.**

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** / **UNVERIFIED** as in UI-098.

## 1. Purpose and target function

- A lab view of test runs of the Companion on a physical Android device (or a device farm), listing device, build, suite and result.
- Target: F-LAB-02 Mobile Device Lab, AUTHORITY_REQUIRED and NOT_DELIVERABLE (`MASTER_WORK_INVENTORY.md:126` per D-MOB `:78`); inventory row `SCREEN_AUDIT_252.csv:145` ("needs real mobile devices").
- It is a test-evidence viewer, not a control surface for the factory.

## 2. Release and gating

| Item | Value |
|---|---|
| Release | **Out of v1** unless FA-MOB-22 is granted (D-MOB Q14 open). |
| Default test path | Maestro on a KVM **emulator** in CI; real devices and device farms are out of scope (`TEST-AND-BUILD.md` 2.2, `:53`) |
| Build package | MOB-31 |

No CI job runs real-device tests. Any device run is lab-only, gated by FA-MOB-22, and outside merge gating (`TEST-AND-BUILD.md` sections 2.2 and 7).

## 3. Authority dependency

FA-MOB-22 (physical-device or paid device-farm testing). Showing results inside the phone app would also need FA-MOB-5 and FA-MOB-6 for a read route; a CI-side report needs FA-MOB-13 and FA-MOB-19. A paid farm or new account is excluded in the first release by the Founder decision. None granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| Real-device run records | **none exist**; no route, store or runner | `SCREEN_AUDIT_252.csv:145` |
| Mobile read route for lab runs | **PROPOSED, not in MOB-3** (MOB-3 lists no lab route) | MOB-3 section 4 |
| Maestro emulator results | PROPOSED CI artefacts, not served by the Control API | `TEST-AND-BUILD.md` 2.2, 3 |

No field below can be filled today; every one renders `—` until a granted source exists.

## 5. Fields (per run)

| Field | Notes |
|---|---|
| Device model, Android API level | from the lab record; `—` if missing |
| Device kind | `PHYSICAL`, `EMULATOR`, `FARM` |
| App build | variant and commit SHA |
| Suite | Maestro flow name |
| Result | `PASS`, `FAIL`, `UNVERIFIED`; never inferred from absence |
| Evidence | digest reference only; no screenshots of real data, no logs on the phone (SC-3) |
| Started / finished | lab clock, labelled as such |

## 6. Actions

- Refresh (read only).
- No "start run", "install build", "pair farm account" or any approval, STOP or production action on the phone.

## 7. Step-up authentication points

- App unlock (UI-174) only. The screen cannot act, so no further step-up.

## 8. Security conditions

SC-3, SC-7, SC-11 (no farm credentials or keystores committed), SC-15 (release signing key never on a lab device), SC-19, SC-20, SC-25.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | fetch | skeleton |
| Empty | no runs recorded | "No real-device runs" |
| Error | source failure | `—` plus fixed code |
| OFFLINE | network down | cached list greyed |
| STALE | cached | STALE badge with age |
| UNAVAILABLE | FA-MOB-22 not granted (**default state**) | "Lab only — not part of this release" |
| Denied | 403/404 route not allow-listed; 401 `DEVICE_REVOKED` | fixed text |

## 10. UNVERIFIED and open

- Whether UI-144 is in scope at all, and whether physical devices or a paid farm may be used (D-MOB Q14).
- Where lab results would be stored without a second store (SC-7).
