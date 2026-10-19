<!-- //TR: UI-113 "Onay gerekli" paneli teslim kaydı: kapsam, davranış, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Tasarım eşleşmesi doğrulanmadı (tasarım paketi UNKNOWN_SOURCE). -->

# UI-113 Approval-required state panel ("Onay gerekli")

- **Screen:** UI-113, Inbox / Founder decisions, P0.
- **Where it renders:** a standalone "Approval required" panel (`#inbox-required`) directly above the "Missions awaiting approval" panel on `#/inbox`. No route was added.
- **Authority:** none needed. The panel is renderer-only and uses only the `ctx.api.cockpit()`, `ctx.api.allMissions()` and `ctx.api.workRuns()` results the view already reads. There is no new endpoint, allow-list entry, POST, IPC channel, storage or protected-file change. The transition rules in `work-core.js` / `work-actions.js` are reused read-only.

## Behaviour and honesty rules (tested)

- **Per mission awaiting approval (cockpit approvals items):**
  - risk level;
  - pending transition, with an "Irreversible" and a "High risk: explicit confirmation required" flag taken from `allowedNext`, `requiresConfirm` and the terminal-state rule of `MISSION_TRANSITIONS`;
  - linked work run and its status;
  - waiting-since as a `<time datetime>` element plus age. The basis is the run start, or else the mission creation time;
  - text for "If approved" and "If rejected", derived from the existing transition definitions.
- **Unknown stays unknown:**
  - Blast radius / impact is always shown as UNKNOWN, because the data has no such field.
  - A mission that is missing from the missions read shows UNKNOWN for the transition.
  - Unreadable work runs show UNKNOWN for the run.
- **No new action:** the per-row button only focuses and scrolls to the existing approval card (`ap-card-<missionId>`, `tabindex=-1`). Decisions stay the existing confirmed transitions. Nothing is auto-approved and the panel makes no POST and no extra GET.
- **States:** a read failure shows the existing honest state note (never a 0). An empty queue shows "Nothing awaits your approval."
- **Cap:** at most 50 rows, with a "showing X of Y" note.
- **Accessibility:** labelled region (`aria-labelledby`), h2/h3 headings, labelled list, labelled focusable buttons. Styles are tokens only, with a forced-colors fallback.
- **Render:** `h()`/`textContent` only, no `innerHTML`.

## Files

- `apps/desktop/renderer/approval-core.js` (new, pure core).
- `apps/desktop/renderer/views/inbox.js`: the panel, plus an id and `tabindex` on the existing approval cards.
- `apps/desktop/renderer/locales/{en,tr}.js`: 27 `inbox.required.*` keys, with identical keys and placeholders.
- `apps/desktop/renderer/styles.css`: one token-only block with a forced-colors fallback.
- `tests/v7-ux-inbox.test.ts`: a new self-contained `describe` block (9 tests).

## Evidence (local, Linux, Node v22.22.0, vitest)

| Command | Result |
|---|---|
| `npm ci --no-audit --no-fund` | FAILED: EBADENGINE, the repo requires node >=24 and this host has v22.22.0. Dependencies were installed with `--engine-strict=false` |
| `npx vitest run tests/v7-ux-inbox.test.ts` | 19/19 passed (9 new) |
| `npx vitest run tests/v7-ux-*.test.ts tests/v7-b4-*.test.ts` | 564/564 passed (25 files) |
| `npx tsc --noEmit` | exit 0 |
| `node scripts/validate-tr-comments.mjs` | TR_VALIDATION: PASS |

## Not run / not verified

- **Windows, full `run-validation.mjs`, Node 24:** NOT_RUN.
- **Real desktop app with a live backend:** NOT_RUN.
- **Design parity:** NOT_VERIFIED. The design package is UNKNOWN_SOURCE.
- **Independent review:** pending. The implementer does not approve this change.
