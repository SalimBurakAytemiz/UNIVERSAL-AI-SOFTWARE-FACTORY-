// //TR: Bu görünüm Güvence (QA + Güvenlik) alanıdır. Üç gerçek-veri katmanı + bir dürüst kapı katmanı içerir:
// (1) QA/Güvenlik genel bakışı: kanıt bütünlüğü sayıları GET /v1/cockpit evidence bloğundan (yalnız VERIFIED/STALE ve geçerli tamsayı), güvenlik duruşu GET /v1/work-runs SECURITY_REPORT kanıtından toplanır;
// (2) Güvenlik statik taraması: her work-run'ın en son güvenlik aşaması (secret-scan + gitleaks/trivy/semgrep durumu, core/workos/security-tools.ts); araç yoksa NOT_INSTALLED, kapsam eksikse PARTIAL, kanıt yoksa NOT_EXECUTED — asla sahte "temiz/geçti";
// (3) Kanıt yüzeyi (DEĞİŞMEDİ): GET /v1/evidence listesi doğrulama çipleriyle (VERIFIED/MISMATCH/MISSING/UNVERIFIABLE) + detay (kaynak yolu, sha256, redakte log);
// (3b) UI-049 Reviews: GET /v1/reviews (+ /:evd_id) bağımsız review kararları AYNEN, yükseltilmeden; veri yoksa dürüst boş/UNAVAILABLE/ERROR durumu;
// (3c) UI-050 Soyağacı: GET /v1/evidence liste alanlarından (missionId, runId) mission->run->evidence; eksik alan gruplanmamış, bağ çıkarımı yok;
// (3d) UI-051 Test raporu: GET /v1/work-runs test kanıt kayıtlarından koşu başına durum (+ GET /v1/evidence?runId= çapraz doğrulama); kanıt yoksa NOT_EXECUTED, "geçti" asla üretilmez;
// (4) Dinamik QA — Founder kapısı (BLOCKED): testleri çalıştırma, görsel/API/web/mobil/masaüstü yürütme, cihaz farmı, canlı önizleme FD-REL-1 (yürütme) + ücretli cihaz farmı kapısındadır; bu yüzey ASLA sahte koş/geçti/kapsam göstermez, "koş" düğmesi yoktur ve SOURCE_GENERATION_COMPLETE asla PRODUCT_VERIFIED sayılmaz. 404 => UNAVAILABLE; veri yalnız h()/textContent ile çizilir, HTML olarak yorumlanmaz.
import {h,panel,stateNote,emptyNote,chip,verificationChip,statePill,miniBars,badge} from "../components.js";
import {MISSING,formatCount} from "../model.js";
import {VERIFICATION_STATES,filterEvidence,formatDateTime} from "../work-core.js";
import {drafts,selection,field} from "../forms.js";
import {mapSecurityScans,evidenceIntegrity,buildLineage,reviewRowVerified,mapTestReports} from "../assurance-core.js";
import {icon} from "../icons.js";

const PAGE_LIMIT=100;
const SCAN_LIMIT=150;
// //TR: Seçili güvenlik tarama koşusu görünüm ömrü boyunca korunur (periyodik yenileme seçimi bozmaz).
const secState={runId:null};
export function resetAssuranceView(){secState.runId=null;revState.id=null;trState.runId=null}

// //TR: Dinamik QA yetenekleri Founder kapısındadır; her satır dürüst BLOCKED/NOT_EXECUTED taşır, hiçbiri yürütme tetiklemez.
const DYNAMIC_QA=Object.freeze([
  {id:"unitTests",pill:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"e2eTests",pill:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"apiTests",pill:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"webTests",pill:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"visualTests",pill:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"desktopTests",pill:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"mobileTests",pill:"BLOCKED",gate:"FD-REL-1 + DEVICE_FARM"},
  {id:"deviceFarm",pill:"BLOCKED",gate:"FD-REL-1 + DEVICE_FARM"},
  {id:"livePreview",pill:"BLOCKED",gate:"FD-REL-1"}
]);

// //TR: Güvenlik aşaması headline durumu -> ayrık rozet. Renk tek başına anlam taşımaz (ikon+metin); PASSED yalnız gerçek aşama PASSED + commit'e bağlıyken, asla PRODUCT_VERIFIED olarak değil.
const SCAN_PILL=Object.freeze({PASSED:"VERIFIED",PARTIAL:"STALE",BLOCKED:"BLOCKED",STALE:"STALE",NOT_EXECUTED:"NOT_EXECUTED"});
function scanPill(ctx,status){
  const kind=SCAN_PILL[status]??"NOT_EXECUTED",p=statePill(ctx,kind,{label:ctx.t(`qa.scan.${status}`)});
  p.dataset.scan=status;return p;
}
// //TR: Araç/alt-durum kodu nötr rozet olarak OLDUĞU GİBİ gösterilir (CLEAN/FINDINGS/NOT_INSTALLED/PARTIAL/ERROR/NOT_AVAILABLE/UNKNOWN); sözlükte karşılığı yoksa ham kod.
function codeChip(ctx,value,{data}={}){
  const raw=String(value??MISSING),key=`qa.code.${raw}`,label=ctx.t(key),span=h(ctx.doc,"span",{class:"qa-code",dataset:data?{code:raw,...data}:{code:raw}},label===key?raw:label);
  return span;
}
const TOOL_PILL=Object.freeze({INSTALLED:"NEUTRAL",NOT_INSTALLED:"NOT_CONNECTED",ERROR:"FAILED"});
function toolPill(ctx,t){
  const kind=TOOL_PILL[t.status]??"FAILED",label=`${ctx.t(`qa.tool.${t.tool}`)} · ${ctx.t(`qa.tool.${t.status}`)}`,p=statePill(ctx,kind,{label});
  p.dataset.tool=t.tool;p.dataset.toolStatus=t.status;if(t.version)p.setAttribute("title",t.version);return p;
}

function stat(ctx,id,labelKey,value,{sub=null,tone=null}={}){
  const doc=ctx.doc;
  return h(doc,"div",{class:"wf-stat qa-stat",dataset:tone?{stat:id,tone}:{stat:id}},
    h(doc,"span",{class:"wf-stat-num",text:formatCount(value)}),h(doc,"span",{class:"wf-stat-label",text:ctx.t(labelKey)}),
    sub?h(doc,"span",{class:"wf-stat-sub",text:sub}):null);
}

