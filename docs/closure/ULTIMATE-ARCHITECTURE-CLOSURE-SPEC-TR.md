<!-- //TR: Bu dosya UNIVERSAL-AI-SOFTWARE-COMPANY-OS için mimari keşif aşamasını kapatmak üzere bütün temel primitive'leri, açıkları, kuralları, lifecycle'ları, schema kataloğunu, acceptance suite'lerini ve extension modelini tek canonical kapanış spesifikasyonunda toplar. -->
> **REFERENCE_SPECIFICATION_NOT_CURRENT_STATUS_EVIDENCE** — //TR: Bu belge geçmiş audit/specification bağlamını korur; current PASS/CLEAN/closure/release authority değildir. Current truth için `CANONICAL-STATUS.md` ve `audit/V6-FULL-SCAN-PROGRESS.json` kullanılır.
# UASCO — Ultimate Architecture Closure Specification

**Amaç:** Mimari keşif döngüsünü kapatmak.  
**Bu dosya ne değildir:** "Dünyada bundan sonra hiçbir yeni teknoloji çıkmayacak" iddiası değildir.  
**Bu dosya neyi garanti etmeyi hedefler:** Yeni teknoloji/araç/cihaz/sector geldiğinde core mimariyi yeniden doğurmadan mevcut primitive + adapter + resource + domain-pack + certification modeliyle sisteme eklenebilmesi.

---

# 0. Kapanış noktası

UASCO mimari olarak ancak şu koşul sağlandığında **CORE ARCHITECTURE FROZEN** sayılır:

> Bilinen tüm yazılım yaşam döngüsü ihtiyaçları canonical primitive'lere ayrılmıştır; bilinmeyen gelecekteki ihtiyaçların çoğu Tool Adapter, Resource Kind, Skill, Domain Pack, Mission Blueprint veya Plugin olarak eklenebilir; kritik trust/authority/evidence/safety kuralları bu extension'ların tamamına otomatik uygulanır.

Bundan sonra yeni bir şey bulunduğunda sınıflandırma:

1. **Var olan primitive + yeni adapter** → core değişmez.
2. **Var olan primitive + yeni resource/provider** → core değişmez.
3. **Yeni domain bilgisi/obligation** → Domain Pack.
4. **Yeni workflow kombinasyonu** → Mission Blueprint.
5. **Yeni skill/toolchain** → Skill/Toolchain Registry.
6. **Gerçekten yeni fundamental primitive** → yalnız o zaman architecture reopen.

Bu dosyadaki kapanıştan sonra "BrowserStack'i unutmuşuz", "yeni database çıktı", "başka CI geldi", "yeni model provider çıktı" gibi şeyler yeni ZIP sebebi değildir.

---

# 1. Sistem kimliği

**UNIVERSAL AI SOFTWARE COMPANY OS**

Kalıcı fiiller:

`UNDERSTAND -> ASSURE -> DESIGN -> BUILD -> OPERATE -> REPAIR -> LEARN -> REPORT`

Sistem:
- yeni ürün tasarlar ve üretir,
- mevcut yazılımı anlar,
- test eder,
- yetkili güvenlik değerlendirmesi yapar,
- performans/resilience analizi yapar,
- düzeltir ve retest eder,
- deploy/operate/observe eder,
- müşteri/business süreçlerini yönetir,
- kanıt üretir,
- doğrulanmış deneyimlerden öğrenir,
- bilinmeyen capability'leri keşfeder ve kontrollü biçimde ekler.

**Human Founder nihai otoritedir.**

---

# 2. Canonical Fundamental Primitives

Aşağıdaki primitive'ler artık core'un kapalı temel sözlüğüdür.

## 2.1 Authority / Identity
1. Human Identity
2. Service Identity
3. Worker Identity
4. Agent Identity
5. Role
6. Permission
7. Authority Scope
8. Approval
9. Break-Glass Grant
10. Session / Authentication Context

## 2.2 Business Boundary
11. Customer
12. Tenant / Workspace
13. Engagement
14. Contract
15. SLA
16. Project
17. Target
18. Asset Ownership / Rights

## 2.3 Work / Execution
19. Mission
20. Task
21. Workflow
22. Queue Item
23. Action
24. Side Effect
25. Compensation
26. Environment
27. Deployment
28. Release

## 2.4 Capability / Agent / Tool
29. Capability
30. Agent Role
31. Agent Contract
32. Skill
33. Tool
34. Tool Adapter
35. Provider Adapter
36. Resource
37. Worker
38. Lease
39. Domain Pack
40. Plugin / Extension
41. Mission Blueprint

## 2.5 AI / Context
42. Model Provider
43. Model
44. Provider Entitlement
45. Prompt Version
46. Context Bundle
47. Model Call
48. Model Evaluation
49. Reviewer Contribution
50. Model/Source Lineage

## 2.6 Requirements / Architecture
51. Requirement
52. Assumption
53. Invariant
54. Decision / ADR
55. Design Artifact
56. Architecture Constraint
57. Trace Link
58. Compatibility Contract
59. Deprecation Contract

## 2.7 Truth / Quality
60. Test
61. Check
62. Finding
63. Defect
64. Evidence
65. Artifact
66. Attestation
67. Review
68. Certification
69. Benchmark Case
70. Holdout Case
71. Coverage Statement
72. Unknown / Unverified Surface

## 2.8 Knowledge / Learning
73. Knowledge Item
74. Source
75. Lesson
76. Experience
77. Hypothesis
78. Conflict
79. Freshness
80. Recertification Trigger
81. Revocation

