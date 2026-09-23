<!-- //TR: Bu dosya mevcut FINAL-CANONICAL-STARTER ZIP içindeki 363 agent, skill matrix, framework pack, tool adapter ve organization yapısını teknik derinlik açısından tekrar denetler; mevcut hataları ve bir sonraki nihai ZIP için zorunlu düzeltmeleri kaydeder. -->
# UASCO — 363 Agent Teknik Derinlik Yeniden Denetimi

## 1. Sonuç: mevcut "FINAL" ZIP teknik olarak hâlâ final değil

Mevcut ZIP içinde:

- 363 agent kaydı var.
- 363 agent için ayrı teknik genome dosyası var.
- 1.186 skill var.
- 40 competency pack var.
- 41 framework pack var.
- 140 tool/provider adapter var.

Ancak tekrar taramada **sistematik modelleme hataları** bulundu.

Bu hatalar tek bir Agent 51 veya Agent 96 problemi değildir. Agent-skill üretim yaklaşımının tamamını etkiliyor.

---

# 2. Repo içinde kanıtlanan somut problemler

## 2.1 Flutter Engineer yanlış zorunlu skill set'e sahip

`053 Flutter Engineer` required skill set'i şu anda ağırlıklı olarak:

- Android Platform
- Kotlin
- Java Android
- Gradle Android
- Jetpack
- Jetpack Compose
- Coroutines
- Android Networking
- Android Storage
- Android Background Work
- Android Permissions

içeriyor.

Fakat **Dart ve Flutter requiredSkillIds içinde yok**.

Bunlar yalnız competency pack'in inherited listesinde aşağıda bulunuyor.

Bu yanlış.

Flutter Engineer için Dart + Flutter + widget/render/layout/state/navigation/platform-channel/build/test/performance/release gibi bilgiler primary/deep competency olmalı.

---

## 2.2 React Native Engineer aynı hatayı taşıyor

`054 React Native Engineer` required skills içinde:

- React Native
- TypeScript
- JavaScript
- Metro
- Expo
- native bridge
- JSI
- Hermes
- Fabric/TurboModules
- React Navigation
- native module integration
- Detox/Maestro
- Android/iOS build integration

gibi first-class derin skill'ler yerine Android pack'in ilk bölümünü miras alıyor.

Bu da yanlış.

---

## 2.3 iOS Engineer'a yanlış Android zorunlulukları bulaşmış

`052 iOS Engineer` için Swift/SwiftUI/UIKit/XCTest gibi role-specific skill'ler eklenmiş olsa da daha sonra Android Platform, Kotlin, Java Android, Gradle, Jetpack, Compose vb. required list'e de eklenmiş.

iOS Engineer'ın Android'i **adjacent awareness / interoperability** seviyesinde bilmesi mantıklıdır.

Ama bunlar iOS primary mastery ile aynı required-depth seviyesinde tutulmamalıdır.

---

## 2.4 Mobile Architect gerçek "cross-platform comparison" seviyesinde değil

`050 Mobile Architect` teknoloji karar verici olmasına rağmen current required list ilk Android ağırlıklı skill'lerle kesilmiş.

Mobile Architect aşağıdaki bütün aileleri **principal decision depth** seviyesinde karşılaştırabilmelidir:

- Native Android
- Native iOS
- Flutter
- React Native
- Kotlin Multiplatform
- Compose Multiplatform
- .NET MAUI
- Ionic/Capacitor
- PWA/hybrid
- legacy Cordova/Xamarin migration paths

Architect'ın işi bir stack'te kod yazmak değil yalnız; hangi stack'in proje için doğru olduğunu kanıtlı trade-off ile seçmektir.

---

## 2.5 Tek competency pack modeli yetersiz

Her agent kaydında yalnız bir:

`competencyPackId`

var.

Gerçekte roller çoğu zaman birden fazla bilgi alanının birleşimidir.

Örnek:

### API QA
Primary:
- Quality Engineering

Secondary:
- Backend/API Engineering
- API Security
- Data validation
- Observability
- Contract/versioning

### Mobile Automation
Primary:
- Quality Engineering

Secondary:
- Mobile Engineering
- Android/iOS platform
- Device lab
- Cloud device providers
- CI/CD

### SRE
Primary:
- Platform/SRE

