// //TR: Bu dosya CORE-5 CrewCoordinator'ını tanımlar: bir projeyi PRE_DEV fazları boyunca MEVCUT PreDevDriver ile sürer (produce -> validate -> DRAFT kaydı -> submit -> bağımsız onay -> advance) ve ÜZERİNE sınırlı bir DOWNSTREAM REWORK döngüsü ekler. Koordinatör ASLA model/ağ/shell çağırmaz, üretilen kodu ASLA yürütmez ve HİÇBİR mevcut kapıyı zayıflatmaz: onay yine kaydedenden bağımsız aktör + boş olmayan evidenceRefs ister (store/apply zorlar); artefakt içeriği yine GERÇEK doğrulayıcıdan geçer.
// //TR: GATE GERÇEĞİ: Mevcut değiştirilemez kapılar (apply.ts) bir APPROVED artefaktı terminal yapar ve fazları yalnız ileri ilerletir; bir üst sürümü (supersedes) ancak önceki sürüm REJECTED ise kaydettirir. Bu yüzden "onaylı üstü geri aç" literal anlamda (fazı geri al / APPROVED'u boz) kapıları ZAYIFLATMADAN YAPILAMAZ. Downstream rework bu nedenle kapı-uyumlu ve DAHA güvenli biçimde şöyle gerçeklenir: bir sonraki (downstream) tüketici rol, üst artefaktın ADAY (DRAFT/SUBMITTED) sürümünü yetersiz bulursa bir ReworkRequest açar; koordinatör bu adayı GERÇEK reviewer-reject mekanizmasıyla REJECTED yapar (faz ilerlemez), sonra üst rol supersedes ile YENİ bir DRAFT sürüm üretir, bağımsız onaylanır ve faz ilerler. Böylece onaylanmış bir üst artefakt asla bozulmaz; yetersiz bir artefakt onaylanmadan geri gönderilir (strictly safer). Döngü SINIRLIDIR (hard max) ve aşılırsa fail-closed olur; asla otomatik onay yapmaz.
import {composeRolePrompt} from "../predev/role-prompts.js";
import {validateArtifactContent, type UpstreamContents} from "../predev/validators.js";
import {bindingForKind, newAssignment, advanceAssignment, type CrewPlan, type TaskAssignment} from "./assignment.js";
import {deriveCoordinationLedger, type CoordinationLedger, type CrewReworkRequest} from "./ledger.js";
import {PreDevDriver, type BuilderPort, type ProjectBrief, type PreDevDriverStore} from "../predev/driver.js";
import type {Scope} from "../types.js";
import type {
  ArtifactContent, ArtifactKind, BusinessAnalysisContent, PlanContent, PreDevArtifact, PreDevPhase, RequirementsContent
} from "../predev/types.js";

export class CrewCoordinatorError extends Error {
  constructor(message: string) { super(message); this.name = "CrewCoordinatorError"; }
}

// //TR: Koordinatörün ihtiyaç duyduğu store yüzeyi: driver'ın dar yüzeyi + tüm sürümleri (superseded REJECTED dahil) okumak için listPreDevArtifacts. WorkOsStore yapısal olarak bunu karşılar; ayrı store KURULMAZ.
export interface CrewStore extends PreDevDriverStore {
  listPreDevArtifacts(scope: Scope, preDevId: string): PreDevArtifact[];
}

// //TR: Downstream yeterlilik kararı portu: bir sonraki tüketici rolün, üst artefaktın ADAY sürümünü yeterli bulup bulmadığına dair dürüst, deterministik kararı. accept=false ise sabit bir sebep taşır (uydurma değil; gerçek reject olayına verilecek sebeple aynıdır). Bu port model/ağ/shell kapsüller; testte kayıtlı karar, runtime'da gerçek downstream değerlendirmesi.
export interface ReworkDecisionInput {
  kind: ArtifactKind;
  phase: PreDevPhase;
  version: number;
  artifactId: string;
  attempt: number;
  downstreamRoleId: string | null;
}
export type ReworkDecision = {accept: true} | {accept: false; reason: string};
export interface ReworkDecider {
  decide(input: ReworkDecisionInput): ReworkDecision;
}

