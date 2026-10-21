// //TR: Bu görünüm parçası Project Studio > Genel Bakış'taki "İlk teslim akışı" göstergesidir: GET /v1/projects/:id/flow okumasını (MISSION, PLAN, RUN, REVIEW, DELIVERY) sıralı adımlar olarak gösterir; durum rengin yanı sıra metin etiketidir. Uç nokta henüz masaüstü allow-list'inde yoksa ya da okuma başarısızsa dürüst UNAVAILABLE/ERROR gösterilir; DONE yalnız sunucunun bildirdiği değerdir ve ürün doğrulandı anlamına gelmez.
import {h,panel,stateNote,badge} from "../components.js";
import {flowPath,mapFlow} from "../project-core.js";

const KIND={DONE:"badge-notverified",BLOCKED:"badge-risk",FAILED:"badge-risk"};
export async function flowPanel(ctx,projectId){
  const doc=ctx.doc,path=flowPath(projectId);
  const res=path?await ctx.api.raw(path):{ok:false,state:"ERROR"};
  const mapped=res.ok?mapFlow(res.data):{state:res.state,flow:null};
  const id="studio-ov-flow";
  if(mapped.state!=="VERIFIED")return panel(ctx,{titleKey:"flow.title",id},h(doc,"p",{class:"note",text:ctx.t("flow.lead")}),stateNote(ctx,mapped.state,mapped.state==="UNAVAILABLE"?"flow.unavailable":undefined));
  const f=mapped.flow;
  const counts=[f.missionCount!==null?ctx.t("flow.missions",{n:String(f.missionCount)}):null,f.taskCount!==null?ctx.t("flow.tasks",{n:String(f.taskCount)}):null].filter(Boolean).join(" · ");
  return panel(ctx,{titleKey:"flow.title",id},h(doc,"p",{class:"note",text:ctx.t("flow.lead")}),
    h(doc,"ol",{class:"flow-steps","aria-label":ctx.t("flow.title")},f.stages.map((s,i)=>h(doc,"li",{class:"flow-step",dataset:{flowStage:s.stage,flowState:s.state}},
      h(doc,"strong",{text:`${i+1}. ${ctx.t(`flow.stage.${s.stage}`)}`})," ",
      KIND[s.state]?badge(ctx,ctx.t(`flow.state.${s.state}`),KIND[s.state]):badge(ctx,ctx.t(`flow.state.${s.state}`)),
      s.detail?h(doc,"span",{class:"note mono",text:` ${s.detail}`}):null))),
    counts?h(doc,"p",{class:"note",dataset:{flowCounts:"1"},text:counts}):null,
    f.taskRuns===undefined?null:h(doc,"p",{class:"note",dataset:{flowTaskRuns:f.taskRuns===null?"UNKNOWN":"KNOWN"},text:f.taskRuns===null?ctx.t("flow.taskRuns.unknown"):ctx.t("flow.taskRuns",{with:String(f.taskRuns.tasksWithRuns),total:String(f.taskRuns.tasks)})}),
    h(doc,"p",{class:"note",text:ctx.t("flow.doneNote")}));
}
