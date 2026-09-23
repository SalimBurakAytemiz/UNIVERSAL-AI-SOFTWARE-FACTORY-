<!-- //TR: Bu audit UNIVERSAL-AI-SOFTWARE-COMPANY-OS-FULL-WOVEN-CANONICAL-STARTER'ın gerçek dosyaları üzerinden, özellikle hızlı kurulum, autonomous build, Claude->Codex review convergence, Git güvenliği, logging/evidence, quota/resume, roadmap scheduling ve bootstrap trust root açısından adversarial biçimde yapılmıştır. -->
> **HISTORICAL_AUDIT_NOT_CURRENT_AUTHORITY** — //TR: Bu belge geçmiş audit/specification bağlamını korur; current PASS/CLEAN/closure/release authority değildir. Current truth için `CANONICAL-STATUS.md` ve `audit/V6-FULL-SCAN-PROGRESS.json` kullanılır.
# UASCO — Mechanical Closure Red-Team Audit

## 0. Kısa hüküm

Mevcut `FULL-WOVEN-CANONICAL-STARTER` mimari ve competency açısından önceki sürümlerden çok daha güçlüdür.

Fakat **şu haliyle "kur ve 149 fazı güvenli/hızlı şekilde kendi kendine tamamlasın" seviyesinde değildir.**

Bu audit yeni framework/agent aramıyor. Şu soruyu soruyor:

> ZIP Windows makineye çıkarıldı. Founder mümkün olduğunca az manuel iş yapmak istiyor. Sistem Phase 0'dan Phase 148'e doğru hızlı, görünür, tekrar başlatılabilir, scope kontrollü, Claude builder + Codex reviewer ile ilerleyebilir mi?

Cevap bugün: **hayır, birkaç P0 mekanik blocker hâlâ var.**

---

# 1. Bu turda dosyadan doğrulanan kritik gerçekler

## 1.1 Supervisor review'den önce push ediyor

Gerçek akış:

`Claude -> validation -> commit -> push -> Codex`

Bu, canonical hedef olan:

`isolated branch/worktree -> validation -> Codex -> remediation -> CLEAN -> merge -> push`

ile çelişiyor.

Review'den geçmeyen kod remote branch'e çıkabiliyor.

---

## 1.2 Supervisor git repo yokken fail-closed değil

`clean()` yalnız `git status --porcelain` stdout'una bakıyor.

Git repo yoksa komut hata verebilir fakat stdout boş olduğu için sistem bunu "clean" kabul edebilir.

Ayrıca `START-HERE` bootstrap'tan sonra `start-full-auto` diyor; bootstrap Git repo init etmiyor.

Yani kurulum sırası mekanik olarak kilitlenmemiş.

---

## 1.3 `.ai/automation/state.json` dirty-worktree riski

Supervisor CLEAN sonrası:

`.ai/automation/state.json`

yazıyor.

`.gitignore` logs ve reviews klasörlerini ignore ediyor fakat `state.json` açıkça ignore edilmiyor.

İlk başarılı run'dan sonra ikinci run'ın:

`SUPERVISOR_STOP: worktree not clean`

ile durma riski var.

---

## 1.4 Config'de görünen güvenlik bayrakları enforce edilmiyor

`config/automation.json` içinde:

- `mode`
- `maxMilestonesPerRun`
- `allowPaidApi`
- `allowProduction`
- `allowRisk5`

var.

Gerçek supervisor kodunda:

- `maxMilestonesPerRun` kullanılmıyor.
- `allowPaidApi` kullanılmıyor.
- `allowProduction` kullanılmıyor.
- `allowRisk5` kullanılmıyor.
- `mode` kullanılmıyor.

Bunlar şu anda policy değil, dekorasyon.

Bu P0'dır.

---

## 1.5 `git add .` çok geniş

Supervisor:

`git add .`

yapıyor.

Böylece Claude'un milestone scope'u dışında değiştirdiği:

- governance
- validators
- tests
- review prompt
- configuration
- accidental local file
- yanlış artifact

aynı commit'e girebilir.

Change manifest / allowed-path / protected-path gate yok.

---

## 1.6 Builder kendi güvenlik kapılarını değiştirebilir

Claude builder `acceptEdits` ile repo üzerinde çalışıyor.

