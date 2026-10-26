// //TR: Bu modül Founder'ın tetiklediği yazma eylemlerini (mission durum geçişi, koşu başlatma) tek yerde toplar: istek work-core kurucusuyla doğrulanır, yüksek riskli geçişler (AUTHORIZED, COMPLETE) erişilebilir onay penceresi olmadan gönderilmez, sonuç dürüstçe sınıflanır (409 EXECUTOR_NOT_CONFIGURED, 423 GLOBAL_STOP_ACTIVE, 503) ve hiçbir eylem kullanıcı tıklaması dışında çalışmaz.
import {buildTransitionRequest,buildRunRequest,requiresConfirm,describePostResult,parseStartedRun,linkableTasks,buildLinkRunRequest,classifyLinkResult} from "./work-core.js";
import {drafts,freshRunLink,setStatus,focusStatus,focusResult} from "./forms.js";
import {statusLabel} from "./components.js";

export const actionStatusId=missionId=>`act-${missionId}`;

/** Geçişi doğrular, gerekirse onay ister, POST eder ve sonucu drafts.status[statusId] içine yazar.
 *  D-M1A-STATE-MODEL-2026-10-15: geçişlerde onay nesnesi yoktur; COMPLETE yalnız sunucunun PRODUCT_VERIFIED kanıt kapısıyla olur (masaüstü onu yalnız PRODUCT_VERIFIED koşuda sunar). */
export async function performTransition(ctx,{missionId,title,from,to,reason,statusId=actionStatusId(missionId)}){
  const keys=[`id:tr-${to}`,`id:ib-${to}-${missionId}`];
  const probe=buildTransitionRequest({missionId,from,to,reason,confirmed:true});
  if(!probe.ok){setStatus(statusId,{ok:false,errors:probe.errors});await ctx.rerender();focusResult(ctx,statusId,keys);return {ok:false,validation:true}}
  let confirmed;
  if(requiresConfirm(to)){
    const body=ctx.t("confirm.transition.body",{from:statusLabel(ctx,from),to:statusLabel(ctx,to)});
    const yes=await ctx.confirm({title:ctx.t("confirm.transition.title",{to:statusLabel(ctx,to)}),body,
      action:ctx.t("confirm.transition.action",{from:statusLabel(ctx,from),to:statusLabel(ctx,to)}),target:`${title} (${missionId})`,confirmLabel:ctx.t("confirm.transition.ok",{to:statusLabel(ctx,to)})});
    if(yes!==true){setStatus(statusId,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,statusId,keys);return {ok:false,cancelled:true}}
    confirmed=true;
  }
  const req=buildTransitionRequest({missionId,from,to,reason,confirmed});
  if(!req.ok){setStatus(statusId,{ok:false,errors:req.errors});await ctx.rerender();focusResult(ctx,statusId,keys);return {ok:false,validation:true}}
  drafts.busy[statusId]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[statusId]=false}
  const d=describePostResult(res);
  setStatus(statusId,{ok:d.ok,key:d.ok?"transition.done":d.key,vars:d.ok?{to:statusLabel(ctx,to)}:d.vars,errors:null});
  if(d.ok)delete drafts.reasons[missionId];
  await ctx.refreshAll({force:true});focusResult(ctx,statusId,keys);return {ok:d.ok,status:res?.status??null};
}
/** Koşu başlatır (mission AUTHORIZED veya PLANNED olmalı); sunucu 409 EXECUTOR_NOT_CONFIGURED veya 423 dönerse açık mesaj gösterilir. */
export async function startRun(ctx,{missionId,status,roleId,statusId=actionStatusId(missionId)}){
  const req=buildRunRequest({missionId,status,roleId});
  if(!req.ok){setStatus(statusId,{ok:false,errors:req.errors});await ctx.rerender();focusStatus(ctx.doc,statusId);return {ok:false,validation:true}}
  drafts.busy[statusId]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[statusId]=false}
  const d=describePostResult(res);
  setStatus(statusId,{ok:d.ok,key:d.ok?"run.startAccepted":d.key,vars:d.ok?{}:d.vars,errors:null});
  // //TR: A-RUN-TASK-LINK: başarılı başlatmadan sonra "koşuyu görevlere bağla" adımı sunulur; koşu kimliği yalnız yanıtta okunabiliyorsa (yoksa adım yerine dürüst not). Hiçbir görev kendiliğinden seçilmez ve hiçbir bağ burada kurulmaz.
  if(d.ok){const runId=parseStartedRun(res,missionId);drafts.runLink={...freshRunLink(),missionId,runId}}
  await ctx.refreshAll({force:true});focusStatus(ctx.doc,statusId);return {ok:d.ok,status:res?.status??null};
}
export const runLinkStatusId=missionId=>`runlink-${missionId}`;
/** Bağ adımını kapatır (hiçbir istek göndermez). */
export async function dismissRunLink(ctx){drafts.runLink=freshRunLink();await ctx.rerender()}
/** Bir görevin seçimini değiştirir (yalnız bellek; varsayılan hepsi seçilmemiş). */
export function toggleRunLinkTask(taskId,checked){if(checked===true)drafts.runLink.checked[taskId]=true;else delete drafts.runLink.checked[taskId]}
/**
 * Seçili görevleri sırayla POST /v1/tasks/:id/runs {runId} ile koşuya bağlar. Seçim yoksa istek GÖNDERİLMEZ. Zaten bağlanmış görev yeniden gönderilmez;
 * başarısız görev kendiliğinden yeniden denenmez (Founder yeniden tıklarsa denenir). Global Stop ya da izin listesi yokluğu görülürse kalan görevler DENENMEZ ve öyle gösterilir.
 */
export async function submitRunLinks(ctx,mission){
  const st=drafts.runLink,sid=runLinkStatusId(mission.missionId);
  if(st.missionId!==mission.missionId||st.runId===null)return {ok:false,validation:true};
  const open=linkableTasks(mission.tasks),pending=open.filter(t=>st.checked[t.taskId]===true&&st.results[t.taskId]?.kind!=="LINKED"&&st.results[t.taskId]?.kind!=="ALREADY_LINKED");
  if(!pending.length){setStatus(sid,{ok:false,key:"runlink.noneChecked",vars:{},errors:null});await ctx.rerender();focusStatus(ctx.doc,sid);return {ok:false,validation:true,posted:0}}
  delete drafts.status[sid];
  drafts.busy[sid]=true;
  let posted=0,halted=false;
  try{
    for(const t of pending){
      if(halted){st.results[t.taskId]={kind:"NOT_ATTEMPTED"};continue}
      const req=buildLinkRunRequest({taskId:t.taskId,runId:st.runId,taskStatus:t.status}); // kimlikler yukarıda doğrulanmıştır (linkableTasks, parseStartedRun)
      posted+=1;
      const res=await ctx.api.post(req.path,req.body);
      const c=classifyLinkResult(res,t.taskId,st.runId);
      st.results[t.taskId]=c;
      if(c.kind==="STOPPED"||(res&&res.thrown))halted=true;
    }
  }finally{drafts.busy[sid]=false}
  await ctx.refreshAll({force:true});focusStatus(ctx.doc,sid);
  return {ok:pending.every(t=>["LINKED","ALREADY_LINKED"].includes(st.results[t.taskId]?.kind)),posted};
}
