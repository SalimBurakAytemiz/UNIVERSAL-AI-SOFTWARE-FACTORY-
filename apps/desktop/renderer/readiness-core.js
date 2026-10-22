// //TR: Bu modül Kalite Kapısı ve Release Readiness görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-227): yalnız dört salt-okunur ve zaten izinli GET (GET /v1/work-runs, GET /v1/reviews, GET /v1/cockpit içindeki kanıt bütünlüğü bloğu, GET /v1/missions yalnız başlık için) yanıtını güvenli, sınırlı alanlara eşler ve koşu başına release-hazırlık değerlendirmesi türetir. HİÇBİR veri uydurulur ya da yükseltilmez: kimlik/enum/biçim/sayı/zaman damgası bozuksa okuma KISMEN değil tümden ERROR olur (fail-closed), eksik alan tahmin edilmez, bağımsız inceleme kararı (CLEAN/BLOCKED/NO_VERDICT/NOT_REVIEWED/INDEPENDENCE_UNVERIFIED) sunucudan AYNEN taşınır. Genel hazırlık (READY) yalnız YEDİ kapının HEPSİ gerçekten sağlandığında verilir: koşu başarıyla bitti, bağımsız inceleme güncel head için temiz, güvenlik taraması güncel head için PASSED, testler doğrulanmış sandbox'ta gerçekten yürütüldü, teslim paketi güncel head için hazır, sunucu güncel head için tamamlanma kaydı tutuyor ve kanıt bütünlüğü tam. Bir kapının kaynağı okunamıyorsa kapı UNKNOWN'dır ve READY olamaz; hiçbir kapı varsayılan olarak geçmiş sayılmaz. Teslim yalnız kaynak düzeyindedir (kod çalıştırılmadı, NOT_VERIFIED); bu modül ürün doğrulamasını yeniden hesaplamaz ve ilgili sabit değer bu dosyada hiç yer almaz.
import {MISSION_ID_RE,PROJECT_ID_RE} from "./work-core.js";
import {RUN_STOPPED_STATUSES,RUN_STATUSES,RUN_STEPS,COCKPIT_PATH,MISSIONS_PATH,WORK_RUNS_PATH,PILL_FOR_RUN_STATUS,shortSha} from "./executive-core.js";

