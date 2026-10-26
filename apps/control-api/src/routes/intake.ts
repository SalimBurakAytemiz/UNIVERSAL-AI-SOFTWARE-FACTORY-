//TR: Bu dosya proje intake route'larını (fikir -> doğrulanmış kayıt -> proje + ilk mission) sağlar; server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-intake.md).
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import type {RouteDeps} from "./deps.js";
import path from "node:path";
import {ProjectStudio, StudioError} from "../../../../core/workos/project-studio.js";
import {submitIntake, listIntakes, getIntake, validateIntakeCreate, IntakeError} from "../../../../core/workos/intake.js";

const validIntakeId = (x: unknown) => typeof x === "string" && /^itk_[0-9a-f]{24}$/.test(x);

export function registerIntakeRoutes(app: any, d: RouteDeps): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => {
    try { return await fn(req, reply); }
    catch (e) {
      if (e instanceof IntakeError) {
        const status = e.code === "INTAKE_IDEMPOTENCY_CONFLICT" ? 409 : e.code === "INTAKE_NOT_FOUND" ? 404 : 503;
        return reply.code(status).send({error: e.code});
      }
      if (e instanceof StudioError) return reply.code(e.status).send({error: e.code});
      return d.workosFail(reply, e);
    }
  };
  // Tüketici ekran: UI-126 Project Intake (SCREEN_AUDIT_252); Founder fikri burada projeye ve ilk mission'a dönüşür.
  app.get("/v1/intakes", guard(async () => ({intakes: listIntakes(d.getStore().dataDir, d.scope)})));
  app.get("/v1/intakes/:id", guard(async (req: any, reply: any) => {
    if (!validIntakeId(req.params.id)) return reply.code(400).send({error: "INVALID_INTAKE_ID"});
    const r = getIntake(d.getStore().dataDir, d.scope, req.params.id);
    return r ? {intake: r} : reply.code(404).send({error: "INTAKE_NOT_FOUND"});
  }));
  app.post("/v1/intakes", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (d.workosStopped()) return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"});
    const decision = d.workosPolicy("workos.intake.create", "NONE", body);
    if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action: "workos.intake.create", reason: decision.reason}); return reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); }
    const v = validateIntakeCreate(body);
    if (!v.ok) return reply.code(400).send({error: "INVALID_BODY", detail: v.errors});
    const store = d.getStore();
    // //TR: Studio yalnız template istendiğinde kurulur (server.ts studio vermişse o örnek kullanılır; yoksa aynı seçeneklerle yerel örnek).
    const studio = (body as any).template === undefined ? undefined : (d.studio?.() ?? new ProjectStudio({dataDir: store.dataDir, envPolicyFile: path.resolve("config", "environment-policy.json")}));
    const r = submitIntake({store, scope: d.scope, orgId: d.orgId, actor: d.actor, ...(studio ? {studio} : {})}, body as any);
    d.audit(r.replayed ? "WORKOS_IDEMPOTENT_REPLAY" : "WORKOS_INTAKE_CREATED", {actor: d.actor, kind: "intake", intakeId: r.intake.intakeId, projectId: r.intake.projectId, missionId: r.intake.missionId, ...(r.intake.template ? {template: r.intake.template} : {})});
    return reply.code(r.replayed ? 200 : 201).send({intake: r.intake});
  }));
}
