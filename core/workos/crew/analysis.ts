// //TR: C-FLOW-ANALYSIS-1: ANALİZ adımı = fikir (intake'in mission'ı) -> BA / Requirements (kabul kriterleri) / Plan (iş paketleri) / Architecture -> görev planı. Mevcut PreDevDriver + bağlı rol profilleri (RoleExecutionProfile) + enjekte edilen BuilderPort üzerinden yürür; ayrı bir state/store YOKTUR (artefaktlar pre-dev journal'ındadır, mevcut pre-dev karar route'ları bunları aynen okur/onaylar).
// //TR: Dürüstlük: hazır değilse (rol bağı eksik, CLI yok/.cmd başlatıcı, başlatıcı kanıtı yok, iki Claude profilinden biri oturumsuz) ücretli iş HİÇ başlamaz, hiçbir şey kaydedilmez ve kesin engel kodu + Founder'ın yapacağı iş döner (BLOCKED); "analiz bitti" ASLA uydurulmaz. Üretilen her taslak MEVCUT doğrulayıcılardan geçmeden kaydedilmez ve yalnız bağımsız Founder onayıyla APPROVED olur (kaydeden = PREDEV_AGENT_ACTOR).
import {assertRoleExecutes, FIRST_DELIVERY_BINDINGS} from "../../agents/first-delivery-bindings.js";
import type {RoleExecutionProfile} from "../../agents/role-execution.js";
import {CLAUDE_PROFILE_ROLES, claudeRoleReadiness, detectClaudeCli} from "../claude-profiles.js";
import type {ClaudeCliStatus, ClaudeProfileOptions, ClaudeProfileRole, ClaudeRoleReadiness} from "../claude-profiles.js";
import {PREDEV_AGENT_ACTOR, PreDevBuilderError} from "../predev/claude-builder.js";
import {briefFromRecords} from "../predev/brief.js";
import {PreDevDriver, PreDevDriverError} from "../predev/driver.js";
import type {BuilderPort} from "../predev/driver.js";
import type {ArchitectureContent, ArtifactKind, PlanContent, RequirementsContent, WorkPackage} from "../predev/types.js";
import {PRE_DEV_ROLE_MAP} from "../predev/types.js";
import {PREDEV_KIND_FUNCTION} from "../predev/claude-builder.js";
import {PlanError, submitPlan} from "../plan.js";
import type {PlanInput} from "../plan.js";
import type {Scope, WorkTask} from "../types.js";
import type {WorkOsStore} from "../store.js";
import {bindingForKind, buildCrewPlan} from "./assignment.js";

// //TR: Analizin kapsadığı artefaktlar (sıra pre-dev faz sırasıdır: BA -> Requirements -> Plan -> Architecture). UxSpec analiz değildir; UX_DESIGN fazı Architecture onayından sonra açık kalır.
export const ANALYSIS_KINDS: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture"];
export const MAX_PLAN_TASKS = 50; // plan.ts planCreateSchema ile aynı sınır; aşılırsa sessizce kesilmez

// //TR: Üretim BuilderPort'u yoksa (LOCAL_CLAUDE seçili değil) route bunu verir: hazırlık geçse bile adım dürüstçe BUILDER_FAILED/PREDEV_DRIVER_BUILDER_NOT_CONFIGURED döner, hiçbir şey uydurulmaz.
export const NO_ANALYSIS_BUILDER: BuilderPort = {produce: async () => { throw new PreDevDriverError("PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"); }};

export class AnalysisError extends Error {
  constructor(readonly code: "ANALYSIS_MISSION_NOT_FOUND" | "ANALYSIS_PROJECT_NOT_FOUND") { super(code); this.name = "AnalysisError"; }
}

