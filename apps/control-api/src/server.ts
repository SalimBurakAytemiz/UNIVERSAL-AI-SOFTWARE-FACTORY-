// //TR: Bu dosya Desktop Control Tower ile Day-0 runtime arasında localhost-only authenticated control/read API sağlar; trust-sensitive runtime state yeniden doğrulanır ve run/log erişimi symlink/realpath kaçışına kapalıdır.
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import cp from "node:child_process";
import {inspectProcessLock,clearStaleProcessLock} from "../../../automation/lib/process-lock.mjs";
import {appendControlAudit,readUtf8Tail,readJsonlTail} from "../../../automation/lib/control-audit.mjs";
import {canRetryBlockedKind,retryableBlockedKinds} from "../../../automation/lib/retry-authority.mjs";
import {activateGlobalStop,clearGlobalStop,globalStopState} from "../../../automation/lib/global-stop.mjs";
import {loadSchedulerState,saveSchedulerState} from "../../../automation/lib/scheduler.mjs";
import {assertSchedulerCompletionEvidence} from "../../../automation/lib/scheduler-completion.mjs";
import {spawnGitSync} from "../../../automation/lib/git-isolation.mjs";
import {safeChildEnv} from "../../../automation/lib/env-policy.mjs";
import {parseControlPort,controlChallengeProof,secureStringEqual,hostHeaderAllowed,resolveExistingPathUnder,resolveWritablePathUnder,verifyPhase0ForControl,verifyInstallReportForControl} from "../../../automation/lib/control-boundary.mjs";
// //TR: B2: orchestrator-state.mjs korumalıdır ve tip bildirimi yoktur; cockpit onu yalnız okuma için dar bir yerel tiple yeniden kullanır, hiçbir şey yazmaz.
// @ts-expect-error TS7016: orchestrator-state.mjs tip bildirimi yok
import {loadState as loadOrchestratorStateUntyped,verifyTransitionLog as verifyTransitionLogUntyped} from "../../../automation/lib/orchestrator-state.mjs";
import {WorkOsStore,defaultDataDir} from "../../../core/workos/store.js";
import {WorkOsError} from "../../../core/workos/types.js";
import {validateProjectCreate,validateMissionCreate,validateMissionTransition,validateRunStart} from "../../../core/workos/schemas.js";
import {isMissionStatus} from "../../../core/mission/state-machine.js";
import {authorizeAction} from "../../../core/action-gateway/policy.js";
import type {ActionPolicyContext} from "../../../core/action-gateway/types.js";
import {MissionRunner} from "../../../core/workos/runner.js";
import type {RunnerOptions} from "../../../core/workos/runner.js";
import {assertIndependentExecutors,executorsFromEnv} from "../../../core/workos/executors.js";
import type {ExecutorPair} from "../../../core/workos/executors.js";

