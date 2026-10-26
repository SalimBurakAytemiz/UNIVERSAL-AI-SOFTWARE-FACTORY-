// //TR: Bu görünüm parçası koşu adımının "motor gerçeği" bloğudur: GET /v1/system/executors yanıtından etkin yürütücü, implementer/reviewer UASCO Claude profil durumları (READY / LOGIN_REQUIRED / REFUSED) ve sandbox durumu gösterilir. Profil READY değilse Kurucunun kendisinin çalıştıracağı giriş komutu yalnız metin olarak görünür (renderer asla çalıştırmaz). Okuma yoksa dürüst "bilinmiyor" yazılır; hiçbir durum "çalışıyor" gibi görünmez ve ürünün doğrulandığı söylenmez.
import {h,stateNote,badge} from "../components.js";
import {engineVerdict} from "../project-core.js";

const tOr=(ctx,k,fallback)=>{const v=ctx.t(k);return v===k?fallback:v};
// //TR: Engelleyici kod -> okunur metin; "KOD:neden" biçiminde (CLAUDE_PROFILE_REFUSED:<neden>) önek çevrilir, neden ham kalır. Sunucunun serbest metni (founderAction) bilerek gösterilmez; bilinmeyen kod ham ve "tanınmadı" notuyla gösterilir.
function blockerText(ctx,code){
  const i=code.indexOf(":"),head=i<0?code:code.slice(0,i),key=`run.reason.${head}`,v=ctx.t(key);
  if(v===key)return `${code} (${ctx.t("runengine.unrecognised")})`;
  return i<0?v:`${v} (${code.slice(i+1)})`;
}
const LOGIN_BLOCKERS=/^CLAUDE_PROFILE_LOGIN_(REQUIRED|EXPIRED)$/;
function profileRow(ctx,role,p){
  const doc=ctx.doc,state=p?p.state:null,blockers=p&&Array.isArray(p.blockers)?p.blockers:[],notReady=p!==null&&p.ready===false;
  const needsLogin=p!==null&&(state==="LOGIN_REQUIRED"||blockers.some(b=>LOGIN_BLOCKERS.test(b)));
  return h(doc,"li",{class:"card",dataset:{engineProfile:role,engineProfileState:p===null?"MISSING":state??"UNKNOWN",engineRoleReady:p===null||p.ready===null?"UNKNOWN":String(p.ready)}},
    h(doc,"strong",{text:ctx.t(`exec.profile.role.${role}`)})," ",
    badge(ctx,p===null||state===null?ctx.t("exec.state.UNKNOWN"):tOr(ctx,`exec.profile.state.${state}`,state),state==="READY"&&!notReady?"badge-ok":"badge-risk"),
    notReady?h(doc,"span",{class:"note",text:` ${ctx.t("runengine.role.notReady")}`}):null,
    p===null?h(doc,"p",{class:"note",text:ctx.t("runengine.profile.missing")}):null,
    p&&state&&state!=="READY"?h(doc,"p",{class:"note",text:tOr(ctx,`exec.profile.hint.${state}`,p.reason??state)}):null,
    blockers.length?h(doc,"ul",{class:"note",dataset:{engineBlockers:role}},blockers.map(b=>h(doc,"li",{dataset:{engineBlocker:b},text:blockerText(ctx,b)}))):null,
    needsLogin&&p.loginCommand?h(doc,"p",{class:"note",text:ctx.t("exec.profile.loginHint")}):null,
    needsLogin&&p.loginCommand?h(doc,"pre",{class:"code",dataset:{engineLogin:role}},h(doc,"code",{text:p.loginCommand})):null);
}
/** exec: ctx.api.executors() sonucu ({state,...}); okuma başarısızsa durum notu + "bilinmiyor" başlığı. */
export function runEngineBlock(ctx,exec){
  const doc=ctx.doc,v=engineVerdict(exec),sb=v.sandbox&&v.sandbox.state?v.sandbox.state:null;
  const wrap=(...c)=>h(doc,"div",{id:"run-engine",class:"note",dataset:{runEngine:v.kind,engineSandbox:sb??"UNKNOWN"}},h(doc,"strong",{text:ctx.t("runengine.title")}),...c);
  if(!exec||exec.state!=="VERIFIED")return wrap(stateNote(ctx,exec?exec.state:"ERROR",exec&&exec.state==="UNAVAILABLE"?"runengine.unavailable":undefined),h(doc,"p",{class:"note",dataset:{engineHead:"UNKNOWN"},text:ctx.t("runengine.head.UNKNOWN")}));
  const activeKey=v.active===null?null:`runengine.active.${v.active}`;
  return wrap(
    h(doc,"p",{class:"note",dataset:{engineHead:v.kind},text:ctx.t(`runengine.head.${v.kind}`)}),
    h(doc,"p",{dataset:{engineActive:v.active??"UNKNOWN"}},ctx.t("runengine.active")+": ",v.active===null?ctx.t("exec.state.UNKNOWN"):(ctx.t(activeKey)===activeKey?`${v.active} (${ctx.t("runengine.unrecognised")})`:ctx.t(activeKey))),
    h(doc,"ul",{class:"cards exec-profiles"},profileRow(ctx,"implementer",v.implementer),profileRow(ctx,"reviewer",v.reviewer)),
    h(doc,"p",{dataset:{engineSandboxNote:sb??"UNKNOWN"},text:ctx.t(sb==="AVAILABLE"?"runengine.sandbox.AVAILABLE":sb==="UNAVAILABLE"?"runengine.sandbox.UNAVAILABLE":"runengine.sandbox.UNKNOWN")}),
    h(doc,"p",{class:"note",text:ctx.t("runengine.note")}));
}
