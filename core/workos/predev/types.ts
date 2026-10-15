// //TR: Bu dosya CORE pre-development artefakt sözleşmelerinin (Business Analysis, Requirements, Plan, Architecture, UX Spec) ve PRE_DEV faz dizisinin tip sözleşmesini tanımlar; ayrı store yoktur, kayıtlar Work OS hash zincirli journal içinde yaşar ve hiçbir alan içerik uydurmaz (yalnız yapı/izlenebilirlik taşınır). Bu paket hiçbir rol-ajanını çalıştırmaz ve üretilen kod yürütmez.

// //TR: Artefakt yaşam döngüsü durumları; onay yalnız SUBMITTED kayıttan ve kanıta bağlı olarak APPROVED'a geçer (uydurma onay yoktur).
export type ArtifactState = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
export const ARTIFACT_STATES: readonly ArtifactState[] = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"];
export const isArtifactState = (x: unknown): x is ArtifactState => typeof x === "string" && (ARTIFACT_STATES as readonly string[]).includes(x);
// Allowlist artefakt geçişleri: tabloda olmayan geçiş hiçbir şey yazmaz. APPROVED ve REJECTED terminaldir (yeni sürüm supersedes ile açılır).
export const ARTIFACT_TRANSITIONS: Readonly<Record<ArtifactState, readonly ArtifactState[]>> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: []
};
export const canArtifactTransition = (from: ArtifactState, to: ArtifactState): boolean => ARTIFACT_TRANSITIONS[from].includes(to);

// //TR: Pre-dev artefakt türleri. Her tür bir mission'a bağlıdır ve journal'a kaydedilir.
export type ArtifactKind = "BusinessAnalysis" | "Requirements" | "Plan" | "Architecture" | "UxSpec";
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];
export const isArtifactKind = (x: unknown): x is ArtifactKind => typeof x === "string" && (ARTIFACT_KINDS as readonly string[]).includes(x);

// ---- İçerik sözleşmeleri (yalnız yapı; doğrulayıcılar içeriği asla uydurmaz, yalnız biçim/izlenebilirlik denetler) ----
// BA hedefleri izlenebilirlik için kimliklidir: Requirements bunlara iz düşer.
export interface Goal { id: string; statement: string }
export interface BusinessAnalysisContent {
  problem: string; stakeholders: string[]; goals: Goal[]; constraints: string[]; successMetrics: string[]; assumptions: string[]; risks: string[];
}
// Her gereksinim bir kimlik, ifade, kabul kriterleri ve iz düştüğü BA hedef kimlikleri taşır (traceability).
export interface Requirement { id: string; statement: string; acceptanceCriteria: string[]; tracesTo: string[] }
export interface RequirementsContent { functional: Requirement[]; nonFunctional: Requirement[] }
// Plan kapsamı kimliklidir: Architecture bileşenleri bu kapsamı kapsar. İş paketleri gereksinimlere iz düşer (satisfies).
export interface ScopeItem { id: string; statement: string }
export interface WorkPackage { id: string; title: string; dependsOn: string[]; estimate: string; satisfies: string[] }
export interface Milestone { id: string; title: string; workPackageIds: string[] }
export interface PlanContent { scope: ScopeItem[]; workPackages: WorkPackage[]; milestones: Milestone[]; outOfScope: string[] }
export interface TechChoice { choice: string; rationale: string; alternativesConsidered: string[] }
// Her bileşen kapsadığı Plan kapsam kimliklerini taşır (covers); Architecture Plan kapsamını kapsar.
export interface Component { id: string; name: string; responsibility: string; covers: string[] }
export interface ArchitectureContent {
  components: Component[]; techChoices: TechChoice[]; dataModel: string; integrations: string[]; infraNeeds: string[]; risks: string[];
}
export interface Screen { id: string; name: string }
export interface Flow { id: string; name: string; steps: string[] }
export interface UxComponent { id: string; name: string }
export interface UxSpecContent { screens: Screen[]; flows: Flow[]; components: UxComponent[]; a11yNotes: string[] }

