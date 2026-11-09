// //TR: Bu modül M1a c2 koşu teslim akışının saf (DOM'suz) çekirdeğidir (D-M1A-STATE-MODEL-2026-10-15 + D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15): sunucunun delivery görünümünü güvenli biçimde eşler (iki ayrı eksen: sourceGeneration / productVerification, artefakt kaydı, kabul kaydı, dosya durumu), "Teslim paketini hazırla" ve NOT_VERIFIED kaynak teslimi kabul isteklerini kurar ve onay kutusu durumunun anahtarını runId + missionId + sourceCommit + exportArtifactHash (+ testSurfaceSha256) olarak tanımlar; anahtar değişirse onaylar sıfırlanır (RV-M1A-C1-OBS-1). Kabul nesnesi yalnız sunucunun bildirdiği değerlerle, birebir biçimde kurulur; hiçbir yüzey doğrulanmamış ürün için COMPLETE/PASS/VERIFIED göstermez.
const RUN_RE=/^run_[0-9a-f]{24}$/,MSN_RE=/^msn_[0-9a-f]{24}$/,PRJ_RE=/^prj_[0-9a-f]{24}$/,SHA_RE=/^[0-9a-f]{40}$/,SHA256_RE=/^[0-9a-f]{64}$/,CODE_RE=/^[A-Z][A-Z0-9_]{0,39}$/;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,max=200)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const arr=(x,max=200)=>Array.isArray(x)?x.slice(0,max):[];
const strList=x=>arr(x).filter(v=>typeof v==="string").map(v=>v.slice(0,500));
export const SOURCE_STATES=Object.freeze(["NOT_STARTED","IN_PROGRESS","SOURCE_GENERATION_COMPLETE","BLOCKED","FAILED"]);
export const PRODUCT_STATES=Object.freeze(["NOT_VERIFIED","PRODUCT_VERIFIED","FAILED"]);
export const FILE_STATES=Object.freeze(["VERIFIED","MODIFIED","MISSING"]);

export const deliveriesPath=projectId=>PRJ_RE.test(String(projectId??""))?`/v1/deliveries?projectId=${projectId}`:null;
export const deliveryPath=runId=>RUN_RE.test(String(runId??""))?`/v1/work-runs/${runId}/delivery`:null;

