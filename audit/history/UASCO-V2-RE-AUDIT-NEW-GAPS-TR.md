<!-- //TR: Bu audit MECHANICALLY-CLOSED-V2 canonical starter ZIP'inin tekrar temiz klasöre çıkarılmış gerçek içeriği üzerinde yapılmıştır. Önceki audit bulgularını körlemesine tekrar etmez; kapanmış maddeleri ayırır ve yalnız güncel kalan/yeni bulunan mekanik, teknik ve operasyonel açıkları kaydeder. -->
# UASCO — Mechanically Closed V2 Re-Audit / New Gaps

## Denetlenen artifact

`UNIVERSAL-AI-SOFTWARE-COMPANY-OS-MECHANICALLY-CLOSED-V2-CANONICAL-STARTER.zip`

Artifact temiz klasöre yeniden çıkarıldı ve validatorlar tekrar çalıştırıldı.

## Tekrar geçen kontroller

- Registry validation: PASS
- Architecture validation: PASS
- TR validation: PASS
- Competency V2 validation: PASS
- Organization validation: PASS
- Schema catalog validation: PASS (151)
- Technology graph validation: PASS (393 / 36 group)
- Agent semantic validation: PASS
- Phase contract validation: PASS (149 / 11 wave / 12 lane)
- Review graph V2 validation: PASS
- Schema strictness validation: PASS (151)
- Woven model validation: PASS
- Mechanical closure validation: PASS
- Mechanical kernel self-test: PASS
- Trust root verify: PASS
- Artifact verify: PASS

## Önceki auditten gerçekten kapanmış olanlar

1. 151 object schema artık `additionalProperties:false`.
2. Schema required alanları artık 1'e düşmüyor; minimum required count 4.
3. 149 phase contract'ın semantic signature'ları artık 149/149 unique.
4. Her phase'te minimum iki failure case ve iki required artifact var.
5. Review-before-merge/worktree/checkpoint/structured review/trust-root/logging mekanikleri source seviyesinde mevcut.
6. `git add .` yerine exact-file staging mekanizması var.
7. Review sonucu string arama yerine strict JSON şemaya bağlı.
8. 149 acceptance phase 34 coherent review package'a gruplanmış.

Bunları yeniden "açık" saymıyoruz.

---

# P0 — Autonomous full build başlamadan önce kapanması gereken güncel açıklar

## P0-01 — Builder host üzerinde gerçek sandbox olmadan çalışıyor

Claude şu şekilde çağrılıyor:

`claude -p --permission-mode acceptEdits --output-format text`

Worktree ayrı, fakat OS/process/network/filesystem yetkisi gerçek bir sandbox/tool broker ile sınırlandırılmıyor.

Change guard yalnız Git diff'i görür. Builder:
- worktree dışındaki absolute path'lere,
- HOME/APPDATA altına,
- host CLI credential/config'lerine,
- network'e,
- `.git` metadata'sına,
- Git dışı side-effect'lere

erişebilir.

Core'da `authorizeAction()` var fakat supervisor/scripts tarafından kullanılmıyor.

**Gerekli:** Builder Execution Sandbox + Tool Broker + Action Gateway integration + egress policy.

---

## P0-02 — Action Gateway mimaride var ama self-build supervisor'a bağlı değil

`core/action-gateway/*` implementation skeleton mevcut.

Fakat automation'da `authorizeAction()` kullanımı yok.

Bu nedenle:
- production mutation,
- external communication,
- spending,
- irreversible operation,
- cloud mutation

child process seviyesinde mekanik olarak bloklanmıyor.

Environment flag tek başına authority enforcement değildir.

---

## P0-03 — `package.json` field-level trust bypass

Change guard yalnız:
- `scripts.validate`
- `scripts.test`
- `scripts.typecheck`
- `engines`

değişimini koruyor.

Korunmayan kritik alanlar:
- `pretest`
- `posttest`
- `preinstall`
- `install`
- `postinstall`
- `prepare`
- `prepack`
- diğer lifecycle scripts
- `packageManager`
- `workspaces`
- `overrides`
- `resolutions`

Builder `test` script'ini değiştirmeden `pretest` ekleyebilir.

**Gerekli:** complete package-policy guard.

---

## P0-04 — Git metadata trust boundary dışında

Protected trust root tracked source paths için çalışıyor.

Ancak Git worktree ortak repository metadata kullanıyor.