// //TR: B1: buildServer testlerin ve CLI başlatmanın ortak girişidir; varsayılanlar eski sabit davranışla aynıdır (127.0.0.1 bind, token/Host kontrolü), opts yalnızca test enjeksiyonu içindir.
// //TR: B3a: executors yalnız programatik test enjeksiyonudur; gerçek adapter yalnız UASCO_WORKOS_EXECUTOR=local-claude ile seçilir. runner.enabled (veya UASCO_WORKOS_RUNNER=1) olmadan engine tick'i başlamaz.
export interface BuildServerOptions{controlToken?:string;runtime?:string;port?:number;dataDir?:string;repoRoot?:string;tenantId?:string;orgId?:string;actor?:string;policyContext?:Partial<ActionPolicyContext>;logger?:boolean;executors?:ExecutorPair;runner?:{enabled?:boolean;intervalMs?:number}&Partial<Pick<RunnerOptions,"leaseTtlMs"|"maxRemediations"|"maxRetries"|"retryBackoffMs"|"testTimeoutMs"|"executorTimeoutMs"|"security">>}
export function buildServer(opts:BuildServerOptions={}){
const app=Fastify({logger:opts.logger??true,requestIdHeader:"x-request-id",genReqId:()=>crypto.randomUUID(),bodyLimit:64*1024});
const readJson=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const readJsonOr=<T>(p:string,fallback:T):T=>fs.existsSync(p)?readJson(p):fallback;
const repoRoot=opts.repoRoot?path.resolve(opts.repoRoot):process.cwd(),runtime=opts.runtime??".ai/runtime",runsRoot=path.join(runtime,"runs"),port=opts.port??parseControlPort(process.env.CONTROL_API_PORT,3210);
const controlToken=opts.controlToken??process.env.UASCO_CONTROL_TOKEN??"";
const validRunId=(x:string)=>/^RUN-[A-Za-z0-9-]+$/.test(x);
const validLogName=(x:string)=>/^[A-Za-z0-9._-]+\.log$/.test(x);

function tokenOk(req:any){const value=req.headers["x-uasco-control-token"];return typeof value==="string"&&Boolean(controlToken)&&secureStringEqual(controlToken,value)}
function audit(event:string,details:Record<string,unknown>={}){const file=resolveWritablePathUnder(runtime,"control-api-events.jsonl");appendControlAudit(file,event,details,{maxBytes:2*1024*1024,maxBackups:5,maxEventBytes:64*1024})}
function safeRuntimeJsonOr<T>(name:string,fallback:T):T{const lexical=path.join(runtime,name);if(!fs.existsSync(lexical))return fallback;const file=resolveExistingPathUnder(runtime,name);if(!fs.statSync(file).isFile())throw new Error("CONTROL_RUNTIME_FILE_NOT_REGULAR");return readJson(file)}
function safeOptionalJsonIn(dir:string,name:string){const lexical=path.join(dir,name);if(!fs.existsSync(lexical))return null;const file=resolveExistingPathUnder(dir,name);if(!fs.statSync(file).isFile())return null;return readJson(file)}
function safeRunPath(runId:string,...parts:string[]){if(!validRunId(runId))throw new Error("INVALID_RUN_ID");return resolveExistingPathUnder(runsRoot,runId,...parts)}
function isAncestor(root:string,ancestor:string,descendant:string){return spawnGitSync(root,["merge-base","--is-ancestor",ancestor,descendant]).status===0}
function validatedSchedulerState(file:string){const state=loadSchedulerState(file),packages={doc:readJson("roadmap/review-packages.json")},publicKeyFile=path.join(runtime,"keys","evidence-ed25519-public.pem");assertSchedulerCompletionEvidence({repoRoot,state,packages,publicKeyFile,isAncestor});return state}
function schedulerView(){const lexical=path.join(runtime,"scheduler-state.json");if(!fs.existsSync(lexical))return {status:"NOT_INITIALIZED",verification:"PENDING"};try{const sf=resolveExistingPathUnder(runtime,"scheduler-state.json");return {...validatedSchedulerState(sf),verification:"VERIFIED"}}catch(e){return {status:"INVALID",verification:"REJECTED",error:"SCHEDULER_STATE_INVALID",detail:String((e as Error).message)}}}
function phase0View(){let report;try{report=safeRuntimeJsonOr<any>("PHASE0_ACCEPTANCE.json",null)}catch(e){return {final:"INVALID",verification:"REJECTED",errors:[String((e as Error).message)]}}if(!report)return {final:"PENDING",verification:"PENDING"};const v=verifyPhase0ForControl(repoRoot,report);return v.ok?{...report,verification:"VERIFIED"}:{final:"INVALID",verification:"REJECTED",errors:v.errors}}
function installView(){let report,phase0;try{report=safeRuntimeJsonOr<any>("INSTALL_REPORT.json",null);phase0=safeRuntimeJsonOr<any>("PHASE0_ACCEPTANCE.json",null)}catch(e){return {phase0Final:"INVALID",verification:"REJECTED",components:{},errors:[String((e as Error).message)]}}if(!report)return {phase0Final:"PENDING",verification:"PENDING",components:{}};const v=verifyInstallReportForControl(repoRoot,report,phase0);return v.ok?{...report,verification:"VERIFIED"}:{phase0Final:"INVALID",verification:"REJECTED",components:{},errors:v.errors}}

// //TR: GOV2: eski ürün supervisor'ı emekli edildi; control-api hiçbir süreç başlatmaz ve açık bir fail-closed sonuç döner (Codex review yolu başlatılamaz).
function startSupervisorDetached(){
  return {started:false,reason:"LEGACY_CODEX_REVIEW_PATH_RETIRED"};
  const lockFile=path.join(runtime,"supervisor.lock");
  try{const state=inspectProcessLock(lockFile);if(state.stale)clearStaleProcessLock(lockFile);else if(state.state!=="ABSENT")return {started:false,reason:`SUPERVISOR_LOCK_${state.state}`};}catch(e){return {started:false,reason:String((e as Error).message)}}
  const script=path.resolve("scripts/start-full-auto.ps1"),shell=process.platform==="win32"?"powershell.exe":"pwsh",env=safeChildEnv("config/environment-policy.json",{provider:"DETERMINISTIC"});
  try{const child=cp.spawn(shell,["-NoProfile","-ExecutionPolicy","Bypass","-File",script],{cwd:process.cwd(),detached:true,stdio:"ignore",windowsHide:true,env});child.unref();return {started:true,pid:child.pid}}catch(e){return {started:false,reason:String((e as Error).message)}}
}

app.addHook("onRequest",async(req,reply)=>{
  if(!hostHeaderAllowed(req.headers.host,port))return reply.code(421).send({error:"CONTROL_HOST_REJECTED"});
  const pathname=req.url.split("?",1)[0];if(pathname==="/health")return;
  if(pathname.startsWith("/v1/")&&!controlToken)return reply.code(503).send({error:"CONTROL_TOKEN_NOT_CONFIGURED"});
  if(pathname.startsWith("/v1/")&&!tokenOk(req))return reply.code(403).send({error:"FORBIDDEN"});
});

app.get<{Querystring:{challenge?:string}}>("/health",async(req)=>({status:"HEALTHY",system:"UNIVERSAL-AI-SOFTWARE-COMPANY-OS",bindHost:"127.0.0.1",port,time:new Date().toISOString(),controlProof:controlChallengeProof(controlToken,String(req.query?.challenge??""))}));
app.get("/v1/factory",async()=>readJson(".ai/MASTER_STATE.json"));
app.get("/v1/phase0",async()=>phase0View());
app.get("/v1/install",async()=>installView());
app.get("/v1/scheduler",async()=>schedulerView());
app.get("/v1/agents",async()=>readJson("registries/agents.json"));
app.get("/v1/capabilities",async()=>readJson("registries/capabilities.json"));
app.get("/v1/fabrics",async()=>readJson("registries/execution-fabrics.json"));
app.get("/v1/adapters",async()=>readJson("registries/tool-adapters.json"));
app.get("/v1/domains",async()=>readJson("registries/domain-packs.json"));
app.get("/v1/control/status",async()=>{try{const f=path.join(runtime,"GLOBAL_STOP.json");if(fs.existsSync(f))resolveExistingPathUnder(runtime,"GLOBAL_STOP.json");return {globalStop:globalStopState(f)??{active:false}}}catch{return {globalStop:{active:true,reason:"GLOBAL_STOP_STATE_UNSAFE"},verification:"REJECTED"}}});
app.get("/v1/retry",async()=>{try{return safeRuntimeJsonOr("SUPERVISOR_RETRY.json",null)}catch{return {status:"INVALID",error:"SUPERVISOR_RETRY_STATE_UNSAFE"}}});
app.get("/v1/founder-attention",async()=>{const scheduler=schedulerView() as any;if(scheduler.verification==="REJECTED")return {blocked:[],retryableKinds:retryableBlockedKinds(),schedulerVerification:"REJECTED",error:scheduler.error};const blocked=(scheduler.blocked??[]).map((x:any)=>({...x,retryable:canRetryBlockedKind(x.kind)}));return {blocked,retryableKinds:retryableBlockedKinds(),schedulerVerification:scheduler.verification,checkpoint:safeRuntimeJsonOr("supervisor-checkpoint.json",null),retry:safeRuntimeJsonOr("SUPERVISOR_RETRY.json",null)}});

app.get("/v1/runs",async()=>{
  if(!fs.existsSync(runsRoot))return {count:0,runs:[]};
  const runs=fs.readdirSync(runsRoot,{withFileTypes:true}).filter(x=>x.isDirectory()&&validRunId(x.name)).flatMap(x=>{try{const dir=safeRunPath(x.name);return [{runId:x.name,summary:safeOptionalJsonIn(dir,"summary.json"),manifest:safeOptionalJsonIn(dir,"run-manifest.json")}]}catch{return []}}).sort((a,b)=>b.runId.localeCompare(a.runId)).slice(0,100);
  return {count:runs.length,runs};
});
app.get<{Params:{runId:string}}>("/v1/runs/:runId/events",async(req,reply)=>{
  if(!validRunId(req.params.runId))return reply.code(400).send({error:"INVALID_RUN_ID"});let f;try{f=safeRunPath(req.params.runId,"events.jsonl")}catch{return reply.code(404).send({error:"NOT_FOUND_OR_UNSAFE_PATH"})};if(!fs.statSync(f).isFile())return reply.code(404).send({error:"NOT_FOUND"});
  const tail=readJsonlTail(f,{maxEvents:2000,maxBytes:1024*1024});return {runId:req.params.runId,events:tail.events,truncated:tail.truncated};
});
app.get<{Params:{runId:string}}>("/v1/runs/:runId/logs",async(req,reply)=>{
  if(!validRunId(req.params.runId))return reply.code(400).send({error:"INVALID_RUN_ID"});let dir;try{dir=safeRunPath(req.params.runId,"logs")}catch{return {runId:req.params.runId,logs:[]}};if(!fs.statSync(dir).isDirectory())return {runId:req.params.runId,logs:[]};
  const logs=fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&validLogName(x.name)).flatMap(x=>{try{const file=resolveExistingPathUnder(dir,x.name);return [{name:x.name,size:fs.statSync(file).size}]}catch{return []}});return {runId:req.params.runId,logs};
});
app.get<{Params:{runId:string,name:string}}>("/v1/runs/:runId/logs/:name",async(req,reply)=>{
  if(!validRunId(req.params.runId)||!validLogName(req.params.name))return reply.code(400).send({error:"INVALID_PATH"});let f;try{f=safeRunPath(req.params.runId,"logs",req.params.name)}catch{return reply.code(404).send({error:"NOT_FOUND_OR_UNSAFE_PATH"})};if(!fs.statSync(f).isFile())return reply.code(404).send({error:"NOT_FOUND"});
  const tail=readUtf8Tail(f,256*1024);return {runId:req.params.runId,name:req.params.name,truncated:tail.truncated,text:tail.text};
});

