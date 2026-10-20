<!-- //TR: UI-114 "Durum açıklamaları" teslim kaydı: Ayarlar'da 14 PILL_KINDS rozetini tanımlayan statik, salt-okunur açıklama paneli. Yeni okuma/endpoint/depolama yoktur. Tasarım eşleşmesi doğrulanmadı (UNKNOWN_SOURCE). -->

# UI-114 Settings state legend

- Scope: renderer-only. `legendPanel(ctx)` in `views/settings.js`, 16 `settings.legend.*` keys in en/tr (after `settings.app.gateNote`).
- Static: reads no data; sample pills have `data-pill` replaced by `data-legend-kind`, so honesty tests that count real pills are unaffected.
- Keeps VERIFIED (validated server fact, not product verification), NOT_VERIFIED, NOT_EXECUTED and PRODUCT_VERIFIED (tests passed in a verified sandbox) distinct.
- Not covered: per-route NOT_VERIFIED badge, verificationChip vocabulary, state-variant design contract, design parity, product verification.
- Windows and full run-validation: NOT_RUN.
