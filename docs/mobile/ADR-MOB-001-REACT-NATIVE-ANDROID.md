<!-- //TR: ADR-MOB-001 (MOB-5): UASCO Mobile Companion için Android-only React Native + TypeScript mimari kararı. Yalnızca tasarım belgesidir; kod, bağımlılık, yeni API, dinleyici veya kimlik doğrulama değişikliği yetkisi vermez. Tüm kütüphane ve sürümler UNVERIFIED'dır ve MOB-9 tarafından doğrulanacaktır. İlk sürüm salt okunurdur; PT-035 düzelmeden mobil onay yok, RESUME masaüstünde kalır. -->

# ADR-MOB-001: React Native + TypeScript for the Android-only Mobile Companion

- **Status:** PROPOSED (phase 0, docs only). Nothing in this ADR is implemented, approved or READY for coding.
- **Date:** 2026-10-20.
- **Task:** MOB-5, package MOBILE-ANDROID.
- **Authority:** `FD-2026-10-20-MOB-PHASE0.md` (docs, research, specs, ADR and test strategy for MOB-1..MOB-9, files under `docs/mobile/**` only). Scope record: `D-2026-10-20-MOBILE-ANDROID.md`, sections 4, 6, 8, 9-11.
- **What this ADR does not grant:** React Native code, `apps/mobile/` scaffolding, package files, dependencies, a new API, a network listener, an authentication change, protected-file edits, CI changes, signing keys, paid services or external accounts. Each of these needs its own FA-MOB grant (`D-2026-10-20-MOBILE-ANDROID.md` section 9). Coding waits for a separate Founder approval.
- **Version rule:** every library, tool and version named below is **UNVERIFIED**. They are research-reported (`D-2026-10-20-MOBILE-ANDROID.md` section 8), not repository evidence, and are not pinned or certified (`knowledge/technologies/react-native.json:118` requires researched and certified facets). MOB-9 verifies them in `TECH-VERSIONS.md`.
- **Related phase 0 documents (referenced by file name only; they may not have merged yet):**
  - `THREAT-MODEL.md` and `SECURITY-CONDITIONS.md` (MOB-1): the threat model and the binding form of the security conditions SC-1..SC-16.
  - `CONNECTIVITY-AND-PAIRING.md` (MOB-2): model A pairing, TLS and device sessions.
  - `API-CONTRACT.md` (MOB-3): the PROPOSED `/v1/mobile/*` read projections.
  - `APPROVAL-AND-STOP.md` (MOB-4): approval and STOP design, design-only.
  - `TEST-AND-BUILD.md` (MOB-8): test, build and release strategy.
  - `TECH-VERSIONS.md` (MOB-9): version verification.

## 1. Context

**Founder decisions this ADR must respect**

- Android-only React Native + TypeScript, under `apps/mobile/` in this repository. No iOS, Swift or Apple distribution.
- No second repository, no second backend, no second Project Memory. The phone is a client of the existing desktop Control API.
- Connectivity model **A** first: same-LAN QR pairing plus TLS. The remote target **B** (a user-managed VPN or overlay) comes later. No open tunnel and no cloud relay.
- The first release is **read-only monitoring**. No mobile approvals before PT-035 is fixed. Mobile STOP and signed approvals are evaluated separately. RESUME stays desktop-only.
- No FCM, no paid LLM and no new external account in the first release. Push and voice stay in the architecture and need their own grants.

**Current state that constrains the design** (from `D-2026-10-20-MOBILE-ANDROID.md` section 4)

