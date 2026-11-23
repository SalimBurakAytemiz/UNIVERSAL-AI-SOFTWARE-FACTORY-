// //TR: Bu modül Plan Karşılaştırma ve Plan Değişim Merkezi'nin saf (DOM'suz) çekirdeğidir (DSK-T0004, UI-018/UI-019): aynı mission'ın pre-dev Plan sürümlerini (GET /v1/missions/:id/tasks yanıtındaki planVersions) sıkı doğrular ve ardışık sürümler arasında eklenen, kaldırılan ve değişen iş paketlerini hesaplar. Yalnız okur; plan geçmişi yoksa veya sunucu alanı sağlamıyorsa dürüst boş/desteklenmiyor durumu döner, hiçbir değişiklik uydurulmaz.
import {MISSION_ID_RE} from "./journey-core.js";

export const planVersionsPath=id=>typeof id==="string"&&MISSION_ID_RE.test(id)?`/v1/missions/${id}/tasks`:null;
export const PLAN_STATES=Object.freeze(["DRAFT","SUBMITTED","APPROVED","REJECTED"]);
export const CHANGE_FIELDS=Object.freeze(["title","dependsOn","estimate","satisfies"]);
export const MAX_VERSIONS=50,MAX_PACKAGES=500;
const ARTIFACT_ID_RE=/^pda_[0-9a-f]{24}$/,WP_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max)=>typeof x==="string"&&x.length<=max;
const strList=(x,max)=>Array.isArray(x)&&x.length<=100&&x.every(v=>str(v,max));
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime());

function mapPackage(w){
  if(!isObj(w)||!str(w.id,60)||!WP_ID_RE.test(w.id)||!str(w.title,300)||!strList(w.dependsOn,60)||!str(w.estimate,60)||!strList(w.satisfies,60))return null;
  return {id:w.id,title:w.title,dependsOn:[...w.dependsOn],estimate:w.estimate,satisfies:[...w.satisfies]};
}

/**
 * GET /v1/missions/:id/tasks yanıtı -> {state:"VERIFIED",versions:[...]} | {state:"UNSUPPORTED"} (sunucu planVersions vermiyor) | {state:"ERROR"}.
 * Sürümler eskiden yeniye, 1'den başlayarak kesintisiz artmalıdır; bozuk tek sürüm veya iş paketi (ya da yinelenen kimlik) TÜM okumayı ERROR yapar.
 */
export function mapPlanVersions(raw){
  const bad={state:"ERROR",versions:null};
  if(!isObj(raw))return bad;
  if(raw.planVersions===undefined)return {state:"UNSUPPORTED",versions:null};
  const list=raw.planVersions;
  if(!Array.isArray(list)||list.length>MAX_VERSIONS)return bad;
  const versions=[];
  for(const [i,v] of list.entries()){
    if(!isObj(v)||typeof v.artifactId!=="string"||!ARTIFACT_ID_RE.test(v.artifactId)||v.version!==i+1||!PLAN_STATES.includes(v.state)||!iso(v.createdAt))return bad;
    if(!(v.supersedes===null||(typeof v.supersedes==="string"&&ARTIFACT_ID_RE.test(v.supersedes))))return bad;
    if(!Array.isArray(v.workPackages)||v.workPackages.length>MAX_PACKAGES)return bad;
    const pkgs=[],seen=new Set();
    for(const w of v.workPackages){const p=mapPackage(w);if(p===null||seen.has(p.id))return bad;seen.add(p.id);pkgs.push(p)}
    versions.push({artifactId:v.artifactId,version:v.version,state:v.state,supersedes:v.supersedes,createdAt:v.createdAt,workPackages:pkgs});
  }
  return {state:"VERIFIED",versions};
}

const same=(a,b)=>Array.isArray(a)?Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>x===b[i]):a===b;
/** İki sürüm arasındaki fark (iş paketi kimliğine göre): eklenen, kaldırılan, değişen (alan listesiyle) ve değişmeyen sayısı. Sıra değişikliği bir değişiklik sayılmaz. */
export function comparePlanVersions(older,newer){
  const a=new Map(older.workPackages.map(w=>[w.id,w])),b=new Map(newer.workPackages.map(w=>[w.id,w]));
  const added=newer.workPackages.filter(w=>!a.has(w.id)),removed=older.workPackages.filter(w=>!b.has(w.id)),changed=[];
  let unchanged=0;
  for(const w of newer.workPackages){
    const o=a.get(w.id);if(!o)continue;
    const fields=CHANGE_FIELDS.filter(f=>!same(o[f],w[f]));
    if(fields.length)changed.push({id:w.id,before:o,after:w,fields});else unchanged+=1;
  }
  return {from:older.version,to:newer.version,added,removed,changed,unchanged};
}

/** Değişim merkezi: ardışık her sürüm çifti için karşılaştırma, en yeniden eskiye. Tek sürüm veya hiç sürüm yoksa çift yoktur (dürüst boş durum). */
export function buildPlanChanges(res){
  if(!res||res.state!=="VERIFIED")return {state:res?.state==="UNSUPPORTED"?"UNSUPPORTED":"ERROR",pairs:[],versions:[]};
  const v=res.versions;
  if(v.length===0)return {state:"NO_PLAN",pairs:[],versions:v};
  if(v.length===1)return {state:"SINGLE_VERSION",pairs:[],versions:v};
  const pairs=[];for(let i=v.length-1;i>0;i--)pairs.push(comparePlanVersions(v[i-1],v[i]));
  return {state:"VERIFIED",pairs,versions:v};
}
