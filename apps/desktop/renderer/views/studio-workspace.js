// //TR: Bu görünüm Project Studio proje çalışma alanıdır (yeni kenar çubuğu öğesi yok, bağlamsal sekmeler): Genel Bakış (durum, mission'lar, son koşu, güvenlik/inceleme durumu), Çalıştır & Önizle (dev-run başlat/durdur/yeniden başlat; sansürlü log kuyruğu yerinde yenilenir ve odağı bozmaz; önizleme yalnız backend AVAILABLE derken ve kesin loopback biçimindeyken, varsayılan tarayıcıda), Dosyalar (salt-okunur, sansürlü, boyut sınırlı), Değişiklikler (git log + diff), Görevler (B5 ekranına bağlantı) ve Teslim (dışa aktarma + ana süreçte çözülen klasörde göster). Backend verisi yalnız metin olarak render edilir; uydurma durum yoktur.
import {h,panel,stateNote,emptyNote,statusPill,statusLabel,badge} from "../components.js";
import {formatTime,mapMissions,MISSING} from "../model.js";
import {formatDateTime,describePostResult} from "../work-core.js";
import {drafts,selection,field,statusBlock,setStatus,focusStatus} from "../forms.js";
import {STUDIO_TABS,GIT_LOG_LIMIT,buildDevRunRequest,buildExportRequest,previewOpenable,devRunActions,diffLineKind,formatBytes,joinRel,parentRel,validRelPath,latestRunFor,securitySummary} from "../project-core.js";
import {studio,setTab} from "../studio-state.js";
import {importPanel} from "./studio-wizard.js";

export const DEV_FORM="studio-devrun";
export const EXPORT_FORM="studio-export";
export const RUN_POLL_MS=3000;
const LIVE_STATES=["STARTING","RUNNING"];
const PREVIEW_REASONS=["DEVRUN_UNAVAILABLE","PREVIEW_UNAVAILABLE","OPEN_FAILED"];
const SHOW_REASONS=["EXPORT_UNAVAILABLE","EXPORT_PATH_REJECTED"];
let runTimer=null;
/** Dev-run yoklamasını durdurur; her çalışma alanı yeniden kurulumunda ve sekme değişiminde çağrılır. */
export function stopRunPolling(){if(runTimer!==null){clearInterval(runTimer);runTimer=null}}

// ---------- Sekme çubuğu ----------
function tabBar(ctx){
  const doc=ctx.doc,go=(k,focus)=>{setTab(k);if(focus){const n=doc.getElementById?.(`studio-tab-${k}`);if(n)n.focus()}ctx.rerender()};
  return h(doc,"div",{class:"tabs studio-tabs",role:"tablist","aria-label":ctx.t("studio.tabs.label")},STUDIO_TABS.map((k,i)=>{
    const sel=studio.tab===k;
    return h(doc,"button",{type:"button",role:"tab",id:`studio-tab-${k}`,"aria-selected":sel?"true":"false","aria-controls":"studio-panel",tabindex:sel?"0":"-1",dataset:{focusKey:`studio-tab-${k}`,tab:k},text:ctx.t(`studio.tab.${k}`),
      on:{click:()=>go(k,false),keydown:e=>{
        const d=e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0;
        if(d){e.preventDefault();go(STUDIO_TABS[(i+d+STUDIO_TABS.length)%STUDIO_TABS.length],true)}
        else if(e.key==="Home"){e.preventDefault();go(STUDIO_TABS[0],true)}
        else if(e.key==="End"){e.preventDefault();go(STUDIO_TABS[STUDIO_TABS.length-1],true)}
      }}});
  }));
}
const fact=(doc,label,value,cls="")=>[h(doc,"dt",{text:label}),h(doc,"dd",{class:cls,text:value})];

