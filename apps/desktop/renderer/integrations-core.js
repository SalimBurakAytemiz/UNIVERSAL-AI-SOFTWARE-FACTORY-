// //TR: Bu modül Uzantılar ve Entegrasyonlar görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-078): yalnız üç salt-okunur GET (GET /v1/capabilities, GET /v1/adapters, GET /v1/fabrics; üçü de sorgusuz sabit yoldur) yanıtını güvenli, sınırlı alanlara eşler. Kayıt defteri değerleri (status, implementation, activation, requiresCertification) sunucudan AYNEN taşınır: REGISTERED "kurulu/bağlı/etkin/sertifikalı" demek değildir ve hiçbir değer yükseltilmez. Okunamayan ya da bozuk kaynağın sayısı 0 değil null'dır (görünümde "—"); tek bozuk satır tüm okumayı reddeder. Yeni uç nokta, etkinleştirme/kurulum/bağlama eylemi veya POST yoktur.
export const CAPABILITIES_PATH="/v1/capabilities";
export const ADAPTERS_PATH="/v1/adapters";
export const FABRICS_PATH="/v1/fabrics";
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); üçü de salt-okunur ve önceden izinlidir. */
export const INTEG_SOURCES=Object.freeze(["capabilities","adapters","fabrics"]);
export const INTEG_SOURCE_PATHS=Object.freeze({capabilities:CAPABILITIES_PATH,adapters:ADAPTERS_PATH,fabrics:FABRICS_PATH});
/** Yanıttaki dizi alanı (kaynağa göre sabit). */
const LIST_KEY=Object.freeze({capabilities:"capabilities",adapters:"adapters",fabrics:"fabrics"});
export const MAX_ITEMS=500;
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const ENUM_RE=/^[A-Z][A-Z0-9_]{0,39}$/;
const text=(x,max)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";

function mapRow(kind,x){
  if(!isObj(x)||typeof x.id!=="string"||!ID_RE.test(x.id))return null;
  if(typeof x.status!=="string"||!ENUM_RE.test(x.status)||typeof x.implementation!=="string"||!ENUM_RE.test(x.implementation))return null;
  const row={id:x.id,name:null,category:null,status:x.status,implementation:x.implementation,activation:null,requiresCertification:null};
  if(kind==="adapters"){
    if(typeof x.category!=="string"||!ENUM_RE.test(x.category))return null;
    row.category=x.category;
    if(x.requiresCertification!==undefined&&x.requiresCertification!==null){if(typeof x.requiresCertification!=="boolean")return null;row.requiresCertification=x.requiresCertification}
  }else{
    const name=text(x.name,120);if(name===null)return null;
    row.name=name;
  }
  if(x.activation!==undefined&&x.activation!==null){if(typeof x.activation!=="string"||!ENUM_RE.test(x.activation))return null;row.activation=x.activation}
  return row;
}
const tally=(items,key)=>{const m=new Map();for(const it of items){const v=it[key];if(v===null)continue;m.set(v,(m.get(v)??0)+1)}return [...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([value,count])=>({value,count}))};

/**
 * Bir kayıt defteri yanıtı -> {state:"VERIFIED",registry:{kind,schemaVersion,count,items,byStatus,byImplementation}} | {state:"ERROR",registry:null}.
 * count, dizi uzunluğuyla birebir tutmalıdır; yinelenen kimlik, bozuk satır ya da MAX_ITEMS aşımı TÜM okumayı ERROR yapar. Değerler AYNEN taşınır.
 */
export function mapRegistry(kind,raw){
  const bad={state:"ERROR",registry:null};
  if(!INTEG_SOURCES.includes(kind)||!isObj(raw))return bad;
  const list=raw[LIST_KEY[kind]];
  if(!Array.isArray(list)||list.length>MAX_ITEMS||!Number.isSafeInteger(raw.count)||raw.count!==list.length)return bad;
  const items=[],seen=new Set();
  for(const x of list){
    const row=mapRow(kind,x);
    if(row===null||seen.has(row.id))return bad;
    seen.add(row.id);items.push(row);
  }
  return {state:"VERIFIED",registry:{kind,schemaVersion:text(raw.schemaVersion,20),count:items.length,items,byStatus:tally(items,"status"),byImplementation:tally(items,"implementation")}};
}
export const mapCapabilities=raw=>mapRegistry("capabilities",raw);
export const mapAdapters=raw=>mapRegistry("adapters",raw);
export const mapFabrics=raw=>mapRegistry("fabrics",raw);

/**
 * res = {capabilities,adapters,fabrics}; her biri bir eşleyici sonucu ({state,registry,...}). Okunamayan kaynak için count null'dır (0 değil).
 * Hiçbir değer yükseltilmez; "bağlı/etkin" türetilmez.
 */
export function buildIntegrations(res){
  const sources={},counts={},registries={};
  for(const k of INTEG_SOURCES){
    const r=res?.[k],ok=Boolean(r)&&r.state==="VERIFIED"&&Boolean(r.registry);
    sources[k]={state:ok?"VERIFIED":failState(r?.state)};
    registries[k]=ok?r.registry:null;
    counts[k]=ok?r.registry.count:null;
  }
  const unreadable=INTEG_SOURCES.filter(k=>registries[k]===null);
  return {sources,counts,registries,unreadable,complete:unreadable.length===0};
}
