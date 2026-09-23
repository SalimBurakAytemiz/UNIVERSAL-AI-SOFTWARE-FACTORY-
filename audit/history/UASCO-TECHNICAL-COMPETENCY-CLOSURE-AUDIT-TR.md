<!-- //TR: Bu dosya UASCO fresh canonical starter ve Ultimate Architecture Closure Spec içinde agent rollerinin isim olarak kayıtlı olmasına rağmen teknik bilgi/skill/playbook seviyesinde eksik kalan ayrıntıları kapatmak için hazırlanmıştır. -->
# UASCO — Technical Competency Closure Audit

## 1. Denetim sonucu

Mevcut fresh starter'da:
- `096 API Test` agent rolü VAR.
- `035 Backend Service Engineer`, `036 REST API Engineer` VAR.
- `051 Android Engineer`, `090 Android Mobile App Test`, `113 Mobile Automation`, `115 Android Development in Test` VAR.
- `postman-newman` tool adapter VAR ama `NOT_IMPLEMENTED`.
- `appium`, `adb`, `uiautomator2` VAR ama `NOT_IMPLEMENTED`.
- Java/Kotlin toolchain VAR: `java`, `maven`, `gradle`, `junit`.
- Android native toolchain VAR: `android-sdk`, `adb`.
- Jetpack Compose açık first-class skill olarak YOK.
- Ajv açık first-class skill/tool/recipe olarak YOK.
- OpenAPI/JSON-Schema inference + strict response validation recipe YOK.
- Espresso / Compose UI Test / Robolectric / Android Lint / Detekt / ktlint gibi Android test/quality toolchain'leri açık kayıtlı değil.
- Agent rollerinin her biri için teknik competency/skill matrix'i YOK.

Sonuç:
**Agent katalogu organizasyon şemasını tanımlıyor; fakat "bu agent tam olarak hangi teknolojileri ne seviyede bilir ve hangi işi hangi standartla yapar?" katmanı henüz tamamlanmış değil.**

Bu, final ZIP öncesi kapanması gereken gerçek bir mimari/registry eksikliğidir.

---

# 2. Yeni zorunlu katman: Technical Competency Fabric

Agent modeli artık şu hale gelmelidir:

`AGENT ROLE + AGENT CONTRACT + SKILLS + TECH STACK PROFILE + PLAYBOOKS + TOOL ADAPTERS + STANDARDS + EVALUATIONS + DOMAIN PACK + MISSION CONTEXT`

Bir agent'ın adı yetmez.

Örnek:

`096 API Test`
tek başına hiçbir şey ifade etmemeli.

Runtime contract şunu açıkça söylemeli:

- hangi protokolleri bilir,
- hangi test tekniklerini uygular,
- hangi validator'ları kullanır,
- hangi tool'ları kullanabilir,
- hangi çıktı formatını üretir,
- hangi quality standard'ı zorunludur,
- hangi skill certification'ı geçmiştir,
- hangi skill version'ı aktif,
- neyi bilmiyorsa hangi knowledge acquisition flow'a girer.

---

# 3. Skill schema

Her technical skill için minimum alanlar:

```yaml
id: SKILL-API-JSON-SCHEMA-STRICT
name: Strict API JSON Schema Validation
version: 1.0.0
category: API_QA
status: CERTIFIED
prerequisites:
  - SKILL-HTTP-FUNDAMENTALS
  - SKILL-JSON
knowledge:
  - JSON Schema
  - OpenAPI
  - Ajv
  - Postman
  - Newman
tools:
  - postman-newman
  - ajv
standards:
  - API-CONTRACT-STANDARD
inputs:
  - request
  - response
  - openapi
outputs:
  - schema
  - tests
  - findings
  - evidence
evaluation:
  goldenTasks: [...]
  holdoutTasks: [...]
freshness:
  lastValidatedAt: ...
  sources: [...]
```

Her skill:
- versioned,
- testable,
- certifiable,
- revocable,
- freshness-aware olmalı.

---

# 4. Playbook schema

Skill "bilgi"dir.
Playbook "işi nasıl yapacağını" tanımlar.

Her playbook:

```yaml
id: PLAYBOOK-API-STRICT-SCHEMA
trigger:
  missionTypes: [QA_EXISTING, AUDIT_EXISTING]
requires:
  skills: [...]
  tools: [...]
steps:
  - discover
  - infer
  - normalize
  - generate
  - validate
  - negative-test
  - execute
  - report
evidence:
  required: [...]
stopConditions: [...]
qualityGates: [...]
```

