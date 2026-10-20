<!-- //TR: MOB-9 teknoloji sürüm doğrulaması (20 Ekim 2026): Android React Native yığınının her bileşeni için en son kararlı sürüm, yayın tarihi, resmi kaynak, doğrulama durumu (VERIFIED/CONFLICTING/UNVERIFIED), lisans, bakım, güvenlik bildirimi ve faz 1 önerisi. Yalnızca doküman; hiçbir sürümü sabitlemez, sertifikalamaz veya onaylamaz; knowledge/technologies/** güncellemesi ayrı yetki ister. -->

# MOB-9: Technology version verification for the RN/Android stack

- **Task:** MOB-9, under the authority of `FD-2026-10-20-MOB-PHASE0` (docs only, `docs/mobile/**`).
- **Baseline checked:** `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md`, section 8. Every baseline claim there is UNVERIFIED.
- **Research date:** 2026-10-20. Sources were consulted today through the session's agent proxy.
- **What this record is not:** it pins, certifies and approves nothing. It promotes no entry to CERTIFIED (`registries/technology-certification-policy.json`). The Founder picks the versions (open question 16 in the decision record). `knowledge/technologies/**` is not touched; updating it is a later, separately authorised step.
- **Author:** an agent (the implementer). This record does not verify itself. The independent reviewer judges it.

## 1. Method and status vocabulary

- **VERIFIED:** the fact was read today from an official source named in the row. These sources count as official:
  - npm registry metadata (`registry.npmjs.org`, which backs npmjs.com);
  - published npm tarballs of the official packages, inspected but not installed;
  - `nodejs.org`;
  - `services.gradle.org`;
  - `developer.android.com`;
  - Maven Central (`repo1.maven.org`);
  - the vendor's GitHub releases page.
- **CONFLICTING:** official sources disagree. The row cites both.
- **UNVERIFIED:** no official source was reached today, or the claim comes only from training knowledge or a third-party page.

### Reachability today

| Source | Result |
|---|---|
| `registry.npmjs.org` (metadata, tarballs, `/-/npm/v1/security/advisories/bulk`) | reached |
| `nodejs.org/dist/index.json` | reached |
| `raw.githubusercontent.com/nodejs/Release/main/schedule.json` | reached |
| `services.gradle.org/versions/current` | reached |
| `developer.android.com` (AGP release notes, Play target-SDK page, Network Security Config) | reached through WebFetch |
| `repo1.maven.org` | reached |
| `github.com/.../releases` pages | reached through WebFetch only |
| `reactnative.dev` | **not reached** (DNS failure in WebFetch; proxy 403 in curl). The 0.88 blog post is known only from its search-result URL and snippet. |
| `api.github.com` | **not reached** (session scope) |
| `dl.google.com` Maven metadata | **not reached** (proxy 403) |
| `hermes-lang.org` | **not reached** (proxy 403) |
| npmjs.com package pages | **not reached** (403) |

No dependency was installed. The two npm tarballs (`@react-native-community/template@0.88.0` and `@react-native/gradle-plugin@0.88.0`) were unpacked into a scratch directory and read only. No script from them was run.

## 2. Summary table

