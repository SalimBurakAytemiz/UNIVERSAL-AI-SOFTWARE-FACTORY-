// //TR: Bu görünüm parçası Projeler ekranındaki "Fikirden başla" (Proje Intake, UI-126) panelidir: Kurucu serbest metin proje fikrini (ve isteğe bağlı başlık/tür/teknoloji/hedef işletim sistemi/kabul kriteri/risk/test komutu) yazar, POST /v1/intakes tek adımda projeyi ve ilk mission'ı oluşturur; sonuçta her alanın kaynağı (Kurucu / varsayılan / fikirden türetilmiş) açıkça gösterilir. Önceki intake'ler GET /v1/intakes ile listelenir; uç nokta masaüstü allow-list'inde yoksa dürüst UNAVAILABLE gösterilir. Görev üretilmez, koşu başlatılmaz. COORD-INTAKE-TEMPLATE: başlangıç şablonu (varsayılan web-node) seçilir; proje yönetilen başlangıç deposuyla kurulur ve sonuç kartı deponun ve test komutunun kaynağını dürüstçe gösterir (sandbox/doğrulama iddiası yok).
import {h,panel,stateNote,emptyNote,badge} from "../components.js";
import {drafts,selection,field,listEditor,statusBlock,setStatus,recordPost,focusResult,settle} from "../forms.js";
import {createIdempotencyTracker} from "../work-core.js";
import {studio,openProject} from "../studio-state.js";
import {buildIntakeRequest,mapIntake,mapIntakes,INTAKES_PATH,INTAKE_PROJECT_TYPES,INTAKE_OS,INTAKE_RISKS} from "../intake-core.js";
import {TEMPLATES} from "../project-core.js";

export const INTAKE_FORM="intake";
const KEYS=["id:intake-submit","id:intake-t"];
// İlk teslim varsayılanı web-node: proje çalıştırılabilir bir başlangıç deposu ve test komutuyla doğar ("" seçilirse eski şablonsuz yol).
const fresh=()=>({idea:"",title:"",template:"web-node",projectType:"",techStack:[""],targetOS:[],acceptanceCriteria:[""],riskLevel:"",testCommand:[""]});
export const intakeDraft=fresh();
export const intakeUi={open:false,last:null};
const tracker=createIdempotencyTracker();
export function resetIntake(){Object.assign(intakeDraft,fresh());tracker.reset()}
export function resetIntakeAll(){resetIntake();intakeUi.open=false;intakeUi.last=null}
const input=()=>({idea:intakeDraft.idea,title:intakeDraft.title,template:intakeDraft.template,projectType:intakeDraft.projectType,techStack:intakeDraft.techStack,targetOS:intakeDraft.targetOS,acceptanceCriteria:intakeDraft.acceptanceCriteria,riskLevel:intakeDraft.riskLevel,testCommand:intakeDraft.testCommand});

