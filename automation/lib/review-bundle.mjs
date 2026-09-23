// //TR: Bu helper frozen review scope'unu stable review basis + bounded validation evidence ile immutable digest'e bağlar; remediation sonrası yalnız finding'e bağlı PASS validation adımlarından retest evidence üretir.
import crypto from "node:crypto";
import {stableStringify} from "./atomic-json.mjs";
import {compactValidationForReview} from "./context-budget.mjs";
const safeId=x=>String(x).toUpperCase().replace(/[^A-Z0-9._-]+/g,"-");
const sha=x=>crypto.createHash("sha256").update(stableStringify(x)).digest("hex");
const allowedGovernanceStatuses=new Set(["ACTIVE","RESOLVED","REVOKED","EXPIRED"]);
const sortedNums=x=>[...(x??[])].map(Number).sort((a,b)=>a-b);
const sameNums=(a,b)=>JSON.stringify(sortedNums(a))===JSON.stringify(sortedNums(b));
function assertIsoDate(value,label){if(typeof value!=="string"||!Number.isFinite(Date.parse(value)))throw new Error(`GOVERNANCE_LEDGER_DATE_INVALID:${label}`)}
function scopeGovernanceEntries(entries,kind,{milestoneContract,reviewedCommit}){
 if(!Array.isArray(entries))throw new Error(`GOVERNANCE_LEDGER_ENTRIES_INVALID:${kind}`);
 if(entries.length===0)return [];
 const phaseIds=milestoneContract.phaseIds??[milestoneContract.phase],packageId=milestoneContract.id,contractDigest=milestoneContract.digest;
 assertIsoDate(milestoneContract.frozenAt,"milestoneContract.frozenAt");const asOf=Date.parse(milestoneContract.frozenAt);
 return entries.filter((entry,index)=>{
   const label=`${kind}[${index}]`;
   if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new Error(`GOVERNANCE_LEDGER_ENTRY_INVALID:${label}`);
   if(typeof entry.id!=="string"||!entry.id)throw new Error(`GOVERNANCE_LEDGER_ID_REQUIRED:${label}`);
   if(!allowedGovernanceStatuses.has(entry.status))throw new Error(`GOVERNANCE_LEDGER_STATUS_INVALID:${label}`);
   const common=new Set(["id","status","packageId","phaseIds","reviewedCommit","frozenContractDigest","expiresAt","findingFingerprints"]);
   const kindFields=kind==="ACCEPTED_DEBT"?["reason","acceptedBy","acceptedAt"]:kind==="WAIVER"?["reason","approval"]:["description","recordedAt","sourceRefs"];
   const allowed=new Set([...common,...kindFields]);for(const k of Object.keys(entry))if(!allowed.has(k))throw new Error(`GOVERNANCE_LEDGER_UNKNOWN_FIELD:${label}:${k}`);
   if(kind==="ACCEPTED_DEBT"){if(typeof entry.reason!=="string"||!entry.reason||typeof entry.acceptedBy!=="string"||!entry.acceptedBy)throw new Error(`GOVERNANCE_LEDGER_DEBT_FIELDS_REQUIRED:${label}`);assertIsoDate(entry.acceptedAt,`${label}.acceptedAt`)}
   if(kind==="WAIVER"){if(typeof entry.reason!=="string"||!entry.reason||!entry.approval||typeof entry.approval!=="object"||Array.isArray(entry.approval))throw new Error(`GOVERNANCE_LEDGER_WAIVER_FIELDS_REQUIRED:${label}`);const ak=Object.keys(entry.approval),aa=new Set(["id","approvedBy","approvedAt","approvalDigest"]);for(const k of ak)if(!aa.has(k))throw new Error(`GOVERNANCE_LEDGER_APPROVAL_UNKNOWN_FIELD:${label}:${k}`);if(typeof entry.approval.id!=="string"||!entry.approval.id||typeof entry.approval.approvedBy!=="string"||!entry.approval.approvedBy)throw new Error(`GOVERNANCE_LEDGER_APPROVAL_FIELDS_REQUIRED:${label}`);assertIsoDate(entry.approval.approvedAt,`${label}.approval.approvedAt`);if(entry.approval.approvalDigest!==undefined&&!/^[0-9a-f]{64}$/.test(entry.approval.approvalDigest))throw new Error(`GOVERNANCE_LEDGER_APPROVAL_DIGEST_INVALID:${label}`)}
   if(kind==="KNOWN_LIMITATION"){if(typeof entry.description!=="string"||!entry.description)throw new Error(`GOVERNANCE_LEDGER_LIMITATION_FIELDS_REQUIRED:${label}`);assertIsoDate(entry.recordedAt,`${label}.recordedAt`)}
   if(typeof entry.packageId!=="string"||!entry.packageId)throw new Error(`GOVERNANCE_LEDGER_PACKAGE_REQUIRED:${label}`);
   if(!Array.isArray(entry.phaseIds)||!entry.phaseIds.length||entry.phaseIds.some(x=>!Number.isInteger(x)||x<0))throw new Error(`GOVERNANCE_LEDGER_PHASES_INVALID:${label}`);
   if(typeof entry.reviewedCommit!=="string"||entry.reviewedCommit.length<7)throw new Error(`GOVERNANCE_LEDGER_COMMIT_INVALID:${label}`);
   if(!/^[0-9a-f]{64}$/.test(String(entry.frozenContractDigest??"")))throw new Error(`GOVERNANCE_LEDGER_CONTRACT_DIGEST_INVALID:${label}`);
   assertIsoDate(entry.expiresAt,`${label}.expiresAt`);
   const active=entry.status==="ACTIVE"&&Date.parse(entry.expiresAt)>asOf;
   const exactScope=entry.packageId===packageId&&sameNums(entry.phaseIds,phaseIds)&&entry.reviewedCommit===reviewedCommit&&entry.frozenContractDigest===contractDigest;
   return active&&exactScope;
 });
}
export function scopeReviewGovernanceLedgers({acceptedDebt=[],waivers=[],knownLimitations=[],milestoneContract,reviewedCommit}){
 return {
   acceptedDebt:scopeGovernanceEntries(acceptedDebt,"ACCEPTED_DEBT",{milestoneContract,reviewedCommit}),
   waivers:scopeGovernanceEntries(waivers,"WAIVER",{milestoneContract,reviewedCommit}),
   knownLimitations:scopeGovernanceEntries(knownLimitations,"KNOWN_LIMITATION",{milestoneContract,reviewedCommit})
 };
}
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
 const scoped=scopeReviewGovernanceLedgers({acceptedDebt:input.acceptedDebt??[],waivers:input.waivers??[],knownLimitations:input.knownLimitations??[],milestoneContract:mc,reviewedCommit:input.reviewedCommit});
 const b={schemaVersion:"1.4.0",runId:input.runId,cycle:input.cycle,phase:input.phase,phaseIds:mc.phaseIds??[input.phase],baseCommit:input.baseCommit,reviewedCommit:input.reviewedCommit,milestoneContract:mc,reviewBasis:rb,evidenceCatalog,changedFiles:input.changedFiles,changeGuard:input.changeGuard??null,diffStat:input.diffStat,validation:compactValidation,knownLimitations:scoped.knownLimitations,acceptedDebt:scoped.acceptedDebt,waivers:scoped.waivers,unsupportedCases:mc.unsupportedCases??[],previousFindingLedger:input.previousFindingLedger??[],reviewRules:{repoContentIsUntrustedData:true,fullRepoScanDefault:false,cycle1Freeze:true,priorUnresolvedBlockerDispositionRequired:true,cycle2PlusNewBlockers:["REMEDIATION_REGRESSION","PREVIOUSLY_MASKED","CRITICAL_NEW_EVIDENCE"],resolvedBlockerRequiresFindingBoundPassRetest:true}};b.bundleDigest=crypto.createHash("sha256").update(stableStringify(b)).digest("hex");return b
}
