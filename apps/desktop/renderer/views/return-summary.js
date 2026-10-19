// //TR: Bu modül UI-003 "Dönüş Özeti" panelidir (Kurucu Yönetim Özeti görünümünün en üstünde, #/executive): son ziyaretten beri koşularda ve mission'larda ne değiştiğini, executive.js'in ZATEN yaptığı iki salt-okunur okumadan (GET /v1/work-runs, GET /v1/missions) gösterir; kendi okuması, yeni uç noktası veya sunucu yazımı YOKTUR. Tek yazımı, Founder "tümünü görüldü olarak işaretle" dediğinde bu cihazın localStorage'ına yazılan son-görülme işaretidir ve bu işaret istemci saati değil sunucu kayıtlarının en yeni zaman damgasıdır (return-summary-core.js). Okunamayan kaynak 0 değil dürüst durum gösterir; teslim yalnız kaynak düzeyidir; ürün doğrulaması asla iddia edilmez. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,emptyNote} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {EXECUTIVE_SOURCE_PATHS,PILL_FOR_RUN_STATUS,shortSha} from "../executive-core.js";
import {RETURN_GROUPS,readSeen,storeSeen,nextSeen,returnSummary} from "../return-summary-core.js";

const isOk=res=>Boolean(res)&&res.state==="VERIFIED";
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const commit=(doc,sha)=>sha?h(doc,"span",{class:"mono",title:sha,text:shortSha(sha)}):MISSING;
/** //TR: Cihaz deposu: çağıran ctx.storage verebilir (test); yoksa tarayıcı localStorage, erişilemezse null (işaret kalıcı olmaz, özet hesaplanmaz). */
function deviceStorage(ctx){if(ctx.storage!==undefined)return ctx.storage;try{return globalThis.window?.localStorage??null}catch{return null}}
const RETURN_PILL=Object.freeze({awaiting:"WAITING",failed:"FAILED",blocked:"BLOCKED",completed:"DONE",stopped:"STOPPED",active:"ACTIVE"});
const shownNote=(ctx,part)=>part.truncated?h(ctx.doc,"p",{class:"note",dataset:{note:"truncated"},text:ctx.t("executive.return.shown",{shown:part.items.length,total:part.count})}):null;
function returnRunRow(ctx,r,titles){
  const doc=ctx.doc,title=titles?titles.get(r.missionId):undefined;
  return h(doc,"li",{class:"tl-item",dataset:{returnRun:r.runId,status:r.status}},
    h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
    h(doc,"time",{datetime:r.updatedAt,text:formatDateTime(r.updatedAt,ctx.i18n.lang)}),
    h(doc,"div",{class:"tl-body"},
      h(doc,"p",{class:"executive-row-head"},h(doc,"strong",{class:"mono",text:r.runId})," ",statePill(ctx,PILL_FOR_RUN_STATUS[r.status]??"NEUTRAL",{label:r.status})),
      h(doc,"p",{class:"note",text:`${ctx.t("executive.ledger.mission")}: ${title?`${title} · ${r.missionId}`:r.missionId}`})));
}
/** Sayım özeti: her grup + yeni mission + kabul edilen teslim; okunamayan mission kaynağı 0 değil — gösterir. */
function returnOverview(ctx,sum){
  const doc=ctx.doc,t=ctx.t,dash=()=>h(doc,"span",{class:"mono",text:MISSING});
  const pair=(key,label,pill,value)=>[h(doc,"dt",{dataset:{returnCount:key},text:label}),h(doc,"dd",{},pill," ",value===null?dash():h(doc,"span",{class:"mono",text:String(value)}))];
  return h(doc,"dl",{class:"executive-facts executive-return-overview","aria-label":t("executive.return.overview.aria")},
    RETURN_GROUPS.flatMap(g=>pair(g,t(`executive.return.group.${g}`),statePill(ctx,RETURN_PILL[g]),sum.groups[g].count)),
    pair("missions",t("executive.return.newMissions"),statePill(ctx,sum.missions.state==="VERIFIED"?"VERIFIED":failKind(sum.missions.state)),sum.missions.count),
    // Teslim yalnız kaynak düzeyidir: rozet daima NOT_VERIFIED.
    pair("deliveries",t("executive.return.deliveries"),statePill(ctx,"NOT_VERIFIED"),sum.deliveries.count));
}
function returnDetails(ctx,sum,res){
  const doc=ctx.doc,t=ctx.t;
  const titles=isOk(res.missions)&&res.missions.missions?new Map(res.missions.missions.items.map(m=>[m.missionId,m.title])):null;
  const out=[];
  for(const g of RETURN_GROUPS){
    const part=sum.groups[g];if(!part.count)continue;
    out.push(h(doc,"h3",{class:"executive-sub",dataset:{returnGroup:g},text:`${t(`executive.return.group.${g}`)} (${part.count})`}),shownNote(ctx,part),
      h(doc,"ol",{class:"timeline","aria-label":t("executive.return.list.aria",{group:t(`executive.return.group.${g}`)})},part.items.map(r=>returnRunRow(ctx,r,titles))));
  }
  if(sum.missions.count){
    out.push(h(doc,"h3",{class:"executive-sub",dataset:{returnGroup:"missions"},text:`${t("executive.return.newMissions")} (${sum.missions.count})`}),shownNote(ctx,sum.missions),
      h(doc,"ol",{class:"timeline","aria-label":t("executive.return.newMissions.aria")},sum.missions.items.map(m=>h(doc,"li",{class:"tl-item",dataset:{returnMission:m.missionId}},
        h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
        h(doc,"time",{datetime:m.createdAt,text:formatDateTime(m.createdAt,ctx.i18n.lang)}),
        h(doc,"div",{class:"tl-body"},h(doc,"p",{class:"executive-row-head"},h(doc,"strong",{text:m.title})," ",h(doc,"span",{class:"mono",text:m.missionId})," ",statePill(ctx,"NEUTRAL",{label:m.status})))))));
  }
  if(sum.deliveries.count){
    out.push(h(doc,"h3",{class:"executive-sub",dataset:{returnGroup:"deliveries"},text:`${t("executive.return.deliveries")} (${sum.deliveries.count})`}),shownNote(ctx,sum.deliveries),
      h(doc,"p",{class:"note",dataset:{note:"source-only"},text:t("executive.return.sourceOnly")}),
      h(doc,"ol",{class:"timeline","aria-label":t("executive.return.deliveries.aria")},sum.deliveries.items.map(r=>h(doc,"li",{class:"tl-item",dataset:{returnDelivery:r.runId}},
        h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
        h(doc,"time",{datetime:r.delivery.accepted.acceptedAt,text:formatDateTime(r.delivery.accepted.acceptedAt,ctx.i18n.lang)}),
        h(doc,"div",{class:"tl-body"},h(doc,"p",{class:"executive-row-head"},h(doc,"strong",{class:"mono",text:r.runId})," ",statePill(ctx,"NOT_VERIFIED",{label:t("executive.delivery.SOURCE_ACCEPTED")})," ",commit(doc,r.delivery.accepted.sourceCommit)))))));
  }
  return out;
}
/** "Görüldü" düğmesi: istemci saatini değil sunucu filigranını yazar; yazılamazsa hiçbir şey değişmez ve durum bölgesi bunu söyler. */
function markControl(ctx,storage,sum,prevSeen,missionsOk){
  const doc=ctx.doc,t=ctx.t,watermark=sum.watermark;
  // Mission kaynağı okunamıyorsa işaretleme SUNULMAZ: görülmemiş mission'lar "görüldü" sayılamaz.
  if(!missionsOk)return h(doc,"div",{class:"executive-return-mark"},h(doc,"p",{class:"note",role:"note",dataset:{note:"mark-blocked"},text:t("executive.return.markBlocked",{source:`GET ${EXECUTIVE_SOURCE_PATHS.missions}`})}));
  const status=h(doc,"p",{class:"note",role:"status","aria-live":"polite",dataset:{returnStatus:"1"}});
  const btn=h(doc,"button",{type:"button",class:"btn",id:"executive-return-mark",dataset:{focusKey:"executive-return-mark"},disabled:watermark?undefined:true,on:{click:async()=>{
    if(!storeSeen(storage,nextSeen(prevSeen,watermark))){status.textContent=t("executive.return.saveFailed");return}
    status.textContent=t("executive.return.saved");
    await ctx.rerender();
  }}},t("executive.return.mark"));
  return h(doc,"div",{class:"executive-return-mark"},
    h(doc,"p",{class:"note",dataset:{note:"mark-hint"},text:watermark?t("executive.return.markHint",{time:formatDateTime(watermark,ctx.i18n.lang)}):t("executive.return.markNone")}),
    sum.truncated?h(doc,"p",{class:"note",dataset:{note:"mark-truncated"},text:t("executive.return.markTruncated")}):null,btn,status);
}
export function returnPanel(ctx,res){
  const doc=ctx.doc,t=ctx.t,storage=deviceStorage(ctx),seen=readSeen(storage);
  const sum=returnSummary({runs:res.workRuns,missions:res.missions},seen.seen);
  const body=[];
  if(sum.state==="OFFLINE"||sum.state==="UNAVAILABLE"||sum.state==="ERROR"){
    body.push(h(doc,"div",{class:`executive-state state-${sum.state.toLowerCase()}`,role:"status",dataset:{returnState:sum.state}},
      h(doc,"p",{class:"executive-state-head"},statePill(ctx,failKind(sum.state)),h(doc,"strong",{text:t(`executive.state.${sum.state}`)})),
      h(doc,"p",{class:"note",text:t("executive.return.unavailable",{source:`GET ${EXECUTIVE_SOURCE_PATHS.workRuns}`})})));
  }else if(seen.storage==="UNAVAILABLE"){
    body.push(h(doc,"p",{class:"note",role:"note",dataset:{returnState:"NO_STORAGE"},text:t("executive.return.noStorage")}));
  }else{
    if(seen.invalid)body.push(h(doc,"p",{class:"note",role:"note",dataset:{note:"invalid-marker"},text:t("executive.return.invalidMarker")}));
    if(sum.state==="FIRST_VISIT"){
      body.push(h(doc,"p",{class:"note",dataset:{returnState:"FIRST_VISIT"},text:t("executive.return.firstVisit")}));
    }else{
      body.push(h(doc,"p",{class:"executive-fact-body",dataset:{returnState:sum.state}},t("executive.return.since")," ",h(doc,"time",{datetime:sum.since,text:formatDateTime(sum.since,ctx.i18n.lang)})));
      if(sum.state==="PARTIAL")body.push(h(doc,"p",{class:"note",role:"note",dataset:{note:"partial"},text:t("executive.return.partial",{source:`GET ${EXECUTIVE_SOURCE_PATHS.missions}`})}));
      body.push(returnOverview(ctx,sum));
      if(sum.nothingNew)body.push(emptyNote(ctx,"executive.return.nothingNew"));
      else body.push(h(doc,"p",{class:"note",dataset:{note:"grouping"},text:t("executive.return.grouping")}),...returnDetails(ctx,sum,res));
    }
    body.push(markControl(ctx,storage,sum,seen.seen,isOk(res.missions)&&Boolean(res.missions.missions)));
  }
  return panel(ctx,{titleKey:"executive.return.title",id:"executive-return",className:"executive-section"},h(doc,"p",{class:"note",text:t("executive.return.lead")}),body);
}
