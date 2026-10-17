// //TR: Bu modül Güvence Komuta Merkezi ve Güvenlik Duruşu görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-037+046): yalnız üç salt-okunur ve zaten izinli GET (GET /v1/work-runs, GET /v1/reviews, GET /v1/cockpit içindeki kanıt bütünlüğü bloğu) yanıtını Kalite Kapısı ekranıyla AYNI katı, fail-closed eşleyicilerle (readiness-core.js; tek sahiplik, iki ekran farklı yorum üretemez) güvenli alanlara eşler ve dört sütunlu toplu bir duruş türetir: QA kanıtı (doğrulanmış sandbox'ta gerçekten yürütülen testler), güvenlik taraması (güncel head'e bağlı son SECURITY_REPORT), bağımsız inceleme (sunucu kararı AYNEN) ve kanıt bütünlüğü (hash-doğrulanmış / eksik). HİÇBİR veri uydurulur ya da yükseltilmez: bozuk yanıt KISMEN değil tümden ERROR olur, okunamayan kaynağın sayıları null'dır (0 değil), eksik kanıt adıyla listelenir. Genel duruş (ASSURED) yalnız DÖRT sütunun HEPSİ gerçekten sağlandığında verilir: QA NOT_EXECUTED/UNVERIFIED, güvenlik PASSED değil, inceleme temiz-ve-bağımsız değil ya da kanıt bütünlüğü doğrulanmamış/eksik/okunamıyorsa duruş ASLA ASSURED olmaz; olumsuz bir sütun (AT_RISK) bilinmeyen/eksik olanın önüne geçer. Bu modül ürün doğrulamasını hesaplamaz ve ilgili sabit değer bu dosyada hiç yer almaz.
import {REVIEWS_PATH,COCKPIT_PATH,WORK_RUNS_PATH,REVIEW_STATES,PILL_FOR_RUN_STATUS,shortSha,integrityGate,mapReadinessWorkRuns,mapReadinessReviews,mapReadinessEvidence} from "./readiness-core.js";

export {REVIEWS_PATH,COCKPIT_PATH,WORK_RUNS_PATH,REVIEW_STATES,PILL_FOR_RUN_STATUS,shortSha};
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); üçü de salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. evidence kaynağı GET /v1/cockpit'in evidence bloğudur. */
export const POSTURE_SOURCES=Object.freeze(["workRuns","reviews","evidence"]);
export const POSTURE_SOURCE_PATHS=Object.freeze({workRuns:WORK_RUNS_PATH,reviews:REVIEWS_PATH,evidence:COCKPIT_PATH});
/** Sütunlar (sıra sabit) ve her sütunun dayandığı tek kaynak. */
export const PILLARS=Object.freeze(["qa","security","review","integrity"]);
export const PILLAR_SOURCE=Object.freeze({qa:"workRuns",security:"workRuns",review:"reviews",integrity:"evidence"});
/** Sütun durumları: OK yalnız tüm kanıt olumlu; FAIL olumsuz kanıt; INCOMPLETE eksik/doğrulanmamış; NO_DATA hiç kayıt yok; UNKNOWN kaynak okunamadı. */
export const PILLAR_STATUSES=Object.freeze(["OK","FAIL","INCOMPLETE","NO_DATA","UNKNOWN"]);
/** Genel duruş: ASSURED yalnız dört sütun da OK iken; AT_RISK = bir sütun FAIL; UNKNOWN = olumsuz yok ama bir sütun okunamadı; UNVERIFIED = olumsuz yok, okunabilir ama eksik/kanıtsız. */
export const TIERS=Object.freeze(["ASSURED","AT_RISK","UNVERIFIED","UNKNOWN"]);
/** Koşu başına değerler (work-runs eşleyicisinin ürettiği sınırlı kümeler; sıra gösterim sırasıdır). */
export const QA_STATES=Object.freeze(["EXECUTED","FAILED","BLOCKED","NOT_EXECUTED","UNVERIFIED"]);
export const SECURITY_STATES=Object.freeze(["PASSED","PARTIAL","BLOCKED","STALE","NOT_EXECUTED"]);
/** İnceleme ayrıntıları: sunucunun beş durumu AYNEN + iki kaynağın uyuşmadığı/doğrulanamadığı üç türetilmiş durum. */
export const REVIEW_DETAILS=Object.freeze([...REVIEW_STATES,"STALE","NOT_LISTED","UNCONFIRMED"]);
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);
/** Eksik kanıt neden kodları (sütun başına; sıra sabit): her olumsuz/eksik durum adıyla listelenir. */
export const REASONS=Object.freeze({
  qa:Object.freeze(["FAILED","BLOCKED","NOT_EXECUTED","UNVERIFIED"]),
  security:Object.freeze(["BLOCKED","PARTIAL","STALE","NOT_EXECUTED"]),
  review:Object.freeze(["BLOCKED","INDEPENDENCE_UNVERIFIED","NO_VERDICT","NOT_REVIEWED","STALE","NOT_LISTED","UNCONFIRMED","UNSEEN"]),
  integrity:Object.freeze(["MISMATCH","MISSING","UNVERIFIABLE","STALE"])});
