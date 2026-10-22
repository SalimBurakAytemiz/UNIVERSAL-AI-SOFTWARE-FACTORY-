// //TR: Bu modül Proje Bilgi Özeti'nin (GET /v1/projects/:id/knowledge: Proje Belleği + kanıt dizini, Lane B) saf, DOM'suz sıkı eşleyicisidir. Sayılar sunucunun bildirdiği gibi AYNEN taşınır, hiçbir değer türetilmez: TAMPERED bellekte sayı/baş yoktur (null), kanıt örneklenmiş (sampled) bir sayımdır ve bu açıkça belirtilir, kanıt dizini bağlı değilse ya da sorgu başarısızsa 0 UYDURULMAZ. Eksik/yanlış tipli alan, toplamla çelişen sayaç ya da durumla çelişen null kuralı TÜM okumayı ERROR yapar.
export const MEMORY_KINDS=Object.freeze(["DECISION","FACT","SOURCE","REVISION","NOTE"]);
export const MEMORY_STATES=Object.freeze(["OK","ABSENT","TAMPERED","TORN_TAIL"]);
export const EVIDENCE_KINDS=Object.freeze(["WORK_RUN_STEP","WORK_RUN_LOG","REVIEW_EVIDENCE","AUDIT_CHECKPOINT"]);
export const VERIFICATION_STATUSES=Object.freeze(["VERIFIED","MISMATCH","MISSING","UNVERIFIABLE"]);
export const KNOWLEDGE_LIMITS=Object.freeze({heads:20,missions:10,latest:10,tags:20});
const PROJECT_ID_RE=/^prj_[0-9a-f]{24}$/;
const MEM_ID_RE=/^mem_\d{6,}$/;
const EVD_ID_RE=/^evd_[0-9a-f]{24}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const ISO_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const MAX_COUNT=1000000;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const cnt=x=>Number.isSafeInteger(x)&&x>=0&&x<=MAX_COUNT;
const iso=x=>{if(typeof x!=="string"||!ISO_RE.test(x))return null;const t=Date.parse(x);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===x.slice(0,10)?x:null};
const str=(x,max)=>typeof x==="string"&&x.length>0&&x.length<=max?x:null;
export const knowledgePath=projectId=>typeof projectId==="string"&&PROJECT_ID_RE.test(projectId)?`/v1/projects/${projectId}/knowledge`:null;
/** Anahtar kümesi tam eşleşmeli ve her değer sayaç olmalı; toplam döner (yoksa null). */
function tally(obj,keys){
  if(!isObj(obj)||Object.keys(obj).length!==keys.length)return null;
  let sum=0;const out={};
  for(const k of keys){if(!cnt(obj[k]))return null;out[k]=obj[k];sum+=obj[k]}
  return {counts:out,sum};
}
function mapMemory(m){
  if(!isObj(m)||!MEMORY_STATES.includes(m.state)||!isObj(m.health)||m.health.state!==m.state)return null;
  const h=m.health;
  if(!cnt(h.records)||!cnt(h.lastSeq)||!cnt(h.tornTailBytes)||(h.reason!==null&&str(h.reason,200)===null))return null;
  const health={state:h.state,reason:h.reason,records:h.records,tornTailBytes:h.tornTailBytes};
  if(m.state==="TAMPERED"){
    if(m.total!==null||m.byKind!==null||m.currentHeads!==null)return null;
    return {state:m.state,health,total:null,byKind:null,currentHeads:null};
  }
  const t=tally(m.byKind,MEMORY_KINDS);
  if(t===null||!cnt(m.total)||t.sum!==m.total||!Array.isArray(m.currentHeads)||m.currentHeads.length>KNOWLEDGE_LIMITS.heads)return null;
  const heads=[];
  for(const x of m.currentHeads){
    if(!isObj(x)||typeof x.id!=="string"||!MEM_ID_RE.test(x.id)||!MEMORY_KINDS.includes(x.kind)||str(x.title,300)===null||iso(x.at)===null)return null;
    if(!Array.isArray(x.tags)||x.tags.length>KNOWLEDGE_LIMITS.tags||!x.tags.every(g=>str(g,64)!==null))return null;
    heads.push({id:x.id,kind:x.kind,title:x.title,at:x.at,tags:x.tags.slice()});
  }
  if(heads.length>m.total)return null;
  return {state:m.state,health,total:m.total,byKind:t.counts,currentHeads:heads};
}
function mapEvidence(e){
  if(!isObj(e))return null;
  if(e.state==="UNAVAILABLE")return e.reason==="EVIDENCE_NOT_WIRED"?{state:"UNAVAILABLE",reason:e.reason}:null;
  if(e.state==="ERROR")return e.reason==="EVIDENCE_QUERY_FAILED"?{state:"ERROR",reason:e.reason}:null;
  if(e.state!=="AVAILABLE"||e.sampled!==true||typeof e.truncated!=="boolean"||!Number.isSafeInteger(e.missionsQueried)||e.missionsQueried<0||e.missionsQueried>KNOWLEDGE_LIMITS.missions||!cnt(e.total))return null;
  const k=tally(e.byKind,EVIDENCE_KINDS),v=tally(e.byVerification,VERIFICATION_STATUSES);
  if(k===null||v===null||k.sum!==e.total||v.sum!==e.total||!Array.isArray(e.latest)||e.latest.length>KNOWLEDGE_LIMITS.latest||e.latest.length>e.total)return null;
  const latest=[];
  for(const x of e.latest){
    if(!isObj(x)||typeof x.evidenceId!=="string"||!EVD_ID_RE.test(x.evidenceId)||!EVIDENCE_KINDS.includes(x.kind)||!VERIFICATION_STATUSES.includes(x.verification))return null;
    const at=x.createdAt===null?null:iso(x.createdAt);if(x.createdAt!==null&&at===null)return null;
    for(const f of ["missionId","runId"])if(x[f]!==null&&(typeof x[f]!=="string"||!SAFE_ID_RE.test(x[f])))return null;
    latest.push({evidenceId:x.evidenceId,kind:x.kind,verification:x.verification,createdAt:at,missionId:x.missionId,runId:x.runId});
  }
  return {state:"AVAILABLE",sampled:true,truncated:e.truncated,missionsQueried:e.missionsQueried,total:e.total,byKind:k.counts,byVerification:v.counts,latest};
}
/** GET /v1/projects/:id/knowledge yanıtı -> {state:"VERIFIED",knowledge:{projectId,memory,evidence}} | {state:"ERROR",knowledge:null}. Yanıttaki projectId istenenle aynı olmalıdır. */
export function mapKnowledge(raw,projectId){
  const bad={state:"ERROR",knowledge:null};
  const k=isObj(raw)?raw.knowledge:null;
  if(!isObj(k)||k.projectId!==projectId||typeof projectId!=="string"||!PROJECT_ID_RE.test(projectId))return bad;
  const memory=mapMemory(k.memory),evidence=mapEvidence(k.evidence);
  return memory!==null&&evidence!==null?{state:"VERIFIED",knowledge:{projectId,memory,evidence}}:bad;
}

