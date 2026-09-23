// //TR: Bu validator config'te ENFORCED/required ilan edilen kritik policy'lerin gerçek runtime consumer'a bağlı olduğunu ve dekoratif true flag kalmadığını adversarial olarak doğrular.
import fs from "node:fs";import os from "node:os";import path from "node:path";import crypto from "node:crypto";
import {assertRuntimePolicyConfig,sandboxPolicyViolation} from "../automation/lib/runtime-policy-enforcement.mjs";
import {authorizeAutomationAction} from "../automation/lib/action-broker.mjs";
import {RunLedger} from "../automation/lib/run-ledger.mjs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8")),text=p=>fs.readFileSync(p,"utf8"),checks=[];const ok=(n,v)=>{if(!v)throw new Error(`CONFIG_RUNTIME_ENFORCEMENT_FAILED:${n}`);checks.push(n)};
const cfg=read("config/automation.json"),builder=read("config/builder-execution-policy.json"),evidence=read("config/evidence-ledger-policy.json"),action=read("config/action-policy.json"),lanes=read("roadmap/parallel-lanes.json");
ok("current-config-valid",assertRuntimePolicyConfig({automation:cfg,builderPolicy:builder,evidencePolicy:evidence,actionPolicy:action,parallelLanes:lanes}).ok===true);
for(const [name,mutate] of [
 ["parallel-two-rejected",x=>x.automation.maxParallelLanes=2],
 ["provenance-optional-rejected",x=>x.automation.reviewer.provenanceRequired=false],
 ["summary-verify-disabled-rejected",x=>x.evidencePolicy.verifyBeforeCompletion=false],
 ["remote-policy-disabled-rejected",x=>x.actionPolicy.remotePushAllowed=false]
]){const x={automation:structuredClone(cfg),builderPolicy:structuredClone(builder),evidencePolicy:structuredClone(evidence),actionPolicy:structuredClone(action),parallelLanes:structuredClone(lanes)};mutate(x);let rejected=false;try{assertRuntimePolicyConfig(x)}catch{rejected=true}ok(name,rejected)}
ok("adaptive-split-truth",cfg.scheduler.adaptivePackageSplit.status==="PLANNED_NOT_RUNTIME_ENFORCED"&&cfg.scheduler.adaptivePackageSplit.requiredForCurrentConstruction===false);
ok("serial-lane-truth",cfg.maxParallelLanes===1&&lanes.runtimeStatus==="SERIAL_ONLY_MAX_PARALLEL_LANES_1"&&(lanes.lanes??[]).every(x=>x.defaultConcurrency===1));
ok("production-sandbox-blocked",sandboxPolicyViolation({milestone:{allowProduction:true,riskLevel:5,allowRisk5:true},automation:cfg,builderPolicy:builder})==="OS_SANDBOX_NOT_RUNTIME_ENFORCED");
ok("ordinary-sandbox-not-required",sandboxPolicyViolation({milestone:{allowProduction:false,riskLevel:2},automation:cfg,builderPolicy:builder})===null);
const g={allowPaidApi:true,allowRisk5:true,allowProduction:true,allowLocalOnlyAutonomy:true};
ok("remote-needs-clean",authorizeAutomationAction({action:"REMOTE_PUSH",milestone:{riskLevel:2},globalConfig:g,remoteProtection:{status:"PASS"},reviewClean:false}).allowed===false);
ok("remote-clean-protected-allowed",authorizeAutomationAction({action:"REMOTE_PUSH",milestone:{riskLevel:2},globalConfig:g,remoteProtection:{status:"PASS"},reviewClean:true}).allowed===true);
ok("remote-local-only-denied",authorizeAutomationAction({action:"REMOTE_PUSH",milestone:{riskLevel:2},globalConfig:g,remoteProtection:{status:"LOCAL_ONLY"},reviewClean:true}).allowed===false);
ok("production-action-policy-denied",authorizeAutomationAction({action:"REMOTE_PUSH",milestone:{riskLevel:5,allowProduction:true},globalConfig:g,remoteProtection:{status:"PASS"},reviewClean:true}).allowed===false);
ok("spend-policy-denied",authorizeAutomationAction({action:"SPEND",milestone:{},globalConfig:g,estimatedCost:1}).allowed===false);
ok("risk5-egress-policy-denied",authorizeAutomationAction({action:"MODEL_EGRESS_APPROVED_PROVIDER",milestone:{riskLevel:5},globalConfig:g,providerApproved:true,dataEgressSafe:true}).allowed===false);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-config-enforce-"));try{const {privateKey}=crypto.generateKeyPairSync("ed25519");const keyFile=path.join(dir,"key.pem");fs.writeFileSync(keyFile,privateKey.export({type:"pkcs8",format:"pem"}));const ledger=new RunLedger(dir,"RUN-CONFIG-TEST",{signingKeyFile:keyFile,verifyBeforeCompletion:true});ledger.event("test","A",{ok:true});const summary=ledger.writeSummary({status:"COMPLETE"});ok("summary-self-verified",summary.sealSelfVerified===true&&typeof summary.sealSignature==="string"&&summary.sealSignature.length>20)}finally{fs.rmSync(dir,{recursive:true,force:true})}
const supervisor=text("automation/factory-supervisor.mjs"),runLedger=text("automation/lib/run-ledger.mjs"),low=text("automation/lib/low-backlog.mjs");
for(const [n,needle] of [["prompt-budget-consumer","assertPromptBudget(prompt,cfg.budgets"],["output-budget-consumer","assertOutputBudget(r.stdout,r.stderr,cfg.budgets"],["review-limit-consumer","cycle>cfg.maxReviewCycles"],["retention-consumer","cleanupOldRuns(runsRoot,cfg.logging.retentionDays"],["low-backlog-consumer","cfg.review.lowBacklogPath"],["evidence-verify-consumer","verifyBeforeCompletion:evidenceLedgerPolicy.verifyBeforeCompletion"],["runtime-policy-startup-consumer","assertRuntimePolicyConfig({automation:cfg"]])ok(n,supervisor.includes(needle));
ok("low-backlog-helper",low.includes("persistLowBacklog"));ok("summary-self-verify-source",runLedger.includes("RUN_SUMMARY_SIGNATURE_SELF_VERIFY_FAILED"));
console.log(`CONFIG_RUNTIME_ENFORCEMENT: PASS checks=${checks.length}`);