export type ArtifactContent = BusinessAnalysisContent | RequirementsContent | PlanContent | ArchitectureContent | UxSpecContent;

// //TR: Ortak artefakt zarfı: mission'a bağlı, sürümlü, journal'a kaydedilen Work OS artefaktı. supersedes yalnız REJECTED (veya önceki) bir artefaktın kimliğini gösterir. evidenceRefs kanıta bağlar.
export interface PreDevArtifact<K extends ArtifactKind = ArtifactKind, C = ArtifactContent> {
  id: string; missionId: string; tenantId: string; kind: K; version: number; authorRoleId: string;
  createdAt: string; state: ArtifactState; supersedes: string | null; evidenceRefs: string[]; content: C;
  // WFR04A deseninde olduğu gibi: artefaktı kaydeden ve durumunu değiştiren aktörler journal'dan türetilir; onaylayan, kaydeden aktörden bağımsız olmalıdır.
  recordedBy: string; approvedBy: string | null; rejectedBy: string | null; updatedAt: string;
}

// ---- PRE_DEV faz dizisi (mission'a eklenen, geriye dönük uyumlu, ek katman) ----
// //TR: Mevcut mission lifecycle (core/mission) DEĞİŞTİRİLMEZ. Bu dizi bir pre-dev isteği (PREDEV_SEQUENCE_OPENED) açıldığında var olur; istek yoksa mission mevcut yolunu izler (geriye dönük uyumlu).
export type PreDevPhase = "AUTHORIZED" | "BUSINESS_ANALYSIS" | "REQUIREMENTS" | "PLANNING" | "ARCHITECTURE" | "UX_DESIGN" | "PRE_DEV_COMPLETE";
export const PRE_DEV_PHASES: readonly PreDevPhase[] = ["AUTHORIZED", "BUSINESS_ANALYSIS", "REQUIREMENTS", "PLANNING", "ARCHITECTURE", "UX_DESIGN", "PRE_DEV_COMPLETE"];
export const isPreDevPhase = (x: unknown): x is PreDevPhase => typeof x === "string" && (PRE_DEV_PHASES as readonly string[]).includes(x);
// Allowlist faz geçişleri: her faz yalnız ilgili artefaktı APPROVED olunca ilerler. PRE_DEV_COMPLETE terminaldir ve mission mevcut PLANNED/EXECUTING yoluna devam eder.
export const PRE_DEV_PHASE_TRANSITIONS: Readonly<Record<PreDevPhase, readonly PreDevPhase[]>> = {
  AUTHORIZED: ["BUSINESS_ANALYSIS"],
  BUSINESS_ANALYSIS: ["REQUIREMENTS"],
  REQUIREMENTS: ["PLANNING"],
  PLANNING: ["ARCHITECTURE"],
  ARCHITECTURE: ["UX_DESIGN"],
  UX_DESIGN: ["PRE_DEV_COMPLETE"],
  PRE_DEV_COMPLETE: []
};
export const canPhaseTransition = (from: PreDevPhase, to: PreDevPhase): boolean => PRE_DEV_PHASE_TRANSITIONS[from].includes(to);
// //TR: Bir faza girmeden önce TAMAMLANMASI (APPROVED) gereken artefaktın türü. AUTHORIZED giriş fazıdır (artefakt istemez); PRE_DEV_COMPLETE'e geçmek için UxSpec APPROVED olmalıdır.
// Yani: bir fazdan sonraki faza ilerlemek için, O ANKİ fazın artefaktı APPROVED olmalıdır.
export const PHASE_ARTIFACT_KIND: Readonly<Partial<Record<PreDevPhase, ArtifactKind>>> = {
  BUSINESS_ANALYSIS: "BusinessAnalysis",
  REQUIREMENTS: "Requirements",
  PLANNING: "Plan",
  ARCHITECTURE: "Architecture",
  UX_DESIGN: "UxSpec"
};

