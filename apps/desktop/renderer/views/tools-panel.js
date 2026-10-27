// //TR: A2 Araçlar paneli (AI İş Gücü görünümünde): dört olgu AYRI satırlarda gösterilir ve birbirine çevrilmez: kayıtlı (GET /v1/adapters, kayıt defteri iddiası), kod destekli (kaynak ağacında doğrulanmış kod yolu), CI kanıt sınıfı ve probe durumu; ayrıca UNDER_REPORTED / DEAD_CODE vb. rozetler. Hiçbir metin probe olmadan bir aracı "kurulu" ya da "hazır" yapmaz. Rapor sunulmamışsa (paketli uygulama NOT_SUPPLIED, ya da uç nokta bu derlemede yok) kayıtlı dışındaki satırlar "ölçülmedi" der: 0 ya da "hazır değil" DEĞİLDİR. Veri yolları: GET /v1/adapters (var), GET /v1/adapters/reality (önerilen, docs/authority-requests/LANE-A-adapter-reality-route.md).
import {h,panel,stateNote} from "../components.js";
import {formatCount} from "../model.js";
import {ADAPTERS_PATH} from "../integrations-core.js";
import {ADAPTER_REALITY_PATH,CI_EVIDENCE,PROBE_STATES,REALITY_FINDINGS,toolsMeasurement} from "../adapter-reality-core.js";

const ROWS_SHOWN=60;
const IDS_SHOWN=8;

