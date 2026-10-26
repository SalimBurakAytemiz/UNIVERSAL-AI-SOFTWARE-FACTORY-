// //TR: Bu dosya CORE-6 crew DEVELOPMENT + REVIEW kancalarını tanımlar: CORE-5 koordinatörü PRE_DEV_COMPLETE'e (UX onaylı) ulaştıktan sonra crew, MEVCUT CORE-4 kod-üretim hattını (gerçek MissionRunner) ve deterministik teslim/dışa-aktarımı (ProjectStudio.prepareRunDelivery) YENİDEN KULLANARAK tek bir kaynak-düzeyi dev+review koşusu sürer. Builder ve reviewer ENJEKTE edilen portlardır (test'te mock, runtime'da gerçek adaptör); canlı model/ağ/shell YOKTUR ve ÜRETİLEN KOD HİÇ ÇALIŞTIRILMAZ (execution-gate sağlayıcısız = BLOCKED(SANDBOX_UNAVAILABLE), M1a). DEVELOPMENT: BuilderPort onaylı Architecture/Plan/Requirements'a göre kaynak üretir (CORE-4 ile aynı sözleşme: dosya haritası), gerçek runner commit eder ve gerçek prepareRunDelivery deterministik artefakta (runId + sourceCommit + exportArtifactHash) paketler. REVIEW: ENJEKTE edilen ReviewerPort bağımsız bir reviewer/QA ROLÜ (gerçek katalog rol kimliği; aktör developer rolünden FARKLI olmalı) olarak üretilen kaynağı + kanıtı inceler ve REVIEW_CLEAN | REWORK_REQUESTED(sebep) kaydeder. REWORK, runner'ın MEVCUT sınırlı remediation döngüsüyle (gate-uyumlu, asla geri gitmeyen, asla kendiliğinden onaylamayan) gerçeklenir: reviewer BLOCKED -> yeni (supersede eden) kaynak sürüm -> yeniden review; sınır (maxRemediations) aşılırsa FAIL-CLOSED (REVIEW_REWORK_LIMIT_EXCEEDED, teslim YOK). Verdict ASLA uydurulmaz; port'tan gelir ve gerçek REVIEW kanıtına kaydedilir.
// //TR: GATE GERÇEĞİ: Bu katman hiçbir kapıyı zayıflatmaz. Bağımsız review (reviewer.identity != implementer.identity) store/runner tarafından zorlanır; test/güvenlik kapıları gerçek runner'dadır; teslim yalnız run SOURCE_GENERATION_COMPLETE (AWAITING_APPROVAL + gerekli kanıt zinciri) olduğunda hazırlanır. Hiçbir mission PRODUCT_VERIFIED'a ulaşmaz ve execution-gate üretilen kodu çalıştırmak için ASLA çağrılmaz (sandbox yok). Ledger yalnız gerçek kaydedilmiş journal olaylarından (run evidence/checkpoints + teslim kaydı) türetilir; uydurma aktivite yoktur.
import fs from "node:fs";
import path from "node:path";
import {agentConfigInWorkspace, commitBuilderOutputAsync, gitControlDigest} from "../builder-output.js";
import {sourceGenerationOf} from "../outcomes.js";
import {assertRoleExecutes} from "../../agents/first-delivery-bindings.js";
import type {ProjectStudio} from "../project-studio.js";
import type {
  ExecContext, ExecutorPair, ImplementerAdapter, ImplementResult, MissionSpec, ReviewerAdapter, ReviewResult
} from "../executors.js";
import type {DeliveryArtifactRecord, Project, Scope, WorkRun} from "../types.js";

export class CrewDevReviewError extends Error {
  constructor(message: string) { super(message); this.name = "CrewDevReviewError"; }
}

// //TR: DEVELOPMENT portu: bir projenin kaynağını (göreli yol -> içerik haritası) üretir; CORE-4 kod-üretim sözleşmesinin aynısı. attempt=0 ilk üretimdir; attempt>0 bir REWORK talebine yanıt olarak SUPERSEDE eden yeni bir kaynak sürümdür (önceki sürümden farklı olmalı; aksi halde runner değişiklik yok diye reddeder). Üretilen içerik ASLA çalıştırılmaz.
export interface DevBuildContext {
  attempt: number;
  missionId: string;
  runId: string;
  startSha: string;
  rework?: {reason: string; findings: readonly string[]};
}
export interface DevBuildOutput { files: Record<string, string>; deleteFiles?: readonly string[] }
export interface DevBuilderPort { build(ctx: DevBuildContext): Promise<DevBuildOutput> }

