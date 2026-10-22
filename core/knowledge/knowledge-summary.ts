//TR: Bu dosya bir proje için Proje Belleği ve kanıt dizininden salt okunur bilgi özeti üretir; yeni depolama yoktur, doğrulanamayan kısım UNAVAILABLE/ERROR yazılır ve hiçbir sayı uydurulmaz.
import type {ProjectMemory} from "./project-memory.js";
import type {MemoryHealth, MemoryKind} from "./project-memory-types.js";
import {MEMORY_KINDS, ProjectMemoryError} from "./project-memory-types.js";
import type {EvidenceKind, EvidencePage, EvidenceQuery, VerificationStatus} from "../evidence/index.js";
import {EVIDENCE_KINDS} from "../evidence/index.js";

export const KNOWLEDGE_LIMITS = Object.freeze({ heads: 20, missions: 10, perMission: 25, latestEvidence: 10 });
export interface KnowledgeMemory {
  state: "OK" | "ABSENT" | "TAMPERED" | "TORN_TAIL"; health: MemoryHealth; total: number | null;
  byKind: Record<MemoryKind, number> | null; currentHeads: { id: string; kind: MemoryKind; title: string; at: string; tags: string[] }[] | null;
}
export type KnowledgeEvidence =
  | { state: "UNAVAILABLE"; reason: "EVIDENCE_NOT_WIRED" }
  | { state: "ERROR"; reason: "EVIDENCE_QUERY_FAILED" }
  | { state: "AVAILABLE"; sampled: true; truncated: boolean; missionsQueried: number; total: number; byKind: Record<EvidenceKind, number>; byVerification: Record<VerificationStatus, number>;
      latest: { evidenceId: string; kind: EvidenceKind; verification: VerificationStatus; createdAt: string | null; missionId: string | null; runId: string | null }[] };
export interface KnowledgeSummary { projectId: string; memory: KnowledgeMemory; evidence: KnowledgeEvidence }

const zero = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;

export function summarizeMemory(memory: ProjectMemory): KnowledgeMemory {
  const health = memory.verify();
  // TAMPERED: kayıt içeriği güvenilmez, okuma MEMORY_TAMPERED fırlatır ve sayı/baş verilmez (fail-closed); TORN_TAIL: doğrulanmış önek okunur.
  let all, heads;
  try { all = memory.all(); heads = memory.currentView(); } catch (e) { if (e instanceof ProjectMemoryError && e.code === "MEMORY_TAMPERED") return {state: "TAMPERED", health, total: null, byKind: null, currentHeads: null}; throw e; }
  const byKind = zero(MEMORY_KINDS);
  for (const r of all) byKind[r.kind]++;
  const currentHeads = heads.map(h => h.head).sort((a, b) => b.seq - a.seq).slice(0, KNOWLEDGE_LIMITS.heads).map(r => ({id: r.id, kind: r.kind, title: r.title, at: r.at, tags: r.tags}));
  return {state: health.state, health, total: all.length, byKind, currentHeads};
}

/** Kanıt özeti: projenin en yeni misyonları için örneklenmiş (sampled) sayım; doğrulama durumu EvidenceIndex'in kendi sonucudur, burada yeniden hesaplanmaz. */
export async function summarizeEvidence(index: { list: (q?: EvidenceQuery) => Promise<EvidencePage> } | undefined, missionIds: string[]): Promise<KnowledgeEvidence> {
  if (!index) return {state: "UNAVAILABLE", reason: "EVIDENCE_NOT_WIRED"};
  const ids = missionIds.slice(0, KNOWLEDGE_LIMITS.missions);
  const byKind = zero(EVIDENCE_KINDS), byVerification = zero<VerificationStatus>(["VERIFIED", "MISMATCH", "MISSING", "UNVERIFIABLE"]);
  const items: EvidencePage["items"] = [];
  let truncated = missionIds.length > ids.length;
  try {
    for (const missionId of ids) {
      const page = await index.list({missionId, limit: KNOWLEDGE_LIMITS.perMission});
      if (page.nextCursor !== null) truncated = true;
      items.push(...page.items);
    }
  } catch { return {state: "ERROR", reason: "EVIDENCE_QUERY_FAILED"}; }
  for (const it of items) { byKind[it.kind]++; byVerification[it.verification.status]++; }
  const latest = [...items].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, KNOWLEDGE_LIMITS.latestEvidence)
    .map(it => ({evidenceId: it.evidenceId, kind: it.kind, verification: it.verification.status, createdAt: it.createdAt, missionId: it.scope.missionId, runId: it.scope.runId}));
  return {state: "AVAILABLE", sampled: true, truncated, missionsQueried: ids.length, total: items.length, byKind, byVerification, latest};
}
