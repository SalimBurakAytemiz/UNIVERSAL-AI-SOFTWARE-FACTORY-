// //TR: Bu helper 149 phase'i dependency DAG + priority + runtime state üzerinden seçer, phase completion/block/retry durumlarını atomic kaydeder ve numara sırasına körlemesine bağlanmadan hızlı runnable work üretir.
import fs from "node:fs";
import path from "node:path";
import {readJsonIfExists,writeJsonAtomic} from "./atomic-json.mjs";

export function initializeSchedulerState(templateFile,stateFile,{phase0Complete=false,phase0Commit=null}={}){
  if(fs.existsSync(stateFile)) return JSON.parse(fs.readFileSync(stateFile,"utf8"));
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
export function loadSchedulerState(file){return JSON.parse(fs.readFileSync(file,"utf8"))}
export function saveSchedulerState(file,state){state.updatedAt=new Date().toISOString();writeJsonAtomic(file,state)}
export function runnablePhases(graph,state){
  const by=new Map(state.phases.map(x=>[x.phase,x]));
  const completed=new Set(state.phases.filter(x=>x.status==="COMPLETED").map(x=>x.phase));
  const active=new Set(state.phases.filter(x=>x.status==="ACTIVE").map(x=>x.phase));
  return graph.doc.nodes
    .filter(n=>{
      const s=by.get(n.phase);
      return s && ["PENDING","RETRY_READY"].includes(s.status) && !active.has(n.phase) && n.dependsOn.every(d=>completed.has(d));
    })
    .sort((a,b)=>{
      const rank={CRITICAL_PATH:0,HIGH:1,NORMAL:2};
      return (rank[a.priority]??9)-(rank[b.priority]??9)||a.phase-b.phase;
    });
}
export function markActive(state,phase,runId){
  const p=state.phases.find(x=>x.phase===phase); if(!p)throw new Error(`Unknown phase ${phase}`);
  p.status="ACTIVE";p.attempts=(p.attempts??0)+1;p.lastRunId=runId;
  state.active=[...new Set([...(state.active??[]),phase])];
}
export function markCompleted(state,phase,commit,evidenceRefs=[]){
  const p=state.phases.find(x=>x.phase===phase);p.status="COMPLETED";p.completedCommit=commit;p.evidenceRefs=evidenceRefs;
  state.active=(state.active??[]).filter(x=>x!==phase); state.blocked=(state.blocked??[]).filter(x=>x.phase!==phase);
}
export function markRetry(state,phase,reason,retryAt){
  const p=state.phases.find(x=>x.phase===phase);p.status="RETRY_WAIT";p.retryAt=retryAt;p.lastFailure=reason;
  state.active=(state.active??[]).filter(x=>x!==phase);
}
export function promoteDueRetries(state,now=Date.now()){
  for(const p of state.phases) if(p.status==="RETRY_WAIT"&&p.retryAt&&Date.parse(p.retryAt)<=now)p.status="RETRY_READY";
}
export function markBlocked(state,phase,reason,kind="FOUNDER_ATTENTION"){
  const p=state.phases.find(x=>x.phase===phase);p.status="BLOCKED";p.lastFailure=reason;
  state.active=(state.active??[]).filter(x=>x!==phase);
  state.blocked=[...(state.blocked??[]).filter(x=>x.phase!==phase),{phase,reason,kind,at:new Date().toISOString()}];
}
export function allComplete(state){return state.phases.every(x=>x.status==="COMPLETED")}
