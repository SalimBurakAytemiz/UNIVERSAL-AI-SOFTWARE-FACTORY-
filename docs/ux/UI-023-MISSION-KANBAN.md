<!-- //TR: UI-023 "Görev Kanban Panosu" teslim kaydı: kapsam, davranış, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Tasarım eşleşmesi doğrulanmadı (tasarım paketi UNKNOWN_SOURCE). -->

# UI-023 Mission Kanban board ("Görev Kanban Panosu")

- **Screen:** UI-023, Work OS missions, P0. Audit status before this change: DESIGN_ONLY ("no kanban column board"), according to `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv`.
- **Where it renders:** a List / Board layout toggle in the Missions panel of `#/work`. List stays the default, so the existing filter and table flow is unchanged. No route was added.
- **Authority:** none needed. The board is renderer-only and uses only the `GET /v1/missions`, `GET /v1/projects` and `GET /v1/work-runs` results the view already reads. There is no new endpoint, allow-list entry, POST, IPC channel, policy change or protected-file change.

## Behaviour and honesty rules (tested)

- **Columns:**
  - Main-path lifecycle columns (`MISSION_PATH`) are always shown, with an honest 0 when empty.
  - Off-path statuses (for example BLOCKED or FOUNDER_ATTENTION_REQUIRED) appear only when a mission has one.
  - Unrecognised statuses are never dropped. They go in a separate last column with their raw value.
  - Every mission appears in exactly one column. Each column shows at most 50 cards, with a "showing X of Y" note.
- **Transitions:** the board does not change mission status. A card opens the existing mission detail, where the confirmation and reason rules for transitions already apply. The board makes no POST and no extra GET.
- **Read failures:** if the missions source is unreadable, the existing honest state note is shown instead of the board. An empty list shows the empty note.
- **Layout state:** the layout choice is kept in memory for the session only. There is no storage, network access or randomness.
- **Accessibility:**
  - The board is a labelled group. Each column is a section labelled by its h3, which carries the count.
  - Card lists are labelled, card titles are real buttons with focus keys, and times are machine-readable.
  - Empty columns say "No missions." in text.
  - Styles use tokens only, with a forced-colors fallback and a single column below 40rem.

## Files

- `apps/desktop/renderer/kanban-core.js` (new, pure core).
- `apps/desktop/renderer/views/work.js`: layout toggle and board.
- `apps/desktop/renderer/styles.css`: a token-only block inside the existing WP-WORKOS section.
- `apps/desktop/renderer/locales/{en,tr}.js`: 9 `work.board.*` keys, with identical keys and placeholders.
- `tests/v7-ux-wp-workos.test.ts`: 7 new tests in this already-registered file. The file's `beforeEach` now also resets the board layout.

## Evidence (local, Linux, Node v22.22.0, vitest)

| Command | Result |
|---|---|
| `npx vitest run tests/v7-ux-wp-workos.test.ts` | 23/23 passed (7 new) |
| all `tests/v7-ux-*`, `tests/v7-b4-*` and the 7 other renderer-related test files (32 files) | 764/764 passed |
| `node scripts/validate-tr-comments.mjs` | TR_VALIDATION: PASS |

## Not run / not verified

- **Windows, full `run-validation.mjs`, Node 24:** NOT_RUN locally. This needs the required CI checks on the PR head.
- **Real desktop app with a live backend:** NOT_RUN.
- **Design parity:** NOT_VERIFIED. The design package is UNKNOWN_SOURCE.
- **Independent review:** pending. The implementer does not approve this change.
