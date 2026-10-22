// //TR: Bu modül Alan Paketleri (Domain Packs) görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-DOMAIN-PACKS): yalnız salt-okunur ve zaten izinli GET /v1/domains (sorgusuz sabit yol) yanıtını güvenli, sınırlı alanlara eşler. Kayıt değerleri (status, activation, knowledgeState, freshnessPolicy) sunucudan AYNEN taşınır: REGISTERED "etkin/sertifikalı/uyumlu" demek değildir, SEED_DOMAIN_PROFILE güncel ya da doğrulanmış sektör bilgisi değildir ve hiçbir değer yükseltilmez. Okunamayan ya da bozuk kaynağın sayısı 0 değil null'dır (görünümde "—"); tek bozuk satır tüm okumayı reddeder. Yeni uç nokta, etkinleştirme eylemi veya POST yoktur.
export const DOMAINS_PATH="/v1/domains";
export const MAX_DOMAINS=500;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const ENUM_RE=/^[A-Z][A-Z0-9_]{0,39}$/;
const PATH_RE=/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,159}$/;
const text=(x,max)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const safePath=p=>typeof p==="string"&&PATH_RE.test(p)&&!p.split("/").some(s=>s===".."||s==="")?p:null;
function mapRow(x){
  if(!isObj(x)||typeof x.id!=="string"||!ID_RE.test(x.id))return null;
  const name=text(x.name,120);if(name===null)return null;
  for(const k of ["status","activation","knowledgeState"])if(typeof x[k]!=="string"||!ENUM_RE.test(x[k]))return null;
  const row={id:x.id,name,status:x.status,activation:x.activation,knowledgeState:x.knowledgeState,freshnessPolicy:null,profilePath:null};
  if(x.freshnessPolicy!==undefined&&x.freshnessPolicy!==null){if(typeof x.freshnessPolicy!=="string"||!ENUM_RE.test(x.freshnessPolicy))return null;row.freshnessPolicy=x.freshnessPolicy}
  if(x.profilePath!==undefined&&x.profilePath!==null){const p=safePath(x.profilePath);if(p===null)return null;row.profilePath=p}
  return row;
}
const tally=(items,key)=>{const m=new Map();for(const it of items){const v=it[key];if(v===null)continue;m.set(v,(m.get(v)??0)+1)}return [...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([value,count])=>({value,count}))};
/**
 * GET /v1/domains yanıtı -> {state:"VERIFIED",registry:{schemaVersion,count,items,byStatus,byActivation,byKnowledgeState}} | {state:"ERROR",registry:null}.
 * count dizi uzunluğuyla birebir tutmalıdır; yinelenen kimlik, bozuk satır ya da MAX_DOMAINS aşımı TÜM okumayı ERROR yapar. Değerler AYNEN taşınır.
 */
export function mapDomains(raw){
  const bad={state:"ERROR",registry:null};
  if(!isObj(raw))return bad;
  const list=raw.domains;
  if(!Array.isArray(list)||list.length>MAX_DOMAINS||!Number.isSafeInteger(raw.count)||raw.count!==list.length)return bad;
  const items=[],seen=new Set();
  for(const x of list){const row=mapRow(x);if(row===null||seen.has(row.id))return bad;seen.add(row.id);items.push(row)}
  return {state:"VERIFIED",registry:{schemaVersion:text(raw.schemaVersion,20),count:items.length,items,byStatus:tally(items,"status"),byActivation:tally(items,"activation"),byKnowledgeState:tally(items,"knowledgeState")}};
}
/** res = mapDomains sonucu; okunamayan kaynak için count null'dır (0 değil). Hiçbir değer yükseltilmez. */
export function buildDomains(res){
  const ok=Boolean(res)&&res.state==="VERIFIED"&&Boolean(res.registry);
  return {state:ok?"VERIFIED":failState(res?.state),registry:ok?res.registry:null,count:ok?res.registry.count:null};
}
