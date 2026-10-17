// //TR: Bu görünüm Operasyon ve Kurtarma runbook'udur (FA-V2-PRODUCT, UI-071): YALNIZ üç salt-okunur ve zaten izinli GET'ten okunur — GET /v1/control/status (global stop ve Work OS günlük sağlığı), GET /v1/runs (supervisor koşuları) ve GET /v1/founder-attention (engelli paketler, yeniden deneme kaydı, checkpoint). Koşu ve kuyruk sağlığı, kurtarma gerektiren engelli paketler ve GERÇEK duruma yansıyan bir kurtarma kontrol listesi gösterilir; "takıldı" yalnız kayıtlı zaman damgasından ve açıkça belirtilen görüntü eşiklerinden türer. Genel durum DÜRÜSTTÜR: NO_ISSUES_RECORDED yalnız üç kaynak okunup doğrulandığında, global stop aktif değilken, günlük OK ve zamanlayıcı doğrulanmışken, en az bir koşu kayıtlıyken ve kayıtlı hiçbir sorun yokken görünür; okunamayan ya da doğrulanmamış kaynak asla "sağlıklı" görünmez ve eksik olan adıyla listelenir. Mevcut Stop/Resume/Retry denetimleri BURADA yeniden uygulanmaz ve tetiklenmez: yalnız dürüst durumları gösterilir ve eylemlerin yaşadığı mevcut ekranlara (Control Tower, Gelen Kutusu) gezinme sunulur; eylemler kabuk/IPC üzerinden bugünkü gibi çalışır. HİÇBİR sayı, durum veya geçiş UYDURULMAZ: bozuk yanıt tümden ERROR gösterilir, okunamayan kaynağın sayıları 0 değil "—" olur. Ürün doğrulaması bu görünümde ASLA iddia edilmez ve ilgili sabit değer hiçbir yerde üretilmez. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {OPS_SOURCES,OPS_SOURCE_PATHS,LIVENESS,MAX_OPS_ROWS,RUN_STALL_AFTER_MS,RETRY_OVERDUE_AFTER_MS,CHECKPOINT_STALE_AFTER_MS,SERVER_RUNS_CAP,buildOperations,waitParts} from "../operations-core.js";

/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t!==null&&t!==undefined&&t!==""?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
const dash=v=>v===null||v===undefined||v===""?MISSING:String(v);
/** Önem düzeyi -> rozet türü (renk tek başına anlam taşımaz; her rozet metin taşır). */
const SEVERITY_PILL=Object.freeze({ACTION:"ATTENTION",UNVERIFIED:"NOT_VERIFIED",WATCH:"WAITING"});
const TIER_PILL=Object.freeze({ATTENTION_NEEDED:"ATTENTION",UNVERIFIED:"NOT_VERIFIED",WATCH:"WAITING",NO_ISSUES_RECORDED:"DONE"});
const GROUP_PILL=Object.freeze({ATTENTION:"ATTENTION",WAITING:"WAITING",STOPPED:"STOPPED",FINISHED:"DONE",RUNNING:"ACTIVE",OTHER:"NEUTRAL",UNKNOWN:"NEUTRAL"});
const LIVE_PILL=Object.freeze({IN_PROGRESS:"ACTIVE",STALLED:"ATTENTION",UNDETERMINED:"NOT_VERIFIED"});
const JOURNAL_PILL=Object.freeze({OK:"VERIFIED",ABSENT:"NOT_VERIFIED",TORN_TAIL:"ATTENTION",TAMPERED:"ATTENTION",UNAVAILABLE:"ATTENTION"});

