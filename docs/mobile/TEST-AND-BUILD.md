<!-- //TR: MOB-8 test, derleme ve sürüm stratejisi (20 Ekim 2026): Android Mobile Companion için önerilen test yığını (Jest + RN Testing Library, KVM emülatörde Maestro, Fastify inject sözleşme testleri), ayrı ve zorunlu olmayan mobil CI işi, debug/release APK varyantları, Founder'da tutulan imza anahtarı deseni, Gradle tedarik zinciri, depo çakışma listesi, birleştirme kapısı kuralı ve ilk salt okunur sürüm stratejisi. YALNIZCA TASARIM; hiçbir şeyi etkinleştirmez, yetki vermez, sürüm sabitlemez veya sertifikalamaz. -->

# MOB-8: Test, build and release strategy (DESIGN ONLY)

> **DESIGN ONLY / NOT ENABLED / PROPOSED.** This document enables, grants, pins and certifies nothing. No mobile code, dependency, workflow, CI job, signing key, GitHub Environment or ruleset exists or is created by it. Every item below is a proposal for later packages (MOB-11..MOB-14, MOB-30), each of which needs its own Founder grant (FA-MOB-*).

- **Task:** MOB-8, under `FD-2026-10-20-MOB-PHASE0` (docs only, `docs/mobile/**`).
- **Inputs:** `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md` (sections 4, 8-10, 13-14); `docs/mobile/ADR-MOB-001-REACT-NATIVE-ANDROID.md` (MOB-5); `docs/mobile/TECH-VERSIONS.md` (MOB-9); `docs/mobile/THREAT-MODEL.md` and `docs/mobile/SECURITY-CONDITIONS.md` (MOB-1); `docs/mobile/CONNECTIVITY-AND-PAIRING.md` (MOB-2); `.github/workflows/ci.yml` and `config/validation.json` (read only).
- **Date of repository reads:** 2026-10-20, on `v7/integration` at `57f3bff`.
- **Author:** an agent (the implementer). This record does not approve itself; the independent reviewer judges it.

## 0. Status vocabulary

- **REPO:** read today from this repository; cited as `file:line`.
- **MOB-9 VERIFIED:** taken from `docs/mobile/TECH-VERSIONS.md`, which records a dated (2026-10-20) official source. Not re-checked here. MOB-9 itself says its pins go stale and must be re-checked on the day of use (`TECH-VERSIONS.md` section 6).
- **UNVERIFIED:** no official source was consulted for this document. This covers training knowledge and every action SHA, flag or tool behaviour not already in `TECH-VERSIONS.md`.
- **PROPOSED:** a design choice of this document. It binds nothing.

No external source was fetched for this document. Every external tooling fact below is either MOB-9 VERIFIED (with its MOB-9 row) or UNVERIFIED.

## 1. Founder constraints carried

From `FD-2026-10-20-MOB-PHASE0`:

- Release 1 is **read-only monitoring**. No mobile approvals before PT-035 is fixed. Mobile STOP and signed approvals are evaluated separately. RESUME stays desktop-only.
- **No FCM, no paid LLM service and no new external account** in release 1.
- Connectivity model A (same-LAN QR pairing plus TLS) first; remote target B (user-managed VPN/overlay). No open tunnel, no second backend.
- Phase 0 grants documentation only. RN code, dependency installs, new APIs, listeners, auth changes, protected-file edits, CI/ruleset changes, reseals and paid services are **not** granted.

## 2. Test stack (PROPOSED)

| Layer | Tool | Where | Version source |
|---|---|---|---|
| Unit and component | Jest + React Native Testing Library (RNTL) | `apps/mobile/__tests__/mob-*.test.tsx` | Jest 29.7.0 exact; RNTL 14.1.0 (MOB-9 rows 17-18, VERIFIED 2026-10-20) |
| End-to-end | Maestro on an Android emulator with KVM | `apps/mobile/e2e/*.yaml` | Maestro CLI 2.11.0 (MOB-9 row 19, VERIFIED 2026-10-20); license UNVERIFIED (row 19a) |
| Server contract | Vitest + Fastify `inject()` | root `tests/v7-mob-*.test.ts` | the repository's existing pattern (REPO) |

