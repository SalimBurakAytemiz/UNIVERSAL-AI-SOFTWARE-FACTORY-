<!-- //TR: Lane B yetki talebi: proje bilgi özeti route kaydı için server.ts yaması ve Electron izin listesi yolu -->
# LANE-B-knowledge-api: register the project knowledge summary route (protected) + Desktop path

Read-only summary the Desktop can show for UI-160: Project Memory (PR #161) plus the evidence index (PQ-006). No new storage; nothing is invented: a part that cannot be read says so.

`GET /v1/projects/:id/knowledge` returns `{knowledge:{projectId, memory, evidence}}`:
- `memory`: `state` (OK / ABSENT / TAMPERED / TORN_TAIL), `health`, `total`, `byKind`, `currentHeads` (up to 20, newest first). TAMPERED -> counts and heads are `null` (fail-closed); TORN_TAIL -> the verified prefix.
- `evidence`: `UNAVAILABLE/EVIDENCE_NOT_WIRED` when server.ts does not pass the index, `ERROR/EVIDENCE_QUERY_FAILED` when the index throws (no message leaked), else `AVAILABLE` with `sampled:true`, `truncated`, `missionsQueried` (newest 10 missions, 25 items each), `total`, `byKind`, `byVerification` (the index's own verification result, not recomputed) and the 10 `latest` rows.

Depends on PR #161 (`core/knowledge/project-memory*.ts`, `routes/memory.ts`); this branch is stacked on it.

## Patch (server.ts)
`evidenceIndex` already exists in server.ts (`const evidenceIndex=()=>new EvidenceIndex({...})`) and must be declared before `laneDeps`, or the lane deps must pass it lazily:
```diff
+import {registerKnowledgeRoutes} from "./routes/knowledge.js";
@@ laneDeps (add the optional evidenceIndex; it is a function, so ordering is safe)
-const laneDeps={getStore,scope,orgId,actor,audit,workosStopped,workosPolicy,workosFail};
+const laneDeps={getStore,scope,orgId,actor,audit,workosStopped,workosPolicy,workosFail,evidenceIndex:()=>evidenceIndex()};
@@ after registerMemoryRoutes(app,laneDeps);
+registerKnowledgeRoutes(app,laneDeps);
```
(`evidenceIndex` is a `const` arrow declared later in the file; the wrapper `()=>evidenceIndex()` is only called at request time, after the module has finished loading.)

## Electron allow-list (apps/desktop/main.mjs, protected)
GET `/v1/projects/prj_<24hex>/knowledge` (no query).

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 60 passed (5 new "LANE-B project knowledge summary", including the real `EvidenceIndex`). Mutations (do not handle a TAMPERED chain; drop the truncation flag; replace UNAVAILABLE with invented zero evidence) each made a test fail.
