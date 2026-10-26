//TR: Bu dosya analiz adımı route'larını sağlar (POST /v1/missions/:id/analysis/step ve /analysis/plan): Lane C'nin AnalysisFlow'u üzerinde ince bir sarmalayıcı; Global Stop 423, politika 403, boş gövde, sıkı id; server.ts'e tek kayıt gerekir (docs/authority-requests/LANE-B-batch-4b.md).
import AjvModule from "ajv";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import {tryProduceLock} from "./produce-lock.js";
import type {RouteDeps} from "./deps.js";
import {AnalysisError, AnalysisStoppedError} from "../../../../core/workos/crew/analysis.js";
import type {AnalysisFlow} from "../../../../core/workos/crew/analysis.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
const emptyBody = ajv.compile({type: "object", additionalProperties: false} as const);
const validMissionId = (x: unknown) => typeof x === "string" && /^msn_[0-9a-f]{24}$/.test(x);
export interface AnalysisRouteDeps extends RouteDeps { analysisFlow: () => AnalysisFlow }

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
  // İstek hataları aynı kalır (400, 403, 404, 423, 409 kilit). Ücretli üretim süreç genelinde tek kilitle sınırlıdır (predev produce ile ORTAK): ikinci eşzamanlı çağrı builder'a ulaşmadan 409.
  // Global Stop, akış tarafından (AnalysisDeps.stopped -> AnalysisStoppedError) veya yanıttan önceki yeniden denetimle yakalanır; ikisi de 423 + STOPPED denetimi. Tür ile eşlenir (instanceof), ileti metniyle DEĞİL.
  const isStopped = (e: unknown): boolean => e instanceof AnalysisStoppedError;
  app.post("/v1/missions/:id/analysis/step", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    if (!gates(req, reply, "workos.analysis.step")) return reply;
    const id: string = req.params.id;
    // Misyon var mı? KİLİTTEN ÖNCE (predev produce ile aynı): bilinmeyen misyon çekişmede 409 BUSY değil 404 alır; salt-okunur adımlar ücretli üretim yüzünden reddedilmez.
    if (!d.getStore().getMission(d.scope, id)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
    const lock = tryProduceLock(id);
    if (!lock.ok) { d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "REFUSED", reason: lock.error}); return reply.code(409).send({error: lock.error}); }
    try {
      let out;
      try { out = await d.analysisFlow().step(id); }
      catch (e) {
        // Ücretli koşu sonrası fırlayan hata (ör. kayıt sırasında WORKOS_DISK_FULL) da denetlenir.
        if (isStopped(e)) { d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "STOPPED", reason: "GLOBAL_STOP_ACTIVE"}); return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); }
        d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "FAILED", reason: String((e as {code?: unknown} | null)?.code ?? "INTERNAL_ERROR").slice(0, 64)});
        throw e;
      }
      // Derinlemesine savunma: üretim sürerken Global Stop gelmiş olabilir; DRAFT_READY yanıtından ÖNCE yeniden denetlenir.
      if (out.status === "DRAFT_READY" && d.workosStopped()) { d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: "STOPPED", reason: "GLOBAL_STOP_ACTIVE"}); return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); }
      d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: id, status: out.status});
      return out;
    } finally { lock.release(); }
  }));
  // Plan: onaylı analizden görev planı (bir mission'a bir plan; aynı gövde idempotent).
  app.post("/v1/missions/:id/analysis/plan", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    if (!gates(req, reply, "workos.analysis.plan")) return reply;
    const out = d.analysisFlow().createPlan(req.params.id, d.actor);
    if (!out.ok) return reply.code(409).send({error: out.code});
    d.audit(out.replayed ? "WORKOS_IDEMPOTENT_REPLAY" : "WORKOS_ANALYSIS_PLAN", {actor: d.actor, missionId: req.params.id, tasks: out.tasks.length});
    return {tasks: out.tasks, replayed: out.replayed, trace: out.trace, summary: out.summary};
  }));
}
