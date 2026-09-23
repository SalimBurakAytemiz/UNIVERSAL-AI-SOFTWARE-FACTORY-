// //TR: Bu helper Founder retry endpoint'inin yalnız gerçekten retryable teknik failure sınıflarını yeniden kuyruğa almasına izin verir; trust/policy/authority/review blocker'larını açmaz.
const retryable=new Set(["TIMEOUT","QUOTA_EXHAUSTED","RATE_LIMIT","NETWORK_FAILURE"]);
export function canRetryBlockedKind(kind){return retryable.has(String(kind??"").toUpperCase())}
export function retryableBlockedKinds(){return [...retryable].sort()}
