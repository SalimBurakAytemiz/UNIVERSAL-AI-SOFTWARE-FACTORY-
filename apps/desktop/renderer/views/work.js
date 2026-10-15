// //TR: Bu görünüm Görevler / Work OS alanıdır: mission listesi (durum filtreli), "Yeni Görev" formu (proje, başlık, hedef, kabul kriterleri listesi, R0–R4 risk açıklamaları, isteğe bağlı argv test komutu), mission detayı (durum zaman çizelgesi, yalnız izinli sonraki geçişler, yüksek riskli geçişlerde onay penceresi, Çalıştır) ve /v1/work-runs koşu zaman çizelgesi; sunucu verisi yoksa dürüst UNAVAILABLE gösterilir, ilerleme uydurulmaz.
import {h,panel,stateNote,emptyNote,chip,statusPill,statusLabel,badge,verificationChip} from "../components.js";
import {formatTime,MISSING} from "../model.js";
import {MISSION_STATUSES,MISSION_PATH,RISK_LEVELS,allowedNext,requiresConfirm,canStartRun,buildMissionRequest,filterMissions,formatDateTime} from "../work-core.js";
import {drafts,selection,trackers,field,listEditor,statusBlock,setStatus,recordPost,resetMissionDraft,focusResult} from "../forms.js";
import {performTransition,startRun,actionStatusId} from "../work-actions.js";

const FORM="mission";
const RUN_DETAIL_LIMIT=5;
const inputOf=()=>({projectId:drafts.mission.projectId,title:drafts.mission.title,objective:drafts.mission.objective,acceptanceCriteria:drafts.mission.criteria,riskLevel:drafts.mission.riskLevel,testCommand:drafts.mission.testCommand});

/** Formu doğrular; geçerliyse idempotency anahtarıyla POST eder (yalnız kullanıcı gönderimi çağırır). */
export async function submitMission(ctx){
  const check=buildMissionRequest(inputOf());
  if(!check.ok){setStatus(FORM,{ok:false,errors:check.errors});await ctx.rerender();focusResult(ctx,FORM,["id:mission-submit","id:mission-form-t"]);return {ok:false,validation:true}}
  const key=trackers.mission.keyFor(check.body),req=buildMissionRequest(inputOf(),{key});
  drafts.busy[FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[FORM]=false}
  const title=res?.body?.mission?.title??check.body.title,ok=recordPost(FORM,res,"mission.created",{title});
  if(ok){const id=res?.body?.mission?.missionId;if(typeof id==="string")selection.missionId=id;resetMissionDraft()}
  await ctx.refreshAll({force:true});focusResult(ctx,FORM,["id:mission-submit","id:mission-form-t"]);return {ok};
}
function missionForm(ctx,projects){
  const doc=ctx.doc,st=drafts.status[FORM],errs=st?.errors??{},d=drafts.mission;
  if(!d.projectId||!projects.some(p=>p.projectId===d.projectId))d.projectId=projects.some(p=>p.projectId===ctx.store.projectId)?ctx.store.projectId:(projects[0]?.projectId??"");
  const form=h(doc,"form",{id:"mission-form",novalidate:true,"aria-labelledby":"mission-form-t",on:{submit:e=>{e.preventDefault();if(!drafts.busy[FORM])submitMission(ctx)}}},
    field(ctx,{id:"mission-project",labelKey:"work.form.project",value:d.projectId,onInput:v=>{d.projectId=v},errorKey:errs.projectId,required:true,options:projects.length?projects.map(p=>({value:p.projectId,label:p.name})):[{value:"",label:ctx.t("work.form.noProjects")}]}),
    field(ctx,{id:"mission-title",labelKey:"work.form.title",value:d.title,onInput:v=>{d.title=v},errorKey:errs.title,required:true}),
    field(ctx,{id:"mission-objective",labelKey:"work.form.objective",value:d.objective,onInput:v=>{d.objective=v},errorKey:errs.objective,multiline:true,required:true}),
    listEditor(ctx,{id:"mission-criteria",labelKey:"work.form.criteria",itemLabelKey:"work.form.criterionN",addKey:"work.form.criterionAdd",removeKey:"work.form.criterionRemove",items:d.criteria,errorKey:errs.acceptanceCriteria,hintKey:"work.form.criteriaHint",multiline:true,required:true}),
    field(ctx,{id:"mission-risk",labelKey:"work.form.risk",value:d.riskLevel,onInput:v=>{d.riskLevel=v},errorKey:errs.riskLevel,required:true,hintKey:"work.form.riskHint",options:RISK_LEVELS.map(r=>({value:r,label:`${r} — ${ctx.t(`risk.${r}.name`)}`}))}),
    h(doc,"dl",{class:"kv risk-legend","aria-label":ctx.t("work.form.riskLegend")},RISK_LEVELS.flatMap(r=>[h(doc,"dt",{text:`${r} — ${ctx.t(`risk.${r}.name`)}`}),h(doc,"dd",{text:ctx.t(`risk.${r}.desc`)})])),
    listEditor(ctx,{id:"mission-test",labelKey:"form.testCommand",itemLabelKey:"form.argvToken",addKey:"form.argvAdd",removeKey:"form.argvRemove",items:d.testCommand,errorKey:errs.testCommand,hintKey:"form.testCommandHint",preview:true}),
    statusBlock(ctx,FORM),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"submit",class:"btn btn-primary",id:"mission-submit",dataset:{focusKey:"mission-submit"},disabled:drafts.busy[FORM]===true||!projects.length,text:ctx.t("work.form.submit")})));
  const details=h(doc,"details",{class:"panel form-panel",id:"mission-new",open:drafts.open.mission||Boolean(st)},
    h(doc,"summary",{id:"mission-form-t",dataset:{focusKey:"mission-summary"},text:ctx.t("work.form.title2")}),form);
  details.addEventListener("toggle",()=>{drafts.open.mission=details.open===true});
  return details;
}

