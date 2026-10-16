// //TR: Bu görünüm Proje Yolculuğu'dur (FA-V2-PRODUCT): seçili mission için OTONOM ZİNCİRİ premium bir faz zaman çizelgesi olarak gösterir — pre-dev fazları (BusinessAnalysis -> Requirements -> Plan -> Architecture -> UxSpec) gerçek artefakt durumuyla (GET /v1/predev/:missionId), ardından ekip koordinasyon ledger'ı ve geliştirme -> bağımsız inceleme -> teslim zaman çizelgesi (GET /v1/crew/:missionId). Yalnız bu iki salt-okunur GET'ten okunur; HİÇBİR faz/artefakt/onay/verdict UYDURULMAZ ve PRODUCT_VERIFIED ASLA gösterilmez (okuma-modeli bunu iddia etmez). Teslim yalnız kaynak düzeyindedir (ürün doğrulanmadı). Mission seçimi mevcut seçimi (forms.js selection.missionId) ve mission listesini yeniden kullanır. Backend verisi yoksa dürüst boş durum, okuma başarısızsa OFFLINE/UNAVAILABLE/ERROR gösterilir. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,missionPill,emptyNote} from "../components.js";
import {MISSING,formatTime} from "../model.js";
import {selection} from "../forms.js";
import {MISSION_ID_RE,PREDEV_KINDS,PHASE_KIND,PILL_FOR_STATE,downstreamOf} from "../journey-core.js";

