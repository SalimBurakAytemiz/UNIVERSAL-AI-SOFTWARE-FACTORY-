# LANE-B MAP: first-delivery flow, backend half

Status legend: VERIFIED = a test proves the link; MISSING; BROKEN; UNVERIFIED = code exists, not yet traced to a proving test by this lane (to be checked next, not assumed).

| # | Step | Endpoint (server.ts) | Domain module | Persistence | Authorization | Tests | State |
|---|------|----------------------|---------------|-------------|---------------|-------|-------|
| 1 | Project idea -> validated intake | POST/GET /v1/intakes, /v1/intakes/:id (routes/intake.ts, registration pending: authority request) | core/workos/intake.ts | <dataDir>/intakes.jsonl (append+fsync) | control token (global hook), Global Stop 423, action-gateway 403, tenant scope | tests/v7-b1-workos.test.ts "LANE-B project intake" | VERIFIED (module+routes); NOT WIRED until Founder applies LANE-B-intake.md |
| 2 | Project created | POST /v1/projects, GET /v1/projects | core/workos/store.ts, project-studio.ts | journal.jsonl (hash chain) + snapshot | same gates | v7-b1-workos, v7-ps1a-project-studio | VERIFIED (pre-existing tests) |
| 3 | First mission created | POST /v1/missions, GET /v1/missions[/:id] | store.ts | journal | same gates | v7-b1-workos | VERIFIED |
| 4 | Tasks planned | GET /v1/predev/:missionId, /v1/crew/:missionId | core/workos/predev/** (Lane C) | journal predev sequence | token | v7-core-predev-* | UNVERIFIED by Lane B (Lane C area; no POST to plan from a mission in server.ts routes list) |
| 5 | Agent runs | POST /v1/missions/:id/runs, GET /v1/work-runs[/:id] | core/workos/runner.ts (Lane C) | journal runs | gates + executor config | v7-b3a-runner | UNVERIFIED (Lane C) |
| 6 | Mission transition | POST /v1/missions/:id/transition | store.ts, mission state machine | journal | gates | mission-state, v7-b1-workos | VERIFIED |
| 7 | Safe app run | GET /v1/projects/:id/devrun | core/workos/devrun.ts | run dir | token | v7-ps1a-* | UNVERIFIED (read-only GET; no start/stop route seen) -> candidate MISSING link |
| 8 | Tests/review evidence | GET /v1/evidence, /v1/runs/:runId/events\|logs, /v1/reviews/:id | core/evidence | evidence store | token | v7-b10a-evidence | VERIFIED |
| 9 | Delivery | GET/POST /v1/work-runs/:id/delivery/{prepare,accept,export} | store.ts, project-studio.ts | journal + export files | gates | v7-m1a-c2-delivery | VERIFIED |

Next candidates: step 7 start/stop of the safe dev run (domain route file), then steps 4/5 gap analysis with Lane C.
