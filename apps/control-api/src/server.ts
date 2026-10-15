// //TR: Bu dosya Desktop Control Tower ile Day-0 runtime arasında localhost-only authenticated control/read API sağlar; trust-sensitive runtime state yeniden doğrulanır ve run/log erişimi symlink/realpath kaçışına kapalıdır.
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import cp from "node:child_process";
import {inspectProcessLock,clearStaleProcessLock,acquireProcessLock} from "../../../automation/lib/process-lock.mjs";
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
import type {WorkOsStoreOptions} from "../../../core/workos/store.js";
import {WorkOsError} from "../../../core/workos/types.js";
import {EvidenceIndex,EvidenceInputError,EVIDENCE_KINDS} from "../../../core/evidence/index.js";
import type {EvidenceKind} from "../../../core/evidence/index.js";
import {validateProjectCreate,validateMissionCreate,validateMissionTransition,validateRunStart,validateProjectImport,validateProjectExport,validateEmptyBody,validateTornTailRepair,validateSourceDeliveryAccept} from "../../../core/workos/schemas.js";
import {isMissionStatus} from "../../../core/mission/state-machine.js";
import {authorizeAction} from "../../../core/action-gateway/policy.js";
import type {ActionPolicyContext} from "../../../core/action-gateway/types.js";
import {MissionRunner} from "../../../core/workos/runner.js";
import {M1A_LABELS,deliveryView,deriveOutcomes} from "../../../core/workos/outcomes.js";
import {RISK_REFUSAL,hostExecutionNotice,riskAdmitted} from "../../../core/workos/risk-admission.js";
import type {RunnerOptions} from "../../../core/workos/runner.js";
import {assertIndependentExecutors,executorsFromEnv,LocalClaudeExecutors} from "../../../core/workos/executors.js";
import type {ExecutorPair} from "../../../core/workos/executors.js";
import {ProjectStudio,StudioError} from "../../../core/workos/project-studio.js";
import {ensureClaudeProfiles} from "../../../core/workos/claude-profiles.js";
import {renderTemplate} from "../../../core/workos/project-templates.js";
import {DevRunManager} from "../../../core/workos/devrun.js";
import type {DevRunOptions} from "../../../core/workos/devrun.js";
import {ExecutorSetup} from "../../../core/workos/executor-setup.js";
import type {ExecutorSetupOptions} from "../../../core/workos/executor-setup.js";
import type {ZipLimits} from "../../../core/workos/zip.js";
import {ExecutionGate} from "../../../core/workos/execution-gate.js";
import type {SandboxProvider} from "../../../core/workos/execution-gate.js";
import {CrmDomain,validateAccountCreate,validateContactCreate,validateOpportunityCreate,validateOpportunityStage} from "../../../core/company/crm.js";
import {FinanceDomain,validateInvoiceCreate,validateInvoiceIssue,validateInvoiceVoid,validatePaymentCreate} from "../../../core/company/finance.js";
import {LegalDomain,validateContractCreate,validateContractTransition} from "../../../core/company/legal.js";
import type {Validation} from "../../../core/company/common.js";

// //TR: B1: buildServer testlerin ve CLI başlatmanın ortak girişidir; varsayılanlar eski sabit davranışla aynıdır (127.0.0.1 bind, token/Host kontrolü), opts yalnızca test enjeksiyonu içindir.
// //TR: B3a: executors yalnız programatik test enjeksiyonudur; gerçek adapter yalnız UASCO_WORKOS_EXECUTOR=local-claude ile seçilir. runner.enabled (veya UASCO_WORKOS_RUNNER=1) olmadan engine tick'i başlamaz.
// //TR: PS-1A: controlRoot provenance/ayar kontrol köküdür (paketli: userData, geliştirme: repo); studio/executorSetup yalnız test enjeksiyonudur (sahte provenance yakalayıcı, CLI keşfi, dev-run zamanlamaları, ZIP sınırları).
export interface BuildServerOptions{controlToken?:string;runtime?:string;port?:number;dataDir?:string;repoRoot?:string;tenantId?:string;orgId?:string;actor?:string;policyContext?:Partial<ActionPolicyContext>;logger?:boolean;executors?:ExecutorPair;runner?:{enabled?:boolean;intervalMs?:number}&Partial<Pick<RunnerOptions,"leaseTtlMs"|"maxRemediations"|"maxRetries"|"retryBackoffMs"|"testTimeoutMs"|"executorTimeoutMs"|"security">>;
  controlRoot?:string;studio?:{zipLimits?:Partial<ZipLimits>;devrun?:Partial<Pick<DevRunOptions,"startTimeOf"|"startWaitMs"|"graceMs"|"probeIntervalMs"|"stopPollMs"|"logRingBytes"|"logTailBytes"|"treeSnapshotMs">>};executorSetup?:Pick<ExecutorSetupOptions,"captureProvenance"|"findClaudeCli">;
  // //TR: SBX-GATE: sandbox yalnız programatik test enjeksiyonudur (testlerdeki sahte sağlayıcı); env/config/journal/API gövdesi/masaüstü ayarı sağlayıcı kaydedemez. Verilmezse proje kodu yürütmesi her zaman SANDBOX_UNAVAILABLE ile reddedilir.
  sandbox?:SandboxProvider;workosStoreOptions?:WorkOsStoreOptions}
