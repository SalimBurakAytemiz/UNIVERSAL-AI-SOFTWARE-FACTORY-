<!-- //TR: MOB-6 ekran şartnamesi UI-180 Mobil Scope / Proje Değiştirme (yalnız tasarım, ETKİN DEĞİL): kapsam seçimi yalnız istemci tarafında bir görünüm filtresidir, çünkü sunucuda proje kapsamı kavramı yoktur (server.ts:156 sabit tenant "local", server.ts:165 scopeAllowed:true). Seçim sunucuya yazılmaz, yetki daraltmaz veya genişletmez; masaüstü de projeyi istemcide tutar (renderer state.js). -->

# UI-180: Mobile Scope / Project Switch (Mobil Scope / Proje Değiştirme)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB section 11 row UI-180 (F2).
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`).
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:181` (AUTHORITY_REQUIRED; `action_contract=switch scope`; desktop project switching exists at `#/projects`).

## 1. Purpose

Let the Founder narrow what the other screens show to one project, or "All projects". It is a **view filter on the phone**, not a permission scope.

## 2. Target function and release

- **Function:** F2 Multi-project (D-MOB section 5).
- **Release:** R1, read-only monitoring.
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. **Build package:** MOB-21.

## 3. Why the scope is client-side only (evidence)

| Fact | Evidence |
|---|---|
| The server's only `scope` is a fixed tenant: `scope={tenantId:opts.tenantId??"local"}`, actor `FOUNDER_LOCAL` | `apps/control-api/src/server.ts:156` |
| The Work OS policy context hard-codes `scopeAllowed:true` | `server.ts:165` |
| Project narrowing exists only as an optional query parameter, validated and passed to the store | `GET /v1/missions?projectId` `server.ts:207-209`; `GET /v1/deliveries?projectId` `server.ts:287-289` |
| No route stores or returns a "current project" | grep of `server.ts` for `currentProject`, `selectedProject`, `activeProject`: no match; store reads receive the fixed tenant object from `:156` (for example `:209`, `:219`, `:276`) |
| The desktop keeps the selected project in the client: `PROJECT_STORAGE_KEY="uasco.projectId"`, in-memory `projectId`, cache cleared on change | `apps/desktop/renderer/state.js:2`, `:5-6`, `:11-12` |
| The desktop applies it as a query parameter | `apps/desktop/renderer/api.js:49` |
| MOB-3 keeps server-side per-project scoping open | `docs/mobile/API-CONTRACT.md` 4.2, Q-3 |

Consequence: switching scope on the phone changes **which query the phone sends and what it displays**. It never changes what the device session may read: the session scope is `MOBILE_READ` for the whole device tenant (MOB-2 5.4). The phone must not present the switch as a security boundary.

## 4. Data source

| Source | Status | Upstream evidence |
|---|---|---|
| `GET /v1/mobile/projects?cursor&limit` (list to choose from) | **PROPOSED** (MOB-3 4.2) | `GET /v1/projects` `server.ts:194` |
| selected `projectId` | phone memory and the STALE cache entry key only | no server field |

The selected id is not a second store: it lives in app state, and at most as part of the cache key of the STALE cache (ADR section 5). Whether it survives an app restart is a UX choice; if kept, it is held inside that same cache (open question).

## 5. Fields

| Field | Upstream | Rule |
|---|---|---|
| "All projects" | client constant | default |
| item `projectId`, `name`, `state` | `server.ts:194` via MOB-3 4.2 | name untrusted, capped (SC-10) |
| item `awaitingApproval` (**DERIVED** count from `awaitingApproval.items`, `server.ts:683`, grouped by `projectId`), `missions.total` | MOB-3 4.2 | badge; `—` if unknown |
| current scope chip | client state | shown on every scoped screen header |

## 6. Actions (all read-only)

| Action | Effect |
|---|---|
| Choose project / "All projects" | client filter; screens refetch with `projectId`/`missionId` query or filter client-side |
| Refresh / load more | re-fetch `projects` / next `cursor` |

No create, rename, import or delete project. A selected id that is no longer listed falls back to "All projects" (like `state.js:11`, which rejects an invalid id).

## 7. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | fetching list | skeleton list; current chip unchanged |
| Empty | zero projects | only "All projects" |
| Error | 400/500 | fixed code; keep current scope |
| OFFLINE | network failure | choose from cached list, labelled STALE (UI-177) |
| STALE | cached list | STALE badge and age |
| UNAVAILABLE | no journal | "All projects" only, list `—` |
| Denied | 401/403 (MOB-3 3.5) | UI-249 |
| Expired | 401 `MOBILE_SESSION_EXPIRED` | silent refresh, else UI-249 |

## 8. Desktop reuse

Counterparts: `apps/desktop/renderer/views/projects.js`, `apps/desktop/renderer/state.js` (selection + epoch/cache reset), read-only reference.

## 9. UNVERIFIED and open questions

- MOB-3 Q-3: is server-side per-project scoping needed in R1? Until answered, scope stays client-side.
- Persisting the selection across restarts inside the STALE cache: PROPOSED, undecided.
