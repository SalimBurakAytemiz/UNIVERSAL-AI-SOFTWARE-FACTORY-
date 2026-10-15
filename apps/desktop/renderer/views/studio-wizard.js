// //TR: Bu görünüm parçası Project Studio'nun "Yeni Proje" sihirbazı ve "İçe Aktar" panelidir: şablon (boş dahil), ad, tür/teknoloji/hedef işletim sistemi, kabul kriterleri, bütçe ve dev/test komutları (argv listesi) project-core kurucusuyla doğrulanır, her gönderim için idempotency anahtarı üretilir; içe aktarma yolu renderer'a yazdırılmaz, yalnız ana süreçteki yerel dosya diyaloğundan dönen yol gösterilir ve geri gönderilir. Hiçbir otomatik gönderim yoktur.
import {h} from "../components.js";
import {buildWizardRequest,buildImportRequest,TEMPLATES,TARGET_OS,IMPORT_KINDS} from "../project-core.js";
import {drafts,field,listEditor,statusBlock,setStatus,recordPost,focusResult,settle} from "../forms.js";
import {describePostResult} from "../work-core.js";
import {studio,wizard,importDraft,studioTrackers,studioUi,resetWizard,resetImport,openProject} from "../studio-state.js";

export const WIZARD_FORM="studio-wizard";
export const IMPORT_FORM="studio-import";
// Odak yedekleri (focusKey biçimi): eylemden sonra aynı denetim varsa o, yoksa sonuç/başlık öğesi.
const WIZARD_KEYS=["id:studio-wizard-submit","id:studio-wizard-t"],IMPORT_KEYS=["id:studio-import-pick","id:studio-import-submit","id:studio-import-t"];
const wizardInput=()=>({name:wizard.name,template:wizard.template,projectType:wizard.projectType,techStack:wizard.techStack,targetOS:wizard.targetOS,acceptanceCriteria:wizard.acceptanceCriteria,maxRuns:wizard.maxRuns,maxTokens:wizard.maxTokens,devCommand:wizard.devCommand,testCommand:wizard.testCommand});

