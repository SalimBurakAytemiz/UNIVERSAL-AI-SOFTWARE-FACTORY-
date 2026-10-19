// //TR: Bu modül DOM yardımcılarını ve ortak bileşenleri (durum çipi, KPI karosu, panel, planlı-alan paneli) içerir; API verisi asla HTML olarak yorumlanmaz, yalnız createElement/textContent ve replaceChildren kullanılır.
import {chipFor,formatCount,MISSING,formatTime,kpiTrend,formatDelta,pillKindFor,missionPillKind} from "./model.js";
import {icon,sparkline} from "./icons.js";
import {verificationChipKind,VERIFICATION_STATES} from "./work-core.js";

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
const PILL_ICON=Object.freeze({LOADING:"clock",EMPTY:"minus",VERIFIED:"check",STALE:"clock",OFFLINE:"wifioff",FAILED:"xcircle",BLOCKED:"ban",DENIED:"lock",NOT_CONNECTED:"plug",UNAVAILABLE:"minuscircle",NOT_EXECUTED:"dashedcircle",NOT_VERIFIED:"help",PRODUCT_VERIFIED:"shield",
  RECOVERING:"recover",ACTIVE:"pulse",WAITING:"clock",ATTENTION:"alert",DONE:"check",STOPPED:"ban",IDLE:"minus",NEUTRAL:"minus"});
/** //TR: UX WP2: ayrık durum rozeti (ikon + metin, renk tek başına anlam taşımaz); FAILED/BLOCKED/DENIED/STALE/OFFLINE/NOT_CONNECTED/UNAVAILABLE/NOT_EXECUTED/NOT_VERIFIED/PRODUCT_VERIFIED ayrı etiketlerdir. label verilmezse pill.<KIND> sözlüğünden gelir. */
export function statePill(ctx,kind,{label}={}){
  const doc=ctx.doc,k=PILL_ICON[kind]?kind:"NEUTRAL";
  return h(doc,"span",{class:`spill spill-${k.toLowerCase()}`,dataset:{pill:k}},icon(doc,PILL_ICON[k],14),h(doc,"span",{class:"spill-text",text:label??ctx.t(`pill.${k}`)}));
}
/** Mission/koşu durumu rozeti: kategori ikonu + yerelleştirilmiş durum metni (ham değer sözlükte yoksa olduğu gibi). */
export function missionPill(ctx,status){
  const k=missionPillKind(status);
  const label=statusLabel(ctx,status);
  return h(ctx.doc,"span",{class:`spill spill-${k.toLowerCase()}`,dataset:{pill:k,status:String(status??MISSING)}},icon(ctx.doc,PILL_ICON[k]??"minus",14),h(ctx.doc,"span",{class:"spill-text",text:k==="BLOCKED"||k==="FAILED"?`${ctx.t(`pill.${k}`)} · ${label}`:label}));
}
/** İkon çipi (KPI/aktivite başlığı için dolgulu kutu içinde ikon). */
export function iconChip(ctx,name,size=22){return h(ctx.doc,"span",{class:"kpi-icon"},icon(ctx.doc,name,size))}
/** //TR: UX WP2: işaretli delta (ok + işaret + renk); yalnız gerçek örneklerden gelir, kapsam (ör. "oturum") metinle belirtilir. good: "up"|"down"|"neutral" hangi yönün iyi olduğunu söyler. */
export function deltaBadge(ctx,trend,{good="neutral",scopeKey="kpi.deltaSession"}={}){
  if(!trend)return null;
  const dir=trend.direction,tone=dir==="flat"||good==="neutral"?"flat":dir===good?"good":"bad";
  return h(ctx.doc,"span",{class:`kpi-delta delta-${dir} delta-${tone}`,dataset:{delta:dir},title:ctx.t("kpi.deltaTitle",{n:trend.count})},
    icon(ctx.doc,dir==="up"?"arrowup":dir==="down"?"arrowdown":"minus",14),h(ctx.doc,"span",{class:"delta-num",text:formatDelta(trend.delta)}),h(ctx.doc,"span",{class:"delta-scope",text:ctx.t(scopeKey)}));
}
/** Mini sütun grafiği: yalnız verilen gerçek girdilerden (key,value,tone) çizilir; boşsa null. Özet metni erişilebilir ad olarak verilir. */
export function miniBars(ctx,entries,labelText){
  const rows=(entries??[]).filter(e=>Number.isSafeInteger(e.value)&&e.value>=0);
  if(!rows.length||rows.every(e=>e.value===0))return null;
  const max=Math.max(1,...rows.map(e=>e.value));
  return h(ctx.doc,"div",{class:"minibars",role:"img","aria-label":labelText},rows.map(e=>h(ctx.doc,"span",{class:`mb mb-${e.tone??"accent"}`,dataset:{mb:e.key,v:e.value},title:`${e.label??e.key}: ${e.value}`},h(ctx.doc,"span",{class:"mb-val",text:String(e.value)}),h(ctx.doc,"span",{class:"mb-bar",dataset:{h:String(Math.max(1,Math.round(e.value/max*4)))}}))));
}
/**
 * KPI karosu (UX WP2): ikon çipi + kalın sayı + (yalnız gerçek örnek varsa) işaretli delta + mini grafik + tek satır nitelik + kaynak/asOf + klavye ile etkinleşen detay bağlantısı.
 * Değer yalnız geçerli sayıysa gösterilir; aksi halde "—" + ayrık durum rozeti. Delta ve sparkline yalnız canlı (VERIFIED/STALE) blokta ve ≥2 gerçek örnekte çizilir.
 * route: ctx.navigate(route) ile gidilecek mevcut ekran. risk: true ise yalnız o zaman risk parıltısı.
 */
