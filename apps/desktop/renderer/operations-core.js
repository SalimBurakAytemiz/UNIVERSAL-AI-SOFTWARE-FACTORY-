// //TR: Bu modül Operasyon ve Kurtarma görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-071): yalnız üç salt-okunur ve zaten izinli GET (GET /v1/control/status, GET /v1/runs, GET /v1/founder-attention; üçü de sorgusuz sabit yoldur) yanıtını güvenli, sınırlı alanlara eşler ve bunlardan bir kurtarma kontrol listesi türetir. HİÇBİR veri uydurulmaz: kimlik/enum/biçim/zaman damgası bozuksa ya da iki alan birbiriyle çelişiyorsa okuma KISMEN değil tümden ERROR olur (fail-closed), eksik alan tahmin edilmez, durumlar kayıttan AYNEN taşınır (yükseltme yok). "Takıldı/durdu" (STALLED) YALNIZ gerçek kayıtlı zaman damgasından (koşu başlangıcı, yeniden deneme zamanı, checkpoint güncelleme) ve açıkça belgelenmiş görüntü eşiklerinden (kontrol düzleminde SLA/zaman aşımı kaydı YOKTUR; eşikler yalnız görüntü sınıflamasıdır) türetilir; zaman damgası yoksa/gelecekteyse sınıflama yapılmaz (UNDETERMINED). Okunamayan kaynağın sayıları null'dır (0 değil). Genel durum (NO_ISSUES_RECORDED) yalnız üç kaynağın HEPSİ okunabilir ve doğrulanmışsa, global stop aktif değilse, Work OS günlüğü OK ise, zamanlayıcı doğrulanmışsa, en az bir koşu kayıtlıysa ve kayıtlı hiçbir sorun yoksa verilir; aksi halde ASLA. Mevcut Stop/Resume/Retry kontrolleri BURADA yeniden uygulanmaz ve tetiklenmez; yalnız dürüst durumları gösterilir. Bu modül ürün doğrulamasını hesaplamaz ve ilgili sabit değer bu dosyada hiç yer almaz.
import {ATTENTION_PATH,mapQueueAttention,waitSince,waitParts} from "./queue-core.js";

import {
  RETRY_OVERDUE_AFTER_MS,validateRetryRecord,classifyRetryPhase
} from "./retry-core.js";

