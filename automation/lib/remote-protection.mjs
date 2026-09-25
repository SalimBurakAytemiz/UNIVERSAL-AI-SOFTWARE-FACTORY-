// //TR: Bu helper GitHub branch protection API cevabını yalnız HTTP başarısına değil, gerekli force-push/deletion/linear-history kurallarına göre fail-closed değerlendirir.
export function evaluateRemoteProtection(doc){
  const errors=[];
  if(!doc||typeof doc!=="object") errors.push("PROTECTION_DOCUMENT_INVALID");
  if(doc?.required_linear_history?.enabled!==true) errors.push("REQUIRED_LINEAR_HISTORY_NOT_ENABLED");
  if(doc?.allow_force_pushes?.enabled!==false) errors.push("FORCE_PUSH_NOT_DISABLED");
  if(doc?.allow_deletions?.enabled!==false) errors.push("DELETIONS_NOT_DISABLED");
  return {ok:errors.length===0,errors};
}