// ---- Hazırlık ----
export interface AnalysisReadiness {
  ready: boolean;
  // Sıralı kesin kodlar (rol bağı, CLI/başlatıcı, oturum) ve ilk engel; hazırsa boş/null.
  blockers: string[]; blocker: string | null; founderAction: string | null;
  // Hangi profilin neden hazır olmadığı (iki profil ayrı): arayüz Founder'ın kendi giriş komutunu buradan gösterir. Rol bağı engeli profil okumasını atlatmaz.
  profiles: Record<ClaudeProfileRole, ClaudeRoleReadiness> | null;
}
export interface ClaudeAnalysisReadinessOptions {
  controlRoot: string; profile?: ClaudeProfileOptions; cli?: ClaudeCliStatus; bindings?: readonly RoleExecutionProfile[];
}
// //TR: RoleExecutionProfile kapısı (dört analiz rolü bağlı ve yürütülebilir) + Claude CLI/başlatıcı kanıtı + İKİ Claude profilinin (implementer, reviewer) oturumu. Pre-dev üretimi reviewer rotasını kullanır; implementer profili akışın sonraki adımı içindir ve Founder tek seferde eksiksiz kurulum görsün diye burada da zorunludur.
export function claudeAnalysisReadiness(o: ClaudeAnalysisReadinessOptions): AnalysisReadiness {
  const blockers: string[] = [], actions: string[] = [];
  const bindings = o.bindings ?? FIRST_DELIVERY_BINDINGS, plan = buildCrewPlan();
  for (const kind of ANALYSIS_KINDS) {
    const b = bindingForKind(plan, kind);
    try { assertRoleExecutes(b.primaryRoleId, PREDEV_KIND_FUNCTION[kind], bindings); }
    catch (e) { blockers.push((e as Error).message.slice(0, 200)); actions.push(`The ${kind} role (${b.primaryRoleId}) is not bound to an executable profile; this is a product configuration problem, not something the Founder can fix in Settings.`); }
  }
  const cli = o.cli ?? detectClaudeCli();
  const profiles = Object.fromEntries(CLAUDE_PROFILE_ROLES.map(r => [r, claudeRoleReadiness(o.controlRoot, r, {...o.profile, cli})])) as Record<ClaudeProfileRole, ClaudeRoleReadiness>;
  for (const r of CLAUDE_PROFILE_ROLES) for (const [i, code] of profiles[r].blockers.entries()) {
    const shared = !code.startsWith("CLAUDE_PROFILE_"); // CLI ve başlatıcı kodları iki rol için ortaktır: bir kez yazılır
    if (shared && blockers.includes(code)) continue;
    blockers.push(shared ? code : `${r}:${code}`);
    actions.push(i === 0 || !shared ? (profiles[r].founderAction ?? "") : "");
  }
  return {ready: blockers.length === 0, blockers, blocker: blockers[0] ?? null, founderAction: actions.find(a => a) ?? null, profiles};
}

// ---- Adım sonucu ----
export type AnalysisStep =
  | {status: "BLOCKED"; blocker: string; blockers: string[]; founderAction: string | null; readiness: AnalysisReadiness}
  | {status: "DRAFT_READY"; kind: ArtifactKind; artifactId: string; version: number; roleId: string; next: "FOUNDER_APPROVAL"}
  | {status: "AWAITING_APPROVAL"; kind: ArtifactKind; artifactId: string; artifactState: "DRAFT" | "SUBMITTED"; next: "FOUNDER_APPROVAL"}
  | {status: "REJECTED"; kind: ArtifactKind; reason: string}
  | {status: "BUILDER_FAILED"; kind: ArtifactKind; code: string}
  | {status: "COMPLETE"; approved: ArtifactKind[]};

// ---- Plan taslağı ----
export interface PlanTaskTrace { index: number; workPackageId: string; estimate: string; satisfies: string[]; requirements: {id: string; statement: string; acceptanceCriteria: string[]}[] }
export interface AnalysisSummary {
  requirements: {functional: number; nonFunctional: number; acceptanceCriteria: number};
  architecture: {components: string[]; techChoices: string[]};
  plan: {workPackages: number; milestones: number};
}
export type PlanDraftCode = "ANALYSIS_NOT_COMPLETE" | "PLAN_TOO_LARGE" | "PLAN_DEPENDENCY_UNKNOWN" | "PLAN_CYCLE";
export type PlanDraft = {ok: true; body: PlanInput; trace: PlanTaskTrace[]; summary: AnalysisSummary} | {ok: false; code: PlanDraftCode; detail: string};

