// //TR: Bu modül Görevler ekranının kullanılabilirlik katmanıdır (V3-T1023 alternatifi; hiyerarşi arka ucu V3-T1022 henüz yok): uzun mission tablosunu sayfalar (dürüst "N / M gösteriliyor" + "daha fazla"), görev listesini durumla süzer (sayılarla; eşleşme yoksa dürüst boş not ve "tümünü göster"), görev listesi ile mission başlık sütununda dolaşan tabindex (ok tuşları, Home/End) kurar ve boş Work listesinde oluşturma formuna götüren eylem sunar. Yalnız bellekte durum; ağ/depolama yok; veri uydurulmaz.
import {h,statusLabel} from "../components.js";

export const MISSION_PAGE=25;
export const TASK_FILTERS=Object.freeze(["ALL","PENDING","IN_PROGRESS","DONE","BLOCKED"]);
export const polishState={missionShown:MISSION_PAGE,missionFilterSeen:null,taskFilter:"ALL",taskFilterMission:null};
export function resetPolish(){polishState.missionShown=MISSION_PAGE;polishState.missionFilterSeen=null;polishState.taskFilter="ALL";polishState.taskFilterMission=null}

/** Sayfalama (saf): {rows,total,hidden}; filtre değişince sayfa başa döner. */
export function pageMissions(items,filterKey){
  const list=Array.isArray(items)?items:[];
  if(polishState.missionFilterSeen!==filterKey){polishState.missionFilterSeen=filterKey;polishState.missionShown=MISSION_PAGE}
  const n=Math.max(MISSION_PAGE,polishState.missionShown);
  return {rows:list.slice(0,n),total:list.length,hidden:Math.max(0,list.length-n)};
}
export function missionMore(ctx,page){
  const doc=ctx.doc;
  if(page.total<=MISSION_PAGE&&page.hidden===0)return null;
  return h(doc,"div",{class:"btn-row",id:"mission-page",dataset:{missionShown:String(page.rows.length),missionTotal:String(page.total)}},
    h(doc,"p",{class:"note",role:"status",text:ctx.t("polish.missions.showing",{shown:page.rows.length,total:page.total})}),
    page.hidden>0?h(doc,"button",{type:"button",class:"btn",id:"mission-more",dataset:{focusKey:"mission-more"},text:ctx.t("polish.missions.more",{n:Math.min(MISSION_PAGE,page.hidden)}),
      on:{click:async()=>{const first=page.rows.length;polishState.missionShown=first+MISSION_PAGE;await ctx.rerender();
        // odak yeni gelen ilk satıra taşınır (klavye kullanıcısı kaldığı yerden devam eder)
        const btn=ctx.doc.getElementById?.(`mission-row-${first}`);if(btn&&typeof btn.focus==="function")btn.focus()}}}):null);
}

/** Görev süzgeci (saf). Bilinmeyen durumlu görev yalnız "Tümü"nde görünür. */
export function filterTasks(tasks,f){const list=Array.isArray(tasks)?tasks:[];return f==="ALL"||!TASK_FILTERS.includes(f)?list:list.filter(t=>t.status===f)}
export function taskFilterKey(missionId){if(polishState.taskFilterMission!==missionId){polishState.taskFilterMission=missionId;polishState.taskFilter="ALL"}return polishState.taskFilter}
export function taskFilterBar(ctx,missionId,tasks){
  const doc=ctx.doc,cur=taskFilterKey(missionId),list=Array.isArray(tasks)?tasks:[];
  const count=k=>k==="ALL"?list.length:list.filter(t=>t.status===k).length;
  const buttons=TASK_FILTERS.map(k=>h(doc,"button",{type:"button",class:"btn btn-small",id:`tf-${k}`,dataset:{taskFilter:k,focusKey:`tf-${k}`,n:String(count(k))},"aria-pressed":cur===k?"true":"false",
    on:{click:()=>{polishState.taskFilter=k;ctx.rerender()}},text:`${k==="ALL"?ctx.t("polish.tasks.all"):statusLabel(ctx,k)} (${count(k)})`}));
  roving(buttons,{horizontal:true});
  return h(doc,"div",{class:"btn-row filter-bar",id:"task-filter",role:"group","aria-label":ctx.t("polish.tasks.filter")},buttons);
}
export function taskFilterNone(ctx,missionId){
  const doc=ctx.doc;
  return h(doc,"div",{class:"btn-row",id:"task-filter-none",role:"status"},h(doc,"p",{class:"note note-empty",text:ctx.t("polish.tasks.none",{status:statusLabel(ctx,polishState.taskFilter)})}),
    h(doc,"button",{type:"button",class:"btn",id:"task-filter-reset",dataset:{focusKey:"task-filter-reset"},text:ctx.t("polish.tasks.showAll"),on:{click:async()=>{polishState.taskFilter="ALL";polishState.taskFilterMission=missionId;await ctx.rerender();const b=ctx.doc.getElementById?.("tf-ALL");if(b&&b.focus)b.focus()}}}));
}

const NEXT=Object.freeze({ArrowDown:1,ArrowUp:-1}),NEXT_H=Object.freeze({ArrowRight:1,ArrowLeft:-1,ArrowDown:1,ArrowUp:-1});
/** //TR: Dolaşan tabindex (WAI-ARIA): grupta yalnız bir öğe Tab sırasındadır (etkin/seçili ya da ilk); ok tuşları sonrakine/öncekine (uçlarda sarar), Home/End ilk/son öğeye odak taşır. Düğmeler etkinleştirme davranışını korur (Enter/Boşluk). */
export function roving(buttons,{horizontal=false,activeIndex=null}={}){
  const list=(buttons??[]).filter(Boolean);if(!list.length)return list;
  const pressed=list.findIndex(b=>b.getAttribute?.("aria-pressed")==="true"||b.getAttribute?.("aria-current")==="true");
  const start=activeIndex!==null&&activeIndex>=0&&activeIndex<list.length?activeIndex:pressed>=0?pressed:0;
  const map=horizontal?NEXT_H:NEXT;
  list.forEach((b,i)=>{
    b.setAttribute("tabindex",i===start?"0":"-1");
    b.addEventListener("keydown",e=>{
      const k=e?.key;let to=null;
      if(Object.prototype.hasOwnProperty.call(map,k))to=(i+map[k]+list.length)%list.length;
      else if(k==="Home")to=0;else if(k==="End")to=list.length-1;
      if(to===null)return;
      if(typeof e.preventDefault==="function")e.preventDefault();
      list.forEach((x,j)=>x.setAttribute("tabindex",j===to?"0":"-1"));
      if(typeof list[to].focus==="function")list[to].focus();
    });
  });
  return list;
}

/** Boş Work listesi: dürüst boş not + oluşturma formunun ilk alanına götüren eylem. */
export function workEmpty(ctx,key="work.empty"){
  const doc=ctx.doc;
  return h(doc,"div",{class:"btn-row",id:"work-empty",dataset:{emptyNext:"mission-form"}},h(doc,"p",{class:"note note-empty",text:ctx.t(key)}),
    h(doc,"button",{type:"button",class:"btn btn-primary",id:"work-empty-create",dataset:{focusKey:"work-empty-create"},text:ctx.t("polish.empty.create"),
      on:{click:()=>{const n=ctx.doc.getElementById?.("mission-title");if(n&&typeof n.focus==="function"){n.focus();if(typeof n.scrollIntoView==="function")n.scrollIntoView({block:"center"})}}}}));
}
