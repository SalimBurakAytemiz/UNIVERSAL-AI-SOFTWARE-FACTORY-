// //TR: Bu görünüm İnsan Onayı Bekleyen İş Kuyruğu'dur (FA-V2-PRODUCT, UI-211): YALNIZ üç salt-okunur ve zaten izinli GET'ten okunur — GET /v1/founder-attention (Founder dikkati engelli paketler), GET /v1/missions (onay bekleyen mission durumları) ve GET /v1/work-runs (kapı bekleyen koşular). Kuyruk, öncelik düzeyine (türden türetilen belgelenmiş sıra) ve GERÇEK zaman damgasından hesaplanan bekleme süresine göre gruplanır/sıralanır; SLA hedefi kontrol düzleminde kayıtlı olmadığı için hiçbir SLA/son tarih değeri uydurulmaz, bekleme bantları yalnız geçen sürenin görüntü gruplamasıdır. HİÇBİR sayı, öğe veya onay UYDURULMAZ: bozuk yanıt tümden ERROR olarak gösterilir (kısmi/tahmini değer yok), okunamayan kaynak varsa toplam/öncelik sayıları gösterilmez ve kuyruk "boş" diye sunulmaz. Bu görünüm SALT-OKUNURDUR: onay/ret/yeniden-deneme burada yapılmaz; her öğe için MEVCUT akışlara (Gelen Kutusu, Work) gezinme sunulur. Toplu (bulk) eylem YOKTUR: her geçiş kendi gerekçesini ve yüksek riskli hedefte kendi onayını ister, bu yüzden her öğe mevcut akışta tek tek karara bağlanır. Ürün doğrulaması bu görünümde ASLA iddia edilmez ve ilgili sabit değer hiçbir yerde üretilmez. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,statusPill,badge,kpiTile} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {selection} from "../forms.js";
import {QUEUE_SOURCES,QUEUE_SOURCE_PATHS,WAIT_BAND_IDS,MAX_QUEUE_ROWS,buildQueue,waitParts} from "../queue-core.js";

const isOk=res=>Boolean(res)&&res.state==="VERIFIED";
/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t!==null&&t!==undefined&&t!==""?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
/** Öğe türünden durum rozeti türü: iş engelliyse ATTENTION, karar/kapı/yetki bekliyorsa WAITING (renk tek başına anlam taşımaz; etiket yerelleştirilmiş tür adıdır). */
const PILL_FOR_KIND=Object.freeze({FOUNDER_ATTENTION:"ATTENTION",BLOCKED_PACKAGE:"ATTENTION",DELIVERY_DECISION:"WAITING",RUN_GATE:"WAITING",AUTHORIZATION:"WAITING"});
/** Mevcut Gelen Kutusu akışının listelediği türler; RUN_GATE (mission REPORTING değil) Gelen Kutusu'nda karar olarak sunulmaz. */
const INBOX_KINDS=Object.freeze(["FOUNDER_ATTENTION","BLOCKED_PACKAGE","DELIVERY_DECISION","AUTHORIZATION"]);
const safeId=key=>String(key).replace(/[^A-Za-z0-9_-]/g,"_");

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("queue.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.queue.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.queue.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("queue.readonly")}),
    // Dürüstlük uyarısı: öncelik kayıtlı alan değildir, SLA hedefi yoktur, burada onay verilmez.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("queue.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. */
function stateBlock(ctx,res,source){
  const doc=ctx.doc,state=failState(res.state);
  return h(doc,"div",{class:`queue-state state-${state.toLowerCase()}`,role:"status",dataset:{queueState:state,source}},
    h(doc,"p",{class:"queue-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`queue.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`queue.hint.${state}`,{source:`GET ${QUEUE_SOURCE_PATHS[source]}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}

/** Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). */
function sourcesList(ctx,res,q){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources queue-sources","aria-label":ctx.t("queue.sources.aria")},QUEUE_SOURCES.map(k=>{
    const ok=isOk(res[k]),kind=ok?"VERIFIED":failKind(res[k].state);
    const verification=k==="attention"&&ok&&q.schedulerVerification!==null&&q.schedulerVerification!=="VERIFIED"?q.schedulerVerification:null;
    return h(doc,"li",{dataset:{source:k,sourceState:ok?"VERIFIED":failState(res[k].state)}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`queue.src.${k}`)}),
      statePill(ctx,kind,{label:ok?ctx.t("queue.src.ok"):undefined}),
      verification?h(doc,"span",{class:"note",dataset:{note:"scheduler-verification"},text:ctx.t("queue.src.verification",{value:verification})}):null);
  }));
}