export {COCKPIT_PATH,MISSIONS_PATH,WORK_RUNS_PATH,PILL_FOR_RUN_STATUS,shortSha};
export const REVIEWS_PATH="/v1/reviews";
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); dördü de salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. evidence kaynağı GET /v1/cockpit'in evidence bloğudur (tam sayımlı kanıt bütünlüğü). */
export const READINESS_SOURCES=Object.freeze(["workRuns","reviews","evidence","missions"]);
export const READINESS_SOURCE_PATHS=Object.freeze({workRuns:WORK_RUNS_PATH,reviews:REVIEWS_PATH,evidence:COCKPIT_PATH,missions:MISSIONS_PATH});
/** Değerlendirmenin TAM sayılması için okunması şart olan kaynaklar; missions yalnız başlık sağlar. */
export const REQUIRED_SOURCES=Object.freeze(["workRuns","reviews","evidence"]);
/** GET /v1/reviews koşu başına review durumları (sunucu sözleşmesi); bunun dışındaki her değer okumayı ERROR yapar. */
export const REVIEW_STATES=Object.freeze(["CLEAN","BLOCKED","NO_VERDICT","NOT_REVIEWED","INDEPENDENCE_UNVERIFIED"]);
export const REVIEW_VERDICTS=Object.freeze(["CLEAN","BLOCKED","NO_VERDICT"]);
/** Kapılar (sıra sabit). İlk dördü koşuya özgüdür (olumsuz sonuç koşuyu engellenmiş yapar), son ikisi teslim/tamamlanma, sonuncusu platform kanıt bütünlüğüdür. */
export const GATES=Object.freeze(["run","review","security","tests","delivery","completion","integrity"]);
export const RUN_SCOPED_GATES=Object.freeze(["run","review","security","tests"]);
export const GATE_STATUSES=Object.freeze(["PASS","FAIL","PENDING","UNKNOWN"]);
/** Genel hazırlık düzeyleri: READY yalnız yedi kapının hepsi PASS iken; SOURCE_ONLY = inceleme + güvenlik + teslim paketi tamam ama ürün doğrulanmadı; BLOCKED = koşuya özgü bir kapı olumsuz. */
export const TIERS=Object.freeze(["READY","SOURCE_ONLY","NOT_READY","BLOCKED"]);
/** Kapı başına gösterilebilen ayrıntı kodları (UNKNOWN kapıda ayrıntı okunamayan kaynağın durumudur: OFFLINE/UNAVAILABLE/ERROR). */
export const GATE_DETAILS=Object.freeze({
  review:Object.freeze([...REVIEW_STATES,"STALE","NOT_LISTED","UNCONFIRMED"]),
  security:Object.freeze(["PASSED","PARTIAL","BLOCKED","STALE","NOT_EXECUTED"]),
  tests:Object.freeze(["EXECUTED","FAILED","BLOCKED","NOT_EXECUTED","UNVERIFIED"]),
  delivery:Object.freeze(["NOT_PREPARED","ARTIFACT_PREPARED","SOURCE_ACCEPTED","STALE"]),
  completion:Object.freeze(["RECORDED","STALE","NOT_RECORDED"]),
  integrity:Object.freeze(["ALL_VERIFIED","MISMATCH","INCOMPLETE","STALE"])});
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);
export const MAX_READINESS_ROWS=200;
/** GET /v1/cockpit blok durumları (sunucu sözleşmesi). */
export const BLOCK_STATES=Object.freeze(["VERIFIED","STALE","UNAVAILABLE","ERROR"]);

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const int=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const ts=x=>{const t=Date.parse(x);return Number.isNaN(t)?0:t};
const matches=(re,x)=>typeof x==="string"&&re.test(x);
const RUN_RE=/^run_[0-9a-f]{24}$/,SHA_RE=/^[0-9a-f]{40}$/,HASH_RE=/^[0-9a-f]{64}$/,KIND_RE=/^[A-Za-z][A-Za-z0-9_.-]{0,59}$/,REVIEW_ID_RE=/^evd_[0-9a-f]{24}$/,PROVIDER_RE=/^[A-Za-z0-9._:@/-]{1,200}$/;
const SECURITY_STAGE_STATES=Object.freeze(["PASSED","PARTIAL","BLOCKED"]);
const TEST_ACCEPTANCE=Object.freeze(["BLOCKED","NOT_EXECUTED","UNVERIFIED_VACUOUS","UNVERIFIED_ORACLE","UNKNOWN"]);
/** İsteğe bağlı alan: yok/null -> null, geçerli -> değer, geçersiz -> undefined (çağıran okumayı reddeder). */
const optional=(v,ok)=>v===undefined||v===null?null:ok(v)?v:undefined;

// ---------- GET /v1/work-runs ----------
/** Tek kanıt kaydı -> yalnız kapı kararı için gereken sınırlı alanlar; biçim bozuksa null. Kanıt kaydı kendi başına "geçti" üretmez, yalnız durum taşır. */
function mapEvidence(e){
  if(!isObj(e)||!matches(KIND_RE,e.kind)||int(e.cycle)===null)return null;
  const commitSha=optional(e.commitSha,v=>matches(SHA_RE,v));
  const exitCode=optional(e.exitCode,v=>Number.isSafeInteger(v));
  const verdict=optional(e.verdict,v=>v==="CLEAN"||v==="BLOCKED");
  const provider=optional(e.sandboxProviderId,v=>matches(PROVIDER_RE,v));
  if([commitSha,exitCode,verdict,provider].includes(undefined))return null;
  let security=null;
  if(e.security!==undefined&&e.security!==null){if(!isObj(e.security)||!SECURITY_STAGE_STATES.includes(e.security.status))return null;security=e.security.status}
  let surface=null;
  if(e.testSurface!==undefined&&e.testSurface!==null){
    const t=e.testSurface,n=isObj(t)?t.executedTests:undefined;
    if(!isObj(t)||!TEST_ACCEPTANCE.includes(t.functionalAcceptance)||!(n===null||int(n)!==null))return null;
    surface={acceptance:t.functionalAcceptance,executed:int(n)};
  }
  return {kind:e.kind,cycle:e.cycle,commitSha,exitCode,verdict,attested:provider!==null,security,surface};
}
const lastOf=(list,pred)=>{for(let i=list.length-1;i>=0;i--)if(pred(list[i]))return list[i];return null};
/** Güvenlik taraması: yalnız GÜNCEL head'e bağlı en son SECURITY_REPORT sayılır; başka commit'e bağlıysa STALE, hiç yoksa NOT_EXECUTED. Hiçbir durum yükseltilmez. */
function securityOf(head,ev){
  const all=ev.filter(e=>e.kind==="SECURITY_REPORT"&&e.security!==null);
  if(!all.length)return "NOT_EXECUTED";
  const at=head===null?null:lastOf(all,e=>e.commitSha===head);
  return at?at.security:"STALE";
}
/**
 * QA testleri: yalnız GÜNCEL head'e bağlı kanıt sayılır. EXECUTED = VERIFY_TESTS ve REGRESSION_TESTS ikisi de var, exit 0, doğrulanmış sandbox tanıklı, yürütülen test sayısı > 0 ve test yüzeyi engelli değil.
 * Sandbox yokluğundan yazılmış NOT_EXECUTED kaydı, eksik test ya da tanıksızlık asla EXECUTED sayılmaz.
 */
