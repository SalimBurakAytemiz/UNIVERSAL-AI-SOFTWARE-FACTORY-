//TR: Bu dosya analiz adımı route'larını sağlar (POST /v1/missions/:id/analysis/step ve /analysis/plan): Lane C'nin AnalysisFlow'u üzerinde ince bir sarmalayıcı; Global Stop 423, politika 403, boş gövde, sıkı id; server.ts'e tek kayıt gerekir (docs/authority-requests/LANE-B-batch-4b.md).
import AjvModule from "ajv";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import type {RouteDeps} from "./deps.js";
import {AnalysisError} from "../../../../core/workos/crew/analysis.js";
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
  // Adım: o anki analiz fazının taslağı. BLOCKED 409 (tam adım gövdesi + error), REJECTED/BUILDER_FAILED 502, diğerleri 200.
  app.post("/v1/missions/:id/analysis/step", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    if (!gates(req, reply, "workos.analysis.step")) return reply;
    const out = await d.analysisFlow().step(req.params.id);
    d.audit("WORKOS_ANALYSIS_STEP", {actor: d.actor, missionId: req.params.id, status: out.status});
    if (out.status === "BLOCKED") return reply.code(409).send({...out, error: "ANALYSIS_BLOCKED"});
    if (out.status === "REJECTED" || out.status === "BUILDER_FAILED") return reply.code(502).send(out);
    return out;
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