| # | Technology | Baseline (D-2026-10-20) | Latest stable today (date) | Status |
|---|---|---|---|---|
| 1 | React Native | 0.88.0, 2026-10-15 | 0.88.0, npm publish 2026-10-15 | VERIFIED |
| 2 | React (pinned by RN) | not stated | RN peer `^19.3.0`; template pins 19.3.0; npm latest 19.3.1 (2026-10-14) | VERIFIED |
| 3 | Hermes engine | not stated | RN 0.88.0 depends on `hermes-compiler` 260318099.0.4, which is the npm `latest-v1` dist-tag (2026-09-27); the separate `latest` tag (250829098.0.19) is the other Hermes line | VERIFIED (dist-tag layout, no version disagreement) |
| 4 | TypeScript | not stated | 7.0.2 (2026-07-08); template uses `^6.0.3` (6.0.3, 2026-04-16) | VERIFIED |
| 5 | Node (tooling) | `^22.13 \|\| ^24.3` | 24.22.0 LTS "Krypton" (2026-10-14); 26.12.0 Current (2026-10-14) | VERIFIED (engines field differs from baseline) |
| 6 | JDK | 17 | JDK 17 required by the RN Gradle plugin and by AGP 9.4.0 | VERIFIED |
| 6a | JDK 17 distribution patch level | not stated | not consulted | UNVERIFIED |
| 7 | Android Gradle Plugin | 9.2.1 | 9.4.0, stable, September 2026 (day not given); RN 0.88 pins 9.2.1 | VERIFIED (differs from latest) |
| 8 | Gradle | 9.4.1 | 9.8.2 (build time 2026-10-19); RN template wrapper uses 9.4.1 | VERIFIED (differs from latest) |
| 9 | Kotlin | 2.2.0 | RN 0.88 pins 2.2.0; latest Kotlin not consulted | UNVERIFIED (latest) |
| 10 | NDK | 27.1.12297006 | template 27.1.12297006; AGP 9.4.0 default 28.2.13676358 | VERIFIED (two official values; the template value is the one RN pins) |
| 11 | compileSdk / targetSdk / minSdk / build tools | 37 / 36 / 24 | template: 37 / 36 / 24, build tools 37.0.0 | VERIFIED |
| 12 | Google Play target-API requirement | not stated | API 36 for new apps and updates since 2026-08-31; extension possible to 2026-11-01 | VERIFIED |
| 13 | react-native-keychain | 10.0.0 | 10.0.0 (2025-03-23) | VERIFIED |
| 13a | react-native-keychain maintenance activity | not stated | no release for about 19 months; repository commit activity not reached | UNVERIFIED |
| 14 | expo-secure-store (alternative) | not stated | 58.0.2 (2026-10-01), peer `expo` | VERIFIED |
| 15 | React Navigation | not stated | `@react-navigation/native` 7.5.1 and `native-stack` 7.21.0 (2026-10-13); 8.0.0 is alpha | VERIFIED |
| 16 | react-native-screens / react-native-safe-area-context | not stated | 4.30.0 (2026-10-13) / 5.10.1 (2026-09-29) | VERIFIED |
| 17 | Jest | 29.7.0 | latest 30.5.2 (2026-09-18); `@react-native/jest-preset@0.88.0` depends on Jest 29.7 parts | VERIFIED |
| 18 | React Native Testing Library | 14.1.0 | 14.1.0 (2026-10-08); peer `test-renderer ^1.0.0` (latest 1.3.1, 2026-10-12) | VERIFIED |
| 19 | Maestro CLI | "Maestro" (no version) | 2.11.0 (2026-09-29) | VERIFIED |
| 19a | Maestro license | not stated | not reached | UNVERIFIED |
| 20 | Detox support range (RN 0.77-0.84) | claim in the baseline | not re-checked | UNVERIFIED |
| 21 | TLS pinning: Android Network Security Config | not stated | platform feature; `<pin-set>` and `<trust-anchors>` documented | VERIFIED |
| 22 | TLS pinning: react-native-ssl-public-key-pinning | not stated | 1.2.6 (2025-07-05) | VERIFIED |
| 23 | QR scanning: react-native-vision-camera | not stated | 5.2.3 (2026-08-20); peers `react-native-nitro-modules`, `react-native-nitro-image` | VERIFIED |
| 24 | QR scanning: react-native-camera-kit | not stated | 18.0.1 (2026-08-03) | VERIFIED (version) |
| 24a | react-native-camera-kit QR/barcode capability in 18.x | not stated | not read from an official source today | UNVERIFIED |
| 25 | EncryptedSharedPreferences deprecation | claim in the baseline | deprecated in `androidx.security:security-crypto` 1.1.0 (developer.android.com reference) | VERIFIED |
| 26 | CI runner: `ubuntu-latest` moves to 26.04 (default JDK 25) in November 2026 | claim in the baseline | not re-checked | UNVERIFIED |
| 27 | Security advisories, npm packages | not stated | **negative result from the npm registry advisory endpoint only**: no advisory returned for the queried versions (section 4). This is not proof that no vulnerability exists, and covers no non-npm component | VERIFIED (npm registry only) |
| 28 | Advisory history of `@react-native-community/cli` (dev-server command injection, CVE-2025-11953) | not stated | known from training knowledge only; the npm bulk query did not confirm it | UNVERIFIED |
| 29 | FCM (Firebase Cloud Messaging). **NOT in release 1** (Founder: no FCM; push needs a separate grant, FA-MOB-15) | baseline: needs a Firebase project, `google-services.json` and an HTTP v1 credential | official Firebase docs (`firebase.google.com`) not reached (proxy refused). Community RN binding `@react-native-firebase/messaging` 27.0.0 (2026-10-19, Apache-2.0) on npm; not an official Google source | UNVERIFIED |
| 30 | UnifiedPush Android connector. **NOT in release 1** (push needs a separate grant, FA-MOB-15) | not stated | `org.unifiedpush.android:connector` 3.3.5 on Maven Central (lastUpdated 2026-08-22); `unifiedpush.org` not reached | VERIFIED (Maven Central version only) |
| 30a | UnifiedPush React Native binding. **NOT in release 1** | baseline: "no maintained RN binding was found" | not re-checked against an official source | UNVERIFIED |
| 31 | Android SpeechRecognizer. **NOT in release 1** (voice needs a separate grant, FA-MOB-16/FA-MOB-17) | baseline: may stream audio to remote servers; on-device recognizer from API 31 | developer.android.com reference: "likely to stream audio to remote servers"; `createOnDeviceSpeechRecognizer` and `isOnDeviceRecognitionAvailable` added in API 31; needs `RECORD_AUDIO` | VERIFIED |