/** Sihirbazı doğrular; geçerliyse idempotency anahtarıyla POST eder (yalnız kullanıcı gönderimi çağırır). */
export async function submitWizard(ctx){
  const check=buildWizardRequest(wizardInput());
  if(!check.ok){setStatus(WIZARD_FORM,{ok:false,errors:check.errors});await ctx.rerender();focusResult(ctx,WIZARD_FORM,WIZARD_KEYS);return {ok:false,validation:true}}
  const key=studioTrackers.wizard.keyFor(check.body),req=buildWizardRequest(wizardInput(),{key});
  drafts.busy[WIZARD_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[WIZARD_FORM]=false}
  const name=res?.body?.project?.name??check.body.name,ok=recordPost(WIZARD_FORM,res,"studio.wizard.created",{name});
  if(ok){
    const id=res?.body?.project?.projectId;
    if(typeof id==="string"&&/^prj_[0-9a-f]{24}$/.test(id)){studio.lastCreated={projectId:id,name};importDraft.projectId=id}
    resetWizard();
  }
  await ctx.refreshAll({force:true});focusResult(ctx,WIZARD_FORM,WIZARD_KEYS);return {ok};
}
function choiceGroup(ctx,{id,legendKey,hintKey,type,options,isChecked,onChange,errorKey}){
  const doc=ctx.doc,describedBy=[hintKey?`${id}-hint`:null,errorKey?`${id}-err`:null].filter(Boolean).join(" ");
  return h(doc,"fieldset",{class:"choice-group",id,"aria-describedby":describedBy||null,"aria-invalid":errorKey?"true":null},
    h(doc,"legend",{text:ctx.t(legendKey)}),
    h(doc,"div",{class:"choice-list"},options.map(o=>{
      const iid=`${id}-${o.value}`,input=h(doc,"input",{type,id:iid,name:id,value:o.value,checked:isChecked(o.value),dataset:{focusKey:iid}});
      input.checked=isChecked(o.value);
      input.addEventListener("change",()=>onChange(o.value,input.checked));
      return h(doc,"label",{class:"choice",for:iid},input,h(doc,"span",{class:"choice-text"},h(doc,"strong",{text:o.label}),o.desc?h(doc,"small",{text:o.desc}):null));
    })),
    hintKey?h(doc,"p",{class:"field-hint",id:`${id}-hint`,text:ctx.t(hintKey)}):null,
    errorKey?h(doc,"p",{class:"field-error",id:`${id}-err`,text:ctx.t(errorKey)}):null);
}
export function wizardPanel(ctx){
  const doc=ctx.doc,st=drafts.status[WIZARD_FORM],errs=st?.errors??{},d=wizard;
  const form=h(doc,"form",{id:"studio-wizard-form",novalidate:true,"aria-labelledby":"studio-wizard-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[WIZARD_FORM])submitWizard(ctx)}}},
    choiceGroup(ctx,{id:"studio-template",legendKey:"studio.wizard.template",hintKey:"studio.wizard.templateHint",type:"radio",errorKey:errs.template,
      options:TEMPLATES.map(v=>({value:v,label:ctx.t(`studio.template.${v}`),desc:ctx.t(`studio.template.${v}.desc`)})),isChecked:v=>d.template===v,onChange:v=>{d.template=v}}),
    field(ctx,{id:"studio-name",labelKey:"studio.wizard.name",value:d.name,onInput:v=>{d.name=v},errorKey:errs.name,required:true}),
    field(ctx,{id:"studio-type",labelKey:"studio.wizard.type",value:d.projectType,onInput:v=>{d.projectType=v},errorKey:errs.projectType,hintKey:"studio.wizard.typeHint"}),
    listEditor(ctx,{id:"studio-tech",labelKey:"studio.wizard.tech",itemLabelKey:"studio.wizard.techN",addKey:"studio.wizard.techAdd",removeKey:"studio.wizard.techRemove",items:d.techStack,errorKey:errs.techStack,hintKey:"studio.wizard.techHint"}),
    choiceGroup(ctx,{id:"studio-os",legendKey:"studio.wizard.os",hintKey:"studio.wizard.osHint",type:"checkbox",errorKey:errs.targetOS,
      options:TARGET_OS.map(v=>({value:v,label:ctx.t(`studio.os.${v}`)})),isChecked:v=>d.targetOS.includes(v),onChange:(v,on)=>{d.targetOS=TARGET_OS.filter(x=>x===v?on:d.targetOS.includes(x))}}),
    listEditor(ctx,{id:"studio-criteria",labelKey:"studio.wizard.criteria",itemLabelKey:"work.form.criterionN",addKey:"work.form.criterionAdd",removeKey:"work.form.criterionRemove",items:d.acceptanceCriteria,errorKey:errs.acceptanceCriteria,hintKey:"studio.wizard.criteriaHint",multiline:true}),
    h(doc,"div",{class:"field-row"},
      field(ctx,{id:"studio-budget-runs",labelKey:"studio.wizard.budgetRuns",value:d.maxRuns,onInput:v=>{d.maxRuns=v},errorKey:errs.budgetMaxRuns,hintKey:"studio.wizard.budgetRunsHint"}),
      field(ctx,{id:"studio-budget-tokens",labelKey:"studio.wizard.budgetTokens",value:d.maxTokens,onInput:v=>{d.maxTokens=v},errorKey:errs.budgetMaxTokens,hintKey:"studio.wizard.budgetTokensHint"})),
    listEditor(ctx,{id:"studio-dev",labelKey:"studio.wizard.devCommand",itemLabelKey:"form.argvToken",addKey:"form.argvAdd",removeKey:"form.argvRemove",items:d.devCommand,errorKey:errs.devCommand,hintKey:"studio.wizard.devCommandHint",preview:true}),
    listEditor(ctx,{id:"studio-test",labelKey:"form.testCommand",itemLabelKey:"form.argvToken",addKey:"form.argvAdd",removeKey:"form.argvRemove",items:d.testCommand,errorKey:errs.testCommand,hintKey:"form.testCommandHint",preview:true}),
    statusBlock(ctx,WIZARD_FORM),
    studio.lastCreated?h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"studio-open-created",dataset:{focusKey:"studio-open-created"},text:ctx.t("studio.wizard.openCreated",{name:studio.lastCreated.name}),
      on:{click:async()=>{const id=studio.lastCreated.projectId;studio.lastCreated=null;ctx.selectProject(id);openProject(id);await ctx.rerender();settle(ctx,["id:view-title"])}}})):null,
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"studio-wizard-submit",dataset:{focusKey:"studio-wizard-submit"},disabled:drafts.busy[WIZARD_FORM]===true,text:ctx.t("studio.wizard.submit")})));
  const details=h(doc,"details",{class:"panel form-panel",id:"studio-wizard",open:studioUi.wizardOpen||Boolean(st)},
    h(doc,"summary",{id:"studio-wizard-t",dataset:{focusKey:"studio-wizard-summary"},text:ctx.t("studio.wizard.title")}),
    h(doc,"p",{class:"note",text:ctx.t("studio.wizard.lead")}),form);
  details.addEventListener("toggle",()=>{studioUi.wizardOpen=details.open===true});
  return details;
}