export async function submitIntake(ctx){
  const check=buildIntakeRequest(input());
  if(!check.ok){setStatus(INTAKE_FORM,{ok:false,errors:check.errors});await ctx.rerender();focusResult(ctx,INTAKE_FORM,KEYS);return {ok:false,validation:true}}
  const key=tracker.keyFor(check.body),req=buildIntakeRequest(input(),{key});
  drafts.busy[INTAKE_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[INTAKE_FORM]=false}
  const ok=recordPost(INTAKE_FORM,res,"intake.created",{title:res?.body?.intake?.title??check.body.title??""});
  if(ok){
    // Başarı yalnız sunucunun geçerli kaydıyla "oluşturuldu" gösterilir; kayıt bozuksa kısayol sunulmaz.
    const rec=mapIntake(res?.body?.intake);
    if(rec){intakeUi.last=rec;resetIntake()}
  }
  await ctx.refreshAll({force:true});focusResult(ctx,INTAKE_FORM,KEYS);return {ok};
}
const srcBadge=(ctx,s)=>badge(ctx,ctx.t(`intake.source.${s}`),s==="FOUNDER"?"":"badge-notverified");
function resultCard(ctx,rec){
  const doc=ctx.doc;
  return h(doc,"div",{class:"card",id:"intake-result",dataset:{intakeId:rec.intakeId}},
    h(doc,"h3",{text:rec.title}),
    h(doc,"dl",{class:"kv"},
      h(doc,"dt",{text:ctx.t("intake.res.title")}),h(doc,"dd",{},srcBadge(ctx,rec.sources.title)),
      h(doc,"dt",{text:ctx.t("intake.res.criteria")}),h(doc,"dd",{},srcBadge(ctx,rec.sources.acceptanceCriteria)," ",h(doc,"span",{text:ctx.t("intake.res.criteriaN",{n:String(rec.acceptanceCriteria.length)})})),
      h(doc,"dt",{text:ctx.t("intake.res.risk")}),h(doc,"dd",{},srcBadge(ctx,rec.sources.riskLevel)," ",h(doc,"span",{class:"mono",text:rec.riskLevel})),
      // Depo satırı yalnız sunucu kaydındaki repository bloğundan gelir; blok yoksa REPOSITORY_NOT_CONFIGURED notu gösterilir (başarı uydurulmaz).
      h(doc,"dt",{text:ctx.t("intake.res.repository")}),h(doc,"dd",{id:"intake-res-repo",text:rec.repository?ctx.t("intake.res.repo.template",{template:ctx.t(`studio.template.${rec.repository.template}`)}):ctx.t("intake.res.repo.none")}),
      rec.repository?h(doc,"dt",{text:ctx.t("intake.res.testSource")}):null,rec.repository?h(doc,"dd",{id:"intake-res-test",dataset:{testSource:rec.repository.testCommandSource},text:ctx.t(`intake.res.test.${rec.repository.testCommandSource}`)}):null,
      h(doc,"dt",{text:ctx.t("intake.res.project")}),h(doc,"dd",{class:"mono",text:rec.projectId}),
      h(doc,"dt",{text:ctx.t("intake.res.mission")}),h(doc,"dd",{class:"mono",text:rec.missionId})),
    h(doc,"div",{class:"btn-row"},
      h(doc,"button",{type:"button",class:"btn",id:"intake-open-project",dataset:{focusKey:"intake-open-project"},text:ctx.t("intake.openProject"),
        on:{click:async()=>{ctx.selectProject(rec.projectId);openProject(rec.projectId);await ctx.rerender();settle(ctx,["id:view-title"])}}}),
      h(doc,"button",{type:"button",class:"btn",id:"intake-open-mission",dataset:{focusKey:"intake-open-mission"},text:ctx.t("intake.openMission"),
        on:{click:()=>{selection.missionId=rec.missionId;ctx.navigate("work")}}})));
}
function history(ctx,res){
  const doc=ctx.doc;
  if(res.state!=="VERIFIED")return stateNote(ctx,res.state,res.state==="UNAVAILABLE"?"intake.listUnavailable":undefined);
  if(!res.items.length)return emptyNote(ctx,"intake.none");
  return h(doc,"ul",{class:"cards",id:"intake-list"},res.items.slice(0,20).map(r=>h(doc,"li",{class:"card",dataset:{intakeRow:r.intakeId}},
    h(doc,"strong",{text:r.title})," ",h(doc,"span",{class:"mono note",text:r.projectId}))));
}
export async function intakePanel(ctx){
  const doc=ctx.doc,st=drafts.status[INTAKE_FORM],errs=st?.errors??{},d=intakeDraft;
  const lr=await ctx.api.raw(INTAKES_PATH);
  const list=lr.ok?mapIntakes(lr.data):{state:lr.state,items:[]};
  const form=h(doc,"form",{id:"intake-form",novalidate:true,"aria-labelledby":"intake-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[INTAKE_FORM])submitIntake(ctx)}}},
    field(ctx,{id:"intake-idea",labelKey:"intake.idea",value:d.idea,onInput:v=>{d.idea=v},errorKey:errs.idea,required:true,multiline:true,hintKey:"intake.ideaHint"}),
    field(ctx,{id:"intake-title",labelKey:"form.field.title",value:d.title,onInput:v=>{d.title=v},errorKey:errs.title,hintKey:"intake.titleHint"}),
    field(ctx,{id:"intake-template",labelKey:"intake.template",value:d.template,onInput:v=>{d.template=v},errorKey:errs.template,hintKey:"intake.templateHint",options:[{value:"",label:ctx.t("intake.template.none")},...TEMPLATES.map(v=>({value:v,label:ctx.t(`studio.template.${v}`)}))]}),
    field(ctx,{id:"intake-type",labelKey:"form.field.projectType",value:d.projectType,onInput:v=>{d.projectType=v},errorKey:errs.projectType,options:[{value:"",label:ctx.t("intake.notSet")},...INTAKE_PROJECT_TYPES.map(v=>({value:v,label:v}))]}),
    listEditor(ctx,{id:"intake-tech",labelKey:"form.field.techStack",itemLabelKey:"studio.wizard.techN",addKey:"studio.wizard.techAdd",removeKey:"studio.wizard.techRemove",items:d.techStack,errorKey:errs.techStack}),
    h(doc,"fieldset",{class:"choice-group",id:"intake-os"},h(doc,"legend",{text:ctx.t("form.field.targetOS")}),
      h(doc,"div",{class:"choice-list"},INTAKE_OS.map(v=>{
        const iid=`intake-os-${v}`,cb=h(doc,"input",{type:"checkbox",id:iid,value:v,checked:d.targetOS.includes(v),dataset:{focusKey:iid}});
        cb.checked=d.targetOS.includes(v);cb.addEventListener("change",()=>{d.targetOS=INTAKE_OS.filter(x=>x===v?cb.checked:d.targetOS.includes(x))});
        return h(doc,"label",{class:"choice",for:iid},cb,h(doc,"span",{class:"choice-text"},h(doc,"strong",{text:ctx.t(`studio.os.${v}`)})));
      })),errs.targetOS?h(doc,"p",{class:"field-error",id:"intake-os-err",text:ctx.t(errs.targetOS)}):null),
    listEditor(ctx,{id:"intake-criteria",labelKey:"form.field.acceptanceCriteria",itemLabelKey:"work.form.criterionN",addKey:"work.form.criterionAdd",removeKey:"work.form.criterionRemove",items:d.acceptanceCriteria,errorKey:errs.acceptanceCriteria,multiline:true,hintKey:"intake.criteriaHint"}),
    field(ctx,{id:"intake-risk",labelKey:"form.field.riskLevel",value:d.riskLevel,onInput:v=>{d.riskLevel=v},errorKey:errs.riskLevel,hintKey:"intake.riskHint",options:[{value:"",label:ctx.t("intake.notSet")},...INTAKE_RISKS.map(r=>({value:r,label:`${r} — ${ctx.t(`risk.${r}.name`)}`}))]}),
    // Test komutu isteğe bağlıdır ve şablonun komutunu geçersiz kılar; şablonsuz ya da empty şablonda girilmezse ilk koşu VERIFY aşamasında komut tanımlanana kadar bloklanır (alan, proje formundaki argv satır düzenleyicisiyle aynıdır).
    listEditor(ctx,{id:"intake-test",labelKey:"form.testCommand",itemLabelKey:"form.argvToken",addKey:"form.argvAdd",removeKey:"form.argvRemove",items:d.testCommand,errorKey:errs.testCommand,hintKey:"intake.testCommandHint",preview:true}),
    statusBlock(ctx,INTAKE_FORM),
    intakeUi.last?resultCard(ctx,intakeUi.last):null,
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"intake-submit",dataset:{focusKey:"intake-submit"},disabled:drafts.busy[INTAKE_FORM]===true,text:ctx.t("intake.submit")})));
  const details=h(doc,"details",{class:"panel form-panel",id:"intake",open:intakeUi.open||Boolean(st)||Boolean(intakeUi.last)},
    h(doc,"summary",{id:"intake-t",dataset:{focusKey:"intake-summary"},text:ctx.t("intake.title")}),
    h(doc,"p",{class:"note",text:ctx.t("intake.lead")}),form,
    h(doc,"h3",{text:ctx.t("intake.history")}),history(ctx,list));
  details.addEventListener("toggle",()=>{intakeUi.open=details.open===true});
  return details;
}
