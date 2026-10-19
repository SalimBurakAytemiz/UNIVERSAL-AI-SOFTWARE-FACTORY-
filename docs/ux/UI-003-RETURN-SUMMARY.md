<!-- //TR: UI-003 "Dönüş Özeti" (son ziyaretten beri ne oldu) teslim kaydı: kapsam, davranış, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Tasarım eşleşmesi doğrulanmadı (tasarım paketi UNKNOWN_SOURCE). -->

# UI-003 Return Summary ("Dönüş Özeti")

- **Screen:** UI-003, workspace SC-02 Founder Cockpit / Home. Audit status before this change: DESIGN_ONLY, no code (`docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv`).
- **Where it renders:** the first panel of `#/executive`, the nearest existing surface named in the audit. No route was added.
- **Authority:** none needed. The panel is renderer-only and reuses two GETs that are already allow-listed. There is no new endpoint, no allow-list change, no protected file and no policy change.

## Behaviour

- **What it shows:** what changed since the Founder last marked the view as seen on this device:
  - runs with activity after the marker, grouped by their **current** status: waiting for your decision, failed, blocked/quarantined, succeeded, cancelled/stopping, still in progress;
  - missions created after the marker;
  - source deliveries accepted after the marker.
- **Data:** the panel uses the same `GET /v1/work-runs` and `GET /v1/missions` results the view already reads. It issues no request of its own; a test checks that the view still makes exactly the same four GETs.
- **Marker:**
  - It is stored in this device's `localStorage` under one key, `uasco.executive.returnSeenAt`.
  - It is written only when the Founder presses "Mark all as seen". The panel writes nothing else.
  - The stored value is the newest **server** timestamp in the data (the watermark), not the client clock, so client clock skew cannot hide or invent changes.
  - Only records strictly after the marker count as new.
  - Marking is offered only when BOTH sources were read. If missions are unreadable (PARTIAL), there is no mark button, so unseen missions can never be hidden (review finding B1 on `9315dba`).
  - The marker never moves backwards: the later of the stored marker and the new watermark is kept.
  - When a list is truncated, a note next to the button says that marking also covers the items not shown.

## Honesty rules (tested)

- **Unreadable work runs:** shown as an honest OFFLINE/UNAVAILABLE/ERROR status block naming the source. There are no counts and no mark button.
- **Unreadable missions:** the summary is PARTIAL. The new-missions count is shown as "—", never 0, and "nothing new" is never claimed.
- **No marker yet:** FIRST_VISIT. Nothing is counted as new.
- **Unreadable marker:** ignored, with a note. The window since the last visit is not guessed.
- **No device storage:** an honest note. There is no mark button and no summary.
- **Failed save:** nothing changes, and the status region says so.
- **Deliveries:** always marked NOT_VERIFIED (source level only). No working-product claim is made anywhere.
- **Run transitions:** runs are grouped by current status. A run's intermediate steps are not reconstructed, and the panel says so.

## Files

- `apps/desktop/renderer/return-summary-core.js` (new): the pure core (marker read/write, watermark, summary).
- `apps/desktop/renderer/views/return-summary.js` (new): the panel. The read-only `executive.js` delegates to it, and `executive.js` itself still touches no storage.
- `apps/desktop/renderer/views/executive.js`: one import and the panel placement.
- `apps/desktop/renderer/locales/en.js` and `tr.js`: 31 `executive.return.*` keys in each, with identical keys and placeholders.
- `tests/v7-ux-executive.test.ts`: already registered in `config/validation.json`, so no protected registration change was needed.
  - 20 new tests.
  - Two existing section-order assertions were extended to include the new section.
  - The import guard now lists the new module, and a new guard pins its only write.

## Evidence (local, Linux, Node v22.22.0, vitest)

| Command | Result |
|---|---|
| `npx vitest run tests/v7-ux-executive.test.ts` | 60/60 passed |
| `npx vitest run tests/v7-ux-*.test.ts tests/v7-b4-*.test.ts` (25 files) | 575/575 passed |
| `npx vitest run` on the 7 other test files that reference the renderer | 202/202 passed |
| `node scripts/validate-tr-comments.mjs` | TR_VALIDATION: PASS |

## Not run / not verified

- **Windows, full `run-validation.mjs`, Node 24:** NOT_RUN locally. This needs the required `validate (ubuntu-latest)` and `validate (windows-latest)` checks on the PR head.
- **Real desktop app with a live backend:** NOT_RUN. There is no product evidence.
- **Design parity:** NOT_VERIFIED. The 252-screen design package is UNKNOWN_SOURCE (it is on the Founder PC), so no visual match is claimed.
- **Independent review:** pending. The implementer does not approve this change.