/** Her sütunda ortak (sayısız) nedenler: kayıt yok ve okunamayan kaynak. */
export const COMMON_REASONS=Object.freeze(["NO_RECORDS",...UNKNOWN_DETAILS]);
export const MAX_POSTURE_ROWS=200;

/** Üç okumanın bağımsız eşleyicileri: Kalite Kapısı ile AYNI katı sözleşme (bozuk/çelişkili tek kayıt TÜM okumayı ERROR yapar). */
export function mapPostureWorkRuns(raw){return mapReadinessWorkRuns(raw)}
export function mapPostureEvidence(raw){return mapReadinessEvidence(raw)}
/**
 * GET /v1/reviews -> {state:"VERIFIED",reviews:{truncated,runs,records,summary}} | {state:"ERROR",reviews:null}.
 * Önce katı eşleyiciden geçer (tek bozuk/çelişkili kayıt TÜM okumayı ERROR yapar); özet sayaçları yalnız doğrulanmış toplamlarla (toplam = koşu sayısı) AYNEN taşınır, eksik anahtar 0'dır.
 */
export function mapPostureReviews(raw){
  const base=mapReadinessReviews(raw);
  if(base.state!=="VERIFIED"||!base.reviews)return {state:"ERROR",reviews:null};
  const s=raw.summary;
  const byState=Object.fromEntries(REVIEW_STATES.map(k=>[k,s.runsByReviewState[k]??0]));
  return {state:"VERIFIED",reviews:{...base.reviews,summary:{runs:s.runs,reviews:s.reviews,byState}}};
}

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ok=res=>Boolean(res)&&res.state==="VERIFIED";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const ts=x=>{const t=Date.parse(x);return Number.isNaN(t)?0:t};
const tally=(keys,values)=>{const o=Object.fromEntries(keys.map(k=>[k,0]));for(const v of values)if(v in o)o[v]+=1;return o};
const reasonsFrom=(codes,counts)=>codes.filter(c=>counts[c]>0).map(c=>({code:c,n:counts[c]}));
/** Kaynak okunamadığında sütun: sayı yok (null), neden = okunamayan kaynağın dürüst durumu. */
const unknownPillar=(id,detail)=>({id,source:PILLAR_SOURCE[id],status:"UNKNOWN",detail,total:null,counts:null,good:null,reasons:[{code:detail,n:null}]});
const noData=()=>({code:"NO_RECORDS",n:null});

