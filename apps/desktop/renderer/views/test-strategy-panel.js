// //TR: DSK-T0006 (UI-038..UI-045) Güvence görünümündeki proje başına "Test stratejisi ve kapsam" paneli. Liste yalnız zaten okunan GET /v1/work-runs test kanıtından türetilir (ek okuma yok);
// bir proje seçilince salt-okunur GET /v1/projects (beyan edilen testCommand) ve GET /v1/work-runs/:id (ürün doğrulama ekseni) okunur. NOT_EXECUTED ile PRODUCT_VERIFIED ayrı eksenlerde gösterilir:
// test durumu kanıttan, ürün doğrulaması yalnız sunucunun productVerification alanından gelir; laboratuvarlar (UI-040..045) için yürütme kanıtı yoktur ve "koş" eylemi bulunmaz. Veri yalnız h()/textContent ile yazılır.
import {h,panel,stateNote,emptyNote,statePill} from "../components.js";
import {MISSING,formatCount} from "../model.js";
import {groupTestsByProject,projectStrategy,productAxisOf,LAB_CATEGORIES,TEST_STATES} from "../test-strategy-core.js";

const tsState={projectId:null};
export function resetTestStrategy(){tsState.projectId=null}
const TEST_PILL=Object.freeze({EXECUTED:"NEUTRAL",FAILED:"FAILED",BLOCKED:"BLOCKED",UNVERIFIED:"STALE",NOT_EXECUTED:"NOT_EXECUTED"});
const AXIS_PILL=Object.freeze({PRODUCT_VERIFIED:"PRODUCT_VERIFIED",NOT_VERIFIED:"NOT_VERIFIED",FAILED:"FAILED"});
function testPill(ctx,state){const p=statePill(ctx,TEST_PILL[state]??"NOT_EXECUTED",{label:ctx.t(`assurance.testreport.state.${state}`)});p.dataset.testState=state;return p}
function axisPill(ctx,axis){
  const k=axis?AXIS_PILL[axis]:"UNAVAILABLE",p=statePill(ctx,k,{label:ctx.t(axis?`assurance.teststrat.axis.${axis}`:"assurance.teststrat.axis.unknown")});
  p.dataset.productAxis=axis??"UNKNOWN";return p;
}
const select=(ctx,id)=>{tsState.projectId=id;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:["id:as-teststrat-detail-h",`id:ts-${id}`]})};

/** Proje listesi (senkron; ek okuma yok). */
export function testStrategyPanel(ctx,reports){
  const doc=ctx.doc,mk=(...k)=>panel(ctx,{titleKey:"assurance.teststrat.title",id:"as-teststrat",className:"as-testrep"},h(doc,"p",{class:"note",text:ctx.t("assurance.teststrat.lead")}),...k,h(doc,"p",{class:"note mono",text:ctx.t("assurance.teststrat.source")}));
  const g=groupTestsByProject(reports);
  if(g.state!=="VERIFIED")return mk(stateNote(ctx,g.state));
  if(!g.projects.length)return mk(emptyNote(ctx,"assurance.teststrat.none"));
  const cols=["assurance.teststrat.col.project","assurance.teststrat.col.runs","assurance.teststrat.col.latest","assurance.teststrat.col.executed","assurance.teststrat.col.states"];
  return mk(
    h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table as-testrep-table"},
      h(doc,"caption",{class:"sr-only",text:ctx.t("assurance.teststrat.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},g.projects.map(p=>{
        const on=tsState.projectId===p.projectId;
        return h(doc,"tr",{class:on?"row-selected":null,dataset:{strategyProject:p.projectId,testState:p.latest.state}},
          h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn mono",id:`ts-${p.projectId}`,dataset:{focusKey:`ts-${p.projectId}`},"aria-current":on?"true":null,
            "aria-label":ctx.t("assurance.teststrat.select",{id:p.projectId}),on:{click:()=>select(ctx,p.projectId)},text:p.projectId})),
          h(doc,"td",{text:formatCount(p.total)}),
          h(doc,"td",{},testPill(ctx,p.latest.state)),
          h(doc,"td",{text:p.latest.executedTests===null?MISSING:formatCount(p.latest.executedTests)}),
          h(doc,"td",{dataset:{stateCounts:"1"},text:TEST_STATES.filter(s=>p.counts[s]>0).map(s=>`${ctx.t(`assurance.testreport.state.${s}`)} ${p.counts[s]}`).join(" · ")}));
      })))),
    g.unassigned>0?h(doc,"p",{class:"note note-stale",role:"note",dataset:{unassigned:String(g.unassigned)},text:ctx.t("assurance.teststrat.unassigned",{n:String(g.unassigned)})}):null,
    g.truncated?h(doc,"p",{class:"note note-stale",role:"note",text:ctx.t("assurance.teststrat.truncated")}):null,
    h(doc,"p",{class:"note",text:ctx.t("assurance.teststrat.note")}));
}

