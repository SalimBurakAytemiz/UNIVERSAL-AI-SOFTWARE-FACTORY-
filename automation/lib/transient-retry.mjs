// //TR: Bu helper bir dış servis çağrısını (ör. npm audit registry isteği) yalnızca çağrının kendisi "transient" olarak işaretlediği sonuçlarda sınırlı sayıda ve artan beklemeyle yeniden dener; geçerli bir sonuç (bulgu içerse bile) asla yeniden denenmez, tüm denemeler biterse son başarısız sonuç olduğu gibi döner (fail-closed, sahte PASS yok).
export const DEFAULT_MAX_ATTEMPTS=4;export const DEFAULT_BACKOFF_MS=Object.freeze([5000,10000,20000]);
const defaultSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function retryTransient(attempt,{maxAttempts=DEFAULT_MAX_ATTEMPTS,backoffMs=DEFAULT_BACKOFF_MS,sleep=defaultSleep,onRetry=()=>{}}={}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1)throw new Error(`RETRY_MAX_ATTEMPTS_INVALID:${maxAttempts}`);
 let result;for(let n=1;n<=maxAttempts;n++){result=await attempt(n);if(!result||typeof result!=="object")throw new Error("RETRY_ATTEMPT_RESULT_INVALID");if(result.ok===true||result.transient!==true||n===maxAttempts)return {...result,attempts:n};const wait=backoffMs[Math.min(n-1,backoffMs.length-1)]??0;onRetry(result,n,maxAttempts,wait);await sleep(wait)}
 return {...result,attempts:maxAttempts};
}
