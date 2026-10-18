// //TR: Bu modül run event listesinden YALNIZCA gerçek timestamp ve stage alanlarıyla salt-okunur "aşama zaman çizelgesi" hesaplar (UI-226): her aşama için ilk->son olay ofseti ve süresi; geçersiz/eksik timestamp'li olaylar "yerleştirilemeyen" listesine girer; gerçek span süresi olmadığı için hiçbir süre uydurulmaz ve bu bir trace değildir.
const ISO=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/;
// //TR: Yalnız tam ISO-8601 (Z veya ±hh:mm zorunlu) kabul edilir; saat dilimsiz değer yerel TZ'ye göre yorumlanıp uydurulmaz. Takvim tarihi geri-doğrulanır (30 Şubat reddedilir).
export function parseTs(v){
  if(typeof v!=="string")return null;
  const m=ISO.exec(v);if(!m)return null;
  const y=+m[1],mo=+m[2],d=+m[3],H=+m[4],mi=+m[5],S=m[6]===undefined?0:+m[6];
  if(mo<1||mo>12||H>23||mi>59||S>59)return null;
  const dt=new Date(0);dt.setUTCFullYear(y,mo-1,d);
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return null;
  let off=0;
  if(m[8]!=="Z"){const oh=+m[8].slice(1,3),om=+m[8].slice(4,6);if(oh>23||om>59)return null;off=(oh*60+om)*60000*(m[8][0]==="-"?-1:1)}
  const frac=m[7]?+(m[7]+"00").slice(0,3):0;
  const ms=dt.setUTCHours(H,mi,S,frac)-off;
  return Number.isFinite(ms)?ms:null;
}
export function buildStageTimeline(events){
  const list=Array.isArray(events)?events:[];
  const by=new Map(),unplaced=[];
  list.forEach((e,index)=>{
    const ev=e&&typeof e==="object"?e:{};
    const stage=typeof ev.stage==="string"?ev.stage.trim():"";
    const ms=parseTs(ev.timestamp);
    if(ms===null){unplaced.push({index,stage,event:typeof ev.event==="string"?ev.event:""});return}
    const g=by.get(stage);
    if(g){g.count++;if(ms<g.firstMs){g.firstMs=ms;g.firstIdx=index}if(ms>g.lastMs)g.lastMs=ms}
    else by.set(stage,{stage,count:1,firstMs:ms,lastMs:ms,firstIdx:index});
  });
  const groups=[...by.values()].sort((a,b)=>a.firstMs-b.firstMs||(a.stage<b.stage?-1:a.stage>b.stage?1:0)||a.firstIdx-b.firstIdx);
  if(!groups.length)return{stages:[],unplaced,originMs:null,spanMs:0};
  const originMs=Math.min(...groups.map(g=>g.firstMs)),endMs=Math.max(...groups.map(g=>g.lastMs)),spanMs=endMs-originMs;
  const stages=groups.map(g=>({stage:g.stage,count:g.count,offsetMs:g.firstMs-originMs,durationMs:g.lastMs-g.firstMs,
    startPct:spanMs>0?(g.firstMs-originMs)/spanMs*100:0,widthPct:spanMs>0?(g.lastMs-g.firstMs)/spanMs*100:0}));
  return{stages,unplaced,originMs,spanMs};
}
export function formatMs(ms){
  if(!Number.isFinite(ms)||ms<0)return"";
  const r=Math.round(ms);
  if(r<1000)return`${r} ms`;
  if(ms<59950)return`${(ms/1000).toFixed(1)} s`;
  const t=Math.round(ms/1000),d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60),sec=t%60;
  if(t<3600)return`${m} min ${sec} s`;
  if(t<86400)return`${h} h ${m} min`;
  return`${d} d ${h} h`;
}
