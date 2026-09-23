// //TR: Bu supervisor Phase0 sonrası 148 acceptance phase'i coherent review package'larında yürütür; persistent isolated worktree, exact-path commit, protected trust-root, deterministic validation, frozen Codex review convergence, crash-safe CLEAN->merge->push ve quota/resume akışını fail-closed uygular.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {createRunId,RunLedger,cleanupOldRuns} from "./lib/run-ledger.mjs";
import {acquireProcessLock} from "./lib/process-lock.mjs";
import {assertNotStopped,globalStopState} from "./lib/global-stop.mjs";
import {safeChildEnv} from "./lib/env-policy.mjs";
import {runCommand} from "./lib/command-runner.mjs";
import {classifyFailure} from "./lib/failure-classifier.mjs";
import {verifyTrustRoot} from "./lib/trust-root.mjs";
import {evaluateChangeSet} from "./lib/change-guard.mjs";
import {freezeMilestonePackage} from "./lib/milestone-contract.mjs";
import {buildReviewBundle} from "./lib/review-bundle.mjs";
import {parseStrictReviewJson,validateReviewResult,governConvergence,finalGovernedResult,effectiveReviewDigest} from "./lib/review-governance.mjs";
import {persistLowBacklog} from "./lib/low-backlog.mjs";
import {assertPromptBudget,assertOutputBudget,utf8Tail} from "./lib/context-budget.mjs";
import {loadCheckpoint,saveCheckpoint} from "./lib/checkpoint.mjs";
import {readJsonIfExists,writeJsonAtomic,sha256,stableStringify} from "./lib/atomic-json.mjs";
import {
  ensureGitRepository,assertClean,gitHead,gitStatus,changedFiles,diffStat,commitAll,showChangedCommitted,
  createRunWorktree,restoreRunWorktree,removeRunWorktree,ensureWorktreeDependencies,cleanupOrphanRunWorktrees,
  mergeReviewedFastForward,pushMainAndVerify,remoteUrl,isAncestor,sanitizeRemoteUrl
} from "./lib/git-ops.mjs";
import {captureGitMetadata,assertGitMetadataUnchanged} from "./lib/git-metadata-guard.mjs";
import {assertFilesystemBoundary} from "./lib/filesystem-boundary.mjs";
import {authorizeAutomationAction,assertAutomationAction} from "./lib/action-broker.mjs";
import {sensitiveTypes} from "./lib/redaction.mjs";
import {signEvidence,verifyEvidence} from "./lib/evidence-signing.mjs";
import {assertFrozenContract,verifyCleanReadyResume} from "./lib/resume-trust.mjs";
import {loadGraph,loadSchedulerState,saveSchedulerState,promoteDueRetries,allComplete} from "./lib/scheduler.mjs";
import {
  loadReviewPackages,runnablePackages,packagePendingPhases,packageStatus,
  markPackageActive,markPackageRetry,markPackageBlocked,markPackageCompleted
} from "./lib/review-packages.mjs";

const repoRoot=process.cwd();
const cfg=JSON.parse(fs.readFileSync("config/automation.json","utf8"));
const protectedPolicy=JSON.parse(fs.readFileSync("config/protected-paths.json","utf8"));
const runtime=path.join(repoRoot,".ai","runtime");
const runsRoot=path.join(repoRoot,cfg.logging.root);
const schedulerFile=path.join(repoRoot,cfg.scheduler.statePath);
const graphFile=path.join(repoRoot,cfg.scheduler.dependencyGraph);
const packagesFile=path.join(repoRoot,cfg.scheduler.reviewPackages);
const checkpointFile=path.join(runtime,"supervisor-checkpoint.json");
const retryFile=path.join(runtime,"SUPERVISOR_RETRY.json");
const globalStopFile=path.join(repoRoot,cfg.globalStop.path);
const lockFile=path.join(runtime,"supervisor.lock");
const evidenceLedgerRoot=path.join(runtime,"evidence-ledger","packages");
const evidencePrivateKey=path.join(runtime,"keys","evidence-ed25519-private.pem");
const evidencePublicKey=path.join(runtime,"keys","evidence-ed25519-public.pem");
const providerProvenanceFile=path.join(runtime,"PROVIDER_PROVENANCE.json");
const remoteProtectionFile=path.join(runtime,"REMOTE_PROTECTION.json");
const acceptedDebtFile=path.join(repoRoot,cfg.review.acceptedDebtLedger);
const waiversFile=path.join(repoRoot,cfg.review.waiverLedger);
const knownLimitationsFile=path.join(repoRoot,cfg.review.knownLimitationsLedger);
fs.mkdirSync(runtime,{recursive:true});

const readJson=file=>JSON.parse(fs.readFileSync(file,"utf8"));
const rm=file=>{try{fs.rmSync(file,{force:true})}catch{}};
const isoAfter=seconds=>new Date(Date.now()+seconds*1000).toISOString();
const clampRetry=seconds=>Math.min(Math.max(Number(seconds)||cfg.quota.defaultRetrySeconds,60),cfg.quota.maxRetrySeconds);
const phaseContractPath=phase=>path.join(repoRoot,"roadmap","contracts",`phase-${String(phase).padStart(3,"0")}.json`);
const currentValidationReport=worktree=>{const p=path.join(worktree,".ai","runtime","VALIDATION_REPORT.json");return fs.existsSync(p)?readJson(p):null};
function failedValidationSummary(report){
  if(!report)return {summary:"Validation failed without report"};
  const failed=(report.steps??[]).find(x=>x.status!=="PASS");
  return failed?{id:failed.id,status:failed.status,exitCode:failed.exitCode,stdout:(failed.stdout??"").slice(-5000),stderr:(failed.stderr??"").slice(-5000)}:{summary:"Validation failed"};
}
function policyViolation(m){
  if(m.allowPaidApi&&!cfg.allowPaidApi)return "PAID_API_FORBIDDEN_BY_GLOBAL_POLICY";
  if(m.allowProduction&&!cfg.allowProduction)return "PRODUCTION_FORBIDDEN_BY_GLOBAL_POLICY";
  if((m.riskLevel??0)>=5&&!cfg.allowRisk5)return "RISK5_FORBIDDEN_BY_GLOBAL_POLICY";
  return null;
}
function packageAttemptCount(state,pkg){return Math.max(1,...pkg.phaseIds.map(p=>state.phases.find(x=>x.phase===p)?.attempts??1))}
function nextRetrySeconds(state,pkg,suggested){
  const attempts=packageAttemptCount(state,pkg),base=clampRetry(suggested??cfg.quota.defaultRetrySeconds);
  return cfg.quota.exponentialBackoff?clampRetry(base*Math.max(1,2**Math.min(attempts-1,4))):base;
}
function writeRetry(seconds,pkg,reason){writeJsonAtomic(retryFile,{"//TR":"Bu runtime state start-full-auto wrapper'ın infrastructure/quota retry bekleme süresini taşır.",packageId:pkg.id,phaseIds:pkg.phaseIds,reason,retryAfterSeconds:seconds,retryAt:isoAfter(seconds),updatedAt:new Date().toISOString()})}
const clearRetry=()=>rm(retryFile);
const saveStage=state=>saveCheckpoint(checkpointFile,state);
const clearStage=()=>rm(checkpointFile);
const loadStage=()=>loadCheckpoint(checkpointFile)?.state??null;
const buildChildEnv=(m,providerCfg)=>safeChildEnv("config/environment-policy.json",{allowPaidApi:cfg.allowPaidApi&&m.allowPaidApi,provider:providerCfg?.provider});
const summaryAndExit=(ledger,status,extra,code)=>{ledger.writeSummary({status,finishedAt:new Date().toISOString(),...extra});return code};