app.post("/v1/control/stop",async(req)=>{const body=(req.body??{}) as {reason?:string};const reason=String(body.reason??"Founder requested stop").slice(0,1000);activateGlobalStop(path.join(runtime,"GLOBAL_STOP.json"),reason,"FOUNDER_CONTROL_TOWER");const doc=globalStopState(path.join(runtime,"GLOBAL_STOP.json"));audit("GLOBAL_STOP_ACTIVATED",{reason});return {ok:true,globalStop:doc}});
app.post("/v1/control/resume",async()=>{clearGlobalStop(path.join(runtime,"GLOBAL_STOP.json"),"FOUNDER_CONTROL_TOWER");const start=startSupervisorDetached();audit("GLOBAL_STOP_CLEARED_AND_RESUME_REQUESTED",start);return {ok:true,globalStop:{active:false},supervisor:start}});
app.post("/v1/control/retry-blocked",async(req,reply)=>{
  const body=(req.body??{}) as {packageId?:string};const packageId=String(body.packageId??"");if(!/^PKG-\d{3}$/.test(packageId))return reply.code(400).send({error:"INVALID_PACKAGE_ID"});
  const lexicalState=path.join(runtime,"scheduler-state.json");if(!fs.existsSync(lexicalState))return reply.code(409).send({error:"SCHEDULER_NOT_INITIALIZED"});let sf;try{sf=resolveExistingPathUnder(runtime,"scheduler-state.json")}catch{return reply.code(409).send({error:"SCHEDULER_STATE_UNSAFE_PATH"})}
  const packages=readJson("roadmap/review-packages.json").packages as Array<{id:string;phaseIds:number[]}>;const pkg=packages.find(x=>x.id===packageId);if(!pkg)return reply.code(404).send({error:"PACKAGE_NOT_FOUND"});
  let state;try{state=validatedSchedulerState(sf)}catch(e){return reply.code(409).send({error:"SCHEDULER_STATE_INVALID",detail:String((e as Error).message)})}const blockers=(state.blocked??[]).filter((x:any)=>x.packageId===packageId||pkg.phaseIds.includes(x.phase));if(!blockers.length)return reply.code(409).send({error:"PACKAGE_NOT_BLOCKED"});const forbidden=blockers.filter((x:any)=>!canRetryBlockedKind(x.kind));if(forbidden.length)return reply.code(409).send({error:"BLOCKER_NOT_TECHNICALLY_RETRYABLE",packageId,blockedKinds:[...new Set(forbidden.map((x:any)=>String(x.kind??"UNKNOWN")))]});for(const phase of pkg.phaseIds){const row=state.phases?.find((x:any)=>x.phase===phase);if(row&&row.status==="BLOCKED"){row.status="RETRY_READY";delete row.lastFailure}}state.blocked=(state.blocked??[]).filter((x:any)=>x.packageId!==packageId&&!pkg.phaseIds.includes(x.phase));saveSchedulerState(sf,state);const start=startSupervisorDetached();audit("FOUNDER_RETRY_TECHNICAL_BLOCKED_PACKAGE",{packageId,blockedKinds:blockers.map((x:any)=>x.kind),...start});return {ok:true,packageId,supervisor:start};
});