// ---------- (1) Genel bakış ----------
function evidencePanel(ctx,ev){
  const doc=ctx.doc;
  if(!ev.live)return panel(ctx,{titleKey:"qa.evidence.title",id:"qa-evidence",className:"qa-evidence"},
    h(doc,"p",{class:"note",text:ctx.t("qa.evidence.lead")}),stateNote(ctx,ev.state),h(doc,"p",{class:"note mono",text:ctx.t("qa.overview.source")}));
  const bars=miniBars(ctx,[
    {key:"verified",value:ev.verified,label:ctx.t("everif.VERIFIED"),tone:"ok"},
    {key:"mismatch",value:ev.mismatch,label:ctx.t("everif.MISMATCH"),tone:"danger"},
    {key:"missing",value:ev.missing,label:ctx.t("everif.MISSING"),tone:"danger"},
    {key:"unverifiable",value:ev.unverifiable,label:ctx.t("everif.UNVERIFIABLE"),tone:"muted"}],ctx.t("qa.evidence.bars"));
  return panel(ctx,{titleKey:"qa.evidence.title",id:"qa-evidence",className:"qa-evidence"},
    h(doc,"p",{class:"note",text:ctx.t("qa.evidence.lead")}),
    h(doc,"div",{class:"wf-stats qa-stats",role:"group","aria-label":ctx.t("qa.evidence.statsLabel")},
      stat(ctx,"total","qa.evidence.total",ev.total),
      stat(ctx,"verified","qa.evidence.verified",ev.verified,{tone:"ok"}),
      stat(ctx,"mismatch","qa.evidence.mismatch",ev.mismatch,{tone:ev.mismatch>0?"danger":null}),
      stat(ctx,"missing","qa.evidence.missing",ev.missing,{tone:ev.missing>0?"danger":null}),
      stat(ctx,"unverifiable","qa.evidence.unverifiable",ev.unverifiable,{tone:"muted"})),
    bars??emptyNote(ctx,"qa.evidence.noBars"),
    h(doc,"p",{class:"note mono",text:ctx.t("qa.overview.source")}));
}
function posturePanel(ctx,scans){
  const doc=ctx.doc;
  if(scans.state!=="VERIFIED")return panel(ctx,{titleKey:"qa.posture.title",id:"qa-posture",className:"qa-posture"},
    h(doc,"p",{class:"note",text:ctx.t("qa.posture.lead")}),stateNote(ctx,scans.state),h(doc,"p",{class:"note mono",text:ctx.t("qa.security.source")}));
  const a=scans.aggregate,bs=a.byStatus;
  const bars=miniBars(ctx,[
    {key:"passed",value:bs.PASSED,label:ctx.t("qa.scan.PASSED"),tone:"ok"},
    {key:"partial",value:bs.PARTIAL,label:ctx.t("qa.scan.PARTIAL"),tone:"warn"},
    {key:"blocked",value:bs.BLOCKED,label:ctx.t("qa.scan.BLOCKED"),tone:"danger"},
    {key:"stale",value:bs.STALE,label:ctx.t("qa.scan.STALE"),tone:"warn"},
    {key:"notrun",value:bs.NOT_EXECUTED,label:ctx.t("qa.scan.NOT_EXECUTED"),tone:"muted"}],ctx.t("qa.posture.bars"));
  return panel(ctx,{titleKey:"qa.posture.title",id:"qa-posture",className:"qa-posture"},
    h(doc,"p",{class:"note",text:ctx.t("qa.posture.lead")}),
    h(doc,"p",{class:"note note-catalog",role:"note",dataset:{posture:a.blocked>0?"BLOCKED":"OK"},text:ctx.t("qa.posture.summary",{total:String(a.total),scanned:String(a.scanned),blocked:String(a.blocked),partial:String(bs.PARTIAL),passed:String(bs.PASSED)})}),
    h(doc,"div",{class:"wf-stats qa-stats",role:"group","aria-label":ctx.t("qa.posture.statsLabel")},
      stat(ctx,"passed","qa.scan.PASSED",bs.PASSED,{tone:"ok"}),
      stat(ctx,"partial","qa.scan.PARTIAL",bs.PARTIAL,{tone:bs.PARTIAL>0?"warn":null}),
      stat(ctx,"blocked","qa.scan.BLOCKED",bs.BLOCKED,{tone:bs.BLOCKED>0?"danger":null}),
      stat(ctx,"notrun","qa.scan.NOT_EXECUTED",bs.NOT_EXECUTED,{tone:"muted"})),
    bars??null,
    h(doc,"p",{class:"note",text:ctx.t("qa.posture.note")}),
    h(doc,"p",{class:"note mono",text:ctx.t("qa.security.source")}));
}