function fileList(ctx,key,list){
  const doc=ctx.doc;if(!list.length)return null;
  return h(doc,"div",{dataset:{testFiles:key}},h(doc,"h5",{class:"qa-def-title",text:ctx.t(`assurance.teststrat.files.${key}`,{n:String(list.length)})}),
    h(doc,"ul",{class:"as-lineage-list"},list.map(f=>h(doc,"li",{class:"mono",text:f}))));
}

/** Seçili proje ayrıntısı: strateji (testCommand), test vakaları (son TEST_SURFACE dosyaları), son sonuç + ayrı ürün doğrulama ekseni, laboratuvar kapsamı. */
export async function testStrategyDetail(ctx,reports){
  const doc=ctx.doc;
  const base=(...kids)=>panel(ctx,{titleKey:"assurance.teststrat.detail.title",id:"as-teststrat-detail",className:"as-testrep"},h(doc,"h3",{id:"as-teststrat-detail-h",tabindex:"-1",class:"sr-only",text:ctx.t("assurance.teststrat.detail.title")}),...kids);
  if(!tsState.projectId)return base(emptyNote(ctx,"assurance.teststrat.detail.none"));
  const g=groupTestsByProject(reports),p=g.state==="VERIFIED"?g.projects.find(x=>x.projectId===tsState.projectId):null;
  if(!p)return base(stateNote(ctx,"UNAVAILABLE","assurance.teststrat.detail.gone"));
  const [projRaw,detail]=await Promise.all([ctx.api.raw("/v1/projects"),ctx.api.workRunDetail(p.latest.runId)]);
  const strat=projectStrategy(projRaw,p.projectId),ax=productAxisOf(detail),r=p.latest,s=p.surface;
  const close=h(doc,"button",{type:"button",class:"btn btn-small",id:"as-teststrat-close",dataset:{focusKey:"as-teststrat-close"},text:ctx.t("assurance.teststrat.detail.close"),
    on:{click:()=>{const id=p.projectId;tsState.projectId=null;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:[`id:ts-${id}`,"id:as-teststrat-t"]})}}});
  const kv=(k,v,attrs={})=>[h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",{...attrs},v)];
  // (1) strateji
  const cmd=strat.state!=="VERIFIED"?stateNote(ctx,strat.state==="NOT_FOUND"?"UNAVAILABLE":strat.state):strat.testCommand?h(doc,"code",{class:"mono",dataset:{testCommand:"1"},text:strat.testCommand.join(" ")}):h(doc,"span",{class:"note",dataset:{testCommand:"0"},text:ctx.t("assurance.teststrat.noCommand")});
  const strategy=h(doc,"section",{dataset:{strategy:"1"}},h(doc,"h4",{class:"qa-def-title",text:ctx.t("assurance.teststrat.strategy")}),
    h(doc,"dl",{class:"kv"},...kv("assurance.teststrat.name",strat.name??MISSING),...kv("assurance.teststrat.command",cmd)),
    h(doc,"p",{class:"note",text:ctx.t("assurance.teststrat.strategyNote")}));
  // (2) test vakaları (dosya düzeyi)
  const cases=h(doc,"section",{dataset:{testCases:s?String(s.files?.total??0):"none"}},h(doc,"h4",{class:"qa-def-title",text:ctx.t("assurance.teststrat.cases")}),
    !s||!s.files?h(doc,"p",{class:"note",text:ctx.t("assurance.teststrat.noSurface")}):
      s.files.total===0?h(doc,"p",{class:"note",text:ctx.t("assurance.teststrat.noFiles")}):
      h(doc,"div",{},fileList(ctx,"added",s.files.added),fileList(ctx,"modified",s.files.modified),fileList(ctx,"renamed",s.files.renamed),fileList(ctx,"deleted",s.files.deleted),
        s.files.truncated?h(doc,"p",{class:"note note-stale",role:"note",text:ctx.t("assurance.teststrat.filesTruncated",{n:String(s.files.total)})}):null),
    h(doc,"p",{class:"note",text:ctx.t("assurance.teststrat.casesNote")}));
  // (3) son sonuçlar: test ekseni ve ürün doğrulama ekseni AYRI
  const tr=s?.testRun??null;
  const results=h(doc,"section",{dataset:{latestResults:r.runId}},h(doc,"h4",{class:"qa-def-title",text:ctx.t("assurance.teststrat.results")}),
    h(doc,"dl",{class:"kv"},
      ...kv("assurance.teststrat.run",r.runId,{class:"mono"}),
      ...kv("assurance.teststrat.head",r.headSha?r.headSha.slice(0,12):MISSING,{class:"mono"}),
      ...kv("assurance.teststrat.testAxis",testPill(ctx,r.state)),
      ...kv("assurance.teststrat.executed",r.executedTests===null?MISSING:formatCount(r.executedTests)),
      ...kv("assurance.teststrat.breakdown",tr?ctx.t("assurance.teststrat.breakdownValue",{format:tr.format??MISSING,passed:String(tr.passed),failed:String(tr.failed),skipped:String(tr.skipped),todo:String(tr.todo)}):MISSING,{dataset:{testRun:tr?"1":"0"}}),
      ...kv("assurance.teststrat.productAxis",ax.state==="VERIFIED"?axisPill(ctx,ax.axis):stateNote(ctx,ax.state))),
    r.state==="NOT_EXECUTED"?h(doc,"p",{class:"note note-blocked",role:"note",dataset:{testNotExecuted:"1"},text:ctx.t("assurance.teststrat.notExecuted")}):null,
    h(doc,"p",{class:"note",role:"note",dataset:{axisSeparation:"1"},text:ctx.t("assurance.teststrat.axisNote")}));
  // (4) laboratuvar kapsamı (UI-040..045): kanıt türü yok, Founder kapısı
  const labs=h(doc,"section",{dataset:{labs:"1"}},h(doc,"h4",{class:"qa-def-title",text:ctx.t("assurance.teststrat.labs")}),
    h(doc,"ul",{class:"as-lineage-list"},LAB_CATEGORIES.map(l=>h(doc,"li",{dataset:{lab:l.id,labState:l.state}},
      statePill(ctx,l.state,{label:ctx.t(`pill.${l.state}`)}),h(doc,"span",{text:` ${ctx.t(`assurance.teststrat.lab.${l.id}`)} (${l.ui}) — ${ctx.t("assurance.teststrat.labGate",{gate:l.gate})}`})))),
    h(doc,"p",{class:"note",text:ctx.t("assurance.teststrat.coverageNote")}));
  return base(h(doc,"div",{class:"as-testrep-head"},h(doc,"span",{class:"mono",text:p.projectId}),testPill(ctx,r.state),close),strategy,cases,results,labs);
}
