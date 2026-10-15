// //TR: Bu dosya Skill Academy drift monitörünü saf fonksiyon olarak uygular: terfi etmiş öğrenme kayıtlarını güncel kaynak/model/araç adaptörü durumuyla karşılaştırır, STALE / RECERTIFY_REQUIRED / REVOKED kararını gerekçeleriyle üretir ve iptali bağımlı kayıtlara zincirler; girdileri değiştirmez, dosya veya ağ okumaz.
import {isFresh} from "./rules.js";
import {canTransition} from "./types.js";
import type {LearningRecord, LearningStatus, SourceRecord} from "./types.js";

export interface DriftEnvironment {
  now: number;
  // Güncel model sürümü; bilinmiyorsa null (varsayılan DENY/UNKNOWN: yeniden sertifika gerekir).
  modelVersion: string | null;
  toolAdapters: Readonly<Record<string, string>>;
  // Reviewer kanıtı yeniden doğrulanamayan (dosya değişmiş/silinmiş) kayıtlar; çağıran taraf hesaplar.
  invalidEvidenceLearningIds?: readonly string[];
}
export interface DriftDecision { learningId: string; from: LearningStatus; to: LearningStatus; reasons: string[]; causeLearningId: string | null }
export interface DriftInput { learnings: Readonly<Record<string, LearningRecord>>; sources: Readonly<Record<string, SourceRecord>> }

const MONITORED: readonly LearningStatus[] = ["PROMOTED_KNOWLEDGE", "PROMOTED_SKILL_CANDIDATE", "STALE", "RECERTIFY_REQUIRED"];

function direct(rec: LearningRecord, input: DriftInput, env: DriftEnvironment, invalidEvidence: ReadonlySet<string>): {to: LearningStatus; reasons: string[]} | null {
  const revoke: string[] = [], recert: string[] = [], stale: string[] = [];
  for (const id of rec.sourceIds) {
    const s = input.sources[id];
    if (!s) revoke.push(`SOURCE_MISSING:${id}`);
    else if (s.status === "REVOKED") revoke.push(`SOURCE_REVOKED:${id}`);
    else if (s.status === "POISONED") revoke.push(`SOURCE_POISONED:${id}`);
  }
  if (invalidEvidence.has(rec.learningId)) revoke.push("REVIEWER_EVIDENCE_INVALID");
  const lab = rec.labResult;
  if (!lab) revoke.push("LAB_RESULT_MISSING");
  else {
    if (env.modelVersion === null) recert.push("MODEL_VERSION_UNKNOWN");
    else if (env.modelVersion !== lab.modelVersion) recert.push("MODEL_VERSION_CHANGED");
    for (const [id, v] of Object.entries(lab.toolAdapters).sort(([a], [b]) => a.localeCompare(b))) {
      const cur = env.toolAdapters[id];
      if (cur === undefined) recert.push(`TOOL_ADAPTER_MISSING:${id}`);
      else if (cur !== v) recert.push(`TOOL_ADAPTER_CHANGED:${id}`);
    }
  }
  for (const id of rec.promotion?.supportingSourceIds ?? []) { const s = input.sources[id]; if (s && !isFresh(s, env.now)) stale.push(`SOURCE_TTL_EXPIRED:${id}`); }
  const pick = revoke.length ? {to: "REVOKED" as const, reasons: revoke} : recert.length ? {to: "RECERTIFY_REQUIRED" as const, reasons: recert} : stale.length ? {to: "STALE" as const, reasons: stale} : null;
  return pick && pick.to !== rec.status && canTransition(rec.status, pick.to) ? pick : null;
}

export function computeDrift(input: DriftInput, env: DriftEnvironment): DriftDecision[] {
  const invalidEvidence = new Set(env.invalidEvidenceLearningIds ?? []);
  const decided = new Map<string, DriftDecision>();
  const monitored = Object.values(input.learnings).filter(r => MONITORED.includes(r.status)).sort((a, b) => a.learningId.localeCompare(b.learningId));
  for (const rec of monitored) {
    const d = direct(rec, input, env, invalidEvidence);
    if (d) decided.set(rec.learningId, {learningId: rec.learningId, from: rec.status, to: d.to, reasons: d.reasons, causeLearningId: null});
  }
  // İptal zinciri: iptal edilmiş (veya bu turda iptal edilen) kayda bağımlı her terfi etmiş kayıt da iptal edilir; sabit noktaya kadar.
  const revoked = (id: string) => input.learnings[id]?.status === "REVOKED" || decided.get(id)?.to === "REVOKED";
  for (let changed = true; changed;) {
    changed = false;
    for (const rec of monitored) {
      if (decided.get(rec.learningId)?.to === "REVOKED") continue;
      const cause = rec.dependsOn.find(revoked);
      if (cause === undefined) continue;
      decided.set(rec.learningId, {learningId: rec.learningId, from: rec.status, to: "REVOKED", reasons: [`DEPENDENCY_REVOKED:${cause}`], causeLearningId: cause});
      changed = true;
    }
  }
  return [...decided.values()];
}
