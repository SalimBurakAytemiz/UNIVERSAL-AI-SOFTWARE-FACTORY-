<!-- //TR: UI-201 öğrenme kanıt kütüphanesi tasarım notu (salt-okunur, yalnız renderer). -->
# UI-201 — Learning evidence library (#/academy)

Read-only, renderer-only. One `details/summary` per learning, built only from fields `GET /v1/academy` already returns (the view still calls only `/v1/academy`).

- `mapLearning` gains a fail-closed, bounded `evidence` block: `src_` ids regex-checked and capped at 50, refs capped at 50, `labResult {passed, testRefCount, recordedAt}`, reviewer ref accepted only as `audit/evidence/skill-academy/<lrn>/REVIEWER.json#sha256=<hex>` (otherwise `null`; sha256 shortened), drift count. Reuse events are mapped to bounded items next to the existing count.
- Each linked source is cross-referenced to the mapped sources list; missing shows `UNKNOWN`. Missing data shows `MISSING`/`UNKNOWN`.
- Every linkage carries a `NOT_VERIFIED` pill. sha256 is not re-verified and nothing is certified: `certified=0`, `authorityEffect NONE`, `executable false` are unchanged.
- No new endpoint, allow-list entry, POST, IPC or storage. No design parity claim (UI-201 PNG is UNKNOWN_SOURCE).
- Files: `academy-core.js`, `views/academy.js`, `locales/{en,tr}.js` (`academy.evidence.*`), `styles.css` (token-only), `tests/v7-ux-academy.test.ts`.
