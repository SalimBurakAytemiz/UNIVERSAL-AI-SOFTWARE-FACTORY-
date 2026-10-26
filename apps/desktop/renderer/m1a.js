// //TR: Bu modül M1a modunun (Founder kararları D-SBX1-PATH-2026-10-15, D-M1A-STATE-MODEL-2026-10-15, D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15) masaüstü göstergelerini toplar: koşu/görev/teslim yüzeylerindeki "Testler çalıştırılmadı — NOT_VERIFIED (sandbox doğrulanmadı)" rozeti (yalnız sunucu kanıtından; asla "doğrulandı" denmez), iki ayrı eksenin (SOURCE_GENERATION_COMPLETE / NOT_VERIFIED) sunucu etiketleri, Ayarlar'daki sandbox durumu ve NOT_VERIFIED kaynak teslimi kabul penceresi: runId, görev, commit, artefakt hash'i, testlerin çalıştırılmadığı beyanı ve değişen testler; her onay için ayrı açık onay kutusu; kutu durumu runId + missionId + sourceCommit + exportArtifactHash (+ testSurfaceSha256) anahtarına bağlıdır ve anahtar değişince sıfırlanır (RV-M1A-C1-OBS-1). Veri HTML olarak yorumlanmaz.
import {h,badge} from "./components.js";
import {drafts} from "./forms.js";
import {deliveryAckKey} from "./delivery-core.js";
import {isProductVerified} from "./work-core.js";

/** Koşu/görev/teslim yüzeyi için NOT_VERIFIED rozeti; scope yalnız test/erişilebilirlik içindir (run|mission|delivery|export). */
export function notVerifiedBadge(ctx,scope){
  return h(ctx.doc,"span",{class:"badge badge-notverified",dataset:{m1aBadge:scope},title:ctx.t("m1a.badge.title")},ctx.t("m1a.badge"));
}
/** Koşu eşlemesinde test yürütme kanıtı (VERIFY_TESTS/REGRESSION_TESTS) yoksa true; kanıt bilinmiyorsa da true (asla doğrulanmış varsayılmaz). */
export const runNotVerified=run=>!isProductVerified(run);
/** Görevin hiçbir koşusunda test yürütme kanıtı yoksa true (koşusu olmayan görev de NOT_VERIFIED'dır). */
export function missionNotVerified(runs,missionId){return !(runs??[]).some(r=>r&&r.missionId===missionId&&isProductVerified(r))}
/** Ayarlar: GET /v1/system/executors sandbox alanı; doğrulanmış sağlayıcı yoksa "UNAVAILABLE — M1a modu". */
export function sandboxBlock(ctx,sandbox){
  const doc=ctx.doc,state=sandbox&&typeof sandbox.state==="string"?sandbox.state:null;
  const text=state==="AVAILABLE"?ctx.t("m1a.sandbox.available",{id:sandbox.providerId??"?"}):state==="UNAVAILABLE"?ctx.t("m1a.sandbox.unavailable"):ctx.t("m1a.sandbox.unknown");
  return h(doc,"section",{id:"settings-sandbox",dataset:{sandboxState:state??"UNKNOWN"}},
    h(doc,"h3",{text:ctx.t("m1a.sandbox.title")}),
    h(doc,"p",{},badge(ctx,text,state==="AVAILABLE"?"badge-ok":"badge-risk")),
    h(doc,"p",{class:"note",text:ctx.t(state==="AVAILABLE"?"m1a.sandbox.noteAvailable":"m1a.sandbox.note")}));
}

// ---------- İki eksen etiketleri ----------
/** Sunucu etiketi (ör. "SOURCE_GENERATION_COMPLETE — Kaynak kod üretildi"); yoksa durum kodu + yerel açıklama. Bilinmeyen durum asla doğrulanmış gösterilmez. */
export function axisLabel(ctx,axisName,ax){
  if(!ax)return ctx.t(`m1a.axis.${axisName}.unknown`);
  return ax.label??`${ax.state} — ${ctx.t(`m1a.axis.${axisName}.${ax.state}`)}`;
}
export function axisBadges(ctx,sg,pv,scope){
  const doc=ctx.doc;
  return h(doc,"span",{class:"axis-badges",dataset:{m1aAxes:scope}},
    h(doc,"span",{class:`badge ${sg?.state==="SOURCE_GENERATION_COMPLETE"?"badge-ok":"badge-risk"}`,dataset:{axis:"sourceGeneration",axisState:sg?.state??"UNKNOWN"},text:axisLabel(ctx,"sourceGeneration",sg)})," ",
    h(doc,"span",{class:`badge ${pv?.state==="PRODUCT_VERIFIED"?"badge-ok":"badge-notverified"}`,dataset:{axis:"productVerification",axisState:pv?.state??"UNKNOWN",axisReason:pv?.reason??""},text:axisLabel(ctx,"productVerification",pv)}));
}

