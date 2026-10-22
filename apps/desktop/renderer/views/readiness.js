// //TR: Bu görünüm Kalite Kapısı ve Release Readiness'tır (FA-V2-PRODUCT, UI-227): YALNIZ dört salt-okunur ve zaten izinli GET'ten okunur — GET /v1/work-runs (koşular, güvenlik/QA kanıtı, teslim paketi, tamamlanma kaydı), GET /v1/reviews (bağımsız inceleme kararları, UI-049), GET /v1/cockpit (yalnız evidence bloğu: hash-doğrulanmış kanıt bütünlüğü) ve GET /v1/missions (yalnız mission başlığı). Her koşu için yedi kapı gösterilir (koşu, bağımsız inceleme, güvenlik taraması, QA testleri, teslim paketi, tamamlanma kaydı, kanıt bütünlüğü) ve genel hazırlık DÜRÜSTTÜR: READY yalnız yedi kapının HEPSİ gerçekten sağlandığında görünür; aksi halde tam olarak neyin eksik olduğu listelenir. Bağımsız inceleme kararı (CLEAN/BLOCKED/NO_VERDICT/NOT_REVIEWED/INDEPENDENCE_UNVERIFIED) sunucudan aynen taşınır; BLOCKED bu arayüzde "engellendi/reddedildi" olarak gösterilir. Teslim yalnız kaynak düzeyindedir (kod çalıştırılmadı, NOT_VERIFIED). HİÇBİR sayı, kapı geçişi, karar veya teslim UYDURULMAZ: bozuk yanıt tümden ERROR olarak gösterilir (kısmi/tahmini değer yok), okunamayan kaynak 0 ya da "geçti" değil dürüst OFFLINE/UNAVAILABLE/ERROR gösterir ve ilgili kapı UNKNOWN olur. Ürün doğrulaması bu görünümde ASLA iddia edilmez ve ilgili sabit değer hiçbir yerde üretilmez. Bu görünüm SALT-OKUNURDUR: onay/ret/teslim burada yapılmaz, yalnız mevcut akışlara gezinme sunulur. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {selection} from "../forms.js";
import {READINESS_SOURCES,READINESS_SOURCE_PATHS,REVIEW_STATES,MAX_READINESS_ROWS,PILL_FOR_RUN_STATUS,buildReadiness,integrityGate,shortSha} from "../readiness-core.js";

const isOk=res=>Boolean(res)&&res.state==="VERIFIED";
/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t!==null&&t!==undefined&&t!==""?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
const safeId=key=>String(key).replace(/[^A-Za-z0-9_-]/g,"_");
/** Genel hazırlık düzeyi -> durum rozeti türü (renk tek başına anlam taşımaz; etiket yerelleştirilmiş düzey adıdır). */
const TIER_PILL=Object.freeze({READY:"DONE",SOURCE_ONLY:"NOT_VERIFIED",NOT_READY:"WAITING",BLOCKED:"BLOCKED"});
/** Bekleyen (PENDING) kapının rozeti: hiç yapılmamış işler NOT_EXECUTED, bayat kanıt STALE, kısmi/doğrulanamayan durumlar NOT_VERIFIED (asla başarı rozeti değil). */
const PENDING_PILL=Object.freeze({NOT_EXECUTED:"NOT_EXECUTED",NOT_REVIEWED:"NOT_EXECUTED",NOT_LISTED:"NOT_EXECUTED",NOT_RECORDED:"NOT_EXECUTED",NOT_PREPARED:"NOT_EXECUTED",STALE:"STALE"});

function gateKind(g){
  if(g.status==="UNKNOWN")return failKind(g.detail);
  if(g.id==="run")return PILL_FOR_RUN_STATUS[g.detail]??"NEUTRAL";
  if(g.status==="FAIL")return g.detail==="FAILED"?"FAILED":"BLOCKED";
  // Teslim paketi geçse bile yalnız kaynak düzeyidir: rozet daima NOT_VERIFIED.
  if(g.status==="PASS")return g.id==="delivery"?"NOT_VERIFIED":g.id==="integrity"?"VERIFIED":"DONE";
  return PENDING_PILL[g.detail]??"NOT_VERIFIED";
}
function gateLabel(ctx,g){
  if(g.status==="UNKNOWN")return ctx.t(`readiness.detail.UNKNOWN.${g.detail}`);
  if(g.id==="run")return g.detail;
  return ctx.t(`readiness.detail.${g.id}.${g.detail}`);
}

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("readiness.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.readiness.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.readiness.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("readiness.readonly")}),
    // Dürüstlük uyarısı: hazırlık yalnız gerçek kapılardan türer, teslim yalnız kaynak düzeyindedir.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("readiness.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. */
function stateBlock(ctx,res,source){
  const doc=ctx.doc,state=failState(res.state);
  return h(doc,"div",{class:`readiness-state state-${state.toLowerCase()}`,role:"status",dataset:{readinessState:state,source}},
    h(doc,"p",{class:"readiness-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`readiness.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`readiness.hint.${state}`,{source:`GET ${READINESS_SOURCE_PATHS[source]}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}

/** Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). */
function sourcesList(ctx,res){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources readiness-sources","aria-label":ctx.t("readiness.sources.aria")},READINESS_SOURCES.map(k=>{
    const ok=isOk(res[k]),kind=ok?"VERIFIED":failKind(res[k].state);
    return h(doc,"li",{dataset:{source:k,sourceState:ok?"VERIFIED":failState(res[k].state)}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`readiness.src.${k}`)}),
      statePill(ctx,kind,{label:ok?ctx.t("readiness.src.ok"):undefined}));
  }));
}

