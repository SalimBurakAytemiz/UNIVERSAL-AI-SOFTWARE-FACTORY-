// //TR: Bu helper builder işini LOCAL_CLAUDE ile CLAUDE_CLOUD_SESSION arasında fail-closed yönlendirir: registry'yi sıkı doğrular, host'a bağlı/Founder'a özel işleri cloud'a asla göndermez, bilinmeyen erişilebilirliği erişilemez sayar, cloud'u taklit etmez, fallback'i yalnız politika izin verirse uygular; yürütme provenance kaydını üretir/doğrular ve üreticiden bağımsız governed CLEAN review olmadan merge'e izin vermez.
import crypto from "node:crypto";
import {stableStringify} from "./atomic-json.mjs";
export const ROUTE_DECISION_VERSION="1.0.0";
export const EXECUTION_PROVENANCE_VERSION="1.0.0";
const MODES=["AUTO","LOCAL_ONLY","CLOUD_PREFERRED","CLOUD_ONLY"],LOCAL="LOCAL_CLAUDE",CLOUD="CLAUDE_CLOUD_SESSION";
const REVIEW_STATUSES=["PENDING_INDEPENDENT_REVIEW","CLEAN","BLOCKED","ENVIRONMENT_BLOCKED","REVIEW_INPUT_INVALID"];
const SHA=/^[0-9a-f]{64}$/,COMMIT=/^[0-9a-f]{40}$/;
const bad=(prefix,reason)=>{throw new Error(`${prefix}:${reason}`)};
const arr=x=>Array.isArray(x)&&x.every(y=>typeof y==="string");
const digest=x=>crypto.createHash("sha256").update(stableStringify(x)).digest("hex");
const deepFreeze=o=>{if(o&&typeof o==="object"){Object.freeze(o);for(const v of Object.values(o))deepFreeze(v)}return o};
// //TR: Registry güvenlik değişmezlerini taşımazsa (cloud host'a bağlı işi yapabilir, imza anahtarı cloud'a açık, üretici kendi çıktısını review edebilir...) yükleme reddedilir.
export function loadExecutionBackendRegistry(doc){
  const R="EXECUTION_REGISTRY_INVALID";if(!doc||typeof doc!=="object")bad(R,"NOT_OBJECT");
  const r=doc.routing,t=doc.taskClasses,b=doc.backends,p=doc.pipeline;
  if(!r||JSON.stringify(r.modes)!==JSON.stringify(MODES))bad(R,"MODES");if(!MODES.includes(r.defaultMode))bad(R,"DEFAULT_MODE");if(r.unknownAvailabilityIsUnavailable!==true)bad(R,"UNKNOWN_AVAILABILITY_MUST_BE_UNAVAILABLE");if(r.unclassifiedTaskType!=="LOCAL_ONLY")bad(R,"UNCLASSIFIED_TASK_MUST_BE_LOCAL_ONLY");
  if(!r.fallback||r.fallback.cloudToLocal?.CLOUD_ONLY!==false||r.fallback.localToCloud?.LOCAL_ONLY!==false)bad(R,"FALLBACK_MUST_RESPECT_ONLY_MODES");
  if(!t||!arr(t.cloudEligible)||!arr(t.localOnly)||!arr(t.founderOnly))bad(R,"TASK_CLASSES");const all=[...t.cloudEligible,...t.localOnly,...t.founderOnly];if(new Set(all).size!==all.length)bad(R,"TASK_CLASSES_NOT_DISJOINT");
  for(const x of ["TARGET_MACHINE_PHASE0","WINDOWS_ACL_CHANGE","TASK_SCHEDULER_CHANGE","FINAL_LOCAL_INSTALL_VALIDATION","HOST_HARDWARE_CHECK","LOCAL_CREDENTIAL_OPERATION","LOCAL_DEVICE_OPERATION"])if(!t.localOnly.includes(x))bad(R,`LOCAL_ONLY_MISSING:${x}`);
  if(!t.founderOnly.includes("RELEASE_SIGNING_PRIVATE_KEY"))bad(R,"RELEASE_SIGNING_MUST_BE_FOUNDER_ONLY");
  if(!arr(doc.hostBoundResources)||!doc.hostBoundResources.includes("PRIVATE_SIGNING_KEY"))bad(R,"HOST_BOUND_RESOURCES");
  if(!arr(doc.cloudForbiddenDataClasses)||!["PRIVATE_SIGNING_KEY","EVIDENCE_SIGNING_KEY","LOCAL_CREDENTIAL","PROVIDER_AUTH_TOKEN"].every(x=>doc.cloudForbiddenDataClasses.includes(x)))bad(R,"CLOUD_FORBIDDEN_DATA_CLASSES");
  if(!arr(doc.cloudAllowedSecurityClassifications)||doc.cloudAllowedSecurityClassifications.some(x=>["CONFIDENTIAL","RESTRICTED","SECRET"].includes(x)))bad(R,"CLOUD_SECURITY_CLASSIFICATIONS");
  if(!doc.riskLevelClassification||typeof doc.riskLevelClassification!=="object")bad(R,"RISK_LEVEL_CLASSIFICATION");
  if(!b||!b[LOCAL]||!b[CLOUD]||Object.keys(b).some(k=>![LOCAL,CLOUD].includes(k)))bad(R,"BACKENDS");
  for(const [k,v] of Object.entries(b)){if(v.sessionType!==(k===LOCAL?"LOCAL_CLI_PROCESS":"CLAUDE_CLOUD_SESSION"))bad(R,`SESSION_TYPE:${k}`);if(!["CONFIGURED","NOT_CONFIGURED"].includes(v.dispatch?.status))bad(R,`DISPATCH_STATUS:${k}`);if(typeof v.provider!=="string"||!v.provider)bad(R,`PROVIDER:${k}`)}
  const c=b[CLOUD];if(c.hostBoundCapable!==false)bad(R,"CLOUD_MUST_NOT_BE_HOST_BOUND_CAPABLE");if(c.mayMutateDefaultBranch!==false)bad(R,"CLOUD_MUST_NOT_MUTATE_DEFAULT_BRANCH");if(c.capacityModel!=="PRODUCT_MANAGED_CAPACITY_NOT_API_CREDITS")bad(R,"CLOUD_CAPACITY_MODEL");if(c.billingApi!=="NONE_ASSUMED")bad(R,"CLOUD_BILLING_API_MUST_NOT_BE_ASSUMED");if(c.dispatch.status==="CONFIGURED"&&(typeof c.dispatch.adapter!=="string"||!c.dispatch.adapter))bad(R,"CLOUD_DISPATCH_CONFIGURED_WITHOUT_ADAPTER");
  if(!p||p.producerMayReviewOwnOutput!==false)bad(R,"PRODUCER_MUST_NOT_REVIEW_OWN_OUTPUT");if(Object.values(b).some(v=>v.provider===p.independentReviewerProvider))bad(R,"REVIEWER_PROVIDER_MUST_DIFFER_FROM_PRODUCERS");if(p.mergeRequiresGovernedResult!=="CLEAN")bad(R,"MERGE_REQUIRES_CLEAN");
  for(const x of ["DETERMINISTIC_VALIDATION","EVIDENCE","INDEPENDENT_CODEX_REVIEW","REMEDIATION_RE_REVIEW","MERGE_GATE"])if(!arr(p.producedWorkEnters)||!p.producedWorkEnters.includes(x))bad(R,`PIPELINE_STAGE_MISSING:${x}`);
  return deepFreeze(JSON.parse(JSON.stringify(doc)));
}
// //TR: Frozen review package'ı yönlendirme görevine çevirir; risk seviyesi eşlenemezse RESTRICTED sayılır (cloud'a gidemez).
export function taskFromReviewPackage(milestone,registry,{taskType="IMPLEMENTATION_PACKAGE",expectedDurationMinutes=null,parallelizable=false}={}){
  return {taskType,securityClassification:registry.riskLevelClassification[String(milestone?.riskLevel)]??"RESTRICTED",requiresHostResources:[],dataClasses:[],requiresLocalCredentials:false,filesystemBoundary:"WORKTREE_ONLY",networkBoundary:"PROVIDER_ONLY",expectedDurationMinutes,parallelizable};
}
// //TR: Yalnız belgelenmiş/yerel sinyaller okunur; cloud kapasitesi veya faturalama için belgelenmiş sinyal olmadığından UNKNOWN kalır ve dispatch yapılandırılmadıkça cloud erişilemez sayılır.
export function observeExecutionBackends({registry,providerProvenance=null,localQuotaPressure="UNKNOWN"}){
  const localOk=providerProvenance?.final==="PASS"&&providerProvenance?.claude?.status==="PASS",dispatchConfigured=registry.backends[CLOUD].dispatch.status==="CONFIGURED";
  return {local:{available:localOk,quotaPressure:["LOW","HIGH"].includes(localQuotaPressure)?localQuotaPressure:"UNKNOWN",signal:registry.backends[LOCAL].availabilitySignal},cloud:{available:dispatchConfigured?"UNKNOWN":false,dispatchConfigured,capacity:"UNKNOWN",signal:registry.backends[CLOUD].availabilitySignal}};
}
export function routeExecution({task,registry,mode=null,observations}){
  const m=mode??registry.routing.defaultMode;if(!MODES.includes(m))bad("ROUTING_MODE_INVALID",String(m));
  if(!task||typeof task.taskType!=="string"||typeof task.securityClassification!=="string")bad("ROUTING_TASK_INVALID","TASK_TYPE_OR_CLASSIFICATION");
  const hostRes=arr(task.requiresHostResources)?task.requiresHostResources:[],dataClasses=arr(task.dataClasses)?task.dataClasses:[],t=registry.taskClasses,reasons=[];
  const localAvail=observations?.local?.available===true,cloudAvail=observations?.cloud?.available===true;
  if(observations?.cloud?.available!==true&&observations?.cloud?.available!==false)reasons.push("CLOUD_AVAILABILITY_UNKNOWN_TREATED_UNAVAILABLE");
  if(observations?.cloud?.dispatchConfigured===false)reasons.push("CLOUD_DISPATCH_NOT_CONFIGURED");
  const out=(decision,extra={})=>{const backend=[LOCAL,CLOUD].includes(decision)?decision:null;const r={"//TR":"Bu kayıt tek bir builder işinin yürütme backend kararını ve gerekçelerini taşır; cloud kararı yalnız erişilebilir, yapılandırılmış bir dispatch ile verilir ve çıktı her durumda bağımsız Codex review'dan geçer.",schemaVersion:ROUTE_DECISION_VERSION,mode:m,taskType:task.taskType,securityClassification:task.securityClassification,hostBound:false,founderOnly:false,fallbackUsed:false,...extra,decision,backend,reasons:[...reasons],observations:{local:{available:observations?.local?.available??"UNKNOWN",quotaPressure:observations?.local?.quotaPressure??"UNKNOWN"},cloud:{available:observations?.cloud?.available??"UNKNOWN",dispatchConfigured:observations?.cloud?.dispatchConfigured??false,capacity:observations?.cloud?.capacity??"UNKNOWN"}},isolation:backend?registry.backends[backend].isolation:null,mayMutateDefaultBranch:false,forbiddenCloudInputs:decision===CLOUD?[...registry.cloudForbiddenDataClasses]:[],pipeline:{stages:[...registry.pipeline.producedWorkEnters],producerProvider:backend?registry.backends[backend].provider:null,independentReviewerProvider:registry.pipeline.independentReviewerProvider,producerMayReviewOwnOutput:false,mergeRequiresGovernedResult:registry.pipeline.mergeRequiresGovernedResult}};return r};
  // //TR: Founder'a özel işler (özel release imza anahtarı) hiçbir otomatik backend'e, hiçbir modda gitmez.
  if(t.founderOnly.includes(task.taskType)){reasons.push("FOUNDER_ONLY_TASK_NO_AUTOMATED_BACKEND");return out("FOUNDER_ACTION_REQUIRED",{hostBound:true,founderOnly:true})}
  const host=[];if(t.localOnly.includes(task.taskType))host.push(`LOCAL_ONLY_TASK_TYPE:${task.taskType}`);for(const x of hostRes)if(registry.hostBoundResources.includes(x))host.push(`HOST_BOUND_RESOURCE:${x}`);for(const x of dataClasses)if(registry.cloudForbiddenDataClasses.includes(x))host.push(`CLOUD_FORBIDDEN_DATA_CLASS:${x}`);
  if(task.requiresLocalCredentials===true)host.push("REQUIRES_LOCAL_CREDENTIALS");if(task.filesystemBoundary!=="WORKTREE_ONLY")host.push(`FILESYSTEM_BOUNDARY:${task.filesystemBoundary??"UNSPECIFIED"}`);if(!registry.cloudAllowedSecurityClassifications.includes(task.securityClassification))host.push(`SECURITY_CLASSIFICATION_NOT_CLOUD_ALLOWED:${task.securityClassification}`);if(!t.cloudEligible.includes(task.taskType)&&!t.localOnly.includes(task.taskType))host.push(`TASK_TYPE_NOT_CLOUD_ELIGIBLE:${task.taskType}`);
  if(host.length){reasons.push(...host,"HOST_BOUND_LOCAL_ONLY");if(m==="CLOUD_ONLY"||m==="CLOUD_PREFERRED")reasons.push("CLOUD_MODE_DOES_NOT_APPLY_TO_HOST_BOUND_WORK");if(localAvail)return out(LOCAL,{hostBound:true});reasons.push("LOCAL_UNAVAILABLE_TASK_QUEUED");return out("QUEUED",{hostBound:true})}
  const fb=registry.routing.fallback,pref=registry.routing.autoPrefersCloudWhen;
  const cloudOr=(fallbackAllowed)=>{if(cloudAvail)return out(CLOUD);reasons.push("CLOUD_UNAVAILABLE");if(fallbackAllowed&&localAvail){reasons.push("POLICY_FALLBACK_TO_LOCAL");return out(LOCAL,{fallbackUsed:true})}reasons.push(fallbackAllowed?"LOCAL_UNAVAILABLE_TASK_QUEUED":"NO_FALLBACK_IN_MODE_TASK_QUEUED");return out("QUEUED")};
  const localOr=(fallbackAllowed)=>{if(localAvail)return out(LOCAL);reasons.push("LOCAL_UNAVAILABLE");if(fallbackAllowed&&cloudAvail){reasons.push("POLICY_FALLBACK_TO_CLOUD");return out(CLOUD,{fallbackUsed:true})}reasons.push(fallbackAllowed?"CLOUD_UNAVAILABLE_TASK_QUEUED":"NO_FALLBACK_IN_MODE_TASK_QUEUED");return out("QUEUED")};
  if(m==="LOCAL_ONLY")return localOr(fb.localToCloud.LOCAL_ONLY===true);
  if(m==="CLOUD_ONLY")return cloudOr(fb.cloudToLocal.CLOUD_ONLY===true);
  if(m==="CLOUD_PREFERRED")return cloudOr(fb.cloudToLocal.CLOUD_PREFERRED===true);
  const preferCloud=(Number.isFinite(task.expectedDurationMinutes)&&task.expectedDurationMinutes>=pref.minExpectedDurationMinutes)||(task.parallelizable===true&&pref.parallelizable===true)||(observations?.local?.quotaPressure===pref.localQuotaPressure);
  if(preferCloud){reasons.push("AUTO_PREFERS_CLOUD_FOR_LONG_PARALLEL_OR_LOCAL_PRESSURE");return cloudOr(fb.cloudToLocal.AUTO===true)}
  reasons.push("AUTO_PREFERS_LOCAL");return localOr(fb.localToCloud.AUTO===true);
}
export function routeDecisionDigest(route){return digest(route)}
export function validateExecutionProvenance(p,registry,{defaultBranch="main",runBranchPrefix=null}={}){
  const P="EXECUTION_PROVENANCE_INVALID";if(!p||p.schemaVersion!==EXECUTION_PROVENANCE_VERSION)bad(P,"VERSION");const be=registry.backends[p.executionBackend];if(!be)bad(P,"BACKEND");
  if(p.sessionType!==be.sessionType)bad(P,"SESSION_TYPE");if(p.provider!==be.provider)bad(P,"PROVIDER");if(typeof p.tool!=="string"||!p.tool)bad(P,"TOOL");if(typeof p.toolVersion!=="string"||!p.toolVersion)bad(P,"TOOL_VERSION");
  if(typeof p.branch!=="string"||!p.branch||p.branch===defaultBranch||p.branch===`refs/heads/${defaultBranch}`)bad(P,"BRANCH_NOT_ISOLATED");if(runBranchPrefix&&!p.branch.startsWith(runBranchPrefix))bad(P,"BRANCH_OUTSIDE_RUN_PREFIX");if(typeof p.workspaceId!=="string"||!p.workspaceId)bad(P,"WORKSPACE");
  if(!COMMIT.test(String(p.sourceCommit)))bad(P,"SOURCE_COMMIT");if(p.resultCommit!==null&&!COMMIT.test(String(p.resultCommit)))bad(P,"RESULT_COMMIT");if(!REVIEW_STATUSES.includes(p.reviewStatus))bad(P,"REVIEW_STATUS");if(p.reviewStatus!=="PENDING_INDEPENDENT_REVIEW"&&p.resultCommit===null)bad(P,"RESULT_COMMIT_REQUIRED_AFTER_REVIEW");
  const s=Date.parse(p.startedAt),f=Date.parse(p.finishedAt);if(!Number.isFinite(s)||!Number.isFinite(f)||f<s)bad(P,"TIMESTAMPS");if(!SHA.test(String(p.evidenceDigest)))bad(P,"EVIDENCE_DIGEST");if(!SHA.test(String(p.routeDigest)))bad(P,"ROUTE_DIGEST");
  return true;
}
export function buildExecutionProvenance({registry,route,branch,workspaceId,sourceCommit,resultCommit=null,startedAt,finishedAt,toolVersion,evidenceDigest,reviewStatus="PENDING_INDEPENDENT_REVIEW",reviewerProvider=null,reviewDigest=null,defaultBranch="main",runBranchPrefix=null}){
  if(![LOCAL,CLOUD].includes(route?.decision))bad("EXECUTION_PROVENANCE_INVALID","ROUTE_NOT_EXECUTABLE");const be=registry.backends[route.decision];
  const p={"//TR":"Bu kayıt bir builder yürütmesinin hangi backend'de, hangi izole dal/çalışma alanında, hangi kaynak ve sonuç commit'iyle ve hangi review durumuyla üretildiğini hash'leriyle bağlar.",schemaVersion:EXECUTION_PROVENANCE_VERSION,executionBackend:route.decision,sessionType:be.sessionType,provider:be.provider,tool:be.tool,toolVersion:String(toolVersion??""),branch,workspaceId,sourceCommit,resultCommit,startedAt,finishedAt,evidenceDigest,routeDigest:digest(route),routeMode:route.mode,fallbackUsed:route.fallbackUsed===true,reviewStatus,reviewerProvider,reviewDigest};
  validateExecutionProvenance(p,registry,{defaultBranch,runBranchPrefix});return p;
}
// //TR: Merge kapısı: üretici hangi backend olursa olsun, üreticiden farklı bağımsız reviewer'ın governed CLEAN sonucu ve izole dal olmadan merge yok; Claude çıktısı kendini review edemez.
export function assertExecutionMergeGate({provenance,registry,governedResult,reviewerProvider,defaultBranch="main",runBranchPrefix=null}){
  const G="EXECUTION_MERGE_GATE_DENIED";validateExecutionProvenance(provenance,registry,{defaultBranch,runBranchPrefix});
  if(governedResult!==registry.pipeline.mergeRequiresGovernedResult)bad(G,`GOVERNED_RESULT:${governedResult}`);if(reviewerProvider!==registry.pipeline.independentReviewerProvider)bad(G,`REVIEWER_NOT_INDEPENDENT_PROVIDER:${reviewerProvider}`);if(String(reviewerProvider).toUpperCase()===String(provenance.provider).toUpperCase())bad(G,"PRODUCER_REVIEWED_OWN_OUTPUT");
  if(provenance.reviewStatus!=="CLEAN"||provenance.reviewerProvider!==reviewerProvider)bad(G,"PROVENANCE_REVIEW_STATUS_NOT_CLEAN");if(provenance.resultCommit===null)bad(G,"RESULT_COMMIT_MISSING");if(provenance.executionBackend===CLOUD&&registry.backends[CLOUD].mayMutateDefaultBranch!==false)bad(G,"CLOUD_DEFAULT_BRANCH_MUTATION");
  return true;
}
