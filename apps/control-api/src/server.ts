// //TR: Bu dosya Desktop Control Tower ile Day-0 runtime arasında localhost-only authenticated control/read API sağlar; run/scheduler/phase0/log özetleri path-traversal olmadan okunur ve Global Stop/Resume token ile korunur.
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";

const app=Fastify({logger:true,requestIdHeader:"x-request-id",genReqId:()=>crypto.randomUUID(),bodyLimit:64*1024});
const readJson=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const readJsonOr=<T>(p:string,fallback:T):T=>fs.existsSync(p)?readJson(p):fallback;
const runtime=".ai/runtime"; const runsRoot=path.join(runtime,"runs");
const controlToken=process.env.UASCO_CONTROL_TOKEN??"";
const validRunId=(x:string)=>/^RUN-[A-Za-z0-9-]+$/.test(x);
const validLogName=(x:string)=>/^[A-Za-z0-9._-]+\.log$/.test(x);

function atomicJson(file:string,value:unknown){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp-${process.pid}-${Date.now()}`,prev=`${file}.prev`;fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n","utf8");if(fs.existsSync(file)){const ptmp=`${prev}.tmp-${process.pid}-${Date.now()}`;fs.copyFileSync(file,ptmp);try{fs.renameSync(ptmp,prev)}catch{fs.rmSync(prev,{force:true});fs.renameSync(ptmp,prev)}}try{fs.renameSync(tmp,file)}catch{fs.copyFileSync(tmp,file);fs.rmSync(tmp,{force:true})}}
function tokenOk(req:any){return Boolean(controlToken)&&req.headers["x-uasco-control-token"]===controlToken}
function audit(event:string,details:Record<string,unknown>={}){fs.mkdirSync(runtime,{recursive:true});fs.appendFileSync(path.join(runtime,"control-api-events.jsonl"),JSON.stringify({timestamp:new Date().toISOString(),event,...details})+"\n")}

function startSupervisorDetached(){
  if(fs.existsSync(path.join(runtime,"supervisor.lock")))return {started:false,reason:"SUPERVISOR_LOCK_PRESENT"};
  const script=path.resolve("scripts/start-full-auto.ps1");
  const shell=process.platform==="win32"?"powershell.exe":"pwsh";
  try{const child=cp.spawn(shell,["-NoProfile","-ExecutionPolicy","Bypass","-File",script],{cwd:process.cwd(),detached:true,stdio:"ignore",windowsHide:true});child.unref();return {started:true,pid:child.pid}}catch(e){return {started:false,reason:String((e as Error).message)}}
}

app.addHook("onRequest",async(req,reply)=>{
  if(req.url==="/health") return;
  if(req.url.startsWith("/v1/")&&!controlToken) return reply.code(503).send({error:"CONTROL_TOKEN_NOT_CONFIGURED"});
  if(req.url.startsWith("/v1/")&&!tokenOk(req)) return reply.code(403).send({error:"FORBIDDEN"});
});

app.get("/health",async()=>({status:"HEALTHY",system:"UNIVERSAL-AI-SOFTWARE-COMPANY-OS",time:new Date().toISOString()}));
app.get("/v1/factory",async()=>readJson(".ai/MASTER_STATE.json"));
app.get("/v1/phase0",async()=>readJsonOr(path.join(runtime,"PHASE0_ACCEPTANCE.json"),{final:"PENDING"}));
app.get("/v1/install",async()=>readJsonOr(path.join(runtime,"INSTALL_REPORT.json"),{phase0Final:"PENDING",components:{}}));
app.get("/v1/scheduler",async()=>readJsonOr(path.join(runtime,"scheduler-state.json"),{status:"NOT_INITIALIZED"}));
app.get("/v1/agents",async()=>readJson("registries/agents.json"));
app.get("/v1/capabilities",async()=>readJson("registries/capabilities.json"));
app.get("/v1/fabrics",async()=>readJson("registries/execution-fabrics.json"));
app.get("/v1/adapters",async()=>readJson("registries/tool-adapters.json"));
app.get("/v1/domains",async()=>readJson("registries/domain-packs.json"));
app.get("/v1/control/status",async()=>({globalStop:fs.existsSync(path.join(runtime,"GLOBAL_STOP.json"))?readJson(path.join(runtime,"GLOBAL_STOP.json")):{active:false}}));
app.get("/v1/retry",async()=>readJsonOr(path.join(runtime,"SUPERVISOR_RETRY.json"),null));
app.get("/v1/founder-attention",async()=>{const scheduler=readJsonOr(path.join(runtime,"scheduler-state.json"),{blocked:[]});return {blocked:scheduler.blocked??[],checkpoint:readJsonOr(path.join(runtime,"supervisor-checkpoint.json"),null),retry:readJsonOr(path.join(runtime,"SUPERVISOR_RETRY.json"),null)}});

app.get("/v1/runs",async()=>{
  if(!fs.existsSync(runsRoot))return {count:0,runs:[]};
  const runs=fs.readdirSync(runsRoot,{withFileTypes:true}).filter(x=>x.isDirectory()&&validRunId(x.name)).map(x=>{const dir=path.join(runsRoot,x.name);return {runId:x.name,summary:readJsonOr(path.join(dir,"summary.json"),null),manifest:readJsonOr(path.join(dir,"run-manifest.json"),null)}}).sort((a,b)=>b.runId.localeCompare(a.runId)).slice(0,100);
  return {count:runs.length,runs};
});
app.get<{Params:{runId:string}}>("/v1/runs/:runId/events",async(req,reply)=>{
  if(!validRunId(req.params.runId))return reply.code(400).send({error:"INVALID_RUN_ID"});
  const f=path.join(runsRoot,req.params.runId,"events.jsonl");if(!fs.existsSync(f))return reply.code(404).send({error:"NOT_FOUND"});
  const events=[];for(const line of fs.readFileSync(f,"utf8").split(/\r?\n/).filter(Boolean).slice(-2000)){try{events.push(JSON.parse(line))}catch{events.push({event:"MALFORMED_EVENT_LINE",raw:"[REDACTED]"})}}
  return {runId:req.params.runId,events};
});
app.get<{Params:{runId:string}}>("/v1/runs/:runId/logs",async(req,reply)=>{
  if(!validRunId(req.params.runId))return reply.code(400).send({error:"INVALID_RUN_ID"});
  const dir=path.join(runsRoot,req.params.runId,"logs");if(!fs.existsSync(dir))return {runId:req.params.runId,logs:[]};
  const logs=fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&validLogName(x.name)).map(x=>({name:x.name,size:fs.statSync(path.join(dir,x.name)).size}));return {runId:req.params.runId,logs};
});
app.get<{Params:{runId:string,name:string}}>("/v1/runs/:runId/logs/:name",async(req,reply)=>{
  if(!validRunId(req.params.runId)||!validLogName(req.params.name))return reply.code(400).send({error:"INVALID_PATH"});
  const f=path.join(runsRoot,req.params.runId,"logs",req.params.name);if(!fs.existsSync(f))return reply.code(404).send({error:"NOT_FOUND"});
  const max=256*1024;const st=fs.statSync(f);const fd=fs.openSync(f,"r");try{const size=Math.min(max,st.size),buf=Buffer.alloc(size);fs.readSync(fd,buf,0,size,Math.max(0,st.size-size));return {runId:req.params.runId,name:req.params.name,truncated:st.size>max,text:buf.toString("utf8")}}finally{fs.closeSync(fd)}
});

app.post("/v1/control/stop",async(req)=>{const body=(req.body??{}) as {reason?:string};const doc={"//TR":"Bu runtime signal Founder Global Stop durumunu taşır.",active:true,reason:String(body.reason??"Founder requested stop").slice(0,1000),actor:"FOUNDER_CONTROL_TOWER",activatedAt:new Date().toISOString()};atomicJson(path.join(runtime,"GLOBAL_STOP.json"),doc);audit("GLOBAL_STOP_ACTIVATED",{reason:doc.reason});return {ok:true,globalStop:doc}});
app.post("/v1/control/resume",async()=>{fs.rmSync(path.join(runtime,"GLOBAL_STOP.json"),{force:true});const start=startSupervisorDetached();audit("GLOBAL_STOP_CLEARED_AND_RESUME_REQUESTED",start);return {ok:true,globalStop:{active:false},supervisor:start}});
app.post("/v1/control/retry-blocked",async(req,reply)=>{
  const body=(req.body??{}) as {packageId?:string};const packageId=String(body.packageId??"");if(!/^PKG-\d{3}$/.test(packageId))return reply.code(400).send({error:"INVALID_PACKAGE_ID"});
  const sf=path.join(runtime,"scheduler-state.json");if(!fs.existsSync(sf))return reply.code(409).send({error:"SCHEDULER_NOT_INITIALIZED"});
  const packages=readJson("roadmap/review-packages.json").packages as Array<{id:string;phaseIds:number[]}>;const pkg=packages.find(x=>x.id===packageId);if(!pkg)return reply.code(404).send({error:"PACKAGE_NOT_FOUND"});
  const state=readJson(sf);for(const phase of pkg.phaseIds){const row=state.phases?.find((x:any)=>x.phase===phase);if(row&&row.status==="BLOCKED"){row.status="RETRY_READY";delete row.lastFailure}}state.blocked=(state.blocked??[]).filter((x:any)=>x.packageId!==packageId&&!pkg.phaseIds.includes(x.phase));state.updatedAt=new Date().toISOString();atomicJson(sf,state);const start=startSupervisorDetached();audit("FOUNDER_RETRY_BLOCKED_PACKAGE",{packageId,...start});return {ok:true,packageId,supervisor:start};
});

const port=Number(process.env.CONTROL_API_PORT??3210);await app.listen({host:"127.0.0.1",port});
