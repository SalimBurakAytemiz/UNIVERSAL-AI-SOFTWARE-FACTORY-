// //TR: Bu modül kalıcı shell'i yönetir: sol navigasyon (8 Factory alanı + Company OS + Ayarlar), bağlam çubuğu (şirket/proje/ortam/principal/API durumu/son yenileme), Ctrl+K arama, bildirim, ACİL DURDUR onay penceresi, sağ görev akışı ve alt canlı aktivite şeridi; tüm veri api.js üzerinden gelir; periyodik yenileme nav/sekme düğümlerini yerinde günceller ve yeniden kurulan alt ağaçlarda odağı korur.
import {h,chip,badge,statusLabel,statePill,missionPill,timelineItem} from "./components.js";
import {icon} from "./icons.js";
import {ROUTES,routeById} from "./routes.js";
import {formatCount,formatTime,MISSING,pushSample,searchEntries,pillKindFor} from "./model.js";
import {syncNav,syncTabs} from "./nav.js";
import {keepFocus} from "./focus.js";
import {selection} from "./forms.js";
import {maybeOpenFirstRun} from "./views/firstrun.js";
import {recoveryPanel} from "./recovery-panel.js";
import {shouldShowApiRecovery} from "./recovery-core.js";
import {createInspector,isInspectableRef} from "./inspector.js";

export const PRINCIPAL="FOUNDER_LOCAL";
const FEED_TABS=Object.freeze(["flow","health","agenda"]);