// //TR: ~13 ilk-sürüm rolünün fazlara eşlenmesi. Değerler registries/role-definitions.json içindeki mevcut roleId'lerdir (BA/SW-Analyst/PO-PM/Architect/UX). Bu paket hiçbir rol EKLEMEZ ve hiçbir rolü
// certified YAPMAZ (runtimeStatus/proficiencyStatus katalogda olduğu gibi kalır). authorRoleId yalnızca bu listelere referans olmalıdır (biçim denetimi; katalog yükleme saf doğrulayıcıda yapılmaz).
export const PRE_DEV_ROLE_MAP: Readonly<Record<ArtifactKind, readonly string[]>> = {
  BusinessAnalysis: ["UASCO-0022", "UASCO-0021"],
  Requirements: ["UASCO-0023", "UASCO-0020"],
  Plan: ["UASCO-0019", "UASCO-0018"],
  Architecture: ["UASCO-0043", "UASCO-0045", "UASCO-0050"],
  UxSpec: ["UASCO-0031", "UASCO-0032", "UASCO-0033", "UASCO-0037"]
};
// Bu paketin referans verdiği tüm roleId'ler (test katalog varlığını ve certified-değil olduğunu doğrular).
export const PRE_DEV_ROLE_IDS: readonly string[] = Object.values(PRE_DEV_ROLE_MAP).flat();

// //TR: Mission'a bağlı pre-dev dizi kaydı. Her mission için en çok bir dizi. artifacts: her tür için O ANDAKİ (en yüksek sürüm) artefaktın kimliği (yoksa yok).
export interface PreDevSequence {
  preDevId: string; missionId: string; tenantId: string; phase: PreDevPhase;
  artifacts: Partial<Record<ArtifactKind, string>>; createdAt: string; createdBy: string; updatedAt: string;
  // Diziyi ilerleten aktörler (replay'de journal'dan türetilir).
  lifecycleActors: string[];
}

export interface PreDevState { sequences: Record<string, PreDevSequence>; artifacts: Record<string, PreDevArtifact> }
export const emptyPreDevState = (): PreDevState => ({sequences: {}, artifacts: {}});

export type PreDevJournalType =
  | "PREDEV_SEQUENCE_OPENED" | "PREDEV_ARTIFACT_RECORDED" | "PREDEV_ARTIFACT_TRANSITIONED" | "PREDEV_PHASE_ADVANCED";
export const PREDEV_JOURNAL_TYPES: readonly PreDevJournalType[] = [
  "PREDEV_SEQUENCE_OPENED", "PREDEV_ARTIFACT_RECORDED", "PREDEV_ARTIFACT_TRANSITIONED", "PREDEV_PHASE_ADVANCED"
];
export const isPreDevJournalType = (t: string): t is PreDevJournalType => (PREDEV_JOURNAL_TYPES as readonly string[]).includes(t);

export interface PreDevEntry { seq: number; type: string; at: string; actor: string; payload: Record<string, unknown> }
export interface PreDevApplied { idem?: {tenantId: string; kind: string; id: string} }
// //TR: Pre-dev yazmaları Work OS store üzerindeki yöntemlerle (lock + yeniden doğrulama + clone-replay ön-denemesi altında) yapılır; Company/Academy ile aynı güvenlik deseni, ayrı store yoktur.
// Mission varlığı/durumu/tenant denetimi yazma tarafında (store full State'e sahipken) yapılır; replay (applyPreDevEntry) iç tutarlılığı doğrular.
// Pre-dev isteği açmanın caiz olduğu mission durumları (pre-execution): dizi yalnız bu durumlarda açılır.
export const PREDEV_OPEN_MISSION_STATUSES: readonly string[] = ["DRAFT", "PREFLIGHT", "AUTHORIZED"];
