// //TR: Bu görünüm Kurucu Yönetim Özeti ve İcra Defteri'dir (FA-V2-PRODUCT, UI-236): YALNIZ dört salt-okunur ve zaten izinli GET'ten okunur — GET /v1/cockpit (başlık göstergeleri), GET /v1/missions (hat içi mission), GET /v1/work-runs (İcra Defteri satırları + teslim durumları) ve GET /v1/founder-attention (Founder'ı bekleyen engelli paketler). HİÇBİR sayı, koşu, karar veya teslim UYDURULMAZ: bozuk yanıt tümden ERROR olarak gösterilir (kısmi/tahmini değer yok), okunamayan kaynak 0 değil dürüst OFFLINE/UNAVAILABLE/ERROR gösterir. Teslim yalnız kaynak düzeyindedir (doğrulanmadı); ürün doğrulaması bu görünümde ASLA iddia edilmez ve ilgili sabit değer hiçbir yerde üretilmez. Şirket/gelir/müşteri/uptime metriği yoktur. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile,miniBars,emptyNote} from "../components.js";
import {MISSING,topEntries} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {EXECUTIVE_SOURCES,EXECUTIVE_SOURCE_PATHS,PILL_FOR_RUN_STATUS,MAX_LEDGER_ROWS,executiveSummary,shortSha} from "../executive-core.js";

const isOk=res=>Boolean(res)&&res.state==="VERIFIED";
/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
/** Kokpit blok durumu -> ayrık rozet türü (ERROR=FAILED, UNAVAILABLE ayrı kalır). */
const blockKind=state=>state==="VERIFIED"?"VERIFIED":state==="STALE"?"STALE":failKind(state);

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("executive.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.executive.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.executive.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("executive.readonly")}),
    // Dürüstlük uyarısı: teslim yalnız kaynak düzeyindedir, hiçbir şirket metriği yoktur.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("executive.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. */
function stateBlock(ctx,res,source){
  const doc=ctx.doc,state=failState(res.state);
  return h(doc,"div",{class:`executive-state state-${state.toLowerCase()}`,role:"status",dataset:{executiveState:state,source}},
    h(doc,"p",{class:"executive-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`executive.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`executive.hint.${state}`,{source:`GET ${EXECUTIVE_SOURCE_PATHS[source]}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}

/** Kaynak şeridi (Bölüm A içinde): her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). */
function sourcesList(ctx,res){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources executive-sources","aria-label":ctx.t("executive.sources.aria")},EXECUTIVE_SOURCES.map(k=>{
    const ok=isOk(res[k]),kind=ok?"VERIFIED":failKind(res[k].state);
    return h(doc,"li",{dataset:{source:k,sourceState:ok?"VERIFIED":failState(res[k].state)}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`executive.src.${k}`)}),
      statePill(ctx,kind,{label:ok?ctx.t("executive.src.ok"):undefined}));
  }));
}

// ---- (A) Yönetim özeti (kaynak şeridi, göstergeler, platform durumu) ----
function kpiRow(ctx,summary,res){
  const doc=ctx.doc,k=summary.kpis,t=ctx.t;
  const tile=(id,iconName,block,extra={})=>kpiTile(ctx,{id:`executive-${id}`,iconName,labelKey:`executive.kpi.${id}`,block:{state:block.state,value:block.value,loading:false,source:block.source,asOf:block.asOf},...extra});
  const live=b=>b.state==="VERIFIED"||b.state==="STALE";
  const bars=live(k.missions)&&k.missions.detail?miniBars(ctx,topEntries(k.missions.detail.byStatus,4).map(e=>({...e,label:e.key})),t("executive.kpi.barsMissions")):null;
  return h(doc,"div",{class:"kpi-row executive-kpis",role:"group","aria-label":t("executive.kpi.group")},
    tile("projects","folder",k.projects,{qualifier:t("executive.kpi.q.projects")}),
    tile("missions","tasks",k.missions,{qualifier:t("executive.kpi.q.missions"),bars}),
    tile("inProgress","pulse",k.inProgress,{qualifier:k.inProgress.detail?t("executive.kpi.q.inProgress",{total:k.inProgress.detail.total}):undefined}),
    tile("runs","bot",k.runs,{qualifier:k.runs.detail?t("executive.kpi.q.runs",k.runs.detail):undefined}),
    tile("approvals","inbox",k.approvals,{qualifier:t("executive.kpi.q.approvals")}),
    tile("blocked","ban",k.blocked,{qualifier:t("executive.kpi.q.blocked"),risk:live(k.blocked)&&k.blocked.value>0}),
    // Teslimler: yalnız kaynak düzeyi; rozet daima NOT_VERIFIED (ürün doğrulandı iddiası yok).
    tile("deliveries","rocket",k.deliveries,{pillKind:live(k.deliveries)?"NOT_VERIFIED":blockKind(k.deliveries.state),qualifier:k.deliveries.detail?t("executive.kpi.q.deliveries",k.deliveries.detail):undefined}),
    tile("evidence","evidence",k.evidence,{qualifier:k.evidence.detail?t("executive.kpi.q.evidence",k.evidence.detail):undefined}));
}

