// //TR: Bu görünüm AI İş Gücü alanıdır. Üst bölüm (DEĞİŞMEDİ): kayıtlı roller (GET /v1/agents kanonik sayı), hedef rol, sertifikalı sayı, aktif çalışan koşular (GET /v1/cockpit) ve canlı koşular (GET /v1/work-runs) ayrı gösterilir; "599 hedef rol kataloğu ≠ çalışan ajan" notu açıktır.
// //TR: UX WP-AGENTS: Alt bölüm canlı /v1/roles rol KATALOĞUNA bağlı referans-sınıf premium katmandır: katalog genel bakışı (gerçek toplam + küme/loncaya göre dağılım), küme/lonca/başlık süzgeciyle gözatma ve rol tanımı ayrıntısı (sorumluluklar/uzmanlık/yasak eylemler/değerlendirme şartnameleri GET /v1/roles/:roleId'den). Her değer GERÇEK veridendir; api.roleCatalog() tam-ya-da-boş döner (asla kısmi); katalog yüklü değilse dürüst sayı-ya-da-boş gösterilir, 599 uydurulmaz.
// //TR: DÜRÜST ROL ANLAMI (FD-NIHAI): 599 kayıt rol TANIMLARI kataloğudur; 599 canlı/aktif ajan DEĞİLDİR ve sertifikalı işçi DEĞİLDİR. runtimeStatus (UNKNOWN) ve proficiencyStatus (NOT_EVALUATED / 0 sertifikalı) dürüst ve belirgin gösterilir; asla N aktif ajan / N sertifikalı işçi / canlı ajan etkinliği ima edilmez. API verisi HTML olarak yorumlanmaz (yalnız h()/textContent).
import {h,panel,chip,stateNote,emptyNote,statusPill,statusLabel,statePill,miniBars} from "../components.js";
import {formatCount,MISSING} from "../model.js";
import {liveRuns,formatDateTime} from "../work-core.js";
import {selection} from "../forms.js";
import {notVerifiedBadge,runNotVerified} from "../m1a.js";
import {buildTaxonomy} from "../workforce-taxonomy-core.js";
import {fleetGroups,fleetCard,fleetDetail} from "../fleet-core.js";
import {FACTORY_COUNTERS,STATUS_SUMMARY_PATH} from "../agent-factory-core.js";

// //TR: Ajan Fabrikası durumu (Founder direktifi 599 ajan): GET /v1/roles/status-summary'nin beş sayacı AYRI gösterilir (kayıtlı, uygulanmış, test edilmiş, sertifikalı, çalışan); toplanmaz, oranlanmaz, "599 kayıtlı" = "599 çalışan ajan" denmez. Okunamıyorsa sayı yerine durum notu gösterilir (0 uydurulmaz).
function factoryStatusPanel(ctx,res,ready){
  const doc=ctx.doc,id="wf-factory",rd=ready&&ready.state==="VERIFIED"?ready:null,runUnmeasured=rd===null||rd.reconciliation.runningMeasured===false;
  const head=[h(doc,"p",{class:"note",text:ctx.t("workforce.factory.lead")}),h(doc,"p",{class:"note",role:"note",dataset:{semantics:"SEPARATE_COUNTERS"},text:ctx.t("workforce.factory.separate")})];
  if(!res||res.state!=="VERIFIED")return panel(ctx,{titleKey:"workforce.factory.title",id,className:"wf-factory"},...head,stateNote(ctx,res?.state??"ERROR"),h(doc,"p",{class:"note mono",text:`GET ${STATUS_SUMMARY_PATH}`}));
  const s=res.summary;
  // //TR: FAIL-CLOSED: hazırlık okunamıyorsa (ERROR/404/503/bozuk) runningMeasured belirlenemez ve ölçülmemiş sayılır; ayrıca günlük yoksa (runningMeasured=false) eski "çalışan" sayacı ASLA sayı olarak gösterilmez (Bilinmiyor). "Uygulanmış" etiketi her durumda kod yolu olduğunu (bağlanmamış aşamaları içerdiğini) söyler.
  const stat=(k,v)=>{
    const unknown=k==="running"&&runUnmeasured;
    return h(doc,"div",{class:"wf-stat",dataset:{stat:`factory-${k}`,value:unknown?"UNKNOWN":String(v)}},h(doc,"span",{class:"wf-stat-num",text:unknown?ctx.t("workforce.ready.runningUnknown"):formatCount(v)}),
      h(doc,"span",{class:"wf-stat-label",text:ctx.t(k==="implemented"?"workforce.ready.legacy.implemented":`workforce.factory.${k}`)}));
  };
  const cols=["workforce.factory.guild",...FACTORY_COUNTERS.map(k=>`workforce.factory.${k}`)];
  const table=s.byGuild.length?h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"wf-factory-guilds",dataset:{factoryTable:"guilds"}},
    h(doc,"caption",{class:"sr-only",text:ctx.t("workforce.factory.byGuild")}),
    h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},s.byGuild.map(g=>h(doc,"tr",{dataset:{factoryGuild:g.guildId}},h(doc,"td",{class:"mono",text:g.guildId}),FACTORY_COUNTERS.map(k=>h(doc,"td",{class:"num",text:k==="running"&&runUnmeasured?ctx.t("workforce.ready.runningUnknown"):formatCount(g[k])}))))))):emptyNote(ctx,"workforce.factory.noGuilds");
  const legacyNote=rd!==null
    ?h(doc,"p",{class:"note",role:"note",dataset:{legacyProjection:"DEPRECATED_LEGACY_PROJECTION",consistent:String(rd.reconciliation.consistent)},text:ctx.t("workforce.ready.legacy.note",{consistent:ctx.t(rd.reconciliation.consistent?"workforce.ready.legacy.yes":"workforce.ready.legacy.no"),n:formatCount(rd.reconciliation.mismatchCount)})})
    :h(doc,"p",{class:"note note-unknown",role:"note",dataset:{legacyProjection:"UNVERIFIED"},text:ctx.t("workforce.ready.legacy.unverified")});
  return panel(ctx,{titleKey:"workforce.factory.title",id,className:"wf-factory"},...head,legacyNote,
    h(doc,"p",{class:"duo-sub",dataset:{factoryTarget:String(s.target)},text:ctx.t("workforce.factory.target",{n:formatCount(s.target)})}),
    h(doc,"div",{class:"wf-stats",role:"group","aria-label":ctx.t("workforce.factory.statsLabel")},FACTORY_COUNTERS.map(k=>stat(k,s[k]))),
    h(doc,"h3",{class:"wf-dist-title",text:ctx.t("workforce.factory.byGuild")}),table,
    h(doc,"p",{class:"note mono",dataset:{factoryBasis:"1"},text:ctx.t("workforce.factory.basis",{at:formatDateTime(s.computedAt,ctx.i18n.lang),sha:s.basis.roleDefinitionsSha256.slice(0,12),n:formatCount(s.basis.bindingsCount)})}),
    h(doc,"p",{class:"note mono",text:`GET ${STATUS_SUMMARY_PATH}`}));
}

