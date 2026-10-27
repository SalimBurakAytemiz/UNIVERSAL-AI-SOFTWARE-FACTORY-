<!-- //TR: UI-030 "Aktif İşçi Filosu Izgarası" teslim kaydı: kapsam, davranış, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Tasarım eşleşmesi doğrulanmadı (tasarım paketi UNKNOWN_SOURCE). -->

# UI-030 Active worker fleet grid ("Aktif İşçi Filosu Izgarası")

- **Screen:** UI-030, Agents & Workforce, P0.
- **Where it renders:** a new "Worker fleet" panel on `#/workforce`, above the existing live-runs table. No route was added and the existing panels are unchanged.
- **Authority:** none needed. The grid is renderer-only and uses only the `GET /v1/work-runs` result the view already reads. There is no new endpoint, allow-list entry, POST, IPC channel, storage or protected-file change.

## Behaviour and honesty rules (tested)

- **Cards:** one card per run in one of three buckets (A-RUNSTATE-1): **live** (exactly the server's `ACTIVE_WORKER_STATUSES` from `core/workos/run-state.ts`: LEASED, RUNNING, CHECKPOINTING, VERIFYING), **queued, not running yet** (QUEUED only, not a live worker) and **unknown status** (anything the server does not define, never counted as live). Each card shows the run id, the status pill, the role if present, the last heartbeat as `<time datetime>` if present, and an "Open mission" button if the run has a mission id. Known non-live, non-terminal runs (retry scheduled, recovering, awaiting approval ...) are not carded; they are counted in an explicit "other" note.
- **UNKNOWN:** a role or heartbeat missing from the data is shown as UNKNOWN. No liveness, count or runtime state is invented. The note that the 599-role catalog is not live agents is kept. The server `WorkRun` has no heartbeat field (only `leaseExpiresAt`), so the heartbeat is UNKNOWN for real runs; the lease expiry and start time are never shown as a heartbeat.
- **Grouping:** live statuses in the server's order, then the queued bucket, then the unknown bucket. Bucket counts are real counts of the runs read. A summary line states the live / queued / unknown counts.
- **Cap:** at most 50 cards (live buckets fill first), with a "Showing X of Y live, queued and unknown-status runs" note only when truncated. If the run list itself was cut at the 500-run cap (the server lists the oldest first, so the newest runs are the ones lost), the fleet and the Live runs panel show a "list truncated" note instead of the summary or any "no live runs" note.
- **Read failures:** the existing honest state note replaces the grid, never a 0. An empty list shows an explicit empty note.
- **Accessibility:** the grid is a labelled region. Each bucket is a labelled section with an h3, cards are list items, and the mission link is a real button (keyboard-reachable). Styles use tokens only, with a forced-colors fallback.
- **Pure core:** `fleet-core.js` is DOM-free. The view renders with `h()`/`textContent` only.

## Files

- `apps/desktop/renderer/fleet-core.js` (new).
- `apps/desktop/renderer/views/workforce.js`: fleet panel.
- `apps/desktop/renderer/styles.css`: a token-only block inside the existing workforce section.
- `apps/desktop/renderer/locales/{en,tr}.js`: 10 `workforce.fleet.*` keys, with identical keys and placeholders.
- `tests/v7-ux-wp-agents.test.ts`: 7 new tests in a new `describe` block (20/20 in the file; 8 tests incl. a collision guard).

## Evidence (local, Linux, Node v22.22.0, vitest)

| Command | Result |
|---|---|
| `npx vitest run tests/v7-ux-wp-agents.test.ts` | 20/20 passed (8 new) |
| `npx vitest run tests/v7-b5-work-screens.test.ts tests/v7-ux-*.test.ts tests/v7-b4-*.test.ts` | 26 files, 618/618 passed |
| `npx vitest run $(grep -l "desktop/renderer" tests/*.test.ts)` | 8 files, 101/101 passed |
| `npx tsc --noEmit` | exit 0, no output |
| `node scripts/validate-tr-comments.mjs` | TR_VALIDATION: PASS |

## Not run / not verified

- **`npm ci` as specified:** it fails with `EBADENGINE` (package requires node >=24, local node is v22.22.0). The install was done with `npm ci --engine-strict=false` (294 packages added).
- **Windows, full `run-validation.mjs`, Node 24:** NOT_RUN. This needs the required CI checks on the PR head.
- **Real desktop app with a live backend:** NOT_RUN.
- **Design parity:** NOT_VERIFIED. The design package is UNKNOWN_SOURCE.
- **Independent review:** pending. The implementer does not approve this change.
