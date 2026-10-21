// //TR: Bu görünüm Görevler / Work OS alanıdır ve UX WP-WORKOS ile Kurucu-Kokpiti sınıfı premium katmana yükseltilmiştir: üstte gerçek /v1/missions + /v1/work-runs okumalarından beslenen görev/koşu özeti (KPI karoları: toplam mission, etkin koşu, Kurucu dikkati bekleyen, gerçekten doğrulanmış koşu) ve yaşam-döngüsü dağılım şeridi vardır. Alt kısımda "Yeni Görev" formu (proje, başlık, hedef, kabul kriterleri listesi, R0–R4 risk açıklamaları, isteğe bağlı argv test komutu), mission listesi (durum filtreli), mission detayı (durum/faz/risk, izinli geçişler, yüksek riskli geçişlerde onay, Çalıştır), /v1/work-runs koşu zaman çizelgesi + koşu kartları ve /v1/evidence kanıt bağlama bölümü korunur/eklenir. WP2/WP-PROJECTS token ve bileşenleri (kpiTile/statePill/missionPill/timelineItem) yeniden kullanılır (palet değişmez, yeni token yok). Hiçbir sayı/durum uydurulmaz: veri canlı değilse dürüst UNAVAILABLE/OFFLINE, boşsa dürüst boş metin; koşu yalnız gerçek test-yürütme kanıtı varsa doğrulanmış sayılır (FD-REL-1; SOURCE_GENERATION_COMPLETE != PRODUCT_VERIFIED), aksi halde NOT_VERIFIED dürüstçe gösterilir. API verisi asla HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {planFormPanel} from "./plan-form.js";
import {taskStatusControls} from "./task-status.js";
import {taskRunsPanel,loadTaskRuns} from "./task-runs.js";
import {h,panel,stateNote,emptyNote,chip,statusPill,statusLabel,badge,verificationChip,kpiTile,statePill,missionPill,timelineItem} from "../components.js";
import {formatTime,formatCount,MISSING,missionPillKind} from "../model.js";
import {MISSION_STATUSES,MISSION_PATH,RISK_LEVELS,RUN_EXPERTS,RUN_EXPERT_NONE,allowedNext,requiresConfirm,canStartRun,buildMissionRequest,filterMissions,formatDateTime,deriveTaskInspector,deriveWorkTimeline,runReadiness,runReasonHintKey,runStepRows} from "../work-core.js";
import {drafts,selection,trackers,field,listEditor,statusBlock,setStatus,recordPost,resetMissionDraft,focusResult} from "../forms.js";
import {performTransition,startRun,actionStatusId} from "../work-actions.js";
import {notVerifiedBadge,runNotVerified,missionNotVerified,axisBadges} from "../m1a.js";
import {canOfferComplete} from "../delivery-core.js";
import {BOARD_LAYOUTS,boardLayout,setBoardLayout,boardColumns} from "../kanban-core.js";

const FORM="mission";
const RUN_DETAIL_LIMIT=5;
const RUN_TIMELINE_LIMIT=8;
const EVIDENCE_LIMIT=12;
// //TR: Görev durumu kategorilerinin yaşam-döngüsü sırası (soldan sağa); yalnız gerçekten mission bulunan kategoriler şeritte gösterilir. Bu, arka ucun bildirmediği bir "aşama" icat etmez, yalnız gerçek mission durumlarını kategoriye göre toplar (WP-PROJECTS ile aynı sıra).
const CATEGORY_ORDER=Object.freeze(["IDLE","WAITING","ACTIVE","ATTENTION","BLOCKED","FAILED","DONE","STOPPED","NEUTRAL"]);
let inspectedTask=null;
const LIVE=r=>r&&(r.state==="VERIFIED"||r.state==="STALE");
const inputOf=()=>({projectId:drafts.mission.projectId,title:drafts.mission.title,objective:drafts.mission.objective,acceptanceCriteria:drafts.mission.criteria,riskLevel:drafts.mission.riskLevel,testCommand:drafts.mission.testCommand});

// ---------- Premium görev/koşu özeti katmanı (UX WP-WORKOS) ----------
/** //TR: Dürüst veri bloğu: değer yalnız kaynak canlıyken (VERIFIED/STALE) geçerli tamsayıdır, aksi halde null (karo "—" ve ayrık durum rozeti gösterir). */
const blockOf=(res,value,source)=>({state:res?.state??"ERROR",value:LIVE(res)?value:null,loading:false,source,asOf:null});