function testsOf(head,ev){
  if(head===null)return "NOT_EXECUTED";
  const at=ev.filter(e=>e.commitSha===head);
  const surface=lastOf(at,e=>e.kind==="TEST_SURFACE"&&e.surface!==null);
  if(surface&&surface.surface.acceptance==="BLOCKED")return "BLOCKED";
  if(lastOf(at,e=>e.kind==="VERIFY_TESTS_NOT_EXECUTED"||e.kind==="REGRESSION_TESTS_NOT_EXECUTED"))return "NOT_EXECUTED";
  const v=lastOf(at,e=>e.kind==="VERIFY_TESTS"),g=lastOf(at,e=>e.kind==="REGRESSION_TESTS");
  if((v&&v.exitCode!==0)||(g&&g.exitCode!==0))return "FAILED";
  if(!v||!g)return "NOT_EXECUTED";
  if(!v.attested||!g.attested)return "UNVERIFIED";
  const n=surface?surface.surface.executed:null;
  if(n===null||n<=0)return "UNVERIFIED";
  return "EXECUTED";
}
/** Teslim durumu (yalnız kaynak düzeyi): artefakt/kabul kaydı biçimi bozuksa null. */
function deliveryOf(r){
  let art=null,acc=null;
  if(r.deliveryArtifact!==undefined&&r.deliveryArtifact!==null){
    const a=r.deliveryArtifact;
    if(!isObj(a)||a.runId!==r.runId||a.missionId!==r.missionId||!matches(SHA_RE,a.sourceCommit)||!matches(SHA_RE,a.treeSha)||!matches(HASH_RE,a.exportArtifactHash))return null;
    art={sourceCommit:a.sourceCommit,exportArtifactHash:a.exportArtifactHash};
  }
  if(r.sourceDelivery!==undefined&&r.sourceDelivery!==null){
    const s=r.sourceDelivery;
    if(!isObj(s)||s.runId!==r.runId||s.missionId!==r.missionId||!matches(SHA_RE,s.sourceCommit)||!matches(HASH_RE,s.exportArtifactHash)||iso(s.acceptedAt)===null)return null;
    acc={sourceCommit:s.sourceCommit,exportArtifactHash:s.exportArtifactHash,acceptedAt:s.acceptedAt};
  }
  return {state:acc?"SOURCE_ACCEPTED":art?"ARTIFACT_PREPARED":"NOT_PREPARED",commits:[art,acc].filter(Boolean).map(x=>x.sourceCommit),exportArtifactHash:(acc??art)?(acc??art).exportArtifactHash:null,acceptedAt:acc?acc.acceptedAt:null};
}
function mapRunRow(r){
  if(!isObj(r)||!matches(RUN_RE,r.runId)||!matches(MISSION_ID_RE,r.missionId)||!matches(PROJECT_ID_RE,r.projectId)||!RUN_STATUSES.includes(r.status)||!RUN_STEPS.includes(r.step)||iso(r.createdAt)===null||iso(r.updatedAt)===null||!Array.isArray(r.evidence)||int(r.remediationCycle)===null)return null;
  const baseSha=optional(r.baseSha,v=>matches(SHA_RE,v)),headSha=optional(r.headSha,v=>matches(SHA_RE,v));
  if(baseSha===undefined||headSha===undefined)return null;
  const ev=[];
  for(const e of r.evidence){const m=mapEvidence(e);if(m===null)return null;ev.push(m)}
  const delivery=deliveryOf(r);if(delivery===null)return null;
  if(r.reason!==undefined&&r.reason!==null&&typeof r.reason!=="string")return null;
  // Tamamlanma kaydı yalnız SUCCEEDED koşuda bulunabilir (sunucu değişmezi); içeriği burada yeniden yorumlanmaz, yalnız varlığı ve bağlı olduğu head taşınır.
  let completion={recorded:false,headSha:null};
  if(r.completion!==undefined&&r.completion!==null){
    if(!isObj(r.completion)||!matches(SHA_RE,r.completion.headSha)||!isObj(r.completion.productVerification)||r.status!=="SUCCEEDED")return null;
    completion={recorded:true,headSha:r.completion.headSha};
  }
  return {runId:r.runId,missionId:r.missionId,projectId:r.projectId,status:r.status,step:r.step,cycle:r.remediationCycle,createdAt:r.createdAt,updatedAt:r.updatedAt,baseSha,headSha,
    security:securityOf(headSha,ev),tests:testsOf(headSha,ev),delivery,completion,reason:text(r.reason)};
}
/** GET /v1/work-runs -> {state:"VERIFIED",runs:{total,items}} | {state:"ERROR",runs:null}. Tek bozuk koşu (ya da yinelenen kimlik) tüm okumayı ERROR yapar. */
export function mapReadinessWorkRuns(raw){
  const bad={state:"ERROR",runs:null};
  if(!isObj(raw)||!Array.isArray(raw.runs))return bad;
  const items=[],seen=new Set();
  for(const r of raw.runs){
    const row=mapRunRow(r);
    if(row===null||seen.has(row.runId))return bad;
    seen.add(row.runId);items.push(row);
  }
  return {state:"VERIFIED",runs:{total:items.length,items}};
}

