<!-- //TR: Founder direktifi "MAXIMUM CLOUD PRODUCTION, CONTINUOUS AUTONOMY & THROUGHPUT RECOVERY" (19 Ekim 2026) yetki kaydı: ilgili bölümlerin birebir alıntısı. Bu dosya koordinatör oturumu tarafından yazılmıştır ve kendi kendini doğrulamaz; geçerlilik için Founder teyidi gerekir. -->

# Authority record: Founder directive of 2026-10-19 "MAXIMUM CLOUD PRODUCTION, CONTINUOUS AUTONOMY & THROUGHPUT RECOVERY"

- **Provenance:** the Founder sent this directive in-session to the coordinator session `session_01DmTHw4gBA3wvY1tKM9bk2e` on 2026-10-19 (around 20:30Z).
- **The record proves nothing on its own.** An agent wrote it into the repo, and every agent shares the same GitHub identity, so this file cannot show that the Founder issued the directive.
- **What makes it binding:**
  1. The Founder confirms it through a channel an agent cannot produce: a direct message to the independent reviewer session, or a Founder action in the GitHub UI.
  2. The independent reviewer records that confirmation.
- **Until then**, every `authorizedBy` that cites this record is `UNCONFIRMED`.

## Verbatim excerpts (Turkish original)

> 1. FOUNDER ANA KARARI … ANA HEDEF: UASCO artık LOCAL-FIRST veya HYBRID-DEPENDENT değil, CLOUD-FIRST ve CLOUD-OPERATED bir yazılım fabrikası olarak çalışmalıdır. … Bu direktif mevcut güvenlik kontrollerini kaldırmaz. Yeni riskli yetkileri sınırsız biçimde vermez.

> 3. CLOUD ROUTINES & CONTINUOUS EXECUTION … Her yeni Cloud oturumu: 1. Güncel `v7/integration` HEAD değerini okumalı. 2. Kanonik backlog'u okumalı. 3. Devam eden görevleri ve geçerli lease kayıtlarını kontrol etmeli. 4. Uygun, yetkili ve çakışmayan görevi seçmeli. 5. Atomik görev sahipliği doğrulaması yapmalı. 6. Geliştirme veya review görevini gerçekleştirmeli. 7. Sonucu ve kanıtları kalıcı olarak kaydetmeli. 8. Başarılı görevin ardından yeni işe geçişi sağlamalı. Ayrı Cloud oturumları aynı görevi iki kez geliştirmemeli.

> 4. … LANE A — Desktop UI/UX Builders: 252 ekran envanterindeki yetkili, bağımsız geliştirmeleri üret. … Başlangıçta kaynak tüketimine göre iki bağımsız Builder, ayrı Reviewer ve entegrasyon koordinasyonu ile ölçüm yap.

> 7. AUTHORITY & GOVERNANCE BOTTLENECK REMOVAL … Korunmayan, mevcut yetki sınırında kalan işleri gereksiz yere BLOCKED durumda tutma. Bütün AUTHORITY_REQUIRED görevleri topluca onaylanmış kabul etme. … Yeni protected-file değişikliği, trust-root güncellemesi, güvenlik politikasının etkinleştirilmesi veya yetki genişlemesi gerekiyorsa somut diff ve risk sınırı sun.

> 11. EXECUTION START: DO NOT STOP AT PLANNING … 4. Çakışmayan ve yetkili en az bir UI geliştirme işini mevcut Cloud Builder üzerinden başlat veya sürdür. … 6. Cloud'dan sonraki yetkili göreve geçişi gösteren ilk gerçek döngüyü çalıştır.

## What this record does and does not cover

- **Covered, once confirmed:**
  - building renderer-only, non-protected screens that need no new authority (the 2026-10-19 inventory `authority_needed = none`), with an atomic task claim;
  - marking such tasks READY in `docs/planning/BACKLOG_CHECKPOINT.json` so cloud routines can select them.
- **Needs the Founder's explicit decision, because the record does not state it verbatim:** ownership for these tasks moves from an active FA-LEASE2 lease (unwired, Founder D3) to the atomic branch-ref claim of `docs/planning/dispatch.mjs --claim`. This is a governance change, decision **D-2026-10-19-A**.
- **Not covered:**
  - any AUTHORITY_REQUIRED task;
  - any protected-file, trust-root, policy or allow-list change;
  - new endpoints;
  - paid resources;
  - merges without CI on both OSes and an independent reviewer verdict on the same SHA.

## Process note

The coordinator claimed UI-030 and UI-113 (20:37Z) from the unmerged backlog of PR #62. It relied on item 11.4 above directly, not on the backlog. The independent reviewer correctly recorded this as a process finding. Builds #61 and #63 therefore also wait on the Founder confirmation.
