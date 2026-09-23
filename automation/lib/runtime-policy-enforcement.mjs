// //TR: Bu helper protected config'lerde ENFORCED/required diye ilan edilen runtime policy'lerin gerçekten desteklenen davranışa bağlı olduğunu fail-closed doğrular.
export function assertRuntimePolicyConfig({automation,builderPolicy,evidencePolicy,actionPolicy,parallelLanes}){
  const errors=[];
  if(automation?.maxParallelLanes!==1)errors.push("PARALLEL_RUNTIME_ONLY_SUPPORTS_ONE_LANE");
  if((parallelLanes?.lanes??[]).some(x=>x.defaultConcurrency!==1))errors.push("PARALLEL_LANE_CONCURRENCY_NOT_RUNTIME_SUPPORTED");
  if(automation?.scheduler?.adaptivePackageSplit?.status!=="PLANNED_NOT_RUNTIME_ENFORCED"||automation?.scheduler?.adaptivePackageSplit?.requiredForCurrentConstruction!==false)errors.push("ADAPTIVE_PACKAGE_SPLIT_TRUTH_INVALID");
  if(automation?.reviewer?.provenanceRequired!==true)errors.push("REVIEWER_PROVENANCE_MUST_BE_REQUIRED");
  if(automation?.sandbox?.productionRequiresOsSandbox!==true||builderPolicy?.highRiskRequiresOsSandbox!==true)errors.push("OS_SANDBOX_REQUIREMENT_MISSING");
  if(automation?.sandbox?.osSandboxRuntimeAttestation?.status!=="PLANNED_NOT_RUNTIME_VERIFIABLE")errors.push("OS_SANDBOX_RUNTIME_STATUS_OVERCLAIM");
  if(evidencePolicy?.verifyBeforeCompletion!==true||evidencePolicy?.eventHashChain!==true||evidencePolicy?.attestationSignature!=="ED25519")errors.push("EVIDENCE_COMPLETION_POLICY_INVALID");
  if(automation?.evidence?.eventHashChain!==true||automation?.evidence?.signingRequired!==true)errors.push("AUTOMATION_EVIDENCE_POLICY_INVALID");
  if(actionPolicy?.defaultDeny!==true)errors.push("ACTION_POLICY_DEFAULT_DENY_REQUIRED");
  if(actionPolicy?.remotePushAllowed!==true)errors.push("REMOTE_PUSH_POLICY_NOT_EXPLICITLY_ALLOWED");
  const required=new Set(actionPolicy?.remotePushRequires??[]);for(const x of ["review-clean","remote-policy-allowed","remote-protection-or-explicit-local-only"])if(!required.has(x))errors.push(`REMOTE_PUSH_REQUIREMENT_MISSING:${x}`);
  if(errors.length)throw new Error(`RUNTIME_POLICY_CONFIG_INVALID:${errors.join(",")}`);
  return {ok:true,serialExecution:true,reviewerProvenanceRequired:true,summaryVerificationRequired:true};
}
export function sandboxPolicyViolation({milestone,automation,builderPolicy}){
  const needs=milestone?.allowProduction===true||Number(milestone?.riskLevel??0)>=5||milestone?.allowRisk5===true;
  if(!needs)return null;
  if(automation?.sandbox?.productionRequiresOsSandbox!==true||builderPolicy?.highRiskRequiresOsSandbox!==true)return "OS_SANDBOX_REQUIREMENT_MISSING";
  // //TR: Gerçek bağımsız OS/container sandbox attestation verifier henüz yoktur; bu yüzden production/Risk5 yolu bilinçli fail-closed kalır.
  if(automation?.sandbox?.osSandboxRuntimeAttestation?.status!=="RUNTIME_ENFORCED")return "OS_SANDBOX_NOT_RUNTIME_ENFORCED";
  return "OS_SANDBOX_RUNTIME_ATTESTATION_CONSUMER_MISSING";
}