// ---------- Kayıt geçmişi (GET /v1/projects/:id/memory/:memId/provenance) ----------
// //TR: Bir bellek girdisinin supersede zincirini (eskiden yeniye) gösterir: yalnız sunucunun bildirdiği adımlar; zincir boşsa, son adım istenen kayıt değilse ya da sıra artmıyorsa TÜM okuma ERROR olur.
export const provenancePath=(projectId,memId)=>typeof projectId==="string"&&PROJECT_ID_RE.test(projectId)&&typeof memId==="string"&&MEM_ID_RE.test(memId)?`/v1/projects/${projectId}/memory/${memId}/provenance`:null;
export const MAX_LINEAGE=1000;
const SHA64_RE=/^[0-9a-f]{64}$/;
function step(x){
  if(!isObj(x)||typeof x.id!=="string"||!MEM_ID_RE.test(x.id)||!Number.isSafeInteger(x.seq)||x.seq<1||x.seq>MAX_COUNT||iso(x.at)===null||!MEMORY_KINDS.includes(x.kind)||typeof x.hash!=="string"||!SHA64_RE.test(x.hash))return null;
  if(!isObj(x.author)||str(x.author.role,64)===null||(x.author.sessionId!==undefined&&str(x.author.sessionId,128)===null))return null;
  if(!Array.isArray(x.sources)||x.sources.length>32)return null;
  const sources=[];
  for(const s of x.sources){
    if(!isObj(s)||str(s.ref,2048)===null||iso(s.retrievedAt)===null||(s.sha256!==undefined&&(typeof s.sha256!=="string"||!SHA64_RE.test(s.sha256))))return null;
    sources.push({ref:s.ref,sha256:s.sha256??null,retrievedAt:s.retrievedAt});
  }
  return {id:x.id,seq:x.seq,at:x.at,kind:x.kind,authorRole:x.author.role,sources,hash:x.hash};
}
/** -> {state:"VERIFIED",provenance:{id,currentHeadId,lineage[]}} | {state:"ERROR",provenance:null}; lineage eskiden yeniye, son adım istenen kayıttır. */
export function mapProvenance(raw,memId){
  const bad={state:"ERROR",provenance:null};
  const p=isObj(raw)?raw.provenance:null;
  if(!isObj(p)||typeof memId!=="string"||!MEM_ID_RE.test(memId)||p.id!==memId||typeof p.currentHeadId!=="string"||!MEM_ID_RE.test(p.currentHeadId)||!Array.isArray(p.lineage)||p.lineage.length<1||p.lineage.length>MAX_LINEAGE)return bad;
  const lineage=[];
  for(const x of p.lineage){const s=step(x);if(s===null||(lineage.length&&s.seq<=lineage[lineage.length-1].seq))return bad;lineage.push(s)}
  if(lineage[lineage.length-1].id!==memId)return bad;
  return {state:"VERIFIED",provenance:{id:memId,currentHeadId:p.currentHeadId,lineage}};
}

