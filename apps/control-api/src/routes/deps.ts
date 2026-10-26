//TR: Bu dosya modüler domain route dosyalarının server.ts'ten aldığı ortak bağımlılık sözleşmesidir (token hook'u server.ts'te global olduğu için burada tekrarlanmaz).
import type {WorkOsStore} from "../../../../core/workos/store.js";
import type {Scope} from "../../../../core/workos/types.js";
import type {EvidencePage, EvidenceQuery} from "../../../../core/evidence/index.js";
import type {DevRunManager} from "../../../../core/workos/devrun.js";

// //TR: COORD-FIRST-DELIVERY-WIRING: modüler yazma route'larının gövde sınırı masaüstü köprüsünün POST sınırıyla (apps/desktop/main.mjs POST_MAX_BODY_BYTES) aynıdır; sunucunun genel 64 KB sınırı yalnız eski rotalar için kalır.
export const LANE_WRITE_BODY_LIMIT = 32 * 1024;

export interface RouteDeps {
  getStore: () => WorkOsStore; scope: Scope; orgId: string; actor: string;
  audit: (event: string, details?: Record<string, unknown>) => void;
  // Ortak yazma kapıları server.ts'teki ile aynıdır: Global Stop 423, action-gateway 403.
  workosStopped: () => boolean;
  workosPolicy: (action: string, missionId: string, body: unknown) => {allowed: boolean; reason?: string};
  workosFail: (reply: any, e: unknown) => unknown;
  // İsteğe bağlı: kanıt dizini (PQ-006). server.ts geçmezse kanıt bölümü dürüstçe UNAVAILABLE/EVIDENCE_NOT_WIRED döner.
  evidenceIndex?: () => { list: (q?: EvidenceQuery) => Promise<EvidencePage> };
  // İsteğe bağlı (B-RUN-1): dev-run yöneticisi; verilmezse ürün çalıştırma rotaları 503 DEVRUN_NOT_WIRED döner.
  devruns?: () => Promise<DevRunManager>;
}
