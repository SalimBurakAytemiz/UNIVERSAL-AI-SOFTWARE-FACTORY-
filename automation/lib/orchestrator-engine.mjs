// //TR: Bu motor gözetimsiz orkestratörün bağımlılık farkında planlayıcısıdır: kalıcı kontrol durumundan bir sonraki uygun eylemi seçer, enjekte edilen yürütücünün sonucunu durum geçişine çevirir; sağlayıcı kotası review cycle/format/remediation hakkı tüketmez ve yalnız o sağlayıcıya bağlı işleri bekletir, Founder kararı yalnız ilgili paketi/release'i durdurur, geçici hatalar sınırlı geri çekilmeyle yeniden denenir, yarım kalan eylemler idempotent yürütücülerle toparlanır.
export const ACTIONS=["REVIEW","REMEDIATE","IMPLEMENT","MERGE","CLOSE","PACKAGE","SIGN","PHASE0","AUTOSTART"];
const TERMINAL=["CLOSED","MERGED"];
const clone=x=>JSON.parse(JSON.stringify(x));
const minutes=(now,m)=>new Date(now.getTime()+m*60_000).toISOString();
// //TR: Sağlayıcının bildirdiği tekrar zamanı yalnız geçerli ve gelecekteyse kullanılır; eski veya bozuk zaman policy backoff'una düşer, aynı tick'te tekrar çağrı olmaz.
const futureIso=(v,now)=>{const t=Date.parse(v??"");return Number.isFinite(t)&&t>now.getTime()?new Date(t).toISOString():null};
export function releaseKey(commit){return String(commit).slice(0,7)}
export function dependenciesMet(control,pkg){
  for(const d of pkg.dependsOn??[]){
    if(d.package){const p=control.packages[d.package];if(!p||!(d.statusIn??TERMINAL).includes(p.status))return false}
    if(d.release){const r=control.releases?.[d.release];if(!r||!(d.statusIn??["PHASE0_DONE"]).includes(r.status))return false}
  }
  return true;
}
function conditionsMet(control,conds){return dependenciesMet(control,{dependsOn:conds??[]})}
// //TR: Sağlayıcı ancak AVAILABLE ise, Founder manuel sıfırlama sonrası tek probe bekliyorsa veya retryAfter geçmişse "due" sayılır.
export function providerDue(control,provider,now){const p=control.providers?.[provider];if(!p||p.status==="AVAILABLE"||p.status==="PROBE_PENDING_FOUNDER_RESET")return true;return !p.retryAfter||Date.parse(p.retryAfter)<=now.getTime()}
const due=(x,now)=>!x.notBefore||Date.parse(x.notBefore)<=now.getTime();
// //TR: Kurulu sistem otomatik başlatma kaydı, kabul edilmiş kurulumdan bağımsız kendi hattıdır: başarısız kayıt sınırlı sayıda, artan beklemeyle yeniden denenir; hak bitince hat açıkça REGISTRATION_BLOCKED_RETRIES_EXHAUSTED olur. Release PHASE0_DONE kalır (kabul ve dependent'lar korunur); bilinmeyen kayıt sonucu kayıtlı sayılmaz.
export function autostartDue(r,now){return r?.status==="PHASE0_DONE"&&r.autostart?.status==="RETRY_PENDING"&&(!r.autostart.notBefore||Date.parse(r.autostart.notBefore)<=now.getTime())}
function autostartLane(prev,rec,now,policy,blockedReason=null){
  const attempts=(prev?.attempts??0)+1,max=Math.max(1,Math.floor(Number(policy?.phase0?.maxAutostartRegistrationAttempts)||5)),at=now.toISOString(),last=rec?{status:rec.status??null,taskName:rec.taskName??null,exitCode:rec.exitCode??null,detail:rec.detail??null,at:rec.at??at}:{status:"UNKNOWN_NO_REGISTRATION_RECORD",at};
  if(rec?.status==="REGISTERED")return {status:"REGISTERED",taskName:rec.taskName??null,attempts,adopted:rec.adopted===true,registeredAt:rec.at??at,last};
  if(blockedReason)return {status:"REGISTRATION_BLOCKED",reason:blockedReason,attempts,max,blockedAt:at,last};
  if(attempts>=max)return {status:"REGISTRATION_BLOCKED_RETRIES_EXHAUSTED",reason:`REGISTRATION_FAILED_${attempts}_OF_${max}`,attempts,max,blockedAt:at,last};
  return {status:"RETRY_PENDING",attempts,max,notBefore:minutes(now,Math.min(5*2**(attempts-1),360)),last};
}
export function nextAction(control,now,{skip=new Set()}={}){
  for(const id of control.order){
    const p=control.packages[id],key=`P:${id}`;if(skip.has(key)||TERMINAL.includes(p.status)||p.status==="FOUNDER_DECISION_PENDING"||!due(p,now)||!dependenciesMet(control,p))continue;
    if(["REVIEW_PENDING","REVIEW_PENDING_PROVIDER_QUOTA"].includes(p.status)){if(providerDue(control,"codex",now))return {type:"REVIEW",packageId:id,key};continue}
    if(p.status==="REMEDIATION_PENDING"){if(providerDue(control,"claude",now))return {type:"REMEDIATE",packageId:id,key};continue}
    // //TR: Backend beklemesi nedeniyle kuyruğa alınan iş, kuyruğa alındığı eylemle (remediation ise aynı bulgular, frozen contract ve bir sonraki cycle ile) sürer.
    if(["IMPLEMENT_PENDING","QUEUED"].includes(p.status)){if(providerDue(control,"claude",now))return {type:p.status==="QUEUED"&&p.queuedAction==="REMEDIATE"?"REMEDIATE":"IMPLEMENT",packageId:id,key};continue}
    if(p.status==="REVIEW_CLEAN"){if(p.merge?.mode==="FF_DEFAULT_BRANCH"){if(conditionsMet(control,p.merge.after))return {type:"MERGE",packageId:id,key};continue}return {type:"CLOSE",packageId:id,key}}
  }
  for(const [rk,r] of Object.entries(control.releases??{})){
    const key=`R:${rk}`;if(skip.has(key))continue;
    if(r.status==="PHASE0_DONE"){if(autostartDue(r,now))return {type:"AUTOSTART",releaseKey:rk,key};continue}
    if(!due(r,now))continue;
    if(r.status==="PACKAGE_PENDING")return {type:"PACKAGE",releaseKey:rk,key};
    if(["SIGN_PENDING","WAITING_FOR_SECURE_SIGNER"].includes(r.status))return {type:"SIGN",releaseKey:rk,key};
    if(r.status==="PHASE0_PENDING")return {type:"PHASE0",releaseKey:rk,key};
  }
  return null;
}
function founder(target,reason,classification="FOUNDER_DECISION_REQUIRED"){target.status="FOUNDER_DECISION_PENDING";target.blockedReason=reason;target.classification=classification;target.nextAction="FOUNDER_DECISION"}
function transient(target,now,reason,policy){const n=(target.transientFailures??0)+1;target.transientFailures=n;target.lastTransientError=reason;if(n>=(policy.tick?.maxTransientRetries??5)){const prior=target.status;founder(target,`RECOVERABLE_RETRIES_EXHAUSTED(${prior}): ${reason}`,"RECOVERABLE_RETRIES_EXHAUSTED");return}target.notBefore=minutes(now,Math.min(5*2**(n-1),360))}
// //TR: Sonuç -> geçiş; dönen olay denetim günlüğüne yazılır.
export function applyOutcome(controlIn,action,outcome,now,policy){
  const control=clone(controlIn),o=outcome??{type:"ENV_ERROR",reason:"NO_OUTCOME"},ev={type:`${action.type}_${o.type}`,packageId:action.packageId??action.releaseKey??null,reason:o.reason??null,evidence:o.evidence??o.runDir??null};
  control.providers=control.providers??{};
  if(action.packageId){
    const p=control.packages[action.packageId];ev.from=p.status;delete p.inFlight;
    if(o.type==="ENV_ERROR"){transient(p,now,o.reason,policy)}
    else if(action.type==="REVIEW"){
      if(o.type==="QUOTA"){const prev=control.providers.codex??{},back=Math.min((prev.backoffMinutes?prev.backoffMinutes*2:policy.providers.codex.quotaBackoffMinutes),policy.providers.codex.quotaBackoffMaxMinutes);const ra=futureIso(o.retryAfter,now);control.providers.codex={status:"QUOTA_BLOCKED",retryAfter:ra??minutes(now,back),backoffMinutes:ra?null:back,lastEvidence:o.evidence??null,since:prev.since??now.toISOString()};p.status="REVIEW_PENDING_PROVIDER_QUOTA";p.quotaBlocks=[...(p.quotaBlocks??[]),o.evidence??null];p.nextAction="REVIEW_AT_PROVIDER_RETRY"}
      else{control.providers.codex={status:"AVAILABLE",retryAfter:null};p.transientFailures=0;if(o.type!=="FORMAT_REJECTED"){p.formatCorrection=false;delete p.formatRejection}
        if(o.type==="CLEAN"){p.status="REVIEW_CLEAN";p.review={result:"CLEAN",runDir:o.runDir,evidence:o.evidence,cycle:p.cycle};p.nextAction=p.merge?.mode==="FF_DEFAULT_BRANCH"?"MERGE_WHEN_ELIGIBLE":"CLOSE"}
        else if(o.type==="BLOCKED"){p.review={result:"BLOCKED",runDir:o.runDir,findings:o.findings??[],ledgerFile:o.ledgerFile??null,cycle:p.cycle};if(p.cycle>=(policy.review.maxReviewCycles??2))founder(p,"REVIEW_CYCLE_LIMIT_REACHED_WITH_OPEN_BLOCKERS");else if(p.remediation?.authorized===true){p.status="REMEDIATION_PENDING";p.nextAction="REMEDIATE"}else founder(p,"BLOCKED_WITHOUT_REMEDIATION_AUTHORITY")}
        else if(o.type==="FORMAT_REJECTED"){const n=(p.formatRetries??0)+1;if(n>(policy.review.formatRetryLimit??1))founder(p,"REVIEW_FORMAT_RETRY_EXHAUSTED");else{p.formatRetries=n;p.formatCorrection=true;p.formatRejection={runDir:o.runDir??null,reason:o.reason??null,at:now.toISOString()};p.status="REVIEW_PENDING";p.nextAction="REVIEW_FORMAT_CORRECTION"}}
        else founder(p,o.reason??o.type,o.type==="INPUT_INVALID"?"ORCHESTRATOR_INPUT_DEFECT":"FOUNDER_DECISION_REQUIRED");
      }
    }
    else if(action.type==="REMEDIATE"||action.type==="IMPLEMENT"){
      if(o.type==="QUOTA"){const prev=control.providers.claude??{},back=Math.min((prev.backoffMinutes?prev.backoffMinutes*2:policy.providers.claude.quotaBackoffMinutes),policy.providers.claude.quotaBackoffMaxMinutes);const ra=futureIso(o.retryAfter,now);control.providers.claude={status:"QUOTA_BLOCKED",retryAfter:ra??minutes(now,back),backoffMinutes:ra?null:back,lastEvidence:o.evidence??null}}
      else if(o.type==="COMMITTED"){control.providers.claude={status:"AVAILABLE",retryAfter:null};delete p.queuedAction;delete p.formatRejection;Object.assign(p,{status:"REVIEW_PENDING",reviewCommit:o.commit,baseCommit:o.baseCommit??p.baseCommit,implementationCommit:o.commit,bundle:o.bundle,cycle:o.cycle??p.cycle,formatRetries:0,formatCorrection:false,executionBackend:o.executionBackend??p.executionBackend??null,executionProvenance:o.provenance??p.executionProvenance??null,transientFailures:0,nextAction:"REVIEW"})}
      else if(o.type==="QUEUED"){p.status="QUEUED";p.queuedAction=action.type;p.notBefore=futureIso(o.retryAfter,now)??minutes(now,30);p.blockedReason=o.reason??null;p.nextAction=`${action.type}_WHEN_BACKEND_AVAILABLE`}
      else founder(p,o.reason??o.type);
    }
    else if(action.type==="MERGE"){
      if(o.type==="MERGED"){p.status="CLOSED";p.mergedAt=now.toISOString();p.mergedCommit=o.master;p.nextAction=null;
        if(p.release===true){control.releases=control.releases??{};const rk=releaseKey(p.reviewCommit);for(const r of Object.values(control.releases))if(!["PHASE0_DONE","SUPERSEDED"].includes(r.status)){r.status="SUPERSEDED";r.supersededBy=rk}control.releases[rk]={sourceCommit:p.reviewCommit,fromPackage:p.id,status:"PACKAGE_PENDING",createdAt:now.toISOString(),nextAction:"PACKAGE"}}}
      else founder(p,o.reason??"MERGE_NOT_FAST_FORWARD");
    }
    else if(action.type==="CLOSE"){p.status="CLOSED";p.nextAction=null}
    ev.to=p.status;return {control,event:ev};
  }
  const r=control.releases[action.releaseKey];ev.from=r.status;delete r.inFlight;
  // //TR: Otomatik başlatma kaydı denemesi yalnız kendi hattını günceller; yürütücü hatası da sınırlı bir deneme sayılır ve release'i Founder kararına düşürmez, kabul edilmiş kurulumu geri almaz.
  if(action.type==="AUTOSTART"){const rec=o.type==="REGISTERED"?(o.installedAutostart??{status:"REGISTERED"}):{...(o.installedAutostart??{}),status:"REGISTRATION_FAILED",detail:o.installedAutostart?.detail??o.reason??o.type};
    r.autostart=autostartLane(r.autostart,rec,now,policy,o.type==="NOT_APPLICABLE"?(o.reason??"NOT_APPLICABLE"):null);if(control.phase0?.releaseKey===action.releaseKey)control.phase0.installedAutostart=r.autostart;ev.reason=`${r.autostart.status}${o.reason?`: ${o.reason}`:""}`}
  else if(o.type==="ENV_ERROR")transient(r,now,o.reason,policy);
  else if(action.type==="PACKAGE"){if(o.type==="PACKAGED"){r.status="SIGN_PENDING";r.packaging=o.record;r.transientFailures=0;r.nextAction="SIGN"}else founder(r,o.reason??"PACKAGING_FAILED")}
  else if(action.type==="SIGN"){
    if(o.type==="SIGNED"){r.signatures=o.signatures;r.transientFailures=0;const accepted=control.phase0?.accepted===true&&control.phase0.releaseKey!==action.releaseKey;if(accepted)founder(r,"REINSTALL_OVER_ACCEPTED_INSTALLATION_REQUIRES_FOUNDER");else{r.status="PHASE0_PENDING";r.nextAction="PHASE0"}}
    else if(o.type==="WAITING_FOR_SECURE_SIGNER"){r.status="WAITING_FOR_SECURE_SIGNER";r.signerReason=o.reason??null;r.notBefore=minutes(now,30);r.nextAction="SIGN_WHEN_SECURE_SIGNER_AVAILABLE"}
    else founder(r,o.reason??"SIGNING_FAILED");
  }
  else if(action.type==="PHASE0"){
    control.phase0=control.phase0??{attempts:[]};control.phase0.attempts=[...(control.phase0.attempts??[]),{releaseKey:action.releaseKey,at:now.toISOString(),result:o.type,final:o.final??null,evidence:o.evidence??null}];
    if(o.type==="PHASE0_DONE"&&["CLEAN","CLEAN_LOCAL_ONLY"].includes(o.final)){r.status="PHASE0_DONE";r.phase0Final=o.final;r.nextAction=null;r.autostart=autostartLane(null,o.installedAutostart??null,now,policy);Object.assign(control.phase0,{accepted:true,final:o.final,releaseKey:action.releaseKey,installRoot:o.installRoot??null,installedAutostart:r.autostart})}
    else founder(r,o.reason??`PHASE0_FAILED:${o.final??"UNKNOWN"}`,"PHASE0_FAILED_NEEDS_REMEDIATION_PACKAGE");
  }
  ev.to=r.status;return {control,event:ev};
}
// //TR: Önceki worker'dan kalan yarım eylem işaretleri temizlenir; yürütücüler idempotent olduğundan eylem güvenle yeniden planlanır (tamamlanmış review/merge/paket/imza yeniden yapılmaz, benimsenir).
export function recoverInFlight(controlIn,workerId){const control=clone(controlIn),recovered=[];for(const x of [...Object.values(control.packages),...Object.values(control.releases??{})])if(x.inFlight&&x.inFlight.workerId!==workerId){recovered.push({target:x.id??x.sourceCommit,action:x.inFlight.action,workerId:x.inFlight.workerId});delete x.inFlight}return {control,recovered}}
// //TR: Global Stop (shouldStop) her eylemden önce denetlenir; durdurma nedeniyle kesilen bir eylemin sonucu uygulanmaz (yarım eylem işareti sonraki tick'te idempotent kurtarılır) ve tick durur.
export async function runTick({control:start,executors,persist,policy,workerId,now=()=>new Date(),maxActions,shouldStop=()=>null}){
  let control=start,stopped=null;const done=[],skip=new Set(),perTarget=new Map(),limit=maxActions??policy.tick?.maxActionsPerTick??12;
  const stopNow=()=>{try{return shouldStop()}catch(e){return `STOP_CHECK_FAILED_FAIL_CLOSED:${e?.message??e}`}};
  for(let i=0;i<limit;i++){
    stopped=stopNow();if(stopped)break;
    const a=nextAction(control,now(),{skip});if(!a)break;const t=now();
    const marked=clone(control),target=a.packageId?marked.packages[a.packageId]:marked.releases[a.releaseKey];target.inFlight={action:a.type,workerId,startedAt:t.toISOString()};control=persist(marked,{type:`${a.type}_STARTED`,packageId:a.packageId??a.releaseKey});
    let outcome;const fn=executors[a.type.toLowerCase()];try{outcome=fn?await fn(a,control):{type:"ENV_ERROR",reason:`NO_EXECUTOR:${a.type}`}}catch(e){outcome={type:"ENV_ERROR",reason:String(e?.message??e)}}
    if(outcome.type==="ENV_ERROR"&&/GLOBAL_STOP_ACTIVE/.test(String(outcome.reason??""))){stopped=stopNow()??String(outcome.reason);break}
    const {control:next,event}=applyOutcome(control,a,outcome,now(),policy);control=persist(next,event);done.push({action:a.type,target:a.packageId??a.releaseKey,outcome:outcome.type});
    // //TR: Bir hedef aynı tick içinde ilerleyebilir (ör. CLEAN -> MERGE) ama sınırlı sayıda; engellenen hat diğer bağımsız işleri durdurmaz.
    const n=(perTarget.get(a.key)??0)+1;perTarget.set(a.key,n);if(n>=(policy.tick?.maxActionsPerTargetPerTick??6))skip.add(a.key);
  }
  return {control,done,stopped};
}
