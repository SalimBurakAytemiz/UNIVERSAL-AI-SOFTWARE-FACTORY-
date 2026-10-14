// //TR: Bu motor gözetimsiz orkestratörün bağımlılık farkında planlayıcısıdır: kalıcı kontrol durumundan bir sonraki uygun eylemi seçer, enjekte edilen yürütücünün sonucunu durum geçişine çevirir; sağlayıcı kotası review cycle/format/remediation hakkı tüketmez ve yalnız o sağlayıcıya bağlı işleri bekletir, Founder kararı yalnız ilgili paketi/release'i durdurur, geçici hatalar sınırlı geri çekilmeyle yeniden denenir, yarım kalan eylemler idempotent yürütücülerle toparlanır.
import {requiredReviewers,currentGate,gateStatus,computeReviewAggregate,nextReviewer,reviewSatisfiesGate,claudeOnlyGate,claudeOnlyPolicy,founderClaudeOnlyRecord,honouredBlockers,aggregateFindings,auditTarget,PROVIDER_STATE_KEY,REVIEWER_IDENTITY,CLAUDE_ONLY,CLAUDE_ONLY_RELEASE_QUORUM} from "./review-quorum.mjs";
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
    const p=control.packages[id],key=`P:${id}`;if(skip.has(key)||TERMINAL.includes(p.status)||p.status==="FOUNDER_DECISION_PENDING"||p.hold||!due(p,now)||!dependenciesMet(control,p))continue;
    // //TR: Çift inceleme gereken pakette her reviewer kendi sağlayıcı durumuna göre ayrı eylemdir; biri kotadayken diğeri ve bağımsız işler sürer.
    const reviewerDue=r=>providerDue(control,PROVIDER_STATE_KEY[r],now);
    // //TR: GOV2: etkin CLAUDE_ONLY kapısı yoksa sağlayıcısız REVIEW eylemi üretilir; yürütücü onu hiçbir inceleme çalıştırmadan Founder kararına düşürür (REVIEW_GATE_NOT_ACTIVATED), Codex asla zamanlanmaz.
    if(["REVIEW_PENDING","REVIEW_PENDING_PROVIDER_QUOTA"].includes(p.status)){if(!claudeOnlyGate(control))return {type:"REVIEW",packageId:id,key};const r=nextReviewer(p,control,reviewerDue);if(r)return {type:"REVIEW",packageId:id,provider:r,key:`${key}:${r}`};continue}
    // //TR: Etkinleştirmeden önce yalnız Codex ile CLEAN olmuş ama birleşmemiş paket, birleşmeden önce eksik CLAUDE_REVIEWER incelemesini alır (CLAUDE_ONLY altında da: yalnız Codex CLEAN'i yetmez).
    if(p.status==="REVIEW_CLEAN"&&!reviewSatisfiesGate(p,control)){if(!claudeOnlyGate(control))return {type:"REVIEW",packageId:id,key};const r=nextReviewer(p,control,reviewerDue);if(r)return {type:"REVIEW",packageId:id,provider:r,key:`${key}:${r}`};continue}
    if(p.status==="REMEDIATION_PENDING"){if(providerDue(control,"claude",now))return {type:"REMEDIATE",packageId:id,key};continue}
    // //TR: Backend beklemesi nedeniyle kuyruğa alınan iş, kuyruğa alındığı eylemle (remediation ise aynı bulgular, frozen contract ve bir sonraki cycle ile) sürer.
    if(["IMPLEMENT_PENDING","QUEUED"].includes(p.status)){if(providerDue(control,"claude",now))return {type:p.status==="QUEUED"&&p.queuedAction==="REMEDIATE"?"REMEDIATE":"IMPLEMENT",packageId:id,key};continue}
    if(p.status==="REVIEW_CLEAN"){if(p.merge?.mode==="FF_DEFAULT_BRANCH"){if(conditionsMet(control,p.merge.after))return {type:"MERGE",packageId:id,key};continue}return {type:"CLOSE",packageId:id,key}}
  }
  for(const [rk,r] of Object.entries(control.releases??{})){
    const key=`R:${rk}`;if(skip.has(key))continue;
    if(r.status==="PHASE0_DONE"){if(autostartDue(r,now))return {type:"AUTOSTART",releaseKey:rk,key};continue}
    if(!due(r,now))continue;
    // //TR: Son sürüm denetimi: önce aday için tam depo bundle'ı dondurulur, sonra her reviewer kendi sağlayıcı durumuna göre ayrı eylemdir; iki CLEAN olmadan paketleme planlanmaz.
    if(r.status==="AUDIT_PENDING"){if(!r.audit?.bundle)return {type:"AUDIT_FREEZE",releaseKey:rk,key};if(!claudeOnlyGate(control))return {type:"AUDIT",releaseKey:rk,key};const k=nextReviewer(auditTarget(r),control,x=>providerDue(control,PROVIDER_STATE_KEY[x],now));if(k)return {type:"AUDIT",releaseKey:rk,provider:k,key:`${key}:${k}`};continue}
    if(r.status==="PACKAGE_PENDING")return {type:"PACKAGE",releaseKey:rk,key};
    if(["SIGN_PENDING","WAITING_FOR_SECURE_SIGNER"].includes(r.status))return {type:"SIGN",releaseKey:rk,key};
    if(r.status==="PHASE0_PENDING")return {type:"PHASE0",releaseKey:rk,key};
  }
  return null;
}
// //TR: Politika son sürüm denetimini gerektiriyorsa yeni release adayı paketlemeden önce iki reviewer'ın tam depo denetimini bekler (CLAUDE_ONLY kapısı etkinse tek CLAUDE_FULL_REPO_REVIEW); denetim nesnesi yalnız bu adaya aittir.
function newAudit(rk,control){return {id:`RELEASE-AUDIT-${rk}`,required:true,cycle:1,policy:"CLAUDE_FULL_REPO_REVIEW"}}
function newRelease(p,rk,now,policy,control){const audit=policy?.releaseAudit?.required===true;return {sourceCommit:p.reviewCommit,fromPackage:p.id,status:audit?"AUDIT_PENDING":"PACKAGE_PENDING",createdAt:now.toISOString(),nextAction:audit?"RELEASE_AUDIT":"PACKAGE",...(audit?{audit:newAudit(rk,control)}:{})}}
function founder(target,reason,classification="FOUNDER_DECISION_REQUIRED"){target.status="FOUNDER_DECISION_PENDING";target.blockedReason=reason;target.classification=classification;target.nextAction="FOUNDER_DECISION"}
function transient(target,now,reason,policy){const n=(target.transientFailures??0)+1;target.transientFailures=n;target.lastTransientError=reason;if(n>=(policy.tick?.maxTransientRetries??5)){const prior=target.status;founder(target,`RECOVERABLE_RETRIES_EXHAUSTED(${prior}): ${reason}`,"RECOVERABLE_RETRIES_EXHAUSTED");return}target.notBefore=minutes(now,Math.min(5*2**(n-1),360))}
// //TR: Sonuç -> geçiş; dönen olay denetim günlüğüne yazılır.
export function applyOutcome(controlIn,action,outcome,now,policy){
  const control=clone(controlIn),o=outcome??{type:"ENV_ERROR",reason:"NO_OUTCOME"},ev={type:`${action.type}_${o.type}`,packageId:action.packageId??action.releaseKey??null,reason:o.reason??null,evidence:o.evidence??o.runDir??null};
  control.providers=control.providers??{};
  if(action.packageId){
    const p=control.packages[action.packageId];ev.from=p.status;delete p.inFlight;
    if(o.type==="ENV_ERROR"){transient(p,now,o.reason,policy)}
    else if(action.type==="REVIEW"&&action.provider)applyDualReview(control,p,action.provider,o,now,policy);
    // //TR: GOV2: sağlayıcısız eski tek-Codex REVIEW sonucu emekli edildi; hiçbir sonuç (CLEAN dahil) kabul edilmez, paket Founder kararına düşer.
    else if(action.type==="REVIEW")founder(p,o.reason??"LEGACY_GATE_RETIRED","REVIEW_GATE_NOT_ACTIVATED");
    else if(action.type==="REMEDIATE"||action.type==="IMPLEMENT"){
      if(o.type==="QUOTA"){const prev=control.providers.claude??{},back=Math.min((prev.backoffMinutes?prev.backoffMinutes*2:policy.providers.claude.quotaBackoffMinutes),policy.providers.claude.quotaBackoffMaxMinutes);const ra=futureIso(o.retryAfter,now);control.providers.claude={status:"QUOTA_BLOCKED",retryAfter:ra??minutes(now,back),backoffMinutes:ra?null:back,lastEvidence:o.evidence??null}}
      // //TR: TARİHÇE (yalnız DUAL dönemi geçişi; GOV2 sonrası etkin Codex incelemesi yoktur, etkin kapı CLAUDE_ONLY'dir): DUAL kapısı etkinken commit edilip dondurulan her yeni revizyon iki reviewer isterdi; CODEX_ONLY_HISTORICAL işareti yalnız konduğu eski revizyona aittir, DUAL ile değiştirilir ve eski revizyonun commit/bundle/cycle kimliğine bağlı olarak historicalReviewPolicy'de saklanır (eski kanıt dokunulmadan kalır). CLAUDE_ONLY kapısı etkinse işaretler dokunulmadan kalır; yeni revizyonu yalnız CLAUDE_REVIEWER inceler.
      else if(o.type==="COMMITTED"){control.providers.claude={status:"AVAILABLE",retryAfter:null};delete p.queuedAction;delete p.formatRejection;delete p.reviewGate;if(control.dualReview?.active===true&&!claudeOnlyGate(control)){if(p.reviewPolicy&&p.reviewPolicy!=="DUAL")p.historicalReviewPolicy={reviewPolicy:p.reviewPolicy,reviewCommit:p.reviewCommit??null,bundleDigest:p.bundle?.digest??null,cycle:p.cycle??null,supersededAt:now.toISOString()};p.reviewPolicy="DUAL"}Object.assign(p,{status:"REVIEW_PENDING",reviewCommit:o.commit,baseCommit:o.baseCommit??p.baseCommit,implementationCommit:o.commit,bundle:o.bundle,cycle:o.cycle??p.cycle,formatRetries:0,formatCorrection:false,executionBackend:o.executionBackend??p.executionBackend??null,executionProvenance:o.provenance??p.executionProvenance??null,transientFailures:0,nextAction:"REVIEW"})}
      else if(o.type==="QUEUED"){p.status="QUEUED";p.queuedAction=action.type;p.notBefore=futureIso(o.retryAfter,now)??minutes(now,30);p.blockedReason=o.reason??null;p.nextAction=`${action.type}_WHEN_BACKEND_AVAILABLE`}
      else founder(p,o.reason??o.type);
    }
    else if(action.type==="MERGE"){
      if(o.type==="MERGED"){p.status="CLOSED";p.mergedAt=now.toISOString();p.mergedCommit=o.master;p.nextAction=null;
        if(p.release===true){control.releases=control.releases??{};const rk=releaseKey(p.reviewCommit);for(const r of Object.values(control.releases))if(!["PHASE0_DONE","SUPERSEDED"].includes(r.status)){r.status="SUPERSEDED";r.supersededBy=rk}control.releases[rk]=newRelease(p,rk,now,policy,control)}}
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
  else if(o.type==="AUDIT_REQUIRED"&&!r.audit&&["PACKAGE","SIGN","PHASE0"].includes(action.type)){r.status="AUDIT_PENDING";r.audit=newAudit(action.releaseKey,control);r.nextAction="RELEASE_AUDIT"}
  else if(action.type==="AUDIT_FREEZE"){if(o.type==="FROZEN"){r.audit={...(r.audit??newAudit(action.releaseKey,control)),bundle:o.bundle,baseCommit:o.baseCommit,cycle:1,fileCount:o.fileCount??null,frozenAt:now.toISOString()};r.transientFailures=0;r.nextAction="RELEASE_AUDIT"}else founder(r,o.reason??"RELEASE_AUDIT_FREEZE_FAILED")}
  // //TR: GOV2: sağlayıcısız AUDIT (kapı etkin değil) hiçbir sonuç üretmez; release denetim yolu Founder kararına düşer.
  else if(action.type==="AUDIT"&&!action.provider)founder(r,o.reason??"REVIEW_GATE_NOT_ACTIVATED","REVIEW_GATE_NOT_ACTIVATED");
  else if(action.type==="AUDIT")applyReleaseAudit(control,r,action.provider,o,now,policy);
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
// //TR: Çift inceleme sonucu: yalnız ilgili reviewer'ın kapısı değişir. Kota o reviewer'ın sağlayıcı durumunu bloke eder, sonuç üretmez, cycle/format hakkı tüketmez. Biçimi bozuk çıktı format hakkını kullanır, hakkı biterse INVALID olur ve asla CLEAN sayılmaz. Yeter sayı review-quorum.mjs'dedir; CLEAN için iki reviewer'ın da bu bundle için geçerli CLEAN'i gerekir, geçerli bir BLOCKED entegrasyonu durdurur ve bulgular sağlayıcı atfıyla builder'a gider.
// //TR: Tek reviewer sonucunun kapıya ve sağlayıcı durumuna etkisi paket incelemesi ve son sürüm denetimi için ortaktır.
function updateReviewerGate(control,t,k,o,now,policy){let known=true;
  const stateKey=PROVIDER_STATE_KEY[k],gate=currentGate(t),g={...(gate.providers[k]??{})},pp=policy.providers?.[stateKey]??{quotaBackoffMinutes:30,quotaBackoffMaxMinutes:360};
  if(o.type==="QUOTA"){const prev=control.providers[stateKey]??{},back=Math.min((prev.backoffMinutes?prev.backoffMinutes*2:pp.quotaBackoffMinutes),pp.quotaBackoffMaxMinutes),ra=futureIso(o.retryAfter,now);control.providers[stateKey]={status:"QUOTA_BLOCKED",retryAfter:ra??minutes(now,back),backoffMinutes:ra?null:back,lastEvidence:o.evidence??null,since:prev.since??now.toISOString(),lastAttempt:now.toISOString()};Object.assign(g,{status:"PROVIDER_BLOCKED",quotaBlocks:[...(g.quotaBlocks??[]),o.evidence??null]})}
  else{control.providers[stateKey]={status:"AVAILABLE",retryAfter:null,lastAttempt:now.toISOString()};
    if(o.type==="CLEAN")Object.assign(g,{status:"CLEAN",runDir:o.runDir??null,evidence:o.evidence??null,at:now.toISOString(),formatCorrection:false});
    else if(o.type==="BLOCKED")Object.assign(g,{status:"BLOCKED",runDir:o.runDir??null,evidence:o.evidence??null,findings:o.findings??[],ledgerFile:o.ledgerFile??null,at:now.toISOString(),formatCorrection:false});
    else if(o.type==="FORMAT_REJECTED"){const n=(g.formatRetries??0)+1;if(n>(policy.review.formatRetryLimit??1))Object.assign(g,{status:"INVALID",formatRetries:n,formatCorrection:false,invalidReason:o.reason??null});else Object.assign(g,{status:"PENDING",formatRetries:n,formatCorrection:true,formatRejection:{runDir:o.runDir??null,reason:o.reason??null,at:now.toISOString()}})}
    else known=false}
  return {gate:{...gate,providers:{...gate.providers,[k]:g}},known}}
function applyDualReview(control,p,k,o,now,policy){
  const {gate,known}=updateReviewerGate(control,p,k,o,now,policy);if(o.type!=="QUOTA")p.transientFailures=0;p.reviewGate=gate;
  if(!known){founder(p,`${REVIEWER_IDENTITY[k]}:${o.reason??o.type}`,o.type==="INPUT_INVALID"?"ORCHESTRATOR_INPUT_DEFECT":"FOUNDER_DECISION_REQUIRED");return}
  applyReviewAggregate(control,p,now,policy);
}
// //TR: Kapının yeter sayı sonucunu pakete uygular (yeni reviewer sonucu veya CLAUDE_ONLY uzlaştırması). CLAUDE_ONLY altında CLEAN, bu bundle ve cycle için CLAUDE_REVIEWER CLEAN'idir; yerine geçen Codex içerikli kayıt historicalCodexReviews'a aynen eklenir, silinmez.
function applyReviewAggregate(control,p,now,policy){
  const co=claudeOnlyGate(control),required=requiredReviewers(p,control),due=r=>providerDue(control,PROVIDER_STATE_KEY[r],now),agg=computeReviewAggregate(p.reviewGate,required,{providerDue:due,alsoBlocking:honouredBlockers(control)});p.reviewGate.aggregate={result:agg.result,dualReviewClean:agg.dualReviewClean,statuses:agg.statuses,...(co?{gateModel:CLAUDE_ONLY}:{})};
  if(agg.result==="CLEAN"){if(co)keepHistoricalCodexReview(p,now);p.status="REVIEW_CLEAN";p.review={result:"CLEAN",dual:required.length===2,dualReviewClean:agg.dualReviewClean,...(co?{gateModel:CLAUDE_ONLY,claudeReviewClean:true}:{}),bundleDigest:p.bundle.digest,cycle:p.cycle,evidence:Object.fromEntries(required.map(r=>[r,p.reviewGate.providers[r].evidence])),runDirs:Object.fromEntries(required.map(r=>[r,p.reviewGate.providers[r].runDir]))};p.nextAction=p.merge?.mode==="FF_DEFAULT_BRANCH"?"MERGE_WHEN_ELIGIBLE":"CLOSE";return}
  if(agg.result==="INVALID"){founder(p,`REVIEW_INVALID:${required.filter(r=>agg.statuses[r]==="INVALID").map(r=>REVIEWER_IDENTITY[r]).join(",")}`,"REVIEW_FORMAT_RETRY_EXHAUSTED");return}
  if(agg.result==="BLOCKED"){if(co)keepHistoricalCodexReview(p,now);p.review={result:"BLOCKED",dual:true,...(co?{gateModel:CLAUDE_ONLY}:{}),bundleDigest:p.bundle.digest,cycle:p.cycle,blockedBy:agg.blockedBy.map(r=>REVIEWER_IDENTITY[r]),findings:aggregateFindings(Object.fromEntries(agg.blockedBy.map(r=>[r,p.reviewGate.providers[r].findings??[]]))),ledgerFiles:Object.fromEntries(agg.blockedBy.map(r=>[r,p.reviewGate.providers[r].ledgerFile??null])),ledgerFile:null,evidence:Object.fromEntries(agg.blockedBy.map(r=>[r,p.reviewGate.providers[r].evidence??null]))};
    if(p.cycle>=(policy.review.maxReviewCycles??2))founder(p,"REVIEW_CYCLE_LIMIT_REACHED_WITH_OPEN_BLOCKERS");else if(p.remediation?.authorized===true){p.status="REMEDIATION_PENDING";p.nextAction="REMEDIATE"}else founder(p,"BLOCKED_WITHOUT_REMEDIATION_AUTHORITY");return}
  const runnable=(agg.runnable??[]).length>0;if(p.status!=="REVIEW_CLEAN")p.status=runnable?"REVIEW_PENDING":"REVIEW_PENDING_PROVIDER_QUOTA";p.nextAction=runnable?"REVIEW":"REVIEW_AT_PROVIDER_RETRY";
}
function keepHistoricalCodexReview(p,now){const r=p.review;if(!r||r.gateModel===CLAUDE_ONLY)return;const codex=typeof r.evidence==="string"||!!r.evidence?.codex||(r.blockedBy??[]).includes(REVIEWER_IDENTITY.codex)||(r.result==="BLOCKED"&&r.dual!==true);if(codex)p.historicalCodexReviews=[...(p.historicalCodexReviews??[]),{review:r,supersededAt:now.toISOString(),supersededBy:"CLAUDE_ONLY_REVIEW_GATE"}]}
// //TR: Son sürüm denetimi sonucu: kota ve biçim kuralları paket incelemesiyle aynıdır; iki reviewer da aynı aday bundle'ı için CLEAN ise release paketlemeye geçer, geçerli bir BLOCKED release hattını AUDIT_BLOCKED olarak durdurur (düzeltme yeni bir paket ve yeni bir adaydır), biçimi bozuk sonuç asla CLEAN olmaz.
function applyReleaseAudit(control,r,k,o,now,policy){
  const t=auditTarget(r),{gate,known}=updateReviewerGate(control,t,k,o,now,policy);if(o.type!=="QUOTA")r.transientFailures=0;r.audit={...r.audit,reviewGate:gate};
  if(!known){founder(r,`RELEASE_AUDIT:${REVIEWER_IDENTITY[k]}:${o.reason??o.type}`,o.type==="INPUT_INVALID"?"ORCHESTRATOR_INPUT_DEFECT":"FOUNDER_DECISION_REQUIRED");return}
  applyAuditAggregate(control,r,now,policy);
}
// //TR: Denetim kapısının yeter sayı sonucunu release'e uygular. CLAUDE_ONLY altında tek gerekli reviewer CLAUDE_REVIEWER'dır (CLAUDE_FULL_REPO_REVIEW_CLEAN); kanıt yalnız onun bu aday bundle'ına bağlı CLEAN'idir.
function applyAuditAggregate(control,r,now,policy){
  const co=claudeOnlyGate(control),t=auditTarget(r),gate=r.audit.reviewGate,required=requiredReviewers(t,control),due=x=>providerDue(control,PROVIDER_STATE_KEY[x],now),agg=computeReviewAggregate(gate,required,{providerDue:due,alsoBlocking:honouredBlockers(control)});r.audit.aggregate={result:agg.result,dualReviewClean:agg.dualReviewClean,statuses:agg.statuses,...(co?{gateModel:CLAUDE_ONLY}:{}),at:now.toISOString()};
  if(co&&agg.result==="CLEAN"&&required.length===1&&required[0]==="claude"){Object.assign(r.audit,{result:"CLEAN",gateModel:CLAUDE_ONLY,quorum:CLAUDE_ONLY_RELEASE_QUORUM,claudeClean:true,bundleDigest:r.audit.bundle.digest,evidence:{claude:gate.providers.claude.evidence},runDirs:{claude:gate.providers.claude.runDir},completedAt:now.toISOString()});r.status="PACKAGE_PENDING";r.nextAction="PACKAGE";return}
  if(agg.result==="CLEAN"&&agg.dualReviewClean){Object.assign(r.audit,{result:"CLEAN",dualClean:true,bundleDigest:r.audit.bundle.digest,evidence:Object.fromEntries(required.map(x=>[x,gate.providers[x].evidence])),runDirs:Object.fromEntries(required.map(x=>[x,gate.providers[x].runDir])),completedAt:now.toISOString()});r.status="PACKAGE_PENDING";r.nextAction="PACKAGE";return}
  if(agg.result==="INVALID"){founder(r,`RELEASE_AUDIT_REVIEW_INVALID:${required.filter(x=>agg.statuses[x]==="INVALID").map(x=>REVIEWER_IDENTITY[x]).join(",")}`,"REVIEW_FORMAT_RETRY_EXHAUSTED");return}
  if(agg.result==="BLOCKED"){Object.assign(r.audit,{result:"BLOCKED",dualClean:false,blockedBy:agg.blockedBy.map(x=>REVIEWER_IDENTITY[x]),findings:aggregateFindings(Object.fromEntries(agg.blockedBy.map(x=>[x,gate.providers[x].findings??[]]))),ledgerFiles:Object.fromEntries(agg.blockedBy.map(x=>[x,gate.providers[x].ledgerFile??null])),evidence:Object.fromEntries(agg.blockedBy.map(x=>[x,gate.providers[x].evidence??null]))});r.status="AUDIT_BLOCKED";r.classification="RELEASE_AUDIT_BLOCKED";r.blockedReason=`RELEASE_AUDIT_BLOCKED_BY:${r.audit.blockedBy.join(",")}`;r.nextAction="REMEDIATION_PACKAGE_REQUIRED";return}
  r.nextAction=required.some(x=>agg.statuses[x]==="PENDING"||(agg.statuses[x]==="PROVIDER_BLOCKED"&&due(x)))?"RELEASE_AUDIT":"RELEASE_AUDIT_AT_PROVIDER_RETRY";
}
// //TR: GOV1 etkinleştirmesi: commit edilmiş policy CLAUDE_ONLY kapısını tanımlıyor ve kalıcı durum Founder kararının kaydını taşıyorsa engine kapıyı bir kez control.reviewGate olarak kaydeder (hash zincirli REVIEW_GATE_ACTIVATED). Policy anahtarı yoksa, bozuksa veya kayıt yoksa hiçbir şey değişmez.
export function activateReviewGate(controlIn,policy,now){
  if(!claudeOnlyPolicy(policy)||claudeOnlyGate(controlIn)||!founderClaudeOnlyRecord(controlIn))return null;
  const control=clone(controlIn),g=policy.reviewGate;control.reviewGate={active:true,model:CLAUDE_ONLY,required:["claude"],codexRequired:false,activatedBy:g.activatedBy,activatedAt:now.toISOString(),releaseAuditQuorum:CLAUDE_ONLY_RELEASE_QUORUM,historicalCodexEvidence:"PRESERVED",founderRecord:"control.finalization.reviewGovernance"};
  return {control,event:{type:"REVIEW_GATE_ACTIVATED",reason:`CLAUDE_ONLY from ${g.activatedBy}: CLAUDE_REVIEWER is the only required reviewer; Codex is no longer required or scheduled; historical Codex evidence preserved`}};
}
// //TR: GOV1 geçiş bekletmesi: bootstrap süpervizörü açık paketleri hold.until = CLAUDE_ONLY_GOVERNANCE_ACTIVE ile (uzak gelecekteki notBefore ile) bekletir. Kapı kaydedildikten sonra (aynı tick'te REVIEW_GATE_ACTIVATED'den hemen sonra ve bu bekletmeler kaldıkça sonraki her tick'te, idempotent) yalnız bu bekletmeler serbest bırakılır: hold silinir, notBefore hold.previousNotBefore'a döner (null, geçersiz veya bir yıldan uzak gelecekteki bekletme işaretiyse silinir), holdReleased kaydı ve hash zincirli ACTIVATION_HOLD_RELEASED geçişi yazılır. Altta kalan önceki bekletme: DUAL_REVIEW_ACTIVE CLAUDE_ONLY kapısıyla geçersizleşir; RELEASE_AUDIT_ACTIVE yalnız bu durumda son sürüm denetimi etkinse karşılanmış sayılır (denetim CLAUDE_ONLY altında tek Claude tam depo incelemesidir), değilse olduğu gibi geri konur; bilinmeyen önceki bekletme de geri konur (fail closed). Başka hold.until değerli, kapalı/birleşmiş paketlere dokunulmaz; FOUNDER_DECISION_PENDING durumu ve Founder kararı korunur. Üç anahtar da (kaydedilmiş kapı, commit edilmiş policy, Founder kaydı) gerekir; Global Stop'ta runTick bunu uygulamaz.
export const CLAUDE_ONLY_HOLD="CLAUDE_ONLY_GOVERNANCE_ACTIVE";
const HOLD_SENTINEL_MS=365*86_400_000,isoString=v=>typeof v==="string"&&Number.isFinite(Date.parse(v));
export function releaseClaudeOnlyHolds(controlIn,now,policy){
  if(!claudeOnlyGate(controlIn)||!claudeOnlyPolicy(policy)||!founderClaudeOnlyRecord(controlIn))return null;
  const ids=Object.keys(controlIn.packages??{}).filter(id=>{const p=controlIn.packages[id];return p?.hold?.until===CLAUDE_ONLY_HOLD&&!TERMINAL.includes(p.status)});if(!ids.length)return null;
  const control=clone(controlIn),g=control.reviewGate,at=now.toISOString(),evidence=[];
  const activationRecord={transition:"REVIEW_GATE_ACTIVATED",model:g.model,activatedBy:g.activatedBy??null,activatedAt:g.activatedAt??null,founderRecord:g.founderRecord??"control.finalization.reviewGovernance"};
  for(const id of ids){
    const q=control.packages[id],h=q.hold,prev=h.previousHold&&typeof h.previousHold==="object"&&typeof h.previousHold.until==="string"?h.previousHold:null;
    const resolution=!prev?null:prev.until==="DUAL_REVIEW_ACTIVE"?"SUPERSEDED_BY_CLAUDE_ONLY_GATE":prev.until==="RELEASE_AUDIT_ACTIVE"&&control.releaseAuditActivation?.active===true?"SATISFIED_BY_ACTIVE_RELEASE_AUDIT":null,restore=!!prev&&!resolution;
    q.holdReleased={until:CLAUDE_ONLY_HOLD,reason:h.reason??null,releasedAt:at,activationRecord,supersededPreviousHold:resolution?{...prev,resolution}:null,restoredPreviousHold:restore?prev.until:null,...(q.holdReleased?{earlierHoldReleased:q.holdReleased}:{})};
    delete q.hold;
    if(restore){q.hold=prev;if(isoString(h.previousNotBefore))q.notBefore=h.previousNotBefore}
    else if(isoString(h.previousNotBefore)&&Date.parse(h.previousNotBefore)-now.getTime()<=HOLD_SENTINEL_MS)q.notBefore=h.previousNotBefore;
    else delete q.notBefore;
    evidence.push({packageId:id,status:q.status,supersededPreviousHold:resolution?prev.until:null,resolution,restoredPreviousHold:restore?prev.until:null,notBefore:q.notBefore??null});
  }
  return {control,event:{type:"ACTIVATION_HOLD_RELEASED",reason:`${CLAUDE_ONLY_HOLD}:${ids.join(",")}`,evidence}};
}
// //TR: CLAUDE_ONLY uzlaştırması: etkinleştirmeden önce CLAUDE_REVIEWER sonucu bu bundle ve cycle için zaten kayıtlı (ör. Codex kotası beklenirken Claude CLEAN/BLOCKED) bekleyen paket veya release denetimi yeni bir inceleme olmadan kapı sonucuna geçer; kapalı, Founder kararı bekleyen, AUDIT_BLOCKED veya yarım eylemli hedeflere dokunulmaz.
export function reconcileReviewGates(controlIn,now,policy){
  if(!claudeOnlyGate(controlIn))return null;const control=clone(controlIn),changed=[],decided=g=>["CLEAN","BLOCKED","INVALID"].includes(gateStatus(g,"claude"));
  for(const id of control.order??[]){const p=control.packages[id];if(!p||p.inFlight||!["REVIEW_PENDING","REVIEW_PENDING_PROVIDER_QUOTA"].includes(p.status))continue;const gate=currentGate(p);if(!decided(gate))continue;p.reviewGate=gate;const from=p.status;applyReviewAggregate(control,p,now,policy);changed.push(`${id}:${from}->${p.status}`)}
  for(const [rk,r] of Object.entries(control.releases??{})){if(r.inFlight||r.status!=="AUDIT_PENDING"||!r.audit?.bundle)continue;const gate=currentGate(auditTarget(r));if(!decided(gate))continue;r.audit={...r.audit,reviewGate:gate};const from=r.status;applyAuditAggregate(control,r,now,policy);changed.push(`R:${rk}:${from}->${r.status}`)}
  return changed.length?{control,event:{type:"REVIEW_GATE_RECONCILED",reason:changed.join(",")}}:null;
}
// //TR: Önceki worker'dan kalan yarım eylem işaretleri temizlenir; yürütücüler idempotent olduğundan eylem güvenle yeniden planlanır (tamamlanmış review/merge/paket/imza yeniden yapılmaz, benimsenir).
export function recoverInFlight(controlIn,workerId){const control=clone(controlIn),recovered=[];for(const x of [...Object.values(control.packages),...Object.values(control.releases??{})])if(x.inFlight&&x.inFlight.workerId!==workerId){recovered.push({target:x.id??x.sourceCommit,action:x.inFlight.action,workerId:x.inFlight.workerId});delete x.inFlight}return {control,recovered}}
// //TR: Global Stop (shouldStop) her eylemden önce denetlenir; durdurma nedeniyle kesilen bir eylemin sonucu uygulanmaz (yarım eylem işareti sonraki tick'te idempotent kurtarılır) ve tick durur.
export async function runTick({control:start,executors,persist,policy,workerId,now=()=>new Date(),maxActions,shouldStop=()=>null}){
  let control=start,stopped=null;const done=[],skip=new Set(),perTarget=new Map(),limit=maxActions??policy.tick?.maxActionsPerTick??12;
  const stopNow=()=>{try{return shouldStop()}catch(e){return `STOP_CHECK_FAILED_FAIL_CLOSED:${e?.message??e}`}};
  // //TR: GOV1 etkinleştirmesi, CLAUDE_ONLY_GOVERNANCE_ACTIVE bekletmelerinin serbest bırakılması ve uzlaştırma yalnız yapılacak bir kayıt varsa ve Global Stop yoksa uygulanır; üçü de dış etkisi olmayan durum kaydıdır ve hash zincirli günlüğe yazılır.
  if((activateReviewGate(control,policy,now())||releaseClaudeOnlyHolds(control,now(),policy)||reconcileReviewGates(control,now(),policy))&&!stopNow()){const act=activateReviewGate(control,policy,now());if(act)control=persist(act.control,act.event);const rel=releaseClaudeOnlyHolds(control,now(),policy);if(rel)control=persist(rel.control,rel.event);const rec=reconcileReviewGates(control,now(),policy);if(rec)control=persist(rec.control,rec.event)}
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
