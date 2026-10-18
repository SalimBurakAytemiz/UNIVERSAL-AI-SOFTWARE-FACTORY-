// //TR: Bu modül Güvence (QA + Güvenlik) görünümünün saf (DOM'suz) çekirdeğidir: GET /v1/work-runs ham kayıtlarındaki SECURITY_REPORT kanıtının (core/workos security-tools.ts aşama özeti) güvenli, DÜRÜST eşlemesi. Hiçbir durum YÜKSELTİLMEZ: yalnız sunucunun bildirdiği gitleaks/trivy/semgrep durumu (INSTALLED/NOT_INSTALLED/ERROR), secret-scan ve SCA durumu taşınır; araç yoksa NOT_INSTALLED, kapsam eksikse PARTIAL, kanıt yoksa NOT_EXECUTED gösterilir; sahte "temiz/geçti" asla üretilmez ve SOURCE_GENERATION_COMPLETE asla PRODUCT_VERIFIED sayılmaz. Veri HTML olarak yorumlanmaz; bu modül yalnız salt-okunur veri üretir.
import {MISSING} from "./model.js";

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max=200)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const safeInt=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const SHA_RE=/^[0-9a-f]{40}$/;
const RUN_ID_RE=/^[A-Za-z0-9_-]{6,64}$/;
const MSN_RE=/^msn_[0-9a-f]{24}$/;
const CODE_RE=/^[A-Z][A-Z0-9_]{0,39}$/;

// //TR: Güvenlik aşaması (B3C) sözleşmesi durumları; bunların DIŞINDAki değer asla "geçti" sayılmaz.
export const SECURITY_STAGE_STATES=Object.freeze(["PASSED","PARTIAL","BLOCKED"]);
export const SECURITY_TOOL_STATES=Object.freeze(["INSTALLED","NOT_INSTALLED","ERROR"]);
// //TR: Bir koşunun headline güvenlik durumu: aşama durumu + kanıtın run.headSha'ya bağlı olup olmadığı birlikte değerlendirilir.
export const SECURITY_SCAN_STATES=Object.freeze(["PASSED","PARTIAL","BLOCKED","STALE","NOT_EXECUTED"]);
// //TR: FD-REL-1 (yürütme kapısı) + ücretli cihaz farmı: dinamik QA Founder kapısındadır ve bu yüzeyler ASLA sahte "koş/geçti" göstermez.
export const DYNAMIC_QA_GATES=Object.freeze(["unitTests","e2eTests","visualTests","apiTests","webTests","mobileTests","desktopTests","deviceFarm","livePreview"]);

const toolStatus=s=>SECURITY_TOOL_STATES.includes(s)?s:"ERROR";
const stageStatus=s=>SECURITY_STAGE_STATES.includes(s)?s:null;
// //TR: Araç/alt-durum kodu (CLEAN/FINDINGS/NOT_INSTALLED/PARTIAL/ERROR/NOT_AVAILABLE ...) sunucunun verdiği haliyle taşınır; bilinmeyen biçim dürüst "UNKNOWN" olur, asla "CLEAN" diye uydurulmaz.
const code=s=>typeof s==="string"&&CODE_RE.test(s)?s:"UNKNOWN";

function toolView(t){
  if(!isObj(t))return null;
  const tool=str(t.tool,40);if(!tool)return null;
  return {tool,status:toolStatus(t.status),version:str(t.version,80),reason:str(t.reason,80)};
}

/** //TR: Koşunun en son SECURITY_REPORT kanıtı (en yüksek cycle, eşitlikte dizideki son); yalnız .security taşıyan kayıt. */
function latestSecurityEvidence(evidence){
  let best=null,bestCycle=-1;
  for(const e of (Array.isArray(evidence)?evidence:[])){
    if(!isObj(e)||e.kind!=="SECURITY_REPORT"||!isObj(e.security))continue;
    const cyc=Number.isSafeInteger(e.cycle)?e.cycle:0;
    if(cyc>=bestCycle){best=e;bestCycle=cyc}
  }
  return best;
}