// //TR: B1 Work OS intake route'ları: hepsi mevcut control token/Host hook'u arkasındadır; yazma route'ları sırasıyla Global Stop (423), action-gateway policy (403) ve sıkı şema (400) kapılarından geçer ve secret içermeyen control audit yazar.
const actor=opts.actor??"FOUNDER_LOCAL",scope={tenantId:opts.tenantId??"local"},orgId=opts.orgId??"local";
let workosStore:WorkOsStore|null=null;
const getStore=()=>workosStore??=new WorkOsStore(opts.dataDir??defaultDataDir(repoRoot));
const sha=(x:string)=>crypto.createHash("sha256").update(x).digest("hex");
const validProjectId=(x:unknown)=>typeof x==="string"&&/^prj_[0-9a-f]{24}$/.test(x);
const validMissionId=(x:unknown)=>typeof x==="string"&&/^msn_[0-9a-f]{24}$/.test(x);
function workosStopped(){try{const f=path.join(runtime,"GLOBAL_STOP.json");if(fs.existsSync(f))resolveExistingPathUnder(runtime,"GLOBAL_STOP.json");return globalStopState(f)!==null}catch{return true}}
function workosPolicy(action:string,missionId:string,body:unknown){
  const target=`workos:${scope.tenantId}`,policyCtx:ActionPolicyContext={scopeAllowed:true,dataPolicyAllowed:true,budgetAllowed:true,adapterCertified:true,...(opts.policyContext??{})};
  return authorizeAction({id:`act_${crypto.randomBytes(8).toString("hex")}`,missionId,actorId:actor,actionClass:"MUTATION",target,actionDigest:sha(`${action}:${JSON.stringify(body??null)}`),targetDigest:sha(target),production:false,reversible:true},policyCtx);
}
// //TR: B2 F-B1-007: bilinen WorkOsError kodları sabit gövdeyle döner; bilinmeyen hata ham mesaj/yol/stack olmadan genel 500 INTERNAL_ERROR olur (ayrıntı yalnız sunucu log'unda).
function workosFail(reply:any,e:unknown){
  if(e instanceof WorkOsError){
    if(e.code==="WORKOS_IDEMPOTENCY_CONFLICT")return reply.code(409).send({error:"IDEMPOTENCY_CONFLICT"});
    // B3a: çakışma/fencing 409; reason yalnız sabit kod parçasıdır (MISSION_NOT_RUNNABLE, RUN_ALREADY_ACTIVE), yol veya secret taşımaz.
    if(e.code==="WORKOS_CONFLICT"||e.code==="WORKOS_LEASE_FENCED")return reply.code(409).send({error:e.code,reason:e.code==="WORKOS_CONFLICT"?e.message.replace(/^WORKOS_CONFLICT: ?/,"").slice(0,64):undefined});
    const status=e.code==="WORKOS_JOURNAL_TAMPERED"||e.code==="WORKOS_UNAVAILABLE"?503:e.code==="WORKOS_NOT_FOUND"?404:e.code==="WORKOS_INVALID_TRANSITION"?409:400;
    return reply.code(status).send({error:e.code});
  }
  try{app.log.error({err:e},"WORKOS_INTERNAL_ERROR")}catch{}
  return reply.code(500).send({error:"INTERNAL_ERROR"});
}
const wos=(fn:(req:any,reply:any)=>unknown)=>async(req:any,reply:any)=>{try{return await fn(req,reply)}catch(e){return workosFail(reply,e)}};
// Ortak yazma kapısı: stop -> policy -> şema; geçerse handler çalışır.
function workosWrite(reply:any,action:string,missionId:string,body:unknown,validate:(x:unknown)=>{ok:true}|{ok:false;errors:string}){
  if(workosStopped()){reply.code(423).send({error:"GLOBAL_STOP_ACTIVE"});return false}
  const decision=workosPolicy(action,missionId,body);if(!decision.allowed){audit("WORKOS_WRITE_DENIED",{actor,action,reason:decision.reason});reply.code(403).send({error:"ACTION_DENIED",reason:decision.reason});return false}
  const v=validate(body);if(!v.ok){reply.code(400).send({error:"INVALID_BODY",detail:v.errors});return false}
  return true;
}

