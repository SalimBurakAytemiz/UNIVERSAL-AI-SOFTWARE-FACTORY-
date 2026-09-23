// //TR: Bu helper supervisor/model/git external side-effectlerini protected action-policy + global config üzerinden fail-closed authorize eder; config'teki remote/spend/risk kuralları dekoratif değildir.
import fs from "node:fs";
const policy=JSON.parse(fs.readFileSync("config/action-policy.json","utf8"));
const allowedSelfBuild=new Set(policy.allowedSelfBuildActions??[]);
export function authorizeAutomationAction({action,milestone,globalConfig,remoteProtection=null,providerApproved=false,dataEgressSafe=false,estimatedCost=0,reviewClean=false}){
 const deny=(reason)=>({allowed:false,reason});
 if(action==="MODEL_EGRESS_APPROVED_PROVIDER"){
   if(!allowedSelfBuild.has(action))return deny("MODEL_EGRESS_NOT_ALLOWED_BY_ACTION_POLICY");
   if(!providerApproved)return deny("MODEL_PROVIDER_NOT_APPROVED");
   if(!dataEgressSafe)return deny("MODEL_EGRESS_DLP_BLOCKED");
   if((milestone?.riskLevel??0)>=5&&(!globalConfig.allowRisk5||policy.risk5Allowed!==true))return deny("RISK5_MODEL_EGRESS_DENIED");
   return {allowed:true};
 }
 if(action==="LOCAL_GIT_COMMIT"||action==="LOCAL_FAST_FORWARD_MERGE")return allowedSelfBuild.has(action)?{allowed:true}:deny(`ACTION_NOT_ALLOWED_BY_POLICY:${action}`);
 if(action==="REMOTE_PUSH"){
   const req=new Set(policy.remotePushRequires??[]);
   if(req.has("review-clean")&&reviewClean!==true)return deny("REMOTE_PUSH_REVIEW_NOT_CLEAN");
   if(req.has("remote-policy-allowed")&&policy.remotePushAllowed!==true)return deny("REMOTE_PUSH_NOT_ALLOWED_BY_POLICY");
   if(milestone?.allowProduction===true&&(!globalConfig.allowProduction||policy.productionActionsAllowed!==true))return deny("PRODUCTION_POLICY_DENIED");
   if((milestone?.riskLevel??0)>=5&&(!globalConfig.allowRisk5||policy.risk5Allowed!==true))return deny("RISK5_REMOTE_PUSH_DENIED");
   if(req.has("remote-protection-or-explicit-local-only")){
     if(remoteProtection?.status==="PASS")return {allowed:true};
     if(globalConfig.allowLocalOnlyAutonomy===true)return deny("REMOTE_PROTECTION_NOT_VERIFIED_LOCAL_ONLY");
     return deny("REMOTE_PROTECTION_REQUIRED");
   }
   return deny("REMOTE_PUSH_REQUIREMENTS_INCOMPLETE");
 }
 if(action==="SPEND"){
   if(!Number.isFinite(estimatedCost)||estimatedCost<0)return deny("SPEND_AMOUNT_INVALID");
   if(policy.spendAllowed!==true||!globalConfig.allowPaidApi)return deny("SPEND_DENIED");
   return {allowed:true};
 }
 return deny(`ACTION_DEFAULT_DENY:${action}`);
}
export function assertAutomationAction(input){const x=authorizeAutomationAction(input);if(!x.allowed)throw new Error(x.reason);return x}
