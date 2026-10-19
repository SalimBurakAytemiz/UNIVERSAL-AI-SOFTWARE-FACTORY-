<!-- //TR: UI-030 "Aktif İşçi Filosu Izgarası" teslim kaydı: kapsam, davranış, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Tasarım eşleşmesi doğrulanmadı (tasarım paketi UNKNOWN_SOURCE). -->

# UI-030 Active worker fleet grid ("Aktif İşçi Filosu Izgarası")

- **Screen:** UI-030, Agents & Workforce, P0.
- **Where it renders:** a new "Worker fleet" panel on `#/workforce`, above the existing live-runs table. No route was added and the existing panels are unchanged.
- **Authority:** none needed. The grid is renderer-only and uses only the `GET /v1/work-runs` result the view already reads. There is no new endpoint, allow-list entry, POST, IPC channel, storage or protected-file change.

## Behaviour and honesty rules (tested)

- **Cards:** one card per live (non-terminal) work run, as defined by the existing `liveRuns`. Each card shows the run id, the existing status pill, the role if present, the last heartbeat as `<time datetime>` if present, and an "Open mission" button if the run has a mission id.
- **UNKNOWN:** a role or heartbeat missing from the data is shown as UNKNOWN. No liveness, count or runtime state is invented. The note that the 599-role catalog is not live agents is kept.
- **Grouping:** cards are grouped by status bucket in the `RUN_ACTIVE_STATES` order. Bucket counts are real counts of the live runs.
- **Cap:** at most 50 cards, with a "Showing X of Y live runs" note only when truncated.
- **Read failures:** the existing honest state note replaces the grid, never a 0. An empty list shows an explicit empty note.
- **Accessibility:** the grid is a labelled region. Each bucket is a labelled section with an h3, cards are list items, and the mission link is a real button (keyboard-reachable). Styles use tokens only, with a forced-colors fallback.
- **Pure core:** `fleet-core.js` is DOM-free. The view renders with `h()`/`textContent` only.

## Files

- `apps/desktop/renderer/fleet-core.js` (new).
- `apps/desktop/renderer/views/workforce.js`: fleet panel.
- `apps/desktop/renderer/styles.css`: a token-only block inside the existing workforce section.
- `apps/desktop/renderer/locales/{en,tr}.js`: 10 `workforce.fleet.*` keys, with identical keys and placeholders.
- `tests/v7-ux-wp-agents.test.ts`: 7 new tests in a new `describe` block (19/19 in the file).

## Evidence (local, Linux, Node v22.22.0, vitest)

| Command | Result |
|---|---|
| `npx vitest run tests/v7-ux-wp-agents.test.ts` | 19/19 passed (7 new) |
| `npx vitest run tests/v7-ux-*.test.ts tests/v7-b4-*.test.ts` | 25 files, 562/562 passed |
| `npx tsc --noEmit` | exit 0, no output |
| `node scripts/validate-tr-comments.mjs` | TR_VALIDATION: PASS |

## Not run / not verified

- **`npm ci` as specified:** it fails with `EBADENGINE` (package requires node >=24, local node is v22.22.0). The install was done with `npm ci --engine-strict=false` (294 packages added).
- **Windows, full `run-validation.mjs`, Node 24:** NOT_RUN. This needs the required CI checks on the PR head.
- **Real desktop app with a live backend:** NOT_RUN.
- **Design parity:** NOT_VERIFIED. The design package is UNKNOWN_SOURCE.
- **Independent review:** pending. The implementer does not approve this change.
