// //TR: DSK-T0003 (UI-024 + UI-207): Görevler > mission ayrıntısındaki görev bağımlılık haritası. Yalnız GET /v1/missions/:id/tasks okunur (salt-okunur, yazma yok); düğümler görevler, kenarlar bağımlılıklardır; kritik yol (görev sayısına göre en uzun zincir, süre tahmini değil), hazır ve engelli görevler vurgulanır. Döngü/eksik hedef dürüst hata olarak gösterilir. SVG yalnız createElementNS + textContent ile kurulur (HTML yorumlanmaz); klavye için her zaman sıralı liste yedeği vardır.
import {h,stateNote,statusPill} from "../components.js";
import {missionTasksPath,mapMissionTasks,buildTaskGraph,layoutTaskGraph} from "../task-graph-core.js";

const SVG_NS="http://www.w3.org/2000/svg";
// Yalnız bellekte: haritası açık mission ve listede seçili görev.
let openFor=null,selected=null;
export function taskGraphState(){return {openFor,selected}}
export function resetTaskGraph(){openFor=null;selected=null}
export const isTaskGraphOpen=missionId=>openFor!==null&&openFor===missionId;

/** Harita açıksa okumayı yapar; okuma hatası {state} olarak döner, görev uydurulmaz. */
export async function loadTaskGraph(ctx,missionId){
  const path=missionTasksPath(missionId);if(!path)return {state:"ERROR"};
  const r=await ctx.api.get(path);
  if(!r.ok)return {state:r.state??"ERROR"};
  const m=mapMissionTasks(r.data);
  return m.state==="VERIFIED"?{state:"VERIFIED",read:m,graph:buildTaskGraph(m.tasks)}:{state:"ERROR"};
}

const s=(doc,tag,attrs={},...kids)=>{const n=doc.createElementNS(SVG_NS,tag);for(const [k,v] of Object.entries(attrs))if(v!==null&&v!==undefined)n.setAttribute(k,String(v));for(const c of kids.flat())if(c)n.append(c);return n};
const cut=(x,n)=>{const t=String(x??"");return t.length>n?`${t.slice(0,n-1)}…`:t};
const titleOf=(ctx,node)=>node?.title??ctx.t("taskgraph.untitled");

function summaryText(ctx,g){
  return ctx.t("taskgraph.summary",{total:g.nodes.length,ready:g.counts.ready,blocked:g.counts.blocked,waiting:g.counts.waiting,
    critical:g.criticalPath?ctx.t("taskgraph.criticalLen",{n:g.criticalPath.length}):ctx.t("taskgraph.criticalNone")});
}

function errorList(ctx,g,read){
  const doc=ctx.doc,by=new Map(g.nodes.map(n=>[n.taskId,n])),name=id=>by.has(id)?titleOf(ctx,by.get(id)):id,items=[];
  for(const c of g.errors.cycles)items.push(h(doc,"li",{dataset:{tgError:"cycle"},text:ctx.t("taskgraph.err.cycle",{list:[...c,c[0]].map(name).join(" → ")})}));
  for(const m of g.errors.missing)items.push(h(doc,"li",{dataset:{tgError:"missing"},text:ctx.t("taskgraph.err.missing",{task:name(m.taskId),dep:m.dependsOn})}));
  for(const id of g.errors.duplicates)items.push(h(doc,"li",{dataset:{tgError:"duplicate"},text:ctx.t("taskgraph.err.duplicate",{id})}));
  for(const id of g.errors.unknownDeps)items.push(h(doc,"li",{dataset:{tgError:"unknownDeps"},text:ctx.t("taskgraph.err.unknownDeps",{task:name(id)})}));
  for(const id of g.errors.invalidDeps)items.push(h(doc,"li",{dataset:{tgError:"invalidDeps"},text:ctx.t("taskgraph.err.invalidDeps",{task:name(id)})}));
  if(read.dropped>0)items.push(h(doc,"li",{dataset:{tgError:"dropped"},text:ctx.t("taskgraph.err.dropped",{n:read.dropped})}));
  if(read.truncated)items.push(h(doc,"li",{dataset:{tgError:"truncated"},text:ctx.t("taskgraph.err.truncated",{n:read.tasks.length})}));
  if(!items.length)return null;
  return h(doc,"div",{class:"note note-error tg-errors",role:"alert",dataset:{tgErrors:String(items.length)}},h(doc,"p",{text:ctx.t("taskgraph.err.title")}),h(doc,"ul",{},items),
    g.criticalPath?null:h(doc,"p",{dataset:{tgCriticalNa:"1"},text:ctx.t("taskgraph.err.noCritical")}));
}

