// //TR: Bu modül gözetimsiz orkestratörün kalıcı daemon döngüsüdür: her turda bir tick çalıştırır, sonra kalıcı kontrol durumundan en yakın uyanma zamanını (hazır iş, sağlayıcı retryAfter, paket/release notBefore, periyodik kalp atışı) hesaplar ve o zamana kadar WAITING durumunda uyur; Global Stop veya uyandırma dosyası uykuyu erken bitirir, canlılık atomik kalp atışı dosyasına yazılır; ölümcül hata daemon'u durdurur ve yeniden başlatma başlatıcıya bırakılır.
import fs from "node:fs";import path from "node:path";
import {writeJsonAtomic,readJsonIfExists} from "./atomic-json.mjs";import {nextAction,runTick,recoverInFlight} from "./orchestrator-engine.mjs";
import {loadState,commitTransition,verifyTransitionLog,acquireLease,heartbeat,releaseLease} from "./orchestrator-state.mjs";
export const SUPERVISOR_HEARTBEAT_VERSION="1.0.0";
export const SUPERVISOR_STATES=["STARTING","RUNNING","WAITING","STOPPED"];
// //TR: Daemon dosyaları kontrol kökünün altında sabit yerlerdedir; policy yalnız süreleri belirler.
export function daemonPaths(policy){const d=path.join(policy.roots.controlRoot,"supervisor");return {dir:d,heartbeat:path.join(d,"SUPERVISOR_HEARTBEAT.json"),wake:path.join(d,"WAKE"),lock:path.join(policy.roots.controlRoot,"orchestrator.lock"),logs:path.join(policy.roots.controlRoot,"logs")}}
export function validateDaemonPolicy(policy){const d=policy?.daemon,bad=r=>{throw new Error(`DAEMON_POLICY_INVALID:${r}`)};if(!d||typeof d!=="object")bad("MISSING");
  for(const k of ["heartbeatMinutes","maxSleepMinutes","sleepChunkSeconds","idleRetrySeconds","staleHeartbeatMinutes"])if(!Number.isFinite(d[k])||d[k]<=0)bad(k);if(d.maxSleepMinutes<d.heartbeatMinutes)bad("MAX_SLEEP_BELOW_HEARTBEAT");if(d.sleepChunkSeconds>d.heartbeatMinutes*60)bad("CHUNK_ABOVE_HEARTBEAT");return d}
// //TR: En yakın uyanma zamanı saf olarak hesaplanır; geçmişteki zamanlar hazır işe dönüşmediyse (bağımlılık bekliyor) kalp atışına düşülür; uyku hiçbir zaman maxSleep'i aşmaz.
export function nextWake(control,now,policy){
  const d=validateDaemonPolicy(policy),t0=now.getTime(),hb=t0+d.heartbeatMinutes*60_000,cap=t0+d.maxSleepMinutes*60_000;
  if(!control)return {at:new Date(hb).toISOString(),reason:"HEARTBEAT_NO_CONTROL_STATE",waitMs:hb-t0};
  if(nextAction(control,now))return {at:now.toISOString(),reason:"QUEUED_ACTION_READY",waitMs:0};
  const cands=[{t:hb,reason:"HEARTBEAT"}],add=(iso,reason)=>{const t=Date.parse(iso);if(Number.isFinite(t)&&t>t0)cands.push({t,reason})};
  for(const [k,p] of Object.entries(control.providers??{}))if(p?.status==="QUOTA_BLOCKED"&&p.retryAfter)add(p.retryAfter,`PROVIDER_RETRY:${k}`);
  for(const [id,p] of Object.entries(control.packages??{}))if(p?.notBefore&&!["CLOSED","MERGED","FOUNDER_DECISION_PENDING"].includes(p.status))add(p.notBefore,`NOT_BEFORE:${id}`);
  for(const [k,r] of Object.entries(control.releases??{}))if(r?.notBefore&&!["PHASE0_DONE","SUPERSEDED","FOUNDER_DECISION_PENDING"].includes(r.status))add(r.notBefore,`NOT_BEFORE:release:${k}`);
  // //TR: Kurulu sistem otomatik başlatma kaydının sınırlı yeniden denemesi kendi zamanında uyandırır; tükenmiş (engellenmiş) hat uyandırmaz.
  for(const [k,r] of Object.entries(control.releases??{}))if(r?.status==="PHASE0_DONE"&&r.autostart?.status==="RETRY_PENDING"&&r.autostart.notBefore)add(r.autostart.notBefore,`AUTOSTART_RETRY:release:${k}`);
  const best=cands.sort((a,b)=>a.t-b.t)[0],t=Math.min(best.t,cap);return {at:new Date(t).toISOString(),reason:best.reason,waitMs:t-t0};
}
export function readHeartbeat(file){return readJsonIfExists(file,null)}
// //TR: Kalp atışı yaşı policy eşiğini aşarsa veya süreç durmuşsa daemon sağlıksız sayılır; bilinmeyen/okunamayan kalp atışı sağlıklı sayılmaz.
export function heartbeatHealth(hb,now,policy){const d=validateDaemonPolicy(policy);if(!hb||!SUPERVISOR_STATES.includes(hb.state))return {healthy:false,reason:"HEARTBEAT_MISSING_OR_INVALID"};const age=now.getTime()-Date.parse(hb.heartbeatAt);if(!Number.isFinite(age))return {healthy:false,reason:"HEARTBEAT_TIME_INVALID"};
  if(hb.state==="STOPPED")return {healthy:false,reason:`SUPERVISOR_STOPPED:${hb.reason??"UNKNOWN"}`,ageMs:age};const limit=(hb.state==="RUNNING"?Math.max(d.staleHeartbeatMinutes,policy.tick?.maxTickMinutes??0):d.staleHeartbeatMinutes)*60_000;if(age>limit)return {healthy:false,reason:"HEARTBEAT_STALE",ageMs:age};return {healthy:true,state:hb.state,ageMs:age}}