// //TR: Rol hazırlığı (8 katman): TEK doğru kaynak. Her katman AYRI satırdır; sayılar paydasıyla birlikte gösterilir ("TRUE k, FALSE f / n"), ölçülemeyen katman "TRUE k, UNKNOWN u / n" der (asla çıplak 0), çalıştırma günlüğü yokken RUNNING "Bilinmiyor – çalıştırma günlüğü yok" der ve TRUE sayısı gösterilmez. Katmanlar toplanmaz, yüzdeye çevrilmez; önerilen (proposedOnly) profiller ayrı kutudadır. Okunamıyorsa sayı yerine durum notu gösterilir (0 uydurulmaz).
function layerCountsText(ctx,L,journal){
  const v={t:formatCount(L.TRUE),f:formatCount(L.FALSE),u:formatCount(L.UNKNOWN),na:formatCount(L.NOT_APPLICABLE),n:formatCount(L.denominator)};
  if(L.layer==="RUNNING"&&journal==="ABSENT")return ctx.t("workforce.ready.runningUnknownCounts",v);
  if(L.measured)return ctx.t(L.NOT_APPLICABLE>0?"workforce.ready.counts.measuredNa":"workforce.ready.counts.measured",v);
  return ctx.t(L.NOT_APPLICABLE>0?"workforce.ready.counts.unmeasuredNa":L.FALSE>0?"workforce.ready.counts.unmeasuredFalse":"workforce.ready.counts.unmeasured",v);
}
function readinessPanel(ctx,res){
  const doc=ctx.doc,id="wf-readiness";
  const head=[h(doc,"p",{class:"note",dataset:{semantics:"LAYERS_SEPARATE"},text:ctx.t("workforce.ready.lead")})];
  if(!res||res.state!=="VERIFIED")return panel(ctx,{titleKey:"workforce.ready.title",id,className:"wf-readiness"},...head,stateNote(ctx,res?.state??"ERROR"),
    h(doc,"p",{class:"note note-unknown",role:"status",dataset:{readiness:"UNAVAILABLE"},text:ctx.t("workforce.ready.unavailable")}),h(doc,"p",{class:"note mono",text:`GET ${STATUS_SUMMARY_PATH}`}));
  const r=res.readiness,journal=r.inputs.journal;
  const row=(L,labelKey)=>{
    const unknownRunning=L.layer==="RUNNING"&&journal==="ABSENT";
    return h(doc,"tr",{dataset:{readinessLayer:L.layer,measured:String(L.measured)}},
      h(doc,"th",{scope:"row",text:ctx.t(labelKey)}),
      h(doc,"td",{class:"num",dataset:unknownRunning?{readinessUnknown:"1"}:{}},unknownRunning?[h(doc,"strong",{text:ctx.t("workforce.ready.runningUnknown")})," · "]:null,layerCountsText(ctx,L,journal)),
      h(doc,"td",{},L.measured?null:h(doc,"span",{class:"note",text:ctx.t("workforce.ready.notMeasured")})));
  };
  const table=h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"wf-readiness-layers",dataset:{readinessTable:"layers"}},
    h(doc,"caption",{class:"sr-only",text:ctx.t("workforce.ready.title")}),
    h(doc,"tbody",{},[...r.layers.map(L=>row(L,`workforce.ready.layer.${L.layer}`)),row({layer:"STAGE_WIRED",...r.stageWired},"workforce.ready.stageWired")])));
  const p=r.proposedOnly;
  return panel(ctx,{titleKey:"workforce.ready.title",id,className:"wf-readiness"},...head,
    h(doc,"p",{class:"duo-sub",dataset:{readinessDenominator:String(r.denominator)},text:ctx.t("workforce.ready.denominator",{n:formatCount(r.denominator)})}),
    table,
    h(doc,"p",{class:"note",dataset:{readinessInputs:"1"},text:ctx.t("workforce.ready.inputs",{journal:ctx.t(`workforce.ready.input.${journal}`),adapters:ctx.t(`workforce.ready.input.${r.inputs.adapterReality}`),stages:ctx.t(`workforce.ready.input.${r.inputs.reachableStages}`)})}),
    r.authority==="AUTHORITATIVE_READINESS_MEASUREMENT"?null:h(doc,"p",{class:"note note-error",role:"note",dataset:{readinessAuthority:r.authority},text:ctx.t(`workforce.ready.authority.${r.authority}`)}),
    p.source==="ABSENT"?null:h(doc,"div",{class:"card wf-proposed",dataset:{readinessProposed:"1"}},h(doc,"h3",{class:"wf-dist-title",text:ctx.t("workforce.ready.proposed.title")}),
      h(doc,"p",{class:"note",text:ctx.t("workforce.ready.proposed.text",{p:formatCount(p.profiles),s:formatCount(p.withCandidateSkills),a:formatCount(p.withCandidateToolAdapters)})})),
    h(doc,"p",{class:"note",dataset:{readinessAnomalies:String(r.anomalies)},text:ctx.t("workforce.ready.anomalies",{n:formatCount(r.anomalies)})}),
    h(doc,"p",{class:"note mono",dataset:{readinessBasis:"1"},text:ctx.t("workforce.ready.basis",{at:formatDateTime(r.computedAt,ctx.i18n.lang),sha:r.digest.slice(0,12)})}),
    h(doc,"p",{class:"note mono",text:`GET ${STATUS_SUMMARY_PATH}`}));
}

