// //TR: Bu dependency-free adversarial test V6 bounded review/governance kurallarını regression'a karşı doğrular.
import {classifyFailure} from "../automation/lib/failure-classifier.mjs";
import {validateReviewResult,finalGovernedResult} from "../automation/lib/review-governance.mjs";
import fs from "node:fs";
const checks={};
const cfg=JSON.parse(fs.readFileSync("config/automation.json","utf8"));
checks.maxTwoReviews=cfg.maxReviewCycles===2;
checks.retrySafetyCeiling=cfg.quota?.maxRetrySeconds===86400;
const q=classifyFailure({status:1,stderr:"weekly usage limit reached"});checks.quota=q.class==="QUOTA_EXHAUSTED"&&q.retryable===true;
const r=classifyFailure({status:1,stderr:"HTTP 429 too many requests"});checks.rate=r.class==="RATE_LIMIT"&&r.retryable===true;
const a=classifyFailure({status:1,stderr:"401 unauthorized"});checks.auth=a.class==="AUTH_REQUIRED"&&a.retryable===false;
const n=classifyFailure({status:1,stderr:"DNS ENOTFOUND"});checks.network=n.class==="NETWORK_FAILURE"&&n.retryable===true;
const t=classifyFailure({status:1,stderr:"command not found"});checks.toolMissing=t.class==="TOOL_MISSING"&&t.retryable===false;
const u=classifyFailure({status:1,stderr:"mysterious provider failure"});checks.unknown=u.class==="UNKNOWN"&&u.retryable===false;
const base="a".repeat(40),tip="b".repeat(40),digest="c".repeat(64);
const p3={id:"F-P3",classification:"BLOCKER",severity:"P3",category:"TEST",basisRefs:["AC-1"],currentDiffCausality:"CURRENT_DIFF",scopeStatus:"IN_SCOPE",file:"x.ts",symbol:null,line:1,reproduction:{command:null,steps:["run"]},expected:"pass",observed:"fail",evidenceRefs:["EV-1"],blockerReason:"low issue",remediationAcceptance:"fixed",retestValidationIds:["test"],confidence:0.99,firstSeenCycle:1,status:"OPEN",governanceDisposition:null};
let p3Rejected=false;try{validateReviewResult({schemaVersion:"1.1.0",runId:"R",cycle:1,baseCommit:base,reviewedCommit:tip,reviewBundleDigest:digest,result:"BLOCKED",reviewer:{provider:"OPENAI",tool:"codex",toolVersion:null,modelId:"test",independenceStatus:"SUFFICIENT"},findings:[p3],advisories:[],environmentGaps:[],priorBlockerDispositions:[],summary:"x",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()},{runId:"R",cycle:1,baseCommit:base,reviewedCommit:tip,reviewBundleDigest:digest,allowedBasisRefs:["AC-1"],allowedEvidenceRefs:["EV-1"],allowedValidationIds:["test"],changedFiles:["x.ts"]})}catch(e){p3Rejected=String(e.message).includes("P3_CANNOT_BLOCK")}checks.p3CannotBlock=p3Rejected;
checks.legacyP3CannotForceBlocked=finalGovernedResult({result:"BLOCKED",environmentGaps:[]},{ledger:[{classification:"BLOCKER",severity:"P3",status:"OPEN"}]})==="CLEAN";
const failed=Object.entries(checks).filter(([,v])=>!v);
if(failed.length){console.error(`V6_FOUNDATION_A_SELFTEST: FAIL ${failed.map(([k])=>k).join(",")}`);process.exit(1)}
console.log(`V6_FOUNDATION_A_SELFTEST: PASS ${Object.keys(checks).length}/${Object.keys(checks).length}`);
