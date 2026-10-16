// //TR: Bu dosya CORE-5 crew/koordinasyon katmanının ASSIGNMENT sözleşmesini tanımlar: ~13 ilk-sürüm uzman rolünü (MEVCUT registries/role-definitions.json kimlikleri, PRE_DEV_ROLE_MAP üzerinden) PRE_DEV fazlarına bağlayan bir CrewPlan ve rol başına bir TaskAssignment durum makinesi (ASSIGNED -> IN_PROGRESS -> SUBMITTED -> APPROVED | REWORK_REQUESTED -> (yeniden) IN_PROGRESS). Bu katman HİÇBİR rol EKLEMEZ ve HİÇBİR rolü certified YAPMAZ: yalnız var olan katalog kimliklerine referans verir (runtimeStatus/proficiencyStatus katalogda olduğu gibi kalır). Saf veri + saf durum makinesi; model/ağ/shell yok, üretilen kod yürütülmez.
import {PHASE_ARTIFACT_KIND, PRE_DEV_PHASE_TRANSITIONS, PRE_DEV_ROLE_MAP} from "../predev/types.js";
import type {ArtifactKind, PreDevPhase} from "../predev/types.js";

// //TR: Rol başına görev durumu. Allowlist tabloda olmayan geçiş hiçbir şey yapmaz. APPROVED terminaldir; REWORK_REQUESTED yalnız IN_PROGRESS'e (yeniden açılış) döner. Bu, MEVCUT artefakt/ faz kapılarını ZAYIFLATMAZ; yalnız koordinasyon katmanının okunur durumudur (gerçek kapılar store/apply içindedir).
export type TaskAssignmentState = "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "REWORK_REQUESTED";
export const TASK_ASSIGNMENT_STATES: readonly TaskAssignmentState[] = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REWORK_REQUESTED"];
export const TASK_ASSIGNMENT_TRANSITIONS: Readonly<Record<TaskAssignmentState, readonly TaskAssignmentState[]>> = {
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REWORK_REQUESTED"],
  REWORK_REQUESTED: ["IN_PROGRESS"],
  APPROVED: []
};
export const canAssignmentTransition = (from: TaskAssignmentState, to: TaskAssignmentState): boolean =>
  TASK_ASSIGNMENT_TRANSITIONS[from].includes(to);

export class CrewAssignmentError extends Error {
  constructor(message: string) { super(message); this.name = "CrewAssignmentError"; }
}

// //TR: Bir fazın crew bağlaması: faz + o fazın artefakt türü + o tür için eşlenmiş GERÇEK rol kimlikleri (primary + alternatifler) + o artefaktın birincil DOWNSTREAM tüketici rolü (bir sonraki artefakt fazının primary rolü; son pre-dev fazında null — ileri dev/review fazları için ayrılmış kanca).
export interface CrewRoleBinding {
  phase: PreDevPhase;
  kind: ArtifactKind;
  primaryRoleId: string;
  roleIds: readonly string[];
  downstreamRoleId: string | null;
}

export interface CrewPlan {
  readonly phases: readonly CrewRoleBinding[];
  readonly roleIds: readonly string[];
  // İleri (dev/review) fazlar için ayrılmış kancalar: bu pakette doldurulmaz (hiçbir rol eklenmez), yalnız downstream zincirinin pre-dev'in ötesine uzatılabileceğini işaretler.
  readonly reservedDownstreamPhaseHooks: readonly string[];
}

// Artefakt türlerinin sabit pre-dev sırası (upstream/downstream ilişkisi bundan türetilir).
const KIND_ORDER: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];

// Bir türün ait olduğu fazı PHASE_ARTIFACT_KIND tersinden bulur.
function phaseOfKind(kind: ArtifactKind): PreDevPhase {
  for (const [phase, k] of Object.entries(PHASE_ARTIFACT_KIND)) if (k === kind) return phase as PreDevPhase;
  throw new CrewAssignmentError(`CREW_KIND_HAS_NO_PHASE:${kind}`);
}

// //TR: CrewPlan'ı MEVCUT PRE_DEV_ROLE_MAP ve faz geçiş allowlist'inden deterministik üretir. roleIds yalnız katalog kimliklerine referanstır; hiçbir rol eklenmez/certified edilmez. downstreamRoleId bir sonraki artefakt fazının primary rolüdür (son fazda null).
export function buildCrewPlan(): CrewPlan {
  const phases: CrewRoleBinding[] = [];
  for (let i = 0; i < KIND_ORDER.length; i++) {
    const kind = KIND_ORDER[i];
    const roleIds = PRE_DEV_ROLE_MAP[kind];
    if (!roleIds || roleIds.length === 0) throw new CrewAssignmentError(`CREW_KIND_UNMAPPED:${kind}`);
    const downstreamKind = KIND_ORDER[i + 1];
    phases.push({
      phase: phaseOfKind(kind),
      kind,
      primaryRoleId: roleIds[0],
      roleIds,
      downstreamRoleId: downstreamKind ? PRE_DEV_ROLE_MAP[downstreamKind][0] : null
    });
  }
  // Faz sırasının MEVCUT PRE_DEV faz geçişleriyle tutarlı olduğunu doğrula (kapı zayıflatılmaz; yalnız tutarlılık iddiası).
  for (let i = 0; i < phases.length - 1; i++) {
    const from = phases[i].phase, to = phases[i + 1].phase;
    if (!PRE_DEV_PHASE_TRANSITIONS[from].includes(to)) throw new CrewAssignmentError(`CREW_PHASE_ORDER_INCONSISTENT:${from}->${to}`);
  }
  const roleIds = [...new Set(phases.flatMap(p => p.roleIds))];
  return {phases, roleIds, reservedDownstreamPhaseHooks: ["DEVELOPMENT", "REVIEW"]};
}

export function bindingForKind(plan: CrewPlan, kind: ArtifactKind): CrewRoleBinding {
  const b = plan.phases.find(p => p.kind === kind);
  if (!b) throw new CrewAssignmentError(`CREW_NO_BINDING:${kind}`);
  return b;
}

// //TR: Rol başına çalışan görev kaydı (koordinasyon okunur durumu). version/artifactId gerçek store artefaktına işaret eder; reworkCount gerçek REJECTED->supersede döngülerinin sayısıdır. Bu nesne store'u DEĞİŞTİRMEZ; yalnız koordinatörün ilerleyişini modelleyen bir görünümdür.
export interface TaskAssignment {
  roleId: string;
  kind: ArtifactKind;
  phase: PreDevPhase;
  state: TaskAssignmentState;
  version: number;
  artifactId: string | null;
  reworkCount: number;
}

export function newAssignment(binding: CrewRoleBinding): TaskAssignment {
  return {roleId: binding.primaryRoleId, kind: binding.kind, phase: binding.phase, state: "ASSIGNED", version: 0, artifactId: null, reworkCount: 0};
}

// //TR: Görev durumunu allowlist'e göre ilerletir; geçersiz geçiş fail-closed (hata) olur ve durum değişmez. Durum makinesi saftır; gerçek artefakt/faz kapıları ayrıca store/apply tarafından zorlanır.
export function advanceAssignment(a: TaskAssignment, to: TaskAssignmentState): TaskAssignment {
  if (!canAssignmentTransition(a.state, to)) throw new CrewAssignmentError(`CREW_ASSIGNMENT_ILLEGAL:${a.state}->${to}`);
  return {...a, state: to};
}