export function buildServer(opts:BuildServerOptions={}){
const app=Fastify({logger:opts.logger??true,requestIdHeader:"x-request-id",genReqId:()=>crypto.randomUUID(),bodyLimit:64*1024});
const readJson=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const readJsonOr=<T>(p:string,fallback:T):T=>fs.existsSync(p)?readJson(p):fallback;
const repoRoot=opts.repoRoot?path.resolve(opts.repoRoot):process.cwd(),runtime=opts.runtime??".ai/runtime",runsRoot=path.join(runtime,"runs"),port=opts.port??parseControlPort(process.env.CONTROL_API_PORT,3210);
const controlToken=opts.controlToken??process.env.UASCO_CONTROL_TOKEN??"";
// //TR: Legacy 363 kayıt dondurulmuştur; yalnız /v1/agents ve cockpit sayımı için belgelenmiş projeksiyondur. Kanonik kayıt role-definitions.json'dır.
const LEGACY_AGENTS_FILE="registries/agents.json"; // LEGACY_REFERENCE_ONLY projection (FA-WFR-03): never used for routing/decisions
const ROLE_REGISTRY_FILE="registries/role-definitions.json";
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
// //TR: WFR-03: /v1/agents geriye uyumludur (legacy 363 kaydın alanları aynen döner) ve kanonik 599 RoleDefinition kaydının özetini ekler; legacy kayıt yalnız bu belgelenmiş LEGACY_REFERENCE_ONLY projeksiyonla okunur, karar için kullanılmaz.
app.get("/v1/agents",async(_req,reply)=>{
  const legacy=readJson(path.join(repoRoot,LEGACY_AGENTS_FILE));let s;try{s=roleRegistrySummary()}catch{return reply.code(503).send({error:"ROLE_REGISTRY_UNAVAILABLE"})}
  return {...legacy,registeredRoles:s.registeredRoles,legacyRoles:Array.isArray(legacy?.agents)?legacy.agents.length:null,certified:s.certified,activeWorkerRuns:activeWorkerRunsOrNull(),roleRegistry:{path:ROLE_REGISTRY_FILE,status:s.status,notice:s.notice,authority:"CANONICAL",legacyAuthority:"LEGACY_REFERENCE_ONLY"}};
});
app.get("/v1/capabilities",async()=>readJson("registries/capabilities.json"));
app.get("/v1/fabrics",async()=>readJson("registries/execution-fabrics.json"));
app.get("/v1/adapters",async()=>readJson("registries/tool-adapters.json"));
app.get("/v1/domains",async()=>readJson("registries/domain-packs.json"));
// //TR: REL-FX-4: durum route'u Work OS journal sağlığını da gösterir (OK/ABSENT/TORN_TAIL/TAMPERED/UNAVAILABLE; yalnız göreli karantina yolu).
function workosHealth(){try{return getStore().journalHealth()}catch{return {state:"UNAVAILABLE",reason:"HEALTH_UNREADABLE",tornTail:null}}}
app.get("/v1/control/status",async()=>{try{const f=path.join(runtime,"GLOBAL_STOP.json");if(fs.existsSync(f))resolveExistingPathUnder(runtime,"GLOBAL_STOP.json");return {globalStop:globalStopState(f)??{active:false},workos:workosHealth()}}catch{return {globalStop:{active:true,reason:"GLOBAL_STOP_STATE_UNSAFE"},verification:"REJECTED",workos:workosHealth()}}});
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

app.post("/v1/control/stop",async(req)=>{const body=(req.body??{}) as {reason?:string};const reason=String(body.reason??"Founder requested stop").slice(0,1000);activateGlobalStop(path.join(runtime,"GLOBAL_STOP.json"),reason,"FOUNDER_CONTROL_TOWER");const doc=globalStopState(path.join(runtime,"GLOBAL_STOP.json"));audit("GLOBAL_STOP_ACTIVATED",{reason});
  // PS-1A: GLOBAL_STOP çalışan bütün dev-run'ları hemen durdurur (bant dışı stop dosyası ayrıca yönetici tarafından izlenir).
  let devRunsStopped:string[]=[];try{devRunsStopped=await (await getDevRuns()).stopAll("GLOBAL_STOP_ACTIVE")}catch{/* dev-run yöneticisi kullanılamıyor */}
  return {ok:true,globalStop:doc,devRunsStopped:devRunsStopped.length}});
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
// //TR: REL-FX-4: workosStoreOptions yalnız test enjeksiyonudur (fs seam ile ENOSPC).
const getStore=()=>workosStore??=new WorkOsStore(opts.dataDir??defaultDataDir(repoRoot),opts.workosStoreOptions);
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
  // PS-1A: Project Studio hataları sabit kod + HTTP durumu taşır (yol/stack yok); export secret bulguları yalnız dosya/satır/tür içerir.
  if(e instanceof StudioError){const d=e.details&&typeof e.details==="object"?e.details as Record<string,unknown>:{};return reply.code(e.status).send({error:e.code,...(e.reason?{reason:e.reason}:{}),...d})}
  if(e instanceof WorkOsError){
    if(e.code==="WORKOS_IDEMPOTENCY_CONFLICT")return reply.code(409).send({error:"IDEMPOTENCY_CONFLICT"});
    // B3a: çakışma/fencing 409; reason yalnız sabit kod parçasıdır (MISSION_NOT_RUNNABLE, RUN_ALREADY_ACTIVE), yol veya secret taşımaz.
    if(e.code==="WORKOS_CONFLICT"||e.code==="WORKOS_LEASE_FENCED")return reply.code(409).send({error:e.code,reason:e.code==="WORKOS_CONFLICT"?e.message.replace(/^WORKOS_CONFLICT: ?/,"").slice(0,64):undefined});
    // REL-FX-4: yırtık kuyrukta store salt-okunurdur (503 + sabit sebep); disk dolu 507 (yazı yapılmadı, yarım satır yok).
    if(e.code==="WORKOS_READ_ONLY")return reply.code(503).send({error:e.code,reason:"JOURNAL_TORN_TAIL"});
    if(e.code==="WORKOS_DISK_FULL")return reply.code(507).send({error:e.code});
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
  // PS1A-C1-F1: istemcinin verdiği repository.path veri dizininin içinde/üstünde olamaz (başka tenant'ın yönetilen deposu, journal, run dizinleri); 400 REPOSITORY_PATH_FORBIDDEN.
  if(b.repository&&typeof b.repository==="object"&&b.repository.path!==undefined)getStudio().assertRepositoryPathAllowed(b.repository.path);
  // PS-1A: template verilirse yönetilen depo journal kilidi altında kurulur; şablonun test/dev komutu ve proje tipi yalnız istemci vermediyse varsayılan olur.
  const tpl=b.template?renderTemplate(b.template,b.name):null;
  const r=getStore().createProjectDetailed({tenantId:scope.tenantId,orgId,name:b.name,environmentId:b.environmentId,customerId:b.customerId,repository:b.repository,createdBy:actor,idempotencyKey:b.idempotencyKey,testCommand:b.testCommand??tpl?.testCommand,
    template:b.template,projectType:b.projectType??tpl?.projectType,techStack:b.techStack,targetOS:b.targetOS,acceptanceCriteria:b.acceptanceCriteria,budget:b.budget,devCommand:b.devCommand??tpl?.devCommand,
    prepareManagedRepository:b.template?(projectId:string)=>{const x=getStudio().createTemplateRepository(projectId,b.template,b.name);return {path:x.path,discard:x.discard}}:undefined});
  audit(r.replayed?"WORKOS_IDEMPOTENT_REPLAY":"WORKOS_PROJECT_CREATED",{actor,kind:"project",projectId:r.entity.projectId,...(b.template?{template:b.template}:{})});return reply.code(r.replayed?200:201).send({project:r.entity});
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
  // //TR: REL-FX-1: COMPLETE istemcinin "to" alanıyla değil, kanıt kapısıyla olur: run.headSha için REPORT + CLEAN REVIEW + BLOCKED olmayan SECURITY_REPORT; aynı journal yazısı run'ı SUCCEEDED yapar, aksi halde 409 + sabit sebep.
  // //TR: D-M1A-STATE-MODEL-2026-10-15: ürün düzeyi COMPLETE ayrıca PRODUCT_VERIFIED ister (M1a'da erişilemez, 409 COMPLETION_PRODUCT_NOT_VERIFIED); gövde hiçbir onay alanı taşıyamaz (şema 400).
  // NOT_VERIFIED kaynak teslimi kabulü ayrı rotadadır (POST /v1/work-runs/:id/delivery/accept) ve mission'ı COMPLETE yapmaz.
  if(b.to==="COMPLETE"){try{const r=getStore().completeMission(scope,req.params.id,b.reason,actor);const outcomes=deriveOutcomes(r.run);audit("WORKOS_MISSION_COMPLETED",{actor,missionId:r.mission.missionId,runId:r.run.runId,headSha:r.run.headSha,completionMode:outcomes.completionMode});return {mission:r.mission,run:r.run,outcomes}}catch(e){if(e instanceof WorkOsError&&e.code==="WORKOS_CONFLICT")audit("WORKOS_MISSION_COMPLETE_REFUSED",{actor,missionId:req.params.id,reason:e.message.replace(/^WORKOS_CONFLICT: ?/,"").slice(0,64)});return workosFail(reply,e)}}
  try{const before=getStore().getMission(scope,req.params.id);const mission=getStore().transitionMission(scope,req.params.id,b.to,b.reason,actor);audit("WORKOS_MISSION_TRANSITIONED",{actor,missionId:mission.missionId,from:before?.status,to:mission.status});return {mission}}catch(e){return workosFail(reply,e)}
}));

