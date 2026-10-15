// //TR: Bu dosya Skill Academy journal girdilerinin replay kurallarını uygular: her girdi şekil, tenant, allowlist geçiş, boş permissionDelta, bağımsız reviewer ve destekleyici kaynak bakımından yeniden doğrulanır; tutarsız veya sahte (ör. kendi kendini onaylayan) girdi journal'ı fail-closed yapar.
import {isObj, isStr, isTime, malformed, tampered} from "../company/common.js";
import {blockingSources, distinctIdentity, identityKey, isSha256, learnerIdentities, parseReviewerEvidenceRef, reviewerIsIndependent, sourceVisibleTo, supportProblem} from "./rules.js";
import {LEARNING_TRIGGERS, PROMOTED_STATUSES, SOURCE_TRUSTS, DRIFT_STATUSES, canTransition, isLearningStatus} from "./types.js";
import type {AcademyApplied, AcademyEntry, AcademyState, Curriculum, LabResult, LearningRecord, LearningStatus, Promotion, ReuseEvent, SourceRecord, SourceScreen} from "./types.js";

const isStrArr = (x: unknown, nonEmpty = false): x is string[] => Array.isArray(x) && x.every(isStr) && (!nonEmpty || x.length > 0);
const isStrOrNull = (x: unknown): x is string | null => x === null || isStr(x);
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const subset = (a: string[], b: string[]) => a.every(x => b.includes(x));

// Öğrenme kaydı görünürlüğü: aynı tenant veya açıkça global terfi etmiş ve hâlâ etkin kayıt.
export function learningVisibleTo(rec: LearningRecord, tenantId: string): boolean {
  return rec.tenantId === tenantId || (rec.promotion?.global === true && PROMOTED_STATUSES.includes(rec.status));
}

function validSource(s: unknown): s is SourceRecord {
  if (!isObj(s)) return false;
  const r = s as unknown as SourceRecord;
  return r.recordKind === "source" && isStr(r.sourceId) && isStr(r.tenantId) && isStrOrNull(r.url) && isStrOrNull(r.localRef) && (r.url !== null || r.localRef !== null)
    && (r.fetchedAt === null || isTime(r.fetchedAt)) && (r.publishedAt === null || isTime(r.publishedAt)) && isStrOrNull(r.version) && isStrOrNull(r.publisher)
    && SOURCE_TRUSTS.includes(r.sourceTrust) && isStrOrNull(r.license) && (r.sha256 === null || isSha256(r.sha256)) && isStrOrNull(r.repoCommit)
    && isObj(r.scope) && r.scope.tenantId === r.tenantId && isStrOrNull(r.scope.projectId) && isBool(r.scope.global)
    && (!r.scope.global || (r.url !== null && r.localRef === null))
    && Number.isSafeInteger(r.freshnessTTLDays) && r.freshnessTTLDays >= 1 && r.freshnessTTLDays <= 3650
    && isStrArr(r.contradictions) && r.status === "ACTIVE" && r.statusReason === null;
}
function validOpened(l: unknown): l is LearningRecord {
  if (!isObj(l)) return false;
  const r = l as unknown as LearningRecord;
  return r.recordKind === "learning" && isStr(r.learningId) && /^UASCO-\d{4}$/.test(r.roleId) && /^G\d{2}$/.test(r.guildId) && isStr(r.tenantId) && isStrOrNull(r.projectId)
    && LEARNING_TRIGGERS.includes(r.trigger) && isStr(r.hypothesis) && Array.isArray(r.sourceIds) && r.sourceIds.length === 0
    && Array.isArray(r.labRunRefs) && r.labRunRefs.length === 0 && Array.isArray(r.negativeEvalRefs) && r.negativeEvalRefs.length === 0
    && r.reviewerIdentity === null && r.reviewerRunRef === null && isStr(r.implementerIdentity) && isStr(r.createdBy)
    && Array.isArray(r.permissionDelta) && r.permissionDelta.length === 0 && isStrArr(r.dependsOn)
    && r.status === "GAP_DETECTED" && r.statusReason === null && r.screen === null && r.curriculum === null && r.labResult === null && r.promotion === null
    && Array.isArray(r.drift) && r.drift.length === 0 && isObj(r.timestamps) && isTime(r.timestamps.createdAt)
    && Array.isArray(r.lifecycleActors) && r.lifecycleActors.length === 1 && r.lifecycleActors[0] === r.createdBy;
}
function validScreen(s: unknown, rec: LearningRecord): s is SourceScreen {
  if (!isObj(s)) return false;
  const x = s as unknown as SourceScreen;
  if (!isTime(x.screenedAt) || !isStrArr(x.cleanSourceIds) || !isStrArr(x.flaggedSourceIds) || !isStrArr(x.unscreenedSourceIds) || !Array.isArray(x.injectionFindings) || !Array.isArray(x.conflicts)) return false;
  const all = [...x.cleanSourceIds, ...x.flaggedSourceIds, ...x.unscreenedSourceIds];
  return all.length === rec.sourceIds.length && new Set(all).size === all.length && subset(all, rec.sourceIds)
    && x.injectionFindings.every(f => isObj(f) && x.flaggedSourceIds.includes(f.sourceId as string) && isStrArr(f.codes, true))
    && x.conflicts.every(c => isObj(c) && rec.sourceIds.includes(c.sourceId as string) && isStrArr(c.contradictions, true));
}
const validCurriculum = (c: unknown): c is Curriculum => isObj(c) && isStrArr(c.prerequisites) && isStrArr(c.steps, true);
const validLab = (l: unknown): l is LabResult => isObj(l) && isBool(l.passed) && isStrArr(l.deterministicTestRefs) && isTime(l.recordedAt) && isStr(l.modelVersion)
  && isObj(l.toolAdapters) && Object.values(l.toolAdapters).every(isStr);