// //TR: İş paketleri bağımlılık sırasına dizilir (kararlı: bağımlılığı hazır olan ilk paket özgün sırayla seçilir) çünkü plan.ts yalnız ÖNCEKİ görevlere bağımlılık kabul eder. Başlık "<iş paketi kimliği>: <başlık>" (en çok 200). Sessiz kesme/uydurma yok: 50'yi aşan, bilinmeyen bağımlılık veya döngü kesin kodla reddedilir.
export function tasksFromPlan(plan: PlanContent, requirements: RequirementsContent): {ok: true; body: PlanInput; trace: PlanTaskTrace[]} | {ok: false; code: PlanDraftCode; detail: string} {
  const wps = plan.workPackages;
  if (wps.length > MAX_PLAN_TASKS) return {ok: false, code: "PLAN_TOO_LARGE", detail: `${wps.length} work packages; at most ${MAX_PLAN_TASKS} tasks fit one plan`};
  const ids = new Set(wps.map(w => w.id));
  for (const w of wps) for (const d of w.dependsOn) if (!ids.has(d)) return {ok: false, code: "PLAN_DEPENDENCY_UNKNOWN", detail: `${w.id} depends on ${d}`};
  const placed: WorkPackage[] = [], left = [...wps];
  while (left.length > 0) {
    const i = left.findIndex(w => w.dependsOn.every(d => placed.some(p => p.id === d)));
    if (i < 0) return {ok: false, code: "PLAN_CYCLE", detail: left.map(w => w.id).join(",")};
    placed.push(left.splice(i, 1)[0]);
  }
  const index = new Map(placed.map((w, i) => [w.id, i]));
  const reqs = new Map([...requirements.functional, ...requirements.nonFunctional].map(r => [r.id, r]));
  const body: PlanInput = {tasks: placed.map(w => ({title: `${w.id}: ${w.title}`.slice(0, 200), ...(w.dependsOn.length > 0 ? {dependsOn: w.dependsOn.map(d => index.get(d)!).sort((a, b) => a - b)} : {})}))};
  const trace: PlanTaskTrace[] = placed.map((w, i) => ({index: i, workPackageId: w.id, estimate: w.estimate, satisfies: [...w.satisfies],
    requirements: w.satisfies.flatMap(id => { const r = reqs.get(id); return r ? [{id: r.id, statement: r.statement, acceptanceCriteria: [...r.acceptanceCriteria]}] : []; })}));
  return {ok: true, body, trace};
}

export interface AnalysisDeps {
  store: WorkOsStore; scope: Scope; builder: BuilderPort;
  // Üretimden ÖNCE sorulur (ücretli iş yalnız hazırsa başlar); üretimde claudeAnalysisReadiness, testte enjekte edilir.
  readiness: () => AnalysisReadiness;
}

export class AnalysisFlow {
  constructor(private readonly d: AnalysisDeps) {}

  private driver(missionId: string): PreDevDriver {
    const mission = this.d.store.getMission(this.d.scope, missionId);
    if (!mission) throw new AnalysisError("ANALYSIS_MISSION_NOT_FOUND");
    const project = this.d.store.getProject(this.d.scope, mission.projectId);
    if (!project) throw new AnalysisError("ANALYSIS_PROJECT_NOT_FOUND");
    return new PreDevDriver({store: this.d.store, brief: briefFromRecords({project, mission}), builder: this.d.builder});
  }