Korunmayan alanlar:
- `.git/config`
- remotes
- refs
- tags
- hooks
- worktree metadata
- local Git config
- filters
- submodule config

Builder Git komutlarıyla source diff oluşturmadan trust state'i etkileyebilir.

`.gitattributes` ve `.gitmodules` da protected path listesinde değil.

**Gerekli:** Git metadata snapshot/guard + hook/config policy + `.gitattributes/.gitmodules` protection.

---

## P0-05 — Shared `node_modules` builder tarafından değiştirilebilir

Supervisor root `node_modules` dizinini worktree'ye junction/symlink ediyor.

Builder worktree içinde dependency/install komutu çalıştırırsa shared dependency tree'yi değiştirebilir.

Bu:
- control tree'yi dolaylı etkileyebilir,
- Git change guard'a görünmez,
- gelecekte paralel worker'larda race yaratır.

**Gerekli:** immutable/read-only cache veya per-worktree dependency store.

---

## P0-06 — Cycle 2+ unresolved blocker omission açığı

Review convergence mevcut finding'leri işler.

Ama önceki blocker'ın sonraki cycle'da mutlaka:
- `OPEN`
- veya `RESOLVED + retest evidence`

olarak geri dönmesini zorunlu kılmıyor.

Codex Cycle 2'de F-001'i listeden tamamen çıkarırsa ledger'da geçmiş kayıt kalıyor ama effective result current accepted blockers üzerinden CLEAN'e dönebilir.

**Gerekli:** explicit blocker-resolution ledger. Prior unresolved blocker'ın kaybolması review input error olmalı.

---

## P0-07 — Moving-goalpost etiketi hâlâ reviewer tarafından abuse edilebilir

Cycle 2+ yeni blocker şu causality değerlerinden birini taşıyorsa kabul ediliyor:

- `REMEDIATION_REGRESSION`
- `PREVIOUSLY_MASKED`
- `CRITICAL_NEW_EVIDENCE`

Ancak machine-level causal proof yeterince sıkı değil.

Özellikle `postCycle1Allowed.has(...)` tek başına blocker'ı kabul edebiliyor.

**Gerekli:**
- regression -> remediation diff linkage,
- masked -> `causedByFindingId` zorunlu,
- critical-new-evidence -> P0/P1 + trust/security/data-integrity basis + Cycle1'de olmayan evidence digest.

---

## P0-08 — Finding fingerprint stabil değil

Fingerprint şunları içeriyor:

- category
- basis
- file
- symbol
- **remediationAcceptance**

Reviewer remediation cümlesini değiştirirse aynı bug yeni fingerprint alabilir.

**Gerekli:** fingerprint yalnız stable identity/reproduction signature üzerinden üretilmeli.

---

## P0-09 — Finding `status` lifecycle enforcement eksik

Schema:
- OPEN
- RESOLVED
- DOWNGRADED
- DUPLICATE

destekliyor.

Ama governance BLOCKER sayarken status lifecycle'ını tam enforce etmiyor.

**Gerekli:** RESOLVED blocker için explicit retest/evidence, OPEN için closure yasağı.

---

## P0-10 — CLEAN attestation governed sonucu tam bağlamıyor

Raw Codex review BLOCKED olabilir.

Governance inadmissible finding'leri advisory'e indirip effective result'i CLEAN yapabilir.

Attestation raw review digest'e bağlansa bile:
- governed disposition digest,
- effective finding ledger digest,
- resolved blocker ledger digest

first-class değil.

**Gerekli:** `effectiveReviewDigest / governedFindingsDigest / blockerLedgerDigest`.

---

## P0-11 — Review bundle accepted debt / waiver taşımıyor

Supervisor `knownLimitations: []` gönderiyor.

Yok:
- accepted technical debt
- Founder-approved waiver
- accepted risk
- known limitation ledger

Bu nedenle Codex aynı kabul edilmiş konuyu tekrar tekrar bulabilir veya sistem neden kabul edildiğini bilemez.

---

## P0-12 — AUTO-REVIEW basis kuralı bundle ile uyumsuz

Bundle basis:
- REQ
- INV
- AC
- VAL
- FAIL
- ART
- RISK

Prompt açıkça yalnız:
- REQ
- INV
- AC
- VAL
- RISK

diyor.

`FAIL-*` ve `ART-*` eksik.

Mandatory failure/artifact blocker'larında reviewer davranışı belirsizleşiyor.

