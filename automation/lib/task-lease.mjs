// //TR: Bu modül ortamlar arası (Cloud-Linux/Local-Windows) tek-görev kira (lease) durum makinesidir; atomiklik tamamen enjekte edilen Store'dan (git ref create-if-absent/CAS) gelir, burada I/O yoktur; süresi dolan kira epoch artırılarak yalnız CAS kazananına devredilir, yarışı kaybeden veya sahibi olmayan fail-closed HELD/LOST/NOOP döner.
// Store contract (injected; every method MUST be atomic in the backing medium):
//   createIfAbsent(taskId, record) -> {created:boolean, current:record|null}   // exactly one concurrent caller gets created:true
//   read(taskId) -> record|null
//   cas(taskId, expected, record) -> {ok:boolean, current:record|null}         // swaps only if leaseVersion(stored) === leaseVersion(expected)
//   remove(taskId, expected) -> {ok:boolean}                                   // deletes only if leaseVersion(stored) === leaseVersion(expected)
// The CAS condition is the observed VERSION (token+epoch+heartbeatAt+expiresAt), not the token alone: renew keeps the token,
// so a token-only CAS would let a taker that observed an expired record overwrite a renew committed after its read.
// Record: {taskId,environment,workerId,sessionId,headSha,epoch,token,acquiredAt,heartbeatAt,expiresAt}; times are epoch-ms numbers supplied by the caller (`now`).
// Epoch is monotonic only while the ref exists (release deletes it); fence on token, which is unique per grant.
import crypto from "node:crypto";
const sameOwner=(a,b)=>!!a&&!!b&&a.environment===b.environment&&a.workerId===b.workerId&&a.sessionId===b.sessionId;
const req=(o,ks)=>{for(const k of ks)if(o?.[k]===undefined||o[k]===null||o[k]==="")throw new Error(`LEASE_ARG_MISSING:${k}`)};
const reqTime=a=>{if(!Number.isFinite(a.now))throw new Error("LEASE_ARG_INVALID:now");if(!(Number.isFinite(a.ttlMs)&&a.ttlMs>0))throw new Error("LEASE_ARG_INVALID:ttlMs")};
const ID=["taskId","environment","workerId","sessionId"];
const mint=(a,epoch)=>({taskId:a.taskId,environment:a.environment,workerId:a.workerId,sessionId:a.sessionId,headSha:a.headSha??null,epoch,token:`${a.sessionId}:${epoch}:${crypto.randomUUID()}`,acquiredAt:a.now,heartbeatAt:a.now,expiresAt:a.now+a.ttlMs});
// A parseable record without the lease shape is unreadable state (never expired/reclaimable): callers fail closed.
export function isValidLeaseRecord(r){return !!r&&typeof r==="object"&&typeof r.token==="string"&&r.token!==""&&Number.isInteger(r.epoch)&&r.epoch>=1&&Number.isFinite(r.heartbeatAt)&&Number.isFinite(r.expiresAt)&&typeof r.environment==="string"&&typeof r.workerId==="string"&&typeof r.sessionId==="string"}
export function leaseVersion(r){return isValidLeaseRecord(r)?JSON.stringify([r.token,r.epoch,r.heartbeatAt,r.expiresAt]):null}
export function isExpired(record,now){return !record||!Number.isFinite(record.expiresAt)||now>record.expiresAt}
export function reclaimableBy(record,now){return isValidLeaseRecord(record)&&isExpired(record,now)}
// claim: GRANTED = caller now exclusively holds taskId; HELD = someone else holds it (or we lost the race / store state unreadable).
export function claim(store,a){req(a,ID);reqTime(a);
  const first=mint(a,1),c=store.createIfAbsent(a.taskId,first);if(c.created)return {status:"GRANTED",record:first};
  const cur=c.current??store.read(a.taskId);if(!isValidLeaseRecord(cur))return {status:"HELD",record:null};
  if(isExpired(cur,a.now)){const next=mint(a,cur.epoch+1),r=store.cas(a.taskId,cur,next);return r.ok?{status:"GRANTED",record:next,previous:cur}:{status:"HELD",record:r.current??null}}
  if(sameOwner(cur,a)){const next={...cur,headSha:a.headSha??cur.headSha,heartbeatAt:a.now,expiresAt:a.now+a.ttlMs},r=store.cas(a.taskId,cur,next);return r.ok?{status:"GRANTED",record:next}:{status:"HELD",record:r.current??null}}
  return {status:"HELD",record:cur}}
// renew: only the current owner extends; the token is stable across renews, so a stale holder never matches after a takeover (owner/token differ -> LOST).
export function renew(store,a){req(a,[...ID,"token"]);reqTime(a);
  const cur=store.read(a.taskId);if(!isValidLeaseRecord(cur)||!sameOwner(cur,a)||a.token!==cur.token)return {status:"LOST",record:cur??null};
  const next={...cur,heartbeatAt:a.now,expiresAt:a.now+a.ttlMs},r=store.cas(a.taskId,cur,next);return r.ok?{status:"RENEWED",record:next}:{status:"LOST",record:r.current??null}}
export function release(store,a){req(a,[...ID,"token"]);
  const cur=store.read(a.taskId);if(!isValidLeaseRecord(cur)||!sameOwner(cur,a)||a.token!==cur.token)return {status:"NOOP"};
  return store.remove(a.taskId,cur).ok?{status:"RELEASED"}:{status:"NOOP"}}