  // //TR: Bir adım = O ANKİ analiz fazının taslağını üretmek. Sıra: tamam mı? -> bekleyen taslak var mı (ücretli iş yok) -> hazır mı (değilse BLOCKED, hiçbir şey açılmaz/kaydedilmez) -> dizi aç/devam et -> üret -> mevcut doğrulayıcı kapısı -> DRAFT kaydı. Faz ilerlemesi yalnız Founder'ın bağımsız onayıyla olur (pre-dev karar route'ları).
  async step(missionId: string): Promise<AnalysisStep> {
    const driver = this.driver(missionId), scope = this.d.scope;
    const rm = this.d.store.preDevReadModel(scope, missionId);
    const approved = ANALYSIS_KINDS.filter(k => rm.artifacts[k].state === "APPROVED");
    if (approved.length === ANALYSIS_KINDS.length) return {status: "COMPLETE", approved};
    const pending = ANALYSIS_KINDS.find(k => rm.artifacts[k].artifactId !== null && (rm.artifacts[k].state === "DRAFT" || rm.artifacts[k].state === "SUBMITTED"));
    if (pending) return {status: "AWAITING_APPROVAL", kind: pending, artifactId: rm.artifacts[pending].artifactId!, artifactState: rm.artifacts[pending].state as "DRAFT" | "SUBMITTED", next: "FOUNDER_APPROVAL"};
    const readiness = this.d.readiness();
    if (!readiness.ready) return {status: "BLOCKED", blocker: readiness.blocker ?? "ANALYSIS_NOT_READY", blockers: readiness.blockers, founderAction: readiness.founderAction, readiness};
    if (!rm.active || rm.phase === "AUTHORIZED") driver.start(scope, missionId, PREDEV_AGENT_ACTOR); // dizi yoksa (veya ilk ilerleme yazımı yarım kaldıysa) açılır/tamamlanır; sonraki fazlarda dokunulmaz
    const phaseKind = ANALYSIS_KINDS.find(k => rm.artifacts[k].state !== "APPROVED")!;
    try {
      const out = await driver.produceCurrentPhase(scope, missionId, PREDEV_AGENT_ACTOR);
      if (out.status === "REJECTED") return {status: "REJECTED", kind: out.kind, reason: out.reason};
      return {status: "DRAFT_READY", kind: out.kind, artifactId: out.artifactId, version: out.version, roleId: PRE_DEV_ROLE_MAP[out.kind][0], next: "FOUNDER_APPROVAL"};
    } catch (e) {
      if (e instanceof PreDevBuilderError) return {status: "BUILDER_FAILED", kind: phaseKind, code: e.code};
      if (e instanceof PreDevDriverError) return {status: "BUILDER_FAILED", kind: phaseKind, code: e.message.slice(0, 120)};
      throw e;
    }
  }

  // //TR: Onaylı artefaktlardan görev planı taslağı: analiz tamam (dört tür APPROVED) değilse ANALYSIS_NOT_COMPLETE. Kimliklendirilmiş iz (iş paketi -> gereksinim -> kabul kriteri) ve Founder'a gösterilecek özet döner.
  planFromApproved(missionId: string): PlanDraft {
    const scope = this.d.scope;
    const rm = this.d.store.preDevReadModel(scope, missionId);
    const missing = ANALYSIS_KINDS.filter(k => rm.artifacts[k].state !== "APPROVED");
    if (missing.length > 0) return {ok: false, code: "ANALYSIS_NOT_COMPLETE", detail: missing.join(",")};
    const content = <T>(k: ArtifactKind) => this.d.store.getPreDevArtifact(scope, rm.artifacts[k].artifactId!)!.content as T;
    const plan = content<PlanContent>("Plan"), requirements = content<RequirementsContent>("Requirements"), architecture = content<ArchitectureContent>("Architecture");
    const t = tasksFromPlan(plan, requirements);
    if (!t.ok) return t;
    const summary: AnalysisSummary = {
      requirements: {functional: requirements.functional.length, nonFunctional: requirements.nonFunctional.length, acceptanceCriteria: [...requirements.functional, ...requirements.nonFunctional].reduce((n, r) => n + r.acceptanceCriteria.length, 0)},
      architecture: {components: architecture.components.map(c => c.name), techChoices: architecture.techChoices.map(c => c.choice)},
      plan: {workPackages: plan.workPackages.length, milestones: plan.milestones.length}
    };
    return {ok: true, body: t.body, trace: t.trace, summary};
  }

  // //TR: Taslağı MEVCUT plan modülüyle (submitPlan: mission başına tek plan, aynı gövde tekrarında idempotent) görevlere çevirir.
  createPlan(missionId: string, actor: string): {ok: true; tasks: WorkTask[]; replayed: boolean; trace: PlanTaskTrace[]; summary: AnalysisSummary} | {ok: false; code: PlanDraftCode | PlanError["code"]; detail: string} {
    const draft = this.planFromApproved(missionId);
    if (!draft.ok) return draft;
    try {
      const r = submitPlan(this.d.store, this.d.scope, actor, missionId, draft.body);
      return {ok: true, tasks: r.tasks, replayed: r.replayed, trace: draft.trace, summary: draft.summary};
    } catch (e) {
      if (e instanceof PlanError) return {ok: false, code: e.code, detail: e.code};
      throw e;
    }
  }
}