## 2.9 Data / Security
82. Data Asset
83. Data Classification
84. Data Route
85. Secret
86. Cryptographic Key
87. Certificate / Signing Identity
88. DLP Finding
89. Retention Rule
90. Residency Rule
91. Legal Hold
92. Deletion / Erasure Request

## 2.10 Operations
93. Event
94. Audit Event
95. Log
96. Metric
97. Trace
98. Incident
99. Problem
100. Runbook
101. Backup
102. Restore Point
103. Recovery Objective
104. Migration
105. Drift Finding

## 2.11 Economics / Scheduling
106. Cost Event
107. Budget
108. Quota
109. Deadline
110. Priority
111. Portfolio Schedule
112. Resource Allocation

## 2.12 Communication / Output
113. Notification
114. Escalation
115. Message
116. Report
117. Export Bundle
118. Customer Delivery
119. Translation / Localization Unit
120. Terminology Entry

## 2.13 Time / Version / Provenance
121. Canonical Time
122. Version
123. Schema Version
124. State Generation
125. Commit
126. Build
127. Dependency
128. SBOM Component
129. Provenance Record
130. Chain-of-Custody Record

**Closure rule:** Yeni bir özellik önce bu primitive'lerden birine bağlanır. Bağlanamıyorsa core primitive gerçekten eksik olabilir.

---

# 3. En son ZIP'te eksik/first-class olmayan ve final ZIP'e eklenmesi gereken trust sistemleri

Aşağıdakiler final ZIP'te açık first-class sistem olmalıdır.

## 3.1 UASCO Identity, Authentication & RBAC
Factory'nin kendisi için:
- Founder authentication
- local desktop lock/unlock
- Admin / Operator / Reviewer / Viewer / Customer roles
- RBAC + gerektiğinde ABAC
- service/worker identities
- session expiry/revocation
- step-up authentication
- future multi-user support
- break-glass
- customer-scoped access
- service-to-service authorization

## 3.2 Authority Non-Repudiation & Approval Lifecycle
Approval:
- kimin verdiği,
- hangi action/mission/commit için olduğu,
- ne zaman verildiği,
- ne zamana kadar geçerli olduğu,
- hedef değişirse invalidation,
- approval revocation,
- Risk-5 için güçlü provenance,
- opsiyonel two-person rule.

`approved=true` bir authority kanıtı değildir.

## 3.3 Universal Action / Side-Effect Gateway
Dış dünyayı değiştiren her eylem sınıflandırılır:

- READ_ONLY
- MUTATION
- EXTERNAL_COMMUNICATION
- SPEND
- PRODUCTION_CHANGE
- DESTRUCTIVE
- IRREVERSIBLE
- LEGAL/FINANCIAL_AUTHORITY

Action Gateway zorunlulukları:
- policy evaluation
- customer/scope check
- idempotency
- dry-run mümkünse dry-run
- budget check
- approval check
- audit event
- execution evidence
- timeout/retry policy
- compensation/rollback
- post-condition verification

Agent doğrudan production/tool mutation yapmamalı.

## 3.4 Compensating Transaction / Saga Ledger
Multi-step external işlemlerde:
- hangi adım tamamlandı,
- hangi adım başarısız,
- hangi rollback/compensation var,
- compensation başarısızsa Founder attention,
- duplicate replay protection.

## 3.5 Untrusted Content & Prompt-Injection Firewall
Aşağıdakiler **DATA**, talimat değildir:
- repo source/comments
- README
- issue/PR
- web page
- PDF/doc
- email
- log
- tool output
- MCP/plugin response
- external research
- customer file
- model-generated untrusted intermediate content

Instruction hierarchy ayrı tutulur.
External content:
- policy değiştiremez,
- secret isteyemez,
- tool permission veremez,
- Founder otoritesi taklit edemez.

## 3.6 Learning / Memory Poisoning Defense
Lesson/knowledge promotion:
- source provenance
- evidence threshold
- customer sanitization
- conflict check
- independent validation
- expiry/freshness
- certification
- revocation
- rollback of poisoned knowledge
- blast-radius analysis.

## 3.7 Certification Dependency & Invalidation Graph
Bir dependency/model/tool/policy/schema değiştiğinde:
- hangi capability certified idi,
- hangileri STALE oldu,
- hangi targeted re-eval gerekir,
- transitive invalidation,
- recertification queue.

## 3.8 Provider Entitlement / Terms / Commercial-Use Registry
Her provider/tool için:
- account/subscription type
- API vs consumer entitlement
- commercial use
- automation allowance
- customer-data allowance
- retention/training policy
- region/residency
- rate/quota
- pricing basis
- terms/license version
- effective date
- last revalidated
- REVIEW_REQUIRED when terms change.

Subscription erişimi generic API credit sayılmaz.

## 3.9 Reviewer Independence & Common-Mode Risk Graph
Independent review yalnız "başka model adı" değildir.

Takip:
- builder contributors
- reviewer model/provider
- underlying family when known
- shared generated patch
- shared sources
- shared prompt/context
- shared tool outputs
- conflict-of-interest score

Independence yeterli değilse review sonucu `INDEPENDENCE_INSUFFICIENT`.

## 3.10 Benchmark Integrity / Holdout Suite
Golden Projects:
- public regression set
- private holdout set
- rotated defects
- contamination detection
- unseen evaluation
- benchmark versioning
- leakage detection.

Agent benchmark sorularını ezberleyerek certified olamaz.

## 3.11 Requirement / Decision / Design / Code Traceability
Canonical chain:

`INTENT -> REQUIREMENT -> ASSUMPTION/DECISION -> DESIGN -> CODE -> TEST -> EVIDENCE -> RELEASE`

Her kritik requirement'ın:
- implementation links
- test links
- evidence links
- owner
- status
- supersession/history

bulunmalı.

## 3.12 Policy Verification & Policy Regression
Policy değişikliği:
- fixtures
- positive tests
- negative tests
- simulation
- diff
- independent review
- affected-policy graph
- rollback.

Policy kendi kendine güvenilir kabul edilmez.

## 3.13 Configuration / Runtime Drift Detector
Compare:
`EXPECTED STATE (Git/registry/policy) vs ACTUAL RUNTIME`

Kapsam:
- worker config
- provider config
- cloud config
- desktop config
- installed tool versions
- model routing
- permissions
- secrets metadata
- customer environment.

## 3.14 Agent Contract Runtime
363 agent rolünün her biri için runtime contract:

- role ID
- skills
- allowed tools
- denied tools
- permissions
- customer scope
- project/mission scope
- model policy
- data policy
- context policy
- risk ceiling
- cost ceiling
- timeout
- output contract
- quality gates
- activation rule
- lifecycle state
- certification state
- current lease/task
- audit/evidence policy.

## 3.15 Prompt / Model / Context Provenance
Her AI action:
- prompt ID/version/digest
- system/developer policy version
- model ID/version
- provider
- routing decision
- context file/hash list
- tool set
- temperature/seed when applicable
- response digest
- cost/tokens
- time
- agent/mission/task
- downstream artifacts.

## 3.16 Encrypted Vault / Key Management
- encryption at rest
- OS keychain/TPM/secure store integration
- master key lifecycle
- scoped secret access
- short-lived credentials
- rotation
- revoke
- backup encryption
- recovery key policy
- no secrets in logs/model prompts
- customer-specific secret namespace.

## 3.17 Universal DLP / Redaction Gateway
DLP before:
- model context
- provider request
- report
- screenshot
- HAR
- network trace
- log export
- crash dump
- video
- PDF
- customer delivery
- support/communication.

Detect/redact:
credentials, tokens, PII, financial information, customer confidential patterns.

## 3.18 Mission Portfolio Scheduler
Across customers/missions:
- SLA/deadline
- priority
- revenue/customer importance
- risk
- worker/resource availability
- model quota
- cost budget
- fairness
- starvation prevention
- preemption rules
- maintenance windows.

## 3.19 Business Back-Office Runtime
"Software Company OS" yalnız technical factory değildir.

Minimum real runtime:
`LEAD -> QUALIFICATION -> PROPOSAL -> CONTRACT -> ENGAGEMENT -> MISSION/PROJECT -> TIME/COST -> INVOICE -> PAYMENT/RECONCILIATION -> SUPPORT -> RENEWAL/OFFBOARDING`

AI:
- analiz/öneri yapabilir,
- hukuki/vergi/finansal kesin hüküm vermez,
- kritik dış execution authority gate'ten geçer.

## 3.20 UASCO Self-Update / Signed Release Channel
UASCO'nun kendisi:
- dev/beta/stable channels
- signed builds
- update manifest
- compatibility check
- state/schema migration
- pre-update backup
- rollback
- downgrade policy
- release evidence
- update pause/kill
- recovery from failed update.

## 3.21 Evidence Export / Customer Handoff Standard
Canonical bundle:
- signed report
- manifest
- hashes
- findings
- remediation/retest status
- screenshots/video
- traces/log excerpts
- SBOM/provenance when relevant
- environment/device/tool versions
- reviewed commit
- redaction metadata
- verification status
- unknown/unverified list.

## 3.22 Archival / Retention / Legal Hold / Erasure
Lifecycle:
hot -> warm -> cold -> archive -> delete.

Rules:
- customer retention
- legal hold
- security incident hold
- audit retention
- encrypted archive
- index compaction
- customer export
- customer offboarding
- privacy deletion
- cryptographic erasure where applicable.

---

# 4. Ek kapanışta eklenmesi gereken distributed/runtime güven sistemleri

## 4.1 Trusted Time & Clock Semantics
- UTC canonical storage
- timezone presentation
- monotonic timers for durations
- clock-skew detection
- timestamp provenance
- expiry semantics
- DST testing
- NTP/time health where relevant.

## 4.2 Event Ordering / Idempotency / Outbox
- idempotency keys
- deduplication
- transactional outbox/inbox where needed
- event generation/version
- at-least-once handling
- no fake exactly-once claims
- replay safety.

## 4.3 Durable Queue Reliability
- priority
- fairness
- starvation protection
- visibility timeout/lease
- retry budget
- exponential backoff/jitter
- dead-letter queue
- poison-message detection
- retry-storm guard
- cancellation.

## 4.4 Worker Identity / Zero-Trust Remote Execution
- worker identity
- enrollment
- attestation
- mTLS or equivalent
- capability declaration
- version/fingerprint
- customer isolation
- network egress policy
- revocation/quarantine
- remote command scope.

## 4.5 Network Egress Control
Sandbox/workers:
- default-deny or explicit policy
- domain/IP allowlist when required
- DNS policy
- proxy policy
- customer-specific egress
- exfiltration guard
- external call logging.

## 4.6 Plugin / Adapter Supply-Chain Trust
Plugins/adapters:
- signed manifest where possible
- provenance
- dependency scan
- permission declaration
- sandbox
- version pin
- compatibility
- trust store
- revocation
- quarantine
- certification.

