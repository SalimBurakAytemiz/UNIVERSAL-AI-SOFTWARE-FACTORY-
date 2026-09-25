// //TR: Bu helper scheduler COMPLETED durumunu yalnız main history içindeki exact commit ve Ed25519 imzalı CLEAN package attestation ile kabul eder; mutable scheduler JSON tek başına completion yetkisi vermez.
import fs from "node:fs";import path from "node:path";
import {readJsonIfExists,stableStringify} from "./atomic-json.mjs";import {verifyEvidence} from "./evidence-signing.mjs";
export function assertSchedulerCompletionEvidence({repoRoot,state,packages,publicKeyFile,isAncestor}){
  for(const p of state.phases??[]){
    if(p.status!=="COMPLETED"||p.phase===0)continue;
    if(!p.completedCommit||!/^[0-9a-f]{7,64}$/i.test(p.completedCommit))throw new Error(`SCHEDULER_COMPLETED_COMMIT_INVALID phase=${p.phase}`);
    if(!isAncestor(repoRoot,p.completedCommit,"HEAD"))throw new Error(`SCHEDULER_COMMIT_NOT_IN_MAIN_HISTORY phase=${p.phase} commit=${p.completedCommit}`);
  }
  for(const pkg of packages.doc.packages??[]){
    const rows=pkg.phaseIds.map(phase=>state.phases.find(x=>x.phase===phase));
    const completed=rows.filter(x=>x?.status==="COMPLETED");if(completed.length===0)continue;if(completed.length!==rows.length)throw new Error(`SCHEDULER_PACKAGE_PARTIAL_COMPLETION package=${pkg.id}`);
    const commits=[...new Set(rows.map(x=>x.completedCommit))];if(commits.length!==1)throw new Error(`SCHEDULER_PACKAGE_COMMIT_DRIFT package=${pkg.id}`);const commit=commits[0];
    const attRel=`.ai/runtime/evidence-ledger/packages/${pkg.id}/${commit}.json`;if(!rows.every(x=>(x.evidenceRefs??[]).includes(attRel)))throw new Error(`SCHEDULER_COMPLETION_ATTESTATION_REF_MISSING package=${pkg.id}`);
    const signed=readJsonIfExists(path.join(repoRoot,attRel),null);if(!signed?.signature)throw new Error(`SCHEDULER_COMPLETION_ATTESTATION_MISSING package=${pkg.id}`);const payload={...signed},signature=payload.signature;delete payload.signature;
    if(!fs.existsSync(publicKeyFile)||!verifyEvidence(payload,signature,publicKeyFile))throw new Error(`SCHEDULER_COMPLETION_ATTESTATION_INVALID package=${pkg.id}`);
    if(payload.result!=="CLEAN"||payload.packageId!==pkg.id||payload.reviewedCommit!==commit||stableStringify(payload.phaseIds)!==stableStringify(pkg.phaseIds))throw new Error(`SCHEDULER_COMPLETION_ATTESTATION_IDENTITY_MISMATCH package=${pkg.id}`);
  }
  return {ok:true};
}
