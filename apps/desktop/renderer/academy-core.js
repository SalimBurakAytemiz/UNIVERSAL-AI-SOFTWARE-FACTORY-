// //TR: Bu modül Skill Academy görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT): GET /v1/academy salt-okunur okuma-modelini güvenli, sınırlı alanlara eşler. HİÇBİR veri uydurulmaz — boş girdi boş dizi/null olur ve biçim bozuksa kayıt atılır. KRİTİK DÜRÜSTLÜK: bu bir öğrenme/yetkinlik KATALOĞUDUR; terfi etmiş bir öğrenme READONLY_KNOWLEDGE veya SKILL_CANDIDATE_NOT_EXECUTABLE'dır (çalıştırılabilir DEĞİL), authorityEffect her zaman NONE'dır ve HİÇBİR rolü sertifikalı/eğitimli göstermez. Akademi hiç kimseyi sertifikalamaz: certified daima 0'dır ve falseCertificationRate değişmez olarak 0 beklenir.
export const ACADEMY_PATH="/v1/academy";
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const arr=(x,max=500)=>Array.isArray(x)?x.slice(0,max):[];
const text=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const ROLE_RE=/^UASCO-\d{4}$/,GUILD_RE=/^G\d{2}$/,LRN_RE=/^lrn_[0-9a-f]{24}$/,SRC_RE=/^src_[0-9a-f]{24}$/;
export const LEARNING_STATUSES=Object.freeze(["GAP_DETECTED","SOURCE_DISCOVERY","SOURCE_SCREENED","CURRICULUM_DRAFTED","CANDIDATE_PROPOSED","LAB_EXPERIMENT_RUNNING","LAB_RESULT_RECORDED","AWAITING_INDEPENDENT_REVIEW","PROMOTED_KNOWLEDGE","PROMOTED_SKILL_CANDIDATE","REJECTED","STALE","RECERTIFY_REQUIRED","REVOKED"]);
export const LEARNING_TRIGGERS=Object.freeze(["REAL_MISSION","CAPABILITY_GAP","RELEASE_DRIFT","FAILED_EVAL"]);
export const SOURCE_TRUSTS=Object.freeze(["OFFICIAL","STANDARD","VENDOR_DOC","ACADEMIC","COMMUNITY_LOWER_TRUST","UNTRUSTED"]);
export const PROMOTED_STATUSES=Object.freeze(["PROMOTED_KNOWLEDGE","PROMOTED_SKILL_CANDIDATE"]);
const KNOWLEDGE_STATUSES=Object.freeze(["READONLY_KNOWLEDGE","SKILL_CANDIDATE_NOT_EXECUTABLE"]);
const SOURCE_STATUSES=Object.freeze(["ACTIVE","REVOKED","POISONED"]);
const num=x=>Number.isFinite(x)?x:null;
const ratio=x=>isObj(x)&&Number.isFinite(x.numerator)&&Number.isFinite(x.denominator)&&Number.isFinite(x.rate)?{numerator:x.numerator,denominator:x.denominator,rate:x.rate}:null;