function refreshRemoteProtection(){
  if(!remoteUrl(repoRoot)) return {status:"LOCAL_ONLY",detail:"No origin"};
  const r=cp.spawnSync(process.execPath,["scripts/verify-remote-protection.mjs"],{cwd:repoRoot,encoding:"utf8",windowsHide:true,env:process.env});
  if(r.status!==0) throw new Error(`REMOTE_PROTECTION_REFRESH_FAILED: ${r.stderr||r.stdout}`);
  const report=readJsonIfExists(remoteProtectionFile,null);if(!report)throw new Error("REMOTE_PROTECTION_REPORT_MISSING");return report;
}
function providerProvenance(){const p=readJsonIfExists(providerProvenanceFile,null);if(!p||p.final!=="PASS")throw new Error("PROVIDER_PROVENANCE_NOT_READY");return p}
function ensureProviderSeparation(review){
  const prov=providerProvenance();
  if(String(cfg.builder.provider).toUpperCase()===String(cfg.reviewer.provider).toUpperCase()) return {ok:false,reason:"BUILDER_AND_REVIEWER_PROVIDER_SAME"};
  if(String(review.reviewer.provider).toUpperCase()!==String(cfg.reviewer.provider).toUpperCase()) return {ok:false,reason:"REVIEWER_PROVIDER_PROVENANCE_MISMATCH"};
  if(!["SUFFICIENT","PROVIDER_SEPARATED_MODEL_UNKNOWN"].includes(review.reviewer.independenceStatus)) return {ok:false,reason:"REVIEWER_INDEPENDENCE_NOT_SUFFICIENT"};
  if(review.reviewer.toolVersion && prov.codex.version && review.reviewer.toolVersion!==prov.codex.version) return {ok:false,reason:"REVIEWER_TOOL_VERSION_MISMATCH"};
  return {ok:true,provenance:{provider:cfg.reviewer.provider,modelId:cfg.reviewer.modelId,toolVersion:prov.codex.version,launcherSha256:prov.codex.launcherSha256,resolvedPath:prov.codex.resolvedPath,provenanceLevel:prov.codex.provenanceLevel??"UNKNOWN",packageName:prov.codex.packageName??"UNKNOWN",packageVersion:prov.codex.packageVersion??"UNKNOWN",packageJsonSha256:prov.codex.packageJsonSha256??"UNKNOWN"}};
}
function assertSchedulerGitConsistency(state){
  for(const p of state.phases??[]){
    if(p.status!=="COMPLETED"||p.phase===0) continue;
    if(!p.completedCommit||!/^[0-9a-f]{7,64}$/i.test(p.completedCommit)) throw new Error(`SCHEDULER_COMPLETED_COMMIT_INVALID phase=${p.phase}`);
    if(!isAncestor(repoRoot,p.completedCommit,"HEAD")) throw new Error(`SCHEDULER_COMMIT_NOT_IN_MAIN_HISTORY phase=${p.phase} commit=${p.completedCommit}`);
  }
}
function ensurePackageAtomicity(pkg,state){
  const rows=pkg.phaseIds.map(p=>state.phases.find(x=>x.phase===p));
  const completed=rows.filter(x=>x?.status==="COMPLETED").length;
  if(completed!==0&&completed!==rows.length) throw new Error(`PARTIAL_REVIEW_PACKAGE_STATE package=${pkg.id} completed=${completed}/${rows.length}`);
}
function markPackageStateRetry(state,pkg,reason,retryAt){markPackageRetry(state,pkg,reason,retryAt)}
function markPackageStateBlocked(state,pkg,reason,kind){markPackageBlocked(state,pkg,reason,kind)}
function allPackagePhasesCompleted(pkg,state){return packageStatus(pkg,state)==="COMPLETED"}

const ajv=new Ajv({allErrors:true,strict:false});addFormats(ajv);
const findingSchema=readJson(path.join(repoRoot,"schemas/review-finding.schema.json"));ajv.addSchema(findingSchema);const milestoneSchema=readJson(path.join(repoRoot,"schemas/milestone-contract.schema.json"));ajv.addSchema(milestoneSchema);
const reviewSchema=readJson(path.join(repoRoot,"schemas/independent-review-result.schema.json"));const validateReviewSchema=ajv.compile(reviewSchema);const reviewBundleSchema=readJson(path.join(repoRoot,"schemas/review-bundle.schema.json"));const validateReviewBundleSchema=ajv.compile(reviewBundleSchema);
function parseGovernedReview(stdout,expected){
  const parsed=parseStrictReviewJson(stdout);
  if(!validateReviewSchema(parsed)) throw new Error(`REVIEW_SCHEMA_VALIDATION_FAILED: ${ajv.errorsText(validateReviewSchema.errors,{separator:" | "})}`);
  return validateReviewResult(parsed,expected);
}

