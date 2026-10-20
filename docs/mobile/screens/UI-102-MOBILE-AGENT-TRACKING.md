<!-- //TR: MOB-6 ekran şartnamesi UI-102 Mobil Ajan Takibi (yalnız tasarım, ETKİN DEĞİL): etkin worker run'ları, rol sayıları ve lease süreleri yalnız okunur gösterilir; canlılık ve bulut oturumları UNKNOWN olarak işaretlenir, asla sıfır gösterilmez. Veri ÖNERİLEN /v1/mobile/workers rotasından gelir (mevcut /v1/agents, /v1/roles ve cockpit.workforce). /v1/system/executors hariç tutulur. -->

# UI-102: Mobile Agent Tracking (Mobil Ajan Takibi)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB section 11 row UI-102.
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`).
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:103` (AUTHORITY_REQUIRED, no route).

## 1. Purpose

Show which worker runs are active now, under which role, and whether their lease looks current, without claiming liveness the server cannot know.

## 2. Target function and release

- **Function:** F3 Agents/workers (D-MOB section 5).
- **Release:** R1, read-only monitoring.
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. **Build packages:** MOB-16, MOB-21.

## 3. Data source

| Source | Status | Upstream evidence |
|---|---|---|
| `GET /v1/mobile/workers?cursor&limit` | **PROPOSED** (MOB-3 4.3) | — |
| upstream `GET /v1/agents` | exists | `server.ts:110-113` (503 `ROLE_REGISTRY_UNAVAILABLE` at `:111`) |
| upstream `GET /v1/roles` | exists | `server.ts:549-563` (per MOB-3) |
| upstream `cockpit.workforce` | exists | `cockpitWorkforce` `server.ts:710-722` |

**Excluded:** `GET /v1/system/executors` (`server.ts:426`), reported to write settings on GET (**UNVERIFIED**, MOB-3 4.3); excluded on either reading (SC-3, SC-19).

## 4. Fields

| Field | Upstream | Rule |
|---|---|---|
| header `activeWorkerRuns` | `server.ts:710-722`; `/v1/agents` `activeWorkerRuns` `server.ts:112` | `—` on `UNAVAILABLE`/`ERROR` |
| header `canonicalRoles` | `cockpitWorkforce` `server.ts:710-722` | `—` if registry unavailable |
| item `runId`, `missionId`, `projectId`, `status` | runs in LEASED, RUNNING, CHECKPOINTING, VERIFYING (MOB-3 4.3) | status chip |
| item `executorRole` | MOB-3 4.3 | role id, no executor settings |
| item `leaseExpiresAt` | run lease fields (`core/workos/types.ts:131-143` per D-MOB, **UNVERIFIED**) | past expiry → `STALE` badge, not "stuck" |
| item `liveness` | none (D-MOB F3 gap) | always `UNKNOWN` in R1 |
| cloud sessions | not visible to the desktop | one row "Cloud sessions: UNKNOWN", never `0` |

## 5. Actions (all read-only)

| Action | Effect |
|---|---|
| Refresh (pull / focus) | re-fetch `workers` |
| Filter by status / role | client-side over the loaded page |
| Load more | next `cursor` |
| Tap run | open UI-099 run detail |
| Tap alarm chip | open UI-178 |

No stop-run, cancel, re-lease, retry, executor enable or role edit control (MOB-3 section 5).

## 6. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | first fetch | skeleton rows |
| Empty | no active worker run | "No active workers" with header counts; empty is not an error |
| Error | 500, malformed item | fixed code; header `—` |
| OFFLINE | network failure | OFFLINE banner, STALE cache (UI-177) |
| STALE | cached copy or expired lease | STALE badge and age; lease rows keep their own STALE badge |
| UNAVAILABLE | role registry missing (upstream 503 `ROLE_REGISTRY_UNAVAILABLE`, `server.ts:111`) or no journal | `—` with UNAVAILABLE pill |
| Denied | 401/403 (MOB-3 3.5) | no data, UI-249 |
| Expired | 401 `MOBILE_SESSION_EXPIRED` | silent refresh, else UI-249 |
| Desktop degraded | 503 `DESKTOP_DEGRADED` | STALE cache only |

## 7. Desktop reuse (honest-state rules)

- Counterparts: `apps/desktop/renderer/views/workforce.js`, `apps/desktop/renderer/fleet-core.js`, `apps/desktop/renderer/workforce-taxonomy-core.js` (read-only reference). Renderer reads: `api.js:89` (`/v1/agents`), `api.js:91` (`/v1/roles`).
- `model.js:6-7` `safeCount`/`formatCount`: a non-integer or negative count renders `—`.

## 8. Not on this screen

Executor settings, local Claude enablement (`server.ts:426-427`, SC-3), run logs, crew artefact bodies.

## 9. UNVERIFIED and open questions

- Lease field names and their timezone semantics: **UNVERIFIED**.
- A real liveness/heartbeat signal needs a store change outside R1 (D-MOB F3 gap).