app.get("/v1/projects",wos(async()=>({projects:getStore().listProjects(scope)})));
app.post("/v1/projects",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"workos.project.create","NONE",body,validateProjectCreate))return reply;
  const b=body as any;
  const r=getStore().createProjectDetailed({tenantId:scope.tenantId,orgId,name:b.name,environmentId:b.environmentId,customerId:b.customerId,repository:b.repository,createdBy:actor,idempotencyKey:b.idempotencyKey,testCommand:b.testCommand});
  audit(r.replayed?"WORKOS_IDEMPOTENT_REPLAY":"WORKOS_PROJECT_CREATED",{actor,kind:"project",projectId:r.entity.projectId});return reply.code(r.replayed?200:201).send({project:r.entity});
}));
app.get<{Querystring:{projectId?:string}}>("/v1/missions",wos(async(req,reply)=>{
  const projectId=req.query?.projectId;if(projectId!==undefined&&!validProjectId(projectId))return reply.code(400).send({error:"INVALID_PROJECT_ID"});
  try{return {missions:getStore().listMissions(scope,projectId)}}catch(e){return workosFail(reply,e)}
}));
app.post("/v1/missions",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"workos.mission.create","NONE",body,validateMissionCreate))return reply;
  const b=body as any;
  const r=getStore().createMissionDetailed({tenantId:scope.tenantId,projectId:b.projectId,title:b.title,objective:b.objective,acceptanceCriteria:b.acceptanceCriteria,riskLevel:b.riskLevel,createdBy:actor,idempotencyKey:b.idempotencyKey,testCommand:b.testCommand});
  const mission=r.entity;audit(r.replayed?"WORKOS_IDEMPOTENT_REPLAY":"WORKOS_MISSION_CREATED",{actor,kind:"mission",missionId:mission.missionId,projectId:mission.projectId,riskLevel:mission.riskLevel,traceId:mission.traceId});return reply.code(r.replayed?200:201).send({mission});
}));
app.get<{Params:{id:string}}>("/v1/missions/:id",wos(async(req,reply)=>{
  if(!validMissionId(req.params.id))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  try{const m=getStore().getMission(scope,req.params.id);if(!m)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});return {mission:m,tasks:getStore().listTasks(scope,m.missionId)}}catch(e){return workosFail(reply,e)}
}));
app.post<{Params:{id:string}}>("/v1/missions/:id/transition",wos(async(req,reply)=>{
  if(!validMissionId(req.params.id))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  const body=req.body??{};if(!workosWrite(reply,"workos.mission.transition",req.params.id,body,validateMissionTransition))return reply;
  const b=body as any;if(!isMissionStatus(b.to))return reply.code(400).send({error:"INVALID_BODY",detail:"to is not a mission status"});
  try{const before=getStore().getMission(scope,req.params.id);const mission=getStore().transitionMission(scope,req.params.id,b.to,b.reason,actor);audit("WORKOS_MISSION_TRANSITIONED",{actor,missionId:mission.missionId,from:before?.status,to:mission.status});return {mission}}catch(e){return workosFail(reply,e)}
}));