## 4.7 Schema / State Migration Framework
Her persistent schema:
- semantic version
- forward migration
- backward compatibility policy
- backup-before-migration
- rollback or explicit irreversible gate
- migration test fixtures
- old-state import
- corruption recovery.

## 4.8 Reproducibility / Randomness Control
Test/build/eval:
- environment fingerprint
- dependency lock
- seed capture when possible
- non-determinism metadata
- rerun/replay support
- reproducible build target.

## 4.9 Customer Offboarding
- stop active missions
- revoke credentials
- export requested data/evidence
- retention/legal hold evaluation
- delete/cryptographically erase eligible data
- remove workers/resources/access
- archive financial/legal records as required
- issue completion receipt.

## 4.10 UASCO UI Quality
Control Tower itself must be:
- accessible
- keyboard usable
- localization-ready
- global-searchable
- explainable
- responsive to degraded/offline states
- safe against accidental destructive clicks
- clear about VERIFIED vs UNKNOWN.

---

# 5. Existing Execution/Domain Coverage that remains mandatory

Final ZIP must retain all previously frozen coverage.

## 5.1 Execution Fabrics
- Repository Intelligence & Context
- Polyglot Language/Build Toolchains
- Source Control / Workspace
- Browser/Web
- Mobile Device
- Desktop/OS
- Test Environment/Sandbox/Digital Twin
- Network/Protocol
- Identity/Access test lab
- Messaging/Notification
- Data/DB/Storage
- Cloud/Infrastructure
- Security Engineering
- Performance/Profiling
- Observability/Diagnostics/Forensics
- File/Document/Content
- Accessibility
- Localization/Globalization
- Payment/FinTech
- AI/ML/LLM Assurance
- CI/CD/SCM/Work Management
- Release/Distribution/Store
- Legacy/Enterprise
- Embedded/IoT/Hardware
- XR/3D/Media
- Game Execution/Device
- Blockchain/Smart Contract
- GIS/Location
- Safety-Critical/Formal Verification
- Scientific/Numeric Correctness
- Service Virtualization/Mocking
- Package/Dependency/Artifact Ecosystem
- PKI/Certificate/Key Lifecycle
- Untrusted Artifact Quarantine
- Product Analytics/Experimentation
- Search/Ranking/Recommendation
- Collaboration/Workspace Communications
- Customer Secure Intake/Portal
- RPA/External Business Operations
- Voice/Meeting/Transcription
- Air-Gapped/On-Prem/VPC
- Durable Workflow/Queue/Backpressure
- Symbol/Sourcemap/Crash Symbolication
- Reproducible Build/Artifact Cache
- Trusted Time/Chain-of-Custody

## 5.2 Device / Browser
- local Android ADB/Appium/UiAutomator2
- Android emulator
- macOS iOS worker/XCUITest/Appium
- iOS simulator
- BrowserStack
- Sauce Labs
- LambdaTest
- Firebase Test Lab
- AWS Device Farm
- Kobiton/Perfecto adapter slots
- Playwright/Selenium
- Chrome/Edge/Firefox
- Safari/macOS
- WebView/PWA
- browser extensions.

## 5.3 Polyglot
- JS/TS
- Python
- Java/Kotlin
- .NET/C#
- Go
- Rust
- C/C++
- Swift/Objective-C
- Dart/Flutter
- PHP
- Ruby
- Scala
- Elixir/Erlang
- Shell/PowerShell
- SQL.

## 5.4 Domain Packs
- SaaS/Enterprise
- Commerce/Marketplace
- FinTech/Banking
- Capital Markets
- Insurance
- Aviation/Aerospace
- Automotive
- Healthcare/Medical Software
- Telecom
- Public Sector
- Streaming/Media
- Industrial/Manufacturing
- IoT/Embedded
- Gaming/MMORPG
- Blockchain
- Education
- Logistics/Supply Chain
- Energy/Utilities
- Travel/Hospitality
- PropTech/Real Estate
- LegalTech
- HRTech.

---

# 6. Canonical 363-Agent model

Existing stable IDs **001–363 korunur ve yeniden numaralandırılmaz**.

Rule:
`REGISTER EVERYTHING. ACTIVATE ONLY WHAT THE MISSION NEEDS.`

Agent != model.

Agent runtime identity:

`ROLE + SKILLS + MISSION CONTEXT + DOMAIN PACK + EXPERIENCE + TOOLS + PERMISSIONS + POLICIES + MODEL POLICY + COST POLICY + RISK CEILING + QUALITY GATES`

Lifecycle:

`CANDIDATE -> REGISTERED -> TRAINING -> EVALUATION -> CERTIFIED -> ACTIVE -> MONITORED -> RESTRICTED -> RECERTIFICATION -> ACTIVE/RETIRED`

Activation runtime:

`REGISTERED/DORMANT -> ACTIVATED -> WORKING -> REVIEWING -> DONE -> DORMANT`

Dynamic specialist guilds may be added without breaking stable 363 IDs.

---

# 7. Universal Action Rules

1. Read does not imply write.
2. Write does not imply production write.
3. Test credentials do not imply customer-admin authority.
4. Repo access does not imply cloud access.
5. Cloud access does not imply billing authority.
6. Billing visibility does not imply spend authority.
7. Security assessment authorization is target/scope/time/technique specific.
8. Approval is bound to exact action/target/version.
9. Changed target invalidates stale approval.
10. External communication may require customer/brand policy.
11. Payment/financial execution is high-risk.
12. Destructive action defaults deny.
13. Irreversible action requires explicit gate.
14. Retry of side-effect requires idempotency/duplicate analysis.
15. Partial external workflow requires compensation or manual recovery plan.
16. Every side effect produces audit/evidence.

