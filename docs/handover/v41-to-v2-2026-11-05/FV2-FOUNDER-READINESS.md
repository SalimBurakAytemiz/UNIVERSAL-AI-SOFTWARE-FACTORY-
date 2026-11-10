# Factory V2 PR readiness (independent assessment by the V4.1 coordinator), 2026-11-10 ~05:15Z

main = e81ac373 (#388 merged); verify-main = MAIN_RUNNING (preflight+ubuntu PASS, windows shards 1/2/3 running since 04:59Z, normal duration).
Method: GitHub PR, check-run and review data; `parseBinding` (merge-gate.mjs) + `reviewAttestation` (autonomy.mjs); task-index.json; STATE.json. The coordinator has not written to the V2 branches.

| PR | task / tier | base.ref (base sha) | draft | CI on head | CLEAN binding on head | attestation line | status |
|---|---|---|---|---|---|---|---|
| #355 | FV2-T0002 / T3 | v7/integration (485d9991, stale; main e81ac373) | yes | all PASS (old head 193e7d35) | 5820099417, base 485d9991 (old) | **none** | WAITING: V2 prep (refresh onto main → CI → fresh review with attestation) |
| #389 | FV2-T0003 / T3, dep FV2-T0002 | **claude/fv2-gov-executor-fence (stacked on #355)** | yes | PASS (70cbcbc0) | 5820099735, base 193e7d35 | none | WAITING: after #355 merges, retarget to v7/integration + refresh + fresh review |
| #408 | FV2-T0005 / **T3** (Founder merge), dep FV2-T0004 | **claude/fv2-p0-control (#388's merged branch)** | yes | PASS (460ede23) | 5820100234, base c427ecc4 (old #388 head) | none | WAITING: V2 prep (retarget to v7/integration + refresh + fresh review) |
| #409 | FV2-T0006 / T2 (routine), dep FV2-T0005 | claude/fv2-p0-live (stacked on #408) | yes | PASS (4bc62535) | 5820100705, base 460ede23 | none | WAITING: #408 merge + a verified STATE.json FV2-T0005 entry + retarget/refresh/review |
| #412 | FV2-T0007 / T3 (reviewer OAuth repair) | v7/integration (485d9991, stale) | yes | PASS (0ba4ea8e) | 5820241290, base 485d9991 | none | WAITING: a separate Founder-tier track; refresh + fresh review |

Dependency evidence:
- FV2-T0004 (#388): **actually merged** (e81ac373; head d2fd0123; the old head c427ecc4 is also in main). But **there is no `{FV2-T0004, 388}` entry in STATE.json** → when the executor computes #408's dependency it reports `TASK_DEPENDENCY_UNMET:FV2-T0004` (#408 is a Founder merge, so this does not block the merge, but the dependency record is missing). Likewise `{FV2-T0001, 411}` has no entry.
- #409's FV2-T0005 dependency requires a verified entry for #408 in STATE.json → **FOUNDER-QUEUE decision 8 (DONE writeback method) is now on the critical path.**

None of these PRs is "mergeable now": all are drafts, the reviews are bound to pre-refresh heads/bases, and they lack the attestation line required by the 2026-11-09 protocol.
