// //TR: Bu modül B5 ekranlarının paylaşılan form durumunu (taslaklar, seçim, idempotency izleyicileri) ve erişilebilir form bileşenlerini (etiketli alan, argv/kriter liste editörü, durum mesajı) içerir; taslaklar yenilemede kaybolmaz, veri HTML olarak yorumlanmaz ve token hiç görülmez.
import {h,statePill} from "./components.js";
import {createIdempotencyTracker,describePostResult} from "./work-core.js";

const freshProject=()=>({name:"",repositoryPath:"",environmentId:"",testCommand:[""]});
/** //TR: Koşu başlatıldıktan sonraki "görevlere bağla" adımının oturum içi durumu (seçimler, görev başına sonuçlar); yalnız bellekte. */
export const freshRunLink=()=>({missionId:null,runId:null,checked:{},results:{}});
const freshMission=()=>({projectId:"",title:"",objective:"",criteria:[""],riskLevel:"R1",testCommand:[""]});

/** Oturum içi taslaklar; periyodik yenileme veya dil değişimi yazılmış alanları silmez. */
export const drafts={project:freshProject(),mission:freshMission(),open:{project:false,mission:false},status:{},busy:{},missionFilter:"ALL",reasons:{},runExpert:{},runLink:freshRunLink(),evidence:{verification:"ALL",kind:"ALL",cursor:null,stack:[]}};
export const selection={missionId:null,evidenceId:null};
export const trackers={project:createIdempotencyTracker(),mission:createIdempotencyTracker()};
export function resetProjectDraft(){drafts.project=freshProject();trackers.project.reset()}
export function resetMissionDraft(){const keep=drafts.mission.projectId;drafts.mission=freshMission();drafts.mission.projectId=keep;trackers.mission.reset()}
export function resetAllForms(){drafts.project=freshProject();drafts.mission=freshMission();drafts.open={project:false,mission:false};drafts.status={};drafts.busy={};drafts.missionFilter="ALL";drafts.reasons={};drafts.runExpert={};drafts.runLink=freshRunLink();drafts.evidence={verification:"ALL",kind:"ALL",cursor:null,stack:[]};selection.missionId=null;selection.evidenceId=null;trackers.project.reset();trackers.mission.reset();delete drafts.deliveryAcks;delete drafts.deliveryDialog}