const byStatusText=by=>Object.entries(by??{}).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([k,n])=>`${k} ${n}`).join(" · ");
/** Platform durumu: küresel durdurma, orkestratör paketleri, kanonik rol sayısı, etkin worker koşuları — yalnız kokpit bloklarından. */
function platformFacts(ctx,platform){
  const doc=ctx.doc,t=ctx.t;
  const fact=(key,labelKey,pill,body)=>h(doc,"div",{class:"fact",dataset:{fact:key}},h(doc,"span",{class:"fact-label",text:t(labelKey)}),h(doc,"p",{class:"executive-fact-body"},pill,body));
  const down=platform.failState;
  const dash=()=>h(doc,"span",{class:"mono",text:MISSING});
  if(down){
    return h(doc,"div",{class:"facts executive-platform",dataset:{platform:down}},["globalStop","orchestrator","roles","workers"].map(k=>fact(k,`executive.platform.${k}`,statePill(ctx,failKind(down)),dash())));
  }
  const gs=platform.globalStop,or=platform.orchestrator,wf=platform.workforce;
  const num=(v)=>v===null?dash():h(doc,"span",{class:"mono",text:String(v)});
  return h(doc,"div",{class:"facts executive-platform"},
    gs.active
      ?fact("globalStop","executive.platform.globalStop",statePill(ctx,"STOPPED",{label:t("executive.platform.stoppedShort")}),h(doc,"span",{text:t("executive.platform.stopped",{reason:gs.reason??MISSING})}))
      :fact("globalStop","executive.platform.globalStop",statePill(ctx,"VERIFIED",{label:t("executive.platform.runningShort")}),h(doc,"span",{text:t("executive.platform.running")})),
    fact("orchestrator","executive.platform.orchestrator",statePill(ctx,blockKind(or.state)),
      or.total===null?dash():h(doc,"span",{},num(or.total),or.asOf?` · ${t("executive.platform.asOf",{time:formatDateTime(or.asOf,ctx.i18n.lang)})}`:"",Object.keys(or.byStatus).length?h(doc,"span",{class:"note mono"}," · "+byStatusText(or.byStatus)):null)),
    // Kanonik rol sayısı kaynakta yoksa (null) rozet VERIFIED değil UNAVAILABLE'dır: "doğrulandı —" gösterilmez.
    fact("roles","executive.platform.roles",statePill(ctx,wf.registeredRoles===null?"UNAVAILABLE":blockKind(wf.state)),num(wf.registeredRoles)),
    fact("workers","executive.platform.workers",statePill(ctx,blockKind(wf.state)),num(wf.activeWorkerRuns)));
}

function summaryPanel(ctx,res){
  const doc=ctx.doc,summary=executiveSummary(res);
  // Okunamayan ya da bozuk kaynak için dürüst durum bloğu (ilgili göstergeler zaten — gösterir; burada neden yazılır).
  const failures=["cockpit","missions","attention"].filter(k=>!isOk(res[k])).map(k=>stateBlock(ctx,res[k],k));
  return panel(ctx,{titleKey:"executive.summary.title",id:"executive-summary",className:"executive-section"},
    h(doc,"p",{class:"note",text:ctx.t("executive.summary.lead")}),
    h(doc,"h3",{class:"executive-sub",text:ctx.t("executive.sources.title")}),
    sourcesList(ctx,res),
    failures,
    kpiRow(ctx,summary,res),
    h(doc,"h3",{class:"executive-sub",text:ctx.t("executive.platform.title")}),
    h(doc,"p",{class:"note",text:ctx.t("executive.platform.lead")}),
    platformFacts(ctx,summary.platform));
}

