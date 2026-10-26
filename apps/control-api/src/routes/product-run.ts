//TR: Bu dosya teslim edilen ürünün çalıştırılması route'larını sağlar (GET /v1/work-runs/:id/product, POST /v1/work-runs/:id/product/start|stop); ürün YALNIZ doğrulanmış sandbox sağlayıcısında ve sağlayıcı köprüsüyle başlar, çalıştırma teslim kaydına (work-run + teslim edilen commit) bağlanır; server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-devrun-bridge.md).
import AjvModule from "ajv";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import type {RouteDeps} from "./deps.js";
import {sourceGenerationOf} from "../../../../core/workos/outcomes.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
const emptyBody = ajv.compile({type: "object", additionalProperties: false} as const);
const validRunId = (x: unknown) => typeof x === "string" && /^run_[0-9a-f]{24}$/.test(x);

export interface ProductRunRouteOptions { /** Test enjeksiyonu: teslim edilebilirlik kararı (varsayılan: kanıttan sourceGenerationOf). */ deliverable?: (run: any) => {ok: true; headSha: string} | {ok: false; reason: string} }
export function registerProductRunRoutes(app: any, d: RouteDeps, opts: ProductRunRouteOptions = {}): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => { try { return await fn(req, reply); } catch (e) { return d.workosFail(reply, e); } };
  const resolve = (req: any, reply: any) => {
    if (!validRunId(req.params.id)) { reply.code(400).send({error: "INVALID_RUN_ID"}); return null; }
    const run = d.getStore().getRun(d.scope, req.params.id);
    if (!run) { reply.code(404).send({error: "RUN_NOT_FOUND"}); return null; }
    const project = run.projectId ? d.getStore().getProject(d.scope, run.projectId) : undefined;
    if (!project) { reply.code(404).send({error: "PROJECT_NOT_FOUND"}); return null; }
    return {run, project};
  };
  const wired = async (reply: any) => { if (!d.devruns) { reply.code(503).send({error: "DEVRUN_NOT_WIRED"}); return null; } return d.devruns(); };
  // Teslim kaydı: kaynak üretimi tamam ve teslim edilen commit biliniyor olmalı (aksi halde çalıştırılacak "teslim edilmiş ürün" yoktur).
  const deliverable = opts.deliverable ?? ((run: any): {ok: true; headSha: string} | {ok: false; reason: string} => {
    const sg = sourceGenerationOf(run);
    if (sg.state !== "SOURCE_GENERATION_COMPLETE") return {ok: false, reason: `${sg.state}:${sg.reason}`.slice(0, 80)};
    return typeof run.headSha === "string" && /^[0-9a-f]{40}$/.test(run.headSha) ? {ok: true, headSha: run.headSha} : {ok: false, reason: "NO_DELIVERED_COMMIT"};
  });
  const shape = (run: any, view: any) => ({runId: run.runId, deliveredHeadSha: run.headSha ?? null, devrun: view, tiedToThisRun: view?.deliveryRunId === run.runId});

  app.get("/v1/work-runs/:id/product", guard(async (req: any, reply: any) => {
    const r = resolve(req, reply); if (!r) return reply;
    const m = await wired(reply); if (!m) return reply;
    return {product: shape(r.run, m.view(r.project))};
  }));
  for (const action of ["start", "stop"] as const) {
    app.post(`/v1/work-runs/:id/product/${action}`, {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
      const body = req.body ?? {};
      if (d.workosStopped()) return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"});
      const decision = d.workosPolicy(`workos.product.${action}`, "NONE", body);
      if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action: `workos.product.${action}`, reason: decision.reason}); return reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); }
      if (!emptyBody(body)) return reply.code(400).send({error: "INVALID_BODY"});
      const r = resolve(req, reply); if (!r) return reply;
      const m = await wired(reply); if (!m) return reply;
      if (action === "stop") {
        // Başka bir koşuya bağlı çalıştırmayı bu rota durdurmaz (yanlış ürünü kapatmak yok); çalışan yoksa idempotent.
        const cur = m.view(r.project);
        if (m.isActive(r.project.projectId) && cur.deliveryRunId !== r.run.runId) return reply.code(409).send({error: "PRODUCT_RUN_NOT_THIS_DELIVERY", reason: "RUNNING_FOR_OTHER_RUN"});
        await m.stop(r.project.projectId);
        d.audit("WORKOS_PRODUCT_STOP", {actor: d.actor, runId: r.run.runId, projectId: r.project.projectId});
        return {product: shape(r.run, m.view(r.project))};
      }
      const dv = deliverable(r.run);
      if (!dv.ok) return reply.code(409).send({error: "PRODUCT_RUN_NOT_DELIVERABLE", reason: dv.reason});
      await m.start(r.project, {runId: r.run.runId, headSha: dv.headSha});
      d.audit("WORKOS_PRODUCT_START", {actor: d.actor, runId: r.run.runId, projectId: r.project.projectId, headSha: dv.headSha});
      return {product: shape(r.run, m.view(r.project))};
    }));
  }
}
