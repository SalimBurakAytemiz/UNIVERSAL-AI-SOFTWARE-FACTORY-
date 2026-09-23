// //TR: Bu dosya external side-effect action'ların scope/data/budget/certification/approval kapılarından geçmeden yürütülmesini fail-closed olarak engeller.
import {assertApprovalValid} from "../authority/approval.js";
import type { ActionPolicyContext, ActionRequest } from "./types.js";

const approvalClasses = new Set([
  "SPEND","PRODUCTION_CHANGE","DESTRUCTIVE","IRREVERSIBLE","LEGAL_FINANCIAL_AUTHORITY"
]);
const nonEmpty=(x:string)=>typeof x==="string"&&x.trim().length>0;

export function authorizeAction(req: ActionRequest, ctx: ActionPolicyContext): {allowed:true}|{allowed:false;reason:string} {
  if(!nonEmpty(req.id)||!nonEmpty(req.missionId)||!nonEmpty(req.actorId)||!nonEmpty(req.target)||!nonEmpty(req.actionDigest)||!nonEmpty(req.targetDigest)) return {allowed:false,reason:"ACTION_IDENTITY_INVALID"};
  if(req.estimatedCost!==undefined&&(!Number.isFinite(req.estimatedCost)||req.estimatedCost<0)) return {allowed:false,reason:"INVALID_ESTIMATED_COST"};
  if(!ctx.scopeAllowed) return {allowed:false,reason:"SCOPE_DENIED"};
  if(!ctx.dataPolicyAllowed) return {allowed:false,reason:"DATA_POLICY_DENIED"};
  if(!ctx.adapterCertified) return {allowed:false,reason:"ADAPTER_NOT_CERTIFIED"};
  if((req.estimatedCost??0)>0 && !ctx.budgetAllowed) return {allowed:false,reason:"BUDGET_DENIED"};
  if(approvalClasses.has(req.actionClass)){
    if(!ctx.approval) return {allowed:false,reason:"APPROVAL_REQUIRED"};
    try{assertApprovalValid(ctx.approval,req.actionDigest,req.targetDigest,ctx.now??new Date())}
    catch(error){return {allowed:false,reason:`APPROVAL_INVALID:${error instanceof Error?error.message:"UNKNOWN"}`}}
  }
  if(req.actionClass!=="READ_ONLY" && !req.idempotencyKey && !req.reversible)
    return {allowed:false,reason:"NON_IDEMPOTENT_IRREVERSIBLE_ACTION_WITHOUT_KEY"};
  return {allowed:true};
}
