// //TR: UASCO-T0124 testleri: CI artefakt digest manifesti doğrulayıcısı (şema, durum tutarlılığı, tekil kimlik, sıra, özet) ve repodaki gerçek manifest dosyasının (docs/evidence/ci-artifact-digests) doğrulayıcıdan geçtiği; arşiv sha256 karşılaştırması. Ağ yok.
import {describe, expect, it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {ARTIFACT_DIGEST_SCHEMA, checkArtifactDigest, summarize, verifyArtifactDigestManifest, type ArtifactDigestManifest, type ArtifactDigestRecord} from "../../core/evidence/artifact-digest-manifest.js";

const DIR = path.join(import.meta.dirname, "..", "..", "docs", "evidence", "ci-artifact-digests");
const H = (c: string) => c.repeat(64), SHA = "a".repeat(40);
const rec = (o: Partial<ArtifactDigestRecord> = {}): ArtifactDigestRecord => ({workflow: "CI", runId: 100, runAttempt: 1, headSha: SHA, runCreatedAt: "2026-11-01T10:00:00Z",
  artifactId: 5, name: "ci-evidence-Linux-100-1", sizeInBytes: 1376, digest: `sha256:${H("1")}`, expired: false, expiresAt: "2026-11-15T10:00:00Z",
  status: "AVAILABLE", verification: "MACHINE_COPIED", ...o});
const man = (records: ArtifactDigestRecord[], o: Partial<ArtifactDigestManifest> = {}): ArtifactDigestManifest => ({"//TR": "test", schema: ARTIFACT_DIGEST_SCHEMA,
  generatedAt: "2026-11-05T18:00:00Z", repository: "o/r", source: "GITHUB_ACTIONS_API_READ_ONLY",
  scope: {branch: "v7/integration", event: "push", workflows: ["CI", "Windows Installer"], since: "2026-10-18T00:00:00Z"},
  collection: {method: "script", verification: "RAW_API_JSON_SCRIPTED"}, summary: summarize(records), records, ...o});

/** Registered from tests/v7-b10a-evidence.test.ts (listed in config/validation.json). */
export function registerArtifactDigestManifestSuite(): void {
  describe("UASCO-T0124 CI artifact digest manifest", () => {
    const good = () => man([rec({verification: "MCP_CROSSCHECKED"}), rec({artifactId: 6, name: "ci-evidence-Windows-100-1", digest: `sha256:${H("b")}`}),
      rec({runId: 101, artifactId: 7, name: "old", expired: true, expiresAt: "2026-11-02T00:00:00Z", status: "EXPIRED", digest: null}),
      rec({runId: 102, artifactId: null, name: null, sizeInBytes: null, digest: null, expired: null, expiresAt: null, status: "NO_ARTIFACTS_LISTED"})]);

    it("a consistent manifest verifies (positive control); summary is recomputed", () => {
      expect(verifyArtifactDigestManifest(good())).toEqual({ok: true, problems: []});
      expect(good().summary).toEqual({runs: 3, artifacts: 3, available: 2, expired: 1, noArtifactsListed: 1, digestMissing: 1, mcpCrossChecked: 1});
    });

    it("rejects: bad digest/sha/ids, AVAILABLE-but-expired, EXPIRED without the flag, NO_ARTIFACTS with fields, duplicates, disorder, wrong summary, out-of-scope run", () => {
      const bad: Array<[string, ArtifactDigestManifest]> = [
        ["digest", man([rec({digest: "sha256:XYZ"})])],
        ["digest-prefix", man([rec({digest: H("1")})])],
        ["headSha", man([rec({headSha: "abc"})])],
        ["artifactId", man([rec({artifactId: 0})])],
        ["available-expired-flag", man([rec({expired: true})])],
        ["available-past-expiry", man([rec({expiresAt: "2026-11-05T17:00:00Z"})])],
        ["expired-flag", man([rec({status: "EXPIRED", expired: false})])],
        ["no-artifacts-fields", man([rec({status: "NO_ARTIFACTS_LISTED"})])],
        ["no-artifacts-crosschecked", man([rec({artifactId: null, name: null, sizeInBytes: null, digest: null, expired: null, expiresAt: null, status: "NO_ARTIFACTS_LISTED", verification: "MCP_CROSSCHECKED"})])],
        ["status", man([rec({status: "GONE" as never})])],
        ["verification", man([rec({verification: "TRUST_ME" as never})])],
        ["extra-key", man([{...rec(), note: "x"} as never])],
        ["before-scope", man([rec({runCreatedAt: "2026-10-01T00:00:00Z"})])],
        ["workflow-scope", man([rec({workflow: "Other"})])],
        ["duplicate", man([rec(), rec({runId: 101})])],
        ["order", man([rec({runId: 101}), rec({runId: 100, artifactId: 9})])],
        ["schema", {...good(), schema: "v0" as never}],
        ["source", {...good(), source: "SCRAPED" as never}],
        ["collection", {...good(), collection: {method: "x", verification: "INDEPENDENT_DOUBLE_READ" as never}}],
      ];
      for (const [what, m] of bad) expect(verifyArtifactDigestManifest(m).ok, what).toBe(false);
      expect(verifyArtifactDigestManifest({...good(), summary: {...good().summary, mcpCrossChecked: 2}}).problems).toEqual(["summary"]);
      expect(verifyArtifactDigestManifest(null).ok).toBe(false);
    });

    it("checkArtifactDigest: MATCH, MISMATCH, UNKNOWN (unrecorded or digest missing)", () => {
      const m = good();
      expect(checkArtifactDigest(m, 5, H("1"))).toBe("MATCH");
      expect(checkArtifactDigest(m, 6, H("b").toUpperCase())).toBe("MATCH");   // hex case-insensitive
      expect(checkArtifactDigest(m, 5, H("3"))).toBe("MISMATCH");
      expect(checkArtifactDigest(m, 7, H("1"))).toBe("UNKNOWN");
      expect(checkArtifactDigest(m, 999, H("1"))).toBe("UNKNOWN");
    });

    it("every committed manifest under docs/evidence/ci-artifact-digests verifies and carries an MCP cross-check", () => {
      const files = fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const m = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
        expect(verifyArtifactDigestManifest(m), f).toEqual({ok: true, problems: []});
        expect(m.summary.mcpCrossChecked, f).toBeGreaterThan(0);
        expect(m.summary.artifacts, f).toBeGreaterThan(0);
      }
    });
  });
}