// //TR: Katalog gözatma seçimi (süzgeç + seçili rol) görünüm ömrü boyunca korunur; periyodik yenileme seçimi bozmaz.
const catState={cluster:"ALL",guild:"ALL",q:"",roleId:null,page:0};
const fleetSel={runId:null};
export function resetWorkforceView(){fleetSel.runId=null;catState.cluster="ALL";catState.guild="ALL";catState.q="";catState.roleId=null;catState.page=0}
const DISPLAY_LIMIT=150;

function liveRunsBody(ctx,runs){
  const doc=ctx.doc;
  if(runs.state!=="VERIFIED")return stateNote(ctx,runs.state,runs.state==="UNAVAILABLE"?"run.unavailable":undefined);
  const live=liveRuns(runs.items);
  if(!live.length)return emptyNote(ctx,"workforce.live.none");
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("workforce.live.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["workforce.live.run","workforce.live.role","workforce.live.status","workforce.live.heartbeat","workforce.live.mission"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},live.map(r=>h(doc,"tr",{dataset:{runId:r.runId}},
      h(doc,"td",{class:"mono",text:r.runId}),h(doc,"td",{text:r.role??MISSING}),h(doc,"td",{},statusPill(ctx,r.status),runNotVerified(r)?[" ",notVerifiedBadge(ctx,"run")]:null),h(doc,"td",{text:formatDateTime(r.heartbeatAt,ctx.i18n.lang)}),
      h(doc,"td",{},r.missionId?h(doc,"button",{type:"button",class:"link-btn",id:`wf-open-${r.runId}`,dataset:{focusKey:`wf-open-${r.runId}`},on:{click:()=>{selection.missionId=r.missionId;ctx.navigate("work")}},text:ctx.t("workforce.live.open")}):MISSING))))));
}

// //TR: UI-030 işçi filosu ızgarası: GET /v1/work-runs'tan yalnız canlı koşular, durum kovalarına göre kart; okuma başarısızsa dürüst durum notu ızgaranın yerini alır (asla 0). Olmayan alanlar BİLİNMİYOR; en çok 50 kart + "X / Y" notu.
// //TR: UI-032 işçi ayrıntı paneli: yalnız seçili canlı koşunun mevcut alanları; koşu artık canlı değilse panel görünmez. Canlı ajan telemetrisi yoktur, UNKNOWN gösterilir.
function fleetDetailPanel(ctx,items){
  const doc=ctx.doc,d=fleetDetail(items,fleetSel.runId);
  if(!d)return null;
  const unknown=()=>h(doc,"span",{class:"wf-fleet-unknown",dataset:{unknown:"1"},text:ctx.t("workforce.fleet.unknown")});
  const row=(k,v)=>h(doc,"div",{},h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",{},v));
  return h(doc,"section",{class:"wf-fleet-detail",id:"wf-fleet-detail",dataset:{fleetDetailFor:d.runId},"aria-label":ctx.t("workforce.fleet.detail.title",{id:d.runId})},
    h(doc,"h3",{class:"wf-fleet-h",text:ctx.t("workforce.fleet.detail.title",{id:d.runId})}),
    h(doc,"dl",{class:"wf-fleet-kv"},
      row("workforce.fleet.detail.status",statusPill(ctx,d.status)),
      row("workforce.fleet.role",d.role?h(doc,"span",{text:d.role}):unknown()),
      row("workforce.fleet.detail.mission",d.missionId?h(doc,"span",{class:"mono",text:d.missionId}):unknown()),
      row("workforce.fleet.updated",d.updatedAt?h(doc,"time",{datetime:d.updatedAt,text:formatDateTime(d.updatedAt,ctx.i18n.lang)}):unknown()),
      row("workforce.fleet.detail.telemetry",unknown())),
    h(doc,"p",{class:"note",text:ctx.t("workforce.fleet.detail.note")}));
}

function fleetBody(ctx,runs){
  const doc=ctx.doc;
  if(runs.state!=="VERIFIED")return stateNote(ctx,runs.state,runs.state==="UNAVAILABLE"?"run.unavailable":undefined);
  const f=fleetGroups(runs.items);
  if(!f.total)return emptyNote(ctx,"workforce.fleet.none");
  const unknown=()=>h(doc,"span",{class:"wf-fleet-unknown",dataset:{unknown:"1"},text:ctx.t("workforce.fleet.unknown")});
  const card=run=>{
    const c=fleetCard(run);
    return h(doc,"li",{class:"wf-fleet-card",dataset:{fleetRunId:c.runId,status:c.status}},
      h(doc,"span",{class:"mono wf-fleet-id",text:c.runId}),statusPill(ctx,c.status),runNotVerified(run)?notVerifiedBadge(ctx,"run"):null,
      h(doc,"dl",{class:"wf-fleet-kv"},
        h(doc,"div",{},h(doc,"dt",{text:ctx.t("workforce.fleet.role")}),h(doc,"dd",{},c.role?h(doc,"span",{text:c.role}):unknown())),
        h(doc,"div",{},h(doc,"dt",{text:ctx.t("workforce.fleet.updated")}),h(doc,"dd",{},c.updatedAt?h(doc,"time",{datetime:c.updatedAt,text:formatDateTime(c.updatedAt,ctx.i18n.lang)}):unknown()))),
      h(doc,"button",{type:"button",class:"link-btn",id:`wf-fleet-detail-${c.runId}`,dataset:{focusKey:`wf-fleet-detail-${c.runId}`},"aria-expanded":fleetSel.runId===c.runId?"true":"false","aria-controls":"wf-fleet-detail",
        on:{click:()=>{fleetSel.runId=fleetSel.runId===c.runId?null:c.runId;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:[`id:wf-fleet-detail-${c.runId}`]})}},text:ctx.t("workforce.fleet.detail.toggle")}),
      c.missionId?h(doc,"button",{type:"button",class:"link-btn",id:`wf-fleet-open-${c.runId}`,dataset:{focusKey:`wf-fleet-open-${c.runId}`},"aria-label":ctx.t("workforce.fleet.open",{id:c.missionId}),on:{click:()=>{selection.missionId=c.missionId;ctx.navigate("work")}},text:ctx.t("workforce.live.open")}):null);
  };
  return h(doc,"div",{class:"wf-fleet",role:"region","aria-label":ctx.t("workforce.fleet.label")},
    h(doc,"p",{class:"note",text:ctx.t("workforce.fleet.lead")}),
    f.groups.map(g=>h(doc,"section",{class:"wf-fleet-group",dataset:{bucket:g.status},"aria-label":ctx.t("workforce.fleet.group",{status:statusLabel(ctx,g.status),n:String(g.count)})},
      h(doc,"h3",{class:"wf-fleet-h",text:ctx.t("workforce.fleet.group",{status:statusLabel(ctx,g.status),n:String(g.count)})}),
      h(doc,"ul",{class:"wf-fleet-list"},g.items.map(card)))),
    fleetDetailPanel(ctx,runs.items),
    f.truncated?h(doc,"p",{class:"note",dataset:{truncated:"1"},text:ctx.t("workforce.fleet.showing",{shown:String(f.shown),total:String(f.total)})}):null);
}