function filterBar(ctx,items){
  const doc=ctx.doc,counts=new Map();for(const m of items)counts.set(m.status,(counts.get(m.status)??0)+1);
  const keys=["ALL",...MISSION_STATUSES.filter(s=>counts.has(s))];
  if(!keys.includes(drafts.missionFilter))drafts.missionFilter="ALL";
  return h(doc,"div",{class:"btn-row filter-bar",role:"group","aria-label":ctx.t("work.filter.label")},keys.map(k=>h(doc,"button",{type:"button",class:"btn",id:`mf-${k}`,dataset:{filter:k,focusKey:`mf-${k}`},"aria-pressed":drafts.missionFilter===k?"true":"false",
    on:{click:()=>{drafts.missionFilter=k;ctx.rerender()}},text:`${k==="ALL"?ctx.t("work.filter.all"):statusLabel(ctx,k)} (${k==="ALL"?items.length:counts.get(k)})`})));
}
function missionTable(ctx,items,projectNames){
  const doc=ctx.doc,shown=filterMissions(items,drafts.missionFilter);
  if(!shown.length)return emptyNote(ctx,"work.filter.none");
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("work.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["work.col.title","work.col.project","work.col.status","work.col.risk","work.col.created"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},shown.map(m=>{
      const sel=selection.missionId===m.missionId;
      return h(doc,"tr",{class:sel?"row-selected":null},
        h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn",dataset:{missionId:m.missionId},"aria-current":sel?"true":null,on:{click:()=>{selection.missionId=m.missionId;ctx.rerender()}},text:m.title})),
        h(doc,"td",{text:projectNames.get(m.projectId)??MISSING}),h(doc,"td",{},statusPill(ctx,m.status)),h(doc,"td",{text:m.riskLevel}),h(doc,"td",{text:formatTime(m.createdAt,ctx.i18n.lang)}));
    }))));
}
/** Durum zaman çizelgesi: mutlu yol sırası; geçilmiş adımlar yalnız yaşam döngüsü sırasından çıkarılır, yol dışı durum ayrıca vurgulanır. */
export function statusTimeline(ctx,status){
  const doc=ctx.doc,idx=MISSION_PATH.indexOf(status),offPath=idx<0;
  return h(doc,"ol",{class:"status-timeline","aria-label":ctx.t("work.timeline.label")},[
    ...MISSION_PATH.map((s,i)=>{
      const cur=s===status,done=!offPath&&i<idx,state=cur?"current":done?"done":"todo";
      return h(doc,"li",{class:`step-${state}`,dataset:{step:s,state},"aria-current":cur?"step":null},h(doc,"span",{class:"step-mark","aria-hidden":"true",text:cur?"●":done?"✓":"○"}),h(doc,"span",{text:statusLabel(ctx,s)}),h(doc,"span",{class:"sr-only",text:` — ${ctx.t(`work.timeline.${state}`)}`}));
    }),
    offPath?h(doc,"li",{class:"step-current step-off",dataset:{step:status,state:"current"},"aria-current":"step"},h(doc,"span",{class:"step-mark","aria-hidden":"true",text:"●"}),h(doc,"span",{text:statusLabel(ctx,status)}),h(doc,"span",{class:"sr-only",text:` — ${ctx.t("work.timeline.offPath")}`})):null]);
}
export function runCard(ctx,run){
  const doc=ctx.doc,lang=ctx.i18n.lang,step=run.step?`${run.step.name??MISSING}${run.step.index!==null?` (${run.step.index}${run.step.total!==null?`/${run.step.total}`:""})`:""}`:MISSING;
  const ev=run.evidence.length?h(doc,"ul",{class:"evidence-links"},run.evidence.map(e=>h(doc,"li",{},
    e.evidenceId?h(doc,"button",{type:"button",class:"link-btn",dataset:{focusKey:`ev-${run.runId}-${e.evidenceId}`},on:{click:()=>{selection.evidenceId=e.evidenceId;ctx.navigate("assurance")}},text:`${e.kind??ctx.t("evidence.kindUnknown")} · ${e.evidenceId}`}):h(doc,"span",{text:e.kind??MISSING}),
    " ",verificationChip(ctx,e.verification)))):h(doc,"p",{class:"note",text:ctx.t("run.noEvidence")});
  const cps=run.checkpoints.length?h(doc,"ol",{class:"checkpoints"},run.checkpoints.map(c=>h(doc,"li",{},h(doc,"span",{text:c.name}),c.status?statusPill(ctx,c.status):null,h(doc,"time",{text:formatDateTime(c.at,lang)})))):h(doc,"p",{class:"note",text:ctx.t(run.checkpointsReported===false?"run.checkpointsNotReported":"run.noCheckpoints")});
  return h(doc,"li",{class:"card run-card",dataset:{runId:run.runId,runStatus:run.status}},
    h(doc,"h5",{},h(doc,"span",{class:"mono",text:run.runId})," ",statusPill(ctx,run.status)),
    h(doc,"dl",{class:"kv"},
      h(doc,"dt",{text:ctx.t("run.step")}),h(doc,"dd",{text:step}),
      h(doc,"dt",{text:ctx.t("run.role")}),h(doc,"dd",{text:run.role??MISSING}),
      h(doc,"dt",{text:ctx.t("run.started")}),h(doc,"dd",{text:formatDateTime(run.startedAt,lang)}),
      h(doc,"dt",{text:ctx.t("run.heartbeat")}),h(doc,"dd",{text:formatDateTime(run.heartbeatAt,lang)}),
      h(doc,"dt",{text:ctx.t("run.lease")}),h(doc,"dd",{text:formatDateTime(run.leaseExpiresAt,lang)}),
      h(doc,"dt",{text:ctx.t("run.reviewer")}),h(doc,"dd",{text:run.reviewer?.identity??ctx.t("run.reviewerNone")}),
      h(doc,"dt",{text:ctx.t("run.verdict")}),h(doc,"dd",{text:run.reviewer?.verdict?statusLabel(ctx,run.reviewer.verdict):ctx.t("run.verdictNone")})),
    h(doc,"h6",{text:ctx.t("run.checkpoints")}),cps,h(doc,"h6",{text:ctx.t("run.evidence")}),ev);
}
function runsSection(ctx,runsRes,details){
  const doc=ctx.doc;
  if(runsRes.state!=="VERIFIED")return stateNote(ctx,runsRes.state,runsRes.state==="UNAVAILABLE"?"run.unavailable":undefined);
  if(!runsRes.items.length)return emptyNote(ctx,"run.none");
  return h(doc,"ul",{class:"cards run-list"},runsRes.items.map(r=>runCard(ctx,details.get(r.runId)??r)));
}
function transitionControls(ctx,mission){
  const doc=ctx.doc,next=allowedNext(mission.status),sid=actionStatusId(mission.missionId),busy=drafts.busy[sid]===true;
  const reasonField=field(ctx,{id:"tr-reason",labelKey:"work.transition.reason",value:drafts.reasons[mission.missionId]??"",onInput:v=>{drafts.reasons[mission.missionId]=v},hintKey:"work.transition.reasonHint"});
  const buttons=next.map(to=>h(doc,"button",{type:"button",class:`btn${requiresConfirm(to)?" btn-primary":""}`,id:`tr-${to}`,dataset:{focusKey:`tr-${to}`,to,confirm:requiresConfirm(to)?"true":"false"},disabled:busy,
    on:{click:()=>performTransition(ctx,{missionId:mission.missionId,title:mission.title,from:mission.status,to,reason:drafts.reasons[mission.missionId]??""})},
    text:requiresConfirm(to)?ctx.t("work.transition.toConfirm",{to:statusLabel(ctx,to)}):ctx.t("work.transition.to",{to:statusLabel(ctx,to)})}));
  const startable=canStartRun(mission.status);
  const runBtn=h(doc,"button",{type:"button",class:"btn btn-primary",id:"run-start",dataset:{focusKey:"run-start"},disabled:!startable||busy,"aria-describedby":"run-start-hint",on:{click:()=>startRun(ctx,{missionId:mission.missionId,status:mission.status})},text:ctx.t("work.run.start")});
  return h(doc,"div",{class:"transition-controls"},
    h(doc,"h4",{text:ctx.t("work.transition.title")}),
    next.length?h(doc,"div",{},reasonField,h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("work.transition.title")},buttons),h(doc,"p",{class:"field-hint",text:ctx.t("work.transition.confirmNote")})):h(doc,"p",{class:"note",text:ctx.t("work.transition.terminal")}),
    h(doc,"h4",{text:ctx.t("work.run.title")}),h(doc,"div",{class:"btn-row"},runBtn),
    h(doc,"p",{class:"field-hint",id:"run-start-hint",text:ctx.t(startable?"work.run.hintOk":"work.run.hintNot")}),
    statusBlock(ctx,sid));
}
function detailPanel(ctx,detail,runsRes,runDetails){
  const doc=ctx.doc;
  if(detail.state!=="VERIFIED")return panel(ctx,{titleKey:"work.detail",id:"work-detail"},stateNote(ctx,detail.state));
  const m=detail.mission;
  return panel(ctx,{titleKey:"work.detail",id:"work-detail"},
    h(doc,"h3",{text:m.title}),
    h(doc,"p",{class:"panel-meta"},statusPill(ctx,m.status),badge(ctx,m.riskLevel,"badge-risk"),h(doc,"span",{class:"mono",text:m.missionId})),
    h(doc,"p",{text:m.objective}),
    h(doc,"h4",{text:ctx.t("work.detail.criteria")}),m.acceptanceCriteria.length?h(doc,"ul",{},m.acceptanceCriteria.map(c=>h(doc,"li",{text:c}))):emptyNote(ctx,"work.detail.noCriteria"),
    m.tasks.length?h(doc,"div",{},h(doc,"h4",{text:ctx.t("work.detail.tasks")}),h(doc,"ul",{},m.tasks.map(t=>h(doc,"li",{},t.title," ",statusPill(ctx,t.status))))):null,
    h(doc,"h4",{text:ctx.t("work.timeline.title")}),statusTimeline(ctx,m.status),
    transitionControls(ctx,m),
    h(doc,"h4",{text:ctx.t("run.timeline")}),runsSection(ctx,runsRes,runDetails));
}

