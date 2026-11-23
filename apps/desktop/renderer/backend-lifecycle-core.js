// //TR: UASCO-T0004.A arka uç yaşam döngüsü (A_UI) saf çekirdeği: renderer'ın Control API hakkında bildiği TEK gerçek kaynak mevcut köprü üzerinden yapılan GET /health sonucudur
// (main.mjs/preload.mjs süreç durumu için ayrı bir kanal açmaz). Bu modül ardışık sağlık okumalarından dürüst bir yaşam döngüsü durumu türetir:
//   CHECKING        → henüz doğrulanmış bir okuma yok (asla "çalışıyor" sayılmaz),
//   CONNECTED       → son okuma kimliği doğrulanmış HEALTHY (yalnız bu durumda "çalışıyor" iddiası yapılabilir),
//   CONNECTION_LOST → bu oturumda en az bir kez doğrulanmış bağlantı vardı, şimdi yanıt yok (arka uç çökmüş/kapanmış olabilir),
//   UNAVAILABLE     → bu oturumda hiç doğrulanmış bağlantı olmadı ve yanıt yok,
//   UNVERIFIED      → bir şey yanıt veriyor ama sağlık/kimlik doğrulanamıyor (HTTP hatası, kimlik uyuşmazlığı, bilinmeyen durum; fail-closed).
// Bu sürümde ana süreç arka ucu otomatik YENİDEN BAŞLATMAZ (main.mjs: çıkışta yalnız kaydeder); bu yüzden "yeniden başlatılıyor" diye bir durum UYDURULMAZ — yalnız
// renderer'ın kendi yeniden bağlanma denemesi (recovery-core createReconnector) RECONNECTING evresi olarak gösterilir. Girdi yalnız beyaz listeli sağlık durumu dizgesidir;
// hata mesajı, yol, token girdi olarak alınmaz.
export const BACKEND_STATES=Object.freeze(["CHECKING","CONNECTED","CONNECTION_LOST","UNAVAILABLE","UNVERIFIED"]);
export const DOWN_STATES=Object.freeze(["CONNECTION_LOST","UNAVAILABLE","UNVERIFIED"]);
/** Bu kadar ardışık başarısız denetimden sonra kullanıcıya uygulamayı kapatıp yeniden açma yolu öne çıkarılır (2+4+8 sn geri çekilmeden sonra). */
export const ESCALATE_AFTER_FAILED_CHECKS=4;

const toIso=ms=>Number.isFinite(ms)?new Date(ms).toISOString():null;

/** Tek bir sağlık durumunu sınıflar: VERIFIED → "up", LOADING → "pending", OFFLINE → "down", diğer her şey (bilinmeyen dahil) → "unverified". */
export function classifyHealth(state){
  if(state==="VERIFIED")return "up";
  if(state==="LOADING")return "pending";
  if(state==="OFFLINE")return "down";
  return "unverified";
}

/**
 * Yaşam döngüsü izleyicisi (DOM'suz; saat enjekte edilir).
 * observe(healthState) her yenilemede çağrılır ve dondurulmuş anlık görüntü döndürür:
 * {status, everConnected, lastConnectedAt, downSince, failedChecks, lostCount, recoveredAt, runningClaimAllowed}
 */
export function createBackendLifecycle({now=()=>Date.now()}={}){
  let status="CHECKING",everConnected=false,lastConnectedAt=null,downSince=null,failedChecks=0,lostCount=0,recoveredAt=null;
  const snapshot=()=>Object.freeze({status,everConnected,lastConnectedAt:toIso(lastConnectedAt),downSince:toIso(downSince),failedChecks,lostCount,recoveredAt:toIso(recoveredAt),runningClaimAllowed:status==="CONNECTED"});
  return {
    observe(healthState){
      const k=classifyHealth(healthState),t=now();
      if(k==="pending")return snapshot(); // okuma sürüyor: önceki dürüst durum korunur, CONNECTED'a yükseltilmez
      if(k==="up"){
        if(DOWN_STATES.includes(status)&&everConnected)recoveredAt=t;
        status="CONNECTED";everConnected=true;lastConnectedAt=t;downSince=null;failedChecks=0;
        return snapshot();
      }
      if(status==="CONNECTED")lostCount+=1;
      if(downSince===null)downSince=t;
      failedChecks+=1;
      status=k==="down"?(everConnected?"CONNECTION_LOST":"UNAVAILABLE"):"UNVERIFIED";
      return snapshot();
    },
    snapshot
  };
}

/** Bilinmeyen/bozuk anlık görüntüyü fail-closed CHECKING'e indirger (asla CONNECTED uydurulmaz). */
export function safeBackendStatus(snap){return snap&&BACKEND_STATES.includes(snap.status)?snap.status:"CHECKING"}

/**
 * Görünüm modeli: yaşam döngüsü + (isteğe bağlı) yeniden bağlanma anlık görüntüsü.
 * {status, down, phase:"IDLE"|"RECONNECTING"|"WAITING", escalate, showBanner, runningClaimAllowed, lastConnectedAt, downSince}
 */
export function backendStatusModel(snap,reconnect){
  const status=safeBackendStatus(snap),down=DOWN_STATES.includes(status);
  const phase=!down?"IDLE":reconnect&&reconnect.running===true?"RECONNECTING":"WAITING";
  const failed=Number.isSafeInteger(snap?.failedChecks)?snap.failedChecks:0;
  return Object.freeze({status,down,phase,escalate:down&&failed>=ESCALATE_AFTER_FAILED_CHECKS,showBanner:down,runningClaimAllowed:status==="CONNECTED",
    lastConnectedAt:typeof snap?.lastConnectedAt==="string"?snap.lastConnectedAt:null,
    downSince:down&&typeof snap?.downSince==="string"?snap.downSince:null});
}