Secondary:
- Cloud
- Security
- Networking
- Database basics
- Distributed systems
- Observability
- Incident response

Bu nedenle tek `competencyPackId` yerine:

- primaryCompetencyPacks
- secondaryCompetencyPacks
- adjacentAwarenessPacks
- missionActivatedPacks

olmalı.

---

# 3. En büyük modelleme problemi: teknoloji, skill, tool ve bilgi birbirine karışmış

Şu anda örneğin:

- `SKILL-AJV`
- `SKILL-FLUTTER`
- `SKILL-REACT_NATIVE`

gibi kayıtlar var.

Fakat Ajv aslında:
- bir library/tool technology profile,

Flutter:
- framework/platform ecosystem,

"Strict JSON Schema Validation":
- gerçek engineering skill,

"API Contract Test":
- engineering capability,

"Postman/Newman":
- tool/runtime adapter.

Bunların hepsini "skill" yapmak ileride bilgi modelini kirletir.

## Final model

### Skill
İnsanın/agent'ın yapabildiği teknik iş.

Örnek:
- JSON Schema Contract Design
- Async Concurrency Debugging
- Mobile Performance Profiling
- Database Query Plan Optimization
- Architecture Trade-off Analysis

### Technology Profile
Bilinen teknoloji/framework/library/runtime/protocol.

Örnek:
- Ajv
- Flutter
- React Native
- Spring Boot
- PostgreSQL
- Kafka
- Unreal Engine

### Tool Adapter
Gerçekte çalıştırılan araç entegrasyonu.

Örnek:
- Newman CLI
- adb
- kubectl
- Gradle
- Xcodebuild
- k6

### Standard
Şirketin "nasıl yapılmalı" kuralı.

### Playbook
Bir işi hangi sıra ile yapacağını gösterir.

### Knowledge Unit
Teknolojinin versioned bilgi parçaları:
- API
- lifecycle
- failure modes
- deprecations
- migration
- security
- performance.

---

# 4. Yeni zorunlu bilgi modeli

Her teknik agent şu katmanların birleşimi olmalıdır:

`UNIVERSAL ENGINEERING LITERACY`
+
`DOMAIN FOUNDATION`
+
`ROLE SPECIALIZATION`
+
`TECHNOLOGY ECOSYSTEM KNOWLEDGE`
+
`TOOL EXECUTION`
+
`ADJACENT DOMAIN LITERACY`
+
`ARCHITECTURE / DECISION DEPTH`
+
`SECURITY / PERFORMANCE / QUALITY DEPTH`
+
`MISSION-SPECIFIC STACK`
+
`DYNAMIC SKILL ACQUISITION`

---

# 5. Her teknik agent için zorunlu ortak mühendislik temeli

Kod yazan/test eden/inceleyen bütün teknik agentlar minimum şu konuları bilmeli:

## Software fundamentals
- algorithms/data structures basics
- complexity
- clean code
- modularity
- SOLID where applicable
- functional/OOP/procedural paradigms
- error handling
- configuration
- dependency management
- versioning
- backward compatibility

## Git/SCM
- commit
- branch
- merge
- rebase
- conflict
- tags
- release branches
- worktrees
- PR/MR
- bisect
- revert

## OS
- Linux
- Windows
- macOS fundamentals
- processes
- threads
- file systems
- permissions
- environment variables
- signals/services

## Networking
- DNS
- TCP
- UDP
- TLS
- HTTP
- proxy
- NAT
- sockets
- latency/loss/timeouts

## Security
- authn/authz
- secrets
- common injection
- data exposure
- dependency risk
- least privilege
- threat awareness

## Quality
- unit/integration/e2e
- negative testing
- boundary
- state
- concurrency
- regression
- observability
- testability

## Operations
- logging
- metrics
- traces
- profiling
- health/readiness
- deployment
- rollback
- backup/recovery basics

## Data
- SQL basics
- transactions
- consistency
- caching
- serialization
- schema/versioning

Bunlar ayrı "her agent her şeyi expert bilsin" anlamına gelmez.
Bunlar teknik ortak dil seviyesidir.

---

# 6. Yetkinlik derinliği artık tek ADVANCED etiketi olmayacak

Her agent-teknoloji ilişkisi aşağıdaki seviyelerden biriyle kaydedilmelidir:

0. NOT_REQUIRED
1. AWARENESS
2. WORKING_KNOWLEDGE
3. IMPLEMENTATION
4. DEBUGGING
5. ADVANCED_ENGINEERING
6. ARCHITECTURE_DECISION
7. PRINCIPAL_REVIEW

Ayrıca tek sayı yeterli değildir.

Her teknik competency için ayrı eksenler:

- fundamentals
- implementation
- debugging
- testing
- architecture
- interoperability
- security
- performance
- operations
- migration/upgrade
- review
- technology-selection

Örnek:

Flutter Engineer:
- Flutter implementation: 6
- Flutter debugging: 6
- Flutter testing: 6
- Android native interop: 4
- iOS native interop: 4
- React Native comparison: 2
- mobile architecture: 4

Mobile Architect:
- Flutter implementation: 3
- Flutter architecture: 6
- Flutter selection/review: 7
- Native Android architecture: 6
- Native iOS architecture: 6
- React Native architecture: 6
- KMP architecture: 6.

---

# 7. "Her türlü teknoloji" isteğini gerçekçi şekilde çözecek yapı

Dünyadaki her package/library adını bir JSON içine sonsuza kadar yazmak mümkün değildir.

Doğru çözüm iki parçalıdır:

## A. Çok geniş seed Technology Universe
Bugün bilinen ana ekosistemler repo içinde kayıtlı olmalı.

## B. Dynamic Technology Discovery
Mission/repo içinde registry'de bulunmayan bir teknoloji tespit edilirse:

`DETECT -> IDENTIFY -> OFFICIAL SOURCE RESEARCH -> VERSION/FRESHNESS -> SANDBOX -> SKILL MAPPING -> TEST -> SECURITY/PERFORMANCE REVIEW -> CERTIFY -> REGISTER`

Bu sayede yarın çıkan teknoloji core değişikliği gerektirmez.

---

# 8. Final ZIP'te seed edilmesi gereken teknoloji evreni

Aşağıdaki liste örnek değil; minimum seed aileleridir.

## 8.1 Web platform & frontend

Languages/platform:
- JavaScript
- TypeScript
- HTML
- CSS
- Web Components
- WASM/WebAssembly
- browser APIs

Framework/meta-framework:
- React
- Next.js
- Angular
- Vue
- Nuxt
- Svelte
- SvelteKit
- Astro
- Remix
- Solid
- Qwik
- HTMX
- Lit

Build/runtime:
- Vite
- Webpack
- Rspack
- Rollup
- esbuild
- SWC
- Turbopack
- Bun
- Deno
- Node

Styling/UI:
- Tailwind
- Bootstrap
- Material UI
- Ant Design
- Chakra UI
- shadcn
- CSS Modules
- Sass
- CSS-in-JS patterns

State/data:
- Redux Toolkit
- Zustand
- MobX
- TanStack Query
- Apollo Client
- RxJS

Test:
- Playwright
- Cypress
- Selenium
- WebdriverIO
- Vitest
- Jest
- Mocha
- Testing Library
- Storybook
- Chromatic-style visual testing
- Lighthouse
- axe.

## 8.2 Mobile

Android:
- Kotlin
- Java
- Android SDK
- Gradle/AGP
- Jetpack
- Compose
- Coroutines/Flow
- Room
- DataStore
- WorkManager
- Retrofit/OkHttp
- Kotlin Serialization
- Hilt/Dagger
- Koin
- Espresso
- Compose UI Test
- UiAutomator
- Robolectric
- Macrobenchmark
- Baseline Profiles
- Firebase
- Play Integrity
- Play Console

iOS:
- Swift
- Objective-C interoperability
- SwiftUI
- UIKit
- Foundation
- async/await
- actors
- Combine
- URLSession
- Codable
- SwiftData
- Core Data
- Keychain
- XCTest
- XCUITest
- Instruments
- SPM
- CocoaPods legacy
- Fastlane
- TestFlight
- StoreKit

Cross-platform:
- Flutter/Dart
- React Native
- Expo
- Kotlin Multiplatform
- Compose Multiplatform
- .NET MAUI
- Ionic
- Capacitor
- legacy Cordova
- legacy Xamarin migration.