// //TR: REVIEW portu: bağımsız reviewer/QA rolünün üretilen kaynak + kanıt üzerindeki dürüst, deterministik kararı. REWORK_REQUESTED sabit bir sebep taşır (uydurma değil; gerçek REVIEW kanıtına ve rework döngüsüne verilecek sebeple aynıdır). Bu port model/ağ/shell kapsüller (test'te kayıtlı karar, runtime'da gerçek değerlendirme) ve review klonunu ASLA değiştirmez (yalnız okur).
export type ReviewVerdict = {verdict: "REVIEW_CLEAN"} | {verdict: "REWORK_REQUESTED"; reason: string};
export interface DevReviewContext {
  attempt: number;
  runId: string;
  baseCommit: string;
  diff: string;
  cleanClone: string;
}
export interface DevReviewerPort { review(ctx: DevReviewContext): Promise<ReviewVerdict> }

// //TR: crew'un ihtiyaç duyduğu dar store yüzeyi (WorkOsStore yapısal olarak karşılar): run oluşturma + teslim kaydı. Ayrı store KURULMAZ; tüm yazmalar mevcut hash-zincirli journal'a gider.
export interface DevReviewStore {
  createRun(input: {tenantId: string; missionId: string; roleId?: string | null; executor: {implementer: string; reviewer: string}; createdBy: string; idempotencyKey?: string}): WorkRun;
  getRun(scope: Scope, runId: string): WorkRun | undefined;
  recordDeliveryArtifact(scope: Scope, runId: string, rec: DeliveryArtifactRecord, actor: string): {record: DeliveryArtifactRecord; run: WorkRun; recorded: boolean};
}

// //TR: Enjekte edilen geliştirme motoru: crew'un kurduğu executor çifti ile bir run'ı terminal duruma kadar süren GERÇEK runner'ı sarar. runner yapılandırması (execution-gate [sağlayıcısız], güvenlik araçları, global-stop, dataDir) buraya enjekte edilir; crew bu yapılandırmayı sabitlemez, yalnız portları executor'a köprüler ve orkestrasyon + teslim + ledger'ı sahiplenir.
export interface DevelopmentEngine { drive(runId: string): Promise<WorkRun> }

export interface CrewDevReviewDeps {
  store: DevReviewStore;
  studio: ProjectStudio;
  builder: DevBuilderPort;
  reviewer: DevReviewerPort;
  // Developer (implementer) ve ONDAN BAĞIMSIZ reviewer/QA katalog rol kimlikleri; bağımsızlığı store/runner zorlar.
  developerRoleId: string;
  reviewerRoleId: string;
  envPolicyFile: string;
  // crew'un kurduğu executor çifti ile GERÇEK runner'ı inşa eden fabrika (execution-gate sağlayıcısız olmalı: üretilen kod çalıştırılmaz).
  makeEngine: (executors: ExecutorPair) => DevelopmentEngine;
  createdBy: string;
}

export type DevReviewResult =
  | {status: "DELIVERED"; runId: string; run: WorkRun; delivery: DeliveryArtifactRecord; reviewRework: number}
  | {status: "REVIEW_REWORK_LIMIT_EXCEEDED"; runId: string; run: WorkRun; reason: string}
  | {status: "DEV_BLOCKED"; runId: string; run: WorkRun; reason: string};

const SHA = /^[0-9a-f]{40}$/;

// //TR: Bir göreli yolu çalışma alanının İÇİNDE güvenli mutlak yola çevirir; dışarı kaçış, boş/nokta parçaları ve .git fail-closed reddedilir (commitBuilderOutput ayrıca forbiddenChange uygular).
function safeWorkspacePath(workspace: string, rel: string): string {
  if (typeof rel !== "string" || rel === "") throw new CrewDevReviewError("CREW_DEV_PATH_INVALID");
  const parts = rel.split(/[\\/]+/);
  if (parts.some(s => s === "" || s === "." || s === ".." || s.toLowerCase() === ".git")) throw new CrewDevReviewError(`CREW_DEV_PATH_FORBIDDEN:${rel.slice(0, 80)}`);
  const abs = path.resolve(workspace, parts.join(path.sep));
  const base = path.resolve(workspace);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new CrewDevReviewError(`CREW_DEV_PATH_ESCAPE:${rel.slice(0, 80)}`);
  return abs;
}

