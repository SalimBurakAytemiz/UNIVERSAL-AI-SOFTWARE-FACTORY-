// //TR: Bu dosya CLOUD-T0008 bulut artifact deposunu tanımlar: tenant izolasyonu, sha256 içerik adresleme (put ve get'te doğrulama), boyut sınırı, güvenli ad, durağanda şifreleme (AES-256-GCM), değiştirilemez provenance, secret reddi ve tenant+artifact+sha'ya bağlı kısa ömürlü imzalı teslim URL'i; her uyuşmazlık reddir (fail-closed).
import {createCipheriv,createDecipheriv,createHmac,hkdfSync,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {mkdir,link,readFile,unlink,writeFile} from "node:fs/promises";
import {dirname,resolve,sep} from "node:path";
import {canonicalJson,sha256Hex,verifyArtifact,type ArtifactRef} from "./contracts.js";
import {findSecretKinds,redactSecrets} from "../workos/secret-scan.js";

export const ARTIFACT_STORE_VERSION="uasco.cloud.artifacts.v1" as const;
export const DEFAULT_MAX_ARTIFACT_BYTES=256*1024*1024;
/** Yapılandırma ile aşılamayan sert tavan (V8 dize sınırının ve tek parça bellek tamponunun altında). */
export const HARD_MAX_ARTIFACT_BYTES=256*1024*1024;
/** Secret taraması parça parça yapılır; örtüşme sınırda bölünen kalıpları yakalar. */
const SCAN_CHUNK_BYTES=4*1024*1024;
const SCAN_OVERLAP_BYTES=4096;
export const DEFAULT_DELIVERY_TTL_MS=5*60*1000;
export const MAX_DELIVERY_TTL_MS=15*60*1000;
export const MIN_KEY_BYTES=32;

// contracts.ts ile aynı kalıplar (orada dışa aktarılmıyor; sözleşme dosyası bu görevin yazma kümesinde değil).
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SHA256_RE=/^[0-9a-f]{64}$/;
const ARTIFACT_NAME_RE=/^(?!.*\.\.)(?![/\\])[A-Za-z0-9._/-]{1,255}$/;
const HEX64_RE=/^[0-9a-f]{64}$/;
const B64URL_RE=/^[A-Za-z0-9_-]{1,2048}$/;
const BLOB_FORMAT=0x01;

/** Sözleşme kalıbına ek olarak boş/"." segment ve sondaki "/" reddedilir. */
export function isSafeArtifactName(name:unknown):name is string{
  return typeof name==="string"&&ARTIFACT_NAME_RE.test(name)&&name.split("/").every(seg=>seg!==""&&seg!==".");
}

export type ArtifactDenyReason=
  |"INVALID_ID"|"INVALID_NAME"|"INVALID_CONTENT"|"TOO_LARGE"|"SIZE_MISMATCH"|"HASH_MISMATCH"|"SECRET_DETECTED"
  |"ARTIFACT_IMMUTABLE"|"NOT_FOUND"|"MANIFEST_TAMPERED"|"BLOB_TAMPERED"|"BACKEND_ERROR"
  |"TENANT_DENIED"|"TTL_OUT_OF_RANGE"|"BASE_URL_INSECURE"
  |"TOKEN_MALFORMED"|"TOKEN_KEY_UNKNOWN"|"TOKEN_SIGNATURE_INVALID"|"TOKEN_EXPIRED"|"TOKEN_NOT_YET_VALID"|"TOKEN_REVOKED"|"TOKEN_SCOPE_MISMATCH";

export type ArtifactResult<T>={ok:true}&T|{ok:false;reason:ArtifactDenyReason};

// --- storage backend ---
/** Depolama arka ucu yalnız opak (şifreli) baytları görür. Yazma bir kez: mevcut anahtar asla üzerine yazılmaz. */
export interface ArtifactBlobBackend{
  readonly name:string;
  /** true => yazıldı; false => anahtar zaten vardı (dokunulmadı). */
  putIfAbsent(key:string,data:Buffer):Promise<boolean>;
  get(key:string):Promise<Buffer|undefined>;
}

const KEY_RE=/^(?:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/){1,8}[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function assertKey(key:string):void{
  if(!KEY_RE.test(key)||key.split("/").some(s=>s==="."||s===".."))throw new Error("ARTIFACT_BACKEND_KEY_INVALID");
}

/** Testler ve tek süreçli staging için bellek içi arka uç. */
export class InMemoryArtifactBackend implements ArtifactBlobBackend{
  readonly name="memory";
  private readonly blobs=new Map<string,Buffer>();
  async putIfAbsent(key:string,data:Buffer):Promise<boolean>{
    assertKey(key);
    if(this.blobs.has(key))return false;
    this.blobs.set(key,Buffer.from(data));return true;
  }
  async get(key:string):Promise<Buffer|undefined>{assertKey(key);const b=this.blobs.get(key);return b?Buffer.from(b):undefined}
  /** Yalnız test: durağandaki baytları kurcalamak için. */
  tamper(key:string,mutate:(b:Buffer)=>Buffer):void{const b=this.blobs.get(key);if(b)this.blobs.set(key,mutate(Buffer.from(b)))}
  keys():string[]{return [...this.blobs.keys()]}
}

/**
 * Dizin arka ucu: geçici dosya + hard link ile atomik, bir kez yazılan nesneler; kök dışına çıkış reddedilir.
 * Yalnız büyük/küçük harf duyarlı Linux dosya sistemi içindir (staging/test): fsync yapmaz ve kök altındaki önceden var olan
 * symlink'leri izler; harf katlayan birimlerde (APFS/NTFS) "Acme"/"acme" tenant yolları çakışır. Üretim için kullanılmaz.
 */
export class FileSystemArtifactBackend implements ArtifactBlobBackend{
  readonly name="filesystem";
  private readonly root:string;
  constructor(root:string){this.root=resolve(root)}
  private pathFor(key:string):string{
    assertKey(key);
    const p=resolve(this.root,...key.split("/"));
    if(!p.startsWith(this.root+sep))throw new Error("ARTIFACT_BACKEND_PATH_ESCAPE");
    return p;
  }
  async putIfAbsent(key:string,data:Buffer):Promise<boolean>{
    const p=this.pathFor(key);
    await mkdir(dirname(p),{recursive:true});
    const tmp=`${p}.${randomUUID()}.tmp`;
    await writeFile(tmp,data,{flag:"wx"});
    try{await link(tmp,p);return true}
    catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")return false;throw e}
    finally{await unlink(tmp).catch(()=>undefined)}
  }
  async get(key:string):Promise<Buffer|undefined>{
    try{return await readFile(this.pathFor(key))}
    catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw e}
  }
}

// --- manifest / provenance ---
export interface ArtifactManifest{
  v:typeof ARTIFACT_STORE_VERSION;
  tenantId:string;projectId:string;name:string;sha256:string;sizeBytes:number;
  storedAt:string;jobId:string|null;producer:string|null;
  /** hex HMAC-SHA256 (tenant'a özel anahtar) over canonicalJson(manifest without mac) */
  mac:string;
}

export interface ArtifactAuditRecord{
  at:string;action:"PUT"|"GET"|"ISSUE_DELIVERY"|"REDEEM_DELIVERY";decision:"ALLOWED"|"REPLAY"|"DENIED";
  tenantId:string|null;projectId:string|null;name:string|null;sha256:string|null;subject?:string|null;reason?:ArtifactDenyReason;secretKinds?:string[];
}

export interface DeliveryPrincipal{tenantId:string;subject:string}
export interface ArtifactLocator{tenantId:string;projectId:string;name:string}
export interface PutArtifactInput extends ArtifactLocator{content:Buffer;sha256:string;sizeBytes:number;jobId?:string;producer?:string}

export interface CloudArtifactStoreOptions{
  backend:ArtifactBlobBackend;
  /** ≥32 bayt; tenant başına şifreleme ve manifest MAC anahtarları HKDF ile türetilir. */
  masterKey:Buffer;
  /** keyId -> secret (≥32 bayt). Boş => teslim URL'i üretilemez/açılamaz. */
  deliveryKeys:ReadonlyMap<string,string|Buffer>;
  activeDeliveryKeyId:string;
  /** Teslim uç noktası; yalnız https. */
  deliveryBaseUrl:string;
  maxArtifactBytes?:number;
  /** Artifact içinde aranacak bilinen secret değerleri (≥8 karakter). */
  knownSecrets?:readonly string[];
  revokedTokenIds?:ReadonlySet<string>;
  audit?:(r:ArtifactAuditRecord)=>void;
  now?:()=>Date;
}

interface DeliveryClaims{v:typeof ARTIFACT_STORE_VERSION;kid:string;jti:string;sub:string;t:string;p:string;n:string;s:string;iat:number;exp:number}

const keyLen=(k:string|Buffer)=>typeof k==="string"?Buffer.byteLength(k):k.byteLength;
const isId=(v:unknown):v is string=>typeof v==="string"&&ID_RE.test(v);
const fail=<T>(reason:ArtifactDenyReason):ArtifactResult<T>=>({ok:false,reason});
const b64url=(s:string)=>Buffer.from(s,"utf8").toString("base64url");

function hexEqual(a:string,b:string):boolean{
  if(!HEX64_RE.test(a)||!HEX64_RE.test(b))return false;
  return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}

export class CloudArtifactStore{
  private readonly o:CloudArtifactStoreOptions;
  private readonly maxBytes:number;
  private readonly now:()=>Date;
  private readonly baseUrl:URL|null;

  constructor(o:CloudArtifactStoreOptions){
    if(!Buffer.isBuffer(o.masterKey)||o.masterKey.byteLength<MIN_KEY_BYTES)throw new Error("ARTIFACT_MASTER_KEY_TOO_SHORT");
    for(const [kid,k] of o.deliveryKeys)if(!isId(kid)||keyLen(k)<MIN_KEY_BYTES)throw new Error("ARTIFACT_DELIVERY_KEY_INVALID");
    const max=o.maxArtifactBytes??DEFAULT_MAX_ARTIFACT_BYTES;
    if(!Number.isSafeInteger(max)||max<1||max>HARD_MAX_ARTIFACT_BYTES)throw new Error("ARTIFACT_MAX_BYTES_INVALID");
    this.o=o;this.maxBytes=max;this.now=o.now??(()=>new Date());
    let u:URL|null=null;
    try{u=new URL(o.deliveryBaseUrl)}catch{u=null}
    this.baseUrl=u&&u.protocol==="https:"&&!u.username&&!u.password&&!u.search&&!u.hash?u:null;
  }

  private derive(tenantId:string,purpose:"enc"|"mac"):Buffer{
    return Buffer.from(hkdfSync("sha256",this.o.masterKey,ARTIFACT_STORE_VERSION,`${purpose}:${tenantId}`,32));
  }
  private blobKey(t:string,p:string,sha:string){return `t/${t}/p/${p}/blob/${sha}`}
  private manifestKey(t:string,p:string,name:string){return `t/${t}/p/${p}/manifest/${sha256Hex(name)}`}
  private macOf(m:Omit<ArtifactManifest,"mac">):string{return createHmac("sha256",this.derive(m.tenantId,"mac")).update(canonicalJson(m)).digest("hex")}
  private aad(t:string,p:string,sha:string):Buffer{return Buffer.from(canonicalJson({v:ARTIFACT_STORE_VERSION,tenantId:t,projectId:p,sha256:sha}))}

  private log(r:Omit<ArtifactAuditRecord,"at">):void{
    if(!this.o.audit)return;
    try{this.o.audit({at:this.now().toISOString(),...r,name:r.name===null?null:redactSecrets(r.name)})}catch{/* audit sink hatası işlemi değiştirmez */}
  }

  private locatorOk(l:ArtifactLocator):ArtifactDenyReason|null{
    if(!l||typeof l!=="object"||!isId(l.tenantId)||!isId(l.projectId))return "INVALID_ID";
    if(!isSafeArtifactName(l.name))return "INVALID_NAME";
    return null;
  }

  private scanSecrets(content:Buffer):string[]{
    const known=(this.o.knownSecrets??[]).filter(s=>typeof s==="string"&&s.length>=8);
    const overlap=Math.max(SCAN_OVERLAP_BYTES,...known.map(s=>Buffer.byteLength(s)));
    const kinds=new Set<string>();
    for(let off=0;off===0||off<content.byteLength;off+=SCAN_CHUNK_BYTES){
      const text=content.subarray(Math.max(0,off-overlap),off+SCAN_CHUNK_BYTES).toString("utf8");
      for(const k of findSecretKinds(text))kinds.add(k);
      for(const s of known)if(text.includes(s))kinds.add("known-secret");
    }
    return [...kinds].sort();
  }

  /** İçerik adresli, bir kez yazılan put. Beyan edilen sha/boyut gerçek içerikle eşleşmeli; aynı ad + aynı sha => REPLAY, farklı sha => ARTIFACT_IMMUTABLE. */
  async put(input:PutArtifactInput):Promise<ArtifactResult<{manifest:ArtifactManifest;replay:boolean}>>{
    const loc={tenantId:input?.tenantId,projectId:input?.projectId,name:input?.name};
    const base={action:"PUT" as const,tenantId:isId(loc.tenantId)?loc.tenantId:null,projectId:isId(loc.projectId)?loc.projectId:null,
      name:isSafeArtifactName(loc.name)?loc.name:null,sha256:typeof input?.sha256==="string"&&SHA256_RE.test(input.sha256)?input.sha256:null};
    const deny=(reason:ArtifactDenyReason,extra:Partial<ArtifactAuditRecord>={})=>{this.log({...base,decision:"DENIED",reason,...extra});return fail<{manifest:ArtifactManifest;replay:boolean}>(reason)};
    const bad=this.locatorOk(loc as ArtifactLocator);
    if(bad)return deny(bad);
    if((input.jobId!==undefined&&!isId(input.jobId))||(input.producer!==undefined&&!isId(input.producer)))return deny("INVALID_ID");
    if(!Buffer.isBuffer(input.content))return deny("INVALID_CONTENT");
    if(input.content.byteLength>this.maxBytes)return deny("TOO_LARGE");
    // Çağıranın tamponu değişebilir: doğrulama, tarama ve şifreleme yalnız girişte alınan kopya üzerinde yapılır.
    const content=Buffer.from(input.content);
    if(typeof input.sha256!=="string"||!SHA256_RE.test(input.sha256))return deny("HASH_MISMATCH");
    if(typeof input.sizeBytes!=="number"||!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<0)return deny("SIZE_MISMATCH");
    if(input.sizeBytes>this.maxBytes)return deny("TOO_LARGE");
    if(content.byteLength!==input.sizeBytes)return deny("SIZE_MISMATCH");
    const ref:ArtifactRef={name:input.name,sha256:input.sha256,sizeBytes:input.sizeBytes};
    const {tenantId:t,projectId:p,name}=input;
    try{
      if(!verifyArtifact(ref,content))return deny("HASH_MISMATCH");
      const kinds=this.scanSecrets(content);
      if(kinds.length)return deny("SECRET_DETECTED",{secretKinds:kinds});
      const prev=await this.readManifest({tenantId:t,projectId:p,name});
      if(prev.ok)return this.immutableOrReplay(prev.manifest,input.sha256,base,deny);
      if(prev.reason!=="NOT_FOUND")return deny(prev.reason);
      const iv=randomBytes(12);
      const c=createCipheriv("aes-256-gcm",this.derive(t,"enc"),iv);c.setAAD(this.aad(t,p,input.sha256));
      const ct=Buffer.concat([c.update(content),c.final()]);
      const blobKey=this.blobKey(t,p,input.sha256);
      if(!await this.o.backend.putIfAbsent(blobKey,Buffer.concat([Buffer.from([BLOB_FORMAT]),iv,c.getAuthTag(),ct]))){
        // Yuva zaten dolu (aynı içerik başka adla ya da önceki yarım/bozuk yazım): manifest yazılmadan önce mevcut blob doğrulanır.
        const existing=await this.o.backend.get(blobKey);
        if(!existing)return deny("BLOB_TAMPERED");
        const v=this.decryptVerified(t,p,input.sha256,input.sizeBytes,existing);
        if(!v.ok)return deny(v.reason);
      }
      const body:Omit<ArtifactManifest,"mac">={v:ARTIFACT_STORE_VERSION,tenantId:t,projectId:p,name,sha256:input.sha256,sizeBytes:input.sizeBytes,
        storedAt:this.now().toISOString(),jobId:input.jobId??null,producer:input.producer??null};
      const manifest:ArtifactManifest={...body,mac:this.macOf(body)};
      const wrote=await this.o.backend.putIfAbsent(this.manifestKey(t,p,name),Buffer.from(canonicalJson(manifest)));
      if(!wrote){   // yarış: başka yazar önce geldi
        const raced=await this.readManifest({tenantId:t,projectId:p,name});
        if(!raced.ok)return deny(raced.reason);
        return this.immutableOrReplay(raced.manifest,input.sha256,base,deny);
      }
      this.log({...base,decision:"ALLOWED"});
      return {ok:true,manifest,replay:false};
    }catch{return deny("BACKEND_ERROR")}
  }

  private immutableOrReplay(m:ArtifactManifest,sha:string,base:Omit<ArtifactAuditRecord,"at"|"decision">,
    deny:(r:ArtifactDenyReason)=>ArtifactResult<{manifest:ArtifactManifest;replay:boolean}>):ArtifactResult<{manifest:ArtifactManifest;replay:boolean}>{
    if(!hexEqual(m.sha256,sha))return deny("ARTIFACT_IMMUTABLE");
    this.log({...base,decision:"REPLAY"});
    return {ok:true,manifest:m,replay:true};
  }

  private async readManifest(l:ArtifactLocator):Promise<ArtifactResult<{manifest:ArtifactManifest}>>{
    const raw=await this.o.backend.get(this.manifestKey(l.tenantId,l.projectId,l.name));
    if(!raw)return fail("NOT_FOUND");
    let m:ArtifactManifest;
    try{m=JSON.parse(raw.toString("utf8")) as ArtifactManifest}catch{return fail("MANIFEST_TAMPERED")}
    if(!m||typeof m!=="object"||typeof m.mac!=="string")return fail("MANIFEST_TAMPERED");
    const {mac,...body}=m;
    let expected:string;
    try{expected=this.macOf(body)}catch{return fail("MANIFEST_TAMPERED")}
    if(!hexEqual(mac,expected))return fail("MANIFEST_TAMPERED");
    // MAC geçerli olsa bile kimlik alanları istekle birebir eşleşmeli (başka tenant/proje/ad kaydının taşınması reddedilir).
    if(m.v!==ARTIFACT_STORE_VERSION||m.tenantId!==l.tenantId||m.projectId!==l.projectId||m.name!==l.name||!SHA256_RE.test(m.sha256)
      ||!Number.isSafeInteger(m.sizeBytes)||m.sizeBytes<0)return fail("MANIFEST_TAMPERED");
    return {ok:true,manifest:m};
  }

  private async fetchVerified(l:ArtifactLocator,expectSha?:string):Promise<ArtifactResult<{content:Buffer;manifest:ArtifactManifest}>>{
    const mr=await this.readManifest(l);
    if(!mr.ok)return mr;
    const m=mr.manifest;
    if(expectSha!==undefined&&!hexEqual(m.sha256,expectSha))return fail("HASH_MISMATCH");
    const blob=await this.o.backend.get(this.blobKey(l.tenantId,l.projectId,m.sha256));
    if(!blob)return fail("NOT_FOUND");
    const v=this.decryptVerified(l.tenantId,l.projectId,m.sha256,m.sizeBytes,blob);
    return v.ok?{ok:true,content:v.content,manifest:m}:v;
  }

  /** Şifreli blob'u açar ve içeriği beyan edilen sha/boyutla yeniden doğrular. */
  private decryptVerified(t:string,p:string,sha:string,sizeBytes:number,blob:Buffer):ArtifactResult<{content:Buffer}>{
    if(blob.byteLength<1+12+16||blob[0]!==BLOB_FORMAT)return fail("BLOB_TAMPERED");
    let content:Buffer;
    try{
      const d=createDecipheriv("aes-256-gcm",this.derive(t,"enc"),blob.subarray(1,13));
      d.setAAD(this.aad(t,p,sha));d.setAuthTag(blob.subarray(13,29));
      content=Buffer.concat([d.update(blob.subarray(29)),d.final()]);
    }catch{return fail("BLOB_TAMPERED")}
    if(!verifyArtifact({name:"blob",sha256:sha,sizeBytes},content))return fail("HASH_MISMATCH");
    return {ok:true,content};
  }

  /** Doğrulanmış okuma: manifest MAC, şifreli blob bütünlüğü ve sha/boyut yeniden hesaplanır. Çağıran tenant'ı yalnız kendi tenant'ını okuyabilir. */
  async get(principal:DeliveryPrincipal,l:ArtifactLocator):Promise<ArtifactResult<{content:Buffer;manifest:ArtifactManifest}>>{
    return this.guardedRead("GET",principal,l);
  }

  private async guardedRead(action:"GET"|"REDEEM_DELIVERY",principal:DeliveryPrincipal|null,l:ArtifactLocator,expectSha?:string,tokenSubject?:string):Promise<ArtifactResult<{content:Buffer;manifest:ArtifactManifest}>>{
    const base={action,tenantId:isId(l?.tenantId)?l.tenantId:null,projectId:isId(l?.projectId)?l.projectId:null,
      name:isSafeArtifactName(l?.name)?l.name:null,sha256:expectSha??null,subject:principal&&isId(principal.subject)?principal.subject:(tokenSubject??null)};
    const deny=(reason:ArtifactDenyReason)=>{this.log({...base,decision:"DENIED",reason});return fail<{content:Buffer;manifest:ArtifactManifest}>(reason)};
    const bad=this.locatorOk(l);
    if(bad)return deny(bad);
    if(principal!==null&&(!principal||!isId(principal.tenantId)||!isId(principal.subject)||principal.tenantId!==l.tenantId))return deny("TENANT_DENIED");
    try{
      const r=await this.fetchVerified(l,expectSha);
      if(!r.ok)return deny(r.reason);
      this.log({...base,sha256:r.manifest.sha256,decision:"ALLOWED"});
      return r;
    }catch{return deny("BACKEND_ERROR")}
  }

  /**
   * Kısa ömürlü imzalı teslim URL'i. Token tenant+proje+ad+sha'ya bağlıdır; URL'de imza dışında secret yoktur.
   * Token bir taşıyıcı (bearer) belgedir: exp'e kadar yeniden kullanılabilir ve sorgu dizesinde taşındığından erişim log'u/Referer
   * yoluyla sızabilir; bu yüzden TTL kısa tutulur. Canlı iptal için revokedTokenIds değiştirilebilir bir Set olarak verilmelidir.
   */
  async issueDeliveryUrl(principal:DeliveryPrincipal,l:ArtifactLocator,ttlMs=DEFAULT_DELIVERY_TTL_MS):Promise<ArtifactResult<{url:string;expiresAt:string;sha256:string}>>{
    const base={action:"ISSUE_DELIVERY" as const,tenantId:isId(l?.tenantId)?l.tenantId:null,projectId:isId(l?.projectId)?l.projectId:null,
      name:isSafeArtifactName(l?.name)?l.name:null,sha256:null,subject:principal&&isId(principal.subject)?principal.subject:null};
    const deny=(reason:ArtifactDenyReason)=>{this.log({...base,decision:"DENIED",reason});return fail<{url:string;expiresAt:string;sha256:string}>(reason)};
    const bad=this.locatorOk(l);
    if(bad)return deny(bad);
    if(!principal||!isId(principal.tenantId)||!isId(principal.subject)||principal.tenantId!==l.tenantId)return deny("TENANT_DENIED");
    if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>MAX_DELIVERY_TTL_MS)return deny("TTL_OUT_OF_RANGE");
    if(!this.baseUrl)return deny("BASE_URL_INSECURE");
    const key=this.o.deliveryKeys.get(this.o.activeDeliveryKeyId);
    if(key===undefined)return deny("TOKEN_KEY_UNKNOWN");
    let m:ArtifactManifest;
    try{const r=await this.fetchVerified(l);if(!r.ok)return deny(r.reason);m=r.manifest}catch{return deny("BACKEND_ERROR")}   // bozuk artifact için URL verilmez
    const iat=this.now().getTime();
    const claims:DeliveryClaims={v:ARTIFACT_STORE_VERSION,kid:this.o.activeDeliveryKeyId,jti:randomUUID(),sub:principal.subject,t:l.tenantId,p:l.projectId,n:l.name,s:m.sha256,iat,exp:iat+ttlMs};
    const payload=b64url(canonicalJson(claims));
    const sig=createHmac("sha256",key).update(payload).digest("hex");
    const u=new URL(this.baseUrl.href);
    u.pathname=`${u.pathname.replace(/\/+$/,"")}/artifacts/${encodeURIComponent(l.tenantId)}/${encodeURIComponent(l.projectId)}/${l.name.split("/").map(encodeURIComponent).join("/")}`;
    u.searchParams.set("token",`${payload}.${sig}`);
    this.log({...base,sha256:m.sha256,decision:"ALLOWED"});
    return {ok:true,url:u.href,expiresAt:new Date(claims.exp).toISOString(),sha256:m.sha256};
  }

  /** Teslim URL'ini açar: köken, yol ve token iddiaları birebir eşleşmeli; imza sabit zamanlı doğrulanır; içerik sha'sı token'daki sha ile eşleşmeli. */
  async redeemDeliveryUrl(url:string):Promise<ArtifactResult<{content:Buffer;manifest:ArtifactManifest}>>{
    const deny=(reason:ArtifactDenyReason,l:Partial<ArtifactLocator>={})=>{
      this.log({action:"REDEEM_DELIVERY",decision:"DENIED",reason,tenantId:isId(l.tenantId)?l.tenantId:null,projectId:isId(l.projectId)?l.projectId:null,
        name:isSafeArtifactName(l.name)?l.name:null,sha256:null});
      return fail<{content:Buffer;manifest:ArtifactManifest}>(reason);
    };
    if(!this.baseUrl)return deny("BASE_URL_INSECURE");
    let u:URL;
    try{u=new URL(url)}catch{return deny("TOKEN_MALFORMED")}
    const prefix=`${this.baseUrl.pathname.replace(/\/+$/,"")}/artifacts/`;
    if(u.origin!==this.baseUrl.origin||!u.pathname.startsWith(prefix)||u.hash||u.username||u.password)return deny("TOKEN_SCOPE_MISMATCH");
    const tokens=u.searchParams.getAll("token");
    if(tokens.length!==1||[...u.searchParams.keys()].length!==1)return deny("TOKEN_MALFORMED");
    let segs:string[];
    try{segs=u.pathname.slice(prefix.length).split("/").map(decodeURIComponent)}catch{return deny("TOKEN_MALFORMED")}
    if(segs.length<3)return deny("TOKEN_SCOPE_MISMATCH");
    const l:ArtifactLocator={tenantId:segs[0]!,projectId:segs[1]!,name:segs.slice(2).join("/")};
    const parts=tokens[0]!.split(".");
    if(parts.length!==2||!B64URL_RE.test(parts[0]!)||!HEX64_RE.test(parts[1]!))return deny("TOKEN_MALFORMED",l);
    let c:DeliveryClaims;
    try{c=JSON.parse(Buffer.from(parts[0]!,"base64url").toString("utf8")) as DeliveryClaims}catch{return deny("TOKEN_MALFORMED",l)}
    if(!c||typeof c!=="object"||c.v!==ARTIFACT_STORE_VERSION||!isId(c.kid)||typeof c.jti!=="string"||!isId(c.sub)||!isId(c.t)||!isId(c.p)||!isSafeArtifactName(c.n)
      ||typeof c.s!=="string"||!SHA256_RE.test(c.s)||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp))return deny("TOKEN_MALFORMED",l);
    const key=this.o.deliveryKeys.get(c.kid);
    if(key===undefined)return deny("TOKEN_KEY_UNKNOWN",l);
    if(!hexEqual(parts[1]!,createHmac("sha256",key).update(parts[0]!).digest("hex")))return deny("TOKEN_SIGNATURE_INVALID",l);
    const now=this.now().getTime();
    if(!Number.isFinite(now)||c.exp<=c.iat||c.exp-c.iat>MAX_DELIVERY_TTL_MS)return deny("TOKEN_MALFORMED",l);
    if(c.iat>now+60_000)return deny("TOKEN_NOT_YET_VALID",l);
    if(now>=c.exp)return deny("TOKEN_EXPIRED",l);
    if(this.o.revokedTokenIds?.has(c.jti))return deny("TOKEN_REVOKED",l);
    if(c.t!==l.tenantId||c.p!==l.projectId||c.n!==l.name)return deny("TOKEN_SCOPE_MISMATCH",l);
    return this.guardedRead("REDEEM_DELIVERY",null,l,c.s,c.sub);
  }
}