---

## P0-13 — Reviewer provenance kısmen self-attested

Review JSON içinde reviewer:
- provider
- modelId
- independenceStatus

kendisi yazıyor.

Supervisor configured provider ile provider adını karşılaştırıyor, fakat exact model/version independently capture edilmiyor.

Config:
`ACCOUNT_DEFAULT_OR_CLI_CONFIG`.

**Gerekli:** CLI version + resolved model identifier + provider/session provenance supervisor tarafından dışarıdan capture edilmeli.

---

## P0-14 — Environment policy `NODE_` / `NPM_` prefix'i fazla geniş

Child env policy şu prefix'leri geçiriyor:

- `NODE_`
- `NPM_`

Özellikle `NODE_OPTIONS` process behavior/code loading'i etkileyebilir.

PATH de host'tan doğrudan geliyor.

**Gerekli:** prefix değil explicit env allowlist. Command path/version/hash Phase0'da resolve/pin edilmeli.

---

## P0-15 — Secret scan autonomous validation zincirinde yok

`scripts/secret-sanity.mjs` mevcut.

Ama `config/validation.json` içinde çalışmıyor.

Yani builder commitinden önce deterministic canonical validation:
- secret sanity
- SCA
- license/provenance

kapılarını çalıştırmıyor.

Secret scan şu anda esasen CI tarafında.

**Gerekli:** minimum secret scan pre-commit validation'a alınmalı. Dependency change paketleri ayrıca supply-chain validation almalı.

---

## P0-16 — Artifact integrity authenticity değildir

`verify-artifact.mjs` bunu doğru biçimde kendisi de söylüyor.

ZIP içindeki dosya + ZIP içindeki SHA manifest birlikte değiştirilirse self-check PASS olabilir.

**Gerekli:** detached release signature veya artifact dışındaki trusted digest/signing key.

---

## P0-17 — Remote branch protection gerçek değil

`init-private-git.ps1` private repo visibility doğrulayabiliyor ve push ediyor.

Ama GitHub/GitLab branch protection configure/verify etmiyor.

`REMOTE_STATUS` protection değeri:
`LOCAL_SUPERVISOR_MERGE_GATE`

Remote `main` başka actor tarafından push edilebilir.

**Gerekli:** remote branch protection/required checks enforcement veya explicit local-only policy.

---

## P0-18 — Remote URL credential leakage riski

`REMOTE_STATUS.json` içinde raw RemoteUrl `detail` olarak saklanıyor.

HTTPS URL embedded credential/token içerirse runtime JSON'a yazılabilir.

**Gerekli:** URL credential sanitizer.

---

## P0-19 — Evidence ledger tamper-evident değil

Run events, logs ve package attestation'lar local ordinary files.

- hash-chain yok,
- detached signature yok,
- append-only trusted store yok.

Local process sonradan değiştirebilir.

Bu “immutable audit / chain-of-custody” hedefini henüz sağlamıyor.

---

## P0-20 — Checkpoint atomicity Windows crash window içeriyor

`writeJsonAtomic()` rename-over-existing başarısız olursa:
1. eski target siliniyor,
2. temp target adına taşınıyor.

Bu iki işlem arasında crash olursa checkpoint kaybolabilir.

`previousDigest` var ama ayrı previous-state file/journal yok.

**Gerekli:** A/B double-buffer veya WAL + last-known-good copy.

---

## P0-21 — Corrupt process lock fail-open olabilir

Lock JSON parse edilemezse `old=null`.

Kod stale lock gibi dosyayı silebilir.

Gerçekte çalışan başka supervisor lock file'ını tam yazarken/corruption durumunda bu tehlikeli.

**Gerekli:** unreadable lock -> fail closed; yalnız same-host dead PID ispatlanırsa temizle.

---

## P0-22 — Installer step ledger için muhtemel PowerShell scope bug

`$steps=@()` script scope'ta.

`Run-Step` function içinde:

`$steps += ...`

kullanılıyor, `$script:steps` değil.

PowerShell scope davranışı nedeniyle child function assignment'ın parent array'i güvenilir şekilde güncellememesi yüksek olasılıklı.

Bu Linux ortamında PowerShell bulunmadığı için target-machine'de doğrulanmalı.

**Gerekli:** mutable collection veya `$script:steps`.

---

## P0-23 — Install correlation ID tutarsız

