// //TR: Bu modül renderer'ın saf (DOM'suz) veri modelidir: hata sınıflandırma, DSK-061-08 durum çipi, KPI biçimleyici ve GET /v1/cockpit sözleşmesi eşleyicisi; eksik/404 veri asla sayıya çevrilmez, "—" ve UNAVAILABLE gösterilir.
export const CONTRACT_STATES=Object.freeze(["VERIFIED","STALE","UNAVAILABLE","ERROR"]);
export const CHIP_KINDS=Object.freeze(["LOADING","EMPTY","STALE","OFFLINE","ERROR","UNVERIFIED","VERIFIED"]);
export const MISSING="—";

export const safeCount=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export function formatCount(v){const n=safeCount(v);return n===null?MISSING:String(n)}
export function formatTime(iso,lang="tr"){
  if(typeof iso!=="string"||!iso)return MISSING;const d=new Date(iso);if(Number.isNaN(d.getTime()))return MISSING;
  try{return new Intl.DateTimeFormat(lang==="en"?"en-GB":"tr-TR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d)}catch{return MISSING}
}
export function classifyFailure(err){
  const msg=String(err&&err.message!==undefined?err.message:err??"");const m=/HTTP (\d{3})/.exec(msg);
  if(m){const status=Number(m[1]);return status===404||status===501?{state:"UNAVAILABLE",status}:{state:"ERROR",status}}
  if(/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|network|timed? ?out|BRIDGE_UNAVAILABLE|CONTROL_API_UNREACHABLE/i.test(msg))return {state:"OFFLINE",status:null};
  return {state:"ERROR",status:null};
}
export function chipFor(block){
  if(!block||block.loading===true)return "LOADING";
  switch(block.state){
    case "OFFLINE":return "OFFLINE";case "ERROR":return "ERROR";case "STALE":return "STALE";
    case "VERIFIED":return block.value===0?"EMPTY":"VERIFIED";
    default:return "UNVERIFIED";
  }
}
const withValue=(state,value)=>state==="VERIFIED"||state==="STALE"?safeCount(value):null;
const normState=s=>CONTRACT_STATES.includes(s)?s:"ERROR";
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function byStatus(raw,state){
  const out={};if(state==="UNAVAILABLE"||state==="ERROR"||!isObj(raw))return out;
  for(const [k,v] of Object.entries(raw)){const n=safeCount(v);if(n!==null&&/^[A-Z_]{1,40}$/.test(k))out[k]=n}return out;
}
const str=(x,max=300)=>typeof x==="string"?x.slice(0,max):null;
const iso=x=>typeof x==="string"&&!Number.isNaN(new Date(x).getTime())?x:null;
export function tile(state,value,extra={}){return {state,value,loading:false,source:null,asOf:null,...extra}}
export function unavailableTile(state="UNAVAILABLE",source=null){return tile(state,null,{source,detail:{},byStatus:{}})}
/** Tüm cockpit alanlarını verilen durumla (404 => UNAVAILABLE, ağ => OFFLINE) boş döndürür. */
export function emptyCockpit(state="UNAVAILABLE"){
  return {generatedAt:null,globalStop:{active:false,reason:null,known:false},
    projects:unavailableTile(state,"COCKPIT"),missions:unavailableTile(state,"COCKPIT"),approvals:{...unavailableTile(state,"COCKPIT"),items:[]},
    orchestrator:unavailableTile(state,"ORCHESTRATOR_STATE"),workforce:{...unavailableTile(state,"WORKFORCE"),registeredRoles:null,legacyRoles:null,targetRoles:null,activeWorkerRuns:null},
    alerts:unavailableTile(state,"COCKPIT"),evidence:{...unavailableTile(state,"COCKPIT:evidence"),total:null,verified:null,mismatch:null,missing:null,unverifiable:null},legacySchedulerAuthority:false};
}
/** GET /v1/cockpit sözleşmesini renderer modeline eşler; sayılar yalnız VERIFIED/STALE bloklardan ve yalnız geçerli tamsayıysa alınır. */
export function mapCockpit(raw){
  if(!isObj(raw))return emptyCockpit("ERROR");
  const out=emptyCockpit("UNAVAILABLE");out.generatedAt=iso(raw.generatedAt);
  if(isObj(raw.globalStop))out.globalStop={active:raw.globalStop.active===true,reason:str(raw.globalStop.reason,1000),known:typeof raw.globalStop.active==="boolean"};
  const asOf=out.generatedAt;
  if(isObj(raw.projects)){const s=normState(raw.projects.state);out.projects=tile(s,withValue(s,raw.projects.count),{source:"COCKPIT:projects",asOf,byStatus:{}})}
  if(isObj(raw.missions)){const s=normState(raw.missions.state);out.missions=tile(s,withValue(s,raw.missions.total),{source:"COCKPIT:missions",asOf,byStatus:byStatus(raw.missions.byStatus,s)})}
  if(isObj(raw.awaitingApproval)){
    const s=normState(raw.awaitingApproval.state),live=s==="VERIFIED"||s==="STALE";
    const items=live&&Array.isArray(raw.awaitingApproval.items)?raw.awaitingApproval.items.filter(isObj).slice(0,200).map(x=>({missionId:str(x.missionId,80),projectId:str(x.projectId,80),title:str(x.title,200),riskLevel:str(x.riskLevel,8)})).filter(x=>x.missionId):[];
    out.approvals={...tile(s,live?items.length:null,{source:"COCKPIT:awaitingApproval",asOf,byStatus:{}}),items};
  }
  if(isObj(raw.orchestrator)){
    const s=normState(raw.orchestrator.state),p=isObj(raw.orchestrator.packages)?raw.orchestrator.packages:{};
    out.orchestrator=tile(s,withValue(s,p.total),{source:str(raw.orchestrator.source,60)??"ORCHESTRATOR_STATE",asOf:iso(raw.orchestrator.asOf),byStatus:byStatus(p.byStatus,s)});
  }
  if(isObj(raw.workforce)){
    const s=normState(raw.workforce.state),live=s==="VERIFIED"||s==="STALE",w=raw.workforce;
    // //TR: INT-R3 D-M1-07: "kayıtlı rol" yalnız kanonik sayıdır (WFR-03 canonicalRegisteredRoles); LEGACY_REFERENCE_ONLY etiketli eski sayı asla kayıtlı rol diye gösterilmez, yalnız legacyRoles alanında taşınır.
    const legacyLabelled=w.registeredRolesAuthority==="LEGACY_REFERENCE_ONLY",reg=safeCount(w.canonicalRegisteredRoles)??(legacyLabelled?null:safeCount(w.registeredRoles));
    out.workforce={...tile(s,live?reg:null,{source:str(w.source,60)??"WORKFORCE",asOf,byStatus:{}}),registeredRoles:live?reg:null,legacyRoles:live&&legacyLabelled?safeCount(w.registeredRoles):null,targetRoles:live?safeCount(w.targetRoles):null,activeWorkerRuns:live?safeCount(w.activeWorkerRuns):null};
  }
  // //TR: UX WP2: cockpit.evidence (B10A) isteğe bağlı bloktur; sayılar yalnız VERIFIED/STALE ve geçerli tamsayıysa alınır, yoksa UNAVAILABLE ve null kalır (uydurma yok).
  if(isObj(raw.evidence)){
    const e=raw.evidence,s=normState(e.state),n=k=>withValue(s,e[k]);
    out.evidence={...tile(s,n("verified"),{source:"COCKPIT:evidence",asOf,byStatus:{}}),total:n("total"),verified:n("verified"),mismatch:n("mismatch"),missing:n("missing"),unverifiable:n("unverifiable")};
  }
  const bs=out.missions.byStatus??{},blocked=(bs.BLOCKED??0)+(bs.FOUNDER_ATTENTION_REQUIRED??0);
  out.alerts=out.missions.value===null?unavailableTile(out.missions.state,"COCKPIT:missions"):tile(out.missions.state,blocked+(out.globalStop.active?1:0),{source:"COCKPIT:missions+globalStop",asOf,byStatus:{},detail:{blockedMissions:bs.BLOCKED??0,attentionMissions:bs.FOUNDER_ATTENTION_REQUIRED??0,globalStop:out.globalStop.active}});
  out.legacySchedulerAuthority=false;return out;
}
export function mapProjects(raw){
  if(!isObj(raw)||!Array.isArray(raw.projects))return {state:"ERROR",items:[]};
  const items=raw.projects.filter(isObj).map(p=>({projectId:str(p.projectId,80),name:str(p.name,200)??"—",tenantId:str(p.tenantId,80),environmentId:str(p.environmentId,100),createdAt:iso(p.createdAt),repositoryPath:isObj(p.repository)?str(p.repository.path,1000):null})).filter(p=>p.projectId);
  return {state:"VERIFIED",items};
}
export function mapMissions(raw){
  if(!isObj(raw)||!Array.isArray(raw.missions))return {state:"ERROR",items:[]};
  const items=raw.missions.filter(isObj).map(m=>({missionId:str(m.missionId,80),projectId:str(m.projectId,80),title:str(m.title,200)??"—",status:str(m.status,40)??"—",riskLevel:str(m.riskLevel,8)??"—",createdAt:iso(m.createdAt)})).filter(m=>m.missionId)
    .sort((a,b)=>String(b.createdAt??"").localeCompare(String(a.createdAt??"")));
  return {state:"VERIFIED",items};
}
export function mapControlStatus(raw){const g=isObj(raw)&&isObj(raw.globalStop)?raw.globalStop:null;return g?{state:"VERIFIED",active:g.active===true,reason:str(g.reason,1000)}:{state:"ERROR",active:false,reason:null}}
export function mapEvents(raw){
  if(!isObj(raw)||!Array.isArray(raw.events))return [];
  return raw.events.filter(isObj).slice(-50).map(x=>({timestamp:iso(x.timestamp),severity:str(x.severity,12)??"INFO",label:`${str(x.stage,60)??""}/${str(x.event,80)??""}`})).reverse();
}
export function mapAttention(raw){
  if(!isObj(raw))return {state:"ERROR",blocked:[]};
  if(raw.schedulerVerification==="REJECTED")return {state:"UNAVAILABLE",blocked:[]};
  return {state:"VERIFIED",blocked:Array.isArray(raw.blocked)?raw.blocked.filter(isObj):[]};
}
/** Oturum içi örneklerden sparkline noktaları üretir; 2'den az gerçek örnek varsa boş string (çizim yok). */
export function pushSample(samples,value,max=30){const n=safeCount(value);if(n===null)return samples;return [...samples,n].slice(-max)}
export function sparkPoints(samples,w=64,h=20){
  const v=samples.filter(x=>Number.isFinite(x));if(v.length<2)return "";const lo=Math.min(...v),hi=Math.max(...v),span=hi-lo||1;
  return v.map((x,i)=>`${((i/(v.length-1))*w).toFixed(1)},${(h-2-((x-lo)/span)*(h-4)).toFixed(1)}`).join(" ");
}
/** //TR: UX WP2: bir göstergenin oturum içi gerçek örneklerinden işaretli fark üretir; 2'den az örnek veya geçersiz değer varsa null (delta ve çizim gösterilmez). Bu arka ucun 24 saat/7 gün serisi DEĞİLDİR, yalnız bu oturumda alınan okumaların ilk-son farkıdır. */
export function kpiTrend(samples){
  const v=(Array.isArray(samples)?samples:[]).filter(x=>safeCount(x)!==null);
  if(v.length<2)return null;
  const delta=v[v.length-1]-v[0];
  return {delta,direction:delta>0?"up":delta<0?"down":"flat",count:v.length,points:sparkPoints(v)};
}
/** İşaretli delta metni: +3, −2, ±0 (gerçek eksi işareti). */
export function formatDelta(delta){return !Number.isSafeInteger(delta)?MISSING:delta>0?`+${delta}`:delta<0?`−${Math.abs(delta)}`:"±0"}
export const PILL_KINDS=Object.freeze(["LOADING","EMPTY","VERIFIED","STALE","OFFLINE","FAILED","BLOCKED","DENIED","NOT_CONNECTED","UNAVAILABLE","NOT_EXECUTED","NOT_VERIFIED","PRODUCT_VERIFIED"]);
/** //TR: UX WP2: veri bloğu durumunu ayrık durum rozeti türüne çevirir; ERROR=FAILED, UNAVAILABLE ayrı kalır, tek yeşil/kırmızıya indirgenmez. */
export function pillKindFor(block){
  if(!block||block.loading===true)return "LOADING";
  switch(block.state){
    case "OFFLINE":return "OFFLINE";case "ERROR":return "FAILED";case "STALE":return "STALE";
    case "VERIFIED":return block.value===0?"EMPTY":"VERIFIED";
    default:return "UNAVAILABLE";
  }
}
const MISSION_CATEGORY=Object.freeze({BLOCKED:"BLOCKED",FAILED:"FAILED",FOUNDER_ATTENTION_REQUIRED:"ATTENTION",PREFLIGHT:"WAITING",AWAITING_APPROVAL:"WAITING",
  AUTHORIZED:"ACTIVE",PLANNED:"ACTIVE",EXECUTING:"ACTIVE",VERIFYING:"ACTIVE",REVIEWING:"ACTIVE",REMEDIATING:"ACTIVE",REGRESSION:"ACTIVE",REPORTING:"ACTIVE",RUNNING:"ACTIVE",STARTING:"ACTIVE",LEASED:"ACTIVE",IN_PROGRESS:"ACTIVE",
  COMPLETE:"DONE",COMPLETED:"DONE",DONE:"DONE",CLEAN:"DONE",CANCELLED:"STOPPED",STOPPED:"STOPPED",DRAFT:"IDLE",QUEUED:"IDLE",PENDING:"IDLE"});
/** //TR: UX WP2: mission/koşu durumunu rozet kategorisine çevirir (ikon+metin); bilinmeyen durum NEUTRAL kalır ve ham değer gösterilir. */
export function missionPillKind(status){return MISSION_CATEGORY[String(status)]??"NEUTRAL"}
/** Anahtar-değer nesnesini azalan sıralı en fazla max girdiye çevirir (yalnız geçerli tamsayılar). */
export function topEntries(obj,max=4){
  if(!isObj(obj))return [];
  return Object.entries(obj).filter(([,v])=>safeCount(v)!==null).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,max).map(([key,value])=>({key,value}));
}
export function searchEntries(query,entries,limit=8){
  const q=String(query??"").trim().toLocaleLowerCase("tr");if(!q)return [];
  return entries.filter(e=>`${e.label} ${e.keywords??""}`.toLocaleLowerCase("tr").includes(q)).slice(0,limit);
}
