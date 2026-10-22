// //TR: Bu görünüm Uzantılar ve Entegrasyonlar'dır (FA-V2-PRODUCT, UI-078): YALNIZ üç salt-okunur GET'ten okunur — GET /v1/capabilities, GET /v1/adapters ve GET /v1/fabrics (kayıt defterleri). Kayıt değerleri (status, implementation, activation, requiresCertification) sunucudan AYNEN gösterilir; REGISTERED/NOT_IMPLEMENTED "bağlı, etkin, kurulu ya da sertifikalı" anlamına gelmez ve hiçbir değer yükseltilmez. Etkinleştirme/kurulum/bağlama denetimi, düğme veya POST yoktur. Okunamayan kaynağın sayısı 0 değil "—" olur; etiketler ctx.t ile, sunucu metinleri yalnız textContent ile yazılır.
import {h,panel,statePill,badge} from "../components.js";
import {MISSING,formatCount} from "../model.js";
import {INTEG_SOURCES,INTEG_SOURCE_PATHS,buildIntegrations} from "../integrations-core.js";

const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("integrations.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.integrations.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.integrations.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("integrations.readonly")}),
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("integrations.honesty")}));
}

function stateBlock(ctx,state,source,message){
  const doc=ctx.doc,st=failState(state);
  return h(doc,"div",{class:`integ-state state-${st.toLowerCase()}`,role:"status",dataset:{integState:st,source}},
    h(doc,"p",{class:"integ-state-head"},statePill(ctx,failKind(st)),h(doc,"strong",{text:ctx.t(`integrations.state.${st}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`integrations.hint.${st}`,{source:`GET ${INTEG_SOURCE_PATHS[source]}`})}),
    message?h(doc,"p",{class:"note mono",text:message}):null);
}

function sourcesPanel(ctx,res,a){
  const doc=ctx.doc;
  const list=h(doc,"ul",{class:"company-sources integ-sources","aria-label":ctx.t("integrations.sources.aria")},INTEG_SOURCES.map(k=>{
    const st=a.sources[k].state;
    return h(doc,"li",{dataset:{source:k,sourceState:st}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`integrations.src.${k}`)}),
      st==="VERIFIED"?statePill(ctx,"VERIFIED",{label:ctx.t("integrations.src.ok")}):statePill(ctx,failKind(st)));
  }));
  const blocks=INTEG_SOURCES.filter(k=>a.registries[k]===null).map(k=>stateBlock(ctx,a.sources[k].state,k,res[k]?.message));
  return panel(ctx,{titleKey:"integrations.sources.title",id:"integ-sources",className:"integ-section"},
    h(doc,"p",{class:"note",text:ctx.t("integrations.sources.lead")}),list,blocks,
    a.unreadable.length?h(doc,"p",{class:"note",role:"status",dataset:{integPartial:a.unreadable.join(",")},text:ctx.t("integrations.partial",{sources:a.unreadable.map(k=>ctx.t(`integrations.srcShort.${k}`)).join(", ")})}):null);
}

/** Üç kayıt sayısı; okunamayan kaynak "—" gösterir (0 değil). Sayı "kayıtlı girdi" sayısıdır, bağlı/etkin sayısı değildir. */
function countsPanel(ctx,a){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"integrations.counts.title",id:"integ-counts",className:"integ-section"},
    h(doc,"p",{class:"note",text:ctx.t("integrations.counts.lead")}),
    h(doc,"div",{class:"kpi-row integ-counts",role:"group","aria-label":ctx.t("integrations.counts.group")},INTEG_SOURCES.map(k=>{
      const n=a.counts[k];
      return h(doc,"article",{class:`kpi integ-count kpi-${n===null?"na":"ok"}`,dataset:{integCount:k,state:a.sources[k].state}},
        h(doc,"h3",{class:"kpi-label",text:ctx.t(`integrations.kpi.${k}`)}),
        h(doc,"p",{class:"kpi-value",text:n===null?MISSING:formatCount(n)}),
        h(doc,"p",{class:"kpi-qual",text:ctx.t(`integrations.kpi.q.${k}`)}),
        h(doc,"p",{class:"kpi-src",text:`GET ${INTEG_SOURCE_PATHS[k]}`}));
    })));
}

function tallyLine(ctx,kind,entries){
  const doc=ctx.doc;
  return h(doc,"p",{class:"note integ-tally",dataset:{tally:kind}},
    h(doc,"span",{text:ctx.t(`integrations.tally.${kind}`)+" "}),
    entries.map(e=>h(doc,"span",{class:"badge mono",dataset:{value:e.value,n:String(e.count)},text:`${e.value} × ${e.count}`})));
}
function fact(ctx,label,value){
  const doc=ctx.doc;
  return h(doc,"span",{class:"integ-fact"},h(doc,"span",{class:"integ-fact-label",text:ctx.t(label)+" "}),value);
}
function row(ctx,kind,it){
  const doc=ctx.doc;
  return h(doc,"li",{class:"card integ-row",dataset:{integItem:it.id,status:it.status,implementation:it.implementation}},
    h(doc,"h4",{class:"mono",text:it.id}),
    it.name?h(doc,"p",{class:"integ-name",text:it.name}):null,
    it.category?h(doc,"p",{class:"integ-name",dataset:{field:"category"},text:it.category}):null,
    h(doc,"p",{class:"integ-facts"},
      fact(ctx,"integrations.field.status",badge(ctx,it.status,"mono")),
      fact(ctx,"integrations.field.implementation",badge(ctx,it.implementation,"mono")),
      it.activation?fact(ctx,"integrations.field.activation",badge(ctx,it.activation,"mono")):null,
      it.requiresCertification===null?null:fact(ctx,"integrations.field.requiresCertification",h(doc,"span",{class:"mono",dataset:{field:"requiresCertification",value:String(it.requiresCertification)},text:ctx.t(it.requiresCertification?"integrations.yes":"integrations.no")}))));
}
function registryPanel(ctx,kind,a){
  const doc=ctx.doc,reg=a.registries[kind];
  let body;
  if(reg===null)body=h(doc,"p",{class:`note note-${a.sources[kind].state.toLowerCase()}`,role:"status",dataset:{integWithheld:kind},text:ctx.t(`integrations.${kind}.withheld`)});
  else if(!reg.items.length)body=h(doc,"p",{class:"note",role:"status",dataset:{integEmpty:kind},text:ctx.t(`integrations.${kind}.none`)});
  else body=[tallyLine(ctx,"status",reg.byStatus),tallyLine(ctx,"implementation",reg.byImplementation),
    h(doc,"ul",{class:"cards integ-list","aria-label":ctx.t(`integrations.${kind}.aria`)},reg.items.map(it=>row(ctx,kind,it)))];
  return panel(ctx,{titleKey:`integrations.${kind}.title`,id:`integ-${kind}`,className:"integ-section"},h(doc,"p",{class:"note",text:ctx.t(`integrations.${kind}.lead`)}),body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [capabilities,adapters,fabrics]=await Promise.all([
    read(()=>api.integrationsCapabilities(),{registry:null}),
    read(()=>api.integrationsAdapters(),{registry:null}),
    read(()=>api.integrationsFabrics(),{registry:null})
  ]);
  const res={capabilities,adapters,fabrics};
  const a=buildIntegrations(res);
  return h(doc,"div",{class:"view view-integrations"},header(ctx),sourcesPanel(ctx,res,a),countsPanel(ctx,a),registryPanel(ctx,"capabilities",a),registryPanel(ctx,"adapters",a),registryPanel(ctx,"fabrics",a));
}
