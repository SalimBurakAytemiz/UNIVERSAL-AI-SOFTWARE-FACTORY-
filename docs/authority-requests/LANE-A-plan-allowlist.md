<!-- //TR: Lane A yetki talebi: görev planı POST rotasını masaüstü yazma allow-list'ine ekleyen main.mjs yaması ve kanıtı / Lane A authority request: main.mjs patch adding the mission plan POST to the desktop write allow-list -->
# LANE-A-plan-allowlist: allow `POST /v1/missions/:id/plan` in the desktop main process (protected)

Why: `apps/desktop/main.mjs` is protected. Mission detail now has a "Plan tasks" form (`views/plan-form.js`) that sends the Founder's typed task list to `POST /v1/missions/:id/plan` (Lane B: `claude/lane-b-plan`, server registration requested in `docs/authority-requests/LANE-B-plan.md`). Until both this entry and Lane B's `server.ts` registration are applied, the bridge refuses the call and the form shows the honest refusal; nothing is recorded. No new IPC, storage or GET (tasks are already returned by `GET /v1/missions/:id`).

## Patch (apps/desktop/main.mjs, B5-POST-ALLOWLIST block)
```diff
-const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/transition$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/runs$/,
+const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/transition$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/runs$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/plan$/,
```

## Tests that prove it (tests/v7-b5-work-screens.test.ts, B5 POST allow-list describe)
- `/v1/missions/${MID}/plan` is allowed; `/plan/`, `/plan?x=1`, `/plan/extra`, a bad mission id, and any other method are rejected (same negative set as `/runs`).
- The body check already rejects non-object, array and over-32 KB bodies; the renderer sends at most 50 tasks of at most 200-character titles, far below the limit.
- Renderer side, tested in this PR: strict `buildPlanRequest` (only `tasks[{title,dependsOn}]`, earlier-task dependencies only), no request on validation errors, honest refusal states.