function owned(st: AcademyState, p: Record<string, unknown>, seq: number): LearningRecord {
  const rec = isStr(p.learningId) ? st.learnings[p.learningId] : undefined;
  if (!rec || rec.tenantId !== p.tenantId) throw tampered(`ACADEMY_REF:${seq}`);
  return rec;
}

// Terfi kuralları (yazma tarafında da aynen uygulanır); ihlal yalnız sabit kod döndürür.
export function promotionProblem(st: AcademyState, rec: LearningRecord, reviewerIdentity: unknown, reviewerRunRef: unknown, pr: Promotion, atMs: number, actor: string): string | null {
  if (rec.status !== "AWAITING_INDEPENDENT_REVIEW") return "NOT_AWAITING_INDEPENDENT_REVIEW";
  // WFR04A-C1-F1/F2: tüm öğrenen kimlikleri (implementer, açan, yaşam döngüsü aktörleri) kanonik anahtarla doğrulanabilir olmalıdır; terfi aktörü bunlardan biri olamaz.
  const learners = learnerIdentities(rec);
  if (learners.some(l => identityKey(l) === null)) return "LEARNER_IDENTITY_UNVERIFIABLE";
  if (identityKey(actor) === null) return "PROMOTER_IDENTITY_INVALID";
  if (!learners.every(l => distinctIdentity(actor, l))) return "PROMOTER_IS_IMPLEMENTER";
  if (!Array.isArray(rec.permissionDelta) || rec.permissionDelta.length !== 0) return "PERMISSION_DELTA_FORBIDDEN";
  if (!isStr(reviewerIdentity) || !reviewerIsIndependent(rec, reviewerIdentity)) return "REVIEWER_NOT_INDEPENDENT";
  if (!isStr(reviewerRunRef)) return "REVIEWER_RUN_REF_REQUIRED";
  const ev = parseReviewerEvidenceRef(pr.reviewerEvidence?.ref);
  if (!ev || ev.learningId !== rec.learningId || ev.sha256 !== pr.reviewerEvidence.sha256) return "REVIEWER_EVIDENCE_REF_INVALID";
  if (!rec.labResult?.passed || rec.labResult.deterministicTestRefs.length === 0 || rec.negativeEvalRefs.length === 0) return "LAB_EVIDENCE_INCOMPLETE";
  if (pr.executable !== false || pr.authorityEffect !== "NONE") return "AUTHORITY_EFFECT_FORBIDDEN";
  if (pr.knowledgeStatus !== (pr.kind === "KNOWLEDGE" ? "READONLY_KNOWLEDGE" : "SKILL_CANDIDATE_NOT_EXECUTABLE")) return "KNOWLEDGE_STATUS_INVALID";
  if (blockingSources(rec, st.sources).length > 0) return "SOURCE_REVOKED_OR_FLAGGED";
  if (!isStrArr(pr.supportingSourceIds, true) || !subset(pr.supportingSourceIds, rec.sourceIds)) return "NO_SUPPORTING_SOURCE";
  for (const id of pr.supportingSourceIds) { const s = st.sources[id]; if (!s || supportProblem(s, rec.screen, atMs) !== null) return "NO_SUPPORTING_SOURCE"; }
  for (const d of rec.dependsOn) { const dep = st.learnings[d]; if (!dep || !PROMOTED_STATUSES.includes(dep.status)) return "DEPENDENCY_NOT_PROMOTED"; }
  if (pr.global) {
    if (pr.anonymized !== true) return "GLOBAL_REQUIRES_ANONYMIZED";
    if (pr.supportingSourceIds.some(id => !st.sources[id]?.scope.global)) return "GLOBAL_REQUIRES_GLOBAL_SOURCES";
  } else if (pr.anonymized !== false && pr.anonymized !== true) return "ANONYMIZED_FLAG_INVALID";
  return null;
}

