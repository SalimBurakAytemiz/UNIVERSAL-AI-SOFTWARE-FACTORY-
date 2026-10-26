// //TR: Bu dosya PRE_DEV fazını YÜRÜTÜLEBİLİR yapan PreDevDriver'ı tanımlar: bir faz, enjekte edilen bir BuilderPort'tan tipli bir artefakt içeriği İSTER, onu MEVCUT doğrulayıcılarla (yapı + izlenebilirlik) doğrular, başarıda DRAFT olarak journal'a kaydeder, başarısızlıkta dürüst bir REJECTED sonucu döner ve HİÇBİR durumda fazı ilerletmez. Submit/approve/reject MEVCUT onay mekanizmasını kullanır (onaylayan != kaydeden ve boş olmayan evidenceRefs). Driver ASLA model/ağ/shell çağırmaz ve dönen kodu ASLA yürütmez; yalnız yapısal içeriği doğrular ve kaydeder. Gerçek builder adaptörü runtime'da sağlanır; bu port enjeksiyonu driver'ı deterministik test edilebilir kılar.
import {validateArtifactContent, type UpstreamContents} from "./validators.js";
import {composeRolePrompt, getRolePrompt, PLACEHOLDER_MARKER} from "./role-prompts.js";
import {PHASE_ARTIFACT_KIND, PRE_DEV_PHASE_TRANSITIONS} from "./types.js";
import type {Scope} from "../types.js";
import type {
  ArtifactContent, ArtifactKind, BusinessAnalysisContent, PlanContent, PreDevArtifact, PreDevPhase, PreDevSequence,
  RequirementsContent
} from "./types.js";
import type {PreDevReadModel} from "./read-model.js";

// //TR: Proje özeti: mission bağlamının kökü; builder'a verilen tek yetkili kaynak malzemedir (artefakt içerikleriyle birlikte). Sadece dürüst referans/istek verisi taşır; sır veya ağ adresi taşımaz. isReference, bu özetin bir referans proje tanımı olduğunu (gerçek bir müşteri projesi olmadığını) açıkça işaretler.
export interface ProjectBrief {
  projectName: string;
  isReference: boolean;
  label: string;
  summary: string;
  stakeholders: string[];
  objectives: string[];
  constraints: string[];
  outOfScope: string[];
  notes: string[];
}

// //TR: Bir role-builder'a verilen mission bağlamı: proje özeti + YALNIZ zaten APPROVED olmuş üst artefaktların içerikleri. DRAFT/REJECTED üst artefaktlar bağlama GİRMEZ (alt rol onları görmez).
export interface MissionContext {
  brief: ProjectBrief;
  approvedUpstream: Partial<Record<ArtifactKind, ArtifactContent>>;
}

// //TR: Enjekte edilen builder portu: bir rol için tipli artefakt içeriğini JSON metni olarak üretir. Driver bu metni parse+doğrular; port'un kendisi model/ağ/shell detayını kapsüller (test'te kayıtlı yanıt veren mock, runtime'da gerçek adaptör).
export type ArtifactContentJson = string;
export interface BuilderPort {
  produce(kind: ArtifactKind, rolePrompt: string, missionContext: MissionContext): Promise<ArtifactContentJson>;
}

// //TR: Driver'ın ihtiyaç duyduğu dar store yüzeyi (WorkOsStore yapısal olarak bunu karşılar). Ayrı store KURULMAZ; tüm yazmalar mevcut hash-zincirli journal'a gider.
export interface PreDevDriverStore {
  openPreDevSequence(scope: Scope, missionId: string, createdBy: string, idempotencyKey?: string): PreDevSequence;
  recordPreDevArtifact(scope: Scope, preDevId: string, input: {kind: ArtifactKind; authorRoleId: string; content: ArtifactContent; supersedes?: string | null; evidenceRefs?: string[]}, actor: string, idempotencyKey?: string): PreDevArtifact;
  transitionPreDevArtifact(scope: Scope, preDevId: string, artifactId: string, to: "SUBMITTED" | "APPROVED" | "REJECTED", opts: {reason?: string; evidenceRefs?: string[]}, actor: string): PreDevArtifact;
  advancePreDevPhase(scope: Scope, preDevId: string, to: PreDevPhase, actor: string): PreDevSequence;
  getPreDevArtifact(scope: Scope, artifactId: string): PreDevArtifact | undefined;
  preDevReadModel(scope: Scope, missionId: string): PreDevReadModel;
}

