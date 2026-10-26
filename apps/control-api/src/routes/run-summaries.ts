//TR: Bu dosya hafif ve sayfalanmış koşu özeti okuma route'unu sağlar (GET /v1/run-summaries); GET /v1/work-runs'ın her sorguda tam evidence/checkpoint dizileri göndermesi sorununu çözer. server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-run-summaries.md).
import type {RouteDeps} from "./deps.js";
import {listRunSummaries, RunSummaryError, RUN_SUMMARY_MAX_LIMIT} from "../../../../core/workos/run-summary.js";
import type {RunStatus} from "../../../../core/workos/types.js";

const ALLOWED = new Set(["projectId", "missionId", "status", "limit", "cursor"]);
const one = (x: unknown): string | undefined | null => (x === undefined ? undefined : typeof x === "string" ? x : null);

export function registerRunSummaryRoutes(app: any, d: RouteDeps): void {
  // Tüketici: Proje/Çalışma ekranlarının koşu listeleri (FRONTEND_BACKEND_MATRIX G-FB-041: sayfalama yok, tam koşu nesneleri her yoklamada).
  app.get("/v1/run-summaries", async (req: any, reply: any) => {
    try {
      const q = (req.query ?? {}) as Record<string, unknown>;
      if (Object.keys(q).some(k => !ALLOWED.has(k))) return reply.code(400).send({error: "INVALID_QUERY"});
      const projectId = one(q.projectId), missionId = one(q.missionId), status = one(q.status), cursor = one(q.cursor), limitRaw = one(q.limit);
      if (projectId === null || (projectId !== undefined && !/^prj_[0-9a-f]{24}$/.test(projectId))) return reply.code(400).send({error: "INVALID_PROJECT_ID"});
      if (missionId === null || (missionId !== undefined && !/^msn_[0-9a-f]{24}$/.test(missionId))) return reply.code(400).send({error: "INVALID_MISSION_ID"});
      if (status === null || cursor === null || limitRaw === null) return reply.code(400).send({error: "INVALID_QUERY"});
      if (limitRaw !== undefined && !new RegExp(`^[0-9]{1,${String(RUN_SUMMARY_MAX_LIMIT).length}}$`).test(limitRaw)) return reply.code(400).send({error: "INVALID_LIMIT"});
      // Bilinmeyen proje/mission honest 404 (boş liste "veri yok" ile karışmasın); başka tenant'ın kaydı da 404'tür.
      if (projectId !== undefined && !d.getStore().getProject(d.scope, projectId)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
      if (missionId !== undefined && !d.getStore().getMission(d.scope, missionId)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
      return {page: listRunSummaries(d.getStore(), d.scope, {projectId, missionId, status: status as RunStatus | undefined, cursor, limit: limitRaw === undefined ? undefined : Number(limitRaw)})};
    } catch (e) { return e instanceof RunSummaryError ? reply.code(400).send({error: e.code}) : d.workosFail(reply, e); }
  });
}
