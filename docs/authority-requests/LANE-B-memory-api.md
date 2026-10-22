<!-- //TR: Lane B yetki talebi: Proje Belleği (SC-14) route kaydı için server.ts yaması ve Electron izin listesi yolları -->
# LANE-B-memory-api: register project memory routes in server.ts (protected) + Desktop paths

Supersedes `docs/knowledge/PROJECT-MEMORY-INTEGRATION.proposed.patch` (PQ-007, never applied): the routes live in a module (`apps/control-api/src/routes/memory.ts`) instead of server.ts, using the same lane conventions (global token hook, Global Stop 423, policy 403, strict body, tenant scope via the Work OS project, fixed error codes, no absolute paths, audit). The core (`core/knowledge/project-memory.ts`, PQ-007) is unchanged.

Consumer screen: UI-160 Project Memory / decision revisions (SCREEN_AUDIT_252).

## Endpoints
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/projects/:id/memory` | list; `?kind=` (one of DECISION, FACT, SOURCE, REVISION, NOTE), `?tag=`, `?q=` (plain text, <= 200 chars); returns `{records, health}` |
| GET | `/v1/projects/:id/memory/current` | head of each supersession chain + `health` |
| GET | `/v1/projects/:id/memory/health` | `{health}`: OK / ABSENT / TAMPERED / TORN_TAIL (works on a tampered chain) |
| GET | `/v1/projects/:id/memory/:memId` | one record (`mem_NNNNNN`) |
| GET | `/v1/projects/:id/memory/:memId/provenance` | lineage with sources, authors, hashes |
| POST | `/v1/projects/:id/memory` | append `{kind,title,body,sources?,supersedes?,tags?}`; `author.role` is the server actor, a client `author` is rejected (400) |

Errors (fixed codes only): 400 INVALID_PROJECT_ID / INVALID_MEMORY_ID / INVALID_QUERY / INVALID_BODY / MEMORY_SECRET_REJECTED / MEMORY_INVALID_INPUT, 403 FORBIDDEN / ACTION_DENIED, 404 WORKOS_NOT_FOUND (also other tenant) / MEMORY_NOT_FOUND, 409 MEMORY_SUPERSEDES_MISSING / MEMORY_SUPERSEDES_NOT_HEAD, 413 MEMORY_LIMIT_EXCEEDED or body over the 32 KiB route limit, 423 GLOBAL_STOP_ACTIVE, 503 MEMORY_TAMPERED / MEMORY_READ_ONLY (torn tail) / MEMORY_BUSY.

## Patch (server.ts, next to the other lane registrations)
```diff
+import {registerMemoryRoutes} from "./routes/memory.js";
@@ after registerTaskRunRoutes(app,laneDeps);
+registerMemoryRoutes(app,laneDeps);
```

## Electron allow-list (apps/desktop/main.mjs, protected; Lane A / coordinator)
- GET: `/v1/projects/prj_<24hex>/memory` (query: kind, tag, q), `/v1/projects/prj_<24hex>/memory/current`, `/v1/projects/prj_<24hex>/memory/health`, `/v1/projects/prj_<24hex>/memory/mem_<6+digits>`, `/v1/projects/prj_<24hex>/memory/mem_<6+digits>/provenance`
- POST: `/v1/projects/prj_<24hex>/memory` (body <= 32 KiB, same as the Desktop POST limit, so a memory body near the core's 32 KiB limit is refused at the route with 413)

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 55 passed (4 new "LANE-B project memory routes": append/list/filter/search/supersede/provenance/restart, bad input + secrets + supersedes + oversize with nothing written, token/423/403/ids/queries/tenant isolation, tampered chain 503 and torn tail read-only without repair). Mutations (drop the Global Stop check; drop the project/tenant lookup) each made 1 test fail.
