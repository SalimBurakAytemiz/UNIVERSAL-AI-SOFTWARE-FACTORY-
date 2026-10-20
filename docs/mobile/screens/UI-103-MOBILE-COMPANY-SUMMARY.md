<!-- //TR: MOB-6 ekran şartnamesi UI-103 Mobil Şirket Özeti (yalnız tasarım, ETKİN DEĞİL): tek tenant içindeki projelerin listesi ve proje başına görev/çalışma özetleri yalnız okunur gösterilir; veri ÖNERİLEN /v1/mobile/summary ve /v1/mobile/projects rotalarından gelir (mevcut /v1/projects, /v1/missions, /v1/deliveries). Finans/hukuk /v1/company/* okumaları dahil değildir. Yazma, onay, STOP veya RESUME yoktur. -->

# UI-103: Mobile Company Summary (Mobil Şirket Özeti)

> **DESIGN ONLY / NOT ENABLED.** This is a screen specification. No app, route, listener or session exists. It grants nothing and enables nothing.

- **Task:** MOB-6. **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md`. **Scope record:** D-MOB section 11 row UI-103 (F1/F2).
- **Inputs and evidence convention:** as in `UI-097-MOBILE-HOME.md` (base `7ee55d9`).
- **Inventory row:** `docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:104` (AUTHORITY_REQUIRED, no route).

## 1. Purpose

A portfolio view across projects: how many missions each project has by status, how many approvals wait on the desktop, and when it last moved. "Company" here means the Work OS portfolio, **not** the finance/legal company module.

## 2. Target function and release

- **Function:** F1 Dashboard + F2 Multi-project (D-MOB section 5).
- **Release:** R1, read-only monitoring.
- **Gating grants (none exist):** FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9. **Build packages:** MOB-16, MOB-21.

## 3. Data source

| Source | Status | Upstream evidence |
|---|---|---|
| `GET /v1/mobile/projects?cursor&limit` | **PROPOSED** (MOB-3 4.2) | `GET /v1/projects` `server.ts:194`; `GET /v1/missions?projectId` `server.ts:207-210`; `GET /v1/deliveries?projectId` `server.ts:287-290` |
| `GET /v1/mobile/summary` (portfolio totals) | **PROPOSED** (MOB-3 4.1) | `GET /v1/cockpit` `server.ts:728-731` |

**Excluded:** `/v1/company/*` (finance/legal, `server.ts:466-535` per MOB-3 5.2) is not in the FA-MOB-5 read set.

## 4. Fields

| Field | Upstream | Rule |
|---|---|---|
| totals: `projects.count`, `missions.total`, `awaitingApproval.count` | `server.ts:675-688`, `:683` | `—` when `UNAVAILABLE` |
| item `projectId` | `listProjects` via `server.ts:194` | canonical id |
| item `name` | `server.ts:194` | untrusted text, capped 200 chars (SC-10) |
| item `state` | `server.ts:194` | chip |
| item `missions.total`, `missions.byStatus` | `listMissions` `server.ts:209` | per-project rollup is new (D-MOB F2 gap) |
| item `awaitingApproval` | `server.ts:683` grouped by `projectId` | count only; no action |
| item `activeRuns` | `listRuns` (MOB-3 4.2) | `UNKNOWN` until the store offers it |
| item `lastActivityAt` | MOB-3 4.2 | `—` if absent |
| never shown | repository path, `repository` object (`server.ts:361`), template detail | MOB-3 4.2 |

## 5. Actions (all read-only)

| Action | Effect |
|---|---|
| Refresh (pull / focus) | re-fetch `projects` and `summary` |
| Sort / filter by state | client-side over the loaded page |
| Load more | next `cursor` |
| Tap project | set client-side scope (UI-180) and open UI-099 filtered to it |

No create-project, import, export, file browse, git log/diff or dev-run control (MOB-3 5.1, 5.2; SC-3).

## 6. States

| State | Trigger | Rendering |
|---|---|---|
| Loading | first fetch | skeleton list |
| Empty | zero projects (journal `ABSENT` or none created) | "No projects on the desktop yet" |
| Error | 400 `INVALID_CURSOR`/`INVALID_LIMIT`, 500 | fixed code |
| OFFLINE | network failure | OFFLINE banner, STALE cache (UI-177) |
| STALE | cached page | STALE badge and age |
| UNAVAILABLE | no journal | `—` with UNAVAILABLE pill |
| Denied | 401/403 (MOB-3 3.5) | no data, UI-249 |
| Expired | 401 `MOBILE_SESSION_EXPIRED` | silent refresh, else UI-249 |
| Desktop degraded | 503 `DESKTOP_DEGRADED` | STALE cache only |

## 7. Desktop reuse (honest-state rules)

- Counterparts: `apps/desktop/renderer/views/projects.js`, `apps/desktop/renderer/matrix-core.js`, `apps/desktop/renderer/project-core.js` (read-only reference). Renderer reads: `api.js:48` (projects), `api.js:49` (missions), `api.js:85` (deliveries).
- `apps/desktop/renderer/views/company.js` is the finance/legal module and is **not** a counterpart.
- `model.js:6-7` count rule: unknown counts are `—`, never `0`.

## 8. Not on this screen

Finance/legal company data, project files, diffs, exports, approval items.

## 9. UNVERIFIED and open questions

- Cost of per-project rollups over `listRuns` per request: **UNVERIFIED** (MOB-3 section 9).
- MOB-3 Q-3: tenant mapping of a device session.
