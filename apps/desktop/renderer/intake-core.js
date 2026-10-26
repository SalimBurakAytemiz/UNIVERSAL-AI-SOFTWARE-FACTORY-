// //TR: Bu modül Proje Intake (UI-126) görünümünün saf (DOM'suz) çekirdeğidir: Kurucunun serbest metin fikrini POST /v1/intakes gövdesine (sunucu şemasıyla birebir: idea 10-4000, isteğe bağlı title/projectType/techStack/targetOS/acceptanceCriteria/riskLevel R0-R3) çevirir ve GET /v1/intakes yanıtlarını güvenli, sınırlı alanlara eşler. Alan kaynakları (FOUNDER/DEFAULT/DERIVED) sunucudan AYNEN taşınır; girilmeyen alan Kurucudan gelmiş gibi gösterilmez. Bozuk kayıt tüm okumayı ERROR yapar.
import {MAX_BODY_BYTES} from "./work-core.js";
export const INTAKE_ID_RE=/^itk_[0-9a-f]{24}$/;
export const INTAKES_PATH="/v1/intakes";
export const intakePath=id=>INTAKE_ID_RE.test(String(id))?`/v1/intakes/${id}`:null;
export const INTAKE_PROJECT_TYPES=Object.freeze(["web","api","library","cli","desktop","mobile","native","other"]);
export const INTAKE_OS=Object.freeze(["windows","macos","linux","web","android","ios"]);
export const INTAKE_RISKS=Object.freeze(["R0","R1","R2","R3"]);
export const INTAKE_SOURCES=Object.freeze(["FOUNDER","DEFAULT","DERIVED"]);
// //TR: Sunucu şeması (core/workos/intake.ts) template: web-node | node-lib | empty; template verilirse sunucu yönetilen bir git deposu kurar (repository ile birlikte verilemez; bu formda repository alanı yoktur).
export const INTAKE_TEMPLATES=Object.freeze(["web-node","node-lib","empty"]);
const IDEA_MIN=10,IDEA_MAX=4000,TITLE_MAX=120,TECH_RE=/^[A-Za-z0-9.+#/ _-]+$/,KEY_RE=/^[A-Za-z0-9._-]{1,100}$/;
const PROJECT_RE=/^prj_[0-9a-f]{24}$/,MISSION_RE=/^msn_[0-9a-f]{24}$/;
const trim=v=>typeof v==="string"?v.trim():"";
const bodyBytes=body=>{try{return new TextEncoder().encode(JSON.stringify(body)).length}catch{return Infinity}};
// Doğrulama geçişi (anahtarsız) sonraki anahtarlı gövde için en uzun geçerli anahtar payı bırakır: ilk geçiş ok ise anahtarlı gövde de köprü sınırına sığar.
const RESERVED_KEY="k".repeat(100);
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max)=>typeof x==="string"&&x.length&&x.length<=max?x:null;

