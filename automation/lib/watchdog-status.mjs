// //TR: Bu modül gözetimsiz süpervizörün pasif durum çıktısını üretir: kalıcı kontrol durumu, kalp atışı, hash zincirli günlük ve süpervizörün kendi yaptığı keşif (git ref'leri, worktree'ler, Task Scheduler durumu, sağlayıcı retry durumu) .ai/runtime/WATCHDOG_STATUS.json dosyasına atomik yazılır. Dosya yalnız okunmak içindir; isteğe bağlı gözlemciler hiçbir komut çalıştırmadan bu dosyayı okur. Keşif yalnız salt-okunur tam komut sözleşmeleriyle yapılır ve her yoklama birbirinden bağımsız başarısız olabilir (UNAVAILABLE olarak raporlanır, taklit edilmez).
import fs from "node:fs";import path from "node:path";
import {writeJsonAtomic,readJsonIfExists} from "./atomic-json.mjs";import {nextAction} from "./orchestrator-engine.mjs";
export const WATCHDOG_STATUS_VERSION="1.0.0";
export const OVERALL_HEALTH=["HEALTHY","WAITING_PROVIDER","FOUNDER_DECISION_REQUIRED","STOPPED","UNHEALTHY"];
const IMPLEMENTATION_STATUSES=["IMPLEMENT_PENDING","QUEUED","REMEDIATION_PENDING"],REVIEW_STATUSES=["REVIEW_PENDING","REVIEW_PENDING_PROVIDER_QUOTA"],TERMINAL=["CLOSED","MERGED"];
export function watchdogStatusPath(policy){return path.join(policy.roots.repo,".ai","runtime","WATCHDOG_STATUS.json")}
export function validateWatchdogPolicy(policy){const w=policy?.watchdog,bad=r=>{throw new Error(`WATCHDOG_POLICY_INVALID:${r}`)};if(!w||typeof w!=="object")bad("MISSING");for(const k of ["discoveryMinutes","maxBranches"])if(!Number.isFinite(w[k])||w[k]<=0)bad(k);return w}
// //TR: Günlüğün son anlamlı geçişi (lease kayıtları hariç) dosyadan okunur; süreç çalıştırılmaz.
export function lastMeaningfulTransition(logFile){if(!fs.existsSync(logFile))return null;const lines=fs.readFileSync(logFile,"utf8").split("\n").filter(Boolean);for(let i=lines.length-1;i>=0;i--){let e;try{e=JSON.parse(lines[i])}catch{return null}if(!["LEASE_ACQUIRED","LEASE_RELEASED"].includes(e.type))return {seq:e.seq,type:e.type,packageId:e.packageId??null,to:e.to??null,at:e.at}}return null}
export function parseWorktreePorcelain(text){const out=[];let cur=null;for(const line of String(text).split(/\r?\n/)){if(line.startsWith("worktree ")){if(cur)out.push(cur);cur={path:line.slice(9),head:null,branch:null,detached:false}}else if(cur&&line.startsWith("HEAD "))cur.head=line.slice(5);else if(cur&&line.startsWith("branch "))cur.branch=line.slice(7);else if(cur&&line==="detached")cur.detached=true}if(cur)out.push(cur);return out}
export function parseBranchHeads(text,max){const out=[];for(const line of String(text).split(/\r?\n/)){const m=line.match(/^(refs\/heads\/\S+) ([0-9a-f]{40})$/);if(m)out.push({ref:m[1],sha:m[2]})}return {total:out.length,items:out.slice(0,max)}}
// //TR: Süpervizörün kendi keşfi: yalnız salt-okunur sözleşmeler; her yoklama ayrı ayrı OK/UNAVAILABLE döner.
export function discoverEnvironment({runner,policy,repo,now=()=>new Date()}){
  const w=validateWatchdogPolicy(policy),probe=(fn)=>{try{return fn()}catch(e){return {status:"UNAVAILABLE",reason:String(e?.message??e).slice(0,300)}}};
  const gitRefs=probe(()=>{const m=runner.run("git.revParse",{cwd:repo,rev:policy.merge.defaultBranchRef}),b=runner.run("git.listBranchHeads",{cwd:repo});if(m.status!==0)return {status:"UNAVAILABLE",reason:`git rev-parse exit ${m.status}`};const heads=b.status===0?parseBranchHeads(b.stdout,w.maxBranches):{total:null,items:[]};return {status:"OK",defaultBranch:{ref:policy.merge.defaultBranchRef,sha:m.stdout.trim()},branches:heads}});
  const worktrees=probe(()=>{const r=runner.run("git.worktreeList",{cwd:repo});return r.status===0?{status:"OK",items:parseWorktreePorcelain(r.stdout)}:{status:"UNAVAILABLE",reason:`git worktree list exit ${r.status}`}});
  const task=name=>probe(()=>{const r=runner.run("ps.scheduledTaskInfo",{taskName:name});if(r.status!==0)return {status:"UNAVAILABLE",taskName:name,reason:`exit ${r.status}`};const j=JSON.parse(r.stdout.trim());return {status:"OK",taskName:name,registered:j.registered===true,state:j.state??null,lastRunTime:j.lastRunTime??null,lastTaskResult:j.lastTaskResult??null,nextRunTime:j.nextRunTime??null}});
  return {at:now().toISOString(),gitRefs,worktrees,scheduler:{constructionSupervisor:task(policy.autostart.taskName),installedSystem:task(policy.autostart.installedSystemTaskName)}};
}
// //TR: Saf üretici: aynı girdiler aynı durumu verir; genel sağlık yalnız gerçek sinyallerden türetilir (bilinmeyen kalp atışı sağlıklı sayılmaz).
export function buildWatchdogStatus({control,doc,heartbeat,health,wake,logCheck,lastTransition,discovery,globalStop,producer,now,policy,controlPlane=null}){
  const d=policy.daemon,pk=control?.packages??{},order=control?.order??Object.keys(pk),live=order.map(id=>pk[id]).filter(p=>p&&!TERMINAL.includes(p.status));
  const next=control?nextAction(control,now):null,inFlight=live.find(p=>p.inFlight)??null,activeId=inFlight?.id??next?.packageId??null,active=activeId?pk[activeId]:null;
  const blockedLanes=[...live.filter(p=>p.status==="FOUNDER_DECISION_PENDING"||p.status==="QUEUED").map(p=>({kind:"package",id:p.id,status:p.status,reason:p.blockedReason??null})),
    ...Object.entries(control?.releases??{}).filter(([,r])=>["FOUNDER_DECISION_PENDING","WAITING_FOR_SECURE_SIGNER"].includes(r.status)).map(([k,r])=>({kind:"release",id:k,status:r.status,reason:r.blockedReason??r.signerReason??null})),
    ...Object.entries(control?.providers??{}).filter(([,p])=>p?.status==="QUOTA_BLOCKED").map(([k,p])=>({kind:"provider",id:k,status:p.status,reason:p.retryAfter?`retry ${p.retryAfter}`:null}))];
  const founderDecisions=[...(doc?.openFounderDecisions??[]).map(x=>({id:x.id??null,packageId:x.packageId??null,question:x.question??null,openedAt:x.openedAt??null})),
    ...live.filter(p=>p.status==="FOUNDER_DECISION_PENDING").map(p=>({id:null,packageId:p.id,question:p.blockedReason??null,openedAt:null})),
    ...Object.entries(control?.releases??{}).filter(([,r])=>r.status==="FOUNDER_DECISION_PENDING").map(([k,r])=>({id:null,packageId:`release:${k}`,question:r.blockedReason??null,openedAt:null}))];
  const signing=Object.entries(control?.releases??{}).filter(([,r])=>["SIGN_PENDING","WAITING_FOR_SECURE_SIGNER"].includes(r.status));
  const signer=signing.length?{status:signing.some(([,r])=>r.status==="WAITING_FOR_SECURE_SIGNER")?"WAITING_FOR_SECURE_SIGNER":"SIGN_PENDING",releases:signing.map(([k,r])=>({release:k,status:r.status,signerReason:r.signerReason??null,notBefore:r.notBefore??null}))}:{status:"NO_SIGNING_PENDING",releases:[]};
  const phaseRel=Object.entries(control?.releases??{}).filter(([,r])=>["PHASE0_PENDING","PHASE0_DONE"].includes(r.status)).map(([k,r])=>({release:k,status:r.status}));
  const phase0={accepted:control?.phase0?.accepted===true,final:control?.phase0?.final??null,releaseKey:control?.phase0?.releaseKey??null,attempts:control?.phase0?.attempts?.length??0,installedAutostart:control?.phase0?.installedAutostart??null,releases:phaseRel};
  const hbAge=heartbeat?.heartbeatAt?Math.round((now.getTime()-Date.parse(heartbeat.heartbeatAt))/1000):null,reasons=[];let overall;
  if(globalStop){overall="STOPPED";reasons.push("GLOBAL_STOP_ACTIVE")}else if(heartbeat?.state==="STOPPED"){overall="STOPPED";reasons.push(`SUPERVISOR_STOPPED:${heartbeat.reason??"UNKNOWN"}`)}
  else if(!health?.healthy){overall="UNHEALTHY";reasons.push(health?.reason??"HEARTBEAT_UNKNOWN")}else if(!control){overall="UNHEALTHY";reasons.push("NO_CONTROL_STATE")}else if(!logCheck?.ok){overall="UNHEALTHY";reasons.push(`TRANSITION_LOG:${logCheck?.reason??"UNKNOWN"}`)}
  else if(next||inFlight)overall="HEALTHY";else if(live.some(p=>REVIEW_STATUSES.includes(p.status)||IMPLEMENTATION_STATUSES.includes(p.status))&&blockedLanes.some(b=>b.kind==="provider"))overall="WAITING_PROVIDER";else if(founderDecisions.length)overall="FOUNDER_DECISION_REQUIRED";else overall="HEALTHY";
  if(founderDecisions.length)reasons.push(`FOUNDER_DECISIONS_PENDING:${founderDecisions.length}`);for(const b of blockedLanes.filter(x=>x.kind==="provider"))reasons.push(`PROVIDER_BLOCKED:${b.id}`);
  for(const [k,v] of Object.entries({gitRefs:discovery?.gitRefs,worktrees:discovery?.worktrees,...Object.fromEntries(Object.entries(discovery?.scheduler??{}).map(([n,t])=>[`scheduler.${n}`,t]))}))if(!v||v.status!=="OK")reasons.push(`DISCOVERY_UNAVAILABLE:${k}`);
  return {"//TR":"Bu dosya UASCO-Autonomous-Supervisor tarafından atomik olarak yazılan pasif durum çıktısıdır; bir karar, onay veya durum geçişi değildir ve yalnız okunmak içindir.",
    schemaVersion:WATCHDOG_STATUS_VERSION,updatedAt:now.toISOString(),staleAfterSeconds:Math.round(Math.max(d.staleHeartbeatMinutes,d.sleepChunkSeconds/60*2)*60),producer:{name:policy.autostart.taskName,...producer},observer:"PASSIVE_READ_ONLY_OPTIONAL",
    overallHealth:overall,healthReasons:reasons,
    supervisor:{state:heartbeat?.state??null,healthy:health?.healthy===true,reason:health?.reason??null,heartbeatAt:heartbeat?.heartbeatAt??null,heartbeatAgeSeconds:hbAge,iteration:heartbeat?.iteration??null,pid:heartbeat?.pid??null,globalStop:globalStop?{active:true,reason:globalStop.reason??null}:{active:false}},
    master:discovery?.gitRefs?.status==="OK"?{status:"OK",...discovery.gitRefs.defaultBranch}:{status:"UNAVAILABLE",ref:policy.merge.defaultBranchRef,sha:null},
    activePackage:active?{id:active.id,status:active.status,cycle:active.cycle,nextAction:active.nextAction??null,inFlight:Boolean(active.inFlight)}:null,
    queues:{implementation:live.filter(p=>IMPLEMENTATION_STATUSES.includes(p.status)).length,review:live.filter(p=>REVIEW_STATUSES.includes(p.status)).length,readyToMerge:live.filter(p=>p.status==="REVIEW_CLEAN").length,founderDecisionPending:live.filter(p=>p.status==="FOUNDER_DECISION_PENDING").length,total:live.length},
    blockedLanes,codex:control?.providers?.codex??null,claude:control?.providers?.claude??null,claudeReviewer:control?.providers?.claudeReviewer??null,dualReview:control?.dualReview??null,signer,phase0,
    controlPlane:controlPlane?{commit:controlPlane.commit??null,path:controlPlane.path??null,activatedAt:controlPlane.activatedAt??null,previousCommit:controlPlane.previous?.commit??null}:null,
    lastSuccessfulAction:lastTransition??null,nextScheduledAction:{action:next,nextWakeAt:wake?.at??heartbeat?.nextWakeAt??null,wakeReason:wake?.reason??heartbeat?.wakeReason??null},founderDecisions,
    discovery:{at:discovery?.at??null,gitRefs:discovery?.gitRefs??{status:"UNAVAILABLE",reason:"NOT_YET_DISCOVERED"},worktrees:discovery?.worktrees??{status:"UNAVAILABLE",reason:"NOT_YET_DISCOVERED"},scheduler:discovery?.scheduler??null,
      transitionLog:{ok:logCheck?.ok===true,entries:logCheck?.entries??null,unapplied:logCheck?.unapplied??null,reason:logCheck?.reason??null,lastSeq:control?.lastTransition?.seq??null,lastAt:control?.lastTransition?.at??null},providers:control?.providers??{}}};
}
// //TR: Yazıcı: keşif en fazla discoveryMinutes'te bir (ve istendiğinde) yenilenir, durum her çağrıda atomik yazılır; yazma hatası daemon'u durdurmaz, çağırana bildirilir.
export function createWatchdogStatusWriter({policy,runner,repo,file=watchdogStatusPath(policy),read,now=()=>new Date(),producer={}}){
  const w=validateWatchdogPolicy(policy);let discovery=null,discoveredAt=0;
  return function writeStatus({heartbeat=null,health=null,wake=null,refresh=false}={}){
    const t=now();if(refresh||!discovery||t.getTime()-discoveredAt>=w.discoveryMinutes*60_000){discovery=discoverEnvironment({runner,policy,repo,now});discoveredAt=t.getTime()}
    const s=read();const status=buildWatchdogStatus({...s,heartbeat,health,wake,discovery,producer,now:t,policy});writeJsonAtomic(file,status);return status};
}
export function readWatchdogStatus(file){return readJsonIfExists(file,null)}