// ---------- Genel Bakış ----------
async function overviewTab(ctx,project,projects){
  const doc=ctx.doc,id=project.projectId;
  const [mres,rres]=await Promise.all([ctx.api.raw(`/v1/missions?projectId=${id}`),ctx.api.workRuns()]);
  const missions=mres.ok?mapMissions(mres.data):{state:mres.state,items:[]};
  const info=panel(ctx,{titleKey:"studio.ov.project",id:"studio-ov-project"},h(doc,"dl",{class:"kv"},
    ...fact(doc,ctx.t("projects.id"),id,"mono"),...fact(doc,ctx.t("projects.env"),project.environmentId??MISSING),...fact(doc,ctx.t("projects.created"),formatTime(project.createdAt,ctx.i18n.lang)),...fact(doc,ctx.t("projects.repo"),project.repositoryPath??MISSING,"mono")));
  let mBody;
  if(missions.state!=="VERIFIED")mBody=stateNote(ctx,missions.state);
  else if(!missions.items.length)mBody=emptyNote(ctx,"studio.ov.noMissions");
  else{
    const counts=new Map();for(const m of missions.items)counts.set(m.status,(counts.get(m.status)??0)+1);
    mBody=h(doc,"ul",{class:"inline-list"},[...counts].map(([s,n])=>h(doc,"li",{},statusPill(ctx,s)," ",h(doc,"strong",{text:String(n)}))));
  }
  const missionsPanel=panel(ctx,{titleKey:"studio.ov.missions",id:"studio-ov-missions"},mBody);
  // Son koşu, inceleme ve güvenlik durumu yalnız sunucunun bildirdiği alanlardan gösterilir; yoksa "bildirilmedi" denir.
  let runBody,reviewBody,secBody;
  if(rres.state!=="VERIFIED"||missions.state!=="VERIFIED"){const s=rres.state!=="VERIFIED"?rres.state:missions.state;runBody=stateNote(ctx,s);reviewBody=stateNote(ctx,s);secBody=stateNote(ctx,s)}
  else{
    const run=latestRunFor(rres.items,missions.items.map(m=>m.missionId));
    if(!run){runBody=emptyNote(ctx,"studio.ov.noRun");reviewBody=emptyNote(ctx,"studio.ov.noRun");secBody=emptyNote(ctx,"studio.ov.noRun")}
    else{
      runBody=h(doc,"dl",{class:"kv"},...fact(doc,ctx.t("workforce.live.run"),run.runId,"mono"),h(doc,"dt",{text:ctx.t("workforce.live.status")}),h(doc,"dd",{},statusPill(ctx,run.status)),...fact(doc,ctx.t("studio.ov.step"),run.step?.name??MISSING),...fact(doc,ctx.t("studio.ov.startedAt"),formatDateTime(run.startedAt,ctx.i18n.lang)));
      reviewBody=run.reviewer?h(doc,"dl",{class:"kv"},...fact(doc,ctx.t("studio.ov.reviewer"),run.reviewer.identity??MISSING),...fact(doc,ctx.t("studio.ov.verdict"),run.reviewer.verdict?statusLabel(ctx,run.reviewer.verdict):MISSING)):emptyNote(ctx,"studio.ov.reviewNone");
      const ev=await ctx.api.evidenceList({runId:run.runId});
      if(ev.state!=="VERIFIED")secBody=stateNote(ctx,ev.state);
      else{
        const sum=securitySummary(ev.items);
        secBody=sum.seen?h(doc,"div",{},h(doc,"p",{class:"note",text:ctx.t("studio.ov.secCount",{n:sum.total})}),h(doc,"ul",{class:"inline-list"},Object.entries(sum.counts).map(([k,n])=>h(doc,"li",{},badge(ctx,k==="NONE"?ctx.t("everif.NONE"):ctx.t(`everif.${k}`)),` ${n}`)))):emptyNote(ctx,"studio.ov.secNone");
      }
    }
  }
  return h(doc,"div",{class:"studio-grid"},info,missionsPanel,panel(ctx,{titleKey:"studio.ov.lastRun",id:"studio-ov-run"},runBody),panel(ctx,{titleKey:"studio.ov.review",id:"studio-ov-review"},reviewBody),panel(ctx,{titleKey:"studio.ov.security",id:"studio-ov-security"},secBody),importPanel(ctx,{projects,fixedId:id}));
}