### 2.1 Unit and component tests (Jest + RNTL)

- **Location:** `apps/mobile/__tests__/` with `mob-` file names, never under root `tests/` (ADR-MOB-001 decision 5). Root test discovery stays unchanged: `tests/pkg-vs-validation-sharding.test.ts:13` lists only `tests/*.test.ts`, so files under `apps/mobile/` are neither required nor counted there (REPO).
- **Runner:** Jest 29.7.0 exact, because `@react-native/jest-preset@0.88.0` depends on Jest 29.7 parts (MOB-9 section 3.12). Root vitest is not used for mobile UI tests.
- **Renderer decision (hand-off from MOB-9 section 3.12):** RNTL 14 peers on `test-renderer ^1.0.0`, while the RN 0.88 template ships `react-test-renderer 19.3.0` (MOB-9 VERIFIED). **PROPOSED:** install the renderer RNTL 14 declares as its peer (`test-renderer`, exact-pinned at admission), and do not keep `react-test-renderer` unless a test imports it directly. If MOB-12 admission finds the peer unsatisfiable with the pinned React version, fall back to RNTL's previous major with `react-test-renderer`, and record the choice. Whether `react-test-renderer` is deprecated for React 19 is training knowledge (UNVERIFIED).
- **What units cover in release 1:** rendering of every read screen from local mock data; STALE labelling of cached data; the absence of any write control (SC-25); `FLAG_SECURE`/`allowBackup=false` are build-level and checked in section 5, not by Jest.
- **No network in unit tests:** the API client is mocked; a test helper fails any test that opens a socket. (PROPOSED.)

### 2.2 End-to-end tests (Maestro on a KVM emulator)

- **Target:** a debug APK on an x86_64 Android emulator image, on a free standard Linux runner with KVM. That standard GitHub Linux runners expose `/dev/kvm` and that a udev rule is needed to use it is **UNVERIFIED** (training knowledge).
- **Emulator setup:** a third-party emulator-runner action (for example `reactivecircus/android-emulator-runner`) or a scripted `sdkmanager` + `avdmanager` + `emulator` run. Its name, SHA, flags (`-no-window`, `-no-snapshot`, `-gpu swiftshader_indirect`, `-no-audio`) and API-level image availability are **UNVERIFIED**. PROPOSED preference: the scripted path, so no extra third-party action is admitted.
- **Maestro install:** from the vendor's GitHub release asset at the exact version, verified by a pinned SHA-256 checksum, never via a `curl | bash` installer (FA-MOB-14; MOB-9 section 3.12). The asset's checksum is not yet recorded anywhere (UNVERIFIED).
- **Release-1 flows:** launch, mock-data navigation across every read screen, unpaired state, STALE banner, and "no write control visible". No flow touches a real desktop, LAN or account.
- **Not in the first CI job:** Maestro is optional and later (MOB-14 notes). Duration on a free runner is UNVERIFIED (`D-2026-10-20-MOBILE-ANDROID.md` section 13).
- **Real devices / device farm:** out of scope; needs FA-MOB-22 (paid or account).

### 2.3 Server contract tests (Fastify inject)

- Any future `/v1/mobile/*` route (FA-MOB-5) or gateway behaviour (FA-MOB-3/4) is tested with Fastify `app.inject()` in root `tests/`, without opening a listener, exactly like the existing tests.
- **Count (REPO, 2026-10-20):** `grep -l "\.inject("` over tracked `*.ts/*.mjs/*.js` finds 34 files: **33 test files under `tests/`** (for example `tests/v7-b1-workos.test.ts`, `tests/v7-ux-reviews-api.test.ts`, `tests/v7-core-predev-crew-api.test.ts`) plus one non-test script, `scripts/workos-live-smoke.mjs`. This matches the 33 in the MOB-8 task notes.
- **Registration:** each new `tests/v7-mob-*.test.ts` must appear in exactly one vitest step of `config/validation.json`, or `tests/pkg-vs-validation-sharding.test.ts:17-25` fails (REPO). `config/validation.json` is protected (`config/protected-paths.json:41`), so registration needs FA-MOB-10.
- **Release-1 contract cases (PROPOSED, mirror SC-25 and SC-19):** every mobile route is `GET`; every non-GET to every mobile route returns 404/405; responses are bounded (pagination limit enforced); a missing or revoked device credential returns 401 and never the desktop token; the desktop `x-uasco-control-token` is rejected on mobile routes (SC-1).

