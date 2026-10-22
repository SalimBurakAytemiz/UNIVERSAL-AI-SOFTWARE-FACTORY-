//TR: Bu dosya Founder'ın pre-dev kararlarını sağlar (diziyi başlat, artefaktı kanıtla onayla+ilerlet, reddet); karar kapıları (bağımsız onaylayan, kanıt zorunlu, faz sırası) MEVCUT store/driver tarafından zorlanır, burada yeniden yazılmaz. server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-predev-decisions.md).
import AjvModule from "ajv";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import type {RouteDeps} from "./deps.js";
import {PreDevDriver, PreDevDriverError, type ProjectBrief} from "../../../../core/workos/predev/driver.js";
import {WorkOsError} from "../../../../core/workos/types.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
const emptyBody = ajv.compile({type: "object", additionalProperties: false} as const);
const approveBody = ajv.compile({type: "object", additionalProperties: false, required: ["evidenceRefs"], properties: {
  evidenceRefs: {type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: {type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$"}}}} as const);
const rejectBody = ajv.compile({type: "object", additionalProperties: false, required: ["reason"], properties: {reason: {type: "string", minLength: 1, maxLength: 1000, pattern: "\\S"}}} as const);
const validMissionId = (x: unknown) => typeof x === "string" && /^msn_[0-9a-f]{24}$/.test(x);
const validArtifactId = (x: unknown) => typeof x === "string" && /^pda_[0-9a-f]{24}$/.test(x);
const GATE = /PREDEV_[A-Z][A-Z_]*/;
const DRIVER_STATUS: Record<string, number> = {PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE: 409, PREDEV_DRIVER_ARTIFACT_NOT_FOUND: 404};

// Karar yollarında özet de kullanılmaz (yalnız buildMissionContext/produce ister); boş ama tip-geçerli bir özet verilir.
const NO_BRIEF: ProjectBrief = {projectName: "", isReference: false, label: "", summary: "", stakeholders: [], objectives: [], constraints: [], outOfScope: [], notes: []};
// Kararlarda builder hiç kullanılmaz (üretim Lane C'nin ajan portundadır); driver yalnız start/approveAndAdvance/reject için kurulur.
const noBuilder = {produce: async (): Promise<string> => { throw new PreDevDriverError("PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"); }};

export function registerPredevDecisionRoutes(app: any, d: RouteDeps): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => {
    try { return await fn(req, reply); }
    catch (e) {
      if (e instanceof PreDevDriverError) {
        const code = e.message.split(":")[0];
        return reply.code(DRIVER_STATUS[code] ?? 409).send({error: DRIVER_STATUS[code] ? code : "PREDEV_GATE_REFUSED", ...(DRIVER_STATUS[code] ? {} : {reason: GATE.exec(e.message)?.[0] ?? "PREDEV_REFUSED"})});
      }
      // Reducer kapıları (bağımsız onaylayan, kanıt, faz sırası) store'da WORKOS_INVALID_INPUT/PREDEV_ENTRY_REJECTED:<KAPI> olarak gelir; istemci hatasıdır (409), journal bozulması değildir.
      if (e instanceof WorkOsError && (e.code === "WORKOS_INVALID_INPUT" || e.code === "WORKOS_JOURNAL_TAMPERED") && /PREDEV_ENTRY_REJECTED/.test(e.message)) return reply.code(409).send({error: "PREDEV_GATE_REFUSED", reason: GATE.exec(e.message.replace("PREDEV_ENTRY_REJECTED", ""))?.[0] ?? "PREDEV_REFUSED"});
      return d.workosFail(reply, e);
    }
  };
  const driver = () => new PreDevDriver({store: d.getStore(), brief: NO_BRIEF, builder: noBuilder});
  // Yazma kapıları server.ts ile aynı sıra: Global Stop 423 -> politika 403 -> şema 400.
  const gate = (reply: any, action: string, scopeId: string, body: unknown, ok: (b: unknown) => boolean): boolean => {
    if (d.workosStopped()) { reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); return false; }
    const decision = d.workosPolicy(action, scopeId, body);
    if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action, reason: decision.reason}); reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); return false; }
    if (!ok(body)) { reply.code(400).send({error: "INVALID_BODY"}); return false; }
    return true;
  };
  const missionOr404 = (req: any, reply: any): boolean => {
    if (!validMissionId(req.params.id)) { reply.code(400).send({error: "INVALID_MISSION_ID"}); return false; }
    if (!d.getStore().getMission(d.scope, req.params.id)) { reply.code(404).send({error: "WORKOS_NOT_FOUND"}); return false; }
    return true;
  };
  const artifactOr404 = (req: any, reply: any): boolean => {
    if (!validArtifactId(req.params.artifactId)) { reply.code(400).send({error: "INVALID_ARTIFACT_ID"}); return false; }
    const a = d.getStore().getPreDevArtifact(d.scope, req.params.artifactId);
    if (!a || a.missionId !== req.params.id) { reply.code(404).send({error: "WORKOS_NOT_FOUND"}); return false; }
    return true;
  };
  const model = (missionId: string) => d.getStore().preDevReadModel(d.scope, missionId);

  // Tüketici: Pre-dev / ekip planı ekranı (GET /v1/predev/:missionId yalnız okur; karar yazımı bu rotalarla).
  app.post("/v1/missions/:id/predev/start", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (!validMissionId(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    if (!gate(reply, "workos.predev.start", req.params.id, body, emptyBody)) return reply;
    if (!missionOr404(req, reply)) return reply;
    // //TR: Yalnız İLERLEMİŞ (AUTHORIZED dışı) mevcut dizi replay sayılır; AUTHORIZED'da kalmış dizi (ilk ilerleme yazımı ENOSPC/çökme ile kaybolmuş) driver.start ile tamamlanır.
    const existing = d.getStore().getPreDevSequence(d.scope, req.params.id);
    if (existing && existing.phase !== "AUTHORIZED") return reply.code(200).send({predev: model(req.params.id), replayed: true});
    const r = driver().start(d.scope, req.params.id, d.actor);
    d.audit("WORKOS_PREDEV_STARTED", {actor: d.actor, kind: "predev", missionId: req.params.id, preDevId: r.preDevId, phase: r.phase});
    return reply.code(201).send({predev: model(req.params.id), replayed: false});
  }));
  app.post("/v1/missions/:id/predev/artifacts/:artifactId/approve", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (!validMissionId(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    if (!gate(reply, "workos.predev.approve", req.params.id, body, approveBody)) return reply;
    if (!missionOr404(req, reply) || !artifactOr404(req, reply)) return reply;
    const r = driver().approveAndAdvance(d.scope, req.params.id, req.params.artifactId, d.actor, (body as {evidenceRefs: string[]}).evidenceRefs);
    d.audit("WORKOS_PREDEV_ARTIFACT_APPROVED", {actor: d.actor, kind: "predev", missionId: req.params.id, artifactId: req.params.artifactId, phase: r.phase});
    return {predev: model(req.params.id)};
  }));
  app.post("/v1/missions/:id/predev/artifacts/:artifactId/reject", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (!validMissionId(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    if (!gate(reply, "workos.predev.reject", req.params.id, body, rejectBody)) return reply;
    if (!missionOr404(req, reply) || !artifactOr404(req, reply)) return reply;
    driver().reject(d.scope, req.params.id, req.params.artifactId, d.actor, (body as {reason: string}).reason);
    d.audit("WORKOS_PREDEV_ARTIFACT_REJECTED", {actor: d.actor, kind: "predev", missionId: req.params.id, artifactId: req.params.artifactId});
    return {predev: model(req.params.id)};
  }));
}