// //TR: B3a mission runner route'ları: aynı token hook'u ve aynı yazma kapısı sırası (GLOBAL_STOP 423 -> action-gateway 403 -> şema 400). Run'lar aynı Work OS journal'ındadır; eski /v1/runs route'larına dokunulmaz.
const validWorkRunId=(x:unknown)=>typeof x==="string"&&/^run_[0-9a-f]{24}$/.test(x);
let executorsCache:{pair:ExecutorPair|null;reason:string}|null=null;
// //TR: PS-1A: açık env seçimi önceliklidir; yoksa veri dizinindeki kalıcı LOCAL_CLAUDE ayarı (yalnız geçerli provenance ile) kullanılır.
function selectExecutors():{pair:ExecutorPair|null;reason:string}{
  const env=executorsFromEnv(repoRoot,process.env,controlRoot,{profile:{forbiddenRoots:[getStore().dataDir]}});if(env.pair||env.reason!=="EXECUTOR_NOT_CONFIGURED")return env;
  const setup=getExecSetup();if(!setup.settingEnabled())return env;
  if(!setup.provenance().ok)return {pair:null,reason:"PROVENANCE_MISSING"};
  // INT-R3 D-M1-03: config/script'ler uygulama kökünden (repoRoot), provenance kontrol kökünden (paketli: userData) okunur.
  try{return {pair:new LocalClaudeExecutors(repoRoot,controlRoot,{profile:{forbiddenRoots:[getStore().dataDir]}}).pair(),reason:"LOCAL_CLAUDE"}}catch{return {pair:null,reason:"EXECUTOR_CONFIG_INVALID"}}
}
const getExecutors=()=>executorsCache??=opts.executors?{pair:opts.executors,reason:opts.executors.kind}:selectExecutors();
let workRunner:MissionRunner|null=null;
// //TR: SBX-GATE (FD-REL-1-REJECT-HOST-EXEC-2026-10-15): runner testleri ve Studio dev-run için tek karar noktası; sağlayıcı yalnız opts.sandbox (test) ile gelir.
const executionGate=new ExecutionGate(opts.sandbox??null);
function getRunner(){
  if(workRunner)return workRunner;
  const ex=getExecutors();if(!ex.pair)return null;
  const r=opts.runner??{};
  workRunner=new MissionRunner({store:getStore(),dataDir:getStore().dataDir,globalStopFile:path.join(runtime,"GLOBAL_STOP.json"),envPolicyFile:path.join(repoRoot,"config","environment-policy.json"),executors:ex.pair,executionGate,
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
  // //TR: REL-FX-3 (D-REL-2): R3/R4 mission'ı için run başlatılmaz (409); düzey yalnız mission kaydından okunur, gövde veya hedef metni onu değiştiremez.
  const target=getStore().getMission(scope,req.params.id);
  if(target&&!riskAdmitted(target.riskLevel)){audit("WORKOS_RUN_REFUSED",{actor,missionId:req.params.id,reason:RISK_REFUSAL,riskLevel:target.riskLevel});return reply.code(409).send({error:RISK_REFUSAL,riskLevel:target.riskLevel})}
  const ex=getExecutors();if(!ex.pair)return reply.code(409).send({error:"EXECUTOR_NOT_CONFIGURED",reason:ex.reason});
  try{assertIndependentExecutors(ex.pair)}catch{audit("WORKOS_RUN_REFUSED",{actor,missionId:req.params.id,reason:"EXECUTOR_CONFIG_REFUSED"});return reply.code(409).send({error:"EXECUTOR_CONFIG_REFUSED"})}
  const b=body as any;
  const r=getStore().createRunDetailed({tenantId:scope.tenantId,missionId:req.params.id,roleId:b.roleId??null,executor:{implementer:ex.pair.implementer.identity,reviewer:ex.pair.reviewer.identity},createdBy:actor,idempotencyKey:b.idempotencyKey});
  audit(r.replayed?"WORKOS_IDEMPOTENT_REPLAY":"WORKOS_RUN_CREATED",{actor,kind:"run",runId:r.entity.runId,missionId:r.entity.missionId,executor:r.entity.executor});
  // V7-PKG-M1A-MODE (RV-INTR4-C1-OBS-1): yanıt, yürütmenin yalnız sandbox içinde olduğunu (ana makinede asla) ve sandbox yoksa test/önizlemenin NOT_EXECUTED olduğunu bildirir.
  return reply.code(r.replayed?200:201).send({run:r.entity,hostExecutionNotice:hostExecutionNotice((target??getStore().getMission(scope,r.entity.missionId))!.riskLevel)});
}));
app.get<{Querystring:{missionId?:string}}>("/v1/work-runs",wos(async(req,reply)=>{
  const missionId=req.query?.missionId;if(missionId!==undefined&&!validMissionId(missionId))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  return {runs:getStore().listRuns(scope,missionId)};
}));
app.get<{Params:{id:string}}>("/v1/work-runs/:id",wos(async(req,reply)=>{
  if(!validWorkRunId(req.params.id))return reply.code(400).send({error:"INVALID_RUN_ID"});
  // M1a c2: delivery salt-okunur görünümdür (iki eksen + teslim artefaktı/kabul kaydı; masaüstü teslim akışı için); kapı kararları store'dadır.
  const run=getStore().getRun(scope,req.params.id);if(!run)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});return {run,outcomes:deriveOutcomes(run),delivery:deliveryView(run)};
}));
// //TR: M1a c2 (D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15) koşu teslim rotaları: liste/ayrıntı salt-okunurdur; hazırla, kabul et ve dışa aktar yazma kapısından (GLOBAL_STOP 423 -> policy 403 -> şema 400)
// geçer. Teslim artefaktı yalnız SOURCE_GENERATION_COMPLETE run'ın run.headSha ağacından deterministik üretilir; kabul tek kullanımlıktır ve COMPLETE/PRODUCT_VERIFIED üretmez; dışa aktarma
// ve kabul öncesinde artefakt dosyasının sha256'sı kayda karşı yeniden doğrulanır (uyuşmazlık 409, bayt verilmez).
const deliveryOut=(run:any)=>{const d=deliveryView(run);return {...d,fileState:d.artifact?getStudio().deliveryFileState(d.artifact):null}};
app.get<{Querystring:{projectId?:string}}>("/v1/deliveries",wos(async(req,reply)=>{
  const projectId=req.query?.projectId;if(projectId!==undefined&&!validProjectId(projectId))return reply.code(400).send({error:"INVALID_PROJECT_ID"});
  return {deliveries:getStore().listRuns(scope).filter(r=>projectId===undefined||r.projectId===projectId).map(deliveryOut)};
}));
app.get<{Params:{id:string}}>("/v1/work-runs/:id/delivery",wos(async(req,reply)=>{
  if(!validWorkRunId(req.params.id))return reply.code(400).send({error:"INVALID_RUN_ID"});
  const run=getStore().getRun(scope,req.params.id);if(!run)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});return {delivery:deliveryOut(run)};
}));
app.post<{Params:{id:string}}>("/v1/work-runs/:id/delivery/prepare",wos(async(req,reply)=>{
  if(!validWorkRunId(req.params.id))return reply.code(400).send({error:"INVALID_RUN_ID"});
  const body=req.body??{};if(!workosWrite(reply,"workos.delivery.prepare",req.params.id,body,validateEmptyBody))return reply;
  const run=getStore().getRun(scope,req.params.id);if(!run)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});
  const p=getStore().getProject(scope,run.projectId);if(!p)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});
  let rec;try{rec=getStudio().prepareRunDelivery(p,run)}catch(e){if(e instanceof StudioError)audit("WORKOS_DELIVERY_PREPARE_REFUSED",{actor,runId:run.runId,reason:e.code});throw e}
  const r=getStore().recordDeliveryArtifact(scope,run.runId,rec,actor);
  audit("WORKOS_DELIVERY_ARTIFACT_PREPARED",{actor,runId:r.record.runId,missionId:r.record.missionId,sourceCommit:r.record.sourceCommit,treeSha:r.record.treeSha,exportArtifactHash:r.record.exportArtifactHash,recorded:r.recorded});
  return reply.code(r.recorded?201:200).send({artifact:r.record,recorded:r.recorded,delivery:deliveryOut(r.run)});
}));
app.post<{Params:{id:string}}>("/v1/work-runs/:id/delivery/accept",wos(async(req,reply)=>{
  if(!validWorkRunId(req.params.id))return reply.code(400).send({error:"INVALID_RUN_ID"});
  const body=req.body??{};if(!workosWrite(reply,"workos.delivery.accept",req.params.id,body,validateSourceDeliveryAccept))return reply;
  const run=getStore().getRun(scope,req.params.id);if(!run)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});
  // Kabul edilen artefakt bozulmamış olmalıdır: dosya kayıttaki hash ile birebir eşleşmiyorsa kabul yazılmaz.
  if(run.deliveryArtifact){const fsState=getStudio().deliveryFileState(run.deliveryArtifact);if(fsState!=="VERIFIED"){audit("WORKOS_SOURCE_DELIVERY_REFUSED",{actor,runId:run.runId,reason:`DELIVERY_ARTIFACT_${fsState}`});return reply.code(409).send({error:fsState==="MODIFIED"?"DELIVERY_ARTIFACT_HASH_MISMATCH":"DELIVERY_ARTIFACT_MISSING"})}}
  try{const r=getStore().acceptSourceDelivery(scope,run.runId,(body as any).acceptance,actor);const outcomes=deriveOutcomes(r.run);
    audit("WORKOS_SOURCE_DELIVERY_ACCEPTED",{actor,runId:r.run.runId,missionId:r.run.missionId,sourceCommit:r.run.sourceDelivery?.sourceCommit,exportArtifactHash:r.run.sourceDelivery?.exportArtifactHash,productVerification:outcomes.productVerification.state});
    return {delivery:deliveryOut(r.run),mission:r.mission,outcomes,label:M1A_LABELS.SOURCE_DELIVERY_ACCEPTED}}
  catch(e){if(e instanceof WorkOsError&&e.code==="WORKOS_CONFLICT")audit("WORKOS_SOURCE_DELIVERY_REFUSED",{actor,runId:run.runId,reason:e.message.replace(/^WORKOS_CONFLICT: ?/,"").slice(0,64)});throw e}
}));
app.post<{Params:{id:string}}>("/v1/work-runs/:id/delivery/export",wos(async(req,reply)=>{
  if(!validWorkRunId(req.params.id))return reply.code(400).send({error:"INVALID_RUN_ID"});
  const body=req.body??{};if(!workosWrite(reply,"workos.delivery.export",req.params.id,body,validateEmptyBody))return reply;
  const run=getStore().getRun(scope,req.params.id);if(!run)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});
  if(!run.deliveryArtifact)return reply.code(409).send({error:"DELIVERY_ARTIFACT_NOT_PREPARED"});
  const st=getStudio(),rec=run.deliveryArtifact,bytes=st.readVerifiedDelivery(rec);
  audit("WORKOS_DELIVERY_EXPORT_VERIFIED",{actor,runId:rec.runId,exportArtifactHash:rec.exportArtifactHash,size:bytes.length});
  // Yol yalnız ana sürecin kendi doğrulamasıyla (veri dizinindeki deliveries klasörü + yeniden sha256) kullanılır.
  return {artifact:rec,sha256:rec.exportArtifactHash,size:bytes.length,fileState:"VERIFIED",path:st.deliveryFile(rec),accepted:run.sourceDelivery??null,delivery:deliveryOut(run)};
}));

