// //TR: Bu görünüm Güvence (QA + Güvenlik) alanıdır: GET /v1/evidence kanıt listesi doğrulama durumu çipleriyle (VERIFIED/MISMATCH/MISSING/UNVERIFIABLE) ve süzgeçlerle gösterilir, detay paneli kaynak yolu, sha256, doğrulama durumu ve redakte log kuyruğunu verir; 404 => UNAVAILABLE, doğrulanamayan kanıt asla doğrulanmış gösterilmez ve log yalnız metin olarak çizilir.
import {h,panel,stateNote,emptyNote,chip,verificationChip} from "../components.js";
import {MISSING} from "../model.js";
import {VERIFICATION_STATES,filterEvidence,formatDateTime} from "../work-core.js";
import {drafts,selection,field} from "../forms.js";

const PAGE_LIMIT=100;

function filters(ctx,items){
  const doc=ctx.doc,f=drafts.evidence,kinds=[...new Set(items.map(e=>e.kind).filter(Boolean))].sort();
  const vOpts=[{value:"ALL",label:ctx.t("assurance.filter.all")},...VERIFICATION_STATES.map(v=>({value:v,label:ctx.t(`everif.${v}`)})),{value:"NONE",label:ctx.t("everif.NONE")}];
  const kOpts=[{value:"ALL",label:ctx.t("assurance.filter.all")},...kinds.map(k=>({value:k,label:k}))];
  if(!kOpts.some(o=>o.value===f.kind))f.kind="ALL";
  return h(doc,"div",{class:"filter-row",role:"group","aria-label":ctx.t("assurance.filter.label")},
    field(ctx,{id:"ev-filter-verification",labelKey:"assurance.filter.verification",value:f.verification,onInput:v=>{f.verification=v;ctx.rerender()},options:vOpts}),
    field(ctx,{id:"ev-filter-kind",labelKey:"assurance.filter.kind",value:f.kind,onInput:v=>{f.kind=v;ctx.rerender()},options:kOpts}),
    selection.missionId?h(doc,"p",{class:"note"},ctx.t("assurance.scopeMission",{id:selection.missionId})," ",h(doc,"button",{type:"button",class:"btn",id:"ev-clear-scope",dataset:{focusKey:"ev-clear-scope"},on:{click:()=>{selection.missionId=null;drafts.evidence.cursor=null;drafts.evidence.stack=[];ctx.rerender()}},text:ctx.t("assurance.scopeClear")})):h(doc,"p",{class:"note",text:ctx.t("assurance.scopeAll")}));
}
function pager(ctx,res){
  const doc=ctx.doc,f=drafts.evidence;
  if(!f.cursor&&!res.nextCursor)return null;
  return h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("assurance.page.label")},
    h(doc,"button",{type:"button",class:"btn",id:"ev-prev",dataset:{focusKey:"ev-prev"},disabled:!f.stack.length&&!f.cursor,on:{click:()=>{f.cursor=f.stack.pop()??null;ctx.rerender()}},text:ctx.t("assurance.page.prev")}),
    h(doc,"button",{type:"button",class:"btn",id:"ev-next",dataset:{focusKey:"ev-next"},disabled:!res.nextCursor,on:{click:()=>{f.stack.push(f.cursor);f.cursor=res.nextCursor;ctx.rerender()}},text:ctx.t("assurance.page.next")}));
}
function listBody(ctx,res,shown){
  const doc=ctx.doc;
  if(res.state!=="VERIFIED")return stateNote(ctx,res.state);
  if(!res.items.length)return emptyNote(ctx,"assurance.empty");
  if(!shown.length)return emptyNote(ctx,"assurance.filter.none");
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("assurance.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["assurance.col.id","assurance.col.kind","assurance.col.verification","assurance.col.created"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},shown.map(e=>{
      const sel=selection.evidenceId===e.evidenceId;
      return h(doc,"tr",{class:sel?"row-selected":null},
        h(doc,"td",{},h(doc,"button",{type:"button",class:"link-btn mono",id:`ev-${e.evidenceId}`,dataset:{focusKey:`ev-${e.evidenceId}`},"aria-current":sel?"true":null,on:{click:()=>{selection.evidenceId=e.evidenceId;ctx.rerender()}},text:e.evidenceId})),
        h(doc,"td",{text:e.kind??MISSING}),h(doc,"td",{},verificationChip(ctx,e.verification)),h(doc,"td",{text:formatDateTime(e.createdAt,ctx.i18n.lang)}));
    }))));
}
async function detailBody(ctx){
  const doc=ctx.doc,res=await ctx.api.evidenceItem(selection.evidenceId);
  if(res.state!=="VERIFIED")return stateNote(ctx,res.state);
  const e=res.item;
  return h(doc,"div",{},
    h(doc,"p",{class:"panel-meta"},verificationChip(ctx,e.verification),h(doc,"span",{class:"mono",text:e.evidenceId})),
    h(doc,"dl",{class:"kv"},
      h(doc,"dt",{text:ctx.t("assurance.detail.kind")}),h(doc,"dd",{text:e.kind??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.mission")}),h(doc,"dd",{class:"mono",text:e.missionId??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.run")}),h(doc,"dd",{class:"mono",text:e.runId??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.source")}),h(doc,"dd",{class:"mono",dataset:{field:"sourcePath"},text:e.sourcePath??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.sha256")}),h(doc,"dd",{class:"mono",dataset:{field:"sha256"},text:e.sha256??MISSING}),
      h(doc,"dt",{text:ctx.t("assurance.detail.verification")}),h(doc,"dd",{text:e.verification?ctx.t(`everif.${e.verification}`):ctx.t("everif.NONE")}),
      h(doc,"dt",{text:ctx.t("assurance.detail.created")}),h(doc,"dd",{text:formatDateTime(e.createdAt,ctx.i18n.lang)})),
    h(doc,"h3",{text:ctx.t("assurance.detail.log")}),
    h(doc,"pre",{id:"ev-log",class:"log",tabindex:"0","aria-label":ctx.t("assurance.detail.log"),text:e.logTail??ctx.t("assurance.detail.noLog")}));
}

export async function render(ctx){
  const doc=ctx.doc,f=drafts.evidence;
  const res=await ctx.api.evidenceList({missionId:selection.missionId??undefined,cursor:f.cursor??undefined,limit:PAGE_LIMIT});
  if(res.state==="VERIFIED"&&f.kind!=="ALL"&&!res.items.some(e=>e.kind===f.kind))f.kind="ALL";
  const shown=res.state==="VERIFIED"?filterEvidence(res.items,{verification:f.verification,kind:f.kind}):[];
  const detail=selection.evidenceId?panel(ctx,{titleKey:"assurance.detail",id:"assurance-detail"},await detailBody(ctx)):null;
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.assurance.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.assurance.desc")}),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:res.state,value:res.items?.length??null}),h(doc,"span",{text:ctx.t("assurance.source")})),
    panel(ctx,{titleKey:"assurance.list",id:"assurance-list"},res.state==="VERIFIED"?filters(ctx,res.items):null,listBody(ctx,res,shown),res.state==="VERIFIED"?pager(ctx,res):null),
    detail);
}