// //TR: Ham durum (UNKNOWN/NOT_EVALUATED/NOT_EXECUTED vb.) yükseltilmeden nötr rozet olarak gösterilir; renk tek başına anlam taşımaz, metin ham değerdir.
const statusChip=(ctx,value)=>statePill(ctx,"NEUTRAL",{label:value??MISSING});
const countBy=(items,key)=>{const m=new Map();for(const it of items){const k=it[key];m.set(k,(m.get(k)??0)+1)}return m};
const distinctSorted=(items,key)=>[...new Set(items.map(x=>x[key]))].sort((a,b)=>String(a).localeCompare(String(b)));
const distEntries=map=>[...map.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).map(([key,value])=>({key,value,label:key,tone:"accent"}));

// //TR: Genel bakış: yalnız VERIFIED katalogdan gerçek toplam, küme/lonca sayısı, sertifikalı (0) ve küme dağılımı; katalog canlı değilse dürüst durum notu, sayı uydurulmaz.
function overview(ctx,catalog){
  const doc=ctx.doc;
  if(catalog.state!=="VERIFIED")return panel(ctx,{titleKey:"workforce.cat.title",id:"wf-catalog",className:"wf-catalog"},
    h(doc,"p",{class:"note",text:ctx.t("workforce.cat.lead")}),stateNote(ctx,catalog.state),h(doc,"p",{class:"note mono",text:ctx.t("workforce.cat.source")}));
  const items=catalog.items,certified=items.filter(r=>r.proficiencyStatus==="CERTIFIED").length;
  const clusters=distinctSorted(items,"clusterId").length,guilds=distinctSorted(items,"guildId").length;
  const stat=(id,labelKey,value)=>h(doc,"div",{class:"wf-stat",dataset:{stat:id}},h(doc,"span",{class:"wf-stat-num",text:formatCount(value)}),h(doc,"span",{class:"wf-stat-label",text:ctx.t(labelKey)}));
  return panel(ctx,{titleKey:"workforce.cat.title",id:"wf-catalog",className:"wf-catalog"},
    h(doc,"p",{class:"note",text:ctx.t("workforce.cat.lead")}),
    // //TR: DÜRÜST anlam bandı: rol TANIMI sayısı, runtime UNKNOWN, 0 sertifikalı / NOT_EVALUATED — canlı/aktif ajan değildir.
    h(doc,"p",{class:"note note-catalog",role:"note",dataset:{semantics:"TARGET_DEFINITIONS"},text:ctx.t("workforce.cat.semantics",{n:formatCount(catalog.total)})}),
    h(doc,"div",{class:"wf-stats",role:"group","aria-label":ctx.t("workforce.cat.statsLabel")},
      stat("roles","workforce.cat.totalRoles",catalog.total),stat("clusters","workforce.cat.clusters",clusters),
      stat("guilds","workforce.cat.guilds",guilds),
      h(doc,"div",{class:"wf-stat",dataset:{stat:"certified",certified:String(certified)}},h(doc,"span",{class:"wf-stat-num",text:formatCount(certified)}),h(doc,"span",{class:"wf-stat-label",text:ctx.t("workforce.cat.certified")}),h(doc,"span",{class:"wf-stat-sub",text:ctx.t("workforce.cat.notCertified")}))),
    h(doc,"div",{class:"wf-dist"},h(doc,"h3",{class:"wf-dist-title",text:ctx.t("workforce.cat.dist.cluster")}),
      miniBars(ctx,distEntries(countBy(items,"clusterId")),ctx.t("workforce.cat.dist.cluster"))??emptyNote(ctx,"workforce.cat.filter.none")),
    h(doc,"p",{class:"note mono",text:ctx.t("workforce.cat.source")}));
}