## 3. Proposed mobile CI job (DESIGN ONLY, NOT ENABLED)

Nothing here is added to `.github/**`. Any workflow change needs FA-MOB-13 and is a protected edit merged outside the gate (`docs/planning/merge-gate.mjs:15`, `.github/workflows/` is in `PROTECTED_FLOOR`; `config/protected-paths.json:6`).

### 3.1 Shape

| Property | Proposal | Status |
|---|---|---|
| Placement | a **separate job** (preferably a separate workflow file, open question 18) named for example `mobile-android (ubuntu-24.04)` | PROPOSED |
| Required? | **non-required** until MOB-14 lands and the Founder adds the context (section 7) | PROPOSED |
| Runner | `ubuntu-24.04`, pinned, not `ubuntu-latest` | PROPOSED; the reason (`ubuntu-latest` → 26.04 with default JDK 25 in November 2026) is UNVERIFIED (MOB-9 row 26) |
| JDK | 17 | MOB-9 row 6 VERIFIED 2026-10-20; distribution and patch level UNVERIFIED (row 6a) |
| Node | 24, same as the existing jobs | REPO (`.github/workflows/ci.yml:30`) |
| Actions | every action pinned by full commit SHA with a version comment, like `ci.yml:25,28,45` | REPO for the existing pattern |
| Java setup | `actions/setup-java` at a pinned SHA | SHA and version **UNVERIFIED** (not recorded anywhere) |
| Gradle setup | `gradle/actions/setup-gradle` at a pinned SHA, with the basic (non-proprietary) cache provider | SHA, version and the cache-provider option name **UNVERIFIED** |
| ABIs | one ABI for CI builds, for example `-PreactNativeArchitectures=x86_64` (emulator) | property name and effect **UNVERIFIED** (training knowledge of the RN Gradle plugin) |
| Triggers | `pull_request` and `push` to `v7/integration`, like `ci.yml:4-8` | PROPOSED |
| Permissions | `contents: read` only, like `ci.yml:9-10`; no secrets; no Environment | PROPOSED |
| Concurrency | cancel stale PR runs, like `ci.yml:12-13` | PROPOSED |

### 3.2 Steps (PROPOSED order)

