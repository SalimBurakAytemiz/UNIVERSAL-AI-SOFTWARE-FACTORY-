//TR: Bu dosya proje koşu-hazırlık okumasını (GET /v1/projects/:id/readiness) sağlar; server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-run-readiness.md).
import type {RouteDeps} from "./deps.js";
import {deriveReadiness} from "../../../../core/workos/readiness.js";

export function registerReadinessRoutes(app: any, d: RouteDeps): void {
  // Tüketici ekran: Project Journey / Project Intake sonrası "ilk koşu neden başlamıyor?" (UI-126). Salt okunur: Global Stop/policy kapısı yok.
  app.get("/v1/projects/:id/readiness", async (req: any, reply: any) => {
    if (typeof req.query === "object" && req.query && Object.keys(req.query).length > 0) return reply.code(400).send({error: "INVALID_QUERY"});
    if (!/^prj_[0-9a-f]{24}$/.test(String(req.params.id))) return reply.code(400).send({error: "INVALID_PROJECT_ID"});
    try {
      const r = await deriveReadiness(d.getStore(), d.scope, req.params.id);
      return r ? {readiness: r} : reply.code(404).send({error: "WORKOS_NOT_FOUND"});
    } catch (e) { return d.workosFail(reply, e); }
  });
}
