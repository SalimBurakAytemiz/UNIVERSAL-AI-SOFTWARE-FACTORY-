//TR: Bu dosya rol yaşam döngüsü özetini (GET /v1/roles/status-summary) sağlar: REGISTERED/IMPLEMENTED/TESTED/CERTIFIED/RUNNING beş bağımsız sayaç yalnız kanıttan hesaplanır (core/agents/role-lifecycle.ts); salt okunur, durum yükseltmez. server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-C-role-status-route.md).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {RouteDeps} from "./deps.js";
import {FIRST_DELIVERY_BINDINGS} from "../../../../core/agents/first-delivery-bindings.js";
import {computeRoleStatusSummary, createEvidenceVerifier} from "../../../../core/agents/role-lifecycle.js";

export const ROLE_REGISTRY_FILE_REL = path.join("registries", "role-definitions.json");

export function registerRoleStatusRoutes(app: any, d: RouteDeps & {repoRoot: string; now?: () => Date}): void {
  // Tüketici ekran: rol/agent yaşam döngüsü paneli; salt okunur, yazma kapısı gerekmez. Kayıt eksik/bozuksa 503 (sayı uydurulmaz).
  app.get("/v1/roles/status-summary", async (_req: any, reply: any) => {
    let raw: Buffer, doc: any;
    try { raw = fs.readFileSync(path.join(d.repoRoot, ROLE_REGISTRY_FILE_REL)); doc = JSON.parse(raw.toString("utf8")); } catch { return reply.code(503).send({error: "ROLE_REGISTRY_UNAVAILABLE"}); }
    if (!Array.isArray(doc?.roles)) return reply.code(503).send({error: "ROLE_REGISTRY_UNAVAILABLE"});
    try {
      const st = d.getStore();
      const runs = st.hasJournal ? st.listRuns(d.scope) : [];
      const statusSummary = computeRoleStatusSummary({
        roles: doc.roles, guildIds: Array.isArray(doc.guilds) ? doc.guilds.map((g: any) => g.guildId) : [],
        roleDefinitionsSha256: crypto.createHash("sha256").update(raw).digest("hex"), bindings: FIRST_DELIVERY_BINDINGS,
        verify: createEvidenceVerifier(d.repoRoot), runs, now: d.now ? d.now() : new Date()
      });
      return {statusSummary};
    } catch (e) { return d.workosFail(reply, e); }
  });
}
