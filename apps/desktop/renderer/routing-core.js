// //TR: Bu modül Ayarlar > Sağlayıcı ve model yönlendirme görünümünün saf (DOM'suz) çekirdeğidir (PQ-005): mevcut GET /v1/system/executors, /v1/capabilities ve /v1/adapters yanıtlarını güvenli, sınırlı alanlara eşler. Kayıt değerleri (status, activation, implementation) AYNEN taşınır; hiçbiri etkin/bağlı/çalışıyor durumuna YÜKSELTİLMEZ. Yanıtta model alanı yoktur: model "—" kalır. Bozuk kayıt tüm okumayı ERROR yapar (kısmi görünüm yok).
import {redactText} from "./project-core.js";
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/,WORD_RE=/^[A-Z][A-Z0-9_]{0,39}$/;
// //TR: Kimlik ve sözcük alanları yalnız gerçek string olabilir (String() zorlaması 5 veya ["A"] gibi değerleri geçirirdi).
const isId=x=>typeof x==="string"&&ID_RE.test(x),isWord=x=>typeof x==="string"&&WORD_RE.test(x);
const text=(x,max=120)=>typeof x==="string"&&x.length&&x.length<=max&&!/[\u0000-\u001f]/.test(x)?x:null;
export const ROUTING_LIST_LIMIT=60;

/** GET /v1/capabilities -> {state:"VERIFIED",items:[{id,name,status,activation,implementation}],total} | {state:"ERROR"}. */
export function mapCapabilities(raw){
  const bad={state:"ERROR",items:[],total:0};
  const list=isObj(raw)?raw.capabilities:null;if(!Array.isArray(list))return bad;
  const items=[];
  for(const x of list){
    if(!isObj(x)||!isId(x.id)||text(x.name)===null||!isWord(x.status)||!isWord(x.activation)||!isWord(x.implementation))return bad;
    items.push({id:x.id,name:x.name,status:x.status,activation:x.activation,implementation:x.implementation});
  }
  return {state:"VERIFIED",items,total:items.length};
}
/** GET /v1/adapters -> {state:"VERIFIED",items:[{id,category,status,implementation,requiresCertification}],total} | {state:"ERROR"}. requiresCertification yalnız gerçek boolean ise taşınır, aksi halde null. */
export function mapAdapters(raw){
  const bad={state:"ERROR",items:[],total:0};
  const list=isObj(raw)?raw.adapters:null;if(!Array.isArray(list))return bad;
  const items=[];
  for(const x of list){
    // //TR: Sır biçimli kimlik (sk-…, ghp_…, AKIA…) DOM'a hiçbir biçimde (önek, uzunluk, maske) taşınmaz: tüm okuma ERROR olur.
    if(!isObj(x)||!isId(x.id)||redactText(x.id)!==x.id||!isWord(x.category)||!isWord(x.status)||!isWord(x.implementation))return bad;
    items.push({id:x.id,category:x.category,status:x.status,implementation:x.implementation,requiresCertification:typeof x.requiresCertification==="boolean"?x.requiresCertification:null});
  }
  return {state:"VERIFIED",items,total:items.length};
}
/** Değerleri (status/implementation) gruplayıp sayar; sıra sabit (alfabetik). */
export function countBy(items,key){
  const m=new Map();for(const it of items)m.set(it[key],(m.get(it[key])??0)+1);
  return [...m.entries()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([value,count])=>({value,count}));
}
/**
 * Rol -> yürütücü yönlendirme satırları (yalnız okunan değerler): implementer ve reviewer için Claude profil durumu ve LOCAL_CLAUDE yürütücü durumu AYNEN;
 * blockers = READY olmayan okunmuş durumlar (liste); boş liste "bildirilen engel yok" demektir, "etkin/bağlı" DEĞİLDİR. Model alanı bu okumalarda yoktur (model: null).
 */
export function buildRoutingRows(exec){
  if(!exec||exec.state!=="VERIFIED")return [];
  const local=(exec.items??[]).find(e=>e.id==="LOCAL_CLAUDE")??null;
  const sandbox=exec.sandbox?.state??null;
  return ["implementer","reviewer"].map(role=>{
    const prof=(exec.profiles??[]).find(p=>p.role===role)??null;
    const executorState=local?local.state:null,profileState=prof?prof.state:null;
    const blockers=[];
    if(!local)blockers.push("EXECUTOR_NOT_REPORTED");else if(executorState!=="READY")blockers.push(`EXECUTOR_${executorState??"UNKNOWN"}`);
    if(!prof)blockers.push("PROFILE_NOT_REPORTED");else if(profileState!=="READY")blockers.push(`PROFILE_${profileState??"UNKNOWN"}`);
    if(sandbox!=="AVAILABLE")blockers.push(`SANDBOX_${sandbox??"UNKNOWN"}`);
    return {role,executor:local?"LOCAL_CLAUDE":null,executorState,profileState,sandbox,model:null,blockers};
  });
}

