<!-- //TR: Lane B haritası: ilk teslim akışının backend halkaları, durumları ve doğrulayan testleri -->
# LANE-B MAP: first-delivery flow, backend half (state of v7/integration 6383eeb)

Legend: VERIFIED = a test proves the link; REGISTERED = route is wired in server.ts; DEAD = module merged but not registered; UNVERIFIED = exists, not traced to a proving test by this lane.

| # | Step | Endpoint | Domain module | Persistence | Authorization | Tests | State |
|---|------|----------|---------------|-------------|---------------|-------|-------|
| 1 | Idea -> validated intake -> project + first mission | POST/GET /v1/intakes, GET /v1/intakes/:id | core/workos/intake.ts | intakes.jsonl (torn-tail safe) | token, Global Stop 423, policy 403, tenant | v7-b1-workos "LANE-B project intake" | VERIFIED, REGISTERED |
| 2 | Project | POST/GET /v1/projects | store.ts, project-studio.ts | journal + snapshot | same gates | v7-b1-workos, v7-ps1a-project-studio | VERIFIED |
| 3 | First mission | POST/GET /v1/missions[/:id] | store.ts | journal | same gates | v7-b1-workos | VERIFIED |
| 4 | Tasks planned | POST /v1/missions/:id/plan, GET /v1/missions/:id/tasks | core/workos/plan.ts | plans.jsonl + journal TASK_CREATED | same gates | v7-b1-workos "mission task plan" | VERIFIED, REGISTERED |
| 4b | Task status | POST /v1/tasks/:id/transition, GET /v1/tasks/:id | store.ts transitionTask (coordinator) | journal TASK_TRANSITIONED | same gates | v7-b1-workos "task transition routes" | VERIFIED, REGISTERED |
| 4c | Task -> run link | POST/GET /v1/tasks/:id/runs, GET /v1/work-runs/:id/tasks | core/workos/task-run-link.ts | task-run-links.jsonl | same gates | v7-b1-workos "task-run link routes" | VERIFIED, REGISTERED |
| 4d | Task status from the run result | POST /v1/work-runs/:id/tasks/reconcile (empty body) | core/workos/task-outcome.ts | journal TASK_TRANSITIONED (via store.transitionTask) | same gates | v7-b1-workos "task outcome reconcile" | VERIFIED, MERGED (#166), route REGISTERED; automatic interval NOT wired (needs server.ts hook, LANE-B-task-outcomes.md) |
| 5 | Agent runs | POST /v1/missions/:id/runs, GET /v1/work-runs[/:id] | runner.ts (Lane C) | journal runs | gates + executor config + risk | v7-b3a-runner, v7-relfx-3-risk-admission | covered by existing tests (not traced by Lane B) |
| 6 | Mission transition | POST /v1/missions/:id/transition | store.ts, state machine | journal | gates | mission-state, v7-b1-workos | VERIFIED |
| 7 | Safe app run | POST /v1/projects/:id/devrun/{start,stop,restart}, GET devrun | core/workos/devrun.ts | run dir | gates + SBX gate | v7-ps1a-*, v7-int-r3-sbx-gate | VERIFIED by existing tests |
| 8 | Tests/review evidence | GET /v1/evidence, /v1/runs/:runId/events\|logs, /v1/reviews/:id | core/evidence | evidence store | token | v7-b10a-evidence | VERIFIED |
| 9 | Delivery | GET/POST /v1/work-runs/:id/delivery/{prepare,accept,export} | store.ts, project-studio.ts | journal + export files | gates | v7-m1a-c2-delivery incl. LANE-B gate + audit tests | VERIFIED |
| 10 | Flow read | GET /v1/projects/:id/flow | core/workos/flow.ts | derived from store + link file | token, tenant | v7-b1-workos "project flow" | VERIFIED, REGISTERED |
| 11 | Project memory (UI-160) | GET/POST /v1/projects/:id/memory[/current\|/health\|/:memId[/provenance]] | core/knowledge/project-memory.ts (PQ-007) | projects/<id>/memory/journal.jsonl (hash chain) | same gates, tenant via project | v7-b1-workos "project memory routes" | VERIFIED, MERGED (#161); NOT registered in server.ts |
| 12 | Knowledge/evidence summary | GET /v1/projects/:id/knowledge | core/knowledge/knowledge-summary.ts | derived (memory + evidence index) | token, tenant | v7-b1-workos "project knowledge summary" | VERIFIED, MERGED (#173); NOT registered in server.ts |
| 13 | Framework error contract | all routes | routes/error-contract.ts | none | n/a | v7-b1-workos "4xx/5xx contract sweep" | VERIFIED, MERGED (#177); NOT registered (needs frameworkErrors + registerErrorContract in server.ts) |
| 14 | Founder attention queue (Work OS) | GET /v1/attention | core/workos/attention.ts | derived from the journal | token, tenant | v7-b1-workos "founder attention queue" | VERIFIED in PR #191 (open); NOT registered; replaces the legacy-only GET /v1/founder-attention for the Desktop |

## Open items (verified by grep on 6383eeb)
- server.ts registers intake, plan, flow, task and task-run routes. Merged but NOT registered: memory, knowledge, error contract (coordinator protected batch 3), task-outcome interval; attention is in open PR #191.
- Desktop allow-list (apps/desktop/main.mjs) has intakes, mission plan, project flow, task transition and task runs. Not allowed yet: GET /v1/work-runs/:id/tasks, POST /v1/work-runs/:id/tasks/reconcile, /v1/projects/:id/memory paths, /v1/projects/:id/knowledge, GET /v1/attention.
- CI note: "DEPENDENCY_AUDIT_INVALID_RESPONSE" failures on lane PRs came from the npm advisory endpoint outage, and one Windows shard timed out (`VALIDATION_STEP_TIMEOUT tests-bs1-c`) once on runner speed; neither was lane code.
- Not traced by Lane B: step 5 internals (Lane C), `GET /v1/predev/:missionId` planning read-model.
