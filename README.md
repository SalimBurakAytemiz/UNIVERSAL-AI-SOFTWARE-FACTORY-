<!-- //TR: Bu README V6 audit/remediation candidate'ın amacını, gerçek source kapsamını ve henüz kapanmamış runtime/release kapılarını Founder için kısa biçimde açıklar. -->
# UNIVERSAL AI SOFTWARE COMPANY OS — V6 Audit/Remediation Candidate

Human Founder nihai otoritedir. UASCO'nun kalıcı fiilleri:

`UNDERSTAND -> ASSURE -> DESIGN -> BUILD -> OPERATE -> REPAIR -> LEARN -> REPORT`

Bu çalışma ağacı **bitmiş runtime şirket OS'u veya installation-ready release değildir**. Claude primary builder + bounded governed CLAUDE_REVIEWER independent reviewer (Codex review retired; tarihsel olarak Codex) ile UASCO'nun tamamını güvenli ve minimum context/token ile inşa ettirmek için kullanılan canonical construction/control repository'nin V6 audit/remediation candidate'ıdır.

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
- bounded governed CLAUDE_REVIEWER review, finding-bound retest, durable LOW backlog, protected trust root, isolated Git/worktree, signed/hash-bound evidence ve fail-closed Phase0 mekanizmaları

## Current audit durumu

- Paste 1: `COMPLETE_SOURCE`
- Paste 2: `COMPLETE_SOURCE_ENVIRONMENT_GATES_PENDING`
- Paste 3: `COMPLETE_SOURCE`
- Paste 4A: `COMPLETE_SOURCE`
- Paste 4B: `COMPLETE_SOURCE`
- Paste 4C: `COMPLETE_SOURCE`
- Paste 4D: `COMPLETE_SOURCE`
- Dependency-aware environment gate: `PASS` on the target Windows machine (Node v24.19.0, npm 11.17.0; canonical validation 34/34, `npm audit` 0 findings)
- Independent review (historical Codex, pre-GOV1): PKG-A, PKG-C, PKG-D, PKG-E, PKG-E2 `CLEAN` (records in `audit/reviews/`)
- Desktop / Control Tower smoke on this machine: `PASS`
- Live provider smoke: `PENDING`

`SOURCE_LEVEL_CLOSURE = FALSE`

`FINAL_TRUST_ROOT_SEAL = SEALED_RELEASE_CANDIDATE`

`TARGET_MACHINE_PHASE0 = PENDING`

`FINAL_ZIP = PACKAGING_STAGE_OUTSIDE_GIT`

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

Paste 1, Paste 2, Paste 3 ve Paste 4A/4B/4C/4D source replay/audit segmentleri, repo-geneli `config -> runtime enforcement` sweep, full dependency-free source regression ve dependency-aware environment gate (reviewed `package-lock.json`, `npm ci`, supply-chain/SBOM, Ajv, typecheck, Vitest) tamamlandı ve bağımsız review'dan geçti (tarihsel kayıt: o dönemde Codex). P1 `TRUST-F1` (canonical validation script'leri protected değildi) PKG-F ile, PKGA-F8 ortam maddesi PKG-G ve Windows Time servisinin başlatılmasıyla kapandı; live provider smoke ve target preflight PASS verdi. PKGR-F1 (mühürlü artifact içinde kanonik doğrulamanın geçememesi) PKG-R1'in SEALED release-candidate modu ile kapandı. Açık P0/P1/P2 bulgusu yoktur. Trust-root bu release-candidate commit'inde mühürlüdür. Sıradaki kapı `RELEASE_PACKAGING_SIGNATURE_THEN_TARGET_MACHINE_PHASE0`'dır: bu commit'in `git archive` export'u -> SHA256SUMS -> deterministik ZIP -> fresh-extract doğrulaması -> Founder'ın harici anahtarıyla detached imza -> imzalı ZIP'in fresh extract'i üzerinde target-machine Phase0. Bunlar tamamlanmadan `SOURCE_LEVEL_CLOSURE` true yapılamaz.
