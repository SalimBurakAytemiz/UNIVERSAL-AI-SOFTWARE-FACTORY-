// //TR: Bu dosya pre-dev journal girdilerinin replay kurallarını uygular: her girdi şekil, tenant, allowlist geçiş, rol eşlemesi ve izlenebilirlik bakımından yeniden doğrulanır; tutarsız veya sahte (ör. kendi kendini onaylayan, kanıtsız onay, atlanmış faz) girdi journal'ı fail-closed yapar. Ayrı store yoktur; durum Work OS State içindeki PreDevState alt-durumudur.
import {WorkOsError} from "../types.js";
import {validateArtifactContent, type UpstreamContents} from "./validators.js";
import {
  PHASE_ARTIFACT_KIND, PRE_DEV_ROLE_MAP, canArtifactTransition, canPhaseTransition, isArtifactKind, isArtifactState, isPreDevPhase
} from "./types.js";
import type {
  ArtifactKind, ArtifactState, BusinessAnalysisContent, PlanContent, PreDevApplied, PreDevArtifact, PreDevEntry,
  PreDevPhase, PreDevSequence, PreDevState, RequirementsContent
} from "./types.js";

const tampered = (d: string) => new WorkOsError("WORKOS_JOURNAL_TAMPERED", d);
const malformed = (d: string) => new WorkOsError("WORKOS_UNAVAILABLE", d);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isTime = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
const isNat = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

// Türün ait olduğu faz (PHASE_ARTIFACT_KIND'in tersi).
export function phaseForKind(kind: ArtifactKind): PreDevPhase {
  for (const [phase, k] of Object.entries(PHASE_ARTIFACT_KIND)) if (k === kind) return phase as PreDevPhase;
  throw tampered("PREDEV_KIND_HAS_NO_PHASE");
}
// Dizideki bir türün O ANDAKİ artefaktı (yoksa undefined).
const currentArtifact = (st: PreDevState, seq: PreDevSequence, kind: ArtifactKind): PreDevArtifact | undefined => {
  const id = seq.artifacts[kind];
  return id ? st.artifacts[id] : undefined;
};
// İzlenebilirlik için üst (APPROVED) artefaktların içeriği; alt doğrulayıcılar bunu ister.
function upstreamFor(st: PreDevState, seq: PreDevSequence, kind: ArtifactKind): UpstreamContents {
  const approved = (k: ArtifactKind) => { const a = currentArtifact(st, seq, k); return a && a.state === "APPROVED" ? a.content : undefined; };
  if (kind === "Requirements") return {businessAnalysis: approved("BusinessAnalysis") as BusinessAnalysisContent | undefined};
  if (kind === "Plan") return {requirements: approved("Requirements") as RequirementsContent | undefined};
  if (kind === "Architecture") return {plan: approved("Plan") as PlanContent | undefined};
  return {};
}

function validSequenceOpen(s: unknown, actor: string): s is PreDevSequence {
  if (!isObj(s)) return false;
  const r = s as unknown as PreDevSequence;
  return isStr(r.preDevId) && isStr(r.missionId) && isStr(r.tenantId) && r.phase === "AUTHORIZED"
    && isObj(r.artifacts) && Object.keys(r.artifacts).length === 0
    && isTime(r.createdAt) && isTime(r.updatedAt) && r.createdBy === actor
    && Array.isArray(r.lifecycleActors) && r.lifecycleActors.length === 1 && r.lifecycleActors[0] === actor;
}
function validArtifact(a: unknown, actor: string): a is PreDevArtifact {
  if (!isObj(a)) return false;
  const r = a as unknown as PreDevArtifact;
  return isStr(r.id) && isStr(r.missionId) && isStr(r.tenantId) && isArtifactKind(r.kind) && isNat(r.version) && r.version >= 1
    && isStr(r.authorRoleId) && isTime(r.createdAt) && isTime(r.updatedAt) && r.state === "DRAFT"
    && (r.supersedes === null || isStr(r.supersedes)) && isStrArr(r.evidenceRefs)
    && isObj(r.content) && r.recordedBy === actor && r.approvedBy === null && r.rejectedBy === null;
}

