// //TR: Bu dosya Skill Academy çekirdeğinin (WFR-04a) tip sözleşmesini tanımlar: kaynak kaydı, öğrenme kaydı, yaşam döngüsü durumları ve journal girdi türleri; ayrı store yoktur, kayıtlar Work OS hash zincirli journal içinde yaşar ve öğrenme hiçbir zaman yetki vermez.

// NEW_INFORMATION != TRUSTED_KNOWLEDGE != AUTHORITY_GRANT: kaynak güveni yalnız bilgi ağırlığıdır, izin değildir.
export type SourceTrust = "OFFICIAL" | "STANDARD" | "VENDOR_DOC" | "ACADEMIC" | "COMMUNITY_LOWER_TRUST" | "UNTRUSTED";
export const SOURCE_TRUSTS: readonly SourceTrust[] = ["OFFICIAL", "STANDARD", "VENDOR_DOC", "ACADEMIC", "COMMUNITY_LOWER_TRUST", "UNTRUSTED"];
export type SourceStatus = "ACTIVE" | "REVOKED" | "POISONED";
export interface SourceScope { tenantId: string; projectId: string | null; global: boolean }
// Kaynak içeriği VERİDİR (talimat değildir); journal'a içerik yazılmaz, yalnız sha256 ile bağlanır.
export interface SourceRecord {
  recordKind: "source"; sourceId: string; tenantId: string;
  url: string | null; localRef: string | null; fetchedAt: string | null; publishedAt: string | null; version: string | null; publisher: string | null;
  sourceTrust: SourceTrust; license: string | null; sha256: string | null; repoCommit: string | null;
  scope: SourceScope; freshnessTTLDays: number; contradictions: string[];
  status: SourceStatus; statusReason: string | null; createdAt: string; createdBy: string; updatedAt: string;
}

export type LearningTrigger = "REAL_MISSION" | "CAPABILITY_GAP" | "RELEASE_DRIFT" | "FAILED_EVAL";
export const LEARNING_TRIGGERS: readonly LearningTrigger[] = ["REAL_MISSION", "CAPABILITY_GAP", "RELEASE_DRIFT", "FAILED_EVAL"];
export type LearningStatus =
  | "GAP_DETECTED" | "SOURCE_DISCOVERY" | "SOURCE_SCREENED" | "CURRICULUM_DRAFTED" | "CANDIDATE_PROPOSED"
  | "LAB_EXPERIMENT_RUNNING" | "LAB_RESULT_RECORDED" | "AWAITING_INDEPENDENT_REVIEW"
  | "PROMOTED_KNOWLEDGE" | "PROMOTED_SKILL_CANDIDATE" | "REJECTED"
  | "STALE" | "RECERTIFY_REQUIRED" | "REVOKED";