/** //TR: Görev/koşu özeti KPI satırı — hepsi gerçek okumalardan: toplam mission, etkin koşu (ACTIVE kategorisi), Kurucu dikkati bekleyen mission (ATTENTION+BLOCKED) ve gerçekten doğrulanmış koşu (yalnız test-yürütme kanıtı olan; FD-REL-1). Hiçbir sayı uydurulmaz. */
function summaryTiles(ctx,miss,runs){
  const activeRuns=LIVE(runs)?runs.items.filter(r=>missionPillKind(r.status)==="ACTIVE").length:null;
  const attention=LIVE(miss)?miss.items.filter(m=>{const k=missionPillKind(m.status);return k==="ATTENTION"||k==="BLOCKED"}).length:null;
  const verifiedRuns=LIVE(runs)?runs.items.filter(r=>r&&r.testsExecuted===true).length:null;
  return h(ctx.doc,"div",{class:"kpi-row",role:"group","aria-label":ctx.t("work.kpiGroup")},
    kpiTile(ctx,{id:"wk-missions",iconName:"tasks",labelKey:"work.kpi.missions",block:blockOf(miss,LIVE(miss)?miss.items.length:null,"GET /v1/missions"),qualifier:ctx.t("work.kpi.q.missions")}),
    kpiTile(ctx,{id:"wk-active",iconName:"pulse",labelKey:"work.kpi.activeRuns",block:blockOf(runs,activeRuns,"GET /v1/work-runs"),qualifier:ctx.t("work.kpi.q.activeRuns"),live:LIVE(runs)&&activeRuns>0}),
    kpiTile(ctx,{id:"wk-attention",iconName:"alert",labelKey:"work.kpi.attention",block:blockOf(miss,attention,"GET /v1/missions"),qualifier:ctx.t("work.kpi.q.attention"),risk:LIVE(miss)&&attention>0}),
    kpiTile(ctx,{id:"wk-verified",iconName:"shield",labelKey:"work.kpi.verifiedRuns",block:blockOf(runs,verifiedRuns,"GET /v1/work-runs"),qualifier:ctx.t("work.kpi.q.verifiedRuns")}));
}

/** //TR: Yaşam-döngüsü dağılım şeridi: gerçek mission durumlarını kategoriye (missionPillKind) göre toplayıp sıralı rozet+sayı olarak gösterir; mission yoksa null (çağıran dürüst boş metni gösterir). */
function lifecycleStrip(ctx,missions,{id,labelKey}){
  const doc=ctx.doc,counts=new Map();
  for(const m of missions)counts.set(missionPillKind(m.status),(counts.get(missionPillKind(m.status))??0)+1);
  const ordered=CATEGORY_ORDER.filter(k=>counts.has(k));
  if(!ordered.length)return null;
  const summary=ordered.map(k=>`${ctx.t(`pill.${k}`)} ${counts.get(k)}`).join(" · ");
  return h(doc,"ul",{class:"pf-strip",id,role:"group","aria-label":`${ctx.t(labelKey)}: ${summary}`},ordered.map(k=>
    h(doc,"li",{class:"pf-strip-item",dataset:{category:k,count:String(counts.get(k))}},statePill(ctx,k),h(doc,"strong",{class:"pf-strip-count",text:String(counts.get(k))}))));
}

/** //TR: Özet paneli: yaşam-döngüsü dağılımı; görev verisi canlı değilse dürüst durum, boşsa dürüst boş metin. Sayı/aşama uydurulmaz. */
function overviewPanel(ctx,miss){
  const doc=ctx.doc;
  let body;
  if(!LIVE(miss))body=stateNote(ctx,miss?.state??"ERROR");
  else if(!miss.items.length)body=emptyNote(ctx,"work.overview.empty");
  else body=lifecycleStrip(ctx,miss.items,{id:"work-overview-strip",labelKey:"work.overview.title"});
  return panel(ctx,{titleKey:"work.overview.title",id:"work-overview",className:"pf-journey"},
    h(doc,"p",{class:"note",text:ctx.t("work.overview.lead")}),body);
}

/** //TR: Yoğun koşu zaman çizelgesi: bu mission'a bağlı koşuların kronolojik premium özeti (başlangıç zamanı + durum rozeti + adım); yalnız koşu verisi canlıysa ve koşu varsa render edilir. Ayrıntılı koşu kartları ayrıca altta kalır. */
function runTimeline(ctx,runsRes){
  const doc=ctx.doc;
  if(runsRes.state!=="VERIFIED"||!runsRes.items.length)return null;
  const items=[...runsRes.items].sort((a,b)=>String(b.startedAt??"").localeCompare(String(a.startedAt??""))).slice(0,RUN_TIMELINE_LIMIT);
  // //TR: Zaman çizelgesi yalnız durum + adımı gösterir; doğrulama/NOT_VERIFIED rozeti yinelenmez (ayrıntılı koşu kartında ve özet KPI'da dürüstçe zaten vardır), böylece tek koşu-kapsamlı rozet değişmezi (M1a) korunur.
  return h(doc,"ol",{class:"timeline run-timeline",id:"work-run-timeline","aria-label":ctx.t("work.runtl.title")},items.map(r=>{
    const step=r.step?`${r.step.name??MISSING}${r.step.index!==null?` (${r.step.index}${r.step.total!==null?`/${r.step.total}`:""})`:""}`:null;
    return timelineItem(ctx,{time:formatTime(r.startedAt,ctx.i18n.lang),iso:r.startedAt??undefined,title:r.runId,
      attribution:r.role??undefined,pill:missionPill(ctx,r.status),
      meta:step?h(doc,"span",{class:"tl-step"},h(doc,"span",{text:step})):null});
  }));
}