// //TR: PS-1A Project Studio route'ları: aynı token/Host hook'u; her proje route'u Work OS kaydını scope (tenant) ile çözer, başka tenant'ın projesi 404'tür. Yazma route'ları aynı kapı sırasını izler (GLOBAL_STOP 423 -> action-gateway 403 -> şema 400).
const controlRoot=path.resolve(opts.controlRoot??process.env.UASCO_CONTROL_ROOT??repoRoot);
const envPolicyFile=path.join(repoRoot,"config","environment-policy.json");
let studio:ProjectStudio|null=null;
const getStudio=()=>studio??=new ProjectStudio({dataDir:getStore().dataDir,envPolicyFile,zipLimits:opts.studio?.zipLimits});
let execSetup:ExecutorSetup|null=null;
function getExecSetup(){return execSetup??=new ExecutorSetup({repoRoot,controlRoot,dataDir:getStore().dataDir,envPolicyFile,...(opts.executorSetup??{})})}
let devRunsP:Promise<DevRunManager>|null=null;
function getDevRuns(){return devRunsP??=(async()=>{const m=new DevRunManager({studio:getStudio(),envPolicyFile,executionGate,globalStopFile:path.join(runtime,"GLOBAL_STOP.json"),audit:(ev,d)=>{try{audit(ev,d)}catch{/* audit dizini yok */}},...(opts.studio?.devrun??{})});await m.recover();return m})()}
app.addHook("onReady",async()=>{try{await getDevRuns()}catch{/* yönetici ilk kullanımda yeniden denenmez; route'lar 500 döner */}});
app.addHook("onClose",async()=>{if(devRunsP){try{await (await devRunsP).close()}catch{/* kapanış */}}});
const validExportId=(x:unknown)=>typeof x==="string"&&/^exp_[0-9a-f]{24}$/.test(x);
const flag=(x:unknown)=>x==="1"||x==="true";
function projectFor(id:string,reply:any){const p=getStore().getProject(scope,id);if(!p){reply.code(404).send({error:"WORKOS_NOT_FOUND"});return null}return p}
const projectRuns=(projectId:string)=>getStore().listRuns(scope).filter(r=>r.projectId===projectId);
const badId=(id:unknown,reply:any)=>{if(validProjectId(id))return false;reply.code(400).send({error:"INVALID_PROJECT_ID"});return true};

app.post<{Params:{id:string}}>("/v1/projects/:id/import",wos(async(req,reply)=>{
  if(badId(req.params.id,reply))return reply;
  const body=req.body??{};if(!workosWrite(reply,"workos.project.import",req.params.id,body,validateProjectImport))return reply;
  const p=projectFor(req.params.id,reply);if(!p)return reply;
  const b=body as {kind:"git"|"zip";path:string};
  if(p.repository?.managed)return reply.code(409).send({error:"PROJECT_REPOSITORY_ALREADY_MANAGED"});
  if(getStore().hasOpenProjectRun(scope,p.projectId))return reply.code(409).send({error:"WORKOS_CONFLICT",reason:"RUN_ALREADY_ACTIVE"});
  if((await getDevRuns()).isActive(p.projectId))return reply.code(409).send({error:"DEVRUN_ACTIVE"});
  const st=getStudio(),dir=st.projectDir(p.projectId);fs.mkdirSync(dir,{recursive:true});
  let release:(()=>void)|null=null;try{release=acquireProcessLock(path.join(dir,"import.lock"),`import-${crypto.randomBytes(4).toString("hex")}`)}catch{return reply.code(409).send({error:"IMPORT_IN_PROGRESS"})}
  const staging=st.stagingDir(p.projectId),final=st.managedRepoPath(p.projectId);
  try{
    const imported=b.kind==="git"?st.importGitInto(staging,b.path):st.importZipInto(staging,b.path),headSha=imported.headSha,quarantined=imported.agentConfigQuarantine;
    fs.rmSync(final,{recursive:true,force:true});fs.renameSync(staging,final);
    // //TR: SBX-8: karantinaya alınan ajan yapılandırma dosyalarının kanıtı (yol, desen, boyut, sha256) proje dizinindeki manifest'e ve audit'e yazılır; yanıt yalnız karantina varsa alanı taşır.
    const qEvidence=quarantined.length?{count:quarantined.length,headSha,files:quarantined.slice(0,500),truncated:quarantined.length>500,storedUnder:"projects/<projectId>/quarantine/agent-config/<sha256>"}:null;
    if(qEvidence){fs.writeFileSync(path.join(dir,"agent-config-quarantine.json"),JSON.stringify({"//TR":"SBX-8 içe aktarma karantina kanıtı; dosyalar yönetilen depoya girmedi.",importedAt:new Date().toISOString(),kind:b.kind,...qEvidence},null,2)+"\n");audit("WORKOS_PROJECT_IMPORT_AGENT_CONFIG_QUARANTINED",{actor,projectId:p.projectId,kind:b.kind,headSha,count:quarantined.length,paths:quarantined.slice(0,100).map(q=>q.path)})}
    try{const project=getStore().setProjectRepository(scope,p.projectId,{path:final,managed:true},actor,{kind:b.kind,headSha});audit("WORKOS_PROJECT_IMPORTED",{actor,projectId:p.projectId,kind:b.kind,headSha});return reply.code(200).send({project,import:{kind:b.kind,headSha,...(qEvidence?{agentConfigQuarantine:qEvidence}:{})}})}
    catch(e){fs.rmSync(final,{recursive:true,force:true});throw e}
  }catch(e){if(e instanceof StudioError)audit("WORKOS_PROJECT_IMPORT_REJECTED",{actor,projectId:p.projectId,kind:b.kind,error:e.code,reason:e.reason??null});throw e}
  finally{try{fs.rmSync(staging,{recursive:true,force:true})}catch{/* staging */}try{release?.()}catch{/* kilit */}}
}));

