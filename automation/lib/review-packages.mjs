// //TR: Bu helper 148 post-Phase0 acceptance phase'ini coherent review package'larında çalıştırır; phase acceptance ayrı kalırken Claude/Codex review tur sayısını ve token tüketimini azaltır.
import fs from "node:fs";

export function loadReviewPackages(file){
  const d=JSON.parse(fs.readFileSync(file,"utf8"));
  const map=new Map(d.packages.map(x=>[x.id,x]));
  return {doc:d,map};
}
function stateByPhase(state){return new Map(state.phases.map(x=>[x.phase,x]))}
export function packagePendingPhases(pkg,state){const by=stateByPhase(state);return pkg.phaseIds.filter(p=>by.get(p)?.status!=="COMPLETED")}
export function packageStatus(pkg,state){
  const by=stateByPhase(state), rows=pkg.phaseIds.map(p=>by.get(p));
  if(rows.every(x=>x?.status==="COMPLETED")) return "COMPLETED";
  if(rows.some(x=>x?.status==="BLOCKED")) return "BLOCKED";
  if(rows.some(x=>x?.status==="ACTIVE")) return "ACTIVE";
  if(rows.some(x=>x?.status==="RETRY_WAIT")) return "RETRY_WAIT";
  return "PENDING";
}
export function runnablePackages(packages,graph,state){
  const by=stateByPhase(state), completed=new Set(state.phases.filter(x=>x.status==="COMPLETED").map(x=>x.phase));
  const rank={RELEASE_CRITICAL:0,TRUST_CRITICAL:1,SECURITY_CRITICAL:2,STANDARD:3};
  return packages.doc.packages.filter(pkg=>{
    const status=packageStatus(pkg,state); if(!["PENDING"].includes(status)) return false;
    const own=new Set(pkg.phaseIds);
    for(const p of packagePendingPhases(pkg,state)){
      const node=graph.map.get(p); if(!node) return false;
      for(const dep of node.dependsOn) if(!own.has(dep)&&!completed.has(dep)) return false;
      const row=by.get(p); if(!row||!["PENDING","RETRY_READY"].includes(row.status)) return false;
    }
    return true;
  }).sort((a,b)=>(rank[a.reviewProfile]??9)-(rank[b.reviewProfile]??9)||a.id.localeCompare(b.id));
}
export function markPackageActive(state,pkg,runId){
  for(const p of packagePendingPhases(pkg,state)){
    const row=state.phases.find(x=>x.phase===p); row.status="ACTIVE";row.attempts=(row.attempts??0)+1;row.lastRunId=runId;
  }
  state.active=[...new Set([...(state.active??[]),...packagePendingPhases(pkg,state)])];
}
export function markPackageRetry(state,pkg,reason,retryAt){
  for(const p of pkg.phaseIds){const row=state.phases.find(x=>x.phase===p);if(row.status!=="COMPLETED"){row.status="RETRY_WAIT";row.retryAt=retryAt;row.lastFailure=reason}}
  state.active=(state.active??[]).filter(x=>!pkg.phaseIds.includes(x));
}
export function markPackageBlocked(state,pkg,reason,kind="FOUNDER_ATTENTION"){
  for(const p of pkg.phaseIds){const row=state.phases.find(x=>x.phase===p);if(row.status!=="COMPLETED"){row.status="BLOCKED";row.lastFailure=reason}}
  state.active=(state.active??[]).filter(x=>!pkg.phaseIds.includes(x));
  state.blocked=[...(state.blocked??[]).filter(x=>!pkg.phaseIds.includes(x.phase)),...pkg.phaseIds.filter(p=>state.phases.find(x=>x.phase===p)?.status!=="COMPLETED").map(phase=>({phase,packageId:pkg.id,reason,kind,at:new Date().toISOString()}))];
}
export function markPackageCompleted(state,pkg,commit,evidenceRefs=[]){
  for(const p of pkg.phaseIds){const row=state.phases.find(x=>x.phase===p);if(row.status!=="COMPLETED"){row.status="COMPLETED";row.completedCommit=commit;row.evidenceRefs=evidenceRefs}}
  state.active=(state.active??[]).filter(x=>!pkg.phaseIds.includes(x));state.blocked=(state.blocked??[]).filter(x=>!pkg.phaseIds.includes(x.phase));
}