- The Control API listens on `127.0.0.1` only, enforces an exact Host header and speaks plain HTTP. A phone cannot reach it as built.
- Authentication is one shared, per-launch `x-uasco-control-token` with a fixed actor `FOUNDER_LOCAL`. There is no device identity, scope, expiry or revocation.
- The backend exits when the desktop app closes, so the phone only works while the desktop app is open (open question 2).
- There is no SSE, WebSocket or change feed. Several read endpoints are unpaginated.
- Project Memory has no API (DESIGN_ONLY).
- The desktop renderer already has pure, DOM-free cores with honest-state rules: missing or 404 data is never turned into a number; it shows `—` or `UNAVAILABLE` (`apps/desktop/renderer/model.js:1`).
- Root tooling does not expect a nested app: root `tsconfig.json` includes `apps/**/*.ts`; the TR-comment and secret-sanity walkers skip `node_modules/` and `build/` only at the root; the supply-chain guards read only the root lockfile.

## 2. Decision

1. **Framework:** bare React Native CLI with TypeScript, Android only. No Expo managed workflow and no EAS (even `eas build --local` needs an Expo login, which is a new external account). Whether the Expo Modules runtime is used without EAS stays open (section 10, Q1).
2. **Location:** a self-contained `apps/mobile/` with its own `package.json`, an exact-pinned lockfile, an `.npmrc` mirroring the root one, and a nested `.gitignore` and `.gitattributes`. It is not a root npm workspace (`workspaces` is a protected field).
3. **Platform hygiene:** the template's `ios/` directory and iOS tooling are removed. The template's public debug keystore is never used for anything but local debug builds.
4. **Source types:** `.tsx`/`.js` sources only until FA-MOB-10 scopes the root `tsc` run, so a nested `.ts` file cannot break or silently enter the root typecheck. (Inferred risk; UNVERIFIED in `D-2026-10-20-MOBILE-ANDROID.md` section 13.)
5. **Tests location:** `apps/mobile/__tests__/` with `mob-` file names, never under root `tests/`, so root test discovery and sharding stay unchanged.
6. **Client role:** a thin, read-only client of the existing desktop Control API through a future TLS mobile gateway inside the same process. It holds no authority, no second store, and no desktop control token.
7. **Secure storage:** Android Keystore-backed storage for the per-device credential. Approval signing (later, not in release 1) uses a small custom Kotlin TurboModule with BiometricPrompt and a CryptoObject.
8. **Network security:** an Android Network Security Config that pins the paired desktop certificate, with cleartext allowed only in a debug-only config.
9. **Data protection:** `allowBackup=false`, `FLAG_SECURE` on all windows, and an encrypted read-only cache labelled STALE.
10. **Reuse of desktop logic:** pure renderer cores are reused either as vendored copies with a parity test, or as read-only imports. The recommended option is vendoring with a parity test (section 10, Q3).

## 3. Alternatives considered

| Option | Summary | Why not chosen |
|---|---|---|
| **Kotlin native (Jetpack Compose)** | Best Android platform fit; direct Keystore and BiometricPrompt access; no JS bridge. | The Founder fixed React Native + TypeScript. Kotlin shares no language or tooling with the repo's TypeScript/JavaScript code, so the desktop renderer's pure cores (model, approval, queue logic) and their honest-state rules would have to be rewritten and kept in sync by hand. A small Kotlin module is still used where native access is required (approval signing). |
| **Flutter (Dart)** | Strong UI toolkit; single codebase. | Same language problem as Kotlin, plus a second toolchain (Dart SDK, pub) that the supply-chain guard and knowledge registry do not cover. Contradicts the Founder's React Native choice. |
| **PWA (browser app)** | No APK, no Gradle, no store. | Needs the desktop to serve a web origin over TLS to the LAN, which is a larger listener surface. Browser storage cannot hold a non-exportable, biometric-bound Keystore key, so SC-1 and SC-4 (later approvals) cannot be met. Service-worker push implies a web push provider. Self-signed certificate pinning is not available to page code. |
| **Expo managed + EAS** | Faster setup, hosted builds. | Needs an Expo account (a new external account, forbidden in release 1) and sends builds to a hosted service. |
| **React Native bare CLI (chosen)** | TypeScript, local Gradle builds, native modules where needed. | Chosen. Costs: a Gradle/Android SDK toolchain, a nested dependency tree that needs its own governance (FA-MOB-12), and native-module upkeep. |