function axis(x,states){
  if(!isObj(x)||!states.includes(x.state))return null;
  return {state:x.state,reason:typeof x.reason==="string"?x.reason.slice(0,160):null,label:text(x.label,160)};
}
function artifactOf(x){
  if(!isObj(x)||!RUN_RE.test(String(x.runId))||!MSN_RE.test(String(x.missionId))||!SHA_RE.test(String(x.sourceCommit))||!SHA_RE.test(String(x.treeSha))||!SHA256_RE.test(String(x.exportArtifactHash)))return null;
  return {runId:x.runId,missionId:x.missionId,sourceCommit:x.sourceCommit,treeSha:x.treeSha,exportArtifactHash:x.exportArtifactHash};
}
/** GET /v1/work-runs/:id/delivery (veya /v1/deliveries öğesi) -> güvenli görünüm; biçim bozuksa null (eylem kurulmaz, sunucu fail-closed karar verir). */
export function mapDelivery(x){
  if(!isObj(x)||!RUN_RE.test(String(x.runId))||!MSN_RE.test(String(x.missionId)))return null;
  const sg=axis(x.sourceGeneration,SOURCE_STATES),pv=axis(x.productVerification,PRODUCT_STATES);
  if(!sg||!pv)return null;
  const tc=isObj(x.testChanges)?x.testChanges:{},ch=isObj(tc.changed)?tc.changed:{};
  const acc=isObj(x.accepted)&&artifactOf({...x.accepted,treeSha:"0".repeat(40)})?{exportArtifactHash:x.accepted.exportArtifactHash,sourceCommit:x.accepted.sourceCommit,acceptedAt:text(x.accepted.acceptedAt,40)}:null;
  return {
    runId:x.runId,missionId:x.missionId,projectId:PRJ_RE.test(String(x.projectId))?x.projectId:null,status:CODE_RE.test(String(x.status))?x.status:null,
    sourceCommit:SHA_RE.test(String(x.sourceCommit))?x.sourceCommit:null,sourceGeneration:sg,productVerification:pv,testsExecuted:x.testsExecuted===true,
    artifact:artifactOf(x.artifact),accepted:acc,fileState:FILE_STATES.includes(x.fileState)?x.fileState:null,
    testChanges:{required:tc.required===true,testSurfaceSha256:SHA256_RE.test(String(tc.testSurfaceSha256))?tc.testSurfaceSha256:null,
      changed:{modified:strList(ch.modified),deleted:strList(ch.deleted),renamed:arr(ch.renamed).filter(r=>isObj(r)&&typeof r.from==="string"&&typeof r.to==="string").map(r=>({from:r.from.slice(0,500),to:r.to.slice(0,500)})),harness:strList(ch.harness),truncated:ch.truncated===true}}
  };
}
export function mapDeliveries(raw){
  if(!isObj(raw)||!Array.isArray(raw.deliveries))return {state:"ERROR",items:[]};
  return {state:"VERIFIED",items:raw.deliveries.slice(0,500).map(mapDelivery).filter(Boolean)};
}
export const isSourceComplete=d=>d?.sourceGeneration?.state==="SOURCE_GENERATION_COMPLETE";
/** Ürün düzeyi COMPLETE yalnız PRODUCT_VERIFIED'da sunulur (M1a'da erişilemez); bilinmeyen durum asla doğrulanmış sayılmaz. */
export const canOfferComplete=run=>run?.productVerification==="PRODUCT_VERIFIED";
/** Onay kutusu durumunun anahtarı: bunlardan biri değişirse (başka run/commit/artefakt/test yüzeyi) önceki işaretler geçersizdir. */
export function deliveryAckKey(d){return [d?.runId??"-",d?.missionId??"-",d?.sourceCommit??"-",d?.artifact?.exportArtifactHash??"-",d?.testChanges?.testSurfaceSha256??"-"].join("|")}
/** Hazırlanan paket ile koşunun güncel head'i (d.sourceCommit, renderer'ın zaten okuduğu veri) karşılaştırması; yalnız iki geçerli 40-hex eşitse VALID, doğrulanmış okuma olmadan olumlu iddia yok. */
export function deliverySourceState(d){
  if(!d?.artifact)return "NOT_PREPARED";
  const head=d.sourceCommit,prep=d.artifact.sourceCommit;
  if(!SHA_RE.test(String(head??""))||!SHA_RE.test(String(prep??"")))return "UNKNOWN";
  return head===prep?"VALID":"STALE";
}
export function buildPrepareRequest(d){
  const errors={};
  if(!d||!RUN_RE.test(String(d.runId)))errors.runId="err.runInvalid";
  else if(!isSourceComplete(d))errors.delivery="err.deliveryNotComplete";
  else if(d.accepted)errors.delivery="err.deliveryAlreadyAccepted";
  return Object.keys(errors).length?{ok:false,errors}:{ok:true,path:`/v1/work-runs/${d.runId}/delivery/prepare`,body:{}};
}
/** Kabul isteği: işaretler aynı anahtara ait olmalı, NOT_EXECUTED/NOT_VERIFIED kutusu işaretli olmalı, test/harness değiştiyse ikinci kutu da; nesne birebir {runId, missionId, sourceCommit, exportArtifactHash, acknowledgeNotExecuted:true} (+ testChangesAcknowledgement). */
export function buildAcceptanceRequest(d,checks){
  const errors={};
  const a=d?.artifact;
  if(!d||!RUN_RE.test(String(d.runId))||!MSN_RE.test(String(d.missionId)))errors.acknowledgement="err.ackDataMissing";
  else if(a&&deliverySourceState(d)==="STALE"&&a.runId===d.runId&&a.missionId===d.missionId)errors.acknowledgement="err.deliveryStale";
  else if(!a||!SHA256_RE.test(String(a.exportArtifactHash))||!SHA_RE.test(String(d.sourceCommit))||a.sourceCommit!==d.sourceCommit||a.runId!==d.runId||a.missionId!==d.missionId)errors.acknowledgement="err.deliveryNotPrepared";
  else if(d.accepted)errors.acknowledgement="err.deliveryAlreadyAccepted";
  else if(!checks||checks.key!==deliveryAckKey(d))errors.acknowledgement="err.ackStale";
  else if(checks.notExecuted!==true)errors.acknowledgement="err.ackNotExecutedRequired";
  else if(d.testChanges.required&&checks.testChanges!==true)errors.acknowledgement="err.ackTestChangesRequired";
  else if(d.testChanges.required&&!d.testChanges.testSurfaceSha256)errors.acknowledgement="err.ackDataMissing";
  if(Object.keys(errors).length)return {ok:false,errors};
  const acceptance={runId:d.runId,missionId:d.missionId,sourceCommit:d.sourceCommit,exportArtifactHash:a.exportArtifactHash,acknowledgeNotExecuted:true};
  if(d.testChanges.required)acceptance.testChangesAcknowledgement={acknowledgeTestChanges:true,testSurfaceSha256:d.testChanges.testSurfaceSha256};
  return {ok:true,path:`/v1/work-runs/${d.runId}/delivery/accept`,body:{acceptance}};
}