export interface PreDevDriverDeps {
  store: PreDevDriverStore;
  brief: ProjectBrief;
  builder: BuilderPort;
}

// //TR: Bir faz üretim denemesinin dürüst sonucu. RECORDED: içerik doğrulandı ve DRAFT olarak kaydedildi. REJECTED: içerik (parse veya doğrulayıcı) kapısından geçemedi; HİÇBİR geçersiz artefakt kaydedilmedi ve faz İLERLEMEDİ; reason doğrulayıcının sabit hata kodudur (uydurma değil).
export type ProduceOutcome =
  | {status: "RECORDED"; kind: ArtifactKind; phase: PreDevPhase; artifactId: string; version: number}
  | {status: "REJECTED"; kind: ArtifactKind; phase: PreDevPhase; reason: string};

// Faz artefakt zincirinin sabit sırası (üst/alt ilişkisi bundan türetilir).
const PREDEV_KIND_ORDER: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];

// Bir türün (sadece) o anki fazdan önce gelen üst türleri.
function upstreamKindsOf(kind: ArtifactKind): ArtifactKind[] {
  const i = PREDEV_KIND_ORDER.indexOf(kind);
  return i <= 0 ? [] : PREDEV_KIND_ORDER.slice(0, i);
}

// Doğrulayıcının istediği üst içerik zarfı; apply.ts'teki upstreamFor ile birebir aynı eşleme (tutarlılık için).
export function toUpstreamContents(kind: ArtifactKind, approved: Partial<Record<ArtifactKind, ArtifactContent>>): UpstreamContents {
  if (kind === "Requirements") return {businessAnalysis: approved.BusinessAnalysis as BusinessAnalysisContent | undefined};
  if (kind === "Plan") return {requirements: approved.Requirements as RequirementsContent | undefined};
  if (kind === "Architecture") return {plan: approved.Plan as PlanContent | undefined};
  return {};
}

// //TR: C-FLOW-ANALYSIS-2: yer tutucu işareti taşıyan HERHANGİ bir metin değeri (anahtarlar dahil) taslağı geçersiz kılar; iskeleti yankılayan çıktı doğrulayıcıdan geçse bile kaydedilmez.
function hasPlaceholder(x: unknown): boolean {
  if (typeof x === "string") return x.includes(PLACEHOLDER_MARKER);
  if (Array.isArray(x)) return x.some(hasPlaceholder);
  if (typeof x === "object" && x !== null) return Object.entries(x).some(([k, v]) => k.includes(PLACEHOLDER_MARKER) || hasPlaceholder(v));
  return false;
}

export class PreDevDriverError extends Error {
  constructor(message: string) { super(message); this.name = "PreDevDriverError"; }
}

export class PreDevDriver {
  constructor(private readonly deps: PreDevDriverDeps) {}

  // //TR: Mission için diziyi açar ve giriş fazından (AUTHORIZED, artefakt istemeyen ungated faz) ilk gerçek faza (BUSINESS_ANALYSIS) ilerletir. Mevcut mission lifecycle'ı DEĞİŞTİRİLMEZ.
  // //TR: Devam (resume): dizi önceki bir denemede açılmış ama ilk ilerleme yazımı (AUTHORIZED -> BUSINESS_ANALYSIS) tamamlanamamışsa (ENOSPC, yazma hatası, iki fsync arasında çökme) dizi AUTHORIZED'da kalır; yeniden denemede YALNIZ o ilerleme tamamlanır. Daha ileri fazdaki mevcut dizi için davranış değişmez (store PREDEV_SEQUENCE_EXISTS fırlatır).
  start(scope: Scope, missionId: string, actor: string): {preDevId: string; phase: PreDevPhase} {
    const rm = this.deps.store.preDevReadModel(scope, missionId);
    const preDevId = rm.active && rm.preDevId !== null && rm.phase === "AUTHORIZED" ? rm.preDevId : this.deps.store.openPreDevSequence(scope, missionId, actor).preDevId;
    const advanced = this.deps.store.advancePreDevPhase(scope, preDevId, "BUSINESS_ANALYSIS", actor);
    return {preDevId: advanced.preDevId, phase: advanced.phase};
  }