/** //TR: Kanıt bağlama bölümü: GET /v1/evidence (missionId süzgeçli) gerçek kanıt kayıtlarını listeler; her kayıt tür + doğrulama çipi (yalnız gerçek "VERIFIED" doğrulanmış sayılır) + kaynak yol + zaman taşır ve Güvence görünümüne bağlanır. Veri canlı değilse dürüst durum, boşsa dürüst boş metin; kanıt uydurulmaz. */
function evidenceSection(ctx,evRes){
  const doc=ctx.doc;
  if(!evRes||evRes.state!=="VERIFIED")return stateNote(ctx,evRes?.state??"ERROR",evRes?.state==="UNAVAILABLE"?"work.evidence.unavailable":undefined);
  if(!evRes.items.length)return emptyNote(ctx,"work.evidence.none");
  const shown=evRes.items.slice(0,EVIDENCE_LIMIT);
  return h(doc,"ul",{class:"cards evidence-list",id:"work-evidence-list"},shown.map(e=>
    h(doc,"li",{class:"card evidence-item",dataset:{evidenceId:e.evidenceId}},
      h(doc,"div",{class:"evidence-head"},
        h(doc,"button",{type:"button",class:"link-btn",dataset:{focusKey:`wev-${e.evidenceId}`},on:{click:()=>{selection.evidenceId=e.evidenceId;ctx.navigate("assurance")}},text:`${e.kind??ctx.t("evidence.kindUnknown")} · ${e.evidenceId}`}),
        verificationChip(ctx,e.verification)),
      e.runId?h(doc,"p",{class:"note evidence-meta"},h(doc,"span",{class:"mono",text:e.runId})):null,
      e.sourcePath?h(doc,"p",{class:"note evidence-meta mono",text:e.sourcePath}):null,
      h(doc,"p",{class:"note evidence-meta"},h(doc,"time",{text:formatDateTime(e.createdAt,ctx.i18n.lang)})))));
}

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
function missionTable(ctx,items,projectNames,allRuns){
  const doc=ctx.doc,shown=filterMissions(items,drafts.missionFilter);
  if(!shown.length)return emptyNote(ctx,"work.filter.none");
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("work.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["work.col.title","work.col.project","work.col.status","work.col.risk","work.col.created"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},shown.map(m=>{
      const sel=selection.missionId===m.missionId;
      return h(doc,"tr",{class:sel?"row-selected":null},
        h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn",dataset:{missionId:m.missionId},"aria-current":sel?"true":null,on:{click:()=>{selection.missionId=m.missionId;ctx.rerender()}},text:m.title})),
        h(doc,"td",{text:projectNames.get(m.projectId)??MISSING}),h(doc,"td",{},statusPill(ctx,m.status),missionNotVerified(allRuns,m.missionId)?[" ",notVerifiedBadge(ctx,"mission")]:null),h(doc,"td",{text:m.riskLevel}),h(doc,"td",{text:formatTime(m.createdAt,ctx.i18n.lang)}));
    }))));
}
// ---------- UI-023 Görev Kanban Panosu (liste/pano düzeni) ----------
/** //TR: Düzen seçici: liste (varsayılan, mevcut filtre+tablo) ya da pano; yalnız bellek-içi oturum durumu, depo/ağ yok. */
function layoutToggle(ctx){
  const doc=ctx.doc,cur=boardLayout();
  return h(doc,"div",{class:"btn-row layout-toggle",role:"group","aria-label":ctx.t("work.board.layout")},BOARD_LAYOUTS.map(k=>h(doc,"button",{type:"button",class:"btn",id:`wl-${k}`,dataset:{layout:k,focusKey:`wl-${k}`},"aria-pressed":cur===k?"true":"false",
    on:{click:()=>{if(setBoardLayout(k))ctx.rerender()}},text:ctx.t(`work.board.layout.${k}`)})));
}
/** //TR: Pano kartı: başlık düğmesi mission ayrıntısını açar (geçişler orada, mevcut onay kurallarıyla); tanınmayan durum ham değeriyle rozetlenir. */
function boardCard(ctx,m,known,projectNames,allRuns){
  const doc=ctx.doc,sel=selection.missionId===m.missionId;
  return h(doc,"li",{class:"kanban-card",dataset:{boardMission:m.missionId,selected:sel?"1":"0"}},
    h(doc,"button",{type:"button",class:"link-btn kanban-card-title",dataset:{focusKey:`kb-${m.missionId}`},"aria-current":sel?"true":null,on:{click:()=>{selection.missionId=m.missionId;ctx.rerender()}},text:m.title??MISSING}),
    h(doc,"p",{class:"kanban-card-meta"},h(doc,"span",{text:projectNames.get(m.projectId)??MISSING})," · ",h(doc,"span",{class:"badge",text:m.riskLevel??MISSING})," · ",
      h(doc,"time",{datetime:m.createdAt??undefined,text:formatTime(m.createdAt,ctx.i18n.lang)})),
    known?null:h(doc,"p",{class:"kanban-card-raw"},statusPill(ctx,m.status)),
    missionNotVerified(allRuns,m.missionId)?h(doc,"p",{class:"kanban-card-badges"},notVerifiedBadge(ctx,"mission")):null);
}
function boardColumn(ctx,c,projectNames,allRuns){
  const doc=ctx.doc,id=`kb-col-${c.status.toLowerCase()}`,label=c.known?statusLabel(ctx,c.status):ctx.t("work.board.unrecognized");
  return h(doc,"section",{class:"kanban-col","aria-labelledby":`${id}-t`,dataset:{boardColumn:c.status,count:String(c.count)}},
    h(doc,"h3",{class:"kanban-col-title",id:`${id}-t`},h(doc,"span",{text:label})," ",h(doc,"span",{class:"kanban-col-count",text:String(c.count)})),
    c.truncated?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:ctx.t("work.board.shown",{shown:c.items.length,total:c.count})}):null,
    c.count?h(doc,"ul",{class:"kanban-cards","aria-label":ctx.t("work.board.colAria",{status:label,count:c.count})},c.items.map(m=>boardCard(ctx,m,c.known,projectNames,allRuns)))
      :h(doc,"p",{class:"note kanban-empty",text:ctx.t("work.board.colEmpty")}));
}
/** //TR: Görev panosu: sütunlar yaşam döngüsü sırasındadır; her mission tam bir sütunda, tanınmayan durumlar ayrı sütunda (atılmaz). */
function missionBoard(ctx,items,projectNames,allRuns){
  const doc=ctx.doc;
  return h(doc,"div",{class:"kanban",id:"work-board",role:"group","aria-label":ctx.t("work.board.aria",{total:items.length})},
    h(doc,"p",{class:"note",dataset:{note:"board-honesty"},text:ctx.t("work.board.lead")}),
    h(doc,"div",{class:"kanban-cols"},boardColumns(items).map(c=>boardColumn(ctx,c,projectNames,allRuns))));
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
  const stepRows=runStepRows(run.evidence);
  const steps=stepRows.length?h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table run-steps",dataset:{runSteps:run.runId}},h(doc,"caption",{text:ctx.t("run.steps.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["run.steps.col.step","run.steps.col.cycle","run.steps.col.kind","run.steps.col.exit","run.steps.col.at","run.steps.col.duration"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},stepRows.map(r=>h(doc,"tr",{dataset:{runStepRow:r.evidenceId??r.kind??"",runStepExit:r.exitCode===null?"":String(r.exitCode),runStepTimedOut:r.timedOut?"1":"0"}},
      h(doc,"td",{class:"mono",text:r.step??MISSING}),h(doc,"td",{class:"mono",text:r.cycle===null?MISSING:String(r.cycle)}),h(doc,"td",{class:"mono",text:r.kind??MISSING}),
      h(doc,"td",{class:"mono",text:r.timedOut?ctx.t("run.steps.timedOut"):(r.exitCode===null?MISSING:ctx.t("run.steps.exit",{code:String(r.exitCode)}))}),
      h(doc,"td",{text:formatDateTime(r.startedAt,lang)}),h(doc,"td",{class:"mono",text:r.durationMs===null?MISSING:ctx.t("run.steps.seconds",{s:(r.durationMs/1000).toFixed(1)})}))))),
    h(doc,"p",{class:"note",text:ctx.t("run.steps.note")})):null;
  const cps=run.checkpoints.length?h(doc,"ol",{class:"checkpoints"},run.checkpoints.map(c=>h(doc,"li",{},h(doc,"span",{text:c.name}),c.status?statusPill(ctx,c.status):null,h(doc,"time",{text:formatDateTime(c.at,lang)})))):h(doc,"p",{class:"note",text:ctx.t(run.checkpointsReported===false?"run.checkpointsNotReported":"run.noCheckpoints")});
  return h(doc,"li",{class:"card run-card",dataset:{runId:run.runId,runStatus:run.status}},
    h(doc,"h5",{},h(doc,"span",{class:"mono",text:run.runId})," ",statusPill(ctx,run.status),runNotVerified(run)?[" ",notVerifiedBadge(ctx,"run")]:null),
    // M1a c2: iki ayrı eksen (sunucu etiketleri) yalnız ayrıntı görünümünde bilinir.
    run.delivery?h(doc,"p",{class:"panel-meta"},axisBadges(ctx,run.delivery.sourceGeneration,run.delivery.productVerification,"run")):null,
    h(doc,"dl",{class:"kv"},
      h(doc,"dt",{text:ctx.t("run.step")}),h(doc,"dd",{text:step}),
      h(doc,"dt",{text:ctx.t("run.role")}),h(doc,"dd",{text:run.role??MISSING}),
      h(doc,"dt",{text:ctx.t("run.started")}),h(doc,"dd",{text:formatDateTime(run.startedAt,lang)}),
      h(doc,"dt",{text:ctx.t("run.heartbeat")}),h(doc,"dd",{text:formatDateTime(run.heartbeatAt,lang)}),
      h(doc,"dt",{text:ctx.t("run.lease")}),h(doc,"dd",{text:formatDateTime(run.leaseExpiresAt,lang)}),
      h(doc,"dt",{text:ctx.t("run.reviewer")}),h(doc,"dd",{text:run.reviewer?.identity??ctx.t("run.reviewerNone")}),
      h(doc,"dt",{text:ctx.t("run.verdict")}),h(doc,"dd",{text:run.reviewer?.verdict?statusLabel(ctx,run.reviewer.verdict):ctx.t("run.verdictNone")}),
      // UI-111: sunucunun kaydettiği olgular; toplam/azami/kalan/geri sayım yok. Zamanlanmış yeniden deneme yalnız RETRY_SCHEDULED durumunda gösterilir (başka durumda retryAt eskimiş olabilir).
      h(doc,"dt",{text:ctx.t("run.retriesInStep")}),h(doc,"dd",{dataset:{runRetryCount:run.retryCount??""},text:formatCount(run.retryCount)}),
      h(doc,"dt",{text:ctx.t("run.remediationCycles")}),h(doc,"dd",{dataset:{runRemediationCycle:run.remediationCycle??""},text:formatCount(run.remediationCycle)}),
      h(doc,"dt",{text:ctx.t("run.leaseAttempts")}),h(doc,"dd",{dataset:{runAttempt:run.attempt??""},text:formatCount(run.attempt)}),
      ...(run.status==="RETRY_SCHEDULED"?[h(doc,"dt",{text:ctx.t("run.retryScheduledFor")}),h(doc,"dd",{dataset:{runRetryAt:run.retryAt??""},text:formatDateTime(run.retryAt,lang)})]:[]),
      // SBX-GATE: BLOCKED/FAILED nedeni dürüstçe gösterilir; SANDBOX_UNAVAILABLE için kodun yanında açıklama vardır.
      ...(run.reason?[h(doc,"dt",{text:ctx.t("run.reason")}),h(doc,"dd",{dataset:{runReason:run.reason},text:run.reason==="SANDBOX_UNAVAILABLE"?`SANDBOX_UNAVAILABLE — ${ctx.t("run.reason.SANDBOX_UNAVAILABLE")}`:runReasonHintKey(run.reason)?`${run.reason} — ${ctx.t(runReasonHintKey(run.reason))}`:run.reason})]:[])),
    h(doc,"h6",{text:ctx.t("run.checkpoints")}),cps,steps?h(doc,"h6",{text:ctx.t("run.steps.title")}):null,steps,h(doc,"h6",{text:ctx.t("run.evidence")}),ev);
}
function runsSection(ctx,runsRes,details){
  const doc=ctx.doc;
  if(runsRes.state!=="VERIFIED")return stateNote(ctx,runsRes.state,runsRes.state==="UNAVAILABLE"?"run.unavailable":undefined);
  if(!runsRes.items.length)return emptyNote(ctx,"run.none");
  return h(doc,"ul",{class:"cards run-list"},runsRes.items.map(r=>runCard(ctx,details.get(r.runId)??r)));
}
/** M1a c2: kabul bekleyen (AWAITING_APPROVAL) en son koşunun sunucu ayrıntısı (iki eksen + teslim görünümü); yoksa null. */
export function awaitingRun(runsRes,details){
  if(runsRes?.state!=="VERIFIED")return null;
  const r=runsRes.items.find(x=>x.status==="AWAITING_APPROVAL");if(!r)return null;
  return details.get(r.runId)??null;
}
/** D-M1A-STATE-MODEL-2026-10-15: ürün düzeyi COMPLETE yalnız PRODUCT_VERIFIED koşuda sunulur; aksi halde düğme yoktur ve dürüst açıklama + iki eksen gösterilir. */
export function completeNotOffered(ctx,run,id){
  const doc=ctx.doc;
  return h(doc,"div",{class:"note complete-not-offered",id,dataset:{completeOffered:"false"}},
    run?.delivery?h(doc,"p",{},axisBadges(ctx,run.delivery.sourceGeneration,run.delivery.productVerification,"complete")):null,
    h(doc,"p",{text:ctx.t("m1a.complete.notOffered")}));
}
/** Koşu öncesi hazırlık notu: yalnız kayıtlardan okunan eksikler kesin uyarıdır; "kayıtlı" garanti vermez; okunamayan kayıt UNKNOWN der. */
function readinessNote(ctx,r){
  const doc=ctx.doc,items=[];
  if(r.repository==="MISSING"||r.repository==="REMOTE")items.push(["repository",ctx.t(`run.ready.repository.${r.repository}`)]);
  if(r.testCommand==="MISSING")items.push(["testCommand",ctx.t("run.ready.testCommand.MISSING")]);
  const unknown=r.repository==="UNKNOWN"||r.testCommand==="UNKNOWN";
  if(!items.length&&!unknown&&r.repository==="RECORDED"&&r.testCommand==="RECORDED")items.push(["recorded",ctx.t("run.ready.recorded")]);
  else if(!items.length&&unknown)items.push(["unknown",ctx.t("run.ready.unknown")]);
  return h(doc,"div",{class:"note",id:"run-readiness",role:"note",dataset:{runReadiness:r.blockers.length?"BLOCKERS":unknown?"UNKNOWN":"RECORDED",runBlockers:r.blockers.join(",")}},
    h(doc,"strong",{text:ctx.t("run.ready.title")}),h(doc,"ul",{},items.map(([k,t])=>h(doc,"li",{dataset:{readyItem:k},text:t}))));
}
function transitionControls(ctx,mission,awaiting,readiness=null){
  const doc=ctx.doc,all=allowedNext(mission.status),next=all.filter(to=>to!=="COMPLETE"||canOfferComplete(awaiting)),hidden=all.includes("COMPLETE")&&!next.includes("COMPLETE"),sid=actionStatusId(mission.missionId),busy=drafts.busy[sid]===true;
  const reasonField=field(ctx,{id:"tr-reason",labelKey:"work.transition.reason",value:drafts.reasons[mission.missionId]??"",onInput:v=>{drafts.reasons[mission.missionId]=v},hintKey:"work.transition.reasonHint"});
  const buttons=next.map(to=>h(doc,"button",{type:"button",class:`btn${requiresConfirm(to)?" btn-primary":""}`,id:`tr-${to}`,dataset:{focusKey:`tr-${to}`,to,confirm:requiresConfirm(to)?"true":"false"},disabled:busy,
    on:{click:()=>performTransition(ctx,{missionId:mission.missionId,title:mission.title,from:mission.status,to,reason:drafts.reasons[mission.missionId]??""})},
    text:requiresConfirm(to)?ctx.t("work.transition.toConfirm",{to:statusLabel(ctx,to)}):ctx.t("work.transition.to",{to:statusLabel(ctx,to)})}));
  const startable=canStartRun(mission.status);
  // //TR: COORD-RUN-EXPERT: koşuyu yürütecek uzman geliştirici rolü (varsayılan ilk-teslim developer bağlaması); seçim yalnız bellekte, mission başına tutulur.
  const expert=drafts.runExpert[mission.missionId]??RUN_EXPERTS[0].roleId;
  const expertField=field(ctx,{id:"run-expert",labelKey:"work.run.expert",value:expert,onInput:v=>{drafts.runExpert[mission.missionId]=v},hintKey:"work.run.expertHint",
    options:[...RUN_EXPERTS.map(e=>({value:e.roleId,label:ctx.t("work.run.expertOpt",{roleId:e.roleId,fn:ctx.t(`work.run.fn.${e.function}`)})})),{value:RUN_EXPERT_NONE,label:ctx.t("work.run.expertNone")}]});
  const runBtn=h(doc,"button",{type:"button",class:"btn btn-primary",id:"run-start",dataset:{focusKey:"run-start"},disabled:!startable||busy,"aria-describedby":"run-start-hint",on:{click:()=>startRun(ctx,{missionId:mission.missionId,status:mission.status,roleId:drafts.runExpert[mission.missionId]??RUN_EXPERTS[0].roleId})},text:ctx.t("work.run.start")});
  return h(doc,"div",{class:"transition-controls"},
    h(doc,"h4",{text:ctx.t("work.transition.title")}),
    next.length?h(doc,"div",{},reasonField,hidden?completeNotOffered(ctx,awaiting,`complete-na-${mission.missionId}`):null,h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("work.transition.title")},buttons),h(doc,"p",{class:"field-hint",text:ctx.t("work.transition.confirmNote")})):h(doc,"p",{class:"note",text:ctx.t("work.transition.terminal")}),
    h(doc,"h4",{text:ctx.t("work.run.title")}),startable&&readiness?readinessNote(ctx,readiness):null,startable?expertField:null,h(doc,"div",{class:"btn-row"},runBtn),
    h(doc,"p",{class:"field-hint",id:"run-start-hint",text:ctx.t(startable?"work.run.hintOk":"work.run.hintNot")}),
    statusBlock(ctx,sid));
}
/** //TR: UI-026 görev denetçisi (salt okunur): seçili görevin yalnız mission okumasından gelen alanlarını gösterir; eksik alan UNKNOWN, okuma canlı değilse UNKNOWN durum notu. Hiçbir POST/depolama yoktur; seçim yalnız bellekte tutulur. */
export function taskInspector(ctx,detail,runsRes,missionId){
  const doc=ctx.doc,sel=inspectedTask&&inspectedTask.missionId===missionId?inspectedTask.taskId:null;
  const inner=[h(doc,"p",{class:"note",text:ctx.t("work.task.lead")})];
  if(!sel)inner.push(h(doc,"p",{class:"note note-empty",role:"status",text:ctx.t("work.task.none")}));
  else{
    const d=deriveTaskInspector(detail,runsRes,sel);
    if(d.state==="UNKNOWN")inner.push(h(doc,"p",{class:"note note-unknown",role:"status",text:ctx.t("work.task.unknownRead")}));
    else if(d.state==="EMPTY")inner.push(h(doc,"p",{class:"note note-empty",role:"status",text:ctx.t("work.task.notFound")}));
    else{
      const t=d.task,unk=(k)=>h(doc,"dd",{class:"task-unknown",dataset:{taskField:k},text:ctx.t("work.task.unknown")});
      const runsText=t.runs.known?ctx.t("work.task.runsCount",{n:t.runs.count}):null;
      inner.push(h(doc,"dl",{class:"kv"},
        h(doc,"dt",{text:ctx.t("work.task.id")}),h(doc,"dd",{class:"mono",dataset:{taskField:"taskId"},text:t.taskId}),
        h(doc,"dt",{text:ctx.t("work.task.name")}),h(doc,"dd",{dataset:{taskField:"title"},text:t.title}),
        h(doc,"dt",{text:ctx.t("work.task.status")}),h(doc,"dd",{dataset:{taskField:"status"}},statusPill(ctx,t.status)),
        h(doc,"dt",{text:ctx.t("work.task.mission")}),h(doc,"dd",{dataset:{taskField:"mission"},text:`${t.missionTitle} · ${statusLabel(ctx,t.missionStatus)} · ${t.riskLevel}`}),
        h(doc,"dt",{text:ctx.t("work.task.runs")}),runsText?h(doc,"dd",{dataset:{taskField:"runs"},text:runsText}):unk("runs"),
        h(doc,"dt",{text:ctx.t("work.task.runLink")}),unk("runLink"),
        ...(t.dependencies?[h(doc,"dt",{text:ctx.t("work.task.f.dependencies")}),h(doc,"dd",{dataset:{taskField:"dependencies"}},t.dependencies.length?h(doc,"ul",{},t.dependencies.map(d=>h(doc,"li",{},h(doc,"span",{text:d.title??d.taskId})," ",d.status?statusPill(ctx,d.status):h(doc,"span",{class:"task-unknown",text:ctx.t("work.task.unknown")})))):ctx.t("work.task.noDeps"))]:[]),
        ...t.unknownFields.flatMap(k=>[h(doc,"dt",{text:ctx.t(`work.task.f.${k}`)}),unk(k)])));
    }
  }
  return h(doc,"div",{class:"task-inspector",id:"task-inspector",role:"region","aria-label":ctx.t("work.task.title"),dataset:{taskInspector:sel?"open":"closed"}},h(doc,"h4",{text:ctx.t("work.task.title")}),inner);
}
/** //TR: UI-025 görev/koşu zaman çizelgesi (salt okunur): mission oluşturma, koşu başlangıcı ve kontrol noktaları; zaman damgası olmayan olay UNKNOWN gösterilir, uydurulmaz. POST/depolama/yakınlaştırma durumu yoktur. */
export function workTimeline(ctx,detail,runsRes){
  const doc=ctx.doc,d=deriveWorkTimeline(detail,runsRes),lang=ctx.i18n.lang;
  const inner=[h(doc,"p",{class:"note",text:ctx.t("work.wtl.lead")})];
  if(d.state==="UNKNOWN")inner.push(h(doc,"p",{class:"note note-unknown",role:"status",text:ctx.t("work.wtl.unknownRead")}));
  else{
    if(!d.runsKnown)inner.push(h(doc,"p",{class:"note note-unknown",role:"status",text:ctx.t("work.wtl.runsUnknown")}));
    inner.push(h(doc,"ol",{class:"wtl-list","aria-label":ctx.t("work.wtl.title")},d.events.map(e=>h(doc,"li",{class:`wtl-item wtl-${e.kind}`,dataset:{wtlKind:e.kind,wtlAt:e.at===null?"UNKNOWN":e.at}},
      h(doc,"span",{class:e.at===null?"wtl-time wtl-unknown":"wtl-time",text:e.at===null?ctx.t("work.wtl.unknown"):formatDateTime(e.at,lang)})," ",
      h(doc,"span",{class:"wtl-kind",text:ctx.t(`work.wtl.k.${e.kind}`)})," ",
      h(doc,"span",{class:e.kind==="run"?"mono":"",text:e.label})," ",
      e.status?statusPill(ctx,e.status):null))));
  }
  return h(doc,"div",{class:"wtl",id:"work-wtl",role:"region","aria-label":ctx.t("work.wtl.title"),dataset:{wtlState:d.state}},h(doc,"h4",{text:ctx.t("work.wtl.title")}),inner);
}
function taskList(ctx,tasks,missionId){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"task-list"},tasks.map(t=>{
    const on=inspectedTask?.missionId===missionId&&inspectedTask.taskId===t.taskId;
    return h(doc,"li",{},h(doc,"button",{type:"button",class:"link-btn",dataset:{taskInspect:t.taskId,focusKey:`task-${t.taskId}`},"aria-pressed":on?"true":"false","aria-controls":"task-inspector",
      on:{click:()=>{inspectedTask=on?null:{missionId,taskId:t.taskId};ctx.rerender()}},text:t.title})," ",statusPill(ctx,t.status));
  }));
}
/** Seçili görevin koşu bölümü (görev seçili ve okuması yapılmışsa); yoksa null. */
function taskRunsFor(ctx,m,runsRes,taskRuns){
  if(!taskRuns||inspectedTask?.missionId!==m.missionId||taskRuns.taskId!==inspectedTask.taskId)return null;
  const task=m.tasks.find(t=>t.taskId===taskRuns.taskId);
  return task?taskRunsPanel(ctx,{task,linked:taskRuns.res,runsRes}):null;
}
function detailPanel(ctx,detail,runsRes,runDetails,evRes,project=null,taskRuns=null){
  const doc=ctx.doc;
  if(detail.state!=="VERIFIED")return panel(ctx,{titleKey:"work.detail",id:"work-detail"},stateNote(ctx,detail.state));
  const m=detail.mission;
  const tl=runTimeline(ctx,runsRes);
  return panel(ctx,{titleKey:"work.detail",id:"work-detail"},
    h(doc,"h3",{text:m.title}),
    h(doc,"p",{class:"panel-meta"},statusPill(ctx,m.status),badge(ctx,m.riskLevel,"badge-risk"),h(doc,"span",{class:"mono",text:m.missionId}),missionNotVerified(runsRes.state==="VERIFIED"?runsRes.items:[],m.missionId)?notVerifiedBadge(ctx,"mission"):null),
    h(doc,"p",{text:m.objective}),
    h(doc,"h4",{text:ctx.t("work.detail.criteria")}),m.acceptanceCriteria.length?h(doc,"ul",{},m.acceptanceCriteria.map(c=>h(doc,"li",{text:c}))):emptyNote(ctx,"work.detail.noCriteria"),
    m.tasks.length?h(doc,"div",{},h(doc,"h4",{text:ctx.t("work.detail.tasks")}),taskList(ctx,m.tasks,m.missionId),taskInspector(ctx,detail,runsRes,m.missionId),taskStatusControls(ctx,m,inspectedTask?.missionId===m.missionId?inspectedTask.taskId:null),taskRunsFor(ctx,m,runsRes,taskRuns)):h(doc,"div",{},h(doc,"h4",{text:ctx.t("work.detail.tasks")}),h(doc,"p",{class:"note",dataset:{noTasks:m.missionId},text:ctx.t("work.detail.noTasks")})),
    workTimeline(ctx,detail,runsRes),
    planFormPanel(ctx,m),
    h(doc,"h4",{text:ctx.t("work.timeline.title")}),statusTimeline(ctx,m.status),
    transitionControls(ctx,m,awaitingRun(runsRes,runDetails),runReadiness({project,mission:m})),
    tl?[h(doc,"h4",{text:ctx.t("work.runtl.title")}),h(doc,"p",{class:"note",text:ctx.t("work.runtl.lead")}),tl]:null,
    h(doc,"h4",{text:ctx.t("run.timeline")}),runsSection(ctx,runsRes,runDetails),
    h(doc,"h4",{text:ctx.t("work.evidence.title")}),h(doc,"p",{class:"note",text:ctx.t("work.evidence.lead")}),evidenceSection(ctx,evRes));
}