// //TR: DEVELOPMENT adaptörü: enjekte edilen BuilderPort'un ürettiği dosyaları çalışma alanına yazar ve MEVCUT engine-owned commit (commitBuilderOutput) ile commit eder. Hiçbir süreç başlatılmaz (builder saf veri üretir); .git'e dokunulmaz; değişiklik yoksa veya yasak yol değişirse engine commit'i reddeder ve run BLOCKED olur. SBX-8: çalışma alanında ajan yapılandırması varsa builder hiç çalışmaz.
function makeDevImplementer(identity: string, builder: DevBuilderPort, envPolicyFile: string): ImplementerAdapter {
  return {
    identity,
    async implement(workspace: string, spec: MissionSpec, ctx: ExecContext): Promise<ImplementResult> {
      const startedAt = new Date().toISOString();
      const sp: <T>(fn: () => T) => T = ctx.span ?? (fn => fn()); // HB-1: küçük senkron .git/yol işleri runner span'ına sarılır, engine commit'i eşzamansızdır
      const startSha = spec.startSha ?? "";
      const base = (log: string, blockReason?: string): ImplementResult =>
        ({exitCode: 0, ...(blockReason ? {blockReason} : {}), log, argv: ["crew-dev-builder", identity], startedAt, endedAt: new Date().toISOString(), timedOut: false, aborted: false, transient: false});
      const agentConfig = sp(() => agentConfigInWorkspace(workspace, envPolicyFile));
      if (agentConfig === null) return base("NOT_EXECUTED: WORKSPACE_AGENT_CONFIG_SCAN_FAILED (builder not started)\n", "WORKSPACE_AGENT_CONFIG_SCAN_FAILED");
      if (agentConfig.length) return base(`NOT_EXECUTED: WORKSPACE_CONTAINS_AGENT_CONFIG (builder not started)\n${agentConfig.slice(0, 50).map(f => `  ${f}`).join("\n")}\n`, "WORKSPACE_CONTAINS_AGENT_CONFIG");
      const gitDigestBefore = sp(() => gitControlDigest(workspace));
      let out: DevBuildOutput;
      try {
        out = await builder.build({attempt: spec.cycle, missionId: spec.missionId, runId: spec.runId, startSha, ...(spec.remediation ? {rework: {reason: spec.remediation.reason, findings: spec.remediation.findings}} : {})});
      } catch (e) {
        return base(`BUILDER_PORT_ERROR: ${(e as Error).message}\n`, "CREW_DEV_BUILDER_PORT_ERROR");
      }
      try {
        for (const rel of out.deleteFiles ?? []) { const abs = safeWorkspacePath(workspace, rel); fs.rmSync(abs, {force: true}); }
        for (const [rel, content] of Object.entries(out.files)) {
          const abs = safeWorkspacePath(workspace, rel);
          fs.mkdirSync(path.dirname(abs), {recursive: true});
          fs.writeFileSync(abs, content);
        }
      } catch (e) {
        return base(`BUILDER_WRITE_REFUSED: ${(e as Error).message}\n`, e instanceof CrewDevReviewError ? e.message : "CREW_DEV_WRITE_FAILED");
      }
      const subject = `uasco run ${spec.runId} cycle ${spec.cycle}: ${String(spec.title).replace(/[\r\n]+/g, " ").slice(0, 120)}`;
      const c = await commitBuilderOutputAsync(workspace, {envPolicyFile, startSha, gitDigestBefore, message: `${subject}\n\nMission: ${spec.missionId}\nCommitted by the UASCO engine on behalf of ${identity} (crew development builder, edit-only).`}, {span: sp});
      return c.ok ? {...base(c.log), commitSha: c.commitSha} : base(c.log, c.reason);
    }
  };
}

// //TR: REVIEW adaptörü: enjekte edilen ReviewerPort'un kararını MEVCUT runner REVIEW kanıtına köprüler. REVIEW_CLEAN -> CLEAN (run REGRESSION/REPORT'a ilerler); REWORK_REQUESTED -> BLOCKED + tek bulgu (title=sebep), runner bunu sınırlı remediation (supersede eden yeni kaynak sürüm + yeniden review) ile işler. Adaptör salt-okunur klona HİÇ yazmaz; verdict ASLA uydurulmaz.
function makeDevReviewer(identity: string, reviewer: DevReviewerPort): ReviewerAdapter {
  return {
    identity,
    async review(cleanClone: string, spec: MissionSpec, diff: string, _ctx: ExecContext): Promise<ReviewResult> {
      const startedAt = new Date().toISOString();
      const base = (log: string): Omit<ReviewResult, "verdict" | "findings" | "valid"> =>
        ({exitCode: 0, log, argv: ["crew-dev-reviewer", identity], startedAt, endedAt: new Date().toISOString(), timedOut: false, aborted: false, transient: false});
      let v: ReviewVerdict;
      try {
        v = await reviewer.review({attempt: spec.cycle, runId: spec.runId, baseCommit: spec.baseSha, diff, cleanClone});
      } catch (e) {
        // Port hatası geçersiz review'dur: ASLA CLEAN değildir; runner fail-closed işler.
        return {verdict: "BLOCKED", findings: [], valid: false, invalidReason: "CREW_REVIEW_PORT_ERROR", ...base(`REVIEW_PORT_ERROR: ${(e as Error).message}\n`)};
      }
      if (v.verdict === "REVIEW_CLEAN") return {verdict: "CLEAN", findings: [], valid: true, ...base("REVIEW_CLEAN\n")};
      const reason = String(v.reason ?? "").slice(0, 300) || "REWORK_REQUESTED";
      return {verdict: "BLOCKED", findings: [{severity: "REWORK", title: reason}], valid: true, ...base(`REWORK_REQUESTED ${reason}\n`)};
    }
  };
}

