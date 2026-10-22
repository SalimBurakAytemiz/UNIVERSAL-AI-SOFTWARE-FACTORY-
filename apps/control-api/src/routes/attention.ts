//TR: Bu dosya Founder dikkat kuyruğu okuma route'unu sağlar (GET /v1/attention): Work OS kayıtlarından türetilir, salt okunur; server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-attention-api.md).
import type {RouteDeps} from "./deps.js";
import {deriveAttention} from "../../../../core/workos/attention.js";

export function registerAttentionRoutes(app: any, d: RouteDeps): void {
  // Tüketici: Founder dikkat paneli (eski /v1/founder-attention kaynağı emekli scheduler'dır; 7 görünüm buna bağlıdır, bkz. FRONTEND_BACKEND_MATRIX G-FB-048).
  app.get("/v1/attention", async (_req: any, reply: any) => {
    try { return {attention: deriveAttention(d.getStore(), d.scope)}; }
    catch (e) { return d.workosFail(reply, e); }
  });
}
