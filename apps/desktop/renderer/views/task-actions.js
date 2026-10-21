// //TR: Bu görünüm parçası Görevler > görev denetçisindeki "Görev durumu" eylemleridir (LANE-A): görevin mevcut durumundan izinli hedefleri (PENDING/IN_PROGRESS/DONE/BLOCKED durum makinesi) zorunlu gerekçeyle POST /v1/tasks/:id/transition olarak gönderir; DONE son durumdur ve ayrı onay ister. Bağımlılıklar yalnız mission okumasındaki dependsOn alanından gösterilir; IN_PROGRESS için bağımlılıkların bitmesi şartını SUNUCU uygular ve ret (409) dürüstçe gösterilir. Uç nokta masaüstü allow-list'inde yoksa köprü reddi gösterilir; hiçbir durum uydurulmaz.
import {h} from "../components.js";
import {statusPill} from "../components.js";
import {drafts,field,statusBlock,setStatus,focusResult} from "../forms.js";
import {buildTaskTransitionRequest,allowedTaskNext,describePostResult} from "../work-core.js";

export const TASK_FORM="task-tr";
const keys=to=>[`id:task-to-${to}`,"id:task-tr-reason"];
export async function performTaskTransition(ctx,{task,to,reason}){
  const probe=buildTaskTransitionRequest({taskId:task.taskId,from:task.status,to,reason});
  if(!probe.ok){setStatus(TASK_FORM,{ok:false,errors:probe.errors});await ctx.rerender();focusResult(ctx,TASK_FORM,keys(to));return {ok:false,validation:true}}
  if(to==="DONE"){
    const yes=await ctx.confirm({title:ctx.t("task.confirm.title"),body:ctx.t("task.confirm.body"),action:ctx.t("task.confirm.action",{title:task.title}),target:`${task.title} (${task.taskId})`,confirmLabel:ctx.t("task.confirm.ok")});
    if(yes!==true){setStatus(TASK_FORM,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,TASK_FORM,keys(to));return {ok:false,cancelled:true}}
  }
  drafts.busy[TASK_FORM]=true;
  let res;try{res=await ctx.api.post(probe.path,probe.body)}finally{drafts.busy[TASK_FORM]=false}
  const d=describePostResult(res);
  setStatus(TASK_FORM,{ok:d.ok,key:d.ok?"task.done":d.key,vars:d.ok?{to:ctx.t(`task.status.${to}`)}:d.vars,errors:null});
  if(d.ok)delete drafts.reasons[`task:${task.taskId}`];
  await ctx.refreshAll({force:true});focusResult(ctx,TASK_FORM,keys(to));return {ok:d.ok,status:res?.status??null};
}
/** Seçili görev için durum eylemleri; bağımlılık başlıkları yalnız aynı mission'ın okunan görevlerinden gelir (bilinmeyen kimlik kimlik olarak gösterilir). */
export function taskTransitionControls(ctx,task,missionTasks=[]){
  const doc=ctx.doc,next=allowedTaskNext(task.status),busy=drafts.busy[TASK_FORM]===true,rkey=`task:${task.taskId}`;
  const byId=new Map(missionTasks.map(t=>[t.taskId,t]));
  const waiting=(task.dependsOn??[]).map(id=>byId.get(id)??{taskId:id,title:id,status:null}).filter(t=>t.status!=="DONE");
  return h(doc,"div",{class:"task-transitions",id:"task-transitions",dataset:{taskTransitions:task.taskId}},
    h(doc,"h5",{text:ctx.t("task.actions.title")}),
    task.dependsOn?.length?h(doc,"p",{class:"note",dataset:{taskDeps:String(task.dependsOn.length),taskWaiting:String(waiting.length)},
      text:waiting.length?ctx.t("task.deps.waiting",{list:waiting.map(t=>t.title).join(", ")}):ctx.t("task.deps.allDone")}):h(doc,"p",{class:"note",text:ctx.t("task.deps.none")}),
    next.length?h(doc,"div",{},
      field(ctx,{id:"task-tr-reason",labelKey:"task.reason",value:drafts.reasons[rkey]??"",onInput:v=>{drafts.reasons[rkey]=v},hintKey:"task.reasonHint"}),
      h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("task.actions.title")},next.map(to=>h(doc,"button",{type:"button",class:`btn${to==="DONE"?" btn-primary":""}`,id:`task-to-${to}`,dataset:{focusKey:`task-to-${to}`,taskTo:to,confirm:to==="DONE"?"true":"false"},disabled:busy,
        on:{click:()=>{performTaskTransition(ctx,{task,to,reason:drafts.reasons[rkey]??""})}},text:ctx.t("task.to",{to:ctx.t(`task.status.${to}`)})})))):
      h(doc,"p",{class:"note",role:"status",text:ctx.t("task.final")}),
    statusBlock(ctx,TASK_FORM));
}