// ---- (A) Özet: kaynaklar, sayılar, platform kanıt bütünlüğü ----
function kpiRow(ctx,a){
  const doc=ctx.doc,c=a.counts;
  // Sayılar yalnız değerlendirme TAMSA (üç gerekli kaynak da okundu) gösterilir; aksi halde değer null ve rozet dürüst durumdur.
  const block=value=>({state:a.complete?"VERIFIED":a.incompleteState,value:a.complete?value:null,loading:false,source:"GET /v1/work-runs · /v1/reviews · /v1/cockpit",asOf:null});
  const tile=(id,iconName,value,extra={})=>kpiTile(ctx,{id:`readiness-${id}`,iconName,labelKey:`readiness.kpi.${id}`,block:block(value),qualifier:ctx.t(`readiness.kpi.q.${id}`),...extra});
  return h(doc,"div",{class:"kpi-row readiness-kpis",role:"group","aria-label":ctx.t("readiness.kpi.group")},
    tile("total","tasks",c?c.total:null),
    tile("ready","check",c?c.byTier.READY:null),
    // Kaynak düzeyi hazır koşular: rozet daima NOT_VERIFIED (ürün doğrulandı iddiası yok).
    tile("sourceOnly","rocket",c?c.byTier.SOURCE_ONLY:null,a.complete?{pillKind:"NOT_VERIFIED"}:{}),
    tile("notReady","clock",c?c.byTier.NOT_READY:null),
    tile("blocked","ban",c?c.byTier.BLOCKED:null,{risk:Boolean(c&&c.byTier.BLOCKED>0)}));
}
/** Platform kanıt bütünlüğü: GET /v1/cockpit evidence bloğundan tam sayımlar; okunamıyorsa dürüst durum (0 değil). */
function integrityBlock(ctx,res){
  const doc=ctx.doc,g=integrityGate(res.evidence),e=isOk(res.evidence)?res.evidence.evidence:null;
  const wrap=(pill,...body)=>h(doc,"div",{class:"readiness-integrity",dataset:{integrity:g.detail,integrityStatus:g.status}},h(doc,"p",{class:"readiness-fact-body"},pill,...body));
  if(g.status==="UNKNOWN")return wrap(statePill(ctx,failKind(g.detail)),h(doc,"span",{class:"note",text:ctx.t(`readiness.detail.UNKNOWN.${g.detail}`)}));
  const counts=ctx.t("readiness.integrity.counts",{verified:e.verified,total:e.total,mismatch:e.mismatch,missing:e.missing,unverifiable:e.unverifiable});
  return wrap(statePill(ctx,gateKind(g),{label:ctx.t(`readiness.detail.integrity.${g.detail}`)}),h(doc,"span",{dataset:{field:"integrityCounts"},text:counts}),
    " ",h(doc,"span",{class:"note"},ctx.t("readiness.integrity.asOf",{time:formatDateTime(e.asOf,ctx.i18n.lang)})));
}
function summaryPanel(ctx,res,a){
  const doc=ctx.doc;
  const failures=READINESS_SOURCES.filter(k=>!isOk(res[k])).map(k=>stateBlock(ctx,res[k],k));
  return panel(ctx,{titleKey:"readiness.summary.title",id:"readiness-summary",className:"readiness-section"},
    h(doc,"p",{class:"note",text:ctx.t("readiness.summary.lead")}),
    h(doc,"h3",{class:"readiness-sub",text:ctx.t("readiness.sources.title")}),
    sourcesList(ctx,res),
    failures,
    !a.complete?h(doc,"p",{class:"note",role:"status",dataset:{readinessPartial:a.unreadableRequired.join(",")},text:ctx.t("readiness.partial",{sources:a.unreadableRequired.map(k=>ctx.t(`readiness.srcShort.${k}`)).join(", ")})}):null,
    kpiRow(ctx,a),
    h(doc,"h3",{class:"readiness-sub",text:ctx.t("readiness.integrity.title")}),
    h(doc,"p",{class:"note",text:ctx.t("readiness.integrity.lead")}),
    integrityBlock(ctx,res),
    h(doc,"h3",{class:"readiness-sub",text:ctx.t("readiness.gates.title")}),
    h(doc,"p",{class:"note",dataset:{note:"gates"},text:ctx.t("readiness.gates.lead")}),
    h(doc,"p",{class:"note",dataset:{note:"source-only"},text:ctx.t("readiness.gates.sourceOnly")}));
}

