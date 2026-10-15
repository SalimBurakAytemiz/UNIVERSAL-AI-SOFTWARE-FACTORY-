// //TR: Bu dosya Skill Academy çekirdek domainini sahiplenir: kaynak kaydı ve iptali, GAP_DETECTED'dan bağımsız reviewer terfisine kadar allowlist yaşam döngüsü, drift uygulaması, yeniden kullanım olayları ve tenant kapsamlı okumalar; kayıtlar ortak Work OS journal'ında yaşar, rol kaydı (registries/role-definitions.json) yalnız okunur ve öğrenme hiçbir zaman yetki, sertifika veya proficiency vermez.
import fs from "node:fs";
import path from "node:path";
import type {Scope} from "../workos/types.js";
import {urlHasUserinfo} from "../workos/types.js";
import type {WriteResult, WorkOsStore} from "../workos/store.js";
import {badTransition, clone, compileSchema, digestOf, idSchema, invalid, isObj, keySchema, noSecrets, notFound, reasonSchema} from "../company/common.js";
import {learningVisibleTo, promotionProblem} from "./apply.js";
import {computeDrift} from "./drift.js";
import type {DriftDecision, DriftEnvironment} from "./drift.js";
import {verifyReviewerEvidence} from "./evidence.js";
import {computeMetrics} from "./metrics.js";
import type {AcademyMetrics} from "./metrics.js";
import {identityKey, parseReviewerEvidenceRef, screenSourceText, sha256Text, sourceVisibleTo, supportProblem} from "./rules.js";
import {PROMOTED_STATUSES, canTransition} from "./types.js";
import type {AcademyTx, AcademyView, Curriculum, LabResult, LearningRecord, LearningStatus, LearningTrigger, Promotion, PromotionKind, ReuseEvent, ReuseOutcome, SourceRecord, SourceScreen, SourceTrust} from "./types.js";

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const refSchema = {type: "string", minLength: 1, maxLength: 300, pattern: "^[A-Za-z0-9._:/#=@+-]+$"} as const;
const textSchema = {type: "string", minLength: 1, maxLength: 2000, pattern: "\\S"} as const;
const shortText = {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"} as const;
const nullable = (s: object) => ({anyOf: [s, {type: "null"}]});
const timeSchema = {type: "string", format: "date-time"} as const;
// WFR04A-C1-F1: kimlik alanları yalnız yazdırılabilir ASCII kabul eder (Unicode tire, sıfır genişlikli karakter, homoglif/karışık betik reddedilir) ve en az bir harf/rakam içerir.
const identitySchema = {type: "string", minLength: 1, maxLength: 200, pattern: "^[\\x20-\\x7E]*[A-Za-z0-9][\\x20-\\x7E]*$"} as const;
const assertActor = (actor: string) => { if (identityKey(actor) === null) throw invalid("ACTOR_IDENTITY_INVALID"); };

export const sourceInputSchema = {
  type: "object", additionalProperties: false, required: ["sourceTrust", "freshnessTTLDays"],
  properties: {
    url: nullable({type: "string", minLength: 1, maxLength: 2000, pattern: "^https?://"}),
    localRef: nullable({type: "string", minLength: 1, maxLength: 500, pattern: "^[A-Za-z0-9._@+-][A-Za-z0-9._@+/-]*$"}),
    fetchedAt: nullable(timeSchema), publishedAt: nullable(timeSchema), version: nullable(shortText), publisher: nullable(shortText),
    sourceTrust: {enum: ["OFFICIAL", "STANDARD", "VENDOR_DOC", "ACADEMIC", "COMMUNITY_LOWER_TRUST", "UNTRUSTED"]},
    license: nullable(shortText), sha256: nullable({type: "string", pattern: "^[0-9a-f]{64}$"}), repoCommit: nullable({type: "string", pattern: "^[0-9a-f]{40}$"}),
    projectId: nullable(idSchema("prj")), global: {type: "boolean"},
    freshnessTTLDays: {type: "integer", minimum: 1, maximum: 3650},
    contradictions: {type: "array", maxItems: 50, items: textSchema},
    idempotencyKey: keySchema
  }
} as const;
export const openGapSchema = {
  type: "object", additionalProperties: false, required: ["roleId", "guildId", "trigger", "hypothesis", "implementerIdentity"],
  properties: {
    roleId: {type: "string", pattern: "^UASCO-\\d{4}$"}, guildId: {type: "string", pattern: "^G\\d{2}$"}, projectId: nullable(idSchema("prj")),
    trigger: {enum: ["REAL_MISSION", "CAPABILITY_GAP", "RELEASE_DRIFT", "FAILED_EVAL"]}, hypothesis: textSchema, implementerIdentity: identitySchema,
    dependsOn: {type: "array", maxItems: 50, uniqueItems: true, items: idSchema("lrn")},
    // Öğrenme yetki vermez: yalnız boş dizi kabul edilir (boş olmayan değer daha önce açık hata ile reddedilir).
    permissionDelta: {type: "array", maxItems: 0},
    idempotencyKey: keySchema
  }
} as const;
const curriculumSchema = {type: "object", additionalProperties: false, required: ["steps"], properties: {prerequisites: {type: "array", maxItems: 50, items: textSchema}, steps: {type: "array", minItems: 1, maxItems: 50, items: textSchema}}} as const;
const labResultSchema = {
  type: "object", additionalProperties: false, required: ["passed", "deterministicTestRefs", "negativeEvalRefs", "modelVersion", "toolAdapters"],
  properties: {
    passed: {type: "boolean"}, deterministicTestRefs: {type: "array", maxItems: 50, items: refSchema}, negativeEvalRefs: {type: "array", maxItems: 50, items: refSchema},
    modelVersion: shortText, toolAdapters: {type: "object", maxProperties: 50, propertyNames: {pattern: "^[A-Za-z0-9._:-]{1,100}$"}, additionalProperties: shortText}
  }
} as const;
export const promoteSchema = {
  type: "object", additionalProperties: false, required: ["kind", "reviewerIdentity", "reviewerRunRef", "reviewerEvidenceRef"],
  properties: {
    kind: {enum: ["KNOWLEDGE", "SKILL_CANDIDATE"]}, reviewerIdentity: identitySchema, reviewerRunRef: refSchema, reviewerEvidenceRef: {type: "string", minLength: 1, maxLength: 300},
    supportingSourceIds: {type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: idSchema("src")}, global: {type: "boolean"}, anonymized: {type: "boolean"}
  }
} as const;
const reuseSchema = {type: "object", additionalProperties: false, required: ["outcome", "missionRef", "evidenceRef"], properties: {outcome: {enum: ["SUCCESS", "FAILURE"]}, missionRef: refSchema, evidenceRef: refSchema, idempotencyKey: keySchema}} as const;
const validateSource = compileSchema(sourceInputSchema), validateOpen = compileSchema(openGapSchema), validateCurriculum = compileSchema(curriculumSchema);
const validateLab = compileSchema(labResultSchema), validatePromote = compileSchema(promoteSchema), validateReuse = compileSchema(reuseSchema);
const validateRefs = compileSchema({type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: refSchema});
const validateSourceIds = compileSchema({type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: idSchema("src")});
const validateReason = compileSchema(reasonSchema);
const check = (v: {ok: true} | {ok: false; errors: string}, label: string) => { if (!v.ok) throw invalid(label); };

export interface SourceInput {
  url?: string | null; localRef?: string | null; fetchedAt?: string | null; publishedAt?: string | null; version?: string | null; publisher?: string | null;
  sourceTrust: SourceTrust; license?: string | null; sha256?: string | null; repoCommit?: string | null; projectId?: string | null; global?: boolean;
  freshnessTTLDays: number; contradictions?: string[]; idempotencyKey?: string;
}
export interface OpenGapInput {
  roleId: string; guildId: string; projectId?: string | null; trigger: LearningTrigger; hypothesis: string; implementerIdentity: string;
  dependsOn?: string[]; permissionDelta?: unknown; idempotencyKey?: string;
}
export interface LabResultInput { passed: boolean; deterministicTestRefs: string[]; negativeEvalRefs: string[]; modelVersion: string; toolAdapters: Record<string, string> }
export interface PromoteInput { kind: PromotionKind; reviewerIdentity: string; reviewerRunRef: string; reviewerEvidenceRef: string; supportingSourceIds?: string[]; global?: boolean; anonymized?: boolean }
export interface ReuseInput { outcome: ReuseOutcome; missionRef: string; evidenceRef: string; idempotencyKey?: string }
// Diğer tenant'lara görünen global bilgi yalnız genelleştirilmiş izdüşümdür: köken tenant/proje, kaynak ve lab referansları sızmaz.
// WFR04A-C1-F4: sahibi olmayan tenant'a global kaynak yalnız bu izdüşümle görünür: köken tenant, oluşturan aktör, durum gerekçesi ve serbest metin çelişkiler sızmaz.
export interface GlobalSourceView {
  recordKind: "globalSource"; sourceId: string; url: string | null; fetchedAt: string | null; publishedAt: string | null; version: string | null; publisher: string | null;
  sourceTrust: SourceTrust; license: string | null; sha256: string | null; freshnessTTLDays: number; global: true; status: SourceRecord["status"]; contradictionCount: number;
}
export const projectGlobalSource = (s: SourceRecord): GlobalSourceView => ({
  recordKind: "globalSource", sourceId: s.sourceId, url: s.url, fetchedAt: s.fetchedAt, publishedAt: s.publishedAt, version: s.version, publisher: s.publisher,
  sourceTrust: s.sourceTrust, license: s.license, sha256: s.sha256, freshnessTTLDays: s.freshnessTTLDays, global: true, status: s.status, contradictionCount: s.contradictions.length
});
export interface GlobalKnowledgeView { learningId: string; roleId: string; guildId: string; hypothesis: string; status: LearningStatus; knowledgeStatus: Promotion["knowledgeStatus"]; promotedAt: string }
export interface SkillAcademyOptions { repoRoot: string; registryFile?: string }

// permissionDelta: undefined/null/boş dizi/boş nesne dışındaki her değer yetki talebidir ve reddedilir.
export function isEmptyPermissionDelta(x: unknown): boolean {
  if (x === undefined || x === null) return true;
  if (Array.isArray(x)) return x.length === 0;
  if (isObj(x)) return Object.keys(x).length === 0;
  return false;
}

export class SkillAcademy {
  private readonly repoRoot: string; private readonly registryFile: string;
  private roleIndex: Map<string, string> | null = null;
  constructor(private readonly store: WorkOsStore, options: SkillAcademyOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.registryFile = path.resolve(options.registryFile ?? path.join(this.repoRoot, "registries", "role-definitions.json"));
  }

  // Tek kanonik rol kaydı yalnız okunur (asla yazılmaz); roleId -> guildId eşlemesi.
  private roles(): Map<string, string> {
    if (this.roleIndex) return this.roleIndex;
    let reg: unknown;
    try { reg = JSON.parse(fs.readFileSync(this.registryFile, "utf8")); } catch { throw invalid("ROLE_REGISTRY_UNREADABLE"); }
    const roles = isObj(reg) && Array.isArray(reg.roles) ? reg.roles : null;
    if (!roles) throw invalid("ROLE_REGISTRY_SHAPE");
    const m = new Map<string, string>();
    for (const r of roles) if (isObj(r) && typeof r.roleId === "string" && typeof r.guildId === "string") m.set(r.roleId, r.guildId);
    this.roleIndex = m;
    return m;
  }
  private owned(tx: AcademyTx, scope: Scope, id: string): LearningRecord {
    const rec = tx.learnings[id];
    if (!rec || rec.tenantId !== scope.tenantId) throw notFound("learning");
    return rec;
  }
  private move(scope: Scope, id: string, to: LearningStatus, actor: string, patch: Record<string, unknown>, reason?: string, pre?: (rec: LearningRecord, tx: AcademyTx) => Record<string, unknown> | void): LearningRecord {
    assertActor(actor);
    return this.store.academyWrite(tx => {
      const rec = this.owned(tx, scope, id);
      if (!canTransition(rec.status, to)) throw badTransition(`LEARNING_${rec.status}_TO_${to}`);
      const computed = pre?.(rec, tx) ?? {};
      tx.append("ACADEMY_LEARNING_TRANSITIONED", actor, {learningId: id, tenantId: scope.tenantId, from: rec.status, to, ...(reason ? {reason: reason.slice(0, 1000)} : {}), patch: {...patch, ...computed}});
      return clone(tx.learnings[id]);
    });
  }

  registerSource(scope: Scope, input: SourceInput, actor: string): WriteResult<SourceRecord> {
    check(validateSource(input), "source");
    noSecrets(input.url ?? undefined, input.localRef ?? undefined, input.publisher ?? undefined, input.version ?? undefined, input.license ?? undefined, ...(input.contradictions ?? []));
    const url = input.url ?? null, localRef = input.localRef ?? null, global = input.global === true, projectId = input.projectId ?? null;
    if (url === null && localRef === null) throw invalid("SOURCE_LOCATION_REQUIRED");
    if (url !== null && urlHasUserinfo(url)) throw invalid("url userinfo");
    if (global && (url === null || localRef !== null || projectId !== null)) throw invalid("GLOBAL_SOURCE_MUST_BE_PUBLIC_URL");
    if (projectId !== null && !this.store.getProject(scope, projectId)) throw notFound("project");
    return this.store.academyWrite(tx => {
      const body = {url, localRef, fetchedAt: input.fetchedAt ?? null, publishedAt: input.publishedAt ?? null, version: input.version ?? null, publisher: input.publisher ?? null,
        sourceTrust: input.sourceTrust, license: input.license ?? null, sha256: input.sha256 ?? null, repoCommit: input.repoCommit ?? null,
        scope: {tenantId: scope.tenantId, projectId, global}, freshnessTTLDays: input.freshnessTTLDays, contradictions: [...(input.contradictions ?? [])]};
      const digest = digestOf(body);
      const prior = tx.idem(tx.sources, "academy.source", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior), replayed: true};
      const at = tx.now();
      const src: SourceRecord = {recordKind: "source", sourceId: tx.newId("src"), tenantId: scope.tenantId, ...body, status: "ACTIVE", statusReason: null, createdAt: at, createdBy: actor, updatedAt: at};
      tx.append("ACADEMY_SOURCE_REGISTERED", actor, {entity: src, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: clone(src), replayed: false};
    });
  }
  // Kaynak iptali/zehirlenmesi yalnız sahibi tenant tarafından yazılır; etkisi drift uygulamasıyla bağımlı öğrenmelere yayılır.
  // WFR04A-C1-F4 (belgelenmiş çapraz-tenant etki): global bir kaynağın sahibi onu iptal/zehirli işaretlerse, o kaynağa atıf yapan BAŞKA tenant'ların
  // terfi etmiş öğrenmeleri de applyDrift ile REVOKED olur. Bu bilinçli fail-closed davranıştır: iptal yalnız desteği kaldırır, hiçbir tenant'a
  // yetki/durum/veri vermez ve diğer tenant'ın kayıt içeriğini açığa çıkarmaz; yanlış iptal yalnız yeniden öğrenme (yeni kaynak) gerektirir.
  revokeSource(scope: Scope, sourceId: string, to: "REVOKED" | "POISONED", reason: string, actor: string): SourceRecord {
    check(validateReason(reason), "reason"); noSecrets(reason);
    if (to !== "REVOKED" && to !== "POISONED") throw invalid("status");
    return this.store.academyWrite(tx => {
      const s = tx.sources[sourceId];
      if (!s || s.tenantId !== scope.tenantId) throw notFound("source");
      if (s.status !== "ACTIVE") throw badTransition(`SOURCE_${s.status}_TO_${to}`);
      tx.append("ACADEMY_SOURCE_REVOKED", actor, {sourceId, tenantId: scope.tenantId, from: s.status, to, reason: reason.slice(0, 1000)});
      return clone(tx.sources[sourceId]);
    });
  }

  openGap(scope: Scope, input: OpenGapInput, actor: string): WriteResult<LearningRecord> {
    // Öğrenme otomatik, yetki asla: izin değişikliği talebi şema kontrolünden önce açık kodla reddedilir.
    if (isObj(input) && !isEmptyPermissionDelta((input as unknown as Record<string, unknown>).permissionDelta)) throw invalid("PERMISSION_DELTA_FORBIDDEN");
    const normalized = {...input, ...(input.permissionDelta !== undefined ? {permissionDelta: []} : {})};
    check(validateOpen(normalized), "learning");
    noSecrets(input.hypothesis, input.implementerIdentity);
    assertActor(actor);
    const guild = this.roles().get(input.roleId);
    if (guild === undefined) throw notFound("role");
    if (guild !== input.guildId) throw invalid("ROLE_GUILD_MISMATCH");
    const projectId = input.projectId ?? null;
    if (projectId !== null && !this.store.getProject(scope, projectId)) throw notFound("project");
    return this.store.academyWrite(tx => {
      const dependsOn = [...(input.dependsOn ?? [])];
      const digest = digestOf({roleId: input.roleId, guildId: input.guildId, projectId, trigger: input.trigger, hypothesis: input.hypothesis, implementerIdentity: input.implementerIdentity, dependsOn});
      const prior = tx.idem(tx.learnings, "academy.learning", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior), replayed: true};
      for (const d of dependsOn) { const dep = tx.learnings[d]; if (!dep || !learningVisibleTo(dep, scope.tenantId)) throw notFound("dependency"); if (!PROMOTED_STATUSES.includes(dep.status)) throw invalid("DEPENDENCY_NOT_PROMOTED"); }
      const at = tx.now();
      const rec: LearningRecord = {
        recordKind: "learning", learningId: tx.newId("lrn"), roleId: input.roleId, guildId: input.guildId, tenantId: scope.tenantId, projectId,
        trigger: input.trigger, hypothesis: input.hypothesis, sourceIds: [], labRunRefs: [], negativeEvalRefs: [], reviewerIdentity: null, reviewerRunRef: null,
        implementerIdentity: input.implementerIdentity, permissionDelta: [], dependsOn, status: "GAP_DETECTED", statusReason: null,
        screen: null, curriculum: null, labResult: null, promotion: null, drift: [],
        timestamps: {createdAt: at, updatedAt: at, promotedAt: null, driftedAt: null, closedAt: null}, createdBy: actor, lifecycleActors: [actor]
      };
      tx.append("ACADEMY_LEARNING_OPENED", actor, {entity: rec, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: clone(rec), replayed: false};
    });
  }
  attachSources(scope: Scope, learningId: string, sourceIds: string[], actor: string): LearningRecord {
    check(validateSourceIds(sourceIds), "sourceIds");
    return this.move(scope, learningId, "SOURCE_DISCOVERY", actor, {sourceIds: [...sourceIds]}, undefined, (rec, tx) => {
      for (const id of sourceIds) { const s = tx.sources[id]; if (!s || !sourceVisibleTo(s, scope.tenantId, rec.projectId)) throw notFound("source"); }
    });
  }
  // Çatışma + enjeksiyon taraması: içerik yalnız VERİ olarak taranır ve sabitlenmiş sha256 ile bağlanır; içerik journal'a yazılmaz ve hiçbir alanı değiştiremez.
  screenSources(scope: Scope, learningId: string, contents: Readonly<Record<string, string>>, actor: string): LearningRecord {
    if (!isObj(contents) || Object.values(contents).some(c => typeof c !== "string" || Buffer.byteLength(c, "utf8") > MAX_CONTENT_BYTES)) throw invalid("contents");
    return this.move(scope, learningId, "SOURCE_SCREENED", actor, {}, undefined, (rec, tx) => {
      if (Object.keys(contents).some(k => !rec.sourceIds.includes(k))) throw invalid("CONTENT_FOR_UNKNOWN_SOURCE");
      const screen: SourceScreen = {screenedAt: tx.now(), cleanSourceIds: [], flaggedSourceIds: [], unscreenedSourceIds: [], injectionFindings: [], conflicts: []};
      for (const id of rec.sourceIds) {
        const s = tx.sources[id];
        // WFR04A-C1-F4: başka tenant'ın global kaynağındaki serbest metin çelişkiler bu tenant'ın kaydına kopyalanmaz; yalnız sayılı bir işaret yazılır.
        if (s && s.contradictions.length > 0) screen.conflicts.push({sourceId: id, contradictions: s.tenantId === rec.tenantId ? [...s.contradictions] : [`REDACTED_CROSS_TENANT_CONTRADICTIONS:${s.contradictions.length}`]});
        const text = Object.prototype.hasOwnProperty.call(contents, id) ? contents[id] : undefined;
        if (!s || text === undefined || s.sha256 === null) { screen.unscreenedSourceIds.push(id); continue; }
        const codes = sha256Text(text) !== s.sha256 ? ["CONTENT_HASH_MISMATCH" as const] : screenSourceText(text);
        if (codes.length > 0) { screen.flaggedSourceIds.push(id); screen.injectionFindings.push({sourceId: id, codes}); } else screen.cleanSourceIds.push(id);
      }
      return {screen};
    });
  }
  draftCurriculum(scope: Scope, learningId: string, curriculum: Curriculum, actor: string): LearningRecord {
    check(validateCurriculum(curriculum), "curriculum");
    noSecrets(...(curriculum.prerequisites ?? []), ...curriculum.steps);
    return this.move(scope, learningId, "CURRICULUM_DRAFTED", actor, {curriculum: {prerequisites: [...(curriculum.prerequisites ?? [])], steps: [...curriculum.steps]}});
  }
  // Aday önerisi yeni izin içermez: permissionDelta boş kalır.
  proposeCandidate(scope: Scope, learningId: string, actor: string): LearningRecord {
    return this.move(scope, learningId, "CANDIDATE_PROPOSED", actor, {}, undefined, rec => { if (rec.permissionDelta.length !== 0) throw invalid("PERMISSION_DELTA_FORBIDDEN"); });
  }
  startLab(scope: Scope, learningId: string, labRunRefs: string[], actor: string): LearningRecord {
    check(validateRefs(labRunRefs), "labRunRefs");
    return this.move(scope, learningId, "LAB_EXPERIMENT_RUNNING", actor, {labRunRefs: [...labRunRefs]});
  }
  recordLabResult(scope: Scope, learningId: string, input: LabResultInput, actor: string): LearningRecord {
    check(validateLab(input), "labResult");
    return this.move(scope, learningId, "LAB_RESULT_RECORDED", actor, {}, undefined, (_rec, tx) => {
      const labResult: LabResult = {passed: input.passed, deterministicTestRefs: [...input.deterministicTestRefs], recordedAt: tx.now(), modelVersion: input.modelVersion, toolAdapters: {...input.toolAdapters}};
      return {labResult, negativeEvalRefs: [...input.negativeEvalRefs]};
    });
  }
  // Bağımsız inceleme yalnız geçmiş deterministik test + negatif değerlendirme kanıtıyla istenebilir.
  requestReview(scope: Scope, learningId: string, actor: string): LearningRecord {
    return this.move(scope, learningId, "AWAITING_INDEPENDENT_REVIEW", actor, {}, undefined, rec => {
      if (!rec.labResult?.passed) throw invalid("LAB_NOT_PASSED");
      if (rec.labResult.deterministicTestRefs.length === 0) throw invalid("DETERMINISTIC_TEST_REFS_REQUIRED");
      if (rec.negativeEvalRefs.length === 0) throw invalid("NEGATIVE_EVAL_REFS_REQUIRED");
    });
  }
  reject(scope: Scope, learningId: string, reason: string, actor: string): LearningRecord {
    check(validateReason(reason), "reason"); noSecrets(reason);
    return this.move(scope, learningId, "REJECTED", actor, {}, reason);
  }

  // Terfi yalnız bu açık çağrıyla: farklı ve bağımsız reviewer kimliği + yeniden doğrulanan sabitlenmiş reviewer kanıtı. Model metni (hipotez, gerekçe, kaynak içeriği) hiçbir etki yapmaz.
  promote(scope: Scope, learningId: string, input: PromoteInput, actor: string): LearningRecord {
    check(validatePromote(input), "promotion");
    noSecrets(input.reviewerIdentity);
    const global = input.global === true, anonymized = input.anonymized === true;
    if (global && !anonymized) throw invalid("GLOBAL_REQUIRES_ANONYMIZED");
    return this.store.academyWrite(tx => {
      const rec = this.owned(tx, scope, learningId);
      if (rec.status !== "AWAITING_INDEPENDENT_REVIEW") throw badTransition(`LEARNING_${rec.status}_TO_PROMOTED`);
      const at = tx.now(), atMs = Date.parse(at);
      const supportingSourceIds = input.supportingSourceIds ? [...input.supportingSourceIds]
        : rec.sourceIds.filter(id => { const s = tx.sources[id]; return !!s && supportProblem(s, rec.screen, atMs) === null; });
      const ev = verifyReviewerEvidence(this.repoRoot, input.reviewerEvidenceRef, rec, {reviewerIdentity: input.reviewerIdentity, kind: input.kind, global});
      const pinned = parseReviewerEvidenceRef(input.reviewerEvidenceRef);
      const promotion: Promotion = {
        kind: input.kind, knowledgeStatus: input.kind === "KNOWLEDGE" ? "READONLY_KNOWLEDGE" : "SKILL_CANDIDATE_NOT_EXECUTABLE", executable: false, authorityEffect: "NONE",
        global, anonymized, reviewerEvidence: {ref: pinned ? `${pinned.relPath}#sha256=${pinned.sha256}` : "", sha256: pinned?.sha256 ?? "", verifiedAt: at},
        supportingSourceIds, promotedAt: at, promotedBy: actor
      };
      const problem = promotionProblem({sources: tx.sources, learnings: tx.learnings, reuses: tx.reuses}, rec, input.reviewerIdentity, input.reviewerRunRef, promotion, atMs, actor);
      if (problem) throw invalid(problem);
      if (!ev.ok) throw invalid(`REVIEWER_EVIDENCE_${ev.problem}`);
      const to: LearningStatus = input.kind === "KNOWLEDGE" ? "PROMOTED_KNOWLEDGE" : "PROMOTED_SKILL_CANDIDATE";
      // WFR04A-C1-F3: yazma tarafı kontrolünde kullanılan aynı zaman (at) ön-denemede ve kalıcı girdide kullanılır.
      tx.append("ACADEMY_LEARNING_PROMOTED", actor, {learningId, tenantId: scope.tenantId, from: rec.status, to, reviewerIdentity: input.reviewerIdentity, reviewerRunRef: input.reviewerRunRef, promotion}, at);
      return clone(tx.learnings[learningId]);
    });
  }

  recordReuse(scope: Scope, learningId: string, input: ReuseInput, actor: string): WriteResult<ReuseEvent> {
    check(validateReuse(input), "reuse");
    return this.store.academyWrite(tx => {
      const digest = digestOf({learningId, outcome: input.outcome, missionRef: input.missionRef, evidenceRef: input.evidenceRef});
      const prior = tx.idem(tx.reuses, "academy.reuse", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior), replayed: true};
      const rec = tx.learnings[learningId];
      if (!rec || !learningVisibleTo(rec, scope.tenantId)) throw notFound("learning");
      if (!PROMOTED_STATUSES.includes(rec.status)) throw invalid("LEARNING_NOT_PROMOTED");
      const ev: ReuseEvent = {recordKind: "reuse", reuseId: tx.newId("reu"), tenantId: scope.tenantId, learningId, outcome: input.outcome, missionRef: input.missionRef, evidenceRef: input.evidenceRef, at: tx.now(), actor};
      tx.append("ACADEMY_REUSE_RECORDED", actor, {entity: ev, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: clone(ev), replayed: false};
    });
  }

  // Engine (sistem aktörü) drift uygulaması: reviewer kanıtları lock altında yeniden doğrulanır, saf monitör kararları tek tek journal'a yazılır.
  applyDrift(env: Omit<DriftEnvironment, "invalidEvidenceLearningIds">, actor: string): DriftDecision[] {
    return this.store.academyWrite(tx => {
      const invalidEvidence: string[] = [];
      for (const rec of Object.values(tx.learnings)) {
        if (!rec.promotion || !["PROMOTED_KNOWLEDGE", "PROMOTED_SKILL_CANDIDATE", "STALE", "RECERTIFY_REQUIRED"].includes(rec.status)) continue;
        const ev = verifyReviewerEvidence(this.repoRoot, rec.promotion.reviewerEvidence.ref, rec, {reviewerIdentity: rec.reviewerIdentity ?? "", kind: rec.promotion.kind, global: rec.promotion.global});
        if (!ev.ok || ev.sha256 !== rec.promotion.reviewerEvidence.sha256) invalidEvidence.push(rec.learningId);
      }
      const decisions = computeDrift({learnings: tx.learnings, sources: tx.sources}, {...env, invalidEvidenceLearningIds: invalidEvidence});
      for (const d of decisions) tx.append("ACADEMY_LEARNING_DRIFTED", actor, {learningId: d.learningId, from: d.from, to: d.to, reasons: d.reasons, causeLearningId: d.causeLearningId});
      return decisions;
    });
  }

  // ---- Okumalar: tenant kapsamlı; başka tenant'ın kaydı "yok" görünür ----
  // WFR04A-C1-F4: sahibi tenant tam kaydı görür; diğer tenant'lar global kaynağı yalnız GlobalSourceView izdüşümüyle görür.
  getSource(scope: Scope, id: string): SourceRecord | GlobalSourceView | undefined {
    return this.store.academyRead(v => { const s = v.sources[id]; if (!s) return undefined; if (s.tenantId === scope.tenantId) return clone(s); return s.scope.global ? projectGlobalSource(s) : undefined; });
  }
  listSources(scope: Scope): Array<SourceRecord | GlobalSourceView> {
    return this.store.academyRead(v => Object.values(v.sources).filter(s => s.tenantId === scope.tenantId || s.scope.global).map(s => s.tenantId === scope.tenantId ? clone(s) : projectGlobalSource(s)));
  }
  getLearning(scope: Scope, id: string): LearningRecord | undefined { return this.store.academyRead(v => { const r = v.learnings[id]; return r && r.tenantId === scope.tenantId ? clone(r) : undefined; }); }
  listLearnings(scope: Scope): LearningRecord[] { return this.store.academyRead(v => Object.values(v.learnings).filter(r => r.tenantId === scope.tenantId).map(clone)); }
  listReuses(scope: Scope): ReuseEvent[] { return this.store.academyRead(v => Object.values(v.reuses).filter(r => r.tenantId === scope.tenantId).map(clone)); }
  listGlobalKnowledge(): GlobalKnowledgeView[] {
    return this.store.academyRead(v => Object.values(v.learnings).filter(r => r.promotion?.global === true && PROMOTED_STATUSES.includes(r.status)).map(r => ({
      learningId: r.learningId, roleId: r.roleId, guildId: r.guildId, hypothesis: r.hypothesis, status: r.status,
      knowledgeStatus: (r.promotion as Promotion).knowledgeStatus, promotedAt: (r.promotion as Promotion).promotedAt
    })));
  }
  // §5.3 metrikleri yalnız bu tenant'ın kendi kayıtlarından hesaplanır.
  metrics(scope: Scope): AcademyMetrics {
    return this.store.academyRead((v: AcademyView) => computeMetrics({
      learnings: Object.values(v.learnings).filter(r => r.tenantId === scope.tenantId),
      sources: Object.values(v.sources).filter(s => s.tenantId === scope.tenantId),
      reuses: Object.values(v.reuses).filter(r => r.tenantId === scope.tenantId)
    }));
  }
}
