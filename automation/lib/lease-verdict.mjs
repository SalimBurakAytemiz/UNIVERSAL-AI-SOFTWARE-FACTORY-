// //TR: Bu modül reviewer verdict'ini yalnız (reviewedSha == beklenen head) + (reviewer session != implementer session) + (reviewer kimliği != builder kimliği) + (sonuç CLEAN) ise kabul eder; mevcut kimlik+sıra bağımsızlığını kimlik+session-id+SHA'ya sertleştirir, diğer her durum fail-closed reddedilir.
// Wiring note: reviewedSha == `reviewedCommit` in review-pipeline.mjs buildFrozenBundle (diff base is `baseCommit`); expectedHeadSha is the supervisor's gitHead of the exact commit under review.
export const VERDICT_RESULTS=Object.freeze(["CLEAN","BLOCKED","INCONCLUSIVE","INVALID"]);
export function bindVerdict(v){for(const k of ["taskId","reviewedSha","reviewerSessionId","implementerSessionId","reviewerIdentity","builderIdentity"])if(!v?.[k])throw new Error(`VERDICT_ARG_MISSING:${k}`);if(!VERDICT_RESULTS.includes(v.result))throw new Error(`VERDICT_RESULT_INVALID:${v.result}`);
  return Object.freeze({taskId:v.taskId,reviewedSha:v.reviewedSha,reviewerSessionId:v.reviewerSessionId,implementerSessionId:v.implementerSessionId,result:v.result,reviewerIdentity:v.reviewerIdentity,builderIdentity:v.builderIdentity})}
export function verifyVerdict(verdict,{expectedHeadSha,implementerSessionId}={}){
  if(!verdict||!expectedHeadSha||verdict.reviewedSha!==expectedHeadSha)return {ok:false,reason:"STALE_SHA"};
  if(!verdict.reviewerSessionId||verdict.reviewerSessionId===verdict.implementerSessionId||(implementerSessionId!==undefined&&verdict.reviewerSessionId===implementerSessionId))return {ok:false,reason:"NOT_INDEPENDENT"};
  if(!verdict.reviewerIdentity||verdict.reviewerIdentity===verdict.builderIdentity)return {ok:false,reason:"SAME_IDENTITY"};
  if(verdict.result!=="CLEAN")return {ok:false,reason:`NOT_CLEAN:${verdict.result}`};
  return {ok:true,reason:"OK"}}
