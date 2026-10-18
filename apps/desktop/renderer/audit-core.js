// //TR: Bu modül Denetim İzi (Audit Trail) görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-070): yalnız salt-okunur ve zaten izinli GET'lerin (GET /v1/runs, GET /v1/runs/RUN-*/events, GET /v1/evidence?limit=N) yanıtını güvenli, sınırlı alanlara eşler ve en son N koşunun olaylarını yeni-önce tek listede birleştirir. Okunamayan kaynak asla "boş/temiz" liste sayılmaz: her kaynak ayrık dürüst durum taşır, kısmi okuma kısmi olarak işaretlenir, okunamayan sayı 0 değil null'dır. Yeni uç nokta, yazma veya POST yoktur.
import {mapOperationsRuns,RUNS_PATH,SERVER_RUNS_CAP} from "./operations-core.js";
import {mapEvidenceItem} from "./work-core.js";

export {RUNS_PATH};
export const EVIDENCE_PATH="/v1/evidence?limit=100";
/** Okunan en yeni koşu sayısı (görüntü sınırı); daha eski koşular okunmaz ve bu açıkça söylenir. */
export const AUDIT_RUN_LIMIT=10;
/** Koşu başına gösterilen en yeni olay sayısı (sunucu en çok 2000 olay kuyruğu döndürür). */
export const MAX_EVENTS_PER_RUN=200;
export const MAX_EVIDENCE_ROWS=100;
export const AUDIT_SOURCES=Object.freeze(["runs","events","evidence"]);
export const AUDIT_SOURCE_PATHS=Object.freeze({runs:RUNS_PATH,events:"/v1/runs/{runId}/events",evidence:EVIDENCE_PATH});
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const RUN_ID_RE=/^RUN-[A-Za-z0-9-]{1,100}$/;
const SEV_RE=/^[A-Za-z][A-Za-z0-9_]{0,11}$/;
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const text=(x,max)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";

/** Yalnız geçerli koşu kimliği olay yolu üretir (main allow-list ile aynı kural); geçersiz kimlik null döner, istek yapılmaz. */
export function runEventsPath(runId){return typeof runId==="string"&&RUN_ID_RE.test(runId)?`/v1/runs/${runId}/events`:null}

/**
 * GET /v1/runs -> {state:"VERIFIED",runs:{total,read,capped,ids}} | {state:"ERROR",runs:null}.
 * Katı operations-core eşleyicisini yeniden kullanır (tek bozuk satır tüm okumayı reddeder); en yeni (kimliği büyük) AUDIT_RUN_LIMIT koşu seçilir.
 */
export function mapAuditRuns(raw){
  const base=mapOperationsRuns(raw);
  if(base.state!=="VERIFIED"||!base.runs)return {state:"ERROR",runs:null};
  const ids=base.runs.items.map(r=>r.runId).sort((a,b)=>b.localeCompare(a));
  return {state:"VERIFIED",runs:{total:ids.length,read:Math.min(ids.length,AUDIT_RUN_LIMIT),capped:ids.length>=SERVER_RUNS_CAP,ids:ids.slice(0,AUDIT_RUN_LIMIT)}};
}

/**
 * GET /v1/runs/:runId/events -> {state:"VERIFIED",runId,events,truncated,shown} | {state:"ERROR",runId,events:null}.
 * Yanıtın runId'si istenenle aynı olmalı; olaylar dizi olmalı ve her biri nesne olmalı. Zaman damgası geçersizse null (görüntüde "—"); tek bozuk olay TÜM koşu okumasını ERROR yapar. Serbest metin ayrıntı/yük taşınmaz.
 */
export function mapAuditEvents(runId,raw){
  const bad={state:"ERROR",runId,events:null,truncated:false,shown:0};
  if(!isObj(raw)||raw.runId!==runId||!Array.isArray(raw.events))return bad;
  if(raw.truncated!==undefined&&typeof raw.truncated!=="boolean")return bad;
  const src=raw.events;
  const tail=src.slice(-MAX_EVENTS_PER_RUN),base=src.length-tail.length,events=[];
  for(let i=0;i<tail.length;i++){
    const x=tail[i];
    if(!isObj(x))return bad;
    const sev=x.severity===undefined||x.severity===null?"INFO":(typeof x.severity==="string"&&SEV_RE.test(x.severity)?x.severity.toUpperCase():null);
    if(sev===null)return bad;
    events.push({runId,seq:base+i,timestamp:iso(x.timestamp),severity:sev,stage:text(x.stage,60),event:text(x.event,80)});
  }
  return {state:"VERIFIED",runId,events,truncated:raw.truncated===true||src.length>tail.length,shown:events.length};
}

