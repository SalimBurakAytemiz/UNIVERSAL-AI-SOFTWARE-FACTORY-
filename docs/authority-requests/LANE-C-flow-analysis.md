<!-- //TR: LANE-C yetki talebi: analiz adımının route'larla bağlanması (korumalı server.ts dalgası) ve yeni test dosyasının config/validation.json kaydı koordinatör işidir. -->
# LANE-C authority request: C-FLOW-ANALYSIS-1, the analysis step of the 31 Oct Desktop flow

## What exists after this package (Lane C paths only)
`core/workos/crew/analysis.ts`: `AnalysisFlow` drives idea -> analysis -> plan on top of the existing pieces (intake's mission, `PreDevDriver`, the bound role profiles, `ClaudePreDevBuilder`, the pre-dev store/validators, `submitPlan`). No second store: the artefacts are ordinary pre-dev artefacts, so the existing pre-dev read model and the decision routes (`predev/start`, `artifacts/:id/approve|reject`) read and approve them unchanged.

First MISSING link found on the path: nothing turned the approved pre-dev **Plan** into the mission's task plan (`POST /v1/missions/:id/plan` only took a hand-written body). `tasksFromPlan` / `planFromApproved` / `createPlan` close it. Intake -> pre-dev and approve -> advance already worked (verified by running them with the fake builder).

- `step(missionId)`: produces the draft of the CURRENT analysis phase (BusinessAnalysis, Requirements with acceptance criteria, Plan with work packages, Architecture decision; UxSpec is not part of the analysis). Result: `BLOCKED {blocker, blockers[], founderAction, readiness}` | `DRAFT_READY {kind, artifactId, version, roleId}` | `AWAITING_APPROVAL {kind, artifactId, artifactState}` (a draft is waiting: no paid call) | `REJECTED {kind, reason}` (output failed the validators: nothing recorded) | `BUILDER_FAILED {kind, code}` (exact builder code, no detail) | `COMPLETE`. Readiness is asked only when a paid call would start. When not ready nothing is called, opened or recorded.
- `claudeAnalysisReadiness({controlRoot, profile?, cli?, bindings?})`: the four analysis roles are bound and executable (RoleExecutionProfile gate), the CLI is found (and is not a `.cmd` shim), the launcher is verified, and BOTH Claude profiles (implementer, reviewer) are signed in. Blockers are exact codes in setup order (`ROLE_NOT_EXECUTABLE:*`, `CLAUDE_CLI_NOT_FOUND | CLAUDE_CLI_SHIM_UNSUPPORTED`, launcher codes, `implementer:CLAUDE_PROFILE_LOGIN_REQUIRED`, ...), with `profiles.{implementer,reviewer}` carrying each profile's state and the Founder's own login command. Builds on C-IMPL-WIN-1 (`afe968a`).
- `planFromApproved(missionId)` -> `{ok, body, trace, summary}` or `{ok:false, code: ANALYSIS_NOT_COMPLETE | PLAN_TOO_LARGE | PLAN_DEPENDENCY_UNKNOWN | PLAN_CYCLE}`; `createPlan(missionId, actor)` calls the existing `submitPlan` (one plan per mission, idempotent on the same body) and reports `PLAN_ALREADY_EXISTS` etc. as `{ok:false, code}`. Tasks are the work packages in dependency order (title `WPn: title`), `dependsOn` mapped to earlier indexes; `trace` links each task to its requirements and their acceptance criteria.
- The Founder stays the approver: drafts are recorded by `agent:claude-predev-builder`, approval needs an independent actor and evidence (the existing store gates).

## For the protected wave (coordinator): routes are NOT added here
Two thin routes over `AnalysisFlow` are the whole wiring (`apps/control-api/src/routes/`, registered in the protected `server.ts`):
- `POST /v1/missions/:id/analysis/step` -> `new AnalysisFlow({store: getStore(), scope, builder: getExecutors().pair?.preDevBuilder?.() ?? NO_ANALYSIS_BUILDER, readiness: () => claudeAnalysisReadiness({controlRoot, profile: {forbiddenRoots: [dataDir]}, cli: getExecSetup().cliStatus()})}).step(id)`; suggested mapping: BLOCKED 409 `{error:"ANALYSIS_BLOCKED", blocker, blockers, founderAction}`, REJECTED/BUILDER_FAILED 502 with the code, others 200. Keep the Global Stop / policy / audit gates of `predev/produce`.
- `POST /v1/missions/:id/analysis/plan` -> `createPlan(id, actor)`; `ok:false` codes 409.
Both can reuse the Desktop allow-list pattern of the other mission routes.

## Registration (coordinator, protected `config/validation.json`)
New file `tests/v7-lane-c-flow-analysis.test.ts` (17 tests, about 1 s, no process, no `platforms` filter). `tests/pkg-vs-validation-sharding.test.ts` is red until it is in one shard.

## NOT_VERIFIED
- No real Claude run here: the builder in the tests is a fake that returns the TaskHub fixtures, so the content quality of real BA/PO/architect output is not judged. The structure and traceability gates (the existing validators) are real.
- Windows/Electron: nothing executed.
- The route wiring and the Desktop screens are not part of this package.
- Mutants: `docs/lanes/LANE-C-flow-analysis-mutants.json` and `.mjs`.
