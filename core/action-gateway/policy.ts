// //TR: Bu dosya external side-effect action'ların scope/data/budget/certification/approval kapılarından geçmeden yürütülmesini fail-closed olarak engeller.
import {assertApprovalValid} from "../authority/approval.js";
import type { ActionClass, ActionPolicyContext, ActionRequest } from "./types.js";

const actionClasses = new Set<ActionClass>([
  "READ_ONLY","MUTATION","EXTERNAL_COMMUNICATION","SPEND","PRODUCTION_CHANGE","DESTRUCTIVE","IRREVERSIBLE","LEGAL_FINANCIAL_AUTHORITY"
]);
const approvalClasses = new Set<ActionClass>([
  "SPEND","PRODUCTION_CHANGE","DESTRUCTIVE","IRREVERSIBLE","LEGAL_FINANCIAL_AUTHORITY"
]);
const nonEmpty=(x:unknown):x is string=>typeof x==="string"&&x.trim().length>0;
const validDigest=(x:unknown):x is string=>typeof x==="string"&&x.trim().length>=16;
const exactBool=(x:unknown):x is boolean=>typeof x==="boolean";

export function authorizeAction(req: ActionRequest, ctx: ActionPolicyContext): {allowed:true}|{allowed:false;reason:string} {
  if(!req||typeof req!=="object"||!ctx||typeof ctx!=="object") return {allowed:false,reason:"ACTION_CONTEXT_INVALID"};
  if(!actionClasses.has(req.actionClass)) return {allowed:false,reason:"ACTION_CLASS_INVALID"};
  if(!nonEmpty(req.id)||!nonEmpty(req.missionId)||!nonEmpty(req.actorId)||!nonEmpty(req.target)||!validDigest(req.actionDigest)||!validDigest(req.targetDigest)) return {allowed:false,reason:"ACTION_IDENTITY_INVALID"};
  if(!exactBool(req.production)||!exactBool(req.reversible)) return {allowed:false,reason:"ACTION_SEMANTICS_INVALID"};
  if(!exactBool(ctx.scopeAllowed)||!exactBool(ctx.dataPolicyAllowed)||!exactBool(ctx.budgetAllowed)||!exactBool(ctx.adapterCertified)) return {allowed:false,reason:"POLICY_CONTEXT_INVALID"};
  if(ctx.now!==undefined&&(!(ctx.now instanceof Date)||!Number.isFinite(ctx.now.getTime()))) return {allowed:false,reason:"POLICY_TIME_INVALID"};
  if(req.estimatedCost!==undefined&&(!Number.isFinite(req.estimatedCost)||req.estimatedCost<0)) return {allowed:false,reason:"INVALID_ESTIMATED_COST"};
  if(req.actionClass==="SPEND"&&req.estimatedCost===undefined) return {allowed:false,reason:"SPEND_AMOUNT_REQUIRED"};
  if(req.actionClass==="IRREVERSIBLE"&&req.reversible!==false) return {allowed:false,reason:"IRREVERSIBLE_SEMANTICS_MISMATCH"};
  if(req.production&&!approvalClasses.has(req.actionClass)) return {allowed:false,reason:"PRODUCTION_ACTION_REQUIRES_APPROVAL_CLASS"};
  if(!ctx.scopeAllowed) return {allowed:false,reason:"SCOPE_DENIED"};
  if(!ctx.dataPolicyAllowed) return {allowed:false,reason:"DATA_POLICY_DENIED"};
  if(!ctx.adapterCertified) return {allowed:false,reason:"ADAPTER_NOT_CERTIFIED"};
  if((req.actionClass==="SPEND"||(req.estimatedCost??0)>0) && !ctx.budgetAllowed) return {allowed:false,reason:"BUDGET_DENIED"};
  if(approvalClasses.has(req.actionClass)){
    if(!ctx.approval) return {allowed:false,reason:"APPROVAL_REQUIRED"};
    try{assertApprovalValid(ctx.approval,req.actionDigest,req.targetDigest,ctx.trustedApproverIdentityIds??[],ctx.now??new Date())}
    catch(error){return {allowed:false,reason:`APPROVAL_INVALID:${error instanceof Error?error.message:"UNKNOWN"}`}}
  }
  if(req.actionClass!=="READ_ONLY" && !req.reversible && !nonEmpty(req.idempotencyKey))
    return {allowed:false,reason:"NON_IDEMPOTENT_IRREVERSIBLE_ACTION_WITHOUT_KEY"};
  return {allowed:true};
}
