// //TR: Bu dosya CORE-5 crew katmanının DENETLENEBİLİR koordinasyon LEDGER'ını (okunur model) türetir: uzman (rol) başına görev zaman çizelgesi — atama, kayıt (submission), onay, rework talebi (sebebiyle), sürümler — YALNIZ gerçek kaydedilmiş olaylardan. Yapısal zaman çizelgesi store.listPreDevArtifacts (hash-zincirli journal replay'inin ürünü) üzerinden türetilir; rework sebep metni, koordinatörün GERÇEK store reject olayına verdiği sebeptir (uydurma yok). Hiçbir uydurma aktivite üretilmez; artefaktı olmayan rol yalnız ASSIGNED görünür (plan gerçeğidir), olay listesi boştur. Render yoktur; yalnız okuma modeli alanları.
import {bindingForKind, type CrewPlan} from "./assignment.js";
import type {TaskAssignmentState} from "./assignment.js";
import type {ArtifactKind, PreDevArtifact, PreDevPhase} from "../predev/types.js";

// //TR: Koordinatörün bir alt (downstream) rolün üst artefaktı yetersiz bulup açtığı rework talebi. Her talep, store'da GERÇEK bir REJECTED geçişine (aynı sebeple) birebir karşılık gelir; ledger bu sebebi o gerçek olaydan taşır.
export interface CrewReworkRequest {
  targetArtifactId: string;
  targetKind: ArtifactKind;
  phase: PreDevPhase;
  requestedByRoleId: string;
  upstreamRoleId: string;
  version: number;
  reason: string;
  at: string;
}

export type LedgerEventType = "RECORDED" | "SUBMITTED" | "APPROVED" | "REWORK_REQUESTED";

// //TR: Tek bir koordinasyon olayı; tümü gerçek store artefakt durumundan/sürümünden türetilir (reason yalnız REWORK_REQUESTED'te ve gerçek reject olayından gelir).
export interface LedgerEvent {
  kind: ArtifactKind;
  phase: PreDevPhase;
  roleId: string;
  type: LedgerEventType;
  version: number;
  artifactId: string;
  actor: string;
  at: string;
  evidenceRefs?: readonly string[];
  reason?: string;
}

export interface ExpertTaskTimeline {
  roleId: string;
  kind: ArtifactKind;
  phase: PreDevPhase;
  assignmentState: TaskAssignmentState;
  reworkCount: number;
  currentVersion: number;
  currentArtifactId: string | null;
  events: readonly LedgerEvent[];
}

export interface CoordinationLedger {
  missionId: string;
  preDevId: string | null;
  // Rol başına (uzman başına) görev zaman çizelgesi; plan sırasında.
  experts: readonly ExpertTaskTimeline[];
  // Tüm olayların journal sırasına (seq benzeri: kayıt zamanı + sürüm) göre düz listesi.
  events: readonly LedgerEvent[];
  reworkRequests: readonly CrewReworkRequest[];
}

// Artefakt durumundan atama durumuna dürüst eşleme (en güncel sürüm için).
function assignmentStateOf(state: PreDevArtifact["state"]): TaskAssignmentState {
  switch (state) {
    case "APPROVED": return "APPROVED";
    case "REJECTED": return "REWORK_REQUESTED";
    case "SUBMITTED": return "SUBMITTED";
    case "DRAFT": return "IN_PROGRESS";
  }
}

// //TR: Bir türün tüm sürümlerinden (artan version) olayları türetir. Her sürüm bir RECORDED olayı üretir; terminal duruma göre APPROVED (kanıtlı) / REWORK_REQUESTED (reject, sebebi reworkRequests overlay'inden) / SUBMITTED eklenir. DRAFT ara olay üretmez (henüz devam ediyor). Uydurma yok: olaylar yalnız var olan artefakt kayıtlarından çıkar.
function timelineForKind(
  binding: ReturnType<typeof bindingForKind>,
  versions: PreDevArtifact[],
  reworkByArtifactId: Map<string, CrewReworkRequest>
): ExpertTaskTimeline {
  const events: LedgerEvent[] = [];
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  for (const art of sorted) {
    const base = {kind: binding.kind, phase: binding.phase, roleId: art.authorRoleId, version: art.version, artifactId: art.id};
    events.push({...base, type: "RECORDED", actor: art.recordedBy, at: art.createdAt});
    if (art.state === "APPROVED") {
      events.push({...base, type: "SUBMITTED", actor: art.recordedBy, at: art.updatedAt});
      events.push({...base, type: "APPROVED", actor: art.approvedBy ?? "", at: art.updatedAt, evidenceRefs: [...art.evidenceRefs]});
    } else if (art.state === "REJECTED") {
      events.push({...base, type: "SUBMITTED", actor: art.recordedBy, at: art.updatedAt});
      const rr = reworkByArtifactId.get(art.id);
      events.push({...base, type: "REWORK_REQUESTED", actor: art.rejectedBy ?? "", at: art.updatedAt, ...(rr ? {reason: rr.reason} : {})});
    } else if (art.state === "SUBMITTED") {
      events.push({...base, type: "SUBMITTED", actor: art.recordedBy, at: art.updatedAt});
    }
  }
  const latest = sorted.length ? sorted[sorted.length - 1] : undefined;
  const reworkCount = sorted.filter(a => a.state === "REJECTED").length;
  return {
    roleId: binding.primaryRoleId,
    kind: binding.kind,
    phase: binding.phase,
    assignmentState: latest ? assignmentStateOf(latest.state) : "ASSIGNED",
    reworkCount,
    currentVersion: latest ? latest.version : 0,
    currentArtifactId: latest ? latest.id : null,
    events
  };
}

// //TR: Koordinasyon ledger'ını GERÇEK store artefaktlarından (listPreDevArtifacts replay ürünü) + koordinatörün gerçek rework taleplerinden türetir. Saf fonksiyon; store'u değiştirmez, yan etkisi yoktur, hiçbir alanı tahmin etmez.
export function deriveCoordinationLedger(
  plan: CrewPlan,
  missionId: string,
  preDevId: string | null,
  allArtifacts: readonly PreDevArtifact[],
  reworkRequests: readonly CrewReworkRequest[]
): CoordinationLedger {
  const reworkByArtifactId = new Map<string, CrewReworkRequest>();
  for (const r of reworkRequests) reworkByArtifactId.set(r.targetArtifactId, r);
  const experts: ExpertTaskTimeline[] = [];
  const flat: LedgerEvent[] = [];
  for (const binding of plan.phases) {
    const versions = allArtifacts.filter(a => a.kind === binding.kind);
    const tl = timelineForKind(bindingForKind(plan, binding.kind), versions, reworkByArtifactId);
    experts.push(tl);
    flat.push(...tl.events);
  }
  // Düz liste kayıt zamanına, eşitlikte sürüme ve olay türü sırasına göre (RECORDED<SUBMITTED<APPROVED/REWORK) kararlı sıralanır.
  const typeRank: Record<LedgerEventType, number> = {RECORDED: 0, SUBMITTED: 1, APPROVED: 2, REWORK_REQUESTED: 2};
  flat.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.version - b.version || typeRank[a.type] - typeRank[b.type]));
  return {missionId, preDevId, experts, events: flat, reworkRequests: [...reworkRequests]};
}