Mobile test:
- Appium
- Maestro
- Detox
- BrowserStack
- Sauce Labs
- LambdaTest
- Firebase Test Lab
- AWS Device Farm
- Kobiton
- Perfecto.

## 8.3 Backend & API

Node/TS:
- Express
- Fastify
- NestJS
- Hono
- Koa
- Bun
- Deno

JVM:
- Spring Boot
- Spring Security
- Spring Data
- Hibernate/JPA
- Quarkus
- Micronaut
- Ktor
- Vert.x

.NET:
- ASP.NET Core
- Entity Framework Core
- minimal APIs
- background services
- SignalR

Python:
- FastAPI
- Django
- Flask
- Starlette
- Pydantic
- SQLAlchemy
- Celery

Go:
- net/http
- Gin
- Fiber
- Echo
- gRPC-Go

Rust:
- Axum
- Actix Web
- Rocket
- Tokio

PHP:
- Laravel
- Symfony

Ruby:
- Rails

Elixir/Erlang:
- Phoenix
- OTP
- Ecto

Scala/JVM:
- Play
- Akka/Pekko ecosystem where relevant.

## 8.4 API/protocol/realtime

- HTTP 1.1/2/3
- REST
- OpenAPI
- JSON Schema
- GraphQL
- Apollo ecosystem
- gRPC
- Protobuf
- WebSocket
- Socket.IO
- SignalR
- SSE
- WebRTC
- SOAP/WSDL/XML/XSD
- GraphQL subscriptions
- webhook
- OAuth/OIDC/SAML/SCIM
- HMAC
- mTLS.

Messaging:
- Kafka
- RabbitMQ
- NATS
- Pulsar
- Redis Streams
- MQTT
- AMQP
- cloud Pub/Sub/SQS/SNS/EventBridge equivalents.

## 8.5 Data stores

Relational:
- PostgreSQL
- MySQL/MariaDB
- SQL Server
- Oracle
- SQLite
- CockroachDB

NoSQL:
- MongoDB
- Cassandra
- ScyllaDB
- Couchbase
- DynamoDB
- Cosmos DB

Cache:
- Redis
- Memcached

Search:
- Elasticsearch
- OpenSearch
- Solr

Graph:
- Neo4j

Time series:
- TimescaleDB
- InfluxDB

Analytics:
- ClickHouse
- DuckDB
- BigQuery
- Snowflake
- Redshift

Vector:
- pgvector
- Qdrant
- Milvus
- Weaviate
- Pinecone-style providers.

ORM/data access:
- Prisma
- Drizzle
- TypeORM
- Sequelize
- Hibernate/JPA
- EF Core
- SQLAlchemy
- Django ORM
- GORM
- Exposed/JOOQ where relevant.

## 8.6 Data engineering

- Kafka Connect
- Debezium
- Spark
- Flink
- Beam
- Airflow
- Dagster
- Prefect
- dbt
- lakehouse concepts
- Delta/Iceberg/Hudi families
- CDC
- lineage
- data quality.

## 8.7 Cloud/platform

Cloud:
- AWS
- Azure
- GCP

Containers/orchestration:
- Docker
- Compose
- Kubernetes
- Helm

IaC:
- Terraform/OpenTofu
- Pulumi
- CloudFormation/Bicep equivalents

Config/provisioning:
- Ansible
- Chef/Puppet awareness

GitOps:
- Argo CD
- Flux

CI:
- GitHub Actions
- GitLab CI
- Jenkins
- Azure DevOps
- CircleCI
- TeamCity and other adapters

Service mesh/gateway:
- Envoy
- Istio
- Linkerd
- ingress/API gateway patterns.

## 8.8 Observability

- OpenTelemetry
- Prometheus
- Grafana
- Loki
- Tempo
- Jaeger
- Elastic/OpenSearch stacks
- Sentry
- Datadog
- New Relic
- Splunk
- cloud-native monitoring.

## 8.9 Security

Standards:
- OWASP ASVS
- WSTG
- API Security Top 10
- MASVS/MSTG
- CWE
- CVSS
- threat modeling

Tools:
- ZAP
- Burp adapter
- Semgrep
- SonarQube-style SAST/quality
- Snyk-style dependency scanner
- Trivy
- Syft
- Grype
- Gitleaks
- Checkmarx/Veracode/Fortify adapters
- Nuclei under authorization
- fuzzers
- container/IaC/cloud scanners.