Playbook hard-coded tek framework'e bağımlı olmak zorunda değildir.
Ajv bir adapter olabilir; policy başka JSON-Schema validator seçebilir.

---

# 5. Kullanıcının verdiği API QA örneğinin canonical technical contract'ı

## 5.1 API QA Agent

İlgili agentlar:
- 023 API Contract Architect
- 036 REST API Engineer
- 096 API Test
- 097 Backend Integration Test
- 104 Third-Party Integration & Contract QA
- 114 Backend Developer in Test
- 118 Test Automation Framework Architect

## 5.2 Zorunlu API bilgi alanları

### HTTP
- methods
- status codes
- headers
- content negotiation
- caching
- ETag / conditional requests
- cookies
- redirects
- compression
- CORS
- TLS basics
- retry semantics
- timeout
- idempotency

### API styles
- REST
- OpenAPI
- GraphQL
- gRPC
- WebSocket
- SSE
- SOAP/XML
- async/event API
- webhook/callback

### Data formats
- JSON
- JSON Schema
- XML/XSD
- multipart
- form-urlencoded
- binary/file
- protobuf

### Authentication / authorization
- Basic
- Bearer/JWT
- OAuth2
- OIDC
- API key
- HMAC/signature
- mTLS
- session/cookie
- service identity
- role/resource/action matrix

## 5.3 JSON Schema / Ajv technical capability

Final systemde aşağıdaki skill first-class olmalı:

`SKILL-API-JSON-SCHEMA-STRICT`

Zorunlulukları:

1. Response örneğinden schema adayı çıkar.
2. OpenAPI varsa contract'ı esas alır.
3. Örnek response ile OpenAPI arasındaki farkı bulur.
4. Bütün beklenen alanları `required` listesine alır.
5. Field type'larını doğrular.
6. Nullable policy'yi explicit uygular.
7. Kullanıcı/factory policy'si `null yasak` ise null kabul etmez.
8. Empty string policy gerekiyorsa `minLength: 1` veya custom assertion kullanır.
9. Empty array yasaksa `minItems`.
10. Empty object yasaksa `minProperties`.
11. Numeric range:
   - minimum
   - maximum
   - exclusiveMinimum
   - exclusiveMaximum
12. String:
   - minLength
   - maxLength
   - pattern
   - format
13. Enum/const.
14. Arrays:
   - item schema
   - uniqueItems
   - minItems/maxItems
15. Objects:
   - required
   - additionalProperties policy
   - nested required
16. Dates:
   - format
   - timezone
   - invalid dates
17. IDs:
   - type/format/pattern
18. Cross-field business assertions gerekiyorsa JSON Schema dışı assertion layer.
19. Sensitive field leakage check.
20. Unknown/unexpected field detection.
21. Contract drift.
22. backward/forward compatibility.

## 5.4 Postman + Ajv entegrasyonu

Canonical recipe:

`REQUEST -> RESPONSE -> HEADER CHECK -> STATUS CHECK -> CONTENT-TYPE -> SCHEMA SELECT/INFER -> AJV COMPILE -> VALIDATE -> CUSTOM NULL/EMPTY RULES -> BUSINESS ASSERTIONS -> EVIDENCE`

Örnek generated Postman test mantığı:

```javascript
// //TR: Response contract ve null/empty kurallarını deterministik doğrular.
const Ajv = require("ajv");
const ajv = new Ajv({
  allErrors: true,
  strict: true
});

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "status"],
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["ACTIVE", "PASSIVE"] }
  }
};

pm.test("Response schema geçerli", function () {
  const validate = ajv.compile(schema);
  const valid = validate(pm.response.json());
  pm.expect(
    valid,
    JSON.stringify(validate.errors, null, 2)
  ).to.eql(true);
});
```

Not:
Postman sandbox/package support runtime sürümüne göre adapter tarafından doğrulanmalıdır.
Ajv doğrudan environment'ta bulunmuyorsa bundle/library adapter stratejisi gerekir.
Tool capability runtime probe edilmeden "çalışıyor" kabul edilmez.

## 5.5 Null / empty recursive validator

Schema yeterli olmayan policy'ler için generic recursive assertion skill'i de olmalı:

- null
- undefined
- empty string
- whitespace-only string
- empty array
- empty object

Policy path-based exception desteklemeli:

```yaml
allowEmpty:
  - response.metadata.optionalNote
allowNull:
  - response.deletedAt
```

Default factory policy project/profile'a göre değişebilir.

## 5.6 Header validation

API QA agent yalnız body bakmamalı.

Zorunlu header profile örnekleri:
- Content-Type
- Cache-Control
- ETag
- request/correlation ID
- security headers where applicable
- API version header
- rate limit headers
- custom contract-required headers

Header requirement project contract'tan türetilmeli.

## 5.7 Negative API matrix

Otomatik üretilebilecek testler:
- missing required field
- null
- empty
- wrong type
- boundary
- malformed JSON
- unknown enum
- duplicate request
- replay
- invalid token
- expired token
- no role
- wrong tenant
- object-level auth
- pagination
- sorting/filtering
- rate limit
- timeout
- concurrency
- idempotency
- content-type mismatch
- oversized payload
- invalid encoding
- injection-safe probes under authorization.

## 5.8 API evidence

- request
- response
- headers
- status
- schema version
- validator version
- validation errors
- test run ID
- Newman output
- HTML/JUnit report
- commit/build/environment
- redacted sensitive data.

---

# 6. Android Engineer technical competency closure

İlgili agentlar:
- 050 Mobile Architect
- 051 Android Engineer
- 055 Firebase & Mobile Integration
- 056 Mobile Release & Store
- 090 Android Mobile App Test
- 113 Mobile Automation
- 115 Android Development in Test

Mevcut fresh starter:
- Java/Kotlin genel toolchain kayıtlı.
- Android SDK/ADB kayıtlı.
- Appium/UiAutomator2 kayıtlı.
- Jetpack Compose açık skill olarak kayıtlı değil.

Final skill pack:

## 6.1 Languages / build
- Kotlin
- Java
- Gradle
- Gradle Kotlin DSL
- Android Gradle Plugin
- version catalogs
- multi-module builds
- build variants/flavors
- signing configs
- ProGuard/R8
- lint

## 6.2 Android platform
- Android SDK
- API levels
- application/activity/service/broadcast/content-provider lifecycles
- Intents
- permissions
- foreground/background execution
- process death
- saved state
- configuration changes
- deep links / app links
- notification channels
- WorkManager
- background restrictions
- storage/scoped storage
- network security config
- biometric/auth
- accessibility services awareness

## 6.3 Jetpack
- AndroidX
- Lifecycle
- ViewModel
- SavedStateHandle
- Navigation
- Room
- DataStore
- Paging
- WorkManager
- CameraX where needed
- Security Crypto / KeyStore usage
- Compose

## 6.4 Jetpack Compose
- composables
- state
- state hoisting
- remember / rememberSaveable
- recomposition
- side effects
- derivedStateOf
- snapshotFlow
- navigation
- Material 3
- themes
- adaptive layouts
- previews
- accessibility semantics
- testing tags
- performance/recomposition analysis
- Compose UI Test

## 6.5 Concurrency
- Kotlin coroutines
- suspend
- structured concurrency
- Dispatchers
- Flow
- StateFlow
- SharedFlow
- cancellation
- lifecycle-aware collection

## 6.6 Architecture patterns
- MVVM
- MVI/UDF
- Clean Architecture
- repository pattern
- use cases
- modularization
- dependency inversion
- state/error modeling

## 6.7 Networking
- OkHttp
- Retrofit
- serialization
- Kotlinx Serialization / Gson/Moshi adapters
- interceptors
- auth refresh
- timeout/retry
- certificate pinning policy
- offline/cache
- API contract errors

## 6.8 Dependency injection
- Hilt/Dagger
- Koin where project uses it

## 6.9 Local data
- Room
- SQLite
- DataStore
- encrypted storage
- migration
- cache invalidation

## 6.10 Firebase / Google services
where applicable:
- Crashlytics
- Analytics
- FCM
- Remote Config
- Performance
- Auth
- App Distribution

## 6.11 Testing
- JUnit
- Kotlin test
- MockK/Mockito
- Robolectric
- Espresso
- Compose UI Test
- UiAutomator
- Appium
- screenshot/visual regression
- contract/API tests
- accessibility tests
- macrobenchmark
- baseline profiles
- startup/frame metrics

## 6.12 Quality
- Android Lint
- ktlint
- Detekt
- static analysis
- dependency/SBOM
- Gradle dependency audit
- secret scanning
- permissions review