/** Süreyi yerelleştirir (gün/saat/dakika); geçersiz/yok için "—" (süre uydurulmaz). */
function dur(ctx,ms){
  const p=waitParts(ms);if(p===null)return MISSING;
  if(p.d>0)return ctx.t("queue.wait.dh",{d:p.d,h:p.h});
  if(p.h>0)return ctx.t("queue.wait.hm",{h:p.h,m:p.m});
  if(p.m>0)return ctx.t("queue.wait.m",{m:p.m});
  return ctx.t("queue.wait.lt1m");
}
const when=(ctx,iso)=>typeof iso==="string"&&iso?formatDateTime(iso,ctx.i18n.lang):MISSING;
const timeEl=(ctx,iso)=>iso?h(ctx.doc,"time",{datetime:iso,text:when(ctx,iso)}):MISSING;

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("ops.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.operations.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.operations.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("ops.readonly")}),
    // Dürüstlük uyarısı: durum yalnız kayıtlı kanıttan türer, ürün doğrulaması değildir.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("ops.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. Reddedilen zamanlayıcı durumu ayrı ve olumsuz kayıttır. */
function stateBlock(ctx,res,source,rejected){
  const doc=ctx.doc,state=rejected?"REJECTED":failState(res.state);
  return h(doc,"div",{class:`ops-state state-${state.toLowerCase()}`,role:"status",dataset:{opsState:state,source}},
    h(doc,"p",{class:"ops-state-head"},statePill(ctx,rejected?"BLOCKED":failKind(state)),h(doc,"strong",{text:ctx.t(`ops.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`ops.hint.${state}`,{source:`GET ${OPS_SOURCE_PATHS[source]}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}
/** Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). */
function sourcesList(ctx,a){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources ops-sources","aria-label":ctx.t("ops.sources.aria")},OPS_SOURCES.map(k=>{
    const st=a.sources[k].state,ok=st==="VERIFIED",kind=ok?"VERIFIED":failKind(st);
    return h(doc,"li",{dataset:{source:k,sourceState:st}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`ops.src.${k}`)}),
      statePill(ctx,kind,{label:ok?ctx.t("ops.src.ok"):undefined}));
  }));
}

// ---------- (A) Özet ----------
function overallBlock(ctx,a){
  const doc=ctx.doc,kind=a.tier==="UNKNOWN"?failKind(a.unknownState):TIER_PILL[a.tier];
  return h(doc,"p",{class:"ops-overall panel-meta",dataset:{overall:a.tier}},
    statePill(ctx,kind,{label:ctx.t(`ops.tier.${a.tier}`)}),
    h(doc,"span",{class:"note",text:ctx.t(`ops.tierDesc.${a.tier}`)}));
}
function kpiRow(ctx,a){
  const doc=ctx.doc,src=a.sources;
  // Her sayı yalnız KENDİ kaynağı okunduysa gösterilir; aksi halde değer null ("—") ve rozet dürüst durumdur (asla 0).
  const tile=(id,iconName,block,extra={})=>kpiTile(ctx,{id:`ops-${id}`,iconName,labelKey:`ops.kpi.${id}`,block,qualifier:ctx.t(`ops.kpi.q.${id}`),...extra});
  const blockOf=(source,value)=>({state:src[source].state,value:src[source].state==="VERIFIED"?value:null,loading:false,source:`GET ${OPS_SOURCE_PATHS[source]}`,asOf:null});
  const R=a.runs,Q=a.queue;
  const stalledPill=R===null?{}:R.stalled>0?{pillKind:"ATTENTION",risk:true}:R.undetermined>0?{pillKind:"NOT_VERIFIED"}:{};
  const blockedPill=Q===null?{}:Q.total>0?{pillKind:"ATTENTION",risk:true}:Q.schedulerVerification!=="VERIFIED"?{pillKind:"NOT_VERIFIED"}:{};
  return h(doc,"div",{class:"kpi-row ops-kpis",role:"group","aria-label":ctx.t("ops.kpi.group")},
    tile("runs","tasks",blockOf("runs",R?R.total:null)),
    tile("inProgress","pulse",blockOf("runs",R?R.inProgress:null)),
    tile("stalled","clock",blockOf("runs",R?R.stalled:null),stalledPill),
    tile("blocked","alert",blockOf("attention",Q?Q.total:null),blockedPill),
    tile("retryable","route",blockOf("attention",Q?Q.retryable:null)));
}
function summaryPanel(ctx,res,a){
  const doc=ctx.doc;
  // Durum, eşleyici çıktısının KULLANILABİLİRLİĞİNE göre (a.sources) belirlenir: VERIFIED ama gövdesi eksik bir okuma ERROR gösterilir.
  const failures=OPS_SOURCES.filter(k=>a.sources[k].state!=="VERIFIED").map(k=>stateBlock(ctx,{state:a.sources[k].state,message:res[k]?.message},k,k==="attention"&&a.schedulerRejected));
  const c=a.counts;
  return panel(ctx,{titleKey:"ops.summary.title",id:"ops-summary",className:"ops-section"},
    h(doc,"p",{class:"note",text:ctx.t("ops.summary.lead")}),
    h(doc,"h3",{class:"ops-sub",text:ctx.t("ops.sources.title")}),
    sourcesList(ctx,a),
    failures,
    a.unreadable.length?h(doc,"p",{class:"note",role:"status",dataset:{opsPartial:a.unreadable.join(",")},text:ctx.t("ops.partial",{sources:a.unreadable.map(k=>ctx.t(`ops.srcShort.${k}`)).join(", ")})}):null,
    h(doc,"h3",{class:"ops-sub",text:ctx.t("ops.overall.title")}),
    overallBlock(ctx,a),
    h(doc,"p",{class:"note",dataset:{note:"step-counts"},text:ctx.t("ops.counts",{action:c.ACTION,unknown:c.UNKNOWN,unverified:c.UNVERIFIED,watch:c.WATCH})}),
    h(doc,"p",{class:"note",dataset:{note:"not-product-verification"},text:ctx.t("ops.notProduct")}),
    h(doc,"h3",{class:"ops-sub",text:ctx.t("ops.kpi.title")}),
    kpiRow(ctx,a));
}

// ---------- (B) Kurtarma kontrol listesi ----------
/** Adımın başlık/ayrıntı metinleri: tüm yer tutucular tek kümeden verilir (kullanılmayan yer tutucu yok sayılır); süre/zaman yoksa "—". */
function stepVars(ctx,s){
  const p=s.params,t=ctx.t;
  const target=p.packageId!==null&&p.packageId!==undefined?p.packageId:p.phase!==null&&p.phase!==undefined?t("ops.step.phase",{n:p.phase}):MISSING;
  return {reason:dash(p.reason),actor:dash(p.actor),duration:dur(ctx,p.activeForMs),kind:dash(p.kind),target,since:dur(ctx,p.waitMs),runId:dash(p.runId),status:dash(p.status),packageId:dash(p.packageId),
    retryAt:when(ctx,p.retryAt),overdue:dur(ctx,p.overdueMs),remaining:dur(ctx,p.remainingMs),generation:dash(p.generation),age:dur(ctx,p.ageMs),startedAt:when(ctx,p.startedAt),finishedAt:when(ctx,p.finishedAt),
    threshold:dur(ctx,RUN_STALL_AFTER_MS),grace:dur(ctx,RETRY_OVERDUE_AFTER_MS),checkpointThreshold:dur(ctx,CHECKPOINT_STALE_AFTER_MS),
    source:p.source?t(`ops.srcShort.${p.source}`):MISSING,state:p.state?t(`ops.state.${p.state}`):MISSING,verification:dash(p.verification),error:dash(p.error)};
}
/** Adımın hangi MEVCUT denetimle ilgili olduğu (yeniden uygulanmaz): resume/retry denetimi ya da yeniden denemenin neden yapılamadığı. */
function stepWhere(ctx,s){
  if(s.control==="resume")return ctx.t("ops.step.where.resume");
  if(s.control==="retry")return ctx.t("ops.step.where.retry");
  if(s.id==="BLOCKED_PACKAGE"){
    const r=s.params.retryable;
    return ctx.t(r===false?"ops.step.where.founder":r===true?"ops.step.where.noId":"ops.step.where.unknown");
  }
  return null;
}
function stepCard(ctx,a,s,idx){
  const doc=ctx.doc,vars=stepVars(ctx,s),where=stepWhere(ctx,s);
  const kind=s.severity==="UNKNOWN"?failKind(a.sources[s.source]?.state):SEVERITY_PILL[s.severity];
  return h(doc,"li",{class:"card ops-step",dataset:{step:s.id,stepSeverity:s.severity,stepKey:s.key,stepSource:s.source,stepControl:s.control??"",stepIndex:String(idx)}},
    h(doc,"h3",{text:ctx.t(`ops.step.${s.id}.title`,vars)}),
    h(doc,"p",{class:"ops-step-head panel-meta"},statePill(ctx,kind,{label:ctx.t(`ops.severity.${s.severity}`)})),
    h(doc,"p",{class:"note",dataset:{field:"detail"},text:ctx.t(`ops.step.${s.id}.detail`,vars)}),
    where?h(doc,"p",{class:"note",dataset:{field:"where"},text:where}):null);
}
function recoveryPanel(ctx,a){
  const doc=ctx.doc;
  const shown=a.steps.slice(0,MAX_OPS_ROWS);
  let body;
  if(!a.steps.length)body=h(doc,"p",{class:"note",role:"status",dataset:{opsEmpty:"clear"},text:ctx.t("ops.recovery.none")});
  else body=[shown.length<a.steps.length?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:ctx.t("ops.recovery.truncated",{shown:shown.length,total:a.steps.length})}):null,
    h(doc,"ol",{class:"cards ops-list ops-steps","aria-label":ctx.t("ops.recovery.aria"),dataset:{opsSteps:String(shown.length)}},shown.map((s,i)=>stepCard(ctx,a,s,i)))];
  return panel(ctx,{titleKey:"ops.recovery.title",id:"ops-recovery",className:"ops-section"},
    h(doc,"p",{class:"note",text:ctx.t("ops.recovery.lead")}),
    body);
}

