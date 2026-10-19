<!-- //TR: Founder'in PR #49 icin verdigi TEK SEFERLIK, dar kapsamli korunan-dosya (trust-root reseal) yetkisinin birebir kaydi. Yetki yalniz asagidaki dort dosya ve yalniz PR #49 icindir; baska PR'a devredilemez. Builder oturumu bu yetkiyle korunan dosyalari KENDISI degistirmez; degisiklik ayri bir maintainer oturumunda uygulanir ve ayri bir Opus reviewer tarafindan incelenir. -->

# Authority record — FD-PUBLIC-CI-2026-10-19

- **Granted by:** the Founder (repository owner), on 2026-10-19, in the builder session that opened PR #49 (claude.ai/code session `session_01DmTHw4gBA3wvY1tKM9bk2e`). It was an answer to an explicit authority question, after the permission layer refused the builder's own edit of `config/validation.json`.
- **Scope:** one time, PR #49 only, and **not transferable** to any other PR.
- **Files allowed to change (only these four):**
  - `.github/workflows/ci.yml`
  - `config/validation.json`
  - `scripts/phase0-acceptance.mjs`
  - `config/trust-root-manifest.json`

## Conditions (verbatim, Turkish original)
1. Mevcut 110 test dosyasının kapsamı ve sırası eksilmeyecek.
2. 600 saniyelik güvenlik sınırı kaldırılmayacak.
3. Manifestte yalnızca değiştirilen üç dosyanın hash'i yenilenecek.
4. Korumalı değişiklikler ayrı bir Claude maintainer oturumunda, mevcut yetki mekanizmasına uygun uygulanacak. Güvenlik engellerini aşma.
5. Ayrı Opus reviewer tam diff'i ve mühürleme işlemini bağımsız inceleyecek.
6. Gerçek Windows ve Linux GitHub Cloud CI testleri PASS olmadan merge yapılmayacak.
7. Public artifact'lara gizli bilgiler veya hassas çalışma logları yüklenmeyecek.
8. Diğer korunan dosyalara dokunulmayacak.
9. Yetki yalnız PR #49 kapsamıyla sınırlıdır; başka PR'lara devredilemez.

"Bağımsız maintainer yetkisi sağlanamıyorsa güvenlik katmanını atlamadan engeli raporla."

## How each condition is checked
| # | Check |
|---|---|
| 1 | `logicalTestFiles(after)` must equal the old `tests` file list exactly, order included (110 files). `pkg-vs` enforces it, and the reviewer re-derives it from the diff. |
| 2 | `scripts/run-validation.mjs` stays untouched (`timeoutMs:600000`); `pkg-vs` asserts this. |
| 3 | In the manifest diff, exactly 3 `sha256` values change (`ci.yml`, `validation.json`, `phase0-acceptance.mjs`) plus the `generatedAt` timestamp. Anything else is a STOP. |
| 4 | The protected commit is authored by a separate maintainer session, not by the builder session. |
| 5 | A separate Opus reviewer session posts a verdict bound to the exact head SHA. |
| 6 | No merge until `validate (ubuntu-latest)` and `validate (windows-latest)` are both green on the same head SHA. |
| 7 | The artifact contains only `CI_EVIDENCE.json`: ids, statuses, durations and the SHA binding. No stdout/stderr, logs or `VALIDATION_REPORT.json`. |
| 8 | `git diff --name-only` limits protected-path changes to the four files above. |
| 9 | This record names PR #49. Other PRs that need protected changes require their own authority. |
