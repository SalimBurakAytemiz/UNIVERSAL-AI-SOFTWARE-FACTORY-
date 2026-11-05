// //TR: Bu görünüm Ana Sayfa / Founder Cockpit'tir: KPI karoları yalnız GET /v1/cockpit verisinden beslenir (404 => UNAVAILABLE, "—"), kayıtlı roller ile aktif çalışanlar görsel olarak ayrıdır, delta/sparkline yalnız gerçek örnekle çizilir ve hiçbir sayı uydurulmaz.
import {h,kpiTile,panel,emptyNote,stateNote,statusLabel,statePill,iconChip,miniBars,tooltipText,chip} from "../components.js";
import {icon} from "../icons.js";
import {formatCount,MISSING,formatTime,pillKindFor,missionPillKind,topEntries} from "../model.js";
import {ROUTES,FACTORY_AREA_ORDER} from "../routes.js";
import {buildProjectCockpit} from "../project-cockpit-core.js";
import {buildNotifications,loadReadIds,saveReadIds,NOTIFY_GROUPS} from "../notifications-core.js";
import {selection} from "../forms.js";

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
    kpiTile(ctx,{id:"approvals",iconName:"clock",labelKey:"kpi.approvals",block:b(c.approvals),sampleKey:"approvals",route:"inbox",qualifier:!loadingAll&&c.approvals?.truncated===true?ctx.t("kpi.q.approvalsTruncated",{shown:formatCount(c.approvals.items.length),total:formatCount(c.approvals.total)}):ctx.t("kpi.q.approvals"),bars:approvalBars,deltaGood:"down"}),
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
/** //TR: V3-T1027: proje başına koşu durumu, engeller, bekleyen onaylar ve harcama. Her hücre kaynağının gerçek durumunu taşır; harcama uç noktası olmadığından her zaman dürüst "kullanılamıyor"dur. */
function projectCockpitPanel(ctx,pc){
  const doc=ctx.doc,na=s=>h(doc,"p",{class:`note note-${String(s).toLowerCase()}`,role:"status",text:ctx.t(`state.${s}`)});
  const cell=(key,state,...kids)=>h(doc,"div",{class:"pc-cell",dataset:{pc:key,pcState:state}},h(doc,"p",{class:"pc-label",text:ctx.t(`home.pc.${key}`)}),...kids);
  const runsCell=r=>r.state!=="VERIFIED"?cell("runs",r.state,na(r.state)):cell("runs","VERIFIED",
    h(doc,"p",{class:"pc-value",text:formatCount(r.count)}),
    h(doc,"p",{class:"pc-sub",text:r.count?topEntries(r.byStatus,4).map(e=>`${statusLabel(ctx,e.key)} ${e.value}`).join(" · "):ctx.t("home.pc.noRuns")}),
    r.partial?h(doc,"p",{class:"pc-partial",dataset:{pcPartial:"runs"},text:ctx.t("home.pc.partial",{shown:formatCount(r.shown),total:formatCount(r.total)})}):null);
  const blockersCell=b=>b.state!=="VERIFIED"?cell("blockers",b.state,na(b.state)):cell("blockers","VERIFIED",
    h(doc,"p",{class:"pc-value",text:formatCount(b.count)}),
    b.count?h(doc,"ul",{class:"pc-list"},b.items.map(x=>h(doc,"li",{dataset:{pcRun:x.runId},text:`${statusLabel(ctx,x.status)} · ${x.reason??ctx.t("home.pc.noReason")}`}))):h(doc,"p",{class:"pc-sub",text:ctx.t("home.pc.none")}),
    b.partial?h(doc,"p",{class:"pc-partial",dataset:{pcPartial:"blockers"},text:ctx.t("home.pc.partial",{shown:formatCount(b.shown),total:formatCount(b.total)})}):null);
  const approvalsCell=a=>a.state!=="VERIFIED"&&a.state!=="STALE"?cell("approvals",a.state,na(a.state)):cell("approvals",a.state,
    h(doc,"p",{class:"pc-value",text:formatCount(a.count)}),
    a.count?h(doc,"ul",{class:"pc-list"},a.items.map(x=>h(doc,"li",{dataset:{pcMission:x.missionId},text:`${x.title??x.missionId} · ${x.riskLevel??MISSING}`}))):h(doc,"p",{class:"pc-sub",text:ctx.t("home.pc.none")}),
    a.partial?h(doc,"p",{class:"pc-partial",dataset:{pcPartial:"approvals"},text:ctx.t("home.pc.partialApprovals",{shown:formatCount(a.shown),total:formatCount(a.total)})}):null);
  // Harcama: hata değil, bilinen bir veri açığı; note-error sınıfı kullanılmaz ki gerçek hata ile karışmasın.
  const spendCell=()=>cell("spend","UNAVAILABLE",h(doc,"p",{class:"pc-value",text:MISSING}),h(doc,"p",{class:"pc-na",dataset:{pcGap:"NO_SPEND_ENDPOINT"},text:ctx.t("home.pc.spendNA")}));
  const body=pc.state==="EMPTY"?emptyNote(ctx,"home.pc.empty"):pc.state!=="VERIFIED"?na(pc.state):h(doc,"div",{class:"pc-rows"},pc.rows.map(r=>h(doc,"article",{class:"pc-row",dataset:{projectCockpit:r.projectId}},
    h(doc,"h3",{class:"pc-name",text:r.name}),runsCell(r.runs),blockersCell(r.blockers),approvalsCell(r.approvals),spendCell())));
  return panel(ctx,{titleKey:"home.pc.title",id:"home-projects"},h(doc,"div",{dataset:{projectCockpitState:pc.state}},body));
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
/** //TR: UASCO-T0019: renderer okundu deposu. Test/kabuk ctx.storage verebilir (null = depo yok); verilmezse localStorage denenir, erişim atarsa depo yok sayılır. */
const storageOf=ctx=>ctx.storage!==undefined?ctx.storage:(()=>{try{return globalThis.localStorage??null}catch{return null}})();
/** //TR: UASCO-T0019: bildirim akışı. Okunmamış rozet, türe göre gruplar, her öğe gerçek hedef ekrana (seçili görev ile) bağlanır; kaynak düşerse dürüst durum notu, depo yoksa "okundu kaydedilemez" notu. */
function notificationsPanel(ctx,feed){
  const doc=ctx.doc,storage=storageOf(ctx);
  const open=n=>{
    if(feed.readAvailable){const r=loadReadIds(storage);r.ids.add(n.id);saveReadIds(storage,r.ids)}
    if(n.missionId)selection.missionId=n.missionId;
    ctx.navigate(n.route);
  };
  const markAll=()=>{const r=loadReadIds(storage);for(const n of feed.items)r.ids.add(n.id);if(saveReadIds(storage,r.ids))ctx.rerender()};
  const sourceNote=k=>feed.sources[k]==="VERIFIED"?null:h(doc,"p",{class:`note note-${String(feed.sources[k]).toLowerCase()}`,role:"status",dataset:{notifySource:k},text:ctx.t("home.notify.sourceDown",{source:ctx.t(`home.notify.source.${k}`),state:ctx.t(`state.${feed.sources[k]}`)})});
  const item=n=>h(doc,"li",{class:`notify-item${n.read?" is-read":""}`,dataset:{notifyId:n.id,notifyRead:n.read?"1":"0"}},
    h(doc,"button",{type:"button",class:"link-btn",dataset:{notifyRoute:n.route,notifyMission:n.missionId??""},"aria-label":ctx.t("home.notify.openAria",{title:n.title,target:ctx.t(`area.${n.route}.title`)}),on:{click:()=>open(n)}},
      h(doc,"span",{class:"notify-kind",text:ctx.t(`home.notify.kind.${n.kind}`)}),h(doc,"span",{class:"notify-sep","aria-hidden":"true",text:" · "}),h(doc,"span",{class:"notify-title",text:n.title})),
    n.detail?h(doc,"p",{class:"notify-detail",text:n.detail}):null,
    h(doc,"p",{class:"notify-meta",text:`${n.read?ctx.t("home.notify.read"):ctx.t("home.notify.unread")} · ${n.at?formatTime(n.at,ctx.i18n.lang):MISSING}`}));
  const head=h(doc,"p",{class:"panel-meta"},
    h(doc,"span",{class:"badge badge-count",dataset:{notifyUnread:feed.unread===null?"":String(feed.unread)},text:feed.unread===null?MISSING:ctx.t("home.notify.unreadCount",{n:formatCount(feed.unread)})}),
    h(doc,"button",{type:"button",class:"btn btn-small",dataset:{notifyMarkAll:"1"},disabled:!feed.readAvailable||!feed.unread,on:{click:markAll},text:ctx.t("home.notify.markAll")}));
  const body=feed.state==="EMPTY"?[emptyNote(ctx,"home.notify.empty")]
    :feed.items.length===0&&feed.state!=="PARTIAL"?[h(doc,"p",{class:`note note-${String(feed.state).toLowerCase()}`,role:"status",text:ctx.t(`state.${feed.state}`)})]
    :NOTIFY_GROUPS.filter(g=>feed.groups[g]).map(g=>h(doc,"section",{class:"notify-group",dataset:{notifyGroup:g}},
      h(doc,"h3",{class:"notify-group-title",text:ctx.t("home.notify.groupTitle",{group:ctx.t(`home.notify.group.${g}`),n:formatCount(feed.groups[g].count),unread:formatCount(feed.groups[g].unread)})}),
      h(doc,"ul",{class:"notify-list"},feed.items.filter(n=>n.group===g).slice(0,8).map(item))));
  return panel(ctx,{titleKey:"home.notify.title",id:"home-notify"},h(doc,"div",{dataset:{notifyState:feed.state}},head,sourceNote("attention"),sourceNote("runs"),
    feed.readAvailable?null:h(doc,"p",{class:"note",dataset:{notifyNoStore:"1"},text:ctx.t("home.notify.noStore")}),
    feed.partial?h(doc,"p",{class:"note",dataset:{notifyPartial:"1"},text:ctx.t("home.notify.partial")}):null,
    feed.state==="PARTIAL"&&feed.items.length===0?emptyNote(ctx,"home.notify.emptyPartial"):null,...body));
}
/** //TR: Ana Sayfa erişilebilirlik: uzun sayfada klavyeyle her ana panele birkaç Tab'da ulaşılır. Hash yönlendirmesi bozulmasın diye <a href="#..."> yerine düğme kullanılır; düğme panel başlığına (tabindex=-1) odak taşır. */
export const HOME_SKIP_TARGETS=Object.freeze([["home-notify","home.notify.title"],["home-projects","home.pc.title"],["home-map","home.map"],["home-orch","home.orchestrator"]]);
function skipNav(ctx,panels){
  const doc=ctx.doc;
  const jump=sec=>{const head=sec?.children?.[0];if(!head)return;head.setAttribute("tabindex","-1");if(typeof head.focus==="function")head.focus();if(typeof head.scrollIntoView==="function")head.scrollIntoView({block:"start"})};
  return h(doc,"nav",{class:"home-skip","aria-label":ctx.t("home.skip.label")},h(doc,"ul",{class:"home-skip-list"},HOME_SKIP_TARGETS.filter(([id])=>panels[id]).map(([id,key])=>
    h(doc,"li",{},h(doc,"button",{type:"button",class:"link-btn",dataset:{skipTo:id},on:{click:()=>jump(panels[id])},text:ctx.t("home.skip.to",{section:ctx.t(key)})})))));
}
export async function render(ctx){
  const doc=ctx.doc,[res,prj,runs,att]=await Promise.all([ctx.api.cockpit(),ctx.api.projects(),ctx.api.runSummaries(),ctx.api.attention()]),c=res.data;
  const tenant=prj.state==="VERIFIED"?(prj.items.find(p=>p.projectId===ctx.store.projectId)??prj.items[0])?.tenantId??null:null;
  // //TR: Başarılı HTTP ama bozuk gövde (tüm bloklar ERROR) de açıklayıcı hata notu gösterir; sessiz boş ekran olmaz.
  const state=res.state==="OK"&&c.projects?.state==="ERROR"&&c.missions?.state==="ERROR"?"ERROR":res.state;
  const note=state==="OK"?null:h(doc,"p",{class:`note note-${state.toLowerCase()}`,role:"status",text:ctx.t(state==="UNAVAILABLE"?"cockpit.unavailable":"cockpit.failed")});
  const panels={"home-notify":notificationsPanel(ctx,buildNotifications({attention:att,runs,read:loadReadIds(storageOf(ctx))})),
    "home-projects":projectCockpitPanel(ctx,buildProjectCockpit({projects:prj,approvals:c.approvals,runs})),
    "home-map":panel(ctx,{titleKey:"home.map",id:"home-map",className:"panel-map"},areaCards(ctx,c)),
    "home-orch":orchestratorPanel(ctx,c.orchestrator)};
  return h(doc,"div",{class:"view view-home"},homeHeader(ctx,{asOf:c.generatedAt,tenant}),skipNav(ctx,panels),note,tiles(ctx,c),
    panels["home-notify"],panels["home-projects"],panels["home-map"],
    h(doc,"div",{class:"two-col"},panels["home-orch"],
      panel(ctx,{titleKey:"home.workforceNote.title",id:"home-wf"},emptyNote(ctx,"home.workforceNote.body"))));
}