export {ATTENTION_PATH,waitSince,waitParts,RETRY_OVERDUE_AFTER_MS,validateRetryRecord,classifyRetryPhase};
export const CONTROL_PATH="/v1/control/status";
export const RUNS_PATH="/v1/runs";
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); üçü de salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. */
export const OPS_SOURCES=Object.freeze(["control","runs","attention"]);
export const OPS_SOURCE_PATHS=Object.freeze({control:CONTROL_PATH,runs:RUNS_PATH,attention:ATTENTION_PATH});
/** Work OS günlük sağlığı (sunucu journalHealth sözleşmesi). */
export const JOURNAL_STATES=Object.freeze(["OK","ABSENT","TORN_TAIL","TAMPERED","UNAVAILABLE"]);
/** Sunucunun global stop okunamadığında/bozukken fail-closed ürettiği sabit nedenler. */
export const FAIL_CLOSED_STOP_REASONS=Object.freeze(["GLOBAL_STOP_STATE_UNSAFE","GLOBAL_STOP_STATE_INVALID_FAIL_CLOSED"]);
/** Koşu özeti durumları (supervisor'ın yazdığı kayıtlı değerler) -> görüntü grubu. Tanınmayan değer OTHER'dır ve AYNEN gösterilir; hiçbir durum "sağlıklı" olarak yükseltilmez. */
export const RUN_GROUPS=Object.freeze(["ATTENTION","WAITING","STOPPED","FINISHED","RUNNING","OTHER","UNKNOWN"]);
export const GROUP_OF_STATUS=Object.freeze({FATAL:"ATTENTION",FOUNDER_ATTENTION_REQUIRED:"ATTENTION",RETRY_WAIT:"WAITING",GLOBAL_STOP:"STOPPED",COMPLETE:"FINISHED",IDLE_NO_RUNNABLE_WORK:"FINISHED",MORE_WORK:"FINISHED",RUNNING:"RUNNING"});
/** Koşu canlılığı: yalnız kayıtlı zaman damgasından türer. */
export const LIVENESS=Object.freeze(["FINISHED","IN_PROGRESS","STALLED","UNDETERMINED"]);
/** GÖRÜNTÜ eşikleri (kayıtlı SLA/zaman aşımı DEĞİL): özeti olmayan bir koşu başlangıcından bu yana bu süreyi aştıysa STALLED; yeniden deneme zamanı bu tolerans kadar geçtiyse ve kayıt hâlâ duruyorsa OVERDUE; checkpoint bu süredir temizlenmediyse bayattır. */
export const RUN_STALL_AFTER_MS=6*3600000;
export const CHECKPOINT_STALE_AFTER_MS=RUN_STALL_AFTER_MS;
/** /v1/runs sunucuda en yeni 100 koşuyla sınırlıdır; tam bu sayıda satır gelirse liste kısaltılmış olabilir. */
export const SERVER_RUNS_CAP=100;
export const MAX_OPS_ROWS=200;
/** Bulgu önem düzeyleri (sıra = kontrol listesi sırası) ve genel durum düzeyleri. */
export const SEVERITIES=Object.freeze(["ACTION","UNKNOWN","UNVERIFIED","WATCH"]);
export const TIERS=Object.freeze(["ATTENTION_NEEDED","UNKNOWN","UNVERIFIED","WATCH","NO_ISSUES_RECORDED"]);
export const TIER_OF_SEVERITY=Object.freeze({ACTION:"ATTENTION_NEEDED",UNKNOWN:"UNKNOWN",UNVERIFIED:"UNVERIFIED",WATCH:"WATCH"});
/** Kontrol listesi adımları (sabit küme; her biri ops.step.<ID>.* anahtarlarıyla yerelleştirilir). */
export const STEP_IDS=Object.freeze({
  ACTION:Object.freeze(["STOP_ACTIVE","STOP_FAIL_CLOSED","JOURNAL_TAMPERED","JOURNAL_TORN_TAIL","JOURNAL_UNAVAILABLE","SCHEDULER_REJECTED","BLOCKED_PACKAGE","RETRY_OVERDUE","CHECKPOINT_STALE","RUN_STALLED","LATEST_RUN_ATTENTION"]),
  UNKNOWN:Object.freeze(["SOURCE_UNREADABLE"]),
  UNVERIFIED:Object.freeze(["SCHEDULER_NOT_VERIFIED","JOURNAL_ABSENT","JOURNAL_NOT_REPORTED","NO_RUNS_RECORDED","RUN_UNDETERMINED","RETRY_UNDETERMINED"]),
  WATCH:Object.freeze(["RETRY_WAITING","RETRY_DUE","RUN_IN_PROGRESS"])});
/** UI-186: kayıtlı koşu durumu RECOVERY_FAILED olan koşular "kurtarma başarısız" sayılır (core/workos/run-state.ts uç durumu); başka hiçbir durum bu gruba yükseltilmez. */
export const RECOVERY_FAILED_STATUS="RECOVERY_FAILED";
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);
/** Mevcut IPC denetimi bu paket kimliği biçimi dışında yeniden denemeyi reddeder (main.mjs'teki retry-blocked IPC kuralı ile aynı). */
export const RETRY_PACKAGE_RE=/^PKG-\d{3}$/;

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const matches=(re,x)=>typeof x==="string"&&re.test(x);
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const RUN_ID_RE=/^RUN-[A-Za-z0-9-]{1,100}$/,STATUS_RE=/^[A-Z][A-Z0-9_]{0,39}$/,PKG_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/,KIND_RE=/^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;
/** İsteğe bağlı alan: yok/null -> null, geçerli -> değer, geçersiz -> undefined (okuma reddedilir). */
const opt=(v,ok)=>v===undefined||v===null?null:ok(v)?v:undefined;
/** Metin alanı: yok/null/boş -> null, dize -> kısaltılmış değer, dize olmayan -> undefined (okuma reddedilir). Boş bir neden gerçek bir stop'u gizlememelidir. */
const optText=(v,max)=>{const r=opt(v,x=>typeof x==="string");return r===null||r===undefined?r:r.length?r.slice(0,max):null};
const optIso=v=>opt(v,x=>iso(x)!==null);

