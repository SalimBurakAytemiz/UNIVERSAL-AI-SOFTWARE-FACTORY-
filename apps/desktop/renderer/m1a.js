// //TR: Bu modül M1a modunun (Founder kararları D-SBX1-PATH-2026-10-15 + koşulları) masaüstü göstergelerini toplar: koşu/görev/teslim yüzeylerindeki "Testler çalıştırılmadı — NOT_VERIFIED (sandbox doğrulanmadı)" rozeti (yalnız sunucu kanıtından: test yürütme kanıtı yoksa gösterilir, asla "doğrulandı" denmez), Ayarlar'daki sandbox durumu ve COMPLETE kabulünde her onay için ayrı açık onay kutusu (NOT_EXECUTED + değişen test/harness listesi). Veri HTML olarak yorumlanmaz; onay nesneleri yalnız sunucunun bildirdiği headSha/testSurfaceSha256 ile kurulur.
import {h,badge} from "./components.js";
import {drafts} from "./forms.js";

const SHA_RE=/^[0-9a-f]{40}$/,SHA256_RE=/^[0-9a-f]{64}$/;
/** Koşu/görev/teslim yüzeyi için NOT_VERIFIED rozeti; scope yalnız test/erişilebilirlik içindir (run|mission|delivery|export). */
export function notVerifiedBadge(ctx,scope){
  return h(ctx.doc,"span",{class:"badge badge-notverified",dataset:{m1aBadge:scope},title:ctx.t("m1a.badge.title")},ctx.t("m1a.badge"));
}
/** Koşu eşlemesinde test yürütme kanıtı (VERIFY_TESTS/REGRESSION_TESTS) yoksa true; kanıt bilinmiyorsa da true (asla doğrulanmış varsayılmaz). */
export const runNotVerified=run=>!(run&&run.testsExecuted===true);
/** Görevin hiçbir koşusunda test yürütme kanıtı yoksa true (koşusu olmayan görev de NOT_VERIFIED'dır). */
export function missionNotVerified(runs,missionId){return !(runs??[]).some(r=>r&&r.missionId===missionId&&r.testsExecuted===true)}
/** Ayarlar: GET /v1/system/executors sandbox alanı; doğrulanmış sağlayıcı yoksa "UNAVAILABLE — M1a modu". */
export function sandboxBlock(ctx,sandbox){
  const doc=ctx.doc,state=sandbox&&typeof sandbox.state==="string"?sandbox.state:null;
  const text=state==="AVAILABLE"?ctx.t("m1a.sandbox.available",{id:sandbox.providerId??"?"}):state==="UNAVAILABLE"?ctx.t("m1a.sandbox.unavailable"):ctx.t("m1a.sandbox.unknown");
  return h(doc,"section",{id:"settings-sandbox",dataset:{sandboxState:state??"UNKNOWN"}},
    h(doc,"h3",{text:ctx.t("m1a.sandbox.title")}),
    h(doc,"p",{},badge(ctx,text,state==="AVAILABLE"?"badge-ok":"badge-risk")),
    h(doc,"p",{class:"note",text:ctx.t(state==="AVAILABLE"?"m1a.sandbox.noteAvailable":"m1a.sandbox.note")}));
}

// ---------- COMPLETE onayları ----------
export function ackState(missionId){return drafts.acks?.[missionId]??{notExecuted:false,testChanges:false}}
function setAck(missionId,key,value){drafts.acks??={};drafts.acks[missionId]={...ackState(missionId),[key]:value===true}}
export function resetAcks(missionId){if(drafts.acks)delete drafts.acks[missionId]}
/**
 * Sunucunun completionRequirements görünümü + onay kutusu durumundan kesin onay nesnelerini kurar.
 * Gerekli onay işaretlenmemişse veya kanıt kimliği (headSha / testSurfaceSha256) yoksa hata döner ve istek gönderilmez.
 */
export function buildCompletionAcknowledgements(req,checks){
  const errors={},acknowledgements={};
  if(!req)return {ok:true,acknowledgements,errors};
  if(req.notExecuted?.required){
    if(checks?.notExecuted!==true)errors.acknowledgement="err.ackNotExecutedRequired";
    else if(!SHA_RE.test(String(req.headSha??"")))errors.acknowledgement="err.ackDataMissing";
    else acknowledgements.notExecuted={acknowledgeNotExecuted:true,headSha:req.headSha};
  }
  if(req.testChanges?.required&&!errors.acknowledgement){
    if(checks?.testChanges!==true)errors.acknowledgement="err.ackTestChangesRequired";
    else if(!SHA256_RE.test(String(req.testChanges.testSurfaceSha256??"")))errors.acknowledgement="err.ackDataMissing";
    else acknowledgements.testChanges={acknowledgeTestChanges:true,testSurfaceSha256:req.testChanges.testSurfaceSha256};
  }
  return {ok:!Object.keys(errors).length,acknowledgements,errors};
}
function changedList(ctx,changed){
  const doc=ctx.doc,rows=[["m1a.ack.modified",changed.modified],["m1a.ack.deleted",changed.deleted],["m1a.ack.renamed",changed.renamed.map(r=>`${r.from} -> ${r.to}`)],["m1a.ack.harness",changed.harness]].filter(([,xs])=>xs.length);
  return h(doc,"dl",{class:"kv ack-changed"},rows.flatMap(([k,xs])=>[h(doc,"dt",{text:ctx.t(k)}),h(doc,"dd",{},h(doc,"ul",{},xs.map(x=>h(doc,"li",{class:"mono",text:x}))))]),
    changed.truncated?[h(doc,"dt",{text:ctx.t("m1a.ack.truncatedLabel")}),h(doc,"dd",{text:ctx.t("m1a.ack.truncated")})]:[]);
}
function checkbox(ctx,{id,missionId,key,labelKey,checked}){
  const doc=ctx.doc;
  const input=h(doc,"input",{type:"checkbox",id,dataset:{focusKey:id,ack:key},checked:checked?true:null,on:{change:e=>{setAck(missionId,key,e?.target?.checked===true)}}});
  return h(doc,"div",{class:"ack-check"},input," ",h(doc,"label",{for:id,text:ctx.t(labelKey)}));
}
/** COMPLETE öncesi gösterilen onay bloğu: NOT_EXECUTED beyanı ve (varsa) değişen test/harness listesi; her onay için ayrı kutu. Gerek yoksa null. */
export function completionAckBlock(ctx,missionId,req){
  if(!req||(!req.notExecuted?.required&&!req.testChanges?.required))return null;
  const doc=ctx.doc,st=ackState(missionId),parts=[];
  if(req.notExecuted?.required)parts.push(h(doc,"p",{class:"note ack-statement",dataset:{ackStatement:"notExecuted"},text:ctx.t("m1a.ack.notExecutedStatement")}),
    checkbox(ctx,{id:`ack-ne-${missionId}`,missionId,key:"notExecuted",labelKey:"m1a.ack.notExecutedLabel",checked:st.notExecuted}));
  if(req.testChanges?.required)parts.push(h(doc,"p",{class:"note ack-statement",dataset:{ackStatement:"testChanges"},text:ctx.t("m1a.ack.testChangesStatement")}),changedList(ctx,req.testChanges.changed),
    checkbox(ctx,{id:`ack-tc-${missionId}`,missionId,key:"testChanges",labelKey:"m1a.ack.testChangesLabel",checked:st.testChanges}));
  return h(doc,"fieldset",{class:"ack-block",id:`ack-block-${missionId}`,dataset:{ackMission:missionId}},h(doc,"legend",{text:ctx.t("m1a.ack.title")}),parts);
}