export function applyPreDevEntry(st: PreDevState, e: PreDevEntry): PreDevApplied {
  const p = e.payload;
  switch (e.type) {
    case "PREDEV_SEQUENCE_OPENED": {
      const s = p.entity;
      if (!validSequenceOpen(s, e.actor)) throw malformed(`PREDEV_SEQUENCE_SHAPE:${e.seq}`);
      if (st.sequences[s.preDevId]) throw tampered(`PREDEV_DUPLICATE:${e.seq}`);
      // Mission başına en çok bir dizi (çift pre-dev isteği reddedilir).
      if (Object.values(st.sequences).some(q => q.missionId === s.missionId)) throw tampered(`PREDEV_SEQUENCE_EXISTS_FOR_MISSION:${e.seq}`);
      st.sequences[s.preDevId] = {...s, artifacts: {}, lifecycleActors: [...s.lifecycleActors]};
      return {idem: {tenantId: s.tenantId, kind: "predev.sequence", id: s.preDevId}};
    }
    case "PREDEV_ARTIFACT_RECORDED": {
      const a = p.entity;
      if (!isStr(p.preDevId)) throw malformed(`PREDEV_REF:${e.seq}`);
      const seq = st.sequences[p.preDevId];
      if (!seq) throw tampered(`PREDEV_SEQUENCE_UNKNOWN:${e.seq}`);
      if (!validArtifact(a, e.actor)) throw malformed(`PREDEV_ARTIFACT_SHAPE:${e.seq}`);
      if (st.artifacts[a.id]) throw tampered(`PREDEV_DUPLICATE:${e.seq}`);
      if (a.missionId !== seq.missionId || a.tenantId !== seq.tenantId) throw tampered(`PREDEV_ARTIFACT_MISSION_MISMATCH:${e.seq}`);
      // Artefakt yalnız kendi fazındayken kaydedilebilir (faz sırası zorlanır).
      if (seq.phase !== phaseForKind(a.kind)) throw tampered(`PREDEV_ARTIFACT_WRONG_PHASE:${e.seq}`);
      // authorRoleId yalnız bu tür için eşlenmiş rollerden biri olmalı (dürüst rol eşlemesi; katalog yükleme yok).
      if (!PRE_DEV_ROLE_MAP[a.kind].includes(a.authorRoleId)) throw tampered(`PREDEV_AUTHOR_ROLE_NOT_MAPPED:${e.seq}`);
      // Sürüm ve supersedes: ilk kayıt v1/null; yeni sürüm yalnız REJECTED bir önceki sürümü supersede eder.
      const prev = currentArtifact(st, seq, a.kind);
      if (a.supersedes === null) {
        if (a.version !== 1 || prev) throw tampered(`PREDEV_VERSION_INCONSISTENT:${e.seq}`);
      } else {
        if (!prev || prev.id !== a.supersedes || prev.state !== "REJECTED" || a.version !== prev.version + 1) throw tampered(`PREDEV_SUPERSEDE_INCONSISTENT:${e.seq}`);
      }
      // İçerik yalnız yapı + izlenebilirlik (APPROVED üst artefakta göre). Uydurma veri yok; üst eksikse doğrulama başarısızdır.
      const v = validateArtifactContent(a.kind, a.content, upstreamFor(st, seq, a.kind));
      if (!v.ok) throw tampered(`PREDEV_ARTIFACT_INVALID:${v.errors}:${e.seq}`);
      st.artifacts[a.id] = {...a, evidenceRefs: [...a.evidenceRefs], content: a.content, updatedAt: e.at};
      seq.artifacts[a.kind] = a.id; seq.updatedAt = e.at;
      return {idem: {tenantId: a.tenantId, kind: "predev.artifact", id: a.id}};
    }
    case "PREDEV_ARTIFACT_TRANSITIONED": {
      if (!isStr(p.artifactId) || !isStr(p.preDevId)) throw malformed(`PREDEV_REF:${e.seq}`);
      const art = st.artifacts[p.artifactId];
      const seq = st.sequences[p.preDevId];
      if (!art || !seq || art.tenantId !== p.tenantId || seq.artifacts[art.kind] !== art.id) throw tampered(`PREDEV_ARTIFACT_REF:${e.seq}`);
      const from = p.from as ArtifactState, to = p.to as ArtifactState;
      if (!isArtifactState(from) || !isArtifactState(to) || art.state !== from || !canArtifactTransition(from, to)) throw tampered(`PREDEV_ARTIFACT_TRANSITION_ILLEGAL:${e.seq}`);
      if (to === "APPROVED") {
        // Kanıta bağlı onay: evidenceRefs boş olamaz; onaylayan aktör kaydedenden bağımsız olmalı (kendi kendini onaylama yok).
        if (!isStrArr(p.evidenceRefs) || p.evidenceRefs.length === 0) throw tampered(`PREDEV_APPROVAL_EVIDENCE_REQUIRED:${e.seq}`);
        if (e.actor === art.recordedBy) throw tampered(`PREDEV_APPROVER_NOT_INDEPENDENT:${e.seq}`);
        art.evidenceRefs = [...p.evidenceRefs]; art.approvedBy = e.actor;
      } else if (to === "REJECTED") {
        if (!isStr(p.reason)) throw malformed(`PREDEV_REJECT_REASON:${e.seq}`);
        art.rejectedBy = e.actor;
      }
      art.state = to; art.updatedAt = e.at; seq.updatedAt = e.at;
      return {};
    }
    case "PREDEV_PHASE_ADVANCED": {
      if (!isStr(p.preDevId)) throw malformed(`PREDEV_REF:${e.seq}`);
      const seq = st.sequences[p.preDevId];
      if (!seq || seq.tenantId !== p.tenantId) throw tampered(`PREDEV_SEQUENCE_REF:${e.seq}`);
      const from = p.from as PreDevPhase, to = p.to as PreDevPhase;
      if (!isPreDevPhase(from) || !isPreDevPhase(to) || seq.phase !== from || !canPhaseTransition(from, to)) throw tampered(`PREDEV_PHASE_TRANSITION_ILLEGAL:${e.seq}`);
      // Gate: O ANKİ fazın artefaktı APPROVED olmadan ilerlenemez (AUTHORIZED giriş fazı artefakt istemez).
      const kind = PHASE_ARTIFACT_KIND[from];
      if (kind) {
        const art = currentArtifact(st, seq, kind);
        if (!art || art.state !== "APPROVED") throw tampered(`PREDEV_PHASE_ARTIFACT_NOT_APPROVED:${e.seq}`);
      }
      seq.phase = to; seq.updatedAt = e.at;
      if (!seq.lifecycleActors.includes(e.actor)) seq.lifecycleActors.push(e.actor);
      return {};
    }
    default: throw tampered(`UNKNOWN_TYPE:${e.seq}`);
  }
}