## 6.13 Release
- APK/AAB
- signing
- Play Console
- internal/closed/open tracks
- versionCode/versionName
- mapping files
- obfuscation symbols
- Play Integrity where applicable
- staged rollout/rollback strategy.

## 6.14 Android evidence
- device/API/model
- build variant
- APK/AAB digest
- logcat
- ANR/crash
- screenshot/video
- Appium/UIAutomator trace
- CPU/RAM/frame metrics
- network capture
- test report.

---

# 7. iOS Engineer technical competency closure

İlgili:
- 052 iOS Engineer
- 089 iOS Mobile App Test
- 116 iOS Development in Test

Skills:
- Swift
- Objective-C interop
- SwiftUI
- UIKit
- Foundation
- async/await
- actors/concurrency
- Combine where used
- MVVM/Clean/UDF
- Navigation
- URLSession
- Codable
- Keychain
- Core Data / SwiftData
- UserDefaults
- APNs
- background tasks
- deep/universal links
- privacy permissions
- StoreKit
- XCTest
- XCUITest
- snapshot tests
- Instruments
- memory/leak/performance
- SPM
- CocoaPods legacy support
- Fastlane adapter
- code signing
- provisioning
- TestFlight
- App Store release.

---

# 8. Web Frontend technical competency closure

İlgili:
- 030 Web Frontend Engineer
- 031 React & Next.js Engineer
- 032 Frontend Design System Engineer
- 033 Web Performance Engineer
- 034 Web Accessibility Engineer

Skills:
- HTML/CSS/JS/TS
- React
- Next.js
- Vite
- SSR/SSG/ISR
- routing
- server/client components awareness
- state management
- forms/validation
- fetch/query/cache
- auth
- accessibility
- responsive/adaptive design
- Core Web Vitals
- browser storage
- service workers/PWA
- security headers/CSP
- i18n
- React Testing Library
- Vitest/Jest
- Playwright
- Storybook
- visual regression
- bundling/tree shaking/code splitting
- frontend observability.

Extensible framework skills:
Angular, Vue/Nuxt, Svelte/SvelteKit, Solid, Astro via skill packs.

---

# 9. Backend technical competency closure

İlgili:
- Backend Service Engineer
- REST API Engineer
- GraphQL Engineer
- Event-Driven Backend Engineer
- Realtime Engineer
- Queue/Scheduler Engineer

Framework skill packs should include:
- Node: Express/Fastify/Nest
- Java/Kotlin: Spring Boot
- .NET: ASP.NET Core
- Python: FastAPI/Django/Flask
- Go: net/http/Gin/Echo/Fiber as project-specific
- Rust: Axum/Actix as project-specific
- PHP: Laravel/Symfony
- Ruby: Rails

Cross-framework skills:
- API design
- transactions
- auth/authz
- idempotency
- concurrency
- validation
- async
- queues
- caching
- observability
- migration
- configuration
- feature flags
- graceful shutdown
- health/readiness
- rate limiting
- resilience
- background jobs
- distributed locking.

---

# 10. Database / Data technical competency closure

SQL:
- PostgreSQL
- MySQL/MariaDB
- SQL Server
- Oracle
- SQLite

NoSQL/cache/search:
- MongoDB
- Redis
- Elasticsearch/OpenSearch

Skills:
- modeling
- normalization/denormalization
- keys/indexes
- constraints
- transactions
- isolation levels
- locks/deadlocks
- execution plans
- query optimization
- migration
- backup/restore
- replication
- CDC
- failover
- data reconciliation
- schema evolution
- test fixtures
- data masking.

Data engineering:
- Kafka
- Spark
- Flink
- Airflow/Dagster/Prefect adapters
- dbt
- warehouse/lake
- ETL/ELT
- lineage
- quality.

---

# 11. QA Automation technical competency closure

Web:
- Playwright
- Selenium
- Cypress adapter
- WebdriverIO adapter
- browser devtools/CDP

Mobile:
- Appium
- UiAutomator2
- Espresso
- Compose UI Test
- XCUITest

API:
- Postman
- Newman
- Ajv
- OpenAPI
- Pact/contract testing adapter
- REST Assured for JVM projects
- Supertest for Node projects
- pytest/httpx/requests for Python
- Karate adapter where project requires

BDD:
- Cucumber/Gherkin
- SpecFlow for .NET where needed