// ---------- (4) Dinamik QA — Founder kapısı ----------
function dynamicQaPanel(ctx){
  const doc=ctx.doc;
  const rows=DYNAMIC_QA.map(g=>h(doc,"tr",{dataset:{gate:g.id,state:g.pill}},
    h(doc,"td",{text:ctx.t(`qa.dyn.${g.id}`)}),
    h(doc,"td",{},statePill(ctx,g.pill)),
    h(doc,"td",{class:"mono",text:g.gate})));
  return panel(ctx,{titleKey:"qa.dyn.title",id:"qa-dynamic",className:"qa-dynamic"},
    h(doc,"p",{class:"note note-blocked",role:"note",dataset:{gateLead:"FD-REL-1"},text:ctx.t("qa.dyn.lead")}),
    h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table qa-dyn-table"},
      h(doc,"caption",{class:"sr-only",text:ctx.t("qa.dyn.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},["qa.dyn.col.capability","qa.dyn.col.state","qa.dyn.col.gate"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},rows))),
    h(doc,"p",{class:"note",dataset:{gateNote:"1"},text:ctx.t("qa.dyn.gateNote")}));
}

// ---------- (2) Güvenlik statik taraması ----------
function securityRow(ctx,r){
  const doc=ctx.doc,on=secState.runId===r.runId;
  const gl=r.secrets.gitleaks,sca=r.sca;
  return h(doc,"tr",{class:on?"row-selected":null,dataset:{runId:r.runId,scan:r.scanStatus}},
    h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn mono",id:`sec-${r.runId}`,dataset:{focusKey:`sec-${r.runId}`},"aria-current":on?"true":null,"aria-label":ctx.t("qa.security.select",{id:r.runId}),
      on:{click:()=>{secState.runId=r.runId;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:["id:qa-secdetail-t",`id:sec-${r.runId}`]})}},text:r.runId})),
    h(doc,"td",{},scanPill(ctx,r.scanStatus)),
    h(doc,"td",{},r.scanned?codeChip(ctx,gl.status,{data:{secrets:"gitleaks"}}):codeChip(ctx,"UNKNOWN")),
    h(doc,"td",{},r.scanned?codeChip(ctx,sca.status,{data:{sca:"trivy"}}):codeChip(ctx,"UNKNOWN")),
    h(doc,"td",{},r.tools.length?h(doc,"div",{class:"qa-tool-row"},r.tools.map(t=>toolPill(ctx,t))):h(doc,"span",{class:"note",text:ctx.t("qa.security.noTools")})),
    h(doc,"td",{class:"mono",text:r.commitSha?r.commitSha.slice(0,12):MISSING}));
}
function securityPanel(ctx,scans){
  const doc=ctx.doc;
  if(scans.state!=="VERIFIED")return panel(ctx,{titleKey:"qa.security.title",id:"qa-security",className:"qa-security"},
    h(doc,"p",{class:"note",text:ctx.t("qa.security.lead")}),stateNote(ctx,scans.state),h(doc,"p",{class:"note mono",text:ctx.t("qa.security.source")}));
  const runs=scans.runs;
  if(!runs.length)return panel(ctx,{titleKey:"qa.security.title",id:"qa-security",className:"qa-security"},
    h(doc,"p",{class:"note",text:ctx.t("qa.security.lead")}),emptyNote(ctx,"qa.security.none"),h(doc,"p",{class:"note mono",text:ctx.t("qa.security.source")}));
  const page=runs.slice(0,SCAN_LIMIT);
  const cols=["qa.security.col.run","qa.security.col.status","qa.security.col.secrets","qa.security.col.sca","qa.security.col.tools","qa.security.col.commit"];
  return panel(ctx,{titleKey:"qa.security.title",id:"qa-security",className:"qa-security"},
    h(doc,"p",{class:"note",text:ctx.t("qa.security.lead")}),
    h(doc,"p",{class:"note",dataset:{results:"1"},text:ctx.t("qa.security.results",{shown:String(page.length),total:String(runs.length)})}),
    h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table qa-sec-table"},
      h(doc,"caption",{class:"sr-only",text:ctx.t("qa.security.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},page.map(r=>securityRow(ctx,r))))),
    runs.length>SCAN_LIMIT?h(doc,"p",{class:"note",dataset:{truncated:"1"},text:ctx.t("qa.security.more",{n:String(runs.length-SCAN_LIMIT)})}):null,
    h(doc,"p",{class:"note",text:ctx.t("qa.tool.installedNote")}),
    h(doc,"p",{class:"note mono",text:ctx.t("qa.security.source")}));
}
// //TR: UI-047: yalnız-metin, salt-okunur bulgu tabloları. Düzeltildi/çözüldü/kabul edildi durumu YOK; tarama yok/bağlı değilse UNKNOWN/NOT_EXECUTED/STALE dürüstçe belirtilir.
// //TR: Boş liste yalnız araç durumu tam olarak CLEAN/FINDINGS ise "bulgu yok" gösterir; ERROR/PARTIAL/diğer durumda "kaydedilmedi" (UNKNOWN) gösterilir, yumuşak "temiz" izlenimi verilmez.
function findingTable(ctx,kind,list,cols,rowCells,aggregate,truncatedFlag,toolStatus){
  const doc=ctx.doc,lbl=k=>ctx.t(`qa.security.find.${k}`);
  const trunc=truncatedFlag||list.overCap||(aggregate!==null&&aggregate>list.items.length+list.dropped);
  const noneOk=toolStatus==="CLEAN"||toolStatus==="FINDINGS";
  const body=!list.recorded||(!list.items.length&&!noneOk)?h(doc,"p",{class:"note",dataset:{findState:"UNKNOWN"},text:lbl("notRecorded")})
    :!list.items.length?h(doc,"p",{class:"note",dataset:{findState:"EMPTY"},text:lbl("empty")})
    :h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table qa-find-table"},
      h(doc,"caption",{class:"sr-only",text:lbl(`${kind}.caption`)}),
      h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:lbl(`${kind}.col.${k}`)})))),
      h(doc,"tbody",{},list.items.map(it=>h(doc,"tr",{dataset:it.severity?{findKind:kind,findSeverity:it.severity}:{findKind:kind}},rowCells(it).map(c=>h(doc,"td",{class:"mono",text:c===null||c===undefined?MISSING:String(c)})))))));
  return h(doc,"section",{class:"qa-find",dataset:{findList:kind}},
    h(doc,"h4",{class:"qa-def-title",text:lbl(`${kind}.title`)}),body,
    list.dropped?h(doc,"p",{class:"note",dataset:{findDropped:String(list.dropped)},text:ctx.t("qa.security.find.dropped",{n:String(list.dropped)})}):null,
    trunc?h(doc,"p",{class:"note note-stale",role:"note",dataset:{findTruncated:kind},text:lbl("truncated")}):null);
}
function findingTables(ctx,r){
  const doc=ctx.doc;
  const sca=findingTable(ctx,"sca",r.scaFindings,["package","version","id","severity","target"],f=>[f.package,f.version,f.id,f.severity,f.target],Object.keys(r.sca.counts).length?Object.values(r.sca.counts).reduce((a,b)=>a+b,0):null,r.scaTruncated,r.sca.status);
  const sec=findingTable(ctx,"secret",r.secretFindings,["rule","file","line","commit"],f=>[f.ruleId,f.file,f.line,f.commit],r.secrets.gitleaks.findings,false,r.secrets.gitleaks.status);
  return h(doc,"div",{class:"qa-find-wrap",dataset:{findWrap:"1"}},sca,sec);
}
function securityDetail(ctx,scans){
  const doc=ctx.doc;
  // //TR: panel() zaten id="qa-secdetail-t" başlığını üretir; yinelenen id yerine bu başlığı odaklanabilir (tabindex=-1) yaparız.
  const base=(...kids)=>{const p=panel(ctx,{titleKey:"qa.security.detail.title",id:"qa-secdetail",className:"qa-secdetail"},...kids);const t=p.children[0];if(t)t.setAttribute("tabindex","-1");return p};
  if(!secState.runId)return base(emptyNote(ctx,"qa.security.detail.none"));
  const r=scans.state==="VERIFIED"?scans.runs.find(x=>x.runId===secState.runId):null;
  if(!r)return base(stateNote(ctx,"UNAVAILABLE","qa.security.detail.gone"));
  const close=h(doc,"button",{type:"button",class:"btn btn-small",id:"qa-secdetail-close",dataset:{focusKey:"qa-secdetail-close"},text:ctx.t("qa.security.detail.close"),
    on:{click:()=>{const id=r.runId;secState.runId=null;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:[`id:sec-${id}`,"id:qa-security-t"]})}}});
  const head=h(doc,"div",{class:"qa-secdetail-head"},h(doc,"span",{class:"mono qa-secdetail-id",text:r.runId}),scanPill(ctx,r.scanStatus),close);
  if(!r.scanned)return base(head,h(doc,"p",{class:"note note-blocked",role:"note",text:ctx.t("qa.security.detail.notScanned")}));
  const kv=(labelKey,value,extra)=>h(doc,"div",{},h(doc,"dt",{text:ctx.t(labelKey)}),h(doc,"dd",extra?.cls?{class:extra.cls}:{},value));
  const sevText=Object.keys(r.sca.counts).length?Object.entries(r.sca.counts).map(([k,v])=>`${k} ${v}`).join(" · "):MISSING;
  const gaps=r.gaps.length?h(doc,"ul",{class:"qa-gaps"},r.gaps.map(g=>h(doc,"li",{class:"mono",text:g}))):h(doc,"p",{class:"note",text:ctx.t("qa.security.detail.noGaps")});
  return base(head,
    r.commitBound?null:h(doc,"p",{class:"note note-stale",role:"note",text:ctx.t("qa.security.detail.commitStale")}),
    h(doc,"dl",{class:"kv qa-secdetail-kv"},
      kv("qa.security.detail.stage",codeChip(ctx,r.stageStatus??"UNKNOWN")),
      r.blockReason?kv("qa.security.detail.blockReason",codeChip(ctx,r.blockReason)):null,
      kv("qa.security.detail.commit",h(doc,"span",{class:"mono",text:r.commitSha??MISSING})),
      kv("qa.security.detail.secretsBuiltin",h(doc,"span",{},codeChip(ctx,r.secrets.builtin.status)," ",r.secrets.builtin.hits!==null?ctx.t("qa.security.detail.hits",{n:String(r.secrets.builtin.hits)}):"")),
      kv("qa.security.detail.gitleaks",h(doc,"span",{},codeChip(ctx,r.secrets.gitleaks.status)," ",r.secrets.gitleaks.findings!==null?ctx.t("qa.security.detail.hits",{n:String(r.secrets.gitleaks.findings)}):"")),
      kv("qa.security.detail.sca",h(doc,"span",{},codeChip(ctx,r.sca.status)," ",r.sca.blocking!==null?ctx.t("qa.security.detail.blocking",{n:String(r.sca.blocking)}):""," ",h(doc,"span",{class:"mono",text:sevText}))),
      kv("qa.security.detail.sast",h(doc,"span",{},codeChip(ctx,r.sast.status)," ",r.sast.reason?codeChip(ctx,r.sast.reason):"")),
      kv("qa.security.detail.sbom",h(doc,"span",{},codeChip(ctx,r.sbom.status)," ",r.sbom.reason?codeChip(ctx,r.sbom.reason):""))),
    findingTables(ctx,r),
    h(doc,"h4",{class:"qa-def-title",text:ctx.t("qa.security.detail.tools")}),
    r.tools.length?h(doc,"div",{class:"qa-tool-row"},r.tools.map(t=>toolPill(ctx,t))):emptyNote(ctx,"qa.security.noTools"),
    h(doc,"h4",{class:"qa-def-title",text:ctx.t("qa.security.detail.gaps")}),gaps,
    r.founderNote?h(doc,"details",{class:"qa-foundernote"},h(doc,"summary",{text:ctx.t("qa.security.detail.founderNote")}),h(doc,"p",{class:"note",text:r.founderNote})):null);
}