// ---------- GET /v1/control/status ----------
/**
 * GET /v1/control/status -> {state:"VERIFIED",control:{active,reason,actor,activatedAt,verification,journal}} | {state:"ERROR",control:null}.
 * globalStop.active mutlaka boolean olmalıdır; bozuk/çelişkili alan (ör. REJECTED doğrulama ama aktif olmayan stop, TORN_TAIL olmayan tornTail) TÜM okumayı ERROR yapar.
 * Aktif olmayan stopta neden/aktör/zaman taşınmaz (bayat metin gösterilmez). workos yoksa journal null'dır (raporlanmadı) — tahmin edilmez.
 */
export function mapOperationsControl(raw){
  const bad={state:"ERROR",control:null};
  if(!isObj(raw)||!isObj(raw.globalStop)||typeof raw.globalStop.active!=="boolean")return bad;
  const g=raw.globalStop,reason=optText(g.reason,1000),actor=optText(g.actor,80),activatedAt=optIso(g.activatedAt);
  if([reason,actor,activatedAt].includes(undefined))return bad;
  const verification=opt(raw.verification,v=>matches(STATUS_RE,v));
  if(verification===undefined)return bad;
  // Sunucu doğrulama REDDEDİLDİĞİNDE yalnız aktif (fail-closed) stop döndürür; aksi çelişkidir.
  if(verification==="REJECTED"&&g.active!==true)return bad;
  let journal=null;
  if(raw.workos!==undefined&&raw.workos!==null){
    const w=raw.workos;
    if(!isObj(w)||!JOURNAL_STATES.includes(w.state))return bad;
    const jr=optText(w.reason,300);
    if(jr===undefined)return bad;
    const torn=opt(w.tornTail,isObj);
    if(torn===undefined||(w.state==="TORN_TAIL")!==(torn!==null))return bad;
    if(w.state==="OK"&&jr!==null)return bad;
    journal={state:w.state,reason:jr};
  }
  return {state:"VERIFIED",control:{active:g.active,reason:g.active?reason:null,actor:g.active?actor:null,activatedAt:g.active?activatedAt:null,verification,journal}};
}

