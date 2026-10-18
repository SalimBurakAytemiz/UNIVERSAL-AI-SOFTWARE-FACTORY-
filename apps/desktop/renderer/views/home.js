// //TR: Bu görünüm Ana Sayfa / Founder Cockpit'tir: KPI karoları yalnız GET /v1/cockpit verisinden beslenir (404 => UNAVAILABLE, "—"), kayıtlı roller ile aktif çalışanlar görsel olarak ayrıdır, delta/sparkline yalnız gerçek örnekle çizilir ve hiçbir sayı uydurulmaz.
import {h,kpiTile,panel,emptyNote,stateNote,statusLabel,statePill,iconChip,miniBars,tooltipText,chip} from "../components.js";
import {icon} from "../icons.js";
import {formatCount,MISSING,formatTime,pillKindFor,missionPillKind,topEntries} from "../model.js";
import {ROUTES,FACTORY_AREA_ORDER} from "../routes.js";

const LOADING={loading:true,state:"UNAVAILABLE",value:null};
const TONE={BLOCKED:"danger",FAILED:"danger",ATTENTION:"warn",WAITING:"warn",ACTIVE:"accent",DONE:"ok",STOPPED:"muted",IDLE:"muted",NEUTRAL:"muted"};
const isLiveBlock=x=>x?.loading!==true&&(x?.state==="VERIFIED"||x?.state==="STALE");
function workforceTile(ctx,w){
  const doc=ctx.doc,loading=w.loading===true,regState=loading?"LOADING":w.state,isLive=!loading&&isLiveBlock(w);
  const registered=loading?MISSING:formatCount(w.registeredRoles),target=loading||w.targetRoles===null?MISSING:formatCount(w.targetRoles),active=loading?MISSING:formatCount(w.activeWorkerRuns);
  const activeBlock={...w,loading,value:w.activeWorkerRuns,state:w.activeWorkerRuns===null?"UNAVAILABLE":w.state};
  // //TR: Canlı olmayan blokta nitelik satırı dürüst durumu söyler (DOĞRULANMADI · Kullanılamıyor); sayı uydurulmaz.
  const honest=loading||(isLive&&w.state==="VERIFIED")?null:`${ctx.t("chip.UNVERIFIED")} · ${ctx.t(`state.${regState}`)}`;
  const go=()=>ctx.navigate("workforce");
  const tile=h(doc,"article",{class:`kpi kpi-wide kpi-drill kpi-${w.state==="VERIFIED"?"ok":"na"}${isLive&&w.activeWorkerRuns>0?" kpi-live":""}`,dataset:{kpi:"workforce",state:regState,drill:"workforce"},tabindex:"0",role:"link","aria-labelledby":"kpi-workforce-l",title:ctx.t("tile.tooltip",{source:w.source??MISSING,asOf:w.asOf??MISSING})},
    h(doc,"div",{class:"kpi-head"},iconChip(ctx,"bot",24),h(doc,"h3",{class:"kpi-label",id:"kpi-workforce-l",text:ctx.t("kpi.workforce")})),
    h(doc,"div",{class:"kpi-duo"},
      h(doc,"div",{class:"duo duo-registered",dataset:{duo:"registered"}},h(doc,"p",{class:"kpi-value",text:registered}),h(doc,"p",{class:"duo-label",text:ctx.t("workforce.registered")}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.target",{n:target})}),statePill(ctx,pillKindFor({...w,loading}))),
      h(doc,"div",{class:"duo duo-active",dataset:{duo:"active"}},h(doc,"p",{class:"kpi-value",text:active}),h(doc,"p",{class:"duo-label",text:ctx.t("workforce.active")}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.activeNote")}),statePill(ctx,pillKindFor(activeBlock)))),
    h(doc,"p",{class:"kpi-qual",text:honest??ctx.t("kpi.q.workforce")}),
    h(doc,"p",{class:"kpi-src",dataset:{src:w.source??""},text:tooltipText(ctx,w)}),
    h(doc,"span",{class:"kpi-go","aria-hidden":"true"},icon(doc,"chevron",16)));
  tile.addEventListener("click",go);
  tile.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target===tile){if(typeof e.preventDefault==="function")e.preventDefault();go()}});
  return tile;
}
/** //TR: UX WP2: mini grafikler yalnız backend'in döndürdüğü kırılımlardan (byStatus, riskLevel, evidence sayıları) çizilir; kırılım yoksa grafik çizilmez. */
function tiles(ctx,c){
  const loadingAll=c.loading===true,m=c.missions??{byStatus:{}},b=x=>loadingAll?{...LOADING}:x;
  const live=x=>!loadingAll&&isLiveBlock(x);
  const missionBars=live(m)?miniBars(ctx,topEntries(m.byStatus).map(e=>({...e,label:statusLabel(ctx,e.key),tone:TONE[missionPillKind(e.key)]??"muted"})),ctx.t("kpi.bars.missions")):null;
  const missionQual=live(m)&&Object.keys(m.byStatus??{}).length?topEntries(m.byStatus,3).map(e=>`${statusLabel(ctx,e.key)} ${e.value}`).join(" · "):null;
  const riskCounts={};if(live(c.approvals))for(const x of c.approvals.items??[]){const k=x.riskLevel??MISSING;riskCounts[k]=(riskCounts[k]??0)+1}
  const approvalBars=live(c.approvals)?miniBars(ctx,topEntries(riskCounts,5).map(e=>({...e,tone:"warn"})),ctx.t("kpi.bars.approvals")):null;
  const d=c.alerts?.detail;
  const alertBars=live(c.alerts)&&d?miniBars(ctx,[{key:"blocked",value:d.blockedMissions,label:ctx.t("kpi.alert.blocked"),tone:"danger"},{key:"attention",value:d.attentionMissions,label:ctx.t("kpi.alert.attention"),tone:"warn"},{key:"stop",value:d.globalStop?1:0,label:ctx.t("kpi.alert.stop"),tone:"danger"}],ctx.t("kpi.bars.alerts")):null;
  const ev=c.evidence,evLive=live(ev);
  const evBars=evLive?miniBars(ctx,[{key:"verified",value:ev.verified,label:ctx.t("everif.VERIFIED"),tone:"ok"},{key:"mismatch",value:ev.mismatch,label:ctx.t("everif.MISMATCH"),tone:"danger"},{key:"missing",value:ev.missing,label:ctx.t("everif.MISSING"),tone:"danger"},{key:"unverifiable",value:ev.unverifiable,label:ctx.t("everif.UNVERIFIABLE"),tone:"muted"}],ctx.t("kpi.bars.evidence")):null;
  const evQual=evLive&&ev.total!==null?ctx.t("kpi.q.evidence",{total:formatCount(ev.total),mismatch:formatCount(ev.mismatch),missing:formatCount(ev.missing)}):null;
  const evKind=evLive&&ev.verified===0&&(ev.total??0)>0?"NOT_VERIFIED":undefined;
  return h(ctx.doc,"div",{class:"kpi-row",role:"group","aria-label":ctx.t("home.kpiGroup")},
    kpiTile(ctx,{id:"projects",iconName:"folder",labelKey:"kpi.projects",block:b(c.projects),sampleKey:"projects",route:"projects",qualifier:ctx.t("kpi.q.projects"),deltaGood:"neutral"}),
    kpiTile(ctx,{id:"missions",iconName:"tasks",labelKey:"kpi.missions",block:b(m),sampleKey:"missions",route:"work",qualifier:missionQual,bars:missionBars,deltaGood:"neutral"}),
    kpiTile(ctx,{id:"approvals",iconName:"clock",labelKey:"kpi.approvals",block:b(c.approvals),sampleKey:"approvals",route:"inbox",qualifier:ctx.t("kpi.q.approvals"),bars:approvalBars,deltaGood:"down"}),
    kpiTile(ctx,{id:"alerts",iconName:"alert",labelKey:"kpi.alerts",block:b(c.alerts),sampleKey:"alerts",route:"work",hintKey:"kpi.alertsHint",bars:alertBars,risk:(c.alerts?.value??0)>0,deltaGood:"down"}),
    kpiTile(ctx,{id:"evidence",iconName:"evidence",labelKey:"kpi.evidence",block:b(ev),route:"assurance",qualifier:evQual,bars:evBars,pillKind:evKind,wide:true,risk:evLive&&(ev.mismatch??0)>0}),
    workforceTile(ctx,loadingAll?{...LOADING,registeredRoles:null,targetRoles:null,activeWorkerRuns:null}:c.workforce));
}
function areaCards(ctx,c){
  const doc=ctx.doc,val=(block,key)=>block.state==="VERIFIED"||block.state==="STALE"?ctx.t(key,{n:formatCount(block.value)}):ctx.t(`state.${block.state}`);
  const line=id=>{switch(id){
    case "home":return ctx.t("map.home");
    case "projects":return val(c.projects,"map.count");
    case "work":return val(c.missions,"map.count");
    case "workforce":return c.workforce.registeredRoles===null?ctx.t(`state.${c.workforce.state}`):ctx.t("map.roles",{n:formatCount(c.workforce.registeredRoles)});
    case "tower":return val(c.orchestrator,"map.packages");
    case "assurance":return ctx.t("map.assurance");
    case "inbox":return val(c.approvals,"map.count");
    case "delivery":return ctx.t("map.delivery");
    default:{
      // //TR: Home alan kartı: yalnız gerçekten plannedPackage'ı olan rota "Planlı paket" yazar; `component` ile gerçek görünüme devreden rota için uydurma "—" paket basılmaz, alan açıklaması gösterilir.
      const r=ROUTES.find(x=>x.id===id),pkg=r?.plannedPackage;
      return pkg?ctx.t("map.planned",{pkg}):ctx.t(`area.${id}.desc`);
    }
  }};
  return h(doc,"ul",{class:"area-map"},FACTORY_AREA_ORDER.map(id=>{
    const r=ROUTES.find(x=>x.id===id);
    return h(doc,"li",{},h(doc,"a",{class:"area-card",href:r.hash,dataset:{area:id}},h(doc,"span",{class:"area-icon"},icon(doc,r.icon,22)),h(doc,"span",{class:"area-title",text:ctx.t(`area.${id}.title`)}),h(doc,"span",{class:"area-line",text:line(id)})));
  }));
}
function orchestratorPanel(ctx,o){
  const doc=ctx.doc,entries=Object.entries(o.byStatus??{}),max=Math.max(1,...entries.map(([,v])=>v));
  return panel(ctx,{titleKey:"home.orchestrator",id:"home-orch"},
    h(doc,"p",{class:"panel-meta"},chip(ctx,o),h(doc,"span",{text:ctx.t("tile.tooltip",{source:o.source??MISSING,asOf:o.asOf??MISSING})})),
    entries.length?h(doc,"ul",{class:"bars"},entries.map(([k,v])=>h(doc,"li",{},h(doc,"span",{class:"bar-label",text:statusLabel(ctx,k)}),h(doc,"progress",{max:String(max),value:String(v),"aria-label":`${statusLabel(ctx,k)}: ${v}`}),h(doc,"span",{class:"bar-num",text:String(v)})))):stateNote(ctx,o.state==="VERIFIED"?"EMPTY":o.state,o.state==="VERIFIED"?"empty.general":undefined));
}
export function skeleton(ctx){
  const doc=ctx.doc;return h(doc,"div",{class:"view view-home","aria-busy":"true"},homeHeader(ctx),tiles(ctx,{loading:true}));
}
/** //TR: UX WP2: karşılama; kimlik ve rol yalnız oturumdaki gerçek principal'dan (ctx.principal), kiracı yalnız gerçek proje kaydından gelir; ad uydurulmaz, bilinmeyen alan gösterilmez. */
function homeHeader(ctx,{asOf=null,tenant=null}={}){
  const doc=ctx.doc,principal=typeof ctx.principal==="string"&&ctx.principal?ctx.principal:null,founder=principal!==null&&/^FOUNDER/.test(principal);
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("home.welcome")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.home.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("home.subtitle")}),
    h(doc,"p",{class:"hero-id"},
      principal?h(doc,"span",{class:"id-chip",dataset:{identity:principal}},icon(doc,"user",16),founder?h(doc,"strong",{text:ctx.t("home.role.founder")}):null,h(doc,"span",{class:"mono",text:ctx.t("home.identity",{principal})})):null,
      tenant?h(doc,"span",{class:"id-chip",dataset:{tenant:"1"}},icon(doc,"building",16),h(doc,"span",{class:"mono",text:ctx.t("home.tenant",{tenant})})):null,
      h(doc,"span",{class:"id-asof",text:ctx.t("home.asOf",{time:asOf?formatTime(asOf,ctx.i18n.lang):MISSING})})),
    h(doc,"p",{class:"hero-hint",text:ctx.t("home.drillHint")}));
}
export async function render(ctx){
  const doc=ctx.doc,[res,prj]=await Promise.all([ctx.api.cockpit(),ctx.api.projects()]),c=res.data;
  const tenant=prj.state==="VERIFIED"?(prj.items.find(p=>p.projectId===ctx.store.projectId)??prj.items[0])?.tenantId??null:null;
  const note=res.state==="OK"?null:h(doc,"p",{class:`note note-${res.state.toLowerCase()}`,role:"status",text:ctx.t(res.state==="UNAVAILABLE"?"cockpit.unavailable":"cockpit.failed")});
  return h(doc,"div",{class:"view view-home"},homeHeader(ctx,{asOf:c.generatedAt,tenant}),note,tiles(ctx,c),
    panel(ctx,{titleKey:"home.map",id:"home-map",className:"panel-map"},areaCards(ctx,c)),
    h(doc,"div",{class:"two-col"},orchestratorPanel(ctx,c.orchestrator),
      panel(ctx,{titleKey:"home.workforceNote.title",id:"home-wf"},emptyNote(ctx,"home.workforceNote.body"))));
}
