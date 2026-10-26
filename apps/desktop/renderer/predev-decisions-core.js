// //TR: Bu modül Pre-dev Founder kararlarının (LANE-A) saf, DOM'suz çekirdeğidir: POST /v1/missions/:id/predev/start, POST .../predev/artifacts/:artifactId/approve {evidenceRefs} ve POST .../reject {reason} isteklerini kurar ve yanıtlarını sınıflar. Karar kapıları (bağımsız onaylayan, kanıt zorunlu, faz sırası) SUNUCUDADIR; burada yeniden uygulanmaz, onaylayan her zaman sunucunun aktörüdür ve istemci onaylayan/kanıt uydurmaz. Girdi yalnız sunucu şemasının izin verdiği biçimde kurulur (kanıt 1..20, benzersiz, ^[A-Za-z0-9._:-]+$ ve en çok 128 karakter; gerekçe boş olmayan en çok 1000 karakter). Reddedilme nedeni sunucunun döndüğü PREDEV_* kodudur ve AYNEN gösterilir; bilinmeyen ama biçimi geçerli kod da aynen gösterilir, biçimi bozuk/eksik neden ise "neden bildirilmedi" olur (asla uydurulmaz). Başarılı yanıt GET /v1/predev okuma-modeliyle aynı sıkı eşleyiciden geçer; bozuk 2xx yanıt başarı sayılmaz. Ana süreç izin listesinde yol yoksa (INVALID_API_PATH) ya da sunucu rotayı bilmiyorsa sonuç "etkin değil"dir ve hiçbir sonuç uydurulmaz. Bu modül ürün doğrulamasını hesaplamaz.
import {MISSION_ID_RE,mapPredev} from "./journey-core.js";
import {describePostResult} from "./work-core.js";

export const ARTIFACT_ID_RE=/^pda_[0-9a-f]{24}$/;
export const EVIDENCE_REF_RE=/^[A-Za-z0-9._:-]{1,128}$/;
export const MAX_EVIDENCE_REFS=20;
export const REJECT_REASON_MAX=1000;
/** Sunucu kapılarının/sürücünün bilinen ret nedenleri (core/workos/predev); her biri ayrıca yerelleştirilmiş bir açıklama taşır, kod AYNEN gösterilir. */
export const PREDEV_REFUSAL_REASONS=Object.freeze([
  "PREDEV_APPROVER_NOT_INDEPENDENT","PREDEV_APPROVAL_EVIDENCE_REQUIRED","PREDEV_PHASE_ARTIFACT_NOT_APPROVED","PREDEV_ARTIFACT_TRANSITION_ILLEGAL",
  "PREDEV_ARTIFACT_WRONG_PHASE","PREDEV_ARTIFACT_MISSION_MISMATCH","PREDEV_PHASE_TRANSITION_ILLEGAL","PREDEV_SEQUENCE_EXISTS_FOR_MISSION",
  "PREDEV_SEQUENCE_UNKNOWN","PREDEV_REJECT_REASON","PREDEV_VERSION_INCONSISTENT","PREDEV_SUPERSEDE_INCONSISTENT","PREDEV_DUPLICATE",
  "PREDEV_DRIVER_NO_NEXT_PHASE","PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE","PREDEV_DRIVER_ARTIFACT_NOT_FOUND","PREDEV_REFUSED"]);
const REASON_RE=/^PREDEV_[A-Z][A-Z_]{0,79}$/;
/** Sunucunun kendi hata alanıyla (409/404 {error:"PREDEV_DRIVER_*"}) bildirdiği sürücü ret kodları. */
const DRIVER_ERRORS=Object.freeze(["PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE","PREDEV_DRIVER_ARTIFACT_NOT_FOUND"]);

export const predevStartPath=id=>MISSION_ID_RE.test(String(id))?`/v1/missions/${id}/predev/start`:null;
export const predevDecisionPath=(id,artifactId,verb)=>MISSION_ID_RE.test(String(id))&&ARTIFACT_ID_RE.test(String(artifactId))&&(verb==="approve"||verb==="reject")?`/v1/missions/${id}/predev/artifacts/${artifactId}/${verb}`:null;

const result=(path,body,errors)=>Object.keys(errors).length?{ok:false,path:null,body:null,errors}:{ok:true,path,body,errors:{}};

