// //TR: Bu görünüm parçası Project Studio'nun "Yeni Proje" sihirbazı ve "İçe Aktar" panelidir: şablon (boş dahil), ad, tür/teknoloji/hedef işletim sistemi, kabul kriterleri, bütçe ve dev/test komutları (argv listesi) project-core kurucusuyla doğrulanır, her gönderim için idempotency anahtarı üretilir; içe aktarma yolu renderer'a yazdırılmaz, yalnız ana süreçteki yerel dosya diyaloğundan dönen yol gösterilir ve geri gönderilir. Hiçbir otomatik gönderim yoktur.
import {h} from "../components.js";
import {buildWizardRequest,buildImportRequest,describeImportResult,mapImportQuarantine,QUARANTINE_FILES_SHOWN,TEMPLATES,TARGET_OS,IMPORT_KINDS} from "../project-core.js";
import {drafts,selection,field,listEditor,statusBlock,setStatus,recordPost,focusResult,settle} from "../forms.js";
import {studio,wizard,importDraft,studioTrackers,studioUi,resetWizard,resetImport,openProject,ideaDraft,resetIdea,importOutcome,setImportOutcome,clearImportOutcome} from "../studio-state.js";
import {buildMissionRequest,MISSION_ID_RE,RISK_LEVELS} from "../work-core.js";

export const WIZARD_FORM="studio-wizard";
export const IMPORT_FORM="studio-import";
export const IDEA_FORM="studio-idea";
const IDEA_KEYS=["id:studio-idea-submit","id:studio-idea-t"];
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
    if(typeof id==="string"&&/^prj_[0-9a-f]{24}$/.test(id)){
      studio.lastCreated={projectId:id,name};importDraft.projectId=id;
      // //TR: Yeni projenin kabul kriterleri, ilk mission (Kurucu fikri) formuna başlangıç olarak aktarılır; yeni proje için fikir taslağı sıfırlanır.
      resetIdea();delete drafts.status[IDEA_FORM];const crit=check.body.acceptanceCriteria??[];ideaDraft.criteria=crit.length?[...crit]:[""];ideaDraft.title=name;
    }
    resetWizard();
  }
  await ctx.refreshAll({force:true});focusResult(ctx,WIZARD_FORM,WIZARD_KEYS);return {ok};
}
/** Kurucu fikri -> ilk mission: yeni projeye bağlı POST /v1/missions (yalnız kullanıcı gönderimi); görevler (task) planlama/koşu tarafından üretilir, burada uydurulmaz. */
export async function submitIdea(ctx){
  const projectId=studio.lastCreated?.projectId,d=ideaDraft;
  const input=()=>({projectId,title:d.title,objective:d.objective,acceptanceCriteria:d.criteria,riskLevel:d.riskLevel});
  const check=buildMissionRequest(input());
  if(!check.ok){setStatus(IDEA_FORM,{ok:false,errors:check.errors});await ctx.rerender();focusResult(ctx,IDEA_FORM,IDEA_KEYS);return {ok:false,validation:true}}
  const key=studioTrackers.idea.keyFor(check.body),req=buildMissionRequest(input(),{key});
  drafts.busy[IDEA_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[IDEA_FORM]=false}
  const title=res?.body?.mission?.title??check.body.title,ok=recordPost(IDEA_FORM,res,"studio.idea.created",{title});
  const id=res?.body?.mission?.missionId;
  if(ok&&typeof id==="string"&&MISSION_ID_RE.test(id)){d.missionId=id;d.missionTitle=title;selection.missionId=id}
  await ctx.refreshAll({force:true});focusResult(ctx,IDEA_FORM,IDEA_KEYS);return {ok};
}
/** Yeni proje oluşturulduktan sonra Kurucu fikrini ilk mission olarak kaydeder; oluşunca "Görevlerde aç" ile #/work mission ayrıntısına geçer. */
export function ideaPanel(ctx){
  const doc=ctx.doc,st=drafts.status[IDEA_FORM],errs=st?.errors??{},d=ideaDraft;
  const form=h(doc,"form",{id:"studio-idea-form",novalidate:true,"aria-labelledby":"studio-idea-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[IDEA_FORM]&&!d.missionId)submitIdea(ctx)}}},
    field(ctx,{id:"studio-idea-title",labelKey:"work.form.title",value:d.title,onInput:v=>{d.title=v},errorKey:errs.title,required:true}),
    field(ctx,{id:"studio-idea-objective",labelKey:"studio.idea.objective",value:d.objective,onInput:v=>{d.objective=v},errorKey:errs.objective,multiline:true,required:true,hintKey:"studio.idea.objectiveHint"}),
    listEditor(ctx,{id:"studio-idea-criteria",labelKey:"work.form.criteria",itemLabelKey:"work.form.criterionN",addKey:"work.form.criterionAdd",removeKey:"work.form.criterionRemove",items:d.criteria,errorKey:errs.acceptanceCriteria,hintKey:"work.form.criteriaHint",multiline:true,required:true}),
    field(ctx,{id:"studio-idea-risk",labelKey:"work.form.risk",value:d.riskLevel,onInput:v=>{d.riskLevel=v},errorKey:errs.riskLevel,required:true,hintKey:"work.form.riskHint",options:RISK_LEVELS.map(r=>({value:r,label:`${r} — ${ctx.t(`risk.${r}.name`)}`}))}),
    statusBlock(ctx,IDEA_FORM),
    h(doc,"div",{class:"btn-row"},
      h(doc,"button",{type:"submit",class:"btn btn-primary",id:"studio-idea-submit",dataset:{focusKey:"studio-idea-submit"},disabled:drafts.busy[IDEA_FORM]===true||Boolean(d.missionId),text:ctx.t("studio.idea.submit")}),
      d.missionId?h(doc,"button",{type:"button",class:"btn",id:"studio-idea-open",dataset:{focusKey:"studio-idea-open",ideaMission:d.missionId},text:ctx.t("studio.idea.open",{title:d.missionTitle??d.missionId}),on:{click:()=>{selection.missionId=d.missionId;ctx.navigate("work")}}}):null));
  return h(doc,"section",{class:"panel form-panel",id:"studio-idea",dataset:{ideaProject:studio.lastCreated.projectId}},
    h(doc,"h3",{id:"studio-idea-t",tabindex:"-1",dataset:{focusKey:"studio-idea-t"},text:ctx.t("studio.idea.title",{name:studio.lastCreated.name})}),
    h(doc,"p",{class:"note",text:ctx.t("studio.idea.lead")}),form);
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
    h(doc,"p",{class:"note",text:ctx.t("studio.wizard.lead")}),form,studio.lastCreated?ideaPanel(ctx):null);
  details.addEventListener("toggle",()=>{studioUi.wizardOpen=details.open===true});
  return details;
}

