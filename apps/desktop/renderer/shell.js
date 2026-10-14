// //TR: Bu modül kalıcı shell'i yönetir: sol navigasyon (8 Factory alanı + Company OS + Ayarlar), bağlam çubuğu (şirket/proje/ortam/principal/API durumu/son yenileme), Ctrl+K arama, bildirim, ACİL DURDUR onay penceresi, sağ görev akışı ve alt canlı aktivite şeridi; tüm veri api.js üzerinden gelir.
import {h,chip,badge,statusPill} from "./components.js";
import {icon} from "./icons.js";
import {ROUTES,routeById} from "./routes.js";
import {formatCount,formatTime,MISSING,pushSample,searchEntries} from "./model.js";

export const PRINCIPAL="FOUNDER_LOCAL";
const FEED_TABS=Object.freeze(["flow","health","agenda"]);

export function createShell(ctx){
  const doc=ctx.doc,el=id=>doc.getElementById(id),{t,store,api}=ctx;
  const data={projects:{state:"LOADING",items:[]},cockpit:null,control:{state:"LOADING",active:false,reason:null},health:{state:"LOADING"},missions:{state:"LOADING",items:[]},attention:{state:"LOADING",blocked:[]},events:{state:"LOADING",runId:null,events:[]}};
  let feedTab="flow",searchHits=[],searchIndex=-1,lastStopActive=null,lastApiState=null;

  const announce=msg=>{const n=el("status");if(n)n.textContent=msg};
  const selectedProject=()=>data.projects.items.find(p=>p.projectId===store.projectId)??null;

  function renderNav(){
    const counts={projects:data.cockpit?.projects.value??(data.projects.state==="VERIFIED"?data.projects.items.length:null),work:data.cockpit?.missions.value??null,inbox:data.cockpit?.approvals.value??null};
    const current=routeById(ctx.currentRouteId());
    const items=ROUTES.map(r=>{
      const n=counts[r.id],a=h(doc,"a",{href:r.hash,class:"nav-link",dataset:{route:r.id},"aria-current":r.id===current?.id?"page":undefined,title:t(`area.${r.id}.title`)},
        h(doc,"span",{class:"nav-icon"},icon(doc,r.icon,20)),h(doc,"span",{class:"nav-label",text:t(`area.${r.id}.title`)}),
        Number.isSafeInteger(n)&&n>0?h(doc,"span",{class:"nav-count",text:String(n),"aria-label":t("nav.count",{n})}):null);
      return h(doc,"li",{class:r.id==="company"?"nav-sep":""},a);
    });
    el("navList").replaceChildren(...items);
  }
  function renderContext(){
    const p=selectedProject(),first=data.projects.items[0],sel=el("projectSelect");
    el("ctxTenant").textContent=(p??first)?.tenantId??MISSING;el("ctxEnv").textContent=p?.environmentId??MISSING;el("ctxPrincipal").textContent=PRINCIPAL;
    const opts=[h(doc,"option",{value:"",text:t("ctx.allProjects")}),...data.projects.items.map(x=>h(doc,"option",{value:x.projectId,text:x.name}))];
    sel.replaceChildren(...opts);sel.value=data.projects.items.some(x=>x.projectId===store.projectId)?store.projectId:"";sel.disabled=data.projects.state!=="VERIFIED";
    sel.title=data.projects.state==="VERIFIED"?"":t(`state.${data.projects.state}`);
    const apiKind=data.health.state==="VERIFIED"?"VERIFIED":data.health.state==="LOADING"?"LOADING":data.health.state==="OFFLINE"?"OFFLINE":"ERROR";
    el("ctxApi").replaceChildren(chip(ctx,null,{kind:apiKind}),h(doc,"span",{class:"ctx-api-text",text:t(`ctx.api.${apiKind}`)}));
    el("ctxRefresh").textContent=formatTime(store.lastRefreshAt,ctx.i18n.lang);if(store.lastRefreshAt)el("ctxRefresh").setAttribute("datetime",store.lastRefreshAt);
    if(lastApiState!==null&&lastApiState!==apiKind)announce(t(`ctx.api.${apiKind}`));lastApiState=apiKind;
    const approvals=data.cockpit?.approvals.value,bell=el("notifyCount");bell.textContent=Number.isSafeInteger(approvals)&&approvals>0?String(approvals):"";bell.hidden=!bell.textContent;
    el("notifyBtn").setAttribute("aria-label",Number.isSafeInteger(approvals)&&approvals>0?t("notify.count",{n:approvals}):t("notify.none"));
  }
  function renderStop(){
    const active=data.control.active===true,banner=el("stopBanner"),btn=el("stopBtn");
    banner.hidden=!active;btn.dataset.stopped=active?"true":"false";btn.setAttribute("aria-label",t(active?"stop.buttonActiveAria":"stop.buttonAria"));
    btn.querySelector(".stop-text").textContent=t(active?"stop.stopped":"stop.button");
    el("stopBannerText").textContent=t("stop.activeLine",{reason:data.control.reason??""});
    if(lastStopActive!==null&&lastStopActive!==active)announce(t(active?"stop.announceOn":"stop.announceOff"));lastStopActive=active;
  }
  function feedBody(){
    const body=h(doc,"div",{class:"feed-body"});
    if(feedTab==="flow"){
      const m=data.missions;
      if(m.state==="LOADING")body.append(chip(ctx,null,{kind:"LOADING"}));
      else if(m.state!=="VERIFIED")body.append(h(doc,"p",{class:"note",text:t(`state.${m.state}`)}));
      else if(!m.items.length)body.append(h(doc,"p",{class:"note",text:t("work.empty")}));
      else body.append(h(doc,"ol",{class:"timeline"},m.items.slice(0,10).map(x=>h(doc,"li",{},h(doc,"time",{text:formatTime(x.createdAt,ctx.i18n.lang)}),h(doc,"div",{},h(doc,"strong",{text:x.title}),h(doc,"div",{class:"tl-meta"},statusPill(ctx,x.status),badge(ctx,x.riskLevel,"badge-risk")))))));
    }else if(feedTab==="health"){
      const c=data.cockpit,o=c?.orchestrator;
      body.append(h(doc,"dl",{class:"kv"},h(doc,"dt",{text:t("feed.api")}),h(doc,"dd",{},chip(ctx,null,{kind:data.health.state==="VERIFIED"?"VERIFIED":data.health.state==="OFFLINE"?"OFFLINE":data.health.state==="LOADING"?"LOADING":"ERROR"})),
        h(doc,"dt",{text:t("feed.orchestrator")}),h(doc,"dd",{},o?chip(ctx,o):chip(ctx,null,{kind:"LOADING"}),h(doc,"span",{text:` ${o?formatCount(o.value):MISSING}`})),
        h(doc,"dt",{text:t("feed.workforce")}),h(doc,"dd",{},c?chip(ctx,c.workforce):chip(ctx,null,{kind:"LOADING"}))));
    }else{
      const a=data.cockpit?.approvals,items=a?.items??[];
      if(!a)body.append(chip(ctx,null,{kind:"LOADING"}));
      else if(a.state!=="VERIFIED"&&a.state!=="STALE")body.append(h(doc,"p",{class:"note",text:t(`state.${a.state}`)}));
      else if(!items.length)body.append(h(doc,"p",{class:"note",text:t("inbox.empty")}));
      else body.append(h(doc,"ul",{class:"timeline"},items.slice(0,10).map(x=>h(doc,"li",{},h(doc,"div",{},h(doc,"strong",{text:x.title??x.missionId}),h(doc,"div",{class:"tl-meta"},badge(ctx,x.riskLevel??"—","badge-risk")))))));
      body.append(h(doc,"a",{class:"link-more",href:"#/inbox",text:t("feed.seeInbox")}));
    }
    return body;
  }
  function renderFeed(){
    const tabs=h(doc,"div",{role:"tablist","aria-label":t("feed.label"),class:"tabs"},FEED_TABS.map(k=>h(doc,"button",{type:"button",role:"tab",id:`feedTab-${k}`,"aria-selected":feedTab===k?"true":"false","aria-controls":"feedPanel",tabindex:feedTab===k?"0":"-1",dataset:{tab:k},text:t(`feed.tab.${k}`),
      on:{click:()=>{feedTab=k;renderFeed()},keydown:e=>{const i=FEED_TABS.indexOf(k),d=e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0;if(d){e.preventDefault();feedTab=FEED_TABS[(i+d+FEED_TABS.length)%FEED_TABS.length];renderFeed();el(`feedTab-${feedTab}`).focus()}}}})));
    const panel=h(doc,"div",{role:"tabpanel",id:"feedPanel","aria-labelledby":`feedTab-${feedTab}`,tabindex:"0"},feedBody());
    el("feedMount").replaceChildren(tabs,panel);
  }
  function renderStrip(){
    const e=data.events,list=el("stripList");
    let nodes;
    if(e.state==="LOADING")nodes=[chip(ctx,null,{kind:"LOADING"})];
    else if(e.state!=="VERIFIED")nodes=[h(doc,"span",{class:"note",text:t(`state.${e.state}`)})];
    else if(!e.events.length)nodes=[h(doc,"span",{class:"note",text:t("strip.empty")})];
    else nodes=e.events.slice(0,6).map(x=>h(doc,"li",{class:`strip-item sev-${x.severity.toLowerCase()}`},h(doc,"time",{text:formatTime(x.timestamp,ctx.i18n.lang)}),h(doc,"span",{text:x.label})));
    list.replaceChildren(...nodes.map(n=>n.tagName==="LI"?n:h(doc,"li",{class:"strip-item"},n)));
    el("stripRun").textContent=e.runId??MISSING;
  }
  function renderAll(){renderNav();renderContext();renderStop();renderFeed();renderStrip()}

  async function refresh(){
    const epoch=store.epoch;
    const [health,projects,cockpit,control,missions,attention,runs]=await Promise.all([api.health(),api.projects(),api.cockpit(),api.control(),api.missions(),api.attention(),api.runs()]);
    if(epoch!==store.epoch)return false;
    data.health=health;data.projects=projects;data.cockpit=cockpit.data;data.control=control;data.missions=missions;data.attention=attention;
    if(store.projectId&&projects.state==="VERIFIED"&&!projects.items.some(p=>p.projectId===store.projectId)){store.selectProject(null);return false}
    const c=cockpit.data;
    for(const [k,v] of [["projects",c.projects.value],["missions",c.missions.value],["approvals",c.approvals.value],["alerts",c.alerts.value]])store.samples.set(k,pushSample(store.samples.get(k)??[],v));
    const latest=runs.runs[0];
    if(latest?.runId){const ev=await api.runEvents(latest.runId);data.events={...ev,runId:latest.runId}}else data.events={state:runs.state==="VERIFIED"?"VERIFIED":runs.state,runId:null,events:[]};
    if(epoch!==store.epoch)return false;
    renderAll();return true;
  }

  // Arama (Ctrl+K)
  function searchEntriesNow(){
    return [...ROUTES.map(r=>({kind:"route",id:r.id,label:t(`area.${r.id}.title`),keywords:r.id,hash:r.hash})),
      ...data.projects.items.map(p=>({kind:"project",id:p.projectId,label:p.name,keywords:`${p.projectId} ${t("search.project")}`})),
      ...data.missions.items.map(m=>({kind:"mission",id:m.missionId,label:m.title,keywords:`${m.missionId} ${m.status} ${t("search.mission")}`}))];
  }
  function closeSearch(){const box=el("searchResults"),inp=el("searchInput");box.hidden=true;box.replaceChildren();inp.setAttribute("aria-expanded","false");inp.removeAttribute("aria-activedescendant");searchHits=[];searchIndex=-1}
  function pick(hit){
    closeSearch();el("searchInput").value="";
    if(hit.kind==="route")ctx.navigate(hit.id);
    else if(hit.kind==="project"){ctx.selectProject(hit.id);ctx.navigate("projects")}else ctx.navigate("work");
  }
  function paintSearch(){
    const box=el("searchResults"),inp=el("searchInput");
    if(!searchHits.length){box.replaceChildren(h(doc,"li",{class:"search-empty",role:"presentation",text:t("search.none")}));box.hidden=!inp.value.trim();inp.setAttribute("aria-expanded",String(!box.hidden));return}
    box.replaceChildren(...searchHits.map((x,i)=>h(doc,"li",{role:"option",id:`searchOpt-${i}`,"aria-selected":i===searchIndex?"true":"false",class:"search-opt",dataset:{kind:x.kind},on:{mousedown:e=>{e.preventDefault();pick(x)}}},h(doc,"span",{class:"search-kind",text:t(`search.kind.${x.kind}`)}),h(doc,"span",{text:x.label}))));
    box.hidden=false;inp.setAttribute("aria-expanded","true");if(searchIndex>=0)inp.setAttribute("aria-activedescendant",`searchOpt-${searchIndex}`);else inp.removeAttribute("aria-activedescendant");
  }
  function wireSearch(){
    const inp=el("searchInput");
    inp.addEventListener("input",()=>{searchHits=searchEntries(inp.value,searchEntriesNow());searchIndex=searchHits.length?0:-1;if(!inp.value.trim()){closeSearch();return}paintSearch()});
    inp.addEventListener("keydown",e=>{
      if(e.key==="ArrowDown"&&searchHits.length){e.preventDefault();searchIndex=(searchIndex+1)%searchHits.length;paintSearch()}
      else if(e.key==="ArrowUp"&&searchHits.length){e.preventDefault();searchIndex=(searchIndex-1+searchHits.length)%searchHits.length;paintSearch()}
      else if(e.key==="Enter"&&searchHits[searchIndex]){e.preventDefault();pick(searchHits[searchIndex])}
      else if(e.key==="Escape"){if(!el("searchResults").hidden||inp.value){e.preventDefault();inp.value="";closeSearch()}else inp.blur()}
    });
    inp.addEventListener("blur",()=>closeSearch());
  }

  // ACİL DURDUR
  function openStopDialog(){const d=el("stopDialog");if(typeof d.showModal==="function"&&!d.open)d.showModal();else d.setAttribute("open","")}
  function closeStopDialog(){const d=el("stopDialog");if(typeof d.close==="function")d.close();else d.removeAttribute("open")}
  function wireStatic(){
    el("bellIcon").replaceChildren(icon(doc,"bell",20));
    el("stopBtn").addEventListener("click",openStopDialog);
    el("stopCancel").addEventListener("click",closeStopDialog);
    el("stopDialog").addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();closeStopDialog()}});
    el("stopConfirm").addEventListener("click",async()=>{closeStopDialog();await ctx.stop()});
    el("resumeBtn").addEventListener("click",()=>ctx.resume());
    el("refreshBtn").addEventListener("click",()=>ctx.refreshAll({force:true}));
    el("notifyBtn").addEventListener("click",()=>ctx.navigate("inbox"));
    el("langBtn").addEventListener("click",()=>ctx.i18n.setLang(ctx.i18n.lang==="tr"?"en":"tr"));
    el("projectSelect").addEventListener("change",e=>{ctx.selectProject(e.target.value||null)});
    wireSearch();
    doc.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==="k"){e.preventDefault();el("searchInput").focus();el("searchInput").select()}});
  }
  return {data,wireStatic,renderAll,renderNav,renderContext,renderStop,refresh,announce,openStopDialog,closeStopDialog};
}
