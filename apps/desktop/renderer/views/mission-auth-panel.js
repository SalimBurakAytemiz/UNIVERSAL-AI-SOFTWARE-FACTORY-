// //TR: Bu görünüm parçası Proje Yolculuğu'ndaki görev başı kapsamlı yetkilendirme formudur (DSK-T0008, Q4): kapsam, sınırlar ve bitiş zamanı yerelde doğrulanır ve önizlenir. Gönderim KAPALIDIR: yetki kaydı Founder onaylı sunucu değişikliğine (P-B) bağlıdır; bu panel hiçbir şey kaydetmez, göndermez ya da saklamaz. Form değerleri yalnız bellekte tutulur.
import {h,panel} from "../components.js";
import {validateMissionAuthorization,buildAuthorizationRequest,AUTH_LIMITS} from "../mission-auth-core.js";
import {describePostResult} from "../work-core.js";
export const authResult={missionId:null,key:null,ok:false};
/** Onay (varsayılan Vazgeç) sonrası tek POST; sonuç canlı bölgede duyurulur. Yerelde yetki saklanmaz. */
export async function submitAuthorization(ctx,v){
  const req=buildAuthorizationRequest(v);if(!req)return {ok:false};
  const yes=await ctx.confirm({title:ctx.t("auth.confirm.title"),body:ctx.t("auth.confirm.body",{runs:String(req.body.maxRuns),until:req.body.expiresAt}),action:ctx.t("auth.confirm.action"),target:req.path,confirmLabel:ctx.t("auth.submit")});
  if(yes!==true)return {ok:false,cancelled:true};
  const res=await ctx.api.post(req.path,req.body),d=describePostResult(res);
  Object.assign(authResult,{missionId:v.preview.missionId,ok:d.ok,key:d.ok?"auth.recorded":d.key});
  await ctx.rerender();return {ok:d.ok,status:res?.status??null};
}
import {RISK_LEVELS} from "../work-core.js";

export const authDraft={missionId:null,maxRisk:"",maxRuns:"",maxConcurrent:"",expiresAt:""};
export function missionAuthPanel(ctx,mission,now=new Date()){
  const doc=ctx.doc,id=mission?mission.missionId:null;
  if(authDraft.missionId!==id)Object.assign(authDraft,{missionId:id,maxRisk:"",maxRuns:"",maxConcurrent:"",expiresAt:""});
  const v=validateMissionAuthorization(authDraft,mission,now);
  const errs=f=>v.errors.filter(e=>e.field===f).map(e=>h(doc,"span",{class:"note",dataset:{authError:`${f}:${e.code}`},text:` ${ctx.t(`auth.error.${e.code}`)}`}));
  const set=(f,val)=>{authDraft[f]=val;void ctx.rerender()};
  const field=(f,input)=>h(doc,"p",{},h(doc,"label",{for:`auth-${f}`,text:ctx.t(`auth.field.${f}`)})," ",input,...errs(f));
  const num=(f,max)=>h(doc,"input",{type:"number",id:`auth-${f}`,min:"1",max:String(max),value:authDraft[f],on:{change:e=>set(f,e.target.value)}});
  return panel(ctx,{titleKey:"auth.title",id:"journey-auth"},
    h(doc,"p",{class:"note",text:ctx.t("auth.lead",{runs:String(AUTH_LIMITS.maxRuns),concurrent:String(AUTH_LIMITS.maxConcurrent),days:String(AUTH_LIMITS.maxDays)})}),
    field("maxRisk",h(doc,"select",{id:"auth-maxRisk",on:{change:e=>set("maxRisk",e.target.value)}},[h(doc,"option",{value:"",text:"—"}),...RISK_LEVELS.map(r=>h(doc,"option",{value:r,selected:authDraft.maxRisk===r,text:r}))])),
    field("maxRuns",num("maxRuns",AUTH_LIMITS.maxRuns)),
    field("maxConcurrent",num("maxConcurrent",AUTH_LIMITS.maxConcurrent)),
    field("expiresAt",h(doc,"input",{type:"date",id:"auth-expiresAt",value:authDraft.expiresAt,on:{change:e=>set("expiresAt",e.target.value)}})),
    v.preview?h(doc,"pre",{class:"code",dataset:{authPreview:"1"}},h(doc,"code",{text:JSON.stringify(v.preview,null,2)})):null,
    h(doc,"p",{class:"note",text:ctx.t("auth.excludes")}),
    h(doc,"button",{type:"button",class:"btn btn-primary",id:"auth-submit",disabled:!v.ok,"aria-describedby":"auth-submit-note",dataset:{authSubmit:v.submit},text:ctx.t("auth.submit"),on:{click:()=>{submitAuthorization(ctx,v)}}}),
    h(doc,"p",{class:"note",id:"auth-submit-note",role:"status",dataset:{authResult:authResult.missionId===id&&authResult.key?(authResult.ok?"RECORDED":"FAILED"):"NONE"},text:authResult.missionId===id&&authResult.key?ctx.t(authResult.key):ctx.t("auth.submitNote")}));
}