  // //TR: O anki faz için mission bağlamını kurar: proje özeti + YALNIZ APPROVED üst artefakt içerikleri. DRAFT/REJECTED üst artefakt bağlama alınmaz; current-artifact her tür için okuma modelinden türetilir.
  buildMissionContext(scope: Scope, missionId: string, kind: ArtifactKind): MissionContext {
    const rm = this.deps.store.preDevReadModel(scope, missionId);
    const approvedUpstream: Partial<Record<ArtifactKind, ArtifactContent>> = {};
    for (const up of upstreamKindsOf(kind)) {
      const summary = rm.artifacts[up];
      if (summary && summary.state === "APPROVED" && summary.artifactId) {
        const art = this.deps.store.getPreDevArtifact(scope, summary.artifactId);
        if (art && art.state === "APPROVED") approvedUpstream[up] = art.content;
      }
    }
    return {brief: this.deps.brief, approvedUpstream};
  }

  // //TR: O anki fazın tipli artefaktını builder'dan ister, parse+doğrular, başarıda DRAFT kaydeder. Başarısızlıkta dürüst REJECTED döner; geçersiz içerik ASLA kaydedilmez ve faz ASLA ilerlemez. Driver model/ağ/shell çağırmaz ve dönen içeriği yürütmez.
  async produceCurrentPhase(scope: Scope, missionId: string, recordedBy: string): Promise<ProduceOutcome> {
    const rm = this.deps.store.preDevReadModel(scope, missionId);
    if (!rm.active || rm.preDevId === null) throw new PreDevDriverError("PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE");
    const phase = rm.phase as PreDevPhase;
    const kind = PHASE_ARTIFACT_KIND[phase];
    if (!kind) throw new PreDevDriverError(`PREDEV_DRIVER_NO_ARTIFACT_PHASE:${phase}`);

    // //TR: Bu türün MEVCUT artefaktı varsa store/replay kuralı: yeni sürüm yalnız REJECTED olanı `supersedes` ile açar; REJECTED dışındaki (DRAFT/SUBMITTED/APPROVED) mevcut artefaktın üstüne yeni taslak yazılamaz. Bu durumda builder çağrılmadan (ücretli iş) temiz bir driver hatası verilir.
    const current = rm.artifacts[kind];
    if (current.artifactId !== null && current.state !== "REJECTED") throw new PreDevDriverError(`PREDEV_DRIVER_ARTIFACT_PENDING:${kind}:${current.state}`);
    const supersedes = current.artifactId !== null ? current.artifactId : null;

    const ctx = this.buildMissionContext(scope, missionId, kind);
    const rolePrompt = composeRolePrompt(kind, ctx);
    const authorRoleId = getRolePrompt(kind).roleId;

    const raw = await this.deps.builder.produce(kind, rolePrompt, ctx);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return {status: "REJECTED", kind, phase, reason: "PREDEV_DRIVER_INVALID_JSON"}; }

    if (hasPlaceholder(parsed)) return {status: "REJECTED", kind, phase, reason: "PREDEV_DRIVER_PLACEHOLDER_VALUE"};

    const v = validateArtifactContent(kind, parsed, toUpstreamContents(kind, ctx.approvedUpstream));
    if (!v.ok) return {status: "REJECTED", kind, phase, reason: v.errors};

