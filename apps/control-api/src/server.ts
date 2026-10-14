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
import {WorkOsStore,defaultDataDir} from "../../../core/workos/store.js";
import {WorkOsError} from "../../../core/workos/types.js";
import {validateProjectCreate,validateMissionCreate,validateMissionTransition} from "../../../core/workos/schemas.js";
import {isMissionStatus} from "../../../core/mission/state-machine.js";
import {authorizeAction} from "../../../core/action-gateway/policy.js";
import type {ActionPolicyContext} from "../../../core/action-gateway/types.js";

// //TR: B1: buildServer testlerin ve CLI başlatmanın ortak girişidir; varsayılanlar eski sabit davranışla aynıdır (127.0.0.1 bind, token/Host kontrolü), opts yalnızca test enjeksiyonu içindir.
export interface BuildServerOptions{controlToken?:string;runtime?:string;port?:number;dataDir?:string;tenantId?:string;orgId?:string;actor?:string;policyContext?:Partial<ActionPolicyContext>;logger?:boolean}
export function buildServer(opts:BuildServerOptions={}){
const app=Fastify({logger:opts.logger??true,requestIdHeader:"x-request-id",genReqId:()=>crypto.randomUUID(),bodyLimit:64*1024});
const readJson=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const readJsonOr=<T>(p:string,fallback:T):T=>fs.existsSync(p)?readJson(p):fallback;
const repoRoot=process.cwd(),runtime=opts.runtime??".ai/runtime",runsRoot=path.join(runtime,"runs"),port=opts.port??parseControlPort(process.env.CONTROL_API_PORT,3210);
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
function workosFail(reply:any,e:unknown){
  if(e instanceof WorkOsError){const status=e.code==="WORKOS_JOURNAL_TAMPERED"?503:e.code==="WORKOS_NOT_FOUND"?404:e.code==="WORKOS_INVALID_TRANSITION"?409:400;return reply.code(status).send({error:e.code})}
  throw e;
}
// Ortak yazma kapısı: stop -> policy -> şema; geçerse handler çalışır.
function workosWrite(reply:any,action:string,missionId:string,body:unknown,validate:(x:unknown)=>{ok:true}|{ok:false;errors:string}){
  if(workosStopped()){reply.code(423).send({error:"GLOBAL_STOP_ACTIVE"});return false}
  const decision=workosPolicy(action,missionId,body);if(!decision.allowed){audit("WORKOS_WRITE_DENIED",{actor,action,reason:decision.reason});reply.code(403).send({error:"ACTION_DENIED",reason:decision.reason});return false}
  const v=validate(body);if(!v.ok){reply.code(400).send({error:"INVALID_BODY",detail:v.errors});return false}
  return true;
}

app.get("/v1/projects",async(_req,reply)=>{try{return {projects:getStore().listProjects(scope)}}catch(e){return workosFail(reply,e)}});
app.post("/v1/projects",async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"workos.project.create","NONE",body,validateProjectCreate))return reply;
  const b=body as any;
  try{const project=getStore().createProject({tenantId:scope.tenantId,orgId,name:b.name,environmentId:b.environmentId,customerId:b.customerId,repository:b.repository,createdBy:actor,idempotencyKey:b.idempotencyKey});audit("WORKOS_PROJECT_CREATED",{actor,projectId:project.projectId});return reply.code(201).send({project})}catch(e){return workosFail(reply,e)}
});
app.get<{Querystring:{projectId?:string}}>("/v1/missions",async(req,reply)=>{
  const projectId=req.query?.projectId;if(projectId!==undefined&&!validProjectId(projectId))return reply.code(400).send({error:"INVALID_PROJECT_ID"});
  try{return {missions:getStore().listMissions(scope,projectId)}}catch(e){return workosFail(reply,e)}
});
app.post("/v1/missions",async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"workos.mission.create","NONE",body,validateMissionCreate))return reply;
  const b=body as any;
  try{const mission=getStore().createMission({tenantId:scope.tenantId,projectId:b.projectId,title:b.title,objective:b.objective,acceptanceCriteria:b.acceptanceCriteria,riskLevel:b.riskLevel,createdBy:actor,idempotencyKey:b.idempotencyKey});audit("WORKOS_MISSION_CREATED",{actor,missionId:mission.missionId,projectId:mission.projectId,riskLevel:mission.riskLevel,traceId:mission.traceId});return reply.code(201).send({mission})}catch(e){return workosFail(reply,e)}
});
app.get<{Params:{id:string}}>("/v1/missions/:id",async(req,reply)=>{
  if(!validMissionId(req.params.id))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  try{const m=getStore().getMission(scope,req.params.id);if(!m)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});return {mission:m,tasks:getStore().listTasks(scope,m.missionId)}}catch(e){return workosFail(reply,e)}
});
app.post<{Params:{id:string}}>("/v1/missions/:id/transition",async(req,reply)=>{
  if(!validMissionId(req.params.id))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  const body=req.body??{};if(!workosWrite(reply,"workos.mission.transition",req.params.id,body,validateMissionTransition))return reply;
  const b=body as any;if(!isMissionStatus(b.to))return reply.code(400).send({error:"INVALID_BODY",detail:"to is not a mission status"});
  try{const before=getStore().getMission(scope,req.params.id);const mission=getStore().transitionMission(scope,req.params.id,b.to,b.reason,actor);audit("WORKOS_MISSION_TRANSITIONED",{actor,missionId:mission.missionId,from:before?.status,to:mission.status});return {mission}}catch(e){return workosFail(reply,e)}
});
return app;
}

// //TR: Yalnızca doğrudan çalıştırıldığında (tsx apps/control-api/src/server.ts) dinler; import eden testler port açmaz.
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  const app=buildServer(),port=parseControlPort(process.env.CONTROL_API_PORT,3210);
  await app.listen({host:"127.0.0.1",port});
}