Şu dosyaları değiştirmesini mekanik olarak engelleyen trust-root guard yok:

- `ARCHITECTURE-CONSTITUTION.md`
- `CODEX.md`
- `prompts/AUTO-REVIEW.md`
- validators
- test infrastructure
- supervisor
- security policy
- Action Gateway rules
- DLP rules
- schemas
- CI gates

Dolayısıyla yanlış/zararlı bir remediation:

> testi veya validator'ı zayıflatıp PASS alabilir.

Prompt'ta "controls weaken etme" yazması mekanik güvence değildir.

Bu audit'in bulduğu en önemli P0 açıklardan biridir.

---

# 2. Codex Review Governance — mevcut durum yeterli değil

## 2.1 Blocker tanımı açık değil

Current Codex contract "reproducible current blockers" diyor fakat blocker admissibility first-class değil.

Codex bugün teorik olarak:

- best practice önerisini,
- gelecekte olabilecek bir edge case'i,
- milestone'un desteklemek zorunda olmadığı extreme scenario'yu,
- mevcut diff'in yaratmadığı eski technical debt'i

blocker yapabilir.

Bu, geçmişte yaşanan sonsuz review döngüsünü tekrar üretebilir.

---

## 2.2 Moving-goalpost önleme mekanizması yok

Cycle 1:
`F-001, F-002, F-003`

Claude düzeltir.

Cycle 2'de Codex'in aynı scope içinde durmadan:
`F-004 ... F-028`

üretmesini engelleyen machine rule yok.

Gereken:

İlk blocker seti freeze edilir.

Sonraki cycle'da yeni blocker ancak:

1. remediation regression,
2. önceki blocker tarafından maskelenmiş current blocker,
3. yeni somut critical trust/security/data-loss evidence

ise kabul edilir.

Diğer yeni fikirler `ADVISORY` olur.

---

## 2.3 BLOCKER / ADVISORY ayrımı yok

Current output:

- CLEAN
- BLOCKED

İhtiyaç:

- CLEAN
- BLOCKED
- ENVIRONMENT_BLOCKED
- REVIEW_INPUT_INVALID
- INDEPENDENCE_INSUFFICIENT
- FOUNDER_DECISION_REQUIRED

Finding sınıfı da:

- BLOCKER
- ADVISORY
- KNOWN_LIMITATION
- ENVIRONMENT_GAP

olmalı.

---

## 2.4 Structured review output yok

Supervisor şu an:

`stdout.includes("INDEPENDENT_REVIEW_RESULT: CLEAN")`

kullanıyor.

Bu yanlış pozitif üretebilir.

Örnek Codex:

> I cannot return INDEPENDENT_REVIEW_RESULT: CLEAN because...

yazarsa string hâlâ içeride.

Review JSON Schema ile parse edilmeli.

---

## 2.5 Review bundle donmuş değil

Codex'e esas olarak:

- milestone text
- reviewed commit
- diff stat

gidiyor.

Gitmesi gereken immutable bundle:

- runId
- phase/milestone ID
- reviewed commit SHA
- base commit SHA
- exact changed files
- exact impacted dependency slice
- requirements
- invariants
- phase acceptance criteria
- declared environment
- supported/unsupported cases
- deterministic test evidence
- known limitations
- accepted debt
- previous review findings
- current review cycle
- prompt/context digests.

Scope digest oluşturulmalı.

---

## 2.6 Review scope firewall yok

Codex read-only olsa bile tüm repoyu okuyabilir.

Full repo scan default olmamalı.

Scope dışına çıkmak için causal justification gerekir.

Codex:

> "Bu dosya current diff ile doğrudan etkileniyor çünkü X"

diyebilirse scope genişler.

Aksi halde advisory bile üretmemeli.

---

## 2.7 Extreme-test sınırı yok

Doğru rule:

Extreme test **yasak değildir**.

Ama blocker olabilmesi için:

- requirement,
- risk profile,
- domain obligation,
- known failure family,
- acceptance criterion

ile bağlantısı olmalıdır.

Normal local utility phase için "100 milyon concurrent user" blocker değildir.

Banking idempotency engine için race/double-spend ekstrem testi gayet blocker olabilir.

---

## 2.8 Finding schema çok zayıf

Gerçek `finding.schema.json` hâlâ pratik olarak yalnız `id` required ediyor.