// ---------- Çalıştır & Önizle ----------
function paintRun(ctx,nodes,run){
  const t=ctx.t,acts=devRunActions(run.status);
  nodes.current=run;
  nodes.state.textContent=t("studio.run.state",{state:t(`devrun.state.${run.status}`)});
  nodes.state.dataset.status=run.status;
  nodes.facts.replaceChildren(...fact(ctx.doc,"PID",run.pid===null?MISSING:String(run.pid),"mono"),...fact(ctx.doc,t("studio.run.port"),run.port===null?MISSING:String(run.port),"mono"),...fact(ctx.doc,t("studio.run.started"),formatDateTime(run.startedAt,ctx.i18n.lang)),
    ...fact(ctx.doc,t("studio.run.exitCode"),run.exitCode===null?MISSING:String(run.exitCode),"mono"),...fact(ctx.doc,t("studio.run.lastProbe"),formatDateTime(run.preview.lastProbeAt,ctx.i18n.lang)));
  nodes.start.disabled=!acts.start||drafts.busy[DEV_FORM]===true;nodes.stop.disabled=!acts.stop||drafts.busy[DEV_FORM]===true;nodes.restart.disabled=!acts.restart||drafts.busy[DEV_FORM]===true;
  const openable=previewOpenable(run);
  nodes.preview.disabled=!openable;
  nodes.previewNote.textContent=openable?t("studio.run.previewReady",{url:run.preview.url}):t("studio.run.previewNone",{state:t(`devrun.preview.${run.preview.state}`)});
  const pre=nodes.log,stick=pre.scrollHeight===undefined||pre.scrollTop===undefined||pre.clientHeight===undefined||pre.scrollHeight-pre.scrollTop-pre.clientHeight<24;
  pre.textContent=run.logTail||t("studio.run.logEmpty");
  if(stick&&pre.scrollHeight!==undefined)pre.scrollTop=pre.scrollHeight;
}
function startRunPolling(ctx,project,nodes){
  stopRunPolling();
  if(!nodes.current||!LIVE_STATES.includes(nodes.current.status))return;
  runTimer=setInterval(async()=>{
    if(nodes.root.isConnected===false){stopRunPolling();return}
    const r=await ctx.api.devrun(project.projectId,{force:true});
    if(nodes.root.isConnected===false){stopRunPolling();return}
    if(r.state==="VERIFIED"){paintRun(ctx,nodes,r.run);if(!LIVE_STATES.includes(r.run.status))stopRunPolling()}
  },RUN_POLL_MS);
}
const repaintStatus=(ctx,wrap,formId)=>wrap.replaceChildren(statusBlock(ctx,formId));
export async function runAction(ctx,project,nodes,action){
  const req=buildDevRunRequest({projectId:project.projectId,action});
  if(!req.ok){setStatus(DEV_FORM,{ok:false,errors:req.errors});repaintStatus(ctx,nodes.statusWrap,DEV_FORM);return {ok:false,validation:true}}
  if(action!=="stop"){
    const yes=await ctx.confirm({title:ctx.t("studio.run.confirm.title",{action:ctx.t(`studio.run.${action}`)}),body:ctx.t("studio.run.confirm.body"),action:ctx.t(`studio.run.${action}`),target:`${project.name} (${project.projectId})`,confirmLabel:ctx.t(`studio.run.${action}`)});
    if(yes!==true){setStatus(DEV_FORM,{ok:false,key:"confirm.cancelled",vars:{},errors:null});repaintStatus(ctx,nodes.statusWrap,DEV_FORM);return {ok:false,cancelled:true}}
  }
  drafts.busy[DEV_FORM]=true;if(nodes.current)paintRun(ctx,nodes,nodes.current);
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[DEV_FORM]=false}
  const d=describePostResult(res);
  setStatus(DEV_FORM,{ok:d.ok,key:d.ok?`studio.run.done.${action}`:d.key,vars:d.ok?{}:d.vars,errors:null});repaintStatus(ctx,nodes.statusWrap,DEV_FORM);
  const r=await ctx.api.devrun(project.projectId,{force:true});
  if(r.state==="VERIFIED"){paintRun(ctx,nodes,r.run);startRunPolling(ctx,project,nodes)}else if(nodes.current)paintRun(ctx,nodes,nodes.current);
  return {ok:d.ok,status:res?.status??null};
}
export async function openPreview(ctx,project,nodes){
  if(!previewOpenable(nodes.current))return {ok:false,blocked:true};
  const native=ctx.native;let msg;
  if(!native||typeof native.openPreview!=="function")msg={ok:false,key:"studio.run.preview.noNative",vars:{},errors:null};
  else{
    let r=null;try{r=await native.openPreview(project.projectId)}catch{r=null}
    msg=r&&r.opened===true?{ok:true,key:"studio.run.preview.opened",vars:{},errors:null}:{ok:false,key:`studio.run.preview.reason.${r&&PREVIEW_REASONS.includes(r.reason)?r.reason:"OPEN_FAILED"}`,vars:{},errors:null};
  }
  setStatus(DEV_FORM,msg);repaintStatus(ctx,nodes.statusWrap,DEV_FORM);return {ok:msg.ok};
}
async function runTab(ctx,project){
  const doc=ctx.doc,res=await ctx.api.devrun(project.projectId,{force:true});
  if(res.state!=="VERIFIED")return panel(ctx,{titleKey:"studio.run.title",id:"studio-run"},stateNote(ctx,res.state),h(doc,"p",{class:"note",text:ctx.t("studio.run.unavailable")}));
  const nodes={current:null};
  const btn=(key,text,onClick,extra={})=>h(doc,"button",{type:"button",class:"btn",id:`studio-run-${key}`,dataset:{focusKey:`studio-run-${key}`},text,on:{click:onClick},...extra});
  nodes.state=h(doc,"p",{class:"studio-run-state",id:"studio-run-state",role:"status","aria-live":"polite"});
  nodes.facts=h(doc,"dl",{class:"kv"});
  nodes.start=btn("start",ctx.t("studio.run.start"),()=>runAction(ctx,project,nodes,"start"));
  nodes.stop=btn("stop",ctx.t("studio.run.stop"),()=>runAction(ctx,project,nodes,"stop"),{class:"btn btn-danger"});
  nodes.restart=btn("restart",ctx.t("studio.run.restart"),()=>runAction(ctx,project,nodes,"restart"));
  nodes.preview=btn("preview",ctx.t("studio.run.openPreview"),()=>openPreview(ctx,project,nodes),{class:"btn btn-primary"});
  nodes.previewNote=h(doc,"p",{class:"field-hint",id:"studio-run-preview-note"});
  nodes.statusWrap=h(doc,"div",{id:"studio-run-status-wrap"},statusBlock(ctx,DEV_FORM));
  nodes.log=h(doc,"pre",{class:"log mono",id:"studio-log",tabindex:"0","aria-label":ctx.t("studio.run.logLabel"),"aria-live":"off",dataset:{focusKey:"studio-log"}});
  nodes.root=h(doc,"section",{class:"panel",id:"studio-run","aria-labelledby":"studio-run-t"},
    h(doc,"h2",{class:"panel-title",id:"studio-run-t",text:ctx.t("studio.run.title")}),
    nodes.state,nodes.facts,
    h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("studio.run.actions")},nodes.start,nodes.stop,nodes.restart,nodes.preview),
    nodes.previewNote,h(doc,"p",{class:"field-hint",text:ctx.t("studio.run.previewWhy")}),nodes.statusWrap,
    h(doc,"h3",{class:"planned-sub",text:ctx.t("studio.run.log")}),nodes.log,h(doc,"p",{class:"field-hint",text:ctx.t("studio.run.logNote")}));
  paintRun(ctx,nodes,res.run);startRunPolling(ctx,project,nodes);
  return nodes.root;
}

