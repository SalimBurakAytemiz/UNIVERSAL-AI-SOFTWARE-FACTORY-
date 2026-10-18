// //TR: Bu modül run event listesinden YALNIZCA gerçek timestamp ve stage alanlarıyla salt-okunur "aşama zaman çizelgesi" hesaplar (UI-226): her aşama için ilk->son olay ofseti ve süresi; geçersiz/eksik timestamp'li olaylar "yerleştirilemeyen" listesine girer; gerçek span süresi olmadığı için hiçbir süre uydurulmaz ve bu bir trace değildir.
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export function parseTs(v){
  if(typeof v!=="string"||!ISO.test(v))return null;
  const ms=Date.parse(v);return Number.isFinite(ms)?ms:null;
}
export function buildStageTimeline(events){
  const list=Array.isArray(events)?events:[];
  const by=new Map(),unplaced=[];
  list.forEach((e,index)=>{
    const ev=e&&typeof e==="object"?e:{};
    const stage=typeof ev.stage==="string"&&ev.stage.trim()?ev.stage:"";
    const ms=parseTs(ev.timestamp);
    if(ms===null){unplaced.push({index,stage,event:typeof ev.event==="string"?ev.event:""});return}
    const g=by.get(stage);
    if(g){g.count++;if(ms<g.firstMs)g.firstMs=ms;if(ms>g.lastMs)g.lastMs=ms}
    else by.set(stage,{stage,count:1,firstMs:ms,lastMs:ms});
  });
  const groups=[...by.values()].sort((a,b)=>a.firstMs-b.firstMs);
  if(!groups.length)return{stages:[],unplaced,originMs:null,spanMs:0};
  const originMs=Math.min(...groups.map(g=>g.firstMs)),endMs=Math.max(...groups.map(g=>g.lastMs)),spanMs=endMs-originMs;
  const stages=groups.map(g=>({stage:g.stage,count:g.count,offsetMs:g.firstMs-originMs,durationMs:g.lastMs-g.firstMs,
    startPct:spanMs>0?(g.firstMs-originMs)/spanMs*100:0,widthPct:spanMs>0?(g.lastMs-g.firstMs)/spanMs*100:0}));
  return{stages,unplaced,originMs,spanMs};
}
export function formatMs(ms){
  if(!Number.isFinite(ms)||ms<0)return"";
  if(ms<1000)return`${Math.round(ms)} ms`;
  if(ms<60000)return`${(ms/1000).toFixed(1)} s`;
  return`${Math.floor(ms/60000)} min ${Math.round((ms%60000)/1000)} s`;
}