### Counts

| Status | Rows |
|---|---|
| VERIFIED | 24 (rows 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 27, 31) |
| VERIFIED (version only) | 2 (row 24, whose capability is row 24a; row 30, whose RN binding is row 30a) |
| CONFLICTING | 0 |
| UNVERIFIED | 10 (rows 6a, 9, 13a, 19a, 20, 24a, 26, 28, 29, 30a) |

Totals: **26 VERIFIED** (rows 24 and 30 included), **0 CONFLICTING**, **10 UNVERIFIED**, 36 rows.

## 3. Per-technology detail

### 3.1 React Native

- **Latest stable:** 0.88.0. npm `dist-tags.latest` = 0.88.0, published 2026-10-15T14:08:56Z. `next` = 0.88.0-rc.6 (2026-10-14).
- **Release-date note:** the official blog URL found by search is `https://reactnative.dev/blog/2026/10/19/react-native-0.88`, dated 2026-10-19. That is the announcement, four days after the npm publish. The page itself was not reachable, so its contents (React 19.3.0, Metro 0.87, "no user-facing breaking changes") stay UNVERIFIED beyond the npm metadata.
- **Sources:**
  - https://registry.npmjs.org/react-native
  - https://registry.npmjs.org/@react-native-community/template (`latest` 0.88.0, 2026-10-15T14:01:39Z)
- **Support window:** the previous stable lines carry dist-tags on the template package: `0.86-stable` = 0.86.3, `0.83-stable` = 0.83.10. The baseline says the previous line is 0.87.1, but no `0.87-stable` tag exists on the template package. The current support policy (`reactnative.dev/versions`) was not reached, so it is UNVERIFIED.
- **License / maintenance:** MIT (npm). Actively released: the npm document was modified 2026-10-20.
- **Engines:** `node: "^22.13.0 || ^24.3.0 || >= 26.0.0"`. **Difference from baseline:** the baseline omits `>= 26.0.0`.
- **Advisories:** none in the npm advisory DB for 0.88.0 or 0.87.1 (section 4).
- **Phase-1 recommendation:** pin **0.88.0 exactly**, or its first patch release if one exists when MOB-13 starts.
  - It is the only line whose template matches the current Play target (API 36) and compileSdk 37.
  - Risk: it is five days old at npm publish and has no patch release yet. If the Founder prefers maturity, the fallback is the newest patch of the previous supported line. Its Android levels must be re-checked before choosing it, because the 0.86/0.87 template values were not consulted today.

### 3.2 React (version RN pins)

- **Values:**
  - `react-native@0.88.0` peer `react: ^19.3.0`, `@types/react: ^19.1.1`;
  - the 0.88.0 template pins `react: 19.3.0` and `react-test-renderer: 19.3.0`;
  - npm `latest` for `react` = 19.3.1 (2026-10-14).
