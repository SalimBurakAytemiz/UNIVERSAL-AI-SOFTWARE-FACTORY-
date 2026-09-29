<!-- //TR: Bu rapor V7 VISUAL-PARITY paketinin görsel-KOD parite iyileştirmesini kriter kriter (TARGET=onaylı referans, BEFORE=mevcut renderer, AFTER=değişen CSS/bileşen) dürüstçe belgeler. Gerçek Windows ekran görüntüsü/piksel regresyonu bu pakette DEĞİLDİR; o ayrı bir follow-on'dur (TEST-variant render koşum hattı). Bu paket yalnız görsel-KOD parite iyileştirmesi iddia eder, doğrulanmış piksel paritesi DEĞİL. -->

# UASCO Desktop — Visual Parity Report (V7 VISUAL-PARITY)

- Package: `FA-V2-PRODUCT + FD-ROLE-CLAUDE-IMPL` (Claude builder; separate reviewer; **not clean / not self-declared CLEAN**)
- Worktree: `C:/Users/salim/UASCO-wt/v2-visualparity` branch `v7/visual-parity` from `3982bb6c83ffc4818e86cdb2c2cb1b549fbc3468`
- Aesthetic authority (read as images): `00_ONAYLI_REFERANS/UASCO_FOUNDER_REFERANS.png`; cockpit `01_ILK_116_EKRAN/UI-001.png`; `UI-053` (tower2d), `UI-054` (tower3d), `UI-236` (executive).
- Scope: **visual / CSS / composition** upgrade of the real renderer (`apps/desktop/renderer/styles.css`). **No data change**, no new runtime deps, LF, `//TR`, no fabricated KPI/agent/project/activity, `h()/textContent` preserved.
- Protected changes (authorized only): `config/validation.json` (new test appended at end of the single `tests` step), `config/trust-root-manifest.json` (resealed last). Renderer `styles.css` is **non-protected**.

## Honest headline finding

The renderer was already built to the approved blueprint: the **design-token palette already matched the NIHAI section-2 start values** and already passed WCAG AA (prior WP1b reconciliation, documented inline in `styles.css`). So the palette criterion was **already at target — no color hex was changed** (changing it would risk AA for no parity gain). The genuine gap vs the reference was in **premium finish/composition**: flat single-shadow elevation, a typographic scale with a gap between body and title, modest KPI number prominence, plain panel headers, and flat card surfaces. Those are what this package upgraded, token-driven, with one source of truth.

## This is NOT verified pixel parity (explicit)

Live Windows screenshot capture and pixel/visual-regression at each route and each DPI (100/125/200/400%) is a **separate follow-on** — the **TEST-variant render harness** — and was **NOT performed in this package**. This report therefore claims **visual-CODE parity improvement**, not verified pixel parity. The static assertions here are structural/token/contrast checks over the CSS, not rendered-image comparisons.

## Per-criterion: TARGET vs BEFORE vs AFTER

### 1. Palette
- TARGET: dark navy canvas `#050E1E`, surface `#0A1D37`, elevated `#102844`, border `#214F75`, focus `#16B8FF`, fg `#F1F8FF`, muted `#A5BAD2`, success `#16DC9B`, caution `#FFBC42`, danger `#FA4D69` — adjusted for AA text contrast.
- BEFORE: already reconciled; all start values exact; danger `#FA4E6A` (documented AA-adjust of `#FA4D69`, per-channel ≤4).
- AFTER: **unchanged** (no hex touched). Locked by new test `exact reference start values ...` + `danger is the reference danger family, AA-adjusted`. One source of truth preserved.

### 2. Typography
- TARGET: commanding page titles and KPI numbers; clear h2/h3 rhythm.
- BEFORE: `--fs` scale had a gap (`body .875rem` → `title 1.75rem`); `.panel-title`/`.feed-title` hard-coded `1.05rem`, `.card h3` `1rem`, `.kpi-value` `2rem`; no intermediate tokens.
- AFTER: added rhythm tokens `--fs-h3:.9375rem; --fs-h2:1.0625rem; --fs-kpi-sm:1.6rem; --fs-kpi:2.25rem`; applied to `.panel-title`/`.feed-title` (h2, weight 700), `.card h3` (h3, weight 700), `.kpi-value` (`--fs-kpi`, weight 800, `letter-spacing:-.015em`, tabular-nums), `.duo .kpi-value` (`--fs-kpi-sm`); `.view h1` weight 800 + `-.01em` + `line-height:1.15`; `body` gets `-webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility`.

### 3. Cards (density / composition / padding / radius)
- TARGET: dense premium info cards with depth and a jewel surface.
- BEFORE: `.card` flat `background:var(--bg-2)`, `radius-md`, single `elev-1`, `.9rem` pad; `.area-card`/`.strip-item` flat.
- AFTER: `.card`/`.area-card` gradient surface (`surface → bg-2`) + `elev-1` + denser pad; `.area-card:hover` lift (`glow-sm + elev-2`); `.strip-item` gradient + elevation; `.kpi` → `radius-xl`, gradient (`surface-2 → surface`), `elev-2`, `--space-5` vertical pad; `.panel` → `radius-lg`, gradient, `elev-2`. All token-driven, no embedded hex (asserted hex-free).