// ---------- Bellek listesi / arama (GET /v1/projects/:id/memory?kind=&tag=&q=) ----------
// //TR: Salt okunur arama: yalnız sunucuda var olan GET rotası; sorgu anahtarları SABİT sırada (kind, tag, q), yüzde-kodlu ve kanonik üretilir (ana süreç izin listesi için), boş ya da denetim karakteri içeren değer isteğe hiç girmez. Yanıt sıkı eşlenir; bir bozuk kayıt tüm okumayı ERROR yapar, sunucu süzgeci istemcide yeniden uygulanmaz.
export const MAX_QUERY=200,MAX_TAG_QUERY=64,MAX_LIST=2000,LIST_RENDER_CAP=100;
const CTRL_RE=/[\u0000-\u001f\u007f]/;
const encQ=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
/** {kind,tag,q} (ham form değerleri) -> {ok,path,errors}; hata anahtarları form.field adlarıdır. */
export function buildMemorySearch(projectId,{kind="",tag="",q=""}={}){
  const errors={};
  if(typeof projectId!=="string"||!PROJECT_ID_RE.test(projectId))errors.project="knowledge.search.err.project";
  const k=typeof kind==="string"?kind:"",t=typeof tag==="string"?tag.trim():"",s=typeof q==="string"?q.trim():"";
  if(typeof kind!=="string"||(k!==""&&!MEMORY_KINDS.includes(k)))errors.memKind="knowledge.search.err.kind";
  if(typeof tag!=="string"||t.length>MAX_TAG_QUERY||CTRL_RE.test(t))errors.memTag="knowledge.search.err.tag";
  if(typeof q!=="string"||s.length>MAX_QUERY||CTRL_RE.test(s))errors.memQ="knowledge.search.err.q";
  if(Object.keys(errors).length)return {ok:false,path:null,errors};
  const parts=[];
  if(k!=="")parts.push(`kind=${k}`);
  if(t!=="")parts.push(`tag=${encQ(t)}`);
  if(s!=="")parts.push(`q=${encQ(s)}`);
  return {ok:true,path:`/v1/projects/${projectId}/memory${parts.length?"?"+parts.join("&"):""}`,errors:{}};
}
function record(x,projectId){
  const base=step({id:x?.id,seq:x?.seq,at:x?.at,kind:x?.kind,author:x?.author,sources:x?.sources,hash:x?.hash});
  if(base===null||!isObj(x)||x.projectId!==projectId||str(x.title,200)===null||typeof x.body!=="string"||x.body.length<1||x.body.length>32768)return null;
  if(typeof x.prevHash!=="string"||!SHA64_RE.test(x.prevHash))return null;
  if(x.supersedes!==undefined&&(typeof x.supersedes!=="string"||!MEM_ID_RE.test(x.supersedes)||x.supersedes===x.id))return null;
  if(!Array.isArray(x.tags)||x.tags.length>32||!x.tags.every(g=>str(g,64)!==null))return null;
  return {id:base.id,seq:base.seq,at:base.at,kind:base.kind,title:x.title,body:x.body,tags:x.tags.slice(),authorRole:base.authorRole,sources:base.sources,supersedes:x.supersedes??null};
}
/** GET .../memory yanıtı -> {state:"VERIFIED",list:{records(en yeni önce),total,health}} | {state:"ERROR",list:null}; kayıtlar seq'e göre kesin artan olmalı. */
export function mapMemoryList(raw,projectId){
  const bad={state:"ERROR",list:null};
  if(!isObj(raw)||typeof projectId!=="string"||!PROJECT_ID_RE.test(projectId)||!Array.isArray(raw.records)||raw.records.length>MAX_LIST||!isObj(raw.health)||!MEMORY_STATES.includes(raw.health.state)||!cnt(raw.health.records)||!cnt(raw.health.tornTailBytes))return bad;
  const out=[],ids=new Set();
  for(const x of raw.records){const r=record(x,projectId);if(r===null||ids.has(r.id)||(out.length&&r.seq<=out[out.length-1].seq))return bad;ids.add(r.id);out.push(r)}
  if(out.length>raw.health.records)return bad;
  return {state:"VERIFIED",list:{records:out.reverse(),total:out.length,health:{state:raw.health.state,records:raw.health.records,tornTailBytes:raw.health.tornTailBytes}}};
}
