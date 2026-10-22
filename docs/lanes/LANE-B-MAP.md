<!-- //TR: Lane B haritası: ilk teslim akışının backend halkaları, durumları ve doğrulayan testleri -->
# LANE-B MAP: first-delivery flow, backend half (state of v7/integration 128cfcb)

Legend: VERIFIED = a test proves the link; REGISTERED = route is wired in server.ts; DEAD = module merged but not registered; UNVERIFIED = exists, not traced to a proving test by this lane.

| # | Step | Endpoint | Domain module | Persistence | Authorization | Tests | State |
|---|------|----------|---------------|-------------|---------------|-------|-------|
| 1 | Idea -> validated intake -> project + first mission | POST/GET /v1/intakes, GET /v1/intakes/:id | core/workos/intake.ts | intakes.jsonl (torn-tail safe) | token, Global Stop 423, policy 403, tenant | v7-b1-workos "LANE-B project intake" | VERIFIED, REGISTERED |
| 2 | Project | POST/GET /v1/projects | store.ts, project-studio.ts | journal + snapshot | same gates | v7-b1-workos, v7-ps1a-project-studio | VERIFIED |
| 3 | First mission | POST/GET /v1/missions[/:id] | store.ts | journal | same gates | v7-b1-workos | VERIFIED |
| 4 | Tasks planned | POST /v1/missions/:id/plan, GET /v1/missions/:id/tasks | core/workos/plan.ts | plans.jsonl + journal TASK_CREATED | same gates | v7-b1-workos "mission task plan" | VERIFIED, REGISTERED |
| 4b | Task status | POST /v1/tasks/:id/transition, GET /v1/tasks/:id | store.ts transitionTask (coordinator) | journal TASK_TRANSITIONED | same gates | v7-b1-workos "task transition routes" | VERIFIED, REGISTERED |
| 4c | Task -> run link | POST/GET /v1/tasks/:id/runs, GET /v1/work-runs/:id/tasks | core/workos/task-run-link.ts | task-run-links.jsonl | same gates | v7-b1-workos "task-run link routes" | VERIFIED, DEAD: registerTaskRunRoutes missing in server.ts |
| 5 | Agent runs | POST /v1/missions/:id/runs, GET /v1/work-runs[/:id] | runner.ts (Lane C) | journal runs | gates + executor config + risk | v7-b3a-runner, v7-relfx-3-risk-admission | covered by existing tests (not traced by Lane B) |
| 6 | Mission transition | POST /v1/missions/:id/transition | store.ts, state machine | journal | gates | mission-state, v7-b1-workos | VERIFIED |
| 7 | Safe app run | POST /v1/projects/:id/devrun/{start,stop,restart}, GET devrun | core/workos/devrun.ts | run dir | gates + SBX gate | v7-ps1a-*, v7-int-r3-sbx-gate | VERIFIED by existing tests |
| 8 | Tests/review evidence | GET /v1/evidence, /v1/runs/:runId/events\|logs, /v1/reviews/:id | core/evidence | evidence store | token | v7-b10a-evidence | VERIFIED |
| 9 | Delivery | GET/POST /v1/work-runs/:id/delivery/{prepare,accept,export} | store.ts, project-studio.ts | journal + export files | gates | v7-m1a-c2-delivery incl. LANE-B gate + audit tests | VERIFIED |
| 10 | Flow read | GET /v1/projects/:id/flow | core/workos/flow.ts | derived from store + link file | token, tenant | v7-b1-workos "project flow" | VERIFIED, REGISTERED |

## Open items (as of this commit)
- 4c is merged but DEAD until the coordinator adds `import {registerTaskRunRoutes} from "./routes/task-runs.js";` and `registerTaskRunRoutes(app,laneDeps);` next to the other lane registrations in server.ts (patch in docs/authority-requests/LANE-B-task-run-link.md).
- Electron allow-list (main.mjs, protected): no entry found for `/v1/intakes`, `/v1/tasks/...` or the task-run paths; Lane A / Founder need to confirm and add (exact paths in each LANE-B-*.md).
- Not traced by Lane B: step 5 internals (Lane C), `GET /v1/predev/:missionId` planning read-model.