// //TR: Süzgeç: küme/lonca açılır menüleri (katalogdaki gerçek kimlikler + sayı) ve başlık/rol araması; değişimde seçim modül durumunda tutulur, görünüm yeniden çizilir ve odak süzgece döner (change ile; tuş-başı yeniden çizim yoktur).
function filterBar(ctx,items){
  const doc=ctx.doc;
  if(catState.cluster!=="ALL"&&!items.some(r=>r.clusterId===catState.cluster)){catState.cluster="ALL";catState.page=0}
  const clusterItems=catState.cluster==="ALL"?items:items.filter(r=>r.clusterId===catState.cluster);
  if(catState.guild!=="ALL"&&!clusterItems.some(r=>r.guildId===catState.guild)){catState.guild="ALL";catState.page=0}
  const clusterCounts=countBy(items,"clusterId"),guildCounts=countBy(clusterItems,"guildId");
  const sel=(id,labelKey,value,opts,onChange)=>{
    const control=h(doc,"select",{id,dataset:{focusKey:id},"aria-label":ctx.t(labelKey),on:{change:e=>onChange(e.target.value)}},
      [h(doc,"option",{value:"ALL",selected:value==="ALL",text:ctx.t("workforce.cat.filter.all")}),
        ...opts.map(o=>h(doc,"option",{value:o.value,selected:o.value===value,text:o.label}))]);
    return h(doc,"div",{class:"field"},h(doc,"label",{for:id,text:ctx.t(labelKey)}),control);
  };
  const clusterOpts=distinctSorted(items,"clusterId").map(c=>({value:c,label:`${c} (${clusterCounts.get(c)})`}));
  const guildOpts=distinctSorted(clusterItems,"guildId").map(g=>({value:g,label:`${g} (${guildCounts.get(g)})`}));
  const apply=keys=>{if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys})};
  const search=h(doc,"input",{id:"wf-q",type:"search",autocomplete:"off",spellcheck:"false",value:catState.q,"aria-label":ctx.t("workforce.cat.filter.search"),"aria-describedby":"wf-q-hint",dataset:{focusKey:"wf-q"},
    on:{change:e=>{catState.q=String(e.target.value??"").slice(0,200);catState.page=0;apply(["id:wf-q"])}}});
  return h(doc,"div",{class:"filter-row wf-filter",role:"group","aria-label":ctx.t("workforce.cat.filterLabel")},
    sel("wf-f-cluster","workforce.cat.filter.cluster",catState.cluster,clusterOpts,v=>{catState.cluster=v;catState.guild="ALL";catState.page=0;apply(["id:wf-f-cluster"])}),
    sel("wf-f-guild","workforce.cat.filter.guild",catState.guild,guildOpts,v=>{catState.guild=v;catState.page=0;apply(["id:wf-f-guild"])}),
    h(doc,"div",{class:"field"},h(doc,"label",{for:"wf-q",text:ctx.t("workforce.cat.filter.search")}),search,h(doc,"p",{class:"field-hint",id:"wf-q-hint",text:ctx.t("workforce.cat.filter.searchHint")})),
    catState.cluster!=="ALL"||catState.guild!=="ALL"||catState.q?h(doc,"button",{type:"button",class:"btn btn-small",id:"wf-f-clear",dataset:{focusKey:"wf-f-clear"},text:ctx.t("workforce.cat.filter.clear"),
      on:{click:()=>{catState.cluster="ALL";catState.guild="ALL";catState.q="";catState.page=0;apply(["id:wf-q"])}}}):null);
}

function filtered(items){
  const q=catState.q.trim().toLocaleLowerCase("tr");
  return items.filter(r=>(catState.cluster==="ALL"||r.clusterId===catState.cluster)&&(catState.guild==="ALL"||r.guildId===catState.guild)&&
    (!q||`${r.roleId} ${r.title} ${r.guildId} ${r.clusterId}`.toLocaleLowerCase("tr").includes(q)));
}

// //TR: Rol listesi: gerçek katalog satırları (roleId/başlık/lonca/küme/öncelik/runtime/yeterlilik); satır düğmesi rol tanımını seçer. Görüntü sınırı aşılırsa önceki/sonraki sayfa denetimi ve gerçek süzülmüş diziden "A–B / M" aralık notu; sayı uydurulmaz.
function roleList(ctx,items){
  const doc=ctx.doc,shown=filtered(items);
  if(!shown.length)return emptyNote(ctx,"workforce.cat.filter.none");
  const lastPage=Math.max(0,Math.ceil(shown.length/DISPLAY_LIMIT)-1),pageIdx=Math.min(Math.max(0,catState.page),lastPage);
  catState.page=pageIdx;
  const page=shown.slice(pageIdx*DISPLAY_LIMIT,(pageIdx+1)*DISPLAY_LIMIT);
  const cols=["workforce.cat.col.role","workforce.cat.col.title","workforce.cat.col.guild","workforce.cat.col.cluster","workforce.cat.col.priority","workforce.cat.col.runtime","workforce.cat.col.proficiency"];
  const table=h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table wf-cat-table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("workforce.cat.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},page.map(r=>{
      const on=catState.roleId===r.roleId;
      return h(doc,"tr",{dataset:{roleId:r.roleId,selected:on?"1":""}},
        h(doc,"td",{class:"mono"},h(doc,"button",{type:"button",class:"link-btn",dataset:{focusKey:`wf-role-${r.roleId}`,roleBtn:r.roleId},"aria-current":on?"true":null,"aria-label":ctx.t("workforce.cat.select",{id:r.roleId,title:r.title}),
          on:{click:()=>{catState.roleId=r.roleId;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:["id:wf-detail-h",`id:wf-role-${r.roleId}`]})}},text:r.roleId})),
        h(doc,"td",{text:r.title}),h(doc,"td",{class:"mono",text:r.guildId}),h(doc,"td",{class:"mono",text:r.clusterId}),h(doc,"td",{text:r.priority??MISSING}),
        h(doc,"td",{},statusChip(ctx,r.runtimeStatus)),h(doc,"td",{},statusChip(ctx,r.proficiencyStatus)));
    }))));
  if(shown.length<=DISPLAY_LIMIT)return [h(doc,"p",{class:"note",dataset:{results:"1"},text:ctx.t("workforce.cat.filter.results",{shown:String(page.length),total:String(shown.length)})}),table];
  const range=h(doc,"p",{class:"note",dataset:{catPage:String(pageIdx+1)},text:ctx.t("workforce.cat.page.range",{from:String(pageIdx*DISPLAY_LIMIT+1),to:String(pageIdx*DISPLAY_LIMIT+page.length),total:String(shown.length)})});
  // //TR: Sayfa değişimi: indeks yalnız modül belleğinde; önce yeniden çizim beklenir, sonra odak [basılan, kardeş] sırasıyla yerleşir (devre dışı kalan düğmeden odak kaybolmaz).
  const go=async(n,keys)=>{catState.page=n;if(typeof ctx.rerender==="function")await ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys})};
  const pager=h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("workforce.cat.page.label"),dataset:{catPager:"1"}},
    h(doc,"button",{type:"button",class:"btn btn-small",id:"wf-cat-prev",dataset:{focusKey:"wf-cat-prev"},disabled:pageIdx===0,"aria-label":ctx.t("workforce.cat.page.prevLabel"),on:{click:()=>go(pageIdx-1,["id:wf-cat-prev","id:wf-cat-next"])},text:ctx.t("workforce.cat.page.prev")}),
    h(doc,"button",{type:"button",class:"btn btn-small",id:"wf-cat-next",dataset:{focusKey:"wf-cat-next"},disabled:pageIdx===lastPage,"aria-label":ctx.t("workforce.cat.page.nextLabel"),on:{click:()=>go(pageIdx+1,["id:wf-cat-next","id:wf-cat-prev"])},text:ctx.t("workforce.cat.page.next")}));
  return [range,table,pager];
}

