// //TR: Bu görünüm Derleme Zamanlayıcı'dır (FA-V2-PRODUCT, UI-BUILD-SCHEDULER): YALNIZ salt-okunur ve zaten izinli GET /v1/scheduler'dan okunur. Sunucunun doğrulama durumu (VERIFIED/PENDING/REJECTED) AYNEN gösterilir; yalnız VERIFIED ise faz satırları listelenir, aksi halde faz/sayı/ilerleme uydurulmaz. COMPLETED bir fazın kaydıdır, ürün doğrulaması ya da teslim değildir. Yeniden deneme, engel kaldırma, düğme veya POST yoktur (eylemler Operasyon ve Kurtarma/kabuk yolunda kalır). Okunamayan kaynağın sayısı 0 değil "—" olur; etiketler ctx.t ile, sunucu metinleri yalnız textContent ile yazılır.
import {h,panel,statePill,badge} from "../components.js";
import {MISSING,formatCount} from "../model.js";
import {SCHEDULER_PATH,buildScheduler} from "../scheduler-core.js";

const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":state==="PENDING"?"PENDING":"FAILED";

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("scheduler.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.scheduler.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.scheduler.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("scheduler.readonly")}),
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("scheduler.honesty")}));
}
function stateBlock(ctx,a,message){
  const doc=ctx.doc,st=a.state;
  return h(doc,"div",{class:`integ-state state-${st.toLowerCase()}`,role:"status",dataset:{schedState:st}},
    h(doc,"p",{class:"integ-state-head"},statePill(ctx,failKind(st)),h(doc,"strong",{text:ctx.t(`scheduler.state.${st}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`scheduler.hint.${st}`,{source:`GET ${SCHEDULER_PATH}`})}),
    a.pendingStatus?h(doc,"p",{class:"note mono",dataset:{schedStatus:a.pendingStatus},text:a.pendingStatus}):null,
    message?h(doc,"p",{class:"note mono",text:message}):null);
}
function kpi(ctx,key,n,state){
  const doc=ctx.doc;
  return h(doc,"article",{class:`kpi kpi-${n===null?"na":"ok"}`,dataset:{schedCount:key,state}},
    h(doc,"h3",{class:"kpi-label",text:ctx.t(`scheduler.kpi.${key}`)}),
    h(doc,"p",{class:"kpi-value",text:n===null?MISSING:formatCount(n)}),
    h(doc,"p",{class:"kpi-qual",text:ctx.t(`scheduler.kpi.q.${key}`)}),
    h(doc,"p",{class:"kpi-src",text:`GET ${SCHEDULER_PATH}`}));
}
function countsPanel(ctx,a){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"scheduler.counts.title",id:"sched-counts",className:"integ-section"},
    h(doc,"p",{class:"note",text:ctx.t("scheduler.counts.lead")}),
    h(doc,"div",{class:"kpi-row",role:"group","aria-label":ctx.t("scheduler.counts.group")},
      ["total","completed","active","blocked"].map(k=>kpi(ctx,k,a[k==="total"?"total":k==="completed"?"completed":k==="active"?"activeCount":"blockedCount"],a.state))));
}
function fact(ctx,label,value){
  const doc=ctx.doc;
  return h(doc,"span",{class:"integ-fact"},h(doc,"span",{class:"integ-fact-label",text:ctx.t(label)+" "}),value);
}
function row(ctx,p){
  const doc=ctx.doc,mono=t=>h(doc,"span",{class:"mono",text:t});
  return h(doc,"li",{class:"card integ-row",dataset:{schedPhase:String(p.phase),status:p.status}},
    h(doc,"h4",{class:"mono",text:ctx.t("scheduler.phase",{n:p.phase})}),
    h(doc,"p",{class:"integ-facts"},
      fact(ctx,"scheduler.field.status",badge(ctx,p.status,"mono")),
      fact(ctx,"scheduler.field.attempts",mono(String(p.attempts))),
      p.lastRunId?fact(ctx,"scheduler.field.lastRun",mono(p.lastRunId)):null,
      p.completedCommit?fact(ctx,"scheduler.field.commit",mono(p.completedCommit)):null,
      p.retryAt?fact(ctx,"scheduler.field.retryAt",mono(p.retryAt)):null,
      p.evidenceRefs.length?fact(ctx,"scheduler.field.evidence",mono(String(p.evidenceRefs.length))):null),
    p.lastFailure?h(doc,"p",{class:"note",dataset:{field:"lastFailure"},text:`${ctx.t("scheduler.field.failure")} ${p.lastFailure}`}):null);
}
function listPanel(ctx,a,message){
  const doc=ctx.doc,s=a.scheduler;
  let body;
  if(s===null)body=[stateBlock(ctx,a,message),h(doc,"p",{class:`note note-${a.state.toLowerCase()}`,role:"status",dataset:{schedWithheld:"1"},text:ctx.t("scheduler.withheld")})];
  else if(!s.phases.length)body=h(doc,"p",{class:"note",role:"status",dataset:{schedEmpty:"1"},text:ctx.t("scheduler.none")});
  else body=[h(doc,"p",{class:"note integ-tally",dataset:{tally:"status"}},h(doc,"span",{text:ctx.t("scheduler.tally")+" "}),
      s.byStatus.map(e=>h(doc,"span",{class:"badge mono",dataset:{value:e.value,n:String(e.count)},text:`${e.value} × ${e.count}`}))),
    s.updatedAt?h(doc,"p",{class:"note mono",dataset:{schedUpdated:s.updatedAt},text:`${ctx.t("scheduler.updated")} ${s.updatedAt}`}):null,
    h(doc,"ul",{class:"cards integ-list","aria-label":ctx.t("scheduler.aria")},s.phases.map(p=>row(ctx,p)))];
  return panel(ctx,{titleKey:"scheduler.list.title",id:"sched-list",className:"integ-section"},h(doc,"p",{class:"note",text:ctx.t("scheduler.list.lead")}),body);
}
export async function render(ctx){
  const doc=ctx.doc;
  let res;
  try{res=await ctx.api.scheduler()}catch{res={state:"ERROR",scheduler:null}}
  if(!res||typeof res.state!=="string")res={state:"UNAVAILABLE",scheduler:null};
  const a=buildScheduler(res);
  return h(doc,"div",{class:"view view-scheduler"},header(ctx),countsPanel(ctx,a),listPanel(ctx,a,res.message));
}
