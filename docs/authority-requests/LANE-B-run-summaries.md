<!-- //TR: Lane B yetki talebi: hafif sayfalanmış koşu özeti route kaydı için server.ts yaması ve Electron izin listesi yolu -->
# LANE-B-run-summaries: light, paginated run list (protected registration + Desktop path)

Gap (FRONTEND_BACKEND_MATRIX G-FB-041 / G-FB-016 / G-FB-021): `GET /v1/work-runs` ships every run with its full `evidence` and `checkpoints` arrays to 13 views on every poll, with no pagination, so the payload grows with the journal. `GET /v1/run-summaries` returns only what a list needs, newest first, in pages. The legacy route is untouched; views can move over gradually.

`GET /v1/run-summaries?projectId=&missionId=&status=&limit=&cursor=` -> `{page:{runs, nextCursor, total}}`
- `limit` 1..100 (default 25); `cursor` is opaque (the last item's createdAt+runId); order is createdAt desc then runId desc, so a run created between pages never duplicates or skips an older one; `total` is the count matching the filters at request time.
- Each run: `runId, missionId, projectId, status, step, attempt, retryCount, remediationCycle, reason` (secret-redacted, <= 200 chars), `headSha`, `executor{implementer,reviewer}`, `evidenceCount`, `checkpointCount`, `createdAt`, `updatedAt`, `delivery{artifactPrepared, sourceAccepted, productVerified}`. The flags come only from recorded delivery/completion records. No lease id, no evidence or checkpoint arrays, no paths.
- Errors (fixed codes): 400 INVALID_QUERY (unknown or repeated param) / INVALID_LIMIT / INVALID_CURSOR / INVALID_STATUS / INVALID_PROJECT_ID / INVALID_MISSION_ID, 403 FORBIDDEN, 404 WORKOS_NOT_FOUND (unknown or other-tenant project/mission, so "no data" is never confused with "no such project"). Read-only, tenant scoped.

## Patch (server.ts, next to the other lane registrations)
```diff
+import {registerRunSummaryRoutes} from "./routes/run-summaries.js";
@@ after registerTaskRunRoutes(app,laneDeps);
+registerRunSummaryRoutes(app,laneDeps);
```
## Electron allow-list (apps/desktop/main.mjs, protected)
GET `/v1/run-summaries` with the query keys `projectId`, `missionId`, `status`, `limit` (1..100), `cursor` (base64url, <= 200 chars). The Desktop's existing path-and-query allow-list style applies; Lane A then moves the run lists from `/v1/work-runs`.

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 77 passed (4 new "LANE-B run summaries": empty state, 7 runs paged 3 at a time with a run inserted mid-paging, stable order, filters, light shape, redaction and cap, delivery flags from records only, query validation, unknown project/mission 404, tenant isolation, token, POST 404). Mutations (cursor tie handling, ascending order, no redaction/cap, full evidence leak, unknown query keys accepted, unknown project = empty list) each made a test fail.
Honest limit: the delivery flags for an accepted delivery and a completed run are exercised through a store view (real ones need the full evidence gate covered by the runner/delivery suites).