app.get<{Params:{id:string}}>("/v1/projects/:id/devrun",wos(async(req,reply)=>{if(badId(req.params.id,reply))return reply;const p=projectFor(req.params.id,reply);if(!p)return reply;return {devrun:(await getDevRuns()).view(p)}}));
for(const action of ["start","stop","restart"] as const){
  app.post<{Params:{id:string}}>(`/v1/projects/:id/devrun/${action}`,wos(async(req,reply)=>{
    if(badId(req.params.id,reply))return reply;
    const body=req.body??{};if(!workosWrite(reply,`workos.project.devrun.${action}`,req.params.id,body,validateEmptyBody))return reply;
    const p=projectFor(req.params.id,reply);if(!p)return reply;
    const m=await getDevRuns();
    // PS1A-C2-F1: dev-run route'ları yalnız yönetilen depo üzerinde (409 REPOSITORY_NOT_MANAGED); çalışan bir dev-run'ı durdurmak süreç güvenliği için her zaman serbesttir.
    if(action==="stop"&&!m.isActive(p.projectId))getStudio().managedRepoRoot(p);
    if(action==="start")await m.start(p);else if(action==="restart")await m.restart(p);else await m.stop(p.projectId);
    audit(`WORKOS_DEVRUN_${action.toUpperCase()}`,{actor,projectId:p.projectId});
    return {devrun:m.view(p)};
  }));
}

app.get<{Params:{id:string};Querystring:{path?:string;all?:string}}>("/v1/projects/:id/files",wos(async(req,reply)=>{
  if(badId(req.params.id,reply))return reply;const p=projectFor(req.params.id,reply);if(!p)return reply;
  if(req.query?.path!==undefined&&typeof req.query.path!=="string")return reply.code(400).send({error:"PATH_REJECTED"});
  return getStudio().listFiles(p,req.query?.path,flag(req.query?.all));
}));
app.get<{Params:{id:string};Querystring:{path?:string;all?:string}}>("/v1/projects/:id/file",wos(async(req,reply)=>{
  if(badId(req.params.id,reply))return reply;const p=projectFor(req.params.id,reply);if(!p)return reply;
  if(typeof req.query?.path!=="string"||!req.query.path)return reply.code(400).send({error:"PATH_REJECTED"});
  return getStudio().readFile(p,req.query.path,flag(req.query?.all));
}));
app.get<{Params:{id:string};Querystring:{limit?:string;runId?:string}}>("/v1/projects/:id/git/log",wos(async(req,reply)=>{
  if(badId(req.params.id,reply))return reply;const p=projectFor(req.params.id,reply);if(!p)return reply;
  const limit=req.query?.limit===undefined?50:Number(req.query.limit);if(!Number.isInteger(limit)||limit<1||limit>200)return reply.code(400).send({error:"INVALID_LIMIT"});
  const runId=req.query?.runId;if(runId!==undefined&&!validWorkRunId(runId))return reply.code(400).send({error:"INVALID_RUN_ID"});
  return getStudio().gitLog(p,projectRuns(p.projectId),limit,runId);
}));
app.get<{Params:{id:string};Querystring:{from?:string;to?:string}}>("/v1/projects/:id/git/diff",wos(async(req,reply)=>{
  if(badId(req.params.id,reply))return reply;const p=projectFor(req.params.id,reply);if(!p)return reply;
  const ref=/^(HEAD|[0-9a-f]{7,40})$/,from=req.query?.from,to=req.query?.to??"HEAD";
  if(typeof from!=="string"||!ref.test(from)||typeof to!=="string"||!ref.test(to))return reply.code(400).send({error:"INVALID_REF"});
  return getStudio().gitDiff(p,projectRuns(p.projectId),from,to);
}));

app.post<{Params:{id:string}}>("/v1/projects/:id/export",wos(async(req,reply)=>{
  if(badId(req.params.id,reply))return reply;
  const body=req.body??{};if(!workosWrite(reply,"workos.project.export",req.params.id,body,validateProjectExport))return reply;
  const p=projectFor(req.params.id,reply);if(!p)return reply;
  const st=getStudio();let ex;
  try{ex=st.exportProject(p,projectRuns(p.projectId),(body as {commit?:string}).commit,actor)}
  catch(e){if(e instanceof StudioError&&e.code==="EXPORT_BLOCKED_SECRET")audit("WORKOS_EXPORT_BLOCKED_SECRET",{actor,projectId:p.projectId,findings:Array.isArray((e.details as any)?.findings)?(e.details as any).findings.length:0});throw e}
  try{const recorded=getStore().recordProjectExport(scope,ex,actor);audit("WORKOS_EXPORT_CREATED",{actor,projectId:p.projectId,exportId:recorded.exportId,commit:recorded.commit,sha256:recorded.sha256,size:recorded.size});return reply.code(201).send({export:recorded})}
  catch(e){try{fs.rmSync(path.join(st.exportsDir(),`${ex.exportId}.zip`),{force:true})}catch{/* export dosyası */}throw e}
}));
app.get<{Params:{id:string}}>("/v1/projects/:id/exports",wos(async(req,reply)=>{if(badId(req.params.id,reply))return reply;const p=projectFor(req.params.id,reply);if(!p)return reply;return {exports:getStore().listProjectExports(scope,p.projectId)}}));
app.get<{Params:{id:string;exportId:string}}>("/v1/projects/:id/exports/:exportId",wos(async(req,reply)=>{
  if(badId(req.params.id,reply))return reply;if(!validExportId(req.params.exportId))return reply.code(400).send({error:"INVALID_EXPORT_ID"});
  const p=projectFor(req.params.id,reply);if(!p)return reply;
  const ex=getStore().getProjectExport(scope,p.projectId,req.params.exportId);if(!ex)return reply.code(404).send({error:"WORKOS_NOT_FOUND"});
  return {export:ex,fileState:getStudio().exportFileState(ex)};
}));

// //TR: Executor kurulumu: durum okunur; etkinleştirme aynı yazma kapısından geçer, model çağrılmaz (provenance yakalama yalnız --version).
// //TR: SBX-8 (D-SBX-11 b): implementer/reviewer UASCO Claude profillerinin durumu (READY/LOGIN_REQUIRED/REFUSED) ve Founder'ın kendisinin çalıştıracağı giriş komutu; UASCO yalnız kendi settings.json dosyasını yazar, kimlik bilgisi okumaz/kopyalamaz.
const claudeProfiles=()=>{try{return ensureClaudeProfiles(controlRoot,{forbiddenRoots:[getStore().dataDir]})}catch{return {error:"CLAUDE_PROFILE_STATUS_UNAVAILABLE"}}};
app.get("/v1/system/executors",wos(async()=>({executors:getExecSetup().status(),active:{reason:getExecutors().reason},sandbox:await executionGate.status(),claudeProfiles:claudeProfiles()})));
app.post("/v1/system/executors/local-claude/enable",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"workos.system.executor.enable","NONE",body,validateEmptyBody))return reply;
  const r=await getExecSetup().enableLocalClaude(actor);
  if(!r.ok){audit("WORKOS_EXECUTOR_ENABLE_REFUSED",{actor,executor:"LOCAL_CLAUDE",reason:r.reason});return reply.code(409).send({error:"EXECUTOR_ENABLE_REFUSED",reason:r.reason,executors:r.status})}
  executorsCache=null;
  if(runnerEnabled&&!workRunner){try{const rn=getRunner();if(rn){rn.start(opts.runner?.intervalMs??2000);audit("WORKOS_RUNNER_STARTED",{engineId:rn.engineId,executor:getExecutors().reason})}}catch{audit("WORKOS_RUNNER_NOT_STARTED",{reason:"EXECUTOR_CONFIG_REFUSED"})}}
  audit("WORKOS_EXECUTOR_ENABLED",{actor,executor:"LOCAL_CLAUDE",source:"SETTING"});
  return {executors:r.status,active:{reason:getExecutors().reason}};
}));

