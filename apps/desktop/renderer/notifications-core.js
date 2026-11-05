// //TR: Bu modül UASCO-T0019 uygulama içi bildirim akışının saf, DOM'suz mantığıdır: bildirimler YALNIZ kayıtlı ve izin listesindeki GET /v1/attention (onay/karar/engel) ve GET /v1/run-summaries (koşu sonuçları, teslim aşamaları) verisinden türetilir; okundu bilgisi yalnız bu cihazdaki renderer deposunda tutulur, depo yoksa dürüstçe "kaydedilemiyor" denir ve hiçbir bildirim uydurulmaz.
import {redactText} from "./project-core.js";

export const NOTIFY_READ_KEY="uasco.notify.read.v1";
export const NOTIFY_READ_MAX=500;
export const NOTIFY_GROUPS=Object.freeze(["APPROVAL","DECISION","BLOCKED","RUN","DELIVERY"]);
/** /v1/attention türü -> grup ve hedef ekran. Onay ve kararlar Gelen Kutusu'nda, engeller Çalışma'da ele alınır. */
export const ATTENTION_GROUP=Object.freeze({RUN_AWAITING_APPROVAL:"APPROVAL",MISSION_AUTHORIZATION_PENDING:"APPROVAL",RUN_NEEDS_DECISION:"DECISION",MISSION_FOUNDER_ATTENTION:"DECISION",MISSION_BLOCKED:"BLOCKED",TASK_BLOCKED:"BLOCKED"});
export const GROUP_ROUTE=Object.freeze({APPROVAL:"inbox",DECISION:"inbox",BLOCKED:"work",RUN:"work",DELIVERY:"delivery"});
/** Bildirim üreten koşu sonuçları (ara durumlar bildirim değildir). */
export const RUN_NOTIFY_STATUSES=Object.freeze(["SUCCEEDED","FAILED","BLOCKED","QUARANTINED","RECOVERY_FAILED","CANCELLED"]);
const DELIVERY_STAGES=Object.freeze(["productVerified","sourceAccepted","artifactPrepared"]);
const ID_RE=/^[A-Za-z0-9:._-]{1,300}$/;

/** Okundu kümesini yükler. Depo yoksa/erişim atarsa ya da içerik bozuksa {available:false} (bozuk içerik sessizce "hepsi okundu" sayılmaz). */
export function loadReadIds(storage){
  if(!storage||typeof storage.getItem!=="function")return {available:false,ids:new Set()};
  try{
    const raw=storage.getItem(NOTIFY_READ_KEY);
    if(raw===null)return {available:true,ids:new Set()};
    const arr=JSON.parse(raw);
    if(!Array.isArray(arr))return {available:true,ids:new Set()};
    return {available:true,ids:new Set(arr.filter(x=>typeof x==="string"&&ID_RE.test(x)).slice(-NOTIFY_READ_MAX))};
  }catch{return {available:false,ids:new Set()}}
}
/** Okundu kümesine ekler ve yazar (en yeni NOTIFY_READ_MAX tutulur). Yazılamazsa false; çağıran "kaydedilemedi" der. */
export function saveReadIds(storage,ids){
  if(!storage||typeof storage.setItem!=="function")return false;
  try{storage.setItem(NOTIFY_READ_KEY,JSON.stringify([...ids].filter(x=>typeof x==="string"&&ID_RE.test(x)).slice(-NOTIFY_READ_MAX)));return true}catch{return false}
}

