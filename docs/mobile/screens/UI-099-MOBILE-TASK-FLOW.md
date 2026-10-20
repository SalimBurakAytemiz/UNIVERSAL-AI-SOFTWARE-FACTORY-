<!-- //TR: MOB-6 ekran şartnamesi UI-099 Mobil Görev Akışı (yalnız tasarım, ETKİN DEĞİL): görevler (mission), work-run listesi ve görev zaman çizelgesi yalnız okunur gösterilir; veri ÖNERİLEN /v1/mobile/runs ve /v1/mobile/missions/:id/timeline rotalarından gelir, bunlar mevcut /v1/work-runs, /v1/missions/:id, /v1/predev ve /v1/crew okumalarına dayanır. Geçiş, onay, teslim, STOP veya RESUME yoktur. -->

# UI-099: Mobile Task Flow (Mobil Görev Akışı)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB (`docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md`) section 11 row UI-099.
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`; `server.ts` = `apps/control-api/src/server.ts`).
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:100` (AUTHORITY_REQUIRED, no route).

## 1. Purpose

Follow work from mission to run: which missions exist, in which status, which runs belong to them, and what each run's outcome and delivery state is.

## 2. Target function and release

- **Function:** F4 Tasks/workflow (D-MOB section 5).
- **Release:** R1, read-only monitoring.
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. **Build packages:** MOB-16, MOB-21.

## 3. Data source

| Source | Status | Upstream evidence |
|---|---|---|
| `GET /v1/mobile/runs?missionId&status&cursor&limit` | **PROPOSED** (MOB-3 4.4) | `GET /v1/work-runs` `server.ts:274-277`; `GET /v1/runs` `server.ts:124-128` |
| `GET /v1/mobile/runs/:runId` | **PROPOSED** (MOB-3 4.4) | `GET /v1/work-runs/:id` `server.ts:278-282` (`deriveOutcomes`, `deliveryView` at `:281`) |
| `GET /v1/mobile/missions/:missionId/timeline` | **PROPOSED** (MOB-3 4.5) | `GET /v1/missions/:id` `server.ts:217-220`; `/v1/predev/:missionId` `:587-591`; `/v1/crew/:missionId` `:592-601` |

## 4. Fields

**Mission header** (timeline route):

| Field | Upstream | Rule |
|---|---|---|
| `mission.missionId`, `projectId`, `status`, `riskLevel` | `getMission` `server.ts:219` | `—` if absent |
| `mission.title` | `server.ts:219` | untrusted text, capped 200 chars, shown with provenance (SC-10) |
| `events[]: at, kind, fromStatus, toStatus, actorClass` | MOB-3 4.5 (projection from journal; feasibility **UNVERIFIED**) | `actorClass` only, never a token or session id |
| transition `reason` | MOB-3 4.5 | free text: untrusted, capped 300 chars, never parsed |
| tasks | `server.ts:219` returns `tasks` | reported always empty (D-MOB F4; **UNVERIFIED** here): no task list is promised |

**Run list item / detail** (runs route):

| Field | Upstream | Rule |
|---|---|---|
| `runId`, `missionId`, `projectId`, `status`, `createdAt`, `updatedAt` | `listRuns` via `server.ts:276`; `WorkRun` `createdAt`/`updatedAt` at `core/workos/types.ts:137` (interface `:131`) | status values per run enum (**UNVERIFIED**, MOB-3 4.4) |
| `startedAt` (named in MOB-3 4.4) | no upstream field on `WorkRun` (`core/workos/types.ts:131-137`) | **UNAVAILABLE**: shown as `—`; `createdAt` is used instead |
| `outcome.state`, `outcome.code` | `deriveOutcomes` `server.ts:281` | codes only |
| `delivery.state` | `deliveryView` `server.ts:281` | state only; no prepare/accept control |
| `evidence.count`, `evidence.byKind` | run evidence (MOB-3 4.4) | counts only, never bodies or log tails |
| `page.nextCursor`, `page.truncated` | MOB-3 3.4 | "more" row; truncated notice |

## 5. Actions (all read-only)

| Action | Effect |
|---|---|
| Refresh (pull / focus) | re-fetch the visible route |
| Filter by status | `status=` query on `runs` (client picks from the enum only) |
| Filter by project | inherited from UI-180 (client-side `missionId`/`projectId` choice) |
| Load more | next `cursor` |
| Tap mission / run | open timeline / run detail |

No transition, COMPLETE, delivery prepare/accept/export, new run or retry control (MOB-3 section 5.1; `server.ts:221-230`, `:295-325` stay desktop-only).

## 6. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | first page | skeleton rows |
| Empty | zero runs / missions | "No runs for this filter"; no zero-count tiles |
| Error | 400 `INVALID_*`, 500 | fixed code, list cleared |
| Not found | 404 `WORKOS_NOT_FOUND` | "Not found on this desktop", back to list |
| OFFLINE | network failure | OFFLINE banner, STALE cache (UI-177) |
| STALE | cached page | STALE badge and age; "load more" disabled offline |
| UNAVAILABLE | no journal | `—` with UNAVAILABLE pill |
| Denied | 401/403 (MOB-3 3.5) | no data, UI-249 |
| Expired | 401 `MOBILE_SESSION_EXPIRED` | silent refresh, else UI-249 |
| Desktop degraded | 503 `DESKTOP_DEGRADED` | STALE cache only; TORN_TAIL shows read-only banner (MOB-3 3.3) |

## 7. Desktop reuse (honest-state rules)

- Counterparts: `apps/desktop/renderer/views/work.js`, `apps/desktop/renderer/work-core.js` (read-only reference). Renderer reads: `api.js:59` (mission detail), `api.js:62` (work-runs), `api.js:64` (run detail), `api.js:142-143` (predev, crew).
- `model.js:4` `MISSING="—"`; `classifyFailure` `model.js:12-17`. `work-core.js` inbox action descriptors are **not** reused (MOB-3 4.10).

## 8. Not on this screen

Approval inbox (F5, MOB-7), raw run events and logs (`server.ts:129-137`, excluded by SC-3), evidence bodies, diffs.

## 9. UNVERIFIED and open questions

- Per-mission event history from the journal without a new index: **UNVERIFIED** (MOB-3 section 9).
- Run status enum and `tasks[]` always empty: **UNVERIFIED** here.
- MOB-3 Q-9: show supervisor runs (`/v1/runs`) at all, or only Work OS runs?
- MOB-3 follow-up (PROPOSED): the run item shape in MOB-3 4.4 names `startedAt`, which `WorkRun` does not carry (`core/workos/types.ts:137` has `createdAt`/`updatedAt`). Replace it with `createdAt`, or define a source for a real start time.