---

# 8. Universal Truth / Evidence Rules

1. Claim != Evidence.
2. Test source != Test execution.
3. Screenshot != full correctness.
4. Green UI != system PASS.
5. Model confidence != proof.
6. Folder != implementation.
7. Registry row != implementation.
8. Prompt != implementation.
9. Finding != confirmed defect until evidence threshold.
10. Fix != verified remediation until regression/retest.
11. Review text != independent attestation unless provenance holds.
12. Customer approval field != authority.
13. "No finding" != "secure".
14. "Not tested" must remain visible.
15. Unknown surfaces must be reported.
16. Every critical evidence item binds to run/commit/environment/tool/resource/time.
17. Evidence can be invalidated by changed dependency/environment/version.
18. Evidence/export must obey DLP/redaction.

---

# 9. Universal Data & Privacy Rules

1. Customer data default-isolated.
2. Secrets never treated as ordinary context.
3. PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED/PII/FINANCIAL/SECRET classification.
4. Model route depends on data class.
5. Free provider does not imply safe provider.
6. DLP before egress/export.
7. Customer-specific memory does not become global memory without sanitization.
8. Retention policy explicit.
9. Residency requirements explicit.
10. Legal hold blocks deletion.
11. Customer offboarding has export/revoke/delete workflow.
12. Backups encrypted.
13. Backup retention follows same data policy.
14. Logs/traces/screenshots may contain sensitive data and are classified.
15. Dataset/training/eval provenance explicit.

---

# 10. Universal AI/Model Rules

1. Cheapest capable approved mechanism first.
2. Deterministic tool before model when possible.
3. Provider health/quota/cost/data policy checked before route.
4. Paid fallback never silent.
5. Consumer subscription != API credit.
6. Model/version/provider provenance captured.
7. Prompt version captured.
8. Context digest captured.
9. Tool set captured.
10. Reviewer independence checked.
11. Model output is untrusted proposal until validated when action-critical.
12. Tool/model output can contain prompt injection.
13. Model/provider terms change can invalidate route.
14. Model quality drift triggers evaluation.
15. Fallback must preserve data/security constraints.
16. Local model does not automatically equal trustworthy model.

---

# 11. Universal Research / External Source Rules

1. External text/code is untrusted.
2. Research workspace separated from builder context.
3. Raw external source is not silently copied.
4. Dependency use follows license/provenance.
5. Source hierarchy prefers official/standards.
6. Claims retain citations/provenance.
7. Conflicting sources are recorded.
8. Knowledge freshness monitored.
9. Unsafe executable artifacts quarantined.
10. Research cannot grant permissions.

---

# 12. Universal Quality Rules

Every applicable mission considers:
- happy path
- negative/edge
- state transitions
- concurrency
- idempotency
- auth/authz
- business rules
- data integrity
- failure recovery
- observability
- compatibility
- accessibility
- localization/timezone
- performance/capacity
- security
- privacy
- dependency/supply chain
- deployment/config
- backup/recovery
- upgrade/downgrade
- unknown/coverage gaps.

Testing techniques:
- unit
- integration
- contract
- E2E
- property-based
- fuzz
- mutation
- metamorphic where relevant
- differential
- static analysis
- dynamic analysis
- formal/model checking where justified.

---

# 13. Universal Operations Rules

1. Every critical service/resource has health.
2. Health != correctness.
3. SLO/SLI where appropriate.
4. Resource/quota/cost telemetry.
5. Runbooks versioned.
6. Incident severity taxonomy.
7. Timeline and root cause evidence.
8. Backup has restore drill.
9. RPO/RTO explicit for critical state.
10. Drift detection.
11. Capacity planning.
12. graceful degradation/offline modes.
13. feature kill/pause.
14. rollout/rollback.
15. schema/state migration.
16. release provenance.
17. failure notification/escalation.

---

# 14. Universal Supply-Chain Rules

1. Dependency inventory.
2. SBOM.
3. vulnerability status.
4. license status.
5. provenance.
6. digest/signature where available.
7. pinned/controlled versions where required.
8. dependency update verification.
9. plugin/adapter permission manifest.
10. plugin quarantine/revocation.
11. build provenance.
12. VEX-like status support where useful.
13. generated assets/fonts/icons/templates also have rights/provenance.

---

# 15. Self-Learning Rules

Self-learning is not self-trusting.

Lesson promotion needs:
- linked evidence
- dedupe
- conflict check
- source/customer sanitization
- validation
- independent review where critical
- certification
- scope
- version
- expiry
- recertification trigger.

Learning can propose:
requirements, tests, policies, heuristics, architecture rules, tool adapters, domain-pack updates.

Learning cannot:
grant authority, approve spending, self-certify, weaken policy, bypass DLP, silently mutate core constitution.

---

# 16. Business OS Closure

Required subsystems:
- CRM
- lead
- qualification
- proposal/quotation
- contract/engagement
- customer onboarding
- portfolio
- project/mission costing
- SLA
- time/resource cost
- billing/invoice
- reconciliation
- profitability
- support/ticketing
- customer success/renewal
- vendor/procurement
- finance/FP&A
- legal/regulatory routing
- offboarding.

Critical legal/tax/regulated decisions retain human/professional escalation.

---

# 17. Control Tower Closure