// ---- Süre biçimi ----
function waitText(ctx,ms){
  const p=waitParts(ms);if(p===null)return MISSING;
  if(p.d>0)return ctx.t("queue.wait.dh",{d:p.d,h:p.h});
  if(p.h>0)return ctx.t("queue.wait.hm",{h:p.h,m:p.m});
  if(p.m>0)return ctx.t("queue.wait.m",{m:p.m});
  return ctx.t("queue.wait.lt1m");
}

// ---- (A) Özet: kaynaklar, sayılar, bekleme bantları ----
function kpiRow(ctx,q){
  const doc=ctx.doc,c=q.counts;
  // Sayılar yalnız kuyruk TAMAMSA (üç kaynak da okundu) gösterilir; aksi halde değer null ve rozet dürüst durumdur.
  const block=value=>({state:q.complete?"VERIFIED":q.incompleteState,value:q.complete?value:null,loading:false,source:"GET /v1/founder-attention · /v1/missions · /v1/work-runs",asOf:null});
  const tile=(id,iconName,value,qualifier)=>kpiTile(ctx,{id:`queue-${id}`,iconName,labelKey:`queue.kpi.${id}`,block:block(value),qualifier});
  return h(doc,"div",{class:"kpi-row queue-kpis",role:"group","aria-label":ctx.t("queue.kpi.group")},
    tile("total","inbox",c?c.total:null,ctx.t("queue.kpi.q.total")),
    tile("p1","alert",c?c.byPriority[1]:null,ctx.t("queue.kpi.q.p1")),
    tile("p2","clock",c?c.byPriority[2]:null,ctx.t("queue.kpi.q.p2")),
    tile("p3","lock",c?c.byPriority[3]:null,ctx.t("queue.kpi.q.p3")));
}
function bandsList(ctx,q){
  const doc=ctx.doc,c=q.counts;
  const li=(id,label)=>h(doc,"li",{dataset:{band:id,bandCount:c?String(c.byBand[id]):MISSING}},h(doc,"span",{class:"queue-band-name",text:label}),h(doc,"strong",{class:"mono",text:c?String(c.byBand[id]):MISSING}));
  return h(doc,"ul",{class:"queue-bands","aria-label":ctx.t("queue.bands.aria")},
    WAIT_BAND_IDS.map(id=>li(id,ctx.t(`queue.band.${id}`))),li("UNKNOWN",ctx.t("queue.band.UNKNOWN")));
}
function summaryPanel(ctx,res,q){
  const doc=ctx.doc;
  const failures=QUEUE_SOURCES.filter(k=>!isOk(res[k])).map(k=>stateBlock(ctx,res[k],k));
  const longest=q.counts&&q.counts.longestWaitMs!==null?waitText(ctx,q.counts.longestWaitMs):MISSING;
  return panel(ctx,{titleKey:"queue.summary.title",id:"queue-summary",className:"queue-section"},
    h(doc,"p",{class:"note",text:ctx.t("queue.summary.lead")}),
    h(doc,"h3",{class:"queue-sub",text:ctx.t("queue.sources.title")}),
    sourcesList(ctx,res,q),
    failures,
    !q.complete?h(doc,"p",{class:"note",role:"status",dataset:{queuePartial:q.unreadable.join(",")},text:ctx.t("queue.partial",{sources:q.unreadable.map(k=>ctx.t(`queue.srcShort.${k}`)).join(", ")})}):null,
    kpiRow(ctx,q),
    h(doc,"h3",{class:"queue-sub",text:ctx.t("queue.bands.title")}),
    h(doc,"p",{class:"note",text:ctx.t("queue.bands.lead")}),
    bandsList(ctx,q),
    h(doc,"p",{class:"queue-fact",dataset:{longestWait:q.counts&&q.counts.longestWaitMs!==null?String(q.counts.longestWaitMs):MISSING}},h(doc,"span",{class:"fact-label",text:ctx.t("queue.longest")})," ",h(doc,"strong",{text:longest})),
    h(doc,"p",{class:"note",dataset:{note:"no-sla"},text:ctx.t("queue.sla.note")}));
}

