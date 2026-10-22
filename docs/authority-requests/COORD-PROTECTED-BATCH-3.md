<!-- //TR: Koordinatör korumalı paket 3 kaydı: hangi korumalı dosyada ne değişti, neyin bilerek dışarıda bırakıldığı ve kanıt; birleştirme Founder'ın korumalı PR auto-merge yetkisiyle olur. -->
# COORD protected batch 3a: memory, knowledge and error-contract wiring + Desktop allow-list

Protected files changed: `apps/control-api/src/server.ts`, `apps/desktop/main.mjs`, `config/trust-root-manifest.json` (reseal: only the two sha256 values and `generatedAt` change). Merge needs the Founder's protected-PR authority (auto-merge enabled by the Founder).

## server.ts (as requested in LANE-B-memory-api, LANE-B-knowledge-api, LANE-B-error-contract, LANE-B-attention-api)
- `registerMemoryRoutes(app,laneDeps)` and `registerKnowledgeRoutes(app,laneDeps)` after the existing lane registrations: same global token hook, same write gates (Global Stop 423, policy 403, schema 400), same tenant scope and audit.
- `registerAttentionRoutes(app,laneDeps)`: the read-only Founder attention queue derived from the Work OS journal (#191).
- `laneDeps.evidenceIndex = ()=>evidenceIndex()`: lazy, called only at request time, so the knowledge summary reports real evidence instead of `UNAVAILABLE/EVIDENCE_NOT_WIRED`.
- `frameworkErrors` constructor option and `registerErrorContract(app)`: errors raised by Fastify itself (bad JSON, media type, body size, bad URL, unknown route) answer a fixed `{error:"CODE"}`; route-level responses are unchanged.

## main.mjs allow-list (inside the B4/B5 blocks the tests evaluate)
- GET, read-only, anchored patterns: `/v1/projects/prj_<24hex>/memory/{current,health}`, `/memory/mem_<6-12 digits>`, `/memory/mem_<6-12 digits>/provenance`, `/v1/projects/prj_<24hex>/knowledge` (no query on any of them).
- GET memory list `/v1/projects/prj_<24hex>/memory` with an optional query of at most `kind`, `tag`, `q`, in that fixed order, no repeats: `kind` in DECISION|FACT|SOURCE|REVISION|NOTE, `tag` 1-64 and `q` 1-200 characters, encoded exactly like the renderer (`psEncodeRel`), no control characters after decoding; whole value at most 2600 characters.
- GET `/v1/attention` (no query; the legacy `/v1/founder-attention` is unchanged).
- POST `/v1/work-runs/run_<24hex>/tasks/reconcile` (the renderer sends an empty body; the route derives task outcomes from the Work OS journal under the same gates).

## Deliberately NOT in this batch
- POST memory (write form): no screen uses it yet; it gets its own allow-list review.
- Linux sandbox provider hook in `server.ts` (LANE-C-linux-sandbox-provider): it lets project code execute where it is refused today, so it is a separate PR for a separate Founder decision.
- `GET /v1/roles/status-summary` registration (#181): its route module is not on `v7/integration` yet; it follows in the next batch.
- `GET /v1/founder-attention` stays as it is.

## Evidence
`tests/support/protected-batch-3.cases.ts` (registered from `tests/v7-b4-desktop-shell.test.ts`): renderer-built paths are accepted, about 35 hostile variants are refused, reconcile POST only for a canonical run id, and the real `buildServer` serves memory and knowledge (evidence wired), maps bad JSON / bad URL / unknown route to fixed codes, and still requires the token. Mutation checks: 8 of 8 caught.
