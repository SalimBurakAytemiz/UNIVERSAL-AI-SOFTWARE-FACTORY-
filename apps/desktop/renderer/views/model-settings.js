// //TR: Bu görünüm parçası Ayarlar → "AI model ve sağlayıcı ayarları" panelidir: yönlendirme rolü, yedek zinciri, kota ve maliyet sınıfını tek tabloda DÜRÜSTÇE gösterir. Veri yalnız mevcut izinli GET'lerden gelir (/v1/system/executors, /v1/adapters); yedek/kota/maliyet için okuma yolu olmadığından bu hücreler "kullanılamıyor" olarak etiketlenir. Yazma yolu yoktur: değiştirme düğmesi gerekçesiyle devre dışıdır. Sır değeri asla gösterilmez; kimlik bilgisi yalnız var/yok/bilinmiyor.
import {h,panel,stateNote,emptyNote,statePill} from "../components.js";
import {mapAdapters,buildModelProviderRows} from "../routing-core.js";
const CONFIG_PILL={CONFIGURED:"VERIFIED",NOT_CONFIGURED:"UNAVAILABLE",UNKNOWN:"NOT_VERIFIED"};

const tOr=(ctx,k,fallback)=>{const v=ctx.t(k);return v===k?fallback:v};
const gapCell=(ctx,field)=>h(ctx.doc,"td",{dataset:{gap:field},text:ctx.t("models.gap.cell")});
function rolesCell(ctx,r){
  const doc=ctx.doc;
  if(!r.roles.length)return h(doc,"td",{dataset:{roles:"0"},text:ctx.t("models.role.none")});
  return h(doc,"td",{dataset:{roles:String(r.roles.length)}},h(doc,"ul",{class:"plain"},r.roles.map(x=>h(doc,"li",{dataset:{modelRole:x.role,credential:x.credential}},
    `${tOr(ctx,`exec.profile.role.${x.role}`,x.role)} · ${x.state??ctx.t("exec.state.UNKNOWN")} · ${ctx.t(`models.cred.${x.credential}`)}`))));
}
function statusCell(ctx,r){
  if(r.kind==="EXECUTOR")return h(ctx.doc,"td",{class:"mono",text:`${r.executorState??"—"}${r.inUse?` · ${ctx.t("models.inUse")}`:""}`});
  return h(ctx.doc,"td",{class:"mono",text:`${r.status??"—"} / ${r.implementation??"—"}`});
}
export function modelTable(ctx,res){
  const doc=ctx.doc;
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"models-table"},h(doc,"caption",{text:ctx.t("models.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["models.col.id","models.col.kind","models.col.config","models.col.roles","models.col.fallback","models.col.quota","models.col.cost","models.col.status"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},res.rows.map(r=>h(doc,"tr",{dataset:{modelRow:r.id,modelKind:r.kind}},
      h(doc,"td",{class:"mono",text:r.id}),h(doc,"td",{text:ctx.t(`models.kind.${r.kind}`)}),h(doc,"td",{dataset:{configured:r.configured},text:ctx.t(`models.config.${r.configured}`)}),rolesCell(ctx,r),
      gapCell(ctx,"fallback"),gapCell(ctx,"quota"),gapCell(ctx,"cost"),statusCell(ctx,r))))));
}
export async function modelSettingsPanel(ctx){
  const doc=ctx.doc,[exec,adRaw]=await Promise.all([ctx.api.executors(),ctx.api.raw("/v1/adapters")]);
  const ads=adRaw&&adRaw.ok?mapAdapters(adRaw.data):{state:adRaw&&adRaw.state?adRaw.state:"UNAVAILABLE",items:[],total:0};
  const res=buildModelProviderRows(exec,ads);
  let body;
  if(res.state==="VERIFIED")body=modelTable(ctx,res);
  else if(res.state==="EMPTY")body=emptyNote(ctx,"models.empty");
  else body=stateNote(ctx,res.state);
  const sources=h(doc,"dl",{class:"kv",dataset:{modelSources:"1"}},
    h(doc,"dt",{text:ctx.t("models.source.executors")}),h(doc,"dd",{dataset:{source:"executors"}},statePill(ctx,res.sources.executors==="VERIFIED"?"VERIFIED":res.sources.executors==="ERROR"?"FAILED":"UNAVAILABLE")),
    h(doc,"dt",{text:ctx.t("models.source.adapters")}),h(doc,"dd",{dataset:{source:"adapters"}},statePill(ctx,res.sources.adapters==="VERIFIED"?"VERIFIED":res.sources.adapters==="ERROR"?"FAILED":"UNAVAILABLE")));
  const edit=h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",disabled:"",dataset:{modelEdit:"disabled"},"aria-describedby":"models-edit-reason",text:ctx.t("models.edit")}),
    h(doc,"span",{class:"note",id:"models-edit-reason",text:ctx.t("models.editDisabled")}));
  // //TR: Özet yalnız satırlar okunduysa gösterilir; hiçbir sağlayıcı yapılandırılmamışsa bunu açıkça NOT_CONFIGURED olarak söyler (canlı sağlayıcı izlenimi yok).
  const summary=res.state==="VERIFIED"?h(doc,"p",{class:"note",dataset:{providerConfig:res.configured}},statePill(ctx,CONFIG_PILL[res.configured]??"NOT_VERIFIED",{label:ctx.t(`models.config.${res.configured}`)}),` ${ctx.t(`models.summary.${res.configured}`)}`):null;
  return panel(ctx,{titleKey:"models.title",id:"settings-models"},
    h(doc,"p",{class:"note",text:ctx.t("models.lead")}),sources,summary,body,
    h(doc,"p",{class:"note",dataset:{modelGap:res.rows.length?res.rows[0].gap:"NO_READ_ROUTE"},text:ctx.t("models.gap.note")}),
    h(doc,"p",{class:"note",text:ctx.t("models.secretNote")}),edit);
}