function qaPillar(W,state){
  if(W===null)return unknownPillar("qa",state);
  const n=W.items.length,counts=tally(QA_STATES,W.items.map(r=>r.tests));
  const status=n===0?"NO_DATA":counts.FAILED+counts.BLOCKED>0?"FAIL":counts.EXECUTED===n?"OK":"INCOMPLETE";
  return {id:"qa",source:"workRuns",status,detail:null,total:n,counts,good:counts.EXECUTED,reasons:n===0?[noData()]:reasonsFrom(REASONS.qa,counts)};
}
function securityPillar(W,state){
  if(W===null)return {pillar:unknownPillar("security",state),latest:null};
  const n=W.items.length,counts=tally(SECURITY_STATES,W.items.map(r=>r.security));
  const status=n===0?"NO_DATA":counts.BLOCKED>0?"FAIL":counts.PASSED===n?"OK":"INCOMPLETE";
  // En son kayıtlı tarama: en yeni etkinlikli koşuların arasında güvenlik taraması kaydı olan ilk koşu (hiç yoksa null = "none").
  const sorted=[...W.items].sort(byUpdated),hit=sorted.find(r=>r.security!=="NOT_EXECUTED")??null;
  return {pillar:{id:"security",source:"workRuns",status,detail:null,total:n,counts,good:counts.PASSED,reasons:n===0?[noData()]:reasonsFrom(REASONS.security,counts)},
    latest:hit?{runId:hit.runId,status:hit.security,updatedAt:hit.updatedAt}:null};
}
const byUpdated=(a,b)=>ts(b.updatedAt)-ts(a.updatedAt)||ts(b.createdAt)-ts(a.createdAt)||(a.runId<b.runId?1:a.runId>b.runId?-1:0);

/** Koşu başına bağımsız inceleme ayrıntısı: sunucu kararı AYNEN; iki okuma aynı head'i görmüyorsa STALE, CLEAN kayıtla doğrulanamıyorsa UNCONFIRMED, listede yoksa NOT_LISTED. Hiçbir durum yükseltilmez. */
function reviewDetailOf(s,w){
  if(s===null)return "NOT_LISTED";
  if(w!==null&&s.headSha!==w.headSha)return "STALE";
  if(s.reviewState!=="CLEAN")return s.reviewState;
  const l=s.latest;
  return l!==null&&l.verdict==="CLEAN"&&l.independent===true&&s.headSha!==null&&l.reviewedCommit===s.headSha?"CLEAN":"UNCONFIRMED";
}
function reviewPillar(V,W,state){
  if(V===null)return {pillar:unknownPillar("review",state),detailOf:null};
  const sBy=new Map(V.runs.map(s=>[s.runId,s])),wBy=W?new Map(W.items.map(r=>[r.runId,r])):null;
  const ids=[...new Set([...V.runs.map(s=>s.runId),...(W?W.items.map(r=>r.runId):[])])];
  const detailOf=id=>reviewDetailOf(sBy.get(id)??null,wBy?wBy.get(id)??null:null);
  const counts=tally(REVIEW_DETAILS,ids.map(detailOf));
  // Sunucu özeti listeden fazla koşu bildiriyorsa (kısaltılmış liste) görülmeyen koşular vardır: bunlar doğrulanamaz.
  const unseen=Math.max(0,V.summary.runs-V.runs.length);
  const n=ids.length+unseen;
  const status=n===0?"NO_DATA":counts.BLOCKED>0?"FAIL":counts.CLEAN===n?"OK":"INCOMPLETE";
  const all={...counts,UNSEEN:unseen};
  return {pillar:{id:"review",source:"reviews",status,detail:null,total:n,counts,good:counts.CLEAN,server:{...V.summary.byState},unseen,truncated:V.truncated,reasons:n===0?[noData()]:reasonsFrom(REASONS.review,all)},detailOf};
}
function integrityPillar(res){
  const g=integrityGate(res);
  if(g.status==="UNKNOWN")return unknownPillar("integrity",g.detail);
  const e=res.evidence;
  const reasons=[];
  if(e.mismatch>0)reasons.push({code:"MISMATCH",n:e.mismatch});
  if(e.missing>0)reasons.push({code:"MISSING",n:e.missing});
  if(e.unverifiable>0)reasons.push({code:"UNVERIFIABLE",n:e.unverifiable});
  if(e.state==="STALE")reasons.push({code:"STALE",n:null});
  const status=g.status==="PASS"?"OK":g.status==="FAIL"?"FAIL":e.total===0?"NO_DATA":"INCOMPLETE";
  return {id:"integrity",source:"evidence",status,detail:null,total:e.total,counts:{verified:e.verified,mismatch:e.mismatch,missing:e.missing,unverifiable:e.unverifiable},good:e.verified,asOf:e.asOf,blockState:e.state,reasons:e.total===0?[noData()]:reasons};
}