function fact(ctx,key,labelKey,...body){
  const doc=ctx.doc;
  return h(doc,"div",{class:"tools-fact",dataset:{toolsFact:key}},h(doc,"h3",{class:"wf-dist-title",text:ctx.t(labelKey)}),...body);
}
function notMeasured(ctx,m){
  return h(ctx.doc,"p",{class:"note note-unknown",role:"status",dataset:{toolsMeasured:"NO",toolsMeasuredWhy:m.kind},text:ctx.t(`tools.notMeasured.${m.kind}`)});
}
function registeredFact(ctx,adapters){
  const doc=ctx.doc;
  if(!adapters||adapters.state!=="VERIFIED")return fact(ctx,"registered","tools.registered.label",stateNote(ctx,adapters?.state??"ERROR"),h(doc,"p",{class:"note note-unknown",dataset:{toolsRegistered:"UNKNOWN"},text:ctx.t("tools.registered.unread")}));
  const r=adapters.registry,impl=r.byImplementation.filter(x=>x.value!=="NOT_IMPLEMENTED").reduce((s,x)=>s+x.count,0),not=(r.byImplementation.find(x=>x.value==="NOT_IMPLEMENTED")?.count)??0;
  return fact(ctx,"registered","tools.registered.label",
    h(doc,"p",{class:"kpi-value",dataset:{toolsRegistered:String(r.count)},text:formatCount(r.count)}),
    h(doc,"p",{class:"note",text:ctx.t("tools.registered.claim",{impl:formatCount(impl),not:formatCount(not)})}));
}
function codeFact(ctx,rl,adapters){
  const doc=ctx.doc,c=rl.codeBacked,total=adapters&&adapters.state==="VERIFIED"?adapters.registry.count:rl.registry.total;
  return fact(ctx,"codeBacked","tools.code.label",
    h(doc,"p",{class:"kpi-value",dataset:{toolsCodeBacked:String(c.registry)},text:formatCount(c.registry)}),
    h(doc,"p",{class:"duo-sub",text:ctx.t("tools.code.value",{n:formatCount(c.registry),total:formatCount(total),other:formatCount(c.other),absent:formatCount(c.absent)})}),
    h(doc,"p",{class:"note",text:ctx.t("tools.code.note")}));
}
function ciFact(ctx,rl){
  const doc=ctx.doc;
  return fact(ctx,"ci","tools.ci.label",
    h(doc,"ul",{class:"note",dataset:{toolsCi:"1"}},CI_EVIDENCE.filter(k=>rl.ci[k]>0).map(k=>h(doc,"li",{dataset:{toolsCiClass:k,count:String(rl.ci[k])},text:ctx.t("tools.ci.item",{label:ctx.t(`tools.ci.class.${k}`),n:formatCount(rl.ci[k])})}))),
    h(doc,"p",{class:"note",text:ctx.t("tools.ci.note")}),
    rl.ciProblems.length?h(doc,"p",{class:"note note-error",role:"note",dataset:{toolsCiProblems:String(rl.ciProblems.length)},text:ctx.t("tools.ci.problems",{n:formatCount(rl.ciProblems.length)})}):null);
}
function probeFact(ctx,rl){
  const doc=ctx.doc,total=rl.adapters.length,none=total>0&&rl.probe.NOT_OBSERVED===total;
  return fact(ctx,"probe","tools.probe.label",
    h(doc,"p",{class:"duo-sub",dataset:{toolsProbe:PROBE_STATES.map(k=>`${k}:${rl.probe[k]}`).join(",")},text:PROBE_STATES.map(k=>ctx.t(`tools.probe.item.${k}`,{n:formatCount(rl.probe[k])})).join(" · ")}),
    h(doc,"p",{class:"note",dataset:{toolsProbeNone:none?"1":"0"},text:ctx.t(none?"tools.probe.noneRun":"tools.probe.note")}));
}
function findingsFact(ctx,rl){
  const doc=ctx.doc,total=REALITY_FINDINGS.reduce((s,k)=>s+rl.counts[k],0);
  return fact(ctx,"findings","tools.finding.label",
    h(doc,"p",{class:"wf-badges"},REALITY_FINDINGS.map(k=>h(doc,"span",{class:`badge${rl.counts[k]>0?" badge-risk":""}`,dataset:{toolsFinding:k,count:String(rl.counts[k])},text:ctx.t(`tools.finding.badge.${k}`,{n:formatCount(rl.counts[k])})}))),
    total===0?h(doc,"p",{class:"note",text:ctx.t("tools.finding.none")}):h(doc,"ul",{class:"note",dataset:{toolsFindingList:"1"}},REALITY_FINDINGS.filter(k=>rl.counts[k]>0).map(k=>{
      const ids=rl.findings.filter(f=>f.finding===k).map(f=>f.id),shown=ids.slice(0,IDS_SHOWN);
      return h(doc,"li",{dataset:{toolsFindingKind:k}},h(doc,"strong",{text:ctx.t(`tools.finding.badge.${k}`,{n:formatCount(rl.counts[k])})})," — ",ctx.t(`tools.finding.explain.${k}`)," ",
        h(doc,"span",{class:"mono",text:shown.join(", ")+(ids.length>shown.length?` ${ctx.t("tools.moreIds",{n:formatCount(ids.length-shown.length)})}`:"")}));
    })));
}
function adapterTable(ctx,rl){
  const doc=ctx.doc,rows=rl.adapters.slice(0,ROWS_SHOWN);
  if(rows.length===0)return null;
  const finds=new Map();for(const f of rl.findings){if(!finds.has(f.id))finds.set(f.id,[]);finds.get(f.id).push(f.finding)}
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"wf-tools-table",dataset:{toolsTable:"adapters"}},
    h(doc,"caption",{class:"sr-only",text:ctx.t("tools.table.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["tools.table.id","tools.table.origin","tools.table.code","tools.table.ci","tools.table.probe","tools.table.findings"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},rows.map(a=>h(doc,"tr",{dataset:{toolsAdapter:a.id}},
      h(doc,"th",{scope:"row",class:"mono",text:a.id}),h(doc,"td",{text:ctx.t(`tools.origin.${a.origin}`)}),h(doc,"td",{dataset:{toolsCode:a.codePath},text:ctx.t(`tools.codePath.${a.codePath}`)}),
      h(doc,"td",{dataset:{toolsCiClass:a.ciEvidence},text:ctx.t(`tools.ci.class.${a.ciEvidence}`)}),h(doc,"td",{dataset:{toolsProbeState:a.probe},text:ctx.t(`tools.probe.state.${a.probe}`)}),
      h(doc,"td",{text:(finds.get(a.id)??[]).map(k=>ctx.t(`tools.finding.name.${k}`)).join(", ")||ctx.t("tools.table.noFinding")}))))));
}
/** Araçlar paneli: adapters = api.integrationsAdapters() sonucu, reality = api.adapterReality() sonucu, ready = api.rolesReadiness() sonucu. */
export function toolsPanel(ctx,{adapters,reality,ready}){
  const doc=ctx.doc,id="wf-tools",m=toolsMeasurement(reality,ready);
  const head=[h(doc,"p",{class:"note",dataset:{semantics:"FACTS_SEPARATE"},text:ctx.t("tools.lead")}),registeredFact(ctx,adapters)];
  const src=h(doc,"p",{class:"note mono",text:`GET ${ADAPTERS_PATH} · GET ${ADAPTER_REALITY_PATH}`});
  if(m.kind!=="MEASURED")return panel(ctx,{titleKey:"tools.title",id,className:"wf-tools"},...head,
    fact(ctx,"unmeasured","tools.unmeasured.label",notMeasured(ctx,m)),
    ready&&ready.state==="VERIFIED"?h(doc,"p",{class:"note",dataset:{toolsInput:ready.readiness.inputs.adapterReality},text:ctx.t("tools.input",{adapters:ctx.t(`workforce.ready.input.${ready.readiness.inputs.adapterReality}`)})}):null,src);
  const rl=reality.reality;
  return panel(ctx,{titleKey:"tools.title",id,className:"wf-tools"},...head,
    codeFact(ctx,rl,adapters),ciFact(ctx,rl),probeFact(ctx,rl),findingsFact(ctx,rl),
    adapterTable(ctx,rl),rl.adapters.length>ROWS_SHOWN?h(doc,"p",{class:"note",dataset:{toolsTableCut:"1"},text:ctx.t("tools.table.more",{n:formatCount(rl.adapters.length-ROWS_SHOWN)})}):null,
    ready&&ready.state==="VERIFIED"?h(doc,"p",{class:"note",dataset:{toolsInput:ready.readiness.inputs.adapterReality},text:ctx.t("tools.input",{adapters:ctx.t(`workforce.ready.input.${ready.readiness.inputs.adapterReality}`)})}):null,src);
}