const defList=(ctx,titleKey,values)=>{
  const doc=ctx.doc;
  return h(doc,"div",{class:"wf-def"},h(doc,"h4",{class:"wf-def-title",text:ctx.t(titleKey)}),
    values.length?h(doc,"ul",{class:"wf-def-list"},values.map(v=>h(doc,"li",{text:v}))):h(doc,"p",{class:"note",text:ctx.t("workforce.cat.detail.empty")}));
};

// //TR: UI-133 salt-okunur ajan kimlik kartı: yalnız VERIFIED rol ayrıntısı (GET /v1/roles/:roleId) + GET /v1/agents kayıt sayılarından; "sertifikalı" yalnız proficiencyStatus=CERTIFIED + certifiedScope + en az bir GEÇEN (PASSED/VERIFIED) değerlendirme sonucu hepsi varsa; sertifikalı değilse kapsam "beyan edilmiş, doğrulanmamış" etiketiyle gösterilir, kanıt izi yoksa BİLİNMİYOR; rol tanımı canlı ajan değildir, yeni uç nokta/yazma yoktur.
function identityCard(ctx,r,agents){
  const doc=ctx.doc,specs=r.evaluationSpecs,passing=specs.filter(e=>e.status==="PASSED"||e.status==="VERIFIED").length,hasTrail=passing>0;
  const certified=r.proficiencyStatus==="CERTIFIED"&&!!r.certifiedScope&&hasTrail;
  const unk=()=>h(doc,"span",{class:"wf-idcard-unknown",dataset:{identityUnknown:"1"},text:ctx.t("workforce.idcard.unknown")});
  const row=(labelKey,body)=>h(doc,"div",{},h(doc,"dt",{text:ctx.t(labelKey)}),h(doc,"dd",{},body));
  const reg=agents&&agents.state==="VERIFIED"&&agents.registeredRoles!==null;
  return h(doc,"section",{class:"wf-idcard",dataset:{identityCardFor:r.roleId},"aria-label":ctx.t("workforce.idcard.title")},
    h(doc,"h4",{class:"wf-def-title",text:ctx.t("workforce.idcard.title")}),
    h(doc,"p",{class:"note",role:"note",text:ctx.t("workforce.idcard.definitionOnly")}),
    h(doc,"dl",{class:"kv wf-idcard-kv"},
      row("workforce.idcard.role",h(doc,"span",{class:"mono",text:r.roleId})),
      row("workforce.idcard.runtime",r.runtimeStatus&&r.runtimeStatus!=="UNKNOWN"?statusChip(ctx,r.runtimeStatus):unk()),
      row("workforce.idcard.proficiency",statusChip(ctx,r.proficiencyStatus)),
      row("workforce.idcard.certification",certified?h(doc,"span",{dataset:{identityCertified:"1"},text:ctx.t("workforce.idcard.certified")}):h(doc,"span",{dataset:{identityCertified:"0"},text:ctx.t("workforce.idcard.notCertified")})),
      row(certified?"workforce.idcard.scope":"workforce.idcard.scopeDeclared",r.certifiedScope?h(doc,"span",{dataset:{identityScope:certified?"verified":"declared"},text:r.certifiedScope}):unk()),
      row("workforce.idcard.evidence",hasTrail?h(doc,"span",{dataset:{identityEvidence:String(passing)},text:ctx.t("workforce.idcard.evidenceCount",{p:formatCount(passing),n:formatCount(specs.length)})}):h(doc,"span",{class:"wf-idcard-unknown",dataset:{identityEvidence:"UNKNOWN"},text:ctx.t("workforce.idcard.evidenceUnknown")})),
      row("workforce.idcard.registry",reg?h(doc,"span",{text:ctx.t("workforce.idcard.registryCounts",{r:formatCount(agents.registeredRoles),k:agents.certified===null?MISSING:formatCount(agents.certified)})}):unk())),
    h(doc,"p",{class:"note mono",text:ctx.t("workforce.idcard.source")}));
}