// //TR: B10A Evidence Center: salt-okunur doğrulanmış read-model; hash her istekte baytlardan yeniden hesaplanır, depolanan PASS metnine güvenilmez, hiçbir şey yazılmaz. Work OS kanıtı server tenant'ına göre süzülür; depo düzeyi kanıt yalnız tek FOUNDER_LOCAL principal'ına görünür; yanıtlarda mutlak yol yoktur, log kuyruğu en çok 4 KB ve redakte edilir.
const evidenceIndex=()=>new EvidenceIndex({repoRoot,dataDir:path.resolve(opts.dataDir??defaultDataDir(repoRoot)),scope,store:getStore,includeRepositoryEvidence:actor==="FOUNDER_LOCAL"});
const validEvidenceId=(x:unknown)=>typeof x==="string"&&/^evi_[0-9a-f]{32}$/.test(x);
app.get<{Querystring:{kind?:unknown;missionId?:unknown;runId?:unknown;cursor?:unknown;limit?:unknown}}>("/v1/evidence",wos(async(req,reply)=>{
  const q=req.query??{},one=(x:unknown)=>x===undefined?undefined:typeof x==="string"?x:null;
  const kind=one(q.kind),missionId=one(q.missionId),runId=one(q.runId),cursor=one(q.cursor),limitRaw=one(q.limit);
  if(kind===null||(kind!==undefined&&!(EVIDENCE_KINDS as readonly string[]).includes(kind)))return reply.code(400).send({error:"INVALID_KIND"});
  if(missionId===null||(missionId!==undefined&&!validMissionId(missionId)))return reply.code(400).send({error:"INVALID_MISSION_ID"});
  if(runId===null||(runId!==undefined&&!validWorkRunId(runId)))return reply.code(400).send({error:"INVALID_RUN_ID"});
  if(cursor===null||(cursor!==undefined&&!/^[A-Za-z0-9_-]{1,1500}$/.test(cursor)))return reply.code(400).send({error:"INVALID_CURSOR"});
  if(limitRaw===null||(limitRaw!==undefined&&!/^[0-9]{1,3}$/.test(limitRaw)))return reply.code(400).send({error:"INVALID_LIMIT"});
  const limit=limitRaw===undefined?undefined:Number(limitRaw);if(limit!==undefined&&(limit<1||limit>100))return reply.code(400).send({error:"INVALID_LIMIT"});
  try{
    const page=await evidenceIndex().list({kind:kind as EvidenceKind|undefined,missionId,runId,cursor,limit});
    return {evidence:page.items,nextCursor:page.nextCursor,sources:page.sources};
  }catch(e){if(e instanceof EvidenceInputError)return reply.code(400).send({error:e.code});throw e}
}));
app.get<{Params:{evidenceId:string}}>("/v1/evidence/:evidenceId",wos(async(req,reply)=>{
  if(!validEvidenceId(req.params.evidenceId))return reply.code(400).send({error:"INVALID_EVIDENCE_ID"});
  const d=await evidenceIndex().get(req.params.evidenceId);if(!d)return reply.code(404).send({error:"EVIDENCE_NOT_FOUND"});
  return {evidence:d.item,summary:d.summary,tail:d.tail,tailWithheld:d.tailWithheld};
}));