BLOCKER için zorunlu olmalı:

- findingId
- classification
- severity
- category
- requirementRef/invariantRef/acceptanceRef
- currentDiffCausality
- file/symbol
- reproduction
- expected
- observed
- evidenceRefs
- blockerReason
- remediationAcceptance
- confidence
- fingerprint
- firstSeenCycle
- status.

---

## 2.9 Review schema çok zayıf

`review.schema.json` yalnız `id` required.

Review result en az:

- runId
- reviewedCommit
- baseCommit
- reviewBundleDigest
- result
- reviewer identity/model/provider/version
- independence status
- findings
- advisories
- environment gaps
- startedAt/finishedAt
- reviewDigest

zorunlu olmalı.

---

## 2.10 CLEAN commit'e güvenli bağlanmıyor

Review text dosyası var.

CLEAN şu exact şeylere bağlanmalı:

- commit SHA
- review bundle digest
- phase contract digest
- validation evidence digest
- reviewer provenance.

Commit değişirse CLEAN otomatik `STALE`.

---

## 2.11 Reviewer prompt-injection firewall uygulanmıyor

Architecture'da untrusted content fikri var fakat `CODEX.md` / `AUTO-REVIEW.md` bunu reviewer'a açıkça enforce etmiyor.

Repo source/comment/README/test fixture içindeki:

> ignore prior review instructions

gibi içerikler DATA kabul edilmeli, instruction değil.

Aynısı builder research/customer repo için de geçerli.

---

# 3. Roadmap / hızlı kurulum scheduler açıkları

## 3.1 149 phase contract var ama çoğu generic template

Gerçek karşılaştırmada:

- 149 contract
- yalnız 5 structural template
- **120 phase neredeyse aynı generic contract**

Yani "149 contract var" tek başına fazların gerçekten teknik olarak dokunmuş olduğu anlamına gelmiyor.

Örneğin Phase 3 approval ile Phase 116 Game Studio aynı generic deliverable/test listesine çok yakın.

Her phase:
- exact deliverables,
- exact code areas,
- exact tests,
- exact negative/failure cases,
- exact evidence,
- exact dependencies,
- exact closure criteria

taşımalı.

---

## 3.2 Dependency DAG yok

Şu dosyalar yok:

- `roadmap/dependency-graph.json`
- `roadmap/build-waves.json`
- `roadmap/critical-path.json`
- `roadmap/parallel-lanes.json`

Bu nedenle sistem hangi fazların paralel yapılabileceğini bilmiyor.

---

## 3.3 149 phase = 149 execution cycle olmamalı

Hız için:

Acceptance phase sayısı korunabilir.

Ama execution:

- Wave
- package
- milestone batch
- parallel lane

mantığında olmalı.

Örnek:

### Wave 0
Bootstrap Kernel + Logging + Git Isolation + Review Governance + Scheduler

### Wave 1
Identity + Approval + Action Gateway + Vault + DLP + Audit

### Wave 2
Agents + Competency + Certification + Review hierarchy

...

Her wave sonunda Codex kapsamlı review.

---

## 3.4 `maxMilestonesPerRun` gerçek değil

Config'de 10.

Supervisor current milestone'u bir kez okuyor ve tek milestone çalıştırıyor.

Milestone auto-advance yok.

---

## 3.5 Runnable-work resolver yok

Sistem şunu hesaplamıyor:

`hangi işler dependency'leri tamam, resource mevcut, quota uygun, blocker yok ve paralel çalışabilir?`

Bu olmadan hızlı autonomy yok.

---

## 3.6 Critical path yok

Toplam süreyi azaltmak için:
- critical path
- longest dependency chain
- resource bottleneck
- parallelizable tasks

çıkarılmıyor.

---

# 4. Quota / token / context / resume açıkları

## 4.1 Claude limit biterse supervisor kapanıyor

Builder non-zero:

`process.exit(3)`

Resume queue yok.

Gereken:

- quota exhaustion detector
- resetAt
- provider status
- checkpoint
- task state
- retryAfter
- alternate safe work
- automatic resume.

---

## 4.2 Codex quota da aynı problem

Review fail ile quota exhaustion aynı state değil.

Ayrılmalı:

