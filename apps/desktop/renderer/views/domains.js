// //TR: Bu görünüm Alan Paketleri'dir (FA-V2-PRODUCT, UI-DOMAIN-PACKS): YALNIZ salt-okunur GET /v1/domains kayıt defterinden okunur (main allow-list girişi koordinatör PR'ında bekler; o gelene kadar okuma UNAVAILABLE olarak dürüstçe gösterilir). Kayıt değerleri (status, activation, knowledgeState, freshnessPolicy) sunucudan AYNEN gösterilir; REGISTERED/ON_DEMAND/SEED_DOMAIN_PROFILE "etkin, güncel, doğrulanmış, uyumlu ya da sertifikalı" anlamına gelmez ve hiçbir değer yükseltilmez. Etkinleştirme denetimi, düğme veya POST yoktur. Okunamayan kaynağın sayısı 0 değil "—" olur; etiketler ctx.t ile, sunucu metinleri yalnız textContent ile yazılır.
import {h,panel,statePill,badge} from "../components.js";
import {MISSING,formatCount} from "../model.js";
import {DOMAINS_PATH,buildDomains} from "../domains-core.js";

const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("domains.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.domains.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.domains.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("domains.readonly")}),
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("domains.honesty")}));
}
function stateBlock(ctx,a,message){
  const doc=ctx.doc,st=a.state;
  return h(doc,"div",{class:`integ-state state-${st.toLowerCase()}`,role:"status",dataset:{domainState:st}},
    h(doc,"p",{class:"integ-state-head"},statePill(ctx,failKind(st)),h(doc,"strong",{text:ctx.t(`domains.state.${st}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`domains.hint.${st}`,{source:`GET ${DOMAINS_PATH}`})}),
    message?h(doc,"p",{class:"note mono",text:message}):null);
}
function countPanel(ctx,a){
  const doc=ctx.doc,n=a.count;
  return panel(ctx,{titleKey:"domains.counts.title",id:"domain-counts",className:"integ-section"},
    h(doc,"p",{class:"note",text:ctx.t("domains.counts.lead")}),
    h(doc,"div",{class:"kpi-row",role:"group","aria-label":ctx.t("domains.counts.group")},
      h(doc,"article",{class:`kpi kpi-${n===null?"na":"ok"}`,dataset:{domainCount:"1",state:a.state}},
        h(doc,"h3",{class:"kpi-label",text:ctx.t("domains.kpi.label")}),
        h(doc,"p",{class:"kpi-value",text:n===null?MISSING:formatCount(n)}),
        h(doc,"p",{class:"kpi-qual",text:ctx.t("domains.kpi.q")}),
        h(doc,"p",{class:"kpi-src",text:`GET ${DOMAINS_PATH}`}))));
}
function tallyLine(ctx,kind,entries){
  const doc=ctx.doc;
  return h(doc,"p",{class:"note integ-tally",dataset:{tally:kind}},
    h(doc,"span",{text:ctx.t(`domains.tally.${kind}`)+" "}),
    entries.map(e=>h(doc,"span",{class:"badge mono",dataset:{value:e.value,n:String(e.count)},text:`${e.value} × ${e.count}`})));
}
function fact(ctx,label,value){
  const doc=ctx.doc;
  return h(doc,"span",{class:"integ-fact"},h(doc,"span",{class:"integ-fact-label",text:ctx.t(label)+" "}),value);
}
function row(ctx,it){
  const doc=ctx.doc;
  return h(doc,"li",{class:"card integ-row",dataset:{domainItem:it.id,status:it.status,activation:it.activation,knowledgeState:it.knowledgeState}},
    h(doc,"h4",{class:"mono",text:it.id}),
    h(doc,"p",{class:"integ-name",text:it.name}),
    h(doc,"p",{class:"integ-facts"},
      fact(ctx,"domains.field.status",badge(ctx,it.status,"mono")),
      fact(ctx,"domains.field.activation",badge(ctx,it.activation,"mono")),
      fact(ctx,"domains.field.knowledgeState",badge(ctx,it.knowledgeState,"mono")),
      it.freshnessPolicy?fact(ctx,"domains.field.freshnessPolicy",badge(ctx,it.freshnessPolicy,"mono")):null),
    it.profilePath?h(doc,"p",{class:"note mono",dataset:{field:"profilePath"},text:it.profilePath}):null);
}
function listPanel(ctx,a,message){
  const doc=ctx.doc,reg=a.registry;
  let body;
  if(reg===null)body=[stateBlock(ctx,a,message),h(doc,"p",{class:`note note-${a.state.toLowerCase()}`,role:"status",dataset:{domainWithheld:"1"},text:ctx.t("domains.withheld")})];
  else if(!reg.items.length)body=h(doc,"p",{class:"note",role:"status",dataset:{domainEmpty:"1"},text:ctx.t("domains.none")});
  else body=[tallyLine(ctx,"status",reg.byStatus),tallyLine(ctx,"activation",reg.byActivation),tallyLine(ctx,"knowledgeState",reg.byKnowledgeState),
    h(doc,"ul",{class:"cards integ-list","aria-label":ctx.t("domains.aria")},reg.items.map(it=>row(ctx,it)))];
  return panel(ctx,{titleKey:"domains.list.title",id:"domain-list",className:"integ-section"},h(doc,"p",{class:"note",text:ctx.t("domains.list.lead")}),body);
}
export async function render(ctx){
  const doc=ctx.doc;
  let res;
  try{res=await ctx.api.domains()}catch{res={state:"ERROR",registry:null}}
  if(!res||typeof res.state!=="string")res={state:"UNAVAILABLE",registry:null};
  const a=buildDomains(res);
  return h(doc,"div",{class:"view view-domains"},header(ctx),countPanel(ctx,a),listPanel(ctx,a,res.message));
}