// //TR: B11A Company OS route'ları (CRM, Finans, Hukuk): aynı token hook'u ve aynı yazma kapısı sırası (GLOBAL_STOP 423 -> action-gateway 403 -> şema 400). Kayıtlar ortak Work OS journal'ındadır (ikinci store yok), tenant kapsamlıdır; audit yalnız kimlik/durum/tutar taşır, ad ve e-posta (PII) asla yazılmaz.
const companyIdOk=(prefix:string,x:unknown)=>typeof x==="string"&&new RegExp(`^${prefix}_[0-9a-f]{24}$`).test(x);
const companyBody=(prefix:string,id:unknown,validate:(x:unknown)=>Validation)=>(x:unknown):Validation=>companyIdOk(prefix,id)?validate(x):{ok:false,errors:"invalid id"};
const companyFilter=(reply:any,value:unknown,prefix:string):{ok:true;id?:string}|{ok:false}=>{if(value===undefined)return {ok:true};if(!companyIdOk(prefix,value)){reply.code(400).send({error:"INVALID_FILTER"});return {ok:false}}return {ok:true,id:value as string}};
const crmDomain=()=>new CrmDomain(getStore()),financeDomain=()=>new FinanceDomain(getStore()),legalDomain=()=>new LegalDomain(getStore());
const created=(reply:any,replayed:boolean,body:unknown)=>reply.code(replayed?200:201).send(body);
app.get("/v1/company/accounts",wos(async()=>({accounts:crmDomain().listAccounts(scope)})));
app.post("/v1/company/accounts",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.account.create","NONE",body,validateAccountCreate))return reply;
  const b=body as any,r=crmDomain().createAccount(scope,{name:b.name,idempotencyKey:b.idempotencyKey},actor);
  audit(r.replayed?"COMPANY_IDEMPOTENT_REPLAY":"COMPANY_ACCOUNT_CREATED",{actor,kind:"account",accountId:r.entity.accountId});return created(reply,r.replayed,{account:r.entity});
}));
app.get<{Querystring:{accountId?:unknown}}>("/v1/company/contacts",wos(async(req,reply)=>{
  const f=companyFilter(reply,req.query?.accountId,"acc");if(!f.ok)return reply;return {contacts:crmDomain().listContacts(scope,f.id)};
}));
app.post("/v1/company/contacts",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.contact.create","NONE",body,validateContactCreate))return reply;
  const b=body as any,r=crmDomain().createContact(scope,{accountId:b.accountId,name:b.name,role:b.role,email:b.email,idempotencyKey:b.idempotencyKey},actor);
  audit(r.replayed?"COMPANY_IDEMPOTENT_REPLAY":"COMPANY_CONTACT_CREATED",{actor,kind:"contact",contactId:r.entity.contactId,accountId:r.entity.accountId});return created(reply,r.replayed,{contact:r.entity});
}));
app.get<{Querystring:{accountId?:unknown}}>("/v1/company/opportunities",wos(async(req,reply)=>{
  const f=companyFilter(reply,req.query?.accountId,"acc");if(!f.ok)return reply;return {opportunities:crmDomain().listOpportunities(scope,f.id)};
}));
app.post("/v1/company/opportunities",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.opportunity.create","NONE",body,validateOpportunityCreate))return reply;
  const b=body as any,r=crmDomain().createOpportunity(scope,{accountId:b.accountId,title:b.title,amountMinor:b.amountMinor,currency:b.currency,idempotencyKey:b.idempotencyKey},actor);
  audit(r.replayed?"COMPANY_IDEMPOTENT_REPLAY":"COMPANY_OPPORTUNITY_CREATED",{actor,kind:"opportunity",opportunityId:r.entity.opportunityId,accountId:r.entity.accountId,amountMinor:r.entity.amountMinor,currency:r.entity.currency});return created(reply,r.replayed,{opportunity:r.entity});
}));
app.post<{Params:{id:string}}>("/v1/company/opportunities/:id/stage",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.opportunity.stage",req.params.id,body,companyBody("opp",req.params.id,validateOpportunityStage)))return reply;
  const b=body as any,before=crmDomain().getOpportunity(scope,req.params.id),opportunity=crmDomain().stageOpportunity(scope,req.params.id,b.stage,b.reason,actor);
  audit("COMPANY_OPPORTUNITY_STAGED",{actor,opportunityId:opportunity.opportunityId,from:before?.stage,to:opportunity.stage});return {opportunity};
}));
app.get<{Querystring:{accountId?:unknown}}>("/v1/company/invoices",wos(async(req,reply)=>{
  const f=companyFilter(reply,req.query?.accountId,"acc");if(!f.ok)return reply;return {invoices:financeDomain().listInvoices(scope,f.id)};
}));
app.post("/v1/company/invoices",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.invoice.create","NONE",body,validateInvoiceCreate))return reply;
  // Client totalMinor yok sayılır; toplam sunucuda satırlardan hesaplanır.
  const b=body as any,r=financeDomain().createInvoice(scope,{accountId:b.accountId,currency:b.currency,lineItems:b.lineItems,dueDate:b.dueDate,idempotencyKey:b.idempotencyKey},actor);
  audit(r.replayed?"COMPANY_IDEMPOTENT_REPLAY":"COMPANY_INVOICE_CREATED",{actor,kind:"invoice",invoiceId:r.entity.invoiceId,accountId:r.entity.accountId,totalMinor:r.entity.totalMinor,currency:r.entity.currency});return created(reply,r.replayed,{invoice:r.entity});
}));
app.post<{Params:{id:string}}>("/v1/company/invoices/:id/issue",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.invoice.issue",req.params.id,body,companyBody("inv",req.params.id,validateInvoiceIssue)))return reply;
  const invoice=financeDomain().issueInvoice(scope,req.params.id,actor);
  audit("COMPANY_INVOICE_ISSUED",{actor,invoiceId:invoice.invoiceId,number:invoice.number,totalMinor:invoice.totalMinor,currency:invoice.currency});return {invoice};
}));
app.post<{Params:{id:string}}>("/v1/company/invoices/:id/void",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.invoice.void",req.params.id,body,companyBody("inv",req.params.id,validateInvoiceVoid)))return reply;
  const invoice=financeDomain().voidInvoice(scope,req.params.id,(body as any).reason,actor);
  audit("COMPANY_INVOICE_VOIDED",{actor,invoiceId:invoice.invoiceId});return {invoice};
}));
app.get<{Querystring:{invoiceId?:unknown}}>("/v1/company/payments",wos(async(req,reply)=>{
  const f=companyFilter(reply,req.query?.invoiceId,"inv");if(!f.ok)return reply;return {payments:financeDomain().listPayments(scope,f.id)};
}));
app.post("/v1/company/payments",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.payment.record","NONE",body,validatePaymentCreate))return reply;
  const b=body as any,fin=financeDomain();
  const r=b.reversesPaymentId!==undefined?fin.reversePayment(scope,{reversesPaymentId:b.reversesPaymentId,invoiceId:b.invoiceId,reason:b.reason,idempotencyKey:b.idempotencyKey},actor)
    :fin.recordPayment(scope,{invoiceId:b.invoiceId,amountMinor:b.amountMinor,currency:b.currency,receivedAt:b.receivedAt,reference:b.reference,idempotencyKey:b.idempotencyKey},actor);
  audit(r.replayed?"COMPANY_IDEMPOTENT_REPLAY":r.entity.payment.entryKind==="REVERSAL"?"COMPANY_PAYMENT_REVERSED":"COMPANY_PAYMENT_RECORDED",{actor,kind:"payment",paymentId:r.entity.payment.paymentId,invoiceId:r.entity.payment.invoiceId,amountMinor:r.entity.payment.amountMinor,currency:r.entity.payment.currency,invoiceStatus:r.entity.invoice.status});
  return created(reply,r.replayed,r.entity);
}));
app.get<{Querystring:{accountId?:unknown}}>("/v1/company/contracts",wos(async(req,reply)=>{
  const f=companyFilter(reply,req.query?.accountId,"acc");if(!f.ok)return reply;return {contracts:legalDomain().listContracts(scope,f.id)};
}));
app.post("/v1/company/contracts",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.contract.create","NONE",body,validateContractCreate))return reply;
  const b=body as any,r=legalDomain().createContract(scope,{accountId:b.accountId,opportunityId:b.opportunityId,title:b.title,idempotencyKey:b.idempotencyKey},actor);
  audit(r.replayed?"COMPANY_IDEMPOTENT_REPLAY":"COMPANY_CONTRACT_CREATED",{actor,kind:"contract",contractId:r.entity.contractId,accountId:r.entity.accountId});return created(reply,r.replayed,{contract:r.entity});
}));
app.post<{Params:{id:string}}>("/v1/company/contracts/:id/transition",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"company.contract.transition",req.params.id,body,companyBody("ctr",req.params.id,validateContractTransition)))return reply;
  const b=body as any,before=legalDomain().getContract(scope,req.params.id),contract=legalDomain().transitionContract(scope,req.params.id,{to:b.to,reason:b.reason,documentSha256:b.documentSha256,signerName:b.signerName,signedAt:b.signedAt},actor);
  audit("COMPANY_CONTRACT_TRANSITIONED",{actor,contractId:contract.contractId,from:before?.status,to:contract.status,...(contract.status==="SIGNED"?{documentSha256:contract.documentSha256}:{})});return {contract};
}));

