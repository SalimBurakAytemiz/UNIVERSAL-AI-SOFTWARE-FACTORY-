// //TR: Bu self-test process lock, atomic checkpoint, Global Stop, review parser/convergence ve failure classifier gibi Pre-Phase-0 trust-kernel mekaniklerinin temel davranışını gerçek dosya/temp state üzerinde doğrular.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {acquireProcessLock} from "../automation/lib/process-lock.mjs";
import {activateGlobalStop,clearGlobalStop,globalStopState} from "../automation/lib/global-stop.mjs";
import {saveCheckpoint,loadCheckpoint} from "../automation/lib/checkpoint.mjs";
import {validateReviewResult,governConvergence,finalGovernedResult} from "../automation/lib/review-governance.mjs";
import {classifyFailure} from "../automation/lib/failure-classifier.mjs";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-kernel-test-"));
const checks={};
try{
 const lock=path.join(dir,"lock.json"); const release=acquireProcessLock(lock,"RUN-TEST");
 let doubleBlocked=false;try{acquireProcessLock(lock,"RUN-TEST2")}catch{doubleBlocked=true}
 release();checks.processLock=doubleBlocked;

 const stop=path.join(dir,"stop.json");activateGlobalStop(stop,"test","SELFTEST");checks.globalStop=globalStopState(stop)?.active===true;clearGlobalStop(stop);checks.globalStop=checks.globalStop&&!globalStopState(stop);

 const cp=path.join(dir,"checkpoint.json");saveCheckpoint(cp,{step:1});saveCheckpoint(cp,{step:2});checks.checkpoint=loadCheckpoint(cp)?.state?.step===2;

 const base="a".repeat(40),tip="b".repeat(40),digest="c".repeat(64);
 const finding={id:"F-1",classification:"BLOCKER",severity:"P1",category:"TEST",basisRefs:["AC-1"],currentDiffCausality:"CURRENT_DIFF",scopeStatus:"IN_SCOPE",
  file:"x.ts",symbol:null,line:1,reproduction:{command:null,steps:["run test"]},expected:"pass",observed:"fail",evidenceRefs:["EV-1"],blockerReason:"acceptance fails",remediationAcceptance:"test passes",confidence:0.9,firstSeenCycle:1,status:"OPEN",governanceDisposition:null};
 const review=validateReviewResult({schemaVersion:"1.1.0",runId:"RUN-TEST",cycle:1,baseCommit:base,reviewedCommit:tip,reviewBundleDigest:digest,result:"BLOCKED",
  reviewer:{provider:"OPENAI",tool:"codex",toolVersion:null,modelId:"test",independenceStatus:"SUFFICIENT"},findings:[finding],advisories:[],environmentGaps:[],priorBlockerDispositions:[],summary:"blocked",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()},
  {runId:"RUN-TEST",cycle:1,baseCommit:base,reviewedCommit:tip,reviewBundleDigest:digest,allowedBasisRefs:["AC-1"],allowedEvidenceRefs:["EV-1"],changedFiles:["x.ts"]});
 const g=governConvergence(review,[],1); checks.review=g.acceptedBlockers.length===1&&finalGovernedResult(review,g)==="BLOCKED";
 checks.failureClassifier=classifyFailure({status:1,stderr:"weekly usage limit reached"}).class==="QUOTA_EXHAUSTED";

 const all=Object.values(checks).every(Boolean);
 const report={"//TR":"Bu runtime report bootstrap trust-kernel self-test sonuçlarını kaydeder.",generatedAt:new Date().toISOString(),checks,final:all?"PASS":"FAIL"};
 fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/BOOTSTRAP_KERNEL_SELFTEST.json",JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify(report,null,2));if(!all)process.exit(1);
} finally {fs.rmSync(dir,{recursive:true,force:true})}
