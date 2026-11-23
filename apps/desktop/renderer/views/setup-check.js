// //TR: Bu görünüm parçası Ayarlar'daki "Hazır mı?" Founder kurulum denetimidir (A-SETUP-1): Claude CLI (yerel mi .cmd kısayolu mu), implementer ve reviewer oturumu, test sandbox'ı ve çalışan ürün köprüsü için PASS / BLOCKED (kesin kodla) / UNKNOWN satırları gösterir; her engel için Founder'ın kendi çalıştıracağı düzeltme METİN olarak yazılır. Yalnızca mevcut salt-okunur okumalardan beslenir; hiçbir şey çalıştırılmaz ya da değiştirilmez, API'nin bildirmediği hiçbir şey PASS görünmez. Windows kabul kiti komutu yalnız metindir.
import {h,panel,stateNote,badge} from "../components.js";
import {buildSetupChecks,nextStep,ACCEPTANCE_COMMAND} from "../setup-check-core.js";

const tOr=(ctx,k,fallback)=>{const v=ctx.t(k);return v===k?fallback:v};
const KIND={PASS:"badge-ok",BLOCKED:"badge-risk",UNKNOWN:""};
/** Kod -> okunur metin ("KOD:ayrıntı" önek çevrilir, ayrıntı ham kalır); bilinmeyen kod ham ve "tanınmadı" notuyla. */
export function reasonText(ctx,code){
  const i=code.indexOf(":"),head=i<0?code:code.slice(0,i),detail=i<0?null:code.slice(i+1);
  const v=tOr(ctx,`setup.reason.${head}`,null)??tOr(ctx,`run.reason.${head}`,null);
  if(v===null)return `${code} (${ctx.t("setup.unrecognised")})`;
  return detail?`${v} (${detail.slice(0,80)})`:v;
}
const fixKey=r=>{
  if(r.state==="PASS")return null;
  if(r.id==="CLI")return r.state==="UNKNOWN"?"setup.fix.UNKNOWN":r.reasons.some(c=>INSTALL.includes(c))?"setup.fix.CLI.install":r.reasons.some(c=>LAUNCHER.includes(c))?"setup.fix.CLI.launcher":"setup.fix.CLI.unknownCode";
  if(r.id==="IMPLEMENTER"||r.id==="REVIEWER")return r.state==="UNKNOWN"?"setup.fix.UNKNOWN":r.reasons.some(c=>c.startsWith("CLAUDE_PROFILE_REFUSED"))?"setup.fix.profile.refused":"setup.fix.profile.login";
  if(r.id==="EXECUTOR")return r.state==="UNKNOWN"?"setup.fix.UNKNOWN":"setup.fix.EXECUTOR";
  if(r.id==="SANDBOX")return r.state==="UNKNOWN"?"setup.fix.UNKNOWN":"setup.fix.SANDBOX";
  return r.state==="BLOCKED"?"setup.fix.PRODUCT.blocked":"setup.fix.PRODUCT.untested";
};
const LAUNCHER=["PROVIDER_PROVENANCE_NOT_READY","CLAUDE_PACKAGE_PROVENANCE_REQUIRED","CLAUDE_LAUNCHER_PROVENANCE_CHANGED","CLAUDE_PACKAGE_PROVENANCE_CHANGED"];
// //TR: "CLI'yi kur" düzeltmesi yalnız CLI'nin gerçekten bulunamadığı/kısayol olduğu kodlara verilir ve başlatıcı düzeltmesinden ÖNCE bakılır (CLI yokken "yeniden etkinleştir" başarılamaz); bilinmeyen kod kurulum metni almaz.
const INSTALL=["CLAUDE_CLI_NOT_FOUND","CLAUDE_CLI_SHIM_UNSUPPORTED"];
export function setupCheckPanel(ctx,exec){
  const doc=ctx.doc,c=buildSetupChecks(exec),id="settings-setup";
  const head=h(doc,"p",{class:"note",role:"status",dataset:{setupKind:c.kind,setupPass:String(c.pass),setupBlocked:String(c.blocked),setupUnknown:String(c.unknown)},text:ctx.t(`setup.head.${c.kind}`,{pass:String(c.pass),total:String(c.rows.length),blocked:String(c.blocked),unknown:String(c.unknown)})});
  const note=!c.readable?stateNote(ctx,exec?exec.state:"ERROR",exec&&exec.state==="UNAVAILABLE"?"setup.unavailable":undefined):null;
  const list=h(doc,"ul",{class:"cards setup-rows",id:"setup-rows"},c.rows.map(r=>{
    const fk=fixKey(r);
    return h(doc,"li",{class:"card",dataset:{setupRow:r.id,setupState:r.state}},
      h(doc,"strong",{text:ctx.t(`setup.row.${r.id}`)})," ",badge(ctx,ctx.t(`setup.state.${r.state}`),KIND[r.state]),
      r.state==="PASS"&&r.providerId?h(doc,"span",{class:"note mono",dataset:{setupProvider:r.providerId},text:` ${r.providerId}`}):null,
      r.reasons.length?h(doc,"ul",{class:"note"},r.reasons.map(code=>h(doc,"li",{dataset:{setupReason:code},text:reasonText(ctx,code)}))):null,
      r.note?h(doc,"p",{class:"note",dataset:{setupNote:r.note},text:ctx.t(`setup.note.${r.note}`)}):null,
      fk?h(doc,"p",{class:"note",dataset:{setupFix:fk},text:ctx.t(fk)}):null,
      r.login?h(doc,"p",{class:"note",text:ctx.t("exec.profile.loginHint")}):null,
      r.login?h(doc,"pre",{class:"code",dataset:{setupLogin:r.id}},h(doc,"code",{text:r.login})):null,
      r.id==="SANDBOX"&&r.state!=="PASS"?h(doc,"p",{class:"note",dataset:{setupConsequence:"TESTS_NOT_EXECUTED"},text:ctx.t("setup.wizard.sandboxConsequence")}):null);
  }));
  return panel(ctx,{titleKey:"setup.title",id},h(doc,"p",{class:"note",text:ctx.t("setup.lead")}),head,wizardBlock(ctx,c),note,list,
    h(doc,"h3",{text:ctx.t("setup.kit.title")}),h(doc,"p",{class:"note",text:ctx.t("setup.kit.lead")}),
    h(doc,"pre",{class:"code",dataset:{setupKit:"1"}},h(doc,"code",{text:ACCEPTANCE_COMMAND})),
    h(doc,"p",{class:"note",dataset:{setupKitPending:"1"},text:ctx.t("setup.kit.pending")}),
    h(doc,"p",{class:"note",text:ctx.t("setup.kit.note")}));
}

// //TR: DSK-T0008 sihirbaz özeti: sıradaki adım (PASS olmayan ilk satır), genel durum ve runner durumu (sunucu bildirmediği için BİLİNMİYOR). Bu panelde düğme yoktur (A-SETUP-1): giriş komutu seçilebilir metindir, Founder kendisi kopyalayıp çalıştırır.
function wizardBlock(ctx,c){
  const doc=ctx.doc,w=nextStep(c);
  return h(doc,"section",{class:"setup-wizard",id:"setup-wizard",dataset:{wizardKind:w.kind,wizardStep:w.step??"NONE"}},
    h(doc,"h3",{text:ctx.t("setup.wizard.title")}),
    h(doc,"p",{role:"status",text:ctx.t(`setup.wizard.kind.${w.kind}`)}),
    w.step?h(doc,"p",{class:"note",dataset:{wizardNext:w.step},text:ctx.t("setup.wizard.next",{n:String(w.index),total:String(w.total),step:ctx.t(`setup.row.${w.step}`)})}):null,
    h(doc,"p",{class:"note",dataset:{wizardRunner:w.runner},text:ctx.t("setup.wizard.runner")}));
}
