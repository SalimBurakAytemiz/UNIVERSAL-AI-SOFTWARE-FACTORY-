<!-- //TR: LANE-C yetki talebi: POST /v1/missions/:id/predev/produce (ClaudePreDevBuilder). Desktop allow-list girdisi ve server.ts tek satırlık sağlayıcı bağlama korumalı dosyalarda koordinatör toplu PR'ı gerektirir. -->
# LANE-C authority request: `POST /v1/missions/:id/predev/produce` (C-PREDEV-PRODUCE)

Coordinator-approved package (grant: one new route in `apps/control-api/src/routes/predev-decisions.ts` and its tests in `tests/v7-b1-workos.test.ts`; Lane B stays out of that file). Nothing below is protected-file content; the two protected changes are requested here.

## What it does
For the mission's **current pre-dev phase** it asks the bound primary role (`PRE_DEV_ROLE_MAP[kind][0]`: UASCO-0022 business analyst, 0023 requirements engineer, 0019 planner, 0043 architect, 0031 UX designer) for the typed artifact, validates it with the existing driver validators and records a **DRAFT**. It never approves, submits or advances: the Founder still decides through the existing approve/reject routes (the DRAFT is recorded by the agent actor `agent:claude-predev-builder`, so the Founder's approval is independent by construction).

