// //TR: Bu modül Gelen Kutusu'ndaki tek "Onay kuyruğu"nun saf (DOM'suz) çekirdeğidir (Final Approval Center): ZATEN okunan GET /v1/missions, GET /v1/work-runs, GET /v1/attention ve seçili mission'lar için GET /v1/predev/:id sonuçlarından, Founder kararı bekleyen her öğeyi TÜRÜNE göre gruplar. Her öğe yalnız gerçek olguları taşır (konu, risk düzeyi, onaylamanın ne yaptığı, derin bağlantı) ve yalnız mevcut, izinli bir rota varsa eylem taşır; rotası olmayan ya da girdi isteyen öğe salt okunurdur ve NEDENİ söylenir. Okunamayan kaynakta öğe uydurulmaz; kaç öğenin denetlenemediği açıkça bildirilir.
import {deriveInbox,allowedNext,MISSION_ID_RE,RISK_LEVELS} from "./work-core.js";
import {PHASE_KIND} from "./journey-core.js";

export const AQ_GROUPS=Object.freeze(["AUTHORIZATION","DELIVERY","FOUNDER_ATTENTION","PREDEV_DRAFT","RUN_DECISION"]);
/** Pre-dev taslağı yalnız bu durumlardaki mission'larda aranır (analiz/pre-dev planlamadan önce yürür); okuma sayısı sınırlıdır. */
export const PREDEV_CHECK_STATUSES=Object.freeze(["DRAFT","PREFLIGHT","AUTHORIZED","PLANNED"]);
export const PREDEV_CHECK_CAP=20;
/** Grup -> eylem biçimi: TRANSITION (bu ekranda, POST /v1/missions/:id/transition), DECIDE (aşağıdaki karar kartında), READ_ONLY (neden + bağlantı). */
export const AQ_MODE=Object.freeze({AUTHORIZATION:"TRANSITION",DELIVERY:"DECIDE",FOUNDER_ATTENTION:"DECIDE",PREDEV_DRAFT:"READ_ONLY",RUN_DECISION:"READ_ONLY"});
/** Derin bağlantının gittiği ekran. */
export const AQ_LINK=Object.freeze({AUTHORIZATION:"work",DELIVERY:"work",FOUNDER_ATTENTION:"work",PREDEV_DRAFT:"journey",RUN_DECISION:"work"});
export const riskOf=r=>typeof r==="string"&&RISK_LEVELS.includes(r)?r:null;
const AUTH_TARGETS=Object.freeze([{to:"AUTHORIZED",type:"approve"},{to:"BLOCKED",type:"reject"}]);

/** Pre-dev okuması yapılacak mission kimlikleri (sıralı, sınırlı) ve sınır nedeniyle atlananların sayısı. */
export function predevCandidates(missions,cap=PREDEV_CHECK_CAP){
  const ids=(Array.isArray(missions)?missions:[]).filter(m=>m&&MISSION_ID_RE.test(String(m.missionId))&&PREDEV_CHECK_STATUSES.includes(m.status)).map(m=>m.missionId);
  return {ids:ids.slice(0,cap),skipped:Math.max(0,ids.length-cap)};
}
/** mapPredev sonucu -> karar bekleyen taslak {kind,artifactId,state} ya da null. Yalnız ŞU ANKİ fazın DRAFT/SUBMITTED artefaktı. */
export function pendingDraft(pre){
  if(!pre||pre.state!=="VERIFIED"||!pre.predev||!pre.predev.active)return null;
  const kind=PHASE_KIND[pre.predev.phase]??null,a=kind?pre.predev.artifacts.find(x=>x.kind===kind):null;
  return a&&(a.state==="DRAFT"||a.state==="SUBMITTED")&&typeof a.artifactId==="string"?{kind,artifactId:a.artifactId,state:a.state}:null;
}
/**
 * {missions,runs,attention,predev:Map<missionId,mapPredev>,predevSkipped} -> {state, groups:[{kind,items}], total, unknown:{runs,attention,predev}}
 * state: missions okuması VERIFIED değilse o durum (öğe yok); aksi halde "READY".
 */
export function buildApprovalQueue({missions,runs,attention,predev=new Map(),predevSkipped=0}){
  if(!missions||missions.state!=="VERIFIED")return {state:missions?.state??"ERROR",groups:[],total:0,unknown:null};
  const list=Array.isArray(missions.items)?missions.items:[],byId=new Map(list.map(m=>[m.missionId,m]));
  const runsOk=runs?.state==="VERIFIED",attOk=attention?.state==="VERIFIED"&&Boolean(attention.queue);
  // //TR: Risk yalnız geçerli bir düzeyse (R0–R4) taşınır; okuma katmanının "—" yer tutucusu ya da eksik değer null olur ve görünüm UNKNOWN der (uydurulmaz).
  const base=m=>({missionId:m.missionId,title:m.title??m.missionId,riskLevel:riskOf(m.riskLevel),status:m.status});
  const items=[];
  for(const m of list){
    if(m.status!=="PREFLIGHT"||!MISSION_ID_RE.test(String(m.missionId)))continue;
    const next=allowedNext(m.status);
    items.push({...base(m),kind:"AUTHORIZATION",actions:AUTH_TARGETS.filter(a=>next.includes(a.to))});
  }
  for(const it of deriveInbox(list,runsOk?runs.items:[]))
    items.push({...base(byId.get(it.missionId)??it),kind:it.kind==="DELIVERY_DECISION"?"DELIVERY":"FOUNDER_ATTENTION",runId:it.runId??null,actions:[]});
  let predevUnread=0;
  for(const [id,pre] of predev){
    if(!pre||pre.state!=="VERIFIED"){predevUnread++;continue}
    const d=pendingDraft(pre),m=byId.get(id);
    if(d&&m)items.push({...base(m),kind:"PREDEV_DRAFT",artifactId:d.artifactId,phaseKind:d.kind,artifactState:d.state,actions:[]});
  }
  if(attOk)for(const x of attention.queue.items){
    if(x.kind!=="RUN_NEEDS_DECISION")continue;
    const m=byId.get(x.missionId);
    items.push({...(m?base(m):{missionId:x.missionId,title:x.title??x.missionId,riskLevel:null,status:null}),kind:"RUN_DECISION",runId:x.runId??null,actions:[]});
  }
  const groups=AQ_GROUPS.map(kind=>({kind,items:items.filter(i=>i.kind===kind)}));
  return {state:"READY",groups,total:items.length,unknown:{runs:!runsOk,attention:!attOk,predevUnread,predevSkipped}};
}
