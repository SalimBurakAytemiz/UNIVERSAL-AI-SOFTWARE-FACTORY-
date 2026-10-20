// //TR: Bu görünüm Control Tower alanıdır: en üstte gerçek okuma modelinden (cockpit global stop, /v1/roles katalogu, /v1/work-runs) beslenen 2B operasyon haritası ve eşdeğer erişilebilir listesi (UX WP4, 3B yok), altında eski Day-0 görünürlüğü korunur: health/Phase-0/install/scheduler/registry sayıları, retry beklemesi, Global Stop/Resume kartı, founder blocker listesi, run listesi, event ve redacted log görüntüleme; hepsi preload GET köprüsünden okunur.
import {confirmAndResume} from "../resume-confirm.js";
import {h,panel,chip,stateNote,emptyNote,statusLabel} from "../components.js";
import {formatCount,MISSING} from "../model.js";
import {buildCampusInput} from "../control-tower/feed.js";
import {mountCampus} from "../control-tower/mount.js";

const okData=r=>r.ok?r.data:null;
export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  const [health,phase0,install,sched,agents,caps,tools,retry,runs,att,control,cockpit,roleList,workRuns]=await Promise.all([api.health(),api.raw("/v1/phase0"),api.raw("/v1/install"),api.raw("/v1/scheduler"),api.raw("/v1/agents"),api.raw("/v1/capabilities"),api.raw("/v1/adapters"),api.raw("/v1/retry"),api.runs(),api.attention(),api.control(),api.cockpit(),api.roles(),api.workRuns()]);
  const campus=mountCampus(ctx,buildCampusInput({cockpit,control,roles:roleList,workRuns}));
  const s=okData(sched),completed=Array.isArray(s?.phases)?s.phases.filter(x=>x.status==="COMPLETED").length:0;
  const fact=(labelKey,value,state)=>h(doc,"div",{class:"fact",dataset:{fact:labelKey}},h(doc,"span",{class:"fact-label",text:ctx.t(labelKey)}),h(doc,"strong",{class:"fact-value",text:value}),state?chip(ctx,{state,value:1}):null);
  const cnt=r=>r.ok&&Number.isSafeInteger(r.data?.count)?`${formatCount(r.data.count)}`:MISSING;
  // //TR: INT-R3 D-M1-07 (WFR-03'ün eski app.js satırındaki niyeti): rol kaydı kanonik registeredRoles ile gösterilir; sertifikalı ve eski (LEGACY_REFERENCE_ONLY) sayılar ayrı etiketlenir, eski sayı kayıtlı rol yerine geçmez.
  const num=v=>Number.isSafeInteger(v)&&v>=0?formatCount(v):MISSING;
  const roles=r=>r.ok&&Number.isSafeInteger(r.data?.registeredRoles)&&r.data.registeredRoles>=0?ctx.t("tower.rolesValue",{registered:num(r.data.registeredRoles),certified:num(r.data.certified),legacy:num(r.data.legacyRoles)}):MISSING;
  const retryData=okData(retry);
  const healthText=health.state==="VERIFIED"?`${health.data.status} · ${health.data.system}`:ctx.t(`state.${health.state}`);
  const eventsEl=h(doc,"pre",{id:"events",class:"log",tabindex:"0","aria-label":ctx.t("tower.events"),text:ctx.t("tower.pickRun")});
  const logText=h(doc,"pre",{id:"logText",class:"log",tabindex:"0","aria-label":ctx.t("tower.logs"),text:ctx.t("tower.pickLog")});
  const logButtons=h(doc,"div",{id:"logButtons",class:"btn-row"});const selected=h(doc,"p",{id:"selectedRun",class:"mono",text:MISSING});
  async function loadRun(runId){
    selected.textContent=runId;eventsEl.textContent=ctx.t("tower.loading");logText.textContent=ctx.t("tower.pickLog");logButtons.replaceChildren(h(doc,"span",{class:"note",role:"status",text:ctx.t("tower.loading")}));
    const [events,logs]=await Promise.all([api.raw(`/v1/runs/${encodeURIComponent(runId)}/events`),api.raw(`/v1/runs/${encodeURIComponent(runId)}/logs`)]);
    eventsEl.textContent=events.ok?((events.data.events??[]).slice(-200).map(x=>`${x.timestamp??""} [${x.severity??"INFO"}] ${x.stage??""}/${x.event??""} ${JSON.stringify(x.details??{})}`).join("\n")||ctx.t("tower.noEvents")):ctx.t(`state.${events.state}`);
    const nodes=logs.ok?(logs.data.logs??[]).map(x=>h(doc,"button",{type:"button",class:"btn",on:{click:async()=>{const y=await api.raw(`/v1/runs/${encodeURIComponent(runId)}/logs/${encodeURIComponent(x.name)}`);logText.textContent=y.ok?(y.data.truncated?`${ctx.t("tower.truncated")}\n`:"")+y.data.text:ctx.t(`state.${y.state}`)}},text:`${x.name} (${ctx.t("tower.bytes",{n:x.size})})`})):[];
    logButtons.replaceChildren(...(nodes.length?nodes:[logs.ok?doc.createTextNode(ctx.t("tower.noLogs")):stateNote(ctx,logs.state)]));
  }
  const runList=runs.runs.slice(0,20).map(x=>h(doc,"button",{type:"button",class:"btn",on:{click:()=>loadRun(x.runId)},text:`${x.runId} · ${statusLabel(ctx,x.summary?.status??x.manifest?.status??"RUNNING")}`}));
  const attention=h(doc,"div",{id:"attention"});ctx.renderAttention(attention,att);
  const stopCard=h(doc,"div",{class:"panel panel-critical"},h(doc,"h2",{class:"panel-title",text:ctx.t("stop.title")}),
    h(doc,"p",{id:"stopState",text:control.active?ctx.t("stop.activeLine",{reason:control.reason??""}):ctx.t(control.state==="VERIFIED"?"stop.running":`state.${control.state}`)}),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn btn-danger",id:"towerStop",on:{click:()=>ctx.requestStop()},text:ctx.t("stop.button")}),h(doc,"button",{type:"button",class:"btn",id:"towerResume",on:{click:()=>confirmAndResume(ctx,{onCancel:typeof ctx.announce==="function"?ctx.announce:undefined})},text:ctx.t("stop.resume")})));
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.tower.title")}),
    panel(ctx,{titleKey:"tower.map.title",id:"tower-map"},campus),
    panel(ctx,{titleKey:"tower.health",id:"tower-health"},h(doc,"p",{id:"health",text:healthText}),
      h(doc,"div",{class:"facts"},fact("tower.install",okData(install)?.phase0Final??MISSING),fact("tower.phase0",okData(phase0)?.final??MISSING),
        fact("tower.scheduler",Array.isArray(s?.phases)?`${completed}/${s.phases.length}`:(s?.status??MISSING)),fact("tower.agents",roles(agents)),fact("tower.caps",cnt(caps)),fact("tower.tools",cnt(tools)),
        fact("tower.retry",retryData&&retryData.packageId?`${retryData.packageId} ${(retryData.phaseIds??[]).join(",")} @ ${retryData.retryAt}`:ctx.t("tower.noRetry")))),
    stopCard,
    panel(ctx,{titleKey:"tower.attention",id:"tower-attention"},attention),
    panel(ctx,{titleKey:"tower.runs",id:"tower-runs"},runs.state!=="VERIFIED"?stateNote(ctx,runs.state):runList.length?h(doc,"div",{class:"btn-row"},runList):emptyNote(ctx,"tower.noRuns")),
    panel(ctx,{titleKey:"tower.selected",id:"tower-selected"},selected,h(doc,"h3",{text:ctx.t("tower.events")}),eventsEl,h(doc,"h3",{text:ctx.t("tower.logs")}),logButtons,logText));
}