// ---------- (C) Mevcut denetimler (salt-okunur) ----------
/** Bir denetimin dürüst durumu: {kind,text,state}. Hiçbir denetim burada tetiklenmez; durum yalnız gerçek okumalardan. */
function controlStates(ctx,a){
  const t=ctx.t,C=a.control,Q=a.queue,src=a.sources;
  const unreadable=source=>({kind:failKind(src[source].state),state:failState(src[source].state),text:t("ops.control.state.unknown",{source:t(`ops.srcShort.${source}`)})});
  const stop=C===null?unreadable("control"):C.active
    ?{kind:"STOPPED",state:"active",text:t("ops.control.state.stop.active")}
    :{kind:"VERIFIED",state:"inactive",text:t("ops.control.state.stop.inactive")};
  const resume=C===null?unreadable("control"):C.active
    ?{kind:"ACTIVE",state:"relevant",text:t("ops.control.state.resume.relevant")}
    :{kind:"NEUTRAL",state:"notNeeded",text:t("ops.control.state.resume.notNeeded")};
  let retry;
  if(Q===null)retry=a.schedulerRejected?{kind:"BLOCKED",state:"rejected",text:t("ops.control.state.retry.rejected")}:unreadable("attention");
  else if(Q.total===0)retry=Q.schedulerVerification==="VERIFIED"?{kind:"NEUTRAL",state:"none",text:t("ops.control.state.retry.none")}:{kind:"NOT_VERIFIED",state:"unverified",text:t("ops.control.state.retry.unverified")};
  else if(Q.retryable>0)retry=Q.retryUsable>0?{kind:"ATTENTION",state:"some",text:t("ops.control.state.retry.some",{n:Q.retryable,total:Q.total})}:{kind:"ATTENTION",state:"someNoId",text:t("ops.control.state.retry.someNoId",{n:Q.retryable,total:Q.total})};
  else retry={kind:"ATTENTION",state:"zero",text:t("ops.control.state.retry.zero",{total:Q.total})};
  return {stop,resume,retry};
}
function controlsPanel(ctx,a){
  const doc=ctx.doc,st=controlStates(ctx,a);
  const row=(id,s)=>h(doc,"li",{class:"card ops-control",dataset:{control:id,controlState:s.state}},
    h(doc,"h3",{text:ctx.t(`ops.control.${id}.title`)}),
    h(doc,"p",{class:"ops-control-head panel-meta"},statePill(ctx,s.kind),h(doc,"span",{text:s.text})),
    h(doc,"p",{class:"note",dataset:{field:"where"},text:ctx.t(`ops.control.where.${id}`)}));
  const btn=(route,key)=>h(doc,"button",{type:"button",class:"btn",id:`ops-open-${route}`,dataset:{focusKey:`ops-open-${route}`,navigate:route},on:{click:()=>ctx.navigate(route)},text:ctx.t(key)});
  return panel(ctx,{titleKey:"ops.controls.title",id:"ops-controls",className:"ops-section"},
    h(doc,"p",{class:"note",text:ctx.t("ops.controls.lead")}),
    h(doc,"ul",{class:"cards ops-list ops-controls-list","aria-label":ctx.t("ops.controls.aria")},row("stop",st.stop),row("resume",st.resume),row("retry",st.retry)),
    h(doc,"p",{class:"note",dataset:{note:"controls-defer"},text:ctx.t("ops.controls.hint")}),
    h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("ops.controls.actions.aria")},btn("tower","ops.control.action.tower"),btn("inbox","ops.control.action.inbox")));
}

