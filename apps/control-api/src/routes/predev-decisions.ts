//TR: Bu dosya Founder'ın pre-dev kararlarını sağlar (diziyi başlat, artefaktı kanıtla onayla+ilerlet, reddet); karar kapıları (bağımsız onaylayan, kanıt zorunlu, faz sırası) MEVCUT store/driver tarafından zorlanır, burada yeniden yazılmaz. server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-predev-decisions.md).
import AjvModule from "ajv";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import {tryProduceLock} from "./produce-lock.js";
import type {RouteDeps} from "./deps.js";
import {PreDevDriver, PreDevDriverError, type ProjectBrief} from "../../../../core/workos/predev/driver.js";
import {WorkOsError} from "../../../../core/workos/types.js";
import {briefFromRecords} from "../../../../core/workos/predev/brief.js";
import {PREDEV_AGENT_ACTOR, PreDevBuilderError} from "../../../../core/workos/predev/claude-builder.js";
import type {ClaudePreDevBuilder} from "../../../../core/workos/predev/claude-builder.js";

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

// //TR: preDevBuilder (isteğe bağlı): üretim BuilderPort sağlayıcısı. server.ts'te mevcut executor durumundan (getExecutors().pair?.preDevBuilder?.()) beslenir, yani Founder'ın /v1/system/executors/local-claude/enable yolu ve provenance PASS dışında bir yetki yoktur; verilmezse veya null dönerse üretim rotası 409 PREDEV_DRIVER_BUILDER_NOT_CONFIGURED verir (varsayılan davranış).
class PreDevStoppedAfterRun extends Error { constructor() { super("GLOBAL_STOP_ACTIVE"); this.name = "PreDevStoppedAfterRun"; } }
export interface PredevRouteDeps extends RouteDeps { preDevBuilder?: () => ClaudePreDevBuilder | null }

export function registerPredevDecisionRoutes(app: any, d: PredevRouteDeps): void {
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

  // //TR: C-PREDEV-PRODUCE: mevcut fazın artefaktını bağlı rol (PRE_DEV_ROLE_MAP[kind][0]) üzerinden üretir ve DRAFT kaydeder; ONAYLAMAZ (Founder karar verir). Kapı sırası diğer pre-dev rotalarıyla aynıdır (kimlik 400 -> Global Stop 423 -> politika 403 -> boş gövde 400 -> misyon/tenant 404); sonra builder yoksa 409, aynı misyonda eşzamanlı ikinci çağrı 409 (çift süreç YOK). Faz/bekleyen-taslak kapıları builder çağrılmadan ÖNCE driver'dadır. Üretim idempotent DEĞİLDİR: her başarılı çağrı yeni bir model çağrısıdır.
  // //TR: Süreç genelinde AYNI ANDA en çok BİR produce (yerel makinede N misyon = N model süreci olmasın): aynı misyonda ikinci çağrı IN_PROGRESS, başka misyonda BUSY; ikisi de süreç başlatmadan 409. Kilit builder-yapılandırma denetiminden SONRA alınır, böylece erken çıkış kilidi sızdıramaz.
  app.post("/v1/missions/:id/predev/produce", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    const body = req.body ?? {};
    const id: string = req.params.id;
    if (!validMissionId(id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    if (!gate(reply, "workos.predev.produce", id, body, emptyBody)) return reply;
    if (!missionOr404(req, reply)) return reply;
    const builder = d.preDevBuilder?.() ?? null;
    if (!builder) return reply.code(409).send({error: "PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"});
    const lock = tryProduceLock(id);
    if (!lock.ok) return reply.code(409).send({error: lock.error});
    try {
      const store = d.getStore(), mission = store.getMission(d.scope, id)!, project = store.getProject(d.scope, mission.projectId);
      if (!project) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
      builder.shouldAbort = d.workosStopped;
      const phase0 = model(id).phase;
      // //TR: Süreç çıktıktan sonra DRAFT kaydedilmeden ÖNCE Global Stop yeniden denetlenir (250 ms'lik yoklama aralığını kapatır): durdurulmuşsa hiçbir şey kaydedilmez, 423.
      const guarded = {produce: async (...a: Parameters<typeof builder.produce>) => { const o = await builder.produce(...a); if (d.workosStopped()) throw new PreDevStoppedAfterRun(); return o; }};
      const drv = new PreDevDriver({store, brief: briefFromRecords({project, mission}), builder: guarded});
      const trace = () => builder.lastTrace;
      const audit = (outcome: "RECORDED" | "REJECTED" | "FAILED", extra: Record<string, unknown>) => d.audit("WORKOS_PREDEV_PRODUCED", {actor: d.actor, kind: "predev", missionId: id, outcome, roleId: trace()?.roleId ?? null, artifactKind: trace()?.kind ?? null, executor: trace()?.identity ?? null, outputSha256: trace()?.outputSha256 ?? null, exitCode: trace()?.exitCode ?? null, durationMs: trace()?.durationMs ?? null, ...extra});
      let out;
      try { out = await drv.produceCurrentPhase(d.scope, id, PREDEV_AGENT_ACTOR); }
      catch (e) {
        if (e instanceof PreDevStoppedAfterRun) { audit("FAILED", {phase: phase0, reason: "GLOBAL_STOP_ACTIVE"}); return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); }
        if (e instanceof PreDevBuilderError) { audit("FAILED", {phase: phase0, reason: e.code}); return reply.code(502).send({error: "PREDEV_BUILDER_FAILED", reason: e.code}); }
        // //TR: Model çağrısı koştuktan SONRA başka bir adım fırlatırsa (ör. journal yazımı WORKOS_DISK_FULL) harcanan çağrı yine de audit'e girer (sabit kod, ham mesaj yok); kapı hataları (PreDevDriverError) builder'dan önce fırlar ve trace boştur.
        if (!(e instanceof PreDevDriverError) && trace() !== null) { try { audit("FAILED", {phase: phase0, reason: e instanceof WorkOsError ? e.code : "PREDEV_PRODUCE_INTERNAL_ERROR"}); } catch { /* özgün hatayı maskeleme */ } }
        throw e;
      }
      // //TR: out.reason doğrulayıcının SABİT hata kodudur (PREDEV_DRIVER_INVALID_JSON veya validators.ts kodları); model metni asla yansıtılmaz.
      if (out.status === "REJECTED") {
        audit("REJECTED", {phase: out.phase, reason: out.reason});
        return reply.code(422).send({error: "PREDEV_OUTPUT_REJECTED", kind: out.kind, phase: out.phase, reason: out.reason});
      }
      audit("RECORDED", {phase: out.phase, artifactId: out.artifactId, version: out.version});
      return reply.code(201).send({produced: {status: "RECORDED", kind: out.kind, phase: out.phase, artifactId: out.artifactId, version: out.version, roleId: trace()?.roleId ?? null}, predev: model(id)});
    } finally { lock.release(); }
  }));
}
