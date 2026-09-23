<!-- //TR: Bu dosya V3 tabanının yeniden çıkarılmış gerçek source ağacı üzerinde 2026-09-21 yapılan güncel re-check sırasında doğrudan doğrulanan açıkları kaydeder; historical audit dosyaları audit/history altında ayrıca korunur. -->
# V4 Current Open Findings

## Hüküm

Bu paket **audit snapshot**'tır. `INSTALLATION_GO` değildir. Amaç mevcut canonical repo ile şu ana kadar bulunan bütün audit geçmişini tek ZIP içinde toplamak ve güncel doğrulanmış açıkları görünür tutmaktır.

## P0 — Güncel ve doğrudan doğrulanan mekanik açıklar

### P0-01 — Trust-root validator prefix bug

`config/protected-paths.json` içinde `scripts/validate-` protected prefix olarak tanımlı.

`generate-trust-root.mjs` ve `trust-root.mjs` prefix'i directory gibi yorumladığı için `scripts/validate-agent-semantic.mjs` vb. dosyalar bu prefix tarafından korunmuyor.

Gerçek sayımda `validate-domain-packs.mjs` exact path olduğu için protected; diğer validate scriptlerinin çoğu trust-root manifest dışında kaldı.

**Risk:** Normal builder validator kodunu değiştirerek sahte PASS üretebilir.

**Fix:** filename-prefix semantiği ayrı uygulanmalı veya bütün validator/self-test trust dosyaları exact protected set olarak generate edilmeli.

---

### P0-02 — `package.json` trust-root ile dependency-change contract çelişiyor

`package.json` exact protected path.

Buna karşı çok sayıda phase contract `allowDependencyChanges: true` diyor ve ayrı `package-policy.json` field-level guard taşıyor.

**Risk:** Dependency değişikliğine izin verilen normal milestone bile `package.json` değiştirince trust-root tarafından bloke edilir; roadmap contract pratikte uygulanamaz.

**Fix:** `package.json` immutable trust-root'tan çıkarılmalı; scripts/lifecycle/engines/workspaces/override gibi execution semantics `package-policy` ile field-level protected kalmalı. Dependency fields yalnız explicit milestone izni + lockfile + supply-chain gate ile değişebilmeli.

---

### P0-03 — Bootstrap trust-kernel self-test contract drift nedeniyle FAIL

`scripts/bootstrap-kernel-selftest.mjs` doğrudan çalıştırıldığında review schema/governance contract ile drift ettiği için FAIL:

`REVIEW_MISSING_FIELD:priorBlockerDispositions`

Self-test halen eski review object shape kullanıyor.

**Risk:** Pre-Phase-0 trust-kernel regression testi güncel review governance'i gerçekten doğrulamıyor.

**Fix:** self-test schemaVersion/current fields/evidence catalog/basis refs ile güncellenmeli ve canonical `npm run validate` zincirine de ayrıca eklenmeli.

---

### P0-04 — Secret sanity gate gerçek source üzerinde false-positive üretiyor

`scripts/secret-sanity.mjs` şu source dosyalarını yanlış secret leak olarak işaretledi:

- `apps/desktop/main.mjs`
- `models/omniroute/client.ts`
- `scripts/smoke-control-tower.mjs`
- `tests/dlp.test.ts`

Runtime `process.env` ifadeleri ve intentional security test fixture'ları literal committed secret gibi algılanıyor.

**Risk:** Canonical validation gerçek secret yokken kırılır; ekip gate'i kapatma eğilimine girebilir.

**Fix:** literal-secret vs runtime expression ayrımı, explicit test-fixture marker ve line-level scanner gerekiyor.

---

### P0-05 — Package-lock target-machine'de üretilmeden supply-chain gate çalışmıyor

`dependency-supply-chain.mjs` bu artifact üzerinde beklendiği gibi:

`PACKAGE_LOCK_MISSING`

ile duruyor.

Bu source artifact için deliberate target-machine pending olabilir; ancak Phase0 install akışı lockfile üretmeden hiçbir autonomous build'e geçmemeli.

**Fix/Acceptance:** Node 24+ target machine -> exact lockfile -> `npm ci` -> supply-chain PASS -> initial Git baseline commit.

---

## P1 — Güncel tasarım/runtime açıklıkları

### P1-01 — Governance ledger filtreleme/scoping runtime'da zayıf

`accepted-debt.json`, `waivers.json`, `known-limitations.json` içindeki bütün entries review bundle'a doğrudan veriliyor.

Current başlangıçta entries boş, ancak ileride kayıtlar eklendiğinde exact package/phase/scope/expiry/status filtrelemesi review-bundle creation aşamasında zorunlu olmalı.

### P1-02 — Bootstrap self-test `npm run validate` içinde first-class değil

`bootstrap.ps1` self-test'i ayrıca çağırıyor; fakat canonical `package.json` validate zinciri `bootstrap-kernel-selftest.mjs` çalıştırmıyor.

Trust-kernel regresyonu install dışında normal CI/validation turunda kaçabilir.

### P1-03 — Real parallel execution kapalı

`config/automation.json` içinde `maxParallelLanes = 1`.

Wave/lane/critical-path metadata var; gerçek eşzamanlı package execution henüz açılmış değil.

### P1-04 — Registered adapter != implemented adapter

194 adapter registry'de bulunuyor; bunların registry varlığı real execution capability kanıtı değildir. Browser/mobile/security/game/cloud adapters roadmap boyunca gerçek implementasyon/certification ister.

### P1-05 — Target-machine acceptance hâlâ zorunlu

Bu ortamda aşağıdakiler gerçek PASS sayılamaz:

- Node 24 target runtime
- package-lock + npm ci
- TypeScript typecheck/Vitest full run
- PowerShell installer E2E
- Windows process/crash/restart behavior
- Electron smoke
- Claude authenticated runtime
- Codex authenticated runtime
- remote branch protection
- real push/merge/restart/resume
- OmniRoute target compatibility

## Güncel truth rule

`REGISTERED != IMPLEMENTED != TESTED != VERIFIED != CERTIFIED != CURRENT != AUTHORIZED`.
