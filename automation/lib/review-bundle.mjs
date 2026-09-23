// //TR: Bu helper frozen review scope'unu stable review basis + bounded validation evidence ile immutable digest'e bağlar; remediation sonrası yalnız finding'e bağlı PASS validation adımlarından retest evidence üretir.
import crypto from "node:crypto";
import {stableStringify} from "./atomic-json.mjs";
import {compactValidationForReview} from "./context-budget.mjs";
const safeId=x=>String(x).toUpperCase().replace(/[^A-Z0-9._-]+/g,"-");
const sha=x=>crypto.createHash("sha256").update(stableStringify(x)).digest("hex");
export function buildReviewBundle(input){
 const compactValidation=compactValidationForReview(input.validation,input.budgets??{});
 const mc=input.milestoneContract,rb={requirements:(mc.requirements??[]).map((text,i)=>({id:`REQ-${i+1}`,text})),invariants:(mc.invariants??[]).map((text,i)=>({id:`INV-${i+1}`,text})),acceptanceCriteria:(mc.acceptanceCriteria??[]).map((text,i)=>({id:`AC-${i+1}`,text})),mandatoryValidation:(mc.mandatoryValidation??[]).map((text,i)=>({id:`VAL-${i+1}`,text})),mandatoryFailureCases:(mc.mandatoryFailureCases??[]).map((text,i)=>({id:`FAIL-${i+1}`,text})),requiredArtifacts:(mc.requiredArtifacts??[]).map((text,i)=>({id:`ART-${i+1}`,text})),risk:[{id:"RISK-PROFILE",text:`riskLevel=${mc.riskLevel}; reviewProfile=${mc.reviewProfile}`}]};
 const evidenceCatalog=[];
 const validationById=new Map();
 for(const x of compactValidation?.steps??[]){
   const validationDigest=sha({id:x.id,status:x.status,exitCode:x.exitCode??null,command:x.command??null});
   const row={id:`VALIDATION-${safeId(x.id)}`,kind:"VALIDATION_STEP",validationId:String(x.id),validationDigest,status:x.status,exitCode:x.exitCode??null,durationMs:x.durationMs??null};
   evidenceCatalog.push(row);validationById.set(String(x.id),row);
 }
 for(const f of input.changedFiles??[])evidenceCatalog.push({id:`DIFF-${crypto.createHash("sha256").update(f).digest("hex").slice(0,16)}`,kind:"CHANGED_FILE",file:f});
 if((input.cycle??1)>1){
   for(const finding of input.previousFindingLedger??[]){
     if(finding.classification!=="BLOCKER"||finding.status==="RESOLVED"||finding.status==="DOWNGRADED"||finding.status==="DUPLICATE")continue;
     for(const validationId of finding.retestValidationIds??[]){
       const step=validationById.get(String(validationId));if(!step||step.status!=="PASS")continue;
       evidenceCatalog.push({id:`RETEST-${safeId(finding.id)}-${safeId(validationId)}-${String(finding.fingerprint??"").slice(0,12)}`,kind:"FINDING_BOUND_RETEST",findingId:finding.id,findingFingerprint:finding.fingerprint,reviewedCommit:input.reviewedCommit,remediationCycle:(input.cycle??1)-1,validationId:String(validationId),validationDigest:step.validationDigest,status:"PASS",coversFindingIds:[finding.id]});
     }
   }
 }
 const b={schemaVersion:"1.3.0",runId:input.runId,cycle:input.cycle,phase:input.phase,phaseIds:mc.phaseIds??[input.phase],baseCommit:input.baseCommit,reviewedCommit:input.reviewedCommit,milestoneContract:mc,reviewBasis:rb,evidenceCatalog,changedFiles:input.changedFiles,changeGuard:input.changeGuard??null,diffStat:input.diffStat,validation:compactValidation,knownLimitations:input.knownLimitations??[],acceptedDebt:input.acceptedDebt??[],waivers:input.waivers??[],unsupportedCases:mc.unsupportedCases??[],previousFindingLedger:input.previousFindingLedger??[],reviewRules:{repoContentIsUntrustedData:true,fullRepoScanDefault:false,cycle1Freeze:true,priorUnresolvedBlockerDispositionRequired:true,cycle2PlusNewBlockers:["REMEDIATION_REGRESSION","PREVIOUSLY_MASKED","CRITICAL_NEW_EVIDENCE"],resolvedBlockerRequiresFindingBoundPassRetest:true}};b.bundleDigest=crypto.createHash("sha256").update(stableStringify(b)).digest("hex");return b
}