/** Etiketli giriş alanı: etiket for/id ile bağlı, ipucu ve hata aria-describedby ile, hata varsa aria-invalid. */
export function field(ctx,{id,labelKey,value="",onInput,errorKey=null,hintKey=null,multiline=false,type="text",required=false,options=null}){
  const doc=ctx.doc,describedBy=[hintKey?`${id}-hint`:null,errorKey?`${id}-err`:null].filter(Boolean).join(" ");
  const common={id,"aria-required":required?"true":null,"aria-invalid":errorKey?"true":null,"aria-describedby":describedBy||null,autocomplete:"off",dataset:{focusKey:id}};
  let control;
  if(options){
    control=h(doc,"select",common,options.map(o=>h(doc,"option",{value:o.value,text:o.label})));
    control.value=value;control.addEventListener("change",()=>onInput(control.value));
  }else{
    control=h(doc,multiline?"textarea":"input",{...common,...(multiline?{rows:"4"}:{type})});
    control.value=value;control.addEventListener("input",()=>onInput(control.value));
  }
  return h(doc,"div",{class:"field"},h(doc,"label",{for:id,text:ctx.t(labelKey)+(required?" *":"")}),control,
    hintKey?h(doc,"p",{class:"field-hint",id:`${id}-hint`,text:ctx.t(hintKey)}):null,
    errorKey?h(doc,"p",{class:"field-error",id:`${id}-err`,text:ctx.t(errorKey)}):null);
}
/** Satır başına bir giriş içeren liste editörü (argv belirteçleri, kabul kriterleri); `items` taslak dizisi yerinde güncellenir, kabuk dizgesi alanı yoktur. */
export function listEditor(ctx,{id,labelKey,itemLabelKey,addKey,removeKey,items,errorKey=null,hintKey=null,multiline=false,preview=false,required=false}){
  const doc=ctx.doc,wrap=h(doc,"div",{class:"field listed",role:"group","aria-labelledby":`${id}-l`,"aria-describedby":[hintKey?`${id}-hint`:null,errorKey?`${id}-err`:null].filter(Boolean).join(" ")||null,"aria-invalid":errorKey?"true":null});
  const list=h(doc,"ol",{class:"list-editor"}),pv=preview?h(doc,"p",{class:"argv-preview mono",id:`${id}-preview`,"aria-live":"off"}):null;
  const paintPreview=()=>{if(pv){const argv=items.map(x=>x.trim()).filter(Boolean);pv.textContent=`${ctx.t("form.argvPreview")} ${JSON.stringify(argv)}`}};
  function paint(focusId){
    list.replaceChildren(...items.map((val,i)=>{
      const inId=`${id}-${i}`,input=h(doc,multiline?"textarea":"input",{id:inId,...(multiline?{rows:"2"}:{type:"text"}),"aria-label":ctx.t(itemLabelKey,{n:i+1}),autocomplete:"off",spellcheck:"false",dataset:{focusKey:inId}});
      input.value=val;input.addEventListener("input",()=>{items[i]=input.value;paintPreview()});
      const rm=h(doc,"button",{type:"button",class:"btn btn-small",id:`${id}-rm-${i}`,"aria-label":ctx.t(removeKey,{n:i+1}),dataset:{focusKey:`${id}-rm-${i}`},text:"✕",on:{click:()=>{items.splice(i,1);if(!items.length)items.push("");paint(`${id}-${Math.min(i,items.length-1)}`);paintPreview()}}});
      return h(doc,"li",{},input,rm);
    }));
    paintPreview();
    if(focusId){const n=doc.getElementById?.(focusId);if(n)n.focus()}
  }
  paint(null);
  const add=h(doc,"button",{type:"button",class:"btn",id:`${id}-add`,dataset:{focusKey:`${id}-add`},text:ctx.t(addKey),on:{click:()=>{items.push("");paint(`${id}-${items.length-1}`)}}});
  wrap.append(...[h(doc,"span",{class:"field-label",id:`${id}-l`,text:ctx.t(labelKey)+(required?" *":"")}),list,pv,add,
    hintKey?h(doc,"p",{class:"field-hint",id:`${id}-hint`,text:ctx.t(hintKey)}):null,
    errorKey?h(doc,"p",{class:"field-error",id:`${id}-err`,text:ctx.t(errorKey)}):null].filter(Boolean));
  return wrap;
}
/** Biçimin son sonucunu (doğrulama özeti, başarı, sunucu hatası) odaklanabilir canlı bölge olarak gösterir. */
export function statusBlock(ctx,formId){
  const st=drafts.status[formId],doc=ctx.doc,id=`${formId}-status`;
  if(!st)return h(doc,"div",{class:"form-status",id,role:"status","aria-live":"polite",tabindex:"-1"});
  if(st.errors&&Object.keys(st.errors).length)return h(doc,"div",{class:"form-status form-status-error",id,role:"alert",tabindex:"-1",dataset:{result:"invalid"}},
    h(doc,"p",{class:"form-status-title",text:ctx.t("form.invalid")}),h(doc,"ul",{},Object.entries(st.errors).map(([f,k])=>h(doc,"li",{text:`${ctx.t(`form.field.${f}`)}: ${ctx.t(k)}`}))));
  return h(doc,"div",{class:`form-status ${st.ok?"form-status-ok":"form-status-error"}`,id,role:st.ok?"status":"alert",tabindex:"-1",dataset:{result:st.ok?"ok":"error"}},
    !st.ok&&st.key==="post.err.denied"?statePill(ctx,"DENIED"):null,h(doc,"p",{text:ctx.t(st.key,st.vars)}));
}
export function setStatus(formId,value){drafts.status[formId]=value}
/** POST sonucunu sınıflar ve form durumuna yazar; {ok} döner. */
export function recordPost(formId,res,okKey,okVars={}){
  const d=describePostResult(res);drafts.status[formId]={ok:d.ok,key:d.ok?okKey:d.key,vars:d.ok?okVars:d.vars,errors:null};return d.ok;
}
/** Yeniden çizimden sonra durum bloğuna odak taşır (ekran okuyucu sonucu duyurur). */
export function focusStatus(doc,formId){const n=doc.getElementById?.(`${formId}-status`);if(n&&typeof n.focus==="function")n.focus()}
/** Odağı belirlenimci yerleştirir (focus.js settleFocus): odak canlı bir denetimdeyse dokunmaz; değilse `keys` sırasıyla, sonra ilk liste öğesi, sonra görünüm başlığı; asla gövde. */
export function settle(ctx,keys=[]){return typeof ctx.settleFocus==="function"?ctx.settleFocus({keys}):null}
/** Bir eylemin sonucundan sonra odağı sonuç bloğuna (varsa) taşır, yoksa `keys` yedeğiyle yerleştirir; sonunda odak asla gövdede kalmaz. */
export function focusResult(ctx,formId,keys=[]){
  const n=ctx.doc.getElementById?.(`${formId}-status`);
  if(n&&typeof n.focus==="function"&&n.disabled!==true)n.focus();
  return settle(ctx,keys);
}