// ---------- GET /v1/runs ----------
function mapRunRow(x){
  if(!isObj(x)||!matches(RUN_ID_RE,x.runId))return null;
  const sum=x.summary===undefined?null:x.summary,man=x.manifest===undefined?null:x.manifest;
  if((sum!==null&&!isObj(sum))||(man!==null&&!isObj(man)))return null;
  let status=null,statusBasis=null,finishedAt=null,packageId=null,error=null,startedAt=null,mode=null;
  if(sum!==null){
    const st=opt(sum.status,v=>matches(STATUS_RE,v)),fin=optIso(sum.finishedAt),pk=opt(sum.packageId,v=>matches(PKG_RE,v)),er=optText(sum.error,300),rid=opt(sum.runId,v=>v===x.runId);
    if([st,fin,pk,er,rid].includes(undefined))return null;
    // Biten bir koşunun özeti RUNNING olamaz: çelişkili kayıt tümden reddedilir.
    if(st==="RUNNING")return null;
    status=st;statusBasis=st===null?null:"SUMMARY";finishedAt=fin;packageId=pk;error=er;
  }
  if(man!==null){
    const st=opt(man.status,v=>matches(STATUS_RE,v)),sa=optIso(man.startedAt),md=optText(man.mode,40),rid=opt(man.runId,v=>v===x.runId);
    if([st,sa,md,rid].includes(undefined))return null;
    startedAt=sa;mode=md;
    if(status===null&&sum===null&&st!==null){status=st;statusBasis="MANIFEST"}
  }
  return {runId:x.runId,hasSummary:sum!==null,hasManifest:man!==null,status,statusBasis,startedAt,finishedAt,packageId,mode,error};
}
/**
 * GET /v1/runs -> {state:"VERIFIED",runs:{total,capped,items}} | {state:"ERROR",runs:null}.
 * count, runs uzunluğuyla birebir tutmalıdır; tek bozuk satır (geçersiz kimlik/durum/zaman, özet-manifest kimlik uyuşmazlığı, yinelenen kimlik) TÜM okumayı ERROR yapar.
 */
export function mapOperationsRuns(raw){
  const bad={state:"ERROR",runs:null};
  if(!isObj(raw)||!Array.isArray(raw.runs)||!Number.isSafeInteger(raw.count)||raw.count!==raw.runs.length)return bad;
  const items=[],seen=new Set();
  for(const x of raw.runs){
    const row=mapRunRow(x);
    if(row===null||seen.has(row.runId))return bad;
    seen.add(row.runId);items.push(row);
  }
  return {state:"VERIFIED",runs:{total:items.length,capped:items.length>=SERVER_RUNS_CAP,items}};
}

// ---------- GET /v1/founder-attention ----------
/**
 * GET /v1/founder-attention -> {state:"VERIFIED",attention:{total,items,schedulerVerification,retryableKinds,retry,checkpoint}} | {state:"UNAVAILABLE",attention:null,schedulerRejected:true} | {state:"ERROR",attention:null}.
 * Engelli paket satırları kuyruk ekranıyla AYNI katı eşleyiciden geçer (tek sahiplik); ek olarak retry (yeniden deneme kaydı) ve checkpoint ayrı ayrı doğrulanır. Tek bozuk öğe TÜM okumayı ERROR yapar.
 */
export function mapOperationsAttention(raw){
  const bad={state:"ERROR",attention:null};
  const base=mapQueueAttention(raw);
  if(base.state==="UNAVAILABLE")return {state:"UNAVAILABLE",attention:null,schedulerRejected:true};
  if(base.state!=="VERIFIED"||!base.attention)return bad;
  let retryableKinds=[];
  if(raw.retryableKinds!==undefined&&raw.retryableKinds!==null){
    if(!Array.isArray(raw.retryableKinds)||raw.retryableKinds.length>20||raw.retryableKinds.some(k=>!matches(KIND_RE,k)))return bad;
    retryableKinds=[...raw.retryableKinds];
  }
  let retry=null;
  if(raw.retry!==undefined&&raw.retry!==null){
    retry=validateRetryRecord(raw.retry);
    if(retry===null)return bad;
  }
  let checkpoint=null;
  if(raw.checkpoint!==undefined&&raw.checkpoint!==null){
    const c=raw.checkpoint;
    if(!isObj(c)||iso(c.updatedAt)===null||!Number.isSafeInteger(c.generation)||c.generation<1)return bad;
    checkpoint={generation:c.generation,updatedAt:c.updatedAt};
  }
  return {state:"VERIFIED",attention:{...base.attention,retryableKinds,retry,checkpoint}};
}