`install.ps1` kendi `$installId` değerini oluşturuyor.

`install-report.mjs` her çalışmada yeni:
`INSTALL-${Date.now()}`

oluşturuyor.

INSTALL_STEPS ve INSTALL_REPORT aynı canonical install run'a bağlanmıyor.

---

## P0-24 — Provider smoke false-positive olabilir

Provider smoke:
`stdout.includes(nonce)`

kontrol ediyor.

CLI promptu echo'layan bir output bile nonce içererek PASS yaratabilir.

**Gerekli:** normalized exact response veya provider-specific structured output.

---

## P0-25 — Phase0 source-existence kontrolü gerçek E2E trust proof değil

Phase0 bazı maddelerde:
- file exists
- report exists

kontrolü yapıyor.

Gerçek supervisor crash/recovery end-to-end simulation yok.

Özellikle test edilmeli:
- crash BUILD
- crash VALIDATE
- crash COMMIT
- crash REVIEW
- crash CLEAN_READY
- crash PUSH
- malformed review JSON
- missing prior blocker
- quota in each stage
- Global Stop during child
- push divergence
- orphan worktree
- trust-root tampering
- lifecycle-script package bypass.

---

# P1 — Hız, sürdürülebilirlik ve gerçek uzmanlık için kapanması gerekenler

## P1-01 — Planlama metadata'sı var, runtime paralellik yok

`build-waves.json`
`parallel-lanes.json`
`critical-path.json`

var.

Ama runtime supervisor bunları scheduling kararında kullanmıyor.

`maxParallelLanes = 1`.

Bütün package execution seri.

**Sonuç:** hız hedefi için tasarım dosyası var, execution engine yok.

---

## P1-02 — 34 review package'ın 18'i 600 file budget'a çıkıyor

Package contract birleşiminde `maxFilesChanged` 600'e kadar çıkıyor.

18/34 package = 600 file budget.

Bu:
- Claude context,
- Codex review,
- diff review,
- convergence

için fazla geniş olabilir.

Yalnız file-count budget var.

Yok:
- changed LOC budget
- diff byte/token budget
- review bundle context budget
- auto split.

**Gerekli:** adaptive package splitter.

---

## P1-03 — Token/cost telemetry yok

Automation'da:
- token usage
- context usage
- model cost
- package token budget
- review budget
- quota meter

yok.

Yalnız textual quota failure classifier var.

Bu kullanıcının temel hedeflerinden biri olan düşük token tüketimiyle çelişiyor.

---

## P1-04 — Quota retry provider-specific değil

Regex-based failure classification ve exponential backoff var.

Ama:
- exact resetAt parser
- subscription usage API/status
- provider-specific CLI health
- “exit 0 ama quota message” doğrulaması

yok.

---

## P1-05 — Global Stop resume supervisor'ı yeniden başlatmıyor

Control Tower Resume yalnız GLOBAL_STOP file'ını siliyor.

`start-full-auto.ps1`, stop code 50 alınca loop'tan çıkıyor.

Resume butonu process'i tekrar başlatmıyor.

Sonraki scheduled trigger/manual start beklenebilir.

---

## P1-06 — Control Tower blocked-state resolution eksik

Gerçek UI'da:
- health
- phase0
- scheduler count
- runs/events/log tail
- global stop/resume

çalışıyor.

Ama yok:
- Founder Attention queue
- blocker/advisory ayrıntısı
- approve / waive / reject
- accepted debt
- retrigger package
- architecture decision
- evidence graph
- quota/token/cost
- live DAG / wave / critical path.

BLOCKED package için desteklenen kullanıcı akışı yok; runtime JSON elle düzenleme riski var.

---

## P1-07 — Installer gerçek prerequisite installer değil

Preflight eksikleri buluyor fakat:
- Node
- Git
- Claude
- Codex
- optional mission tools

otomatik kurmuyor.

Kullanıcının minimal manuel iş hedefi için guided/optional winget installer gerekiyor.

OAuth/login gibi insan aksiyonları yine kaçınılmazdır.

---

## P1-08 — Installer bütün stdout/stderr loglarını merkezi toplamıyor

INSTALL_STEPS:
- status
- duration
- error

tutuyor.

Ama her install command'ın full redacted stdout/stderr'i canonical install run loguna bağlı değil.

---

## P1-09 — 363 agent technology mapping hâlâ kapsamlı değil

Gerçek sayım:

