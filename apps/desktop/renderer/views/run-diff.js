// //TR: DSK-T0001: koşu kartındaki "Bu koşudaki değişiklikler" bloğu. Koşunun commit'i ayrı koşu dalındadır (HEAD geçmişinde görünmez), bu yüzden fark yalnız Kurucu tıklayınca GET /v1/projects/:id/git/diff?from=baseSha&to=headSha ile okunur. Dosya listesi + satırlar yalnız h()/textContent ile çizilir; fark bir kaynak değişikliğidir, test/ürün doğrulaması değildir.
import {h,stateNote,emptyNote} from "../components.js";
import {diffLineKind} from "../project-core.js";
import {settle} from "../forms.js";

// Oturum içi önbellek: runId -> {state:"LOADING"|"VERIFIED"|<hata durumu>, diff}. Yalnız tıklamayla dolar; kendiliğinden istek yoktur.
export const runDiffs=new Map();
export function resetRunDiffs(){runDiffs.clear()}
export const canShowRunDiff=run=>Boolean(run&&run.projectId&&run.baseSha&&run.headSha&&run.baseSha!==run.headSha);

export async function loadRunDiff(ctx,run){
  if(!canShowRunDiff(run))return {ok:false};
  runDiffs.set(run.runId,{state:"LOADING",diff:null});await ctx.rerender();
  let d;try{d=await ctx.api.gitDiff(run.projectId,run.baseSha,run.headSha)}catch{d={state:"ERROR",diff:null}}
  runDiffs.set(run.runId,{state:d?.state??"ERROR",diff:d?.diff??null});
  await ctx.rerender();settle(ctx,[`id:run-diff-view-${run.runId}`,`id:run-diff-show-${run.runId}`]);
  return {ok:d?.state==="VERIFIED"};
}

export function runDiffBlock(ctx,run){
  if(!canShowRunDiff(run))return null;
  const doc=ctx.doc,id=run.runId,cur=runDiffs.get(id)??null;
  const btn=h(doc,"button",{type:"button",class:"btn btn-small",id:`run-diff-show-${id}`,dataset:{focusKey:`run-diff-show-${id}`},disabled:cur?.state==="LOADING",
    text:ctx.t(cur&&cur.state!=="LOADING"?"run.diff.reload":"run.diff.show"),on:{click:()=>{loadRunDiff(ctx,run)}}});
  let body=null;
  if(cur?.state==="LOADING")body=h(doc,"p",{class:"note",role:"status",text:ctx.t("run.diff.loading")});
  else if(cur&&cur.state!=="VERIFIED")body=stateNote(ctx,cur.state);
  else if(cur&&cur.diff.empty)body=emptyNote(ctx,"studio.git.noDiff");
  else if(cur)body=h(doc,"div",{},
    cur.diff.files.length?h(doc,"ul",{class:"inline-list",id:`run-diff-files-${id}`},cur.diff.files.map(f=>h(doc,"li",{class:"mono",dataset:{runDiffFile:f.path},text:`${f.path} (+${f.additions??"?"} −${f.deletions??"?"})`}))):null,
    h(doc,"pre",{class:"log mono diff-view",id:`run-diff-view-${id}`,tabindex:"0","aria-label":ctx.t("run.diff.label",{runId:id}),dataset:{focusKey:`run-diff-view-${id}`}},cur.diff.lines.map(line=>h(doc,"span",{class:`diff-line diff-${diffLineKind(line)}`,text:line||" "}))),
    cur.diff.truncated?h(doc,"p",{class:"note",text:ctx.t("studio.git.truncated")}):null);
  return h(doc,"div",{class:"run-diff",id:`run-diff-${id}`,dataset:{runDiff:cur?.state??"NOT_LOADED"}},
    h(doc,"h6",{text:ctx.t("run.diff.title")}),
    h(doc,"p",{class:"field-hint",text:ctx.t("run.diff.note",{base:run.baseSha.slice(0,7),head:run.headSha.slice(0,7)})}),
    h(doc,"div",{class:"btn-row"},btn),body);
}