// ---------- Dosyalar ----------
async function filesTab(ctx,project){
  const doc=ctx.doc,id=project.projectId,dir=studio.dir,list=await ctx.api.projectFiles(id,dir);
  const crumb=h(doc,"p",{class:"mono path-chosen",id:"studio-files-path","aria-label":ctx.t("studio.files.here"),text:`/${dir}`});
  const up=dir?h(doc,"button",{type:"button",class:"btn btn-small",id:"studio-files-up",dataset:{focusKey:"studio-files-up"},text:ctx.t("studio.files.up"),on:{click:()=>{studio.dir=parentRel(dir);studio.file=null;ctx.rerender()}}}):null;
  let tree;
  if(list.state!=="VERIFIED")tree=stateNote(ctx,list.state);
  else if(!list.entries.length)tree=emptyNote(ctx,"studio.files.empty");
  else tree=h(doc,"div",{},h(doc,"ul",{class:"file-list"},list.entries.map(e=>{
    const rel=joinRel(dir,e.name),ok=validRelPath(rel),isSel=!e.dir&&studio.file===rel;
    return h(doc,"li",{},h(doc,"button",{type:"button",class:"link-btn",id:`fe-${rel}`,dataset:{focusKey:`fe:${rel}`},"aria-current":isSel?"true":null,disabled:!ok,
      on:{click:()=>{if(e.dir){studio.dir=rel;studio.file=null}else studio.file=rel;ctx.rerender()}},text:`${e.dir?ctx.t("studio.files.dir"):ctx.t("studio.files.file")} ${e.name}`}),e.dir||e.size===null?null:h(doc,"span",{class:"field-hint",text:` ${formatBytes(e.size)}`}));
  })),list.truncated?h(doc,"p",{class:"note",text:ctx.t("studio.files.listTruncated")}):null);
  let viewer=emptyNote(ctx,"studio.files.pick");
  if(studio.file){
    const f=await ctx.api.projectFile(id,studio.file);
    if(f.state!=="VERIFIED")viewer=stateNote(ctx,f.state);
    else if(f.file.binary)viewer=h(doc,"p",{class:"note",text:ctx.t("studio.files.binary")});
    else viewer=h(doc,"div",{},h(doc,"p",{class:"mono",text:studio.file}),h(doc,"pre",{class:"log mono code-view",id:"studio-file-view",tabindex:"0","aria-label":ctx.t("studio.files.viewLabel",{path:studio.file}),dataset:{focusKey:"studio-file-view"},text:f.file.text||ctx.t("studio.files.emptyFile")}),
      f.file.truncated?h(doc,"p",{class:"note",text:ctx.t("studio.files.truncated")}):null,h(doc,"p",{class:"field-hint",text:ctx.t("studio.files.note")}));
  }
  return h(doc,"div",{class:"studio-files"},panel(ctx,{titleKey:"studio.files.tree",id:"studio-files-tree"},crumb,up,tree),panel(ctx,{titleKey:"studio.files.viewer",id:"studio-files-viewer"},viewer));
}

