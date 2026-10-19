// //TR: UI-251 Kritik Hata / Recovery Center saf çekirdeği: bir görünüm render edilemediğinde veya control API (GET /health) erişilemediğinde panelin neyi göstereceğini hesaplar. Yalnız beyaz listeden rota kimliği ve sağlık durumu alır; hata mesajı, yığın izi, yol veya token ASLA girdi olarak alınmaz (güvenli tanılama). Bilinmeyen/okunamayan girdi başarısızlık kapalı (fail-closed) olarak UNKNOWN gösterilir, asla sağlıklı sayılmaz.
export const HEALTH_STATES=Object.freeze(["VERIFIED","LOADING","OFFLINE","ERROR","FAILED","UNAVAILABLE"]);
export const REASONS=Object.freeze(["VIEW_FAILED","API_DOWN"]);
const PILL=Object.freeze({OFFLINE:"OFFLINE",ERROR:"FAILED",FAILED:"FAILED",UNAVAILABLE:"UNAVAILABLE",LOADING:"LOADING",VERIFIED:"VERIFIED",UNKNOWN:"NOT_VERIFIED"});
/** Rota kimliğini yalnız bilinen kimlikler arasından döndürür; aksi halde "unknown" (rastgele metin tanılamaya sızmaz). */
export function safeRouteId(id,knownIds){return typeof id==="string"&&Array.isArray(knownIds)&&knownIds.includes(id)?id:"unknown"}
/** Sağlık durumunu beyaz listeye indirger; bilinmeyen değer "UNKNOWN" olur (fail-closed). */
export function safeHealth(state){return HEALTH_STATES.includes(state)?state:"UNKNOWN"}
/** Panel modeli: {reason, routeId, health, pill, apiDown}. reason geçersizse VIEW_FAILED (bir şey başarısız oldu; sessiz başarı yok). */
export function recoveryModel({reason,routeId,health,knownRouteIds}={}){
  const r=REASONS.includes(reason)?reason:"VIEW_FAILED",hs=safeHealth(health);
  return Object.freeze({reason:r,routeId:safeRouteId(routeId,knownRouteIds),health:hs,pill:PILL[hs],apiDown:hs!=="VERIFIED"&&hs!=="LOADING"});
}
/** Shell yalnız API gerçekten erişilemez/hatalıyken paneli gösterir; LOADING ve VERIFIED'da göstermez (yanlış alarm yok). */
export function shouldShowApiRecovery(healthState){const s=safeHealth(healthState);return s!=="VERIFIED"&&s!=="LOADING"}