- 363 agent
- 258 technical agent
- **205 technical agent'ın primaryTechnologyIds listesi boş**
- 317 agent'ın comparisonTechnologyIds listesi boş.

Özellikle:
- Unreal Engine agent
- Unity Engine agent
- Godot Engine agent
- Gameplay Engineer
- Game Backend
- Firmware Engineer
- IoT Platform
- Robotics Engineer
- XR
- HIL

primary teknoloji eşlemesi taşımıyor.

Yani Android/API örneği düzeldi, fakat 363 agentın bütününde aynı teknik derinlik tamamlanmadı.

---

## P1-10 — Agent semantic validator örnek rol odaklı

Validator özellikle:
- 050
- 051
- 052
- 053
- 054
- 096
- 098
- 108
- 132

gibi kritik örnek rolleri kontrol ediyor.

363 agent için role ontology bazlı must-have semantic validation yok.

Bu nedenle Game/Embedded boşlukları PASS geçti.

---

## P1-11 — Domain pack'ler hâlâ label

22 domain registry entry:
- id
- name
- status
- activation

seviyesinde.

Fiziksel `domain-packs/` bilgi sistemi yok.

Eksik:
- terminology
- business invariants
- state machines
- reference architecture
- known failures
- regulatory primary sources
- region/effective date
- QA heuristics
- security/privacy obligations
- evidence expectations.

---

## P1-12 — 393 teknoloji seed profile ama gerçek bilgi henüz certified değil

393 technology knowledge file var.

Facet state'leri başlangıçta:
`NOT_RESEARCHED / NOT_CERTIFIED`.

Bu dürüst tasarım ama şu sonucu doğuruyor:

Agent'ın technology ID'si olması güncel teknik bilgi kanıtı değildir.

Dynamic Technology Discovery runtime engine roadmap'te gerçekten implement edilmelidir.

---

## P1-13 — Tool adapters tamamı registered, runtime değil

194/194 adapter `NOT_IMPLEMENTED`.

Bu nedenle BrowserStack/Appium/ZAP/k6/Unity/etc isimlerinin repo'da olması execution capability değildir.

---

## P1-14 — Capability/meta/fabric/binder'lar büyük ölçüde roadmap implementation bekliyor

Construction starter doğru şekilde specification seviyesinde.

Fakat:
- 110 capability
- 20 meta/core
- 45 fabric
- 16 binder

runtime açısından implementation backlog.

Bu "açık" değilse bile INSTALLATION sonrası gerçek build yükünün büyüklüğünü ifade eder.

---

# P2 — Production maturity

1. Evidence/audit ledger için external signing/HSM/OS-keystore trust.
2. Full DLP/PII redaction.
3. Multi-machine workers için mTLS/attestation.
4. Branch protection provider adapters.
5. Encrypted backup of control-plane state.
6. Cost/usage dashboards.
7. Production Control Tower RBAC.
8. Remote disaster recovery.
9. Signed self-update/release.
10. Multi-repo/multi-mission parallel portfolio runtime.

---

# Güncel sonuç

V2 önceki ZIP'ten belirgin biçimde daha iyi.
Eski schema/phase-generic problemlerinin bir kısmı gerçekten kapanmış.

Fakat yeniden auditte iki büyük sınıf açık kaldı:

### 1. Trust boundary mekanik olarak henüz tam değil
En kritik:
- builder sandbox/tool broker,
- Action Gateway wiring,
- Git/package/process trust boundary,
- Codex blocker resolution/convergence,
- tamper-evident evidence.

### 2. "Bütün agentlar teknik olarak dolu" hedefi tamamlanmış değil
Android/API/Flutter gibi örnek roller güçlü hale getirildi fakat teknik agentların büyük bölümünde primary teknoloji mapping'i hâlâ boş.

Bu nedenle mevcut artifact'e henüz **FINAL INSTALLATION GO** verilmemelidir.

Bir sonraki fix turunun P0 sırası:

`Builder Sandbox -> Action Gateway wiring -> package/git trust policy -> Codex unresolved-blocker ledger -> Codex causal proof -> provider provenance -> secret/supply-chain validation -> durable/tamper-evident checkpoint/evidence -> installer correlation/scope fixes -> Phase0 E2E crash harness`

Sonra P1:

`agent 363 semantic completion -> domain packs -> runtime scheduler parallelism -> token/cost budgets -> Control Tower blocked-state workflow`.