// //TR: Teslim kontrol listesi (Founder yönergesi, UASCO-T0015 renderer kapsamı): artefakt, sha256, dosya bütünlüğü, arşiv secret taraması, koşu güvenlik aşaması,
// doğrulama durumu ve kabul durumu tek listede. Kaynaklar yalnız mevcut izinli GET'lerdir (/v1/deliveries?projectId, /v1/work-runs/:id). Hiçbir satır kanıtsız
// "tamam" olmaz: ürün doğrulaması yalnız PRODUCT_VERIFIED'da OK'dir; arşiv taraması yalnız hazırlanmış artefakt varken (hazırlama her bulguda EXPORT_BLOCKED_SECRET ile
// reddeder) CLEAN_AT_PREPARE'dir; güvenlik aşaması okunamazsa UNAVAILABLE, hiç koşmadıysa NOT_RUN'dır.
export const SECURITY_STATUSES=Object.freeze(["PASSED","PARTIAL","BLOCKED"]);
const BUILTIN_STATES=Object.freeze(["CLEAN","FINDINGS"]),GITLEAKS_STATES=Object.freeze(["CLEAN","FINDINGS","NOT_INSTALLED","ERROR"]),SCA_STATES=Object.freeze(["CLEAN","FINDINGS","PARTIAL","NOT_INSTALLED","ERROR"]);
const BLOCK_REASONS=Object.freeze(["SECRET_DETECTED","VULNERABLE_DEPENDENCY","SECURITY_TOOL_ERROR"]);
/** GET /v1/work-runs/:id gövdesi -> {state:"VERIFIED",...} | {state:"NOT_RUN"} | {state:"ERROR"}. Güvenlik aşaması özeti WorkRun'da alan olarak DEĞİL, yalnız
 *  run.evidence içindeki SECURITY_REPORT kanıtında (`.security`) bulunur (runner.ts SECURITY_REPORT; project-studio prepare ile aynı seçim). Seçim: `commit` verilmişse o commit'e
 *  bağlı en son SECURITY_REPORT, yoksa en son SECURITY_REPORT (kanıt dizisi ekleme sırasındadır). Hiç SECURITY_REPORT yoksa NOT_RUN; özeti eksik/bozuksa ERROR. */