// ---------- Değişiklikler ----------
async function changesTab(ctx,project){
  const doc=ctx.doc,id=project.projectId,log=await ctx.api.gitLog(id,GIT_LOG_LIMIT);
  if(log.state!=="VERIFIED")return panel(ctx,{titleKey:"studio.git.log",id:"studio-git-log"},stateNote(ctx,log.state));
  if(!log.commits.length)return panel(ctx,{titleKey:"studio.git.log",id:"studio-git-log"},emptyNote(ctx,"studio.git.empty"));
  const hashes=new Set(log.commits.map(c=>c.hash));
  if(!hashes.has(studio.diffTo))studio.diffTo=log.commits[0].hash;
  if(studio.diffFrom&&!hashes.has(studio.diffFrom))studio.diffFrom="";
  if(!studio.diffFrom&&!studio.diffRequested)studio.diffFrom=log.commits[1]?.hash??"";
  const opts=[{value:"",label:ctx.t("studio.git.none")},...log.commits.map(c=>({value:c.hash,label:`${c.short} — ${c.subject}`}))];
  const table=h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},h(doc,"caption",{class:"sr-only",text:ctx.t("studio.git.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["studio.git.hash","studio.git.subject","studio.git.author","studio.git.date"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},log.commits.map(c=>h(doc,"tr",{},h(doc,"td",{class:"mono",text:c.short}),h(doc,"td",{text:c.subject}),h(doc,"td",{text:c.author??MISSING}),h(doc,"td",{text:formatDateTime(c.date,ctx.i18n.lang)}))))));
  const picker=h(doc,"div",{class:"filter-row"},
    field(ctx,{id:"studio-diff-from",labelKey:"studio.git.from",value:studio.diffFrom,onInput:v=>{studio.diffFrom=v},options:opts}),
    field(ctx,{id:"studio-diff-to",labelKey:"studio.git.to",value:studio.diffTo,onInput:v=>{studio.diffTo=v},options:opts.slice(1)}),
    h(doc,"button",{type:"button",class:"btn btn-primary",id:"studio-diff-show",dataset:{focusKey:"studio-diff-show"},text:ctx.t("studio.git.show"),on:{click:()=>{studio.diffRequested=true;ctx.rerender()}}}));
  let diffBody=null;
  if(studio.diffRequested){
    const d=await ctx.api.gitDiff(id,studio.diffFrom,studio.diffTo);
    if(d.state!=="VERIFIED")diffBody=stateNote(ctx,d.state);
    else if(d.diff.empty)diffBody=emptyNote(ctx,"studio.git.noDiff");
    else diffBody=h(doc,"div",{},
      d.diff.files.length?h(doc,"ul",{class:"inline-list"},d.diff.files.map(f=>h(doc,"li",{class:"mono",text:`${f.path} (+${f.additions??"?"} −${f.deletions??"?"})`}))):null,
      h(doc,"pre",{class:"log mono diff-view",id:"studio-diff-view",tabindex:"0","aria-label":ctx.t("studio.git.diffLabel"),dataset:{focusKey:"studio-diff-view"}},d.diff.lines.map(line=>h(doc,"span",{class:`diff-line diff-${diffLineKind(line)}`,text:line||" "}))),
      d.diff.truncated?h(doc,"p",{class:"note",text:ctx.t("studio.git.truncated")}):null,h(doc,"p",{class:"field-hint",text:ctx.t("studio.git.note")}));
  }
  return h(doc,"div",{class:"studio-grid"},panel(ctx,{titleKey:"studio.git.log",id:"studio-git-log"},table),panel(ctx,{titleKey:"studio.git.diff",id:"studio-git-diff"},picker,diffBody));
}

// ---------- Görevler ----------
async function missionsTab(ctx,project){
  const doc=ctx.doc,res=await ctx.api.raw(`/v1/missions?projectId=${project.projectId}`),m=res.ok?mapMissions(res.data):{state:res.state,items:[]};
  const go=missionId=>{if(missionId)selection.missionId=missionId;ctx.selectProject(project.projectId);ctx.navigate("work")};
  let body;
  if(m.state!=="VERIFIED")body=stateNote(ctx,m.state);
  else if(!m.items.length)body=emptyNote(ctx,"studio.ov.noMissions");
  else body=h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},h(doc,"caption",{class:"sr-only",text:ctx.t("work.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["work.col.title","work.col.status","work.col.risk"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},m.items.map(x=>h(doc,"tr",{},h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn",id:`sm-${x.missionId}`,dataset:{focusKey:`sm-${x.missionId}`,missionId:x.missionId},text:x.title,on:{click:()=>go(x.missionId)}})),h(doc,"td",{},statusPill(ctx,x.status)),h(doc,"td",{text:x.riskLevel}))))));
  return panel(ctx,{titleKey:"studio.missions.title",id:"studio-missions"},h(doc,"p",{class:"note",text:ctx.t("studio.missions.lead")}),body,
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"studio-missions-open",dataset:{focusKey:"studio-missions-open"},text:ctx.t("studio.missions.open"),on:{click:()=>go(null)}})));
}