// ---------- Türetim ----------
const ok=res=>Boolean(res)&&res.state==="VERIFIED";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const rankOf=s=>SEVERITIES.indexOf(s);
// //TR: "En yeni" koşu KRONOLOJİK runId'den seçilir (sunucunun /v1/runs sıralamasıyla birebir aynı), manifest'e bağlı DEĞİL: writeManifest'ten önce yazılan manifest'siz bir FATAL özet, startedAt yokluğundan en eskiye düşüp gerçek en-yeni sorunu gizleyemez.
const newestFirst=(a,b)=>(a.runId<b.runId?1:a.runId>b.runId?-1:0);

/** Bir koşunun canlılığı: özeti olan koşu FINISHED; özetsiz koşu YALNIZ kayıtlı başlangıç zamanından sınıflanır (zaman yok/gelecekte -> UNDETERMINED). */
export function classifyRun(row,nowMs){
  const group=row.status===null?"UNKNOWN":(GROUP_OF_STATUS[row.status]??"OTHER");
  if(row.hasSummary&&row.status!==null)return {...row,group,liveness:"FINISHED",ageMs:null};
  const {waitMs}=waitSince(row.startedAt,nowMs);
  if(row.hasSummary||waitMs===null)return {...row,group,liveness:"UNDETERMINED",ageMs:null};
  return {...row,group,liveness:waitMs>RUN_STALL_AFTER_MS?"STALLED":"IN_PROGRESS",ageMs:waitMs};
}
function deriveRuns(R,nowMs){
  const items=R.items.map(r=>classifyRun(r,nowMs)).sort(newestFirst);
  const byStatus=new Map(),groups=Object.fromEntries(RUN_GROUPS.map(g=>[g,0])),live=Object.fromEntries(LIVENESS.map(l=>[l,0]));
  for(const r of items){const k=r.status??"NO_STATUS";byStatus.set(k,(byStatus.get(k)??0)+1);groups[r.group]+=1;live[r.liveness]+=1}
  const byState=[...byStatus].map(([status,n])=>({status,n})).sort((a,b)=>b.n-a.n||(a.status<b.status?-1:a.status>b.status?1:0));
  return {total:items.length,capped:R.capped,items,byState,groups,live,inProgress:live.IN_PROGRESS,stalled:live.STALLED,undetermined:live.UNDETERMINED,latest:items[0]??null};
}
function deriveQueue(A,nowMs){
  const items=A.items.map(x=>{const {waitMs,band}=waitSince(x.at,nowMs);return {...x,waitMs,band,retryNow:x.retryable===true&&matches(RETRY_PACKAGE_RE,x.packageId)}});
  const retryUsable=items.filter(x=>x.retryNow).length,retryable=items.filter(x=>x.retryable===true).length,notRetryable=items.filter(x=>x.retryable===false).length,unknownRetry=items.filter(x=>x.retryable===null).length;
  let retry=null;
  if(A.retry){
    retry=classifyRetryPhase(A.retry,nowMs);
  }
  let checkpoint=null;
  if(A.checkpoint){const {waitMs}=waitSince(A.checkpoint.updatedAt,nowMs);checkpoint={...A.checkpoint,ageMs:waitMs,stale:waitMs!==null&&waitMs>CHECKPOINT_STALE_AFTER_MS}}
  return {total:items.length,items,retryable,retryUsable,notRetryable,unknownRetry,retryableKinds:A.retryableKinds,schedulerVerification:A.schedulerVerification,retry,checkpoint};
}
function deriveControl(C,nowMs){
  const failClosed=C.active&&(C.verification==="REJECTED"||FAIL_CLOSED_STOP_REASONS.includes(C.reason));
  const {waitMs}=waitSince(C.activatedAt,nowMs);
  return {active:C.active,reason:C.reason,actor:C.actor,activatedAt:C.activatedAt,activeForMs:C.active?waitMs:null,failClosed,verification:C.verification,journal:C.journal};
}

