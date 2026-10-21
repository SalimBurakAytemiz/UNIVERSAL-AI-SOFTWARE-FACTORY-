<!-- //TR: Lane A yetki talebi: akış okumasını masaüstü GET allow-list'ine ekleyen main.mjs yaması ve kanıtı / Lane A authority request: main.mjs patch adding the project flow read to the desktop GET allow-list -->
# LANE-A-flow-allowlist: allow `GET /v1/projects/:id/flow` in the desktop main process (protected)

Why: `apps/desktop/main.mjs` is protected. The Project Studio overview now shows a first-delivery stepper (`views/flow-panel.js`) that reads `GET /v1/projects/:id/flow` (Lane B: `claude/lane-b-flow`, route registration requested in `docs/authority-requests/LANE-B-flow.md`). Until both this allow-list entry and Lane B's `server.ts` registration are applied, the panel shows an honest UNAVAILABLE note and no progress. No POST, no storage, no new IPC.

## Patch (apps/desktop/main.mjs, PS-1B block)
```diff
-const PS_GET_ROUTE_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/(devrun|files|file|git\/log|git\/diff|exports)$/;
+const PS_GET_ROUTE_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/(devrun|files|file|git\/log|git\/diff|exports|flow)$/;
@@ const PS_QUERY={
   "exports":{keys:{},req:[]}
+  ,"flow":{keys:{},req:[]}
 };
```

## Tests that prove it (tests/v7-ps1b-project-studio-ui.test.ts, main.mjs GET allow-list describe)
- `/v1/projects/${PID}/flow` is allowed; with any query (`?x=1`), a trailing slash, `/flow/extra`, a malformed id, or a non-GET method it is rejected (same negative set as `devrun`).
- Renderer side already tested in this PR: strict `mapFlow`, `flowPath`, honest UNAVAILABLE/ERROR, no POST.

Related (not requested here): Lane B's `POST /v1/missions/:id/plan` and `GET /v1/missions/:id/tasks` also need desktop allow-list entries (see `LANE-B-plan.md`); a UI consumer will follow once those routes are registered.