// ---------- İçe aktarma ----------
/** Ana süreçteki yerel dosya diyaloğunu açar; renderer yalnız tür verir, yol ana süreçten gelir. */
export async function pickImportPath(ctx){
  const native=ctx.native;
  if(!native||typeof native.pickImportPath!=="function"){setStatus(IMPORT_FORM,{ok:false,key:"studio.import.noDialog",vars:{},errors:null});await ctx.rerender();focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:false}}
  let r;try{r=await native.pickImportPath(importDraft.kind)}catch{setStatus(IMPORT_FORM,{ok:false,key:"studio.import.dialogFailed",vars:{},errors:null});await ctx.rerender();focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:false}}
  if(!r||r.cancelled===true||typeof r.path!=="string"||r.kind!==importDraft.kind){settle(ctx,IMPORT_KEYS);return {ok:false,cancelled:true}}
  importDraft.path=r.path;importDraft.pickedFor=importDraft.kind;drafts.status[IMPORT_FORM]=undefined;
  await ctx.rerender();settle(ctx,IMPORT_KEYS);return {ok:true};
}
export async function submitImport(ctx){
  const req=buildImportRequest({projectId:importDraft.projectId,kind:importDraft.kind,path:importDraft.path});
  if(!req.ok){setStatus(IMPORT_FORM,{ok:false,errors:req.errors});await ctx.rerender();focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:false,validation:true}}
  drafts.busy[IMPORT_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[IMPORT_FORM]=false}
  const d=describePostResult(res);
  setStatus(IMPORT_FORM,{ok:d.ok,key:d.ok?"studio.import.done":d.key,vars:d.ok?{}:d.vars,errors:null});
  if(d.ok)resetImport();
  await ctx.refreshAll({force:true});focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:d.ok,status:res?.status??null};
}
/** projects: seçilebilir proje listesi; fixedId verilirse hedef proje sabittir (çalışma alanı içinden). */
export function importPanel(ctx,{projects,fixedId=null}){
  const doc=ctx.doc,st=drafts.status[IMPORT_FORM],errs=st?.errors??{},d=importDraft;
  if(fixedId)d.projectId=fixedId;
  else if(!d.projectId||!projects.some(p=>p.projectId===d.projectId))d.projectId=projects.some(p=>p.projectId===studio.lastCreated?.projectId)?studio.lastCreated.projectId:(projects.some(p=>p.projectId===ctx.store.projectId)?ctx.store.projectId:(projects[0]?.projectId??""));
  if(d.pickedFor!==d.kind){d.path="";d.pickedFor=null}
  const form=h(doc,"form",{id:"studio-import-form",novalidate:true,"aria-labelledby":"studio-import-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[IMPORT_FORM])submitImport(ctx)}}},
    fixedId?null:field(ctx,{id:"studio-import-project",labelKey:"studio.import.project",value:d.projectId,onInput:v=>{d.projectId=v},errorKey:errs.projectId,required:true,options:projects.length?projects.map(p=>({value:p.projectId,label:p.name})):[{value:"",label:ctx.t("work.form.noProjects")}]}),
    field(ctx,{id:"studio-import-kind",labelKey:"studio.import.kind",value:d.kind,onInput:v=>{d.kind=IMPORT_KINDS.includes(v)?v:"git";d.path="";d.pickedFor=null;Promise.resolve(ctx.rerender()).then(()=>settle(ctx,["id:studio-import-kind"]))},errorKey:errs.importKind,required:true,options:IMPORT_KINDS.map(k=>({value:k,label:ctx.t(`studio.import.kind.${k}`)}))}),
    h(doc,"div",{class:"field"},
      h(doc,"span",{class:"field-label",id:"studio-import-path-l",text:ctx.t("studio.import.path")+" *"}),
      h(doc,"p",{class:"mono path-chosen",id:"studio-import-path","aria-labelledby":"studio-import-path-l","aria-live":"polite",text:d.path||ctx.t("studio.import.noneChosen")}),
      h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"studio-import-pick",dataset:{focusKey:"studio-import-pick"},text:ctx.t(d.kind==="zip"?"studio.import.pickZip":"studio.import.pickGit"),on:{click:()=>{pickImportPath(ctx)}}})),
      h(doc,"p",{class:"field-hint",text:ctx.t("studio.import.hint")}),
      errs.importPath?h(doc,"p",{class:"field-error",id:"studio-import-path-err",text:ctx.t(errs.importPath)}):null),
    statusBlock(ctx,IMPORT_FORM),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"studio-import-submit",dataset:{focusKey:"studio-import-submit"},disabled:drafts.busy[IMPORT_FORM]===true||!d.path||!d.projectId,text:ctx.t("studio.import.submit")})));
  const details=h(doc,"details",{class:"panel form-panel",id:fixedId?"studio-import-ws":"studio-import",open:fixedId?true:(studioUi.importOpen||Boolean(st))},
    h(doc,"summary",{id:"studio-import-t",dataset:{focusKey:"studio-import-summary"},text:ctx.t("studio.import.title")}),
    h(doc,"p",{class:"note",text:ctx.t("studio.import.lead")}),form);
  if(!fixedId)details.addEventListener("toggle",()=>{studioUi.importOpen=details.open===true});
  return details;
}
