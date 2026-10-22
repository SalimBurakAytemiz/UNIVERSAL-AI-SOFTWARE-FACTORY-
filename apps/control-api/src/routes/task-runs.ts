//TR: Bu dosya görev-koşu bağı route'larını sağlar (POST/GET /v1/tasks/:id/runs, GET /v1/work-runs/:id/tasks); server.ts'te tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-task-run-link.md).
import AjvModule from "ajv";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import type {RouteDeps} from "./deps.js";
import {linkTaskRun, runsForTask, tasksForRun, LinkError} from "../../../../core/workos/task-run-link.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
const check = ajv.compile({type: "object", additionalProperties: false, required: ["runId"], properties: {runId: {type: "string", pattern: "^run_[0-9a-f]{24}$"}}} as const);
const validTaskId = (x: unknown) => typeof x === "string" && /^tsk_[0-9a-f]{24}$/.test(x);
const validRunId = (x: unknown) => typeof x === "string" && /^run_[0-9a-f]{24}$/.test(x);
const STATUS: Record<string, number> = {TASK_NOT_FOUND: 404, RUN_NOT_FOUND: 404, RUN_MISSION_MISMATCH: 409, TASK_NOT_LINKABLE: 409, LINK_STORE_CORRUPT: 503};

export function registerTaskRunRoutes(app: any, d: RouteDeps): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => {
    try { return await fn(req, reply); }
    catch (e) { return e instanceof LinkError ? reply.code(STATUS[e.code]).send({error: e.code}) : d.workosFail(reply, e); }
  };
  // Tüketici ekran: görev panosu / koşu detayı (hangi görev hangi koşuyla yürütülüyor); koşu kendisi POST /v1/missions/:id/runs ile açılır.
  app.get("/v1/tasks/:id/runs", guard(async (req: any, reply: any) => {
    if (!validTaskId(req.params.id)) return reply.code(400).send({error: "INVALID_TASK_ID"});
    const r = runsForTask(d.getStore(), d.scope, req.params.id);
    return r ? {runs: r} : reply.code(404).send({error: "TASK_NOT_FOUND"});
  }));
  app.get("/v1/work-runs/:id/tasks", guard(async (req: any, reply: any) => {
    if (!validRunId(req.params.id)) return reply.code(400).send({error: "INVALID_RUN_ID"});
    const r = tasksForRun(d.getStore(), d.scope, req.params.id);
    return r ? {links: r} : reply.code(404).send({error: "RUN_NOT_FOUND"});
  }));
  app.post("/v1/tasks/:id/runs", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    if (!validTaskId(req.params.id)) return reply.code(400).send({error: "INVALID_TASK_ID"});
    const body = req.body ?? {};
    if (d.workosStopped()) return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"});
    const decision = d.workosPolicy("workos.task.link-run", "NONE", body);
    if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action: "workos.task.link-run", reason: decision.reason}); return reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); }
    if (!check(body)) return reply.code(400).send({error: "INVALID_BODY", detail: ajv.errorsText(check.errors, {separator: " | "})});
    const r = linkTaskRun(d.getStore(), d.scope, d.actor, req.params.id, (body as {runId: string}).runId);
    d.audit(r.replayed ? "WORKOS_IDEMPOTENT_REPLAY" : "WORKOS_TASK_RUN_LINKED", {actor: d.actor, kind: "task-run-link", taskId: r.link.taskId, runId: r.link.runId, missionId: r.link.missionId});
    return reply.code(r.replayed ? 200 : 201).send({link: r.link});
  }));
}
