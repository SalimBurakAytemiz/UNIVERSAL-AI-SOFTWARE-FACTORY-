// //TR: Bu helper 149 phase'i dependency DAG + priority + runtime state üzerinden seçer; phase completion/block/retry durumlarını atomic kaydeder ve state invariant'larını fail-closed doğrular.
import fs from "node:fs";
import path from "node:path";
import {readJsonIfExists,writeJsonAtomic} from "./atomic-json.mjs";

export function initializeSchedulerState(templateFile,stateFile,{phase0Complete=false,phase0Commit=null}={}){
  if(fs.existsSync(stateFile)||fs.existsSync(`${stateFile}.prev`)) return loadSchedulerState(stateFile);
  const t=JSON.parse(fs.readFileSync(templateFile,"utf8"));
  t.updatedAt=new Date().toISOString();
  if(phase0Complete){
    const p=t.phases.find(x=>x.phase===0); p.status="COMPLETED"; p.completedCommit=phase0Commit??"PHASE0_INSTALL_BASELINE";
  }
  writeJsonAtomic(stateFile,t); return t;
}
export function loadGraph(file){
  const d=JSON.parse(fs.readFileSync(file,"utf8"));
  const map=new Map(d.nodes.map(x=>[x.phase,x]));
  return {doc:d,map};
}
const VALID_PHASE_STATUS=new Set(["PENDING","ACTIVE","COMPLETED","RETRY_WAIT","RETRY_READY","BLOCKED"]);
const validDate=x=>typeof x==="string"&&x.trim()&&Number.isFinite(Date.parse(x));
export function validateSchedulerState(state){
  const errors=[];
  if(!state||typeof state!=="object"||Array.isArray(state))return {ok:false,errors:["state-not-object"]};
  if(state.schemaVersion!=="1.0.0")errors.push("schema-version");
  if(!Array.isArray(state.phases)||state.phases.length!==149)errors.push("phase-count");
  const phases=Array.isArray(state.phases)?state.phases:[],ids=phases.map(x=>x?.phase);
  if(new Set(ids).size!==ids.length||ids.some((x,i)=>!Number.isInteger(x)||x!==i))errors.push("phase-identity");
  for(const row of phases){
    if(!row||!VALID_PHASE_STATUS.has(row.status)){errors.push(`phase-status:${row?.phase}`);continue}
    if(!Number.isInteger(row.attempts)||row.attempts<0)errors.push(`phase-attempts:${row.phase}`);
    if(!Array.isArray(row.evidenceRefs)||row.evidenceRefs.some(x=>typeof x!=="string"||!x.trim()))errors.push(`phase-evidence:${row.phase}`);
    if(row.status==="ACTIVE"&&!(typeof row.lastRunId==="string"&&row.lastRunId.trim()))errors.push(`active-run-id:${row.phase}`);
    if(row.status==="RETRY_WAIT"&&(!validDate(row.retryAt)||!(typeof row.lastFailure==="string"&&row.lastFailure.trim())))errors.push(`retry-wait-fields:${row.phase}`);
    if(row.status==="BLOCKED"&&!(typeof row.lastFailure==="string"&&row.lastFailure.trim()))errors.push(`blocked-failure:${row.phase}`);
    if(row.status==="COMPLETED"){
      if(!(typeof row.completedCommit==="string"&&row.completedCommit.trim()))errors.push(`completed-commit:${row.phase}`);
      if(row.phase!==0&&row.evidenceRefs.length===0)errors.push(`completed-evidence:${row.phase}`);
    }
  }
  if(!Array.isArray(state.active)||state.active.some(x=>!Number.isInteger(x)))errors.push("active-shape");
  if(Array.isArray(state.active)&&new Set(state.active).size!==state.active.length)errors.push("active-duplicates");
  if(!Array.isArray(state.blocked))errors.push("blocked-shape");
  const by=new Map(phases.map(x=>[x.phase,x]));
  const activeSet=new Set(state.active??[]),expectedActive=new Set(phases.filter(x=>x.status==="ACTIVE").map(x=>x.phase));
  for(const id of activeSet)if(by.get(id)?.status!=="ACTIVE")errors.push(`active-mismatch:${id}`);
  for(const id of expectedActive)if(!activeSet.has(id))errors.push(`active-missing:${id}`);
  const blockedRows=Array.isArray(state.blocked)?state.blocked:[],blockedIds=blockedRows.map(x=>x?.phase);
  if(new Set(blockedIds).size!==blockedIds.length)errors.push("blocked-duplicates");
  const blockedSet=new Set(blockedIds.filter(Number.isInteger)),expectedBlocked=new Set(phases.filter(x=>x.status==="BLOCKED").map(x=>x.phase));
  for(const row of blockedRows){
    if(!row||!Number.isInteger(row.phase)||by.get(row.phase)?.status!=="BLOCKED")errors.push(`blocked-mismatch:${row?.phase}`);
    else if(!(typeof row.reason==="string"&&row.reason.trim())||!(typeof row.kind==="string"&&row.kind.trim())||!validDate(row.at))errors.push(`blocked-fields:${row.phase}`);
  }
  for(const id of expectedBlocked)if(!blockedSet.has(id))errors.push(`blocked-missing:${id}`);
  return {ok:errors.length===0,errors};
}
function parseSchedulerCandidate(file){
  if(!fs.existsSync(file))return {ok:false,error:"missing"};
  try{const state=JSON.parse(fs.readFileSync(file,"utf8")),v=validateSchedulerState(state);return v.ok?{ok:true,state}:{ok:false,error:`invalid:${v.errors.join(",")}`}}catch(e){return {ok:false,error:`parse:${e.message}`}}
}
function restoreRecoveredMain(file,state){
  const tmp=`${file}.recover-${process.pid}-${Date.now()}`;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(tmp,JSON.stringify(state,null,2)+"\n","utf8");fs.renameSync(tmp,file);
}
export function loadSchedulerState(file){
  const current=parseSchedulerCandidate(file);if(current.ok)return current.state;
  const previous=parseSchedulerCandidate(`${file}.prev`);
  if(previous.ok){restoreRecoveredMain(file,previous.state);return previous.state}
  throw new Error(`SCHEDULER_STATE_UNRECOVERABLE: current=${current.error}; prev=${previous.error}`);
}
export function saveSchedulerState(file,state){const v=validateSchedulerState(state);if(!v.ok)throw new Error(`SCHEDULER_STATE_INVALID: ${v.errors.join(",")}`);state.updatedAt=new Date().toISOString();writeJsonAtomic(file,state)}
export function runnablePhases(graph,state){
  const by=new Map(state.phases.map(x=>[x.phase,x]));
  const completed=new Set(state.phases.filter(x=>x.status==="COMPLETED").map(x=>x.phase));
  const active=new Set(state.phases.filter(x=>x.status==="ACTIVE").map(x=>x.phase));
  return graph.doc.nodes
    .filter(n=>{const s=by.get(n.phase);return s&&["PENDING","RETRY_READY"].includes(s.status)&&!active.has(n.phase)&&n.dependsOn.every(d=>completed.has(d))})
    .sort((a,b)=>{const rank={CRITICAL_PATH:0,HIGH:1,NORMAL:2};return (rank[a.priority]??9)-(rank[b.priority]??9)||a.phase-b.phase});
}
export function markActive(state,phase,runId){const p=state.phases.find(x=>x.phase===phase);if(!p)throw new Error(`Unknown phase ${phase}`);p.status="ACTIVE";p.attempts=(p.attempts??0)+1;p.lastRunId=runId;delete p.retryAt;state.active=[...new Set([...(state.active??[]),phase])];state.blocked=(state.blocked??[]).filter(x=>x.phase!==phase)}
export function markCompleted(state,phase,commit,evidenceRefs=[]){const p=state.phases.find(x=>x.phase===phase);p.status="COMPLETED";p.completedCommit=commit;p.evidenceRefs=evidenceRefs;delete p.retryAt;delete p.lastFailure;state.active=(state.active??[]).filter(x=>x!==phase);state.blocked=(state.blocked??[]).filter(x=>x.phase!==phase)}
export function markRetry(state,phase,reason,retryAt){const p=state.phases.find(x=>x.phase===phase);p.status="RETRY_WAIT";p.retryAt=retryAt;p.lastFailure=String(reason);state.active=(state.active??[]).filter(x=>x!==phase);state.blocked=(state.blocked??[]).filter(x=>x.phase!==phase)}
export function promoteDueRetries(state,now=Date.now()){for(const p of state.phases)if(p.status==="RETRY_WAIT"&&validDate(p.retryAt)&&Date.parse(p.retryAt)<=now)p.status="RETRY_READY"}
export function markBlocked(state,phase,reason,kind="FOUNDER_ATTENTION"){const p=state.phases.find(x=>x.phase===phase);p.status="BLOCKED";p.lastFailure=String(reason);delete p.retryAt;state.active=(state.active??[]).filter(x=>x!==phase);state.blocked=[...(state.blocked??[]).filter(x=>x.phase!==phase),{phase,reason:String(reason),kind:String(kind),at:new Date().toISOString()}]}
export function allComplete(state){return state.phases.every(x=>x.status==="COMPLETED")}