    const art = this.deps.store.recordPreDevArtifact(scope, rm.preDevId, {kind, authorRoleId, content: parsed as ArtifactContent, ...(supersedes ? {supersedes} : {})}, recordedBy);
    return {status: "RECORDED", kind, phase, artifactId: art.id, version: art.version};
  }

  // //TR: Kaydedilmiş DRAFT'ı MEVCUT onay mekanizmasıyla SUBMITTED->APPROVED yapar ve o fazdan sonraki faza ilerletir. Kaydeden submit eder; onaylayan kaydedenden bağımsız olmalı ve evidenceRefs boş olamaz (bunları store zorlar; driver zayıflatmaz). APPROVED değilse faz kapısı ilerlemeyi reddeder.
  approveAndAdvance(scope: Scope, missionId: string, artifactId: string, approver: string, evidenceRefs: string[]): {phase: PreDevPhase} {
    const rm = this.deps.store.preDevReadModel(scope, missionId);
    if (!rm.active || rm.preDevId === null) throw new PreDevDriverError("PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE");
    const art = this.deps.store.getPreDevArtifact(scope, artifactId);
    if (!art) throw new PreDevDriverError("PREDEV_DRIVER_ARTIFACT_NOT_FOUND");
    const next = PRE_DEV_PHASE_TRANSITIONS[rm.phase as PreDevPhase][0];
    if (!next) throw new PreDevDriverError(`PREDEV_DRIVER_NO_NEXT_PHASE:${rm.phase}`);

    // //TR: Devam (resume): artefakt ZATEN APPROVED, bu fazın türünün MEVCUT artefaktı ve faz henüz ilerlememişse (önceki denemede APPROVED yazıldı, ilerleme yazımı ENOSPC/çökme ile kaybedildi) yalnız bekleyen ilerleme yapılır. Kapılar aynı kalır: onaylanan kayıt kapılarını APPROVED yazılırken geçti (bağımsızlık, kanıt); ilerleten aktör de kaydedenden bağımsız olmalıdır ve faz sırası store'ca yeniden doğrulanır. Başka her APPROVED artefakt eskisi gibi store'ca reddedilir (geçersiz geçiş).
    if (art.state === "APPROVED") {
      const kind = PHASE_ARTIFACT_KIND[rm.phase as PreDevPhase];
      if (kind && art.kind === kind && rm.artifacts[kind].artifactId === art.id) {
        if (approver === art.recordedBy) throw new PreDevDriverError("PREDEV_APPROVER_NOT_INDEPENDENT");
        const seq = this.deps.store.advancePreDevPhase(scope, rm.preDevId, next, approver);
        return {phase: seq.phase};
      }
    }
    // //TR: Submit yalnız DRAFT iken yapılır (idempotent): önceki bir onay denemesi (ör. bağımsızlık/kanıt kapısına takılan) zaten SUBMITTED yapmışsa yeniden submit edilmez; kapılar yine mevcut mekanizmaca zorlanır.
    if (art.state === "DRAFT") this.deps.store.transitionPreDevArtifact(scope, rm.preDevId, artifactId, "SUBMITTED", {}, art.recordedBy);
    this.deps.store.transitionPreDevArtifact(scope, rm.preDevId, artifactId, "APPROVED", {evidenceRefs}, approver);
    const seq = this.deps.store.advancePreDevPhase(scope, rm.preDevId, next, approver);
    return {phase: seq.phase};
  }

  // //TR: Kaydedilmiş bir DRAFT'ı MEVCUT mekanizmayla reddeder (reviewer reddi): SUBMITTED->REJECTED, dürüst reason ile. Faz İLERLEMEZ. (Bu, doğrulayıcı reddinden farklıdır: burada yapısal olarak geçerli ama reviewer'ca reddedilen bir taslak söz konusudur.)
  reject(scope: Scope, missionId: string, artifactId: string, reviewer: string, reason: string): PreDevArtifact {
    const rm = this.deps.store.preDevReadModel(scope, missionId);
    if (!rm.active || rm.preDevId === null) throw new PreDevDriverError("PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE");
    const art = this.deps.store.getPreDevArtifact(scope, artifactId);
    if (!art) throw new PreDevDriverError("PREDEV_DRIVER_ARTIFACT_NOT_FOUND");
    if (art.state === "DRAFT") this.deps.store.transitionPreDevArtifact(scope, rm.preDevId, artifactId, "SUBMITTED", {}, art.recordedBy);
    return this.deps.store.transitionPreDevArtifact(scope, rm.preDevId, artifactId, "REJECTED", {reason}, reviewer);
  }
}
