// //TR: Bu görünüm parçası "ilk koşu neden başlamıyor?" yanıtını gösterir: GET /v1/projects/:id/readiness (MISSION, RISK, REPOSITORY, TEST_COMMAND, PLAN) her kontrol için durum + sunucunun gerekçe/sonraki adım kodlarıyla yazılır. Uç nokta masaüstü allow-list'inde yoksa ya da okuma başarısızsa dürüst UNAVAILABLE/ERROR gösterilir, "hazır" varsayılmaz; başka projenin yanıtı reddedilir. Bilinen kod okunur metne çevrilir, bilinmeyen kod AYNEN ve "tanınmadı" notuyla gösterilir. Hazır olmak ürünün doğrulandığı anlamına gelmez.
import {h,stateNote,badge} from "../components.js";
import {readinessPath,mapRunReadiness} from "../project-core.js";

const KIND={OK:"badge-notverified",BLOCKED:"badge-risk",UNKNOWN:""};
const headKey=r=>!r.ready?"runready.head.blocked":r.verifiable?"runready.head.verifiable":"runready.head.ready";
// Sözlükte olmayan kod ham gösterilir (ctx.t eksik anahtarda anahtarın kendisini döndürür).
function codeText(ctx,prefix,code){
  const key=`${prefix}.${code}`,v=ctx.t(key);
  return v===key?`${code} (${ctx.t("runready.unrecognised")})`:v;
}
export async function runReadinessBlock(ctx,projectId){
  const doc=ctx.doc,path=readinessPath(projectId);
  const res=path?await ctx.api.raw(path):{ok:false,state:"ERROR"};
  let mapped=res.ok?mapRunReadiness(res.data):{state:res.state,readiness:null};
  // Başka projenin yanıtı kabul edilmez (hem gövde hem durum etiketi ERROR olur).
  if(mapped.state==="VERIFIED"&&mapped.readiness.projectId!==projectId)mapped={state:"ERROR",readiness:null};
  const wrap=(...c)=>h(doc,"div",{id:"intake-readiness",class:"readiness-block",dataset:{runReadiness:mapped.state==="VERIFIED"?(mapped.readiness.ready?"READY":"BLOCKED"):mapped.state}},h(doc,"h4",{text:ctx.t("runready.title")}),...c);
  if(mapped.state!=="VERIFIED")return wrap(stateNote(ctx,mapped.state,mapped.state==="UNAVAILABLE"?"runready.unavailable":undefined));
  const r=mapped.readiness;
  return wrap(
    h(doc,"p",{class:"note",dataset:{runReadyHead:headKey(r)},text:ctx.t(headKey(r))}),
    h(doc,"ul",{class:"cards",id:"intake-readiness-checks"},r.checks.map(c=>h(doc,"li",{class:"card",dataset:{readyCheck:c.id,readyState:c.state,readyBlocking:String(c.blocking)}},
      h(doc,"strong",{text:ctx.t(`runready.check.${c.id}`)})," ",badge(ctx,ctx.t(`runready.state.${c.state}`),KIND[c.state]),
      c.blocking?null:h(doc,"span",{class:"note",text:` ${ctx.t("runready.notBlocking")}`}),
      c.reason?h(doc,"p",{class:"note",dataset:{readyReason:c.reason},text:codeText(ctx,"runready.reason",c.reason)}):null,
      c.nextAction?h(doc,"p",{class:"note",dataset:{readyNext:c.nextAction},text:`${ctx.t("runready.next")}: ${codeText(ctx,"runready.action",c.nextAction)}`}):null))),
    h(doc,"p",{class:"note",text:ctx.t("runready.doneNote")}));
}