export interface CrewCoordinatorDeps {
  store: CrewStore;
  driver: PreDevDriver;
  plan: CrewPlan;
  brief: ProjectBrief;
  builder: BuilderPort;
  decider: ReworkDecider;
  // Sınır: bir faz için izin verilen maksimum rework (supersede) sayısı; aşılırsa fail-closed.
  maxReworkPerPhase: number;
  // Kaydeden (recorder) ve ONDAN BAĞIMSIZ onaylayan kimlikleri; onay bağımsızlığını store zorlar.
  recorder: string;
  approver: string;
  now?: () => string;
}

export type CrewRunResult =
  | {status: "PRE_DEV_COMPLETE"; preDevId: string; assignments: Record<ArtifactKind, TaskAssignment>; reworkRequests: CrewReworkRequest[]; ledger: CoordinationLedger}
  | {status: "PRODUCE_REJECTED"; preDevId: string; phase: PreDevPhase; kind: ArtifactKind; reason: string; reworkRequests: CrewReworkRequest[]; ledger: CoordinationLedger}
  | {status: "REWORK_LIMIT_EXCEEDED"; preDevId: string; phase: PreDevPhase; kind: ArtifactKind; reworkCount: number; reworkRequests: CrewReworkRequest[]; ledger: CoordinationLedger};

// Doğrulayıcının istediği üst içerik zarfı; driver/apply ile birebir aynı eşleme (tutarlılık).
function toUpstreamContents(kind: ArtifactKind, approved: Partial<Record<ArtifactKind, ArtifactContent>>): UpstreamContents {
  if (kind === "Requirements") return {businessAnalysis: approved.BusinessAnalysis as BusinessAnalysisContent | undefined};
  if (kind === "Plan") return {requirements: approved.Requirements as RequirementsContent | undefined};
  if (kind === "Architecture") return {plan: approved.Plan as PlanContent | undefined};
  return {};
}

export class CrewCoordinator {
  constructor(private readonly deps: CrewCoordinatorDeps) {
    if (!Number.isSafeInteger(deps.maxReworkPerPhase) || deps.maxReworkPerPhase < 0) throw new CrewCoordinatorError("CREW_MAX_REWORK_INVALID");
    if (deps.recorder === deps.approver) throw new CrewCoordinatorError("CREW_APPROVER_NOT_INDEPENDENT");
  }

  private now(): string { return (this.deps.now ?? (() => new Date().toISOString()))(); }

