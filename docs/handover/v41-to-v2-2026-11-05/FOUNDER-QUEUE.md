# Items awaiting a Founder decision (2026-11-05 ~21:05Z, base b4bbe4b0)

Data source: the builders' reports (I, E, F) plus the coordinator's gate checks. The coordinator does not merge these PRs.

## Governance / settings
1. **"UASCO Independent Review" workflow:** disable it (not required; the `collect` job held runners idle for 413 min in 24h). See CI-BOTTLENECK-AND-REVIEW-401.md.
2. **TASK_LINE_RE suffix bug** (`docs/planning/autonomy/autonomy.mjs`): `(?:\.[a-z0-9]+)?` accepts only a single lowercase suffix; task-index.json has 63 IDs with uppercase or double suffixes (`.A`, `.a.A`), so none of them can be declared. Proposal: `(?:\.[A-Za-z0-9]+)*` (+ the title-id parse ~:229), or lowercase the suffixes in build-task-index.mjs. If fixed, #386 (T0004.A) and #390 (T0016.A) become eligible for autonomous merge.

3. **WIN-4 (protected `scripts/bootstrap-autonomy-selftest.mjs`):** stopTickCases waits a fixed `setTimeout(1000)` before asserting the old tick pid is dead → races with Windows process-tree teardown (pkg-bs1 shard b, 2 failures). Proposal (Builder A): a bounded poll ≤15 s + print the pid's image/start time. The protected owner must apply it.
4. **WIN-3 task ID:** the main-based EPERM fix (`claude/builder-d-win3-main` 7e295f3f, independent of #398) is covered honestly only by UASCO-T0088 (RW-013 Windows CI stability); T0088 needs dep V3-T1002 MERGED, so FOUNDER_REQUIRED. Decision: resolve the T0088 dependency, or create a new small task ID for this test-only fix.

## Founder-tier PRs (dependency order)
- **Builder I renderer UX** (`UASCO-TASK: none`, Founder product directive): #370 (T0007 SPLIT) → #371 (stacked on #370) → #377 → #382 → #397 (shares error-code.js with #382, so after #382). HELD after these: 371-safe cc3db0c, 377-safe f8ff0ae, 382-safe c2297f4 → 374-safe 7dbc56f → approval-gate 9d21537 → cloud-sink-guard 1f195e7. #375 has no deps.
- **Builder E:** #381 (T0011.B; deps T0035/T0014/T0044 MISSING, T0028 UNVERIFIABLE, T0029 BLOCKED) → #372 (T0011.A, needs T0011.B REVIEWED). #374 (T0020.A ← T0020.B ← T0016.A + T0016.D).
- **Builder F:** #385 (FD 2026-11-05 design system; no task in the index). HELD: claude/builder-f-a11y-2 32eb0aba.
- **Builder G:** V3-T1012 branches 4b96758d / 1a3a0536 (PROPOSED).
- **Builder C:** #396 (T0124, supervisor register), #403 (T0111, draft), #399 (T0083 SPLIT), #400 (T0081 BLOCKED), #367.

## Routine candidates (they will enter the integration window in turn)
#360, #391, #378 (window) → #387, #393, #394, #395, #401, #402, #404, #405, #364 (T0005, ASSET_DONE, no deps), #366 (T0012) and #373 (T0013) via their H -ready heads.

Note: #366/#373/#379/#383 conflict with each other in tests/v7-b4-desktop-shell.test.ts and leak test state; the fix is on the H `-ready` HELD branches (FF), to be pushed onto the PR branch when its turn comes.