// ---------- GET /v1/reviews ----------
const sumOf=o=>Object.values(o).reduce((a,b)=>a+b,0);
/** {anahtar:sayı} sözlüğü: her anahtar izinli ve her değer tamsayı olmalı, toplam verilen toplamla eşit olmalı; aksi halde null (bozuk). */
function countMap(v,allowed,total){
  if(!isObj(v))return null;
  for(const [k,n] of Object.entries(v))if(!allowed.includes(k)||int(n)===null)return null;
  return sumOf(v)===total?{...v}:null;
}
function mapReviewRecord(x){
  if(!isObj(x)||!matches(REVIEW_ID_RE,x.reviewId)||!matches(RUN_RE,x.runId)||!matches(MISSION_ID_RE,x.missionId)||!matches(PROJECT_ID_RE,x.projectId)||int(x.cycle)===null||!REVIEW_VERDICTS.includes(x.verdict)||iso(x.timestamp)===null)return null;
  if(!isObj(x.reviewer)||!isObj(x.implementer)||!isObj(x.evidence)||typeof x.currentHead!=="boolean")return null;
  const reviewer=optional(x.reviewer.identity,v=>typeof v==="string"),implementer=optional(x.implementer.identity,v=>typeof v==="string");
  const independent=optional(x.independent,v=>typeof v==="boolean"),commit=optional(x.reviewedCommit,v=>matches(SHA_RE,v));
  const findings=optional(x.evidence.findingsCount,v=>int(v)!==null);
  if([reviewer,implementer,independent,commit,findings].includes(undefined))return null;
  return {reviewId:x.reviewId,runId:x.runId,missionId:x.missionId,cycle:x.cycle,verdict:x.verdict,reviewer:reviewer===null?null:text(reviewer,120),independent,reviewedCommit:commit,currentHead:x.currentHead,timestamp:x.timestamp,findingsCount:findings};
}
function mapReviewRun(x){
  if(!isObj(x)||!matches(RUN_RE,x.runId)||!matches(MISSION_ID_RE,x.missionId)||!matches(PROJECT_ID_RE,x.projectId)||!RUN_STATUSES.includes(x.status)||!RUN_STEPS.includes(x.step)||!REVIEW_STATES.includes(x.reviewState)||int(x.reviewCount)===null)return null;
  const headSha=optional(x.headSha,v=>matches(SHA_RE,v)),latestReviewId=optional(x.latestReviewId,v=>matches(REVIEW_ID_RE,v));
  if(headSha===undefined||latestReviewId===undefined)return null;
  // Sunucu değişmezi: NOT_REVIEWED <=> güncel head'e ait review kaydı yok. Diğer her durumda head ve son review kimliği vardır.
  if((x.reviewState==="NOT_REVIEWED")!==(latestReviewId===null))return null;
  if(x.reviewState!=="NOT_REVIEWED"&&headSha===null)return null;
  return {runId:x.runId,missionId:x.missionId,headSha,reviewState:x.reviewState,latestReviewId,reviewCount:x.reviewCount,latest:null};
}
/**
 * GET /v1/reviews -> {state:"VERIFIED",reviews:{truncated,runs,records}} | {state:"ERROR",reviews:null}.
 * Karar kayıttan AYNEN taşınır. Tek bozuk kayıt, yinelenen kimlik, tutarsız sayaç ya da kendiyle çelişen koşu özeti (ör. CLEAN ama kayıtta bağımsız olmayan/başka commit) TÜM okumayı ERROR yapar.
 */