- **Source:** https://registry.npmjs.org/react
- **License:** MIT.
- **Advisories:** none for 19.3.0 or 19.3.1 in the npm DB.
- **Phase-1 recommendation:** use the exact version the RN template pins (19.3.0), or 19.3.1 if the RN 0.88 patch notes accept it. Do not float `^19`.

### 3.3 Hermes

- **Facts (npm):**
  - `react-native@0.88.0` depends on `hermes-compiler: 260318099.0.4`;
  - the `hermes-compiler` npm dist-tags are `latest` = 250829098.0.19 (2026-09-07), **`latest-v1` = 260318099.0.4 (2026-09-27)**, `latest-v0` = 0.17.0 (2026-05-05) and `nightly`;
  - the template sets `hermesEnabled=true` and `newArchEnabled=true` in `android/gradle.properties`.
- **Status: VERIFIED (re-labelled from CONFLICTING).** There is no version disagreement. The package publishes parallel lines under separate dist-tags, and the version RN 0.88.0 pins is exactly the `latest-v1` tag. The plain `latest` tag points at another line, so "npm latest" is the wrong question for Hermes. What distinguishes the lines (for example "Hermes V1" vs the legacy engine) is described in the official Hermes release notes (`hermes-lang.org`, `github.com/facebook/hermes`), which were not reachable; that description stays UNVERIFIED.
- **License:** MIT (npm).
- **Phase-1 recommendation:** do not pick Hermes on its own. Use exactly the Hermes that the chosen RN version bundles, with Hermes enabled (the template default). Never take the `hermes-compiler` `latest` tag; if Hermes is ever pinned on its own, use the `latest-v1` line that RN pins.

### 3.4 TypeScript

- **Values:**
  - npm `latest` = 7.0.2 (2026-07-08); `next` = 7.1.0-dev.20261020.3;
  - the newest 6.x is 6.0.3 (2026-04-16);
  - the RN 0.88 template uses `typescript: ^6.0.3` with `@react-native/typescript-config@0.88.0`;
  - the repository root pins `typescript: 5.9.3` (`package.json:49`).
- **Source:** https://registry.npmjs.org/typescript
- **License:** Apache-2.0.
- **Advisories:** none for 6.0.3 or 7.0.2.
- **Phase-1 recommendation:** pin **6.0.3 exactly** inside `apps/mobile` only, following the template. TypeScript 7 compatibility with `@react-native/typescript-config` and the RN Babel/Metro toolchain is UNVERIFIED. The mobile workspace TypeScript must not change the root 5.9.3 pin; that separation is MOB-11's scope (FA-MOB-10).

### 3.5 Node (tooling)

- **Releases:**
  - 24.22.0 LTS "Krypton" (2026-10-14);
  - 22.23.3 LTS "Jod" (2026-09-23);
  - 26.12.0 Current (2026-10-14).
- **Schedule:**
  - Node 24 enters maintenance on **2026-10-20 (today)**; end of life 2028-04-30;
  - Node 26 becomes LTS on 2026-10-28; end of life 2029-04-30;
  - Node 22 end of life 2027-04-30.
- **Sources:**
  - https://nodejs.org/dist/index.json
  - https://raw.githubusercontent.com/nodejs/Release/main/schedule.json (the official Node.js Release working-group repository)
- **Compatibility:** RN 0.88.0 accepts `^22.13.0 || ^24.3.0 || >= 26.0.0`. The template's own `engines` is `>= 22.11.0`. The repository requires `node >= 24` (`package.json:8`).
- **Phase-1 recommendation:** keep **Node 24 LTS** (latest patch, 24.22.0 today), matching the repository and CI. Re-evaluate Node 26 after it reaches LTS on 2026-10-28.

### 3.6 JDK

- **Facts:**
  - the `@react-native/gradle-plugin@0.88.0` sources use `jvmToolchain(17)` (6 occurrences) and `JavaVersion.VERSION_17`;
  - AGP 9.4.0 lists JDK minimum 17 and default 17.
- **Sources:**
  - https://registry.npmjs.org/@react-native/gradle-plugin/-/gradle-plugin-0.88.0.tgz (inspected)
  - https://developer.android.com/build/releases/gradle-plugin