// ---------- (D) Kontrol düzlemi ve kuyruk ----------
function factRows(ctx,rows){
  const doc=ctx.doc;
  return h(doc,"dl",{class:"ops-facts"},rows.flatMap(([key,label,attrs,...dd])=>[h(doc,"dt",{text:label}),h(doc,"dd",{dataset:{field:key,...attrs}},...dd)]));
}
function withheld(ctx,source,reason){
  return h(ctx.doc,"p",{class:"note",role:"status",dataset:{withheld:"1",reason,source},text:ctx.t("ops.withheld",{source:`GET ${OPS_SOURCE_PATHS[source]}`,reason:ctx.t(`ops.reason.${reason}`)})});
}
function controlFacts(ctx,a){
  const doc=ctx.doc,t=ctx.t,C=a.control;
  if(C===null)return withheld(ctx,"control",failState(a.sources.control.state));
  const rows=[];
  rows.push(["stop",t("ops.field.stop"),{value:C.active?(C.failClosed?"failClosed":"active"):"inactive"},statePill(ctx,C.active?"STOPPED":"VERIFIED",{label:C.active?t(C.failClosed?"ops.stop.failClosed":"ops.stop.active"):t("ops.stop.inactive")})]);
  if(C.active){
    rows.push(["reason",t("ops.field.reason"),{},mono(doc,C.reason)]);
    rows.push(["actor",t("ops.field.actor"),{},mono(doc,C.actor)]);
    rows.push(["since",t("ops.field.since"),{},dur(ctx,C.activeForMs),C.activatedAt?[" · ",timeEl(ctx,C.activatedAt)]:null]);
  }
  if(C.verification!==null)rows.push(["verification",t("ops.field.verification"),{value:C.verification},mono(doc,C.verification)]);
  const j=C.journal;
  rows.push(["journal",t("ops.field.journal"),{value:j?j.state:"NOT_REPORTED"},
    j?statePill(ctx,JOURNAL_PILL[j.state],{label:t(`ops.journal.${j.state}`)}):statePill(ctx,"NOT_VERIFIED",{label:t("ops.journal.NOT_REPORTED")}),
    j&&j.reason?[" ",mono(doc,j.reason)]:null]);
  return factRows(ctx,rows);
}
function retryFact(ctx,r){
  const doc=ctx.doc;
  if(r===null)return [["retry",ctx.t("ops.field.retry"),{value:"none"},ctx.t("ops.retry.none")]];
  const kind=r.phase==="OVERDUE"?"ATTENTION":r.phase==="UNDETERMINED"?"NOT_VERIFIED":"WAITING";
  return [["retry",ctx.t("ops.field.retry"),{value:r.phase,packageId:r.packageId??""},statePill(ctx,kind,{label:ctx.t(`ops.retry.phase.${r.phase}`)})," ",mono(doc,r.packageId)," · ",timeEl(ctx,r.retryAt),
    r.reason?[" · ",r.reason]:null]];
}
function queueFacts(ctx,a){
  const doc=ctx.doc,t=ctx.t,Q=a.queue;
  if(Q===null)return a.schedulerRejected
    ?h(doc,"p",{class:"note",role:"status",dataset:{withheld:"1",reason:"REJECTED",source:"attention"},text:t("ops.withheld.rejected",{source:`GET ${OPS_SOURCE_PATHS.attention}`})})
    :withheld(ctx,"attention",failState(a.sources.attention.state));
  const sv=Q.schedulerVerification;
  const rows=[["scheduler",t("ops.field.scheduler"),{value:sv??"NOT_REPORTED"},
    statePill(ctx,sv==="VERIFIED"?"VERIFIED":"NOT_VERIFIED",{label:sv?t(sv==="VERIFIED"?"ops.scheduler.VERIFIED":"ops.scheduler.OTHER"):t("ops.scheduler.NOT_REPORTED")}),sv&&sv!=="VERIFIED"?[" ",mono(doc,sv)]:null],
    ...retryFact(ctx,Q.retry),
    ["checkpoint",t("ops.field.checkpoint"),{value:Q.checkpoint?(Q.checkpoint.stale?"stale":"present"):"none"},
      Q.checkpoint?[t("ops.checkpoint.present",{generation:Q.checkpoint.generation,age:dur(ctx,Q.checkpoint.ageMs)})," · ",timeEl(ctx,Q.checkpoint.updatedAt)]:t("ops.checkpoint.none")]];
  return factRows(ctx,rows);
}
function blockedList(ctx,a){
  const doc=ctx.doc,t=ctx.t,Q=a.queue;
  if(Q===null)return h(doc,"p",{class:"note",role:"status",dataset:{opsEmpty:"unknown"},text:t("ops.blocked.unknown")});
  if(!Q.items.length)return h(doc,"p",{class:"note",role:"status",dataset:{opsEmpty:Q.schedulerVerification==="VERIFIED"?"1":"unverified"},text:t(Q.schedulerVerification==="VERIFIED"?"ops.blocked.none":"ops.blocked.noneUnverified")});
  const shown=Q.items.slice(0,MAX_OPS_ROWS);
  return [shown.length<Q.items.length?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:t("ops.blocked.truncated",{shown:shown.length,total:Q.items.length})}):null,
    h(doc,"ul",{class:"cards ops-list ops-blocked","aria-label":t("ops.blocked.aria"),dataset:{opsBlocked:String(shown.length)}},shown.map(x=>{
      const key=`${x.packageId??""}|${x.phase??""}`;
      const rt=x.retryable===true?"yes":x.retryable===false?"no":"unknown";
      return h(doc,"li",{class:"card ops-item",dataset:{opsBlockedItem:key,retryable:rt}},
        h(doc,"h3",{text:x.packageId??t("ops.step.phase",{n:x.phase})}),
        factRows(ctx,[
          ["package",t("ops.field.package"),{},mono(doc,x.packageId)],
          ["phase",t("ops.field.phase"),{},mono(doc,x.phase)],
          ["kind",t("ops.field.kind"),{},mono(doc,x.kind)],
          ["blockedAt",t("ops.field.blockedAt"),{},timeEl(ctx,x.at)," · ",dur(ctx,x.waitMs)],
          ["reason",t("ops.field.reason"),{},x.reason??MISSING],
          ["retryable",t("ops.field.retryable"),{value:rt},t(`ops.retryable.${rt}`)]]));
    }))];
}
function planePanel(ctx,a){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"ops.plane.title",id:"ops-plane",className:"ops-section"},
    h(doc,"p",{class:"note",text:ctx.t("ops.plane.lead")}),
    h(doc,"h3",{class:"ops-sub",text:ctx.t("ops.plane.control")}),
    controlFacts(ctx,a),
    h(doc,"h3",{class:"ops-sub",text:ctx.t("ops.plane.queue")}),
    queueFacts(ctx,a),
    h(doc,"h3",{class:"ops-sub",text:ctx.t("ops.blocked.title")}),
    blockedList(ctx,a));
}

