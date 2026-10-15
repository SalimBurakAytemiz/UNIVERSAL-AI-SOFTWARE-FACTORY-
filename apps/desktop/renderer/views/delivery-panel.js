// //TR: Bu görünüm parçası Project Studio > Teslim sekmesindeki M1a c2 koşu teslimlerini gösterir (D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15): SOURCE_GENERATION_COMPLETE koşular runId, sourceCommit ve (hazırlandıysa) exportArtifactHash ile listelenir; "Teslim paketini hazırla" deterministik artefaktı üretir, kabul penceresi runId/görev/commit/artefakt hash'ini, testlerin çalıştırılmadığı beyanını ve değişen testleri her onay için ayrı açık kutuyla gösterir, "Teslim paketini dışa aktar" ana süreçte hash yeniden doğrulanarak yapılır. Diğer koşular yalnız iki eksen etiketiyle (eylemsiz) gösterilir. Hiçbir yüzey doğrulanmamış ürün için COMPLETE/PASS/VERIFIED göstermez; her eylemden sonra odak sonuç bloğuna taşınır (asla gövdede kalmaz).
import {h,panel,stateNote,emptyNote,statusPill,badge} from "../components.js";
import {drafts,statusBlock,setStatus,focusResult,settle} from "../forms.js";
import {describePostResult} from "../work-core.js";
import {buildPrepareRequest,buildAcceptanceRequest,isSourceComplete} from "../delivery-core.js";
import {axisBadges,axisLabel,deliveryAckBlock,deliveryAckState,resetDeliveryAcks} from "../m1a.js";

export const deliveryStatusId=runId=>`dl-${runId}`;
const EXPORT_REASONS=["CANCELLED","DELIVERY_UNAVAILABLE","DELIVERY_RECORD_INVALID","DELIVERY_ARTIFACT_HASH_MISMATCH","DELIVERY_ARTIFACT_MISSING","DELIVERY_PATH_REJECTED","DELIVERY_WRITE_FAILED","DELIVERY_ARTIFACT_NOT_PREPARED"];
const dialogOpen=runId=>drafts.deliveryDialog?.[runId]===true;
function setDialog(runId,open){drafts.deliveryDialog??={};if(open)drafts.deliveryDialog[runId]=true;else delete drafts.deliveryDialog[runId]}