// //TR: Enjekte edilen portlardan bağımsız bir executor çifti kurar (implementer=developer rolü, reviewer=QA/review rolü; store/runner aynı kimliği reddeder). Köprüdür; yeni rol eklemez, hiçbir rolü certified yapmaz.
export function crewDevExecutors(developerRoleId: string, reviewerRoleId: string, builder: DevBuilderPort, reviewer: DevReviewerPort, envPolicyFile: string): ExecutorPair {
  if (developerRoleId === reviewerRoleId) throw new CrewDevReviewError("CREW_REVIEWER_NOT_INDEPENDENT");
  // //TR: Rol TANIMI çalışan ajan değildir: yalnız tam yürütme bağlaması olan roller (developer / security-reviewer) executor çiftine girebilir.
  try { assertRoleExecutes(developerRoleId, "developer"); assertRoleExecutes(reviewerRoleId, "security-reviewer"); } catch (e) { throw new CrewDevReviewError((e as Error).message); }
  return {kind: "FAKE", implementer: makeDevImplementer(developerRoleId, builder, envPolicyFile), reviewer: makeDevReviewer(reviewerRoleId, reviewer)};
}

// //TR: CORE-6 dev+review orkestratörü. PRE_DEV_COMPLETE'ten sonra çağrılır: portlardan executor çifti kurar, run oluşturur, GERÇEK runner'ı (enjekte motor) terminal duruma kadar sürer ve sonucu dürüstçe yorumlar. SOURCE_GENERATION_COMPLETE (AWAITING_APPROVAL + kanıt zinciri) -> gerçek prepareRunDelivery ile deterministik teslim + journal kaydı. Review-rework sınırı aşılırsa (runner BLOCKED(REVIEW_BLOCKED...)) fail-closed. Asla merge/push/COMPLETE yapmaz; hiçbir mission PRODUCT_VERIFIED'a ulaşmaz.
export class CrewDevReview {
  constructor(private readonly deps: CrewDevReviewDeps) {
    if (deps.developerRoleId === deps.reviewerRoleId) throw new CrewDevReviewError("CREW_REVIEWER_NOT_INDEPENDENT");
  }

  async run(scope: Scope, project: Project, missionId: string): Promise<DevReviewResult> {
    const {store, studio, developerRoleId, reviewerRoleId, builder, reviewer, envPolicyFile, makeEngine, createdBy} = this.deps;
    if (project.tenantId !== scope.tenantId) throw new CrewDevReviewError("CREW_DEV_PROJECT_TENANT_MISMATCH");
    const executors = crewDevExecutors(developerRoleId, reviewerRoleId, builder, reviewer, envPolicyFile);
    const created = store.createRun({tenantId: scope.tenantId, missionId, roleId: developerRoleId, executor: {implementer: developerRoleId, reviewer: reviewerRoleId}, createdBy});
    const engine = makeEngine(executors);
    const run = await engine.drive(created.runId);

    if (run.status === "AWAITING_APPROVAL" && sourceGenerationOf(run).state === "SOURCE_GENERATION_COMPLETE") {
      if (run.projectId !== project.projectId) throw new CrewDevReviewError("CREW_DEV_RUN_PROJECT_MISMATCH");
      const rec = studio.prepareRunDelivery(project, run);
      const {record, run: delivered} = store.recordDeliveryArtifact(scope, run.runId, rec, developerRoleId);
      return {status: "DELIVERED", runId: run.runId, run: delivered, delivery: record, reviewRework: delivered.remediationCycle};
    }
    const reason = run.reason ?? run.status;
    // Review tarafından tetiklenen sınırlı rework döngüsü sınırı aştıysa fail-closed (REVIEW_REWORK_LIMIT_EXCEEDED).
    if (run.status === "BLOCKED" && /^REVIEW_BLOCKED/.test(reason)) {
      return {status: "REVIEW_REWORK_LIMIT_EXCEEDED", runId: run.runId, run, reason};
    }
    return {status: "DEV_BLOCKED", runId: run.runId, run, reason};
  }
}