export function applyAcademyEntry(st: AcademyState, e: AcademyEntry): AcademyApplied {
  const p = e.payload;
  switch (e.type) {
    case "ACADEMY_SOURCE_REGISTERED": {
      const s = p.entity;
      if (!validSource(s)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      if (st.sources[s.sourceId]) throw tampered(`ACADEMY_DUPLICATE:${e.seq}`);
      st.sources[s.sourceId] = s;
      return {idem: {tenantId: s.tenantId, kind: "academy.source", id: s.sourceId}};
    }
    case "ACADEMY_SOURCE_REVOKED": {
      const s = isStr(p.sourceId) ? st.sources[p.sourceId] : undefined;
      if (!s || s.tenantId !== p.tenantId || s.status !== p.from || p.from !== "ACTIVE" || (p.to !== "REVOKED" && p.to !== "POISONED") || !isStr(p.reason)) throw tampered(`ACADEMY_SOURCE_REVOKE_INCONSISTENT:${e.seq}`);
      s.status = p.to; s.statusReason = p.reason; s.updatedAt = e.at;
      return {};
    }
    case "ACADEMY_LEARNING_OPENED": {
      const l = p.entity;
      if (!validOpened(l)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      if (st.learnings[l.learningId]) throw tampered(`ACADEMY_DUPLICATE:${e.seq}`);
      // WFR04A-C1-F2: kaydı açan, girdiyi yazan aktördür (createdBy serbestçe başka bir kimliğe bağlanamaz).
      if (l.createdBy !== e.actor) throw tampered(`ACADEMY_CREATOR_MISMATCH:${e.seq}`);
      for (const d of l.dependsOn) { const dep = st.learnings[d]; if (!dep || !learningVisibleTo(dep, l.tenantId) || !PROMOTED_STATUSES.includes(dep.status)) throw tampered(`ACADEMY_DEPENDENCY:${e.seq}`); }
      st.learnings[l.learningId] = l;
      return {idem: {tenantId: l.tenantId, kind: "academy.learning", id: l.learningId}};
    }
    case "ACADEMY_LEARNING_TRANSITIONED": {
      const rec = owned(st, p, e.seq);
      const to = p.to as LearningStatus;
      if (rec.status !== p.from || !isLearningStatus(to) || !canTransition(rec.status, to) || PROMOTED_STATUSES.includes(to) || DRIFT_STATUSES.includes(to)) throw tampered(`ACADEMY_TRANSITION_ILLEGAL:${e.seq}`);
      const patch = isObj(p.patch) ? p.patch : {};
      if (rec.permissionDelta.length !== 0) throw tampered(`ACADEMY_PERMISSION_DELTA:${e.seq}`);
      switch (to) {
        case "SOURCE_DISCOVERY": {
          if (!isStrArr(patch.sourceIds, true) || new Set(patch.sourceIds).size !== patch.sourceIds.length) throw malformed(`ACADEMY_PATCH:${e.seq}`);
          for (const id of patch.sourceIds) { const s = st.sources[id]; if (!s || !sourceVisibleTo(s, rec.tenantId, rec.projectId)) throw tampered(`ACADEMY_SOURCE_SCOPE:${e.seq}`); }
          rec.sourceIds = [...patch.sourceIds]; break;
        }
        case "SOURCE_SCREENED": { if (!validScreen(patch.screen, rec)) throw malformed(`ACADEMY_PATCH:${e.seq}`); rec.screen = patch.screen; break; }
        case "CURRICULUM_DRAFTED": { if (!validCurriculum(patch.curriculum)) throw malformed(`ACADEMY_PATCH:${e.seq}`); rec.curriculum = patch.curriculum; break; }
        case "LAB_EXPERIMENT_RUNNING": { if (!isStrArr(patch.labRunRefs, true)) throw malformed(`ACADEMY_PATCH:${e.seq}`); rec.labRunRefs = [...patch.labRunRefs]; break; }
        case "LAB_RESULT_RECORDED": {
          if (!validLab(patch.labResult) || !isStrArr(patch.negativeEvalRefs)) throw malformed(`ACADEMY_PATCH:${e.seq}`);
          rec.labResult = patch.labResult; rec.negativeEvalRefs = [...patch.negativeEvalRefs]; break;
        }
        case "AWAITING_INDEPENDENT_REVIEW": {
          if (!rec.labResult?.passed || rec.labResult.deterministicTestRefs.length === 0 || rec.negativeEvalRefs.length === 0) throw tampered(`ACADEMY_LAB_INCOMPLETE:${e.seq}`);
          break;
        }
        case "REJECTED": { if (!isStr(p.reason)) throw malformed(`ACADEMY_PATCH:${e.seq}`); rec.timestamps.closedAt = e.at; break; }
        default: break;
      }
      rec.status = to; rec.statusReason = isStr(p.reason) ? p.reason : null; rec.timestamps.updatedAt = e.at;
      // WFR04A-C1-F2: öğrenme işini yapan her aktör kayda bağlanır (yazma ve replay aynı yoldan geçer).
      if (!rec.lifecycleActors.includes(e.actor)) rec.lifecycleActors.push(e.actor);
      return {};
    }
    case "ACADEMY_LEARNING_PROMOTED": {
      const rec = owned(st, p, e.seq);
      const pr = p.promotion as Promotion;
      if (!isObj(pr) || (pr.kind !== "KNOWLEDGE" && pr.kind !== "SKILL_CANDIDATE") || !isBool(pr.global) || !isObj(pr.reviewerEvidence) || !isTime(pr.reviewerEvidence.verifiedAt)) throw malformed(`ACADEMY_PROMOTION_SHAPE:${e.seq}`);
      const to: LearningStatus = pr.kind === "KNOWLEDGE" ? "PROMOTED_KNOWLEDGE" : "PROMOTED_SKILL_CANDIDATE";
      if (p.from !== rec.status || p.to !== to) throw tampered(`ACADEMY_TRANSITION_ILLEGAL:${e.seq}`);
      const problem = promotionProblem(st, rec, p.reviewerIdentity, p.reviewerRunRef, pr, Date.parse(e.at), e.actor);
      if (problem) throw tampered(`ACADEMY_PROMOTION_INVALID:${problem}:${e.seq}`);
      rec.reviewerIdentity = p.reviewerIdentity as string; rec.reviewerRunRef = p.reviewerRunRef as string;
      rec.promotion = {...pr, promotedAt: e.at, promotedBy: e.actor};
      rec.status = to; rec.statusReason = null; rec.timestamps.updatedAt = e.at; rec.timestamps.promotedAt = e.at;
      return {};
    }
    case "ACADEMY_LEARNING_DRIFTED": {
      const rec = isStr(p.learningId) ? st.learnings[p.learningId] : undefined;
      const to = p.to as LearningStatus;
      if (!rec || rec.status !== p.from || !DRIFT_STATUSES.includes(to) || !canTransition(rec.status, to) || !isStrArr(p.reasons, true) || !isStrOrNull(p.causeLearningId ?? null)) throw tampered(`ACADEMY_DRIFT_INCONSISTENT:${e.seq}`);
      rec.drift.push({to, reasons: [...p.reasons], at: e.at, causeLearningId: (p.causeLearningId as string | null | undefined) ?? null});
      rec.status = to; rec.statusReason = p.reasons.join(";").slice(0, 1000); rec.timestamps.updatedAt = e.at; rec.timestamps.driftedAt = e.at;
      if (to === "REVOKED") rec.timestamps.closedAt = e.at;
      return {};
    }
    case "ACADEMY_REUSE_RECORDED": {
      const r = p.entity as ReuseEvent;
      if (!isObj(r) || r.recordKind !== "reuse" || !isStr(r.reuseId) || !isStr(r.tenantId) || !isStr(r.learningId) || (r.outcome !== "SUCCESS" && r.outcome !== "FAILURE") || !isStr(r.missionRef) || !isStr(r.evidenceRef)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      const rec = st.learnings[r.learningId];
      if (!rec || !learningVisibleTo(rec, r.tenantId) || !PROMOTED_STATUSES.includes(rec.status) || st.reuses[r.reuseId]) throw tampered(`ACADEMY_REUSE_INCONSISTENT:${e.seq}`);
      st.reuses[r.reuseId] = r;
      return {idem: {tenantId: r.tenantId, kind: "academy.reuse", id: r.reuseId}};
    }
    default: throw tampered(`UNKNOWN_TYPE:${e.seq}`);
  }
}