// //TR: Model ve sağlayıcı ayarları tablosu (Founder yönergesi, UASCO-T0063 öncesi salt-okunur). Kaynaklar YALNIZ mevcut, izinli GET'lerdir:
// GET /v1/system/executors (LOCAL_CLAUDE yürütücüsü + Claude profilleri) ve GET /v1/adapters (MODEL_GATEWAY / LOCAL_MODEL kayıtları). Yedek zinciri,
// kota ve maliyet sınıfı için hiçbir okuma yolu yoktur: bu alanlar her zaman null + gerekçe NO_READ_ROUTE'dur (uydurulmaz). Kimlik bilgisi yalnız
// var/yok/bilinmiyor olarak türetilir (profil READY = giriş sinyali var); hiçbir sır değeri, yol ya da komut taşınmaz.
export const MODEL_ADAPTER_CATEGORIES=Object.freeze(["MODEL_GATEWAY","LOCAL_MODEL"]);
export const MODEL_GAP="NO_READ_ROUTE";
// //TR: Yapılandırma yalnız iki sinyalden türetilir: yürütücü için sunucunun KULLANDIĞI yürütücü (active === LOCAL_CLAUDE -> CONFIGURED; başka bir
// okunmuş neden, örn. EXECUTOR_NOT_CONFIGURED -> NOT_CONFIGURED; okunamadı -> UNKNOWN); bağdaştırıcı için NOT_IMPLEMENTED -> NOT_CONFIGURED, aksi UNKNOWN
// (bağdaştırıcı yapılandırması için okuma yolu yok; kayıt "REGISTERED" asla CONFIGURED sayılmaz).
export const CONFIG_STATES=Object.freeze(["CONFIGURED","NOT_CONFIGURED","UNKNOWN"]);
const execConfigured=active=>active==="LOCAL_CLAUDE"?"CONFIGURED":typeof active==="string"&&active?"NOT_CONFIGURED":"UNKNOWN";
const adapterConfigured=impl=>impl==="NOT_IMPLEMENTED"?"NOT_CONFIGURED":"UNKNOWN";
/** Satırların özeti: en az biri CONFIGURED -> CONFIGURED; hepsi NOT_CONFIGURED -> NOT_CONFIGURED; aksi (karışık bilinmeyen ya da satır yok) UNKNOWN. */
export function providerConfigSummary(rows){
  if(!Array.isArray(rows)||!rows.length)return "UNKNOWN";
  if(rows.some(r=>r.configured==="CONFIGURED"))return "CONFIGURED";
  return rows.every(r=>r.configured==="NOT_CONFIGURED")?"NOT_CONFIGURED":"UNKNOWN";
}
const credentialOf=state=>state==="READY"?"PRESENT":state==="LOGIN_REQUIRED"||state==="REFUSED"?"ABSENT":"UNKNOWN";
/**
 * exec: mapExecutors çıktısı; adapters: mapAdapters çıktısı. Dönüş: {state, sources:{executors,adapters}, rows:[...]}.
 * state: iki kaynak da doğrulanmadıysa UNAVAILABLE (ya da ikisi de ERROR ise ERROR); en az biri doğrulandı ve satır yoksa EMPTY; aksi halde VERIFIED.
 * Satır: {id, kind, roles:[{role,state,credential}], executorState, inUse, configured (CONFIG_STATES), status, implementation, fallback:null, quota:null, costClass:null, gap}.
 */
export function buildModelProviderRows(exec,adapters){
  const ex=exec&&exec.state==="VERIFIED"?exec:null,ad=adapters&&adapters.state==="VERIFIED"?adapters:null;
  const sources={executors:exec&&typeof exec.state==="string"?exec.state:"UNAVAILABLE",adapters:adapters&&typeof adapters.state==="string"?adapters.state:"UNAVAILABLE"};
  if(!ex&&!ad)return {state:sources.executors==="ERROR"&&sources.adapters==="ERROR"?"ERROR":"UNAVAILABLE",sources,rows:[],configured:"UNKNOWN"};
  const rows=[];
  const local=ex?(ex.items??[]).find(e=>e.id==="LOCAL_CLAUDE")??null:null;
  if(local){
    const roles=["implementer","reviewer"].map(role=>{const p=(ex.profiles??[]).find(x=>x.role===role)??null;const state=p&&typeof p.state==="string"?p.state:null;return {role,state,credential:credentialOf(state)}});
    rows.push({id:"LOCAL_CLAUDE",kind:"EXECUTOR",roles,executorState:local.state??null,inUse:ex.active==="LOCAL_CLAUDE",configured:execConfigured(ex.active),status:null,implementation:null,fallback:null,quota:null,costClass:null,gap:MODEL_GAP});
  }
  if(ad)for(const a of ad.items)if(MODEL_ADAPTER_CATEGORIES.includes(a.category))
    rows.push({id:a.id,kind:a.category,roles:[],executorState:null,inUse:false,configured:adapterConfigured(a.implementation),status:a.status,implementation:a.implementation,fallback:null,quota:null,costClass:null,gap:MODEL_GAP});
  return {state:rows.length?"VERIFIED":"EMPTY",sources,rows,configured:providerConfigSummary(rows)};
}