/** //TR: Tek bir ham work-run kaydını güvenli güvenlik görünümüne eşler; kanıt yoksa dürüst NOT_EXECUTED. Geçersiz kimlik => null (satır üretilmez). */
export function mapRunSecurity(run){
  if(!isObj(run))return null;
  const idv=run.runId??run.workRunId??run.id;
  const runId=typeof idv==="string"&&RUN_ID_RE.test(idv)?idv:null;if(!runId)return null;
  const missionId=typeof run.missionId==="string"&&MSN_RE.test(run.missionId)?run.missionId:null;
  const headSha=typeof run.headSha==="string"&&SHA_RE.test(run.headSha)?run.headSha:null;
  const status=typeof run.status==="string"&&CODE_RE.test(run.status)?run.status:null;
  const ev=latestSecurityEvidence(run.evidence);
  if(!ev){
    return {runId,missionId,runStatus:status,headSha,commitSha:null,commitBound:false,scanned:false,
      scanStatus:"NOT_EXECUTED",stageStatus:null,blockReason:null,cycle:null,founderNote:null,
      secrets:{builtin:{status:"UNKNOWN",hits:null},gitleaks:{status:"UNKNOWN",findings:null,reason:null}},
      sca:{status:"UNKNOWN",blocking:null,counts:{},reason:null},
      sast:{status:"NOT_AVAILABLE",reason:"NO_SECURITY_EVIDENCE"},sbom:{status:"NOT_AVAILABLE",reason:"NO_SECURITY_EVIDENCE"},
      tools:[],gaps:[]};
  }
  const sec=ev.security,commitSha=typeof ev.commitSha==="string"&&SHA_RE.test(ev.commitSha)?ev.commitSha:null;
  const commitBound=Boolean(headSha&&commitSha&&headSha===commitSha);
  const st=stageStatus(sec.status);
  // //TR: Headline: aşama PASSED yalnız kanıt run.headSha'ya bağlıyken PASSED gösterilir; başka commit'e bağlıysa STALE (asla geçerli "geçti" gibi). BLOCKED her durumda engeldir.
  const scanStatus=st==="BLOCKED"?"BLOCKED":st==="PASSED"?(commitBound?"PASSED":"STALE"):st==="PARTIAL"?(commitBound?"PARTIAL":"STALE"):"NOT_EXECUTED";
  const secrets=isObj(sec.secrets)?sec.secrets:{};
  const builtin=isObj(secrets.builtin)?secrets.builtin:{};
  const gitleaks=isObj(secrets.gitleaks)?secrets.gitleaks:{};
  const sca=isObj(sec.sca)?sec.sca:{};
  const sast=isObj(sec.sast)?sec.sast:{};
  const sbom=isObj(sec.sbom)?sec.sbom:{};
  const counts={};if(isObj(sca.counts))for(const [k,v] of Object.entries(sca.counts)){const n=safeInt(v);if(n!==null&&/^[A-Z_]{1,20}$/.test(k))counts[k]=n}
  return {
    runId,missionId,runStatus:status,headSha,commitSha,commitBound,scanned:true,
    scanStatus,stageStatus:st,blockReason:typeof sec.blockReason==="string"&&CODE_RE.test(sec.blockReason)?sec.blockReason:null,
    cycle:Number.isSafeInteger(ev.cycle)?ev.cycle:null,founderNote:str(sec.founderNote,600),
    secrets:{builtin:{status:code(builtin.status),hits:safeInt(builtin.hits)},gitleaks:{status:code(gitleaks.status),findings:safeInt(gitleaks.findings),reason:str(gitleaks.reason,80)}},
    sca:{status:code(sca.status),blocking:safeInt(sca.blocking),counts,reason:str(sca.reason,80)},
    sast:{status:code(sast.status),reason:str(sast.reason,80)},sbom:{status:code(sbom.status),reason:str(sbom.reason,80)},
    tools:(Array.isArray(sec.tools)?sec.tools:[]).slice(0,10).map(toolView).filter(Boolean),
    gaps:(Array.isArray(sec.gaps)?sec.gaps:[]).filter(g=>typeof g==="string").slice(0,30).map(g=>g.slice(0,120))
  };
}

function emptyAggregate(){return {total:0,scanned:0,byStatus:{PASSED:0,PARTIAL:0,BLOCKED:0,STALE:0,NOT_EXECUTED:0},blocked:0,toolsSeen:null}}
/** //TR: Koşu güvenlik görünümlerinin dürüst toplamı: duruma göre sayım + engel sayısı + son taranan koşudaki araç durumu (varsa). Hiçbir sayı uydurulmaz. */
export function aggregateSecurity(runs){
  const agg=emptyAggregate();agg.total=runs.length;
  let latestScanned=null;
  for(const r of runs){
    if(agg.byStatus[r.scanStatus]!==undefined)agg.byStatus[r.scanStatus]+=1;
    if(r.scanned){agg.scanned+=1;if(!latestScanned)latestScanned=r}
  }
  agg.blocked=agg.byStatus.BLOCKED;
  // //TR: Araç kapsamı yalnız gerçek taranmış bir koşunun kanıtından; hiç tarama yoksa null (kurulu/kurulu değil durumu uydurulmaz).
  agg.toolsSeen=latestScanned?latestScanned.tools:null;
  return agg;
}