- TOOL_FAILURE
- AUTH_REQUIRED
- QUOTA_EXHAUSTED
- NETWORK_FAILURE
- MODEL_FAILURE
- REVIEW_RESULT.

---

## 4.3 Token budget yok

Per:
- run
- milestone
- agent
- review cycle

token/context budget yok.

---

## 4.4 Context compiler çok geç

Repository Intelligence/context compiler Phase 32.

Fakat token verimliliği için self-build sürecinde **Wave 0** minimal context compiler gerekli.

En az:
- changed files
- direct dependencies
- requirements
- prior findings
- condensed logs.

---

## 4.5 Checkpoint crash-safe değil

`.ai` file state var ama:
- atomic state transaction,
- journal,
- generation,
- lock,
- crash recovery

yok.

---

# 5. Logging / evidence / observability açıkları

## 5.1 Central Run ID yok

Builder log, validation log ve review log birbirine canonical `runId` ile bağlı değil.

---

## 5.2 Structured event bus yok

Gereken:

`.ai/runs/<runId>/events.jsonl`

Her event:
- runId
- mission
- phase
- milestone
- actor
- stage
- event
- timestamp
- duration
- exitCode
- severity
- artifactRefs.

---

## 5.3 Bootstrap log yok

`bootstrap.ps1` sonucu terminalde kaybolabilir.

Zorunlu:
- install manifest
- exact versions
- command results
- auth status
- port status
- final Phase-0 summary.

---

## 5.4 Revalidation log kaydedilmiyor

İlk validation loglanıyor.

Remediation sonrası `vv` sonucu persistent log dosyasına yazılmıyor.

---

## 5.5 Git operations loglanmıyor

Commit/push/merge/branch/worktree resultleri structured ledger değil.

---

## 5.6 Log DLP/redaction yok

Builder/Codex stdout doğrudan file'a yazılıyor.

Source code, tokens, credentials veya customer data loga girebilir.

DLP skeleton var fakat automation'a bağlı değil.

---

## 5.7 Log retention/rotation/size limit yok

Uzun build:
- disk doldurabilir,
- dev stdout'u RAM'de büyütebilir,
- hassas loglar sonsuza kadar kalabilir.

---

## 5.8 Evidence manifest yok

Bir run'ın:

- logs
- tests
- review
- git commit
- build artifact
- environment
- hashes

tek manifestte bağlanması yok.

---

## 5.9 Factory observability Phase 98'i bekleyemez

Product observability Phase 98 olabilir.

Factory self-build observability **pre-Phase 0 / Wave 0** olmalı.

---

# 6. Git / workspace / merge güvenliği açıkları

## 6.1 Worktree isolation yok

Claude main working tree üzerinde çalışıyor.

Gereken:

`runs/<id>` branch + git worktree.

---

## 6.2 Process lock yok

Scheduled task ile manual start aynı anda çalışabilir.

Task Scheduler'ın `IgnoreNew` ayarı yalnız aynı scheduled task instance'ını kapsar; başka process'i engellemez.

Repo-level process lock gerekli.

---

## 6.3 PR / merge queue yok

Codex CLEAN sonrası:
- merge
- post-merge validation
- main push
- remote SHA verify

akışı yok.

---

## 6.4 Branch protection doğrulanmıyor

`init-private-git.ps1` private repo adı taşıyor fakat:
- private remote oluşturmaz,
- remote'un private olduğunu doğrulamaz,
- branch protection kurmaz,
- CODEOWNERS kurmaz.

---

## 6.5 Git identity kontrolü yok

Clean machine'de initial commit:
`user.name / user.email`

yüzünden fail olabilir.

---

## 6.6 Commit signing/attestation yok

İlk sürüm için opsiyonel olabilir fakat:
- release tags
- review attestations
- final builds

için gerekli hale gelmeli.

---

## 6.7 Rollback/revert automation yok

Review/remediation kötü commit üretirse sistemin:
- branch discard,
- worktree cleanup,
- revert,
- restore checkpoint

akışı yok.

---

## 6.8 Child process cleanup yok

Timeout olduğunda spawned CLI alt-process tree'sinin kesin kapandığını garanti eden process-tree controller yok.

---

# 7. Bootstrap / installer açıkları

## 7.1 One-click installer yok

Current `bootstrap.ps1` dependency + validation yapıyor.

Ama full installation state machine değil.

---