- **Not reached:** the RN environment-setup page (`reactnative.dev/docs/set-up-your-environment`). Its JDK recommendation is UNVERIFIED.
- **Phase-1 recommendation:** JDK 17 (a current Temurin or other OpenJDK 17 build). The exact patch level and distribution are UNVERIFIED and must be pinned by MOB-12/MOB-14 with checksums.

### 3.7 Android Gradle Plugin and Gradle

- **AGP:**
  - latest stable **9.4.0** (September 2026, day not stated); 9.5 is in preview;
  - AGP 9.4.0 requires Gradle ≥ 9.6.0, JDK 17 and SDK Build Tools ≥ 36.0.0; default NDK 28.2.13676358; max API level 37.
  - Source: https://developer.android.com/build/releases/gradle-plugin
- **What RN 0.88 pins:** `agp = "9.2.1"` and `kotlin = "2.2.0"` in the plugin's `gradle/libs.versions.toml`.
- **Gradle:**
  - latest current release **9.8.2** (build time 2026-10-19T16:29:26Z);
  - the RN 0.88 template wrapper is `gradle-9.4.1-bin.zip`.
  - Source: https://services.gradle.org/versions/current
- **Differences from baseline:** the baseline values (AGP 9.2.1, Gradle 9.4.1) are correct for the RN 0.88 template, but neither is the latest stable. Moving to AGP 9.4.0 forces Gradle ≥ 9.6.0.
- **License:** not consulted today (UNVERIFIED).
- **Advisories:** none looked up (no npm DB coverage; no official advisory source reached).
- **Phase-1 recommendation:** keep the **RN-pinned pair (AGP 9.2.1, Gradle 9.4.1)**, because the RN Gradle plugin is tested against it. Do not upgrade AGP or Gradle independently of RN. Gradle dependency verification and the wrapper checksum stay with MOB-12/FA-MOB-14.

### 3.8 Kotlin and NDK

- **Kotlin:** RN 0.88 pins 2.2.0. The latest Kotlin release was not consulted (UNVERIFIED). Recommendation: use the RN-pinned 2.2.0.
- **NDK:** the template uses `27.1.12297006`; the AGP 9.4.0 default is `28.2.13676358`. Recommendation: use the template value, which ships with the chosen RN version.

### 3.9 SDK levels and the Google Play target-API requirement

