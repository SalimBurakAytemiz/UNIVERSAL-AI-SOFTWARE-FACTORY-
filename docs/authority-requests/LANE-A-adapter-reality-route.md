<!-- //TR: Lane A yetki talebi: Araçlar paneli (A2) için salt-okunur GET /v1/adapters/reality uç noktası ve ana süreç GET izin listesi girişi / Lane A authority request: read-only adapter reality route for the Tools panel -->
# LANE-A-adapter-reality-route: serve the adapter reality report read-only (protected + Lane B)

The A2 Tools panel (`apps/desktop/renderer/views/tools-panel.js`, `adapter-reality-core.js`) shows four facts **separately**: registered (`GET /v1/adapters`, 194 rows, all `REGISTERED` / `NOT_IMPLEMENTED`), code-backed, CI evidence class and probe state, with `UNDER_REPORTED` / `DEAD_CODE` (and the other three) finding badges. Only the first is served today. Lane B's #287 supplies `adapterReality` to the readiness aggregate only (`GET /v1/roles/status-summary`, `readiness.inputs.adapterReality` `SUPPLIED` / `NOT_SUPPLIED`); the per-adapter report from `buildAdapterRealityReport()` (`core/capabilities/adapter-reality.ts`) is not served by any route. Until this request is done the panel shows "Not measured: this build does not serve the adapter reality report yet" for everything except the registered count. It never shows 0 or "not ready", and never says an adapter is present or ready without a probe.

> **STATUS: OPEN.** Needs Lane B (route + serialiser) and the coordinator (`main.mjs` GET allow-list). Lane A touches neither. Locations are exact for `origin/v7/integration` @5e8fc50.

## 1. Route (Lane B, `apps/control-api/src/routes/`, registered in protected `server.ts`)
`GET /v1/adapters/reality`: read-only, no query string, same token hook as the other GETs. It never runs a tool and never probes.

- Packaged app, or any root where `sourceTreePresent(root)` is false (`role-status.ts:35`): `200 {"schemaVersion":"1.0.0","adapterReality":"NOT_SUPPLIED"}` and nothing else. This must agree with `readiness.inputs.adapterReality` of the same process (the panel shows "not measured" if they disagree).
- Verified source tree: `200` with exactly these keys (the renderer rejects any other shape as a whole, no partial numbers):

```json
{
  "schemaVersion": "1.0.0",
  "adapterReality": "SUPPLIED",
  "registry": {"total": 194, "defined": 194, "implemented": 0},
  "adapters": [{"id": "semgrep", "origin": "REGISTRY", "codePath": "PRESENT", "probe": "NOT_OBSERVED", "ciEvidence": "REAL"}],
  "codeBackedRegistryIds": ["semgrep"],
  "unregisteredReal": [],
  "deadCode": ["core/capabilities/resolver.ts"],
  "unresolvedBindingAdapters": [],
  "findings": [{"finding": "UNDER_REPORTED", "id": "semgrep", "detail": "registry implementation NOT_IMPLEMENTED but a verified code path exists"}],
  "counts": {"UNDER_REPORTED": 1, "OVER_REPORTED": 0, "UNREGISTERED_REAL": 0, "DEAD_CODE": 1, "ADAPTER_UNRESOLVED": 0},
  "ciProblems": []
}
```
Mapping from `buildAdapterRealityReport(repoRoot, {bindingAdapterIds})`:
- `registry`, `codeBackedRegistryIds`, `unregisteredReal`, `deadCode`, `unresolvedBindingAdapters`, `findings`, `counts` are `report.reconciliation` as is.
- `adapters[]` is one row per `ADAPTER_REALITY_RECORDS` record: `id = adapterId`, `origin`, `ciEvidence` from the record; `codePath` and `probe` from `report.entries.get(id)`.
- `ciProblems` is `report.ciProblems`.
- The renderer's invariants (all checked): at most 500 adapters and 1000 findings; unique ids; `codeBackedRegistryIds` equals exactly the `origin REGISTRY` + `codePath PRESENT` rows; `counts` equals the tally of `findings`; `deadCode`, `unresolvedBindingAdapters`, `unregisteredReal` equal the ids of the matching findings; every `UNDER_REPORTED` id is code-backed; `defined` and `implemented` at most `total`.
- Use the cached `adapterRealityFor` content-hash path (`role-status.ts:60`), not a fresh scan per request. Do not put local absolute paths in `detail`.

## 2. Desktop allow-list (protected, coordinator)
`apps/desktop/main.mjs:36`, add one exact entry to `EXTRA_GET_ROUTES` (inside `B4-ALLOWLIST`):
```diff
-const EXTRA_GET_ROUTES=new Set(["/v1/cockpit",...,"/v1/company/contracts"]);
+const EXTRA_GET_ROUTES=new Set(["/v1/cockpit",...,"/v1/company/contracts","/v1/adapters/reality"]);
```
No POST, no query string, no other path. Test pins: in `tests/v7-b5-work-screens.test.ts` (B4 GET allow-list block) `get("/v1/adapters/reality")` is `true`, `get("/v1/adapters/reality?x=1")`, `get("/v1/adapters/reality/x")`, `post("/v1/adapters/reality")` are `false`.

## 3. What Lane A already pins (no change needed from you)
- `mapAdapterReality` is checked against the REAL `buildAdapterRealityReport` output of this repository, serialised with the mapping above, in `tests/v7-ux-wp-agents.test.ts` (describe "LANE-A A2 Tools panel"). If you change the key set, update that serialiser in the same PR.
- The route being absent today (`INVALID_API_PATH` / 404) is shown as "not measured", not as an error and not as zero.
