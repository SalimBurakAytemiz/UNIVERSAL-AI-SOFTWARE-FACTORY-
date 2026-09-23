// //TR: Bu helper Claude/Codex/tool failure sınıflarını birbirinden ayırır; yalnız açıkça retryable teknik failure sınıfları otomatik retry alır, UNKNOWN fail-closed kalır.
export function classifyFailure({status,error,stdout="",stderr="",timedOut=false,globalStopped=false}){
  const text=`${error??""}\n${stdout}\n${stderr}`.toLowerCase();
  if(globalStopped) return {class:"GLOBAL_STOP",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Founder Global Stop"};
  if(timedOut) return {class:"TIMEOUT",retryable:true,consumeReviewCycle:false,retryAfterSeconds:300,summary:"Command timeout"};
  if(/weekly.*limit|usage.*limit|quota|credit.*exhaust|insufficient.*quota/.test(text))
    return {class:"QUOTA_EXHAUSTED",retryable:true,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Provider quota exhausted"};
  if(/rate.?limit|too many requests|\b429\b/.test(text))
    return {class:"RATE_LIMIT",retryable:true,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Provider rate limited"};
  if(/login|required|not authenticated|unauthorized|forbidden|\b401\b|authentication/.test(text))
    return {class:"AUTH_REQUIRED",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Provider/tool authentication required"};
  if(/enotfound|econnreset|econnrefused|network|dns|tls|certificate.*verify|socket hang up/.test(text))
    return {class:"NETWORK_FAILURE",retryable:true,consumeReviewCycle:false,retryAfterSeconds:300,summary:"Network/TLS connectivity failure"};
  if(/not recognized|command not found|enoent|no such file or directory/.test(text))
    return {class:"TOOL_MISSING",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Required tool missing"};
  if(status!==0||error) return {class:"UNKNOWN",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Unclassified tool/provider failure"};
  return {class:"UNKNOWN",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Unclassified infrastructure state"};
}