async function post(ctx,sid,req,okKey,okVars,keys){
  drafts.busy[sid]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[sid]=false}
  const d=describePostResult(res);
  setStatus(sid,{ok:d.ok,key:d.ok?okKey:d.key,vars:d.ok?okVars(res):d.vars,errors:null});
  await ctx.refreshAll({force:true});focusResult(ctx,sid,keys);
  return {ok:d.ok,status:res?.status??null,body:res?.body??null};
}
/** "Teslim paketini hazırla": yalnız SOURCE_GENERATION_COMPLETE ve kabul edilmemiş koşu; sunucu NO_GENERATED_SOURCE / SOURCE_GENERATION_NOT_COMPLETE ile reddedebilir. */
export async function prepareDelivery(ctx,d){
  const sid=deliveryStatusId(d.runId),keys=[`id:dl-prep-${d.runId}`,`id:dl-open-${d.runId}`];
  const req=buildPrepareRequest(d);
  if(!req.ok){setStatus(sid,{ok:false,errors:req.errors});await ctx.rerender();focusResult(ctx,sid,keys);return {ok:false,validation:true}}
  return post(ctx,sid,req,"m1a.delivery.prepared",res=>({hash:res?.body?.artifact?.exportArtifactHash??"—"}),keys);
}
export async function openAcceptance(ctx,d){
  setDialog(d.runId,true);deliveryAckState(d);await ctx.rerender();
  settle(ctx,[`id:ack-ne-${d.runId}`,`id:dl-accept-${d.runId}`]);
}
export async function closeAcceptance(ctx,d){setDialog(d.runId,false);await ctx.rerender();settle(ctx,[`id:dl-open-${d.runId}`,`id:dl-prep-${d.runId}`])}
/** Kabul: kutular aynı anahtara ait ve işaretli olmalı; açık onay penceresi (eylem + hedef) sonrası birebir kabul nesnesi gönderilir. Kabul COMPLETE değildir, ürünü doğrulamaz. */
export async function acceptDelivery(ctx,d){
  const sid=deliveryStatusId(d.runId),keys=[`id:dl-accept-${d.runId}`,`id:ack-ne-${d.runId}`,`id:dl-export-${d.runId}`];
  const req=buildAcceptanceRequest(d,deliveryAckState(d));
  if(!req.ok){setStatus(sid,{ok:false,errors:req.errors});await ctx.rerender();focusResult(ctx,sid,keys);return {ok:false,validation:true}}
  const yes=await ctx.confirm({title:ctx.t("m1a.delivery.confirmTitle"),body:`${axisLabel(ctx,"productVerification",d.productVerification)}. ${ctx.t("m1a.delivery.confirmBody",{accepted:ctx.t("m1a.delivery.acceptedLabel")})}`,
    action:ctx.t("m1a.delivery.accept"),target:`${d.runId} · ${d.sourceCommit} · ${req.body.acceptance.exportArtifactHash}`,confirmLabel:ctx.t("m1a.delivery.accept")});
  if(yes!==true){setStatus(sid,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,sid,keys);return {ok:false,cancelled:true}}
  const r=await post(ctx,sid,req,"m1a.delivery.acceptedDone",()=>({label:ctx.t("m1a.delivery.acceptedLabel")}),[`id:dl-export-${d.runId}`,...keys]);
  if(r.ok){resetDeliveryAcks(d.runId);setDialog(d.runId,false);await ctx.rerender();focusResult(ctx,sid,[`id:dl-export-${d.runId}`])}
  return r;
}
/** "Teslim paketini dışa aktar": renderer yalnız run kimliği verir; ana süreç sunucunun yeniden doğruladığı kaydı alır, dosya hash'ini tekrar doğrular ve seçilen konuma yazar. */
export async function exportDelivery(ctx,d){
  const sid=deliveryStatusId(d.runId),native=ctx.native;let msg;
  if(!native||typeof native.exportDelivery!=="function")msg={ok:false,key:"m1a.delivery.noNative",vars:{},errors:null};
  else{
    let r=null;try{r=await native.exportDelivery(d.runId)}catch{r=null}
    msg=r&&r.exported===true?{ok:true,key:"m1a.delivery.exported",vars:{hash:String(r.sha256??""),file:String(r.savedTo??r.fileName??"")},errors:null}
      :{ok:false,key:`m1a.delivery.reason.${r&&EXPORT_REASONS.includes(r.reason)?r.reason:"DELIVERY_UNAVAILABLE"}`,vars:{},errors:null};
  }
  setStatus(sid,msg);await ctx.rerender();focusResult(ctx,sid,[`id:dl-export-${d.runId}`]);return {ok:msg.ok};
}

