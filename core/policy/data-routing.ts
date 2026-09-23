// //TR: Bu dosya veri sınıfına göre LOCAL/FREE/SUBSCRIPTION/PAID model katmanlarına erişimi fail-closed olarak sınırlar ve gizli verinin free provider'a gitmesini önler.
import type { DataClass } from "../mission/types.js";
export type CostTier = "LOCAL" | "FREE" | "SUBSCRIPTION" | "PAID";

const allowed: Record<DataClass, CostTier[]> = {
  PUBLIC: ["LOCAL","FREE","SUBSCRIPTION","PAID"],
  INTERNAL: ["LOCAL","SUBSCRIPTION","PAID"],
  CONFIDENTIAL: ["LOCAL","SUBSCRIPTION"],
  RESTRICTED: ["LOCAL"],
  PII: ["LOCAL"],
  FINANCIAL: ["LOCAL"],
  SECRET: ["LOCAL"]
};

export function canRouteData(dataClass: DataClass, tier: CostTier): boolean {
  return allowed[dataClass].includes(tier);
}