Required views:
- Dashboard
- Missions
- Portfolio
- Customers
- Projects
- Targets
- Departments
- Agents
- Agent Contracts
- Tasks/Runs
- Resources/Leases
- Workers
- Labs
- Tool Adapters
- Providers/Models
- Costs/Quotas
- Software Intelligence
- Requirements/Traceability
- Design Studio
- QA
- Security
- Performance
- Mobile Device Lab
- Browser Lab
- Game Intelligence
- Game Studio
- Evidence
- Artifacts
- Findings
- Reports
- Problems/Incidents
- Knowledge/Lessons
- Research
- Approvals
- Decisions/ADRs
- Policies
- Deployments/Releases
- Backups/Recovery
- Audit
- Global Communications
- Business OS
- Settings
- Global Stop.

Global UX requirements:
- global search
- command palette
- accessibility
- localization
- offline/degraded indication
- verified/unknown distinction
- causal links "why did this happen?"
- no deceptive green state.

---

# 18. Canonical Lifecycle Catalog

## Mission
DRAFT -> PREFLIGHT -> AUTHORIZED -> PLANNED -> EXECUTING -> VERIFYING -> REVIEWING -> REMEDIATING -> REGRESSION -> REPORTING -> COMPLETE
Alternative: BLOCKED / PAUSED / ABORTED / FOUNDER_ATTENTION_REQUIRED.

## Requirement
PROPOSED -> CLARIFIED -> ACCEPTED -> IMPLEMENTING -> IMPLEMENTED -> VERIFIED -> RELEASED
Alternative: REJECTED / DEFERRED / SUPERSEDED / DEPRECATED.

## Capability
DISCOVERED -> REGISTERED -> PLANNED -> IMPLEMENTING -> IMPLEMENTED -> TESTED -> VERIFIED -> CERTIFIED -> ACTIVE -> STALE -> RECERTIFICATION / RETIRED.

## Agent
CANDIDATE -> REGISTERED -> TRAINING -> EVALUATION -> CERTIFIED -> ACTIVE -> MONITORED -> RESTRICTED -> RECERTIFICATION -> RETIRED.

## Tool Adapter
DISCOVERED -> RESEARCHED -> SANDBOXED -> IMPLEMENTED -> TESTED -> SECURITY_REVIEWED -> CERTIFIED -> ACTIVE -> DEGRADED / QUARANTINED / STALE / RETIRED.

## Provider/Model
REGISTERED -> ENTITLEMENT_CHECKED -> DATA_POLICY_CHECKED -> HEALTHY -> ACTIVE -> DEGRADED / QUOTA_LIMITED / TERMS_REVIEW_REQUIRED / QUARANTINED / RETIRED.

## Resource
DISCOVERED -> ENROLLED -> HEALTH_CHECKED -> READY -> LEASED -> BUSY -> RELEASED -> READY
Alternative: DEGRADED / QUARANTINED / OFFLINE / RETIRED.

## Finding
CANDIDATE -> REPRODUCED -> CONFIRMED -> TRIAGED -> REMEDIATING -> RETESTING -> VERIFIED_FIXED -> CLOSED
Alternative: FALSE_POSITIVE / ACCEPTED_RISK / DEFERRED / DUPLICATE.

## Knowledge
UNKNOWN -> DISCOVERED -> RESEARCHING -> RESEARCHED -> CORROBORATED -> VALIDATED -> CERTIFIED -> ACTIVE -> STALE -> RECERTIFICATION
Alternative: REJECTED / SUPERSEDED / REVOKED.

## Lesson
CANDIDATE -> EVIDENCE_LINKED -> DEDUPED -> CONFLICT_CHECKED -> VALIDATED -> REVIEWED -> CERTIFIED -> ACTIVE -> STALE / REVOKED.

## Approval
REQUESTED -> VERIFIED_IDENTITY -> GRANTED -> ACTIVE -> USED / EXPIRED / REVOKED / INVALIDATED.

## Evidence
CREATED -> HASHED -> LINKED -> VALIDATED -> ACCEPTED -> STALE / INVALIDATED / ARCHIVED.

## Release
CANDIDATE -> VALIDATING -> REVIEWED -> SIGNED -> STAGED -> DEPLOYING -> VERIFIED -> STABLE
Alternative: ROLLED_BACK / WITHDRAWN.

## Incident
DETECTED -> TRIAGED -> MITIGATING -> STABILIZED -> ROOT_CAUSE -> REMEDIATED -> VALIDATED -> POSTMORTEM -> CLOSED.

---

# 19. Canonical Schema Catalog

Final ZIP should include at minimum schemas/definitions for:

## Identity / Authority
1. human-identity.schema.json
2. service-identity.schema.json
3. worker-identity.schema.json
4. role.schema.json
5. permission.schema.json
6. auth-session.schema.json
7. approval-request.schema.json
8. approval-attestation.schema.json
9. break-glass.schema.json

## Customer / Business Boundary
10. customer.schema.json
11. workspace.schema.json
12. engagement.schema.json
13. contract-scope.schema.json
14. sla.schema.json
15. project.schema.json
16. target.schema.json
17. asset-rights.schema.json

## Mission / Work
18. mission.schema.json
19. mission-plan.schema.json
20. mission-blueprint.schema.json
21. task.schema.json
22. workflow.schema.json
23. action-request.schema.json
24. action-result.schema.json
25. side-effect.schema.json
26. compensation.schema.json
27. environment.schema.json