function deliveryCard(ctx,d){
  const doc=ctx.doc,sid=deliveryStatusId(d.runId),busy=drafts.busy[sid]===true,prepared=!!d.artifact,accepted=!!d.accepted;
  const fact=(k,v,cls="mono")=>[h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",{class:cls,text:v})];
  const btn=(id,key,on,primary=false)=>h(doc,"button",{type:"button",class:`btn${primary?" btn-primary":""}`,id,dataset:{focusKey:id},disabled:busy,text:ctx.t(key),on:{click:on}});
  const buttons=[];
  if(!accepted)buttons.push(btn(`dl-prep-${d.runId}`,"m1a.delivery.prepare",()=>prepareDelivery(ctx,d),!prepared));
  if(prepared&&!accepted&&!dialogOpen(d.runId))buttons.push(btn(`dl-open-${d.runId}`,"m1a.delivery.openAccept",()=>openAcceptance(ctx,d),true));
  if(prepared&&accepted)buttons.push(btn(`dl-export-${d.runId}`,"m1a.delivery.export",()=>exportDelivery(ctx,d),true));
  const dialog=prepared&&!accepted&&dialogOpen(d.runId)?h(doc,"section",{class:"delivery-dialog",id:`dl-dialog-${d.runId}`,role:"group","aria-labelledby":`dl-dialog-t-${d.runId}`,dataset:{deliveryDialog:d.runId}},
    h(doc,"h4",{id:`dl-dialog-t-${d.runId}`,text:ctx.t("m1a.delivery.dialogTitle")}),
    deliveryAckBlock(ctx,d),
    h(doc,"div",{class:"btn-row"},btn(`dl-accept-${d.runId}`,"m1a.delivery.accept",()=>acceptDelivery(ctx,d),true),btn(`dl-cancel-${d.runId}`,"m1a.delivery.cancel",()=>closeAcceptance(ctx,d)))):null;
  return h(doc,"li",{class:"card delivery-card",dataset:{deliveryRun:d.runId,deliveryState:accepted?"ACCEPTED":prepared?"PREPARED":"NOT_PREPARED"}},
    h(doc,"h3",{class:"mono",text:d.runId}),
    h(doc,"p",{class:"panel-meta"},axisBadges(ctx,d.sourceGeneration,d.productVerification,"delivery"),accepted?[" ",badge(ctx,ctx.t("m1a.delivery.acceptedLabel"),"badge-notverified")]:null),
    h(doc,"dl",{class:"kv"},...fact("m1a.delivery.mission",d.missionId),...fact("m1a.delivery.commit",d.sourceCommit??"—"),
      ...fact("m1a.delivery.hash",d.artifact?.exportArtifactHash??ctx.t("m1a.delivery.notPrepared"),d.artifact?"mono":""),
      ...(prepared?fact("m1a.delivery.fileState",d.fileState?ctx.t(`m1a.delivery.file.${d.fileState}`):"—",""):[])),
    h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("m1a.delivery.actions",{run:d.runId})},buttons),
    dialog,
    statusBlock(ctx,sid));
}
/** Koşu teslimleri paneli: SOURCE_GENERATION_COMPLETE koşular eylemli kartlar, diğerleri yalnız iki eksen etiketiyle tablo. */
export function runDeliveriesPanel(ctx,list){
  const doc=ctx.doc;
  let body;
  if(list.state!=="VERIFIED")body=stateNote(ctx,list.state);
  else{
    const complete=list.items.filter(isSourceComplete),others=list.items.filter(d=>!isSourceComplete(d));
    body=h(doc,"div",{},
      complete.length?h(doc,"ul",{class:"cards delivery-list"},complete.map(d=>deliveryCard(ctx,d))):emptyNote(ctx,"m1a.delivery.noneComplete"),
      others.length?h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"studio-other-runs"},h(doc,"caption",{text:ctx.t("m1a.delivery.othersCaption")}),
        h(doc,"thead",{},h(doc,"tr",{},["m1a.delivery.col.run","m1a.delivery.col.status","m1a.delivery.col.source","m1a.delivery.col.product"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
        h(doc,"tbody",{},others.map(d=>h(doc,"tr",{dataset:{otherRun:d.runId}},h(doc,"td",{class:"mono",text:d.runId}),h(doc,"td",{},d.status?statusPill(ctx,d.status):"—"),
          h(doc,"td",{text:axisLabel(ctx,"sourceGeneration",d.sourceGeneration)}),h(doc,"td",{text:axisLabel(ctx,"productVerification",d.productVerification)})))))):null);
  }
  return panel(ctx,{titleKey:"m1a.delivery.title",id:"studio-deliveries"},h(doc,"p",{class:"note",text:ctx.t("m1a.delivery.lead")}),body);
}