/** Form girdisinden istek: yalnız girilen isteğe bağlı alanlar gövdeye girer (girilmeyen alanı sunucu varsayılanlar ve kaynağını DEFAULT/DERIVED işaretler). */
export function buildIntakeRequest(input,{key}={}){
  const errors={},idea=trim(input?.idea),title=trim(input?.title),type=trim(input?.projectType),risk=trim(input?.riskLevel),tpl=trim(input?.template);
  if(idea.length<IDEA_MIN)errors.idea="intake.err.ideaShort";else if(idea.length>IDEA_MAX)errors.idea="intake.err.ideaLong";
  if(title.length>TITLE_MAX)errors.title="intake.err.titleLong";
  if(type&&!INTAKE_PROJECT_TYPES.includes(type))errors.projectType="intake.err.type";
  const tech=(Array.isArray(input?.techStack)?input.techStack:[]).map(trim).filter(Boolean);
  if(tech.length>20||new Set(tech).size!==tech.length||tech.some(t=>t.length>50||!TECH_RE.test(t)))errors.techStack="intake.err.tech";
  const os=Array.isArray(input?.targetOS)?input.targetOS:[];
  if(os.length>6||new Set(os).size!==os.length||os.some(o=>!INTAKE_OS.includes(o)))errors.targetOS="intake.err.os";
  const crit=(Array.isArray(input?.acceptanceCriteria)?input.acceptanceCriteria:[]).map(trim).filter(Boolean);
  if(crit.length>50||crit.some(c=>c.length>4000))errors.acceptanceCriteria="intake.err.criteria";
  if(risk&&!INTAKE_RISKS.includes(risk))errors.riskLevel="intake.err.risk";
  if(tpl&&!INTAKE_TEMPLATES.includes(tpl))errors.template="intake.err.template";
  if(key!==undefined&&!KEY_RE.test(String(key)))errors.idempotencyKey="intake.err.key";
  const body={idea};
  if(title)body.title=title;
  if(type)body.projectType=type;
  if(tech.length)body.techStack=tech;
  if(os.length)body.targetOS=[...os];
  if(crit.length)body.acceptanceCriteria=crit;
  if(risk)body.riskLevel=risk;
  if(tpl)body.template=tpl;
  if(key!==undefined)body.idempotencyKey=String(key);
  // Köprü (POST_MAX_BODY_BYTES) ve sunucu (LANE_WRITE_BODY_LIMIT) 32 KB'ı aşan gövdeyi reddeder; sınır work-core.js MAX_BODY_BYTES ile aynıdır (testle köprü sabitine sabitlenmiştir).
  if(!Object.keys(errors).length&&bodyBytes(key===undefined?{...body,idempotencyKey:RESERVED_KEY}:body)>MAX_BODY_BYTES)errors.form="err.tooLarge";
  const ok=!Object.keys(errors).length;
  return {ok,path:INTAKES_PATH,body:ok?body:null,errors};
}
/** Tek intake kaydı; kimlik/enum/biçim bozuksa null (kısmi kayıt yok). */
export function mapIntake(x){
  if(!isObj(x)||!INTAKE_ID_RE.test(String(x.intakeId))||!PROJECT_RE.test(String(x.projectId))||!MISSION_RE.test(String(x.missionId)))return null;
  const idea=str(x.idea,IDEA_MAX),title=str(x.title,200);
  if(idea===null||title===null||!INTAKE_RISKS.includes(x.riskLevel)||!Array.isArray(x.acceptanceCriteria)||x.acceptanceCriteria.length>50||x.acceptanceCriteria.some(c=>str(c,4000)===null))return null;
  const s=x.sources;
  if(!isObj(s)||!["title","acceptanceCriteria","riskLevel"].every(k=>INTAKE_SOURCES.includes(s[k])))return null;
  // //TR: template yoksa null (eski sunucu / şablonsuz intake); VAR ama şemada değilse kayıt bozuktur (null), tanınmayan değer sessizce "şablonsuz" sayılmaz.
  if(x.template!==undefined&&!INTAKE_TEMPLATES.includes(x.template))return null;
  const at=typeof x.createdAt==="string"&&!Number.isNaN(new Date(x.createdAt).getTime())?x.createdAt:null;
  return {intakeId:x.intakeId,projectId:x.projectId,missionId:x.missionId,idea,title,riskLevel:x.riskLevel,acceptanceCriteria:[...x.acceptanceCriteria],
    projectType:INTAKE_PROJECT_TYPES.includes(x.projectType)?x.projectType:null,template:x.template??null,sources:{title:s.title,acceptanceCriteria:s.acceptanceCriteria,riskLevel:s.riskLevel},createdAt:at};
}
/** GET /v1/intakes -> {state:"VERIFIED",items} | {state:"ERROR",items:[]}. */
export function mapIntakes(raw){
  const list=isObj(raw)?raw.intakes:null;if(!Array.isArray(list))return {state:"ERROR",items:[]};
  const items=[];for(const x of list.slice(0,200)){const m=mapIntake(x);if(m===null)return {state:"ERROR",items:[]};items.push(m)}
  return {state:"VERIFIED",items:items.sort((a,b)=>String(b.createdAt??"").localeCompare(String(a.createdAt??"")))};
}
