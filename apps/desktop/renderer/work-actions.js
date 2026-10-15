// //TR: Bu modül Founder'ın tetiklediği yazma eylemlerini (mission durum geçişi, koşu başlatma) tek yerde toplar: istek work-core kurucusuyla doğrulanır, yüksek riskli geçişler (AUTHORIZED, COMPLETE) erişilebilir onay penceresi olmadan gönderilmez, sonuç dürüstçe sınıflanır (409 EXECUTOR_NOT_CONFIGURED, 423 GLOBAL_STOP_ACTIVE, 503) ve hiçbir eylem kullanıcı tıklaması dışında çalışmaz.
import {buildTransitionRequest,buildRunRequest,requiresConfirm,describePostResult} from "./work-core.js";
import {drafts,setStatus,focusStatus} from "./forms.js";
import {statusLabel} from "./components.js";

export const actionStatusId=missionId=>`act-${missionId}`;

/** Geçişi doğrular, gerekirse onay ister, POST eder ve sonucu drafts.status[statusId] içine yazar. */
export async function performTransition(ctx,{missionId,title,from,to,reason,statusId=actionStatusId(missionId)}){
  const probe=buildTransitionRequest({missionId,from,to,reason,confirmed:true});
  if(!probe.ok){setStatus(statusId,{ok:false,errors:probe.errors});await ctx.rerender();focusStatus(ctx.doc,statusId);return {ok:false,validation:true}}
  let confirmed;
  if(requiresConfirm(to)){
    const yes=await ctx.confirm({title:ctx.t("confirm.transition.title",{to:statusLabel(ctx,to)}),body:ctx.t("confirm.transition.body",{from:statusLabel(ctx,from),to:statusLabel(ctx,to)}),
      action:ctx.t("confirm.transition.action",{from:statusLabel(ctx,from),to:statusLabel(ctx,to)}),target:`${title} (${missionId})`,confirmLabel:ctx.t("confirm.transition.ok",{to:statusLabel(ctx,to)})});
    if(yes!==true){setStatus(statusId,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusStatus(ctx.doc,statusId);return {ok:false,cancelled:true}}
    confirmed=true;
  }
  const req=buildTransitionRequest({missionId,from,to,reason,confirmed});
  if(!req.ok){setStatus(statusId,{ok:false,errors:req.errors});await ctx.rerender();focusStatus(ctx.doc,statusId);return {ok:false,validation:true}}
  drafts.busy[statusId]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[statusId]=false}
  const d=describePostResult(res);
  setStatus(statusId,{ok:d.ok,key:d.ok?"transition.done":d.key,vars:d.ok?{to:statusLabel(ctx,to)}:d.vars,errors:null});
  if(d.ok)delete drafts.reasons[missionId];
  await ctx.refreshAll({force:true});focusStatus(ctx.doc,statusId);return {ok:d.ok,status:res?.status??null};
}
/** Koşu başlatır (mission AUTHORIZED veya PLANNED olmalı); sunucu 409 EXECUTOR_NOT_CONFIGURED veya 423 dönerse açık mesaj gösterilir. */
export async function startRun(ctx,{missionId,status,statusId=actionStatusId(missionId)}){
  const req=buildRunRequest({missionId,status});
  if(!req.ok){setStatus(statusId,{ok:false,errors:req.errors});await ctx.rerender();focusStatus(ctx.doc,statusId);return {ok:false,validation:true}}
  drafts.busy[statusId]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[statusId]=false}
  const d=describePostResult(res);
  setStatus(statusId,{ok:d.ok,key:d.ok?"run.startAccepted":d.key,vars:d.ok?{}:d.vars,errors:null});
  await ctx.refreshAll({force:true});focusStatus(ctx.doc,statusId);return {ok:d.ok,status:res?.status??null};
}