## 8.10 QA/Test ecosystems

API:
- Postman/Newman
- Ajv
- REST Assured
- Supertest
- pytest/httpx
- Karate
- Pact
- WireMock
- MockServer

Web:
- Playwright
- Cypress
- Selenium
- WebdriverIO
- browser devtools/CDP

JVM:
- JUnit
- TestNG
- Mockito
- MockK

.NET:
- xUnit
- NUnit

Python:
- pytest
- unittest
- Hypothesis

JS:
- Vitest
- Jest
- Mocha
- Testing Library

BDD:
- Cucumber/Gherkin
- SpecFlow equivalent

Performance:
- k6
- JMeter
- Locust
- Gatling.

## 8.11 Desktop

- Electron
- Tauri
- WPF
- WinUI
- .NET MAUI desktop
- Qt
- PySide/PyQt
- native macOS AppKit/SwiftUI
- native Windows integration
- Linux desktop packaging
- installer/update/signing.

## 8.12 AI / ML / Agent systems

ML:
- NumPy/Pandas
- scikit-learn
- PyTorch
- TensorFlow/Keras
- Hugging Face
- ONNX

LLM:
- structured output
- function/tool calling
- RAG
- embeddings
- reranking
- evals
- guardrails
- prompt injection
- multimodal
- local inference

Framework ecosystem:
- LangChain
- LangGraph
- LlamaIndex
- Semantic Kernel
- DSPy
- agent/workflow frameworks as adapters, not hard dependency.

Inference:
- Ollama
- vLLM
- llama.cpp
- GPU runtime basics.

## 8.13 Game

Engines:
- Unity
- Unreal
- Godot

Additional ecosystem awareness:
- proprietary engines
- CryEngine-family
- custom C++ engines

Graphics:
- DirectX
- Vulkan
- Metal
- OpenGL
- WebGPU

Multiplayer/services:
- authoritative server architecture
- Photon-style services
- Unity Netcode/Mirror awareness
- Steamworks
- Epic Online Services
- platform SDK adapters

Art:
- Blender
- Maya
- 3ds Max
- Substance family
- asset pipelines.

## 8.14 Embedded / IoT / Robotics

- C/C++
- Rust embedded
- FreeRTOS
- Zephyr
- ESP-IDF
- STM32
- Arduino/PlatformIO
- UART/serial
- USB
- BLE
- Wi-Fi
- MQTT
- CAN where relevant
- Modbus/industrial protocols via domain pack
- OTA
- bootloader
- HIL.

## 8.15 Identity / enterprise integration

Identity:
- Keycloak
- Auth0
- Okta
- Cognito
- Entra ID
- LDAP/AD
- OAuth/OIDC
- SAML
- SCIM
- WebAuthn/passkeys

Enterprise/business:
- Salesforce
- SAP
- Dynamics 365
- ServiceNow
- Shopify
- WooCommerce
- Magento/Adobe Commerce
- payment providers through adapters.

---

# 9. Current repo sample technology audit

A broad string-level sample of common technology names was compared against current 1.186 skill registry.

The current registry contained examples such as:
- Angular, Vue, Nuxt, Svelte
- React Native, Flutter
- Spring Boot, FastAPI, Django, NestJS
- PostgreSQL/MongoDB
- Kafka/RabbitMQ
- Playwright/Cypress/Selenium
- Appium
- Unity/Unreal/Godot
- Terraform/Kubernetes
- OpenTelemetry/Prometheus/Grafana

However a large sample of still-common technologies had no explicit skill/profile representation, including examples such as:

- Astro
- Remix
- Solid
- Qwik
- HTMX
- Ionic/Capacitor
- Kotlin Multiplatform / Compose Multiplatform
- Apollo
- Protobuf
- Socket.IO
- SignalR
- NATS
- Pulsar
- Quarkus
- Micronaut
- Ktor
- ASP.NET / EF Core
- Flask
- Axum / Actix
- Symfony
- Phoenix
- Prisma / Drizzle / TypeORM
- Cassandra / DynamoDB / Cosmos DB / Neo4j / ClickHouse / Snowflake
- Datadog / New Relic / Splunk
- Pulumi / Argo CD / Flux
- Maestro / Detox
- Mocha / TestNG / NUnit / xUnit
- Zod / Joi
- Burp / SonarQube / Snyk / enterprise security scanners
- DirectX / Vulkan / Metal / WebGPU
- Blender / Maya / Substance
- Tailwind / MUI / Chakra / Ant Design
- Supabase / Appwrite
- Keycloak / Auth0 / Okta / Cognito
- major payment/ecommerce/enterprise platforms.