Test architecture:
- Page Object
- Screenplay
- fixtures
- test data builders
- service clients
- retry policy
- flake analysis
- parallelism
- tagging/sharding
- reporting
- evidence hooks.

---

# 12. Performance technical competency closure

Tools:
- k6
- JMeter
- Locust
- Gatling adapter
- browser performance
- Android Macrobenchmark
- Instruments
- profilers

Skills:
- workload modeling
- arrival vs closed models
- concurrency
- throughput
- latency percentiles
- error rate
- saturation
- ramp/spike/soak
- capacity
- SLO
- bottleneck correlation
- DB pool
- GC
- memory leak
- CPU
- network
- disk
- abort guard.

---

# 13. Security technical competency closure

Knowledge packs:
- OWASP ASVS
- OWASP WSTG
- OWASP API Security
- OWASP MASVS/MSTG
- CWE
- CVSS
- secure coding
- threat modeling

Tools/adapters:
- Semgrep
- ZAP
- SCA/SBOM
- secret scanners
- container/IaC scanners
- fuzzers
- mobile static/dynamic tools where authorized.

Security agent must distinguish:
standard mapping, automated finding, safe reproduction, confirmed issue, remediation, retest.

Standards versions require freshness/recertification.

---

# 14. DevOps / Cloud competency closure

Skills:
- Docker/Dockerfile/Compose
- Kubernetes
- Helm
- Terraform/OpenTofu
- GitHub Actions
- GitLab CI
- Azure DevOps
- Jenkins
- artifact/container registries
- secrets
- IAM
- networking
- DNS/TLS
- load balancers
- autoscaling
- observability
- backup/DR
- rollout/rollback
- cost.

Cloud packs:
AWS, Azure, GCP, then provider service overlays.

---

# 15. Observability / SRE competency closure

- OpenTelemetry
- logs
- metrics
- traces
- Prometheus
- Grafana
- ELK/OpenSearch
- Loki/Tempo adapters
- Sentry-style error tracking
- tracing context propagation
- SLI/SLO
- error budget
- alerting
- runbooks
- incident management
- capacity
- synthetic monitoring.

---

# 16. AI / Data Science competency closure

Languages/frameworks:
- Python
- NumPy/Pandas
- scikit-learn
- PyTorch
- TensorFlow/Keras adapter
- Hugging Face
- ONNX
- local inference adapters

LLM:
- prompt/versioning
- structured output
- tool calling
- RAG
- vector stores
- retrieval evaluation
- hallucination/factuality
- prompt injection
- context leakage
- agent eval
- model routing
- cost/latency
- benchmark/holdout
- dataset provenance.

Frameworks such as LangChain/LlamaIndex should be project skill packs, not core assumptions.

---

# 17. Game development competency closure

Unity:
- C#
- scenes/prefabs
- ScriptableObject
- Addressables
- input
- physics
- rendering
- profiler
- networking
- build pipeline

Unreal:
- C++
- Blueprint
- Gameplay Framework
- GAS where relevant
- replication
- assets
- Unreal Insights
- AutomationTool
- build/cook/package

Godot:
- GDScript/C#
- scenes/nodes
- signals
- resources
- multiplayer
- profiler/export.

Shared:
- gameplay architecture
- ECS/data-oriented patterns
- deterministic simulation where relevant
- save systems
- multiplayer/state replication
- server authority
- anti-cheat/trust
- performance/frame-time
- economy invariants
- patcher/LiveOps.

---

# 18. Desktop competency closure

- Electron
- Tauri
- .NET WPF/WinUI/MAUI packs
- Qt/C++/PySide packs
- native macOS Swift/AppKit
- Linux packaging
- installer/updater
- code signing/notarization
- protocol/file associations
- tray/background service
- crash dumps
- DPI/multi-monitor
- accessibility.

---

# 19. Embedded / IoT technical competency closure

- C/C++
- Rust embedded where relevant
- MCU basics
- Arduino/PlatformIO skill packs
- ESP-IDF
- STM32 toolchain
- Zephyr
- FreeRTOS
- serial/UART
- USB
- BLE
- Wi-Fi
- MQTT
- OTA
- bootloader
- HIL
- device logs
- power/reboot
- firmware artifact/version
- safe debug interfaces under authorization.

---

# 20. Design technical competency closure

Design Studio agents need actual skills:
- user research
- IA
- user flows
- journey maps
- wireframes
- prototyping
- Figma adapter
- design tokens
- typography
- color
- spacing
- layout/grid
- responsive/adaptive
- Material Design
- Apple HIG
- accessibility
- localization/RTL
- component states
- design-to-code traceability
- pixel-perfect visual QA.