const PREDEV_SRC="/v1/predev/:missionId",CREW_SRC="/v1/crew/:missionId";
const isLive=res=>res&&res.state==="VERIFIED";
/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const mono=(doc,t)=>t?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
const shortSha=s=>s?String(s).slice(0,12):null;
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("journey.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.journey.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.journey.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("journey.readonly")}),
    // Dürüstlük uyarısı: teslim yalnız kaynak düzeyindedir, ürün doğrulaması iddia edilmez.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("journey.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. */
function stateBlock(ctx,res,source){
  const doc=ctx.doc,state=failState(res.state);
  return h(doc,"div",{class:`journey-state state-${state.toLowerCase()}`,role:"status",dataset:{journeyState:state}},
    h(doc,"p",{class:"journey-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`journey.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`journey.hint.${state}`,{source:`GET ${source}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}

/** Artefakt/atama durumu rozeti: ham durum kodu etiket olur, kategori ikon+renk taşır (renk tek başına anlam taşımaz). */
const artPill=(ctx,state)=>statePill(ctx,PILL_FOR_STATE[state]??"NEUTRAL",{label:state});

// ---- mission seçici ----
function missionSelector(ctx,mres,selectedId){
  const doc=ctx.doc;
  let body;
  if(!isLive(mres))body=stateBlock(ctx,mres,"/v1/missions");
  else if(!mres.items.length)body=emptyNote(ctx,"journey.missions.empty");
  else{
    const select=h(doc,"select",{id:"journey-mission",dataset:{focusKey:"journey-mission"},"aria-describedby":"journey-mission-hint",
      on:{change:async e=>{const v=e.target.value;selection.missionId=MISSION_ID_RE.test(v)?v:null;await ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:["id:journey-mission"]})}}},
      h(doc,"option",{value:"",selected:!selectedId,text:ctx.t("journey.selector.placeholder")}),
      mres.items.map(m=>h(doc,"option",{value:m.missionId,selected:m.missionId===selectedId,text:`${m.title} · ${m.missionId}`})));
    body=h(doc,"div",{class:"field journey-selector"},h(doc,"label",{for:"journey-mission",text:ctx.t("journey.selector.label")}),select,h(doc,"p",{class:"field-hint",id:"journey-mission-hint",text:ctx.t("journey.selector.hint")}));
  }
  const chosen=isLive(mres)&&selectedId?mres.items.find(m=>m.missionId===selectedId):null;
  return panel(ctx,{titleKey:"journey.selector.title",id:"journey-selector"},body,
    chosen?h(doc,"p",{class:"journey-chosen",dataset:{mission:chosen.missionId}},missionPill(ctx,chosen.status)," ",h(doc,"strong",{text:chosen.title})):null);
}

// ---- zincir şeridi (rail) ----
function focusPanel(ctx,id){
  const n=ctx.doc.getElementById?.(id);if(!n)return;
  if(typeof n.scrollIntoView==="function")n.scrollIntoView({block:"start"});
  if(typeof n.focus==="function")n.focus();
}
function railNode(ctx,{id,labelKey,pill,sub,target,current}){
  const doc=ctx.doc;
  return h(doc,"li",{class:"journey-step",dataset:{stage:id,stepState:pill.state}},
    h(doc,"button",{type:"button",class:"journey-node",id:`journey-node-${id}`,dataset:{focusKey:`journey-node-${id}`},"aria-current":current?"step":null,on:{click:()=>focusPanel(ctx,target)}},
      h(doc,"span",{class:"journey-num","aria-hidden":"true"}),
      h(doc,"span",{class:"journey-name",text:ctx.t(labelKey)}),
      pill.node,
      sub?h(doc,"span",{class:"journey-sub",text:sub}):null));
}
function chainRail(ctx,pre,crew){
  const doc=ctx.doc,steps=[];
  const currentKind=isLive(pre)?PHASE_KIND[pre.predev.phase]??null:null;
  PREDEV_KINDS.forEach((kind,i)=>{
    let pill;
    if(isLive(pre)){const a=pre.predev.artifacts.find(x=>x.kind===kind);pill={state:a.state,node:artPill(ctx,a.state)}}
    else pill={state:failState(pre.state),node:statePill(ctx,failKind(pre.state))};
    steps.push(railNode(ctx,{id:kind,labelKey:`journey.kind.${kind}`,pill,target:"journey-predev",current:currentKind===kind}));
  });
  // Aşağı akış düğümleri yalnız crew okumasının gerçek kaydından; son listelenen koşu kullanılır ve koşu kimliği şeritte açıkça yazılır.
  const ds=isLive(crew)?downstreamOf(crew.crew.runs):null;
  const lastRun=ds?ctx.t("journey.rail.run",{id:ds.runId}):null;
  const down=(id,labelKey,build)=>{
    let pill;
    if(!isLive(crew))pill={state:failState(crew.state),node:statePill(ctx,failKind(crew.state))};
    else if(!ds)pill={state:"NOT_STARTED",node:artPill(ctx,"NOT_STARTED")};
    else pill=build(ds);
    return railNode(ctx,{id,labelKey,pill,sub:lastRun,target:"journey-dev"});
  };
  steps.push(down("develop","journey.stage.develop",d=>d.developed?{state:"SOURCE_RECORDED",node:statePill(ctx,"DONE",{label:ctx.t("journey.dev.sourceRecorded")})}:{state:"NOT_STARTED",node:artPill(ctx,"NOT_STARTED")}));
  steps.push(down("review","journey.stage.review",d=>{
    const v=d.finalVerdict;
    if(v==="NONE")return {state:"NOT_STARTED",node:artPill(ctx,"NOT_STARTED")};
    const kind=v==="REVIEW_CLEAN"?"DONE":v==="REWORK_REQUESTED"?"ATTENTION":"BLOCKED";
    return {state:v,node:statePill(ctx,kind,{label:v})};
  }));
  steps.push(down("delivery","journey.stage.delivery",d=>d.sourceDelivered
    // Teslim yalnız kaynak düzeyindedir: NOT_VERIFIED rozeti, asla PRODUCT_VERIFIED.
    ?{state:"SOURCE_ONLY",node:statePill(ctx,"NOT_VERIFIED",{label:ctx.t("journey.delivery.sourceOnlyShort")})}
    :{state:"NOT_STARTED",node:artPill(ctx,"NOT_STARTED")}));
  steps.forEach((s,i)=>{const num=s.children[0].children[0];num.textContent=String(i+1)});
  return panel(ctx,{titleKey:"journey.chain.title",id:"journey-chain",className:"journey-chain-panel"},
    h(doc,"p",{class:"note",text:ctx.t("journey.chain.lead")}),
    h(doc,"ol",{class:"journey-rail","aria-label":ctx.t("journey.chain.aria"),dataset:{journeyRail:"1"}},steps),
    ds?h(doc,"p",{class:"note",dataset:{note:"latest-run"},text:ctx.t("journey.rail.latestNote",{id:ds.runId,n:ds.runCount})}):null);
}

// ---- pre-dev fazları ----
function predevPanel(ctx,pre){
  const doc=ctx.doc;
  let body;
  if(!isLive(pre))body=stateBlock(ctx,pre,PREDEV_SRC);
  else if(!pre.predev.active)body=emptyNote(ctx,"journey.predev.empty");
  else{
    const p=pre.predev,currentKind=PHASE_KIND[p.phase]??null;
    const rows=p.artifacts.map(a=>h(doc,"li",{class:"journey-phase",dataset:{kind:a.kind,artState:a.state,approved:a.approved?"1":"0"},"aria-current":a.kind===currentKind?"step":null},
      h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
      h(doc,"div",{class:"journey-phase-body"},
        h(doc,"p",{class:"journey-phase-head"},h(doc,"strong",{text:ctx.t(`journey.kind.${a.kind}`)})," ",artPill(ctx,a.state)),
        h(doc,"p",{class:"note",text:ctx.t(`journey.artState.${a.state}`)}),
        h(doc,"dl",{class:"journey-facts"},
          h(doc,"dt",{text:ctx.t("journey.field.version")}),h(doc,"dd",{class:"mono",text:a.version===null?MISSING:String(a.version)}),
          h(doc,"dt",{text:ctx.t("journey.field.author")}),h(doc,"dd",{},mono(doc,a.authorRoleId)),
          h(doc,"dt",{text:ctx.t("journey.field.approved")}),h(doc,"dd",{text:ctx.t(a.approved?"journey.yes":"journey.no")}),
          h(doc,"dt",{text:ctx.t("journey.field.evidence")}),h(doc,"dd",{class:"mono",text:String(a.evidenceCount)}),
          h(doc,"dt",{text:ctx.t("journey.field.mappedRoles")}),h(doc,"dd",{},a.mappedRoleIds.length?a.mappedRoleIds.map(r=>h(doc,"span",{class:"mono journey-role",text:r})):MISSING)))));
    body=[h(doc,"p",{class:"note",dataset:{phase:p.phase},text:ctx.t("journey.predev.phase",{phase:ctx.t(`journey.phase.${p.phase}`)})}),
      h(doc,"ol",{class:"journey-phases","aria-label":ctx.t("journey.predev.aria")},rows)];
  }
  const sec=panel(ctx,{titleKey:"journey.predev.title",id:"journey-predev",className:"journey-section"},h(doc,"p",{class:"note",text:ctx.t("journey.predev.lead")}),body);
  sec.setAttribute("tabindex","-1");return sec;
}

// ---- crew koordinasyon ledger'ı ----
function crewPanel(ctx,crew){
  const doc=ctx.doc;
  let body;
  if(!isLive(crew))body=stateBlock(ctx,crew,CREW_SRC);
  else{
    const c=crew.crew;
    const experts=h(doc,"ul",{class:"journey-experts","aria-label":ctx.t("journey.crew.expertsAria")},c.experts.map(x=>h(doc,"li",{class:"journey-expert",dataset:{role:x.roleId,kind:x.kind,assignment:x.assignmentState}},
      h(doc,"span",{class:"journey-expert-kind",text:ctx.t(`journey.kind.${x.kind}`)}),
      h(doc,"span",{class:"mono journey-role",text:x.roleId}),
      artPill(ctx,x.assignmentState),
      h(doc,"span",{class:"note",text:ctx.t("journey.crew.versionRework",{v:x.currentVersion,n:x.reworkCount})}))));
    const events=c.events.length
      ?h(doc,"ol",{class:"timeline journey-events","aria-label":ctx.t("journey.crew.eventsAria")},c.events.slice(0,100).map(e=>
        h(doc,"li",{class:"tl-item",dataset:{event:e.type,kind:e.kind}},
          h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
          h(doc,"time",{datetime:e.at??undefined,text:e.at?formatTime(e.at,ctx.i18n.lang):MISSING}),
          h(doc,"div",{class:"tl-body"},
            h(doc,"strong",{class:"tl-title",text:ctx.t("journey.crew.eventTitle",{type:ctx.t(`journey.event.${e.type}`),kind:ctx.t(`journey.kind.${e.kind}`),v:e.version})}),
            h(doc,"div",{class:"tl-attr"},mono(doc,e.roleId),e.actor?` · ${e.actor}`:""),
            h(doc,"div",{class:"tl-meta"},artPill(ctx,e.type==="RECORDED"?"DRAFT":e.type==="REWORK_REQUESTED"?"REJECTED":e.type),
              e.reason?h(doc,"span",{class:"note",dataset:{reason:"1"},text:ctx.t("journey.crew.reason",{reason:e.reason})}):null)))))
      :emptyNote(ctx,"journey.crew.noEvents");
    body=[c.preDevId?null:h(doc,"p",{class:"note",dataset:{note:"plan-only"},text:ctx.t("journey.crew.planOnly")}),experts,events];
  }
  const sec=panel(ctx,{titleKey:"journey.crew.title",id:"journey-crew",className:"journey-section"},h(doc,"p",{class:"note",text:ctx.t("journey.crew.lead")}),body);
  sec.setAttribute("tabindex","-1");return sec;
}

// ---- geliştirme -> bağımsız inceleme -> teslim ----
function verdictPill(ctx,v){
  const kind=v==="REVIEW_CLEAN"?"DONE":v==="REWORK_REQUESTED"?"ATTENTION":v==="REVIEW_REWORK_LIMIT_EXCEEDED"?"BLOCKED":"NOT_EXECUTED";
  return statePill(ctx,kind,{label:v});
}
function runCard(ctx,run){
  const doc=ctx.doc;
  const versions=run.versions.length
    ?h(doc,"ol",{class:"timeline journey-versions","aria-label":ctx.t("journey.dev.versionsAria")},run.versions.map(v=>h(doc,"li",{class:"tl-item",dataset:{cycle:v.cycle,verdict:v.reviewVerdict}},
      h(doc,"span",{class:"tl-dot","aria-hidden":"true"}),
      h(doc,"span",{class:"mono journey-cycle",text:ctx.t("journey.dev.cycle",{n:v.cycle})}),
      h(doc,"div",{class:"tl-body"},
        h(doc,"strong",{class:"tl-title",text:ctx.t("journey.dev.sourceVersion")}),
        h(doc,"div",{class:"tl-attr"},ctx.t("journey.dev.commit")," ",v.sourceCommit?h(doc,"span",{class:"mono",text:shortSha(v.sourceCommit)}):h(doc,"span",{text:ctx.t("journey.dev.noCommit")})),
        h(doc,"div",{class:"tl-meta"},verdictPill(ctx,v.reviewVerdict),v.reviewReason?h(doc,"span",{class:"note",dataset:{reason:"1"},text:ctx.t("journey.crew.reason",{reason:v.reviewReason})}):null)))))
    :emptyNote(ctx,"journey.dev.noVersions");
  // Teslim yalnız kaynak düzeyindedir; ürün doğrulandı ASLA iddia edilmez.
  const delivery=run.delivery
    ?h(doc,"div",{class:"journey-delivery",dataset:{delivery:"source-only"}},
      h(doc,"p",{class:"journey-state-head"},statePill(ctx,"NOT_VERIFIED",{label:ctx.t("journey.delivery.sourceOnlyShort")}),h(doc,"strong",{text:ctx.t("journey.delivery.title")})),
      h(doc,"p",{class:"note",text:ctx.t("journey.delivery.sourceOnlyNote")}),
      h(doc,"dl",{class:"journey-facts"},
        h(doc,"dt",{text:ctx.t("journey.delivery.commit")}),h(doc,"dd",{class:"mono",text:run.delivery.sourceCommit}),
        h(doc,"dt",{text:ctx.t("journey.delivery.tree")}),h(doc,"dd",{class:"mono",text:run.delivery.treeSha}),
        h(doc,"dt",{text:ctx.t("journey.delivery.hash")}),h(doc,"dd",{class:"mono",text:run.delivery.exportArtifactHash})))
    :h(doc,"p",{class:"note",dataset:{delivery:"none"},text:ctx.t("journey.delivery.none")});
  return h(doc,"article",{class:"journey-run",dataset:{run:run.runId,finalVerdict:run.finalVerdict},"aria-labelledby":`journey-run-${run.runId}`},
    h(doc,"h3",{class:"journey-run-title",id:`journey-run-${run.runId}`},ctx.t("journey.dev.run")," ",h(doc,"span",{class:"mono",text:run.runId})),
    h(doc,"dl",{class:"journey-facts"},
      h(doc,"dt",{text:ctx.t("journey.dev.developer")}),h(doc,"dd",{},mono(doc,run.developerRoleId)),
      h(doc,"dt",{text:ctx.t("journey.dev.reviewer")}),h(doc,"dd",{},mono(doc,run.reviewerRoleId)),
      h(doc,"dt",{text:ctx.t("journey.dev.finalVerdict")}),h(doc,"dd",{},verdictPill(ctx,run.finalVerdict))),
    h(doc,"p",{class:"note",text:ctx.t(`journey.verdict.${run.finalVerdict}`)}),
    versions,delivery);
}
function devPanel(ctx,crew){
  const doc=ctx.doc;
  let body;
  if(!isLive(crew))body=stateBlock(ctx,crew,CREW_SRC);
  else if(!crew.crew.runs.length)body=emptyNote(ctx,"journey.dev.empty");
  else body=crew.crew.runs.map(r=>runCard(ctx,r));
  const sec=panel(ctx,{titleKey:"journey.dev.title",id:"journey-dev",className:"journey-section"},h(doc,"p",{class:"note",text:ctx.t("journey.dev.lead")}),body);
  sec.setAttribute("tabindex","-1");return sec;
}

export async function render(ctx){
  const doc=ctx.doc;
  let mres;try{mres=stateRes(await ctx.api.missions())}catch{mres={state:"ERROR",items:[]}}
  // Seçim yalnız kanonik kimlikse ve (liste okunabiliyorsa) listede varsa geçerlidir; paylaşılan seçim burada değiştirilmez.
  let id=typeof selection.missionId==="string"&&MISSION_ID_RE.test(selection.missionId)?selection.missionId:null;
  if(id&&isLive(mres)&&!mres.items.some(m=>m.missionId===id))id=null;
  const root=h(doc,"div",{class:"view view-journey"},header(ctx),missionSelector(ctx,mres,id));
  if(!id){
    root.append(h(doc,"section",{class:"panel journey-empty",id:"journey-none","aria-labelledby":"journey-none-t",dataset:{journey:"no-mission"}},
      h(doc,"h2",{class:"panel-title",id:"journey-none-t",text:ctx.t("journey.chain.title")}),emptyNote(ctx,"journey.noMission")));
    return root;
  }
  let pre,crew;
  [pre,crew]=await Promise.all([
    Promise.resolve().then(()=>ctx.api.predev(id)).then(stateRes,()=>({state:"ERROR",predev:null})),
    Promise.resolve().then(()=>ctx.api.crew(id)).then(stateRes,()=>({state:"ERROR",crew:null}))
  ]);
  root.append(chainRail(ctx,pre,crew),predevPanel(ctx,pre),crewPanel(ctx,crew),devPanel(ctx,crew));
  return root;
}