function graphSvg(ctx,g){
  const doc=ctx.doc,L=layoutTaskGraph(g),sel=selected&&g.nodes.some(n=>n.taskId===selected)?selected:null;
  const related=new Set();if(sel){const n=g.nodes.find(x=>x.taskId===sel);for(const d of n.dependsOn)related.add(d);for(const x of g.nodes)if(x.dependsOn.includes(sel))related.add(x.taskId)}
  const marker=(id,cls)=>s(doc,"marker",{id,viewBox:"0 0 10 10",refX:"9",refY:"5",markerWidth:"7",markerHeight:"7",orient:"auto-start-reverse"},s(doc,"path",{d:"M0 0 L10 5 L0 10 z",class:cls}));
  const edges=L.edges.map(e=>s(doc,"path",{d:e.d,class:`tg-edge${e.critical?" tg-edge-critical":""}${sel&&(e.from===sel||e.to===sel)?" tg-edge-related":""}`,"marker-end":e.critical?"url(#tg-arrow-critical)":"url(#tg-arrow)","data-from":e.from,"data-to":e.to}));
  const nodes=g.nodes.map(n=>{
    const p=L.pos.get(n.taskId),label=ctx.t("taskgraph.nodeAria",{title:titleOf(ctx,n),kind:ctx.t(`taskgraph.k.${n.kind}`)})+(n.critical?` · ${ctx.t("taskgraph.onCritical")}`:"");
    const t=s(doc,"title");t.textContent=label;
    const t1=s(doc,"text",{x:p.x+10,y:p.y+18,class:"tg-node-title"});t1.textContent=cut(titleOf(ctx,n),24);
    const t2=s(doc,"text",{x:p.x+10,y:p.y+34,class:"tg-node-kind"});t2.textContent=ctx.t(`taskgraph.k.${n.kind}`)+(n.critical?" ★":"");
    return s(doc,"g",{class:`tg-node tg-k-${n.kind}${n.critical?" tg-critical":""}${n.inCycle?" tg-cycle":""}${n.taskId===sel?" tg-selected":""}${related.has(n.taskId)?" tg-related":""}`,
      "data-task-id":n.taskId,"data-kind":n.kind,"data-critical":n.critical?"1":"0"},t,s(doc,"rect",{x:p.x,y:p.y,width:p.w,height:p.h,rx:"6"}),t1,t2);
  });
  const svg=s(doc,"svg",{xmlns:SVG_NS,class:"tg-svg",width:L.width,height:L.height,viewBox:`0 0 ${L.width} ${L.height}`,role:"img","aria-label":summaryText(ctx,g),"aria-describedby":"task-graph-list-h"},
    s(doc,"defs",{},marker("tg-arrow","tg-arrowhead"),marker("tg-arrow-critical","tg-arrowhead tg-arrowhead-critical")),s(doc,"g",{class:"tg-edges"},edges),s(doc,"g",{class:"tg-nodes"},nodes));
  // Geniş harita yatay kaydırılır; kaydırma kabı klavyeyle odaklanabilir (ok tuşlarıyla kaydırma).
  return h(doc,"div",{class:"tg-scroll",tabindex:"0",role:"group","aria-label":ctx.t("taskgraph.canvas")},svg);
}

