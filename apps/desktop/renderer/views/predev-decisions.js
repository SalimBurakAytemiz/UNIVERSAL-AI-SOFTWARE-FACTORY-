// //TR: Bu görünüm parçası Proje Yolculuğu'ndaki "Pre-dev kararları" bölümüdür (LANE-A): sunucu pre-dev dizisini başlatmak (POST .../predev/start), faz taslağını kanıtla onaylamak (.../approve {evidenceRefs}) ve reddetmek (.../reject {reason}) için Founder kontrollerini sunar. Karar kapıları sunucudadır (bağımsız onaylayan, kanıt zorunlu, faz sırası); burada yeniden uygulanmaz: onaylayan sunucunun aktörüdür, istemci onaylayan/kanıt uydurmaz, sunucunun ret nedeni (PREDEV_*) AYNEN gösterilir. Kontroller yalnız GET /v1/predev okuması başarılıysa ve karar beklenen bir taslak varsa çıkar (DRAFT/SUBMITTED); reddedilmiş, onaylı ya da hiç yazılmamış artefakt için karar kontrolü yoktur. POST yolları ana süreç izin listesinde yoksa sonuç dürüstçe "etkin değil"dir. API verisi yalnız h()/textContent ile yazılır.
import {h,statePill} from "../components.js";
import {MISSING} from "../model.js";
import {drafts,field,statusBlock,setStatus,focusResult,settle,missionWriteBusy} from "../forms.js";
import {PHASE_KIND} from "../journey-core.js";
import {ARTIFACT_ID_RE,buildStartRequest,buildApproveRequest,buildRejectRequest,classifyPredevPost,predevStatusKey,phaseTimeline} from "../predev-decisions-core.js";

export const PREDEV_START_FORM="predev-start";
export const PREDEV_APPROVE_FORM="predev-approve";
export const PREDEV_REJECT_FORM="predev-reject";
export const predevDraft={missionId:null,artifactId:null,evidence:"",reason:"",keepStatus:false};
/** Seçili mission ya da karar bekleyen artefakt değişince taslaklar ve eski sonuçlar sıfırlanır (başka artefakta yanlış karar gitmesin). */
export function resetPredevDraft(missionId=null,artifactId=null){
  predevDraft.missionId=missionId;predevDraft.artifactId=artifactId;predevDraft.evidence="";predevDraft.reason="";predevDraft.keepStatus=false;
  for(const f of [PREDEV_START_FORM,PREDEV_APPROVE_FORM,PREDEV_REJECT_FORM])delete drafts.status[f];
}

/** //TR: UASCO-T0013: karar eylemleri (onayla/reddet/yeniden onayla) istek doğrulandıktan sonra ve göndermeden önce açık onay ister. Onay penceresi açıkken form KİLİTLİDİR (ikinci basış ikinci pencere/istek açmaz); vazgeçilirse ya da onay işlevi yoksa hiçbir istek gitmez ve durum dürüstçe "onaylanmadı" der. */
export async function confirmDecision(ctx,formId,spec){
  drafts.busy[formId]=true;
  let yes=false;try{yes=typeof ctx.confirm==="function"?(await ctx.confirm(spec))===true:false}finally{drafts.busy[formId]=false}
  return yes;
}
// Anahtarlar düz metin olarak yazılır (yerelleştirme testleri dosyadaki "predev.*" anahtarlarını tarar).
const CONFIRM_KEYS=Object.freeze({
  approve:{title:"predev.confirm.approve.title",body:"predev.confirm.approve.body",action:"predev.confirm.approve.action",ok:"predev.confirm.approve.ok"},
  reject:{title:"predev.confirm.reject.title",body:"predev.confirm.reject.body",action:"predev.confirm.reject.action",ok:"predev.confirm.reject.ok"},
  reapprove:{title:"predev.confirm.reapprove.title",body:"predev.confirm.reapprove.body",action:"predev.confirm.reapprove.action",ok:"predev.confirm.reapprove.ok"}});
