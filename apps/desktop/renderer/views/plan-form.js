// //TR: Bu görünüm parçası Görevler > mission ayrıntısındaki "Görevleri planla" formudur (LANE-A first-delivery): Kurucu sıralı görev başlıkları ve isteğe bağlı bağımlılıkları (yalnız önceki satır numaraları) girer, POST /v1/missions/:id/plan ile kaydedilir. Görev ÜRETİLMEZ: yalnız kullanıcının yazdığı satırlar gönderilir; uç nokta masaüstü allow-list'inde yoksa sunucu/köprü reddi dürüstçe gösterilir. Plan görevleri çalıştırmaz; koşu ayrı eylemdir.
import {h,panel} from "../components.js";
import {drafts,statusBlock,setStatus,recordPost,focusResult} from "../forms.js";
import {buildPlanRequest,canPlan,PLAN_MAX_TASKS} from "../work-core.js";

export const PLAN_FORM="mission-plan";
const KEYS=["id:plan-submit","id:plan-t"];
// Taslak yalnız oturum içidir ve mission değişince sıfırlanır; son sonuç (başarı/satır hataları) da mission'a bağlıdır, başka mission'a taşınmaz.
export const planDraft={missionId:null,rows:[{title:"",deps:""}]};
export function resetPlanDraft(missionId=null){planDraft.missionId=missionId;planDraft.rows=[{title:"",deps:""}]}
// Başarılı gönderimden sonra aynı mission'da resetPlanDraft çağrılır ve başarı mesajı korunur; durum yalnız mission DEĞİŞİNCE silinir (task-status.js resetTaskStatusDraft örüntüsü).
function scopePlanDraft(missionId){resetPlanDraft(missionId);delete drafts.status[PLAN_FORM]}

export async function submitPlan(ctx,missionId){
  const req=buildPlanRequest({missionId,rows:planDraft.rows});
  if(!req.ok){setStatus(PLAN_FORM,{ok:false,errors:req.errors});drafts.status[PLAN_FORM].rowErrors=req.rowErrors;await ctx.rerender();focusResult(ctx,PLAN_FORM,KEYS);return {ok:false,validation:true}}
  drafts.busy[PLAN_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[PLAN_FORM]=false}
  const ok=recordPost(PLAN_FORM,res,"plan.created",{n:String(req.body.tasks.length)});
  if(ok)resetPlanDraft(missionId);
  await ctx.refreshAll({force:true});focusResult(ctx,PLAN_FORM,KEYS);return {ok,status:res?.status??null};
}
/** Yalnız planlanabilir durumdaki ve görevi olmayan mission için form; aksi halde null. */
export function planFormPanel(ctx,mission){
  if(!canPlan(mission.status,mission.tasks.length))return null;
  const doc=ctx.doc;
  if(planDraft.missionId!==mission.missionId)scopePlanDraft(mission.missionId);
  const st=drafts.status[PLAN_FORM],rowErrors=st?.rowErrors??{},rows=planDraft.rows;
  const list=h(doc,"ol",{class:"list-editor plan-rows",id:"plan-rows"});
  const paint=focusId=>{
    list.replaceChildren(...rows.map((r,i)=>{
      const tid=`plan-title-${i}`,did=`plan-deps-${i}`;
      const title=h(doc,"input",{type:"text",id:tid,autocomplete:"off",spellcheck:"false","aria-label":ctx.t("plan.titleN",{n:i+1}),"aria-invalid":rowErrors[i]?"true":null,dataset:{focusKey:tid}});
      title.value=r.title;title.addEventListener("input",()=>{r.title=title.value});
      const deps=h(doc,"input",{type:"text",id:did,autocomplete:"off",spellcheck:"false","aria-label":ctx.t("plan.depsN",{n:i+1}),placeholder:ctx.t("plan.depsPh"),dataset:{focusKey:did}});
      deps.value=r.deps;deps.addEventListener("input",()=>{r.deps=deps.value});
      const rm=h(doc,"button",{type:"button",class:"btn btn-small",id:`plan-rm-${i}`,"aria-label":ctx.t("plan.removeN",{n:i+1}),dataset:{focusKey:`plan-rm-${i}`},text:"✕",
        on:{click:()=>{rows.splice(i,1);if(!rows.length)rows.push({title:"",deps:""});paint(`plan-title-${Math.min(i,rows.length-1)}`)}}});
      return h(doc,"li",{},h(doc,"span",{class:"mono",text:`${i+1}.`})," ",title," ",deps," ",rm,rowErrors[i]?h(doc,"p",{class:"field-error",id:`plan-err-${i}`,text:ctx.t(rowErrors[i])}):null);
    }));
    if(focusId){const n=doc.getElementById?.(focusId);if(n&&n.focus)n.focus()}
  };
  paint(null);
  const add=h(doc,"button",{type:"button",class:"btn",id:"plan-add",dataset:{focusKey:"plan-add"},disabled:rows.length>=PLAN_MAX_TASKS,text:ctx.t("plan.add"),on:{click:()=>{if(rows.length<PLAN_MAX_TASKS){rows.push({title:"",deps:""});paint(`plan-title-${rows.length-1}`)}}}});
  const form=h(doc,"form",{id:"plan-form",novalidate:true,"aria-labelledby":"plan-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[PLAN_FORM])submitPlan(ctx,mission.missionId)}}},
    h(doc,"p",{class:"note",text:ctx.t("plan.lead")}),list,h(doc,"div",{class:"btn-row"},add),statusBlock(ctx,PLAN_FORM),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"plan-submit",dataset:{focusKey:"plan-submit"},disabled:drafts.busy[PLAN_FORM]===true,text:ctx.t("plan.submit")})));
  return panel(ctx,{titleKey:"plan.title",id:"mission-plan-panel"},form);
}