async function executeModel({kind,providerCfg,prompt,worktree,ledger,leadPhase,milestoneId,attemptName,milestone}){
  const dlpSignals=sensitiveTypes(prompt);
  assertAutomationAction({action:"MODEL_EGRESS_APPROVED_PROVIDER",milestone,globalConfig:cfg,providerApproved:["ANTHROPIC","OPENAI"].includes(String(providerCfg.provider??"").toUpperCase()),dataEgressSafe:dlpSignals.length===0});
  if(dlpSignals.length) throw new Error(`MODEL_EGRESS_DLP_BLOCKED types=${dlpSignals.join(",")}`);
  const {promptBytes,promptApproxTokens}=assertPromptBudget(prompt,cfg.budgets??{});
  const logFile=ledger.logPath(`${attemptName}.log`);const gitBefore=kind==="builder"?captureGitMetadata(worktree):null;
  const r=await runCommand({cmd:providerCfg.command==="node"?process.execPath:providerCfg.command,args:providerCfg.args,cwd:worktree,input:prompt,timeoutMs:cfg.timeoutMs,
    env:{...buildChildEnv(milestone,providerCfg),UASCO_CONTROL_ROOT:repoRoot},logFile,maxLogBytes:cfg.logging.maxLogBytesPerFile,globalStopFile,
    onEvent:(event,details)=>ledger.event(kind,event,details,"INFO",{phase:leadPhase,milestoneId,actor:kind.toUpperCase()})});
  if(kind==="builder")assertGitMetadataUnchanged(gitBefore,captureGitMetadata(worktree));
  const {outputBytes,outputApproxTokens}=assertOutputBudget(r.stdout,r.stderr,cfg.budgets??{}),approxTokens=promptApproxTokens+outputApproxTokens;
  ledger.usage({kind,phase:leadPhase,milestoneId,promptBytes,promptApproxTokens,outputBytes,outputApproxTokens,approxTokens,durationMs:r.durationMs,status:r.status});
  if(approxTokens>(cfg.budgets?.perPackageApproxTokenWarning??250000))ledger.event("budget","APPROX_TOKEN_WARNING",{kind,approxTokens,threshold:cfg.budgets?.perPackageApproxTokenWarning},"WARN",{phase:leadPhase,milestoneId,actor:"SUPERVISOR"});
  ledger.event(kind,"PROCESS_FINISHED",{status:r.status,timedOut:r.timedOut,globalStopped:r.globalStopped,promptBytes,outputBytes,approxTokens},r.status===0?"INFO":"ERROR",{phase:leadPhase,milestoneId,actor:kind.toUpperCase(),durationMs:r.durationMs,exitCode:r.status});
  return r;
}

async function handleInfrastructureFailure({result,stage,pkg,scheduler,ledger,checkpointState,worktree}){
  const f=classifyFailure(result); const leadPhase=Math.min(...pkg.phaseIds);
  ledger.event(stage,"FAILURE_CLASSIFIED",f,"ERROR",{phase:leadPhase,milestoneId:pkg.id,actor:stage.toUpperCase()});
  if(f.class==="GLOBAL_STOP") return {code:50,kind:"GLOBAL_STOP",failure:f};
  if(f.retryable){
    const seconds=nextRetrySeconds(scheduler,pkg,f.retryAfterSeconds),retryAt=isoAfter(seconds);
    markPackageStateRetry(scheduler,pkg,f.summary,retryAt);saveSchedulerState(schedulerFile,scheduler);
    saveStage({...checkpointState,stage,lastFailure:f,lastRetryAt:new Date().toISOString()});writeRetry(seconds,pkg,f);
    ledger.writeSummary({status:"RETRY_WAIT",packageId:pkg.id,phaseIds:pkg.phaseIds,failure:f,retryAfterSeconds:seconds,worktree});return {code:30,kind:"RETRY",failure:f};
  }
  markPackageStateBlocked(scheduler,pkg,f.summary,f.class);saveSchedulerState(schedulerFile,scheduler);
  saveStage({...checkpointState,stage:"FOUNDER_ATTENTION",lastFailure:f});
  ledger.writeSummary({status:"FOUNDER_ATTENTION_REQUIRED",packageId:pkg.id,phaseIds:pkg.phaseIds,failure:f,worktree});return {code:40,kind:"BLOCKED",failure:f};
}

function guardWorktree({worktree,baseCommit,milestone}){
  const filesystemBoundary=assertFilesystemBoundary(worktree);
  const files=changedFiles(worktree,baseCommit);
  const guard=evaluateChangeSet({repoRoot,worktree,baseCommit,changedFiles:files,milestone,protectedPolicy,governanceAuthorized:false});
  const trust=verifyTrustRoot(worktree);
  return {files,guard,trust,filesystemBoundary,ok:guard.ok&&trust.ok&&filesystemBoundary.ok};
}

async function runValidationWithFixes({pkg,milestone,worktree,ledger,scheduler,checkpointState,labelPrefix}){
  const leadPhase=Math.min(...pkg.phaseIds);
  for(let cycle=1;cycle<=cfg.maxBuilderValidationCycles;cycle++){
    assertNotStopped(globalStopFile);saveStage({...checkpointState,stage:"VALIDATE",validationCycle:cycle});
    const r=await runCommand({cmd:cfg.validationCommand[0],args:cfg.validationCommand.slice(1),cwd:worktree,timeoutMs:cfg.timeoutMs,
      env:{...buildChildEnv(milestone,{provider:"DETERMINISTIC"}),UASCO_CONTROL_ROOT:repoRoot},logFile:ledger.logPath(`${labelPrefix}-validation-${cycle}.log`),maxLogBytes:cfg.logging.maxLogBytesPerFile,globalStopFile,
      onEvent:(event,details)=>ledger.event("validation",event,details,"INFO",{phase:leadPhase,milestoneId:pkg.id,actor:"VALIDATOR"})});
    const report=currentValidationReport(worktree);ledger.writeJson(`evidence/${labelPrefix}-validation-${cycle}.json`,report??{status:"MISSING_REPORT"});
    if(r.status===0&&report?.status==="PASS") return {ok:true,report,cycle};
    if(r.globalStopped) return {ok:false,terminal:{code:50}};
    if(cycle===cfg.maxBuilderValidationCycles){markPackageStateBlocked(scheduler,pkg,"DETERMINISTIC_VALIDATION_DID_NOT_CONVERGE","VALIDATION_FAILURE");saveSchedulerState(schedulerFile,scheduler);saveStage({...checkpointState,stage:"FOUNDER_ATTENTION",validationFailure:failedValidationSummary(report)});return {ok:false,terminal:{code:40}}}
    const fixPrompt=fs.readFileSync(path.join(repoRoot,"prompts/AUTO-VALIDATION-FIX.md"),"utf8")+`\nFROZEN REVIEW PACKAGE CONTRACT:\n${JSON.stringify(milestone,null,2)}\nVALIDATION FAILURE:\n${JSON.stringify(failedValidationSummary(report),null,2)}`;
    saveStage({...checkpointState,stage:"VALIDATION_FIX",validationCycle:cycle});
    const b=await executeModel({kind:"builder",providerCfg:cfg.builder,prompt:fixPrompt,worktree,ledger,leadPhase,milestoneId:pkg.id,attemptName:`${labelPrefix}-validation-fix-${cycle}`,milestone});
    if(b.status!==0||b.error){const h=await handleInfrastructureFailure({result:b,stage:"validation-fix",pkg,scheduler,ledger,checkpointState:{...checkpointState,stage:"VALIDATION_FIX"},worktree});return {ok:false,terminal:h}}
    const g=guardWorktree({worktree,baseCommit:checkpointState.baseCommit,milestone});ledger.writeJson(`evidence/${labelPrefix}-change-guard-${cycle}.json`,g);
    if(!g.ok){markPackageStateBlocked(scheduler,pkg,"VALIDATION_FIX_TRUST_GUARD_VIOLATION","TRUST_ROOT");saveSchedulerState(schedulerFile,scheduler);saveStage({...checkpointState,stage:"FOUNDER_ATTENTION",guard:g});return {ok:false,terminal:{code:40}}}
  }
  return {ok:false,terminal:{code:40}};
}

