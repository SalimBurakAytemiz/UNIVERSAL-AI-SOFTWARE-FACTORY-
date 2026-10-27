// //TR: A2a Araçlar paneli (AI İş Gücü görünümünde): yalnız mevcut eşlenmiş hazırlıktan (GET /v1/roles/status-summary: readiness.totals.TOOL_READY, readiness.inputs.adapterReality, sunucunun gönderdiği TOOL_READY neden kodları) beslenir. Yeni uç nokta ve yeni api çağrısı yok, korumalı dosya yok (katalog sayısı satırı bu paketin dışındadır). Her sayının yanında payda gösterilir; toplam, yüzde ya da veride olmayan araç sayısı YOKTUR. adapterReality NOT_SUPPLIED ise "bu uygulamada ölçülmedi" denir (sıfır ya da "hazır değil" değil, sayı da gösterilmez). Probe olmadan hiçbir yerde "kurulu" ya da "hazır" yazılmaz. Adaptör başına satırlar (kod destekli, CI kanıtı, probe, UNDER_REPORTED/DEAD_CODE) A2b'dir: bir Lane B rota uzantısı bekler, burada YOKTUR.
import {h,panel,stateNote} from "../components.js";
import {formatCount} from "../model.js";
import {STATUS_SUMMARY_PATH} from "../agent-factory-core.js";

const KNOWN_REASONS=Object.freeze(["ROLE_HAS_NO_BINDING","ADAPTERS_MISSING","ADAPTER_UNRESOLVED","ADAPTER_CODE_ABSENT","PROBE_FAILED","PROBE_NOT_OBSERVED","ADAPTER_REALITY_NOT_SUPPLIED"]);
const COUNT_STATES=Object.freeze(["TRUE","FALSE","UNKNOWN","NOT_APPLICABLE"]);

function reasonRows(ctx,r,tool){
  const doc=ctx.doc,den=formatCount(r.denominator),list=r.toolReasons;
  if(list===null)return h(doc,"p",{class:"note note-unknown",dataset:{toolsReasons:"UNKNOWN"},text:ctx.t("tools.reasons.none")});
  return h(doc,"ul",{class:"note",dataset:{toolsReasons:String(list.length)}},list.map(x=>{
    const known=KNOWN_REASONS.includes(x.code);
    return h(doc,"li",{dataset:{toolsReason:x.code,known:String(known),count:String(x.count)}},
      ctx.t("tools.reason.item",{text:known?ctx.t(`tools.reason.${x.code}`):ctx.t("tools.reason.unknown"),n:formatCount(x.count),den}),
      " ",h(doc,"span",{class:"mono",text:x.code}));
  }));
}
/** Araçlar paneli: ready = api.rolesReadiness() sonucu. */
export function toolsPanel(ctx,{ready}){
  const doc=ctx.doc,id="wf-tools";
  const head=[h(doc,"p",{class:"note",dataset:{semantics:"TOOL_READY_ONLY"},text:ctx.t("tools.lead")})];
  const src=h(doc,"p",{class:"note mono",text:`GET ${STATUS_SUMMARY_PATH}`});
  if(!ready||ready.state!=="VERIFIED")return panel(ctx,{titleKey:"tools.title",id,className:"wf-tools"},...head,stateNote(ctx,ready?.state??"ERROR"),
    h(doc,"p",{class:"note note-unknown",role:"status",dataset:{toolsReadiness:"UNAVAILABLE"},text:ctx.t("tools.notRead")}),src);
  const r=ready.readiness;
  if(r.inputs.adapterReality!=="SUPPLIED")return panel(ctx,{titleKey:"tools.title",id,className:"wf-tools"},...head,
    h(doc,"p",{class:"note note-unknown",role:"status",dataset:{toolsReadiness:"NOT_MEASURED"},text:ctx.t("tools.notMeasured")}),src);
  const tool=r.layers.find(l=>l.layer==="TOOL_READY"),den=formatCount(r.denominator);
  const probeReason=(r.toolReasons??[]).some(x=>x.code==="PROBE_NOT_OBSERVED");
  return panel(ctx,{titleKey:"tools.title",id,className:"wf-tools"},...head,
    h(doc,"div",{class:"tools-fact",dataset:{toolsFact:"toolReady"}},h(doc,"h3",{class:"wf-dist-title",text:ctx.t("tools.counts.label")}),
      h(doc,"ul",{class:"note",dataset:{toolsReadiness:"MEASURED",denominator:String(r.denominator)}},COUNT_STATES.filter(k=>k!=="NOT_APPLICABLE"||tool.NOT_APPLICABLE>0).map(k=>
        h(doc,"li",{dataset:{toolsState:k,count:String(tool[k])},text:ctx.t(`tools.count.${k}`,{n:formatCount(tool[k]),den})}))),
      probeReason?h(doc,"p",{class:"note",dataset:{toolsWhy:"PROBE_NOT_OBSERVED"},text:ctx.t("tools.why.probe")}):null),
    h(doc,"div",{class:"tools-fact",dataset:{toolsFact:"reasons"}},h(doc,"h3",{class:"wf-dist-title",text:ctx.t("tools.reasons.label")}),reasonRows(ctx,r,tool)),src);
}