## 4. Module layout under `apps/mobile/` (design only)

This layout is a design target. No directory or file is created by this ADR; MOB-13 creates the scaffold only after its grants exist.

```text
apps/mobile/
  package.json            own manifest, exact pins (FA-MOB-12)
  package-lock.json       own lockfile, integrity-checked (FA-MOB-12)
  .npmrc                  mirrors the root .npmrc (ignore-scripts, registry)
  .gitignore              keystores, .gradle, local.properties, build output, google-services.json (SC-11)
  .gitattributes          line endings for gradlew / gradlew.bat
  index.js                RN entry
  src/
    app/                  App root, navigation, error boundary, lock gate
    screens/              one folder per screen ID (UI-097, UI-099, UI-102, UI-103, UI-177, UI-178, UI-180, UI-249 in release 1)
    components/           presentational components, no network access
    core/                 pure logic: state mapping, honest-state rules, formatting (vendored desktop cores + parity tests)
    api/                  typed read-only client for the mobile gateway; GET only in release 1
    session/              pairing result, device credential handle, session lifecycle
    storage/              Keystore-backed secret storage; encrypted STALE cache
    security/             screen lock, FLAG_SECURE wiring, pin-mismatch handling
    i18n/                 tr / en strings
  android/
    app/src/main/res/xml/network_security_config.xml   pinned config (release)
    app/src/debug/res/xml/network_security_config.xml  debug-only cleartext for emulator
    app/src/main/java/.../signing/                     later: Kotlin TurboModule for BiometricPrompt CryptoObject signing (not in release 1)
  __tests__/              mob-*.test.tsx unit and component tests
  e2e/                    Maestro flows (UNVERIFIED tool, MOB-8 / MOB-9)
```

**Rules**

- `screens/` and `components/` never call the network. Only `api/` does, and only through `session/`.
- `core/` has no React Native imports, so it can be tested in plain Node and compared with the desktop cores.
- No module under `apps/mobile/` writes to the Control API in release 1. Write paths (approvals, STOP, drafts) are added only by MOB-23..MOB-25 and MOB-28 under their own grants.
- Push, voice and assistant modules are not created in release 1. The layout leaves room for `src/notifications/`, `src/voice/` and `src/assistant/` later.

## 5. State, networking and secure storage

**State**

- Server state is the only source of truth. The app keeps a cache, not a store: no local edits, no merge logic, no offline queue (SC-7).
- Each screen view-model carries an explicit contract state, mirroring `CONTRACT_STATES` in `apps/desktop/renderer/model.js:2`: `VERIFIED`, `STALE`, `UNAVAILABLE`, `ERROR`, plus `OFFLINE` for network failure. Missing data renders `—` or `UNAVAILABLE`, never a number or a guess.
- Cached data is always labelled STALE with its fetch time. While the desktop is off, the phone shows only the STALE cache (UI-177, UI-249).
- State management library: kept minimal (React state and context, plus a small query/cache layer if MOB-9 verifies one). Any library choice is UNVERIFIED and deferred to MOB-9.

**Networking**

- Release 1 uses HTTPS `GET` only, to the paired desktop's mobile gateway on the LAN (model A, `CONNECTIVITY-AND-PAIRING.md`). Model B later reuses the same app-level authentication over a user-managed VPN or overlay; the app does not embed any VPN or tunnel client.
- TLS uses the desktop certificate pinned at pairing, through the Network Security Config. A pin mismatch fails closed and asks for re-pairing. Whether Network Security Config pins match IP-literal hosts is UNVERIFIED (`D-2026-10-20-MOBILE-ANDROID.md` section 13); `CONNECTIVITY-AND-PAIRING.md` decides the fallback.
- Refresh is pull-based: on screen focus, pull-to-refresh and a foreground interval. No background polling service and no FCM in release 1. A change cursor (`GET /v1/mobile/changes?since`) is PROPOSED in `API-CONTRACT.md` and used only if FA-MOB-5 grants it.
- Requests carry the per-device credential, never the desktop `x-uasco-control-token` (SC-1). `/health` is not used over the mobile listener (SC-2).
- Free text from the server (titles, reasons, PR text) is rendered as untrusted text with its provenance, never parsed as authority (SC-10).