export function buildStartRequest({missionId}){
  const path=predevStartPath(missionId);
  return result(path,{},path?{}:{mission:"predev.err.mission"});
}
/** Serbest metni (satır/boşluk/virgül ayrımlı) kanıt listesine çevirir: {refs,error}; kural sunucu şemasıyla aynıdır. */
export function parseEvidenceRefs(text){
  const refs=(typeof text==="string"?text:"").split(/[\s,]+/).filter(Boolean);
  if(!refs.length)return {refs:[],error:"predev.err.evidenceRequired"};
  if(refs.some(r=>!EVIDENCE_REF_RE.test(r)))return {refs:[],error:"predev.err.evidenceFormat"};
  if(new Set(refs).size!==refs.length)return {refs:[],error:"predev.err.evidenceDuplicate"};
  if(refs.length>MAX_EVIDENCE_REFS)return {refs:[],error:"predev.err.evidenceMany"};
  return {refs,error:null};
}
export function buildApproveRequest({missionId,artifactId,evidenceText}){
  const path=predevDecisionPath(missionId,artifactId,"approve"),errors={};
  if(!path)errors.artifact="predev.err.artifact";
  const ev=parseEvidenceRefs(evidenceText);
  if(ev.error)errors.evidenceRefs=ev.error;
  return result(path,{evidenceRefs:ev.refs},errors);
}
export function buildRejectRequest({missionId,artifactId,reason}){
  const path=predevDecisionPath(missionId,artifactId,"reject"),errors={},r=typeof reason==="string"?reason.trim():"";
  if(!path)errors.artifact="predev.err.artifact";
  if(!r)errors.reason="err.reasonRequired";
  else if(r.length>REJECT_REASON_MAX)errors.reason="predev.err.reasonLong";
  return result(path,{reason:r},errors);
}

/**
 * POST sonucunu sınıflar: RESULT ({predev,replayed}; sıkı eşlemeden geçti ve istenen mission), REFUSED ({reason|null,known}),
 * NOT_FOUND (sunucu mission/artefaktı bilmiyor), NOT_ENABLED (izin listesi/rota yok), INVALID (2xx ama bozuk), FAILED (diğer; describePostResult kullanılır).
 */
export function classifyPredevPost(res,missionId){
  if(!res)return {kind:"FAILED"};
  const err=typeof res.body?.error==="string"?res.body.error:"";
  if(res.thrown&&/INVALID_API_PATH/.test(String(res.message??"")))return {kind:"NOT_ENABLED"};
  if(res.thrown)return {kind:"FAILED"};
  const s=res.status;
  if(s>=200&&s<300){
    const m=mapPredev(res.body);
    if(m.state!=="VERIFIED"||m.predev.missionId!==missionId)return {kind:"INVALID"};
    const rep=res.body.replayed;
    if(rep!==undefined&&typeof rep!=="boolean")return {kind:"INVALID"};
    return {kind:"RESULT",predev:m.predev,replayed:rep===true};
  }
  if((s===409||s===404)&&DRIVER_ERRORS.includes(err))return {kind:"REFUSED",reason:err,known:true};
  if(s===409&&err==="PREDEV_GATE_REFUSED"){
    const r=res.body.reason;
    if(typeof r==="string"&&PREDEV_REFUSAL_REASONS.includes(r))return {kind:"REFUSED",reason:r,known:true};
    if(typeof r==="string"&&REASON_RE.test(r))return {kind:"REFUSED",reason:r,known:false};
    return {kind:"REFUSED",reason:null,known:false};
  }
  if(s===404&&err==="WORKOS_NOT_FOUND")return {kind:"NOT_FOUND"};
  if(s===404||s===501)return {kind:"NOT_ENABLED"};
  return {kind:"FAILED"};
}
/** Sınıfı form durum anahtarına çevirir: {ok,key,vars}; yalnız sunucunun bildirdiği sonuç/neden söylenir. `verb` start|approve|reject. */
export function predevStatusKey(c,res,verb){
  if(c.kind==="RESULT")return {ok:true,key:verb==="start"?(c.replayed?"predev.started.replayed":"predev.started"):`predev.${verb==="approve"?"approved":"rejected"}`,vars:{phase:c.predev.phase}};
  if(c.kind==="REFUSED")return c.reason===null?{ok:false,key:"predev.refused.noReason",vars:{}}:{ok:false,key:c.known?`predev.refused.${c.reason}`:"predev.refused.unrecognised",vars:{reason:c.reason}};
  if(c.kind==="NOT_FOUND")return {ok:false,key:"predev.notFound",vars:{}};
  if(c.kind==="NOT_ENABLED")return {ok:false,key:"predev.notEnabled",vars:{}};
  if(c.kind==="INVALID")return {ok:false,key:"predev.invalid",vars:{}};
  const d=describePostResult(res);return {ok:false,key:d.key,vars:d.vars};
}