---

# 21. Technical standards registry

Final repo should contain versioned standards/profiles such as:

- API Contract Standard
- Strict JSON Schema Validation Standard
- API Negative Matrix Standard
- Web Frontend Engineering Standard
- Android Engineering Standard
- iOS Engineering Standard
- Backend Engineering Standard
- Database Engineering Standard
- Mobile QA Standard
- Automation Framework Standard
- Performance Standard
- Security Assessment Standard
- Accessibility Standard
- Localization Standard
- Observability Standard
- Release Standard
- Evidence Standard
- Code Review Standard
- Dependency Standard.

Project/domain can override only through explicit policy and traceable decision.

---

# 22. Agent-to-Skill Matrix

A machine-readable matrix is mandatory.

Example:

```json
{
  "agentId": "096",
  "requiredSkills": [
    "SKILL-HTTP",
    "SKILL-REST",
    "SKILL-OPENAPI",
    "SKILL-JSON-SCHEMA",
    "SKILL-AJV",
    "SKILL-POSTMAN",
    "SKILL-NEWMAN",
    "SKILL-AUTH-API",
    "SKILL-API-NEGATIVE-MATRIX"
  ],
  "optionalSkills": [
    "SKILL-GRAPHQL",
    "SKILL-GRPC",
    "SKILL-WEBSOCKET"
  ]
}
```

Android:

```json
{
  "agentId": "051",
  "requiredSkills": [
    "SKILL-KOTLIN",
    "SKILL-JAVA-ANDROID",
    "SKILL-GRADLE-ANDROID",
    "SKILL-ANDROID-SDK",
    "SKILL-JETPACK",
    "SKILL-JETPACK-COMPOSE",
    "SKILL-COROUTINES-FLOW",
    "SKILL-ANDROID-ARCHITECTURE",
    "SKILL-ANDROID-NETWORK",
    "SKILL-ANDROID-STORAGE",
    "SKILL-ANDROID-TESTING",
    "SKILL-ANDROID-RELEASE"
  ]
}
```

---

# 23. Skill certification

Bir model "Kotlin biliyorum" dedi diye certified sayılmaz.

Her skill için:
- knowledge eval
- implementation task
- debugging task
- review task
- test task
- golden cases
- hidden holdout cases
- tool execution
- output quality
- regression
- freshness.

Status:

`REGISTERED -> TRAINING -> EVALUATION -> CERTIFIED -> ACTIVE -> STALE -> RECERTIFICATION`

---

# 24. Skill acquisition

Bir mission şu teknolojiyi getirirse:

`Phoenix/Elixir framework`

ve agent skill registry'de yoksa:

`MISSING SKILL -> Research -> Official docs -> Practice sandbox -> Golden task -> Independent review -> Certification -> Skill Registry -> Mission activation`

Agent kafasından bildiğini varsaymamalı.

---

# 25. Son verdict

Fresh starter'da organizasyon rolleri ve broad toolchain coverage vardı.

Ancak teknik detay seviyesi için şu layer eksik:

**TECHNICAL COMPETENCY FABRIC**

Bu olmadan:
- "Android Engineer var" denebilir,
- ama "Jetpack Compose, Coroutines, Room, Retrofit, Hilt, Espresso biliyor mu?" sorusunun canonical cevabı yoktur.

Bu olmadan:
- "API Test Agent var" denebilir,
- ama "Ajv ile Postman response schema üretip required/type/null/empty/additionalProperties ve header validation yapıyor mu?" sorusunun canonical cevabı yoktur.

Dolayısıyla final ZIP'te zorunlu olarak eklenmelidir:

1. `registries/skills.json`
2. `registries/agent-skill-matrix.json`
3. `registries/technical-standards.json`
4. `registries/playbooks.json`
5. `registries/framework-packs.json`
6. `schemas/skill.schema.json`
7. `schemas/playbook.schema.json`
8. `schemas/agent-skill-profile.schema.json`
9. `schemas/technical-standard.schema.json`
10. `skills/**`
11. `playbooks/**`
12. `standards/**`
13. `evaluations/skills/**`
14. `knowledge-packs/frameworks/**`

Bu layer final architecture closure spec'e eklenmeden "agent teknik olarak ne biliyor?" konusu kapalı sayılmamalıdır.
