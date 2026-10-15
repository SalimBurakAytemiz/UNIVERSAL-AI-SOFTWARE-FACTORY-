<!-- //TR: Bu README Control Tower 2B kampüs modülünün veri sözleşmesini, 2B/3B parite kuralını ve dürüstlük kurallarını anlatır; modül henüz kabuğa bağlı değildir. -->
# Control Tower 2D campus module

Self-contained, dependency-free renderer module (Master V2 section 10, UX-DEC-067 Guild Company Campus,
DSK-061-10 2D/3D parity, DSK-061-11 role registry is not runtime). It is **not wired into the shell yet**;
the shell owner imports it later. Plain ES modules, no DOM access, no network, no AI provider calls.

## Files

| File | Purpose |
|---|---|
| `model.js` | `buildCampusModel(input)`: pure, deterministic layout and counts |
| `render-svg.js` | `renderCampusSvg(model, {t, reducedMotion, locale})` returns an SVG string |
| `list-view.js` | `renderCampusList(model, {locale})` returns the accessible table equivalent (HTML string) |
| `locales.js` | `STRINGS` (`tr`, `en`), `tr()`, `esc()`, `truncate()`; the shell merges the dictionary later |
| `*.d.ts` | Type declarations for the tsc gate only |

## Data contract

```
buildCampusModel({
  cockpit: <GET /v1/cockpit payload> | null,      // only cockpit.globalStop.active (boolean) and .reason are read
  catalog: { clusters: [{clusterId, name}],
             guilds:   [{guildId, name, clusterId}],
             roles?:   { [guildId]: <non-negative integer target role count> } } | null,
  runs:    [{runId, missionId, status, roleId|null, guildId|null}] | null
})
```

- Layout: clusters sorted by `clusterId` take fixed slots (4 top, 1 right, 4 bottom, 1 left; extra clusters
  go to overflow rows). Guilds sorted by `guildId` fill the plate two per row. No randomness; same input gives
  byte-identical output. Expected catalog: 10 districts, 51 buildings from the canonical role registry
  (`registries/role-definitions.json`, WFR-03; the former target catalog was promoted into it and deleted).
- Building: `{guildId, clusterId, name, x, y, width, height, targetRoles, activeRuns, state}`.
- `activeRuns` counts distinct `runId`s whose status is one of `LEASED`, `RUNNING`, `CHECKPOINTING`, `VERIFYING`
  and whose `guildId` is a catalog guild. Live runs without a usable `guildId` are only counted in
  `totals.unattributedActiveRuns`; they are never assigned to a building by guessing.
- `globalState`: `RUNNING` | `STOPPED` | `UNAVAILABLE`. `globalStop.active === true` marks the whole campus
  `STOPPED` and the SVG draws a `role="alert"` overlay (no animation while stopped).
- Each SVG building and list row carries the same `data-guild-id`, `data-cluster-id`, `data-target-roles`,
  `data-active-runs`, `data-state` attributes (`na` for unknown).

## Parity rule (2D equivalent of the visual campus)

The SVG campus and the list view are two renderings of one model. They must show the same districts, the
same guild ids and the same counts; neither may carry information the other lacks. The list view is the
keyboard/screen-reader path and the low-GPU fallback. A future 3D renderer must consume the same model and keep
this parity.

## Honesty rules

1. Missing data is never invented. No cockpit (or a cockpit without a boolean `globalStop.active`), no catalog
   role count, or no runs list gives `state: "UNAVAILABLE"` and `null` counts; the UI shows "VERI YOK", never `0`.
2. No catalog means no districts or buildings at all (there are no ids to draw); the SVG shows only the tower
   and a notice.
3. `targetRoles` is **catalog capacity** (target inventory, `TARGET_CATALOG_NOT_RUNTIME`), never a count of
   running agents. Only `activeRuns` reflects live work, and only from the supplied `runs`.
4. Registry role status is not runtime status (DSK-061-11); this module reads no registry and certifies nothing.
5. All names and reasons are escaped (`esc`) in SVG text, `<title>`, `aria-label` and HTML; the SVG uses only
   presentation attributes (no `<style>`, no `style=`, no scripts), so it works under the shell CSP
   `style-src 'self'`.
6. `reducedMotion: true` (and any `STOPPED` state) produces no `<animate*>` elements.
