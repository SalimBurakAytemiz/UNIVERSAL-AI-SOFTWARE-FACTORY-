<!-- //TR: Lane A yetki talebi: görev durum geçişi POST rotasını masaüstü yazma allow-list'ine ekleyen main.mjs yaması ve kanıtı / Lane A authority request: main.mjs patch adding the task status transition POST to the desktop write allow-list -->
# LANE-A-task-status-allowlist: allow `POST /v1/tasks/:id/transition` in the desktop main process (protected)

Why: `apps/desktop/main.mjs` is protected. The task inspector in Tasks now has a "Task status" action group (`views/task-actions.js`) that sends `{to, reason}` to `POST /v1/tasks/:id/transition` (Lane B: `claude/lane-b-task-routes`, store side by the coordinator on `claude/coord-task-status`; `server.ts` registration requested in `docs/authority-requests/LANE-B-task-status.md`). Until this entry and that registration are applied, the bridge refuses the call and the UI shows the honest refusal; no status changes. No new GET: tasks (with `dependsOn`) already arrive in `GET /v1/missions/:id`. No new IPC or storage.

## Patch (apps/desktop/main.mjs, B5-POST-ALLOWLIST block)
```diff
-const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/transition$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/runs$/,
+const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/transition$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/runs$/,/^\/v1\/tasks\/tsk_[0-9a-f]{24}\/transition$/,
```
(If the plan request `LANE-A-plan-allowlist.md` is applied too, both entries sit in the same array.)

## Tests that prove it (tests/v7-b5-work-screens.test.ts, B5 POST allow-list describe)
- `/v1/tasks/tsk_<24 hex>/transition` is allowed; `/transition/`, `?x=1`, `/transition/extra`, a non-hex or wrong-length id, `/v1/tasks/tsk_x`, and any other method are rejected (same negative set as `/v1/missions/:id/runs`).
- Renderer side, tested in this PR: client copy of the task state machine (same as Lane B's `TASK_TRANSITIONS`; a parity test against `core/workos/types.ts` can be added once the coordinator's store branch is merged), strict `{to,reason}` body, required reason, DONE confirmation, honest refusal states.