Bu liste "hepsi bunlar" değildir; mevcut modelin seed teknoloji kapsamının hâlâ dar olduğunun kanıtıdır.

---

# 10. Framework Pack sayısı ve derinliği yeterli değil

Current:
- 41 framework pack.

Bu pack'lerin çoğu 3–5 skill referansı içeriyor.

Örneğin Flutter pack:
- Dart
- Flutter
- Mobile Architecture
- Mobile Testing

Bu, gerçek Flutter mastery için yeterli değildir.

Flutter profile en az:
- Dart language semantics
- null safety
- async/isolate
- widget/render/element tree
- state/lifecycle
- layout/constraints
- navigation
- state management alternatives
- platform channels
- FFI
- native integration
- build flavors
- Android/iOS signing
- networking
- storage
- background work
- notifications
- deep links
- accessibility
- localization
- testing
- integration testing
- golden testing
- performance/profiling
- DevTools
- crash diagnostics
- upgrade/migration
- package compatibility

gibi versioned knowledge units taşımalıdır.

Aynı kural React, Spring, PostgreSQL, Unreal vb. için geçerli.

---

# 11. Agent hierarchy daha doğru hale getirilmeli

Current review chain çoğunlukla:

`SPECIALIST -> DEPARTMENT HEAD`

şeklinde.

Final yapı:

`SPECIALIST -> TECH LEAD / PRINCIPAL -> DEPARTMENT HEAD -> CROSS-FUNCTIONAL REVIEW -> INDEPENDENT ASSURANCE`

olmalıdır.

Her 363 agent için:
- directLeadAgentId
- principalReviewerAgentIds
- departmentHeadAgentId
- crossFunctionalReviewerRules
- independentReviewRequirement

tanımlanmalıdır.

---

# 12. 363 agent'a aynı şeyi kopyalamak da yanlış

Amaç her agent'a 3.000 technology ID gömmek değildir.

Doğru inheritance:

## T0 — Universal Company Literacy
Tüm agentlar.

## T1 — Universal Engineering Literacy
Teknik agentlar.

## T2 — Department Universe
Örn. Mobile Engineering teknoloji evreni.

## T3 — Subdomain
Örn. Android / iOS / Flutter / React Native.

## T4 — Role Specialization
Örn. Compose performance specialist.

## T5 — Mission Stack
Projede gerçekten kullanılan versiyon/araçlar.

## T6 — Dynamic Gap Acquisition
Registry dışı teknoloji.

Bu model hem çok yönlü hem token açısından verimlidir.

---

# 13. Heads ve architects için ayrı kural

Takım başı specialist'tan daha çok framework adı ezberlemek zorunda değildir; ama:

- bütün ana alternatifleri bilmeli,
- karşılaştırabilmeli,
- hangi durumda hangisini seçmeyeceğini bilmeli,
- migration/lock-in/cost/security/testability/operability trade-off'larını bilmeli,
- specialist çıktısını teknik olarak sorgulayabilmeli.

Head/Architect için `technology-selection` ve `principal-review` eksenleri yüksek olmalıdır.

---

# 14. QA agentları yalnız test tool'u değil ürün stack'ini de anlamalı

Örnek API QA:
- HTTP/REST/OpenAPI/JSON Schema
- backend validation patterns
- auth/authz
- DB transaction/data integrity basics
- async/event basics
- observability
- security basics
- actual project backend framework awareness.

Örnek Android QA:
- Android lifecycle
- Compose/View hierarchy
- Gradle/build variants
- permissions
- activity/process lifecycle
- network/storage/background work
- test framework/tooling.

Bu sayede QA yalnız black-box buton basan agent olmaz.

---

# 15. Socket/Realtime agentı genişletilmeli

Current Socket & Realtime QA:
- WebSocket/SSE
- ordering
- reconnect
- backpressure

gibi iyi başlangıçlara sahip.

