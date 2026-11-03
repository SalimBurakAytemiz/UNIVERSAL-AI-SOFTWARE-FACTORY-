// //TR: Bu dosya CLOUD-T0001 bulut yürütme veri sözleşmesini ve güven sınırını tanımlar: job kimliği, tenant, imzalı kapsam, timeout, idempotency, retry, yapılandırılmış olaylar, artifact SHA ve fail-closed red politikası.
import {createHash,createHmac,timingSafeEqual} from "node:crypto";

export const CLOUD_CONTRACT_VERSION="uasco.cloud.v1" as const;
/** 24h hard ceiling (V4.1 8h/24h timeout kuralı); 8h default. */
export const MAX_JOB_TIMEOUT_MS=24*60*60*1000;
export const DEFAULT_JOB_TIMEOUT_MS=8*60*60*1000;
export const MIN_JOB_TIMEOUT_MS=1000;
export const MAX_RETRY_ATTEMPTS=3;
export const MAX_RETRY_BACKOFF_MS=15*60*1000;
export const MAX_SCOPE_LIFETIME_MS=24*60*60*1000;
export const MAX_INPUT_ARTIFACTS=256;

export type CloudJobKind="BUILD"|"TEST"|"SECURITY_SCAN"|"MODEL_CALL"|"PACKAGE"|"DELIVERY";
export const CLOUD_JOB_KINDS:readonly CloudJobKind[]=["BUILD","TEST","SECURITY_SCAN","MODEL_CALL","PACKAGE","DELIVERY"];
export type CloudEnvironment="staging"|"production";

export interface ArtifactRef{name:string;sha256:string;sizeBytes:number}

/** Supervisor tarafından imzalanan yetki kapsamı. İstemci (Windows .exe) bunu üretemez, yalnız taşır. */
export interface SignedScope{
  tenantId:string;
  projectId:string;
  environment:CloudEnvironment;
  jobKinds:CloudJobKind[];
  allowNetwork:boolean;
  maxCostUsd:number;
  issuedAt:string;
  expiresAt:string;
  keyId:string;
  /** hex HMAC-SHA256 over canonicalJson(scope without signature) */
  signature:string;
}
export type UnsignedScope=Omit<SignedScope,"signature">;

export interface RetryPolicy{maxAttempts:number;backoffMs:number}

export interface CloudJobRequest{
  contractVersion:typeof CLOUD_CONTRACT_VERSION;
  jobId:string;
  tenantId:string;
  projectId:string;
  environment:CloudEnvironment;
  kind:CloudJobKind;
  idempotencyKey:string;
  timeoutMs:number;
  retry:RetryPolicy;
  needsNetwork:boolean;
  estimatedCostUsd:number;
  inputArtifacts:ArtifactRef[];
  scope:SignedScope;
  requestedAt:string;
}

export type CloudDenyReason=
  |"MALFORMED_REQUEST"|"CONTRACT_VERSION_UNSUPPORTED"|"INVALID_ID"|"INVALID_KIND"
  |"TIMEOUT_OUT_OF_RANGE"|"RETRY_OUT_OF_RANGE"|"COST_INVALID"|"ARTIFACT_INVALID"
  |"SCOPE_MALFORMED"|"SCOPE_KEY_UNKNOWN"|"SCOPE_SIGNATURE_INVALID"|"SCOPE_NOT_YET_VALID"|"SCOPE_EXPIRED"|"SCOPE_LIFETIME_TOO_LONG"
  |"TENANT_MISMATCH"|"PROJECT_MISMATCH"|"ENVIRONMENT_MISMATCH"|"KIND_NOT_IN_SCOPE"|"NETWORK_NOT_IN_SCOPE"|"COST_EXCEEDS_SCOPE"
  |"REQUEST_FROM_FUTURE"|"IDEMPOTENCY_CONFLICT";

export type CloudJobDecision=
  |{ok:true;job:CloudJobRequest;requestDigest:string;replay:boolean}
  |{ok:false;reason:CloudDenyReason;detail?:string};