function writeDurableAttestation(pkg,reviewedCommit,attestation){
  if(!fs.existsSync(evidencePrivateKey))throw new Error("EVIDENCE_SIGNING_KEY_MISSING");const signed={...attestation};signed.signature=signEvidence(signed,evidencePrivateKey);const verifyCopy={...signed};delete verifyCopy.signature;if(!fs.existsSync(evidencePublicKey)||!verifyEvidence(verifyCopy,signed.signature,evidencePublicKey))throw new Error("EVIDENCE_SIGNATURE_SELF_VERIFY_FAILED");const dir=path.join(evidenceLedgerRoot,pkg.id);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,`${reviewedCommit}.json`);writeJsonAtomic(file,signed);return {file,signed};
}

async function main(){
  if(cfg.mode!=="AUTOMATIC") throw new Error(`AUTOMATION_MODE_NOT_AUTOMATIC: ${cfg.mode}`);
  const phase0=readJsonIfExists(path.join(runtime,"PHASE0_ACCEPTANCE.json"),null);if(!phase0||!["CLEAN","CLEAN_LOCAL_ONLY"].includes(phase0.final)) throw new Error("PHASE0_NOT_CLEAN");if(readJsonIfExists(path.join(runtime,"BUILDER_BOUNDARY_SMOKE.json"),null)?.status!=="PASS")throw new Error("BUILDER_BOUNDARY_NOT_VERIFIED");if(!fs.existsSync(evidencePrivateKey))throw new Error("EVIDENCE_SIGNING_NOT_READY");providerProvenance();
  ensureGitRepository(repoRoot);assertClean(repoRoot);assertNotStopped(globalStopFile);
  const tr=verifyTrustRoot(repoRoot);if(!tr.ok)throw new Error(`TRUST_ROOT_MISMATCH: ${JSON.stringify(tr.mismatches)}`);
  if(!fs.existsSync(schedulerFile))throw new Error("SCHEDULER_STATE_MISSING; rerun phase0 acceptance");
  if(!fs.existsSync(packagesFile))throw new Error("REVIEW_PACKAGES_MISSING");

  const runId=createRunId();let releaseLock;
  try{releaseLock=acquireProcessLock(lockFile,runId)}catch(e){console.error(String(e.message??e));return 40}
  cleanupOldRuns(runsRoot,cfg.logging.retentionDays,cfg.logging.maxRuns);
  const ledger=new RunLedger(runsRoot,runId,{maxLogBytes:cfg.logging.maxLogBytesPerFile,signingKeyFile:evidencePrivateKey});
  let processed=0;
  try{
    const graph=loadGraph(graphFile),packages=loadReviewPackages(packagesFile);let scheduler=loadSchedulerState(schedulerFile);assertSchedulerGitConsistency(scheduler);promoteDueRetries(scheduler);saveSchedulerState(schedulerFile,scheduler);
    let priorStage=loadStage();
    if(priorStage?.packageId){const pp=packages.map.get(priorStage.packageId);if(pp&&allPackagePhasesCompleted(pp,scheduler)){clearStage();priorStage=null}}
    const orphanCleanup=cleanupOrphanRunWorktrees(repoRoot,priorStage?.worktreeDir?[priorStage.worktreeDir]:[],cfg.git.runBranchPrefix);if(orphanCleanup.length)ledger.event("git","ORPHAN_WORKTREES_CLEANED",orphanCleanup,"WARN",{actor:"SUPERVISOR"});
    ledger.writeManifest({"//TR":"Bu manifest autonomous supervisor invocation'ını exact repo/provider/policy/package scheduler durumuna bağlar.",runId,startedAt:new Date().toISOString(),baseCommit:gitHead(repoRoot),mode:cfg.mode,executionUnit:cfg.scheduler.executionUnit,builder:{provider:cfg.builder.provider,modelId:cfg.builder.modelId},reviewer:{provider:cfg.reviewer.provider,modelId:cfg.reviewer.modelId},remoteConfigured:Boolean(remoteUrl(repoRoot)),remoteUrl:sanitizeRemoteUrl(remoteUrl(repoRoot)),status:"RUNNING"});

    while(processed<cfg.maxMilestonesPerRun){
      assertNotStopped(globalStopFile);assertClean(repoRoot);scheduler=loadSchedulerState(schedulerFile);assertSchedulerGitConsistency(scheduler);promoteDueRetries(scheduler);saveSchedulerState(schedulerFile,scheduler);
      if(allComplete(scheduler)){clearRetry();clearStage();return summaryAndExit(ledger,"COMPLETE",{processed},0)}
      let stage=loadStage(),pkg=null;
      if(stage?.packageId){const candidate=packages.map.get(stage.packageId);if(candidate&&!allPackagePhasesCompleted(candidate,scheduler)){
        const rows=candidate.phaseIds.map(p=>scheduler.phases.find(x=>x.phase===p));const retryDue=rows.every(r=>r.status!=="RETRY_WAIT"||!r.retryAt||Date.parse(r.retryAt)<=Date.now());
        if(rows.every(r=>["PENDING","RETRY_READY","ACTIVE","RETRY_WAIT"].includes(r.status))&&retryDue)pkg=candidate;
      }}
      if(!pkg)pkg=runnablePackages(packages,graph,scheduler)[0]??null;
      if(!pkg){
        const retrying=scheduler.phases.filter(x=>x.status==="RETRY_WAIT"&&x.retryAt).sort((a,b)=>Date.parse(a.retryAt)-Date.parse(b.retryAt));
        if(retrying.length){const sec=Math.max(60,Math.ceil((Date.parse(retrying[0].retryAt)-Date.now())/1000));const rp=packages.doc.packages.find(p=>p.phaseIds.includes(retrying[0].phase));writeRetry(sec,rp??{id:"UNKNOWN",phaseIds:[retrying[0].phase]},retrying[0].lastFailure);return summaryAndExit(ledger,"RETRY_WAIT",{phase:retrying[0].phase,retryAfterSeconds:sec},30)}
        if((scheduler.blocked??[]).length)return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{blocked:scheduler.blocked},40);
        return summaryAndExit(ledger,"IDLE_NO_RUNNABLE_WORK",{processed},0);
      }
      ensurePackageAtomicity(pkg,scheduler);const phaseIds=packagePendingPhases(pkg,scheduler);if(!phaseIds.length){processed++;continue}const leadPhase=Math.min(...phaseIds);
      const phaseContracts=phaseIds.map(p=>readJson(phaseContractPath(p)));const frozenFile=path.join(runtime,"frozen-contracts",`${pkg.id}.json`);fs.mkdirSync(path.dirname(frozenFile),{recursive:true});
      let milestone=readJsonIfExists(frozenFile,null);if(!milestone){milestone=freezeMilestonePackage({packageDef:pkg,phaseContracts,protectedPolicy});writeJsonAtomic(frozenFile,milestone)}
      assertFrozenContract(milestone);
      if(JSON.stringify([...milestone.phaseIds].sort((a,b)=>a-b))!==JSON.stringify([...phaseIds].sort((a,b)=>a-b)))throw new Error(`FROZEN_PACKAGE_PHASE_SET_MISMATCH ${pkg.id}`);
      const pv=policyViolation(milestone);if(pv){markPackageStateBlocked(scheduler,pkg,pv,"POLICY");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,reason:pv},40)}

      stage=loadStage();if(stage?.packageId===pkg.id)assertFrozenContract(milestone,stage.milestoneDigest);const baseCommit=stage?.packageId===pkg.id?stage.baseCommit:gitHead(repoRoot);
      if(stage?.packageId===pkg.id&&!['CLEAN_READY','PUSH'].includes(stage.stage)&&gitHead(repoRoot)!==baseCommit){markPackageStateBlocked(scheduler,pkg,"CONTROL_HEAD_CHANGED_DURING_RESUME","STATE_CONFLICT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id},40)}
      if(stage?.packageId!==pkg.id){stage={packageId:pkg.id,phaseIds,stage:"PREPARE",baseCommit,milestoneDigest:milestone.digest,cycle:1,reviewedCommit:null,findingLedger:[]};saveStage(stage)}
      markPackageActive(scheduler,pkg,runId);saveSchedulerState(schedulerFile,scheduler);clearRetry();

      // CLEAN_READY/PUSH are explicit crash-safe post-review states.
      if(stage.stage==='CLEAN_READY'||stage.stage==='PUSH'){
        const reviewedCommit=stage.reviewedCommit;if(!reviewedCommit)throw new Error("POST_CLEAN_REVIEWED_COMMIT_MISSING");
        verifyCleanReadyResume({repoRoot,stage,milestone,packageDef:pkg,publicKeyFile:evidencePublicKey});
        const head=gitHead(repoRoot);
        if(head===baseCommit){assertAutomationAction({action:"LOCAL_FAST_FORWARD_MERGE",milestone,globalConfig:cfg});mergeReviewedFastForward(repoRoot,baseCommit,reviewedCommit,stage.branch);ledger.event("git","MERGED_AFTER_CLEAN_RESUME",{commit:reviewedCommit},"INFO",{phase:leadPhase,milestoneId:pkg.id,actor:"SUPERVISOR"})}
        else if(head!==reviewedCommit)throw new Error(`POST_CLEAN_CONTROL_HEAD_CONFLICT expected=${baseCommit}|${reviewedCommit} actual=${head}`);
        saveStage({...stage,stage:"PUSH"});
        try{const remoteProtection=refreshRemoteProtection();const auth=authorizeAutomationAction({action:"REMOTE_PUSH",milestone,globalConfig:cfg,remoteProtection});const push=auth.allowed?pushMainAndVerify(repoRoot,cfg.git.defaultBranch):{pushed:false,reason:auth.reason};ledger.event("git","PUSH_AFTER_CLEAN",push,"INFO",{phase:leadPhase,milestoneId:pkg.id,actor:"SUPERVISOR"})}
        catch(e){const sec=nextRetrySeconds(scheduler,pkg,300),retryAt=isoAfter(sec);markPackageStateRetry(scheduler,pkg,String(e.message),retryAt);saveSchedulerState(schedulerFile,scheduler);saveStage({...stage,stage:"PUSH",lastFailure:String(e.message)});writeRetry(sec,pkg,String(e.message));return summaryAndExit(ledger,"RETRY_WAIT",{packageId:pkg.id,reason:String(e.message)},30)}
        markPackageCompleted(scheduler,pkg,reviewedCommit,stage.evidenceRefs??[]);saveSchedulerState(schedulerFile,scheduler);clearStage();if(stage.worktreeDir&&stage.branch){removeRunWorktree(repoRoot,stage.worktreeDir,stage.branch)}processed++;continue;
      }

      let workspace;
      if(stage.worktreeDir&&stage.branch)workspace=restoreRunWorktree(repoRoot,stage.worktreeDir,stage.branch);
      else{workspace=createRunWorktree(repoRoot,`${runId}-${pkg.id}`,baseCommit,cfg.git.runBranchPrefix);stage={...stage,worktreeDir:workspace.dir,branch:workspace.branch,stage:"BUILD"};saveStage(stage)}
            ledger.event("scheduler","PACKAGE_STARTED",{title:pkg.title,phaseIds,branch:workspace.branch},"INFO",{phase:leadPhase,milestoneId:pkg.id,actor:"SUPERVISOR"});

      let reviewedCommit=stage.reviewedCommit??null,validation=stage.validation??null,findingLedger=stage.findingLedger??[],cycle=stage.cycle??1;

      if(stage.stage==="BUILD"||stage.stage==="PREPARE"){
        const prompt=fs.readFileSync(path.join(repoRoot,"prompts/AUTO-BUILDER.md"),"utf8")+`\nFROZEN REVIEW PACKAGE CONTRACT:\n${JSON.stringify(milestone,null,2)}\nRESUME NOTE:\n${stage.worktreeDir?"Continue safely from existing isolated worktree; inspect current partial work before editing.":"Fresh isolated review-package worktree."}`;
        saveStage({...stage,stage:"BUILD",worktreeDir:workspace.dir,branch:workspace.branch});
        const b=await executeModel({kind:"builder",providerCfg:cfg.builder,prompt,worktree:workspace.dir,ledger,leadPhase,milestoneId:pkg.id,attemptName:`${pkg.id}-builder`,milestone});
        if(b.status!==0||b.error){const h=await handleInfrastructureFailure({result:b,stage:"builder",pkg,scheduler,ledger,checkpointState:{...stage,stage:"BUILD",worktreeDir:workspace.dir,branch:workspace.branch},worktree:workspace.dir});return h.code}
        const g=guardWorktree({worktree:workspace.dir,baseCommit,milestone});ledger.writeJson(`evidence/${pkg.id}-build-change-guard.json`,g);if(!g.files.length){markPackageStateBlocked(scheduler,pkg,"BUILDER_PRODUCED_NO_REVIEWABLE_CHANGE","BUILD");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id},40)}if(!g.ok){markPackageStateBlocked(scheduler,pkg,"BUILD_TRUST_GUARD_VIOLATION","TRUST_ROOT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,guard:g},40)}
        stage={...stage,stage:"VALIDATE",worktreeDir:workspace.dir,branch:workspace.branch};saveStage(stage);
      }

      if(["VALIDATE","VALIDATION_FIX"].includes(loadStage()?.stage)){
        stage=loadStage();try{ensureWorktreeDependencies(repoRoot,workspace.dir)}catch(e){const fake={status:1,stderr:String(e.message),stdout:"",timedOut:false,globalStopped:false};const h=await handleInfrastructureFailure({result:fake,stage:"dependencies",pkg,scheduler,ledger,checkpointState:stage,worktree:workspace.dir});return h.code}const vr=await runValidationWithFixes({pkg,milestone,worktree:workspace.dir,ledger,scheduler,checkpointState:stage,labelPrefix:`${pkg.id}-build`});if(!vr.ok)return vr.terminal.code;
        validation=vr.report;stage={...stage,stage:"COMMITTING",validation,commitKind:"build"};saveStage(stage);
      }

      stage=loadStage();
      if(stage.stage==="COMMITTING"){
        validation=stage.validation??validation;const currentHead=gitHead(workspace.dir),status=gitStatus(workspace.dir).trim();
        if(currentHead!==baseCommit&&!status){reviewedCommit=currentHead}
        else{
          const g=guardWorktree({worktree:workspace.dir,baseCommit,milestone});ledger.writeJson(`evidence/${pkg.id}-precommit-guard.json`,g);if(!g.ok||!g.files.length){markPackageStateBlocked(scheduler,pkg,"PRECOMMIT_GUARD_OR_EMPTY","TRUST_ROOT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,guard:g},40)}
          reviewedCommit=commitAll(workspace.dir,stage.commitKind==="remediation"?`fix(factory): ${pkg.id} review remediation`:`build(factory): ${pkg.id} ${pkg.title}`,g.files);
        }
        stage={...stage,stage:"REVIEW",reviewedCommit,cycle:stage.cycle??1,validation,findingLedger:stage.findingLedger??[]};saveStage(stage);
      }

      while(true){
        stage=loadStage();reviewedCommit=stage.reviewedCommit;validation=stage.validation??validation;findingLedger=stage.findingLedger??[];cycle=stage.cycle??1;
        if(stage.stage==="REMEDIATE"){
          const blockers=(findingLedger??[]).filter(x=>x.classification==="BLOCKER"&&x.status!=="RESOLVED");if(!blockers.length){markPackageStateBlocked(scheduler,pkg,"REMEDIATION_RESUME_WITHOUT_BLOCKERS","STATE_CONFLICT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id},40)}
          const remediationPrompt=fs.readFileSync(path.join(repoRoot,"prompts/AUTO-REMEDIATION.md"),"utf8")+`\nFROZEN REVIEW PACKAGE CONTRACT:\n${JSON.stringify(milestone,null,2)}\nADMISSIBLE BLOCKERS ONLY:\n${JSON.stringify(blockers,null,2)}\nRESUME NOTE:\nContinue from the existing isolated worktree; do not broaden scope.`;
          const rem=await executeModel({kind:"builder",providerCfg:cfg.builder,prompt:remediationPrompt,worktree:workspace.dir,ledger,leadPhase,milestoneId:pkg.id,attemptName:`${pkg.id}-remediation-${cycle}`,milestone});if(rem.status!==0||rem.error){const h=await handleInfrastructureFailure({result:rem,stage:"remediation",pkg,scheduler,ledger,checkpointState:stage,worktree:workspace.dir});return h.code}
          const rg=guardWorktree({worktree:workspace.dir,baseCommit,milestone});ledger.writeJson(`evidence/${pkg.id}-remediation-${cycle}-guard.json`,rg);if(!rg.ok){markPackageStateBlocked(scheduler,pkg,"REMEDIATION_TRUST_GUARD_VIOLATION","TRUST_ROOT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,guard:rg},40)}
          try{ensureWorktreeDependencies(repoRoot,workspace.dir)}catch(e){const fake={status:1,stderr:String(e.message),stdout:"",timedOut:false,globalStopped:false};const h=await handleInfrastructureFailure({result:fake,stage:"dependencies",pkg,scheduler,ledger,checkpointState:stage,worktree:workspace.dir});return h.code}const vr=await runValidationWithFixes({pkg,milestone,worktree:workspace.dir,ledger,scheduler,checkpointState:{...stage,stage:"VALIDATE"},labelPrefix:`${pkg.id}-remediation-${cycle}`});if(!vr.ok)return vr.terminal.code;
          const finalGuard=guardWorktree({worktree:workspace.dir,baseCommit,milestone});if(!finalGuard.ok||!finalGuard.files.length){markPackageStateBlocked(scheduler,pkg,"POST_REMEDIATION_GUARD_OR_EMPTY","TRUST_ROOT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,finalGuard},40)}
          saveStage({...stage,stage:"COMMITTING",validation:vr.report,commitKind:"remediation",findingLedger,cycle});
          const headBefore=gitHead(workspace.dir),st=gitStatus(workspace.dir).trim();reviewedCommit=headBefore!==baseCommit&&!st?headBefore:commitAll(workspace.dir,`fix(factory): ${pkg.id} review remediation cycle ${cycle}`,finalGuard.files);
          validation=vr.report;stage={...stage,stage:"REVIEW",reviewedCommit,validation,findingLedger,cycle:cycle+1};saveStage(stage);continue;
        }
        if(stage.stage!=="REVIEW")throw new Error(`UNEXPECTED_PACKAGE_STAGE ${stage.stage}`);
        if(cycle>cfg.maxReviewCycles){markPackageStateBlocked(scheduler,pkg,"REVIEW_DID_NOT_CONVERGE","REVIEW_NON_CONVERGENCE");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,findings:findingLedger},40)}
        assertNotStopped(globalStopFile);const committedChanged=showChangedCommitted(workspace.dir,baseCommit,reviewedCommit);const committedGuard=evaluateChangeSet({repoRoot,worktree:workspace.dir,baseCommit,changedFiles:committedChanged,milestone,protectedPolicy,governanceAuthorized:false});if(!committedGuard.ok){markPackageStateBlocked(scheduler,pkg,"COMMITTED_CHANGE_GUARD_VIOLATION","TRUST_ROOT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,committedGuard},40)}
        const bundle=buildReviewBundle({runId,cycle,phase:leadPhase,baseCommit,reviewedCommit,milestoneContract:milestone,changedFiles:committedChanged,changeGuard:committedGuard,diffStat:diffStat(workspace.dir,baseCommit,reviewedCommit),validation,knownLimitations:readJson(knownLimitationsFile).entries??[],acceptedDebt:readJson(acceptedDebtFile).entries??[],waivers:readJson(waiversFile).entries??[],previousFindingLedger:findingLedger,budgets:cfg.budgets});if(!validateReviewBundleSchema(bundle))throw new Error(`REVIEW_BUNDLE_SCHEMA_INVALID: ${ajv.errorsText(validateReviewBundleSchema.errors,{separator:" | "})}`);if(Buffer.byteLength(JSON.stringify(bundle),"utf8")>(cfg.budgets?.maxReviewBundleBytes??1_500_000))throw new Error("REVIEW_BUNDLE_BYTE_BUDGET_EXCEEDED");const runBundleFile=ledger.writeJson(`review/${pkg.id}-cycle-${cycle}-bundle.json`,bundle);
        const reviewPrompt=fs.readFileSync(path.join(repoRoot,"prompts/AUTO-REVIEW.md"),"utf8")+`\nREVIEW BUNDLE:\n${JSON.stringify(bundle,null,2)}`;
        const resultSchemaText=fs.readFileSync(path.join(repoRoot,cfg.review.resultSchema),"utf8");
        const reviewIdentity={runId,cycle,baseCommit,reviewedCommit,reviewBundleDigest:bundle.bundleDigest};
        let review=null,lastFormatError=null,lastMalformedOutput="";
        for(let formatTry=0;formatTry<=cfg.reviewer.formatRetryLimit;formatTry++){
          const prompt=formatTry===0?reviewPrompt:`FORMAT CORRECTION ONLY. Do not re-review and do not widen scope.\nIDENTITY:\n${JSON.stringify(reviewIdentity)}\nRESULT SCHEMA:\n${resultSchemaText}\nREJECTION:\n${lastFormatError}\nMALFORMED OUTPUT:\n${utf8Tail(lastMalformedOutput,cfg.budgets?.maxFormatCorrectionOutputBytes??24000)}\nReturn exactly one schema-valid JSON object preserving the prior analysis.`;
          const rp=await executeModel({kind:"reviewer",providerCfg:cfg.reviewer,prompt,worktree:workspace.dir,ledger,leadPhase,milestoneId:pkg.id,attemptName:`${pkg.id}-review-${cycle}-format-${formatTry}`,milestone});
          if(rp.status!==0||rp.error){const h=await handleInfrastructureFailure({result:rp,stage:"review",pkg,scheduler,ledger,checkpointState:{...stage,stage:"REVIEW",cycle,reviewedCommit,validation,findingLedger},worktree:workspace.dir});return h.code}
          try{review=parseGovernedReview(rp.stdout,{runId,cycle,baseCommit,reviewedCommit,reviewBundleDigest:bundle.bundleDigest,allowedBasisRefs:Object.values(bundle.reviewBasis).flat().map(x=>x.id),allowedEvidenceRefs:(bundle.evidenceCatalog??[]).map(x=>x.id),allowedValidationIds:(bundle.validation?.steps??[]).map(x=>String(x.id)),evidenceCatalog:bundle.evidenceCatalog??[],previousFindingLedger:bundle.previousFindingLedger??[],changedFiles:bundle.changedFiles});break}catch(e){lastFormatError=e.message;lastMalformedOutput=String(rp.stdout??"");ledger.event("reviewer","FORMAT_REJECTED",{error:e.message},"WARN",{phase:leadPhase,milestoneId:pkg.id,actor:"CODEX"})}
        }
        if(!review){markPackageStateBlocked(scheduler,pkg,`REVIEW_OUTPUT_INVALID: ${lastFormatError}`,"REVIEW_INPUT_INVALID");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,reason:lastFormatError},40)}
        const independence=ensureProviderSeparation(review);if(!independence.ok){markPackageStateBlocked(scheduler,pkg,independence.reason,"INDEPENDENCE_INSUFFICIENT");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,independence},40)}
        const governed=governConvergence(review,findingLedger,cycle);findingLedger=governed.ledger;persistLowBacklog(path.join(repoRoot,cfg.review.lowBacklogPath),[...(review.findings??[]),...(review.advisories??[]),...(governed.downgraded??[])],{packageId:pkg.id,runId,reviewedCommit,cycle});const result=finalGovernedResult(review,governed);const rawReviewDigest=sha256(stableStringify(review)),effectiveDigest=effectiveReviewDigest(review,governed,result);const reviewProof={review,governed,effectiveResult:result,rawReviewDigest,effectiveReviewDigest:effectiveDigest};const runReviewProofFile=ledger.writeJson(`review/${pkg.id}-cycle-${cycle}-result.json`,reviewProof);
        if(gitStatus(workspace.dir).trim()){markPackageStateBlocked(scheduler,pkg,"REVIEWER_MUTATED_READ_ONLY_WORKTREE","REVIEW_TRUST");saveSchedulerState(schedulerFile,scheduler);return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id},40)}
        if(result==="CLEAN"){
          const prov=providerProvenance();const attestation={"//TR":"Bu signed attestation exact reviewed package commit + frozen contract + review bundle + validation + governed blocker ledger üzerinde unresolved admissible blocker kalmadığını bağlar.",schemaVersion:"2.0.0",runId,packageId:pkg.id,phaseIds,reviewedCommit,baseCommit,milestoneDigest:milestone.digest,reviewBundleDigest:bundle.bundleDigest,validationDigest:sha256(stableStringify(validation??{})),rawReviewDigest,effectiveReviewDigest:effectiveDigest,governedFindingsDigest:governed.governedFindingsDigest,blockerLedgerDigest:governed.blockerLedgerDigest,reviewerProvenance:{provider:cfg.reviewer.provider,configuredModelId:cfg.reviewer.modelId,toolVersion:prov.codex.version,launcherSha256:prov.codex.launcherSha256,provenanceLevel:prov.codex.provenanceLevel??"UNKNOWN",packageName:prov.codex.packageName??"UNKNOWN",packageVersion:prov.codex.packageVersion??"UNKNOWN",packageJsonSha256:prov.codex.packageJsonSha256??"UNKNOWN"},result:"CLEAN",createdAt:new Date().toISOString()};
          const signedAtt=writeDurableAttestation(pkg,reviewedCommit,attestation);const durableDir=path.dirname(signedAtt.file),durableBundle=path.join(durableDir,`${reviewedCommit}-review-bundle.json`),durableProof=path.join(durableDir,`${reviewedCommit}-review-proof.json`),durableValidation=path.join(durableDir,`${reviewedCommit}-validation.json`);writeJsonAtomic(durableBundle,bundle);writeJsonAtomic(durableProof,reviewProof);writeJsonAtomic(durableValidation,validation??{});const runAtt=ledger.writeJson(`evidence/${pkg.id}-review-attestation.json`,signedAtt.signed);const evidenceRefs=[path.relative(repoRoot,signedAtt.file).replaceAll("\\","/"),path.relative(repoRoot,durableBundle).replaceAll("\\","/"),path.relative(repoRoot,durableProof).replaceAll("\\","/"),path.relative(repoRoot,durableValidation).replaceAll("\\","/"),path.relative(repoRoot,runAtt).replaceAll("\\","/"),path.relative(repoRoot,runBundleFile).replaceAll("\\","/"),path.relative(repoRoot,runReviewProofFile).replaceAll("\\","/"),`${cfg.logging.root}/${runId}/events.jsonl`];
          const cleanEvidence={attestationPath:path.relative(repoRoot,signedAtt.file).replaceAll("\\","/"),reviewBundlePath:path.relative(repoRoot,durableBundle).replaceAll("\\","/"),reviewProofPath:path.relative(repoRoot,durableProof).replaceAll("\\","/"),validationPath:path.relative(repoRoot,durableValidation).replaceAll("\\","/")};stage={...stage,stage:"CLEAN_READY",cycle,reviewedCommit,validation,findingLedger,evidenceRefs,reviewDigest:effectiveDigest,cleanEvidence};saveStage(stage);verifyCleanReadyResume({repoRoot,stage,milestone,packageDef:pkg,publicKeyFile:evidencePublicKey});
          const controlHead=gitHead(repoRoot);if(controlHead===baseCommit){assertAutomationAction({action:"LOCAL_FAST_FORWARD_MERGE",milestone,globalConfig:cfg});mergeReviewedFastForward(repoRoot,baseCommit,reviewedCommit,workspace.branch)} else if(controlHead!==reviewedCommit)throw new Error(`CONTROL_HEAD_CHANGED_BEFORE_CLEAN_MERGE actual=${controlHead}`);ledger.event("git","MERGED_AFTER_CLEAN",{commit:reviewedCommit},"INFO",{phase:leadPhase,milestoneId:pkg.id,actor:"SUPERVISOR"});
          stage={...stage,stage:"PUSH"};saveStage(stage);
          try{const remoteProtection=refreshRemoteProtection();const auth=authorizeAutomationAction({action:"REMOTE_PUSH",milestone,globalConfig:cfg,remoteProtection});const push=auth.allowed?pushMainAndVerify(repoRoot,cfg.git.defaultBranch):{pushed:false,reason:auth.reason};ledger.event("git","PUSH_AFTER_CLEAN",push,"INFO",{phase:leadPhase,milestoneId:pkg.id,actor:"SUPERVISOR"})}
          catch(e){const sec=nextRetrySeconds(scheduler,pkg,300),retryAt=isoAfter(sec);markPackageStateRetry(scheduler,pkg,String(e.message),retryAt);saveSchedulerState(schedulerFile,scheduler);writeRetry(sec,pkg,String(e.message));return summaryAndExit(ledger,"RETRY_WAIT",{packageId:pkg.id,reason:String(e.message)},30)}
          markPackageCompleted(scheduler,pkg,reviewedCommit,evidenceRefs);saveSchedulerState(schedulerFile,scheduler);clearStage();removeRunWorktree(repoRoot,workspace.dir,workspace.branch);ledger.event("scheduler","PACKAGE_COMPLETED",{commit:reviewedCommit,phaseIds},"INFO",{phase:leadPhase,milestoneId:pkg.id,actor:"SUPERVISOR"});processed++;break;
        }
        if(["ENVIRONMENT_BLOCKED","INDEPENDENCE_INSUFFICIENT","REVIEW_INPUT_INVALID","FOUNDER_DECISION_REQUIRED"].includes(result)){markPackageStateBlocked(scheduler,pkg,review.summary||result,result);saveSchedulerState(schedulerFile,scheduler);saveStage({...stage,stage:"FOUNDER_ATTENTION",findingLedger});return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,result,summary:review.summary},40)}
        if(cycle===cfg.maxReviewCycles){markPackageStateBlocked(scheduler,pkg,"REVIEW_DID_NOT_CONVERGE","REVIEW_NON_CONVERGENCE");saveSchedulerState(schedulerFile,scheduler);saveStage({...stage,stage:"FOUNDER_ATTENTION",findingLedger});return summaryAndExit(ledger,"FOUNDER_ATTENTION_REQUIRED",{packageId:pkg.id,findings:governed.acceptedBlockers},40)}
        stage={...stage,stage:"REMEDIATE",cycle,reviewedCommit,validation,findingLedger};saveStage(stage);
      }
    }
    scheduler=loadSchedulerState(schedulerFile);promoteDueRetries(scheduler);saveSchedulerState(schedulerFile,scheduler);if(runnablePackages(loadReviewPackages(packagesFile),loadGraph(graphFile),scheduler).length)return summaryAndExit(ledger,"MORE_WORK",{processed},20);return summaryAndExit(ledger,allComplete(scheduler)?"COMPLETE":"IDLE",{processed},0);
  }catch(e){if(globalStopState(globalStopFile)){ledger.writeSummary({status:"GLOBAL_STOP",error:String(e?.message??e)});return 50}ledger.event("supervisor","UNHANDLED_EXCEPTION",{error:String(e?.stack??e)},"ERROR",{actor:"SUPERVISOR"});ledger.writeSummary({status:"FATAL",error:String(e?.message??e),finishedAt:new Date().toISOString()});console.error(e);return 60}
  finally{releaseLock?.()}
}

const code=await main();process.exit(code);
