// //TR: Bu görünüm Çoklu Proje Komuta Matrisi'dir (FA-V2-PRODUCT, UI-205): YALNIZ dört salt-okunur ve zaten izinli GET'ten okunur — GET /v1/projects (matris satırları), GET /v1/missions (mission sayıları), GET /v1/work-runs (koşu sayıları, son inceleme kararı, kaynak düzeyinde teslim) ve GET /v1/cockpit (portföy toplamı). Proje başına tek satır gösterilir ve satırlar "önce dikkat gerektirenler" olarak gruplanır (ATTENTION_NEEDED, UNKNOWN, ACTIVE, IDLE, NO_ACTIVITY). Proje durumu DÜRÜSTTÜR: kayıtlı etkinliğin sınıflandırmasıdır, sağlık iddiası DEĞİLDİR — "sağlıklı", "doğrulanmış" ya da başarı rozetli bir proje durumu YOKTUR. Bir sayı yalnız bağlı olduğu kaynak okunabiliyorsa gösterilir; okunamıyorsa 0 değil "—" ve dürüst durum rozeti görünür. İnceleme kararı (CLEAN/BLOCKED) sunucudan AYNEN gösterilir ve CLEAN yalnız koşunun güncel head'ine bağlıysa başarı rozeti alır; bağımsızlık burada yeniden türetilmez. Teslim yalnız kaynak düzeyindedir ve daima NOT_VERIFIED'dır. Bu görünüm SALT-OKUNURDUR: onay/ret/başlatma/teslim/toplu eylem yoktur; satır eylemleri yalnız mevcut ekranlara (projects/work/journey) gezinmedir. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile,miniBars} from "../components.js";
import {MISSING,topEntries} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {selection} from "../forms.js";
import {MATRIX_SOURCES,MATRIX_SOURCE_PATHS,MATRIX_COLUMNS,MAX_MATRIX_ROWS,buildMatrix} from "../matrix-core.js";

/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t!==null&&t!==undefined&&t!==""?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
const isLive=b=>b.state==="VERIFIED"||b.state==="STALE";
/** Proje durumu -> rozet türü. Hiçbiri başarı/doğrulama rozeti değildir (DONE/VERIFIED yok); UNKNOWN okunamayan kaynağın dürüst durumunu taşır. */
const STATUS_PILL=Object.freeze({ATTENTION_NEEDED:"ATTENTION",ACTIVE:"ACTIVE",IDLE:"IDLE",NO_ACTIVITY:"EMPTY"});
/** Son inceleme türü -> rozet türü. Başarı rozeti (DONE) yalnız CLEAN kararı koşunun güncel head'ine bağlıyken; bayat/geçersiz/kayıtsız asla başarı gibi görünmez. */
const REVIEW_PILL=Object.freeze({CLEAN_AT_HEAD:"DONE",CLEAN_STALE:"NOT_VERIFIED",BLOCKED:"BLOCKED",NO_VALID_VERDICT:"NOT_VERIFIED",NONE:"NOT_EXECUTED"});
/** Teslim -> rozet türü. Kaynak düzeyi: hiçbiri başarı rozeti almaz; hazırlanmış/kabul edilmiş teslim NOT_VERIFIED kalır. */
const DELIVERY_PILL=Object.freeze({NO_RUNS:"EMPTY",NOT_PREPARED:"NOT_EXECUTED",ARTIFACT_PREPARED:"NOT_VERIFIED",SOURCE_ACCEPTED:"NOT_VERIFIED"});
const entriesText=entries=>entries.map(([k,n])=>`${k} ${n}`).join(" · ");

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("matrix.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.matrix.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.matrix.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("matrix.readonly")}),
    // Dürüstlük uyarısı: durum sağlık değildir, okunamayan sayı 0 değildir, teslim yalnız kaynaktır.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("matrix.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. */
function stateBlock(ctx,res,source){
  const doc=ctx.doc,state=failState(res.state);
  return h(doc,"div",{class:`matrix-state state-${state.toLowerCase()}`,role:"status",dataset:{matrixState:state,source}},
    h(doc,"p",{class:"matrix-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`matrix.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`matrix.hint.${state}`,{source:`GET ${MATRIX_SOURCE_PATHS[source]}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}
/** Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). */
function sourcesList(ctx,a){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources matrix-sources","aria-label":ctx.t("matrix.sources.aria")},MATRIX_SOURCES.map(k=>{
    const st=a.sources[k].state,okay=st==="VERIFIED",kind=okay?"VERIFIED":failKind(st);
    return h(doc,"li",{dataset:{source:k,sourceState:st}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`matrix.src.${k}`)}),
      statePill(ctx,kind,{label:okay?ctx.t("matrix.src.ok"):undefined}));
  }));
}