export async function render(ctx){
  const doc=ctx.doc,[res,projRes]=await Promise.all([ctx.api.missions(),ctx.api.projects()]);
  const projects=projRes.state==="VERIFIED"?projRes.items:[],names=new Map(projects.map(p=>[p.projectId,p.name]));
  let body;
  if(res.state!=="VERIFIED")body=stateNote(ctx,res.state);
  else if(!res.items.length)body=emptyNote(ctx,"work.empty");
  else body=h(doc,"div",{},filterBar(ctx,res.items),missionTable(ctx,res.items,names));
  let detailNode=null;
  if(selection.missionId){
    const [detail,runsRes]=await Promise.all([ctx.api.missionDetail(selection.missionId),ctx.api.workRuns({missionId:selection.missionId})]);
    const runDetails=new Map();
    if(runsRes.state==="VERIFIED")await Promise.all(runsRes.items.slice(0,RUN_DETAIL_LIMIT).map(async r=>{const d=await ctx.api.workRunDetail(r.runId);if(d.state==="VERIFIED"&&d.run)runDetails.set(r.runId,d.run)}));
    detailNode=detailPanel(ctx,detail,runsRes,runDetails);
  }
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.work.title")}),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:res.state,value:res.items?.length??null}),h(doc,"span",{text:ctx.store.projectId?ctx.t("work.scopeProject"):ctx.t("work.scopeAll")})),
    missionForm(ctx,projects),
    panel(ctx,{titleKey:"work.list",id:"work-list"},body),
    detailNode);
}
