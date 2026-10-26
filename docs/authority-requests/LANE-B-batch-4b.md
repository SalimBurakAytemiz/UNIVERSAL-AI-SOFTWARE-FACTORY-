<!-- //TR: Lane B yetki talebi: analiz route kaydı (registerAnalysisRoutes) için server.ts satırı; stopped zorunlu. -->
# LANE-B batch 4b: analysis routes (server.ts registration)

Protected file: `apps/control-api/src/server.ts`. Lane B provides text only; the coordinator applies it.

Add next to the other `register*Routes(app, …)` calls (same `deps` object):

```ts
registerAnalysisRoutes(app, {...deps, analysisFlow: (stopped) => new AnalysisFlow({store: getStore(), scope, builder, readiness, stopped})});
```

- `stopped` is REQUIRED: the route passes `workosStopped` into the factory, so the flow aborts the paid call and throws `AnalysisStoppedError` (mapped to 423 by `instanceof`). A factory that ignores `stopped` lets a paid run start under Global Stop; the route test pins that the hook reaches the flow.
- `builder` / `readiness` are the same ones used for `predev/produce` (`ClaudePreDevBuilder`, `claudeAnalysisReadiness`).
- The route holds the process-wide produce lock (shared with `predev/produce`) for the whole step; a mission that is not pre-dev eligible is refused 409 `MISSION_NOT_PREDEV_ELIGIBLE` before any builder call.