  // //TR: Rework için üst rolün supersede eden YENİ DRAFT sürümünü üretir. MEVCUT BuilderPort + GERÇEK doğrulayıcı + GERÇEK store kullanılır (driver.produceCurrentPhase supersedes=null kaydettiği için rework'te kullanılamaz). İçerik geçersizse fail-closed (hata); geçersiz artefakt ASLA kaydedilmez. Model/ağ/shell yok, üretilen içerik yürütülmez.
  private async reproduceSuperseding(scope: Scope, missionId: string, preDevId: string, kind: ArtifactKind, authorRoleId: string, rejectedId: string): Promise<{artifactId: string; version: number}> {
    const ctx = this.deps.driver.buildMissionContext(scope, missionId, kind);
    const rolePrompt = composeRolePrompt(kind, ctx);
    const raw = await this.deps.builder.produce(kind, rolePrompt, ctx);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new CrewCoordinatorError("CREW_REWORK_INVALID_JSON"); }
    const v = validateArtifactContent(kind, parsed, toUpstreamContents(kind, ctx.approvedUpstream));
    if (!v.ok) throw new CrewCoordinatorError(`CREW_REWORK_INVALID:${v.errors}`);
    const art = this.deps.store.recordPreDevArtifact(scope, preDevId, {kind, authorRoleId, content: parsed as ArtifactContent, supersedes: rejectedId}, this.deps.recorder);
    return {artifactId: art.id, version: art.version};
  }

  // //TR: Projeyi PRE_DEV fazları boyunca sürer. Her faz: driver.produceCurrentPhase ile DRAFT; downstream yeterlilik kararı; accept -> bağımsız onay + advance; rework -> sınır kontrolü, GERÇEK reject, supersede eden yeni sürüm. Sınır aşılırsa fail-closed (onay/advance YOK). Dönen sonuç koordinasyon ledger'ını (gerçek kayıtlardan türetilmiş) taşır.
  async run(scope: Scope, missionId: string): Promise<CrewRunResult> {
    const started = this.deps.driver.start(scope, missionId, this.deps.recorder);
    const preDevId = started.preDevId;
    const assignments = {} as Record<ArtifactKind, TaskAssignment>;
    const reworkRequests: CrewReworkRequest[] = [];
    const ledger = () => deriveCoordinationLedger(this.deps.plan, missionId, preDevId, this.deps.store.listPreDevArtifacts(scope, preDevId), reworkRequests);

    for (const binding of this.deps.plan.phases) {
      const kind = binding.kind;
      let assignment = newAssignment(binding);                 // ASSIGNED
      assignment = advanceAssignment(assignment, "IN_PROGRESS"); // üretim başlıyor

      const out = await this.deps.driver.produceCurrentPhase(scope, missionId, this.deps.recorder);
      if (out.status !== "RECORDED") {
        // Doğrulayıcı reddi: hiçbir geçersiz artefakt kaydedilmedi, faz ilerlemedi — fail-closed.
        assignments[kind] = assignment;
        return {status: "PRODUCE_REJECTED", preDevId, phase: binding.phase, kind, reason: out.reason, reworkRequests, ledger: ledger()};
      }
      let artifactId = out.artifactId, version = out.version;
      assignment = {...advanceAssignment(assignment, "SUBMITTED"), artifactId, version};

      for (let attempt = 0; ; attempt++) {
        const decision = this.deps.decider.decide({kind, phase: binding.phase, version, artifactId, attempt, downstreamRoleId: binding.downstreamRoleId});
        if (decision.accept) {
          // Bağımsız onay (approver != recorder) + boş olmayan evidenceRefs; MEVCUT kapıyı kullanır, advance sonrası bir sonraki faza geçer.
          this.deps.driver.approveAndAdvance(scope, missionId, artifactId, this.deps.approver, [`crew_evd_${kind}_v${version}`]);
          assignment = advanceAssignment(assignment, "APPROVED");
          break;
        }
        // Downstream yetersiz buldu: önce SINIR kontrolü (hard max). Aşılırsa fail-closed: onay YOK, advance YOK.
        if (assignment.reworkCount >= this.deps.maxReworkPerPhase) {
          assignments[kind] = assignment;
          return {status: "REWORK_LIMIT_EXCEEDED", preDevId, phase: binding.phase, kind, reworkCount: assignment.reworkCount, reworkRequests, ledger: ledger()};
        }
        // ReworkRequest: alt (downstream) rol, üst ADAY artefaktına karşı sabit sebeple açar (gerçek reject olayına verilecek sebeple birebir aynı).
        const requestedBy = binding.downstreamRoleId ?? binding.primaryRoleId;
        reworkRequests.push({targetArtifactId: artifactId, targetKind: kind, phase: binding.phase, requestedByRoleId: requestedBy, upstreamRoleId: binding.primaryRoleId, version, reason: decision.reason, at: this.now()});
        assignment = advanceAssignment(assignment, "REWORK_REQUESTED");
        // GERÇEK reviewer-reject: DRAFT->SUBMITTED->REJECTED, downstream rol aktör; faz İLERLEMEZ.
        this.deps.driver.reject(scope, missionId, artifactId, requestedBy, decision.reason);
        // Üst rol supersede eden yeni DRAFT sürüm üretir (GERÇEK store/doğrulayıcı).
        assignment = advanceAssignment(assignment, "IN_PROGRESS");
        const re = await this.reproduceSuperseding(scope, missionId, preDevId, kind, binding.primaryRoleId, artifactId);
        artifactId = re.artifactId; version = re.version;
        assignment = {...advanceAssignment(assignment, "SUBMITTED"), artifactId, version, reworkCount: assignment.reworkCount + 1};
      }
      assignments[kind] = assignment;
    }

    return {status: "PRE_DEV_COMPLETE", preDevId, assignments, reworkRequests, ledger: ledger()};
  }
}