## 7.2 Prereq script yalnız command existence bakıyor

Kontrol edilmeyenler:
- Node >=24 gerçekten mi
- npm version
- Git version
- PowerShell version
- Claude version/auth
- Codex version/auth
- Docker daemon
- ADB device authorization
- Appium driver health
- disk space
- RAM
- CPU
- port conflicts
- path length
- UTF-8/locale
- time sync
- proxy/TLS/network
- admin/Task Scheduler rights.

---

## 7.3 Bootstrap Git'i başlatmıyor

`bootstrap` ve `init-private-git` iki ayrı akış.

START-HERE net installation state machine vermiyor.

Supervisor Git'e bağımlı.

---

## 7.4 Autostart erken kaydediliyor

Bootstrap:
1. validate
2. doctor
3. OmniRoute
4. autostart
5. sonra Claude/Codex command warning

yapıyor.

Auth/tool hazır olmadan autostart kurulabilir.

---

## 7.5 `start-full-auto.ps1` `npm install` kullanıyor

Lockfile varsa:
`npm ci`

olmalı.

---

## 7.6 `start-control-tower.ps1` de `npm install` kullanıyor

Aynı deterministic build sorunu.

---

## 7.7 OmniRoute canlı "latest" install ediyor

`npm view omniroute version`

sonra global install.

İlk keşif aşamasında anlaşılabilir fakat:
- allowed version decision
- license/terms
- integrity/provenance
- pin
- compatibility

onayından sonra kullanılmalı.

---

## 7.8 Artifact hash bootstrap'tan önce doğrulanmıyor

ZIP `SHA256SUMS.txt` taşıyor fakat bootstrap script çalışmadan önce source files manifest'e göre verify edilmiyor.

Minimal trusted verifier gerekli.

---

# 8. Trust Root / Self-modification açıkları

Bu bölüm P0.

## 8.1 Protected Trust Root yok

Protected alanlar:

- constitution
- authority policy
- review governance
- validation framework
- supervisor core
- logging/evidence core
- DLP
- secret policy
- phase acceptance framework
- protected schema set.

Normal feature milestone bunları değiştirememeli.

---

## 8.2 Gate tampering detector yok

Claude şu yollarla "başarı" üretebilir:
- failing test silmek
- assertion gevşetmek
- validator değiştirmek
- review prompt değiştirmek
- phase exit criterion azaltmak.

Bunun için:
- trust-root digest
- test deletion/weakening detection
- validator diff gate
- policy diff gate
- separate governance review

gerekiyor.

---

## 8.3 Trust-root değişikliği özel workflow olmalı

Normal:
`FEATURE_BUILD`

Trust root değişikliği:
`GOVERNANCE_CHANGE`

ayrı scope,
iki aşamalı independent review,
gerekirse Founder approval.

---

# 9. Schema ve validation tarafında yeni doğrulanan açıklık

## 9.1 "141 strict schema" ifadesi yanıltıcı derecede iyimser

Evet:
`additionalProperties:false`

oldu.

Fakat gerçek sayım:

- total schemas: 141
- **130 schema'nın required alanı <= 1**

Yani çoğu schema hâlâ semantic skeleton.

Örnek:
- review
- finding
- certification
- requirement
- incident
- provider
- plugin manifest
- action result
- workflow

yalnız `id` ile geçebilir.

---

## 9.2 Schema strictness validator yüzeysel

Validator sadece:
- `additionalProperties === false`
- dört V2 schema required count >= 4

kontrol ediyor.

141 schema'nın business/relationship semantics'i doğrulanmıyor.

---

## 9.3 Phase validator yüzeysel

Sadece arrays non-empty mi bakıyor.

Phase 0 ile Game Studio'nun generic template olması PASS geçiyor.

---

## 9.4 Woven validator sayı ağırlıklı

393 tech, 425 skill, 363 agent gibi minimum sayıları kontrol ediyor.

Bu yararlı ama tam semantic proof değil.

---

# 10. CI / test mekanik açıkları

## 10.1 CI yalnız Ubuntu

Actual Founder environment Windows.

Zorunlu:
- Windows clean-machine CI
- PowerShell script tests
- Electron smoke
- installer dry-run.

---

## 10.2 package-lock artifact'te yok

CI intentionally fail ediyor.