// //TR: UI-186 "kurtarma başarısız -> güvenli dur" türetimi (salt-okunur, yeni veri yok): koşular YALNIZ kayıtlı durumu RECOVERY_FAILED olanlardır; global stop kaynağın bildirdiği gibidir (okunamıyorsa null = bilinmiyor, asla "aktif değil" değil); engelli paket sayısı yalnız bilgi içindir, paketlerin "kurtarma başarısız" olduğu iddia EDİLMEZ. Okunamayan kaynağın alanı null'dır.
export function deriveSafeStop(control,runs,queue){
  return {
    stop:control===null?null:{active:control.active,failClosed:control.failClosed,reason:control.reason,actor:control.actor,activatedAt:control.activatedAt},
    failedRuns:runs===null?null:runs.items.filter(r=>r.status===RECOVERY_FAILED_STATUS).map(r=>({runId:r.runId,status:r.status,finishedAt:r.finishedAt,packageId:r.packageId,error:r.error})),
    blockedPackages:queue===null?null:queue.total
  };
}

/**
 * Üç okuma sonucundan ({control,runs,attention}: mapOperations* çıktıları) çalışma durumunu ve kurtarma kontrol listesini türetir (nowMs: şimdiki zaman, ms).
 * Sayılar yalnız ilgili kaynak okunabiliyorsa vardır (aksi halde null, asla 0). Her bulgu kayıtlı bir durumdan türer; "takıldı" yalnız gerçek zaman damgasından.
 * Genel düzey: ACTION bulgusu -> ATTENTION_NEEDED; yoksa UNKNOWN (okunamayan kaynak) -> UNKNOWN; yoksa UNVERIFIED (kanıt eksik) -> UNVERIFIED; yoksa WATCH (bekleyen/süren iş) -> WATCH; hiçbiri yoksa NO_ISSUES_RECORDED.
 */