// ---- Ledger: pre-dev -> development -> review tek denetlenebilir zaman çizelgesi (yalnız gerçek journal olaylarından türetilir) ----

export type DevReviewVerdict = "REVIEW_CLEAN" | "REWORK_REQUESTED" | "NONE";

// //TR: Tek bir kaynak sürümü (remediation cycle): üreten developer rolü, üretilen commit (IMPLEMENT kanıtı), ve o sürüme verilen reviewer kararı. Tümü gerçek run kanıtından/checkpoint'inden türetilir; hiçbir alan tahmin edilmez.
export interface DevSourceVersion {
  cycle: number;
  sourceCommit: string | null;
  developerRoleId: string;
  reviewerRoleId: string;
  reviewVerdict: DevReviewVerdict;
  reviewReason: string | null;
}

export interface DevReviewTimeline {
  runId: string;
  missionId: string;
  developerRoleId: string;
  reviewerRoleId: string;
  versions: DevSourceVersion[];
  finalVerdict: DevReviewVerdict | "REVIEW_REWORK_LIMIT_EXCEEDED";
  delivery: {sourceCommit: string; treeSha: string; exportArtifactHash: string} | null;
}

// //TR: GERÇEK run'dan (journal replay ürünü) dev+review zaman çizelgesini türetir: her remediation cycle bir kaynak sürümdür; sürümün commit'i o cycle'ın IMPLEMENT kanıtından, reviewer kararı o cycle'ın REVIEW kanıtından (CLEAN) veya REMEDIATE checkpoint'inden (REWORK, sebep bulgulardan) gelir. Teslim varsa (DELIVERY_ARTIFACT_PREPARED kaydı run.deliveryArtifact) hash eklenir. Saf fonksiyon; uydurma aktivite yok.
export function deriveDevReviewTimeline(run: WorkRun, developerRoleId: string, reviewerRoleId: string): DevReviewTimeline {
  const cycles = new Map<number, DevSourceVersion>();
  const ensure = (cycle: number): DevSourceVersion => {
    let v = cycles.get(cycle);
    if (!v) { v = {cycle, sourceCommit: null, developerRoleId, reviewerRoleId, reviewVerdict: "NONE", reviewReason: null}; cycles.set(cycle, v); }
    return v;
  };
  for (const e of run.evidence) {
    if (e.kind === "IMPLEMENT" && typeof e.commitSha === "string" && SHA.test(e.commitSha) && e.exitCode === 0) ensure(e.cycle).sourceCommit = e.commitSha;
    if (e.kind === "REVIEW" && e.verdict === "CLEAN") { const v = ensure(e.cycle); v.reviewVerdict = "REVIEW_CLEAN"; }
  }
  // REWORK kararları gerçek REMEDIATE checkpoint'lerinden (reason=REVIEW_BLOCKED, findings=[REWORK sebebi]) türetilir.
  for (const cp of run.checkpoints) {
    const d = cp.data as {outcome?: unknown; reason?: unknown; findings?: unknown};
    if (d.outcome === "REMEDIATE" && d.reason === "REVIEW_BLOCKED" && cp.step === "REVIEW") {
      const v = ensure(cp.cycle);
      if (v.reviewVerdict !== "REVIEW_CLEAN") { v.reviewVerdict = "REWORK_REQUESTED"; v.reviewReason = Array.isArray(d.findings) ? d.findings.map(String).join("; ").slice(0, 300) : null; }
    }
  }
  const versions = [...cycles.values()].sort((a, b) => a.cycle - b.cycle);
  const delivery = run.deliveryArtifact
    ? {sourceCommit: run.deliveryArtifact.sourceCommit, treeSha: run.deliveryArtifact.treeSha, exportArtifactHash: run.deliveryArtifact.exportArtifactHash}
    : null;
  const lastCleaned = versions.some(v => v.reviewVerdict === "REVIEW_CLEAN");
  const finalVerdict: DevReviewTimeline["finalVerdict"] = delivery && lastCleaned ? "REVIEW_CLEAN"
    : run.status === "BLOCKED" && /^REVIEW_BLOCKED/.test(run.reason ?? "") ? "REVIEW_REWORK_LIMIT_EXCEEDED"
    : versions.length ? (versions[versions.length - 1].reviewVerdict) : "NONE";
  return {runId: run.runId, missionId: run.missionId, developerRoleId, reviewerRoleId, versions, finalVerdict, delivery};
}