### 4. KPI hierarchy + drill treatment
- TARGET: colored icon tile, big bold number, delta, sparkline, drillable.
- BEFORE: icon tile flat `bg-2` + `border`; value `2rem`; drill hover `glow-sm` only.
- AFTER: `.kpi-icon` gets a radial tint (`glow-soft → bg-2`) + inner bevel (`--inner-top`) + `border-ui`; `.kpi-value` `--fs-kpi` 2.25rem; `.kpi-drill:hover` adds `elev-2` for a premium lift. Registered-vs-active duo and honest EMPTY/UNAVAILABLE/NOT_VERIFIED states **unchanged** (still real-data-bound).

### 5. Neon glow / elevation / depth layering
- TARGET: selective neon glow (jewel tower, live/risk), real depth.
- BEFORE: single flat `--elev-*` shadows; glow discipline already present.
- AFTER: layered elevation tokens `--elev-1/2/3` = ambient + key shadow + `--inner-top` light bevel (`--hairline`/`--hairline-strong` neutral-light tokens, not a second palette); `body` adds a third depth vignette radial. **Glow discipline preserved**: base `.kpi`/`.card`/`.panel` carry neutral elevation only (asserted no `glow-md/lg`); glow stays on focus/selected (`--glow-md`), live (`--glow-live`) and risk (`--glow-risk-*`).

### 6. Cockpit hero
- TARGET: Founder welcome with strong title and a glowing centerpiece.
- BEFORE: hero eyebrow + `h1` + subtitle + identity chip; plain panel headers.
- AFTER: bolder `h1`; new reference-style section marker `.panel-title::before` (accent→accent-2 gradient bar, 3px) echoing the reference's numbered-section cue, on every panel title. Identity/tenant/as-of remain from real principal/project only (no "Alex/Healthcare" demo text).

### 7. Tower (2D/3D control tower)
- TARGET: jewel-like, glowing isometric control tower canvas.
- BEFORE: `.ct-map` flat `surface` + `glow-sm`.
- AFTER: `.ct-map` ambient radial (`ambient-blue`) + `glow-sm + elev-2` + `radius-lg` for a jewel-like depth frame. Tower SVG geometry (`render-svg.js`) unchanged; honest DEMO/NOT_VERIFIED states unchanged.

### 8. Turkish (TR) + overflow
- All new comments are `//TR`; `validate-tr-comments` PASS. No fixed-px widths introduced; padding/radius/type are rem/token-based and scale with the root `clamp(16px,.35vw+10px,24px)`; `container-type` and `overflow-wrap` paths intact → Turkish strings wrap without overflow. Existing structural suites (b4/b5/ps1b/wp2/wp3/projects/workos/tower) still pass, so no layout regression.

### 9. DPI / zoom (1280/1366/1920/4K, 100/125/200/400%)
- Root font `clamp(16px … 24px)` scales up to 4K; KPI grid container queries (`1 / 2 / 4` cols at 38rem/52rem) unchanged; new paddings are `--space-*` rem tokens; `@media max-width:1100px/760px/640px` and `min-width:2200px` responsive rules untouched; ACİL DURDUR never hidden (asserted). No new fixed px that would clip at 200/400%.

### 10. a11y — contrast (measured ratios on the reconciled palette)

| fg token | bg token | ratio | AA (≥4.5) |
|---|---|---|---|
| text `#F1F8FF` | bg `#050E1E` | 18.02 | PASS |
| text | surface `#0A1D37` | 15.77 | PASS |
| text | surface-2 `#102844` | 13.92 | PASS |
| muted `#A5BAD2` | bg | 9.70 | PASS |
| muted | surface | 8.49 | PASS |
| muted | surface-2 | 7.49 | PASS |
| muted | bg-2 `#07182D` | 8.96 | PASS |
| accent `#15C5FF` | bg | 9.62 | PASS |
| accent | surface | 8.41 | PASS |
| accent | surface-2 | 7.43 | PASS |
| focus `#16B8FF` | bg | 8.58 | PASS |
| on-danger `#ffffff` | danger-bg `#b4132a` | 6.85 | PASS |
| danger `#FA4E6A` | bg-2 | 5.40 | PASS |
| ok `#16DC9B` | bg-2 | 9.97 | PASS |
| warn `#FFBC42` | bg-2 | 10.64 | PASS |
| accent-2 `#448BFF` | bg-2 | 5.42 | PASS |
| purple `#A570FF` | bg-2 | 5.40 | PASS |

All text/icon pairs ≥ 4.5:1 (tightest: danger/bg-2 and purple/bg-2 at 5.40, accent-2/bg-2 at 5.42). No AA regression (no color hex changed). `:focus-visible` (3px), `prefers-reduced-motion:reduce` (all transitions/animations → 0; no new auto-playing animation was introduced — only pre-existing `pulse`/`stop-glow`), and `forced-colors:active` extended so the new surfaces drop `box-shadow:none` and `.panel-title::before` falls back to `Highlight` (decorative color is never the sole signal).

## Changed files
- `apps/desktop/renderer/styles.css` — premium composition (non-protected).
- `tests/v7-ux-vp-visual-parity.test.ts` — NEW; locks palette reconciliation, AA, token-driven composition, glow discipline, reduced-motion/forced-colors coverage.
- `config/validation.json` — appended the new test at the END of the single `tests` step.
- `config/trust-root-manifest.json` — resealed LAST.

## Validation posture
`npx tsc --noEmit` clean; all listed desktop/renderer suites + new parity test pass; `validate-tr-comments`, `secret-sanity`, `verify-trust-root` (post-reseal), `v6-apps-control-desktop-selftest` PASS; full canonical `run-validation.mjs` executed. Builder does not self-declare CLEAN — a separate governed reviewer owns the gate.