export interface ValidationContext{
  /** keyId -> secret; empty map => every request denied (fail-closed). */
  scopeKeys:ReadonlyMap<string,string|Buffer>;
  now:Date;
  /** idempotencyKey scoped by tenant -> requestDigest of first accepted request */
  idempotencyIndex?:Map<string,string>;
  /** clock skew tolerance for requestedAt/issuedAt (default 5 min) */
  maxClockSkewMs?:number;
}

const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SHA256_RE=/^[0-9a-f]{64}$/;
const ARTIFACT_NAME_RE=/^(?!.*\.\.)(?![/\\])[A-Za-z0-9._/-]{1,255}$/;

/** Deterministik JSON: anahtarlar sıralı, undefined alanlar atılır. */
export function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object"){
    if(typeof value==="number"&&!Number.isFinite(value))throw new Error("Non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return `[${value.map(v=>canonicalJson(v===undefined?null:v)).join(",")}]`;
  const obj=value as Record<string,unknown>;
  return `{${Object.keys(obj).filter(k=>obj[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function sha256Hex(data:string|Buffer):string{return createHash("sha256").update(data).digest("hex")}

function stripSignature(scope:SignedScope):UnsignedScope{
  const {signature:_sig,...rest}=scope;return rest;
}

export function signScope(scope:UnsignedScope,secret:string|Buffer):SignedScope{
  if(!secret||(typeof secret==="string"?secret.length:secret.byteLength)<32)throw new Error("Scope signing secret must be at least 32 bytes");
  const signature=createHmac("sha256",secret).update(canonicalJson(scope)).digest("hex");
  return {...scope,signature};
}

export function verifyScopeSignature(scope:SignedScope,secret:string|Buffer):boolean{
  if(typeof scope.signature!=="string"||!SHA256_RE.test(scope.signature))return false;
  const expected=Buffer.from(createHmac("sha256",secret).update(canonicalJson(stripSignature(scope))).digest("hex"),"hex");
  const got=Buffer.from(scope.signature,"hex");
  return got.length===expected.length&&timingSafeEqual(got,expected);
}

/** İmzası hariç, isteğin bağlayıcı özeti (idempotency ve audit için). */
export function requestDigest(req:CloudJobRequest):string{
  return sha256Hex(canonicalJson({...req,scope:{...req.scope,signature:undefined}}));
}

const isObj=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const isId=(v:unknown):v is string=>typeof v==="string"&&ID_RE.test(v);
const isBool=(v:unknown):v is boolean=>typeof v==="boolean";
const parseTime=(v:unknown):number=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(v)?Date.parse(v):Number.NaN;
const isEnv=(v:unknown):v is CloudEnvironment=>v==="staging"||v==="production";
const isKind=(v:unknown):v is CloudJobKind=>typeof v==="string"&&(CLOUD_JOB_KINDS as readonly string[]).includes(v);
const isNonNegFinite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0;

function deny(reason:CloudDenyReason,detail?:string):CloudJobDecision{return detail===undefined?{ok:false,reason}:{ok:false,reason,detail}}

function validateScopeShape(s:unknown):s is SignedScope{
  if(!isObj(s))return false;
  return isId(s.tenantId)&&isId(s.projectId)&&isEnv(s.environment)&&Array.isArray(s.jobKinds)&&s.jobKinds.length>0&&s.jobKinds.every(isKind)
    &&isBool(s.allowNetwork)&&isNonNegFinite(s.maxCostUsd)&&Number.isFinite(parseTime(s.issuedAt))&&Number.isFinite(parseTime(s.expiresAt))
    &&isId(s.keyId)&&typeof s.signature==="string";
}

/**
 * Bulut Control API giriş kapısı. Herhangi bir belirsizlik => red (fail-closed).
 * Kabul edilen istek idempotencyIndex'e yazılır; aynı anahtar + aynı özet => replay,
 * aynı anahtar + farklı özet => IDEMPOTENCY_CONFLICT.
 */
export function validateCloudJobRequest(input:unknown,ctx:ValidationContext):CloudJobDecision{
  if(!isObj(input))return deny("MALFORMED_REQUEST");
  const r=input;
  if(r.contractVersion!==CLOUD_CONTRACT_VERSION)return deny("CONTRACT_VERSION_UNSUPPORTED");
  for(const k of ["jobId","tenantId","projectId","idempotencyKey"] as const)if(!isId(r[k]))return deny("INVALID_ID",k);
  if(!isEnv(r.environment))return deny("MALFORMED_REQUEST","environment");
  if(!isKind(r.kind))return deny("INVALID_KIND");
  if(typeof r.timeoutMs!=="number"||!Number.isSafeInteger(r.timeoutMs)||r.timeoutMs<MIN_JOB_TIMEOUT_MS||r.timeoutMs>MAX_JOB_TIMEOUT_MS)return deny("TIMEOUT_OUT_OF_RANGE");
  const retry=r.retry;
  if(!isObj(retry)||typeof retry.maxAttempts!=="number"||!Number.isSafeInteger(retry.maxAttempts)||retry.maxAttempts<1||retry.maxAttempts>MAX_RETRY_ATTEMPTS
    ||typeof retry.backoffMs!=="number"||!Number.isSafeInteger(retry.backoffMs)||retry.backoffMs<0||retry.backoffMs>MAX_RETRY_BACKOFF_MS)return deny("RETRY_OUT_OF_RANGE");
  if(!isBool(r.needsNetwork))return deny("MALFORMED_REQUEST","needsNetwork");
  if(!isNonNegFinite(r.estimatedCostUsd))return deny("COST_INVALID");
  if(!Array.isArray(r.inputArtifacts)||r.inputArtifacts.length>MAX_INPUT_ARTIFACTS)return deny("ARTIFACT_INVALID");
  const names=new Set<string>();
  for(const a of r.inputArtifacts){
    if(!isObj(a)||typeof a.name!=="string"||!ARTIFACT_NAME_RE.test(a.name)||typeof a.sha256!=="string"||!SHA256_RE.test(a.sha256)
      ||typeof a.sizeBytes!=="number"||!Number.isSafeInteger(a.sizeBytes)||a.sizeBytes<0||names.has(a.name))return deny("ARTIFACT_INVALID");
    names.add(a.name);
  }
  const requestedAt=parseTime(r.requestedAt);
  if(!Number.isFinite(requestedAt))return deny("MALFORMED_REQUEST","requestedAt");
  const now=ctx.now.getTime();
  if(!Number.isFinite(now))return deny("MALFORMED_REQUEST","now");
  const skew=ctx.maxClockSkewMs??5*60*1000;
  if(requestedAt>now+skew)return deny("REQUEST_FROM_FUTURE");

  // --- signed scope (trust boundary) ---
  const s=r.scope;
  if(!validateScopeShape(s))return deny("SCOPE_MALFORMED");
  const key=ctx.scopeKeys.get(s.keyId);
  if(key===undefined)return deny("SCOPE_KEY_UNKNOWN");
  if(!verifyScopeSignature(s,key))return deny("SCOPE_SIGNATURE_INVALID");
  const issued=parseTime(s.issuedAt),expires=parseTime(s.expiresAt);
  if(expires<=issued||expires-issued>MAX_SCOPE_LIFETIME_MS)return deny("SCOPE_LIFETIME_TOO_LONG");
  if(issued>now+skew)return deny("SCOPE_NOT_YET_VALID");
  if(now>=expires)return deny("SCOPE_EXPIRED");
  if(s.tenantId!==r.tenantId)return deny("TENANT_MISMATCH");
  if(s.projectId!==r.projectId)return deny("PROJECT_MISMATCH");
  if(s.environment!==r.environment)return deny("ENVIRONMENT_MISMATCH");
  if(!s.jobKinds.includes(r.kind))return deny("KIND_NOT_IN_SCOPE");
  if(r.needsNetwork&&!s.allowNetwork)return deny("NETWORK_NOT_IN_SCOPE");
  if(r.estimatedCostUsd>s.maxCostUsd)return deny("COST_EXCEEDS_SCOPE");

  const job=r as unknown as CloudJobRequest;
  const digest=requestDigest(job);
  let replay=false;
  if(ctx.idempotencyIndex){
    const idxKey=`${job.tenantId}\u0000${job.idempotencyKey}`;
    const prev=ctx.idempotencyIndex.get(idxKey);
    if(prev!==undefined){if(prev!==digest)return deny("IDEMPOTENCY_CONFLICT");replay=true}
    else ctx.idempotencyIndex.set(idxKey,digest);
  }
  return {ok:true,job,requestDigest:digest,replay};
}

// --- structured job events ---
export type CloudJobEventType="QUEUED"|"STARTED"|"HEARTBEAT"|"LOG"|"ARTIFACT"|"RETRYING"|"SUCCEEDED"|"FAILED"|"CANCELLED"|"TIMED_OUT"|"STOPPED";
export const TERMINAL_EVENT_TYPES:readonly CloudJobEventType[]=["SUCCEEDED","FAILED","CANCELLED","TIMED_OUT","STOPPED"];
export interface CloudJobEvent{jobId:string;seq:number;type:CloudJobEventType;at:string;attempt:number;artifact?:ArtifactRef;message?:string}

export type EventStreamVerdict={ok:true;terminal?:CloudJobEventType}|{ok:false;reason:string;index:number};

/** Olay akışı bütünlüğü: tek jobId, seq 0'dan kesintisiz, zaman monoton, ilk olay QUEUED, en çok bir terminal ve en sonda, attempt ≤ retry sınırı. */
export function verifyEventStream(events:readonly CloudJobEvent[],job:Pick<CloudJobRequest,"jobId"|"retry">):EventStreamVerdict{
  let lastAt=-Infinity,attempt=1,terminal:CloudJobEventType|undefined;
  for(let i=0;i<events.length;i++){
    const e=events[i]!;
    if(e.jobId!==job.jobId)return {ok:false,reason:"JOB_ID_MISMATCH",index:i};
    if(e.seq!==i)return {ok:false,reason:"SEQ_GAP",index:i};
    const at=parseTime(e.at);
    if(!Number.isFinite(at)||at<lastAt)return {ok:false,reason:"TIME_NOT_MONOTONIC",index:i};
    lastAt=at;
    if(i===0&&e.type!=="QUEUED")return {ok:false,reason:"FIRST_EVENT_NOT_QUEUED",index:i};
    if(terminal)return {ok:false,reason:"EVENT_AFTER_TERMINAL",index:i};
    if(!Number.isSafeInteger(e.attempt)||e.attempt<attempt||e.attempt>job.retry.maxAttempts)return {ok:false,reason:"ATTEMPT_OUT_OF_RANGE",index:i};
    if(e.type==="RETRYING"){if(e.attempt!==attempt+1)return {ok:false,reason:"RETRY_ATTEMPT_SKIP",index:i}}
    else if(e.attempt!==attempt)return {ok:false,reason:"ATTEMPT_OUT_OF_RANGE",index:i};
    attempt=e.attempt;
    if(e.type==="ARTIFACT"&&(!e.artifact||!SHA256_RE.test(e.artifact.sha256)||!ARTIFACT_NAME_RE.test(e.artifact.name)))return {ok:false,reason:"ARTIFACT_INVALID",index:i};
    if(TERMINAL_EVENT_TYPES.includes(e.type))terminal=e.type;
  }
  return terminal?{ok:true,terminal}:{ok:true};
}

/** Artifact bütünlüğü: beyan edilen SHA ve boyut, gerçek içerikle eşleşmeli. */
export function verifyArtifact(ref:ArtifactRef,content:Buffer):boolean{
  return content.byteLength===ref.sizeBytes&&sha256Hex(content)===ref.sha256;
}

// --- audit ---
export interface CloudAuditRecord{at:string;jobId:string|null;tenantId:string|null;decision:"ACCEPTED"|"REPLAY"|"DENIED";reason?:CloudDenyReason;requestDigest?:string}

/** Audit kaydı imza/sır içermez; reddedilen isteklerde yalnız güvenli kimlik alanları taşınır. */
export function auditRecordFor(input:unknown,decision:CloudJobDecision,now:Date):CloudAuditRecord{
  const r=isObj(input)?input:{};
  const at=now.toISOString();
  if(decision.ok)return {at,jobId:decision.job.jobId,tenantId:decision.job.tenantId,decision:decision.replay?"REPLAY":"ACCEPTED",requestDigest:decision.requestDigest};
  return {at,jobId:isId(r.jobId)?r.jobId:null,tenantId:isId(r.tenantId)?r.tenantId:null,decision:"DENIED",reason:decision.reason};
}