export const LEARNING_STATUSES: readonly LearningStatus[] = [
  "GAP_DETECTED", "SOURCE_DISCOVERY", "SOURCE_SCREENED", "CURRICULUM_DRAFTED", "CANDIDATE_PROPOSED",
  "LAB_EXPERIMENT_RUNNING", "LAB_RESULT_RECORDED", "AWAITING_INDEPENDENT_REVIEW",
  "PROMOTED_KNOWLEDGE", "PROMOTED_SKILL_CANDIDATE", "REJECTED", "STALE", "RECERTIFY_REQUIRED", "REVOKED"
];
// Allowlist geçiş tablosu: tabloda olmayan geçiş hiçbir şey yazmaz. Terfi yalnız bağımsız inceleme bekleyen kayıttan, drift yalnız terfi etmiş aileden yapılır.
// Yeniden sertifikasyon yolu (RECERTIFY_REQUIRED -> yeni lab) ayrı ve sonraki bir pakettir; burada terminal kabul edilir (yalnız REVOKED'a gidebilir).
export const LEARNING_TRANSITIONS: Readonly<Record<LearningStatus, readonly LearningStatus[]>> = {
  GAP_DETECTED: ["SOURCE_DISCOVERY", "REJECTED"],
  SOURCE_DISCOVERY: ["SOURCE_SCREENED", "REJECTED"],
  SOURCE_SCREENED: ["CURRICULUM_DRAFTED", "REJECTED"],
  CURRICULUM_DRAFTED: ["CANDIDATE_PROPOSED", "REJECTED"],
  CANDIDATE_PROPOSED: ["LAB_EXPERIMENT_RUNNING", "REJECTED"],
  LAB_EXPERIMENT_RUNNING: ["LAB_RESULT_RECORDED", "REJECTED"],
  LAB_RESULT_RECORDED: ["AWAITING_INDEPENDENT_REVIEW", "REJECTED"],
  AWAITING_INDEPENDENT_REVIEW: ["PROMOTED_KNOWLEDGE", "PROMOTED_SKILL_CANDIDATE", "REJECTED"],
  PROMOTED_KNOWLEDGE: ["STALE", "RECERTIFY_REQUIRED", "REVOKED"],
  PROMOTED_SKILL_CANDIDATE: ["STALE", "RECERTIFY_REQUIRED", "REVOKED"],
  STALE: ["RECERTIFY_REQUIRED", "REVOKED"],
  RECERTIFY_REQUIRED: ["REVOKED"],
  REJECTED: [],
  REVOKED: []
};
export const PROMOTED_STATUSES: readonly LearningStatus[] = ["PROMOTED_KNOWLEDGE", "PROMOTED_SKILL_CANDIDATE"];
export const DRIFT_STATUSES: readonly LearningStatus[] = ["STALE", "RECERTIFY_REQUIRED", "REVOKED"];
// Terfi etmiş aile: bir kez terfi edip sonra drift ile işaretlenmiş olanlar dahil.
export const PROMOTED_FAMILY: readonly LearningStatus[] = ["PROMOTED_KNOWLEDGE", "PROMOTED_SKILL_CANDIDATE", "STALE", "RECERTIFY_REQUIRED", "REVOKED"];
export const isLearningStatus = (x: unknown): x is LearningStatus => typeof x === "string" && (LEARNING_STATUSES as readonly string[]).includes(x);
export const canTransition = (from: LearningStatus, to: LearningStatus): boolean => LEARNING_TRANSITIONS[from].includes(to);

export type InjectionCode = "IGNORE_INSTRUCTIONS" | "AUTHORITY_ESCALATION" | "STATUS_FORGERY" | "SECRET_EXFILTRATION" | "POLICY_TAMPER" | "REMOTE_EXEC" | "CONTENT_HASH_MISMATCH";
export interface SourceScreen {
  screenedAt: string;
  // İçeriği sağlanıp hash'i eşleşen ve hiçbir enjeksiyon bulgusu olmayan kaynaklar.
  cleanSourceIds: string[];
  flaggedSourceIds: string[];
  unscreenedSourceIds: string[];
  injectionFindings: Array<{sourceId: string; codes: InjectionCode[]}>;
  conflicts: Array<{sourceId: string; contradictions: string[]}>;
}
export interface Curriculum { prerequisites: string[]; steps: string[] }
export interface LabResult {
  passed: boolean; deterministicTestRefs: string[]; recordedAt: string;
  // Lab sonucunun üretildiği model ve araç adaptörü sürümleri; drift bunlarla karşılaştırılır.
  modelVersion: string; toolAdapters: Record<string, string>;
}
export type PromotionKind = "KNOWLEDGE" | "SKILL_CANDIDATE";
export interface Promotion {
  kind: PromotionKind;
  // Öğrenilmiş belge READONLY_KNOWLEDGE'dır; aday beceri çalıştırılabilir değildir (APPROVED_EXECUTABLE_SKILL ayrı güvenlik/lisans/test kapısı ister).
  knowledgeStatus: "READONLY_KNOWLEDGE" | "SKILL_CANDIDATE_NOT_EXECUTABLE";
  executable: false;
  // Öğrenme yetki büyütmez; rol proficiencyStatus/certification değişmez (ayrı eval/sertifika paketleri).
  authorityEffect: "NONE";
  global: boolean; anonymized: boolean;
  reviewerEvidence: {ref: string; sha256: string; verifiedAt: string};
  supportingSourceIds: string[];
  promotedAt: string; promotedBy: string;
}
export interface DriftMark { to: LearningStatus; reasons: string[]; at: string; causeLearningId: string | null }
export interface LearningTimestamps { createdAt: string; updatedAt: string; promotedAt: string | null; driftedAt: string | null; closedAt: string | null }
export interface LearningRecord {
  recordKind: "learning"; learningId: string; roleId: string; guildId: string; tenantId: string; projectId: string | null;
  trigger: LearningTrigger; hypothesis: string; sourceIds: string[]; labRunRefs: string[]; negativeEvalRefs: string[];
  reviewerIdentity: string | null; reviewerRunRef: string | null; implementerIdentity: string;
  // Her zaman boş: boş olmayan herhangi bir değer girişte reddedilir ve replay'de journal'ı fail-closed yapar.
  permissionDelta: [];
  dependsOn: string[];
  status: LearningStatus; statusReason: string | null;
  screen: SourceScreen | null; curriculum: Curriculum | null; labResult: LabResult | null; promotion: Promotion | null; drift: DriftMark[];
  timestamps: LearningTimestamps; createdBy: string;
  // WFR04A-C1-F2: kaydı açan aktör + her ACADEMY_LEARNING_TRANSITIONED aktörü (replay'de journal'dan yeniden türetilir); reviewer ve terfi aktörü bunlardan biri olamaz.
  lifecycleActors: string[];
}
export type ReuseOutcome = "SUCCESS" | "FAILURE";
export interface ReuseEvent { recordKind: "reuse"; reuseId: string; tenantId: string; learningId: string; outcome: ReuseOutcome; missionRef: string; evidenceRef: string; at: string; actor: string }

