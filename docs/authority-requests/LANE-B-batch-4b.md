<!-- //TR: Lane B yetki talebi: analiz route kaydı (registerAnalysisRoutes) için server.ts satırı; fabrika stopped'ı akışa VERMELİ (route ön kapısı yeni ücretli koşuyu zaten engeller; stopped çalışırken iptal ve kayıt öncesi durdurma denetimini sağlar), tip bunu zorlamaz. -->
# LANE-B batch 4b: analysis routes (server.ts registration)

Protected file: `apps/control-api/src/server.ts`. Lane B provides text only; the coordinator applies it.

Add next to the other `register*Routes(app, …)` calls, plus the two imports (`registerAnalysisRoutes` from `./routes/analysis.js`; `AnalysisFlow`, `NO_ANALYSIS_BUILDER`, `claudeAnalysisReadiness` from `core/workos/crew/analysis.js`). The coordinator-verified line (type-checks in server.ts scope):

```ts
registerAnalysisRoutes(app,{...laneDeps,analysisFlow:(stopped)=>new AnalysisFlow({store:getStore(),scope,builder:getExecutors().pair?.preDevBuilder?.()??NO_ANALYSIS_BUILDER,readiness:()=>claudeAnalysisReadiness({controlRoot,profile:{forbiddenRoots:[getStore().dataDir]},cli:getExecSetup().cliStatus()}),stopped})})
```

- The route passes `workosStopped` into the factory as `stopped`. The route's own Global Stop pre-gate (423 before the flow is built) is what prevents a paid run from STARTING under Global Stop. `stopped` additionally gives the flow (1) the abort of a paid call that is already running (the builder process group is killed) and (2) the pre-record stop check: a flow built WITHOUT it can record a draft while Global Stop is active, and the route then answers 423 with a `stoppedAfterRecord` audit (the draft exists). A factory that ignores `stopped` still type-checks; the route test pins only that the hook reaches the flow.
- Optional audit enrichment (no server.ts change needed for the line above): the factory may return the narrowed form (type-checks against #242's server.ts line): `const c = getExecutors().pair?.preDevBuilder?.() ?? null; return Object.assign(new AnalysisFlow({... builder: c ?? NO_ANALYSIS_BUILDER, stopped}), {builderTrace: () => c?.lastTrace ?? null});`. Then `WORKOS_ANALYSIS_STEP` carries the same paid-call fields as `WORKOS_PREDEV_PRODUCED` (roleId, artifactKind, executor, outputSha256, exitCode, durationMs; never prompts or output) and `builderRan` is evidence-based. Without it `builderRan` is `null` (unknown) on errors other than `AnalysisError`.
- The route holds the process-wide produce lock (shared with `predev/produce`) for the whole step; a mission that is not pre-dev eligible (no active sequence and a non-open status) is refused 409 `MISSION_NOT_PREDEV_ELIGIBLE` before the lock and before any builder call.
