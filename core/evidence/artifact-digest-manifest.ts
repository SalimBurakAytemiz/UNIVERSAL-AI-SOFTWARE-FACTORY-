// //TR: UASCO-T0124: süresi dolan CI kanıt artefaktlarının (GitHub Actions) salt-okunur listelemeden elde edilen digest manifestinin SAF doğrulayıcısı. Şema, kayıt tutarlılığı (AVAILABLE/EXPIRED/NO_ARTIFACTS_LISTED), tekil artefakt kimliği, deterministik sıra ve özet sayıları denetlenir; indirilen bir arşivin sha256'sı manifestle karşılaştırılabilir. G/Ç yok.

export const ARTIFACT_DIGEST_SCHEMA = "uasco.ci-artifact-digests.v1" as const;
/** NO_ARTIFACTS_LISTED: the API lists no in-scope artifact for the run (expired and purged, or none produced); nothing is invented for it. */
export type ArtifactRecordStatus = "AVAILABLE" | "EXPIRED" | "NO_ARTIFACTS_LISTED";
/** MACHINE_COPIED: copied by a script from the raw API JSON (no hand transcription); MCP_CROSSCHECKED: additionally matched field by field against an independent MCP read. */
export type RecordVerification = "MACHINE_COPIED" | "MCP_CROSSCHECKED";