// ---- (B) İcra Defteri ----
const commit=(doc,sha)=>sha?h(doc,"span",{class:"mono",title:sha,text:shortSha(sha)}):MISSING;
function versionsBlock(ctx,r){
  const doc=ctx.doc;
  if(!r.versions.length)return h(doc,"span",{class:"note",dataset:{versions:"none"},text:ctx.t("executive.versions.none")});
  return h(doc,"ol",{class:"executive-versions","aria-label":ctx.t("executive.versions.aria"),dataset:{versions:String(r.versions.length)}},r.versions.map(v=>
    h(doc,"li",{dataset:{cycle:v.cycle,commit:v.commitSha}},h(doc,"span",{class:"executive-cycle",text:ctx.t("executive.versions.cycle",{n:v.cycle})})," ",commit(doc,v.commitSha))));
}
function verdictBlock(ctx,r){
  const doc=ctx.doc,rv=r.review;
  if(!rv)return h(doc,"span",{},statePill(ctx,"NOT_EXECUTED",{label:ctx.t("executive.verdict.none")}));
  const pill=rv.verdict===null?statePill(ctx,"NOT_EXECUTED",{label:ctx.t("executive.verdict.noValid")}):statePill(ctx,rv.verdict==="CLEAN"?"DONE":"BLOCKED",{label:rv.verdict});
  return h(doc,"span",{class:"executive-verdict",dataset:{atHead:rv.atHead?"1":"0"}},pill,
    h(doc,"span",{class:"note",text:` ${ctx.t("executive.verdict.by",{reviewer:rv.reviewer??MISSING,n:rv.cycle})}`}),
    rv.verdict!==null&&!rv.atHead?h(doc,"span",{class:"note",dataset:{note:"stale-verdict"},text:` ${ctx.t("executive.verdict.stale")}`}):null);
}
function deliveryBlock(ctx,r){
  const doc=ctx.doc,d=r.delivery;
  const pill=d.state==="NOT_PREPARED"?statePill(ctx,"NOT_EXECUTED",{label:ctx.t("executive.delivery.NOT_PREPARED")}):statePill(ctx,"NOT_VERIFIED",{label:ctx.t(`executive.delivery.${d.state}`)});
  const facts=d.artifact
    ?h(doc,"dl",{class:"executive-facts executive-delivery-facts"},
      h(doc,"dt",{text:ctx.t("executive.delivery.commit")}),h(doc,"dd",{},commit(doc,d.artifact.sourceCommit)),
      h(doc,"dt",{text:ctx.t("executive.delivery.hash")}),h(doc,"dd",{class:"mono",text:d.artifact.exportArtifactHash}),
      d.accepted?h(doc,"dt",{text:ctx.t("executive.delivery.acceptedAt")}):null,
      d.accepted?h(doc,"dd",{},h(doc,"time",{datetime:d.accepted.acceptedAt,text:formatDateTime(d.accepted.acceptedAt,ctx.i18n.lang)})):null)
    :null;
  return h(doc,"div",{class:"executive-delivery",dataset:{delivery:d.state}},
    h(doc,"p",{class:"executive-fact-body"},pill),
    d.state==="NOT_PREPARED"?null:h(doc,"p",{class:"note",dataset:{note:"source-only"},text:ctx.t("executive.delivery.sourceOnlyNote")}),
    facts,
    // Sunucuda tamamlanma kaydı varsa yalnız VARLIĞI belirtilir; bu görünüm onu yeniden doğrulamaz.
    r.completionRecorded?h(doc,"p",{class:"executive-fact-body",dataset:{completion:"recorded"}},statePill(ctx,"DONE",{label:ctx.t("executive.delivery.completionShort")}),h(doc,"span",{class:"note",text:ctx.t("executive.delivery.completion")})):null);
}
function ledgerRow(ctx,r,titles){
  const doc=ctx.doc;
  const title=titles?titles.get(r.missionId):undefined;
  const missionLine=titles===null?r.missionId:title?`${title} · ${r.missionId}`:`${r.missionId} · ${ctx.t("executive.ledger.missionUnknown")}`;
  return h(doc,"li",{class:"tl-item executive-row",dataset:{run:r.runId,status:r.status,delivery:r.delivery.state,verdict:r.review&&r.review.verdict?r.review.verdict:"NONE"}},
    h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
    h(doc,"time",{datetime:r.updatedAt,text:formatDateTime(r.updatedAt,ctx.i18n.lang)}),
    h(doc,"div",{class:"tl-body"},
      h(doc,"p",{class:"executive-row-head"},h(doc,"strong",{class:"mono",text:r.runId})," ",statePill(ctx,PILL_FOR_RUN_STATUS[r.status]??"NEUTRAL",{label:r.status})),
      h(doc,"p",{class:"note",dataset:{role:"mission"},text:`${ctx.t("executive.ledger.mission")}: ${missionLine}`}),
      h(doc,"dl",{class:"executive-facts"},
        h(doc,"dt",{text:ctx.t("executive.field.step")}),h(doc,"dd",{},mono(doc,r.step)," · ",ctx.t("executive.field.cycleN",{n:r.cycle})),
        h(doc,"dt",{text:ctx.t("executive.field.started")}),h(doc,"dd",{},h(doc,"time",{datetime:r.createdAt,text:formatDateTime(r.createdAt,ctx.i18n.lang)})),
        h(doc,"dt",{text:ctx.t("executive.field.versions")}),h(doc,"dd",{},versionsBlock(ctx,r)),
        h(doc,"dt",{text:ctx.t("executive.field.head")}),h(doc,"dd",{},commit(doc,r.headSha)),
        h(doc,"dt",{text:ctx.t("executive.field.verdict")}),h(doc,"dd",{},verdictBlock(ctx,r)),
        h(doc,"dt",{text:ctx.t("executive.field.delivery")}),h(doc,"dd",{},deliveryBlock(ctx,r)))));
}
function ledgerPanel(ctx,res){
  const doc=ctx.doc,runs=res.workRuns;
  let body;
  if(!isOk(runs))body=stateBlock(ctx,runs,"workRuns");
  else if(!runs.runs.total)body=emptyNote(ctx,"executive.ledger.empty");
  else{
    // Mission başlığı yalnız mission listesi okunabiliyorsa eşlenir; okunamıyorsa yalnız kimlik gösterilir (uydurma başlık yok).
    const titles=isOk(res.missions)&&res.missions.missions?new Map(res.missions.missions.items.map(m=>[m.missionId,m.title])):null;
    const shown=runs.runs.items.slice(0,MAX_LEDGER_ROWS);
    body=[shown.length<runs.runs.total?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:ctx.t("executive.ledger.shown",{shown:shown.length,total:runs.runs.total})}):null,
      h(doc,"ol",{class:"timeline executive-ledger","aria-label":ctx.t("executive.ledger.aria"),dataset:{executiveLedger:String(shown.length)}},shown.map(r=>ledgerRow(ctx,r,titles)))];
  }
  return panel(ctx,{titleKey:"executive.ledger.title",id:"executive-ledger",className:"executive-section"},h(doc,"p",{class:"note",text:ctx.t("executive.ledger.lead")}),body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [cockpit,missions,workRuns,attention]=await Promise.all([
    read(()=>api.execCockpit(),{cockpit:null}),
    read(()=>api.execMissions(),{missions:null}),
    read(()=>api.execWorkRuns(),{runs:null}),
    read(()=>api.execAttention(),{attention:null})
  ]);
  // executiveSummary dört okumayı {cockpit,missions,runs,attention} adlarıyla bekler; ledger/kaynak şeridi workRuns adını kullanır.
  const res={cockpit,missions,workRuns,attention,runs:workRuns};
  return h(doc,"div",{class:"view view-executive"},header(ctx),summaryPanel(ctx,res),ledgerPanel(ctx,res));
}