// //TR: B3a mission runner route'ları: aynı token hook'u ve aynı yazma kapısı sırası (GLOBAL_STOP 423 -> action-gateway 403 -> şema 400). Run'lar aynı Work OS journal'ındadır; eski /v1/runs route'larına dokunulmaz.
const validWorkRunId=(x:unknown)=>typeof x==="string"&&/^run_[0-9a-f]{24}$/.test(x);
let executorsCache:{pair:ExecutorPair|null;reason:string}|null=null;
const getExecutors=()=>executorsCache??=opts.executors?{pair:opts.executors,reason:opts.executors.kind}:executorsFromEnv(repoRoot);
let workRunner:MissionRunner|null=null;
function getRunner(){
  if(workRunner)return workRunner;
  const ex=getExecutors();if(!ex.pair)return null;
  const r=opts.runner??{};
  workRunner=new MissionRunner({store:getStore(),dataDir:getStore().dataDir,globalStopFile:path.join(runtime,"GLOBAL_STOP.json"),envPolicyFile:path.join(repoRoot,"config","environment-policy.json"),executors:ex.pair,
    leaseTtlMs:r.leaseTtlMs,maxRemediations:r.maxRemediations,maxRetries:r.maxRetries,retryBackoffMs:r.retryBackoffMs,testTimeoutMs:r.testTimeoutMs,executorTimeoutMs:r.executorTimeoutMs,security:r.security});
  return workRunner;
}
const runnerEnabled=opts.runner?.enabled??process.env.UASCO_WORKOS_RUNNER==="1";
if(runnerEnabled){
  app.addHook("onReady",async()=>{try{const r=getRunner();if(r){r.start(opts.runner?.intervalMs??2000);audit("WORKOS_RUNNER_STARTED",{engineId:r.engineId,executor:getExecutors().reason})}else audit("WORKOS_RUNNER_NOT_STARTED",{reason:getExecutors().reason})}catch{audit("WORKOS_RUNNER_NOT_STARTED",{reason:"EXECUTOR_CONFIG_REFUSED"})}});
  app.addHook("onClose",async()=>{workRunner?.stop()});
}
app.post<{Params:{id:string}}>("/v1/missions/:id/runs",wos(async(req,reply)=>{
  if(!validMissionId(req.params.id))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  const body=req.body??{};if(!workosWrite(reply,"workos.run.start",req.params.id,body,validateRunStart))return reply;
  const ex=getExecutors();if(!ex.pair)return reply.code(409).send({error:"EXECUTOR_NOT_CONFIGURED",reason:ex.reason});
  try{assertIndependentExecutors(ex.pair)}catch{audit("WORKOS_RUN_REFUSED",{actor,missionId:req.params.id,reason:"EXECUTOR_CONFIG_REFUSED"});return reply.code(409).send({error:"EXECUTOR_CONFIG_REFUSED"})}
  const b=body as any;
  const r=getStore().createRunDetailed({tenantId:scope.tenantId,missionId:req.params.id,roleId:b.roleId??null,executor:{implementer:ex.pair.implementer.identity,reviewer:ex.pair.reviewer.identity},createdBy:actor,idempotencyKey:b.idempotencyKey});
  audit(r.replayed?"WORKOS_IDEMPOTENT_REPLAY":"WORKOS_RUN_CREATED",{actor,kind:"run",runId:r.entity.runId,missionId:r.entity.missionId,executor:r.entity.executor});
  return reply.code(r.replayed?200:201).send({run:r.entity});
}));
app.get<{Querystring:{missionId?:string}}>("/v1/work-runs",wos(async(req,reply)=>{
  const missionId=req.query?.missionId;if(missionId!==undefined&&!validMissionId(missionId))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  return {runs:getStore().listRuns(scope,missionId)};
}));
app.get<{Params:{id:string}}>("/v1/work-runs/:id",wos(async(req,reply)=>{
  if(!validWorkRunId(req.params.id))return reply.code(400).send({error:"INVALID_RUN_ID"});
  const run=getStore().getRun(scope,req.params.id);if(!run)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});return {run};
}));