## Agent / Capability / Tool
28. capability.schema.json
29. agent-role.schema.json
30. agent-contract.schema.json
31. agent-run.schema.json
32. skill.schema.json
33. tool.schema.json
34. tool-adapter.schema.json
35. plugin-manifest.schema.json
36. domain-pack.schema.json
37. resource.schema.json
38. lease.schema.json
39. worker.schema.json
40. health.schema.json

## Model / AI
41. provider.schema.json
42. provider-entitlement.schema.json
43. model.schema.json
44. model-routing-policy.schema.json
45. prompt-version.schema.json
46. context-bundle.schema.json
47. model-call.schema.json
48. model-evaluation.schema.json
49. reviewer-independence.schema.json

## Requirements / Traceability
50. requirement.schema.json
51. assumption.schema.json
52. invariant.schema.json
53. adr.schema.json
54. design-artifact.schema.json
55. trace-link.schema.json
56. compatibility-contract.schema.json
57. deprecation.schema.json

## Evidence / Quality
58. test-run.schema.json
59. finding.schema.json
60. evidence.schema.json
61. artifact.schema.json
62. attestation.schema.json
63. review.schema.json
64. certification.schema.json
65. benchmark-case.schema.json
66. holdout-suite.schema.json
67. coverage-statement.schema.json
68. unknown-surface.schema.json
69. report-manifest.schema.json
70. evidence-export.schema.json

## Data / Security
71. data-classification.schema.json
72. data-routing.schema.json
73. secret-metadata.schema.json
74. key-metadata.schema.json
75. certificate.schema.json
76. dlp-event.schema.json
77. retention-rule.schema.json
78. residency-rule.schema.json
79. legal-hold.schema.json
80. erasure-request.schema.json
81. authorization-scope.schema.json
82. security-assessment-contract.schema.json

## Knowledge / Learning
83. source-provenance.schema.json
84. knowledge-item.schema.json
85. lesson.schema.json
86. conflict.schema.json
87. freshness.schema.json
88. recertification-trigger.schema.json
89. revocation.schema.json

## Operations
90. event.schema.json
91. audit-event.schema.json
92. incident.schema.json
93. problem.schema.json
94. runbook.schema.json
95. backup.schema.json
96. restore.schema.json
97. recovery-objective.schema.json
98. migration.schema.json
99. drift-finding.schema.json
100. release.schema.json
101. deployment.schema.json
102. notification.schema.json
103. escalation.schema.json

## Economics / Portfolio
104. cost-event.schema.json
105. budget.schema.json
106. quota.schema.json
107. portfolio-priority.schema.json
108. schedule.schema.json

## Version / Supply Chain
109. schema-version.schema.json
110. state-migration.schema.json
111. dependency.schema.json
112. sbom-component.schema.json
113. provenance.schema.json
114. chain-of-custody.schema.json
115. license-decision.schema.json

## Business OS
116. lead.schema.json
117. proposal.schema.json
118. invoice.schema.json
119. payment-reconciliation.schema.json
120. support-ticket.schema.json
121. customer-offboarding.schema.json.

---

# 20. Canonical Registry Catalog

Final repo should have machine-readable registries for:

- agents
- agent contracts
- skills
- capabilities
- capability dependencies
- meta/core systems
- execution fabrics
- execution binders
- resource kinds
- resources
- workers
- tool adapters
- providers
- models
- provider entitlements
- polyglot toolchains
- mission types
- mission blueprints
- domain packs
- policies
- requirements
- invariants
- ADRs
- schemas
- prompts
- benchmarks
- holdout suites
- certifications
- third-party dependencies
- licenses
- asset rights
- data classes
- data routing rules
- DLP detectors/rules
- retention/residency rules
- notification/escalation routes
- report templates
- release channels
- migrations
- extension trust store
- customer workspaces
- SLAs
- cost/budget policies.

---

# 21. Acceptance Suite Catalog

Before production release, UASCO itself must pass:

1. Constitution/Policy Acceptance
2. Authority/RBAC Acceptance
3. Customer Isolation Acceptance
4. Secret/Vault Acceptance
5. DLP/Egress Acceptance
6. Mission Lifecycle Acceptance
7. Action/Side-Effect Acceptance
8. Resource/Lease/Scheduler Acceptance
9. Worker Zero-Trust Acceptance
10. Provider/Entitlement/Data-Routing Acceptance
11. Builder/Reviewer Independence Acceptance
12. Evidence/Attestation Integrity Acceptance
13. Requirement Traceability Acceptance
14. Policy Regression Acceptance
15. Learning Poisoning/Revocation Acceptance
16. Certification Invalidation Acceptance
17. Benchmark/Holdout Integrity Acceptance
18. Schema Migration/Backward Compatibility Acceptance
19. Drift Detection Acceptance
20. Backup/Restore/RPO/RTO Acceptance
21. Queue/Retry/DLQ/Crash-Recovery Acceptance
22. Plugin/Adapter Supply-Chain Acceptance
23. Repository Context/Token-Economy Acceptance
24. Desktop Accessibility/Localization Acceptance
25. Self-Update/Rollback Acceptance
26. Customer Export/Offboarding Acceptance
27. Business OS End-to-End Acceptance
28. Air-Gapped/Offline Acceptance
29. Security Abuse Acceptance
30. Golden Project Suite
31. Representative Web Project
32. Representative Mobile Project with physical device
33. Representative Desktop Project
34. Representative API/Data Project
35. Representative Game Project
36. Representative IoT/Hardware Project
37. Authorized Security Assessment
38. Performance/Load Mission
39. Incident/Recovery Drill
40. Full independent final review.

---

# 22. Golden / Holdout validation matrix

At least these seeded failure families:

- auth bypass
- broken object authorization
- multi-tenant leakage
- race condition
- replay/idempotency
- stale cache
- DB integrity
- migration failure
- partial workflow
- notification duplicate/loss
- payment precision
- refund/reconciliation
- secret leak
- dependency vulnerability
- prompt injection
- poisoned knowledge
- malicious plugin
- provider terms mismatch
- DLP failure
- backup restore failure
- clock skew/expiry
- retry storm
- queue starvation
- dead-letter handling
- schema migration corruption
- mobile lifecycle crash
- device permission bug
- browser compatibility bug
- accessibility failure
- localization/RTL/timezone
- desktop updater failure
- game state/economy duplication
- performance regression
- memory/resource leak
- observability blind spot
- evidence tampering
- review independence violation.

---

# 23. Architecture Fitness Functions

CI/Factory continuously verifies:

- no unregistered authority path
- no production mutation bypassing Action Gateway
- no SECRET route to disallowed providers
- no active adapter without certification
- no active resource without health/identity
- no certified capability with stale dependency certification
- no CLOSED finding without retest evidence
- no milestone closure without independent review
- no customer cross-boundary reference
- no secret in committed files
- no generated external-source copy without provenance/license decision
- no schema breaking change without migration/version
- no release without evidence manifest
- no approval valid after bound target changed
- no unreviewed core policy change
- no learning promotion without evidence/certification
- no side-effect retry without idempotency/compensation policy
- no long-running workflow without durable checkpoint.

---

# 24. Definition of Architectural Closure

The architecture is **CLOSED/FROZEN** when:

1. 130 primitives above have stable IDs/names.
2. Their schemas exist or are explicitly scheduled in Phase 0–Core phases.
3. Trust systems 3.x and runtime systems 4.x are part of roadmap.
4. 363 agents use Agent Contract, not free-form unlimited authority.
5. All execution fabrics map to Resource + Tool Adapter + Mission.
6. All external effects pass Action Gateway.
7. All data egress passes Data Routing + DLP.
8. All AI outputs carry Prompt/Model/Context provenance.
9. All reusable learning is certified/revocable.
10. Certification dependency graph can invalidate stale trust.
11. New tool/provider/device can be added without core rewrite.
12. New sector can be added as Domain Pack.
13. New workflow can be added as Mission Blueprint.
14. Persistent changes have version/migration policy.
15. Factory can update/rollback itself.
16. Factory can back up/restore itself.
17. Customer can be onboarded and offboarded safely.
18. Full acceptance suite exists.
19. Unknowns are reported, not hidden.
20. No architecture item is called IMPLEMENTED until runtime/test/evidence/review proves it.

At that point feature-discovery is closed and implementation becomes the only primary workstream.

---

# 25. What does NOT justify reopening architecture

These are normal extensions:
- new browser
- new phone
- new OS version
- new BrowserStack competitor
- new model provider
- new cloud
- new DB
- new programming language
- new CI tool
- new PM tool
- new payment provider
- new game engine
- new observability product
- new ticketing system
- new security scanner
- new communication service
- new customer sector.

They enter via adapter/resource/toolchain/domain-pack/plugin.

---

# 26. What MAY justify reopening architecture

Only if a future requirement:
1. cannot be represented by any existing primitive,
2. cannot be handled by adapter/resource/domain/blueprint/plugin,
3. requires a fundamentally new authority/trust/state/evidence semantic.

Even then:
- write gap report,
- prove existing primitives are insufficient,
- independent architecture review,
- Founder decision,
- version constitution/schema,
- migrate state.

---

# 27. Final implementation order principle

Do not build 130 independent microservices.

Consolidate into bounded cores:

1. **TRUST CORE** — identity, authority, policy, action gateway, secrets, DLP.
2. **MISSION CORE** — mission/workflow/task/portfolio/scheduler.
3. **STATE CORE** — persistence, events, audit, migrations, time.
4. **CAPABILITY CORE** — agents, skills, tools, plugins, resources, workers.
5. **AI CORE** — models, providers, prompts, context, evaluation, entitlements.
6. **INTELLIGENCE CORE** — repo/system genome, knowledge/research.
7. **DESIGN/BUILD CORE** — studios/toolchains/generated products.
8. **ASSURANCE CORE** — QA/security/performance/evidence/findings.
9. **OPERATIONS CORE** — observability/incidents/release/backup/recovery.
10. **BUSINESS CORE** — customers/contracts/SLA/cost/billing/support.
11. **COMMUNICATION CORE** — reports/notifications/languages/meetings.
12. **GAME/HARDWARE CORE** — game/IoT/XR specialized execution.
13. **LEARNING CORE** — lessons/certification/invalidation/recertification.
14. **CONTROL TOWER** — Founder interface and explainability.

This avoids architecture fragmentation.

---

# 28. Final verdict

Bu spesifikasyondan sonra kalan risk "başka bir ürün ismini unutmuş olmak" değildir.

Kalan riskler:
- implementation bug,
- yanlış integration,
- yetersiz test,
- yeni external provider behavior,
- yeni regulation/domain knowledge,
- unknown unknown.

Bunlar core mimariyi yeniden çizmek yerine Factory'nin discovery/certification mekanizmalarıyla yönetilir.

**Architecture discovery closure condition: SATISFIED once this specification is merged into the fresh starter and represented by schema/registry/roadmap contracts.**

Sonraki aşama:
**ZIP V2 FINAL -> install -> Phase 0 -> implementation -> deterministic validation -> Codex independent review -> Golden/holdout validation -> real-project validation.**
