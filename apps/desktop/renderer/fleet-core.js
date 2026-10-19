// //TR: Bu modül UI-030 "Aktif işçi filosu ızgarası"nın saf (DOM'suz) çekirdeğidir: #/workforce görünümünün ZATEN okuduğu GET /v1/work-runs satırlarından yalnız canlı (terminal olmayan) koşuları durum kovalarına dağıtır; kendi okuması, yeni uç noktası veya yazımı YOKTUR. Verideki olmayan alanlar (rol, mission, kalp atışı) UNKNOWN kalır; sayı/canlılık uydurulmaz. Üst sınır 50 kart; aşılırsa "X / Y gösteriliyor" notu için truncated bilgisi döner.
import {RUN_ACTIVE_STATES,liveRuns} from "./work-core.js";

export const MAX_FLEET_CARDS=50;

/**
 * Canlı koşuları RUN_ACTIVE_STATES sırasıyla kovalara böler; toplam kart sayısı MAX_FLEET_CARDS ile sınırlıdır.
 * -> {total, shown, truncated, groups:[{status,count,items}]}; count kovanın gerçek (sınırsız) sayısıdır, items gösterilen kartlardır.
 */
export function fleetGroups(runs,max=MAX_FLEET_CARDS){
  const live=liveRuns(Array.isArray(runs)?runs.filter(r=>r&&typeof r==="object"):[]);
  let room=Math.max(0,Math.trunc(max)),shown=0;
  const groups=[];
  for(const status of RUN_ACTIVE_STATES){
    const all=live.filter(r=>r.status===status);
    if(!all.length)continue;
    const items=all.slice(0,room);room-=items.length;shown+=items.length;
    groups.push({status,count:all.length,items});
  }
  return {total:live.length,shown,truncated:shown<live.length,groups};
}

/** Kart alanları: yalnız veride gerçekten olan değerler; yoksa null (arayüz UNKNOWN/— gösterir, uydurma yok). */
export function fleetCard(run){
  return {runId:run.runId,status:run.status,role:run.role??null,missionId:run.missionId??null,updatedAt:run.heartbeatAt??null};
}
