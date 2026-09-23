// //TR: Bu helper Claude/Codex/tool failure'larını code defect yerine quota/auth/network/timeout/global-stop/environment sınıflarına ayırarak retry/resume ve review-cycle accounting'in doğru yapılmasını sağlar.
export function classifyFailure({status,error,stdout="",stderr="",timedOut=false,globalStopped=false}){
  const text=`${error??""}\n${stdout}\n${stderr}`.toLowerCase();
  if(globalStopped) return {class:"GLOBAL_STOP",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Founder Global Stop"};
  if(timedOut) return {class:"TIMEOUT",retryable:true,consumeReviewCycle:false,retryAfterSeconds:300,summary:"Command timeout"};
  if(/weekly.*limit|usage.*limit|rate.?limit|quota|too many requests|429/.test(text))
    return {class:"QUOTA_OR_RATE_LIMIT",retryable:true,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Provider quota or rate limit"};
  if(/login|required|not authenticated|unauthorized|forbidden|401|authentication/.test(text))
    return {class:"AUTH_REQUIRED",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Provider/tool authentication required"};
  if(/enotfound|econnreset|econnrefused|network|dns|tls|certificate.*verify|socket hang up/.test(text))
    return {class:"NETWORK_FAILURE",retryable:true,consumeReviewCycle:false,retryAfterSeconds:300,summary:"Network/TLS connectivity failure"};
  if(/not recognized|command not found|enoent|no such file or directory/.test(text))
    return {class:"TOOL_MISSING",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Required tool missing"};
  if(status!==0||error) return {class:"TOOL_FAILURE",retryable:true,consumeReviewCycle:false,retryAfterSeconds:120,summary:"Tool process failed"};
  return {class:"UNKNOWN_INFRASTRUCTURE_FAILURE",retryable:false,consumeReviewCycle:false,retryAfterSeconds:null,summary:"Unclassified infrastructure failure"};
}
