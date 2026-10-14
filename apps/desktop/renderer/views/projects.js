// //TR: Bu görünüm Projeler alanıdır: GET /v1/projects gerçek proje listesi ve "Yeni Proje" formu (ad, yerel depo yolu, argv belirteç listesi olarak test komutu); gövde work-core kurucusuyla doğrulanır, her gönderim için idempotency anahtarı üretilir, istek yalnız ana süreçteki sabit POST köprüsünden gider ve proje seçimi store.selectProject ile önbelleği geçersiz kılar (DSK-061-06).
import {h,panel,stateNote,emptyNote,chip} from "../components.js";
import {formatTime} from "../model.js";
import {buildProjectRequest} from "../work-core.js";
import {drafts,trackers,field,listEditor,statusBlock,setStatus,recordPost,resetProjectDraft,focusStatus} from "../forms.js";

const FORM="project";
const inputOf=()=>({name:drafts.project.name,repositoryPath:drafts.project.repositoryPath,environmentId:drafts.project.environmentId,testCommand:drafts.project.testCommand});

/** Formu doğrular; geçerliyse idempotency anahtarıyla POST eder. Hiçbir otomatik gönderim yoktur: yalnız kullanıcı gönderimi çağırır. */
export async function submitProject(ctx){
  const check=buildProjectRequest(inputOf());
  if(!check.ok){setStatus(FORM,{ok:false,errors:check.errors});await ctx.rerender();focusStatus(ctx.doc,FORM);return {ok:false,validation:true}}
  const key=trackers.project.keyFor(check.body),req=buildProjectRequest(inputOf(),{key});
  drafts.busy[FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[FORM]=false}
  const name=res?.body?.project?.name??check.body.name,ok=recordPost(FORM,res,"project.created",{name});
  if(ok){resetProjectDraft()}
  await ctx.refreshAll({force:true});focusStatus(ctx.doc,FORM);return {ok};
}
function projectForm(ctx){
  const doc=ctx.doc,st=drafts.status[FORM],errs=st?.errors??{},d=drafts.project;
  const form=h(doc,"form",{id:"project-form",novalidate:true,"aria-labelledby":"project-form-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[FORM])submitProject(ctx)}}},
    field(ctx,{id:"project-name",labelKey:"projects.form.name",value:d.name,onInput:v=>{d.name=v},errorKey:errs.name,required:true}),
    field(ctx,{id:"project-repo",labelKey:"projects.form.repo",value:d.repositoryPath,onInput:v=>{d.repositoryPath=v},errorKey:errs.repositoryPath,hintKey:"projects.form.repoHint",required:true}),
    field(ctx,{id:"project-env",labelKey:"projects.form.env",value:d.environmentId,onInput:v=>{d.environmentId=v},errorKey:errs.environmentId,hintKey:"projects.form.envHint"}),
    listEditor(ctx,{id:"project-test",labelKey:"form.testCommand",itemLabelKey:"form.argvToken",addKey:"form.argvAdd",removeKey:"form.argvRemove",items:d.testCommand,errorKey:errs.testCommand,hintKey:"form.testCommandHint",preview:true}),
    statusBlock(ctx,FORM),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"project-submit",dataset:{focusKey:"project-submit"},disabled:drafts.busy[FORM]===true,text:ctx.t("projects.form.submit")})));
  const details=h(doc,"details",{class:"panel form-panel",id:"project-new",open:drafts.open.project||Boolean(st)},
    h(doc,"summary",{id:"project-form-t",dataset:{focusKey:"project-summary"},text:ctx.t("projects.form.title")}),form);
  details.addEventListener("toggle",()=>{drafts.open.project=details.open===true});
  return details;
}

export async function render(ctx){
  const doc=ctx.doc,res=await ctx.api.projects();
  let body;
  if(res.state!=="VERIFIED")body=stateNote(ctx,res.state);
  else if(!res.items.length)body=emptyNote(ctx,"projects.empty");
  else body=h(doc,"ul",{class:"cards"},res.items.map(p=>{
    const active=ctx.store.projectId===p.projectId;
    return h(doc,"li",{class:`card${active?" card-active":""}`,dataset:{projectId:p.projectId}},
      h(doc,"h3",{text:p.name}),
      h(doc,"dl",{class:"kv"},h(doc,"dt",{text:ctx.t("projects.env")}),h(doc,"dd",{text:p.environmentId??"—"}),h(doc,"dt",{text:ctx.t("projects.tenant")}),h(doc,"dd",{text:p.tenantId??"—"}),h(doc,"dt",{text:ctx.t("projects.repo")}),h(doc,"dd",{class:"mono",text:p.repositoryPath??"—"}),h(doc,"dt",{text:ctx.t("projects.created")}),h(doc,"dd",{text:formatTime(p.createdAt,ctx.i18n.lang)}),h(doc,"dt",{text:ctx.t("projects.id")}),h(doc,"dd",{class:"mono",text:p.projectId})),
      h(doc,"button",{type:"button",class:"btn",disabled:active,"aria-pressed":active?"true":"false",on:{click:()=>ctx.selectProject(p.projectId)},text:ctx.t(active?"projects.selected":"projects.select")}));
  }));
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.projects.title")}),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:res.state==="VERIFIED"?"VERIFIED":res.state,value:res.items?.length??null}),h(doc,"span",{text:ctx.t("projects.source")})),
    projectForm(ctx),
    panel(ctx,{titleKey:"projects.list",id:"projects-list"},body));
}