// ---------- İçe aktarma ----------
/** Ana süreçteki yerel dosya diyaloğunu açar; renderer yalnız tür verir, yol ana süreçten gelir. */
export async function pickImportPath(ctx){
  const native=ctx.native;
  if(!native||typeof native.pickImportPath!=="function"){setStatus(IMPORT_FORM,{ok:false,key:"studio.import.noDialog",vars:{},errors:null,projectId:importDraft.projectId});await ctx.rerender();focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:false}}
  let r;try{r=await native.pickImportPath(importDraft.kind)}catch{setStatus(IMPORT_FORM,{ok:false,key:"studio.import.dialogFailed",vars:{},errors:null,projectId:importDraft.projectId});await ctx.rerender();focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:false}}
  if(!r||r.cancelled===true||typeof r.path!=="string"||r.kind!==importDraft.kind){settle(ctx,IMPORT_KEYS);return {ok:false,cancelled:true}}
  // //TR: Yeni yol seçimi önceki içe aktarmanın durumunu VE karantina kanıtını siler (aksi halde eski kanıt, seçili başka proje için görünür kalırdı).
  importDraft.path=r.path;importDraft.pickedFor=importDraft.kind;drafts.status[IMPORT_FORM]=undefined;clearImportOutcome();
  await ctx.rerender();settle(ctx,IMPORT_KEYS);return {ok:true};
}
export async function submitImport(ctx){
  // //TR: Proje kimliği await'ten ÖNCE yakalanır; yanıt geldiğinde kullanıcı başka çalışma alanına geçmiş olsa bile durum ve kanıt isteği başlatılan projeye yazılır.
  const pid=importDraft.projectId;
  const req=buildImportRequest({projectId:pid,kind:importDraft.kind,path:importDraft.path});
  if(!req.ok){setStatus(IMPORT_FORM,{ok:false,errors:req.errors,projectId:pid});await ctx.rerender();focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:false,validation:true}}
  drafts.busy[IMPORT_FORM]=true;clearImportOutcome();
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[IMPORT_FORM]=false}
  const d=describeImportResult(res);
  // //TR: Başarılı içe aktarma karantinayı GİZLEYEN düz bir "kabul edildi" olamaz: sonuç (karantinaya alındı / sunucu bildirmedi / bilinmiyor) durum satırında ve altındaki kanıt bloğunda gösterilir.
  const q=d.ok?mapImportQuarantine(res):null,doneKey=q===null?null:q.state==="QUARANTINED"?"studio.import.doneQuarantined":q.state==="UNKNOWN"?"studio.import.doneQuarantineUnknown":"studio.import.done";
  setStatus(IMPORT_FORM,{ok:d.ok,key:d.ok?doneKey:d.key,vars:d.ok?(q.state==="QUARANTINED"?{count:q.count}:{}):d.vars,errors:null,projectId:pid});
  if(d.ok){resetImport();setImportOutcome(pid,q)}
  await ctx.refreshAll({force:true});focusResult(ctx,IMPORT_FORM,IMPORT_KEYS);return {ok:d.ok,status:res?.status??null};
}
/** projects: seçilebilir proje listesi; fixedId verilirse hedef proje sabittir (çalışma alanı içinden). */
// //TR: Son içe aktarmanın karantina kanıtı: QUARANTINED => adet, commit, saklama yeri ve (ilk QUARANTINE_FILES_SHOWN) dosya tablosu; NONE => "sunucu karantina bildirmedi"; UNKNOWN => bilinmiyor. Yalnız h()/textContent; sunucu metni HTML olarak yorumlanmaz.
function quarantineBlock(ctx,fixedId){
  const doc=ctx.doc,o=importOutcome,q=o.quarantine;
  if(q===null||o.projectId===null||(fixedId&&o.projectId!==fixedId))return null;
  const wrap=(...c)=>h(doc,"div",{class:"note studio-quarantine",id:"studio-import-quarantine",role:"status",dataset:{quarantine:q.state,quarantineFor:o.projectId}},h(doc,"h4",{text:ctx.t("studio.import.q.title")}),...c);
  if(q.state==="UNKNOWN")return wrap(h(doc,"p",{dataset:{quarantineNote:"unknown"},text:ctx.t("studio.import.q.unknown")}));
  if(q.state==="NONE")return wrap(h(doc,"p",{dataset:{quarantineNote:"none"},text:ctx.t("studio.import.q.none")}));
  const shown=q.files.slice(0,QUARANTINE_FILES_SHOWN),cols=["path","pattern","kind","bytes","sha"];
  // //TR: Sunucu en çok 500 yolu kaydeder (server.ts); truncated iken kalan adlar HİÇBİR yerde saklanmaz. Bu yüzden "tam liste manifestte" yalnız kesilmemiş kanıtta söylenir. Listelenemeyen yollar (çok uzun / kontrol karakteri) sayılır, gösterilmez.
  const recorded=q.recorded??q.files.length,und=q.undisplayable??0,unlisted=q.count-shown.length-und;
  const row=f=>h(doc,"tr",{dataset:{quarantineFile:f.path}},h(doc,"td",{class:"mono",text:f.path}),h(doc,"td",{class:"mono",text:f.pattern}),h(doc,"td",{text:f.kind}),h(doc,"td",{class:"num",text:String(f.bytes)}),h(doc,"td",{class:"mono",text:f.sha256.slice(0,12)}));
  const table=shown.length===0?null:h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"studio-import-quarantine-files"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("studio.import.q.files")}),
    h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(`studio.import.q.col.${k}`)})))),
    h(doc,"tbody",{},shown.map(row))));
  return wrap(h(doc,"p",{dataset:{quarantineNote:"quarantined",quarantineCount:String(q.count)},text:ctx.t("studio.import.q.quarantined",{count:q.count,sha:q.headSha.slice(0,12),where:q.storedUnder})}),table,
    und>0?h(doc,"p",{dataset:{quarantineUndisplayable:String(und)},text:ctx.t("studio.import.q.undisplayable",{n:und})}):null,
    unlisted>0?h(doc,"p",{dataset:{quarantineMore:"1"},text:q.truncated?ctx.t("studio.import.q.moreTruncated",{shown:shown.length,count:q.count,recorded,rest:q.count-recorded}):ctx.t("studio.import.q.more",{shown:shown.length,count:q.count})}):null);
}
export function importPanel(ctx,{projects,fixedId=null}){
  const doc=ctx.doc,d=importDraft;
  if(fixedId)d.projectId=fixedId;
  else if(!d.projectId||!projects.some(p=>p.projectId===d.projectId))d.projectId=projects.some(p=>p.projectId===studio.lastCreated?.projectId)?studio.lastCreated.projectId:(projects.some(p=>p.projectId===ctx.store.projectId)?ctx.store.projectId:(projects[0]?.projectId??""));
  if(d.pickedFor!==d.kind){d.path="";d.pickedFor=null}
  // //TR: Durum satırı kanıt bloğu gibi proje kapsamlıdır: çalışma alanı paneli yalnız KENDİ projesinin (veya proje etiketsiz) sonucunu gösterir; başka projenin "N dosya karantinaya alındı" satırı sızmaz.
  const stAll=drafts.status[IMPORT_FORM],st=stAll&&(!fixedId||stAll.projectId===undefined||stAll.projectId===fixedId)?stAll:undefined,errs=st?.errors??{};
  const form=h(doc,"form",{id:"studio-import-form",novalidate:true,"aria-labelledby":"studio-import-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[IMPORT_FORM])submitImport(ctx)}}},
    fixedId?null:field(ctx,{id:"studio-import-project",labelKey:"studio.import.project",value:d.projectId,onInput:v=>{d.projectId=v},errorKey:errs.projectId,required:true,options:projects.length?projects.map(p=>({value:p.projectId,label:p.name})):[{value:"",label:ctx.t("work.form.noProjects")}]}),
    field(ctx,{id:"studio-import-kind",labelKey:"studio.import.kind",value:d.kind,onInput:v=>{d.kind=IMPORT_KINDS.includes(v)?v:"git";d.path="";d.pickedFor=null;Promise.resolve(ctx.rerender()).then(()=>settle(ctx,["id:studio-import-kind"]))},errorKey:errs.importKind,required:true,options:IMPORT_KINDS.map(k=>({value:k,label:ctx.t(`studio.import.kind.${k}`)}))}),
    h(doc,"div",{class:"field"},
      h(doc,"span",{class:"field-label",id:"studio-import-path-l",text:ctx.t("studio.import.path")+" *"}),
      h(doc,"p",{class:"mono path-chosen",id:"studio-import-path","aria-labelledby":"studio-import-path-l","aria-live":"polite",text:d.path||ctx.t("studio.import.noneChosen")}),
      h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"studio-import-pick",dataset:{focusKey:"studio-import-pick"},text:ctx.t(d.kind==="zip"?"studio.import.pickZip":"studio.import.pickGit"),on:{click:()=>{pickImportPath(ctx)}}})),
      h(doc,"p",{class:"field-hint",text:ctx.t("studio.import.hint")}),
      errs.importPath?h(doc,"p",{class:"field-error",id:"studio-import-path-err",text:ctx.t(errs.importPath)}):null),
    st?statusBlock(ctx,IMPORT_FORM):h(doc,"div",{class:"form-status",id:`${IMPORT_FORM}-status`,role:"status","aria-live":"polite",tabindex:"-1"}),
    quarantineBlock(ctx,fixedId),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"studio-import-submit",dataset:{focusKey:"studio-import-submit"},disabled:drafts.busy[IMPORT_FORM]===true||!d.path||!d.projectId,text:ctx.t("studio.import.submit")})));
  const details=h(doc,"details",{class:"panel form-panel",id:fixedId?"studio-import-ws":"studio-import",open:fixedId?true:(studioUi.importOpen||Boolean(st))},
    h(doc,"summary",{id:"studio-import-t",dataset:{focusKey:"studio-import-summary"},text:ctx.t("studio.import.title")}),
    h(doc,"p",{class:"note",text:ctx.t("studio.import.lead")}),form);
  if(!fixedId)details.addEventListener("toggle",()=>{studioUi.importOpen=details.open===true});
  return details;
}
