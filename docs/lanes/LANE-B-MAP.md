<!-- //TR: Lane B haritası: ilk teslim akışının backend halkaları, kayıt (server.ts) ve izin listesi (main.mjs) durumları ve doğrulayan testleri; durum ae347da üzerinde doğrulandı -->
# LANE-B MAP: first-delivery flow, backend half (state of v7/integration ae347da)

Legend. Test = a named test block proves the link. SRV = registered in `apps/control-api/src/server.ts` (G = verified by grep on ae347da). ALW = allowed by the Desktop `apps/desktop/main.mjs` allow-list (G = verified by grep). `-` = not present. INF = inferred, not grep-checked. Status "TESTED" means Linux only; nothing here is INTEGRATED or PRODUCT_ACCEPTED, and no Windows/Electron run was done by this lane.

| # | Step | Endpoint | Module | Proving test (tests/v7-b1-workos.test.ts unless noted) | SRV | ALW |
|---|------|----------|--------|------|-----|-----|
| 1 | Idea -> intake -> project + first mission (+ testCommand, repository.url) | POST/GET /v1/intakes, GET /v1/intakes/:id | core/workos/intake.ts | "LANE-B project intake" | yes (G) | yes (G) |
| 2 | Project, mission | POST/GET /v1/projects, /v1/missions | store.ts | existing b1-workos / ps1a suites | yes (INF, pre-lane) | yes (INF) |
| 3 | Plan tasks | POST /v1/missions/:id/plan, GET .../tasks | plan.ts | "LANE-B mission task plan" | yes (G) | yes (G) |
| 4 | Task status | POST /v1/tasks/:id/transition, GET /v1/tasks/:id | store.ts (coordinator) | "LANE-B task transition routes" | yes (G) | yes (G) |
| 5 | Task -> run link | POST/GET /v1/tasks/:id/runs | task-run-link.ts | "LANE-B task-run link routes" | yes (G) | yes (G) |
| 5b | Runs of a task / reverse read | GET /v1/work-runs/:id/tasks | task-run-link.ts | same block | yes (G) | - (G) |
| 5c | Task status from run result | POST /v1/work-runs/:id/tasks/reconcile | task-outcome.ts | "LANE-B task outcome reconcile" | route yes (G, in task-runs.ts); automatic interval hook - | - (G) |
| 6 | Agent runs | POST /v1/missions/:id/runs, GET /v1/work-runs[/:id] | runner.ts (Lane C) | v7-b3a-runner, v7-relfx-3-risk-admission | yes (INF) | yes (G, `runs$`) |
| 7 | Run list / summaries | GET /v1/run-summaries | run-summary.ts | "LANE-B run summaries" | - (G) | - (G) |
| 8 | Run readiness (why can't the run start) | GET /v1/projects/:id/readiness | readiness.ts | "LANE-B run readiness" | - (G) | - (G) |
| 9 | Safe app run, restart safe | POST /v1/projects/:id/devrun/{start,stop,restart}, GET devrun | devrun.ts | v7-ps1a-c2-remediation (stop timeout), v7-ps1a-project-studio | yes (INF) | yes (INF) |
| 10 | Tests/review evidence | GET /v1/evidence, /v1/runs/:id/events\|logs, /v1/reviews/:id | core/evidence | v7-b10a-evidence | yes (INF) | yes (G, review detail) |
| 11 | Delivery | GET/POST /v1/work-runs/:id/delivery/{prepare,accept,export} | store.ts, project-studio.ts | v7-m1a-c2-delivery "LANE-B delivery routes" | yes (INF) | yes (G, prepare/accept/export) |
| 12 | Flow read (+ taskRuns summary, testCommand flag) | GET /v1/projects/:id/flow | flow.ts | "LANE-B project flow", "LANE-B flow task-run summary" | yes (G) | yes (G) |
| 13 | Project memory | GET/POST /v1/projects/:id/memory[...] | core/knowledge/project-memory.ts | "LANE-B project memory routes" | - (G) | - (G) |
| 14 | Knowledge summary | GET /v1/projects/:id/knowledge | knowledge-summary.ts | "LANE-B project knowledge summary" | - (G) | - (G) |
| 15 | Framework error contract | all routes | routes/error-contract.ts | "LANE-B first-delivery 4xx/5xx contract sweep" | - (G) | n/a |
| 16 | Founder attention queue | GET /v1/attention | attention.ts | "LANE-B founder attention queue" | - (G) | - (G) |
| 17 | Pre-dev Founder decisions | POST /v1/missions/:id/predev/{start,artifacts/:id/approve\|reject} | routes/predev-decisions.ts | "LANE-B pre-dev Founder decisions" | - (G) | - (G) |

SRV "-" for rows 5c (interval), 7, 8, 13-17 means the route module is merged but the `register...Routes(app,laneDeps)` call is absent from server.ts (grep: only Flow, Intake, Plan, Task, TaskRun are registered). Each has its server.ts diff and Desktop path in `docs/authority-requests/LANE-B-<slug>.md`. Protected batches 3a/3b/3c are the coordinator's; whether PRs #195 / #199 are still open was not checked live (INF from server.ts and main.mjs lacking them).

## Open items
- Unwired merged routes (rows 5c interval, 7, 8, 13-17): need protected batches (server.ts + main.mjs). Lane A consumers for memory, knowledge and attention exist, so those screens read "unavailable" until the batches land (INF from the Lane A PR descriptions, not re-grepped).
- Desktop allow-list lacks GET /v1/work-runs/:id/tasks and POST .../tasks/reconcile (G).
- Row 8 limit, pinned by a test: an existing directory that is not a git repository reads REPOSITORY OK; the runner then BLOCKs with REPOSITORY_HEAD_UNRESOLVED. Waits for Lane C's C-RUNNER-HEAD-PREDICATE.
- Row 6 internals (runner.ts) and `GET /v1/predev/:missionId` are not traced by Lane B.
- Candidate, not started: starting a run does not create the task -> run link (a client must POST /v1/tasks/:id/runs); Desktop callers not yet checked.
- Not covered by this lane: Windows, Electron, packaged runs, visual checks.
