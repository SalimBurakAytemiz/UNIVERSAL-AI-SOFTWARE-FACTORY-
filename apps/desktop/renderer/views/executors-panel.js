// //TR: Bu görünüm parçası Ayarlar → "AI Yürütücüleri" panelidir: GET /v1/system/executors durumunu (LOCAL_CLAUDE: READY, NOT_CONFIGURED, PROVENANCE_MISSING, CLI_NOT_FOUND) dürüstçe gösterir, FAKE'i yalnız test olarak işaretler ve "Etkinleştir" eylemini yalnız NOT_CONFIGURED iken, kullanıcının kendi Claude Code girişiyle yerel CLI çalıştıracağını açıklayan erişilebilir onaydan sonra gönderir; arka uç yoksa UNAVAILABLE gösterilir, durum uydurulmaz.
import {h,panel,stateNote,emptyNote,badge} from "../components.js";
import {drafts,statusBlock,setStatus,focusResult} from "../forms.js";
import {buildEnableExecutorRequest,canEnableExecutor} from "../project-core.js";
import {describePostResult} from "../work-core.js";
import {sandboxBlock} from "../m1a.js";
import {mapCapabilities,mapAdapters,countBy,buildRoutingRows,ROUTING_LIST_LIMIT} from "../routing-core.js";

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
  // M1a: sandbox durumu sunucudan okunur (doğrulanmış sağlayıcı yoksa "UNAVAILABLE — M1a modu"); profiller ayrı UASCO profilleridir, kişisel profile düşülmez.
  return panel(ctx,{titleKey:"exec.title",id:"settings-executors"},h(doc,"p",{class:"note",text:ctx.t("exec.lead")}),sandboxBlock(ctx,res.state==="VERIFIED"?res.sandbox:null),body,profilesBlock(ctx,res.profiles),statusBlock(ctx,EXEC_FORM));
}
const tOr=(ctx,k,fallback)=>{const v=ctx.t(k);return v===k?fallback:v};
/** SBX-8 (D-SBX-11 b): ayrı UASCO Claude profilleri (implementer / salt-okunur reviewer) için durum ve Founder'ın kendisinin çalıştıracağı giriş komutu (yalnız metin; UASCO oturum açmaz, kişisel ayar/kimlik aktarmaz). */
function profilesBlock(ctx,profiles){
  const doc=ctx.doc;if(!Array.isArray(profiles)||!profiles.length)return null;
  return h(doc,"section",{id:"settings-claude-profiles"},
    h(doc,"h3",{text:ctx.t("exec.profiles.title")}),
    h(doc,"p",{class:"note",text:ctx.t("exec.profiles.lead")}),
    h(doc,"ul",{class:"cards exec-profiles"},profiles.map(p=>h(doc,"li",{class:"card",dataset:{profile:p.role,state:p.state??"UNKNOWN"}},
      h(doc,"h4",{text:ctx.t(`exec.profile.role.${p.role}`)}),
      h(doc,"p",{},badge(ctx,p.state===null?ctx.t("exec.state.UNKNOWN"):tOr(ctx,`exec.profile.state.${p.state}`,p.state),p.state==="READY"?"badge-ok":"badge-risk")),
      p.state&&p.state!=="READY"?h(doc,"p",{class:"note",text:tOr(ctx,`exec.profile.hint.${p.state}`,p.reason??p.state)}):null,
      p.loginCommand?h(doc,"p",{class:"note",text:ctx.t("exec.profile.loginHint")}):null,
      p.loginCommand?h(doc,"pre",{class:"code",dataset:{loginCommand:p.role}},h(doc,"code",{text:p.loginCommand})):null))));
}

