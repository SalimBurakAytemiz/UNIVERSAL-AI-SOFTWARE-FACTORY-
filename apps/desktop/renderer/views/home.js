// //TR: Bu görünüm Ana Sayfa / Founder Cockpit'tir: KPI karoları yalnız GET /v1/cockpit verisinden beslenir (404 => UNAVAILABLE, "—"), kayıtlı roller ile aktif çalışanlar görsel olarak ayrıdır ve hiçbir sayı uydurulmaz.
import {h,kpiTile,panel,chip,emptyNote,stateNote} from "../components.js";
import {icon} from "../icons.js";
import {formatCount,MISSING} from "../model.js";
import {ROUTES,FACTORY_AREA_ORDER} from "../routes.js";

const LOADING={loading:true,state:"UNAVAILABLE",value:null};
function workforceTile(ctx,w){
  const doc=ctx.doc,loading=w.loading===true,regState=loading?"LOADING":w.state;
  const registered=loading?MISSING:formatCount(w.registeredRoles),target=loading||w.targetRoles===null?MISSING:formatCount(w.targetRoles),active=loading?MISSING:formatCount(w.activeWorkerRuns);
  const activeBlock={...w,loading,value:w.activeWorkerRuns,state:w.activeWorkerRuns===null?"UNAVAILABLE":w.state};
  return h(doc,"article",{class:`kpi kpi-wide kpi-${w.state==="VERIFIED"?"ok":"na"}`,dataset:{kpi:"workforce",state:regState},tabindex:"0","aria-labelledby":"kpi-workforce-l",title:ctx.t("tile.tooltip",{source:w.source??MISSING,asOf:w.asOf??MISSING})},
    h(doc,"span",{class:"kpi-icon"},icon(doc,"bot",26)),
    h(doc,"div",{class:"kpi-body"},
      h(doc,"h3",{class:"kpi-label",id:"kpi-workforce-l",text:ctx.t("kpi.workforce")}),
      h(doc,"div",{class:"kpi-duo"},
        h(doc,"div",{class:"duo duo-registered",dataset:{duo:"registered"}},h(doc,"p",{class:"kpi-value",text:registered}),h(doc,"p",{class:"duo-label",text:ctx.t("workforce.registered")}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.target",{n:target})}),chip(ctx,{...w,loading})),
        h(doc,"div",{class:"duo duo-active",dataset:{duo:"active"}},h(doc,"p",{class:"kpi-value",text:active}),h(doc,"p",{class:"duo-label",text:ctx.t("workforce.active")}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.activeNote")}),chip(ctx,activeBlock)))));
}
function tiles(ctx,c){
  const loadingAll=c.loading===true,m=c.missions??{byStatus:{}},b=x=>loadingAll?{...LOADING}:x;
  return h(ctx.doc,"div",{class:"kpi-row",role:"group","aria-label":ctx.t("home.kpiGroup")},
    kpiTile(ctx,{id:"projects",iconName:"folder",labelKey:"kpi.projects",block:b(c.projects),sampleKey:"projects"}),
    kpiTile(ctx,{id:"missions",iconName:"tasks",labelKey:"kpi.missions",block:b(m),sampleKey:"missions",extra:Object.keys(m.byStatus??{}).length&&!loadingAll?h(ctx.doc,"p",{class:"kpi-hint",text:Object.entries(m.byStatus).map(([k,v])=>`${k} ${v}`).join(" · ")}):null}),
    kpiTile(ctx,{id:"approvals",iconName:"clock",labelKey:"kpi.approvals",block:b(c.approvals),sampleKey:"approvals"}),
    kpiTile(ctx,{id:"alerts",iconName:"alert",labelKey:"kpi.alerts",block:b(c.alerts),sampleKey:"alerts",hintKey:"kpi.alertsHint"}),
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
    case "inbox":return val(c.approvals,"map.count");
    default:return ctx.t("map.planned",{pkg:ROUTES.find(r=>r.id===id)?.plannedPackage??MISSING});
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
    entries.length?h(doc,"ul",{class:"bars"},entries.map(([k,v])=>h(doc,"li",{},h(doc,"span",{class:"bar-label",text:k}),h(doc,"progress",{max:String(max),value:String(v),"aria-label":`${k}: ${v}`}),h(doc,"span",{class:"bar-num",text:String(v)})))):stateNote(ctx,o.state==="VERIFIED"?"EMPTY":o.state,o.state==="VERIFIED"?"empty.general":undefined));
}
export function skeleton(ctx){
  const doc=ctx.doc;return h(doc,"div",{class:"view view-home","aria-busy":"true"},homeHeader(ctx),tiles(ctx,{loading:true}));
}
function homeHeader(ctx){const doc=ctx.doc;return h(doc,"div",{class:"hero"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.home.title")}),h(doc,"p",{class:"hero-sub",text:ctx.t("home.subtitle")}))}
export async function render(ctx){
  const doc=ctx.doc,res=await ctx.api.cockpit(),c=res.data,note=res.state==="OK"?null:h(doc,"p",{class:`note note-${res.state.toLowerCase()}`,role:"status",text:ctx.t(res.state==="UNAVAILABLE"?"cockpit.unavailable":"cockpit.failed")});
  return h(doc,"div",{class:"view view-home"},homeHeader(ctx),note,tiles(ctx,c),
    panel(ctx,{titleKey:"home.map",id:"home-map",className:"panel-map"},areaCards(ctx,c)),
    h(doc,"div",{class:"two-col"},orchestratorPanel(ctx,c.orchestrator),
      panel(ctx,{titleKey:"home.workforceNote.title",id:"home-wf"},emptyNote(ctx,"home.workforceNote.body"))));
}