// ---- (B) Kuyruk ----
function facts(ctx,it,q){
  const doc=ctx.doc,t=ctx.t,rows=[];
  const add=(key,labelKey,...dd)=>rows.push([h(doc,"dt",{text:t(labelKey)}),h(doc,"dd",{dataset:{field:key}},...dd)]);
  add("needs","queue.field.needs",t(`queue.kindDesc.${it.kind}`));
  if(it.missionId!==null){
    // Başlık yalnız mission listesinden gelir; liste okunamadıysa ya da koşunun mission'ı listede yoksa bu AÇIKÇA söylenir (başlık uydurulmaz).
    const title=it.title!==null?it.title:t(q.sources.missions.state==="VERIFIED"?"queue.mission.unknown":"queue.mission.unread");
    add("mission","queue.field.mission",title," · ",mono(doc,it.missionId),it.missionStatus!==null?" ":null,it.missionStatus!==null?statusPill(ctx,it.missionStatus):null);
  }
  if(it.runId!==null)add("run","queue.field.run",mono(doc,it.runId)," · ",statePill(ctx,"WAITING",{label:it.runStatus})," · ",mono(doc,it.step));
  if(it.kind==="BLOCKED_PACKAGE"){
    if(it.packageId!==null)add("package","queue.field.package",mono(doc,it.packageId));
    if(it.phase!==null)add("phase","queue.field.phase",mono(doc,it.phase));
    add("blocker","queue.field.blocker",statePill(ctx,"ATTENTION",{label:it.blockerKind}));
    if(it.reason!==null)add("reason","queue.field.reason",it.reason);
    if(it.retryable!==null)add("retryable","queue.field.retryable",t(it.retryable?"queue.retry.yes":"queue.retry.no"));
  }
  if(it.riskLevel!==null)add("risk","queue.field.risk",badge(ctx,it.riskLevel,"badge-risk"));
  const wait=it.waitMs!==null
    ?[h(doc,"strong",{dataset:{waitMs:String(it.waitMs)},text:waitText(ctx,it.waitMs)})]
    :[h(doc,"span",{dataset:{waitMs:MISSING},text:t("queue.wait.unknown")})];
  if(it.since!==null&&it.basis!==null)wait.push(" · ",t(`queue.basis.${it.basis}`)," ",h(doc,"time",{datetime:it.since,text:formatDateTime(it.since,ctx.i18n.lang)}));
  add("waiting","queue.field.waiting",...wait);
  add("band","queue.field.band",t(`queue.band.${it.band===null?"UNKNOWN":it.band}`));
  return h(doc,"dl",{class:"queue-facts"},rows.flat());
}
/** Eylemler yalnız MEVCUT akışlara gezinmedir; burada hiçbir geçiş/onay/POST yoktur. */
function actions(ctx,it,heading){
  const doc=ctx.doc,sid=safeId(it.key),buttons=[];
  if(it.missionId!==null)buttons.push(h(doc,"button",{type:"button",class:"btn",id:`q-open-${sid}`,dataset:{focusKey:`q-open-${sid}`,navigate:"work"},
    on:{click:()=>{selection.missionId=it.missionId;ctx.navigate("work")}},text:ctx.t("queue.action.openMission")}));
  if(INBOX_KINDS.includes(it.kind))buttons.push(h(doc,"button",{type:"button",class:"btn",id:`q-inbox-${sid}`,dataset:{focusKey:`q-inbox-${sid}`,navigate:"inbox"},
    on:{click:()=>ctx.navigate("inbox")},text:ctx.t("queue.action.openInbox")}));
  return h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("queue.actions.aria",{title:heading})},buttons);
}
function itemCard(ctx,it,q){
  const doc=ctx.doc;
  const heading=it.title??it.packageId??(it.phase!==null?ctx.t("queue.item.phase",{phase:it.phase}):it.runId??it.missionId??MISSING);
  return h(doc,"li",{class:"card queue-item",dataset:{queueItem:it.key,kind:it.kind,priority:it.priority,band:it.band===null?"UNKNOWN":it.band,basis:it.basis===null?"NONE":it.basis}},
    h(doc,"h4",{text:String(heading)}),
    h(doc,"p",{class:"panel-meta"},statePill(ctx,PILL_FOR_KIND[it.kind],{label:ctx.t(`queue.kind.${it.kind}`)}),it.band!==null?badge(ctx,ctx.t(`queue.band.${it.band}`)):null),
    facts(ctx,it,q),
    actions(ctx,it,String(heading)));
}
function tierSection(ctx,g,q,budget){
  const doc=ctx.doc,id=`queue-tier-${g.priority}`;
  const shown=g.items.slice(0,Math.max(0,budget));
  let body;
  if(!g.items.length)body=h(doc,"p",{class:"note",dataset:{tierEmpty:String(g.priority)},text:ctx.t(q.complete?"queue.tier.empty":"queue.tier.emptyPartial")});
  else body=h(doc,"ol",{class:"cards queue-list","aria-labelledby":`${id}-t`,dataset:{queueTier:String(g.priority),count:String(shown.length)}},shown.map(it=>itemCard(ctx,it,q)));
  return {node:h(doc,"div",{class:"queue-tier",dataset:{priority:g.priority}},
    h(doc,"h3",{class:"queue-sub",id:`${id}-t`},ctx.t(`queue.tier.${g.priority}`)," ",badge(ctx,ctx.t("queue.tier.listed",{n:g.items.length}))),
    h(doc,"p",{class:"note",text:ctx.t(`queue.tier.${g.priority}.desc`)}),body),shown:shown.length};
}
function queuePanel(ctx,q){
  const doc=ctx.doc;
  let body;
  if(!q.items.length){
    // Boş kuyruk YALNIZ üç kaynak da okunduysa söylenir; aksi halde "boş" iddia edilmez.
    body=q.complete
      ?h(doc,"p",{class:"note",dataset:{queueEmpty:"1"},role:"status",text:ctx.t("queue.empty")})
      :h(doc,"p",{class:"note",dataset:{queueEmpty:"unknown"},role:"status",text:q.unreadable.length===QUEUE_SOURCES.length?ctx.t("queue.emptyAll"):ctx.t("queue.emptyPartial",{sources:q.unreadable.map(k=>ctx.t(`queue.srcShort.${k}`)).join(", ")})});
  }else{
    let budget=MAX_QUEUE_ROWS,shownTotal=0;
    const tiers=q.groups.map(g=>{const t=tierSection(ctx,g,q,budget);budget-=t.shown;shownTotal+=t.shown;return t.node});
    body=[shownTotal<q.items.length?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:ctx.t("queue.truncated",{shown:shownTotal,total:q.items.length})}):null,...tiers];
  }
  return panel(ctx,{titleKey:"queue.list.title",id:"queue-list",className:"queue-section"},
    h(doc,"p",{class:"note",dataset:{note:"order"},text:ctx.t("queue.order.note")}),
    h(doc,"p",{class:"note",dataset:{note:"actions"},text:ctx.t("queue.action.hint")}),
    h(doc,"p",{class:"note",dataset:{note:"no-bulk"},text:ctx.t("queue.bulk.note")}),
    body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [attention,missions,workRuns]=await Promise.all([
    read(()=>api.queueAttention(),{attention:null}),
    read(()=>api.queueMissions(),{missions:null}),
    read(()=>api.queueWorkRuns(),{runs:null})
  ]);
  const res={attention,missions,workRuns};
  const nowMs=typeof ctx.now==="function"?Number(ctx.now()):Date.now();
  const q=buildQueue({attention,missions,runs:workRuns},nowMs);
  return h(doc,"div",{class:"view view-queue"},header(ctx),summaryPanel(ctx,res,q),queuePanel(ctx,q));
}