// ---- (A) Portföy özeti ----
function kpiRow(ctx,a){
  const doc=ctx.doc,t=ctx.t,T=a.rollup.tiles;
  const tile=(id,iconName,block,extra={})=>kpiTile(ctx,{id:`matrix-${id}`,iconName,labelKey:`matrix.kpi.${id}`,block:{state:block.state,value:block.value,loading:false,source:block.source,asOf:block.asOf},qualifier:t(`matrix.kpi.q.${id}`),...extra});
  const bars=isLive(T.missions)&&T.missions.detail?miniBars(ctx,topEntries(T.missions.detail.byStatus,4).map(e=>({...e,label:e.key})),t("matrix.kpi.barsMissions")):null;
  const ev=T.evidence,evPartial=isLive(ev)&&ev.detail&&ev.detail.total>ev.value;
  // Dikkat/onay göstergelerinin rozeti yalnız canlıyken sayıya göre seçilir; okunamayan kaynakta varsayılan dürüst durum rozeti kalır (asla başarı rozeti değil).
  const attn=isLive(T.attention)&&T.attention.value>0,wait=isLive(T.awaiting)&&T.awaiting.value>0;
  return h(doc,"div",{class:"kpi-row matrix-kpis",role:"group","aria-label":t("matrix.kpi.group")},
    tile("projects","folder",T.projects),
    tile("missions","tasks",T.missions,{bars}),
    tile("awaiting","inbox",T.awaiting,{pillKind:isLive(T.awaiting)?(wait?"WAITING":"EMPTY"):undefined,risk:wait}),
    tile("attention","alert",T.attention,{pillKind:isLive(T.attention)?(attn?"ATTENTION":"EMPTY"):undefined,risk:attn}),
    tile("workers","bot",T.workers),
    tile("evidence","evidence",ev,{qualifier:ev.detail?t("matrix.kpi.q.evidenceDetail",ev.detail):t("matrix.kpi.q.evidence"),pillKind:evPartial?"NOT_VERIFIED":undefined}));
}
function globalStopFact(ctx,a){
  const doc=ctx.doc,t=ctx.t,gs=a.rollup.globalStop;
  const body=gs===null
    ?[statePill(ctx,failKind(a.rollup.state)),mono(doc,null)]
    :gs.active
      ?[statePill(ctx,"STOPPED",{label:t("matrix.globalStop.shortActive")}),h(doc,"span",{text:t("matrix.globalStop.active",{reason:gs.reason??MISSING})})]
      :[statePill(ctx,"IDLE",{label:t("matrix.globalStop.shortInactive")}),h(doc,"span",{text:t("matrix.globalStop.inactive")})];
  return h(doc,"div",{class:"fact matrix-fact",dataset:{fact:"globalStop",globalStop:gs===null?"unknown":gs.active?"active":"inactive"}},
    h(doc,"span",{class:"fact-label",text:t("matrix.globalStop.label")}),
    h(doc,"p",{class:"matrix-fact-body"},body));
}
/** Çapraz denetim: kokpit toplamları proje/mission listeleriyle karşılaştırılır; uyuşmazlık düzeltilmez, iki değer de olduğu gibi gösterilir. */
function reconcileBlock(ctx,a){
  const doc=ctx.doc,items=a.reconcile;
  if(!items.length)return null;
  const bad=items.filter(x=>!x.agree);
  if(!bad.length)return h(doc,"p",{class:"note",dataset:{reconcile:"agree",compared:items.map(x=>x.key).join(",")},text:ctx.t("matrix.reconcile.agree",{compared:items.map(x=>ctx.t(`matrix.reconcile.key.${x.key}`)).join(", ")})});
  return h(doc,"ul",{class:"matrix-reconcile","aria-label":ctx.t("matrix.reconcile.aria"),dataset:{reconcile:"mismatch"}},bad.map(x=>
    h(doc,"li",{dataset:{reconcileKey:x.key,cockpit:String(x.cockpit),matrix:String(x.matrix)},text:ctx.t(`matrix.reconcile.mismatch.${x.key}`,{cockpit:x.cockpit,matrix:x.matrix})})));
}
function unlistedNotes(ctx,a){
  const doc=ctx.doc,u=a.unlisted,out=[];
  if(u.missions>0)out.push(h(doc,"p",{class:"note",role:"status",dataset:{unlisted:"missions",n:String(u.missions)},text:ctx.t("matrix.unlisted.missions",{n:u.missions})}));
  if(u.runs>0)out.push(h(doc,"p",{class:"note",role:"status",dataset:{unlisted:"runs",n:String(u.runs)},text:ctx.t("matrix.unlisted.runs",{n:u.runs})}));
  return out;
}
function rollupPanel(ctx,res,a){
  const doc=ctx.doc;
  // Durum, eşleyici çıktısının KULLANILABİLİRLİĞİNE göre (a.sources) belirlenir: VERIFIED ama gövdesi eksik bir okuma ERROR gösterilir.
  const failures=MATRIX_SOURCES.filter(k=>a.sources[k].state!=="VERIFIED").map(k=>stateBlock(ctx,{state:a.sources[k].state,message:res[k]?.message},k));
  return panel(ctx,{titleKey:"matrix.rollup.title",id:"matrix-rollup",className:"matrix-section"},
    h(doc,"p",{class:"note",text:ctx.t("matrix.rollup.lead")}),
    h(doc,"h3",{class:"matrix-sub",text:ctx.t("matrix.sources.title")}),
    sourcesList(ctx,a),
    failures,
    a.unreadable.length?h(doc,"p",{class:"note",role:"status",dataset:{matrixPartial:a.unreadable.join(",")},text:ctx.t("matrix.partial",{sources:a.unreadable.map(k=>ctx.t(`matrix.srcShort.${k}`)).join(", ")})}):null,
    h(doc,"h3",{class:"matrix-sub",text:ctx.t("matrix.kpi.title")}),
    kpiRow(ctx,a),
    globalStopFact(ctx,a),
    reconcileBlock(ctx,a),
    unlistedNotes(ctx,a));
}