// ---------- (5) UI-049: Bağımsız review kararları (GET /v1/reviews, GET /v1/reviews/:evd_id) ----------
// //TR: Karar sunucudan AYNEN gösterilir; CLEAN yalnız bağımsızlığı kanıtlı ve incelenen commit güncel head ise VERIFIED rozetidir, aksi halde STALE (asla yükseltilmez). Veri yoksa dürüst boş durum; uydurma karar yok. Seçim görünüm ömrü boyunca korunur.
const revState={id:null};
const REVIEW_LIMIT=100;
function verdictPill(ctx,r,verified){
  const kind=r.verdict==="BLOCKED"?"BLOCKED":r.verdict==="NO_VERDICT"?"NOT_EXECUTED":verified===true?"VERIFIED":"STALE";
  const p=statePill(ctx,kind,{label:r.verdict});p.dataset.verdict=r.verdict;return p;
}
function indepText(ctx,v){return ctx.t(v===true?"assurance.reviews.indep.yes":v===false?"assurance.reviews.indep.no":"assurance.reviews.indep.unknown")}
function reviewRow(ctx,r,runs){
  const doc=ctx.doc,on=revState.id===r.reviewId;
  return h(doc,"tr",{class:on?"row-selected":null,dataset:{reviewId:r.reviewId,verdict:r.verdict}},
    h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn mono",id:`rev-${r.reviewId}`,dataset:{focusKey:`rev-${r.reviewId}`},"aria-current":on?"true":null,"aria-label":ctx.t("assurance.reviews.select",{id:r.reviewId}),
      on:{click:()=>{revState.id=r.reviewId;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:["id:as-reviews-detail-h",`id:rev-${r.reviewId}`]})}},text:r.reviewId})),
    h(doc,"td",{},verdictPill(ctx,r,reviewRowVerified(r,runs))),
    h(doc,"td",{class:"mono",text:r.runId}),
    h(doc,"td",{class:"mono",text:r.missionId}),
    h(doc,"td",{text:indepText(ctx,r.independent)}),
    h(doc,"td",{text:formatDateTime(r.timestamp,ctx.i18n.lang)}));
}
function reviewsPanel(ctx,res){
  const doc=ctx.doc,mk=(...k)=>panel(ctx,{titleKey:"assurance.reviews.title",id:"as-reviews",className:"as-reviews"},h(doc,"p",{class:"note",text:ctx.t("assurance.reviews.lead")}),...k,h(doc,"p",{class:"note mono",text:ctx.t("assurance.reviews.source")}));
  if(res.state!=="VERIFIED"||!res.reviews)return mk(stateNote(ctx,res.state==="VERIFIED"?"ERROR":res.state));
  const recs=res.reviews.records;
  if(!recs.length)return mk(emptyNote(ctx,"assurance.reviews.none"));
  const page=recs.slice(0,REVIEW_LIMIT),cols=["assurance.reviews.col.id","assurance.reviews.col.verdict","assurance.reviews.col.run","assurance.reviews.col.mission","assurance.reviews.col.independent","assurance.reviews.col.time"];
  return mk(
    h(doc,"p",{class:"note",dataset:{results:"reviews"},text:ctx.t("assurance.reviews.results",{shown:String(page.length),total:String(recs.length)})}),
    h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table as-reviews-table"},
      h(doc,"caption",{class:"sr-only",text:ctx.t("assurance.reviews.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},page.map(r=>reviewRow(ctx,r,res.reviews.runs))))),
    res.reviews.truncated?h(doc,"p",{class:"note",dataset:{truncated:"reviews"},text:ctx.t("assurance.reviews.truncated")}):null);
}
async function reviewDetailPanel(ctx){
  const doc=ctx.doc;
  const base=(...kids)=>panel(ctx,{titleKey:"assurance.reviews.detail.title",id:"as-reviews-detail",className:"as-reviews"},h(doc,"h3",{id:"as-reviews-detail-h",tabindex:"-1",class:"sr-only",text:ctx.t("assurance.reviews.detail.title")}),...kids);
  if(!revState.id)return base(emptyNote(ctx,"assurance.reviews.detail.none"));
  const res=await ctx.api.assuranceReview(revState.id);
  if(res.state!=="VERIFIED"||!res.review)return base(stateNote(ctx,res.state==="VERIFIED"?"ERROR":res.state));
  const r=res.review,id=r.reviewId;
  const close=h(doc,"button",{type:"button",class:"btn btn-small",id:"as-reviews-close",dataset:{focusKey:"as-reviews-close"},text:ctx.t("assurance.reviews.detail.close"),
    on:{click:()=>{revState.id=null;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:[`id:rev-${id}`,"id:as-reviews-t"]})}}});
  const kv=(k,v,cls)=>h(doc,"div",{},h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",cls?{class:cls}:{},v));
  const dash=v=>v===null||v===undefined?MISSING:String(v);
  return base(
    h(doc,"div",{class:"as-reviews-head"},h(doc,"span",{class:"mono",text:id}),verdictPill(ctx,r,r.verified),close),
    r.verdict==="CLEAN"&&!r.verified?h(doc,"p",{class:"note note-stale",role:"note",text:ctx.t("assurance.reviews.detail.cleanCaveat")}):null,
    h(doc,"dl",{class:"kv as-reviews-kv"},
      kv("assurance.reviews.col.run",r.runId,"mono"),kv("assurance.reviews.col.mission",r.missionId,"mono"),
      kv("assurance.reviews.detail.cycle",String(r.cycle)),
      kv("assurance.reviews.detail.reviewer",dash(r.reviewer),"mono"),kv("assurance.reviews.detail.implementer",dash(r.implementer),"mono"),
      kv("assurance.reviews.col.independent",indepText(ctx,r.independent)),
      kv("assurance.reviews.detail.commit",dash(r.reviewedCommit),"mono"),
      kv("assurance.reviews.detail.currentHead",ctx.t(r.currentHead?"assurance.reviews.yes":"assurance.reviews.no")),
      kv("assurance.reviews.col.time",formatDateTime(r.timestamp,ctx.i18n.lang)),
      kv("assurance.reviews.detail.recorded",dash(r.recordedVerdict),"mono"),
      r.invalidated?kv("assurance.reviews.detail.invalidated",r.invalidated,"mono"):null,
      kv("assurance.reviews.detail.findingsCount",dash(r.findingsCount)),
      kv("assurance.reviews.detail.exit",dash(r.exitCode),"mono"),
      kv("assurance.reviews.detail.timedOut",ctx.t(r.timedOut?"assurance.reviews.yes":"assurance.reviews.no")),
      r.note?kv("assurance.reviews.detail.note",r.note):null),
    h(doc,"h4",{class:"qa-def-title",text:ctx.t("assurance.reviews.detail.findings")}),
    r.findings&&r.findings.length?h(doc,"ul",{class:"qa-gaps",dataset:{findings:"1"}},r.findings.map(f=>h(doc,"li",{text:f}))):h(doc,"p",{class:"note",text:ctx.t("assurance.reviews.detail.noFindings")}));
}

// ---------- (6) UI-050: Kanıt soyağacı mission -> run -> evidence (yalnız GET /v1/evidence liste alanları) ----------
// //TR: Yalnız listedeki missionId/runId alanları kenar üretir; eksik alan "gruplanmamış" olarak ayrı gösterilir, hiçbir bağ çıkarılmaz. Kapsam yalnız yüklü sayfadır (sayfalama/mission kapsamı geçerlidir) ve bu açıkça yazılır.
function lineageLeaf(ctx,e){
  const doc=ctx.doc,sel=selection.evidenceId===e.evidenceId;
  return h(doc,"li",{class:"as-lineage-leaf",dataset:{lineage:"evidence",evidenceId:e.evidenceId}},
    h(doc,"button",{type:"button",class:"link-btn mono",id:`lin-${e.evidenceId}`,dataset:{focusKey:`lin-${e.evidenceId}`},"aria-current":sel?"true":null,on:{click:()=>{selection.evidenceId=e.evidenceId;ctx.rerender()}},text:e.evidenceId})," ",
    h(doc,"span",{text:e.kind??MISSING}));
}
function lineageRun(ctx,run,{noMission=false}={}){
  const doc=ctx.doc;
  return h(doc,"li",{class:"as-lineage-run",dataset:{lineage:"run",lineageRun:run.runId,...(noMission?{noMission:"1"}:{})}},
    h(doc,"span",{class:"mono",text:run.runId}),noMission?h(doc,"span",{class:"note",text:` · ${ctx.t("assurance.lineage.noMission")}`}):null,
    h(doc,"ul",{class:"as-lineage-list"},run.evidence.map(e=>lineageLeaf(ctx,e))));
}
function lineagePanel(ctx,res){
  const doc=ctx.doc,mk=(...k)=>panel(ctx,{titleKey:"assurance.lineage.title",id:"as-lineage",className:"as-lineage"},h(doc,"p",{class:"note",text:ctx.t("assurance.lineage.lead")}),...k);
  if(res.state!=="VERIFIED")return mk(stateNote(ctx,res.state));
  if(!res.items.length)return mk(emptyNote(ctx,"assurance.lineage.none"));
  const L=buildLineage(res.items);
  return mk(
    h(doc,"p",{class:"note",dataset:{lineageScope:"page"},text:ctx.t("assurance.lineage.scope",{n:String(L.total)})}),
    L.duplicates>0?h(doc,"p",{class:"note note-stale",role:"note",dataset:{lineageDuplicates:String(L.duplicates)},text:ctx.t("assurance.lineage.duplicates",{n:String(L.duplicates)})}):null,
    h(doc,"ul",{class:"as-lineage-list as-lineage-root",role:"tree","aria-label":ctx.t("assurance.lineage.title")},
      L.missions.map(m=>h(doc,"li",{class:"as-lineage-mission",dataset:{lineage:"mission",missionId:m.missionId}},
        h(doc,"span",{class:"mono",text:m.missionId}),
        h(doc,"ul",{class:"as-lineage-list"},
          m.runs.map(r=>lineageRun(ctx,r)),
          m.noRun.length?h(doc,"li",{class:"as-lineage-run",dataset:{lineage:"norun",missionId:m.missionId}},h(doc,"span",{class:"note",text:ctx.t("assurance.lineage.noRun")}),h(doc,"ul",{class:"as-lineage-list"},m.noRun.map(e=>lineageLeaf(ctx,e)))):null)))),
    L.orphanRuns.length?h(doc,"div",{class:"as-lineage-ungrouped",dataset:{lineage:"orphanRuns"}},h(doc,"h4",{class:"qa-def-title",text:ctx.t("assurance.lineage.orphanRuns")}),h(doc,"ul",{class:"as-lineage-list"},L.orphanRuns.map(r=>lineageRun(ctx,r,{noMission:true})))):null,
    L.ungrouped.length?h(doc,"div",{class:"as-lineage-ungrouped",dataset:{lineage:"ungrouped"}},h(doc,"h4",{class:"qa-def-title",text:ctx.t("assurance.lineage.ungrouped")}),h(doc,"p",{class:"note",text:ctx.t("assurance.lineage.ungroupedNote")}),h(doc,"ul",{class:"as-lineage-list"},L.ungrouped.map(e=>lineageLeaf(ctx,e)))):null);
}

// ---------- (7) UI-051: Koşu başına test raporu (GET /v1/work-runs kanıt kayıtları + GET /v1/evidence?runId=) ----------
// //TR: Durum yalnız kayıtlı test kanıtından türetilir (VERIFY_TESTS + REGRESSION_TESTS, güncel head, sandbox tanıklı, yürütülen test > 0); kayıt yoksa NOT_EXECUTED. Hiçbir yerde "geçti" üretilmez: EXECUTED yalnız "kanıtla yürütüldü" demektir ve PRODUCT_VERIFIED anlamına gelmez. Test kaydı kimliği kanıt indeksinde (evidence?runId=) birebir eşleşirse doğrulama çipi eklenir; eşleşmezse "indekste yok" yazılır.
const trState={runId:null};
const TEST_PILL=Object.freeze({EXECUTED:"NEUTRAL",FAILED:"FAILED",BLOCKED:"BLOCKED",UNVERIFIED:"STALE",NOT_EXECUTED:"NOT_EXECUTED"});
function testPill(ctx,state){
  const p=statePill(ctx,TEST_PILL[state]??"NOT_EXECUTED",{label:ctx.t(`assurance.testreport.state.${state}`)});p.dataset.testState=state;return p;
}
function testRow(ctx,r){
  const doc=ctx.doc,on=trState.runId===r.runId;
  return h(doc,"tr",{class:on?"row-selected":null,dataset:{testRun:r.runId,testState:r.state}},
    h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn mono",id:`tr-${r.runId}`,dataset:{focusKey:`tr-${r.runId}`},"aria-current":on?"true":null,"aria-label":ctx.t("assurance.testreport.select",{id:r.runId}),
      on:{click:()=>{trState.runId=r.runId;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:["id:as-testrep-detail-h",`id:tr-${r.runId}`]})}},text:r.runId})),
    h(doc,"td",{},testPill(ctx,r.state)),
    h(doc,"td",{text:r.executedTests===null?MISSING:formatCount(r.executedTests)}),
    h(doc,"td",{text:formatCount(r.records.length)}),
    h(doc,"td",{class:"mono",text:r.headSha?r.headSha.slice(0,12):MISSING}));
}
function testReportPanel(ctx,reports){
  const doc=ctx.doc,mk=(...k)=>panel(ctx,{titleKey:"assurance.testreport.title",id:"as-testrep",className:"as-testrep"},h(doc,"p",{class:"note",text:ctx.t("assurance.testreport.lead")}),...k,h(doc,"p",{class:"note mono",text:ctx.t("assurance.testreport.source")}));
  if(reports.state!=="VERIFIED")return mk(stateNote(ctx,reports.state));
  if(!reports.runs.length)return mk(emptyNote(ctx,"assurance.testreport.none"));
  const page=reports.runs.slice(0,SCAN_LIMIT),cols=["assurance.testreport.col.run","assurance.testreport.col.state","assurance.testreport.col.executed","assurance.testreport.col.records","assurance.testreport.col.head"];
  return mk(
    h(doc,"p",{class:"note",dataset:{results:"testreport"},text:ctx.t("assurance.testreport.results",{shown:String(page.length),total:String(reports.total)})}),
    h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table as-testrep-table"},
      h(doc,"caption",{class:"sr-only",text:ctx.t("assurance.testreport.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},page.map(r=>testRow(ctx,r))))),
    h(doc,"p",{class:"note",text:ctx.t("assurance.testreport.note")}));
}
async function testReportDetail(ctx,reports){
  const doc=ctx.doc;
  const base=(...kids)=>panel(ctx,{titleKey:"assurance.testreport.detail.title",id:"as-testrep-detail",className:"as-testrep"},h(doc,"h3",{id:"as-testrep-detail-h",tabindex:"-1",class:"sr-only",text:ctx.t("assurance.testreport.detail.title")}),...kids);
  if(!trState.runId)return base(emptyNote(ctx,"assurance.testreport.detail.none"));
  const r=reports.state==="VERIFIED"?reports.runs.find(x=>x.runId===trState.runId):null;
  if(!r)return base(stateNote(ctx,"UNAVAILABLE","assurance.testreport.detail.gone"));
  const idx=await ctx.api.evidenceList({runId:r.runId,limit:PAGE_LIMIT});
  const byId=idx.state==="VERIFIED"?new Map(idx.items.map(e=>[e.evidenceId,e])):null;
  const close=h(doc,"button",{type:"button",class:"btn btn-small",id:"as-testrep-close",dataset:{focusKey:"as-testrep-close"},text:ctx.t("assurance.testreport.detail.close"),
    on:{click:()=>{const id=r.runId;trState.runId=null;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:[`id:tr-${id}`,"id:as-testrep-t"]})}}});
  const head=h(doc,"div",{class:"as-testrep-head"},h(doc,"span",{class:"mono",text:r.runId}),testPill(ctx,r.state),close);
  const idxCell=rec=>{
    if(!rec.evidenceId)return h(doc,"span",{class:"note",text:MISSING});
    if(byId===null)return h(doc,"span",{class:"note",dataset:{indexState:idx.state},text:ctx.t(`state.${idx.state}`)});
    const hit=byId.get(rec.evidenceId);
    // //TR: Doğrulama çipi yalnız indeks kaydı AYNI koşuya ve AYNI türe aitse gösterilir; aksi halde "indekste yok".
    return hit&&hit.runId===r.runId&&hit.kind===rec.kind?verificationChip(ctx,hit.verification):h(doc,"span",{class:"note",dataset:{indexState:"NOT_INDEXED"},text:ctx.t("assurance.testreport.notIndexed")});
  };
  const cols=["assurance.testreport.rec.id","assurance.testreport.rec.kind","assurance.testreport.rec.cycle","assurance.testreport.rec.head","assurance.testreport.rec.exit","assurance.testreport.rec.attested","assurance.testreport.rec.index"];
  return base(head,
    r.state==="NOT_EXECUTED"?h(doc,"p",{class:"note note-blocked",role:"note",dataset:{testNotExecuted:"1"},text:ctx.t(r.records.length?"assurance.testreport.detail.notExecutedRecords":"assurance.testreport.detail.notExecuted")}):null,
    r.state==="UNVERIFIED"?h(doc,"p",{class:"note note-stale",role:"note",text:ctx.t("assurance.testreport.detail.unverified")}):null,
    r.records.length?h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table as-testrep-table"},
      h(doc,"caption",{class:"sr-only",text:ctx.t("assurance.testreport.detail.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},r.records.map(rec=>h(doc,"tr",{dataset:{testRecord:rec.kind,atHead:rec.atHead?"1":"0"}},
        h(doc,"td",{class:"mono",text:rec.evidenceId??MISSING}),h(doc,"td",{text:rec.kind}),h(doc,"td",{text:rec.cycle===null?MISSING:String(rec.cycle)}),
        h(doc,"td",{class:"mono",text:rec.commitSha?`${rec.commitSha.slice(0,12)}${rec.atHead?"":` (${ctx.t("assurance.testreport.notHead")})`}`:MISSING}),
        h(doc,"td",{class:"mono",text:rec.exitCode===null?MISSING:String(rec.exitCode)}),
        h(doc,"td",{text:ctx.t(rec.attested?"assurance.testreport.yes":"assurance.testreport.no")}),
        h(doc,"td",{},idxCell(rec))))))):emptyNote(ctx,"assurance.testreport.detail.noRecords"));
}