const TL_STATE=Object.freeze({NOT_STARTED:"predev.tl.state.NOT_STARTED",DRAFT:"predev.tl.state.DRAFT",SUBMITTED:"predev.tl.state.SUBMITTED",APPROVED:"predev.tl.state.APPROVED",REJECTED:"predev.tl.state.REJECTED"});
const TL_DECISION=Object.freeze({APPROVED:"predev.tl.decision.APPROVED",REJECTED:"predev.tl.decision.REJECTED",PENDING:"predev.tl.decision.PENDING",NONE:"predev.tl.decision.NONE"});
export function decisionSpec(ctx,verb,{kind,artifactId}){
  const K=CONFIRM_KEYS[verb],k=kind?ctx.t(`journey.kind.${kind}`):ctx.t("predev.confirm.kindUnknown");
  return {title:ctx.t(K.title),body:ctx.t(K.body),action:ctx.t(K.action,{kind:k}),target:`${k} (${artifactId})`,confirmLabel:ctx.t(K.ok)};
}
async function submit(ctx,formId,verb,req,keys,missionId,confirm=null){
  if(missionWriteBusy())return {ok:false,busy:true}; // başka bir mission-yazma eylemi sürerken gönderilmez
  if(!req.ok){setStatus(formId,{ok:false,errors:req.errors});await ctx.rerender();focusResult(ctx,formId,keys);return {ok:false,validation:true}}
  if(confirm){
    const yes=await confirmDecision(ctx,formId,confirm);
    if(predevDraft.missionId!==missionId){await ctx.rerender();return {ok:false,stale:true,status:null}}
    if(!yes){setStatus(formId,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,formId,keys);return {ok:false,cancelled:true}}
  }
  drafts.busy[formId]=true;
  // //TR: kilit görünür olsun (diğer düğmeler istek sürerken kapanır); yeniden çizim reddedilirse de kilit BIRAKILIR (try/finally); düğme kapandığı için odak not bloğuna alınır.
  let res;try{await ctx.rerender();settle(ctx,["id:predev-in-flight"]);res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[formId]=false}
  if(predevDraft.missionId!==missionId){await ctx.rerender();return {ok:false,stale:true,status:res?.status??null}} // istek sürerken başka mission seçildi: cevap onun durumuna yazılmaz
  const c=classifyPredevPost(res,predevDraft.missionId),k=predevStatusKey(c,res,verb);
  setStatus(formId,{ok:k.ok,key:k.key,vars:k.vars,errors:null});
  // Başarıda artefakt/faz değişir: taslak girdileri bir sonraki çizimde sıfırlanır ama bu sonucun durum bloğu korunur.
  if(k.ok)predevDraft.keepStatus=true;
  await ctx.rerender();focusResult(ctx,formId,keys);return {ok:k.ok,kind:c.kind,status:res?.status??null};
}
export const submitStart=(ctx,missionId)=>submit(ctx,PREDEV_START_FORM,"start",buildStartRequest({missionId}),["id:predev-start-submit"],missionId);
export const submitApprove=(ctx,missionId,artifactId,kind=null)=>submit(ctx,PREDEV_APPROVE_FORM,"approve",buildApproveRequest({missionId,artifactId,evidenceText:predevDraft.evidence}),["id:predev-approve-submit","id:predev-evidence"],missionId,decisionSpec(ctx,"approve",{kind,artifactId}));
export const submitReject=(ctx,missionId,artifactId,kind=null)=>submit(ctx,PREDEV_REJECT_FORM,"reject",buildRejectRequest({missionId,artifactId,reason:predevDraft.reason}),["id:predev-reject-submit","id:predev-reason"],missionId,decisionSpec(ctx,"reject",{kind,artifactId}));