// //TR: Rol tanımı ayrıntısı: GET /v1/roles/:roleId'den sorumluluklar/uzmanlık/yasak eylemler/değerlendirme şartnameleri + dürüst runtime/yeterlilik durumu; hiçbir durum yükseltilmez, "canlı ajan/sertifikalı işçi değildir" notu açıktır.
function detailPanel(ctx,detail,agents){
  const doc=ctx.doc;
  if(!catState.roleId)return panel(ctx,{titleKey:"workforce.cat.detail.title",id:"wf-detail",className:"wf-detail"},
    h(doc,"h3",{id:"wf-detail-h",tabindex:"-1",class:"sr-only",text:ctx.t("workforce.cat.detail.title")}),emptyNote(ctx,"workforce.cat.detail.none"));
  if(!detail||detail.state!=="VERIFIED"||!detail.role)return panel(ctx,{titleKey:"workforce.cat.detail.title",id:"wf-detail",className:"wf-detail"},
    h(doc,"h3",{id:"wf-detail-h",tabindex:"-1",class:"sr-only",text:ctx.t("workforce.cat.detail.title")}),stateNote(ctx,detail?detail.state:"ERROR"),
    h(doc,"p",{class:"note mono",text:ctx.t("workforce.cat.srcDetail",{id:catState.roleId})}));
  const r=detail.role,g=detail.guild,c=detail.cluster;
  const kv=(labelKey,value)=>h(doc,"div",{},h(doc,"dt",{text:ctx.t(labelKey)}),h(doc,"dd",{text:value??MISSING}));
  const evalBody=r.evaluationSpecs.length?h(doc,"ul",{class:"wf-def-list"},r.evaluationSpecs.map(e=>h(doc,"li",{},h(doc,"span",{class:"mono",text:`${e.evaluationId} · ${e.kind} · `}),statusChip(ctx,e.status)))):h(doc,"p",{class:"note",text:ctx.t("workforce.cat.detail.empty")});
  return panel(ctx,{titleKey:"workforce.cat.detail.title",id:"wf-detail",className:"wf-detail"},
    h(doc,"div",{class:"wf-detail-head"},
      h(doc,"h3",{id:"wf-detail-h",tabindex:"-1",class:"wf-detail-name",dataset:{roleId:r.roleId},text:r.title}),
      h(doc,"span",{class:"mono wf-detail-id",text:r.roleId}),
      h(doc,"button",{type:"button",class:"btn btn-small",id:"wf-detail-close",dataset:{focusKey:"wf-detail-close"},text:ctx.t("workforce.cat.detail.close"),
        on:{click:()=>{const id=catState.roleId;catState.roleId=null;if(typeof ctx.rerender==="function")ctx.rerender();if(typeof ctx.settleFocus==="function")ctx.settleFocus({keys:[`id:wf-role-${id}`,"id:wf-catalog-t"]})}}})),
    h(doc,"p",{class:"note",dataset:{notRuntime:"1"},role:"note",text:ctx.t("workforce.cat.detail.notRuntime")}),
    identityCard(ctx,r,agents),
    h(doc,"dl",{class:"kv wf-detail-kv"},
      kv("workforce.cat.detail.guild",g?`${g.name??g.guildId} (${g.guildId})`:r.guildId),
      kv("workforce.cat.detail.cluster",c?`${c.name??c.clusterId} (${c.clusterId})`:r.clusterId),
      kv("workforce.cat.detail.lifecycle",r.lifecycle),kv("workforce.cat.detail.priority",r.priority),
      h(doc,"div",{},h(doc,"dt",{text:ctx.t("workforce.cat.detail.runtime")}),h(doc,"dd",{},statusChip(ctx,r.runtimeStatus))),
      h(doc,"div",{},h(doc,"dt",{text:ctx.t("workforce.cat.detail.proficiency")}),h(doc,"dd",{},statusChip(ctx,r.proficiencyStatus))),
      kv("workforce.cat.detail.certifiedScope",r.certifiedScope),
      kv("workforce.cat.detail.legacyAliases",ctx.t("workforce.cat.detail.count",{n:String(detail.legacyAliasCount)})),
      kv("workforce.cat.detail.gaps",ctx.t("workforce.cat.detail.count",{n:String(detail.gaps.role.length)}))),
    defList(ctx,"workforce.cat.detail.responsibilities",r.responsibilities),
    defList(ctx,"workforce.cat.detail.specialization",r.specializationBoundaries),
    defList(ctx,"workforce.cat.detail.forbidden",r.forbiddenActions),
    h(doc,"div",{class:"wf-def"},h(doc,"h4",{class:"wf-def-title",text:ctx.t("workforce.cat.detail.evaluations")}),evalBody),
    h(doc,"p",{class:"note mono",text:ctx.t("workforce.cat.srcDetail",{id:r.roleId})}));
}

