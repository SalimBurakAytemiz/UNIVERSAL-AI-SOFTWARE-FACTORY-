// //TR: Bu modül reviewer verdict'ini yalnız (taskId == beklenen task) + (reviewedSha == beklenen head) + (verdict'in implementer'ı == supervisor'ın bildirdiği implementer, zorunlu) + (reviewer session != implementer session) + (verdict'in builder kimliği == supervisor'ın bildirdiği builder, zorunlu; reviewer kimliği != builder, normalize edilmiş) + (sonuç CLEAN) ise kabul eder; bağımsızlık dışarıdan zorunlu argümanla kanıtlanmazsa fail-closed reddedilir.
// Wiring note: expectedTaskId == orchestrator packageId; reviewedSha == `reviewedCommit` in review-pipeline.mjs buildFrozenBundle (diff base is `baseCommit`); expectedHeadSha is the supervisor's gitHead; implementerSessionId and builderIdentity are supervisor-owned (not caller/verdict self-reported).
export const VERDICT_RESULTS=Object.freeze(["CLEAN","BLOCKED","INCONCLUSIVE","INVALID"]);
// identities compare case/whitespace-insensitively so a case variant of the builder can never pass as a distinct reviewer
const ident=x=>typeof x==="string"?x.trim().toLowerCase():"";
export function bindVerdict(v){for(const k of ["taskId","reviewedSha","reviewerSessionId","implementerSessionId","reviewerIdentity","builderIdentity"])if(!v?.[k])throw new Error(`VERDICT_ARG_MISSING:${k}`);if(!VERDICT_RESULTS.includes(v.result))throw new Error(`VERDICT_RESULT_INVALID:${v.result}`);
  return Object.freeze({taskId:v.taskId,reviewedSha:v.reviewedSha,reviewerSessionId:v.reviewerSessionId,implementerSessionId:v.implementerSessionId,result:v.result,reviewerIdentity:v.reviewerIdentity,builderIdentity:v.builderIdentity})}
export function verifyVerdict(verdict,{expectedTaskId,expectedHeadSha,implementerSessionId,builderIdentity}={}){
  if(!verdict||!expectedTaskId||verdict.taskId!==expectedTaskId)return {ok:false,reason:"TASK_MISMATCH"};
  if(!expectedHeadSha||verdict.reviewedSha!==expectedHeadSha)return {ok:false,reason:"STALE_SHA"};
  if(!implementerSessionId||verdict.implementerSessionId!==implementerSessionId||!verdict.reviewerSessionId||verdict.reviewerSessionId===implementerSessionId||verdict.reviewerSessionId===verdict.implementerSessionId)return {ok:false,reason:"NOT_INDEPENDENT"};
  const builder=ident(builderIdentity),reviewer=ident(verdict.reviewerIdentity);
  if(!builder||ident(verdict.builderIdentity)!==builder||!reviewer)return {ok:false,reason:"IDENTITY_UNVERIFIED"};
  if(reviewer===builder)return {ok:false,reason:"SAME_IDENTITY"};
  if(verdict.result!=="CLEAN")return {ok:false,reason:`NOT_CLEAN:${verdict.result}`};
  return {ok:true,reason:"OK"}}