// //TR: WFR-03 tek kanonik RoleDefinition kaydı: dosya mtime+boyut anahtarlı önbellekle okunur, yalnız okunur; eksik/bozuk kayıt 503 döner, sayı uydurulmaz.
const ROLE_ID_RE=/^UASCO-\d{4}$/,GUILD_ID_RE=/^G\d{2}$/,CLUSTER_ID_RE=/^CL\d{2}$/;
let roleRegistryCache:{key:string;doc:any;index:Map<string,number>}|null=null;
function loadRoleRegistry(){
  const f=path.join(repoRoot,ROLE_REGISTRY_FILE),st=fs.statSync(f),key=`${st.mtimeMs}:${st.size}`;if(roleRegistryCache?.key===key)return roleRegistryCache;
  const doc=readJson(f);if(!Array.isArray(doc?.roles))throw new Error("ROLE_REGISTRY_INVALID");
  roleRegistryCache={key,doc,index:new Map(doc.roles.map((r:any,i:number)=>[r.roleId,i]))};return roleRegistryCache;
}
function roleRegistrySummary(){const {doc}=loadRoleRegistry();return {registeredRoles:doc.roles.length as number,certified:doc.roles.filter((r:any)=>r.proficiencyStatus==="CERTIFIED").length as number,status:String(doc.status),notice:String(doc.notice)}}
function activeWorkerRunsOrNull(){try{const st=getStore();return st.hasJournal?st.countActiveWorkerRuns(scope):null}catch{return null}}
const roleItem=(r:any)=>({roleId:r.roleId,title:r.title,guildId:r.guildId,clusterId:r.clusterId,priority:r.priority,runtimeStatus:r.runtimeStatus,proficiencyStatus:r.proficiencyStatus,certifiedScope:r.certifiedScope,legacyAliasCount:Array.isArray(r.legacyAliases)?r.legacyAliases.length:0,gapCount:Array.isArray(r.gapIds)?r.gapIds.length:0});
// //TR: GET /v1/roles: guildId/clusterId/q filtreli, roleId artan sıralı kararlı sayfalama; cursor son dönen roleId'dir, limit 1..100 (varsayılan 50); geçersiz parametre 400 döner.
app.get<{Querystring:Record<string,unknown>}>("/v1/roles",async(req,reply)=>{
  const q=req.query??{},str=(k:string)=>q[k]===undefined?undefined:typeof q[k]==="string"?q[k] as string:null;
  const guildId=str("guildId"),clusterId=str("clusterId"),text=str("q"),cursor=str("cursor"),limitRaw=str("limit");
  if(guildId===null||(guildId!==undefined&&!GUILD_ID_RE.test(guildId)))return reply.code(400).send({error:"INVALID_GUILD_ID"});
  if(clusterId===null||(clusterId!==undefined&&!CLUSTER_ID_RE.test(clusterId)))return reply.code(400).send({error:"INVALID_CLUSTER_ID"});
  if(cursor===null||(cursor!==undefined&&!ROLE_ID_RE.test(cursor)))return reply.code(400).send({error:"INVALID_CURSOR"});
  if(text===null||(text!==undefined&&text.length>200))return reply.code(400).send({error:"INVALID_QUERY"});
  if(limitRaw===null||(limitRaw!==undefined&&!/^\d{1,3}$/.test(limitRaw)))return reply.code(400).send({error:"INVALID_LIMIT"});
  const limit=limitRaw===undefined?50:Number(limitRaw);if(limit<1||limit>100)return reply.code(400).send({error:"INVALID_LIMIT"});
  let reg;try{reg=loadRoleRegistry()}catch{return reply.code(503).send({error:"ROLE_REGISTRY_UNAVAILABLE"})}
  const needle=text?.trim().toLowerCase()??"";
  const matches=(reg.doc.roles as any[]).filter(r=>(!guildId||r.guildId===guildId)&&(!clusterId||r.clusterId===clusterId)&&(!needle||[r.roleId,r.title,...(Array.isArray(r.specializationBoundaries)?r.specializationBoundaries:[])].some(x=>String(x).toLowerCase().includes(needle)))).sort((a,b)=>a.roleId<b.roleId?-1:a.roleId>b.roleId?1:0);
  const after=cursor?matches.filter(r=>r.roleId>cursor):matches,page=after.slice(0,limit);
  return {status:reg.doc.status,notice:reg.doc.notice,registeredRoles:reg.doc.roles.length,total:matches.length,limit,cursor:cursor??null,nextCursor:after.length>limit?page[page.length-1].roleId:null,items:page.map(roleItem)};
});
// //TR: GET /v1/roles/:roleId: tam RoleDefinition (legacy takma adlar PROPOSED, gap kimlikleri, guild/cluster) döner; hiçbir durum yükseltilmez.
app.get<{Params:{roleId:string}}>("/v1/roles/:roleId",async(req,reply)=>{
  if(!ROLE_ID_RE.test(req.params.roleId))return reply.code(400).send({error:"INVALID_ROLE_ID"});
  let reg;try{reg=loadRoleRegistry()}catch{return reply.code(503).send({error:"ROLE_REGISTRY_UNAVAILABLE"})}
  const i=reg.index.get(req.params.roleId);if(i===undefined)return reply.code(404).send({error:"ROLE_NOT_FOUND"});
  const role=reg.doc.roles[i],guild=(reg.doc.guilds??[]).find((g:any)=>g.guildId===role.guildId)??null,cluster=(reg.doc.clusters??[]).find((c:any)=>c.clusterId===role.clusterId)??null;
  return {status:reg.doc.status,notice:reg.doc.notice,role,guild,cluster,legacyAliases:role.legacyAliases??[],gaps:{role:role.gapIds??[],guild:guild?.gapIds??[]}};
});

// //TR: REL-FX-4 onaylı yırtık kuyruk onarımı: aynı token/Host hook'u (her açılışta verilen control token) ve aynı yazma kapısı; gövde kuyruğun tam sha256'sını aynen onaylamalıdır. Tamper asla kesilmez.
app.post("/v1/system/workos/journal/repair-torn-tail",wos(async(req,reply)=>{
  const body=req.body??{};if(!workosWrite(reply,"workos.system.journal.repair-torn-tail","NONE",body,validateTornTailRepair))return reply;
  const repair=getStore().repairTornTail((body as {confirmTailSha256:string}).confirmTailSha256,actor);
  audit("WORKOS_JOURNAL_TORN_TAIL_REPAIRED",{actor,...repair});
  return {repair,workos:workosHealth()};
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
// //TR: WFR-03: workforce.registeredRoles legacy 363 kaydın sayısıdır (LEGACY_REFERENCE_ONLY projeksiyon), targetRoles kanonik role-definitions.json'dan gelir; sözleşme şekli değişmez.
// //TR: WFR-03 c2: registeredRolesAuthority bu alanın yalnız legacy referans olduğunu açıkça söyler; canonicalRegisteredRoles kanonik kayıttan hesaplanan rol sayısıdır (/v1/agents.registeredRoles ile aynı kaynak). Mevcut anahtarlar korunur, iki alan geriye uyumlu eklenir.
// //TR: B3a: workforce.activeWorkerRuns Work OS journal'ındaki LEASED/RUNNING/CHECKPOINTING/VERIFYING run sayısıdır (state VERIFIED); journal yoksa UNAVAILABLE/null, okunamazsa ERROR/null. registeredRoles/targetRoles yalnız okunabilen registry dosyasından gelir. Sözleşme şekli değişmez.
function cockpitWorkforce(){
  const base=(state:CockpitState,registeredRoles:number|null,targetRoles:number|null,activeWorkerRuns:number|null=null)=>({state,registeredRoles,registeredRolesAuthority:"LEGACY_REFERENCE_ONLY",canonicalRegisteredRoles:targetRoles,targetRoles,activeWorkerRuns,source:`${LEGACY_AGENTS_FILE} (LEGACY_REFERENCE_ONLY); ${ROLE_REGISTRY_FILE}; Work OS journal runs (LEASED|RUNNING|CHECKPOINTING|VERIFYING)`});
  try{
    let registered:number|null=null,target:number|null=null;
    const af=path.join(repoRoot,LEGACY_AGENTS_FILE);
    if(fs.existsSync(af)){const a=readJson(af);if(!Array.isArray(a?.agents))return base("ERROR",null,null);registered=a.agents.length}
    const tf=path.join(repoRoot,ROLE_REGISTRY_FILE);
    if(fs.existsSync(tf)){const t=readJson(tf);const n=Array.isArray(t)?t.length:Array.isArray(t?.roles)?t.roles.length:Number.isInteger(t?.count)&&t.count>=0?t.count:null;if(n===null)return base("ERROR",registered,null);target=n}
    const st=getStore();if(!st.hasJournal)return base("UNAVAILABLE",registered,target);
    let active:number;try{active=st.countActiveWorkerRuns(scope)}catch{return base("ERROR",registered,target)}
    return base("VERIFIED",registered,target,active);
  }catch{return base("ERROR",null,null)}
}
// //TR: B10A: cockpit.evidence yeni isteğe bağlı bloktur (mevcut alanlar değişmez); kaynaklar yoksa UNAVAILABLE, okunamazsa ERROR ve sayılar null olur, sayı uydurulmaz.
async function cockpitEvidence(){
  try{const s=await evidenceIndex().summary();return {state:s.state as CockpitState,total:s.total,verified:s.verified,mismatch:s.mismatch,missing:s.missing,unverifiable:s.unverifiable,sources:s.sources}}
  catch{return {state:"ERROR" as CockpitState,total:null,verified:null,mismatch:null,missing:null,unverifiable:null,sources:null}}
}
app.get("/v1/cockpit",wos(async()=>({
  generatedAt:new Date().toISOString(),globalStop:cockpitStop(),...cockpitWorkos(),orchestrator:cockpitOrchestrator(),workforce:cockpitWorkforce(),
  legacy:{scheduler:{authority:false,note:"LEGACY_SNAPSHOT"}},evidence:await cockpitEvidence()
})));
return app;
}

// //TR: Yalnızca doğrudan çalıştırıldığında (tsx apps/control-api/src/server.ts) dinler; import eden testler port açmaz.
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  const app=buildServer(),port=parseControlPort(process.env.CONTROL_API_PORT,3210);
  await app.listen({host:"127.0.0.1",port});
}

