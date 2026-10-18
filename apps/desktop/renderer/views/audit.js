// //TR: Bu görünüm Denetim İzi'dir (FA-V2-PRODUCT, UI-070): YALNIZ salt-okunur ve zaten izinli GET'lerden okunur — GET /v1/runs (en yeni N koşu), GET /v1/runs/RUN-*/events (koşu başına olay günlüğü) ve GET /v1/evidence (kanıt referansları). Olaylar koşular arasında yeni-önce tek listede birleştirilir. Okunamayan/bozuk kaynak asla boş-temiz liste olarak gösterilmez (ayrık dürüst durum, kısmi okuma işareti, okunamayan sayı 0 değil "—"); "temiz/sorunsuz/doğrulanmış" iddiası yoktur, kayıt yokluğu yalnız "kayıt yok" demektir. Etiketler ctx.t ile, sunucu metinleri yalnız textContent ile yazılır; yazma, POST veya eylem yoktur.
import {h,panel,statePill,kpiTile,stateNote} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {AUDIT_SOURCES,AUDIT_SOURCE_PATHS,AUDIT_RUN_LIMIT,buildAudit} from "../audit-core.js";

const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const timeEl=(ctx,iso)=>iso?h(ctx.doc,"time",{datetime:iso,text:formatDateTime(iso,ctx.i18n.lang)}):h(ctx.doc,"span",{text:MISSING});

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("audit.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.audit.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.audit.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("audit.readonly",{n:AUDIT_RUN_LIMIT})}),
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("audit.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak ile dürüst açıklama. */
function stateBlock(ctx,state,source,message){
  const doc=ctx.doc,st=failState(state);
  return h(doc,"div",{class:`audit-state state-${st.toLowerCase()}`,role:"status",dataset:{auditState:st,source}},
    h(doc,"p",{class:"audit-state-head"},statePill(ctx,failKind(st)),h(doc,"strong",{text:ctx.t(`audit.state.${st}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`audit.hint.${st}`,{source:`GET ${AUDIT_SOURCE_PATHS[source]}`})}),
    message?h(doc,"p",{class:"note mono",text:message}):null);
}

function sourcesPanel(ctx,res,a){
  const doc=ctx.doc;
  const list=h(doc,"ul",{class:"company-sources audit-sources","aria-label":ctx.t("audit.sources.aria")},AUDIT_SOURCES.map(k=>{
    const st=a.sources[k].state;
    const pill=st==="VERIFIED"?statePill(ctx,"VERIFIED",{label:ctx.t("audit.src.ok")})
      :st==="PARTIAL"?statePill(ctx,"STALE",{label:ctx.t("audit.src.partial")})
      :st==="UNAVAILABLE"&&k==="events"&&a.runs===null?statePill(ctx,"NOT_EXECUTED",{label:ctx.t("audit.src.notRead")})
      :statePill(ctx,failKind(st));
    return h(doc,"li",{dataset:{source:k,sourceState:st}},h(doc,"span",{class:"company-src-name",text:ctx.t(`audit.src.${k}`)}),pill);
  }));
  const blocks=[];
  if(a.runs===null)blocks.push(stateBlock(ctx,a.sources.runs.state,"runs",res.runs?.message));
  if(a.eventsRead)for(const f of a.eventsRead.failed)blocks.push(stateBlock(ctx,f.state,"events",null));
  if(a.evidence===null)blocks.push(stateBlock(ctx,a.sources.evidence.state,"evidence",res.evidence?.message));
  const failedIds=a.eventsRead?a.eventsRead.failed.map(f=>f.runId):[];
  return panel(ctx,{titleKey:"audit.sources.title",id:"audit-sources",className:"audit-section"},
    h(doc,"p",{class:"note",text:ctx.t("audit.sources.lead")}),list,blocks,
    a.unreadable.length?h(doc,"p",{class:"note",role:"status",dataset:{auditPartial:a.unreadable.join(",")},text:ctx.t("audit.partial",{sources:a.unreadable.map(k=>ctx.t(`audit.srcShort.${k}`)).join(", ")})}):null,
    failedIds.length?h(doc,"p",{class:"note mono",dataset:{auditFailedRuns:failedIds.join(",")},text:failedIds.join(", ")}):null);
}

function kpiRow(ctx,a){
  const doc=ctx.doc,t=ctx.t;
  const runsOk=a.runs!==null,evOk=a.evidence!==null;
  const tile=(id,iconName,value,src,state)=>kpiTile(ctx,{id:`audit-${id}`,iconName,labelKey:`audit.kpi.${id}`,block:{state:state?"VERIFIED":"UNAVAILABLE",value:state?value:null,loading:false,source:src,asOf:null},qualifier:t(`audit.kpi.q.${id}`),pillKind:state?undefined:"UNAVAILABLE"});
  return h(doc,"div",{class:"kpi-row audit-kpis",role:"group","aria-label":t("audit.kpi.group")},
    tile("runs","tasks",runsOk?a.runs.read:null,`GET ${AUDIT_SOURCE_PATHS.runs}`,runsOk),
    tile("events","pulse",a.events?a.events.length:null,`GET ${AUDIT_SOURCE_PATHS.events}`,a.events!==null&&a.eventsRead.failed.length===0),
    tile("evidence","folder",evOk?a.evidence.items.length:null,`GET ${AUDIT_SOURCE_PATHS.evidence}`,evOk));
}

function eventsPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t;
  let body;
  if(a.events===null)body=stateNote(ctx,"UNAVAILABLE","audit.events.withheld");
  else{
    const er=a.eventsRead;
    const notes=[];
    if(a.runs.total>er.runsSelected)notes.push(h(doc,"p",{class:"note",dataset:{note:"older-runs"},text:t("audit.events.older",{read:er.runsSelected,total:a.runs.total})}));
    if(er.truncatedRuns>0)notes.push(h(doc,"p",{class:"note",dataset:{note:"truncated"},text:t("audit.events.truncated",{n:er.truncatedRuns})}));
    if(er.failed.length>0)notes.push(h(doc,"p",{class:"note",role:"status",dataset:{note:"incomplete"},text:t("audit.events.incomplete",{failed:er.failed.length,total:er.runsSelected})}));
    if(!a.events.length){
      // Boş liste yalnız kayıt yokluğudur; okunamayan koşu varsa "kayıt yok" bile söylenmez.
      body=[...notes,er.failed.length===0?h(doc,"p",{class:"note",role:"status",dataset:{auditEmpty:"events"},text:t(a.runs.total===0?"audit.events.noRuns":"audit.events.none")}):null];
    }else body=[...notes,h(doc,"ol",{class:"audit-list","aria-label":t("audit.events.aria")},a.events.map(e=>
      h(doc,"li",{class:"audit-row",dataset:{auditEvent:"1",runId:e.runId,severity:e.severity}},
        timeEl(ctx,e.timestamp),
        h(doc,"span",{class:"badge audit-sev",text:e.severity}),
        h(doc,"span",{class:"mono audit-run",text:e.runId}),
        h(doc,"span",{class:"mono audit-label",dataset:{verbatim:"1"},text:`${e.stage??MISSING}/${e.event??MISSING}`}))))];
  }
  return panel(ctx,{titleKey:"audit.events.title",id:"audit-events",className:"audit-section"},h(doc,"p",{class:"note",text:t("audit.events.lead")}),body);
}

function evidencePanel(ctx,a){
  const doc=ctx.doc,t=ctx.t;
  let body;
  if(a.evidence===null)body=stateNote(ctx,"UNAVAILABLE","audit.evidence.withheld");
  else{
    const ev=a.evidence,notes=[];
    if(ev.skipped>0)notes.push(h(doc,"p",{class:"note",role:"status",dataset:{note:"skipped",n:String(ev.skipped)},text:t("audit.evidence.skipped",{n:ev.skipped})}));
    if(ev.more)notes.push(h(doc,"p",{class:"note",dataset:{note:"more"},text:t("audit.evidence.more")}));
    body=ev.items.length
      ?[...notes,h(doc,"ul",{class:"audit-list","aria-label":t("audit.evidence.aria")},ev.items.map(e=>
        h(doc,"li",{class:"audit-row",dataset:{auditEvidence:e.evidenceId,verification:e.verification??"NONE"}},
          timeEl(ctx,e.createdAt),
          h(doc,"span",{class:"badge audit-sev",text:e.verification??MISSING}),
          h(doc,"span",{class:"mono audit-run",text:e.kind??MISSING}),
          h(doc,"span",{class:"mono audit-label",dataset:{verbatim:"1"},text:e.evidenceId}),
          e.runId?h(doc,"span",{class:"mono audit-run",text:e.runId}):null)))]
      :[...notes,ev.skipped===0?h(doc,"p",{class:"note",role:"status",dataset:{auditEmpty:"evidence"},text:t("audit.evidence.none")}):null];
  }
  return panel(ctx,{titleKey:"audit.evidence.title",id:"audit-evidence",className:"audit-section"},h(doc,"p",{class:"note",text:t("audit.evidence.lead")}),body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [runs,evidence]=await Promise.all([read(()=>api.auditRuns(),{runs:null}),read(()=>api.auditEvidence(),{evidence:null})]);
  const events={};
  if(runs.state==="VERIFIED"&&runs.runs){
    const ids=runs.runs.ids;
    const rs=await Promise.all(ids.map(id=>read(()=>api.auditRunEvents(id),{events:null})));
    ids.forEach((id,i)=>{events[id]=rs[i]});
  }
  const res={runs,events,evidence};
  const a=buildAudit(res);
  return h(doc,"div",{class:"view view-audit"},header(ctx),sourcesPanel(ctx,res,a),kpiRow(ctx,a),eventsPanel(ctx,a),evidencePanel(ctx,a));
}
