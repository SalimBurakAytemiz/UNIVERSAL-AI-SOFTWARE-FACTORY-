// //TR: Bu dosya health/capability/data-policy şartlarını sağlayan provider adayları arasında local/free/subscription/paid önceliğini uygular ve malformed maliyet/kimlik girdilerini fail-closed reddeder.
import { canRouteData, type CostTier } from "../../core/policy/data-routing.js";
import type { DataClass } from "../../core/mission/types.js";
export interface ProviderCandidate {id:string;tier:CostTier;healthy:boolean;capabilities:string[];estimatedCost:number;}
const rank:Record<CostTier,number>={LOCAL:0,FREE:1,SUBSCRIPTION:2,PAID:3};
const nonEmpty=(x:unknown):x is string=>typeof x==="string"&&x.trim().length>0;
export function chooseProvider(candidates:ProviderCandidate[],dataClass:DataClass,capability:string,allowPaid=false):ProviderCandidate|undefined{
  if(!Array.isArray(candidates)||!nonEmpty(capability))throw new Error("Model routing input invalid");
  const seen=new Set<string>();
  for(const x of candidates){
    if(!x||!nonEmpty(x.id)||seen.has(x.id))throw new Error("Provider identity invalid or duplicate");seen.add(x.id);
    if(!(x.tier in rank)||typeof x.healthy!=="boolean")throw new Error("Provider tier/health invalid");
    if(!Array.isArray(x.capabilities)||x.capabilities.some(c=>!nonEmpty(c)))throw new Error("Provider capabilities invalid");
    if(!Number.isFinite(x.estimatedCost)||x.estimatedCost<0)throw new Error("Provider estimatedCost must be non-negative and finite");
  }
  return candidates.filter(x=>x.healthy).filter(x=>x.capabilities.includes(capability)).filter(x=>canRouteData(dataClass,x.tier)).filter(x=>allowPaid||x.tier!=="PAID").sort((a,b)=>rank[a.tier]-rank[b.tier]||a.estimatedCost-b.estimatedCost)[0];
}