1. `actions/checkout` at the SHA already used (`ci.yml:25`, REPO).
2. `actions/setup-node` at the SHA already used, Node 24 (`ci.yml:28-30`, REPO).
3. Require `apps/mobile/package-lock.json`; `npm ci --ignore-scripts` inside `apps/mobile` (SC-12).
4. `npm audit` in `apps/mobile` at the level FA-MOB-12 sets.
5. `tsc --noEmit` with `apps/mobile/tsconfig.json`; Jest (section 2.1).
6. `setup-java` (JDK 17) and `setup-gradle` (basic cache).
7. Gradle wrapper validation (wrapper jar checksum) and `distributionSha256Sum` check (section 6).
8. `./gradlew assembleDebug` with the reduced ABI set and dependency verification in strict mode (section 6).
9. Upload the debug APK as a short-lived artifact (retention like `ci.yml`'s 14 days), named with the commit SHA.
10. Later and optional: a separate Maestro job (section 2.2) that downloads that APK.

### 3.3 What must not change

- **Windows shards are untouched:** `validate-windows-shard (1..3)` and the `validate (windows-latest)` aggregator (`ci.yml:52-96`) and `config/validation.json` `shardPlan` (`config/validation.json:4`) keep their steps, limits and order.
- **Linux `validate` is untouched:** the mobile job adds no step to `validate (ubuntu-latest)` (`ci.yml:15-51`).
- **No self-hosted, larger or paid runner** (`ci.yml:1`, REPO; `FD-PUBLIC-CI-2026-10-19`).
- The mobile job never needs or reads a secret on `pull_request`.

## 4. APK variants (PROPOSED)

| Variant | Signing | Built where | Purpose |
|---|---|---|---|
| `debug` | the template's local debug keystore only | developer machine; PR CI | Jest-adjacent smoke, Maestro, sideload to the Founder's own device during development |
| `release`-type, unsigned | none | PR CI (optional, open question O-3) | catch minification/R8 and release-only config errors without any key |
| `release`-type, signed | Founder-held upload/release key | protected release workflow only (section 5) | the artifact a Founder decides to distribute |

- The RN template's release build type signs with the debug key (`D-2026-10-20-MOBILE-ANDROID.md` section 8; MOB-9 section 5 item 10 keeps this UNVERIFIED). MOB-13 replaces that: the release `signingConfig` is empty unless Founder signing properties are supplied at build time from the protected Environment.
- Release builds use the release Network Security Config (no cleartext; ADR-MOB-001 decision 8). Cleartext is allowed only in a debug-only config.
- Both variants set `allowBackup=false` and `FLAG_SECURE` (ADR-MOB-001 decision 9). A build-output check reads the merged manifest to prove `allowBackup=false` (PROPOSED).

## 5. Signing pattern (PROPOSED; custody needs FA-MOB-20)

- **Key holder:** the Founder generates, holds and backs up the release/upload key (SC-15). No agent generates it, sees it or stores it.
- **Where it lives in CI:** only as secrets of a **protected GitHub Environment** (for example `mobile-release`) with a required reviewer who is the Founder. Creating the Environment is an owner action (FA-MOB-13/FA-MOB-20). Whether the Founder prefers local signing only (no CI secret at all) is open question O-4.
- **Triggers:** `workflow_dispatch` or a tag on a protected branch only. **Never `pull_request` and never `pull_request_target`.** A workflow lint check asserts this (SC-15).
- **No secret in the repository:** no keystore, `.jks`, keystore password, `local.properties` or `google-services.json` is committed. The nested `apps/mobile/.gitignore` covers them before the first scaffold commit (SC-11). Root `.gitignore:2-15` ignores none of them today (REPO), and root `.gitignore` is protected (`config/protected-paths.json:7`), so the nested file is the path that needs no protected edit.
- **Detection:** secret-sanity gains keystore and Firebase-key patterns (FA-MOB-11). Today `scripts/secret-sanity.mjs:8-11` has no such pattern (REPO).
- **Debug-key guard:** a release check fails if the signing certificate fingerprint equals the template debug keystore's fingerprint (SC-15). The `apksigner verify --print-certs` invocation is UNVERIFIED (training knowledge).
- **Logs:** the signing job never echoes secrets; keystore material is decoded to a runner temp path and deleted in an `always()` step (PROPOSED).

## 6. Gradle supply chain (PROPOSED; needs FA-MOB-12 and FA-MOB-14)

- **Version pair:** keep the RN-pinned AGP 9.2.1 / Gradle 9.4.1 and do not upgrade them independently of RN (MOB-9 section 3.7, VERIFIED 2026-10-20). Do not contradict: the latest stable values (AGP 9.4.0, Gradle 9.8.2) are recorded by MOB-9 but not recommended.
- **Wrapper checksum:** `gradle/wrapper/gradle-wrapper.properties` carries `distributionSha256Sum` for the exact distribution; CI also validates the committed wrapper jar against Gradle's published checksums. Property name and the validation action are UNVERIFIED; the checksum value is taken from `services.gradle.org` on the day of admission (MOB-12).
- **Dependency verification:** `gradle/verification-metadata.xml` with SHA-256 for every resolved artifact, generated once (`--write-verification-metadata sha256`, flag UNVERIFIED), reviewed, committed, and enforced in strict mode in CI. A missing or mismatched entry fails the build (SC-12 negative fixture).
- **Repositories:** only Google Maven, Maven Central and the Gradle plugin portal, declared explicitly. Build-time egress to `services.gradle.org`, Google Maven, Maven Central, the Android SDK/NDK hosts and the Maestro release host needs FA-MOB-14.
- **npm side:** exact pins, `ignore-scripts`, nested lockfile integrity and the `registry.npmjs.org`-only policy (`config/supply-chain-policy.json:4`, REPO) extended to `apps/mobile` by MOB-12.
- **Advisories:** MOB-9 found no npm advisory for the queried versions and consulted no advisory source for JDK, AGP, Gradle, Kotlin, NDK or Maestro (MOB-9 section 4). MOB-12 must close that gap before admission.

## 7. Merge-gating rule

- **Rule (PROPOSED, matches MOB-13/MOB-14 notes):** mobile tests gate **no** merge until MOB-14 exists and the Founder has added the mobile context.
- **Why:** the merge gate trusts exactly two contexts, `validate (ubuntu-latest)` and `validate (windows-latest)` (`docs/planning/merge-gate.mjs:10`, REPO), and only from `ci.yml` (`docs/planning/merge-gate.mjs:31`, REPO). A mobile job before MOB-14 is advisory: its result is visible but not trusted.
- **Consequence:** MOB-13 (scaffold) should land together with or after MOB-14, so mobile code is never merged with only advisory tests.
- **Until then:** root validation (typecheck, TR comments, secret-sanity, vitest) must stay green on both platforms. That is the only merge-relevant signal for any mobile-adjacent PR.

## 8. Repository collision list

Each row is a collision a naive `apps/mobile` scaffold would cause. Re-verified today at the cited line. None of these changes is made or granted here.

| # | Site (REPO, 2026-10-20) | What collides | Exact protected change it would need | Protection | Grant |
|---|---|---|---|---|---|
| C-1 | `tsconfig.json:17-22` | `include` has `apps/**/*.ts` and there is no `exclude`, so any `.ts` under `apps/mobile` enters the root `tsc` run | add `"exclude": ["apps/mobile/**"]`; the mobile tree gets its own `apps/mobile/tsconfig.json`; prove the root file count is unchanged before/after (SC-13); reseal | `config/protected-paths.json:142` | FA-MOB-10 (+ FA-MOB-1) |
| C-2 | `scripts/validate-tr-comments.mjs:5,7` | `skip` (line 5) is matched with `r.startsWith(x)` in `walk` (line 7), so `node_modules/`, `build/` etc. are skipped only at the repository root; a local install puts thousands of `//TR`-less files under `apps/mobile/node_modules` and `android/**/build` | add skips for `apps/mobile/node_modules/`, `apps/mobile/android/**/build/`, `apps/mobile/android/.gradle/`, `apps/mobile/android/**/.cxx/`; committed mobile sources stay scanned; fixture test both ways; reseal | `config/protected-paths.json:135`; `merge-gate.mjs:15` floor `scripts/validate-` | FA-MOB-11 |
| C-3 | `scripts/secret-sanity.mjs:13,16` | `ignorePrefixes` (line 13) are root-relative and `walk` (line 16) uses `rel.startsWith(x)`, so nested `node_modules` is scanned; no keystore or Firebase-key pattern exists (`:8-11`) | same nested skips as C-2; add keystore and Firebase-key patterns; a fixture secret in `apps/mobile/src/` is still detected; reseal | `config/protected-paths.json:99`; `merge-gate.mjs:27` (`CI_EXECUTED_FLOOR`) | FA-MOB-11 |
| C-4 | `scripts/supply-chain.mjs:14` | **UNVERIFIED at that path: the file does not exist.** The guard the decision record names is `automation/lib/supply-chain.mjs:14` (REPO), which reads only the root `package-lock.json`; `config/supply-chain-policy.json:4` allows only `registry.npmjs.org`; `automation/lib/change-guard.mjs:13` checks only root `package.json`/`package-lock.json` | extend supply-chain, change-guard, package-policy and audit to `apps/mobile/package.json` and `apps/mobile/package-lock.json`; add the Gradle policy (section 6); fixture lockfiles for each block case; reseal | `automation/lib/` prefix (`config/protected-paths.json:145`; `merge-gate.mjs:15`); `config/` prefix | FA-MOB-12 (+ FA-MOB-14 for Gradle hosts) |
| C-5 | `docs/planning/merge-gate.mjs:10` | `REQUIRED_CONTEXTS` has only the two `validate` contexts, so a mobile job is never merge-gating | at MOB-14 only: add the mobile context to `REQUIRED_CONTEXTS` (and the workflow to the trusted path set at `:31` if it is a separate file); extend `merge-gate.proof.mjs`; the owner updates the GitHub ruleset | `merge-gate.mjs` is not listed in `config/protected-paths.json` (grep); it is the coordinator's gate file and its change is a CI/ruleset change | FA-MOB-13 |
| C-6 | `docs/planning/merge-gate.mjs:15` | `PROTECTED_FLOOR` includes `.github/workflows/`, with no bypass, so any mobile workflow or job is a protected change | add the mobile job/workflow (section 3) as a Founder-authorised protected edit, merged outside the gate under a Founder record | `merge-gate.mjs:15`; `config/protected-paths.json:6` | FA-MOB-13 |

Related, not on the task's list but found on the same reads:

- `config/validation.json` registration of new `tests/v7-mob-*.test.ts` (section 2.3): protected (`config/protected-paths.json:41`), FA-MOB-10.
- Root `.gitignore` is protected (`config/protected-paths.json:7`); the nested `apps/mobile/.gitignore` avoids touching it (section 5).
- `.gradle`, `.kt` and Gradle Kotlin DSL files are not in the TR walker's extension set (`scripts/validate-tr-comments.mjs:4`), so they are not checked for `//TR`; committed `.json`, `.js`, `.ts(x)`, `.yml` and `.md` mobile files are, and need a `//TR` header or key. Whether to add `.kt`/`.gradle`/`.kts` is open question O-6 (FA-MOB-11).

## 9. Release strategy for the read-only first release (PROPOSED)

- **Content:** read-only monitoring only (SC-25). No approval, STOP, RESUME, retry-blocked, mission-create or draft control in the app.
- **No FCM, no push provider:** in-app refresh only; push stays in the architecture behind FA-MOB-15.
- **No paid LLM, no assistant, no voice:** behind FA-MOB-18 and FA-MOB-16/17.
- **No new external account:** no Expo/EAS, no Firebase project, no Play Console, no device farm (ADR-MOB-001 section 7).
- **Distribution:** a release-type APK, signed with the Founder-held key, **sideloaded by the Founder to their own device**. **No store publication** (Play internal testing, limited distribution or production) without a separate Founder decision (FA-MOB-20, open question 19).
- **Reproducibility:** the release APK is built from a tagged SHA by the protected release workflow; its SHA-256 and signing-certificate fingerprint are recorded next to the tag (PROPOSED; MOB-30 test).
- **Rollback:** uninstalling the app and revoking the device from the desktop (SC-26) returns the system to its pre-mobile state; the desktop control plane is unchanged for a desktop-only user.

## 10. Acceptance criteria for the first code package (MOB-11 / MOB-12), testable

These are proposals for the packages' own contracts. They do not start those packages; each still needs FA-MOB-1 plus its listed grant.

### MOB-11 (repository guards; FA-MOB-1, FA-MOB-10, FA-MOB-11)

1. **AC-11.1:** with a fixture file lacking `//TR` placed at `apps/mobile/node_modules/x/index.js` and at `apps/mobile/android/app/build/y.json`, `node scripts/validate-tr-comments.mjs` prints `TR_VALIDATION: PASS`.
2. **AC-11.2:** with a fixture `apps/mobile/src/z.tsx` lacking `//TR`, the same command exits 2 and lists that path.
3. **AC-11.3:** a fixture fake keystore marker and a fake Firebase-style key under `apps/mobile/src/` make `node scripts/secret-sanity.mjs` exit 1 with the new finding types; the same fixtures under `apps/mobile/node_modules/` do not.
4. **AC-11.4:** every pattern in `scripts/secret-sanity.mjs` before the change still fires on its existing fixture after the change (no weakening, SC-13).
5. **AC-11.5:** the set of files root `tsc` type-checks, listed before and after the `tsconfig.json` change, is identical, and a fixture `apps/mobile/src/w.ts` is not in the after-set.
6. **AC-11.6:** `tests/v7-mob-repo-guards.test.ts` exists, is registered in exactly one vitest step of `config/validation.json`, and `tests/pkg-vs-validation-sharding.test.ts` passes.
7. **AC-11.7:** the trust-root manifest is resealed in the same package, and the full validation run passes on `validate (ubuntu-latest)` and `validate (windows-latest)` with unchanged Windows shard steps.
8. **AC-11.8:** the diff touches no file under `apps/mobile/` other than test fixtures, and adds no dependency.

### MOB-12 (supply chain; FA-MOB-1, FA-MOB-12, FA-MOB-14)

1. **AC-12.1:** a fixture `apps/mobile/package-lock.json` with a non-exact version is rejected.
2. **AC-12.2:** a fixture lockfile entry without `integrity` is rejected.
3. **AC-12.3:** a fixture lockfile entry resolved from a host other than `registry.npmjs.org` is rejected.
4. **AC-12.4:** a fixture audit report with a finding at or above the agreed severity is rejected.
5. **AC-12.5:** a change to `apps/mobile/package.json` without `apps/mobile/package-lock.json` (or the reverse) is rejected by the change guard.
6. **AC-12.6:** a fixture `gradle-wrapper.properties` whose `distributionSha256Sum` does not match the fixture distribution fails the wrapper check; a matching one passes.
7. **AC-12.7:** a fixture Gradle artifact absent from `verification-metadata.xml` fails the verification check.
8. **AC-12.8:** the root lockfile checks give the same result on the unchanged root tree before and after the change.
9. **AC-12.9:** no RN dependency is added; `apps/mobile/.npmrc` template mirrors the root `.npmrc` and sets `ignore-scripts=true`.
10. **AC-12.10:** reseal recorded; full validation passes on both required contexts.

## 11. UNVERIFIED items introduced or carried here

- Action names and SHAs for `actions/setup-java`, `gradle/actions/setup-gradle`, any wrapper-validation action and any emulator-runner action.
- The setup-gradle basic cache-provider option name.
- KVM availability and the udev rule on standard GitHub Linux runners; emulator flags; emulator image availability for the chosen API level.
- `-PreactNativeArchitectures` as the RN property for reduced ABIs.
- Gradle `distributionSha256Sum`, `--write-verification-metadata sha256` and strict-mode behaviour.
- `apksigner` usage for the fingerprint check.
- Maestro release asset checksum and license (MOB-9 row 19a).
- `ubuntu-latest` → 26.04 change (MOB-9 row 26); JDK 17 distribution/patch (MOB-9 row 6a).
- CI build and emulator duration on a free runner.
- The task's `scripts/supply-chain.mjs:14` site (file absent; see C-4).

## 12. Open questions

- **O-1 (= decision record Q18):** separate workflow file or a job in the protected `ci.yml`? This document prefers a separate file, so the existing required jobs stay byte-identical. Which check name becomes merge-gating at MOB-14?
- **O-2 (= Q16):** RN 0.88.x (five days old) or 0.87.1? The test stack versions above follow MOB-9's 0.88 reading.
- **O-3:** should PR CI also build an unsigned release-type APK, or only `debug`?
- **O-4 (= Q19):** sign in CI behind a protected Environment, or sign locally on the Founder's machine only (no CI secret at all)?
- **O-5:** is Maestro in the first mobile CI package, or only after the first green `assembleDebug` job?
- **O-6:** should the TR walker add `.kt`, `.kts` and `.gradle` to its extension set when FA-MOB-11 is granted?
- **O-7:** may the supervisor or local working tree ever run `npm ci` in `apps/mobile` (Q20)? If yes, C-2 and C-3 must land before the first scaffold.
- **O-8:** which `npm audit` severity blocks: moderate+ (MOB-12 notes) or high+?
- **O-9:** the renderer choice in section 2.1: confirm `test-renderer` per RNTL 14's peer.

## 13. Hand-off

- **MOB-11 / MOB-12:** section 10 acceptance criteria; collisions C-1..C-4.
- **MOB-13:** sections 2.1, 4, 5 (nested `.gitignore`, debug-only template key); lands with or after MOB-14 (section 7).
- **MOB-14:** sections 3, 6, 7; collisions C-5, C-6.
- **MOB-30:** sections 5 and 9.
- Every version above must be re-verified on the day it is pinned (MOB-9 section 6).