export function mapReadinessReviews(raw){
  const bad={state:"ERROR",reviews:null};
  if(!isObj(raw)||raw.source!=="WORK_OS_JOURNAL_RUN_EVIDENCE"||!isObj(raw.summary)||!Array.isArray(raw.reviews)||!Array.isArray(raw.runs))return bad;
  const s=raw.summary;
  if(int(s.runs)===null||int(s.reviews)===null||typeof s.truncated!=="boolean")return bad;
  if(countMap(s.runsByReviewState,REVIEW_STATES,s.runs)===null||countMap(s.reviewsByVerdict,REVIEW_VERDICTS,s.reviews)===null)return bad;
  const records=[],byId=new Map();
  for(const x of raw.reviews){const r=mapReviewRecord(x);if(r===null||byId.has(r.reviewId))return bad;byId.set(r.reviewId,r);records.push(r)}
  const runs=[],seen=new Set();
  for(const x of raw.runs){const r=mapReviewRun(x);if(r===null||seen.has(r.runId))return bad;seen.add(r.runId);runs.push(r)}
  // Sayaçlar listeyle uyuşmalı: kısaltılmadıysa tam eşit, kısaltıldıysa liste toplamı aşamaz.
  if(s.truncated?(runs.length>s.runs||records.length>s.reviews):(runs.length!==s.runs||records.length!==s.reviews))return bad;
  for(const r of runs){
    if(r.latestReviewId===null)continue;
    const rec=byId.get(r.latestReviewId)??null;
    if(rec===null){if(!s.truncated)return bad;continue}
    if(rec.runId!==r.runId)return bad;
    // CLEAN/BLOCKED yalnız bağımsızlığı kanıtlı ve incelenen commit'i güncel head olan kayıtla desteklenir; aksi çelişkidir ve okuma reddedilir.
    const consistent=r.reviewState==="NO_VERDICT"?rec.verdict==="NO_VERDICT"
      :r.reviewState==="INDEPENDENCE_UNVERIFIED"?rec.verdict!=="NO_VERDICT"&&rec.independent!==true
      :rec.verdict===r.reviewState&&rec.independent===true&&rec.reviewedCommit===r.headSha;
    if(!consistent)return bad;
    r.latest=rec;
  }
  return {state:"VERIFIED",reviews:{truncated:s.truncated,runs,records}};
}

// ---------- GET /v1/cockpit (yalnız evidence bloğu) ----------
/**
 * GET /v1/cockpit -> {state:"VERIFIED",evidence:{state,total,verified,mismatch,missing,unverifiable,asOf}} | {state:"ERROR",evidence:null}.
 * Sunucunun blok durumu (UNAVAILABLE/ERROR) dürüst veridir ve sayısız taşınır; bilinmeyen durum, canlı blokta eksik/geçersiz sayı ya da tutarsız toplam TÜM okumayı ERROR yapar.
 */
export function mapReadinessEvidence(raw){
  const bad={state:"ERROR",evidence:null};
  if(!isObj(raw)||iso(raw.generatedAt)===null||!isObj(raw.evidence)||!BLOCK_STATES.includes(raw.evidence.state))return bad;
  const e=raw.evidence,live=e.state==="VERIFIED"||e.state==="STALE";
  const n=k=>live?int(e[k]):null;
  const out={state:e.state,total:n("total"),verified:n("verified"),mismatch:n("mismatch"),missing:n("missing"),unverifiable:n("unverifiable"),asOf:raw.generatedAt};
  if(live){
    if([out.total,out.verified,out.mismatch,out.missing,out.unverifiable].includes(null))return bad;
    if(out.verified+out.mismatch+out.missing+out.unverifiable!==out.total)return bad;
  }
  return {state:"VERIFIED",evidence:out};
}

