// //TR: Bu görünüm parçası Görevler > mission ayrıntısındaki plan özetidir (UASCO-T0012): mission okumasındaki görevlerden (GET /v1/missions/:id) durum sayımı ve sıralı satırları türetir. Hiçbir sayı uydurulmaz: durumu bilinmeyen görev "bilinmiyor" sayılır; bağımlılık yalnız sunucu dependsOn dizisi döndürdüyse gösterilir. Okuma/yazma yoktur; saf türetim + h()/textContent.
import {h} from "../components.js";
import {MISSING} from "../model.js";

export const PLAN_STATUS_ORDER=Object.freeze(["DONE","IN_PROGRESS","PENDING","BLOCKED"]);
const kindOf=s=>PLAN_STATUS_ORDER.includes(s)?s:"UNKNOWN";
/** Görev listesinden durum sayımı: {total,counts:{DONE,IN_PROGRESS,PENDING,BLOCKED,UNKNOWN}}. */
export function planCounts(tasks){
  const counts={DONE:0,IN_PROGRESS:0,PENDING:0,BLOCKED:0,UNKNOWN:0},list=Array.isArray(tasks)?tasks:[];
  for(const t of list)counts[kindOf(t?.status)]++;
  return {total:list.length,counts};
}
/** Sıralı satırlar: {n,task,statusKind,after}; after null = bağımlılık bilinmiyor, [] = yok, aksi halde önceki satır numaraları (listede olmayan kimlik olduğu gibi). */
export function orderedTaskRows(tasks){
  const list=Array.isArray(tasks)?tasks:[],pos=new Map(list.map((t,i)=>[t.taskId,i+1]));
  return list.map((t,i)=>({n:i+1,task:t,statusKind:kindOf(t.status),after:Array.isArray(t.dependsOn)?t.dependsOn.map(d=>pos.get(d)??d):null}));
}
export function planOverview(ctx,tasks){
  const doc=ctx.doc,{total,counts}=planCounts(tasks);
  const parts=[...PLAN_STATUS_ORDER,"UNKNOWN"].filter(k=>counts[k]>0||k!=="UNKNOWN").flatMap((k,i)=>[i?" · ":null,h(doc,"span",{dataset:{planCount:k,n:String(counts[k])}},h(doc,"span",{class:"mono",text:String(counts[k])})," ",h(doc,"span",{text:ctx.t(`planview.k.${k}`)}))]);
  return h(doc,"div",{class:"plan-overview",id:"plan-overview",role:"region","aria-label":ctx.t("planview.title"),dataset:{planTotal:String(total),planDone:String(counts.DONE)}},
    h(doc,"p",{class:"panel-meta",dataset:{planProgress:"1"},text:ctx.t("planview.progress",{done:counts.DONE,total})}),
    h(doc,"p",{class:"note plan-counts"},parts),
    counts.UNKNOWN>0?h(doc,"p",{class:"note note-unknown",role:"status",dataset:{planUnknown:String(counts.UNKNOWN)},text:ctx.t("planview.unknown",{n:counts.UNKNOWN,dash:MISSING})}):null);
}
