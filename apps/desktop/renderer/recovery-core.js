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

// //TR: UASCO-T0004.A arka uç çökme/yeniden başlatma: Control API erişilemezken otomatik yeniden bağlanma. Bekleme üstel artar (2, 4, 8, 16 sn, sonra her 30 sn) ve sınırlıdır;
// her deneme mevcut ctx.refreshAll yolunu kullanır (yeni uç nokta/IPC yok), ardından sağlık GERÇEK GET /health sonucundan okunur. Sağlık VERIFIED olunca döngü sıfırlanır ve bir kez "yeniden bağlandı" bildirilir.
export const RECONNECT_DELAYS_MS=Object.freeze([2000,4000,8000,16000,30000]);
/** n. deneme (0 tabanlı) öncesi bekleme; geçersiz/negatif deneme ilk beklemeyi, sınırı aşan son beklemeyi (30 sn) alır. */
export function reconnectDelayMs(attempt){
  const i=Number.isSafeInteger(attempt)&&attempt>0?attempt:0;
  return RECONNECT_DELAYS_MS[Math.min(i,RECONNECT_DELAYS_MS.length-1)];
}
/**
 * Yeniden bağlanma denetleyicisi (DOM'suz; zamanlayıcı ve saat enjekte edilir).
 * deps: {schedule(fn,ms)->handle, cancel(handle), now()->ms, attemptOnce()->Promise, isHealthy()->Promise<boolean>, onRecovered()}
 * - noteDown(): sağlık düşükken çağrılır (panel her çizildiğinde); bekleyen deneme yoksa bir sonraki denemeyi planlar (tekrar çağrılması zararsızdır).
 * - retryNow(): bekleyeni iptal edip hemen dener.
 * - snapshot(): {active, attempt, nextAt, running}.
 */
export function createReconnector(deps){
  let active=false,attempt=0,handle=null,nextAt=null,running=false;
  const plan=()=>{if(handle!==null||running)return;const ms=reconnectDelayMs(attempt);nextAt=deps.now()+ms;handle=deps.schedule(fire,ms)};
  async function fire(){
    handle=null;nextAt=null;running=true;attempt+=1;
    let healthy=false;
    try{await deps.attemptOnce()}catch{/* deneme hatası sağlık okumasıyla değerlendirilir */}
    try{healthy=(await deps.isHealthy())===true}catch{healthy=false}
    running=false;
    if(healthy){active=false;attempt=0;try{deps.onRecovered()}catch{/* bildirim hatası döngüyü etkilemez */}}
    else if(active)plan();
  }
  return {
    noteDown(){active=true;plan()},
    retryNow(){active=true;if(handle!==null){deps.cancel(handle);handle=null;nextAt=null}return running?Promise.resolve():fire()},
    stop(){if(handle!==null)deps.cancel(handle);handle=null;nextAt=null;active=false;attempt=0},
    snapshot(){return Object.freeze({active,attempt,nextAt,running})}
  };
}