export interface ArtifactDigestRecord {
  workflow: string; runId: number; runAttempt: number; headSha: string; runCreatedAt: string;
  artifactId: number | null; name: string | null; sizeInBytes: number | null; digest: string | null;
  expired: boolean | null; expiresAt: string | null; status: ArtifactRecordStatus; verification: RecordVerification;
}
export interface ArtifactDigestSummary {
  runs: number; artifacts: number; available: number; expired: number; noArtifactsListed: number; digestMissing: number; mcpCrossChecked: number;
}
export interface ArtifactDigestManifest {
  "//TR": string; schema: typeof ARTIFACT_DIGEST_SCHEMA; generatedAt: string; repository: string;
  source: "GITHUB_ACTIONS_API_READ_ONLY";
  scope: {branch: string; event: string; workflows: string[]; since: string};
  collection: {method: string; verification: "RAW_API_JSON_SCRIPTED"};
  summary: ArtifactDigestSummary;
  records: ArtifactDigestRecord[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const iso = (x: unknown): x is string => typeof x === "string" && ISO_RE.test(x) && Number.isFinite(Date.parse(x));
const TOP_KEYS = ["//TR", "collection", "generatedAt", "records", "repository", "schema", "scope", "source", "summary"].join(",");
const SCOPE_KEYS = ["branch", "event", "since", "workflows"].join(",");
const COLLECTION_KEYS = ["method", "verification"].join(",");
const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const posInt = (x: unknown, min: number): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= min;
const obj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const RECORD_KEYS = ["artifactId", "digest", "expired", "expiresAt", "headSha", "name", "runAttempt", "runCreatedAt", "runId", "sizeInBytes", "status", "verification", "workflow"].join(",");

/** Deterministic record order: runId, then artifactId (null first). */
export const recordOrder = (a: ArtifactDigestRecord, b: ArtifactDigestRecord): number => a.runId - b.runId || (a.artifactId ?? -1) - (b.artifactId ?? -1);

export function summarize(records: readonly ArtifactDigestRecord[]): ArtifactDigestSummary {
  const withArtifact = records.filter(r => r.status !== "NO_ARTIFACTS_LISTED");
  return {
    runs: new Set(records.map(r => r.runId)).size, artifacts: withArtifact.length,
    available: records.filter(r => r.status === "AVAILABLE").length, expired: records.filter(r => r.status === "EXPIRED").length,
    noArtifactsListed: records.filter(r => r.status === "NO_ARTIFACTS_LISTED").length, digestMissing: withArtifact.filter(r => r.digest === null).length,
    mcpCrossChecked: records.filter(r => r.verification === "MCP_CROSSCHECKED").length,
  };
}

function recordProblems(r: unknown, i: number, generatedAtMs: number, sinceMs: number): string[] {
  const p: string[] = [], at = `records[${i}]`;
  if (!obj(r)) return [`${at}: not an object`];
  if (Object.keys(r).sort().join(",") !== RECORD_KEYS) p.push(`${at}: keys`);
  if (typeof r.workflow !== "string" || r.workflow.length === 0) p.push(`${at}.workflow`);
  if (!posInt(r.runId, 1)) p.push(`${at}.runId`);
  if (!posInt(r.runAttempt, 1)) p.push(`${at}.runAttempt`);
  if (typeof r.headSha !== "string" || !SHA40_RE.test(r.headSha)) p.push(`${at}.headSha`);
  if (!iso(r.runCreatedAt) || Date.parse(r.runCreatedAt) < sinceMs || !(Date.parse(r.runCreatedAt) <= generatedAtMs)) p.push(`${at}.runCreatedAt`);
  if (!["MACHINE_COPIED", "MCP_CROSSCHECKED"].includes(r.verification as string)) p.push(`${at}.verification`);
  if (r.status === "NO_ARTIFACTS_LISTED") {
    if ([r.artifactId, r.name, r.sizeInBytes, r.digest, r.expired, r.expiresAt].some(v => v !== null)) p.push(`${at}: NO_ARTIFACTS_LISTED carries artifact fields`);
    if (r.verification !== "MACHINE_COPIED") p.push(`${at}.verification`);
    return p;
  }
  if (r.status !== "AVAILABLE" && r.status !== "EXPIRED") return [...p, `${at}.status`];
  if (!posInt(r.artifactId, 1)) p.push(`${at}.artifactId`);
  if (typeof r.name !== "string" || r.name.length === 0) p.push(`${at}.name`);
  if (!posInt(r.sizeInBytes, 0)) p.push(`${at}.sizeInBytes`);
  if (r.digest !== null && (typeof r.digest !== "string" || !DIGEST_RE.test(r.digest))) p.push(`${at}.digest`);
  if (typeof r.expired !== "boolean") p.push(`${at}.expired`);
  if (!iso(r.expiresAt)) p.push(`${at}.expiresAt`);
  else {
    // The status follows the API's own `expired` flag; an "available" artifact whose expiry already passed at generation time is inconsistent.
    if (r.status === "AVAILABLE" && (r.expired !== false || Date.parse(r.expiresAt) <= generatedAtMs)) p.push(`${at}: AVAILABLE but expired`);
    if (r.status === "EXPIRED" && r.expired !== true) p.push(`${at}: EXPIRED but expired flag is not true`);
  }
  return p;
}

/** Full manifest check. ok only when there are no problems. */
export function verifyArtifactDigestManifest(m: unknown): {ok: boolean; problems: string[]} {
  if (!obj(m)) return {ok: false, problems: ["manifest: not an object"]};
  const p: string[] = [];
  // Closed key sets (review N2): an unexpected top-level, scope or collection field is a problem, like an unexpected record field.
  if (Object.keys(m).sort().join(",") !== TOP_KEYS) p.push("keys");
  if (obj(m.scope) && Object.keys(m.scope).sort().join(",") !== SCOPE_KEYS) p.push("scope: keys");
  if (obj(m.collection) && Object.keys(m.collection).sort().join(",") !== COLLECTION_KEYS) p.push("collection: keys");
  if (typeof m["//TR"] !== "string" || m["//TR"].length === 0) p.push("//TR");
  if (m.schema !== ARTIFACT_DIGEST_SCHEMA) p.push("schema");
  if (!iso(m.generatedAt)) p.push("generatedAt");
  if (typeof m.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(m.repository)) p.push("repository");
  if (m.source !== "GITHUB_ACTIONS_API_READ_ONLY") p.push("source");
  const sc = m.scope;
  if (!obj(sc) || typeof sc.branch !== "string" || typeof sc.event !== "string" || !Array.isArray(sc.workflows) || sc.workflows.length === 0 || !iso(sc.since)) p.push("scope");
  if (!obj(m.collection) || m.collection.verification !== "RAW_API_JSON_SCRIPTED" || typeof m.collection.method !== "string") p.push("collection");
  if (!Array.isArray(m.records)) return {ok: false, problems: [...p, "records"]};
  const gen = iso(m.generatedAt) ? Date.parse(m.generatedAt) : NaN, since = obj(sc) && iso(sc.since) ? Date.parse(sc.since) : NaN;
  m.records.forEach((r, i) => p.push(...recordProblems(r, i, gen, since)));
  const recs = m.records as ArtifactDigestRecord[];
  if (p.length === 0) {
    const ids = recs.filter(r => r.artifactId !== null).map(r => r.artifactId);
    if (new Set(ids).size !== ids.length) p.push("records: duplicate artifactId");
    if (obj(sc) && Array.isArray(sc.workflows) && recs.some(r => !(sc.workflows as unknown[]).includes(r.workflow))) p.push("records: workflow outside scope");
    // Per-run consistency (review N3): every record of one runId carries the same workflow, attempt, head SHA and creation time.
    const runs = new Map<number, string>();
    for (const r of recs) {
      const k = JSON.stringify([r.workflow, r.runAttempt, r.headSha, r.runCreatedAt]), seen = runs.get(r.runId);
      if (seen === undefined) runs.set(r.runId, k); else if (seen !== k) { p.push(`records: run ${r.runId} inconsistent`); break; }
    }
    for (let i = 1; i < recs.length; i++) if (recordOrder(recs[i - 1], recs[i]) >= 0) { p.push(`records: order at ${i}`); break; }
    if (JSON.stringify(m.summary) !== JSON.stringify(summarize(recs))) p.push("summary");
  }
  return {ok: p.length === 0, problems: p};
}

/**
 * Compare a downloaded artifact archive's sha256 (hex) with the manifest. UNKNOWN when the artifact or its digest is not recorded.
 * INVALID_INPUT when sha256Hex is not 64 hex characters (review N4): a malformed hash is a caller error, not a digest mismatch.
 */
export function checkArtifactDigest(m: ArtifactDigestManifest, artifactId: number, sha256Hex: string): "MATCH" | "MISMATCH" | "UNKNOWN" | "INVALID_INPUT" {
  if (typeof sha256Hex !== "string" || !HEX64_RE.test(sha256Hex)) return "INVALID_INPUT";
  const r = m.records.find(x => x.artifactId === artifactId);
  if (!r || r.digest === null) return "UNKNOWN";
  return r.digest === `sha256:${String(sha256Hex).toLowerCase()}` ? "MATCH" : "MISMATCH";
}