- **Template values** (`android/build.gradle` of `@react-native-community/template@0.88.0`): `minSdkVersion = 24`, `compileSdkVersion = 37`, `targetSdkVersion = 36`, `buildToolsVersion = "37.0.0"`.
- **Google Play rule** (https://developer.android.com/google/play/requirements/target-sdk, last updated 2026-10-16):
  > "New apps and app updates must target Android 16 (API level 36) or higher to be submitted to Google Play"

  This applies from 2026-08-31, except Wear OS and Android Automotive OS (API 35) and Android TV and Android XR (API 34). An extension to 2026-11-01 can be requested.
- **Not checked:** the Play Console Help article and the 2027 requirement.
- **Phase-1 recommendation:**
  - **targetSdk 36**, which meets the current Play rule even though phase 1 is not distributed through Play (FA-MOB-20);
  - **compileSdk 37**, as the template sets;
  - **minSdk 24**, as the template sets; the decision record allows raising it.
  - Note for MOB-1/MOB-5: an on-device speech recognizer exists from API 31 (VERIFIED, row 31), so a higher minSdk may be preferable for F7. That decision belongs to MOB-5, not to this record.

### 3.10 Secure storage

- **react-native-keychain:**
  - **10.0.0** (2025-03-23). The npm document was last modified the same day, so there has been no release since.
  - The GitHub releases page (via WebFetch) shows v10.0.0 as "Latest", after v9.2.3 and v9.2.2. The v10.0.0 notes say the FacebookConceal dependency is deprecated and no longer maintained.
  - License MIT. No advisories in the npm DB for 9.2.3 or 10.0.0.
  - Sources: https://registry.npmjs.org/react-native-keychain and https://github.com/oblador/react-native-keychain/releases
  - **Maintenance:** about 19 months without a release. Repository commit and issue activity was not reachable (UNVERIFIED). Compatibility with RN 0.88 / New Architecture is UNVERIFIED.
- **expo-secure-store:** 58.0.2 (2026-10-01), MIT, peer `expo: *`. It requires the Expo Modules runtime, which is the open "bare RN vs bare RN + Expo Modules (no EAS)" question (decision record, question 16).
- **Not suitable as a secret store:** react-native-mmkv 4.3.2 (2026-06-22) is a fast key-value store, not a Keystore-backed secret store.
- **Phase-1 recommendation:**
  - Phase 1 is read-only, but pairing still needs secure storage for session credentials.
  - Prefer a **small first-party Kotlin TurboModule over Android Keystore** (AES-GCM key, non-exportable, optionally `setUserAuthenticationRequired` with BiometricPrompt). The decision record already expects this module for approval signing, and one native module can serve both uses.
  - Keep react-native-keychain 10.0.0 as the candidate only if MOB-5 confirms New Architecture compatibility and acceptable maintenance.
  - Choose expo-secure-store only if the Founder admits the Expo Modules runtime.

### 3.11 Navigation

- **Versions:**
  - `@react-navigation/native` **7.5.1** (2026-10-13), MIT, peer `react >= 18.2.0`;
  - `@react-navigation/native-stack` **7.21.0** (2026-10-13), peers `react-native-screens >= 4.0.0` and `react-native-safe-area-context >= 4.0.0`;
  - `react-native-screens` 4.30.0 (2026-10-13);
  - `react-native-safe-area-context` 5.10.1 (2026-09-29); the template ships `^5.5.2`.
- **Pre-release:** v8 is `8.0.0-alpha.51` (do not use).
- **Advisories:** none for these versions.
- **Sources:** https://registry.npmjs.org/@react-navigation/native, https://registry.npmjs.org/@react-navigation/native-stack
- **Phase-1 recommendation:** React Navigation 7 with native-stack, all exact pins. Phase 1 has only a few read screens.

### 3.12 Test stack

- **Jest:**
  - npm `latest` 30.5.2 (2026-09-18);
  - `@react-native/jest-preset@0.88.0` depends on `babel-jest ^29.7.0`, `jest-environment-node ^29.7.0` and `@jest/create-cache-key-function ^29.7.0`;
  - the template uses `jest: ^29.6.3`.
  - The baseline's "pin Jest 29.7.0 because the preset depends on Jest 29" is consistent with these facts.
  - Recommendation: **Jest 29.7.0 exact** in `apps/mobile`.
- **React Native Testing Library:**
  - **14.1.0** (2026-10-08); peers `jest >= 29.0.0`, `react >= 19.0.0`, `react-native >= 0.78`, `test-renderer ^1.0.0`; engines `node ^22.13.0 || >=24`.
  - **Difference from the template:** RNTL 14 peers on `test-renderer` (latest 1.3.1, 2026-10-12), while the template ships `react-test-renderer 19.3.0`. MOB-8 must resolve which renderer is installed.
- **Maestro:**
  - CLI **2.11.0** (tag `cli-2.11.0`, 29 Sep, before it 2.10.0 on 31 Aug and 2.9.0 on 26 Aug). Source: https://github.com/mobile-dev-inc/maestro/releases. The page shows no year.
  - Maven Central `dev.mobile:maestro-client` has `latest`/`release` 2.11.0 with `lastUpdated` 20260929134828, which confirms the year 2026. Source: https://repo1.maven.org/maven2/dev/mobile/maestro-client/maven-metadata.xml
  - License: not reached (UNVERIFIED).
  - Recommendation: Maestro 2.11.0 exact on a KVM emulator, with the release asset checksum pinned (FA-MOB-14).
- **Detox:** the claim that it supports only RN 0.77-0.84 was not re-checked (UNVERIFIED). It does not affect the recommendation.

### 3.13 TLS and certificate pinning

- **Android Network Security Config** (https://developer.android.com/privacy-and-security/security-config):
  - a declarative XML resource with `<pin-set>` (SPKI SHA-256 pins, optional `expiration`, backup pin recommended) and `<trust-anchors>` (bundled self-signed or non-public CA);
  - certificate transparency is opt-in at API 36 and default from API 37.
  - The page does not state the minimum API level (UNVERIFIED here).
- **react-native-ssl-public-key-pinning:** 1.2.6 (2025-07-05), MIT, no npm advisories. Its Android mechanism (OkHttp `CertificatePinner`) is not confirmed from an official source today (UNVERIFIED).
- **Design constraint for MOB-2/MOB-5:**
  - Connectivity model A pins a **per-host self-signed certificate learned at QR pairing time**.
  - Network Security Config is fixed at build time, so it cannot hold a pin that is only known after pairing.
  - A plain `CertificatePinner` alone also fails, because platform chain validation rejects the self-signed leaf before the pin is checked.
- **Phase-1 recommendation:**
  - Use a **small first-party Kotlin module** with an OkHttp client and a custom `X509TrustManager` that accepts exactly the paired SPKI hash, stored in Keystore-protected storage. RN's own networking is backed by OkHttp; that is UNVERIFIED today.
  - Set the Network Security Config to `cleartextTrafficPermitted="false"` with no user CAs.
  - Do not add the third-party pinning library unless MOB-5 shows it can pin a runtime-provided self-signed SPKI.

### 3.14 QR scanning

- **react-native-vision-camera:** **5.2.3** (2026-08-20), MIT. Peers are `react-native-nitro-modules` (latest 0.37.1, 2026-08-27) and `react-native-nitro-image`, so it brings an extra native runtime into the dependency tree. No npm advisories.
- **react-native-camera-kit:** **18.0.1** (2026-08-03), MIT, peers only `react` and `react-native`. No npm advisories. Its QR/barcode capability in 18.x was not read from an official source today (UNVERIFIED).
- **Phase-1 recommendation:** pairing needs only a one-shot QR read with the CAMERA permission.
  - Prefer the library with the smaller native footprint (camera-kit), after MOB-5 confirms its 18.x QR support and New Architecture compatibility.
  - Use vision-camera 5.x only if Nitro modules are admitted under FA-MOB-12.
  - Either way, the scanned payload is untrusted input and must be validated by the pairing protocol (MOB-2).

### 3.15 Push, voice and storage facts outside release 1

None of these is in release 1. The Founder decided no FCM in the first release; push (FA-MOB-15) and voice (FA-MOB-16, FA-MOB-17) each need a separate grant. They are recorded here only so the task's coverage list is complete.

- **FCM (row 29, UNVERIFIED):**
  - The official Firebase documentation (`https://firebase.google.com/docs/cloud-messaging`) was not reachable: the agent proxy refused the connection. The baseline's requirements (Firebase project, `google-services.json`, HTTP v1 service credential) stay UNVERIFIED.
  - npm shows the community binding `@react-native-firebase/messaging` 27.0.0 (2026-10-19, Apache-2.0; https://registry.npmjs.org/@react-native-firebase/messaging). It is not a Google source and does not verify FCM itself.
- **UnifiedPush (rows 30 and 30a):**
  - Android connector: `org.unifiedpush.android:connector` 3.3.5, Maven Central `latest`/`release`, lastUpdated 2026-08-22 (https://repo1.maven.org/maven2/org/unifiedpush/android/connector/maven-metadata.xml). VERIFIED for the version only.
  - `https://unifiedpush.org` was not reachable, so the project's own library list and any React Native binding stay UNVERIFIED.
- **Android SpeechRecognizer (row 31, VERIFIED):** source https://developer.android.com/reference/android/speech/SpeechRecognizer.
  - The page says: "The implementation of this API is likely to stream audio to remote servers to perform speech recognition."
  - It also says the app "must have Manifest.permission.RECORD_AUDIO permission to use this class".
  - `createOnDeviceSpeechRecognizer` and `isOnDeviceRecognitionAvailable` were added in API level 31.
- **EncryptedSharedPreferences (row 25, VERIFIED):** source https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences.
  - The page says: "Artifact: androidx.security:security-crypto … Added in 1.0.0 Deprecated in 1.1.0 … This class is deprecated. Use android.content.SharedPreferences instead."
  - This supports the baseline's advice not to use it for secrets. Section 3.10 already recommends Android Keystore.

## 4. Security advisories

**Scope of this result:** everything below is a **negative result from the npm registry advisory endpoint only**. It is not proof that no vulnerability exists. It does not cover any non-npm component (JDK, AGP, Gradle, Kotlin, NDK, Hermes native code, Maestro, Android platform).


- **Query:** `POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` (npm's advisory DB, mirrored from the GitHub Advisory Database). It returned **no advisories** for:
  - react-native 0.88.0 and 0.87.1;
  - react 19.3.0 and 19.3.1;
  - typescript 6.0.3 and 7.0.2;
  - react-native-keychain 9.2.3 and 10.0.0;
  - @react-navigation/native 7.5.1 and native-stack 7.21.0;
  - react-native-screens 4.30.0;
  - react-native-safe-area-context 5.5.2 and 5.10.1;
  - jest 29.7.0 and 30.5.2;
  - @testing-library/react-native 14.1.0;
  - react-native-vision-camera 5.2.3 and react-native-camera-kit 18.0.1;
  - react-native-nitro-modules 0.37.1;
  - react-native-ssl-public-key-pinning 1.2.6;
  - hermes-compiler 260318099.0.4;
  - @react-native-community/cli 20.2.0.
- **Control query:** the same endpoint returned the known advisories for `lodash@4.17.15`, so the endpoint works.
- **Gap (UNVERIFIED):** training knowledge records a 2025 command-injection advisory in the RN CLI dev server (`@react-native-community/cli-server-api`, CVE-2025-11953). The bulk query for `@react-native-community/cli-server-api@15.0.0` returned nothing, so this record neither confirms nor rules it out. MOB-12 must check the GitHub Advisory Database directly before admitting any CLI version. Independently, the Metro dev server must never listen beyond loopback in this project.
- **No advisory source was consulted** for JDK, AGP, Gradle, Kotlin, NDK, Hermes native code or Maestro (UNVERIFIED).

## 5. Differences from the D-2026-10-20-MOBILE-ANDROID baseline

1. **RN engines:** the baseline gives Node `^22.13 || ^24.3`; npm shows `^22.13.0 || ^24.3.0 || >= 26.0.0`. The template's own `engines` is `>= 22.11.0`.
2. **RN 0.87.1 as the "previous line":** no `0.87-stable` dist-tag exists on the template package; the tagged previous lines are `0.86-stable` (0.86.3) and `0.83-stable` (0.83.10). The 0.87 support status is UNVERIFIED.
3. **RN release date:** npm publish is 2026-10-15 (matches the baseline); the official blog URL is dated 2026-10-19.
4. **AGP 9.2.1 / Gradle 9.4.1:** correct as RN-pinned values, but the latest stable are AGP 9.4.0 and Gradle 9.8.2.
5. **NDK:** the template has 27.1.12297006 (matches the baseline); the AGP 9.4.0 default is 28.2.13676358.
6. **Hermes:** not in the baseline. The version RN pins is the npm `latest-v1` dist-tag, not `latest` (row 3).
7. **TypeScript:** not in the baseline. The template uses 6.0.x, npm `latest` is 7.0.2, and the repository root is on 5.9.3.
8. **RNTL 14.1.0:** peers on `test-renderer ^1.0.0`, while the template ships `react-test-renderer`.
9. **react-native-keychain 10.0.0:** the version matches the baseline, but its last release is 2025-03-23. The baseline does not note this maintenance gap.
10. **Claims not re-verified today (stay UNVERIFIED):** the template ships `ios/` and a public `debug.keystore`; the Detox 0.77-0.84 range; the `ubuntu-latest` → 26.04 change; the UnifiedPush RN binding gap; the FCM requirements; the WorkManager 15-minute minimum. Now VERIFIED today: the EncryptedSharedPreferences deprecation (row 25) and the SpeechRecognizer remote-streaming warning and API 31 on-device recognizer (row 31). The template's `android/` contents were read, but `ios/` and keystore files were not inspected.

## 6. Hand-off

- **MOB-5 (ADR):** decides the native-module approach for secure storage, pinning and approval signing (sections 3.10 and 3.13), and the QR library (section 3.14).
- **MOB-8 (test/build/release strategy):** decides the Jest/RNTL renderer question (section 3.12).
- **MOB-12 (supply chain):** must re-verify every pinned version and checksum at admission time, and must close the UNVERIFIED rows in section 2. This record goes stale; any pin taken from it must be re-checked on the day it is used.
- **Knowledge registry:** updating `knowledge/technologies/**` from this record needs separate authority.
