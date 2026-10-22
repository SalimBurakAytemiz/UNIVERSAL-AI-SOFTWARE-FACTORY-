<!-- //TR: Koordinatör korumalı paket 3b kaydı: pre-dev Founder karar rotaları ve rol yaşam döngüsü özeti server.ts kaydı ile Desktop izin listesi; birleştirme Founder'ın korumalı PR auto-merge yetkisiyle olur. -->
# COORD protected batch 3b: pre-dev decisions + role status summary registration + Desktop allow-list

Stacked on batch 3a (#195): the branch contains #195's commits until that PR merges; the own diff of 3b is the five lines in `server.ts`, the allow-list lines in `main.mjs`, the reseal and the tests below. Protected files changed: `apps/control-api/src/server.ts`, `apps/desktop/main.mjs`, `config/trust-root-manifest.json` (reseal: only the two sha256 values and `generatedAt` change). Merge needs the Founder's protected-PR authority.

## server.ts (as requested in LANE-B-predev-decisions and LANE-C-role-status-route)
- `registerPredevDecisionRoutes(app,laneDeps)` (#194): `POST /v1/missions/:id/predev/start`, `.../predev/artifacts/:artifactId/approve` and `.../reject`. Same global token hook; gates in the route: Global Stop 423, policy 403, strict body 400, mission/artifact lookup with tenant scope 404, store gates as `409 PREDEV_GATE_REFUSED` (independent approver, evidence required, phase order). The approver is always the server actor.
- `registerRoleStatusRoutes(app,{...laneDeps,repoRoot})` (#181): read-only `GET /v1/roles/status-summary`, five independent counters computed only from evidence, `503 ROLE_REGISTRY_UNAVAILABLE` when the registry is missing or invalid. The static path does not shadow `GET /v1/roles/:roleId` (a test pins both).

## main.mjs allow-list (inside the B4/B5 blocks the tests evaluate)
- GET `/v1/roles/status-summary` (no query), as a separate anchored pattern; the pinned `EXTRA_GET_ROUTES` set is unchanged.
- POST `/v1/missions/msn_<24hex>/predev/start`, `/v1/missions/msn_<24hex>/predev/artifacts/pda_<24hex>/approve` and `/reject` (no query, no trailing segment). The body stays under the existing rule: a plain JSON object of at most 32 KiB.

## Deliberately NOT in this batch
- Linux sandbox provider hook in `server.ts` (LANE-C-linux-sandbox-provider): it lets project code execute where it is refused today, so it stays a separate PR for a separate Founder decision.
- Desktop allow-list entry for POST memory: no screen uses it yet.

## Evidence
`tests/support/protected-batch-3b.cases.ts` (registered from `tests/v7-b4-desktop-shell.test.ts`): the three pre-dev POST paths are accepted only with canonical ids and about 20 hostile variants are refused; the renderer's `STATUS_SUMMARY_PATH` is accepted and its variants are refused; the real `buildServer` runs start -> agent draft -> Founder approve with evidence -> reject keeps the phase -> re-draft (supersedes, #198) -> approve -> PLANNING, refuses without the token, and serves the role status summary with the registry digest while role detail still answers. Suites run: `v7-b4-desktop-shell`, `v7-b1-workos`, `v7-wfr03-role-registry`, `v7-ux-journey` 206/206; `tsc --noEmit` clean; trust-root verify PASS. Mutation checks: 9 of 9 caught (each registration removed, role-status without `repoRoot`, a predev path removed, artifact id widened to upper-case hex, an extra verb, the status-summary pattern removed or unanchored, the start pattern unanchored).