**Secure storage**

- The per-device credential issued at pairing lives in Android Keystore-backed storage (for example react-native-keychain, UNVERIFIED). EncryptedSharedPreferences is not used (reported deprecated, UNVERIFIED).
- The STALE cache is encrypted with a Keystore-held key and can be wiped from the app (unpair) and is wiped on credential revocation.
- An app lock (device credential or biometric) gates opening the app (UI-174 spec in MOB-7). In release 1 it protects reading only; it does not sign anything.
- `allowBackup=false` keeps the credential and cache out of cloud and adb backups. `FLAG_SECURE` keeps content out of screenshots and the recent-apps view.
- Later (not release 1): approval signing with a non-exportable, biometric-bound Keystore key through a custom Kotlin TurboModule (SC-4), designed in `APPROVAL-AND-STOP.md`.

## 6. How the app consumes the desktop control-plane API (read-only)

- **No new API is created by this ADR.** The PROPOSED `/v1/mobile/*` projections are specified in `API-CONTRACT.md` (MOB-3) and need FA-MOB-5 and FA-MOB-6.
- The phone reaches the existing Control API process only through a future TLS mobile gateway inside the same process (FA-MOB-3), with per-device sessions (FA-MOB-4) and a protected mobile route allow-list (FA-MOB-6). The loopback listener and its Host check stay unchanged.
- Release 1 consumes read projections only. Their upstream sources are existing reads: `GET /v1/cockpit`, `/v1/control/status`, `/v1/projects`, `/v1/missions`, `/v1/work-runs`, `/v1/agents`, `/v1/reviews`, `/v1/evidence` (`D-2026-10-20-MOBILE-ANDROID.md` section 5). The app does not call these desktop routes directly; the gateway exposes only the allow-listed, paginated projections.
- Excluded from the phone entirely (SC-3): file content, git diff, raw logs and exports, project import, executor settings (including `GET /v1/system/executors`, which writes settings), dev-runs, journal repair, finance and legal writes, and mission creation.
- Not called in release 1: `POST /v1/missions/:id/transition`, delivery prepare/accept, `/v1/control/stop`, `/v1/control/resume`, `/v1/control/retry-blocked`. RESUME stays desktop-only regardless of later grants unless the Founder decides otherwise.
- Project Memory is not shown until the desktop/backend defines it (open question 12 of the scope record).
- The approval inbox, if later shown read-only, must come from a server-side projection, not be re-derived on the phone from client logic, so that phone and desktop cannot disagree.

## 7. Build and release outline (phase 0: no Play Store account)

Detailed strategy belongs to `TEST-AND-BUILD.md` (MOB-8). This ADR fixes only the outline.

- **Toolchain (UNVERIFIED, MOB-9):** RN 0.88.x line; JDK 17; Android minSdk 24, targetSdk 36 (compileSdk reported as 37); AGP, Gradle, Kotlin and NDK versions as reported in `D-2026-10-20-MOBILE-ANDROID.md` section 8. Node stays on the repository's Node 24.
- **Build:** local Gradle (`assembleDebug`, later `assembleRelease`). No EAS, no hosted build service. Gradle wrapper checksum and dependency verification are required (SC-12, FA-MOB-14).
- **Artifact:** an APK, sideloaded to the Founder's own device. No Play Store account, no Play internal testing and no developer account in phase 0 or release 1 (FA-MOB-20 decides any later channel).
- **Signing:** debug builds use the local debug key only. A release APK needs a Founder-held signing key (SC-15, FA-MOB-20); the template's public debug keystore is never used for release, and no signing job runs on `pull_request`.
- **CI:** none in phase 0. A mobile CI job (unit tests, lint, Android build, Maestro on an emulator) needs FA-MOB-13 and is designed in `TEST-AND-BUILD.md`. Runner pinning (for example `ubuntu-24.04`) is UNVERIFIED.
- **Repository guards first:** the root typecheck scope, walker scope and supply-chain guards (MOB-11, MOB-12, FA-MOB-10..12) must land before the first scaffold commit, so no validator is weakened (SC-13).

