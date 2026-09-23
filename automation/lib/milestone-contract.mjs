// //TR: Bu helper phase veya coherent review package contract'larını build başlamadan objective/acceptance/scope/risk/evidence/failure/artifact sınırlarıyla freeze eder; digest builder/reviewer moving-scope problemini engeller.
import crypto from "node:crypto";
import {stableStringify} from "./atomic-json.mjs";

const uniq=a=>[...new Set(a)];
const profileRank={STANDARD:0,TRUST_CRITICAL:3,SECURITY_CRITICAL:4,RELEASE_CRITICAL:5};
function freeze(raw){raw.frozenAt=new Date().toISOString();raw.digest=crypto.createHash("sha256").update(stableStringify(raw)).digest("hex");return raw}
function phaseTraceability(c){
  const acceptance=(c.phaseSpecificAcceptance??[]).slice(3);
  if(!(c.requirements??[])[0]||!acceptance.length||!(c.mandatoryFailureCases??[]).length||!(c.requiredArtifacts??[]).length) throw new Error(`PHASE_TRACEABILITY_INCOMPLETE:${c.phase}`);
  return {phase:c.phase,requirement:c.requirements[0],acceptanceCriteria:acceptance,mandatoryFailureCases:[...c.mandatoryFailureCases],requiredArtifacts:[...c.requiredArtifacts],unsupportedCases:[...(c.unsupportedCases??[])]};
}
function one(c,protectedPolicy){return {
  schemaVersion:"1.2.0",id:`PHASE-${String(c.phase).padStart(3,"0")}`,phase:c.phase,phaseIds:[c.phase],title:c.title,
  objective:c.objective??`Implement and verify ${c.title}`,
  requirements:c.requirements??c.entryCriteria??["Canonical phase scope must be satisfied"],
  invariants:c.invariants??["NO_FAKE_SUCCESS","NO_WEAKENED_CONTROLS","NO_SILENT_SCOPE_EXPANSION","EVIDENCE_REQUIRED"],
  acceptanceCriteria:c.phaseSpecificAcceptance??c.exitCriteria,
  mandatoryFailureCases:c.mandatoryFailureCases??[],requiredArtifacts:c.requiredArtifacts??[],phaseTraceability:[phaseTraceability(c)],
  allowedPathPrefixes:c.allowedPathPrefixes??["core","apps","tests","docs","registries","schemas"],
  protectedPaths:[...(protectedPolicy.exactPaths??[]),...(protectedPolicy.protectedPrefixes??[])],
  mandatoryValidation:c.requiredValidation,mandatoryEvidence:c.evidence,
  riskLevel:c.riskLevel??2,allowPaidApi:c.allowPaidApi??false,allowProduction:c.allowProduction??false,allowRisk5:c.allowRisk5??false,
  allowDependencyChanges:c.allowDependencyChanges??false,unsupportedCases:c.unsupportedCases??[],reviewProfile:c.reviewProfile??"STANDARD",
  maxFilesChanged:c.maxFilesChanged??120,maxDiffLines:c.maxDiffLines??4000,allowExistingTestAssertionReduction:c.allowExistingTestAssertionReduction??false
}}
export function freezeMilestoneContract({phaseContract,protectedPolicy}){return freeze(one(phaseContract,protectedPolicy))}
export function freezeMilestonePackage({packageDef,phaseContracts,protectedPolicy}){
  if(!Array.isArray(phaseContracts)||!phaseContracts.length) throw new Error("PACKAGE_PHASE_CONTRACTS_REQUIRED");
  const phases=phaseContracts.map(x=>x.phase), lead=Math.min(...phases);
  const prefix=(c,text)=>`[P${String(c.phase).padStart(3,"0")}] ${text}`;
  const strongest=[...phaseContracts.map(x=>x.reviewProfile??"STANDARD"),packageDef.reviewProfile??"STANDARD"].sort((a,b)=>(profileRank[b]??0)-(profileRank[a]??0))[0];
  return freeze({
    schemaVersion:"1.2.0",id:packageDef.id,phase:lead,phaseIds:phases,title:packageDef.title,
    objective:`Implement, integrate and prove review package ${packageDef.id}: ${packageDef.title}`,
    requirements:phaseContracts.flatMap(c=>(c.requirements??c.entryCriteria??[]).map(x=>prefix(c,x))),
    invariants:uniq(phaseContracts.flatMap(c=>c.invariants??[])),
    acceptanceCriteria:phaseContracts.flatMap(c=>(c.phaseSpecificAcceptance??c.exitCriteria??[]).map(x=>prefix(c,x))),
    mandatoryFailureCases:phaseContracts.flatMap(c=>(c.mandatoryFailureCases??[]).map(x=>prefix(c,x))),
    requiredArtifacts:phaseContracts.flatMap(c=>(c.requiredArtifacts??[]).map(x=>prefix(c,x))),
    phaseTraceability:phaseContracts.map(phaseTraceability),
    allowedPathPrefixes:uniq(phaseContracts.flatMap(c=>c.allowedPathPrefixes??[])),
    protectedPaths:[...(protectedPolicy.exactPaths??[]),...(protectedPolicy.protectedPrefixes??[])],
    mandatoryValidation:uniq(phaseContracts.flatMap(c=>c.requiredValidation??[])),
    mandatoryEvidence:uniq(phaseContracts.flatMap(c=>c.evidence??[])),
    riskLevel:Math.max(...phaseContracts.map(c=>c.riskLevel??2)),
    allowPaidApi:phaseContracts.some(c=>c.allowPaidApi===true),allowProduction:phaseContracts.some(c=>c.allowProduction===true),allowRisk5:phaseContracts.some(c=>c.allowRisk5===true),
    allowDependencyChanges:phaseContracts.some(c=>c.allowDependencyChanges===true),
    unsupportedCases:phaseContracts.flatMap(c=>(c.unsupportedCases??[]).map(x=>prefix(c,x))),reviewProfile:strongest,deliveryTier:packageDef.deliveryTier,
    maxFilesChanged:Math.min(240,Math.max(120,phaseContracts.reduce((n,c)=>n+(c.maxFilesChanged??120),0))),
    maxDiffLines:Math.min(6000,Math.max(2500,phaseContracts.reduce((n,c)=>n+(c.maxDiffLines??1500),0))),
    allowExistingTestAssertionReduction:phaseContracts.every(c=>c.allowExistingTestAssertionReduction===true)
  });
}
