// //TR: Bu helper gözetimsiz orkestratörün ORCHESTRATOR_STATE.json içindeki "control" bölümünü sıkı doğrular, her durum geçişini hash zincirli JSONL günlüğüne yazıp ardından atomik kaydeder, lease/heartbeat ile tek aktif worker ve bayat worker tespiti sağlar; eski serbest biçimli alanlara dokunmaz.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";
import {writeJsonAtomic,readJsonIfExists,stableStringify} from "./atomic-json.mjs";
export const CONTROL_VERSION="2.0.0";
export const PACKAGE_KINDS=["REVIEW","IMPLEMENT"];
export const PACKAGE_STATUSES=["IMPLEMENT_PENDING","REVIEW_PENDING","REVIEW_PENDING_PROVIDER_QUOTA","REVIEW_CLEAN","REMEDIATION_PENDING","MERGED","CLOSED","QUEUED","FOUNDER_DECISION_PENDING"];
export const RELEASE_STATUSES=["PACKAGE_PENDING","SIGN_PENDING","WAITING_FOR_SECURE_SIGNER","PHASE0_PENDING","PHASE0_DONE","FOUNDER_DECISION_PENDING","SUPERSEDED"];
const SHA40=/^[0-9a-f]{40}$/,SHA64=/^[0-9a-f]{64}$/;
const bad=reason=>{throw new Error(`CONTROL_INVALID:${reason}`)};
const isoOrNull=v=>v===null||v===undefined||Number.isFinite(Date.parse(v));
export function validateControl(c){
  if(!c||c.schemaVersion!==CONTROL_VERSION)bad("VERSION");if(!c.packages||typeof c.packages!=="object")bad("PACKAGES");if(!Array.isArray(c.order))bad("ORDER");
  for(const id of c.order)if(!c.packages[id])bad(`ORDER_UNKNOWN_PACKAGE:${id}`);
  for(const [id,p] of Object.entries(c.packages)){
    if(p.id!==id)bad(`PACKAGE_ID:${id}`);if(!PACKAGE_KINDS.includes(p.kind))bad(`PACKAGE_KIND:${id}`);if(!PACKAGE_STATUSES.includes(p.status))bad(`PACKAGE_STATUS:${id}:${p.status}`);
    if(p.kind==="REVIEW"&&p.status!=="FOUNDER_DECISION_PENDING"){if(!SHA40.test(String(p.baseCommit))||!SHA40.test(String(p.reviewCommit)))bad(`PACKAGE_COMMITS:${id}`);if(!p.bundle||!SHA64.test(String(p.bundle.digest)))bad(`PACKAGE_BUNDLE:${id}`)}
    if(!Number.isInteger(p.cycle)||p.cycle<1)bad(`PACKAGE_CYCLE:${id}`);if(!isoOrNull(p.notBefore))bad(`PACKAGE_NOT_BEFORE:${id}`);
    for(const d of p.dependsOn??[])if(!c.packages[d.package]&&!d.release)bad(`DEPENDENCY_UNKNOWN:${id}:${d.package}`);
    if(p.status==="FOUNDER_DECISION_PENDING"&&!p.blockedReason)bad(`FOUNDER_DECISION_WITHOUT_REASON:${id}`);
  }
  for(const [k,r] of Object.entries(c.releases??{})){if(!SHA40.test(String(r.sourceCommit)))bad(`RELEASE_COMMIT:${k}`);if(!RELEASE_STATUSES.includes(r.status))bad(`RELEASE_STATUS:${k}:${r.status}`)}
  for(const [k,v] of Object.entries(c.providers??{})){if(!["AVAILABLE","QUOTA_BLOCKED","PROBE_PENDING_FOUNDER_RESET"].includes(v.status))bad(`PROVIDER_STATUS:${k}`);if(!isoOrNull(v.retryAfter))bad(`PROVIDER_RETRY_AFTER:${k}`)}
  if(c.lease&&(!c.lease.workerId||!isoOrNull(c.lease.expiresAt)))bad("LEASE");
  return true;
}
export function loadState(stateFile){const doc=readJsonIfExists(stateFile,null);if(!doc)throw new Error("ORCHESTRATOR_STATE_MISSING");if(doc.control)validateControl(doc.control);return {doc,control:doc.control??null}}
const entryHash=e=>crypto.createHash("sha256").update(stableStringify(e)).digest("hex");
const GENESIS="0".repeat(64);
function readLogEntries(logFile){if(!fs.existsSync(logFile))return [];return fs.readFileSync(logFile,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{throw new Error("TRANSITION_LOG_LINE_NOT_JSON")}})}
// //TR: Günlük kesin doğrusal bir zincirdir: her kayıt bir önceki kaydın seq+1'i ve hash'ine bağlanır. Geçiş önce günlüğe eklenir, sonra durum atomik yazılır;
// //TR: ikisi arasında çökme olursa uygulanmamış kayıt(lar) günlükte kalır ve bir sonraki geçiş bunları açık bir uzlaştırma kaydıyla (recoveredFrom + voids) geçersiz sayar, zincir hiç çatallanmaz.
export function commitTransition({stateFile,logFile,doc,next,event,now=new Date()}){
  validateControl(next);const base=doc.control?.lastTransition??{seq:0,hash:GENESIS};
  const log=readLogEntries(logFile),tail=log.length?log[log.length-1]:{seq:0,hash:GENESIS};let recovery={};
  if(tail.hash!==base.hash){const i=base.hash===GENESIS?-1:log.findIndex(e=>e.hash===base.hash);if(base.hash!==GENESIS&&i<0)throw new Error("TRANSITION_LOG_STATE_DIVERGED");recovery={recoveredFrom:base.hash,voids:log.slice(i+1).map(e=>e.hash)}}
  const body={seq:tail.seq+1,at:now.toISOString(),prevHash:tail.hash,type:String(event?.type??"UNSPECIFIED"),packageId:event?.packageId??null,from:event?.from??null,to:event?.to??null,reason:event?.reason??null,evidence:event?.evidence??null,workerId:next.lease?.workerId??null,...recovery};
  const entry={...body,hash:entryHash(body)};fs.mkdirSync(path.dirname(logFile),{recursive:true});
  const fd=fs.openSync(logFile,"a");try{fs.writeSync(fd,JSON.stringify(entry)+"\n");fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  const control={...next,lastTransition:{seq:entry.seq,hash:entry.hash,at:entry.at}};const out={...doc,control,updatedAt:now.toISOString()};writeJsonAtomic(stateFile,out);return {doc:out,control,entry};
}
// //TR: Doğrulama sıralı zinciri denetler: ilk kayıt seq 1 ve genesis'e, her kayıt hemen önceki kaydın seq+1'ine ve hash'ine bağlı olmalıdır (yeniden oynatılan,
// //TR: çoğaltılan veya boşluklu kayıt reddedilir); uzlaştırma kaydı tam olarak recoveredFrom sonrasındaki kayıtları geçersiz saymalıdır; durumdaki son geçiş
// //TR: günlükte aynı seq ile bulunmalıdır. Ondan sonraki kayıtlar çökmede uygulanmamış kayıtlardır, "unapplied" olarak raporlanır ve sonraki geçişte geçersiz sayılır.
export function verifyTransitionLog(logFile,control){
  if(!fs.existsSync(logFile))return {ok:!control?.lastTransition,entries:0,unapplied:0,reason:control?.lastTransition?"LOG_MISSING":null};
  const lines=fs.readFileSync(logFile,"utf8").split("\n").filter(Boolean),index=new Map(),order=[];let bad=null,prev={seq:0,hash:GENESIS};
  for(const l of lines){let e;try{e=JSON.parse(l)}catch{bad="LOG_LINE_NOT_JSON";break}const {hash,...body}=e;
    if(entryHash(body)!==hash){bad=`LOG_ENTRY_HASH_MISMATCH:${e.seq}`;break}
    if(e.seq!==prev.seq+1){bad=`LOG_SEQUENCE_BROKEN:${e.seq}`;break}
    if(e.prevHash!==prev.hash){bad=`LOG_CHAIN_BROKEN:${e.seq}`;break}
    if(index.has(hash)){bad=`LOG_ENTRY_DUPLICATE:${e.seq}`;break}
    if("recoveredFrom" in e||"voids" in e){const from=e.recoveredFrom===GENESIS?-1:index.get(e.recoveredFrom),expected=from===undefined?null:order.slice(from+1).map(x=>x.hash);
      if(!expected||!expected.length||!Array.isArray(e.voids)||e.voids.join(",")!==expected.join(",")){bad=`LOG_RECOVERY_INVALID:${e.seq}`;break}}
    index.set(hash,order.length);order.push({seq:e.seq,hash});prev={seq:e.seq,hash}}
  let unapplied=0;
  if(!bad&&control?.lastTransition){const k=index.get(control.lastTransition.hash);if(k===undefined)bad="STATE_TRANSITION_NOT_IN_LOG";else if(order[k].seq!==control.lastTransition.seq)bad="STATE_TRANSITION_SEQ_MISMATCH";else unapplied=order.length-1-k}
  else if(!bad)unapplied=order.length;
  return {ok:!bad,entries:lines.length,unapplied,reason:bad};
}
// //TR: Lease tek aktif worker'ı garanti eder; süresi dolmamış başka bir worker'ın lease'i varken yeni worker reddedilir, süresi dolmuşsa bayat kabul edilir ve devralınır.
export function acquireLease(control,{workerId,now=new Date(),ttlMs}){
  const l=control.lease;if(l&&l.workerId!==workerId&&Date.parse(l.expiresAt)>now.getTime())return {ok:false,reason:"LEASE_HELD",holder:l.workerId};
  const stale=Boolean(l&&l.workerId!==workerId);return {ok:true,stale,previous:stale?l:null,control:{...control,lease:{workerId,acquiredAt:now.toISOString(),heartbeatAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttlMs).toISOString()}}};
}
export function heartbeat(control,{workerId,now=new Date(),ttlMs}){if(control.lease?.workerId!==workerId)throw new Error("LEASE_NOT_OWNED");return {...control,lease:{...control.lease,heartbeatAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttlMs).toISOString()}}}
export function releaseLease(control,{workerId}){if(control.lease?.workerId!==workerId)return control;const {lease,...rest}=control;return rest}