/** //TR: UASCO-T0013: faz zaman çizelgesi: her faz, kayıtlı durumu, şu anki faz işareti ve kararı (verildi/bekliyor/yok) + özet sayılar. */
export function phaseTimelineBlock(ctx,predev){
  const doc=ctx.doc,tl=phaseTimeline(predev);
  if(!tl)return null;
  return h(doc,"div",{class:"predev-timeline",id:"predev-timeline",role:"region","aria-label":ctx.t("predev.tl.title"),dataset:{tlTaken:String(tl.taken),tlPending:String(tl.pending),tlNone:String(tl.notStarted),tlComplete:tl.complete?"1":"0"}},
    h(doc,"h4",{text:ctx.t("predev.tl.title")}),
    h(doc,"p",{class:"note",dataset:{tlSummary:"1"},text:ctx.t(tl.complete?"predev.tl.summaryComplete":"predev.tl.summary",{taken:tl.taken,pending:tl.pending,none:tl.notStarted})}),
    h(doc,"ul",{class:"predev-tl-list","aria-label":ctx.t("predev.tl.title")},tl.rows.map((r,i)=>h(doc,"li",{dataset:{tlKind:r.kind,tlDecision:r.decision,tlCurrent:r.current?"1":"0"},"aria-current":r.current?"step":null},
      h(doc,"span",{class:"mono",text:`${i+1}.`})," ",h(doc,"strong",{text:ctx.t(`journey.kind.${r.kind}`)})," ",statePill(ctx,r.decision==="APPROVED"?"DONE":r.decision==="REJECTED"?"ATTENTION":r.decision==="PENDING"?"WAITING":"NOT_EXECUTED",{label:ctx.t(TL_STATE[r.state]??"predev.tl.state.NOT_STARTED")}),
      r.current?h(doc,"span",{class:"note",dataset:{tlCurrentMark:"1"},text:` ${ctx.t("predev.tl.current")}`}):null,
      h(doc,"span",{class:"note",text:` — ${ctx.t(TL_DECISION[r.decision])}`}))))); 
}

