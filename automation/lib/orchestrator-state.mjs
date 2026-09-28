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
// //TR: Geçiş önce hash zincirli günlüğe eklenir, sonra durum atomik yazılır; prevHash her zaman kaydedilen son geçişe bağlanır, çökmede uygulanmamış günlük kaydı zinciri bozmadan görünür kalır.
export function commitTransition({stateFile,logFile,doc,next,event,now=new Date()}){
  validateControl(next);const prev=doc.control?.lastTransition??{seq:0,hash:"0".repeat(64)};
  const body={seq:prev.seq+1,at:now.toISOString(),prevHash:prev.hash,type:String(event?.type??"UNSPECIFIED"),packageId:event?.packageId??null,from:event?.from??null,to:event?.to??null,reason:event?.reason??null,evidence:event?.evidence??null,workerId:next.lease?.workerId??null};
  const entry={...body,hash:entryHash(body)};fs.mkdirSync(path.dirname(logFile),{recursive:true});
  const fd=fs.openSync(logFile,"a");try{fs.writeSync(fd,JSON.stringify(entry)+"\n");fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  const control={...next,lastTransition:{seq:entry.seq,hash:entry.hash,at:entry.at}};const out={...doc,control,updatedAt:now.toISOString()};writeJsonAtomic(stateFile,out);return {doc:out,control,entry};
}
export function verifyTransitionLog(logFile,control){
  if(!fs.existsSync(logFile))return {ok:!control?.lastTransition,entries:0,reason:control?.lastTransition?"LOG_MISSING":null};
  const lines=fs.readFileSync(logFile,"utf8").split("\n").filter(Boolean),byHash=new Map();let bad=null;
  for(const l of lines){let e;try{e=JSON.parse(l)}catch{bad="LOG_LINE_NOT_JSON";break}const {hash,...body}=e;if(entryHash(body)!==hash){bad=`LOG_ENTRY_HASH_MISMATCH:${e.seq}`;break}if(e.seq>1&&!byHash.has(e.prevHash)){bad=`LOG_CHAIN_BROKEN:${e.seq}`;break}byHash.set(hash,e)}
  if(!bad&&control?.lastTransition&&!byHash.has(control.lastTransition.hash))bad="STATE_TRANSITION_NOT_IN_LOG";
  return {ok:!bad,entries:lines.length,reason:bad};
}
// //TR: Lease tek aktif worker'ı garanti eder; süresi dolmamış başka bir worker'ın lease'i varken yeni worker reddedilir, süresi dolmuşsa bayat kabul edilir ve devralınır.
export function acquireLease(control,{workerId,now=new Date(),ttlMs}){
  const l=control.lease;if(l&&l.workerId!==workerId&&Date.parse(l.expiresAt)>now.getTime())return {ok:false,reason:"LEASE_HELD",holder:l.workerId};
  const stale=Boolean(l&&l.workerId!==workerId);return {ok:true,stale,previous:stale?l:null,control:{...control,lease:{workerId,acquiredAt:now.toISOString(),heartbeatAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttlMs).toISOString()}}};
}
export function heartbeat(control,{workerId,now=new Date(),ttlMs}){if(control.lease?.workerId!==workerId)throw new Error("LEASE_NOT_OWNED");return {...control,lease:{...control.lease,heartbeatAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttlMs).toISOString()}}}
export function releaseLease(control,{workerId}){if(control.lease?.workerId!==workerId)return control;const {lease,...rest}=control;return rest}
