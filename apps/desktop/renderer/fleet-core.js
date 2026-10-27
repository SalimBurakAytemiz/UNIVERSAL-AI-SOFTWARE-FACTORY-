// //TR: Bu modül UI-030 "Aktif işçi filosu ızgarası"nın saf (DOM'suz) çekirdeğidir: #/workforce görünümünün ZATEN okuduğu GET /v1/work-runs satırlarından koşuları üç kovaya dağıtır (A-RUNSTATE-1): canlı işçi (yalnız sunucunun aktif-işçi kümesi), "kuyrukta (henüz çalışmıyor)" ve "durum bilinmiyor" (asla canlı sayılmaz); terminal koşular gösterilmez; kendi okuması, yeni uç noktası veya yazımı YOKTUR. Verideki olmayan alanlar (rol, mission, kalp atışı) UNKNOWN kalır; sayı/canlılık uydurulmaz. Üst sınır 50 kart; aşılırsa "X / Y gösteriliyor" notu için truncated bilgisi döner.
import {RUN_LIVE_STATES,RUN_QUEUED_STATE,liveRuns,queuedRuns} from "./work-core.js";
import {RUN_STATUSES} from "./executive-core.js";

export const MAX_FLEET_CARDS=50;
export const FLEET_BUCKETS=Object.freeze({LIVE:"LIVE",QUEUED:"QUEUED",UNKNOWN:"UNKNOWN",OTHER:"OTHER"});

/** A-RUNSTATE-1: durum -> kova. LIVE yalnız sunucunun aktif-işçi kümesi; QUEUED ayrı kova; sunucu RunStatus listesinde olmayan her şey UNKNOWN (asla canlı sayılmaz); geri kalan bilinen durumlar OTHER (ızgarada yok). */
export function runBucket(status){
  if(RUN_LIVE_STATES.includes(status))return FLEET_BUCKETS.LIVE;
  if(status===RUN_QUEUED_STATE)return FLEET_BUCKETS.QUEUED;
  return RUN_STATUSES.includes(status)?FLEET_BUCKETS.OTHER:FLEET_BUCKETS.UNKNOWN;
}

/**
 * Koşuları kovalara böler: canlı işçi durumları (RUN_LIVE_STATES sırasıyla), sonra "kuyrukta (henüz çalışmıyor)", sonra "durum bilinmiyor". Kart sınırı MAX_FLEET_CARDS; canlı kovalar önce yer alır.
 * -> {total, live, queued, unknown, other, shown, truncated, groups:[{status,bucket,count,items}]}; count kovanın gerçek (sınırsız) sayısı, items gösterilen kartlardır; live yalnız canlı işçi sayısıdır.
 */
export function fleetGroups(runs,max=MAX_FLEET_CARDS){
  const valid=Array.isArray(runs)?runs.filter(r=>r&&typeof r==="object"):[];
  const live=liveRuns(valid),queued=queuedRuns(valid),unknown=valid.filter(r=>runBucket(r.status)===FLEET_BUCKETS.UNKNOWN),other=valid.filter(r=>runBucket(r.status)===FLEET_BUCKETS.OTHER).length;
  let room=Math.max(0,Math.trunc(max)),shown=0;
  const groups=[];
  const add=(status,bucket,all)=>{
    if(!all.length)return;
    const items=all.slice(0,room);room-=items.length;shown+=items.length;
    groups.push({status,bucket,count:all.length,items});
  };
  for(const status of RUN_LIVE_STATES)add(status,FLEET_BUCKETS.LIVE,live.filter(r=>r.status===status));
  add(RUN_QUEUED_STATE,FLEET_BUCKETS.QUEUED,queued);
  add(FLEET_BUCKETS.UNKNOWN,FLEET_BUCKETS.UNKNOWN,unknown);
  const total=live.length+queued.length+unknown.length;
  return {total,live:live.length,queued:queued.length,unknown:unknown.length,other,shown,truncated:shown<total,groups};
}

/** Kart alanları: yalnız veride gerçekten olan değerler; yoksa null (arayüz UNKNOWN/— gösterir, uydurma yok). */
export function fleetCard(run){
  return {runId:run.runId,status:run.status,bucket:runBucket(run.status),role:run.role??null,missionId:run.missionId??null,updatedAt:run.heartbeatAt??null};
}

/**
 * UI-032: seçili canlı koşunun ayrıntısı. Koşu artık ızgarada değilse (listede yok) null döner; canlı ajan telemetrisi YOK, o alan her zaman null (UNKNOWN).
 */
export function fleetDetail(runs,runId){
  if(typeof runId!=="string"||!runId)return null;
  const run=fleetGroups(runs,Number.MAX_SAFE_INTEGER).groups.flatMap(g=>g.items).find(r=>r.runId===runId);
  return run?{...fleetCard(run),telemetry:null}:null;
}