/**
 * GET /v1/evidence -> {state:"VERIFIED",evidence:{items,skipped,more}} | {state:"ERROR",evidence:null}.
 * Liste dizi olmalıdır; geçersiz satırlar sessizce yok sayılmaz, `skipped` olarak sayılır ve görünümde kısmi okuma olarak söylenir. Yalnız referans alanları taşınır (log kuyruğu/yol taşınmaz).
 */
export function mapAuditEvidence(raw){
  const bad={state:"ERROR",evidence:null};
  if(!isObj(raw))return bad;
  const list=Array.isArray(raw.evidence)?raw.evidence:Array.isArray(raw.items)?raw.items:null;
  if(list===null)return bad;
  const items=[];let skipped=0;
  for(const x of list.slice(0,MAX_EVIDENCE_ROWS)){
    const m=mapEvidenceItem(x);
    if(m===null){skipped++;continue}
    items.push({evidenceId:m.evidenceId,missionId:m.missionId,runId:m.runId,kind:m.kind,verification:m.verification,createdAt:m.createdAt});
  }
  items.sort((a,b)=>(b.createdAt===null?-Infinity:Date.parse(b.createdAt))-(a.createdAt===null?-Infinity:Date.parse(a.createdAt))||b.evidenceId.localeCompare(a.evidenceId));
  const more=list.length>MAX_EVIDENCE_ROWS||(typeof raw.nextCursor==="string"&&raw.nextCursor.length>0);
  return {state:"VERIFIED",evidence:{items,skipped,more}};
}

const tsKey=t=>t===null?-Infinity:Date.parse(t);
/** Yeni-önce: zaman damgası azalan; damgasız olaylar sonda; eşitlikte koşu kimliği azalan, sonra koşu içi sıra azalan. */
export function compareEvents(a,b){
  const d=tsKey(b.timestamp)-tsKey(a.timestamp);
  if(d!==0&&!Number.isNaN(d))return d;
  return b.runId.localeCompare(a.runId)||b.seq-a.seq;
}

/**
 * Üç kaynağı birleştirir. res = {runs, events:{[runId]:result}, evidence}; her sonuç {state,...}.
 * complete yalnız koşu listesi, seçilen TÜM koşuların olayları ve kanıt listesi okunduysa true'dur; aksi halde unreadable kaynakları listelenir.
 * Hiçbir durumda "temiz/sorunsuz" sonucu üretilmez: boş liste yalnız "kayıt yok" demektir.
 */
export function buildAudit(res){
  const runsRes=res?.runs,runsOk=Boolean(runsRes)&&runsRes.state==="VERIFIED"&&runsRes.runs!==null&&runsRes.runs!==undefined;
  const evRes=res?.evidence,evOk=Boolean(evRes)&&evRes.state==="VERIFIED"&&Boolean(evRes.evidence);
  const sources={
    runs:{state:runsOk?"VERIFIED":failState(runsRes?.state)},
    events:{state:"UNAVAILABLE"},
    evidence:{state:evOk?"VERIFIED":failState(evRes?.state)}
  };
  const rows=[],failedRuns=[];let readRuns=0,truncatedRuns=0;
  if(runsOk){
    for(const id of runsRes.runs.ids){
      const r=res.events?.[id];
      if(r&&r.state==="VERIFIED"&&Array.isArray(r.events)){readRuns++;if(r.truncated)truncatedRuns++;rows.push(...r.events)}
      else failedRuns.push({runId:id,state:failState(r?.state)});
    }
    rows.sort(compareEvents);
    sources.events={state:failedRuns.length===0?"VERIFIED":readRuns===0&&runsRes.runs.ids.length>0?failedRuns[0].state:"PARTIAL"};
  }
  const unreadable=[];
  if(!runsOk)unreadable.push("runs");
  if(runsOk&&failedRuns.length>0)unreadable.push("events");
  if(!evOk)unreadable.push("evidence");
  return {
    sources,
    runs:runsOk?runsRes.runs:null,
    events:runsOk?rows:null,
    eventsRead:runsOk?{runsRead:readRuns,runsSelected:runsRes.runs.ids.length,failed:failedRuns,truncatedRuns}:null,
    evidence:evOk?evRes.evidence:null,
    unreadable,
    complete:unreadable.length===0
  };
}