export function createShell(ctx){
  const doc=ctx.doc,el=id=>doc.getElementById(id),{t,store,api}=ctx;
  const data={projects:{state:"LOADING",items:[]},cockpit:null,control:{state:"LOADING",active:false,reason:null},health:{state:"LOADING"},missions:{state:"LOADING",items:[]},attention:{state:"LOADING",blocked:[]},events:{state:"LOADING",runId:null,events:[]}};
  let feedTab="flow",searchHits=[],searchIndex=-1,lastStopActive=null,lastApiState=null;
  const inspector=createInspector(ctx);

  const announce=msg=>{const n=el("status");if(n)n.textContent=msg};
  /** Inspector çekmecesini verilen varlık referansıyla açar; çağıran denetim (invoker) kapanışta odağı geri alır. Referans geçersizse sessizce yok sayılır. */
  function openInspector(ref,invoker){if(isInspectableRef(ref))inspector.open(ref,invoker??el("searchInput"))}
  /** Durdurma/Devam başarısızlığı ACİL DURDUR'un yanında görünür role="alert" olarak gösterilir (ayrıca canlı bölgede duyurulur). */
  function showStopError(msg){const n=el("stopError");if(n){n.textContent=msg;n.hidden=false}announce(msg)}
  function clearStopError(){const n=el("stopError");if(n){n.textContent="";n.hidden=true}}
  const selectedProject=()=>data.projects.items.find(p=>p.projectId===store.projectId)??null;

  function renderNav(){
    const counts={projects:data.cockpit?.projects.value??(data.projects.state==="VERIFIED"?data.projects.items.length:null),work:data.cockpit?.missions.value??null,inbox:data.cockpit?.approvals.value??null};
    syncNav(doc,el("navList"),ROUTES,{currentId:routeById(ctx.currentRouteId())?.id,counts,labelOf:r=>t(`area.${r.id}.title`),countLabel:n=>t("nav.count",{n}),makeIcon:r=>icon(doc,r.icon,20)});
  }
  function renderContext(){
    const p=selectedProject(),first=data.projects.items[0],sel=el("projectSelect");
    el("ctxTenant").textContent=(p??first)?.tenantId??MISSING;el("ctxEnv").textContent=p?.environmentId??MISSING;el("ctxPrincipal").textContent=PRINCIPAL;
    const optKey=JSON.stringify([t("ctx.allProjects"),...data.projects.items.map(x=>[x.projectId,x.name])]);
    if(sel.dataset.optKey!==optKey){const opts=[h(doc,"option",{value:"",text:t("ctx.allProjects")}),...data.projects.items.map(x=>h(doc,"option",{value:x.projectId,text:x.name}))];sel.replaceChildren(...opts);sel.dataset.optKey=optKey}
    sel.value=data.projects.items.some(x=>x.projectId===store.projectId)?store.projectId:"";sel.disabled=data.projects.state!=="VERIFIED";
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
    if(lastStopActive!==null&&lastStopActive!==active){clearStopError();announce(t(active?"stop.announceOn":"stop.announceOff"))}lastStopActive=active;
  }
  /** Akış/gündem satırından (gerçek varlık satırı) Inspector'ı açan küçük, klavye erişilebilir düğme; düğmenin kendisi kapanışta odağı geri alan invoker olur. */
  function inspectBtn(ref,name){
    if(!isInspectableRef(ref))return null;
    return h(doc,"button",{type:"button",class:"btn btn-small tl-inspect","aria-label":t("inspector.rowAria",{name:name??ref.id}),on:{click:e=>openInspector(ref,e&&e.currentTarget?e.currentTarget:null)}},t("inspector.open"));
  }
  function feedBody(){
    const body=h(doc,"div",{class:"feed-body"});
    if(feedTab==="flow"){
      const m=data.missions;
      if(m.state==="LOADING")body.append(chip(ctx,null,{kind:"LOADING"}));
      else if(m.state!=="VERIFIED")body.append(h(doc,"p",{class:"note",text:t(`state.${m.state}`)}));
      else if(!m.items.length)body.append(h(doc,"p",{class:"note",text:t("work.empty")}));
      else body.append(h(doc,"ol",{class:"timeline"},m.items.slice(0,10).map(x=>{
        // //TR: UX WP2: atıf yalnız gerçek kayıttan (mission'ın proje adı) gelir; ajan/servis adı backend vermediği için uydurulmaz.
        const proj=data.projects.items.find(p=>p.projectId===x.projectId);
        return timelineItem(ctx,{time:formatTime(x.createdAt,ctx.i18n.lang),iso:x.createdAt,title:x.title,attribution:proj?t("feed.attr.project",{name:proj.name}):null,pill:missionPill(ctx,x.status),meta:[badge(ctx,x.riskLevel,"badge-risk"),inspectBtn({kind:"mission",id:x.missionId},x.title)]});
      })));
    }else if(feedTab==="health"){
      const c=data.cockpit,o=c?.orchestrator;
      body.append(h(doc,"dl",{class:"kv"},h(doc,"dt",{text:t("feed.api")}),h(doc,"dd",{},statePill(ctx,data.health.state==="VERIFIED"?"VERIFIED":data.health.state==="OFFLINE"?"OFFLINE":data.health.state==="LOADING"?"LOADING":"FAILED")),
        h(doc,"dt",{text:t("feed.orchestrator")}),h(doc,"dd",{},statePill(ctx,o?pillKindFor(o):"LOADING"),h(doc,"span",{text:` ${o?formatCount(o.value):MISSING}`})),
        h(doc,"dt",{text:t("feed.workforce")}),h(doc,"dd",{},statePill(ctx,c?pillKindFor(c.workforce):"LOADING"))));
      // //TR: UI-251: control API erişilemezken (OFFLINE/ERROR/…) sağlık sekmesinde Recovery Center paneli gösterilir; LOADING/VERIFIED'da gösterilmez.
      if(shouldShowApiRecovery(data.health.state))body.append(recoveryPanel(ctx,{routeId:ctx.currentRouteId(),health:data.health.state,reason:"API_DOWN"}));
    }else{
      const a=data.cockpit?.approvals,items=a?.items??[];
      if(!a)body.append(chip(ctx,null,{kind:"LOADING"}));
      else if(a.state!=="VERIFIED"&&a.state!=="STALE")body.append(h(doc,"p",{class:"note",text:t(`state.${a.state}`)}));
      else if(!items.length)body.append(h(doc,"p",{class:"note",text:t("inbox.empty")}));
      else body.append(h(doc,"ol",{class:"timeline"},items.slice(0,10).map(x=>{
        const proj=data.projects.items.find(p=>p.projectId===x.projectId);
        return timelineItem(ctx,{time:null,title:x.title??x.missionId,attribution:proj?t("feed.attr.project",{name:proj.name}):null,pill:statePill(ctx,"WAITING",{label:t("feed.agenda.waiting")}),meta:[badge(ctx,x.riskLevel??"—","badge-risk"),inspectBtn({kind:"mission",id:x.missionId},x.title??x.missionId)]});
      })));
      body.append(h(doc,"a",{class:"link-more",href:"#/inbox",dataset:{focusKey:"feed-see-inbox"},text:t("feed.seeInbox")}));
    }
    return body;
  }
  function selectFeedTab(k,{viaKey=false}={}){feedTab=k;renderFeed();if(viaKey)el(`feedTab-${k}`)?.focus()}
  function renderFeed(){
    const mount=el("feedMount");let tabs=mount.children[0],panel=mount.children[1];
    if(!tabs||!panel){tabs=h(doc,"div",{});panel=h(doc,"div",{role:"tabpanel",id:"feedPanel",tabindex:"0"});mount.replaceChildren(tabs,panel)}
    syncTabs(doc,tabs,FEED_TABS,{selected:feedTab,ariaLabel:t("feed.label"),labelOf:k=>t(`feed.tab.${k}`),onSelect:selectFeedTab});
    panel.setAttribute("aria-labelledby",`feedTab-${feedTab}`);
    keepFocus(doc,panel,()=>panel.replaceChildren(feedBody()));
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
  // //TR: UX WP-SHELL-REFINE: Ctrl+K komut paleti. Mevcut "aramayla gezin" (proje/mission) KALDIRILMAZ; üzerine gruplu bir EYLEMLER bölümü eklenir: her rota için "git" (go-to-view), geçerli seçim için Inspector aç ve global STOP_ALL. STOP_ALL yeni bir yan etkili/yazma denetimi EKLEMEZ; yalnız mevcut ACİL DURDUR onay penceresini (openStopDialog) ve onun zaten allow-list'li kontrol yolunu yeniden kullanır. Combobox/listbox a11y semantiği korunur: seçilebilir öğeler role=option + aria-activedescendant, grup başlıkları role=presentation'dır ve gezinmede sayılmaz.
  /** Palet "geçerli seçim" eylemi için referans: önce seçili mission (hâlâ listede ise), sonra seçili proje; yoksa null (eylem gösterilmez). */
  function currentSelectionRef(){
    if(selection.missionId&&data.missions.items.some(m=>m.missionId===selection.missionId))return {kind:"mission",id:selection.missionId};
    const p=selectedProject();return p?{kind:"project",id:p.projectId}:null;
  }
  function actionEntries(){
    const acts=ROUTES.map(r=>({kind:"action",action:"goto",group:"action",id:`goto:${r.id}`,routeId:r.id,label:t("palette.goto",{name:t(`area.${r.id}.title`)}),keywords:`${r.id} ${t(`area.${r.id}.title`)} ${t("palette.goKeyword")}`}));
    const sel=currentSelectionRef();
    if(sel){const m=data.missions.items.find(x=>x.missionId===sel.id),p=selectedProject(),name=sel.kind==="mission"?(m?.title??sel.id):(p?.name??sel.id);
      acts.push({kind:"action",action:"inspect",group:"action",id:"inspect:selection",ref:sel,label:t("palette.inspect",{name}),keywords:`${t("palette.inspectKeyword")} ${sel.id} ${name}`});}
    acts.push({kind:"action",action:"stopall",group:"action",id:"action:stopall",label:t("palette.stopAll"),keywords:`${t("palette.stopKeyword")} ${t("stop.button")}`});
    return acts;
  }
  // //TR: Aramayla gezin (search-to-navigate) sonuç grubu: gerçek projeler ve mission'lar; seçildiğinde o ekrana/kayda gidilir (eski davranış korunur).
  function resultEntries(){
    return [...data.projects.items.map(p=>({kind:"project",group:"result",id:p.projectId,label:p.name,keywords:`${p.projectId} ${t("search.project")}`})),
      ...data.missions.items.map(m=>({kind:"mission",group:"result",id:m.missionId,label:m.title,keywords:`${m.missionId} ${m.status} ${statusLabel(ctx,m.status)} ${t("search.mission")}`}))];
  }
  /** Boş sorgu: tüm eylemleri göster (palet açılışı). Aksi halde eylemler + sonuçlar sorguyla süzülür (her grup kendi içinde sınırlı). */
  function computeHits(query){
    const q=String(query??"").trim();
    if(!q)return actionEntries();
    return [...searchEntries(q,actionEntries()),...searchEntries(q,resultEntries())];
  }
  function closeSearch(){const box=el("searchResults"),inp=el("searchInput");box.hidden=true;box.replaceChildren();inp.setAttribute("aria-expanded","false");inp.removeAttribute("aria-activedescendant");searchHits=[];searchIndex=-1}
  function pick(hit){
    if(!hit)return;
    closeSearch();el("searchInput").value="";
    if(hit.kind==="action"){
      if(hit.action==="goto")ctx.navigate(hit.routeId);
      else if(hit.action==="inspect")openInspector(hit.ref);
      else if(hit.action==="stopall")openStopDialog();
      return;
    }
    if(hit.kind==="project"){ctx.selectProject(hit.id);ctx.navigate("projects")}
    else{selection.missionId=hit.id;ctx.navigate("work")}
  }
  function paintSearch(){
    const box=el("searchResults"),inp=el("searchInput");
    if(!searchHits.length){box.replaceChildren(h(doc,"li",{class:"search-empty",role:"presentation",text:t("search.none")}));box.hidden=!inp.value.trim();inp.setAttribute("aria-expanded",String(!box.hidden));inp.removeAttribute("aria-activedescendant");return}
    const nodes=[];let lastGroup=null;
    searchHits.forEach((x,i)=>{
      const g=x.group??"result";
      if(g!==lastGroup){nodes.push(h(doc,"li",{class:"search-group",role:"presentation",text:t(`palette.group.${g}`)}));lastGroup=g}
      nodes.push(h(doc,"li",{role:"option",id:`searchOpt-${i}`,"aria-selected":i===searchIndex?"true":"false",class:"search-opt",dataset:{kind:x.kind},on:{mousedown:e=>{e.preventDefault();pick(x)}}},
        h(doc,"span",{class:"search-kind",text:t(`palette.kind.${x.kind}`)}),h(doc,"span",{class:"search-opt-label",text:x.label})));
    });
    box.replaceChildren(...nodes);
    box.hidden=false;inp.setAttribute("aria-expanded","true");if(searchIndex>=0)inp.setAttribute("aria-activedescendant",`searchOpt-${searchIndex}`);else inp.removeAttribute("aria-activedescendant");
  }
  /** Palet açılışı (Ctrl+K veya boş alana odak): sorgusuz eylem listesini gösterir. */
  function openPalette(){searchHits=computeHits("");searchIndex=searchHits.length?0:-1;paintSearch()}
  function wireSearch(){
    const inp=el("searchInput");
    inp.addEventListener("input",()=>{searchHits=computeHits(inp.value);searchIndex=searchHits.length?0:-1;if(!inp.value.trim()){openPalette();return}paintSearch()});
    inp.addEventListener("focus",()=>{if(!inp.value.trim())openPalette()});
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
    doc.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==="k"){e.preventDefault();el("searchInput").focus();el("searchInput").select();openPalette()}});
    // //TR: UX WP-FIRSTRUN: ilk açılışta (güvenli per-user tercih "görülmedi" ise) kurulum/onboarding sihirbazını bir kez aç. Sihirbaz KAPI DEĞİLDİR (atlanır/başarısız olursa uygulama yine açılır) ve asla giriş yapmaz/durum uydurmaz; her hata yutulur.
    try{maybeOpenFirstRun(ctx)}catch{/* ilk kurulum sihirbazı açılamadı; uygulama yine açılır */}
  }
  return {data,wireStatic,renderAll,renderNav,renderContext,renderStop,refresh,announce,showStopError,clearStopError,openStopDialog,closeStopDialog,openInspector,inspector};
}
