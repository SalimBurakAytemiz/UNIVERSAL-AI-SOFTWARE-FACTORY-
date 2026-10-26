// //TR: Bu görünüm parçası Görevler > mission ayrıntısındaki "koşuyu görevlere bağla" adımıdır (LANE-A A-RUN-TASK-LINK): bir koşu BAŞARIYLA başlatıldıktan sonra mission'ın DONE olmayan görevlerini işaret kutularıyla listeler. Hepsi işaretsiz başlar; hangi görevlerin bu koşuyla yürütüldüğüne YALNIZ Founder karar verir, hiçbir şey çıkarım yoluyla seçilmez. İşaretli her görev için mevcut ve zaten izinli POST /v1/tasks/:id/runs {runId} çağrılır; görev başına sonuç (bağlandı / zaten bağlı / reddedildi + sunucunun hata kodu) gösterilir ve kısmi başarısızlık görünür kalır. Başarısız görev kendiliğinden yeniden denenmez. Bağ yalnız kayıt tutar: koşu başlatmaz, görevi ilerletmez. API verisi yalnız h()/textContent ile yazılır.
import {h,statusPill} from "../components.js";
import {MISSING} from "../model.js";
import {drafts,statusBlock} from "../forms.js";
import {linkableTasks} from "../work-core.js";
import {runLinkStatusId,toggleRunLinkTask,submitRunLinks,dismissRunLink} from "../work-actions.js";

const DONE_KINDS=Object.freeze(["LINKED","ALREADY_LINKED"]);
/** Görev başına sonuç metni; sunucunun hata kodu/gerekçesi AYNEN taşınır. */
function resultText(ctx,r){
  if(r.kind==="REFUSED")return ctx.t("runlink.result.REFUSED",{code:r.code,status:r.status});
  if(r.kind==="DENIED")return ctx.t("runlink.result.DENIED",{reason:r.reason});
  if(r.kind==="FAILED")return ctx.t(r.key,r.vars);
  return ctx.t(`runlink.result.${r.kind}`);
}
/** mission: mapMissionDetail görevleriyle. Teklif bu mission için değilse hiçbir şey çizilmez. */
export function runLinkPanel(ctx,mission){
  const doc=ctx.doc,st=drafts.runLink;
  if(st.missionId!==mission.missionId)return null;
  const sid=runLinkStatusId(mission.missionId),busy=drafts.busy[sid]===true;
  const wrap=body=>h(doc,"div",{class:"run-link",id:"run-link",role:"region","aria-label":ctx.t("runlink.title"),dataset:{runLink:mission.missionId,runId:st.runId??""}},
    h(doc,"h4",{text:ctx.t("runlink.title")}),body);
  const close=h(doc,"button",{type:"button",class:"btn",id:"runlink-close",dataset:{focusKey:"runlink-close"},disabled:busy,text:ctx.t("runlink.close"),on:{click:()=>{if(!drafts.busy[sid])dismissRunLink(ctx)}}});
  if(st.runId===null)return wrap([h(doc,"p",{class:"note",role:"status",dataset:{runlink:"unreadable"},text:ctx.t("runlink.unreadable")}),h(doc,"div",{class:"btn-row"},close)]);
  const tasks=linkableTasks(mission.tasks);
  const lead=h(doc,"p",{class:"note",dataset:{runlink:"lead"},text:ctx.t("runlink.lead",{runId:st.runId})});
  if(!tasks.length)return wrap([lead,h(doc,"p",{class:"note note-empty",role:"status",dataset:{runlink:"none"},text:ctx.t("runlink.noTasks")}),h(doc,"div",{class:"btn-row"},close)]);
  const items=tasks.map(t=>{
    const r=st.results[t.taskId]??null,locked=r!==null&&DONE_KINDS.includes(r.kind),cbId=`runlink-cb-${t.taskId}`;
    const cb=h(doc,"input",{type:"checkbox",id:cbId,disabled:busy||locked,checked:st.checked[t.taskId]===true?true:null,dataset:{focusKey:cbId,runlinkTask:t.taskId},on:{change:e=>{toggleRunLinkTask(t.taskId,e?.target?.checked===true)}}});
    return h(doc,"li",{class:"card run-link-task",dataset:{runlinkItem:t.taskId,runlinkState:r?r.kind:"IDLE"}},
      h(doc,"label",{for:cbId},cb," ",h(doc,"span",{text:t.title})),
      " ",t.status===MISSING?h(doc,"span",{class:"note",text:MISSING}):statusPill(ctx,t.status)," ",h(doc,"span",{class:"mono",text:t.taskId}),
      r?h(doc,"p",{class:`note${DONE_KINDS.includes(r.kind)?"":" note-error"}`,role:"status",dataset:{runlinkResult:r.kind},text:resultText(ctx,r)}):null);
  });
  const results=Object.values(st.results),linked=results.filter(r=>DONE_KINDS.includes(r.kind)).length,notLinked=results.length-linked;
  return wrap([lead,
    h(doc,"ul",{class:"cards run-link-list","aria-label":ctx.t("runlink.pick")},items),
    results.length?h(doc,"p",{class:"note",role:"status",dataset:{runlink:"summary",linked:String(linked),notLinked:String(notLinked)},text:ctx.t("runlink.summary",{linked,notLinked})}):null,
    h(doc,"div",{class:"btn-row"},
      h(doc,"button",{type:"button",class:"btn btn-primary",id:"runlink-submit",dataset:{focusKey:"runlink-submit"},disabled:busy,text:ctx.t("runlink.submit"),on:{click:()=>{if(!drafts.busy[sid])submitRunLinks(ctx,mission)}}}),close),
    statusBlock(ctx,sid)]);
}
