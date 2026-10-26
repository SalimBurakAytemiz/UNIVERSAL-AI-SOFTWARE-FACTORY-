//TR: Bu dosya analiz adımı route'larını sağlar (POST /v1/missions/:id/analysis/step ve /analysis/plan): Lane C'nin AnalysisFlow'u üzerinde ince bir sarmalayıcı; Global Stop 423, politika 403, boş gövde, sıkı id; server.ts'e tek kayıt gerekir (docs/authority-requests/LANE-B-batch-4b.md).
import AjvModule from "ajv";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import {tryProduceLock} from "./produce-lock.js";
import {STATUS as PLAN_ERROR_STATUS} from "./plan.js";
import {PREDEV_OPEN_MISSION_STATUSES} from "../../../../core/workos/predev/types.js";
import type {RouteDeps} from "./deps.js";
import {AnalysisError, AnalysisStoppedError} from "../../../../core/workos/crew/analysis.js";
import type {AnalysisFlow} from "../../../../core/workos/crew/analysis.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
const emptyBody = ajv.compile({type: "object", additionalProperties: false} as const);
const validMissionId = (x: unknown) => typeof x === "string" && /^msn_[0-9a-f]{24}$/.test(x);
// //TR: Fabrika Global Stop denetimini (stopped) alır: akış çalışan ücretli çağrıyı durdurabilsin. Yeni ücretli çağrıyı başlatmayı ZATEN route ön kapısı (423) engeller; fabrika stopped'ı yok sayarsa yalnız çalışırken iptal kaybolur (tipi denetlemez).
// //TR: builderTrace (isteğe bağlı): fabrika, o isteğe ait builder'ın son çağrı özetini (ClaudePreDevBuilder.lastTrace; çağrı başına TAZE örnek) akışa ekleyebilir. Verilirse denetim predev/produce ile aynı alanları taşır ve builderRan kanıta dayanır; verilmezse builderRan bilinmez (null).
export interface AnalysisBuilderTrace { roleId?: string | null; kind?: string | null; identity?: string | null; outputSha256?: string | null; exitCode?: number | null; durationMs?: number | null }
export type AnalysisFlowWithTrace = AnalysisFlow & { builderTrace?: () => AnalysisBuilderTrace | null };
export interface AnalysisRouteDeps extends RouteDeps { analysisFlow: (stopped: () => boolean) => AnalysisFlowWithTrace }