export interface AcademyState { sources: Record<string, SourceRecord>; learnings: Record<string, LearningRecord>; reuses: Record<string, ReuseEvent> }
export const emptyAcademyState = (): AcademyState => ({sources: {}, learnings: {}, reuses: {}});

export type AcademyJournalType =
  | "ACADEMY_SOURCE_REGISTERED" | "ACADEMY_SOURCE_REVOKED"
  | "ACADEMY_LEARNING_OPENED" | "ACADEMY_LEARNING_TRANSITIONED" | "ACADEMY_LEARNING_PROMOTED" | "ACADEMY_LEARNING_DRIFTED"
  | "ACADEMY_REUSE_RECORDED";
export const ACADEMY_JOURNAL_TYPES: readonly AcademyJournalType[] = [
  "ACADEMY_SOURCE_REGISTERED", "ACADEMY_SOURCE_REVOKED",
  "ACADEMY_LEARNING_OPENED", "ACADEMY_LEARNING_TRANSITIONED", "ACADEMY_LEARNING_PROMOTED", "ACADEMY_LEARNING_DRIFTED",
  "ACADEMY_REUSE_RECORDED"
];
export const isAcademyJournalType = (t: string): t is AcademyJournalType => (ACADEMY_JOURNAL_TYPES as readonly string[]).includes(t);

export interface AcademyEntry { seq: number; type: string; at: string; actor: string; payload: Record<string, unknown> }
export interface AcademyApplied { idem?: {tenantId: string; kind: string; id: string} }

// Domain yazmaları store'un lock ve yeniden doğrulama altında verdiği bu dar arayüzle yapılır (Company OS ile aynı desen).
export interface AcademyTx {
  readonly sources: Readonly<Record<string, SourceRecord>>;
  readonly learnings: Readonly<Record<string, LearningRecord>>;
  readonly reuses: Readonly<Record<string, ReuseEvent>>;
  now(): string;
  newId(prefix: string): string;
  idem<T extends {tenantId: string}>(table: Readonly<Record<string, T>>, kind: string, tenantId: string, key: string | undefined, digest: string): T | undefined;
  idemFields(key: string | undefined, digest: string): Record<string, unknown>;
  // WFR04A-C1-F3: at verilirse hem ön-deneme (dry-run) hem diske yazılan girdi tam olarak bu zamanı kullanır; verilmezse store saati bir kez okunur ve ikisi için de kullanılır.
  append(type: AcademyJournalType, actor: string, payload: Record<string, unknown>, at?: string): void;
}
export interface AcademyView {
  readonly sources: Readonly<Record<string, SourceRecord>>;
  readonly learnings: Readonly<Record<string, LearningRecord>>;
  readonly reuses: Readonly<Record<string, ReuseEvent>>;
}