Final technical universe:
- raw TCP socket behavior
- WebSocket frames/handshake
- Socket.IO semantics
- SignalR
- SSE
- gRPC streaming
- MQTT
- pub/sub
- message ordering
- duplication
- loss
- out-of-order
- backpressure
- reconnect
- heartbeat
- presence
- fan-out
- broker outage
- partition
- slow consumer
- schema/version compatibility
- concurrency/load
- network impairment
- security/auth/session expiry.

---

# 16. Technology Knowledge Graph gerekli

Yeni registry:

`registries/technologies.json`

Her technology:

- canonical ID
- aliases
- category
- ecosystem
- type
- languages
- supported platforms
- official sources
- release/version policy
- latest-known version snapshot
- LTS/EOL policy
- security advisories source
- package managers
- build tools
- common test tools
- common observability tools
- interoperatesWith
- alternatives
- migrationFrom/To
- known failure families
- certification rules.

Ek registry'ler:
- technology-relations.json
- technology-version-policies.json
- technology-agent-depth.json
- technology-source-registry.json
- technology-compatibility-rules.json.

---

# 17. Technical Knowledge Unit

Her önemli teknoloji için tek isim değil, bilgi parçaları:

- fundamentals
- language semantics
- API/lifecycle
- architecture
- configuration
- build/package
- implementation patterns
- anti-patterns
- failure modes
- debugging
- testing
- security
- performance
- observability
- deployment
- upgrade/migration
- compatibility
- deprecation
- decision criteria.

Bunların her biri source/version/provenance/freshness taşır.

---

# 18. Final ZIP validator'ı daha sert olmalı

Yeni validator örnekleri:

- Flutter Engineer required primary set içinde Dart+Flutter yoksa FAIL.
- React Native Engineer required primary set içinde React Native+TS/native bridge knowledge yoksa FAIL.
- iOS Engineer Android primary skills ile aynı depth'te ise FAIL.
- Mobile Architect Native Android+iOS+Flutter+React Native+KMP comparison coverage yoksa FAIL.
- API QA HTTP+OpenAPI+JSON Schema+contract+auth+negative+protocol awareness yoksa FAIL.
- Socket QA realtime technology family matrix'i yetersizse FAIL.
- Web Head React/Angular/Vue/Svelte + web standards + build/runtime alternatives bilmiyorsa FAIL.
- Backend Architect en az JVM/.NET/Node/Python/Go/Rust/PHP/Ruby/Elixir family comparison bilmiyorsa FAIL.
- Database Architect relational/document/key-value/search/graph/time-series/analytics/vector familiesini karşılaştıramıyorsa FAIL.
- Game Architect Unity/Unreal/Godot + custom engine/graphics/network/backend/performance awareness yoksa FAIL.
- Security Architect App/Web/API/Mobile/Cloud/Identity/SupplyChain/AI/Infra breadth yoksa FAIL.
- QA Head tüm assurance domainlerini principal-review seviyesinde bilmiyorsa FAIL.
- role tool references registry'de yoksa FAIL.
- required technology has no official-source policy ise FAIL.
- stale technology certification active ise FAIL.

---

# 19. Final karar

Mevcut FINAL ZIP:
- organizationally güçlü,
- broad architecture olarak güçlü,
- competency fikrini içeriyor,

fakat **agent technical knowledge modelinde hala otomatik/generic inheritance hataları ve dar technology universe problemi var.**

Bu nedenle bir sonraki ZIP'te:

1. skill/technology/tool ayrımı düzeltilmeli,
2. Technology Knowledge Graph eklenmeli,
3. seed teknoloji evreni büyük ölçüde genişletilmeli,
4. 363 agent matrix yeniden üretilmeli,
5. her agent için multi-pack inheritance kullanılmalı,
6. agent-role teknik derinlik eksenleri ayrı tutulmalı,
7. Head/Architect/Principal için comparative decision depth eklenmeli,
8. QA agentlarına product-stack literacy verilmeli,
9. role-specific tools doğru bağlanmalı,
10. direct lead/principal/head/council review zinciri tamamlanmalı,
11. dynamic unknown-technology acquisition first-class olmalı,
12. validator role-by-role semantic coverage kontrol etmeli.

Bunlar yapılmadan "bütün agentlar çok yönlü ve teknik olarak derin" iddiası doğru değildir.