## 8. Consequences

**Positive**

- One language family across desktop and mobile; pure cores and honest-state rules can be shared under a parity test.
- No new backend, store or external account; the desktop stays the single control plane and authority.
- A read-only first release keeps the attack surface to authenticated, allow-listed GETs over pinned TLS.
- Android-only removes iOS toolchain, signing and store costs.

**Negative / costs**

- A Gradle and Android SDK toolchain and a nested npm dependency tree enter a repository whose guards assume one root lockfile; guard changes are protected edits (FA-MOB-10..12).
- Native-module upkeep (Keystore, later BiometricPrompt signing) and React Native upgrade cadence; RN 0.88 was only days old at research time.
- The phone works only while the desktop app runs, unless a headless mode is granted (FA-MOB-21).
- No push in release 1: users see changes only when they open or refresh the app.
- Vendored cores can drift from the desktop; the parity test must fail loudly when they do.

**Neutral**

- Push, voice and assistant stay possible in this layout but are absent until their grants exist.

## 9. Security conditions traceability

`SECURITY-CONDITIONS.md` (MOB-1) is the binding source. This ADR applies:

| Condition | Where this ADR applies it |
|---|---|
| SC-1 per-device credential, no desktop token | sections 5, 6 |
| SC-2 no listener without TLS, auth, allow-list, rate limit, audit | section 6 (gateway is a future grant) |
| SC-3 mobile allow-list exclusions | section 6 |
| SC-4 signed approvals | section 5 (later only) |
| SC-5 PT-035 before approvals | sections 1, 6 |
| SC-6 STOP / RESUME | section 6 |
| SC-7 no second store, no offline queue | section 5 |
| SC-8 push content-free | not in release 1 |
| SC-9 voice | not in release 1 |
| SC-10 free text not authority | section 5 |
| SC-11 secrets never committed, nested `.gitignore` first | section 4 |
| SC-12 dependency governance | sections 2, 7 |
| SC-13 no silent validator weakening | sections 2, 7 |
| SC-15 release signing key custody | section 7 |
| SC-16 technology knowledge researched first | version rule (header), section 7 |

## 10. Open questions

1. Bare React Native only, or bare RN plus the Expo Modules runtime (no EAS) for secure storage, local authentication and later speech? (Scope record Q16.)
2. Pin the RN 0.88.x line or the 0.87.x line? MOB-9 verifies; the Founder chooses.
3. Vendor desktop renderer cores with a parity test (recommended), or import them read-only and couple to every renderer PR? (Scope record Q21.) Whether Metro `watchFolders` can import them is UNVERIFIED.
4. Which state/query library, if any, beyond React state? Deferred to MOB-9.
5. Does Network Security Config pinning work for IP-literal LAN hosts, or does pairing need a hostname? Decided with `CONNECTIVITY-AND-PAIRING.md`.
6. Minimum Android version: is minSdk 24 acceptable, or should it be raised (for example to 31) for on-device speech and stronger Keystore guarantees later? (Scope record Q9.)
7. Foreground refresh interval for release 1, and whether a change cursor endpoint is granted (FA-MOB-5).
8. Headless or service mode on the PC (FA-MOB-21), or phone only while the desktop app is open? (Scope record Q2.)
9. Will mobile dependencies ever be installed in the supervisor or local working tree before the walker-scope fix (FA-MOB-11)? (Scope record Q20.)
10. Separate mobile CI workflow, or a job in the protected `ci.yml`, and which check becomes merge-gating? (Scope record Q18.)
11. Later distribution channel and signing-key custody (sideload only, limited distribution, or Play). (Scope record Q19.)