export async function render(ctx){
  const doc=ctx.doc,[res,projRes,allRunsRes]=await Promise.all([ctx.api.missions(),ctx.api.projects(),ctx.api.workRuns()]);
  const allRuns=allRunsRes.state==="VERIFIED"?allRunsRes.items:[];
  const projects=projRes.state==="VERIFIED"?projRes.items:[],names=new Map(projects.map(p=>[p.projectId,p.name]));
  let body;
  if(res.state!=="VERIFIED")body=stateNote(ctx,res.state);
  else if(!res.items.length)body=emptyNote(ctx,"work.empty");
  else body=h(doc,"div",{},layoutToggle(ctx),...(boardLayout()==="board"?[missionBoard(ctx,res.items,names,allRuns)]:[filterBar(ctx,res.items),missionTable(ctx,res.items,names,allRuns)]));
  let detailNode=null;
  if(selection.missionId){
    const [detail,runsRes,evRes]=await Promise.all([ctx.api.missionDetail(selection.missionId),ctx.api.workRuns({missionId:selection.missionId}),ctx.api.evidenceList({missionId:selection.missionId,limit:EVIDENCE_LIMIT})]);
    const runDetails=new Map();
    if(runsRes.state==="VERIFIED")await Promise.all([...new Set([...runsRes.items.slice(0,RUN_DETAIL_LIMIT),...runsRes.items.filter(r=>r.status==="AWAITING_APPROVAL")])].map(async r=>{const d=await ctx.api.workRunDetail(r.runId);if(d.state==="VERIFIED"&&d.run)runDetails.set(r.runId,d.run)}));
    const taskRuns=inspectedTask?.missionId===selection.missionId?{taskId:inspectedTask.taskId,res:await loadTaskRuns(ctx,inspectedTask.taskId)}:null;
    detailNode=detailPanel(ctx,detail,runsRes,runDetails,evRes,detail.state==="VERIFIED"?(projects.find(p=>p.projectId===detail.mission.projectId)??null):null,taskRuns);
  }
  // //TR: Premium başlık (hero): göz üstü etiket + başlık + alt başlık + dürüst kaynak çipi/kapsam. Mevcut h1#view-title korunur (odak hedefi).
  const header=h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("work.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.work.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("work.subtitle")}),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:res.state,value:res.items?.length??null}),h(doc,"span",{text:ctx.store.projectId?ctx.t("work.scopeProject"):ctx.t("work.scopeAll")})));
  return h(doc,"div",{class:"view view-work"},header,
    summaryTiles(ctx,res,allRunsRes),
    overviewPanel(ctx,res),
    missionForm(ctx,projects),
    panel(ctx,{titleKey:"work.list",id:"work-list"},body),
    detailNode);
}
