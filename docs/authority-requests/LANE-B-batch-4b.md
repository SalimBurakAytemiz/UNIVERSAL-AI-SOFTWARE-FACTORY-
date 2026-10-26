<!-- //TR: Lane B yetki talebi: analiz route kaydı (registerAnalysisRoutes) için server.ts satırı; stopped zorunlu. -->
# LANE-B batch 4b: analysis routes (server.ts registration)

Protected file: `apps/control-api/src/server.ts`. Lane B provides text only; the coordinator applies it.

Add next to the other `register*Routes(app, …)` calls, plus the two imports (`registerAnalysisRoutes` from `./routes/analysis.js`; `AnalysisFlow`, `NO_ANALYSIS_BUILDER`, `claudeAnalysisReadiness` from `core/workos/crew/analysis.js`). The coordinator-verified line (type-checks in server.ts scope):

```ts
registerAnalysisRoutes(app,{...laneDeps,analysisFlow:(stopped)=>new AnalysisFlow({store:getStore(),scope,builder:getExecutors().pair?.preDevBuilder?.()??NO_ANALYSIS_BUILDER,readiness:()=>claudeAnalysisReadiness({controlRoot,profile:{forbiddenRoots:[getStore().dataDir]},cli:getExecSetup().cliStatus()}),stopped})})
```

- The route passes `workosStopped` into the factory as `stopped`. The route's own Global Stop pre-gate (423 before the flow is built) is what prevents a paid run from STARTING under Global Stop; `stopped` additionally lets the flow abort a paid call that is already running and map it to 423. A factory that ignores `stopped` still type-checks and only loses that mid-run abort (the route test pins that the hook reaches the flow, but nothing forces a factory to use it).
- The route holds the process-wide produce lock (shared with `predev/produce`) for the whole step; a mission that is not pre-dev eligible (no active sequence and a non-open status) is refused 409 `MISSION_NOT_PREDEV_ELIGIBLE` before the lock and before any builder call.
