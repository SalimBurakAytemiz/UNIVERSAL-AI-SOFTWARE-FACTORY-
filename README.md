<!-- //TR: Bu README V6 audit/remediation candidate'ın amacını, gerçek source kapsamını ve henüz kapanmamış runtime/release kapılarını Founder için kısa biçimde açıklar. -->
# UNIVERSAL AI SOFTWARE COMPANY OS — V6 Audit/Remediation Candidate

Human Founder nihai otoritedir. UASCO'nun kalıcı fiilleri:

`UNDERSTAND -> ASSURE -> DESIGN -> BUILD -> OPERATE -> REPAIR -> LEARN -> REPORT`

Bu çalışma ağacı **bitmiş runtime şirket OS'u veya installation-ready release değildir**. Claude primary builder + bounded Codex independent reviewer ile UASCO'nun tamamını güvenli ve minimum context/token ile inşa ettirmek için kullanılan canonical construction/control repository'nin V6 audit/remediation candidate'ıdır.

Canonical gerçeklik:

`SPECIFICATION != IMPLEMENTATION != TEST != EVIDENCE != RUNTIME_VERIFICATION != PRODUCTION_VERIFICATION`

`REGISTERED != KNOWN != SKILLED != CERTIFIED != CURRENT != AUTHORIZED != VERIFIED`

## Current source kapsamı

- 363 canonical agent genome + 363 role-specific evaluation contract
- 425 canonical V2 runtime skill + 1186 legacy/reference V1 skill
- 415 seed technology profile + 415 technology knowledge unit
- 117 deduplicated pairwise relation + 415/415 structural technology coverage
- 6114 agent↔technology depth assignment
- 194 registered tool/provider adapter
- 22 domain pack
- 152 canonical schema
- 149 acceptance phase: Phase 0 + Phase 1..148
- 34 coherent review package: Phase 1..148; Phase 0 ayrı bootstrap/trust gate
- delivery tier: 14 CORE / 2 HIGH / 18 MEDIUM
- bounded Codex review, finding-bound retest, durable LOW backlog, protected trust root, isolated Git/worktree, signed/hash-bound evidence ve fail-closed Phase0 mekanizmaları

## Current audit durumu

- Paste 1: `COMPLETE_SOURCE`
- Paste 2: `COMPLETE_SOURCE_ENVIRONMENT_GATES_PENDING`
- Paste 3: `COMPLETE_SOURCE`
- Paste 4A: `COMPLETE_SOURCE`
- Paste 4B: `COMPLETE_SOURCE`
- Paste 4C: `COMPLETE_SOURCE`
- Paste 4D: `COMPLETE_SOURCE`
- Dependency-aware environment gate: `PASS` on the target Windows machine (Node v24.19.0, npm 11.17.0; canonical validation 34/34, `npm audit` 0 findings)
- Independent Codex review: PKG-A, PKG-C, PKG-D, PKG-E, PKG-E2 `CLEAN` (records in `audit/reviews/`)
- Desktop / Control Tower smoke on this machine: `PASS`
- Live provider smoke: `PENDING`

`SOURCE_LEVEL_CLOSURE = FALSE`

`FINAL_TRUST_ROOT_SEAL = STALE_PENDING_FINAL_RESEAL`

`TARGET_MACHINE_PHASE0 = PENDING`

`FINAL_ZIP = NOT_DONE`

## Authority

Current source durumu için `CANONICAL-STATUS.md` ve `audit/V6-FULL-SCAN-PROGRESS.json` esas alınır. `docs/closure/` altındaki V2/V3/V4 audit/closure belgeleri tarihsel veya reference materyaldir; current PASS/CLEAN/closure authority değildir.

## Windows release başlangıcı

Final release artifact üretildikten ve trust-root/lock/release authenticity kapıları kapandıktan sonra canonical installer giriş noktası:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```

Target-machine Phase0 ve live provider smoke çalışmadan kurulumu veya release'i PASS kabul etme.

## Current V6 audit route

Paste 1, Paste 2, Paste 3 ve Paste 4A/4B/4C/4D source replay/audit segmentleri, repo-geneli `config -> runtime enforcement` sweep, full dependency-free source regression ve dependency-aware environment gate (reviewed `package-lock.json`, `npm ci`, supply-chain/SBOM, Ajv, typecheck, Vitest) tamamlandı ve bağımsız Codex review'dan geçti. Açık kalan tek source bulgusu önceden var olan P1 `TRUST-F1`'dir (protected önek eşleştirmesi `scripts/validate-*` validator'larını korumuyor; Founder kararı bekliyor). Sıradaki kapı `TARGET_MACHINE_PHASE0_ACCEPTANCE_AND_LIVE_PROVIDER_SMOKE`'dur; bu kapı ve final reseal/imza/ZIP tamamlanmadan `SOURCE_LEVEL_CLOSURE` true yapılamaz.
