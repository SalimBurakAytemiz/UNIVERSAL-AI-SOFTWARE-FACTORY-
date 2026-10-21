// //TR: Bu modül Ayarlar > Sağlayıcı ve model yönlendirme görünümünün saf (DOM'suz) çekirdeğidir (PQ-005): mevcut GET /v1/system/executors, /v1/capabilities ve /v1/adapters yanıtlarını güvenli, sınırlı alanlara eşler. Kayıt değerleri (status, activation, implementation) AYNEN taşınır; hiçbiri etkin/bağlı/çalışıyor durumuna YÜKSELTİLMEZ. Yanıtta model alanı yoktur: model "—" kalır. Bozuk kayıt tüm okumayı ERROR yapar (kısmi görünüm yok).
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/,WORD_RE=/^[A-Z][A-Z0-9_]{0,39}$/;
const text=(x,max=120)=>typeof x==="string"&&x.length&&x.length<=max&&!/[\u0000-\u001f]/.test(x)?x:null;
export const ROUTING_LIST_LIMIT=60;

/** GET /v1/capabilities -> {state:"VERIFIED",items:[{id,name,status,activation,implementation}],total} | {state:"ERROR"}. */
export function mapCapabilities(raw){
  const bad={state:"ERROR",items:[],total:0};
  const list=isObj(raw)?raw.capabilities:null;if(!Array.isArray(list))return bad;
  const items=[];
  for(const x of list){
    if(!isObj(x)||!ID_RE.test(String(x.id))||text(x.name)===null||!WORD_RE.test(String(x.status))||!WORD_RE.test(String(x.activation))||!WORD_RE.test(String(x.implementation)))return bad;
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
    if(!isObj(x)||!ID_RE.test(String(x.id))||!WORD_RE.test(String(x.category))||!WORD_RE.test(String(x.status))||!WORD_RE.test(String(x.implementation)))return bad;
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