// //TR: B2 GET /v1/cockpit: UI için tek okuma otoritesidir; yalnız okur (Work OS store, orchestrator state, registry), hiçbir kaynağı yazmaz, eksik/okunamayan/uygulanmamış kaynak için sayı uydurmaz (state UNAVAILABLE/ERROR, sayılar null).
type CockpitState="VERIFIED"|"STALE"|"UNAVAILABLE"|"ERROR";
const loadOrchestratorState=loadOrchestratorStateUntyped as (file:string)=>{doc:any;control:any};
const verifyTransitionLog=verifyTransitionLogUntyped as (file:string,control:any)=>{ok:boolean};
const countBy=<T,>(items:T[],key:(x:T)=>string)=>{const o:Record<string,number>={};for(const i of items){const k=key(i);o[k]=(o[k]??0)+1}return o};
const underRepo=(raw:string)=>{const f=path.resolve(raw.split("${REPO}").join(repoRoot)),rel=path.relative(repoRoot,f);if(!rel||rel.startsWith("..")||path.isAbsolute(rel))throw new Error("COCKPIT_PATH_OUTSIDE_REPO");return {file:f,rel}};
function cockpitStop(){try{const f=path.join(runtime,"GLOBAL_STOP.json");if(fs.existsSync(f))resolveExistingPathUnder(runtime,"GLOBAL_STOP.json");const st=globalStopState(f);return st?{active:true,reason:typeof st.reason==="string"?st.reason:null}:{active:false,reason:null}}catch{return {active:true,reason:"GLOBAL_STOP_STATE_UNSAFE"}}}
function cockpitWorkos(){
  const none={projects:{state:"UNAVAILABLE" as CockpitState,count:null as number|null},missions:{state:"UNAVAILABLE" as CockpitState,total:null as number|null,byStatus:{} as Record<string,number>},awaitingApproval:{state:"UNAVAILABLE" as CockpitState,items:[] as unknown[]}};
  try{
    const st=getStore();if(!st.hasJournal)return none;
    const projects=st.listProjects(scope),missions=st.listMissions(scope);
    return {
      projects:{state:"VERIFIED" as CockpitState,count:projects.length},
      missions:{state:"VERIFIED" as CockpitState,total:missions.length,byStatus:countBy(missions,m=>m.status)},
      awaitingApproval:{state:"VERIFIED" as CockpitState,items:missions.filter(m=>m.status==="PREFLIGHT"||m.status==="FOUNDER_ATTENTION_REQUIRED").map(m=>({missionId:m.missionId,projectId:m.projectId,title:m.title,riskLevel:m.riskLevel}))}
    };
  }catch{
    const e={...none};e.projects={state:"ERROR",count:null};e.missions={state:"ERROR",total:null,byStatus:{}};e.awaitingApproval={state:"ERROR",items:[]};return e;
  }
}
function cockpitOrchestrator(){
  const mk=(state:CockpitState,asOf:string|null=null,total:number|null=null,byStatus:Record<string,number>={})=>({state,asOf,packages:{total,byStatus},source:"ORCHESTRATOR_STATE" as const});
  const policyFile=path.join(repoRoot,"config","orchestrator-policy.json");
  if(!fs.existsSync(policyFile))return mk("UNAVAILABLE");
  try{
    const policy=readJson(policyFile);if(typeof policy?.roots?.stateFile!=="string")return mk("ERROR");
    const {file,rel}=underRepo(policy.roots.stateFile);
    if(!fs.existsSync(file)&&!fs.existsSync(`${file}.prev`))return mk("UNAVAILABLE");
    if(fs.existsSync(file)){const real=resolveExistingPathUnder(repoRoot,rel);if(!fs.statSync(real).isFile())return mk("ERROR")}
    const {doc,control}=loadOrchestratorState(file);
    if(!control)return mk("UNAVAILABLE");
    if(typeof policy.roots.transitionLog==="string"){const log=underRepo(policy.roots.transitionLog);if(!verifyTransitionLog(log.file,control).ok)return mk("ERROR")}
    const pk=Object.values(control.packages) as any[];
    const asOf=typeof doc.updatedAt==="string"&&Number.isFinite(Date.parse(doc.updatedAt))?doc.updatedAt:null;
    const leaseExpired=Boolean(control.lease)&&Date.parse(control.lease.expiresAt)<Date.now();
    return mk(asOf===null||leaseExpired?"STALE":"VERIFIED",asOf,pk.length,countBy(pk,p=>String(p.status)));
  }catch{return mk("ERROR")}
}
// //TR: B3a: workforce.activeWorkerRuns Work OS journal'ındaki LEASED/RUNNING/CHECKPOINTING/VERIFYING run sayısıdır (state VERIFIED); journal yoksa UNAVAILABLE/null, okunamazsa ERROR/null. registeredRoles/targetRoles yalnız okunabilen registry dosyasından gelir. Sözleşme şekli değişmez.
function cockpitWorkforce(){
  const base=(state:CockpitState,registeredRoles:number|null,targetRoles:number|null,activeWorkerRuns:number|null=null)=>({state,registeredRoles,targetRoles,activeWorkerRuns,source:"registries/agents.json; registries/target-role-catalog.json; Work OS journal runs (LEASED|RUNNING|CHECKPOINTING|VERIFYING)"});
  try{
    let registered:number|null=null,target:number|null=null;
    const af=path.join(repoRoot,"registries","agents.json");
    if(fs.existsSync(af)){const a=readJson(af);if(!Array.isArray(a?.agents))return base("ERROR",null,null);registered=a.agents.length}
    const tf=path.join(repoRoot,"registries","target-role-catalog.json");
    if(fs.existsSync(tf)){const t=readJson(tf);const n=Array.isArray(t)?t.length:Array.isArray(t?.roles)?t.roles.length:Number.isInteger(t?.count)&&t.count>=0?t.count:null;if(n===null)return base("ERROR",registered,null);target=n}
    const st=getStore();if(!st.hasJournal)return base("UNAVAILABLE",registered,target);
    let active:number;try{active=st.countActiveWorkerRuns(scope)}catch{return base("ERROR",registered,target)}
    return base("VERIFIED",registered,target,active);
  }catch{return base("ERROR",null,null)}
}
app.get("/v1/cockpit",wos(async()=>({
  generatedAt:new Date().toISOString(),globalStop:cockpitStop(),...cockpitWorkos(),orchestrator:cockpitOrchestrator(),workforce:cockpitWorkforce(),
  legacy:{scheduler:{authority:false,note:"LEGACY_SNAPSHOT"}}
})));
return app;
}

// //TR: Yalnızca doğrudan çalıştırıldığında (tsx apps/control-api/src/server.ts) dinler; import eden testler port açmaz.
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  const app=buildServer(),port=parseControlPort(process.env.CONTROL_API_PORT,3210);
  await app.listen({host:"127.0.0.1",port});
}