function fromAttention(item){
  const group=ATTENTION_GROUP[item.kind];if(!group)return null;
  const subject=item.taskId??item.runId??item.missionId;
  return {id:`att:${item.kind}:${subject}:${item.since??"-"}`,group,kind:item.kind,title:item.title,detail:item.reason===null?null:redactText(item.reason).slice(0,300),at:item.since,
    projectId:item.projectId,missionId:item.missionId,runId:item.runId,taskId:item.taskId,route:GROUP_ROUTE[group]};
}
/** //TR: Koşu bildirimine görev başlığı yalnız Ana Sayfa'nın zaten okuduğu verilerden eklenir: /v1/attention öğe başlıkları (TASK_BLOCKED hariç: onun başlığı iş başlığıdır) ve cockpit onay öğeleri. Başlık bilinmiyorsa runId gösterilir; başlık uydurulmaz. */
export function missionTitleIndex(attentionItems,approvalItems){
  const m=new Map();
  for(const a of approvalItems??[])if(a&&typeof a.missionId==="string"&&typeof a.title==="string"&&a.title)m.set(a.missionId,a.title);
  for(const x of attentionItems??[])if(x&&x.kind!=="TASK_BLOCKED"&&typeof x.missionId==="string"&&typeof x.title==="string"&&x.title&&!m.has(x.missionId))m.set(x.missionId,x.title);
  return m;
}
function fromRun(run,claimedRuns,titles){
  const out=[];
  if(!run.missionId)return out;
  if(RUN_NOTIFY_STATUSES.includes(run.status)&&!claimedRuns.has(run.runId))
    out.push({id:`run:${run.runId}:${run.status}:${run.updatedAt??"-"}`,group:"RUN",kind:`RUN_${run.status}`,title:titles.get(run.missionId)??run.runId,detail:run.reason===null?null:redactText(run.reason).slice(0,300),at:run.updatedAt,
      projectId:run.projectId,missionId:run.missionId,runId:run.runId,taskId:null,route:GROUP_ROUTE.RUN});
  const stage=DELIVERY_STAGES.find(k=>run.delivery?.[k]===true);
  if(stage)out.push({id:`dlv:${run.runId}:${stage}`,group:"DELIVERY",kind:`DELIVERY_${stage}`,title:titles.get(run.missionId)??run.runId,detail:null,at:run.updatedAt,
    projectId:run.projectId,missionId:run.missionId,runId:run.runId,taskId:null,route:GROUP_ROUTE.DELIVERY});
  return out;
}

/**
 * //TR: attention ({state,queue}) + runs (mapRunSummaries) + okundu kümesi -> bildirim akışı. Her kaynak kendi gerçek durumunu taşır; biri düşerse diğerinin bildirimleri gösterilir ve
 * durum PARTIAL olur (eksik kaynak "boş" sayılmaz). Aynı koşu attention'da zaten varsa koşu sonucu ikinci kez bildirilmez. Sıra: okunmamış önce, sonra en yeni.
 */
export function buildNotifications({attention,runs,read,approvals}){
  const attOk=attention?.state==="VERIFIED"&&Boolean(attention.queue),runsOk=runs?.state==="VERIFIED";
  const sources={attention:attOk?"VERIFIED":attention?.state??"ERROR",runs:runsOk?"VERIFIED":runs?.state??"ERROR"};
  const readIds=read?.ids??new Set(),readAvailable=read?.available===true;
  if(!attOk&&!runsOk)return {state:sources.attention,items:[],unread:null,groups:{},sources,readAvailable,partial:false};
  const att=attOk?attention.queue.items.map(fromAttention).filter(Boolean):[];
  const claimed=new Set(att.map(n=>n.runId).filter(Boolean));
  const titles=missionTitleIndex(attOk?attention.queue.items:[],approvals?.items);
  const fromRuns=runsOk?runs.runs.flatMap(r=>fromRun(r,claimed,titles)):[];
  const seen=new Set(),items=[];
  for(const n of [...att,...fromRuns]){if(seen.has(n.id))continue;seen.add(n.id);items.push({...n,read:readIds.has(n.id)})}
  items.sort((a,b)=>Number(a.read)-Number(b.read)||String(b.at??"").localeCompare(String(a.at??"")));
  const groups={};for(const g of NOTIFY_GROUPS){const xs=items.filter(n=>n.group===g);if(xs.length)groups[g]={count:xs.length,unread:xs.filter(n=>!n.read).length}}
  const partial=(attOk&&(attention.queue.truncated||attention.queue.dropped>0))||(runsOk&&runs.partial===true);
  return {state:attOk&&runsOk?(items.length?"VERIFIED":"EMPTY"):"PARTIAL",items,unread:items.filter(n=>!n.read).length,groups,sources,readAvailable,partial};
}
/** Kabuk zili için tek sayı: okunmamış bildirim sayısı; akış okunamıyorsa null (rozet gizlenir, 0 uydurulmaz). */
export function notificationsUnread(feed){return feed&&Number.isSafeInteger(feed.unread)?feed.unread:null}
