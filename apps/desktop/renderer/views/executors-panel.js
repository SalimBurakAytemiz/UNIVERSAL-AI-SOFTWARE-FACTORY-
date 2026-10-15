// //TR: Bu görünüm parçası Ayarlar → "AI Yürütücüleri" panelidir: GET /v1/system/executors durumunu (LOCAL_CLAUDE: READY, NOT_CONFIGURED, PROVENANCE_MISSING, CLI_NOT_FOUND) dürüstçe gösterir, FAKE'i yalnız test olarak işaretler ve "Etkinleştir" eylemini yalnız NOT_CONFIGURED iken, kullanıcının kendi Claude Code girişiyle yerel CLI çalıştıracağını açıklayan erişilebilir onaydan sonra gönderir; arka uç yoksa UNAVAILABLE gösterilir, durum uydurulmaz.
import {h,panel,stateNote,emptyNote,badge} from "../components.js";
import {drafts,statusBlock,setStatus,focusResult} from "../forms.js";
import {buildEnableExecutorRequest,canEnableExecutor} from "../project-core.js";
import {describePostResult} from "../work-core.js";

export const EXEC_FORM="executors";
const EXEC_KEYS=["id:exec-enable"];
const stateLabel=(ctx,e)=>{
  if(e.state===null)return ctx.t("exec.state.UNKNOWN");
  const k=`exec.state.${e.state}`,v=ctx.t(k);return v===k?e.state:v;
};
/** Etkinleştirme: erişilebilir onay (varsayılan odak "Vazgeç") sonrası sabit POST; sonuç canlı bölgede duyurulur. */
export async function enableLocalClaude(ctx){
  const yes=await ctx.confirm({title:ctx.t("exec.confirm.title"),body:ctx.t("exec.confirm.body"),action:ctx.t("exec.confirm.action"),target:ctx.t("exec.name.LOCAL_CLAUDE"),confirmLabel:ctx.t("exec.enable")});
  if(yes!==true){setStatus(EXEC_FORM,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,EXEC_FORM,EXEC_KEYS);return {ok:false,cancelled:true}}
  const req=buildEnableExecutorRequest();
  drafts.busy[EXEC_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[EXEC_FORM]=false}
  const d=describePostResult(res);
  setStatus(EXEC_FORM,{ok:d.ok,key:d.ok?"exec.enabled":d.key,vars:d.ok?{}:d.vars,errors:null});
  await ctx.refreshAll({force:true});focusResult(ctx,EXEC_FORM,EXEC_KEYS);return {ok:d.ok,status:res?.status??null};
}
export async function executorsPanel(ctx){
  const doc=ctx.doc,res=await ctx.api.executors();
  let body;
  if(res.state!=="VERIFIED")body=stateNote(ctx,res.state);
  else if(!res.items.length)body=emptyNote(ctx,"exec.none");
  else body=h(doc,"ul",{class:"cards exec-list"},res.items.map(e=>{
    const nameKey=`exec.name.${e.id}`,name=ctx.t(nameKey)===nameKey?e.id:ctx.t(nameKey),hintKey=`exec.hint.${e.state}`,hint=e.state&&ctx.t(hintKey)!==hintKey?ctx.t(hintKey):null;
    return h(doc,"li",{class:"card",dataset:{executor:e.id,state:e.state??"UNKNOWN"}},
      h(doc,"h3",{text:name}),
      h(doc,"p",{},badge(ctx,stateLabel(ctx,e),e.state==="READY"?"badge-ok":"badge-risk"),e.testOnly?h(doc,"span",{}," ",badge(ctx,ctx.t("exec.testOnly"))):null),
      e.testOnly?h(doc,"p",{class:"note",text:ctx.t("exec.testOnlyNote")}):(hint?h(doc,"p",{class:"note",text:hint}):null),
      canEnableExecutor(e)?h(doc,"button",{type:"button",class:"btn btn-primary",id:"exec-enable",dataset:{focusKey:"exec-enable"},disabled:drafts.busy[EXEC_FORM]===true,text:ctx.t("exec.enable"),on:{click:()=>{enableLocalClaude(ctx)}}}):null);
  }));
  return panel(ctx,{titleKey:"exec.title",id:"settings-executors"},h(doc,"p",{class:"note",text:ctx.t("exec.lead")}),body,statusBlock(ctx,EXEC_FORM));
}
