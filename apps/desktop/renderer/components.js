// //TR: Bu modül DOM yardımcılarını ve ortak bileşenleri (durum çipi, KPI karosu, panel, planlı-alan paneli) içerir; API verisi asla HTML olarak yorumlanmaz, yalnız createElement/textContent ve replaceChildren kullanılır.
import {chipFor,formatCount,MISSING,formatTime} from "./model.js";
import {icon,sparkline} from "./icons.js";
import {verificationChipKind,VERIFICATION_STATES} from "./work-core.js";
import {sparkPoints} from "./model.js";

export function h(doc,tag,props={},...children){
  const n=doc.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(v===undefined||v===null||v===false)continue;
    if(k==="class")n.className=v;else if(k==="text")n.textContent=String(v);else if(k==="on"){for(const [ev,fn] of Object.entries(v))n.addEventListener(ev,fn)}
    else if(k==="dataset"){for(const [dk,dv] of Object.entries(v))n.dataset[dk]=String(dv)}else n.setAttribute(k,v===true?"":String(v));
  }
  for(const c of children.flat()){if(c===undefined||c===null||c===false)continue;n.append(typeof c==="string"||typeof c==="number"?doc.createTextNode(String(c)):c)}
  return n;
}
export function chip(ctx,block,{kind}={}){
  const k=kind??chipFor(block);
  return h(ctx.doc,"span",{class:`chip chip-${k.toLowerCase()}`,dataset:{chip:k}},h(ctx.doc,"span",{class:"chip-dot","aria-hidden":"true"}),ctx.t(`chip.${k}`));
}
export function tooltipText(ctx,block){
  return ctx.t("tile.tooltip",{source:block?.source??MISSING,asOf:block?.asOf?formatTime(block.asOf,ctx.i18n.lang):MISSING});
}
/** KPI karosu: değer yalnız geçerli sayıysa gösterilir; aksi halde "—" + durum çipi + kaynak/asOf tooltip. */
export function kpiTile(ctx,{id,iconName,labelKey,block,sampleKey,hintKey,extra}){
  const doc=ctx.doc,loading=block?.loading===true,value=block&&!loading?formatCount(block.value):MISSING;
  const samples=sampleKey?ctx.store.samples.get(sampleKey)??[]:[];
  const stateKey=loading?"LOADING":block?.state??"UNAVAILABLE";
  const tile=h(doc,"article",{class:`kpi kpi-${block?.state==="VERIFIED"?"ok":"na"}`,dataset:{kpi:id,state:loading?"LOADING":block?.state??"UNAVAILABLE"},title:tooltipText(ctx,block),tabindex:"0","aria-labelledby":`kpi-${id}-l`},
    h(doc,"span",{class:"kpi-icon"},icon(doc,iconName,26)),
    h(doc,"div",{class:"kpi-body"},
      h(doc,"h3",{class:"kpi-label",id:`kpi-${id}-l`,text:ctx.t(labelKey)}),
      h(doc,"p",{class:"kpi-value",text:value}),
      h(doc,"p",{class:"kpi-state"},chip(ctx,block?{...block,loading}:null),h(doc,"span",{class:"kpi-state-text",text:ctx.t(`state.${stateKey}`)})),
      hintKey?h(doc,"p",{class:"kpi-hint",text:ctx.t(hintKey)}):null,extra??null),
    h(doc,"div",{class:"kpi-spark"},sparkline(doc,sparkPoints(samples),ctx.t(samples.length>=2?"spark.session":"spark.none"))));
  return tile;
}
export function panel(ctx,{titleKey,id,className=""},...children){
  const doc=ctx.doc;return h(doc,"section",{class:`panel ${className}`.trim(),"aria-labelledby":`${id}-t`,id},h(doc,"h2",{class:"panel-title",id:`${id}-t`,text:ctx.t(titleKey)}),...children);
}
export function emptyNote(ctx,key){return h(ctx.doc,"p",{class:"note",text:ctx.t(key)})}
export function stateNote(ctx,state,messageKeyOverride){
  const k=messageKeyOverride??`state.${state}`;return h(ctx.doc,"p",{class:`note note-${String(state).toLowerCase()}`,role:"status",text:ctx.t(k)});
}
export function badge(ctx,text,cls=""){return h(ctx.doc,"span",{class:`badge ${cls}`.trim(),text:String(text)})}
/** Backend durum değerini sözlükten (mstatus.*) çevirir; sözlükte yoksa ham değer gösterilir (veri uydurulmaz). */
export function statusLabel(ctx,status){
  const raw=String(status??MISSING),key=`mstatus.${raw}`,v=ctx.t(key);return v===key?raw:v;
}
export function statusPill(ctx,status){return h(ctx.doc,"span",{class:"pill",dataset:{status},text:statusLabel(ctx,status)})}
/** Henüz uygulanmamış alan için dürüst panel: planlı paket + içerecekleri. */
export function plannedPanel(ctx,route,{partial=false}={}){
  const doc=ctx.doc,id=`planned-${route.id}`;
  return h(doc,"section",{class:"panel planned",id,"aria-labelledby":`${id}-t`,dataset:{planned:route.plannedPackage??""}},
    h(doc,"h2",{class:"panel-title",id:`${id}-t`,text:ctx.t(partial?"planned.partial.title":"planned.title",{pkg:route.plannedPackage})}),
    h(doc,"p",{class:"note",text:ctx.t(partial?"planned.partial.lead":"planned.lead",{pkg:route.plannedPackage})}),
    h(doc,"h3",{class:"planned-sub",text:ctx.t("planned.contains")}),
    h(doc,"ul",{class:"planned-list"},[1,2,3].map(i=>h(doc,"li",{text:ctx.t(`area.${route.id}.plan${i}`)}))));
}
/** Kanıt doğrulama durumu çipi (VERIFIED/MISMATCH/MISSING/UNVERIFIABLE); durum yoksa veya bilinmiyorsa asla "doğrulandı" gösterilmez. */
export function verificationChip(ctx,verification){
  const k=verificationChipKind(verification),label=verification&&VERIFICATION_STATES.includes(verification)?ctx.t(`everif.${verification}`):ctx.t("everif.NONE");
  return h(ctx.doc,"span",{class:`chip chip-${k.toLowerCase()}`,dataset:{chip:k,verification:verification??"NONE"}},h(ctx.doc,"span",{class:"chip-dot","aria-hidden":"true"}),label);
}
