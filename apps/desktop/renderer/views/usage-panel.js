// //TR: Bu görünüm parçası Ayarlar > "Kullanım ve sınırlar" panelidir (DSK-T0008): yalnız ölçülen değerleri (bugünkü koşular, şu an etkin koşular) mevcut salt-okunur GET'lerden gösterir; token ve maliyet her zaman BİLİNMİYOR'dur. Founder politika sınırları (20/gün, 2 eşzamanlı) "politika — sunucu zorlaması bekliyor" etiketiyle gösterilir, asla zorlanıyor denmez. Hiçbir yazma yapılmaz.
import {h,panel,stateNote,badge} from "../components.js";
import {buildUsage,usageLevel} from "../usage-core.js";

export function usagePanel(ctx,runsRes,exec,now=new Date()){
  const doc=ctx.doc,u=buildUsage(runsRes,exec,now);
  if(u.state!=="VERIFIED")return panel(ctx,{titleKey:"usage.title",id:"settings-usage"},h(doc,"p",{class:"note",text:ctx.t("usage.lead")}),stateNote(ctx,runsRes&&runsRes.state!=="VERIFIED"?runsRes.state:"ERROR"));
  const unknown=ctx.t("usage.unknown"),rm=u.realModel===true?"REAL":u.realModel===false?"NOT_REAL":"UNKNOWN";
  const row=(key,value,extra)=>[h(doc,"dt",{text:ctx.t(key)}),h(doc,"dd",{dataset:extra},value)];
  return panel(ctx,{titleKey:"usage.title",id:"settings-usage"},
    h(doc,"p",{class:"note",text:ctx.t("usage.lead")}),
    h(doc,"p",{class:"note",dataset:{usageExecutor:rm},text:ctx.t(`usage.executor.${rm}`)}),
    h(doc,"dl",{class:"kv",id:"usage-kv"},
      ...row("usage.runsToday",ctx.t("usage.ofLimit",{n:String(u.runsToday),limit:String(u.policy.runsPerDay)}),{usageRunsToday:String(u.runsToday),usageLevel:usageLevel(u,"day")}),
      ...row("usage.activeNow",ctx.t("usage.ofLimit",{n:String(u.activeNow),limit:String(u.policy.concurrentRealRuns)}),{usageActiveNow:String(u.activeNow),usageLevel:usageLevel(u,"concurrent")}),
      ...row("usage.tokens",unknown,{usageTokens:"UNKNOWN"}),
      ...row("usage.cost",unknown,{usageCost:"UNKNOWN"})),
    h(doc,"p",{dataset:{usageEnforcement:u.policy.enforcement}},badge(ctx,ctx.t("usage.policyBadge"))," ",ctx.t("usage.policyNote")),
    h(doc,"p",{class:"note",text:ctx.t("usage.paidNote")}));
}