/** pre: GET /v1/predev eşlemesi (VERIFIED); okunamıyorsa bu bölüm çizilmez (Yolculuk zaten okuma hatasını gösterir). */
export function decisionsPanel(ctx,{missionId,pre}){
  const doc=ctx.doc;
  if(!pre||pre.state!=="VERIFIED")return null;
  const p=pre.predev,kind=PHASE_KIND[p.phase]??null,art=kind?p.artifacts.find(a=>a.kind===kind)??null:null;
  const decidable=Boolean(art)&&(art.state==="DRAFT"||art.state==="SUBMITTED")&&ARTIFACT_ID_RE.test(String(art.artifactId));
  const targetId=decidable?art.artifactId:null;
  if(predevDraft.missionId!==missionId)resetPredevDraft(missionId,targetId);
  else if(predevDraft.artifactId!==targetId){
    if(predevDraft.keepStatus){predevDraft.artifactId=targetId;predevDraft.evidence="";predevDraft.reason="";predevDraft.keepStatus=false}
    else resetPredevDraft(missionId,targetId);
  }
  let body;
  if(!p.active){
    const busy=missionWriteBusy();
    body=[h(doc,"p",{class:"note",dataset:{decision:"start"},text:ctx.t("predev.start.lead")}),
      h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"predev-start-submit",dataset:{focusKey:"predev-start-submit"},disabled:busy,text:ctx.t("predev.start.button"),
        on:{click:()=>{if(!missionWriteBusy())submitStart(ctx,missionId)}}})),
      statusBlock(ctx,PREDEV_START_FORM)];
  }else if(p.phase==="PRE_DEV_COMPLETE"){
    body=[h(doc,"p",{class:"note",role:"status",dataset:{decision:"complete"},text:ctx.t("predev.complete")}),statusBlock(ctx,PREDEV_APPROVE_FORM)];
  }else if(!decidable){
    const why=!art?"predev.none.phase":art.state==="REJECTED"?"predev.none.rejected":art.state==="APPROVED"?"predev.none.approved":art.state==="NOT_STARTED"?"predev.none.noDraft":"predev.none.unreadable";
    body=[h(doc,"p",{class:"note",role:"status",dataset:{decision:"none",why:why.split(".").pop()},text:ctx.t(why,{kind:kind?ctx.t(`journey.kind.${kind}`):MISSING})}),
      statusBlock(ctx,PREDEV_APPROVE_FORM),statusBlock(ctx,PREDEV_REJECT_FORM)];
  }else{
    const busyA=missionWriteBusy(),busyR=busyA;
    body=[
      h(doc,"p",{class:"note",dataset:{decision:"pending",artifact:art.artifactId},text:ctx.t("predev.pending",{kind:ctx.t(`journey.kind.${kind}`)})}),
      h(doc,"dl",{class:"journey-facts"},
        h(doc,"dt",{text:ctx.t("journey.field.version")}),h(doc,"dd",{class:"mono",text:art.version===null?MISSING:String(art.version)}),
        h(doc,"dt",{text:ctx.t("predev.field.artifact")}),h(doc,"dd",{class:"mono",text:art.artifactId}),
        h(doc,"dt",{text:ctx.t("journey.field.author")}),h(doc,"dd",{},art.authorRoleId?h(doc,"span",{class:"mono",text:art.authorRoleId}):MISSING),
        h(doc,"dt",{text:ctx.t("predev.field.state")}),h(doc,"dd",{},statePill(ctx,art.state==="SUBMITTED"?"WAITING":"ACTIVE",{label:art.state}))),
      h(doc,"p",{class:"note",dataset:{note:"server-gates"},text:ctx.t("predev.gates")}),
      h(doc,"div",{class:"predev-approve",role:"group","aria-label":ctx.t("predev.approve.title")},
        h(doc,"h4",{text:ctx.t("predev.approve.title")}),
        field(ctx,{id:"predev-evidence",labelKey:"predev.evidence.label",value:predevDraft.evidence,onInput:v=>{predevDraft.evidence=v},hintKey:"predev.evidence.hint",multiline:true,required:true}),
        h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"predev-approve-submit",dataset:{focusKey:"predev-approve-submit"},disabled:busyA,text:ctx.t("predev.approve.button"),
          on:{click:()=>{if(!missionWriteBusy())submitApprove(ctx,missionId,art.artifactId,kind)}}})),
        statusBlock(ctx,PREDEV_APPROVE_FORM)),
      h(doc,"div",{class:"predev-reject",role:"group","aria-label":ctx.t("predev.reject.title")},
        h(doc,"h4",{text:ctx.t("predev.reject.title")}),
        field(ctx,{id:"predev-reason",labelKey:"predev.reason.label",value:predevDraft.reason,onInput:v=>{predevDraft.reason=v},hintKey:"predev.reason.hint",multiline:true,required:true}),
        h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"predev-reject-submit",dataset:{focusKey:"predev-reject-submit"},disabled:busyR,text:ctx.t("predev.reject.button"),
          on:{click:()=>{if(!missionWriteBusy())submitReject(ctx,missionId,art.artifactId,kind)}}})),
        statusBlock(ctx,PREDEV_REJECT_FORM))];
  }
  return h(doc,"div",{class:"predev-decisions",id:"predev-decisions",role:"region","aria-label":ctx.t("predev.title"),dataset:{predevDecisions:missionId}},
    h(doc,"h3",{text:ctx.t("predev.title")}),p.active?phaseTimelineBlock(ctx,p):null,missionWriteBusy()?h(doc,"p",{class:"note",id:"predev-in-flight",tabindex:"-1",role:"status",dataset:{predevBusy:"1",focusKey:"predev-in-flight"},text:ctx.t("busy.missionWrite")}):null,body,p.active?statusBlock(ctx,PREDEV_START_FORM):null);
}
