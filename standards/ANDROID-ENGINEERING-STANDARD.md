<!-- //TR: Bu dosya Android engineer/architect/SDET rollerinin Kotlin, Java, Gradle, Jetpack Compose, coroutines, storage, networking, testing, performance, security ve release bilgisini şirket standardı olarak tanımlar. -->
# Android Engineering Standard

Required technical areas:
- Kotlin + Java interoperability; null safety, generics, sealed models and idiomatic APIs.
- Gradle/AGP/Kotlin DSL, modules, variants/flavors, version catalogs, dependency governance, R8/ProGuard.
- Android lifecycle, process death, saved state, configuration changes, intents, permissions, storage, background limits, deep links/app links and notifications.
- AndroidX/Jetpack: Lifecycle, ViewModel, SavedStateHandle, Navigation, Room, DataStore, WorkManager and project-required libraries.
- Jetpack Compose: state/hoisting, recomposition, remember/rememberSaveable, side effects, Flow integration, Material, adaptive UI, semantics/a11y, UI tests and performance.
- Coroutines/Flow: structured concurrency, dispatchers, cancellation, supervision, StateFlow/SharedFlow and lifecycle-aware collection.
- Networking: OkHttp/Retrofit or project-equivalent, serialization, auth refresh, timeout/retry, TLS/pinning policy, cache/offline/error contracts.
- DI: Hilt/Dagger or project-selected equivalent.
- Tests: JUnit, MockK/Mockito, Robolectric, Espresso, Compose UI Test, UiAutomator, Appium, screenshot/visual, API contract, accessibility.
- Quality: Android Lint, Detekt/ktlint as selected, dependency/SBOM/secret checks.
- Performance: startup/frame/jank, macrobenchmark, baseline profiles, CPU/memory/network/battery where relevant.
- Release: APK/AAB, signing, Play tracks, versioning, mapping/symbol artifacts, staged rollout and rollback.

Technology choice is not hard-coded. Native/Flutter/React Native decisions follow Project Genome + Technology Council evidence.