export function kpiTile(ctx,{id,iconName,labelKey,block,sampleKey,hintKey,extra,route,qualifier,bars,pillKind,risk=false,live=false,wide=false,deltaGood="neutral"}){
  const doc=ctx.doc,loading=block?.loading===true,isLive=!loading&&(block?.state==="VERIFIED"||block?.state==="STALE"),value=block&&!loading?formatCount(block.value):MISSING;
  const samples=sampleKey?ctx.store.samples.get(sampleKey)??[]:[];
  const trend=isLive&&sampleKey?kpiTrend(samples):null;
  const stateKey=loading?"LOADING":block?.state??"UNAVAILABLE",kind=pillKind??pillKindFor(block?{...block,loading}:null);
  // //TR: Canlı olmayan blokta nitelik satırı dürüst durumu söyler (DOĞRULANMADI · Kullanılamıyor (UNAVAILABLE) vb.); STALE değerde "Eski veri" öne eklenir. Sayı uydurulmaz.
  const honest=loading?null:!isLive?`${ctx.t("chip.UNVERIFIED")} · ${ctx.t(`state.${stateKey}`)}`:block?.state==="STALE"?ctx.t("state.STALE"):null;
  const qualText=honest&&!isLive?honest:honest?`${honest} · ${qualifier??(hintKey?ctx.t(hintKey):"")}`.replace(/ · $/,""):qualifier??(hintKey?ctx.t(hintKey):null);
  const drill=route&&typeof ctx.navigate==="function"?()=>ctx.navigate(route):null;
  const tile=h(doc,"article",{class:`kpi${wide?" kpi-wide":""} kpi-${block?.state==="VERIFIED"?"ok":"na"}${risk&&isLive?" kpi-risk":""}${live&&isLive?" kpi-live":""}${drill?" kpi-drill":""}`,dataset:{kpi:id,state:stateKey,drill:route??""},title:tooltipText(ctx,block),tabindex:"0",role:drill?"link":undefined,"aria-labelledby":`kpi-${id}-l`},
    h(doc,"div",{class:"kpi-head"},iconChip(ctx,iconName,24),h(doc,"h3",{class:"kpi-label",id:`kpi-${id}-l`,text:ctx.t(labelKey)})),
    h(doc,"div",{class:"kpi-main"},h(doc,"p",{class:"kpi-value",text:value}),deltaBadge(ctx,trend,{good:deltaGood}),h(doc,"span",{class:"kpi-pill"},statePill(ctx,kind))),
    h(doc,"div",{class:"kpi-spark"},isLive&&bars?bars:sparkline(doc,trend?trend.points:"",ctx.t(trend?"spark.session":"spark.none"))),
    qualText?h(doc,"p",{class:"kpi-qual",text:qualText}):null,extra??null,
    h(doc,"p",{class:"kpi-src",dataset:{src:block?.source??""},text:tooltipText(ctx,block)}),
    drill?h(doc,"span",{class:"kpi-go","aria-hidden":"true"},icon(doc,"chevron",16)):null);
  if(drill){
    tile.addEventListener("click",drill);
    tile.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target===tile){if(typeof e.preventDefault==="function")e.preventDefault();drill()}});
  }
  return tile;
}
/** //TR: UX WP2: aktivite zaman çizelgesi öğesi (zaman + atıf + durum rozeti); atıf yalnız gerçek kayıttan (proje adı vb.) gelir, yoksa gösterilmez. */
export function timelineItem(ctx,{time,iso,title,attribution,pill,meta}){
  const doc=ctx.doc;
  return h(doc,"li",{class:"tl-item"},
    h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
    h(doc,"time",{datetime:iso??undefined,text:time??MISSING}),
    h(doc,"div",{class:"tl-body"},h(doc,"strong",{class:"tl-title",text:title}),attribution?h(doc,"div",{class:"tl-attr",text:attribution}):null,h(doc,"div",{class:"tl-meta"},pill??null,meta??null)));
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
