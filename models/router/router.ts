// //TR: Bu dosya health/capability/data-policy şartlarını sağlayan provider adayları arasında local/free/subscription/paid önceliğini uygulayan temel model router'ını sağlar.
import { canRouteData, type CostTier } from "../../core/policy/data-routing.js";
import type { DataClass } from "../../core/mission/types.js";

export interface ProviderCandidate {
  id: string;
  tier: CostTier;
  healthy: boolean;
  capabilities: string[];
  estimatedCost: number;
}
const rank: Record<CostTier, number> = { LOCAL:0, FREE:1, SUBSCRIPTION:2, PAID:3 };

export function chooseProvider(
  candidates: ProviderCandidate[], dataClass: DataClass, capability: string, allowPaid=false
): ProviderCandidate | undefined {
  return candidates
    .filter(x => x.healthy)
    .filter(x => x.capabilities.includes(capability))
    .filter(x => canRouteData(dataClass, x.tier))
    .filter(x => allowPaid || x.tier !== "PAID")
    .sort((a,b) => rank[a.tier]-rank[b.tier] || a.estimatedCost-b.estimatedCost)[0];
}
