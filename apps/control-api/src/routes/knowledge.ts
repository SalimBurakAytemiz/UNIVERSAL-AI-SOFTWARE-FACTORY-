//TR: Bu dosya proje bilgi özeti okuma route'unu sağlar (GET /v1/projects/:id/knowledge): Proje Belleği + kanıt dizini, salt okunur; server.ts'e kayıt gerekir (docs/authority-requests/LANE-B-knowledge-api.md).
import type {RouteDeps} from "./deps.js";
import {ProjectMemory} from "../../../../core/knowledge/project-memory.js";
import {ProjectMemoryError} from "../../../../core/knowledge/project-memory-types.js";
import {summarizeMemory, summarizeEvidence} from "../../../../core/knowledge/knowledge-summary.js";

export function registerKnowledgeRoutes(app: any, d: RouteDeps): void {
  // Tüketici ekran: UI-160 bilgi/kanıt özeti paneli (proje ayrıntısı); salt okunur, yazma kapısı gerekmez.
  app.get("/v1/projects/:id/knowledge", async (req: any, reply: any) => {
    try {
      if (typeof req.params.id !== "string" || !/^prj_[0-9a-f]{24}$/.test(req.params.id)) return reply.code(400).send({error: "INVALID_PROJECT_ID"});
      const store = d.getStore();
      if (!store.getProject(d.scope, req.params.id)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
      const memory = summarizeMemory(new ProjectMemory({rootDir: store.dataDir, projectId: req.params.id}));
      const missions = store.listMissions(d.scope, req.params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(m => m.missionId);
      const evidence = await summarizeEvidence(d.evidenceIndex?.(), missions);
      return {knowledge: {projectId: req.params.id, memory, evidence}};
    } catch (e) { return e instanceof ProjectMemoryError ? reply.code(503).send({error: e.code}) : d.workosFail(reply, e); }
  });
}