// ---- (B) Matris ----
const timeEl=(ctx,iso)=>h(ctx.doc,"time",{datetime:iso,text:formatDateTime(iso,ctx.i18n.lang)});
/** Okunamayan kaynağa bağlı hücre: sayı yok ("—", asla 0), ayrık dürüst durum rozeti. */
function withheldCell(ctx,col,sourceKeys,state){
  const doc=ctx.doc,st=failState(state);
  return h(doc,"td",{dataset:{col,withheld:"1",sourceState:st,source:sourceKeys.join(",")},title:ctx.t("matrix.cell.withheld",{sources:sourceKeys.map(k=>ctx.t(`matrix.srcShort.${k}`)).join(", ")})},
    h(doc,"span",{class:"mono",text:MISSING})," ",statePill(ctx,failKind(st),{label:ctx.t(`matrix.state.${st}`)}));
}
function projectCell(ctx,r){
  const doc=ctx.doc;
  return h(doc,"th",{scope:"row",class:"matrix-project",dataset:{col:"project"}},
    h(doc,"strong",{class:"matrix-project-name",text:r.name}),
    h(doc,"span",{class:"mono matrix-project-id",dataset:{field:"projectId"},text:r.projectId}),
    r.environmentId?h(doc,"span",{class:"note",dataset:{field:"environment"},text:ctx.t("matrix.env",{env:r.environmentId})}):null,
    r.lastActivityAt?h(doc,"span",{class:"note",dataset:{field:"lastActivity"}},ctx.t("matrix.lastActivity")," ",timeEl(ctx,r.lastActivityAt)):h(doc,"span",{class:"note",dataset:{field:"lastActivity",value:"none"},text:ctx.t("matrix.lastActivityNone")}));
}
function statusCell(ctx,r){
  const doc=ctx.doc,t=ctx.t;
  const unknown=r.status==="UNKNOWN",srcText=r.unreadable.map(k=>t(`matrix.srcShort.${k}`)).join(", ");
  const label=unknown?t(`matrix.state.${failState(r.unknownState)}`):t(`matrix.status.${r.status}`);
  let detail;
  if(r.status==="ATTENTION_NEEDED")detail=[
    h(doc,"ul",{class:"matrix-signals","aria-label":t("matrix.signals.aria",{name:r.name})},r.signals.map(s=>h(doc,"li",{dataset:{signal:s.code,n:String(s.n),signalSource:s.source},text:t(`matrix.signal.${s.code}`,{n:s.n})}))),
    r.partial?h(doc,"p",{class:"note",role:"status",dataset:{note:"partial"},text:t("matrix.row.partial",{sources:srcText})}):null];
  else if(unknown)detail=h(doc,"p",{class:"note",role:"status",dataset:{note:"unknown"},text:t("matrix.row.unknown",{sources:srcText})});
  else if(r.status==="ACTIVE")detail=h(doc,"p",{class:"note",text:t("matrix.row.active",{open:r.runs.open,progress:r.missions.inProgress})});
  else if(r.status==="IDLE")detail=h(doc,"p",{class:"note",text:t("matrix.row.idle")});
  else detail=h(doc,"p",{class:"note",text:t("matrix.row.noActivity")});
  return h(doc,"td",{dataset:{col:"status",status:r.status}},
    h(doc,"p",{class:"matrix-cell-head"},statePill(ctx,unknown?failKind(r.unknownState):STATUS_PILL[r.status],{label})),detail);
}
function countCell(ctx,col,summary,sourceKey,state){
  const doc=ctx.doc;
  if(summary===null)return withheldCell(ctx,col,[sourceKey],state);
  return h(doc,"td",{dataset:{col,n:String(summary.total)}},
    h(doc,"strong",{class:"matrix-count",text:String(summary.total)}),
    summary.total>0?h(doc,"p",{class:"note mono",dataset:{field:"breakdown"},text:entriesText(summary.byStatus)}):null);
}
function sumCell(ctx,col,sum,r){
  const doc=ctx.doc;
  if(sum===null)return withheldCell(ctx,col,r.unreadable,r.unknownState);
  return h(doc,"td",{dataset:{col,n:String(sum.total)}},
    h(doc,"strong",{class:"matrix-count",text:String(sum.total)}),
    h(doc,"p",{class:"note",dataset:{field:"split"},text:ctx.t(`matrix.cell.${col}Split`,{m:sum.missions,r:sum.runs})}));
}
function reviewCell(ctx,r,a){
  const doc=ctx.doc,t=ctx.t;
  if(r.review===null)return withheldCell(ctx,"review",["workRuns"],a.sources.workRuns.state);
  const rv=r.review,l=rv.latest;
  const label=rv.kind==="NONE"?t("matrix.review.NONE"):rv.kind==="NO_VALID_VERDICT"?t("matrix.review.NO_VALID_VERDICT"):l.verdict;
  const body=[h(doc,"p",{class:"matrix-cell-head"},statePill(ctx,REVIEW_PILL[rv.kind],{label}))];
  if(l!==null){
    // Karar AYNEN (ham kod) ve kimden/hangi döngüden geldiği; bayat karar açıkça işaretlenir.
    if(l.verdict!==null)body.push(h(doc,"p",{class:"note"},h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:l.verdict})," · ",t("matrix.review.by",{reviewer:l.reviewer??MISSING,n:l.cycle})));
    body.push(h(doc,"p",{class:"note",dataset:{field:"reviewRun"}},t("matrix.review.run")," ",mono(doc,l.runId)));
    if(l.verdict!==null)body.push(h(doc,"p",{class:"note",dataset:{note:l.atHead?"at-head":"stale-verdict"},text:t(l.atHead?"matrix.review.atHead":"matrix.review.stale")}));
    body.push(h(doc,"p",{class:"note",dataset:{field:"reviewed"},text:t("matrix.review.reviewed",{n:rv.reviewedRuns,total:r.runs.total})}));
  }
  return h(doc,"td",{dataset:{col:"review",kind:rv.kind,verdict:l&&l.verdict?l.verdict:"",atHead:l&&l.atHead?"1":"0"}},body);
}
function deliveryCell(ctx,r,a){
  const doc=ctx.doc,t=ctx.t;
  if(r.delivery===null)return withheldCell(ctx,"delivery",["workRuns"],a.sources.workRuns.state);
  const d=r.delivery;
  return h(doc,"td",{dataset:{col:"delivery",delivery:d.best}},
    h(doc,"p",{class:"matrix-cell-head"},statePill(ctx,DELIVERY_PILL[d.best],{label:t(`matrix.delivery.${d.best}`)})),
    d.runs>0?h(doc,"p",{class:"note",dataset:{field:"deliveryCounts"},text:t("matrix.delivery.counts",{accepted:d.counts.SOURCE_ACCEPTED,prepared:d.counts.ARTIFACT_PREPARED,none:d.counts.NOT_PREPARED})}):null);
}
/** Satır eylemleri yalnız mevcut ekranlara gezinmedir (yazma/POST yok); proje bağlamı yerel olarak seçilir, mission kimliği yalnız okunabilen son mission'dandır. */
function actionsCell(ctx,r){
  const doc=ctx.doc,t=ctx.t;
  const pick=()=>{if(typeof ctx.selectProject==="function")ctx.selectProject(r.projectId)};
  const btn=(kind,route,go)=>h(doc,"button",{type:"button",class:"btn",id:`mx-${kind}-${r.projectId}`,"aria-label":t(`matrix.action.${kind}.aria`,{name:r.name}),dataset:{focusKey:`mx-${kind}-${r.projectId}`,navigate:route,projectId:r.projectId},on:{click:go},text:t(`matrix.action.${kind}`)});
  return h(doc,"td",{dataset:{col:"open"}},
    h(doc,"div",{class:"btn-row matrix-actions",role:"group","aria-label":t("matrix.action.group",{name:r.name})},
      btn("project","projects",()=>{pick();ctx.navigate("projects")}),
      btn("work","work",()=>{pick();selection.missionId=r.latestMissionId;ctx.navigate("work")}),
      r.latestMissionId!==null?btn("journey","journey",()=>{pick();selection.missionId=r.latestMissionId;ctx.navigate("journey")}):null));
}
function matrixRow(ctx,r,a){
  const doc=ctx.doc;
  return h(doc,"tr",{class:"matrix-row",dataset:{matrixRow:r.projectId,status:r.status,review:r.review?r.review.kind:"UNREAD",delivery:r.delivery?r.delivery.best:"UNREAD"}},
    projectCell(ctx,r),
    statusCell(ctx,r),
    countCell(ctx,"missions",r.missions,"missions",a.sources.missions.state),
    countCell(ctx,"runs",r.runs,"workRuns",a.sources.workRuns.state),
    sumCell(ctx,"blocked",r.blocked,r),
    sumCell(ctx,"awaiting",r.awaiting,r),
    reviewCell(ctx,r,a),
    deliveryCell(ctx,r,a),
    actionsCell(ctx,r));
}
/** Gösterilecek gruplar: en acil olan önce, toplam MAX_MATRIX_ROWS satırla sınırlı (gerçek toplam ayrıca belirtilir). */
function visibleGroups(a){
  let left=MAX_MATRIX_ROWS;const out=[];
  for(const g of a.groups){
    if(!g.items.length||left<=0)continue;
    const items=g.items.slice(0,left);left-=items.length;
    out.push({status:g.status,total:g.items.length,items});
  }
  return out;
}
function groupBody(ctx,g,a){
  const doc=ctx.doc,t=ctx.t;
  return h(doc,"tbody",{dataset:{matrixGroup:g.status,n:String(g.total)}},
    h(doc,"tr",{class:"matrix-group-row"},
      h(doc,"th",{scope:"colgroup",colspan:String(MATRIX_COLUMNS.length),id:`matrix-group-${g.status}`},
        h(doc,"strong",{text:t(`matrix.group.${g.status}`,{n:g.total})})," ",h(doc,"span",{class:"note",text:t(`matrix.groupDesc.${g.status}`)}))),
    g.items.map(r=>matrixRow(ctx,r,a)));
}
function matrixTable(ctx,a,groups){
  const doc=ctx.doc;
  return h(doc,"div",{class:"matrix-scroll",role:"region",tabindex:"0","aria-label":ctx.t("matrix.grid.aria")},
    h(doc,"table",{class:"matrix-table",dataset:{matrixRows:String(groups.reduce((n,g)=>n+g.items.length,0))}},
      h(doc,"caption",{class:"sr-only",text:ctx.t("matrix.grid.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},MATRIX_COLUMNS.map(c=>h(doc,"th",{scope:"col",dataset:{col:c},text:ctx.t(`matrix.col.${c}`)})))),
      groups.map(g=>groupBody(ctx,g,a))));
}
function gridPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t;
  let body;
  if(a.projects===null)body=h(doc,"p",{class:"note",role:"status",dataset:{matrixEmpty:"unknown"},text:t("matrix.grid.emptyAll")});
  else if(!a.rows.length)body=h(doc,"p",{class:"note",role:"status",dataset:{matrixEmpty:"1"},text:t("matrix.grid.empty")});
  else{
    const groups=visibleGroups(a),shown=groups.reduce((n,g)=>n+g.items.length,0);
    body=[shown<a.rows.length?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:t("matrix.grid.truncated",{shown,total:a.rows.length})}):null,
      matrixTable(ctx,a,groups),
      h(doc,"p",{class:"note",dataset:{note:"review-independence"},text:t("matrix.review.note")}),
      h(doc,"p",{class:"note",dataset:{note:"source-only"},text:t("matrix.delivery.sourceOnly")}),
      h(doc,"p",{class:"note",dataset:{note:"actions"},text:t("matrix.action.hint")})];
  }
  return panel(ctx,{titleKey:"matrix.grid.title",id:"matrix-grid",className:"matrix-section"},
    h(doc,"p",{class:"note",text:t("matrix.grid.lead")}),
    h(doc,"p",{class:"note",dataset:{note:"order"},text:t("matrix.order.note")}),
    body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [projects,missions,workRuns,cockpit]=await Promise.all([
    read(()=>api.matrixProjects(),{projects:null}),
    read(()=>api.matrixMissions(),{missions:null}),
    read(()=>api.matrixWorkRuns(),{runs:null}),
    read(()=>api.matrixCockpit(),{cockpit:null})
  ]);
  const res={projects,missions,workRuns,cockpit};
  const a=buildMatrix(res);
  return h(doc,"div",{class:"view view-matrix"},header(ctx),rollupPanel(ctx,res,a),gridPanel(ctx,a));
}
