//TR: Bu dosya proje ilk-teslim akışı durum okumasını (GET /v1/projects/:id/flow) sağlar; server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-flow.md).
import type {RouteDeps} from "./deps.js";
import {deriveProjectFlow} from "../../../../core/workos/flow.js";

export function registerFlowRoutes(app: any, d: RouteDeps): void {
  // Tüketici ekran: proje akış/ilerleme göstergesi (ilk teslim akışı); salt okunur, yazma kapısı gerekmez.
  app.get("/v1/projects/:id/flow", async (req: any, reply: any) => {
    if (typeof req.params.id !== "string" || !/^prj_[0-9a-f]{24}$/.test(req.params.id)) return reply.code(400).send({error: "INVALID_PROJECT_ID"});
    try {
      const flow = deriveProjectFlow(d.getStore(), d.scope, req.params.id);
      return flow ? {flow} : reply.code(404).send({error: "WORKOS_NOT_FOUND"});
    } catch (e) { return d.workosFail(reply, e); }
  });
}