// ---------- Hazırlık değerlendirmesi ----------
const ok=res=>Boolean(res)&&res.state==="VERIFIED";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const gate=(id,status,detail)=>({id,status,detail});
const unknown=(id,res)=>gate(id,"UNKNOWN",failState(res?.state));

/** Platform kanıt bütünlüğü kapısı (görünüm de aynı kuralı kullanır). */
export function integrityGate(evidenceRes){
  if(!ok(evidenceRes)||!evidenceRes.evidence)return unknown("integrity",evidenceRes);
  const e=evidenceRes.evidence;
  // Sunucu bloğu UNAVAILABLE/ERROR ise bütünlük bilinmez (sayı yok): kapı UNKNOWN'dır, geçmiş sayılmaz.
  if(e.state==="UNAVAILABLE"||e.state==="ERROR")return gate("integrity","UNKNOWN",e.state==="ERROR"?"ERROR":"UNAVAILABLE");
  if(e.mismatch>0)return gate("integrity","FAIL","MISMATCH");
  // Hiç doğrulanmış kayıt yoksa (toplam 0) bütünlük kanıtlanmış sayılmaz.
  if(e.missing>0||e.unverifiable>0||e.total===0)return gate("integrity","PENDING","INCOMPLETE");
  if(e.state==="STALE")return gate("integrity","PENDING","STALE");
  return gate("integrity","PASS","ALL_VERIFIED");
}
function reviewGate(run,reviewsRes,byRun){
  if(!ok(reviewsRes)||!reviewsRes.reviews)return {gate:unknown("review",reviewsRes),summary:null};
  const s=byRun.get(run.runId)??null;
  if(s===null)return {gate:gate("review","PENDING","NOT_LISTED"),summary:null};
  // İki okuma aynı head'i görmüyorsa karar bayattır: asla geçerli sayılmaz.
  if(s.headSha!==run.headSha)return {gate:gate("review","PENDING","STALE"),summary:s};
  const st=s.reviewState;
  if(st==="BLOCKED")return {gate:gate("review","FAIL","BLOCKED"),summary:s};
  if(st==="CLEAN"){
    // CLEAN yalnız kayıtla doğrulanırsa geçer: kayıt CLEAN, bağımsız ve incelenen commit güncel head olmalı (liste kısaltıldıysa kayıt yoktur -> UNCONFIRMED).
    const l=s.latest,confirmed=l!==null&&l.verdict==="CLEAN"&&l.independent===true&&run.headSha!==null&&l.reviewedCommit===run.headSha;
    return {gate:confirmed?gate("review","PASS","CLEAN"):gate("review","PENDING","UNCONFIRMED"),summary:s};
  }
  return {gate:gate("review","PENDING",st),summary:s};
}
function assess(run,ctx){
  const {reviewsRes,byRun,evidenceRes,titles}=ctx;
  const rv=reviewGate(run,reviewsRes,byRun);
  const sec=run.security==="PASSED"?"PASS":run.security==="BLOCKED"?"FAIL":"PENDING";
  const tst=run.tests==="EXECUTED"?"PASS":run.tests==="FAILED"||run.tests==="BLOCKED"?"FAIL":"PENDING";
  const d=run.delivery;
  const deliveryDetail=d.state==="NOT_PREPARED"?"NOT_PREPARED":run.headSha!==null&&d.commits.length>0&&d.commits.every(c=>c===run.headSha)?d.state:"STALE";
  const comp=run.completion;
  const completionGate=!comp.recorded?gate("completion","PENDING","NOT_RECORDED"):run.headSha!==null&&comp.headSha===run.headSha?gate("completion","PASS","RECORDED"):gate("completion","PENDING","STALE");
  const gates=[
    gate("run",run.status==="SUCCEEDED"?"PASS":RUN_STOPPED_STATUSES.includes(run.status)?"FAIL":"PENDING",run.status),
    rv.gate,
    gate("security",sec,run.security),
    gate("tests",tst,run.tests),
    gate("delivery",deliveryDetail==="ARTIFACT_PREPARED"||deliveryDetail==="SOURCE_ACCEPTED"?"PASS":"PENDING",deliveryDetail),
    completionGate,
    integrityGate(evidenceRes)];
  const by=Object.fromEntries(gates.map(g=>[g.id,g]));
  const blocked=RUN_SCOPED_GATES.some(id=>by[id].status==="FAIL");
  const ready=gates.every(g=>g.status==="PASS");
  // Kanıt bütünlüğü olumsuzsa (uyuşmazlık) inceleme/güvenlik kanıtının kendisi şüphelidir: kaynak-düzeyi hazır iddiası da kurulmaz.
  const sourceOnly=by.review.status==="PASS"&&by.security.status==="PASS"&&by.delivery.status==="PASS"&&by.integrity.status!=="FAIL";
  // READY yalnız yedi kapının HEPSİ PASS iken; olumsuz bir koşu kapısı her şeyin önüne geçer. UNKNOWN/PENDING hiçbir zaman PASS sayılmaz.
  const tier=blocked?"BLOCKED":ready?"READY":sourceOnly?"SOURCE_ONLY":"NOT_READY";
  const title=titles?titles.get(run.missionId)??null:null;
  const lt=rv.summary?rv.summary.latest:null;
  return {runId:run.runId,missionId:run.missionId,projectId:run.projectId,title,missionKnown:titles!==null&&titles.has(run.missionId),status:run.status,step:run.step,cycle:run.cycle,createdAt:run.createdAt,updatedAt:run.updatedAt,headSha:run.headSha,reason:run.reason,
    gates,gateById:by,missing:gates.filter(g=>g.status!=="PASS"),tier,
    review:lt?{reviewer:lt.reviewer,independent:lt.independent,reviewedCommit:lt.reviewedCommit,timestamp:lt.timestamp,findingsCount:lt.findingsCount,cycle:lt.cycle}:null,
    delivery:{state:deliveryDetail,commit:d.commits.length?d.commits[d.commits.length-1]:null,exportArtifactHash:d.exportArtifactHash,acceptedAt:d.acceptedAt}};
}
const byUpdated=(a,b)=>ts(b.updatedAt)-ts(a.updatedAt)||ts(b.createdAt)-ts(a.createdAt)||(a.runId<b.runId?1:a.runId>b.runId?-1:0);
/**
 * Dört okuma sonucundan ({workRuns,reviews,evidence,missions}: mapReadiness* çıktıları) koşu başına hazırlık değerlendirmesini türetir.
 * Bir gerekli kaynak (workRuns/reviews/evidence) okunamıyorsa değerlendirme EKSİKTİR (complete=false): toplam/düzey sayıları null olur (eksik değerlendirme sayılı ya da "hazır" gösterilmez)
 * ve ilgili kapı UNKNOWN'dır. workRuns okunamıyorsa hiç satır yoktur.
 */
