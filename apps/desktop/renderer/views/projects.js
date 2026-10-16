// //TR: UX WP-PROJECTS: Bu görünüm Project Studio girişidir ve Kurucu-Kokpiti sınıfı premium portföy katmanıdır: üstte gerçek /v1/projects + /v1/missions + /v1/work-runs okumalarından beslenen portföy özeti (KPI karoları), portföy geneli görev durumu şeridi ve proje başına yoğun bilgi kartları (bağlam/kapsam özeti + görev durumu dağılımı + son koşu) vardır. Hiçbir sayı/durum uydurulmaz: proje listesi yoksa dürüst boş/OFFLINE/UNAVAILABLE durumu gösterilir, görev/koşu verisi canlı değilse kart içinde dürüst "veri yok/kullanılamıyor" denir; yeni kapsam-hiyerarşisi arka ucu icat edilmez. WP2 token/kart/rozet bileşenleri yeniden kullanılır (palet değişmez). Alt kısımda "Yeni Proje" sihirbazı, "İçe Aktar" paneli ve B5 "mevcut yerel depoyu kaydet" formu korunur; bir proje açıldığında bağlamsal çalışma alanı (sekmeler) render edilir. API verisi asla HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır. Önceki B5 açıklaması: GET /v1/projects gerçek proje listesi ve "Yeni Proje" formu; gövde work-core kurucusuyla doğrulanır, her gönderim için idempotency anahtarı üretilir, proje seçimi store.selectProject ile önbelleği geçersiz kılar (DSK-061-06).
import {h,panel,stateNote,emptyNote,chip,kpiTile,statePill,missionPill,badge} from "../components.js";
import {formatTime,MISSING,missionPillKind} from "../model.js";
import {buildProjectRequest} from "../work-core.js";
import {latestRunFor} from "../project-core.js";
import {drafts,trackers,field,listEditor,statusBlock,setStatus,recordPost,resetProjectDraft,focusResult,settle} from "../forms.js";
import {studio,openProject,closeProject} from "../studio-state.js";
import {wizardPanel,importPanel} from "./studio-wizard.js";
import {renderWorkspace,stopRunPolling} from "./studio-workspace.js";

const FORM="project";
const FORM_KEYS=["id:project-submit","id:project-form-t"];
const inputOf=()=>({name:drafts.project.name,repositoryPath:drafts.project.repositoryPath,environmentId:drafts.project.environmentId,testCommand:drafts.project.testCommand});
// //TR: Görev durumu kategorilerinin yaşam-döngüsü sırası (soldan sağa); yalnız gerçekten mission bulunan kategoriler şeritte gösterilir. Bu, arka ucun bildirmediği bir "aşama" icat etmez, yalnız gerçek mission durumlarını kategoriye göre toplar.
const CATEGORY_ORDER=Object.freeze(["IDLE","WAITING","ACTIVE","ATTENTION","BLOCKED","FAILED","DONE","STOPPED","NEUTRAL"]);
const LIVE=r=>r&&(r.state==="VERIFIED"||r.state==="STALE");

