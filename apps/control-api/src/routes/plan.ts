//TR: Bu dosya mission görev planı route'larını sağlar (POST /v1/missions/:id/plan, GET /v1/missions/:id/tasks); server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-plan.md).
import type {RouteDeps} from "./deps.js";
import {submitPlan, validatePlanCreate, PlanError} from "../../../../core/workos/plan.js";

const validMissionId = (x: unknown) => typeof x === "string" && /^msn_[0-9a-f]{24}$/.test(x);
const STATUS: Record<string, number> = {PLAN_ALREADY_EXISTS: 409, MISSION_NOT_PLANNABLE: 409, PLAN_MISSION_NOT_FOUND: 404, PLAN_STORE_CORRUPT: 503};

export function registerPlanRoutes(app: any, d: RouteDeps): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => {
    try { return await fn(req, reply); }
    catch (e) { return e instanceof PlanError ? reply.code(STATUS[e.code]).send({error: e.code}) : d.workosFail(reply, e); }
  };
  // Tüketici ekranlar: Mission/Task planı (SCREEN_AUDIT_252 görev planlama ekranları); ilk teslim akışında "görevler planlanır" adımı.
  app.get("/v1/missions/:id/tasks", guard(async (req: any, reply: any) => {
    if (!validMissionId(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    if (!d.getStore().getMission(d.scope, req.params.id)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
    return {tasks: d.getStore().listTasks(d.scope, req.params.id)};
  }));
  app.post("/v1/missions/:id/plan", guard(async (req: any, reply: any) => {
    if (!validMissionId(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    const body = req.body ?? {};
    if (d.workosStopped()) return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"});
    const decision = d.workosPolicy("workos.mission.plan", req.params.id, body);
    if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action: "workos.mission.plan", reason: decision.reason}); return reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); }
    const v = validatePlanCreate(body);
    if (!v.ok) return reply.code(400).send({error: "INVALID_BODY", detail: v.errors});
    const r = submitPlan(d.getStore(), d.scope, d.actor, req.params.id, body as any);
    d.audit(r.replayed ? "WORKOS_IDEMPOTENT_REPLAY" : "WORKOS_PLAN_CREATED", {actor: d.actor, kind: "plan", missionId: req.params.id, taskCount: r.tasks.length});
    return reply.code(r.replayed ? 200 : 201).send({tasks: r.tasks});
  }));
}
