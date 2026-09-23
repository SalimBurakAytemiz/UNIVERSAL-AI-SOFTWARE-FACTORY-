// //TR: Bu helper supervisor'ın model egress/Git merge/remote push gibi side-effectlerini fail-closed authorize eder; model egress yalnız approved provider + DLP-safe prompt ile yapılabilir ve production/spend/risk sınırları bypass edilemez.
import fs from "node:fs";
const policy=JSON.parse(fs.readFileSync("config/action-policy.json","utf8"));
export function authorizeAutomationAction({action,milestone,globalConfig,remoteProtection=null,providerApproved=false,dataEgressSafe=false,estimatedCost=0}){
 const deny=(reason)=>({allowed:false,reason});
 if(action==="MODEL_EGRESS_APPROVED_PROVIDER"){
   if(!providerApproved)return deny("MODEL_PROVIDER_NOT_APPROVED");
   if(!dataEgressSafe)return deny("MODEL_EGRESS_DLP_BLOCKED");
   if((milestone?.riskLevel??0)>=5&&!globalConfig.allowRisk5)return deny("RISK5_MODEL_EGRESS_DENIED");
   return {allowed:true};
 }
 if(action==="LOCAL_GIT_COMMIT"||action==="LOCAL_FAST_FORWARD_MERGE")return {allowed:true};
 if(action==="REMOTE_PUSH"){
   if(milestone?.allowProduction===true&&!globalConfig.allowProduction)return deny("PRODUCTION_POLICY_DENIED");
   if(remoteProtection?.status==="PASS")return {allowed:true};
   if(globalConfig.allowLocalOnlyAutonomy===true)return deny("REMOTE_PROTECTION_NOT_VERIFIED_LOCAL_ONLY");
   return deny("REMOTE_PUSH_DENIED");
 }
 if(action==="SPEND"){
   if(!Number.isFinite(estimatedCost)||estimatedCost<0)return deny("SPEND_AMOUNT_INVALID");
   if(!globalConfig.allowPaidApi)return deny("SPEND_DENIED");
   return {allowed:true};
 }
 return deny(`ACTION_DEFAULT_DENY:${action}`);
}
export function assertAutomationAction(input){const x=authorizeAutomationAction(input);if(!x.allowed)throw new Error(x.reason);return x}