/** Formu doğrular; geçerliyse idempotency anahtarıyla POST eder. Hiçbir otomatik gönderim yoktur: yalnız kullanıcı gönderimi çağırır. */
export async function submitProject(ctx){
  const check=buildProjectRequest(inputOf());
  if(!check.ok){setStatus(FORM,{ok:false,errors:check.errors});await ctx.rerender();focusResult(ctx,FORM,FORM_KEYS);return {ok:false,validation:true}}
  const key=trackers.project.keyFor(check.body),req=buildProjectRequest(inputOf(),{key});
  drafts.busy[FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[FORM]=false}
  const name=res?.body?.project?.name??check.body.name,ok=recordPost(FORM,res,"project.created",{name});
  if(ok){resetProjectDraft()}
  await ctx.refreshAll({force:true});focusResult(ctx,FORM,FORM_KEYS);return {ok};
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

// ---------- Premium portföy katmanı ----------
/** //TR: Dürüst veri bloğu kurar: değer yalnız kaynak canlıyken (VERIFIED/STALE) geçerli tamsayıdır, aksi halde null (karo "—" ve ayrık durum rozeti gösterir). */
const blockOf=(res,value,source)=>({state:res?.state??"ERROR",value:LIVE(res)?value:null,loading:false,source,asOf:null});

/** Portföy özeti KPI satırı: proje sayısı, farklı ortam sayısı, görev sayısı ve canlı koşu sayısı — hepsi gerçek okumalardan, uydurma yok. */
function summaryTiles(ctx,prj,miss,runs){
  const envs=LIVE(prj)?new Set(prj.items.map(p=>p.environmentId).filter(e=>typeof e==="string"&&e!=="")).size:null;
  const activeRuns=LIVE(runs)?runs.items.filter(r=>missionPillKind(r.status)==="ACTIVE").length:null;
  return h(ctx.doc,"div",{class:"kpi-row",role:"group","aria-label":ctx.t("projects.kpiGroup")},
    kpiTile(ctx,{id:"pf-projects",iconName:"folder",labelKey:"projects.kpi.projects",block:blockOf(prj,LIVE(prj)?prj.items.length:null,"GET /v1/projects"),qualifier:ctx.t("projects.kpi.q.projects")}),
    kpiTile(ctx,{id:"pf-environments",iconName:"building",labelKey:"projects.kpi.environments",block:blockOf(prj,envs,"GET /v1/projects"),qualifier:ctx.t("projects.kpi.q.environments")}),
    kpiTile(ctx,{id:"pf-missions",iconName:"tasks",labelKey:"projects.kpi.missions",block:blockOf(miss,LIVE(miss)?miss.items.length:null,"GET /v1/missions"),qualifier:ctx.t("projects.kpi.q.missions")}),
    kpiTile(ctx,{id:"pf-runs",iconName:"pulse",labelKey:"projects.kpi.activeRuns",block:blockOf(runs,activeRuns,"GET /v1/work-runs"),qualifier:ctx.t("projects.kpi.q.activeRuns"),live:LIVE(runs)&&activeRuns>0}));
}

/** //TR: Görev durumu şeridi: gerçek mission durumlarını kategoriye (missionPillKind) göre toplayıp sıralı rozet+sayı olarak gösterir. missions boşsa null döner (çağıran dürüst boş metni gösterir). */
function missionStrip(ctx,missions,{id,labelKey}){
  const doc=ctx.doc,counts=new Map();
  for(const m of missions)counts.set(missionPillKind(m.status),(counts.get(missionPillKind(m.status))??0)+1);
  const ordered=CATEGORY_ORDER.filter(k=>counts.has(k));
  if(!ordered.length)return null;
  const summary=ordered.map(k=>`${ctx.t(`pill.${k}`)} ${counts.get(k)}`).join(" · ");
  return h(doc,"ul",{class:"pf-strip",id,role:"group","aria-label":`${ctx.t(labelKey)}: ${summary}`},ordered.map(k=>
    h(doc,"li",{class:"pf-strip-item",dataset:{category:k,count:String(counts.get(k))}},statePill(ctx,k),h(doc,"strong",{class:"pf-strip-count",text:String(counts.get(k))}))));
}

/** Portföy geneli görev durumu şeridi; görev verisi canlı değilse dürüst durum, boşsa dürüst boş metin. */
function journeyPanel(ctx,miss){
  const doc=ctx.doc;
  let body;
  if(!LIVE(miss))body=stateNote(ctx,miss?.state??"ERROR");
  else if(!miss.items.length)body=emptyNote(ctx,"projects.journey.empty");
  else body=missionStrip(ctx,miss.items,{id:"projects-journey-strip",labelKey:"projects.journey.title"});
  return panel(ctx,{titleKey:"projects.journey.title",id:"projects-journey",className:"pf-journey"},
    h(doc,"p",{class:"note",text:ctx.t("projects.journey.lead")}),body);
}

/** Proje başına yoğun bilgi kartı: bağlam/kapsam özeti (ortam/şirket/depo/oluşturma/kimlik), görev durumu dağılımı ve son koşu; sonra Aç/Seç düğmeleri. */
function projectCard(ctx,p,{miss,runs,byProject,runsByProject}){
  const doc=ctx.doc,active=ctx.store.projectId===p.projectId;
  const facts=h(doc,"dl",{class:"kv pf-card-meta"},
    h(doc,"dt",{text:ctx.t("projects.env")}),h(doc,"dd",{text:p.environmentId??MISSING}),
    h(doc,"dt",{text:ctx.t("projects.tenant")}),h(doc,"dd",{text:p.tenantId??MISSING}),
    h(doc,"dt",{text:ctx.t("projects.repo")}),h(doc,"dd",{class:"mono",text:p.repositoryPath??MISSING}),
    h(doc,"dt",{text:ctx.t("projects.created")}),h(doc,"dd",{text:formatTime(p.createdAt,ctx.i18n.lang)}),
    h(doc,"dt",{text:ctx.t("projects.id")}),h(doc,"dd",{class:"mono",text:p.projectId}));
  // Görev durumu dağılımı: yalnız görev verisi canlıyken; aksi halde dürüst durum.
  let missionBody;
  if(!LIVE(miss))missionBody=h(doc,"p",{class:"note pf-card-note",text:ctx.t("projects.card.missionsUnavailable",{state:ctx.t(`state.${miss?.state??"ERROR"}`)})});
  else{
    const own=byProject.get(p.projectId)??[];
    missionBody=own.length?missionStrip(ctx,own,{id:`pf-strip-${p.projectId}`,labelKey:"projects.card.missions"}):h(doc,"p",{class:"note pf-card-note",text:ctx.t("projects.card.noMissions")});
  }
  // Son koşu: yalnız koşu+görev verisi canlıyken bu projenin mission'larına bağlı en son koşu; yoksa dürüst "koşu yok".
  let runBody;
  if(!LIVE(runs)||!LIVE(miss))runBody=h(doc,"p",{class:"note pf-card-note",text:ctx.t("projects.card.runUnavailable",{state:ctx.t(`state.${(!LIVE(runs)?runs?.state:miss?.state)??"ERROR"}`)})});
  else{
    const run=latestRunFor(runs.items,(runsByProject.get(p.projectId)??[]));
    runBody=run?h(doc,"p",{class:"pf-runline"},missionPill(ctx,run.status),h(doc,"span",{class:"mono pf-run-id",text:run.runId})):h(doc,"p",{class:"note pf-card-note",text:ctx.t("projects.card.noRun")});
  }
  return h(doc,"li",{class:`card pf-card${active?" card-active":""}`,dataset:{projectId:p.projectId},"aria-labelledby":`pf-card-${p.projectId}-t`},
    h(doc,"div",{class:"pf-card-head"},h(doc,"h3",{id:`pf-card-${p.projectId}-t`,text:p.name}),active?badge(ctx,ctx.t("projects.active"),"badge-ok"):null),
    facts,
    h(doc,"div",{class:"pf-card-section"},h(doc,"h4",{class:"pf-card-label",text:ctx.t("projects.card.missions")}),missionBody),
    h(doc,"div",{class:"pf-card-section"},h(doc,"h4",{class:"pf-card-label",text:ctx.t("projects.card.latestRun")}),runBody),
    h(doc,"div",{class:"btn-row"},
      h(doc,"button",{type:"button",class:"btn btn-primary",id:`open-${p.projectId}`,dataset:{focusKey:`open-${p.projectId}`},on:{click:async()=>{openProject(p.projectId);ctx.selectProject(p.projectId);await ctx.rerender();settle(ctx,["id:view-title"])}},text:ctx.t("studio.open")}),
      h(doc,"button",{type:"button",class:"btn",disabled:active,"aria-pressed":active?"true":"false",on:{click:()=>ctx.selectProject(p.projectId)},text:ctx.t(active?"projects.selected":"projects.select")})));
}

/** Komuta matrisi paneli: proje yoksa dürüst durum/boş, aksi halde yoğun kartlar. */
function matrixPanel(ctx,prj,miss,runs){
  const doc=ctx.doc;
  let body;
  if(!LIVE(prj))body=stateNote(ctx,prj.state);
  else if(!prj.items.length)body=emptyNote(ctx,"projects.empty");
  else{
    // Görevleri ve koşuları projelere gerçek verisiyle eşle (mission.projectId; koşu -> mission -> proje).
    const byProject=new Map();if(LIVE(miss))for(const m of miss.items){if(!byProject.has(m.projectId))byProject.set(m.projectId,[]);byProject.get(m.projectId).push(m)}
    const missionToProject=new Map();if(LIVE(miss))for(const m of miss.items)missionToProject.set(m.missionId,m.projectId);
    const runsByProject=new Map();
    if(LIVE(miss))for(const r of (LIVE(runs)?runs.items:[])){const pid=missionToProject.get(r.missionId);if(pid){if(!runsByProject.has(pid))runsByProject.set(pid,[]);runsByProject.get(pid).push(r.missionId)}}
    body=h(doc,"ul",{class:"cards pf-cards"},prj.items.map(p=>projectCard(ctx,p,{miss,runs,byProject,runsByProject})));
  }
  return panel(ctx,{titleKey:"projects.matrix.title",id:"projects-list",className:"pf-matrix"},
    h(doc,"p",{class:"note",text:ctx.t("projects.matrix.lead")}),body);
}

function header(ctx,prj,miss,runs){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("projects.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.projects.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("projects.subtitle")}),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:prj.state==="VERIFIED"?"VERIFIED":prj.state,value:prj.items?.length??null}),h(doc,"span",{text:ctx.t("projects.source")})));
}

export async function render(ctx){
  const doc=ctx.doc,res=await ctx.api.projects();
  if(studio.projectId&&res.state==="VERIFIED"){
    const open=res.items.find(x=>x.projectId===studio.projectId);
    if(open)return renderWorkspace(ctx,open,res.items,{onBack:async()=>{const pid=studio.projectId;stopRunPolling();closeProject();await ctx.rerender();settle(ctx,[`id:open-${pid}`,"id:view-title"])}});
    closeProject();
  }
  // Portföy katmanı için görev ve koşu okumaları (salt-okunur, allow-list'li, önbellekli); canlı değilse dürüst durum gösterilir, sayı uydurulmaz.
  const [miss,runs]=await Promise.all([ctx.api.allMissions(),ctx.api.workRuns()]);
  return h(doc,"div",{class:"view view-projects"},
    header(ctx,res,miss,runs),
    summaryTiles(ctx,res,miss,runs),
    journeyPanel(ctx,miss),
    wizardPanel(ctx),
    importPanel(ctx,{projects:res.state==="VERIFIED"?res.items:[]}),
    matrixPanel(ctx,res,miss,runs),
    projectForm(ctx));
}