export function registerAnalysisRoutes(app: any, d: AnalysisRouteDeps): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => {
    try { return await fn(req, reply); }
    catch (e) { return e instanceof AnalysisError ? reply.code(404).send({error: e.code}) : d.workosFail(reply, e); }
  };
  const gates = (req: any, reply: any, action: string): boolean => {
    if (!validMissionId(req.params.id)) { reply.code(400).send({error: "INVALID_MISSION_ID"}); return false; }
    const body = req.body ?? {};
    if (d.workosStopped()) { reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); return false; }
    const decision = d.workosPolicy(action, req.params.id, body);
    if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action, reason: decision.reason}); reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); return false; }
    if (!emptyBody(body)) { reply.code(400).send({error: "INVALID_BODY"}); return false; }
    return true;
  };
  // Adım: o anki analiz fazının taslağı. Değerlendirilen her adım (BLOCKED / REJECTED / BUILDER_FAILED / DRAFT_READY / ...) 200 + TAM adım gövdesiyle döner: Desktop köprüsü (sanitizePostBody) >= 400 gövdelerinden yalnız error/code/reason/message bırakır, blocker(s)/kind/code kaybolurdu.
  // İstek hataları aynı kalır (400, 403, 404, 423, 409 kilit). Süreç genelinde AYNI ANDA tek produce kilidi (predev produce ile ORTAK) TÜM adım boyunca tutulur: başka bir produce sürerken ücretsiz sonuçlar (BLOCKED, AWAITING_APPROVAL, ...) da 409 BUSY alır; ANALYSIS_IN_PROGRESS bu route üzerinden ulaşılamaz.
  // Global Stop, akış tarafından (AnalysisDeps.stopped -> AnalysisStoppedError) veya yanıttan önceki yeniden denetimle yakalanır; ikisi de 423 + STOPPED denetimi. Tür ile eşlenir (instanceof), ileti metniyle DEĞİL.
  const isStopped = (e: unknown): boolean => e instanceof AnalysisStoppedError;
  app.post("/v1/missions/:id/analysis/step", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    if (!gates(req, reply, "workos.analysis.step")) return reply;
    const id: string = req.params.id;
    // Misyon var mı? KİLİTTEN ÖNCE (predev produce ile aynı): bilinmeyen misyon çekişmede 409 BUSY değil 404 alır; salt-okunur adımlar ücretli üretim yüzünden reddedilmez.
    if (!d.getStore().getMission(d.scope, id)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
    // Uygunluk: predev produce ile aynı kural; uygun olmayan misyon için builder HİÇ çağrılmaz (ücretsiz 409).
    const mission = d.getStore().getMission(d.scope, id)!;
    if (!d.getStore().preDevReadModel(d.scope, id).active && !PREDEV_OPEN_MISSION_STATUSES.includes(mission.status)) return reply.code(409).send({error: "WORKOS_CONFLICT", reason: "MISSION_NOT_PREDEV_ELIGIBLE"});
    const lock = tryProduceLock(id);
    if (!lock.ok) { d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "REFUSED", reason: lock.error}); return reply.code(409).send({error: lock.error}); }
    try {
      let out;
      let flow: AnalysisFlowWithTrace | undefined, traceThrew = false;
      // Ücretli çağrı özeti (sır/istem yok): rol, tür, yürütücü kimliği, çıktı özeti, çıkış kodu, süre; builder hiç çağrılmadıysa boş.
      const trace = (): AnalysisBuilderTrace | null => { try { return flow?.builderTrace?.() ?? null; } catch { traceThrew = true; return null; } };
      const tf = (): Record<string, unknown> => { const t = trace(); return t ? {roleId: t.roleId ?? null, artifactKind: t.kind ?? null, executor: t.identity ?? null, outputSha256: t.outputSha256 ?? null, exitCode: t.exitCode ?? null, durationMs: t.durationMs ?? null} : {}; };
      // Fabrika da denetlenen bölgededir: fırlatan bir fabrika (ör. builder yapılandırması) FAILED denetimi bırakır.
      try { flow = d.analysisFlow(d.workosStopped); out = await flow.step(id); }
      catch (e) {
        // Ücretli koşu sonrası fırlayan hata (ör. kayıt sırasında WORKOS_DISK_FULL) da denetlenir.
        if (isStopped(e)) { d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "STOPPED", reason: "GLOBAL_STOP_ACTIVE", ...tf()}); return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); }
        // builderRan: KANIT önce. İz varsa builder çağrılmıştır (true, AnalysisError olsa bile); iz yoksa: fabrika fırlattıysa ya da AnalysisError (ücretli çağrıdan önceki istek hatası) ise false; iz kaynağı var ama boş döndüyse false; kaynak yoksa ya da kaynak fırlattıysa BİLİNMEZ (null). detail: WorkOsError "<kod>: <ayrıntı>" ayrıntısı (ör. koşu sırasında MISSION_NOT_PREDEV_ELIGIBLE), yalnız güvenli simge biçimindeyse.
        const code = String((e as {code?: unknown} | null)?.code ?? "INTERNAL_ERROR").slice(0, 64), msg = (e as {message?: unknown} | null)?.message;
        const detail = typeof msg === "string" && msg.startsWith(`${code}: `) && /^[A-Z0-9_]{1,64}$/.test(msg.slice(code.length + 2)) ? msg.slice(code.length + 2) : undefined;
        d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "FAILED", reason: code, ...(detail ? {detail} : {}), builderRan: trace() !== null ? true : (!flow || e instanceof AnalysisError) ? false : (!flow.builderTrace || traceThrew) ? null : false, ...tf()});
        throw e;
      }
      // Derinlemesine savunma: üretim sürerken Global Stop gelmiş olabilir; DRAFT_READY yanıtından ÖNCE yeniden denetlenir.
      // Taslak ZATEN kaydedildi: denetim bunu açıkça söyler (stoppedAfterRecord), yanıt yine 423.
      if (out.status === "DRAFT_READY" && d.workosStopped()) { d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "STOPPED", reason: "GLOBAL_STOP_ACTIVE", stoppedAfterRecord: true, kind: out.kind, artifactId: out.artifactId, version: out.version, ...tf()}); return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); }
      const x = out as Record<string, unknown>; // yalnız ayırt edici alanlar (gövde değil): ücretli adımın ne ürettiği/neden düştüğü denetimde görünür
      d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: out.status, ...(x.kind !== undefined ? {kind: x.kind} : {}), ...(x.artifactId !== undefined ? {artifactId: x.artifactId} : {}), ...(x.version !== undefined ? {version: x.version} : {}), ...(typeof x.code === "string" ? {code: x.code.slice(0, 120)} : {}), ...(typeof x.reason === "string" ? {reason: x.reason.slice(0, 200)} : {}), ...(typeof x.blocker === "string" ? {blocker: x.blocker.slice(0, 64)} : {}), ...(typeof x.roleId === "string" ? {roleId: x.roleId} : {}), ...tf()});
      return out;
    } finally { lock.release(); }
  }));
  // Plan: onaylı analizden görev planı (bir mission'a bir plan; aynı gövde idempotent).
  app.post("/v1/missions/:id/analysis/plan", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    if (!gates(req, reply, "workos.analysis.plan")) return reply;
    if (!d.getStore().getMission(d.scope, req.params.id)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
    const out = d.analysisFlow(d.workosStopped).createPlan(req.params.id, d.actor);
    // PlanError kodları plan route'unun tablosuyla (503/404/409); taslak kodları (PlanDraftCode) 409.
    if (!out.ok) return reply.code(PLAN_ERROR_STATUS[out.code] ?? 409).send({error: out.code});
    d.audit(out.replayed ? "WORKOS_IDEMPOTENT_REPLAY" : "WORKOS_ANALYSIS_PLAN", {actor: d.actor, missionId: req.params.id, tasks: out.tasks.length});
    return {tasks: out.tasks, replayed: out.replayed, trace: out.trace, summary: out.summary};
  }));
}