/**
 * Üç okuma sonucundan ({workRuns,reviews,evidence}: mapPosture* çıktıları) toplu duruşu türetir.
 * Sayılar yalnız ilgili sütunun kaynağı okunabiliyorsa vardır (aksi halde null, asla 0); okunamayan sütun UNKNOWN'dır ve hiçbir zaman "tamam" sayılmaz.
 * Genel duruş: herhangi bir sütun FAIL -> AT_RISK; olumsuz yok ve bir sütun UNKNOWN -> UNKNOWN; hepsi OK -> ASSURED; kalan her durum (INCOMPLETE/NO_DATA) -> UNVERIFIED.
 */
export function buildPosture(res){
  // Bir kaynak yalnız eşleyici çıktısı eksiksizse kullanılır; VERIFIED ama gövdesi eksik (ör. özetsiz inceleme) okuma ERROR sayılır, tahmin edilmez.
  const usable={workRuns:ok(res.workRuns)&&Boolean(res.workRuns.runs),reviews:ok(res.reviews)&&Boolean(res.reviews.reviews)&&isObj(res.reviews.reviews.summary),evidence:ok(res.evidence)&&Boolean(res.evidence.evidence)};
  const W=usable.workRuns?res.workRuns.runs:null,V=usable.reviews?res.reviews.reviews:null;
  const sources=Object.fromEntries(POSTURE_SOURCES.map(k=>[k,{state:usable[k]?"VERIFIED":ok(res[k])?"ERROR":failState(res[k]?.state)}]));
  const unreadable=POSTURE_SOURCES.filter(k=>sources[k].state!=="VERIFIED");
  const incompleteState=unreadable.some(k=>sources[k].state==="OFFLINE")?"OFFLINE":unreadable.some(k=>sources[k].state==="ERROR")?"ERROR":unreadable.length?"UNAVAILABLE":null;
  const sec=securityPillar(W,sources.workRuns.state),rev=reviewPillar(V,W,sources.reviews.state);
  const pillars=[qaPillar(W,sources.workRuns.state),sec.pillar,rev.pillar,integrityPillar(usable.evidence?res.evidence:{state:sources.evidence.state})];
  const byPillar=Object.fromEntries(pillars.map(p=>[p.id,p]));
  const statuses=pillars.map(p=>p.status);
  const tier=statuses.includes("FAIL")?"AT_RISK":statuses.includes("UNKNOWN")?"UNKNOWN":statuses.every(s=>s==="OK")?"ASSURED":"UNVERIFIED";
  const unknownDetails=pillars.filter(p=>p.status==="UNKNOWN").map(p=>p.detail);
  const unknownState=unknownDetails.includes("OFFLINE")?"OFFLINE":unknownDetails.includes("ERROR")?"ERROR":unknownDetails.length?"UNAVAILABLE":null;
  // Eksik kanıt: OK olmayan her sütunun adıyla listelenen nedenleri (en az bir tane vardır; ASSURED iken boştur).
  const missing=pillars.filter(p=>p.status!=="OK").flatMap(p=>p.reasons.map(r=>({pillar:p.id,status:p.status,code:r.code,n:r.n})));
  // Koşu başına satırlar (yalnız work-runs okunduysa; en yeni etkinlik önce). İnceleme okunamıyorsa satırın incelemesi bilinmeyen kaynak durumudur.
  const rows=W?[...W.items].sort(byUpdated).map(r=>({runId:r.runId,missionId:r.missionId,status:r.status,step:r.step,updatedAt:r.updatedAt,headSha:r.headSha,qa:r.tests,security:r.security,
    review:rev.detailOf?rev.detailOf(r.runId):null,reviewUnread:rev.detailOf?null:sources.reviews.state})):[];
  return {sources,unreadable,incompleteState,pillars,byPillar,tier,unknownState,missing,runs:W?W.total:null,rows,latestSecurity:sec.latest};
}