export function buildOperations(res,nowMs){
  const usable={control:ok(res.control)&&isObj(res.control.control),runs:ok(res.runs)&&isObj(res.runs.runs),attention:ok(res.attention)&&isObj(res.attention.attention)};
  const sources=Object.fromEntries(OPS_SOURCES.map(k=>[k,{state:usable[k]?"VERIFIED":ok(res[k])?"ERROR":failState(res[k]?.state)}]));
  const unreadable=OPS_SOURCES.filter(k=>sources[k].state!=="VERIFIED");
  const rejected=!usable.attention&&Boolean(res.attention)&&res.attention.schedulerRejected===true&&sources.attention.state==="UNAVAILABLE";
  const control=usable.control?deriveControl(res.control.control,nowMs):null;
  const runs=usable.runs?deriveRuns(res.runs.runs,nowMs):null;
  const queue=usable.attention?deriveQueue(res.attention.attention,nowMs):null;
  const F=[];
  const add=(id,severity,source,params={},extra={})=>F.push({id,severity,source,key:`${id}${extra.key?`:${extra.key}`:""}`,params,control:extra.control??null,route:extra.route??null});
  if(control){
    if(control.active&&control.failClosed)add("STOP_FAIL_CLOSED","ACTION","control",{reason:control.reason},{control:"resume",route:"tower"});
    else if(control.active)add("STOP_ACTIVE","ACTION","control",{reason:control.reason,actor:control.actor,activatedAt:control.activatedAt,activeForMs:control.activeForMs},{control:"resume",route:"tower"});
    const j=control.journal;
    if(j===null)add("JOURNAL_NOT_REPORTED","UNVERIFIED","control");
    else if(j.state==="TAMPERED")add("JOURNAL_TAMPERED","ACTION","control",{reason:j.reason});
    else if(j.state==="TORN_TAIL")add("JOURNAL_TORN_TAIL","ACTION","control",{reason:j.reason});
    else if(j.state==="UNAVAILABLE")add("JOURNAL_UNAVAILABLE","ACTION","control",{reason:j.reason});
    else if(j.state==="ABSENT")add("JOURNAL_ABSENT","UNVERIFIED","control");
  }
  if(rejected)add("SCHEDULER_REJECTED","ACTION","attention",{},{route:"inbox"});
  if(queue){
    for(const x of queue.items)add("BLOCKED_PACKAGE","ACTION","attention",{packageId:x.packageId,phase:x.phase,kind:x.kind,reason:x.reason,retryable:x.retryable,retryNow:x.retryNow,at:x.at,waitMs:x.waitMs},{key:`${x.packageId??""}|${x.phase??""}`,control:x.retryNow?"retry":null,route:"tower"});
    if(queue.schedulerVerification!=="VERIFIED")add("SCHEDULER_NOT_VERIFIED","UNVERIFIED","attention",{verification:queue.schedulerVerification});
    const r=queue.retry;
    if(r){
      const p={packageId:r.packageId,retryAt:r.retryAt,reason:r.reason};
      if(r.phase==="OVERDUE")add("RETRY_OVERDUE","ACTION","attention",{...p,overdueMs:r.overdueMs});
      else if(r.phase==="DUE")add("RETRY_DUE","WATCH","attention",{...p,overdueMs:r.overdueMs});
      else if(r.phase==="WAITING")add("RETRY_WAITING","WATCH","attention",{...p,remainingMs:r.remainingMs});
      else if(r.phase==="UNDETERMINED")add("RETRY_UNDETERMINED","UNVERIFIED","attention",{...p});
    }
    if(queue.checkpoint&&queue.checkpoint.stale)add("CHECKPOINT_STALE","ACTION","attention",{generation:queue.checkpoint.generation,updatedAt:queue.checkpoint.updatedAt,ageMs:queue.checkpoint.ageMs});
  }
  if(runs){
    if(runs.total===0)add("NO_RUNS_RECORDED","UNVERIFIED","runs");
    const l=runs.latest;
    if(l&&l.liveness==="FINISHED"&&l.group==="ATTENTION")add("LATEST_RUN_ATTENTION","ACTION","runs",{runId:l.runId,status:l.status,finishedAt:l.finishedAt,error:l.error},{key:l.runId,route:"tower"});
    for(const r of runs.items){
      if(r.liveness==="STALLED")add("RUN_STALLED","ACTION","runs",{runId:r.runId,startedAt:r.startedAt,ageMs:r.ageMs,status:r.status},{key:r.runId});
      else if(r.liveness==="IN_PROGRESS")add("RUN_IN_PROGRESS","WATCH","runs",{runId:r.runId,startedAt:r.startedAt,ageMs:r.ageMs},{key:r.runId});
      else if(r.liveness==="UNDETERMINED")add("RUN_UNDETERMINED","UNVERIFIED","runs",{runId:r.runId,status:r.status},{key:r.runId});
    }
  }
  for(const k of unreadable)if(!(k==="attention"&&rejected))add("SOURCE_UNREADABLE","UNKNOWN",k,{source:k,state:sources[k].state},{key:k});
  // Kontrol listesi: ACTION -> UNKNOWN -> UNVERIFIED -> WATCH; aynı düzeyde ekleme sırası korunur (kararlı sıralama).
  const steps=F.map((f,i)=>({f,i})).sort((a,b)=>rankOf(a.f.severity)-rankOf(b.f.severity)||a.i-b.i).map(x=>x.f);
  const top=steps.length?steps[0].severity:null;
  const tier=top===null?"NO_ISSUES_RECORDED":TIER_OF_SEVERITY[top];
  const unknownStates=unreadable.map(k=>sources[k].state);
  const unknownState=unknownStates.includes("OFFLINE")?"OFFLINE":unknownStates.includes("ERROR")?"ERROR":unknownStates.length?"UNAVAILABLE":null;
  const counts=Object.fromEntries(SEVERITIES.map(s=>[s,steps.filter(x=>x.severity===s).length]));
  return {sources,unreadable,unknownState,schedulerRejected:rejected,control,runs,queue,steps,counts,tier,safeStop:deriveSafeStop(control,runs,queue)};
}
