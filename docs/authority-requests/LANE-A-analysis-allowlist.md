<!-- //TR: Lane A yetki talebi: Analiz adımının (A-FLOW-5) iki POST yolu için main.mjs allow-list yaması / Lane A authority request: desktop POST allow-list entries for the analysis step -->
# LANE-A-analysis-allowlist: allow the two analysis POST routes in the desktop (protected)

The Journey "Analysis" section (`apps/desktop/renderer/views/analysis-step.js`, `analysis-core.js`) posts only to the two routes that Lane C's `AnalysisFlow` (C-FLOW-ANALYSIS-1, `claude/lane-c-flow-analysis-1`, doc `docs/authority-requests/LANE-C-flow-analysis.md`) needs wired. The drafts are approved or rejected through the existing pre-dev decision routes (UI from PR #197), which #199 registers.

> **STATUS: OPEN, batch 4b request.** Locations are exact for `origin/claude/coord-protected-wave-p1` @7f6591c.

## What the coordinator wave must add
1. `apps/control-api/src/server.ts`: the two routes over `AnalysisFlow` (Lane C doc, "For the protected wave").
2. `apps/desktop/main.mjs` @7f6591c: `POST_ROUTE_RES` starts at line 159 and ends at line 168 with the pre-dev entries (`...\/predev\/start$/,/...\/predev\/artifacts\/pda_[0-9a-f]{24}\/(?:approve|reject)$/];`). Add one anchored pattern (empty body, no query) before the closing `];`:
```diff
-  /^\/v1\/missions\/msn_[0-9a-f]{24}\/predev\/start$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/predev\/artifacts\/pda_[0-9a-f]{24}\/(?:approve|reject)$/];
+  /^\/v1\/missions\/msn_[0-9a-f]{24}\/predev\/start$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/predev\/artifacts\/pda_[0-9a-f]{24}\/(?:approve|reject)$/,
+  // COORD protected batch 4b (LANE-A A-FLOW-5 / LANE-C C-FLOW-ANALYSIS-1): analysis step (next phase draft) and plan (task plan from the approved analysis); empty body, same gates (Global Stop 423, policy 403).
+  /^\/v1\/missions\/msn_[0-9a-f]{24}\/analysis\/(?:step|plan)$/];
```
`apps/control-api/src/server.ts` @7f6591c: register the two Lane C routes next to the other mission routes (after `registerReadinessRoutes`, line 263 / before `registerTaskRoutes`) using the existing `laneDeps` (line 258).

3. Test pins to add in `tests/v7-b5-work-screens.test.ts` @7f6591c, describe "COORD first-delivery Desktop allow-list (main.mjs)" (line 1622): extend `POSTS` (line 1628) with `` `/v1/missions/${MSN}/analysis/step` `` and `` `/v1/missions/${MSN}/analysis/plan` `` (this runs the near-miss table at line 1636 for both: query, trailing slash, uppercase, 23/25 hex, prefix, sub-path, encoding), and add to the "refuses ... wrong method" test:
```ts
for (const p of [`/v1/missions/${MSN}/analysis/step`, `/v1/missions/${MSN}/analysis/plan`]) expect(get(p), `GET ${p}`).toBe(false); // POST only
for (const p of [`/v1/missions/${MSN}/analysis`, `/v1/missions/${MSN}/analysis/other`, `/v1/missions/${MSN}/analysis/step/x`]) { expect(get(p), p).toBe(false); expect(post(p), p).toBe(false); }
```
No new GET path is needed: the Journey reads the existing `/v1/predev/:id`, `/v1/crew/:id` and (only after a BLOCKED answer) `/v1/system/executors`.

## HTTP mapping the UI is built against (from the Lane C doc's suggested mapping; confirm or send the final shapes)
- `POST .../analysis/step`: body is exactly Lane C's `AnalysisStep` (`status` = `BLOCKED | DRAFT_READY | AWAITING_APPROVAL | REJECTED | BUILDER_FAILED | COMPLETE`).
  - 2xx for `DRAFT_READY`, `AWAITING_APPROVAL`, `COMPLETE`.
  - `BLOCKED`: 409 (or 200), body either the full step or `{error:"ANALYSIS_BLOCKED", blocker, blockers, founderAction}`.
  - `REJECTED` / `BUILDER_FAILED`: 502 (or 200) with the step body.
  - A step whose HTTP status disagrees with its result (for example `COMPLETE` with 409) is shown as unreadable, never as a result.
- `POST .../analysis/plan`: 2xx body `{tasks, replayed, trace, summary}` (the `createPlan` success shape); 409 `{error:<code>}` (or `{code}`) for `ANALYSIS_NOT_COMPLETE | PLAN_TOO_LARGE | PLAN_DEPENDENCY_UNKNOWN | PLAN_CYCLE | PLAN_ALREADY_EXISTS | ...`.
- 423 Global Stop, 403 policy denial and 404 are mapped like the other mission routes.
If the final shapes differ, send them and I align in one commit; until the routes are allow-listed the UI says "not enabled in this build yet" and sends nothing.

## Rules the UI follows (asserted in `tests/v7-ux-journey.test.ts`, "LANE-A A-FLOW-5")
- "Analysis complete" only for `COMPLETE` with all four phases (BusinessAnalysis, Requirements, Plan, Architecture) approved exactly once.
- BLOCKED shows each exact blocker in plain words; the Founder's own login command comes from the existing executors read and is shown as text only.
- "Create plan" is offered, and sent, only after this mission's step reported `COMPLETE` in the same view.