// //TR: Tek öğrenme kaydını güvenli görünüme indirger; terfi varsa YALNIZ çalıştırılamaz bilgi durumu + NONE yetki etkisi taşınır (çalıştırılabilirlik/yetki ASLA türetilmez).
function mapLearning(x){
  if(!isObj(x)||!LRN_RE.test(String(x.learningId))||!LEARNING_STATUSES.includes(x.status))return null;
  const pr=isObj(x.promotion)?x.promotion:null;
  const knowledgeStatus=pr&&KNOWLEDGE_STATUSES.includes(pr.knowledgeStatus)?pr.knowledgeStatus:null;
  return {
    learningId:x.learningId,
    roleId:ROLE_RE.test(String(x.roleId))?x.roleId:null,
    guildId:GUILD_RE.test(String(x.guildId))?x.guildId:null,
    status:x.status,
    trigger:LEARNING_TRIGGERS.includes(x.trigger)?x.trigger:null,
    hypothesis:text(x.hypothesis,300),
    promoted:PROMOTED_STATUSES.includes(x.status),
    knowledgeStatus,
    // Dürüstlük değişmezleri: akademi terfisi çalıştırılabilir değildir ve yetki/sertifika vermez.
    executable:false,
    authorityEffect:"NONE",
    hasReviewerEvidence:!!(pr&&isObj(pr.reviewerEvidence)&&typeof pr.reviewerEvidence.sha256==="string"),
    promotedAt:pr?text(pr.promotedAt,40):null
  };
}
function mapSource(x){
  if(!isObj(x))return null;
  const id=String(x.sourceId);if(!SRC_RE.test(id))return null;
  return {
    sourceId:id,
    sourceTrust:SOURCE_TRUSTS.includes(x.sourceTrust)?x.sourceTrust:null,
    status:SOURCE_STATUSES.includes(x.status)?x.status:null,
    global:x.global===true||(isObj(x.scope)&&x.scope.global===true),
    publisher:text(x.publisher,120)
  };
}
function mapGlobalKnowledge(x){
  if(!isObj(x)||!LRN_RE.test(String(x.learningId)))return null;
  return {
    learningId:x.learningId,
    roleId:ROLE_RE.test(String(x.roleId))?x.roleId:null,
    guildId:GUILD_RE.test(String(x.guildId))?x.guildId:null,
    hypothesis:text(x.hypothesis,300),
    knowledgeStatus:KNOWLEDGE_STATUSES.includes(x.knowledgeStatus)?x.knowledgeStatus:null
  };
}
function mapMetrics(m){
  if(!isObj(m))return null;
  const byTrigger=isObj(m.gapDetect)&&isObj(m.gapDetect.byTrigger)?m.gapDetect.byTrigger:{};
  const byTrust=isObj(m.sourceCredibility)&&isObj(m.sourceCredibility.byTrust)?m.sourceCredibility.byTrust:{};
  const count=(o,keys)=>{const out={};for(const k of keys)out[k]=Number.isFinite(o[k])?o[k]:0;return out};
  return {
    gapDetect:isObj(m.gapDetect)&&Number.isFinite(m.gapDetect.total)?{total:m.gapDetect.total,byTrigger:count(byTrigger,LEARNING_TRIGGERS)}:null,
    sourceCredibility:isObj(m.sourceCredibility)&&Number.isFinite(m.sourceCredibility.total)?{total:m.sourceCredibility.total,byTrust:count(byTrust,SOURCE_TRUSTS)}:null,
    knowledgeFreshness:ratio(m.knowledgeFreshness),
    labPassRate:ratio(m.labPassRate),
    promotionReversalRate:ratio(m.promotionReversalRate),
    reuseSuccess:ratio(m.reuseSuccess),
    // Yanlış sertifika oranı: değişmez olarak 0 beklenir; null (veri yok) veya 0 dışında bir değer dürüstçe gösterilir (gizlenmez).
    falseCertificationRate:ratio(m.falseCertificationRate),
    timeToAcquireMs:isObj(m.timeToAcquireMs)&&Number.isFinite(m.timeToAcquireMs.count)?{count:m.timeToAcquireMs.count,meanMs:num(m.timeToAcquireMs.meanMs),medianMs:num(m.timeToAcquireMs.medianMs)}:null
  };
}
/** Durum sayımı: yalnız bilinen durumlardan, gerçek kayıtlardan; uydurma yok. */
export function countByStatus(learnings){
  const out={};for(const s of LEARNING_STATUSES)out[s]=0;
  for(const l of learnings)if(out[l.status]!==undefined)out[l.status]+=1;
  return out;
}
/**
 * //TR: GET /v1/academy -> güvenli görünüm. VERIFIED (gerçek okuma-modeli; boşsa görünüm EMPTY gösterir) veya biçim bozuksa ERROR.
 * certified her zaman 0'dır (akademi sertifikalamaz); promotedKnowledge yalnız READONLY/NOT_EXECUTABLE bilgidir.
 */
export function mapAcademy(raw){
  if(!isObj(raw))return {state:"ERROR",learnings:[],sources:[],reuses:0,globalKnowledge:[],byStatus:countByStatus([]),metrics:null};
  const learnings=arr(raw.learnings).map(mapLearning).filter(Boolean);
  const sources=arr(raw.sources).map(mapSource).filter(Boolean);
  const globalKnowledge=arr(raw.globalKnowledge).map(mapGlobalKnowledge).filter(Boolean);
  const reuses=arr(raw.reuses).filter(isObj).length;
  return {state:"VERIFIED",learnings,sources,reuses,globalKnowledge,byStatus:countByStatus(learnings),metrics:mapMetrics(raw.metrics)};
}
