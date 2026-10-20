// //TR: Bu görünüm Skill Academy'dir (Öğrenme & Yetkinlik; FA-V2-PRODUCT): YALNIZ salt-okunur GET /v1/academy gerçek okuma-modelinden okunur ve HİÇBİR veri uydurulmaz. KRİTİK DÜRÜSTLÜK: bu bir öğrenme/yetkinlik KATALOĞUDUR; hiçbir rolün sertifikalı ya da hiçbir ajanın eğitilmiş olduğunun KANITI DEĞİLDİR. Terfi etmiş öğrenme yalnız READONLY_KNOWLEDGE / SKILL_CANDIDATE_NOT_EXECUTABLE'dır (çalıştırılabilir değil), authorityEffect NONE'dır; sertifikalı sayısı daima 0 gösterilir ve proficiency NOT_EVALUATED olarak dürüstçe belirtilir. Backend verisi yoksa dürüst EMPTY/UNAVAILABLE gösterilir. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile,badge,stateNote,emptyNote} from "../components.js";
import {MISSING} from "../model.js";
import {ACADEMY_PATH,PROMOTED_STATUSES} from "../academy-core.js";

const isLive=res=>res&&res.state==="VERIFIED";
/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
function failKind(state){return state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED"}
const mono=(doc,t)=>t?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
const ratioText=(ctx,r)=>r?`${r.numerator}/${r.denominator} (${Math.round(r.rate*100)}%)`:ctx.t("academy.metrics.none");

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("academy.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.academy.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.academy.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("academy.readonly")}),
    // Dürüstlük uyarısı: katalog, sertifika kanıtı değildir.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("academy.honesty")}));
}

const blockOf=(res,value)=>({state:res.state,value:isLive(res)?value:null,loading:false,source:`GET ${ACADEMY_PATH}`,asOf:null});
function kpis(ctx,res){
  const doc=ctx.doc;
  const learnings=isLive(res)?res.learnings:[];
  const promoted=learnings.filter(l=>PROMOTED_STATUSES.includes(l.status)).length;
  const sources=isLive(res)?res.sources.length:0;
  return h(doc,"div",{class:"kpi-row academy-kpis",role:"group","aria-label":ctx.t("academy.kpiGroup")},
    kpiTile(ctx,{id:"academy-curricula",iconName:"layers",labelKey:"academy.kpi.curricula",block:blockOf(res,learnings.length),qualifier:ctx.t("academy.kpi.q.curricula")}),
    kpiTile(ctx,{id:"academy-knowledge",iconName:"evidence",labelKey:"academy.kpi.knowledge",block:blockOf(res,promoted),qualifier:ctx.t("academy.kpi.q.knowledge")}),
    // Sertifikalı: akademi hiç kimseyi sertifikalamaz; değer daima 0 ve nitelik satırı bunu açıkça söyler.
    kpiTile(ctx,{id:"academy-certified",iconName:"shield",labelKey:"academy.kpi.certified",block:blockOf(res,isLive(res)?0:null),pillKind:isLive(res)?"NOT_VERIFIED":failKind(res.state),qualifier:ctx.t("academy.kpi.q.certified")}),
    kpiTile(ctx,{id:"academy-sources",iconName:"folder",labelKey:"academy.kpi.sources",block:blockOf(res,sources),qualifier:ctx.t("academy.kpi.q.sources")}));
}

function stateBlock(ctx,res){
  const doc=ctx.doc,state=res.state;
  return h(doc,"div",{class:`academy-state state-${String(state).toLowerCase()}`,role:"status",dataset:{academyState:state}},
    h(doc,"p",{class:"academy-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`academy.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`academy.hint.${state}`,{source:`GET ${ACADEMY_PATH}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}

function tableWrap(ctx,id,captionKey,cols,rows){
  const doc=ctx.doc;
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table academy-table",id,dataset:{academyTable:id}},
    h(doc,"caption",{class:"sr-only",text:ctx.t(captionKey)}),
    h(doc,"thead",{},h(doc,"tr",{},cols.map(c=>h(doc,"th",{scope:"col",text:ctx.t(c)})))),
    h(doc,"tbody",{},rows)));
}

/** Öğrenme kaydı durum rozeti: terfi etmişse yalnız çalıştırılamaz BİLGİ (READONLY/aday) olarak; asla "sertifikalı/eğitilmiş" değil. */
function learningStatusPill(ctx,l){
  const promoted=l.promoted;
  return h(ctx.doc,"span",{},statePill(ctx,promoted?"NOT_VERIFIED":"NOT_EXECUTED",{label:l.status}),
    promoted?badge(ctx,ctx.t("academy.readonlyBadge"),"badge-notverified"):null);
}

function learningsPanel(ctx,res){
  const doc=ctx.doc;
  let body;
  if(!isLive(res))body=stateBlock(ctx,res);
  else if(!res.learnings.length)body=emptyNote(ctx,"academy.learnings.empty");
  else{
    const cols=["academy.col.learning","academy.col.role","academy.col.status","academy.col.trigger","academy.col.knowledge","academy.col.authority"];
    const rows=res.learnings.slice(0,200).map(l=>h(doc,"tr",{dataset:{learning:l.learningId,promoted:l.promoted?"1":"0"}},
      h(doc,"td",{},mono(doc,l.learningId)),
      h(doc,"td",{},l.roleId?mono(doc,l.roleId):MISSING),
      h(doc,"td",{},learningStatusPill(ctx,l)),
      h(doc,"td",{},l.trigger?mono(doc,l.trigger):MISSING),
      // Bilgi durumu: terfi etmişse READONLY/aday; değilse henüz terfi yok (dürüst).
      h(doc,"td",{},l.knowledgeStatus?mono(doc,l.knowledgeStatus):h(doc,"span",{class:"note",text:ctx.t("academy.notPromoted")})),
      // Yetki etkisi daima NONE + çalıştırılabilir değil (değişmez).
      h(doc,"td",{},h(doc,"span",{dataset:{authority:"NONE",executable:"false"}},ctx.t("academy.authority.none")))));
    body=[h(doc,"p",{class:"note",dataset:{note:"authority"},text:ctx.t("academy.learnings.authorityNote")}),tableWrap(ctx,"academy-learnings-table","academy.learnings.title",cols,rows)];
  }
  return panel(ctx,{titleKey:"academy.learnings.title",id:"academy-learnings",className:"academy-section"},
    h(doc,"p",{class:"note",text:ctx.t("academy.learnings.lead")}),body);
}

function sourcesPanel(ctx,res){
  const doc=ctx.doc;
  let body;
  if(!isLive(res))body=stateBlock(ctx,res);
  else if(!res.sources.length)body=emptyNote(ctx,"academy.sources.empty");
  else{
    const cols=["academy.col.source","academy.col.trust","academy.col.srcStatus","academy.col.scope"];
    const rows=res.sources.slice(0,200).map(s=>h(doc,"tr",{dataset:{source:s.sourceId}},
      h(doc,"td",{},mono(doc,s.sourceId)),
      h(doc,"td",{},s.sourceTrust?mono(doc,s.sourceTrust):MISSING),
      h(doc,"td",{},s.status?mono(doc,s.status):MISSING),
      h(doc,"td",{},ctx.t(s.global?"academy.scope.global":"academy.scope.tenant"))));
    body=tableWrap(ctx,"academy-sources-table","academy.sources.title",cols,rows);
  }
  return panel(ctx,{titleKey:"academy.sources.title",id:"academy-sources",className:"academy-section"},
    h(doc,"p",{class:"note",text:ctx.t("academy.sources.lead")}),body);
}

function metricsPanel(ctx,res){
  const doc=ctx.doc;
  if(!isLive(res))return panel(ctx,{titleKey:"academy.metrics.title",id:"academy-metrics",className:"academy-section"},h(doc,"p",{class:"note",text:ctx.t("academy.metrics.lead")}),stateBlock(ctx,res));
  const m=res.metrics;
  const rows=[
    ["academy.metrics.gapDetect",m&&m.gapDetect?String(m.gapDetect.total):ctx.t("academy.metrics.none")],
    ["academy.metrics.sourceCredibility",m&&m.sourceCredibility?String(m.sourceCredibility.total):ctx.t("academy.metrics.none")],
    ["academy.metrics.knowledgeFreshness",ratioText(ctx,m&&m.knowledgeFreshness)],
    ["academy.metrics.labPassRate",ratioText(ctx,m&&m.labPassRate)],
    ["academy.metrics.promotionReversalRate",ratioText(ctx,m&&m.promotionReversalRate)],
    ["academy.metrics.reuseSuccess",ratioText(ctx,m&&m.reuseSuccess)],
    ["academy.metrics.falseCertification",ratioText(ctx,m&&m.falseCertificationRate)]
  ];
  const list=h(doc,"dl",{class:"academy-metrics",dataset:{academyMetrics:"1"}},rows.flatMap(([k,v])=>[
    h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",{class:"mono",dataset:{metric:k.split(".").pop()},text:v})]));
  return panel(ctx,{titleKey:"academy.metrics.title",id:"academy-metrics",className:"academy-section"},
    h(doc,"p",{class:"note",text:ctx.t("academy.metrics.lead")}),
    list,
    // §5.3 değişmezi: yanlış sertifika oranı 0 olmalıdır; etiketli veri gerektiren metrikler (precision/recall) hiç gösterilmez (uydurulmaz).
    h(doc,"p",{class:"note",dataset:{note:"false-cert"},text:ctx.t("academy.metrics.falseCertNote")}));
}

function knowledgePanel(ctx,res){
  const doc=ctx.doc;
  let body;
  if(!isLive(res))body=stateBlock(ctx,res);
  else if(!res.globalKnowledge.length)body=emptyNote(ctx,"academy.knowledge.empty");
  else{
    const cols=["academy.col.learning","academy.col.role","academy.col.knowledge"];
    const rows=res.globalKnowledge.slice(0,200).map(g=>h(doc,"tr",{dataset:{knowledge:g.learningId}},
      h(doc,"td",{},mono(doc,g.learningId)),
      h(doc,"td",{},g.roleId?mono(doc,g.roleId):MISSING),
      h(doc,"td",{},g.knowledgeStatus?mono(doc,g.knowledgeStatus):MISSING)));
    body=tableWrap(ctx,"academy-knowledge-table","academy.knowledge.title",cols,rows);
  }
  return panel(ctx,{titleKey:"academy.knowledge.title",id:"academy-knowledge",className:"academy-section"},
    h(doc,"p",{class:"note",text:ctx.t("academy.knowledge.lead")}),body);
}

const dd=(doc,kt,ctx,...kids)=>[h(doc,"dt",{text:ctx.t(kt)}),h(doc,"dd",{},...kids)];
const notVerified=ctx=>statePill(ctx,"NOT_VERIFIED");
const monoList=(ctx,xs)=>xs.length?h(ctx.doc,"span",{},xs.flatMap(v=>[mono(ctx.doc,v)," "])):h(ctx.doc,"span",{class:"note",text:ctx.t("academy.evidence.missing")});
/** //TR: Tek öğrenmenin kanıt satırı (details/summary); her bağ NOT_VERIFIED, sha256 yeniden doğrulanmaz. */
function evidenceItem(ctx,res,l){
  const doc=ctx.doc,e=l.evidence;
  const known=new Set(res.sources.map(s=>s.sourceId));
  const srcRow=id=>h(doc,"li",{dataset:{evidenceSource:id,evidenceXref:known.has(id)?"FOUND":"UNKNOWN"}},mono(doc,id)," ",
    known.has(id)?h(doc,"span",{class:"note",text:ctx.t("academy.evidence.xrefFound")}):statePill(ctx,"UNAVAILABLE",{label:ctx.t("academy.evidence.unknown")}));
  const lab=e.labResult;
  const labText=!lab?ctx.t("academy.evidence.missing"):`${lab.passed===null?ctx.t("academy.evidence.unknown"):ctx.t(lab.passed?"academy.evidence.labPassed":"academy.evidence.labFailed")} · ${ctx.t("academy.evidence.testRefs",{n:lab.testRefCount})}${lab.recordedAt?` · ${lab.recordedAt}`:""}`;
  const mine=res.reuseEvents.filter(r=>r.learningId===l.learningId);
  const reuseRows=mine.length?h(doc,"ul",{class:"evidence-list"},mine.map(r=>h(doc,"li",{dataset:{evidenceReuse:r.reuseId||""}},
    mono(doc,r.outcome||ctx.t("academy.evidence.unknown"))," ",r.missionRef?mono(doc,r.missionRef):MISSING," ",r.at?mono(doc,r.at):MISSING))):h(doc,"span",{class:"note",text:ctx.t("academy.evidence.noReuse")});
  const rv=e.reviewerRef;
  return h(doc,"details",{class:"evidence-item",dataset:{evidenceLearning:l.learningId}},
    h(doc,"summary",{},mono(doc,l.learningId)," ",notVerified(ctx)),
    h(doc,"dl",{class:"evidence-dl"},
      dd(doc,"academy.evidence.sources",ctx,e.sourceIds.length?h(doc,"ul",{class:"evidence-list"},e.sourceIds.map(srcRow)):h(doc,"span",{class:"note",text:ctx.t("academy.evidence.missing")})),
      dd(doc,"academy.evidence.supporting",ctx,e.supportingSourceIds.length?h(doc,"ul",{class:"evidence-list"},e.supportingSourceIds.map(srcRow)):h(doc,"span",{class:"note",text:ctx.t("academy.evidence.missing")})),
      dd(doc,"academy.evidence.lab",ctx,h(doc,"span",{dataset:{evidenceLab:"1"},text:labText})),
      dd(doc,"academy.evidence.labRuns",ctx,monoList(ctx,e.labRunRefs)),
      dd(doc,"academy.evidence.negative",ctx,monoList(ctx,e.negativeEvalRefs)),
      dd(doc,"academy.evidence.reviewer",ctx,rv?h(doc,"span",{},mono(doc,rv.ref)," ",mono(doc,rv.sha256Short)):h(doc,"span",{class:"note",text:ctx.t("academy.evidence.missing")})),
      dd(doc,"academy.evidence.reviewerRun",ctx,e.reviewerRunRef?mono(doc,e.reviewerRunRef):MISSING),
      dd(doc,"academy.evidence.drift",ctx,h(doc,"span",{class:"mono",text:String(e.driftCount)})),
      dd(doc,"academy.evidence.reuse",ctx,reuseRows)),
    h(doc,"p",{class:"note",dataset:{evidenceLinkage:"NOT_VERIFIED"},text:ctx.t("academy.evidence.note")}));
}
function evidencePanel(ctx,res){
  const doc=ctx.doc;
  let body;
  if(!isLive(res))body=stateBlock(ctx,res);
  else if(!res.learnings.length)body=emptyNote(ctx,"academy.evidence.empty");
  else body=h(doc,"div",{class:"evidence-library",dataset:{evidenceLibrary:"1"}},res.learnings.slice(0,200).map(l=>evidenceItem(ctx,res,l)));
  return panel(ctx,{titleKey:"academy.evidence.title",id:"academy-evidence",className:"academy-section"},
    h(doc,"p",{class:"note",text:ctx.t("academy.evidence.lead")}),body);
}

/** Yetkinlik/sertifika dürüstlük paneli: akademi sertifikalamaz; proficiency NOT_EVALUATED, 0 sertifikalı. */
function proficiencyPanel(ctx){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"academy.proficiency.title",id:"academy-proficiency",className:"academy-section academy-honesty"},
    h(doc,"p",{class:"academy-state-head",dataset:{proficiency:"NOT_EVALUATED"}},statePill(ctx,"NOT_VERIFIED"),h(doc,"strong",{text:ctx.t("academy.proficiency.state")})),
    h(doc,"p",{class:"note",text:ctx.t("academy.proficiency.body")}),
    h(doc,"p",{class:"note",dataset:{note:"not-certified"},text:ctx.t("academy.notCertified")}));
}

export async function render(ctx){
  const doc=ctx.doc;
  let res;try{res=await ctx.api.academy()}catch{res={state:"ERROR",learnings:[],sources:[],reuses:0,reuseEvents:[],globalKnowledge:[],byStatus:{},metrics:null}}
  if(!res||typeof res.state!=="string")res={state:"UNAVAILABLE",learnings:[],sources:[],reuses:0,reuseEvents:[],globalKnowledge:[],byStatus:{},metrics:null};
  return h(doc,"div",{class:"view view-academy"},
    header(ctx),
    kpis(ctx,res),
    proficiencyPanel(ctx),
    learningsPanel(ctx,res),
    knowledgePanel(ctx,res),
    evidencePanel(ctx,res),
    sourcesPanel(ctx,res),
    metricsPanel(ctx,res));
}
