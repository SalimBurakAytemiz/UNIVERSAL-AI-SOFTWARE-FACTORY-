<!-- //TR: UI-105 "Rota başlıklı yükleme iskeleti" teslim kaydı: kapsam, dürüstlük kuralları ve çalıştırılmayan (NOT_RUN) doğrulamalar. -->

# UI-105 Route-titled, number-free loading skeleton

- **Scope:** every route except home and tower (projects, work, workforce, assurance, inbox, settings and all routes hosted by `views/planned.js`). Each view re-exports `viewSkeleton` from `components.js` as `skeleton`; the existing per-view hook in `app.js` picks it up. `app.js`, `index.html` and `views/tower.js` are unchanged.
- **Content:** `div.view[aria-busy][data-skeleton=<route id>]` with the route's `area.<id>.title` as the single H1, one `role=status` line (`state.LOADING`), and three empty `aria-hidden` `.skel-block` placeholders. No locale key, endpoint, POST, IPC or storage is added.
- **Honesty:** synchronous, reads no data, shows no number, pill, chip or KPI. For a missing/unknown route or any internal error it returns the same single "Loading" note as the `app.js` fallback; it never throws.
- **CSS:** token-only `.skel-block`, existing `pulse` keyframes (disabled by the global reduced-motion rule), forced-colors border.
- **Not claimed:** design parity, product verification (PRODUCT_VERIFIED), a tower skeleton, or empty/error/denied variants. Windows and full run-validation: NOT_RUN.
