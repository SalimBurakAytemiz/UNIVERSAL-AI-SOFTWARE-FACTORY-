// //TR: Bu modül Ajan Fabrikası durum özetinin (GET /v1/roles/status-summary, Founder direktifi 599 ajan) saf, DOM'suz sıkı eşleyicisidir: beş sayaç (registered, implemented, tested, certified, running) AYRI tutulur, birbirine eklenmez ve birinden diğeri türetilmez; "599 kayıtlı" asla "599 çalışan ajan" demek değildir. Eksik/yanlış tipli herhangi bir alan TÜM okumayı ERROR yapar; 404/çevrimdışı çağıran tarafta UNAVAILABLE/OFFLINE olarak gösterilir. Sayılar sunucunun bildirdiği gibi AYNEN taşınır, eşitsizlik/oran hesaplanmaz.
export const STATUS_SUMMARY_PATH="/v1/roles/status-summary";
/** Sayaçların sabit sırası; her biri ayrı bir şeyi sayar. */
export const FACTORY_COUNTERS=Object.freeze(["registered","implemented","tested","certified","running"]);
export const MAX_GUILDS=200;
export const MAX_COUNT=1000000;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=MAX_COUNT;
const GUILD_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const SHA_RE=/^[0-9a-f]{64}$/;
const ISO_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
// //TR: Takvimde olmayan tarih (ör. 30 Şubat) JS tarafından sessizce kaydırılabilir; bu yüzden ayrıştırılan UTC tarihi metindeki tarihle birebir eşleşmelidir.
const iso=x=>{if(typeof x!=="string"||!ISO_RE.test(x))return null;const t=Date.parse(x);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===x.slice(0,10)?x:null};
function counters(x){
  if(!isObj(x))return null;
  const out={};
  for(const k of FACTORY_COUNTERS){if(!count(x[k]))return null;out[k]=x[k]}
  return out;
}
/** GET /v1/roles/status-summary yanıtı -> {state:"VERIFIED",summary:{target,...beş sayaç,byGuild,computedAt,basis}} | {state:"ERROR",summary:null}. */
export function mapStatusSummary(raw){
  const bad={state:"ERROR",summary:null};
  const s=isObj(raw)?raw.statusSummary:null;
  if(!isObj(s)||!Number.isSafeInteger(s.target)||s.target<1||s.target>MAX_COUNT)return bad;
  const total=counters(s);if(total===null)return bad;
  if(!Array.isArray(s.byGuild)||s.byGuild.length>MAX_GUILDS)return bad;
  const byGuild=[],seen=new Set();
  for(const g of s.byGuild){
    if(!isObj(g)||typeof g.guildId!=="string"||!GUILD_RE.test(g.guildId)||seen.has(g.guildId))return bad;
    const c=counters(g);if(c===null)return bad;
    seen.add(g.guildId);byGuild.push({guildId:g.guildId,...c});
  }
  const computedAt=iso(s.computedAt);if(computedAt===null)return bad;
  const b=s.basis;
  if(!isObj(b)||typeof b.roleDefinitionsSha256!=="string"||!SHA_RE.test(b.roleDefinitionsSha256)||!Number.isSafeInteger(b.bindingsCount)||b.bindingsCount<0||b.bindingsCount>MAX_COUNT)return bad;
  byGuild.sort((a,c)=>a.guildId.localeCompare(c.guildId));
  return {state:"VERIFIED",summary:{target:s.target,...total,byGuild,computedAt,basis:{roleDefinitionsSha256:b.roleDefinitionsSha256,bindingsCount:b.bindingsCount}}};
}

