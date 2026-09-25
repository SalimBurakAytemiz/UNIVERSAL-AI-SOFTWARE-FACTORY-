// //TR: Bu dosya veri sınıfına göre LOCAL/FREE/SUBSCRIPTION/PAID model katmanlarına erişimi fail-closed olarak sınırlar ve gizli verinin free provider'a gitmesini önler.
import type { DataClass } from "../mission/types.js";
export type CostTier = "LOCAL" | "FREE" | "SUBSCRIPTION" | "PAID";

const allowed: Record<DataClass, readonly CostTier[]> = {
  PUBLIC: ["LOCAL","FREE","SUBSCRIPTION","PAID"],
  INTERNAL: ["LOCAL","SUBSCRIPTION","PAID"],
  CONFIDENTIAL: ["LOCAL","SUBSCRIPTION"],
  RESTRICTED: ["LOCAL"],
  PII: ["LOCAL"],
  FINANCIAL: ["LOCAL"],
  SECRET: ["LOCAL"]
};
const dataClasses=new Set<DataClass>(Object.keys(allowed) as DataClass[]);
const tiers=new Set<CostTier>(["LOCAL","FREE","SUBSCRIPTION","PAID"]);
export function canRouteData(dataClass: DataClass, tier: CostTier): boolean {
  if(typeof dataClass!=="string"||!dataClasses.has(dataClass as DataClass)||typeof tier!=="string"||!tiers.has(tier as CostTier))return false;
  return allowed[dataClass].includes(tier);
}
