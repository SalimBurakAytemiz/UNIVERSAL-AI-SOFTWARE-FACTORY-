// //TR: Bu modül Ayarlar > "Kullanım ve sınırlar" panelinin saf (DOM'suz) çekirdeğidir (DSK-T0008): YALNIZ mevcut salt-okunur GET'lerden (GET /v1/work-runs ve GET /v1/system/executors) ölçülen değerleri türetir — bugün (yerel gün) ilk lease'i alınmış, yani başlamış koşu sayısı (firstLeasedAt; çalıştırıcının günlük sınırı da aynı alanla sayar) ve şu an etkin (lease altındaki) koşu sayısı. Koşu kaydı yürütücüyü bildirmediği için "gerçek model koşusu" yalnız sunucunun etkin yürütücüsü LOCAL_CLAUDE iken öyle sayılır; aksi halde bilinmiyor. Token ve maliyet için kaynak yoktur: her zaman UNKNOWN (null) kalır, hiçbir sayı uydurulmaz. Founder politika sınırları (20 yeni koşu/gün, 2 eşzamanlı gerçek-model koşusu) çalıştırıcı (core/workos/runner.ts REAL_MODEL_LIMITS, DSK-T0008 #433) tarafından LOCAL_CLAUDE yürütücüsünde zorlanır; bu modül yalnız gösterir, hiçbir şeyi engellemez.
import {RUN_STATUSES} from "./executive-core.js";

/** Founder kararı (DSK-T0008 Q5): ileride yükseltilebilir politika değerleri; runner.ts REAL_MODEL_LIMITS ile aynı. Zorlama çalıştırıcıdadır (#433, bu PR'dan önce birleşir); bu modül hiçbir şeyi engellemez. */
export const USAGE_POLICY=Object.freeze({runsPerDay:20,concurrentRealRuns:2,enforcement:"RUNNER_ENFORCED"});
/** Lease altında model süreci çalışıyor olabilecek durumlar (eşzamanlılık sayımı). */
export const ACTIVE_RUN_STATUSES=Object.freeze(["LEASED","RUNNING","CHECKPOINTING","VERIFYING","RECOVERING"]);
export const USAGE_STATES=Object.freeze(["VERIFIED","ERROR"]);

const sameLocalDay=(iso,now)=>{const d=new Date(iso);return !Number.isNaN(d.getTime())&&d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate()};

/**
 * runsRes: api.queueWorkRuns() sonucu ({state,runs:{items}}); exec: api.executors() sonucu; now: Date.
 * -> {state:"ERROR"} | {state:"VERIFIED", runsToday, activeNow, realModel:true|false|null, tokens:null, cost:null, policy}.
 * realModel: true yalnız etkin yürütücü LOCAL_CLAUDE iken; başka bir değer bildirilmişse false (örn. FAKE / yapılandırılmamış); okunamazsa null.
 */
export function buildUsage(runsRes,exec,now=new Date()){
  if(!runsRes||runsRes.state!=="VERIFIED"||!runsRes.runs||!Array.isArray(runsRes.runs.items))return {state:"ERROR"};
  const items=runsRes.runs.items;
  if(!items.every(r=>r&&RUN_STATUSES.includes(r.status)&&typeof r.createdAt==="string"&&(r.firstLeasedAt===undefined||typeof r.firstLeasedAt==="string")))return {state:"ERROR"};
  const active=exec&&exec.state==="VERIFIED"&&typeof exec.active==="string"?exec.active:null;
  return {state:"VERIFIED",runsToday:items.filter(r=>typeof r.firstLeasedAt==="string"&&sameLocalDay(r.firstLeasedAt,now)).length,activeNow:items.filter(r=>ACTIVE_RUN_STATUSES.includes(r.status)).length,
    realModel:active===null?null:active==="LOCAL_CLAUDE",tokens:null,cost:null,policy:USAGE_POLICY};
}
/** Politika değerine göre bilgi amaçlı düzey (zorlama değil): AT_LIMIT / BELOW / UNKNOWN. Gerçek model koşusu olduğu bilinmiyorsa UNKNOWN. */
export function usageLevel(u,key){
  if(!u||u.state!=="VERIFIED"||u.realModel!==true)return "UNKNOWN";
  const [v,lim]=key==="day"?[u.runsToday,u.policy.runsPerDay]:[u.activeNow,u.policy.concurrentRealRuns];
  return v>=lim?"AT_LIMIT":"BELOW";
}