// ---------- (3) Kanıt yüzeyi (mevcut davranış) ----------
function filters(ctx,items){
  const doc=ctx.doc,f=drafts.evidence,kinds=[...new Set(items.map(e=>e.kind).filter(Boolean))].sort();
  const vOpts=[{value:"ALL",label:ctx.t("assurance.filter.all")},...VERIFICATION_STATES.map(v=>({value:v,label:ctx.t(`everif.${v}`)})),{value:"NONE",label:ctx.t("everif.NONE")}];
  const kOpts=[{value:"ALL",label:ctx.t("assurance.filter.all")},...kinds.map(k=>({value:k,label:k}))];
  if(!kOpts.some(o=>o.value===f.kind))f.kind="ALL";
  return h(doc,"div",{class:"filter-row",role:"group","aria-label":ctx.t("assurance.filter.label")},
    field(ctx,{id:"ev-filter-verification",labelKey:"assurance.filter.verification",value:f.verification,onInput:v=>{f.verification=v;ctx.rerender()},options:vOpts}),
    field(ctx,{id:"ev-filter-kind",labelKey:"assurance.filter.kind",value:f.kind,onInput:v=>{f.kind=v;ctx.rerender()},options:kOpts}),
    selection.missionId?h(doc,"p",{class:"note"},ctx.t("assurance.scopeMission",{id:selection.missionId})," ",h(doc,"button",{type:"button",class:"btn",id:"ev-clear-scope",dataset:{focusKey:"ev-clear-scope"},on:{click:()=>{selection.missionId=null;drafts.evidence.cursor=null;drafts.evidence.stack=[];ctx.rerender()}},text:ctx.t("assurance.scopeClear")})):h(doc,"p",{class:"note",text:ctx.t("assurance.scopeAll")}));
}
function pager(ctx,res){
  const doc=ctx.doc,f=drafts.evidence;
  if(!f.cursor&&!res.nextCursor)return null;
  return h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("assurance.page.label")},
    h(doc,"button",{type:"button",class:"btn",id:"ev-prev",dataset:{focusKey:"ev-prev"},disabled:!f.stack.length&&!f.cursor,on:{click:()=>{f.cursor=f.stack.pop()??null;ctx.rerender()}},text:ctx.t("assurance.page.prev")}),
    h(doc,"button",{type:"button",class:"btn",id:"ev-next",dataset:{focusKey:"ev-next"},disabled:!res.nextCursor,on:{click:()=>{f.stack.push(f.cursor);f.cursor=res.nextCursor;ctx.rerender()}},text:ctx.t("assurance.page.next")}));
}
function listBody(ctx,res,shown){
  const doc=ctx.doc;
  if(res.state!=="VERIFIED")return stateNote(ctx,res.state);
  if(!res.items.length)return emptyNote(ctx,"assurance.empty");
  if(!shown.length)return emptyNote(ctx,"assurance.filter.none");
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("assurance.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["assurance.col.id","assurance.col.kind","assurance.col.verification","assurance.col.created"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},shown.map(e=>{
      const sel=selection.evidenceId===e.evidenceId;
      return h(doc,"tr",{class:sel?"row-selected":null},
        h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn mono",id:`ev-${e.evidenceId}`,dataset:{focusKey:`ev-${e.evidenceId}`},"aria-current":sel?"true":null,on:{click:()=>{selection.evidenceId=e.evidenceId;ctx.rerender()}},text:e.evidenceId})),
        h(doc,"td",{text:e.kind??MISSING}),h(doc,"td",{},verificationChip(ctx,e.verification)),h(doc,"td",{text:formatDateTime(e.createdAt,ctx.i18n.lang)}));
    }))));
}
async function detailBody(ctx){
  const doc=ctx.doc,res=await ctx.api.evidenceItem(selection.evidenceId);
  if(res.state!=="VERIFIED")return stateNote(ctx,res.state);
  const e=res.item;
  return h(doc,"div",{},
    h(doc,"p",{class:"panel-meta"},verificationChip(ctx,e.verification),h(doc,"span",{class:"mono",text:e.evidenceId})),
    h(doc,"dl",{class:"kv"},
      h(doc,"dt",{text:ctx.t("assurance.detail.kind")}),h(doc,"dd",{text:e.kind??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.mission")}),h(doc,"dd",{class:"mono",text:e.missionId??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.run")}),h(doc,"dd",{class:"mono",text:e.runId??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.source")}),h(doc,"dd",{class:"mono",dataset:{field:"sourcePath"},text:e.sourcePath??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.sha256")}),h(doc,"dd",{class:"mono",dataset:{field:"sha256"},text:e.sha256??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.verification")}),h(doc,"dd",{text:e.verification?ctx.t(`everif.${e.verification}`):ctx.t("everif.NONE")}),
      h(doc,"dt",{text:ctx.t("assurance.detail.created")}),h(doc,"dd",{text:formatDateTime(e.createdAt,ctx.i18n.lang)})),
    h(doc,"h3",{text:ctx.t("assurance.detail.log")}),
    h(doc,"pre",{id:"ev-log",class:"log",tabindex:"0","aria-label":ctx.t("assurance.detail.log"),text:e.logTail??ctx.t("assurance.detail.noLog")}));
}

