// //TR: Bu helper supervisor/model/git external side-effectlerini protected action-policy + global config üzerinden fail-closed authorize eder; config'teki remote/spend/risk kuralları dekoratif değildir.
import fs from "node:fs";
const policy=JSON.parse(fs.readFileSync("config/action-policy.json","utf8"));
const allowedSelfBuild=new Set(policy.allowedSelfBuildActions??[]);
const exactBool=(x)=>typeof x==="boolean";
const validRisk=(x)=>Number.isInteger(x)&&x>=0&&x<=5;
const cfgBool=(obj,key)=>obj&&typeof obj==="object"&&exactBool(obj[key])?obj[key]:null;
const milestoneRisk=(milestone)=>milestone&&typeof milestone==="object"&&validRisk(milestone.riskLevel)?milestone.riskLevel:null;
export function authorizeAutomationAction({action,milestone,globalConfig,remoteProtection=null,providerApproved=false,dataEgressSafe=false,estimatedCost=0,reviewClean=false}={}){
 const deny=(reason)=>({allowed:false,reason});
 if(typeof action!=="string"||!action)return deny("ACTION_INVALID");
 if(action==="MODEL_EGRESS_APPROVED_PROVIDER"){
   if(!allowedSelfBuild.has(action))return deny("MODEL_EGRESS_NOT_ALLOWED_BY_ACTION_POLICY");
   if(providerApproved!==true)return deny("MODEL_PROVIDER_NOT_APPROVED");
   if(dataEgressSafe!==true)return deny("MODEL_EGRESS_DLP_BLOCKED");
   const risk=milestoneRisk(milestone);if(risk===null)return deny("MILESTONE_RISK_INVALID");
   const allowRisk5=cfgBool(globalConfig,"allowRisk5");if(allowRisk5===null)return deny("GLOBAL_CONFIG_INVALID");
   if(risk>=5&&(allowRisk5!==true||policy.risk5Allowed!==true))return deny("RISK5_MODEL_EGRESS_DENIED");
   return {allowed:true};
 }
 if(action==="LOCAL_GIT_COMMIT"||action==="LOCAL_FAST_FORWARD_MERGE")return allowedSelfBuild.has(action)?{allowed:true}:deny(`ACTION_NOT_ALLOWED_BY_POLICY:${action}`);
 if(action==="REMOTE_PUSH"){
   const risk=milestoneRisk(milestone);if(risk===null)return deny("MILESTONE_RISK_INVALID");
   const allowProduction=cfgBool(globalConfig,"allowProduction"),allowRisk5=cfgBool(globalConfig,"allowRisk5"),allowLocalOnlyAutonomy=cfgBool(globalConfig,"allowLocalOnlyAutonomy");
   if(allowProduction===null||allowRisk5===null||allowLocalOnlyAutonomy===null)return deny("GLOBAL_CONFIG_INVALID");
   const req=new Set(policy.remotePushRequires??[]);
   if(req.has("review-clean")&&reviewClean!==true)return deny("REMOTE_PUSH_REVIEW_NOT_CLEAN");
   if(req.has("remote-policy-allowed")&&policy.remotePushAllowed!==true)return deny("REMOTE_PUSH_NOT_ALLOWED_BY_POLICY");
   if(milestone?.allowProduction!==undefined&&milestone.allowProduction!==true&&milestone.allowProduction!==false)return deny("MILESTONE_PRODUCTION_FLAG_INVALID");
   if(milestone?.allowProduction===true&&(allowProduction!==true||policy.productionActionsAllowed!==true))return deny("PRODUCTION_POLICY_DENIED");
   if(risk>=5&&(allowRisk5!==true||policy.risk5Allowed!==true))return deny("RISK5_REMOTE_PUSH_DENIED");
   if(req.has("remote-protection-or-explicit-local-only")){
     if(remoteProtection?.status==="PASS")return {allowed:true};
     if(allowLocalOnlyAutonomy===true)return deny("REMOTE_PROTECTION_NOT_VERIFIED_LOCAL_ONLY");
     return deny("REMOTE_PROTECTION_REQUIRED");
   }
   return deny("REMOTE_PUSH_REQUIREMENTS_INCOMPLETE");
 }
 if(action==="SPEND"){
   if(!Number.isFinite(estimatedCost)||estimatedCost<0)return deny("SPEND_AMOUNT_INVALID");
   const allowPaidApi=cfgBool(globalConfig,"allowPaidApi");if(allowPaidApi===null)return deny("GLOBAL_CONFIG_INVALID");
   if(policy.spendAllowed!==true||allowPaidApi!==true)return deny("SPEND_DENIED");
   return {allowed:true};
 }
 return deny(`ACTION_DEFAULT_DENY:${action}`);
}
export function assertAutomationAction(input){const x=authorizeAutomationAction(input);if(!x.allowed)throw new Error(x.reason);return x}