// ---------- Teslim ----------
export async function submitExport(ctx,project){
  const req=buildExportRequest({projectId:project.projectId,commit:studio.commit});
  if(!req.ok){setStatus(EXPORT_FORM,{ok:false,errors:req.errors});await ctx.rerender();focusStatus(ctx.doc,EXPORT_FORM);return {ok:false,validation:true}}
  drafts.busy[EXPORT_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[EXPORT_FORM]=false}
  const d=describePostResult(res);
  setStatus(EXPORT_FORM,{ok:d.ok,key:d.ok?"studio.export.done":d.key,vars:d.ok?{}:d.vars,errors:null});
  await ctx.refreshAll({force:true});focusStatus(ctx.doc,EXPORT_FORM);return {ok:d.ok,status:res?.status??null};
}
/** Klasörde göster: renderer yalnız kimlikleri verir; yolu ana süreç backend'den okuyup veri dizinindeki exports klasörüne karşı doğrular. */
export async function showExport(ctx,project,exportId){
  const native=ctx.native;let msg;
  if(!native||typeof native.showExport!=="function")msg={ok:false,key:"studio.export.noNative",vars:{},errors:null};
  else{
    let r=null;try{r=await native.showExport(project.projectId,exportId)}catch{r=null}
    msg=r&&r.shown===true?{ok:true,key:"studio.export.shown",vars:{},errors:null}:{ok:false,key:`studio.export.reason.${r&&SHOW_REASONS.includes(r.reason)?r.reason:"EXPORT_UNAVAILABLE"}`,vars:{},errors:null};
  }
  setStatus(EXPORT_FORM,msg);await ctx.rerender();focusStatus(ctx.doc,EXPORT_FORM);return {ok:msg.ok};
}
async function deliveryTab(ctx,project){
  const doc=ctx.doc,st=drafts.status[EXPORT_FORM],errs=st?.errors??{},list=await ctx.api.projectExports(project.projectId);
  const form=h(doc,"form",{id:"studio-export-form",novalidate:true,"aria-labelledby":"studio-export-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[EXPORT_FORM])submitExport(ctx,project)}}},
    field(ctx,{id:"studio-export-commit",labelKey:"studio.export.commit",value:studio.commit,onInput:v=>{studio.commit=v},errorKey:errs.commit,hintKey:"studio.export.commitHint"}),
    statusBlock(ctx,EXPORT_FORM),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"studio-export-submit",dataset:{focusKey:"studio-export-submit"},disabled:drafts.busy[EXPORT_FORM]===true,text:ctx.t("studio.export.submit")})));
  let body;
  if(list.state!=="VERIFIED")body=stateNote(ctx,list.state);
  else if(!list.items.length)body=emptyNote(ctx,"studio.export.empty");
  else body=h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},h(doc,"caption",{class:"sr-only",text:ctx.t("studio.export.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["studio.export.col.id","studio.export.col.created","studio.export.col.commit","studio.export.col.size","studio.export.col.status","studio.export.col.action"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},list.items.map(x=>h(doc,"tr",{},h(doc,"td",{class:"mono",text:x.exportId}),h(doc,"td",{text:formatDateTime(x.createdAt,ctx.i18n.lang)}),h(doc,"td",{class:"mono",text:x.commit?x.commit.slice(0,7):MISSING}),h(doc,"td",{text:formatBytes(x.sizeBytes)}),h(doc,"td",{text:x.status?statusLabel(ctx,x.status):MISSING}),
      h(doc,"td",{},h(doc,"button",{type:"button",class:"btn btn-small",id:`ex-show-${x.exportId}`,dataset:{focusKey:`ex-show-${x.exportId}`},text:ctx.t("studio.export.show"),"aria-label":ctx.t("studio.export.showAria",{id:x.exportId}),on:{click:()=>{showExport(ctx,project,x.exportId)}}})))))));
  return h(doc,"div",{class:"studio-grid"},
    h(doc,"section",{class:"panel",id:"studio-export","aria-labelledby":"studio-export-t"},h(doc,"h2",{class:"panel-title",id:"studio-export-t",text:ctx.t("studio.export.title")}),h(doc,"p",{class:"note",text:ctx.t("studio.export.lead")}),form),
    panel(ctx,{titleKey:"studio.export.list",id:"studio-exports"},body));
}

const TAB_RENDERERS={overview:overviewTab,run:runTab,files:filesTab,changes:changesTab,missions:missionsTab,delivery:deliveryTab};
/** Çalışma alanını kurar; project: mapProjects öğesi, projects: tüm proje listesi (içe aktarma paneli için). */
export async function renderWorkspace(ctx,project,projects,{onBack}){
  stopRunPolling();
  const doc=ctx.doc,body=await TAB_RENDERERS[studio.tab](ctx,project,projects);
  return h(doc,"div",{class:"view studio-ws"},
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"studio-back",dataset:{focusKey:"studio-back"},text:ctx.t("studio.back"),on:{click:onBack}})),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:project.name}),
    h(doc,"p",{class:"panel-meta mono",text:project.projectId}),
    tabBar(ctx),
    h(doc,"div",{id:"studio-panel",role:"tabpanel","aria-labelledby":`studio-tab-${studio.tab}`},body));
}
