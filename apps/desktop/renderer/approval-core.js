// //TR: Bu modül UI-113 "Onay gerekli" panelinin saf (DOM'suz) çekirdeğidir: #/inbox görünümünün ZATEN okuduğu cockpit approvals, GET /v1/missions ve GET /v1/work-runs sonuçlarından, onay bekleyen her mission için yalnız var olan olguları türetir (risk, bekleyen geçişin geri alınamaz/yüksek riskli olması work-core.js kurallarından, bağlı koşu ve durumu, bekleme süresi, onay/ret sonucu geçiş tanımlarından); veride olmayan etki/patlama yarıçapı HİÇBİR ZAMAN tahmin edilmez, UNKNOWN kalır. Yeni eylem, istek veya depolama yoktur.
import {allowedNext,requiresConfirm,isMissionStatus,MISSION_TRANSITIONS} from "./work-core.js";
import {MISSING} from "./model.js";

export const REQUIRED_CAP=50;
// //TR: Onay hedefleri yüksek riskli geçişlerdir (HIGH_RISK_TARGETS: AUTHORIZED, COMPLETE); ret hedefleri deriveInbox ile aynıdır (REMEDIATING, BLOCKED).
const REJECT_TARGETS=Object.freeze(["REMEDIATING","BLOCKED"]);
export const UNKNOWN="UNKNOWN";

/** Mevcut geçiş kurallarından onay/ret sonuçlarını türetir; mission durumu bilinmiyorsa UNKNOWN (uydurma yok). */
export function transitionOutcome(status){
  if(!isMissionStatus(status))return {known:false,from:null,approve:[],reject:[]};
  const next=allowedNext(status);
  const approve=next.filter(to=>requiresConfirm(to)).map(to=>({to,highRisk:true,irreversible:MISSION_TRANSITIONS[to].length===0}));
  const reject=next.filter(to=>REJECT_TARGETS.includes(to)).map(to=>({to,highRisk:requiresConfirm(to),irreversible:MISSION_TRANSITIONS[to].length===0}));
  return {known:true,from:status,approve,reject};
}
/** Bekleme süresi: geçerli ISO tarihten now'a gün/saat/dakika; geçersiz/gelecek tarih => null. */
export function ageOf(iso,now){
  const t=typeof iso==="string"?Date.parse(iso):NaN;
  if(!Number.isFinite(t)||!Number.isFinite(now)||t>now)return null;
  const min=Math.floor((now-t)/60000);
  return {days:Math.floor(min/1440),hours:Math.floor(min%1440/60),minutes:min%60};
}
/** Kuyruğun ayrık durumu: cockpit okunamıyorsa onun durumu, approvals bloğu canlı değilse onun durumu, aksi halde EMPTY/READY. */
export function requiredState(c,a){
  if(!c||c.state!=="OK")return c?.state??"ERROR";
  if(!a||(a.state!=="VERIFIED"&&a.state!=="STALE"))return a?.state??"ERROR";
  return Array.isArray(a.items)&&a.items.length?"READY":"EMPTY";
}
/** Onay gerekli satırlarını türetir: {state,total,shown,rows}; satırlar en fazla cap kadardır. */
export function deriveApprovalRequired({cockpit,missions,runs,now=Date.now(),cap=REQUIRED_CAP}){
  const a=cockpit?.data?.approvals,state=requiredState(cockpit,a);
  if(state!=="READY")return {state,total:0,shown:0,rows:[]};
  const mById=new Map(missions?.state==="VERIFIED"?missions.items.map(m=>[m.missionId,m]):[]);
  const runsOk=runs?.state==="VERIFIED",rByM=new Map();
  if(runsOk)for(const r of runs.items){if(!r.missionId)continue;const cur=rByM.get(r.missionId);if(!cur||(cur.status!=="AWAITING_APPROVAL"&&r.status==="AWAITING_APPROVAL"))rByM.set(r.missionId,r)}
  const all=a.items.map(x=>{
    const m=mById.get(x.missionId)??null,r=rByM.get(x.missionId)??null,status=m?m.status:null;
    const since=r?.startedAt??m?.createdAt??null;
    return {missionId:x.missionId,title:x.title??m?.title??x.missionId,riskLevel:x.riskLevel??m?.riskLevel??MISSING,
      status,outcome:transitionOutcome(status),
      run:r?{runId:r.runId,status:r.status}:null,runKnown:runsOk,
      since,sinceBasis:r?.startedAt?"RUN_STARTED":m?.createdAt?"MISSION_CREATED":null,age:ageOf(since,now),
      impact:UNKNOWN};
  });
  const rows=all.slice(0,Math.max(0,cap));
  return {state,total:all.length,shown:rows.length,rows};
}