// //TR: Uyku parçalı yapılır: kalp atışı yalnız parça zamanlayıcısıyla yenilenir ve her parçada durdurma koşulu denetlenir; yalnız uyandırma dosyası veya Global Stop dosyasındaki değişiklik uykuyu hemen bitirir (izleme olayı kalp atışı yazmaz, böylece aynı dizindeki kalp atışı dosyası kendini tetikleyemez; izleme kaçarsa parça sonu yoklaması yakalar).
export function createSleeper({wakeFile,watchFiles=[],chunkMs,shouldStop,onBeat=()=>{},now=()=>Date.now()}){
  const mtime=f=>{try{return fs.statSync(f).mtimeMs}catch{return 0}};
  const targets=[wakeFile,...watchFiles],dirs=[...new Set(targets.map(f=>path.dirname(f)))],names=new Set(targets.flatMap(f=>[path.basename(f),`${path.basename(f)}.prev`]));
  // //TR: Uyandırma taban çizgisi çağıranın tick başında gördüğü zamandır (wakeBaselineMs); tick veya kalp atışı/durum yazımı sırasında gelen istek kaybolmaz.
  const sleepUntil=function sleepUntil(untilMs,meta={}){return new Promise(resolve=>{const startWake=Number.isFinite(meta?.wakeBaselineMs)?meta.wakeBaselineMs:mtime(wakeFile),watchers=[];let timer=null,done=false;
    const finish=reason=>{if(done)return;done=true;clearTimeout(timer);for(const w of watchers)try{w.close()}catch{};resolve(reason)};
    const check=beat=>{if(done)return;const s=shouldStop();if(s)return finish(`STOP:${s}`);if(mtime(wakeFile)>startWake)return finish("WAKE_FILE");if(now()>=untilMs)return finish("TIME");if(beat)onBeat();clearTimeout(timer);timer=setTimeout(()=>check(true),Math.max(10,Math.min(chunkMs,untilMs-now())))};
    for(const d of dirs){try{fs.mkdirSync(d,{recursive:true});watchers.push(fs.watch(d,(ev,name)=>{if(name===null||name===undefined||names.has(String(name)))setImmediate(()=>check(false))}))}catch{}}
    check(false)})};
  sleepUntil.wakeMtime=()=>mtime(wakeFile);return sleepUntil;
}
// //TR: Daemon döngüsü: bağımlılıklar enjekte edilir (üretimde CLI, testte gerçek süreçli koşum); her tur sonucu ve bir sonraki uyanma kalp atışına yazılır; hiçbir şey yapmayan anlık tekrar idleRetry ile sınırlanır.
export async function runDaemon({policy,tickOnce,loadControl,sleepUntil,shouldStop,writeHeartbeat,now=()=>new Date(),maxIterations=Infinity,log=()=>{},afterTick=null}){
  const d=validateDaemonPolicy(policy);let iteration=0;writeHeartbeat({state:"STARTING",iteration});
  while(iteration<maxIterations){
    const stop=shouldStop();if(stop){writeHeartbeat({state:"STOPPED",iteration,reason:stop});return {status:"STOPPED",reason:stop,iteration}}
    iteration++;const wakeBaselineMs=typeof sleepUntil.wakeMtime==="function"?sleepUntil.wakeMtime():undefined;writeHeartbeat({state:"RUNNING",iteration});let r;
    try{r=await tickOnce(iteration)}catch(e){r={status:"TICK_EXCEPTION",fatal:true,reason:String(e?.message??e)}}
    log({event:"TICK",iteration,status:r.status,done:r.done??[]});
    if(r.fatal){writeHeartbeat({state:"STOPPED",iteration,reason:r.status,detail:r.reason??null});return {status:r.status,fatal:true,reason:r.reason??null,iteration}}
    if(r.stop){writeHeartbeat({state:"STOPPED",iteration,reason:r.status});return {status:"STOPPED",reason:r.status,iteration}}
    // //TR: Tick sonrası kanca (ör. denetimli kendini güncelleme): durdurma isterse daemon kendi çıkış koduyla temiz durur.
    if(afterTick){const u=await afterTick(r,iteration);if(u?.stop){writeHeartbeat({state:"STOPPED",iteration,reason:u.status});return {status:u.status,reason:u.reason??null,iteration,exitCode:u.exitCode??0}}}
    let wake=nextWake(loadControl(),now(),policy);
    if(wake.waitMs===0&&!(r.done?.length))wake={...wake,at:new Date(now().getTime()+d.idleRetrySeconds*1000).toISOString(),waitMs:d.idleRetrySeconds*1000,reason:`${wake.reason}_NO_PROGRESS_IDLE_RETRY`};
    const lastTick={status:r.status,actions:(r.done??[]).length};writeHeartbeat({state:wake.waitMs>0?"WAITING":"RUNNING",iteration,nextWakeAt:wake.at,wakeReason:wake.reason,lastTick});
    if(wake.waitMs>0){const why=await sleepUntil(Date.parse(wake.at),{iteration,nextWakeAt:wake.at,wakeReason:wake.reason,lastTick,wakeBaselineMs});log({event:"WAKE",iteration,why})}
  }
  writeHeartbeat({state:"STOPPED",iteration,reason:"MAX_ITERATIONS"});return {status:"MAX_ITERATIONS",iteration};
}
export function createHeartbeatWriter({file,base}){let last={};return function writeHeartbeat(fields){last={...last,...fields};if(fields.state!=="WAITING"&&fields.state!=="RUNNING"){delete last.nextWakeAt;delete last.wakeReason}const doc={"//TR":"Bu dosya gözetimsiz orkestratör daemon'unun canlılığını ve bir sonraki uyanma nedenini taşır; bir karar veya durum geçişi değildir.",schemaVersion:SUPERVISOR_HEARTBEAT_VERSION,...base,...last,heartbeatAt:new Date().toISOString()};writeJsonAtomic(file,doc);return doc}}
// //TR: Tek tick (CLI --tick ve --daemon ile testler aynı kodu kullanır): günlük doğrulaması, lease, yarım eylem kurtarma, isteğe bağlı Founder manuel kota sıfırlaması, günlük GitHub durumu, bağımlılık farkında eylemler; lease her durumda bırakılır. Sonuç nesne olarak döner.
export function createTick({policy,workerId,runner,executors,now=()=>new Date(),shouldStop=()=>null,controlPlaneCommit=null}){
  const ttl=policy.tick.leaseTtlMinutes*60_000,stateFile=policy.roots.stateFile,logFile=policy.roots.transitionLog;
  return async function tickOnce({manualReset=null}={}){
    let {doc,control}=loadState(stateFile);if(!control)return {status:"NO_CONTROL_STATE",code:0,done:[]};
    const log=verifyTransitionLog(logFile,control);if(!log.ok)return {status:"TRANSITION_LOG_INVALID",reason:log.reason,code:2,fatal:true};
    const lease=acquireLease(control,{workerId,now:now(),ttlMs:ttl});if(!lease.ok)return {status:"LEASE_HELD",holder:lease.holder,code:0,done:[]};
    const commit=(next,event)=>{const r=commitTransition({stateFile,logFile,doc,next,event});doc=r.doc;return r.control};
    const persist=(next,event)=>commit(heartbeat({...next,lease:next.lease??control.lease},{workerId,now:now(),ttlMs:ttl}),event);
    control=commit(lease.control,{type:"LEASE_ACQUIRED",reason:lease.stale?`STALE_LEASE_TAKEN_OVER:${lease.previous.workerId}`:null});
    try{
      const rec=recoverInFlight(control,workerId);if(rec.recovered.length)control=persist(rec.control,{type:"INFLIGHT_RECOVERED",evidence:rec.recovered});
      // //TR: DUAL_REVIEW_REQUIRED bir kez, etkinleştiren kontrol düzlemi commit'iyle kaydedilir; tarihsel yalnız-Codex CLEAN kanıtları geçerli kalır, açık paketler ek CLAUDE_REVIEWER incelemesi alır.
      if(policy.review?.dualReviewRequired===true&&control.dualReview?.active!==true)control=persist({...control,dualReview:{active:true,activatedAt:now().toISOString(),policy:"DUAL_REVIEW_REQUIRED",activationCommit:controlPlaneCommit,historicalCodexOnlyCleanRemainsValid:true}},{type:"DUAL_REVIEW_ACTIVATED",reason:`DUAL_REVIEW_REQUIRED from control plane ${controlPlaneCommit??"unknown"}`});
      if(manualReset){if(!["codex","claude","claudeReviewer"].includes(manualReset))return {status:"USAGE",reason:"provider must be codex, claude or claudeReviewer",code:2};control=persist({...control,providers:{...(control.providers??{}),[manualReset]:{status:"PROBE_PENDING_FOUNDER_RESET",retryAfter:null,manualResetAt:now().toISOString()}}},{type:"FOUNDER_MANUAL_QUOTA_RESET",packageId:manualReset,reason:"stale retryAfter invalidated; one controlled probe"})}
      // //TR: GitHub durumu günde bir kez dürüstçe kaydedilir; branch protection yoksa yerel mod ve kuyrukta bekleyen push olarak kalır, taklit edilmez.
      if(!control.github?.checkedAt||now().getTime()-Date.parse(control.github.checkedAt)>86_400_000){const a=runner.run("gh.authStatus"),v=runner.run("gh.repoView"),bp=runner.run("gh.branchProtection");let repoInfo=null;try{repoInfo=JSON.parse(v.stdout)}catch{}const account=(`${a.stdout}\n${a.stderr}`.match(/account ([A-Za-z0-9-]+)/)??[])[1]??null;
        const protection=bp.status===0?"PRESENT_UNVERIFIED_RULES":/Upgrade to GitHub Pro/i.test(bp.stdout+bp.stderr)?"UNAVAILABLE_PLAN_LIMIT":/not protected/i.test(bp.stdout+bp.stderr)?"NOT_CONFIGURED":"UNKNOWN";
        control=persist({...control,github:{checkedAt:now().toISOString(),account,expectedOwner:policy.github.expectedOwner,ownerMatches:account===policy.github.expectedOwner,repository:repoInfo?.nameWithOwner??null,visibility:repoInfo?.visibility??null,remote:repoInfo?.url??null,remoteMatches:repoInfo?.url===policy.github.expectedRemote,branchProtection:protection,constructionRepoPush:"QUEUED_REMOTE_PROTECTION_POLICY"}},{type:"GITHUB_STATUS",reason:protection})}
      // //TR: Global Stop her eylemden önce denetlenir; tick durdurulduysa sonuç durma olarak döner (daemon temiz durur, --tick durduğunu raporlar).
      const t=await runTick({control,executors,persist,policy,workerId,now,shouldStop});control=t.control;
      if(t.stopped)return {status:"TICK_STOPPED_GLOBAL_STOP",stopped:t.stopped,stop:true,done:t.done,control,code:0};
      return {status:"TICK_DONE",done:t.done,control,code:0};
    }finally{try{const cur=loadState(stateFile);if(cur.control?.lease?.workerId===workerId){doc=cur.doc;commit(releaseLease(cur.control,{workerId}),{type:"LEASE_RELEASED"})}}catch{}}
  };
}
