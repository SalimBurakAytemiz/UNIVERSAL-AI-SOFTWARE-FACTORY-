// //TR: Bu dosya external side-effect action'ların scope/data/budget/certification/approval kapılarından geçmeden yürütülmesini fail-closed olarak engeller.
import type { ActionPolicyContext, ActionRequest } from "./types.js";

const approvalClasses = new Set([
  "SPEND","PRODUCTION_CHANGE","DESTRUCTIVE","IRREVERSIBLE","LEGAL_FINANCIAL_AUTHORITY"
]);

export function authorizeAction(req: ActionRequest, ctx: ActionPolicyContext): {allowed:true}|{allowed:false;reason:string} {
  if(!ctx.scopeAllowed) return {allowed:false,reason:"SCOPE_DENIED"};
  if(!ctx.dataPolicyAllowed) return {allowed:false,reason:"DATA_POLICY_DENIED"};
  if(!ctx.adapterCertified) return {allowed:false,reason:"ADAPTER_NOT_CERTIFIED"};
  if((req.estimatedCost??0)>0 && !ctx.budgetAllowed) return {allowed:false,reason:"BUDGET_DENIED"};
  if(approvalClasses.has(req.actionClass) && !ctx.approvalValid) return {allowed:false,reason:"APPROVAL_REQUIRED"};
  if(req.actionClass!=="READ_ONLY" && !req.idempotencyKey && !req.reversible)
    return {allowed:false,reason:"NON_IDEMPOTENT_IRREVERSIBLE_ACTION_WITHOUT_KEY"};
  return {allowed:true};
}