// //TR: Hazırlık (readiness) eşleyicisi: GET /v1/roles/status-summary yanıtının `readiness` (core/agents/readiness-audit.ts computeRoleReadiness) ve `reconciliation` (reconcileLegacyStatusSummary) bölümlerini SIKI okur. Sekiz katman sabit sırada ve yalnız bu adlarla kabul edilir (bilinmeyen/eksik katman ERROR); her sayı sınırlı bir tamsayıdır; dört durum paydayı toplar ve `measured` çekirdek tanımına (payda > 0 ve UNKNOWN = 0) birebir uyar. Kısmi sayı ASLA dönmez: tek bir bozuk alan tüm okumayı ERROR yapar. Katmanlar toplanmaz ve oranlanmaz. `roles`/`byGuild`/`byCluster` okunmaz (yalnız sınırlı boyut denetimi).
export const READINESS_LAYERS=Object.freeze(["DEFINED","PROFILED","KNOWLEDGE_READY","TOOL_READY","EXECUTABLE","EVALUATED","INTERNALLY_CERTIFIED","RUNNING"]);
export const LAYER_STATES=Object.freeze(["TRUE","FALSE","UNKNOWN","NOT_APPLICABLE"]);
export const MAX_ROLES=5000;
export const MAX_MISMATCHES=2000;
export const MAX_REASONS=50;
const REASON_RE=/^[A-Z][A-Z0-9_]{0,63}$/;
const LEGACY_STATUS="DEPRECATED_LEGACY_PROJECTION";
export const READINESS_UNAVAILABLE_CODE="ROLE_READINESS_UNAVAILABLE";
const AUTHORITIES=Object.freeze(["AUTHORITATIVE_READINESS_MEASUREMENT","NON_AUTHORITATIVE_PROMOTED_STATUS_OVERRIDE"]);
function layerCount(x,den){
  if(!isObj(x)||x.denominator!==den||typeof x.measured!=="boolean")return null;
  const out={};let sum=0;
  for(const k of LAYER_STATES){if(!count(x[k]))return null;out[k]=x[k];sum+=x[k]}
  if(sum!==den||x.measured!==(den>0&&out.UNKNOWN===0))return null;
  return {...out,denominator:den,measured:x.measured};
}
/** GET /v1/roles/status-summary yanıtı -> {state:"VERIFIED",readiness,reconciliation} | {state:"ERROR",readiness:null,reconciliation:null}. */
export function mapReadiness(raw){
  const bad={state:"ERROR",readiness:null,reconciliation:null};
  if(!isObj(raw))return bad;
  if(raw.statusSummaryStatus!==undefined&&raw.statusSummaryStatus!==LEGACY_STATUS)return bad;
  const r=raw.readiness,c=raw.reconciliation;
  // //TR: #262 sözleşmesi: hazırlık girdileri yüklenemezse sunucu 200 + {readiness:null, reconciliation:null, readinessError:"ROLE_READINESS_UNAVAILABLE"} döner; bu bir HATA değil "kullanılamıyor" durumudur (sayı yok, neden var). Başka her null/readinessError birleşimi ERROR'dır.
  if(r===null&&c===null&&raw.readinessError===READINESS_UNAVAILABLE_CODE)return {state:"UNAVAILABLE",readiness:null,reconciliation:null,reason:READINESS_UNAVAILABLE_CODE};
  if(raw.readinessError!==undefined||!isObj(r)||!isObj(c))return bad;
  if(r.schemaVersion!=="1.0.0"||!AUTHORITIES.includes(r.authority)||!count(r.denominator)||!count(r.anomalies))return bad;
  for(const k of ["roles","byGuild","byCluster"])if(r[k]!==undefined&&(!Array.isArray(r[k])||r[k].length>(k==="roles"?MAX_ROLES:MAX_GUILDS)))return bad;
  const den=r.denominator;
  if(!isObj(r.totals)||Object.keys(r.totals).length!==READINESS_LAYERS.length)return bad;
  const layers=[];
  for(const layer of READINESS_LAYERS){const lc=layerCount(r.totals[layer],den);if(lc===null)return bad;layers.push({layer,...lc})}
  const stageWired=layerCount(r.stageWired,den);if(stageWired===null)return bad;
  const p=r.proposedOnly;
  if(!isObj(p)||!["PROPOSED_DERIVED_NOT_RUNTIME","ABSENT"].includes(p.source)||!count(p.profiles)||!count(p.withCandidateSkills)||!count(p.withCandidateToolAdapters))return bad;
  if(p.profiles>den||p.withCandidateSkills>p.profiles||p.withCandidateToolAdapters>p.profiles||(p.source==="ABSENT"&&p.profiles!==0))return bad; // //TR: öneri sayıları üretici değişmezleriyle sınırlıdır: profil <= payda, aday sayıları <= profil
  const i=r.inputs;
  if(!isObj(i)||!["PRESENT","ABSENT"].includes(i.journal)||!["SUPPLIED","NOT_SUPPLIED"].includes(i.adapterReality)||!["SUPPLIED","NOT_SUPPLIED"].includes(i.reachableStages))return bad;
  // //TR: Üretici değişmezleri: çalıştırma günlüğü YOKSA RUNNING katmanı tamamen UNKNOWN'dır (TRUE 0, FALSE 0); erişilebilir aşamalar verilmediyse hiçbir rol "aşaması bağlı" olamaz (TRUE 0).
  const running=layers.find(l=>l.layer==="RUNNING");
  if(i.journal==="ABSENT"&&(running.TRUE!==0||running.FALSE!==0||running.NOT_APPLICABLE!==0||running.UNKNOWN!==den))return bad;
  if(i.journal==="PRESENT"&&running.UNKNOWN!==0)return bad; // //TR: ters yön: günlük VARSA RUNNING ölçülmüş olmalıdır (measured = journal PRESENT)
  if(i.reachableStages==="NOT_SUPPLIED"&&stageWired.TRUE!==0)return bad;
  // //TR: A2a: sunucunun gönderdiği TOOL_READY neden kodları (reasonCounts.TOOL_READY: kod -> o nedene sahip rol sayısı). Yoksa null (neden bilinmiyor); varsa her sayı 1..(FALSE+UNKNOWN) arasındadır (TRUE bir rolün nedeni olmaz) ve FALSE+UNKNOWN>0 ise en az bir neden vardır; aksi halde TÜM okuma ERROR.
  let toolReasons=null;
  if(r.reasonCounts!==undefined){
    if(!isObj(r.reasonCounts))return bad;
    const t=r.reasonCounts.TOOL_READY;
    if(t!==undefined){
      const tool=layers.find(l=>l.layer==="TOOL_READY"),open=tool.FALSE+tool.UNKNOWN;
      if(!isObj(t)||Object.keys(t).length>MAX_REASONS)return bad;
      const list=[];
      for(const [code,n] of Object.entries(t)){if(!REASON_RE.test(code)||!count(n)||n<1||n>open)return bad;list.push({code,count:n})}
      if(open>0&&list.length===0)return bad;
      toolReasons=list.sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:0);
    }
  }
  const computedAt=iso(r.computedAt);if(computedAt===null||typeof r.digest!=="string"||!SHA_RE.test(r.digest))return bad;
  if(c.status!==LEGACY_STATUS||c.authority!=="readiness"||typeof c.consistent!=="boolean"||typeof c.runningMeasured!=="boolean"||c.implementedMeaning!=="EXECUTABLE_CODE_PATH_INCLUDES_UNWIRED_STAGES")return bad;
  if(!Array.isArray(c.mismatches)||c.mismatches.length>MAX_MISMATCHES||c.mismatches.some(m=>typeof m!=="string"||m.length>200)||c.consistent!==(c.mismatches.length===0))return bad;
  if(c.runningMeasured!==(i.journal==="PRESENT"))return bad;
  const wired=i.reachableStages==="SUPPLIED"?stageWired.TRUE:"UNKNOWN";
  if(c.implementedStageWired!==wired)return bad;
  return {state:"VERIFIED",
    readiness:{authority:r.authority,denominator:den,layers,stageWired,proposedOnly:{source:p.source,profiles:p.profiles,withCandidateSkills:p.withCandidateSkills,withCandidateToolAdapters:p.withCandidateToolAdapters},
      inputs:{journal:i.journal,adapterReality:i.adapterReality,reachableStages:i.reachableStages},toolReasons,anomalies:r.anomalies,computedAt,digest:r.digest},
    reconciliation:{consistent:c.consistent,mismatchCount:c.mismatches.length,runningMeasured:c.runningMeasured,implementedStageWired:wired}};
}