/** //TR: GET /v1/work-runs ham sonucunu (api.raw) güvenlik tarama görünümüne eşler; başarısızsa dürüst durum, asla boş "temiz" tablo. */
export function mapSecurityScans(r){
  if(!isObj(r)||r.ok!==true){
    const state=isObj(r)&&typeof r.state==="string"?r.state:"ERROR";
    return {state,runs:[],aggregate:emptyAggregate()};
  }
  const data=r.data;
  const list=isObj(data)?(Array.isArray(data.workRuns)?data.workRuns:Array.isArray(data.runs)?data.runs:Array.isArray(data.items)?data.items:null):null;
  if(!list)return {state:"ERROR",runs:[],aggregate:emptyAggregate()};
  const runs=list.slice(0,500).map(mapRunSecurity).filter(Boolean);
  return {state:"VERIFIED",runs,aggregate:aggregateSecurity(runs)};
}

/** //TR: cockpit.evidence bloğundan dürüst kanıt bütünlüğü özeti; yalnız VERIFIED/STALE blokta ve geçerli tamsayıysa sayı, aksi halde null (uydurma yok). */
export function evidenceIntegrity(evBlock){
  const b=isObj(evBlock)?evBlock:null,live=b&&(b.state==="VERIFIED"||b.state==="STALE");
  const n=k=>live?safeInt(b[k]):null;
  return {state:b?b.state:"UNAVAILABLE",live:Boolean(live),total:n("total"),verified:n("verified"),mismatch:n("mismatch"),missing:n("missing"),unverifiable:n("unverifiable")};
}

// //TR: UI-049: GET /v1/reviews/:evd_id yanıtının fail-closed eşlemesi. Karar sunucudan AYNEN taşınır (yükseltilmez); biçim bozuksa {state:"ERROR",review:null}. Serbest metin yalnız sınırlı uzunlukta alınır ve textContent ile çizilir.
export const REVIEW_ID_RE=/^evd_[0-9a-f]{24}$/;
const REVIEW_VERDICT_SET=Object.freeze(["CLEAN","BLOCKED","NO_VERDICT"]);
const RUN_RE_R=/^run_[0-9a-f]{24}$/;
const isoOrNull=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
export function mapReviewDetail(raw){
  const bad={state:"ERROR",review:null};
  if(!isObj(raw)||raw.source!=="WORK_OS_JOURNAL_RUN_EVIDENCE"||!isObj(raw.review))return bad;
  const r=raw.review,ev=r.evidence;
  if(!REVIEW_ID_RE.test(String(r.reviewId))||!RUN_RE_R.test(String(r.runId))||!MSN_RE.test(String(r.missionId))||!REVIEW_VERDICT_SET.includes(r.verdict)||!isObj(r.reviewer)||!isObj(r.implementer)||!isObj(ev)||typeof r.currentHead!=="boolean"||safeInt(r.cycle)===null)return bad;
  if(r.independent!==null&&typeof r.independent!=="boolean")return bad;
  const commit=r.reviewedCommit===null||r.reviewedCommit===undefined?null:SHA_RE.test(String(r.reviewedCommit))?r.reviewedCommit:undefined;
  if(commit===undefined)return bad;
  const findings=Array.isArray(ev.findings)?ev.findings.filter(f=>typeof f==="string").slice(0,20).map(f=>f.slice(0,300)):null;
  return {state:"VERIFIED",review:{reviewId:r.reviewId,runId:r.runId,missionId:r.missionId,cycle:r.cycle,verdict:r.verdict,independent:r.independent===true?true:r.independent===false?false:null,
    reviewer:str(r.reviewer.identity,120),implementer:str(r.implementer.identity,120),reviewedCommit:commit,currentHead:r.currentHead,timestamp:isoOrNull(r.timestamp),
    recordedVerdict:REVIEW_VERDICT_SET.includes(ev.recordedVerdict)?ev.recordedVerdict:null,invalidated:str(ev.invalidated,60),findingsCount:safeInt(ev.findingsCount),findings,
    exitCode:Number.isSafeInteger(ev.exitCode)?ev.exitCode:null,timedOut:ev.timedOut===true,note:str(ev.note,200)}};
}
export {MISSING};