export function buildReadiness(res){
  const R=ok(res.workRuns)&&res.workRuns.runs?res.workRuns.runs:null,V=ok(res.reviews)&&res.reviews.reviews?res.reviews.reviews:null;
  const E=ok(res.evidence)&&res.evidence.evidence?res.evidence.evidence:null,M=ok(res.missions)&&res.missions.missions?res.missions.missions:null;
  const sources=Object.fromEntries(READINESS_SOURCES.map(k=>[k,{state:ok(res[k])?"VERIFIED":failState(res[k]?.state)}]));
  const unreadable=READINESS_SOURCES.filter(k=>sources[k].state!=="VERIFIED"),unreadableRequired=REQUIRED_SOURCES.filter(k=>sources[k].state!=="VERIFIED");
  const complete=R!==null&&V!==null&&E!==null;
  const ctx={reviewsRes:res.reviews,evidenceRes:res.evidence,byRun:new Map(V?V.runs.map(x=>[x.runId,x]):[]),titles:M?new Map(M.items.map(x=>[x.missionId,x.title])):null};
  const rows=R?R.items.map(r=>assess(r,ctx)).sort(byUpdated):[];
  const counts=complete?{total:rows.length,byTier:Object.fromEntries(TIERS.map(t=>[t,rows.filter(r=>r.tier===t).length]))}:null;
  const incompleteState=unreadableRequired.some(k=>sources[k].state==="OFFLINE")?"OFFLINE":unreadableRequired.some(k=>sources[k].state==="ERROR")?"ERROR":"UNAVAILABLE";
  return {complete,sources,unreadable,unreadableRequired,incompleteState:complete?null:incompleteState,rows,counts,integrity:E,titlesKnown:M!==null,reviewsTruncated:V?V.truncated:null};
}