İlk successful bootstrap sonrası commit edilmeli.

---

## 10.3 Exact package-manager/runtime capture yok

Node/npm exact versions first baseline'da kaydedilmeli.

---

## 10.4 Supervisor testleri yok

Test edilmesi gerekenler:
- no git repo
- dirty tree
- quota exhaustion
- malformed review output
- review timeout
- new finding after cycle 1
- moving goalpost
- failed push
- merge conflict
- process lock
- crash/restart
- orphan process
- state recovery
- DLP log block
- protected path modification.

---

## 10.5 Installer clean VM acceptance yok

Final installation ancak clean Windows VM/machine üzerinde:
`extract -> install -> login -> phase0 -> restart -> resume`

testinden geçerse kabul edilmeli.

---

# 11. Control Tower mekanik açıkları

Current Control Tower:
- nav buttons
- counts
- health.

Gerçek build-control için yok:

- run list
- live phase/milestone
- build wave DAG
- logs
- review findings
- advisory/blocker distinction
- quota/limit
- token/cost
- approvals
- pause/resume
- retry
- process health
- Global Stop
- Founder attention queue
- evidence viewer.

---

## 11.1 GLOBAL STOP gerçek değil

UI navigation metni olmak kill switch değildir.

Gerçek Global Stop:
- scheduler new work stop
- running child processes graceful stop
- timeout -> hard kill
- leases release/quarantine
- state checkpoint
- event/evidence record
- restart requires explicit resume.

---

# 12. Provider/model runtime açıkları

## 12.1 CLI existence != auth

`Get-Command claude`
`Get-Command codex`

yeterli değil.

Auth health probe gerekli.

---

## 12.2 Model/version provenance yok

Run:
- exact Claude model/version if exposed
- exact Codex model/version
- CLI version
- provider
- prompt digest

taşımalı.

---

## 12.3 Reviewer independence runtime check yok

Architecture/registry var.

Supervisor enforce etmiyor.

---

## 12.4 Paid API guard enforce edilmiyor

`allowPaidApi=false` sadece JSON alanı.

---

# 13. Hız için eksik optimizasyonlar

- local deterministic validator first
- changed-file impact analysis
- selective test runner
- artifact/cache reuse
- dependency install cache
- build cache
- context compiler
- log condensation
- review bundle minimization
- parallel worktrees
- quota-aware scheduling
- critical-path priority
- batched Codex reviews at coherent package boundaries
- skip unchanged certified components.

Bunlar token/süre hedefi için mekanik olmalı.

---

# 14. Multi-project/company-level autonomy boşluğu

Current supervisor:
- tek repo
- tek current milestone
- tek builder
- tek reviewer

modeli.

UASCO vision:
- Mission > Project
- birden fazla proje
- ayrı product repo'ları.

İleride control plane:
- project/repo workspaces
- per-repo branch/worktree
- per-mission queue
- shared quotas/resources
- portfolio priority

desteklemeli.

Bu Phase 0 blocker olmak zorunda değil ama architecture/runtime contract'a şimdiden bağlanmalı.

---

# 15. Pre-Phase-0 Bootstrap Trust Kernel

Roadmap'e 149 phase öncesinde **Bootstrap Kernel** eklenmeli.

Bu ürün feature scope'u değildir; build sisteminin kök güvenidir.

Minimum:

1. Artifact integrity verifier
2. Environment/preflight
3. Git repo/private remote verification
4. Process lock
5. Run ID/event logger
6. DLP/redacted log writer
7. Atomic checkpoint
8. Worktree/branch isolation
9. Protected trust-root manifest
10. Change-scope guard
11. Deterministic validation runner
12. Structured Codex review governance
13. Finding ledger/freeze/dedupe
14. Review attestation
15. Quota/auth/network failure classifier
16. Auto-resume state
17. Roadmap dependency DAG/build waves
18. Milestone auto-advance
19. Merge-after-CLEAN
20. Real Global Stop
21. Phase-0 final acceptance report.

Bunlar olmadan UASCO kendi trust core'unu güvenli şekilde inşa ederken kendi ayağının altındaki zemini değiştirebilir.

---

# 16. Codex blocker admissibility — canonical rule

Bir Codex finding yalnız şu şartlarda BLOCKER olabilir:

1. Current reviewed commit ile ilgili.
2. Frozen review scope içinde veya causal expansion açıklanmış.
3. Şunlardan en az birine bağlı:
   - requirement
   - invariant
   - phase acceptance
   - current regression
   - explicit risk/domain obligation
   - current trust/security/data-integrity breach.
4. Reproducible veya deterministic evidence var.
5. Expected vs observed açık.
6. Milestone kapanışını neden engellediği açıklanmış.
7. Remediation acceptance yazılmış.

BLOCKER olamaz:
- preference
- style taste
- optional refactor
- unsupported future feature
- unrelated legacy issue
- speculative edge case
- "best practice olabilir"
- requirement dışı scale target
- environment/resource unavailable durumu.

Bunlar advisory veya environment gap olur.

---

# 17. Review convergence rule

## Cycle 1
Tüm admissible blocker setini çıkar.

## Cycle 2+
Yalnız:
- prior blocker verification
- remediation regression
- previously masked blocker
- newly evidenced critical trust violation

yeni blocker olabilir.

Yeni ordinary finding -> advisory.

## Cycle max
3.

Ama 3 cycle sonunda:
`FOUNDER_ATTENTION_REQUIRED`

demeden önce sistem nedeni ayırmalı:

- legitimate unresolved blocker
- reviewer non-convergence
- environment gap
- tool/quota failure
- architecture decision conflict.

---

# 18. Kurulum kapanış kriteri

Founder `start-full-auto.ps1` çalıştırmadan önce bir tek:

`PHASE0_ACCEPTANCE.json`

şu sonucu vermeli:

```text
artifact integrity             PASS
git repository                 PASS
private remote                 PASS
branch protection              PASS/explicit-local-only
node/npm exact                 PASS
dependency lock                PASS
Claude command/auth            PASS
Codex command/auth             PASS
OmniRoute state                PASS/BLOCKED_WITH_REASON
process lock                   PASS
run logger                     PASS
DLP/redaction                  PASS
checkpoint/resume              PASS
review governance              PASS
protected trust root           PASS
worktree isolation             PASS
roadmap scheduler              PASS
quota classification           PASS
global stop                    PASS
static validation              PASS
typecheck                      PASS
unit tests                     PASS
control API smoke              PASS
desktop smoke                  PASS
restart/resume smoke           PASS
final                          CLEAN
```

Bu olmadan autonomous full build başlamamalı.

---

# 19. Öncelik sırası

## P0 — autonomous build başlamadan önce
- Bootstrap Trust Kernel
- protected trust root
- worktree branch isolation
- no push before CLEAN
- structured Codex governance
- central run logger/evidence
- process lock
- checkpoint/resume
- quota/auth failure classification
- roadmap dependency DAG/build waves
- auto milestone advancement
- real Global Stop
- installer/preflight exact version checks
- Git private/branch protection baseline
- Phase-0 acceptance.

## P1 — Trust/Core build wave içinde
- durable state DB/journal
- full Identity/RBAC
- Vault
- DLP production runtime
- Action Gateway integration
- immutable audit/evidence
- provider entitlement
- worker trust.

## P2 — execution/domain waves
- full adapters/labs/studios/business/game/device systems.

---

# 20. Son karar

Bu audit'ten sonra **mevcut ZIP'i doğrudan 149 phase autonomous build'e sokmak doğru değildir.**

Ana mimariyi yeniden keşfetmemiz gerekmiyor.

Fakat build engine'in kendi mekanik güvenliği için bir **Pre-Phase-0 Bootstrap Trust Kernel** zorunlu hale gelmiştir.

Özellikle bu turda kullanıcı söylemeden bulunan yeni kritik açıklar:

- config safety flags'in enforce edilmemesi,
- Git repo yokken supervisor'ın fail-closed olmaması,
- builder'ın validator/review/policy trust-root'u değiştirebilmesi,
- 120/149 phase contract'ın generic template olması,
- 130/141 schema'nın semantic olarak yalnız `id` ile geçebilmesi,
- review prompt-injection firewall'ın runtime reviewer'a bağlı olmaması,
- autostart'ın auth kontrolünden önce kurulabilmesi,
- bootstrap ile Git init sırasının mekanik olarak kilitli olmaması.

Bunların tamamı yeni final construction ZIP'te kapanmadan kurulum `GO` olmamalıdır.