// ---- (B) Koşu başına hazırlık ----
const reviewExtra=(ctx,row,g)=>{
  const doc=ctx.doc,rv=row.review,bits=[];
  // Karar sunucudan AYNEN taşınır (makine-okunur ham kod).
  if(REVIEW_STATES.includes(g.detail))bits.push(" ",h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:g.detail}));
  if(rv){
    bits.push(h(doc,"span",{class:"note",text:` ${ctx.t("readiness.review.by",{reviewer:rv.reviewer??MISSING,n:rv.cycle})}`}));
    bits.push(h(doc,"span",{class:"note",dataset:{independent:rv.independent===null?"unknown":rv.independent?"yes":"no"},text:` · ${ctx.t(`readiness.review.independent.${rv.independent===null?"unknown":rv.independent?"yes":"no"}`)}`}));
    if(rv.reviewedCommit)bits.push(" ",h(doc,"span",{class:"mono",title:rv.reviewedCommit,text:shortSha(rv.reviewedCommit)}));
    bits.push(" ",h(doc,"time",{datetime:rv.timestamp,text:formatDateTime(rv.timestamp,ctx.i18n.lang)}));
  }
  return bits;
};
const deliveryExtra=(ctx,row)=>{
  const doc=ctx.doc,d=row.delivery;
  if(d.state==="NOT_PREPARED")return [];
  return [h(doc,"p",{class:"note",dataset:{note:"source-only"},text:ctx.t("readiness.delivery.sourceOnlyNote")}),
    h(doc,"p",{class:"note"},ctx.t("readiness.delivery.commit")," ",d.commit?h(doc,"span",{class:"mono",title:d.commit,text:shortSha(d.commit)}):MISSING),
    h(doc,"p",{class:"note"},ctx.t("readiness.delivery.hash")," ",mono(doc,d.exportArtifactHash)),
    d.acceptedAt?h(doc,"p",{class:"note"},ctx.t("readiness.delivery.acceptedAt")," ",h(doc,"time",{datetime:d.acceptedAt,text:formatDateTime(d.acceptedAt,ctx.i18n.lang)})):null];
};
function facts(ctx,row,a){
  const doc=ctx.doc,t=ctx.t,rows=[];
  const add=(key,label,attrs,...dd)=>rows.push([h(doc,"dt",{text:label}),h(doc,"dd",{dataset:{field:key,...attrs}},...dd)]);
  // Başlık yalnız mission listesinden gelir; liste okunamadıysa ya da koşunun mission'ı listede yoksa bu AÇIKÇA söylenir (başlık uydurulmaz).
  add("mission",t("readiness.field.mission"),{},row.title!==null?row.title:t(a.titlesKnown?"readiness.mission.unknown":"readiness.mission.unread")," · ",mono(doc,row.missionId));
  add("runInfo",t("readiness.field.run"),{},mono(doc,row.runId)," · ",mono(doc,row.step)," · ",t("readiness.field.cycleN",{n:row.cycle}));
  add("updated",t("readiness.field.updated"),{},h(doc,"time",{datetime:row.updatedAt,text:formatDateTime(row.updatedAt,ctx.i18n.lang)}));
  add("head",t("readiness.field.head"),{},row.headSha?h(doc,"span",{class:"mono",title:row.headSha,text:shortSha(row.headSha)}):MISSING);
  for(const g of row.gates){
    const extra=g.id==="review"&&g.status!=="UNKNOWN"?reviewExtra(ctx,row,g):g.id==="delivery"?deliveryExtra(ctx,row):g.id==="run"&&g.status==="FAIL"?[" ",h(doc,"span",{class:"note",text:t("readiness.run.reason")})," ",h(doc,"span",{dataset:{readinessRunReason:""}},row.reason===null?MISSING:row.reason)]:[];
    add(g.id,t(`readiness.gate.${g.id}`),{gateStatus:g.status,gateDetail:g.detail},statePill(ctx,gateKind(g),{label:gateLabel(ctx,g)}),...extra);
  }
  return h(doc,"dl",{class:"readiness-facts"},rows.flat());
}
function missingList(ctx,row,headingId){
  const doc=ctx.doc;
  if(!row.missing.length)return h(doc,"p",{class:"note",dataset:{missing:"0"},text:ctx.t("readiness.missing.none")});
  return h(doc,"ul",{class:"readiness-missing","aria-labelledby":headingId,dataset:{missing:String(row.missing.length)}},row.missing.map(g=>
    h(doc,"li",{dataset:{gate:g.id,gateStatus:g.status,gateDetail:g.detail},text:ctx.t("readiness.missing.item",{gate:ctx.t(`readiness.gate.${g.id}`),state:gateLabel(ctx,g)})})));
}
/** Eylemler yalnız MEVCUT akışlara gezinmedir; burada hiçbir geçiş/onay/POST yoktur. */
function actions(ctx,row,heading){
  const doc=ctx.doc,sid=safeId(row.runId);
  return h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("readiness.actions.aria",{title:heading})},
    h(doc,"button",{type:"button",class:"btn",id:`rd-open-${sid}`,dataset:{focusKey:`rd-open-${sid}`,navigate:"work"},on:{click:()=>{selection.missionId=row.missionId;ctx.navigate("work")}},text:ctx.t("readiness.action.openMission")}),
    h(doc,"button",{type:"button",class:"btn",id:`rd-assure-${sid}`,dataset:{focusKey:`rd-assure-${sid}`,navigate:"assurance"},on:{click:()=>ctx.navigate("assurance")},text:ctx.t("readiness.action.openAssurance")}));
}
function runCard(ctx,row,a){
  const doc=ctx.doc,sid=safeId(row.runId),heading=String(row.title??row.runId),mid=`rd-missing-${sid}`;
  const by=row.gateById;
  return h(doc,"li",{class:"card readiness-item",dataset:{readinessItem:row.runId,tier:row.tier,runStatus:row.status,review:by.review.detail,security:by.security.detail,tests:by.tests.detail,delivery:by.delivery.detail,completion:by.completion.detail,integrity:by.integrity.detail}},
    h(doc,"h4",{text:heading}),
    h(doc,"p",{class:"readiness-overall panel-meta",dataset:{overall:row.tier}},
      statePill(ctx,TIER_PILL[row.tier],{label:ctx.t(`readiness.tier.${row.tier}`)}),
      h(doc,"span",{class:"note",text:ctx.t(`readiness.tierDesc.${row.tier}`)})),
    h(doc,"h5",{class:"readiness-subhead",id:mid,text:ctx.t("readiness.missing.title")}),
    missingList(ctx,row,mid),
    facts(ctx,row,a),
    actions(ctx,row,heading));
}
function runsPanel(ctx,res,a){
  const doc=ctx.doc,wr=res.workRuns;
  let body;
  if(!isOk(wr))body=h(doc,"p",{class:"note",role:"status",dataset:{readinessEmpty:"unknown"},text:ctx.t("readiness.emptyAll")});
  else if(!a.rows.length)body=h(doc,"p",{class:"note",role:"status",dataset:{readinessEmpty:"1"},text:ctx.t("readiness.empty")});
  else{
    const shown=a.rows.slice(0,MAX_READINESS_ROWS);
    body=[shown.length<a.rows.length?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:ctx.t("readiness.truncated",{shown:shown.length,total:a.rows.length})}):null,
      !a.complete?h(doc,"p",{class:"note",role:"status",dataset:{note:"gates-unknown"},text:ctx.t("readiness.unknownGates",{sources:a.unreadableRequired.map(k=>ctx.t(`readiness.srcShort.${k}`)).join(", ")})}):null,
      h(doc,"ol",{class:"cards readiness-list","aria-label":ctx.t("readiness.runs.aria"),dataset:{readinessList:String(shown.length)}},shown.map(r=>runCard(ctx,r,a)))];
  }
  return panel(ctx,{titleKey:"readiness.runs.title",id:"readiness-runs",className:"readiness-section"},
    h(doc,"p",{class:"note",text:ctx.t("readiness.runs.lead")}),
    h(doc,"p",{class:"note",dataset:{note:"order"},text:ctx.t("readiness.order.note")}),
    h(doc,"p",{class:"note",dataset:{note:"actions"},text:ctx.t("readiness.action.hint")}),
    body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [workRuns,reviews,evidence,missions]=await Promise.all([
    read(()=>api.readinessWorkRuns(),{runs:null}),
    read(()=>api.readinessReviews(),{reviews:null}),
    read(()=>api.readinessEvidence(),{evidence:null}),
    read(()=>api.readinessMissions(),{missions:null})
  ]);
  const res={workRuns,reviews,evidence,missions};
  const a=buildReadiness(res);
  return h(doc,"div",{class:"view view-readiness"},header(ctx),summaryPanel(ctx,res,a),runsPanel(ctx,res,a));
}
