// //TR: Bu görünüm parçası Görevler > görev denetçisindeki "Bu görevin koşuları" bölümüdür (LANE-A): GET /v1/tasks/:id/runs ile göreve bağlı koşuları listeler ve mission'ın henüz bağlanmamış bir koşusunu POST /v1/tasks/:id/runs {runId} ile göreve bağlar. Bağ yalnız kayıt tutar: koşu başlatmaz, görevi ilerletmez, doğrulama anlamı taşımaz. Okuma/yazma uç noktası masaüstü allow-list'inde yoksa dürüst UNAVAILABLE/ret gösterilir.
import {h,statusPill,stateNote,emptyNote} from "../components.js";
import {drafts,field,statusBlock,setStatus,recordPost,focusResult} from "../forms.js";
import {formatDateTime,buildLinkRunRequest,linkableRuns,taskRunsPath,mapTaskRuns,taskFollowsRun} from "../work-core.js";

export const TASK_RUNS_FORM="task-runs";
const KEYS=["id:taskruns-submit","id:taskruns-run"];
export const taskRunsDraft={taskId:null,runId:""};
export function resetTaskRunsDraft(taskId=null){taskRunsDraft.taskId=taskId;taskRunsDraft.runId="";delete drafts.status[TASK_RUNS_FORM]}

/** Göreve bağlı koşuları okur: {state,items}; yol geçersizse ERROR, okuma başarısızsa istemci durumu (UNAVAILABLE/OFFLINE/…). */
export async function loadTaskRuns(ctx,taskId){
  const path=taskRunsPath(taskId);if(!path)return {state:"ERROR",items:[]};
  const r=await ctx.api.raw(path);
  return r.ok?mapTaskRuns(r.data):{state:r.state,items:[]};
}
export async function submitLinkRun(ctx,task,runId){
  const req=buildLinkRunRequest({taskId:task.taskId,runId,taskStatus:task.status});
  if(!req.ok){setStatus(TASK_RUNS_FORM,{ok:false,errors:req.errors});await ctx.rerender();focusResult(ctx,TASK_RUNS_FORM,KEYS);return {ok:false,validation:true}}
  drafts.busy[TASK_RUNS_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[TASK_RUNS_FORM]=false}
  const ok=recordPost(TASK_RUNS_FORM,res,"taskruns.done",{runId});
  if(ok)taskRunsDraft.runId="";
  await ctx.refreshAll({force:true});focusResult(ctx,TASK_RUNS_FORM,KEYS);return {ok,status:res?.status??null};
}
/** Sunucu kuralı: görev, ona en son bağlanan koşunun sonucunu izler. Yalnız kural gösterilir; bir geçişin yapıldığı iddia edilmez. */
function followNote(ctx,f){
  const doc=ctx.doc;
  if(!f.governing)return h(doc,"p",{class:"note",dataset:{taskRunFollow:"superseded"},text:ctx.t("taskruns.follow.superseded")});
  if(f.target===null)return h(doc,"p",{class:"note",dataset:{taskRunFollow:"unknown"},text:ctx.t("taskruns.follow.unknown")});
  if(f.target==="NONE")return h(doc,"p",{class:"note",dataset:{taskRunFollow:"none"},text:ctx.t("taskruns.follow.none")});
  return h(doc,"p",{class:"note",dataset:{taskRunFollow:f.target}},ctx.t("taskruns.follow.rule")," ",statusPill(ctx,f.target));
}
/** linked: loadTaskRuns sonucu; runsRes: mission koşu okuması (api.workRuns). */
export function taskRunsPanel(ctx,{task,linked,runsRes}){
  const doc=ctx.doc,lang=ctx.i18n.lang;
  if(taskRunsDraft.taskId!==task.taskId)resetTaskRunsDraft(task.taskId);
  let list;
  if(linked.state!=="VERIFIED")list=stateNote(ctx,linked.state,linked.state==="UNAVAILABLE"?"taskruns.unavailable":undefined);
  else if(!linked.items.length)list=emptyNote(ctx,"taskruns.none");
  else{
    const follow=taskFollowsRun(linked.items);
    list=h(doc,"ul",{class:"cards task-run-list"},linked.items.map((l,i)=>h(doc,"li",{class:"card",dataset:{taskRun:l.runId,taskRunGoverning:follow[i].governing?"1":"0"}},
      h(doc,"span",{class:"mono",text:l.runId})," ",l.status?statusPill(ctx,l.status):h(doc,"span",{class:"note",text:ctx.t("taskruns.statusUnknown")})," ",h(doc,"time",{text:formatDateTime(l.linkedAt,lang)}),
      followNote(ctx,follow[i]))));
  }
  let form=null;
  if(linked.state==="VERIFIED"){
    const opts=runsRes?.state==="VERIFIED"?linkableRuns(runsRes.items,linked.items):[];
    if(task.status==="DONE")form=h(doc,"p",{class:"note",role:"status",dataset:{taskrunsNote:"done"},text:ctx.t("taskruns.doneNote")});
    else if(runsRes?.state!=="VERIFIED")form=h(doc,"p",{class:"note",role:"status",dataset:{taskrunsNote:"runsUnknown"},text:ctx.t("taskruns.runsUnknown")});
    else if(!opts.length)form=h(doc,"p",{class:"note",role:"status",dataset:{taskrunsNote:"noUnlinked"},text:ctx.t("taskruns.noUnlinked")});
    else{
      if(!opts.some(o=>o.runId===taskRunsDraft.runId))taskRunsDraft.runId=opts[0].runId;
      const busy=drafts.busy[TASK_RUNS_FORM]===true;
      form=h(doc,"div",{},
        field(ctx,{id:"taskruns-run",labelKey:"taskruns.pick",value:taskRunsDraft.runId,onInput:v=>{taskRunsDraft.runId=v},hintKey:"taskruns.pickHint",
          options:opts.map(o=>({value:o.runId,label:`${o.runId} · ${o.status}`}))}),
        h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"taskruns-submit",dataset:{focusKey:"taskruns-submit"},disabled:busy,text:ctx.t("taskruns.link"),
          on:{click:()=>{if(!drafts.busy[TASK_RUNS_FORM])submitLinkRun(ctx,task,taskRunsDraft.runId)}}})));
    }
  }
  return h(doc,"div",{class:"task-runs",id:"task-runs",role:"region","aria-label":ctx.t("taskruns.title"),dataset:{taskRunsFor:task.taskId}},
    h(doc,"h5",{text:ctx.t("taskruns.title")}),h(doc,"p",{class:"note",text:ctx.t("taskruns.lead")}),list,form,statusBlock(ctx,TASK_RUNS_FORM));
}
