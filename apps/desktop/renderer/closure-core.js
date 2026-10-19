// //TR: UI-132 proje kapanış ve devir kontrol listesinin saf (DOM'suz) çekirdeği: yalnız mevcut proje/görev/koşu ve kaynak-teslim (GET /v1/deliveries) okumalarından madde durumu türetir. Durumlar MET (veriyle karşılandı), OPEN (veriye göre açık) ve UNKNOWN (veri canlı değil; asla MET sayılmaz). Teslim kaynak düzeyinde kalır: ürün doğrulaması yalnız sunucu PRODUCT_VERIFIED bildirirse MET olur, aksi halde NOT_VERIFIED açık görünür; imza/onay eylemi yoktur.
import {missionPillKind} from "./model.js";
export const CLOSURE_STATES=Object.freeze(["MET","OPEN","UNKNOWN"]);
export const CLOSURE_ITEM_IDS=Object.freeze(["hasMissions","missionsDone","noActiveRuns","noFailed","sourceDelivery","productVerified"]);
// //TR: Yalnız VERIFIED okuma "canlı" sayılır; STALE/OFFLINE/UNAVAILABLE/ERROR maddeyi UNKNOWN yapar. Koşu listesi üst sınıra (500) ulaştıysa kesilmiş olabilir, bu yüzden "etkin koşu yok" UNKNOWN olur.
export const RUNS_CAP=500;
const live=r=>Boolean(r)&&r.state==="VERIFIED"&&Array.isArray(r.items);
const item=(id,state,count=null)=>({id,state,count});
/** projectId için kapanış maddeleri; her girdi {state, items} (okuma durumu) biçimindedir. Sayı yalnız gerçek veriden gelir, yoksa null. */
export function buildClosure({projectId,missions,runs,deliveries}){
  const out=[];
  if(!live(missions)){
    for(const id of ["hasMissions","missionsDone","noFailed"])out.push(item(id,"UNKNOWN"));
  }else{
    const own=missions.items.filter(m=>m.projectId===projectId);
    const notDone=own.filter(m=>missionPillKind(m.status)!=="DONE").length;
    const bad=own.filter(m=>{const k=missionPillKind(m.status);return k==="FAILED"||k==="BLOCKED"}).length;
    out.push(item("hasMissions",own.length?"MET":"OPEN",own.length));
    out.push(item("missionsDone",own.length&&!notDone?"MET":"OPEN",own.length?notDone:null));
    out.push(item("noFailed",bad?"OPEN":own.length?"MET":"UNKNOWN",bad));
  }
  if(!live(missions)||!live(runs)||runs.items.length>=RUNS_CAP)out.splice(2,0,item("noActiveRuns","UNKNOWN"));
  else{
    const ids=new Set(missions.items.filter(m=>m.projectId===projectId).map(m=>m.missionId));
    const active=runs.items.filter(r=>ids.has(r.missionId)&&missionPillKind(r.status)==="ACTIVE").length;
    out.splice(2,0,item("noActiveRuns",active?"OPEN":"MET",active));
  }
  if(!live(deliveries)){out.push(item("sourceDelivery","UNKNOWN"),item("productVerified","UNKNOWN"))}
  else{
    const own=deliveries.items.filter(d=>d.projectId===projectId);
    out.push(item("sourceDelivery",own.some(d=>d.sourceGeneration?.state==="SOURCE_GENERATION_COMPLETE")?"MET":"OPEN",own.length));
    out.push(item("productVerified",own.some(d=>d.productVerification?.state==="PRODUCT_VERIFIED")?"MET":"OPEN",own.length));
  }
  return out;
}