// ---------- (E) Koşular ----------
function runPill(ctx,r){
  return r.liveness==="FINISHED"?statePill(ctx,GROUP_PILL[r.group],{label:ctx.t(`ops.group.${r.group}`)}):statePill(ctx,LIVE_PILL[r.liveness],{label:ctx.t(`ops.live.${r.liveness}`)});
}
function runCard(ctx,r){
  const doc=ctx.doc,t=ctx.t;
  const rows=[["run",t("ops.field.run"),{},runPill(ctx,r)," ",mono(doc,r.status??t("ops.runs.noStatus"))]];
  rows.push(["started",t("ops.field.started"),{},timeEl(ctx,r.startedAt)]);
  rows.push(["finished",t("ops.field.finished"),{},timeEl(ctx,r.finishedAt)]);
  rows.push(["age",t("ops.field.age"),{},r.liveness==="FINISHED"||r.liveness==="UNDETERMINED"?MISSING:dur(ctx,r.ageMs)]);
  rows.push(["package",t("ops.field.package"),{},mono(doc,r.packageId)]);
  if(r.error)rows.push(["error",t("ops.field.error"),{},r.error]);
  return h(doc,"li",{class:"card ops-item",dataset:{opsRun:r.runId,liveness:r.liveness,group:r.group,status:r.status??""}},
    h(doc,"h3",{text:r.runId}),
    factRows(ctx,rows));
}
function runsPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t,R=a.runs;
  let body;
  if(R===null)body=h(doc,"p",{class:"note",role:"status",dataset:{opsEmpty:"unknown"},text:t("ops.runs.emptyAll")});
  else if(!R.items.length)body=h(doc,"p",{class:"note",role:"status",dataset:{opsEmpty:"1"},text:t("ops.runs.empty")});
  else{
    const shown=R.items.slice(0,MAX_OPS_ROWS);
    body=[
      h(doc,"h3",{class:"ops-sub",id:"ops-bystate-t",text:t("ops.runs.byState.title")}),
      h(doc,"ul",{class:"ops-counts","aria-labelledby":"ops-bystate-t"},R.byState.map(x=>h(doc,"li",{dataset:{runState:x.status,n:String(x.n)}},h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:x.status==="NO_STATUS"?t("ops.runs.noStatus"):x.status}),`: ${x.n}`))),
      h(doc,"ul",{class:"ops-counts","aria-label":t("ops.runs.live.aria")},LIVENESS.map(k=>h(doc,"li",{dataset:{live:k,n:String(R.live[k])},text:`${t(`ops.live.${k}`)}: ${R.live[k]}`}))),
      R.capped?h(doc,"p",{class:"note",role:"status",dataset:{note:"capped"},text:t("ops.runs.capped",{n:SERVER_RUNS_CAP})}):null,
      shown.length<R.items.length?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:t("ops.runs.truncated",{shown:shown.length,total:R.items.length})}):null,
      h(doc,"ol",{class:"cards ops-list","aria-label":t("ops.runs.aria"),dataset:{opsRunList:String(shown.length)}},shown.map(r=>runCard(ctx,r)))];
  }
  return panel(ctx,{titleKey:"ops.runs.title",id:"ops-runs",className:"ops-section"},
    h(doc,"p",{class:"note",text:t("ops.runs.lead")}),
    h(doc,"p",{class:"note",dataset:{note:"thresholds"},text:t("ops.runs.thresholds",{run:dur(ctx,RUN_STALL_AFTER_MS),retry:dur(ctx,RETRY_OVERDUE_AFTER_MS),checkpoint:dur(ctx,CHECKPOINT_STALE_AFTER_MS)})}),
    h(doc,"p",{class:"note",dataset:{note:"order"},text:t("ops.runs.order")}),
    body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [control,runs,attention]=await Promise.all([
    read(()=>api.operationsControl(),{control:null}),
    read(()=>api.operationsRuns(),{runs:null}),
    read(()=>api.operationsAttention(),{attention:null})
  ]);
  const res={control,runs,attention};
  // Şimdiki zaman yalnız takılma/bekleme türetmek içindir; geçerli bir sayı değilse hiçbir süre/işaret türetilmez.
  const nowMs=typeof ctx.now==="function"?Number(ctx.now()):Date.now();
  const a=buildOperations(res,nowMs);
  return h(doc,"div",{class:"view view-operations"},header(ctx),summaryPanel(ctx,res,a),recoveryPanel(ctx,a),controlsPanel(ctx,a),planePanel(ctx,a),runsPanel(ctx,a));
}