The brief given to the role is derived only from recorded fields (project name/type/stack/platforms and mission title/objective/acceptance criteria; for a mission created through intake the objective is the Founder's idea). Stakeholders, out-of-scope items and metrics that the Founder never gave stay empty and the prompt says so; nothing is invented (`core/workos/predev/brief.ts`).

## Authority (nothing new)
- Same executor state as the runner: the route calls the provider `preDevBuilder()`; in `server.ts` that is `getExecutors().pair?.preDevBuilder?.()`, i.e. the explicit `UASCO_WORKOS_EXECUTOR=local-claude` selection or the Founder's persisted `/v1/system/executors/local-claude/enable` setting, **plus** `PROVIDER_PROVENANCE.json` PASS and an unchanged launcher sha256 (`LocalClaudeExecutors.verifiedLauncher`). **No new env flag, no bypass of the enable path.** The FAKE pair has no pre-dev builder.
- Same process authority as the independent reviewer: `reviewerArgv` (tools `Read,Grep,Glob` only; Edit/Write/Bash/Web/Agent/Skill/MCP denied; the builder's isolation flags), the separate reviewer profile (`CLAUDE_CONFIG_DIR`; never the personal profile; not logged in -> refused), `safeChildEnv` with `allowPaidApi=false` (no API key is passed), no network tool.
- Runs with an **empty temporary scratch dir** outside the repo and the run workspaces as cwd (mode 0700, removed afterwards). Any entry in it afterwards invalidates the output (`PREDEV_BUILDER_SCRATCH_MODIFIED`).
- Role binding is checked **before** provenance, profile or any process: a missing/unsafe binding is `PREDEV_BUILDER_ROLE_NOT_EXECUTABLE`. Timeout = min(10 min default, the role's `limits.timeoutMs`) via `effectiveLimits`.
- Model output is data: the adapter never interprets it; the only gate to a recorded DRAFT is the existing validators.

## Exact request body and path (for the Desktop allow-list batch; do NOT edit `apps/desktop/main.mjs` from Lane C)
- Method/path: `POST /v1/missions/msn_<24 lowercase hex>/predev/produce` (anchored; no query string).
- Body: the **empty object** `{}` (strict `additionalProperties:false`; any key -> 400 `INVALID_BODY`). Body limit 32 KiB like the other pre-dev POSTs.

## Exact patch (apps/control-api/src/server.ts, protected)
Pass the provider where the pre-dev decision routes are registered (they currently receive `laneDeps`):
```diff
-registerPredevDecisionRoutes(app,laneDeps);
+registerPredevDecisionRoutes(app,{...laneDeps,preDevBuilder:()=>getExecutors().pair?.preDevBuilder?.()??null});
```
`getExecutors` is the existing cached selector (`selectExecutors`), reset by `/v1/system/executors/local-claude/enable`. Until this line lands, the route exists but always answers `409 PREDEV_DRIVER_BUILDER_NOT_CONFIGURED` (default behaviour, no process is started).

## Gates and answers (same order as the other pre-dev routes)
1. `400 INVALID_MISSION_ID` -> Global Stop `423 GLOBAL_STOP_ACTIVE` -> policy `403 ACTION_DENIED` (action id `workos.predev.produce`) -> strict empty body `400 INVALID_BODY` -> mission/tenant `404 WORKOS_NOT_FOUND`.
2. `409 PREDEV_DRIVER_BUILDER_NOT_CONFIGURED` (no provider / executor off).
3. `409 PREDEV_PRODUCE_IN_PROGRESS`: at most one produce per mission at a time; a concurrent second call starts **no** second process (other missions are not blocked; the lock is released after success and failure).
4. Driver gates before any process: `409 PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE`; `409 PREDEV_GATE_REFUSED` with `reason` `PREDEV_DRIVER_NO_ARTIFACT_PHASE` (phase has no artifact kind) or `PREDEV_DRIVER_ARTIFACT_PENDING` (current artifact is DRAFT/SUBMITTED/APPROVED; only a REJECTED one is re-drafted, superseded).
5. `201 {produced:{status:"RECORDED",kind,phase,artifactId,version,roleId},predev}`.
6. `422 {error:"PREDEV_OUTPUT_REJECTED",kind,phase,reason}`: output was not JSON or failed the validators; nothing is recorded, the phase does not move.
7. `502 {error:"PREDEV_BUILDER_FAILED",reason}` with a fixed `reason` from: `PREDEV_BUILDER_ROLE_NOT_EXECUTABLE`, `_PROMPT_INVALID`, `_PROVENANCE_REFUSED`, `_PROFILE_REFUSED` (e.g. reviewer profile not logged in), `_SCRATCH_FAILED`, `_SPAWN_FAILED`, `_TIMEOUT`, `_ABORTED` (Global Stop while running), `_EXIT_NONZERO`, `_EMPTY_OUTPUT`, `_OUTPUT_TOO_LARGE`, `_SCRATCH_MODIFIED`. No stderr or model text is returned or stored. Nothing is recorded.

Not idempotent: every successful call is a new model call (no idempotency key).

## Audit
`WORKOS_PREDEV_PRODUCED` for every call that reached the driver: `{actor (Founder), kind:"predev", missionId, outcome: RECORDED|REJECTED|FAILED, roleId, artifactKind, executor (reviewer identity), outputSha256, exitCode, durationMs, phase, artifactId?, version?, reason?}`. The raw output is never logged.

## Process cleanup
The model process runs in its own session/process group (POSIX); timeout or Global Stop kills the whole group (Windows: `taskkill /T /F`). Proven with a real process tree: a grandchild started by the model process is dead after the timeout.

## Counts (role lifecycle, `GET /v1/roles/status-summary`)
Registry `registries/role-definitions.json` sha256 `aaaac2dd2f58d967448e96358a70b9635f42079f5c52da046cea12570f979b0a` (unchanged by this package).
- before: registered 599 / implemented **3** / tested 0 / certified 0 / running 0
- after:  registered 599 / implemented **8** / tested 0 / certified 0 / running 0
The five added roles are exactly the pre-dev primaries, counted only through `STAGE_CONSUMERS.PREDEV_PRODUCE` in `core/agents/first-delivery-bindings.ts` (a stage that really calls `assertRoleExecutes` for them); `role-lifecycle.ts` is unchanged. Delivery 0232 stays uncounted (deterministic Studio route). Honest reading: "implemented" = bound + production route + a code stage consumes the binding. It is **not** tested, certified, running or product-verified, and until the `server.ts` line above lands the stage cannot be reached in the packaged app.

## Residual: NOT_VERIFIED
- The real Claude CLI was never run for this stage. CI uses injected fake process runners only (plus one real node process tree for the kill proof, POSIX). Quality, JSON-only compliance and latency of real model output are NOT_VERIFIED; a model that wraps its JSON in prose or fences is simply `422 PREDEV_OUTPUT_REJECTED` and can be retried.
- `reviewerArgv` is reused unchanged; an empty cwd (not `--tools ""`) is what keeps the read tools empty. No seccomp/cgroup/network namespace: same residual as the reviewer route.
- Windows process-tree kill (`taskkill /T`) is the existing `killTree` path and has no new Windows test here.
- Prompt injection through Founder-supplied brief text can steer the model's output, but the output can only become a validated DRAFT that the Founder must approve; it cannot run code or touch the repo.

## Tests that prove it
- `tests/v7-core-predev-driver.test.ts`, describe "LANE-C ClaudePreDevBuilder ..." (argv/cwd/stdin/env, timeout cap, fail-closed binding, provenance/profile refusal, scratch modification, process outcomes, real process-group kill, Global Stop wiring, five-phase run through the real driver, brief derivation).
- `tests/v7-sbx8-reviewer.test.ts`, describe "LANE-C pre-dev builder from the LOCAL_CLAUDE pair" (profile/provenance/env/paid-key).
- `tests/v7-b1-workos.test.ts`, describe "LANE-C pre-dev produce route" (every gate, executor off, concurrency, failures, rejections, Founder-only approval).
- `tests/v7-wfr03-role-registry.test.ts` (counts 8, exact implemented role ids, `STAGE_CONSUMERS`).