// ---------- NOT_VERIFIED kaynak teslimi kabul onayları ----------
/** Kutu durumu run başına tutulur ve anahtar (run/görev/commit/artefakt/test yüzeyi) değişince sıfırlanır. */
export function deliveryAckState(d){
  const key=deliveryAckKey(d),cur=drafts.deliveryAcks?.[d.runId];
  if(cur&&cur.key===key)return cur;
  drafts.deliveryAcks??={};drafts.deliveryAcks[d.runId]={key,notExecuted:false,testChanges:false};return drafts.deliveryAcks[d.runId];
}
function setDeliveryAck(d,k,value){const st=deliveryAckState(d);st[k]=value===true}
export function resetDeliveryAcks(runId){if(drafts.deliveryAcks)delete drafts.deliveryAcks[runId]}
function changedList(ctx,changed){
  const doc=ctx.doc,rows=[["m1a.ack.modified",changed.modified],["m1a.ack.deleted",changed.deleted],["m1a.ack.renamed",changed.renamed.map(r=>`${r.from} -> ${r.to}`)],["m1a.ack.harness",changed.harness]].filter(([,xs])=>xs.length);
  return h(doc,"dl",{class:"kv ack-changed"},rows.flatMap(([k,xs])=>[h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",{},h(doc,"ul",{},xs.map(x=>h(doc,"li",{class:"mono",text:x}))))]),
    changed.truncated?[h(doc,"dt",{text:ctx.t("m1a.ack.truncatedLabel")}),h(doc,"dd",{text:ctx.t("m1a.ack.truncated")})]:[]);
}
function checkbox(ctx,{id,d,key,labelKey,checked}){
  const doc=ctx.doc;
  const input=h(doc,"input",{type:"checkbox",id,dataset:{focusKey:id,ack:key},checked:checked?true:null,on:{change:e=>{setDeliveryAck(d,key,e?.target?.checked===true)}}});
  return h(doc,"div",{class:"ack-check"},input," ",h(doc,"label",{for:id,text:ctx.t(labelKey)}));
}
/** Kabul penceresi içeriği: runId, görev, commit, artefakt hash'i, NOT_EXECUTED beyanı, (varsa) değişen testler; her onay için ayrı kutu. */
export function deliveryAckBlock(ctx,d){
  const doc=ctx.doc,st=deliveryAckState(d),parts=[];
  const fact=(k,v)=>[h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",{class:"mono",text:v??"—"})];
  parts.push(h(doc,"dl",{class:"kv delivery-facts"},...fact("m1a.delivery.run",d.runId),...fact("m1a.delivery.mission",d.missionId),...fact("m1a.delivery.commit",d.sourceCommit),...fact("m1a.delivery.hash",d.artifact?.exportArtifactHash)));
  parts.push(h(doc,"p",{class:"note ack-statement",dataset:{ackStatement:"notExecuted"},text:`${axisLabel(ctx,"productVerification",d.productVerification)}. ${ctx.t("m1a.ack.notExecutedStatement")}`}),
    checkbox(ctx,{id:`ack-ne-${d.runId}`,d,key:"notExecuted",labelKey:"m1a.ack.notExecutedLabel",checked:st.notExecuted}));
  if(d.testChanges.required)parts.push(h(doc,"p",{class:"note ack-statement",dataset:{ackStatement:"testChanges"},text:ctx.t("m1a.ack.testChangesStatement")}),changedList(ctx,d.testChanges.changed),
    checkbox(ctx,{id:`ack-tc-${d.runId}`,d,key:"testChanges",labelKey:"m1a.ack.testChangesLabel",checked:st.testChanges}));
  return h(doc,"fieldset",{class:"ack-block",id:`ack-block-${d.runId}`,dataset:{ackRun:d.runId,ackKey:st.key}},h(doc,"legend",{text:ctx.t("m1a.ack.title")}),parts);
}
