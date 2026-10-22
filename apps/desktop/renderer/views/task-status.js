// //TR: Bu görünüm parçası Görevler > mission ayrıntısında seçili görevin durum denetimidir (COORD-TASK-UI): yalnız sunucu durum makinesinin izin verdiği hedefler düğme olarak sunulur (PENDING -> IN_PROGRESS -> DONE, BLOCKED), bağımlılıkları bitmemiş görev başlatılamaz, COMPLETE mission'ın görevleri donuktur. POST /v1/tasks/:id/transition; karar sunucudadır, uç nokta masaüstü allow-list'inde yoksa veya sunucu reddederse ret dürüstçe gösterilir, başarı uydurulmaz. Durum değişikliği koşu başlatmaz, ajan çalıştırmaz.
import {h,statusPill,statusLabel} from "../components.js";
import {drafts,field,statusBlock,setStatus,recordPost,focusResult} from "../forms.js";
import {allowedTaskTargets,buildTaskTransitionRequest,isTaskStatus,TASK_ID_RE} from "../work-core.js";

export const TASK_STATUS_FORM="task-status";
const KEYS=["id:taskst-reason"];
// Gerekçe taslağı yalnız oturum içidir ve seçili görev değişince sıfırlanır.
export const taskStatusDraft={taskId:null,reason:""};
export function resetTaskStatusDraft(taskId=null){taskStatusDraft.taskId=taskId;taskStatusDraft.reason="";delete drafts.status[TASK_STATUS_FORM]}

export async function submitTaskTransition(ctx,mission,task,to){
  const req=buildTaskTransitionRequest({task,tasks:mission.tasks,missionStatus:mission.status,to,reason:taskStatusDraft.reason});
  if(!req.ok){setStatus(TASK_STATUS_FORM,{ok:false,errors:req.errors});await ctx.rerender();focusResult(ctx,TASK_STATUS_FORM,KEYS);return {ok:false,validation:true}}
  // //TR: DONE son durumdur (TASK_TRANSITIONS: DONE -> yok); yalnız bu hedefte, istek kurulup doğrulandıktan sonra ve göndermeden önce açık onay istenir. Vazgeçilirse hiçbir istek gönderilmez ve durum bloğu dürüstçe "iptal edildi" der. Diğer hedeflerde onay yoktur.
  if(to==="DONE"){
    const yes=await ctx.confirm({title:ctx.t("taskst.confirm.title"),body:ctx.t("taskst.confirm.body"),action:ctx.t("taskst.confirm.action",{title:task.title}),target:`${task.title} (${task.taskId})`,confirmLabel:ctx.t("taskst.confirm.ok")});
    if(yes!==true){setStatus(TASK_STATUS_FORM,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,TASK_STATUS_FORM,KEYS);return {ok:false,cancelled:true}}
  }
  drafts.busy[TASK_STATUS_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[TASK_STATUS_FORM]=false}
  const ok=recordPost(TASK_STATUS_FORM,res,"taskst.done",{title:task.title,to:statusLabel(ctx,to)});
  if(ok)taskStatusDraft.reason="";
  await ctx.refreshAll({force:true});focusResult(ctx,TASK_STATUS_FORM,KEYS);return {ok,status:res?.status??null};
}
/** Seçili görev için durum denetimi; görev seçili değilse veya mission'da yoksa null. */
export function taskStatusControls(ctx,mission,taskId){
  const task=taskId?(mission.tasks??[]).find(t=>t.taskId===taskId):null;
  if(!task)return null;
  const doc=ctx.doc;
  if(taskStatusDraft.taskId!==taskId)resetTaskStatusDraft(taskId);
  const wrap=(...c)=>h(doc,"div",{class:"task-status",id:"task-status",role:"region","aria-label":ctx.t("taskst.title"),dataset:{taskStatus:taskId}},h(doc,"h4",{text:ctx.t("taskst.title")}),...c);
  if(!TASK_ID_RE.test(taskId))return wrap(h(doc,"p",{class:"note note-unknown",role:"status",dataset:{taskstNote:"id"},text:ctx.t("taskst.idUnknown")}));
  const {targets,blockedBy}=allowedTaskTargets(task,mission.tasks,mission.status),busy=drafts.busy[TASK_STATUS_FORM]===true;
  const note=(k,key,vars)=>h(doc,"p",{class:"note",role:"status",dataset:{taskstNote:k},text:ctx.t(key,vars)});
  const notes=[];
  if(mission.status==="COMPLETE")notes.push(note("frozen","taskst.frozen"));
  else if(!isTaskStatus(task.status))notes.push(note("status","taskst.statusUnknown"));
  else if(task.status==="DONE")notes.push(note("terminal","taskst.terminal"));
  if(blockedBy.length){
    const titles=blockedBy.map(id=>(mission.tasks??[]).find(t=>t.taskId===id)?.title??id);
    notes.push(note("deps","taskst.waiting",{list:titles.join(", ")}));
  }
  const controls=targets.length?h(doc,"div",{},
    field(ctx,{id:"taskst-reason",labelKey:"taskst.reason",value:taskStatusDraft.reason,onInput:v=>{taskStatusDraft.reason=v},hintKey:"taskst.reasonHint"}),
    h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("taskst.title")},targets.map(to=>h(doc,"button",{type:"button",class:`btn${to==="DONE"?" btn-primary":""}`,id:`taskst-${to}`,dataset:{focusKey:`taskst-${to}`,taskTo:to,confirm:to==="DONE"?"true":"false"},disabled:busy,
      on:{click:()=>{if(!drafts.busy[TASK_STATUS_FORM])submitTaskTransition(ctx,mission,task,to)}},text:ctx.t("taskst.to",{to:statusLabel(ctx,to)})})))):null;
  return wrap(h(doc,"p",{class:"note",text:ctx.t("taskst.lead")}),h(doc,"p",{class:"panel-meta"},h(doc,"span",{text:ctx.t("taskst.current")})," ",statusPill(ctx,task.status)),...notes,controls,statusBlock(ctx,TASK_STATUS_FORM));
}