// //TR: UI-197 Uzman Rol Taksonomisi: salt-okunur küme->lonca ağacı, yalnız VERIFIED katalogdaki mevcut alanlardan (clusterId/guildId/sayılar); katalog VERIFIED değilse ağaç yerine dürüst durum notu; "genom" alanı uydurulmaz, yeni uç nokta/yazma yoktur.
function taxonomySection(ctx,catalog){
  const doc=ctx.doc;
  if(catalog.state!=="VERIFIED")return panel(ctx,{titleKey:"workforce.taxonomy.title",id:"wf-taxonomy",className:"wf-taxonomy"},
    h(doc,"p",{class:"note",text:ctx.t("workforce.taxonomy.lead")}),h(doc,"p",{class:`note note-${String(catalog.state).toLowerCase()}`,role:"status",dataset:{taxonomyState:catalog.state},text:ctx.t("workforce.taxonomy.notVerified")}));
  const tax=buildTaxonomy(catalog.items);
  // //TR: Katalog boşsa "boş" notu; öğe var ama hiçbiri sınıflanamıyorsa "sınıflandırılmamış" notu (asla "boş" denmez).
  if(!tax.clusters.length)return panel(ctx,{titleKey:"workforce.taxonomy.title",id:"wf-taxonomy",className:"wf-taxonomy"},h(doc,"p",{class:"note",text:ctx.t("workforce.taxonomy.lead")}),
    tax.totalCount>0?h(doc,"p",{class:"note",dataset:{taxonomyUnclassified:"1"},text:ctx.t("workforce.taxonomy.unclassified",{s:formatCount(tax.skippedCount),t:formatCount(tax.totalCount)})}):emptyNote(ctx,"workforce.cat.empty"));
  return panel(ctx,{titleKey:"workforce.taxonomy.title",id:"wf-taxonomy",className:"wf-taxonomy"},
    h(doc,"p",{class:"note",text:ctx.t("workforce.taxonomy.lead")}),
    h(doc,"p",{class:"note",dataset:{taxonomySummary:"1"},text:ctx.t("workforce.taxonomy.summary",{c:formatCount(tax.clusterCount),g:formatCount(tax.guildCount),d:formatCount(tax.distinctGuildCount),r:formatCount(tax.roleCount)})}),
    tax.skippedCount>0?h(doc,"p",{class:"note",role:"note",dataset:{taxonomySkipped:String(tax.skippedCount)},text:ctx.t("workforce.taxonomy.skipped",{s:formatCount(tax.skippedCount),t:formatCount(tax.totalCount)})}):null,
    h(doc,"ul",{class:"wf-taxonomy-tree","aria-label":ctx.t("workforce.taxonomy.treeLabel")},tax.clusters.map(c=>
      h(doc,"li",{class:"wf-taxonomy-cluster",dataset:{clusterId:c.clusterId}},
        h(doc,"span",{class:"mono wf-taxonomy-name",text:c.clusterId})," ",h(doc,"span",{class:"wf-taxonomy-count",text:ctx.t("workforce.taxonomy.counts",{r:formatCount(c.roles),g:formatCount(c.guilds.length),k:formatCount(c.certified)})}),
        h(doc,"ul",{class:"wf-taxonomy-guilds"},c.guilds.map(g=>
          h(doc,"li",{class:"wf-taxonomy-guild",dataset:{guildId:g.guildId}},
            h(doc,"span",{class:"mono wf-taxonomy-name",text:g.guildId})," ",h(doc,"span",{class:"wf-taxonomy-count",text:ctx.t("workforce.taxonomy.guildCounts",{r:formatCount(g.roles),k:formatCount(g.certified)})}))))))),
    h(doc,"p",{class:"note",text:ctx.t("workforce.taxonomy.noGenome")}),
    h(doc,"p",{class:"note mono",text:ctx.t("workforce.cat.source")}));
}

function catalogSection(ctx,catalog,detail,agents){
  const doc=ctx.doc;
  const browse=catalog.state==="VERIFIED"?panel(ctx,{titleKey:"workforce.cat.browseTitle",id:"wf-browse",className:"wf-browse"},
    catalog.items.length?[filterBar(ctx,catalog.items),...[roleList(ctx,catalog.items)].flat()]:emptyNote(ctx,"workforce.cat.empty")):null;
  return [overview(ctx,catalog),taxonomySection(ctx,catalog),browse,detailPanel(ctx,detail,agents)].filter(Boolean);
}

export async function render(ctx,route){
  const doc=ctx.doc,[cockpit,agents,runs,catalog,factory,ready]=await Promise.all([ctx.api.cockpit(),ctx.api.agentCount(),ctx.api.workRuns(),ctx.api.roleCatalog(),ctx.api.rolesStatusSummary(),ctx.api.rolesReadiness()]),w=cockpit.data.workforce;
  // //TR: INT-R3 D-M1-07: kayıtlı rol = kanonik sayı (GET /v1/agents registeredRoles, yoksa cockpit kanonik sayısı); sertifikalı sayı ayrı, eski kayıt yalnız LEGACY_REFERENCE_ONLY notu olarak.
  const registered=agents.registeredRoles!==null?agents.registeredRoles:w.registeredRoles;
  const regBlock=agents.registeredRoles!==null?{state:"VERIFIED",value:agents.registeredRoles}:w;
  const legacy=agents.legacyRoles!==null?agents.legacyRoles:w.legacyRoles??null;
  const activeBlock={...w,value:w.activeWorkerRuns,state:w.activeWorkerRuns===null?"UNAVAILABLE":w.state};
  // //TR: UX WP-AGENTS: seçili rol tanımı ayrıntısı yalnız seçim varken okunur (salt-okunur GET /v1/roles/:roleId).
  const detail=catState.roleId?await ctx.api.roleDetail(catState.roleId):null;
  return h(doc,"div",{class:"view view-workforce"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.workforce.title")}),h(doc,"p",{class:"hero-sub",text:ctx.t("area.workforce.desc")}),
    h(doc,"p",{class:"note note-catalog",role:"note",text:ctx.t("workforce.catalogNote")}),
    h(doc,"div",{class:"two-col"},
      panel(ctx,{titleKey:"workforce.registered",id:"wf-reg",className:"panel-registered"},
        h(doc,"p",{class:"kpi-value",text:formatCount(registered)}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.target",{n:w.targetRoles===null?MISSING:formatCount(w.targetRoles)})}),chip(ctx,regBlock),
        agents.certified!==null?h(doc,"p",{class:"duo-sub",dataset:{certified:String(agents.certified)},text:ctx.t("workforce.certified",{n:formatCount(agents.certified)})}):null,
        h(doc,"p",{class:"note",text:ctx.t("workforce.registrySource")}),
        legacy!==null?h(doc,"p",{class:"note",dataset:{legacyReference:"LEGACY_REFERENCE_ONLY"},text:ctx.t("workforce.registryLegacy",{n:formatCount(legacy)})}):null),
      panel(ctx,{titleKey:"workforce.active",id:"wf-act",className:"panel-active"},
        h(doc,"p",{class:"kpi-value",text:formatCount(w.activeWorkerRuns)}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.activeNote")}),chip(ctx,activeBlock))),
    panel(ctx,{titleKey:"workforce.fleet.title",id:"wf-fleet"},fleetBody(ctx,runs)),
    panel(ctx,{titleKey:"workforce.live.title",id:"wf-live"},liveRunsBody(ctx,runs)),
    readinessPanel(ctx,ready),
    factoryStatusPanel(ctx,factory,ready),
    ...catalogSection(ctx,catalog,detail,agents));
}
export {viewSkeleton as skeleton} from "../components.js";