export async function render(ctx){
  const doc=ctx.doc,f=drafts.evidence;
  // //TR: Kanıt listesi (mevcut davranış) önce istenir; genel bakış/güvenlik okumaları salt-okunur ektir ve başarısızlıkları dürüst duruma düşer.
  const [res,cockpit,scansRaw,revRes]=await Promise.all([
    ctx.api.evidenceList({missionId:selection.missionId??undefined,cursor:f.cursor??undefined,limit:PAGE_LIMIT}),
    ctx.api.cockpit(),
    ctx.api.raw("/v1/work-runs"),
    ctx.api.assuranceReviews()
  ]);
  const scans=mapSecurityScans(scansRaw),tests=mapTestReports(scansRaw),ev=evidenceIntegrity(cockpit?.data?.evidence);
  if(res.state==="VERIFIED"&&f.kind!=="ALL"&&!res.items.some(e=>e.kind===f.kind))f.kind="ALL";
  const shown=res.state==="VERIFIED"?filterEvidence(res.items,{verification:f.verification,kind:f.kind}):[];
  const detail=selection.evidenceId?panel(ctx,{titleKey:"assurance.detail",id:"assurance-detail"},await detailBody(ctx)):null;
  return h(doc,"div",{class:"view view-assurance"},
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.assurance.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.assurance.desc")}),
    h(doc,"div",{class:"two-col"},evidencePanel(ctx,ev),posturePanel(ctx,scans)),
    dynamicQaPanel(ctx),
    securityPanel(ctx,scans),
    securityDetail(ctx,scans),
    testReportPanel(ctx,tests),
    await testReportDetail(ctx,tests),
    reviewsPanel(ctx,revRes),
    await reviewDetailPanel(ctx),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:res.state,value:res.items?.length??null}),h(doc,"span",{text:ctx.t("assurance.source")})),
    panel(ctx,{titleKey:"assurance.list",id:"assurance-list"},res.state==="VERIFIED"?filters(ctx,res.items):null,listBody(ctx,res,shown),res.state==="VERIFIED"?pager(ctx,res):null),
    lineagePanel(ctx,res),
    detail);
}
