<!-- //TR: Bu belge Lane A'nın UI-011 (Proje Yolculuğu) analiz adımı ve ürün-çalıştırma adımı için Linux kanıt güncellemesidir (A-UI011-EVIDENCE-1); üretim kodu değiştirmez, yalnız test ve kanıt ekler. Ücretli Claude çağrısı yapılmadı; LOCAL_CLAUDE hiçbir zaman etkinleştirilmedi. -->
# UI-011 evidence update: analysis step and run-the-product step against the real control-api (A-UI011-EVIDENCE-1)

Status: **TESTED (Linux)**. Not INTEGRATED, not PRODUCT_ACCEPTED. This is evidence and tests only; it adds no feature and changes no server or protected file. The implementer does not approve this change.

## Why

The P0 remainder audit (`LANE-A-P0-REMAINDER-AUDIT.md`, UI-011) marked the Journey's analysis step and create-plan as renderer-only and BLOCKED in the desktop build, because the routes were not registered and not allow-listed. #242 (protected batch 4b) registered `routes/analysis.ts` and `routes/product-run.ts` in `apps/control-api/src/server.ts` and allow-listed them in `apps/desktop/main.mjs`. This update proves, on Linux, that the real renderer reaches those real routes.

## What is now VERIFIED on Linux

Test block `LANE-A A-UI011-EVIDENCE-1` in `tests/v7-ux-journey.test.ts` (5 tests, 105/105 in the file). A real `buildServer` instance answers through `app.inject`; the bridge applies main.mjs's own `B5-POST-ALLOWLIST` and its own `scrubText`/`sanitizePostBody` (extracted from `main.mjs`, not re-implemented); the views are the real `analysis-step.js`, `product-card.js` and `api.js`. No route is mocked. A free state is a 200 BLOCKED or a 409; nothing starts a Claude process.

| State | Real answer | Exact UI state (en) |
|---|---|---|
| No analysis builder, no executor configured, LOCAL_CLAUDE disabled (`active.reason` `EXECUTOR_NOT_CONFIGURED`) | `POST /v1/missions/:id/analysis/step` -> 200 `{status:"BLOCKED", blocker, blockers:[... , "EXECUTOR_NOT_ENABLED"]}` | `analysisStatus=BLOCKED`, one `analysisBlocker` row per server blocker in the server's order, head "Blocked: the analysis cannot start until these are fixed. Nothing was produced or recorded.", Create plan closed, the free "write the plan by hand in Tasks" way out shown, never "not enabled in this build"; `GET /v1/predev/:id` still NOT_STARTED with no artifact |
| No analysis builder, executor pair installed but without a pre-development builder (the fake pair) | the same 200 BLOCKED | same state; `GET /v1/system/executors`: LOCAL_CLAUDE `enabled:false`, active executor unchanged |
| Create plan before the analysis is COMPLETE | `POST .../analysis/plan` -> 409 `{error:"ANALYSIS_NOT_COMPLETE"}` | classified `REFUSED`, status key `analysis.plan.refused` with the code |
| Unknown mission | `POST .../analysis/step` -> 404 `WORKOS_NOT_FOUND` | classified `NOT_FOUND` |
| Product status of a run that has no product | `GET /v1/work-runs/:id/product` -> `{product:{runId, deliveredHeadSha:null, devrun:{status:"STOPPED",...}, tiedToThisRun:false}}` | accepted by `mapRunProduct` (VERIFIED), card `productState=STOPPED`, `productOffer=NONE`, no Start or Stop button, "no delivered commit" and "cannot be started as a product ... (NOT_STARTED)" notes |
| Product start on that run (driven directly) | 409 `{error:"PRODUCT_RUN_NOT_DELIVERABLE", reason:"NOT_STARTED:QUEUED"}` (survives the bridge scrubber) | key `post.err.409.PRODUCT_RUN_NOT_DELIVERABLE` with the reason: "Refused (PRODUCT_RUN_NOT_DELIVERABLE, reason NOT_STARTED:QUEUED): this run has no delivered source commit, so there is no product to start." |
| Product stop on that run | 200, idempotent, same product shape | key `product.done.stop`; no dev-run was started |
| Allow-lists | main.mjs admits `GET /v1/work-runs/:id/product` (and refuses a query string) and `POST .../product/start\|stop` | n/a |

No paid call: every test asserts LOCAL_CLAUDE `enabled:false` before and after, the active executor unchanged, and that the `.../executors/local-claude/enable` route is never called. The `claude` CLI may exist on the machine; it is never started because every step is refused before a builder is invoked.

## Findings (renderer; the server is not touched)

- **F1 (missing locale key).** The route's free BLOCKED always ends with `EXECUTOR_NOT_ENABLED` when there is no builder, but `blockerText` (`apps/desktop/renderer/views/analysis-step.js:73-78`) looks up `analysis.blocker.EXECUTOR_NOT_ENABLED`, which does not exist in `locales/en.js` or `locales/tr.js` (only `setup.reason.EXECUTOR_NOT_ENABLED` exists, `en.js:1664`). The Founder sees `EXECUTOR_NOT_ENABLED (not recognised)` for the most common blocker. Not a wiring gap (the path and shape match); a small renderer follow-up. The test pins the current text with a comment so the fix flips it deliberately.
- **F2 (409 reason dropped).** `POST .../analysis/step` on a mission that is no longer open for pre-development answers 409 `{error:"WORKOS_CONFLICT", reason:"MISSION_NOT_PREDEV_ELIGIBLE"}`; the bridge keeps both fields, but `classifyAnalysisStep` (`apps/desktop/renderer/analysis-core.js:69-91`) falls through to `FAILED` and the view shows only the generic `post.err.409` text (`locales/en.js:671`), which also talks about an idempotency key that does not apply. Not a wiring gap; a small renderer follow-up.

No real wiring gap was found: every path and shape the renderer sends or reads is served by the route (checked: step and plan paths, empty `{}` bodies, the 200 BLOCKED step shape, the 409 `ANALYSIS_NOT_COMPLETE`, the product GET shape, and the 409 product refusal).

## What stays NOT_EXECUTED

- Windows (including the packaged desktop paths).
- A real Electron run (the real `main.mjs` bridge process); here its allow-list and scrubber are extracted from the source and applied in-process.
- A real analysis: no AI builder was invoked, so DRAFT_READY, AWAITING_APPROVAL, COMPLETE and the plan creation after a real analysis are covered only by the existing fake-route tests, not by this update.
- A real product run: no delivered source commit exists in these tests, so a real start through a verified sandbox, the preview URL and a real stop of a running product were not exercised.
- Pixel and design parity; product verification (PRODUCT_VERIFIED) is out of scope.