// //TR: PQ-005: salt-okunur sağlayıcı/model yönlendirme görünümü. Yalnız mevcut GET'ler (executors, capabilities, adapters); kayıt değerleri aynen, hiçbiri etkin/bağlı sayılmaz; yeni POST yok (mevcut local-claude etkinleştirme eylemi yerinde kalır).
function registryTable(ctx,{id,captionKey,cols,rows,total}){
  const doc=ctx.doc,shown=rows.slice(0,ROUTING_LIST_LIMIT);
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id},h(doc,"caption",{text:ctx.t(captionKey,{n:String(total)})}),
    h(doc,"thead",{},h(doc,"tr",{},cols.map(c=>h(doc,"th",{scope:"col",text:ctx.t(c.key)})))),
    h(doc,"tbody",{},shown.map(r=>h(doc,"tr",{dataset:{registryRow:r.id}},cols.map(c=>h(doc,"td",{class:c.mono?"mono":null,text:c.get(r)}))))),
  ),total>shown.length?h(doc,"p",{class:"note",text:ctx.t("routing.truncated",{shown:String(shown.length),total:String(total)})}):null);
}
function registryBlock(ctx,{res,title,id,summaryKeys,table}){
  const doc=ctx.doc;
  let body;
  if(res.state!=="VERIFIED")body=stateNote(ctx,res.state);
  else if(!res.items.length)body=emptyNote(ctx,"routing.registryEmpty");
  else body=h(doc,"div",{},
    h(doc,"p",{class:"note",dataset:{routingCounts:id}},summaryKeys.map(k=>`${k}: ${countBy(res.items,k).map(c=>`${c.value} ${c.count}`).join(", ")}`).join(" · ")),table);
  return h(doc,"section",{id,dataset:{routingBlock:id}},h(doc,"h3",{text:ctx.t(title)}),body);
}
export async function routingPanel(ctx){
  const doc=ctx.doc,[exec,capRaw,adRaw]=await Promise.all([ctx.api.executors(),ctx.api.raw("/v1/capabilities"),ctx.api.raw("/v1/adapters")]);
  const caps=capRaw.ok?mapCapabilities(capRaw.data):{state:capRaw.state,items:[],total:0},ads=adRaw.ok?mapAdapters(adRaw.data):{state:adRaw.state,items:[],total:0};
  const rows=buildRoutingRows(exec);
  const routes=exec.state!=="VERIFIED"?stateNote(ctx,exec.state):
    h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"routing-table"},h(doc,"caption",{text:ctx.t("routing.routes.caption")}),
      h(doc,"thead",{},h(doc,"tr",{},["routing.col.role","routing.col.executor","routing.col.executorState","routing.col.profileState","routing.col.sandbox","routing.col.model","routing.col.blockers"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},rows.map(r=>h(doc,"tr",{dataset:{routingRole:r.role}},
        h(doc,"td",{text:ctx.t(`exec.profile.role.${r.role}`)}),h(doc,"td",{class:"mono",text:r.executor??"—"}),h(doc,"td",{class:"mono",text:r.executorState??"—"}),
        h(doc,"td",{class:"mono",text:r.profileState??"—"}),h(doc,"td",{class:"mono",text:r.sandbox??"—"}),h(doc,"td",{text:r.model??"—"}),
        h(doc,"td",{class:"mono",dataset:{blockers:String(r.blockers.length)},text:r.blockers.length?r.blockers.join(", "):ctx.t("routing.noBlocker")}))))));
  return panel(ctx,{titleKey:"routing.title",id:"settings-routing"},h(doc,"p",{class:"note",text:ctx.t("routing.lead")}),routes,h(doc,"p",{class:"note",text:ctx.t("routing.modelNote")}),
    registryBlock(ctx,{res:caps,title:"routing.caps.title",id:"routing-caps",summaryKeys:["status","implementation"],table:caps.state==="VERIFIED"&&caps.items.length?registryTable(ctx,{id:"routing-caps-table",captionKey:"routing.caps.caption",total:caps.total,rows:caps.items,
      cols:[{key:"routing.col.id",mono:true,get:r=>r.id},{key:"routing.col.name",get:r=>r.name},{key:"routing.col.status",mono:true,get:r=>r.status},{key:"routing.col.activation",mono:true,get:r=>r.activation},{key:"routing.col.implementation",mono:true,get:r=>r.implementation}]}):null}),
    registryBlock(ctx,{res:ads,title:"routing.ads.title",id:"routing-ads",summaryKeys:["status","implementation"],table:ads.state==="VERIFIED"&&ads.items.length?registryTable(ctx,{id:"routing-ads-table",captionKey:"routing.ads.caption",total:ads.total,rows:ads.items,
      cols:[{key:"routing.col.id",mono:true,get:r=>r.id},{key:"routing.col.category",mono:true,get:r=>r.category},{key:"routing.col.status",mono:true,get:r=>r.status},{key:"routing.col.implementation",mono:true,get:r=>r.implementation},{key:"routing.col.cert",mono:true,get:r=>r.requiresCertification===null?"—":(r.requiresCertification?ctx.t("routing.cert.yes"):ctx.t("routing.cert.no"))}]}):null}));
}
