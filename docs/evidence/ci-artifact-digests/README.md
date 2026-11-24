<!-- //TR: UASCO-T0124 CI artefakt digest manifestleri: süresi dolan GitHub Actions kanıt artefaktlarının (CI ci-evidence-*, Windows installer) salt-okunur API listelemesinden alınmış sha256 özetleri; doğrulayıcı core/evidence/artifact-digest-manifest.ts. -->
# CI artifact digest manifests (UASCO-T0124)

Each `YYYY-MM-DD.json` records, for the `v7/integration` push runs of the CI and Windows Installer workflows, every artifact the GitHub Actions API still listed on that day. Each entry has the run id, attempt, head SHA, artifact id, name, size, `sha256` digest and expiry.

- **Source:** read-only REST listing (`actions/workflows/{workflow}/runs`, `actions/runs/{id}/artifacts`). The raw JSON was copied by a script, not retyped. Nothing was downloaded, uploaded or deleted.
- **Scope:** runs created on or after `scope.since`. The CI `validation-shard-*` artifacts are left out; the SHA-bound evidence is `ci-evidence-*`.
- **`NO_ARTIFACTS_LISTED`:** the API lists no in-scope artifact for that run. Its artifacts expired and were purged, or none were produced. Nothing is invented for such runs.
- **Verification:** `MCP_CROSSCHECKED` records were matched field by field against an independent GitHub MCP read. Every other record is `MACHINE_COPIED`.
- **Checking a download:** `checkArtifactDigest(manifest, artifactId, sha256OfZip)` returns MATCH, MISMATCH or UNKNOWN.
- **Validation:** `verifyArtifactDigestManifest` checks the file's shape and consistency. The test lives in `tests/support/artifact-digest-manifest.cases.ts`, registered from `tests/v7-b10a-evidence.test.ts`.

Long-term retention of the installer binaries themselves is not covered here; it needs storage and is a Founder item.