export function mapRunSecurity(raw,commit){
  const run=isObj(raw)?(isObj(raw.run)?raw.run:isObj(raw.workRun)?raw.workRun:null):null;
  if(!run||!Array.isArray(run.evidence))return {state:"ERROR"};
  const reports=run.evidence.filter(e=>isObj(e)&&e.kind==="SECURITY_REPORT");
  if(!reports.length)return {state:"NOT_RUN"};
  const forCommit=typeof commit==="string"?reports.filter(e=>e.commitSha===commit):[];
  const s=(forCommit.length?forCommit:reports).at(-1).security;
  if(!isObj(s)||!SECURITY_STATUSES.includes(s.status)||!isObj(s.secrets)||!isObj(s.secrets.builtin)||!isObj(s.secrets.gitleaks)||!isObj(s.sca))return {state:"ERROR"};
  const b=s.secrets.builtin.status,g=s.secrets.gitleaks.status,c=s.sca.status;
  if(!BUILTIN_STATES.includes(b)||!GITLEAKS_STATES.includes(g)||!SCA_STATES.includes(c))return {state:"ERROR"};
  if(s.blockReason!==null&&s.blockReason!==undefined&&!BLOCK_REASONS.includes(s.blockReason))return {state:"ERROR"};
  return {state:"VERIFIED",status:s.status,blockReason:s.blockReason??null,builtin:b,gitleaks:g,sca:c,headSha:SHA_RE.test(String(s.headSha))?s.headSha:null};
}
/** Kontrol listesi satırları; her satırın `level`'ı OK | PENDING | ATTENTION | UNKNOWN (yalnız kanıtlı durum OK olur). */
export function deliveryChecklist(d,sec){
  if(!d)return [];
  const a=d.artifact,prepared=!!a,src=deliverySourceState(d);
  const rows=[];
  rows.push({key:"artifact",value:prepared?"PREPARED":"NOT_PREPARED",level:prepared?(src==="VALID"?"OK":src==="STALE"?"ATTENTION":"UNKNOWN"):"PENDING",detail:prepared?src:null});
  rows.push({key:"sha256",value:prepared?a.exportArtifactHash:null,level:prepared?"OK":"PENDING",detail:null});
  rows.push({key:"integrity",value:prepared?(d.fileState??"UNKNOWN"):null,level:!prepared?"PENDING":d.fileState==="VERIFIED"?"OK":d.fileState==null?"UNKNOWN":"ATTENTION",detail:null});
  rows.push({key:"archiveScan",value:prepared?"CLEAN_AT_PREPARE":"NOT_YET",level:prepared?"OK":"PENDING",detail:null});
  let st,lvl,detail=null;
  if(!sec||sec.state==="UNAVAILABLE"||sec.state==="OFFLINE"){st="UNAVAILABLE";lvl="UNKNOWN"}
  else if(sec.state==="ERROR"){st="ERROR";lvl="UNKNOWN"}
  else if(sec.state==="NOT_RUN"){st="NOT_RUN";lvl="UNKNOWN"}
  else if(sec.state==="VERIFIED"){
    const sameHead=sec.headSha!==null&&sec.headSha===d.sourceCommit;
    st=sec.status;detail={builtin:sec.builtin,gitleaks:sec.gitleaks,sca:sec.sca,blockReason:sec.blockReason,sameHead};
    // OK yalnız PASSED + aynı commit + TÜM bileşenler CLEAN iken (iç tutarsız "PASSED ama araç yok/kısmi" kaydı Tamam sayılmaz).
    const allClean=sec.builtin==="CLEAN"&&sec.gitleaks==="CLEAN"&&sec.sca==="CLEAN";
    lvl=sec.status==="BLOCKED"||sec.builtin==="FINDINGS"||sec.gitleaks==="FINDINGS"||sec.sca==="FINDINGS"?"ATTENTION":sec.status==="PASSED"&&sameHead&&allClean?"OK":"UNKNOWN";
  }else{st="UNAVAILABLE";lvl="UNKNOWN"}
  rows.push({key:"securityStage",value:st,level:lvl,detail});
  const pv=d.productVerification?.state??null;
  rows.push({key:"verification",value:pv??"UNKNOWN",level:pv==="PRODUCT_VERIFIED"?"OK":pv==="FAILED"?"ATTENTION":"UNKNOWN",detail:d.productVerification?.reason??null});
  rows.push({key:"acceptance",value:d.accepted?"ACCEPTED":"NOT_ACCEPTED",level:d.accepted?"OK":"PENDING",detail:d.accepted?.acceptedAt??null});
  return rows;
}
