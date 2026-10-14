// //TR: Bu modül Desktop ana sürecinin mevcut Control API GET allow-list'ine ek olarak yalnız B4 shell'in okuduğu sabit rotaları (cockpit, projeler, mission'lar) tam eşleşme veya sıkı kimlik regex'i ile fail-closed izin verir; token ana süreçte eklenir, renderer görmez.
const EXACT_ROUTES=new Set(["/v1/cockpit","/v1/projects","/v1/missions"]);
const PROJECT_MISSIONS=/^\/v1\/missions\?projectId=prj_[0-9a-f]{24}$/;
const MISSION_DETAIL=/^\/v1\/missions\/msn_[0-9a-f]{24}$/;
export function desktopExtraGetPathAllowed(value){
  if(typeof value!=="string"||value.length>128)return false;
  return EXACT_ROUTES.has(value)||PROJECT_MISSIONS.test(value)||MISSION_DETAIL.test(value);
}
