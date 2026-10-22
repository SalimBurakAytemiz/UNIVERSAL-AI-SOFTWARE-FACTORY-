// //TR: Bu modül E2E harness'inin saf karar mantığını (durum, çıkış kodu, commit SHA tercihi) içerir; fail-closed: yalnız status==="PASS" ise çıkış 0, sıfır rota FAIL'dir, NOT_VERIFIED rota PASS değildir.
export function computeStatus(routes,fatal){
  const fail=routes.filter(r=>r.status==="FAIL").length,nv=routes.filter(r=>r.status==="NOT_VERIFIED").length;
  if(fatal||fail>0||routes.length===0)return "FAIL";
  return nv>0?"PARTIAL":"PASS";
}
export function exitCodeFor(status){return status==="PASS"?0:1}
// //TR: Tercih sırası: PR head SHA (UASCO_HEAD_SHA) > GITHUB_SHA > git rev-parse HEAD > "UNKNOWN"; boş/boşluk değerler atlanır.
export function resolveCommitSha(envObj,gitHead){
  for(const v of [envObj?.UASCO_HEAD_SHA,envObj?.GITHUB_SHA,gitHead]){const t=String(v??"").trim();if(t)return t}
  return "UNKNOWN";
}
