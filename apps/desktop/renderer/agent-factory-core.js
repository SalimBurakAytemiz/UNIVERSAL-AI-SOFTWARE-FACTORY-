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