function listFallback(ctx,g){
  const doc=ctx.doc,by=new Map(g.nodes.map(n=>[n.taskId,n])),pathIndex=new Map((g.criticalPath??[]).map((id,i)=>[id,i+1]));
  const items=g.nodes.map(n=>{
    const on=selected===n.taskId,deps=n.dependsOn.map(id=>titleOf(ctx,by.get(id)));
    const btn=h(doc,"button",{type:"button",class:"link-btn tg-item-btn","aria-pressed":on?"true":"false",dataset:{tgSelect:n.taskId,focusKey:`tg-${n.taskId}`},
      on:{click:()=>{selected=on?null:n.taskId;ctx.rerender()},keydown:e=>moveFocus(e)},text:titleOf(ctx,n)});
    return h(doc,"li",{class:`tg-item tg-k-${n.kind}${n.critical?" tg-critical":""}`,dataset:{tgItem:n.taskId,tgKind:n.kind,tgCritical:n.critical?"1":"0"}},
      btn," ",n.status?statusPill(ctx,n.status):h(doc,"span",{class:"task-unknown",text:ctx.t("work.task.unknown")}),
      " ",h(doc,"span",{class:`tg-kind tg-kind-${n.kind}`,text:ctx.t(`taskgraph.k.${n.kind}`)}),
      pathIndex.has(n.taskId)?[" ",h(doc,"span",{class:"tg-crit-badge",dataset:{tgCritStep:String(pathIndex.get(n.taskId))},text:ctx.t("taskgraph.critStep",{n:pathIndex.get(n.taskId),total:g.criticalPath.length})})]:null,
      deps.length?h(doc,"span",{class:"note",dataset:{tgDeps:n.dependsOn.join(",")},text:` ${ctx.t("taskgraph.dependsOn",{list:deps.join(", ")})}`}):null,
      n.waitingOn.length&&n.kind==="waiting"?h(doc,"span",{class:"note",text:` ${ctx.t("taskgraph.waitingOn",{n:n.waitingOn.length})}`}):null,
      n.missing.length?h(doc,"span",{class:"note note-error",text:` ${ctx.t("taskgraph.missingDep",{list:n.missing.join(", ")})}`}):null,
      n.inCycle?h(doc,"span",{class:"note note-error",text:` ${ctx.t("taskgraph.inCycle")}`}):null);
  });
  return h(doc,"div",{class:"tg-list-wrap"},h(doc,"h4",{id:"task-graph-list-h",text:ctx.t("taskgraph.list")}),h(doc,"p",{class:"field-hint",text:ctx.t("taskgraph.listHint")}),
    h(doc,"ol",{class:"tg-list",id:"task-graph-list","aria-labelledby":"task-graph-list-h"},items));
}
/** Liste düğmeleri arasında Yukarı/Aşağı/Home/End ile odak gezinmesi. */
function moveFocus(e){
  const keys={ArrowDown:1,ArrowUp:-1,Home:"first",End:"last"},k=keys[e.key];if(k===undefined)return;
  const li=e.currentTarget?.parentNode,ol=li?.parentNode;if(!ol)return;
  const items=[...ol.children],i=items.indexOf(li),j=k==="first"?0:k==="last"?items.length-1:Math.min(items.length-1,Math.max(0,i+k));
  const b=items[j]?.querySelector?.("button")??items[j]?.children?.[0];if(b&&typeof b.focus==="function"){e.preventDefault();b.focus()}
}

function legend(ctx){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"tg-legend","aria-label":ctx.t("taskgraph.legend")},["ready","waiting","blocked","active","done","unresolved","unknown"].map(k=>h(doc,"li",{class:`tg-legend-item tg-k-${k}`},h(doc,"span",{class:"tg-swatch","aria-hidden":"true"}),ctx.t(`taskgraph.k.${k}`))),
    h(doc,"li",{class:"tg-legend-item tg-critical"},h(doc,"span",{class:"tg-swatch","aria-hidden":"true"}),ctx.t("taskgraph.onCritical")));
}

/** Haritayı açan/kapatan düğme ve (açıksa) harita bölümü. res yalnız açıkken loadTaskGraph sonucudur. */
export function taskGraphSection(ctx,missionId,res){
  const doc=ctx.doc,open=isTaskGraphOpen(missionId);
  const toggle=h(doc,"button",{type:"button",class:"btn",id:"task-graph-toggle","aria-expanded":open?"true":"false","aria-controls":"task-graph",dataset:{focusKey:"task-graph-toggle"},
    on:{click:()=>{if(open){openFor=null;selected=null}else{openFor=missionId;selected=null}ctx.rerender()}},text:ctx.t(open?"taskgraph.hide":"taskgraph.show")});
  if(!open)return h(doc,"div",{class:"tg-toggle-row"},toggle);
  let body;
  if(!res||res.state!=="VERIFIED")body=h(doc,"div",{dataset:{taskGraphState:res?.state??"ERROR"}},stateNote(ctx,res?.state??"ERROR"),h(doc,"p",{class:"note",text:ctx.t("taskgraph.unread")}));
  else if(!res.graph.nodes.length)body=h(doc,"p",{class:"note",dataset:{taskGraphState:"EMPTY"},text:ctx.t("taskgraph.empty")});
  else{
    const g=res.graph;
    body=h(doc,"div",{dataset:{taskGraphState:"VERIFIED",tgTotal:String(g.nodes.length),tgReady:String(g.counts.ready),tgBlocked:String(g.counts.blocked),tgWaiting:String(g.counts.waiting),tgCritical:g.criticalPath?g.criticalPath.join(","):""}},
      h(doc,"p",{class:"tg-summary",role:"status",text:summaryText(ctx,g)}),
      h(doc,"p",{class:"field-hint",text:ctx.t("taskgraph.criticalNote")}),
      errorList(ctx,g,res.read),legend(ctx),graphSvg(ctx,g),listFallback(ctx,g));
  }
  return h(doc,"div",{class:"tg-toggle-row"},toggle,h(doc,"section",{class:"task-graph",id:"task-graph","aria-labelledby":"task-graph-t"},h(doc,"h4",{id:"task-graph-t",text:ctx.t("taskgraph.title")}),body));
}
