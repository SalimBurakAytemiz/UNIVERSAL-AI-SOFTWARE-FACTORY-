//TR: Bu dosya görev durum geçişi route'unu sağlar (POST /v1/tasks/:id/transition, GET /v1/tasks/:id); server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-task-status.md).
import AjvModule from "ajv";
import type {RouteDeps} from "./deps.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
const bodySchema = {
  type: "object", additionalProperties: false, required: ["to", "reason"],
  properties: {to: {enum: ["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]}, reason: {type: "string", minLength: 1, maxLength: 1000, pattern: "\\S"}}
} as const;
const check = ajv.compile(bodySchema);
const validTaskId = (x: unknown) => typeof x === "string" && /^tsk_[0-9a-f]{24}$/.test(x);

export function registerTaskRoutes(app: any, d: RouteDeps): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => { try { return await fn(req, reply); } catch (e) { return d.workosFail(reply, e); } };
  // Tüketici ekran: görev panosu / mission detayı (SCREEN_AUDIT_252 görev ekranları) ve akış PLAN aşaması.
  app.get("/v1/tasks/:id", guard(async (req: any, reply: any) => {
    if (!validTaskId(req.params.id)) return reply.code(400).send({error: "INVALID_TASK_ID"});
    const t = d.getStore().getTask(d.scope, req.params.id);
    return t ? {task: t} : reply.code(404).send({error: "WORKOS_NOT_FOUND"});
  }));
  app.post("/v1/tasks/:id/transition", guard(async (req: any, reply: any) => {
    if (!validTaskId(req.params.id)) return reply.code(400).send({error: "INVALID_TASK_ID"});
    const body = req.body ?? {};
    if (d.workosStopped()) return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"});
    const decision = d.workosPolicy("workos.task.transition", "NONE", body);
    if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action: "workos.task.transition", reason: decision.reason}); return reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); }
    if (!check(body)) return reply.code(400).send({error: "INVALID_BODY", detail: ajv.errorsText(check.errors, {separator: " | "})});
    const b = body as {to: "PENDING" | "IN_PROGRESS" | "DONE" | "BLOCKED"; reason: string};
    const before = d.getStore().getTask(d.scope, req.params.id);
    const task = d.getStore().transitionTask(d.scope, req.params.id, b.to, b.reason, d.actor);
    d.audit("WORKOS_TASK_TRANSITIONED", {actor: d.actor, kind: "task", taskId: task.taskId, missionId: task.missionId, from: before?.status, to: task.status});
    return {task};
  }));
}
