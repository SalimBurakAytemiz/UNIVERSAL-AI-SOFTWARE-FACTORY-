// //TR: Bu görünüm parçası Görevler > mission ayrıntısındaki "Değişiklik iste" akışıdır (UASCO-T0017.A alternatifi; akıllı revizyon motoru UASCO-T0017.C henüz yok). Onay bekleyen (AWAITING_APPROVAL) bir koşusu olan REPORTING mission'ı için Founder ne değişmesi gerektiğini yazar; YALNIZ mevcut ve izinli POST /v1/missions/:id/transition {to:"BLOCKED",reason} kullanılır (sunucu durum makinesinde REPORTING'den Founder'ın gidebileceği tek geri dönüş BLOCKED'dır; REMEDIATING yalnız koşucunun iç geçişidir). Gerekçe koşu kimliğiyle birlikte kaydedilir (sunucu denetim kaydı). Gönderim açık onay penceresinin arkasındadır; pencere açıkken kilit tutulur; vazgeçilirse ya da onay işlevi yoksa hiçbir istek gitmez. Hiçbir yeniden çalışma otomatik başlatılmaz ve bu açıkça söylenir. API verisi yalnız h()/textContent ile yazılır.
import {h,statusLabel} from "../components.js";
import {drafts,field,statusBlock,setStatus,focusResult} from "../forms.js";
import {performTransition} from "../work-actions.js";
import {allowedNext,MISSION_ID_RE} from "../work-core.js";

export const RC_MAX=4000;
export const rcStatusId=missionId=>`rc-${missionId}`;
/** Taslak yalnız oturum içidir; mission ya da koşu değişince sıfırlanır. last: son başarılı istek (mission'a bağlı) gösterim için. */
export const rcDraft={missionId:null,runId:null,text:"",last:null};
export function resetRequestChanges(){rcDraft.missionId=null;rcDraft.runId=null;rcDraft.text="";rcDraft.last=null}

/** Saf: mission + koşu okumasından hedef koşu. {state:"OFFER",runId} | {state:"RUNS_UNKNOWN"} | {state:"NONE"}. */
export function requestChangesTarget(mission,runsRes){
  if(!mission||mission.status!=="REPORTING"||!allowedNext("REPORTING").includes("BLOCKED"))return {state:"NONE"};
  if(!runsRes||runsRes.state!=="VERIFIED")return {state:"RUNS_UNKNOWN"};
  const r=(runsRes.items??[]).find(x=>x&&x.missionId===mission.missionId&&x.status==="AWAITING_APPROVAL");
  return r?{state:"OFFER",runId:r.runId}:{state:"NONE"};
}
/** Saf: kaydedilecek gerekçe. Boş ya da sınır aşımı hatadır; koşu kimliği gerekçeye yazılır (denetim kaydında hangi koşu için istendiği görünür). */
export function buildRequestChangesReason(runId,text){
  const t=typeof text==="string"?text.trim():"";
  if(!t)return {ok:false,error:"rc.err.required"};
  const reason=`Changes requested for run ${runId}: ${t}`;
  if(reason.length>RC_MAX)return {ok:false,error:"rc.err.long"};
  return {ok:true,reason};
}
export async function submitRequestChanges(ctx,mission,runId){
  const sid=rcStatusId(mission.missionId),keys=["id:rc-submit","id:rc-text"];
  if(drafts.busy[sid]===true)return {ok:false,busy:true};
  const r=buildRequestChangesReason(runId,rcDraft.text);
  if(!r.ok){setStatus(sid,{ok:false,errors:{reason:r.error}});await ctx.rerender();focusResult(ctx,sid,keys);return {ok:false,validation:true}}
  drafts.busy[sid]=true;let yes=false;
  try{yes=typeof ctx.confirm==="function"?(await ctx.confirm({title:ctx.t("rc.confirm.title"),body:ctx.t("rc.confirm.body"),action:ctx.t("rc.confirm.action",{run:runId}),target:`${mission.title} (${mission.missionId})`,confirmLabel:ctx.t("rc.confirm.ok")}))===true:false}
  finally{drafts.busy[sid]=false}
  if(rcDraft.missionId!==mission.missionId){await ctx.rerender();return {ok:false,stale:true}}
  if(!yes){setStatus(sid,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,sid,keys);return {ok:false,cancelled:true}}
  const res=await performTransition(ctx,{missionId:mission.missionId,title:mission.title,from:mission.status,to:"BLOCKED",reason:r.reason,statusId:sid});
  // performTransition yeniden çizimi sonucu kaydetmeden önce yapar: kayıt notu görünsün diye başarıdan sonra bir kez daha çizilir (yalnız sunucu 2xx dediyse).
  if(res.ok){rcDraft.last={missionId:mission.missionId,runId,reason:r.reason};rcDraft.text="";await ctx.rerender()}
  return res;
}
/** Bağlanma noktası (work.js detay paneli): mission + koşu okuması. Teklif yoksa ve son kayıt da yoksa null. */
export function requestChangesPanel(ctx,mission,runsRes){
  const doc=ctx.doc;
  if(!mission||!MISSION_ID_RE.test(String(mission.missionId)))return null;
  const tg=requestChangesTarget(mission,runsRes),sid=rcStatusId(mission.missionId);
  if(rcDraft.missionId!==mission.missionId||(tg.state==="OFFER"&&rcDraft.runId!==tg.runId)){const last=rcDraft.last?.missionId===mission.missionId?rcDraft.last:null;resetRequestChanges();rcDraft.missionId=mission.missionId;rcDraft.runId=tg.runId??null;rcDraft.last=last}
  const wrap=(...c)=>h(doc,"div",{class:"request-changes",id:"request-changes",role:"region","aria-label":ctx.t("rc.title"),dataset:{rcState:tg.state,rcMission:mission.missionId}},h(doc,"h4",{text:ctx.t("rc.title")}),...c);
  const recorded=rcDraft.last&&rcDraft.last.missionId===mission.missionId?h(doc,"div",{class:"note",role:"status",id:"rc-recorded",dataset:{rcRecorded:rcDraft.last.runId}},
    h(doc,"p",{text:ctx.t("rc.recorded",{status:statusLabel(ctx,mission.status)})}),h(doc,"p",{class:"mono",text:rcDraft.last.reason}),h(doc,"p",{text:ctx.t("rc.recorded.next")})):null;
  if(tg.state==="NONE")return recorded?wrap(recorded,statusBlock(ctx,sid)):null;
  if(tg.state==="RUNS_UNKNOWN")return wrap(h(doc,"p",{class:"note note-unknown",role:"status",dataset:{rcNote:"runsUnknown"},text:ctx.t("rc.runsUnknown")}));
  const busy=drafts.busy[sid]===true;
  return wrap(
    h(doc,"p",{class:"note",text:ctx.t("rc.lead",{run:tg.runId})}),
    h(doc,"p",{class:"note",dataset:{rcHonest:"1"},text:ctx.t("rc.honest")}),
    field(ctx,{id:"rc-text",labelKey:"rc.field",value:rcDraft.text,onInput:v=>{rcDraft.text=v},hintKey:"rc.hint",multiline:true,required:true}),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"rc-submit",dataset:{focusKey:"rc-submit",rcRun:tg.runId},disabled:busy,text:ctx.t("rc.submit"),
      on:{click:()=>{if(drafts.busy[sid]!==true)submitRequestChanges(ctx,mission,tg.runId)}}})),
    statusBlock(ctx,sid),recorded);
}
