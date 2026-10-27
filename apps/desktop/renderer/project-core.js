// //TR: Bu modül PS-1B Project Studio'nun saf (DOM'suz) çekirdeğidir: sihirbaz/içe aktarma/dev-run/dışa aktarma/yürütücü istek gövdesi kurucuları (argv dizisi, idempotency), main allow-list ile aynı kurallı GET yol kurucuları, dev-run/dosya/git/dışa aktarma/yürütücü eşleyicileri, renderer tarafı gizli bilgi sansürü (backend sansürüne ek savunma), boyut sınırları ve önizleme kapısı; eksik veri asla uydurulmaz, 404 dürüst UNAVAILABLE olarak kalır.
import {MISSING} from "./model.js";
import {describePostResult,normalizeArgv,validatePath,IDEMPOTENCY_KEY_RE,PROJECT_ID_RE,SAFE_ID_RE,MAX_BODY_BYTES,MAX_CRITERIA} from "./work-core.js";

export const TEMPLATES=Object.freeze(["web-node","node-lib","empty"]);
export const TARGET_OS=Object.freeze(["windows","macos","linux"]);
export const IMPORT_KINDS=Object.freeze(["git","zip"]);
export const DEVRUN_STATES=Object.freeze(["STOPPED","STARTING","RUNNING","CRASHED","BLOCKED"]);
export const DEVRUN_ACTIONS=Object.freeze(["start","stop","restart"]);
export const PREVIEW_STATES=Object.freeze(["AVAILABLE","UNAVAILABLE"]);
export const EXECUTOR_STATES=Object.freeze(["READY","NOT_CONFIGURED","PROVENANCE_MISSING","CLI_NOT_FOUND"]);
export const STUDIO_TABS=Object.freeze(["overview","run","files","changes","missions","delivery"]);
export const LOG_TAIL_MAX_CHARS=20000;
export const FILE_VIEW_MAX_CHARS=100000;
export const DIFF_VIEW_MAX_CHARS=200000;
export const DIFF_VIEW_MAX_LINES=4000;
export const GIT_LOG_LIMIT=30;
export const PREVIEW_URL_RE=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/$/;
export const GIT_REF_RE=/^(?:[0-9a-f]{7,64}|HEAD(?:~[0-9]{1,3})?)$/;
export const COMMIT_RE=/^[0-9a-f]{7,64}$/;
export const MAX_TECH_ITEMS=20;
export const MAX_TECH_LENGTH=60;
export const MAX_RUNS_LIMIT=1000;
export const MAX_TOKENS_MIN=1000;
export const MAX_TOKENS_MAX=1000000000;

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const iso=x=>typeof x==="string"&&!Number.isNaN(new Date(x).getTime())?x:null;
const pick=(...v)=>v.find(x=>x!==undefined&&x!==null);
const arr=(x,max=1000)=>Array.isArray(x)?x.slice(0,max):[];
const trim=v=>typeof v==="string"?v.trim():"";
const CONTROL_RE=/[\u0000-\u001f\u007f]/;
const bodyBytes=body=>{try{return new TextEncoder().encode(JSON.stringify(body)).length}catch{return Infinity}};
const result=(path,body,errors)=>Object.keys(errors).length?{ok:false,errors}:{ok:true,path,body};
const safeInt=x=>Number.isSafeInteger(x)?x:null;

// ---------- Gizli bilgi sansürü (backend sansürüne ek savunma; asla "temiz" iddiası değildir) ----------
const REDACTED="[REDACTED]";
const SECRET_PATTERNS=Object.freeze([
  new RegExp("-----BEGIN"+" [A-Z ]*PRIVATE KEY-----[\\s\\S]*?(?:-----END"+" [A-Z ]*PRIVATE KEY-----|$)","g"),
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+[A-Za-z0-9._~+\/=-]{16,}/gi
]);
const KEYED_SECRET_RE=/((?:api[_-]?key|secret|token|passwd|password|authorization|credential)[A-Za-z0-9_-]{0,20})(["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;]+)/gi;
export function redactText(value){
  let t=typeof value==="string"?value:"";
  for(const re of SECRET_PATTERNS)t=t.replace(re,REDACTED);
  return t.replace(KEYED_SECRET_RE,(_m,k,sep)=>`${k}${sep}${REDACTED}`);
}
/** Sansürler ve son max karakteri tutar (log kuyruğu). */
export function redactTail(value,max=LOG_TAIL_MAX_CHARS){const t=redactText(value);return t.length>max?t.slice(t.length-max):t}
/** Sansürler ve ilk max karakteri tutar; {text,truncated} döner (dosya/diff görüntüleyici). */
export function redactHead(value,max){const t=redactText(value),cut=t.length>max;return {text:cut?t.slice(0,max):t,truncated:cut}}

// ---------- Göreli yol (main allow-list ile aynı kurallar) ----------
/** Proje içi göreli yol: boş değil, "/" ile başlamaz/bitmez, ".." "." boş parça yok, ters eğik çizgi/":"/"%"/kontrol karakteri yok, ≤300 karakter. */
// //TR: PS-1B c2: eşleşmemiş vekil (surrogate) karakterler encodeURIComponent'i fırlattığı için geçersiz yol sayılır.
const LONE_SURROGATE_RE=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export function validRelPath(p){
  if(typeof p!=="string"||p.length<1||p.length>300||CONTROL_RE.test(p)||/[\\%:]/.test(p)||LONE_SURROGATE_RE.test(p)||p.startsWith("/")||p.endsWith("/"))return false;
  return p.split("/").every(s=>s.length>0&&s!=="."&&s!=="..");
}
export const joinRel=(dir,name)=>dir?`${dir}/${name}`:name;
export const parentRel=p=>{const i=typeof p==="string"?p.lastIndexOf("/"):-1;return i<0?"":p.slice(0,i)};

// ---------- GET yol kurucuları (geçersizse null; main allow-list ile birebir uyumlu) ----------
const pid=id=>typeof id==="string"&&PROJECT_ID_RE.test(id)?id:null;
export const devrunPath=id=>pid(id)?`/v1/projects/${id}/devrun`:null;
export const exportsPath=id=>pid(id)?`/v1/projects/${id}/exports`:null;
export const exportItemPath=(id,eid)=>pid(id)&&typeof eid==="string"&&SAFE_ID_RE.test(eid)?`/v1/projects/${id}/exports/${eid}`:null;
// //TR: PS-1B c2: tek kanonik kodlayıcı; encodeURIComponent'in bırakıp bıraktığı ! ' ( ) * karakterleri de %XX olur (main.mjs psEncodeRel ile birebir aynı).
export const encodeRelPath=rel=>encodeURIComponent(rel).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
export function filesPath(id,rel=""){
  if(!pid(id))return null;if(!rel)return `/v1/projects/${id}/files`;
  return validRelPath(rel)?`/v1/projects/${id}/files?path=${encodeRelPath(rel)}`:null;
}
export const filePath=(id,rel)=>pid(id)&&validRelPath(rel)?`/v1/projects/${id}/file?path=${encodeRelPath(rel)}`:null;
export function gitLogPath(id,limit=GIT_LOG_LIMIT){
  if(!pid(id))return null;if(!Number.isSafeInteger(limit)||limit<1||limit>500)return null;return `/v1/projects/${id}/git/log?limit=${limit}`;
}
export function gitDiffPath(id,from,to){
  if(!pid(id))return null;const q=[];
  if(from){if(!GIT_REF_RE.test(from))return null;q.push(`from=${from}`)}
  if(to){if(!GIT_REF_RE.test(to))return null;q.push(`to=${to}`)}
  return `/v1/projects/${id}/git/diff${q.length?`?${q.join("&")}`:""}`;
}
export const EXECUTORS_PATH="/v1/system/executors";
export const ENABLE_LOCAL_CLAUDE_PATH="/v1/system/executors/local-claude/enable";

// ---------- İstek kurucuları ----------
const GENERIC_ARGV_ERRORS=Object.freeze({"err.argvInvalid":"studio.err.argvInvalid","err.argvControl":"studio.err.argvControl","err.argvLong":"studio.err.argvLong","err.argvMany":"studio.err.argvMany","err.argvShellString":"studio.err.argvShellString"});
const argvOrError=(tokens,errors,field)=>{
  const a=normalizeArgv(tokens);
  if(!a.ok){errors[field]=GENERIC_ARGV_ERRORS[a.error]??a.error;return []}
  return a.argv;
};
const parseIntStrict=(v,lo,hi)=>{
  const s=trim(String(v??""));if(!s)return {empty:true};
  if(!/^[0-9]{1,12}$/.test(s))return {error:true};
  const n=Number(s);return Number.isSafeInteger(n)&&n>=lo&&n<=hi?{value:n}:{error:true};
};
/** Yeni proje sihirbazı: POST /v1/projects gövdesi (şablon dahil boş proje; argv dizileri; bütçe isteğe bağlı). */
export function buildWizardRequest(input,{key}={}){
  const errors={},name=trim(input?.name),template=trim(input?.template),type=trim(input?.projectType);
  if(!name)errors.name="err.nameRequired";else if(name.length>200)errors.name="err.nameLong";
  if(!TEMPLATES.includes(template))errors.template="studio.err.template";
  if(type.length>MAX_TECH_LENGTH||CONTROL_RE.test(type))errors.projectType="studio.err.typeLong";
  const tech=arr(input?.techStack,100).map(trim).filter(Boolean);
  if(tech.length>MAX_TECH_ITEMS||tech.some(t=>t.length>MAX_TECH_LENGTH||CONTROL_RE.test(t)))errors.techStack="studio.err.techInvalid";
  const os=arr(input?.targetOS,10).filter(x=>typeof x==="string");
  if(os.some(x=>!TARGET_OS.includes(x))||new Set(os).size!==os.length)errors.targetOS="studio.err.osInvalid";
  const crit=arr(input?.acceptanceCriteria,200).map(trim).filter(Boolean);
  if(crit.length>MAX_CRITERIA)errors.acceptanceCriteria="err.criteriaMany";else if(crit.some(c=>c.length>4000))errors.acceptanceCriteria="err.criteriaLong";
  const runs=parseIntStrict(input?.maxRuns,1,MAX_RUNS_LIMIT),tokens=parseIntStrict(input?.maxTokens,MAX_TOKENS_MIN,MAX_TOKENS_MAX);
  if(runs.error)errors.budgetMaxRuns="studio.err.budgetRuns";
  if(tokens.error)errors.budgetMaxTokens="studio.err.budgetTokens";
  const dev=argvOrError(input?.devCommand,errors,"devCommand"),test=argvOrError(input?.testCommand,errors,"testCommand");
  if(key!==undefined&&!IDEMPOTENCY_KEY_RE.test(String(key)))errors.idempotencyKey="err.idempotencyKey";
  const body={name,template};
  if(type)body.projectType=type;
  if(tech.length)body.techStack=tech;
  if(os.length)body.targetOS=os;
  if(crit.length)body.acceptanceCriteria=crit;
  const budget={};if(runs.value!==undefined)budget.maxRuns=runs.value;if(tokens.value!==undefined)budget.maxTokens=tokens.value;
  if(Object.keys(budget).length)body.budget=budget;
  if(dev.length)body.devCommand=dev;
  if(test.length)body.testCommand=test;
  if(key!==undefined)body.idempotencyKey=String(key);
  if(!Object.keys(errors).length&&bodyBytes(body)>MAX_BODY_BYTES)errors.form="err.tooLarge";
  return result("/v1/projects",body,errors);
}
/** İçe aktarma yanıtı sınıflaması: sunucunun sabit ret/hata kodlarını belirli anahtarlara eşler; diğer her yanıt describePostResult'a devredilir. */
const IMPORT_CODE_RE=/^[A-Z][A-Z0-9_]{1,63}$/;
const IMPORT_REJECT_KEYS=Object.freeze({
  IMPORT_PATH_INVALID:"studio.import.err.pathInvalid",IMPORT_REMOTE_NOT_SUPPORTED:"studio.import.err.remote",IMPORT_PATH_NOT_ABSOLUTE:"studio.import.err.notAbsolute",
  IMPORT_SOURCE_FORBIDDEN:"studio.import.err.forbidden",IMPORT_SOURCE_NOT_FOUND:"studio.import.err.notFound",IMPORT_SOURCE_NOT_A_REPOSITORY:"studio.import.err.notRepo",
  ZIP_INVALID:"studio.import.err.zipInvalid",ZIP_CRC_MISMATCH:"studio.import.err.zipInvalid",ZIP_UNSUPPORTED_FEATURE:"studio.import.err.zipInvalid",
  ZIP_PATH_TRAVERSAL:"studio.import.err.zipPath",ZIP_INVALID_NAME:"studio.import.err.zipPath",ZIP_FORBIDDEN_PATH:"studio.import.err.zipPath",ZIP_SYMLINK_REJECTED:"studio.import.err.zipPath",ZIP_SPECIAL_FILE_REJECTED:"studio.import.err.zipPath",
  ZIP_TOO_LARGE:"studio.import.err.zipLimit",ZIP_TOO_MANY_FILES:"studio.import.err.zipLimit",ZIP_DUPLICATE_ENTRY:"studio.import.err.zipContent",ZIP_EMPTY:"studio.import.err.zipContent"});
const IMPORT_FAILED_KEYS=Object.freeze({GIT_CLONE_FAILED:"studio.import.err.cloneFailed",IMPORT_SOURCE_EMPTY:"studio.import.err.sourceEmpty",AGENT_CONFIG_QUARANTINE_FAILED:"studio.import.err.quarantine"});
export function describeImportResult(res){
  const s=res?.status,b=res&&!res.thrown&&res.body&&typeof res.body==="object"?res.body:null,err=typeof b?.error==="string"?b.error:"",r=b?.reason,code=typeof r==="string"&&IMPORT_CODE_RE.test(r)?r:null;
  if(s===400&&err==="IMPORT_REJECTED"){
    if(code&&Object.hasOwn(IMPORT_REJECT_KEYS,code))return {ok:false,key:IMPORT_REJECT_KEYS[code],vars:{status:s,code}};
    return code?{ok:false,key:"studio.import.err.rejectedCode",vars:{status:s,code}}:{ok:false,key:"studio.import.err.rejected",vars:{status:s}};
  }
  if(s===422&&err==="IMPORT_FAILED"){
    if(code&&Object.hasOwn(IMPORT_FAILED_KEYS,code))return {ok:false,key:IMPORT_FAILED_KEYS[code],vars:{status:s,code}};
    return code?{ok:false,key:"studio.import.err.failedCode",vars:{status:s,code}}:{ok:false,key:"studio.import.err.failed",vars:{status:s}};
  }
  if(s===409){
    if(err==="PROJECT_REPOSITORY_ALREADY_MANAGED")return {ok:false,key:"studio.import.err.alreadyManaged",vars:{status:s}};
    if(err==="DEVRUN_ACTIVE")return {ok:false,key:"studio.import.err.devrunActive",vars:{status:s}};
    if(err==="WORKOS_CONFLICT"&&r==="RUN_ALREADY_ACTIVE")return {ok:false,key:"studio.import.err.runActive",vars:{status:s}};
  }
  return describePostResult(res);
}
/** İçe aktarma: yol yalnız ana süreçteki dosya diyaloğundan gelir; renderer burada yalnız biçimi doğrular. */
export function buildImportRequest({projectId,kind,path}){
  const errors={};
  if(!pid(projectId))errors.projectId="err.projectRequired";
  if(!IMPORT_KINDS.includes(kind))errors.importKind="studio.err.importKind";
  const p=typeof path==="string"?path.trim():"";
  const pe=validatePath(p);if(pe)errors.importPath=pe;else if(kind==="zip"&&!/\.zip$/i.test(p))errors.importPath="studio.err.zipExt";
  return result(`/v1/projects/${projectId}/import`,{kind,path:p},errors);
}
// //TR: İçe aktarma yanıtındaki ajan yapılandırma KARANTİNASI kanıtı (SBX-8, server.ts import rotası): gövde {project, import:{kind, headSha, agentConfigQuarantine?}}; alan YALNIZ karantinaya alınan dosya varsa gönderilir {count, headSha, files:[{path,pattern,kind,bytes,sha256}] (en çok 500), truncated, storedUnder}. QUARANTINED: alan geçerli. NONE: geçerli bir import bloğu var ve alan YOK (sunucu sözleşmesi: karantina yoksa alan gönderilmez; "tarama yapıldı" iddiası YOKTUR, yalnız "sunucu karantina bildirmedi"). UNKNOWN: import bloğu okunamıyor ya da alan bozuk (kısmi veri asla dönmez, düz başarı gibi gösterilmez).
export const QUARANTINE_MAX_FILES=500;
export const QUARANTINE_FILES_SHOWN=20;
const SHA40_RE=/^[0-9a-f]{40}([0-9a-f]{24})?$/,SHA256_RE=/^[0-9a-f]{64}$/;
const QUARANTINE_KINDS=Object.freeze(["file","symlink","other"]);
// //TR: Görüntülenen bir yol/desen/saklama yeri, depo yazarının kontrol edebildiği metindir. Kontrol (Cc: C0, DEL, C1), biçim (Cf: bidi, sıfır genişlik, etiketler, FEFF, 00AD), vekil (Cs), satır/paragraf ayırıcı (Zl/Zp) ve Default_Ignorable karakterler (034F, FE0F, 3164 ...) GÖRÜNMEZ ya da satırı bozar; ".claude/settings\u2060.json" gerçeğinden ayırt edilemezdi. Ayrıca bir tabanda 8'den fazla yığılmış birleştirici işaret de gösterilmez.
const HIDDEN_CHARS_RE=/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u,STACKED_MARKS_RE=/\p{M}{9,}/u;
const cleanText=(x,max)=>typeof x==="string"&&x.length>0&&x.length<=max&&!HIDDEN_CHARS_RE.test(x)&&!STACKED_MARKS_RE.test(x);
export function mapImportQuarantine(res){
  const unknown={state:"UNKNOWN"};
  const b=res&&!res.thrown&&isObj(res.body)?res.body:null,imp=b&&isObj(b.import)?b.import:null;
  if(imp===null||!IMPORT_KINDS.includes(imp.kind)||typeof imp.headSha!=="string"||!SHA40_RE.test(imp.headSha))return unknown;
  const q=imp.agentConfigQuarantine;
  if(q===undefined)return {state:"NONE",headSha:imp.headSha};
  if(!isObj(q)||!Number.isSafeInteger(q.count)||q.count<1||q.count>1000000||q.headSha!==imp.headSha||typeof q.truncated!=="boolean"||!cleanText(q.storedUnder,200)||!Array.isArray(q.files))return unknown;
  if(q.files.length>QUARANTINE_MAX_FILES||q.files.length!==Math.min(q.count,QUARANTINE_MAX_FILES)||q.truncated!==(q.count>q.files.length))return unknown;
  const files=[];let undisplayable=0;
  for(const f of q.files){
    if(!isObj(f)||typeof f.path!=="string"||f.path.length===0||!cleanText(f.pattern,120)||!QUARANTINE_KINDS.includes(f.kind)||!Number.isSafeInteger(f.bytes)||f.bytes<0||typeof f.sha256!=="string"||!SHA256_RE.test(f.sha256))return unknown;
    // //TR: Depo içeriği yola karar verir (git TAB/satır sonu ve çok uzun yola izin verir): geçerli sayı/commit kanıtı olan bir karantinayı tek böyle girdi için BİLİNMİYOR'a düşürmek yanlış nedeni söyler; girdi sayılır, listelenmez (undisplayable) ve asla NONE olmaz.
    if(!cleanText(f.path,1024)){undisplayable++;continue}
    files.push({path:f.path,pattern:f.pattern,kind:f.kind,bytes:f.bytes,sha256:f.sha256});
  }
  return {state:"QUARANTINED",headSha:imp.headSha,count:q.count,files,truncated:q.truncated,storedUnder:q.storedUnder,recorded:q.files.length,undisplayable};
}
export function buildDevRunRequest({projectId,action}){
  const errors={};
  if(!pid(projectId))errors.projectId="err.projectRequired";
  if(!DEVRUN_ACTIONS.includes(action))errors.action="studio.err.action";
  return result(`/v1/projects/${projectId}/devrun/${action}`,{},errors);
}
export function buildExportRequest({projectId,commit}){
  const errors={},c=trim(commit);
  if(!pid(projectId))errors.projectId="err.projectRequired";
  if(c&&!COMMIT_RE.test(c))errors.commit="studio.err.commit";
  const body={};if(c)body.commit=c;
  return result(`/v1/projects/${projectId}/export`,body,errors);
}
export const buildEnableExecutorRequest=()=>({ok:true,path:ENABLE_LOCAL_CLAUDE_PATH,body:{}});

// ---------- Dev-run ----------
/** Durumdan izinli eylemler; STOP her durumda görünür kalır (yalnız çalışmıyorsa devre dışı), başlatma yalnız STOPPED/CRASHED durumunda. */
export function devRunActions(status){
  const live=status==="STARTING"||status==="RUNNING";
  // //TR: LANE-A A-FLOW-4: BLOCKED (ör. sandbox yokken reddedilen başlatma) yeniden denenebilir: sunucu BLOCKED durumundan start kabul eder ve kapıyı her seferinde yeniden sorar; aksi halde sandbox sonradan hazır olsa bile başlatma sonsuza dek kapalı kalırdı.
  return {start:status==="STOPPED"||status==="CRASHED"||status==="BLOCKED",stop:live,restart:live||status==="CRASHED"};
}
// ---------- Teslim edilen ürünün çalıştırılması (B-RUN-1: GET /v1/work-runs/:id/product, POST .../product/start|stop) ----------
const WORK_RUN_ID_RE=/^run_[0-9a-f]{24}$/;
export const runProductPath=id=>typeof id==="string"&&WORK_RUN_ID_RE.test(id)?`/v1/work-runs/${id}/product`:null;
export function buildProductRequest({runId,action}){
  const errors={};
  if(typeof runId!=="string"||!WORK_RUN_ID_RE.test(runId))errors.runId="err.runInvalid";
  if(action!=="start"&&action!=="stop")errors.action="studio.err.action";
  return result(`/v1/work-runs/${runId}/product/${action}`,{},errors);
}
/** //TR: LANE-A A-FLOW-4 (B-RUN-1): ürün durumu SADECE koşuya bağlı rotadan okunur. Yanıt bu koşunun kimliğini taşımalı; teslim edilen commit yoksa null ya da 40 hex; tiedToThisRun yalnız deliveryRunId bu koşuysa doğru olabilir (çelişki = tüm okuma ERROR). */
export function mapRunProduct(raw,runId){
  const bad={state:"ERROR",product:null};
  const x=isObj(raw)?raw.product:null;
  if(!isObj(x)||x.runId!==runId||!WORK_RUN_ID_RE.test(String(runId)))return bad;
  const head=x.deliveredHeadSha;
  if(!(head===null||(typeof head==="string"&&COMMIT_RE.test(head)&&head.length===40)))return bad;
  if(typeof x.tiedToThisRun!=="boolean")return bad;
  const d=mapDevRun(isObj(x.devrun)?{devrun:x.devrun}:null);
  if(d.state!=="VERIFIED")return bad;
  if(x.tiedToThisRun!==(d.run.deliveryRunId===runId))return bad;
  // //TR: sunucu ürün kaydına `deliverable` ({ok:boolean, reason?:kod}) eklerse o okunur; biçim bozuksa tüm okuma ERROR (yarım güvenle başlatma sunulmaz). Yoksa null.
  let deliverable=null;
  if(Object.hasOwn(x,"deliverable")){
    const dv=x.deliverable;
    if(!isObj(dv)||typeof dv.ok!=="boolean"||!(dv.reason===undefined||dv.reason===null||(typeof dv.reason==="string"&&/^[A-Z][A-Z0-9_:]{0,79}$/.test(dv.reason))))return bad;
    deliverable={ok:dv.ok,reason:typeof dv.reason==="string"?dv.reason:null};
  }
  return {state:"VERIFIED",product:{runId,deliveredHeadSha:head,tiedToThisRun:x.tiedToThisRun,deliverable,run:d.run}};
}
/** //TR: "Ürünü başlat" YALNIZ bu teslim ürünü çalıştırılabilirse sunulur. Koşul B-RUN-1 route'unun KENDİ koşuludur (routes/product-run.ts `deliverable`): kaynak üretimi SOURCE_GENERATION_COMPLETE ve 40 hex teslim commit'i. DELIVERY aşamasının DONE olması BEKLENMEZ: DONE yalnızca PRODUCT_VERIFIED demektir (flow.ts, outcomes.ts), oysa kabul edilmiş NOT_VERIFIED bir kaynak teslimi de çalıştırılabilir. Kaynak: ürün kaydındaki `deliverable` alanı varsa o ({ok:boolean}); yoksa sunucunun koşu teslim görünümü (delivery.sourceGeneration.state) + ürün kaydının deliveredHeadSha'sı. İkisi de okunamıyorsa başlatma sunulmaz (UNKNOWN). "Durdur" YALNIZ bu teslimin kendi çalışan ürünü için (başka teslimin ürününü bu düğme kapatmaz); yerel adres YALNIZ bu teslime bağlı, RUNNING, bridged=true ve önizleme AVAILABLE iken. Çalışıyor olmak ürünün doğrulandığı anlamına gelmez. */
export function productOffer(product,delivery){
  const run=product.run,a=devRunActions(run.status),hasCommit=product.deliveredHeadSha!==null;
  let deliverable=null; // true | false | null (bilinmiyor)
  if(product.deliverable!==null&&product.deliverable!==undefined)deliverable=product.deliverable.ok===true&&hasCommit;
  else if(delivery&&delivery.sourceGeneration&&typeof delivery.sourceGeneration.state==="string")deliverable=delivery.sourceGeneration.state==="SOURCE_GENERATION_COMPLETE"&&hasCommit;
  const otherRunning=!product.tiedToThisRun&&(run.status==="STARTING"||run.status==="RUNNING");
  return {deliverable,hasCommit,otherRunning,
    start:deliverable===true&&!otherRunning&&a.start,
    stop:product.tiedToThisRun&&a.stop,
    open:product.tiedToThisRun&&run.status==="RUNNING"&&run.bridged===true&&previewOpenable(run)};
}
export function mapDevRun(raw){
  const r=isObj(raw)?(isObj(raw.devrun)?raw.devrun:raw):null;
  if(!r||!DEVRUN_STATES.includes(r.status))return {state:"ERROR",run:null};
  const pv=isObj(r.preview)?r.preview:{},url=typeof pv.url==="string"&&PREVIEW_URL_RE.test(pv.url)?pv.url:null,port=safeInt(r.port);
  // //TR: LANE-A A-FLOW-4: BLOCKED/CRASHED nedeni (ör. SANDBOX_UNAVAILABLE) sunucunun kodu olarak taşınır; desen dışıysa null (uydurulmaz).
  const reason=typeof r.reason==="string"&&r.reason.length<=160&&/^[A-Z][A-Z0-9_]{0,63}(?::[A-Za-z0-9_.:-]{1,80})?$/.test(r.reason)?r.reason:null;
  return {state:"VERIFIED",run:{
    status:r.status,reason,deliveryRunId:typeof r.deliveryRunId==="string"&&/^run_[0-9a-f]{24}$/.test(r.deliveryRunId)?r.deliveryRunId:null,bridged:typeof r.bridged==="boolean"?r.bridged:null,pid:safeInt(r.pid),startedAt:iso(r.startedAt),exitCode:safeInt(r.exitCode),port:port!==null&&port>=1&&port<=65535?port:null,
    preview:{url,state:PREVIEW_STATES.includes(pv.state)?pv.state:"UNAVAILABLE",lastProbeAt:iso(pv.lastProbeAt)},
    logTail:redactTail(typeof r.logTail==="string"?r.logTail:Array.isArray(r.logTail)?r.logTail.filter(x=>typeof x==="string").join("\n"):"")
  }};
}
/** Önizleme düğmesi yalnız dev-run RUNNING, önizleme AVAILABLE ve URL kesin http://127.0.0.1:<port>/ biçimindeyse (ve varsa port uyuşuyorsa) etkin olur; aksi halde asla açılmaz. */
export function previewOpenable(run){
  if(!run||run.status!=="RUNNING"||!run.preview||run.preview.state!=="AVAILABLE"||typeof run.preview.url!=="string")return false;
  const m=PREVIEW_URL_RE.exec(run.preview.url);if(!m)return false;
  const p=Number(m[1]);if(p<1024||p>65535)return false;
  return run.port===null||run.port===undefined||run.port===p;
}

// ---------- Dosyalar ----------
export function mapFileList(raw){
  if(!isObj(raw))return {state:"ERROR",entries:[],truncated:false};
  const list=pick(raw.entries,raw.files,raw.items,raw.children);if(!Array.isArray(list))return {state:"ERROR",entries:[],truncated:false};
  const entries=list.slice(0,1000).filter(isObj).map(x=>{
    const name=str(x.name,255);if(!name||/[\/\\]/.test(name)||CONTROL_RE.test(name)||name==="."||name==="..")return null;
    const t=String(pick(x.type,x.kind)??"").toLowerCase();
    return {name,dir:x.isDirectory===true||t==="dir"||t==="directory"||t==="tree",size:safeInt(x.size)};
  }).filter(Boolean).sort((a,b)=>(a.dir===b.dir?a.name.localeCompare(b.name):a.dir?-1:1));
  return {state:"VERIFIED",entries,truncated:raw.truncated===true||list.length>1000};
}
export function mapFileContent(raw){
  if(!isObj(raw))return {state:"ERROR",file:null};
  const f=isObj(raw.file)?raw.file:raw,text=pick(f.content,f.text);
  if(f.binary===true)return {state:"VERIFIED",file:{binary:true,text:"",size:safeInt(f.size),truncated:false}};
  if(typeof text!=="string")return {state:"ERROR",file:null};
  const cut=redactHead(text,FILE_VIEW_MAX_CHARS);
  return {state:"VERIFIED",file:{binary:false,text:cut.text,size:safeInt(f.size),truncated:cut.truncated||f.truncated===true}};
}

// ---------- Git ----------
export function mapGitLog(raw){
  if(!isObj(raw))return {state:"ERROR",commits:[]};
  const list=pick(raw.commits,raw.log,raw.items);if(!Array.isArray(list))return {state:"ERROR",commits:[]};
  const commits=list.slice(0,500).filter(isObj).map(x=>{
    const hash=String(pick(x.hash,x.sha,x.id)??"").toLowerCase();if(!COMMIT_RE.test(hash))return null;
    const author=isObj(x.author)?str(x.author.name,120):str(x.author,120),subject=str(pick(x.subject,typeof x.message==="string"?x.message.split(/\r?\n/)[0]:undefined),300);
    return {hash,short:hash.slice(0,7),subject:subject?redactText(subject):MISSING,author,date:iso(pick(x.date,x.authoredAt,x.committedAt))};
  }).filter(Boolean);
  return {state:"VERIFIED",commits};
}
export function mapGitDiff(raw){
  if(!isObj(raw))return {state:"ERROR",diff:null};
  const text=pick(raw.diff,raw.patch,raw.text);if(typeof text!=="string")return {state:"ERROR",diff:null};
  const cut=redactHead(text,DIFF_VIEW_MAX_CHARS),all=cut.text.split(/\r?\n/),lines=all.slice(0,DIFF_VIEW_MAX_LINES);
  const files=arr(raw.files,200).filter(isObj).map(f=>({path:str(f.path,300),additions:safeInt(f.additions),deletions:safeInt(f.deletions)})).filter(f=>f.path);
  return {state:"VERIFIED",diff:{lines,files,truncated:cut.truncated||all.length>DIFF_VIEW_MAX_LINES||raw.truncated===true,empty:text.trim().length===0}};
}
/** Diff satırı türü: yalnız görsel sınıf; anlam ayrıca "+"/"-" önekiyle okunur (renk tek başına taşıyıcı değildir). */
export function diffLineKind(line){
  const s=String(line??"");
  if(s.startsWith("@@"))return "hunk";
  if(s.startsWith("+++ ")||s.startsWith("--- ")||s.startsWith("diff --git")||s.startsWith("index "))return "meta";
  if(s.startsWith("+"))return "add";
  if(s.startsWith("-"))return "del";
  return "ctx";
}

// ---------- Dışa aktarma ----------
export function mapExports(raw){
  if(!isObj(raw))return {state:"ERROR",items:[]};
  const list=pick(raw.exports,raw.items);if(!Array.isArray(list))return {state:"ERROR",items:[]};
  const items=list.slice(0,200).filter(isObj).map(x=>{
    const id=pick(x.exportId,x.id);if(typeof id!=="string"||!SAFE_ID_RE.test(id))return null;
    const commit=String(x.commit??"").toLowerCase();
    // M1a: export kaydının kanıttan türetilmiş doğrulama özeti (VERIFICATION_STATUS.json); yoksa null (rozet yine NOT_VERIFIED gösterir).
    const v=isObj(x.verification)?x.verification:null;
    const verification=v?{label:str(v.label,160),testsExecuted:v.testsExecuted===true,notExecutedReason:/^[A-Z][A-Z0-9_]{0,39}$/.test(String(v.notExecutedReason??""))?v.notExecutedReason:null}:null;
    return {exportId:id,createdAt:iso(x.createdAt),commit:COMMIT_RE.test(commit)?commit:null,sizeBytes:safeInt(pick(x.sizeBytes,x.size)),status:/^[A-Z][A-Z0-9_]{0,39}$/.test(String(x.status??""))?x.status:null,format:str(pick(x.format,x.kind),20),verification};
  }).filter(Boolean).sort((a,b)=>String(b.createdAt??"").localeCompare(String(a.createdAt??"")));
  return {state:"VERIFIED",items};
}
export function formatBytes(n){
  if(!Number.isSafeInteger(n)||n<0)return MISSING;
  if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`;return `${(n/1073741824).toFixed(2)} GB`;
}

// ---------- Yürütücüler ----------
/** GET /v1/system/executors -> [{id,state,label?}]; bilinmeyen durum ham (büyük harf, güvenli desenli) gösterilir, aksi halde null (uydurulmaz). */
export function mapExecutors(raw){
  if(!isObj(raw))return {state:"ERROR",items:[]};
  let list=pick(raw.executors,raw.items);
  if(isObj(list))list=Object.entries(list).map(([id,v])=>isObj(v)?{id,...v}:{id,state:v});
  if(!Array.isArray(list))return {state:"ERROR",items:[]};
  const items=list.slice(0,20).filter(isObj).map(x=>{
    const id=String(pick(x.id,x.executor,x.kind,x.name)??"").toUpperCase().replace(/-/g,"_");if(!/^[A-Z][A-Z0-9_]{0,39}$/.test(id))return null;
    const s=pick(x.state,x.status),state=typeof s==="string"&&/^[A-Z][A-Z0-9_]{0,39}$/.test(s)?s:null;
    return {id,state,testOnly:id==="FAKE"||x.testOnly===true,cli:id==="LOCAL_CLAUDE"?mapCliStatus(x.cli):null,readiness:id==="LOCAL_CLAUDE"?mapRoleReadiness(x.readiness):null};
  }).filter(Boolean);
  // //TR: LANE-A A-FLOW-3: `active.reason` sunucunun şu an KULLANDIĞI yürütücüdür (LOCAL_CLAUDE ya da EXECUTOR_NOT_CONFIGURED/EXECUTOR_UNKNOWN/...); desen dışı ya da yoksa null (uydurulmaz).
  const ar=isObj(raw.active)&&typeof raw.active.reason==="string"&&/^[A-Z][A-Z0-9_]{0,63}$/.test(raw.active.reason)?raw.active.reason:null;
  return {state:"VERIFIED",items,profiles:mapClaudeProfiles(raw.claudeProfiles),sandbox:mapSandbox(raw.sandbox),active:ar,readiness:(items.find(i=>i.id==="LOCAL_CLAUDE")??{}).readiness??null};
}
const BLOCKER_RE=/^[A-Z][A-Z0-9_]{0,63}(?::[A-Z][A-Z0-9_]{0,63})?$/;
/** //TR: C-IMPL-WIN-1: LOCAL_CLAUDE.cli.state (FOUND | NOT_FOUND | SHIM_UNSUPPORTED); yol ve sunucunun serbest metni (founderAction) bilerek TAŞINMAZ. Bilinmeyen biçim null. */
export function mapCliStatus(raw){
  return isObj(raw)&&["FOUND","NOT_FOUND","SHIM_UNSUPPORTED"].includes(raw.state)?{state:raw.state}:null;
}
/** //TR: C-IMPL-WIN-1: LOCAL_CLAUDE.readiness.{implementer,reviewer} -> {ready,blockers[],profile,loginCommand}; `ready` YALNIZ blockers boşken doğru olabilir (çelişki = o rol null/bilinmiyor); engelleyici kodlar sabit desenli, serbest metin (founderAction/loginHint) taşınmaz. */
export function mapRoleReadiness(raw){
  if(!isObj(raw))return null;
  const out={};
  for(const role of CLAUDE_PROFILE_ROLES){
    const p=raw[role];
    if(!isObj(p)||typeof p.ready!=="boolean"||!Array.isArray(p.blockers)||p.blockers.length>8||!p.blockers.every(b=>typeof b==="string"&&BLOCKER_RE.test(b))||p.ready!==(p.blockers.length===0)){out[role]=null;continue}
    const profile=typeof p.profile==="string"&&/^[A-Z][A-Z_]{0,39}$/.test(p.profile)?p.profile:null,cmd=p.loginCommand;
    out[role]={ready:p.ready,blockers:[...p.blockers],profile,loginCommand:typeof cmd==="string"&&cmd.length<=2000&&!CONTROL_RE.test(cmd)&&cmd.startsWith("$env:CLAUDE_CONFIG_DIR='")?redactText(cmd):null};
  }
  return out;
}
/** //TR: LANE-A A-FLOW-3: koşu adımı için motor gerçeği. READY yalnız etkin yürütücü LOCAL_CLAUDE ve implementer+reviewer profilleri READY iken; etkin yürütücü başka ya da bir profil READY değilse BLOCKED (LOGIN_REQUIRED asla "çalışıyor" görünmez); okuma yok ya da eksikse UNKNOWN. Sandbox koşuyu engellemez, yalnız testlerin çalışıp çalışmayacağını söyler. Bu bir koşunun sürdüğünü ya da ürünün doğrulandığını ASLA söylemez. */
export function engineVerdict(exec){
  const none={kind:"UNKNOWN",active:null,implementer:null,reviewer:null,sandbox:null};
  if(!isObj(exec)||exec.state!=="VERIFIED")return none;
  const profs=Array.isArray(exec.profiles)?exec.profiles:[],prof=role=>profs.find(p=>p&&p.role===role)??null;
  // //TR: C-IMPL-WIN-1: rol hazırlığı (CLI + başlatıcı kanıtı + oturum) varsa profil durumuna EK olarak değerlendirilir: ready=false her zaman BLOCKED'tır; hazırlık nesnesi VARKEN bir rolün okuması geçersizse o rol READY sayılmaz (bilinmiyor); profil READY olsa bile (örn. CLI yok) rol hazır sayılmaz.
  const rd=isObj(exec.readiness)?exec.readiness:null,role=r=>{
    const p=prof(r),x=rd&&isObj(rd[r])?rd[r]:null;
    if(p===null&&x===null)return null;
    return {role:r,state:p?p.state:(x?x.profile:null),reason:p?p.reason:null,loginCommand:(p&&p.loginCommand)||(x&&x.loginCommand)||null,ready:x?x.ready:null,blockers:x?x.blockers:null};
  };
  const implementer=role("implementer"),reviewer=role("reviewer"),active=typeof exec.active==="string"?exec.active:null,sandbox=isObj(exec.sandbox)?exec.sandbox:null;
  const bad=p=>p!==null&&((p.state!==null&&p.state!=="READY")||p.ready===false),good=p=>p!==null&&p.state==="READY"&&p.ready!==false&&(rd===null||p.ready===true);
  const blocked=(active!==null&&active!=="LOCAL_CLAUDE")||bad(implementer)||bad(reviewer);
  const ready=active==="LOCAL_CLAUDE"&&good(implementer)&&good(reviewer);
  return {kind:blocked?"BLOCKED":ready?"READY":"UNKNOWN",active,implementer,reviewer,sandbox};
}
/** M1a: GET /v1/system/executors sandbox -> {state,reason,detail,providerId}; bilinmeyen biçim null (Ayarlar "bilinmiyor" der, AVAILABLE uydurulmaz). */
export function mapSandbox(raw){
  if(!isObj(raw))return null;
  const st=raw.state==="AVAILABLE"||raw.state==="UNAVAILABLE"?raw.state:null;if(!st)return null;
  const code=v=>typeof v==="string"&&/^[A-Z][A-Z0-9_]{0,63}$/.test(v)?v:null;
  return {state:st,reason:code(raw.reason),detail:code(raw.detail),providerId:typeof raw.providerId==="string"&&/^[A-Za-z0-9_.:-]{1,64}$/.test(raw.providerId)&&redactText(raw.providerId)===raw.providerId?raw.providerId:null};
}
/** SBX-8 (D-SBX-11 b): GET /v1/system/executors claudeProfiles -> [{role,state,reason,loginCommand}]; yalnız implementer/reviewer, güvenli desenli durum/neden; giriş komutu yalnız metin olarak gösterilir (renderer asla çalıştırmaz). */
export const CLAUDE_PROFILE_ROLES=["implementer","reviewer"];
export function mapClaudeProfiles(raw){
  if(!isObj(raw))return [];
  return CLAUDE_PROFILE_ROLES.map(role=>{
    const p=raw[role];if(!isObj(p))return null;
    const state=typeof p.state==="string"&&/^[A-Z][A-Z_]{0,39}$/.test(p.state)?p.state:null;
    const reason=typeof p.reason==="string"&&/^[A-Z][A-Z0-9_:]{0,119}$/.test(p.reason)?p.reason:null;
    const cmd=p.loginCommand;
    // //TR: komut bilinçli olarak METİN gösterilir; yalnız anahtar/belirteç desenleri maskelenir.
    const loginCommand=typeof cmd==="string"&&cmd.length<=2000&&!CONTROL_RE.test(cmd)&&cmd.startsWith("$env:CLAUDE_CONFIG_DIR='")?redactText(cmd):null;
    return {role,state,reason,loginCommand};
  }).filter(Boolean);
}
/** "Etkinleştir" yalnız LOCAL_CLAUDE ve NOT_CONFIGURED iken sunulur; CLI/köken eksikse veya zaten READY ise sunulmaz, FAKE yalnız test içindir. */
export const canEnableExecutor=e=>Boolean(e)&&e.id==="LOCAL_CLAUDE"&&e.state==="NOT_CONFIGURED"&&e.testOnly!==true;

// ---------- Genel bakış türetimleri ----------
/** Projeye ait mission kimlikleriyle koşuları süzer ve en son başlayanı seçer; koşu yoksa null (uydurulmaz). */
export function latestRunFor(runs,missionIds){
  const ids=new Set(missionIds??[]);let best=null;
  for(const r of runs??[]){if(!r||!ids.has(r.missionId))continue;if(!best||String(r.startedAt??"").localeCompare(String(best.startedAt??""))>=0)best=r}
  return best;
}
export const SECURITY_KIND_RE=/SECURITY|SAST|SECRET|AUDIT|VULN/;
/** Kanıt listesinden güvenlik türündekileri ve doğrulama durum sayısını çıkarır; hiç güvenlik kanıtı yoksa seen:false (güvenli sayılmaz). */
export function securitySummary(evidence){
  const sec=(evidence??[]).filter(e=>typeof e?.kind==="string"&&SECURITY_KIND_RE.test(e.kind));
  const counts={};for(const e of sec){const k=e.verification??"NONE";counts[k]=(counts[k]??0)+1}
  return {seen:sec.length>0,total:sec.length,counts,allVerified:sec.length>0&&sec.every(e=>e.verification==="VERIFIED")};
}

// ---------- İlk teslim akışı (GET /v1/projects/:id/flow) ----------
// //TR: LANE-A first-delivery: sunucunun akış okuması (MISSION, PLAN, RUN, REVIEW, DELIVERY) güvenli, sınırlı alanlara eşlenir; aşama sırası, adı ve durumu sabit sözlükten gelmelidir, aksi halde tüm okuma ERROR olur (kısmi görünüm yok). Hiçbir olumlu durum uydurulmaz.
export const FLOW_STAGES=Object.freeze(["MISSION","PLAN","RUN","REVIEW","DELIVERY"]);
export const FLOW_STATES=Object.freeze(["NOT_STARTED","ACTIVE","DONE","BLOCKED","FAILED","UNKNOWN"]);
export const flowPath=id=>pid(id)?`/v1/projects/${id}/flow`:null;
export function mapFlow(raw){
  const bad={state:"ERROR",flow:null};
  const f=isObj(raw)?raw.flow:null;
  if(!isObj(f)||!pid(f.projectId)||!Array.isArray(f.stages)||f.stages.length!==FLOW_STAGES.length)return bad;
  const stages=[];
  for(const [i,s] of f.stages.entries()){
    if(!isObj(s)||s.stage!==FLOW_STAGES[i]||!FLOW_STATES.includes(s.state))return bad;
    stages.push({stage:s.stage,state:s.state,detail:str(s.detail,120)});
  }
  const cnt=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const rid=typeof f.latestRunId==="string"&&/^[A-Za-z0-9_-]{6,64}$/.test(f.latestRunId)?f.latestRunId:null;
  // //TR: taskRuns: sunucu alanı yoksa undefined (satır gösterilmez); null = bağ dosyası okunamadı (UNKNOWN); nesne geçerliyse (tasksWithRuns <= tasks) sayılar, aksi halde null.
  const tr=Object.hasOwn(f,"taskRuns")?(isObj(f.taskRuns)&&cnt(f.taskRuns.tasksWithRuns)!==null&&cnt(f.taskRuns.tasks)!==null&&f.taskRuns.tasksWithRuns<=f.taskRuns.tasks?{tasksWithRuns:f.taskRuns.tasksWithRuns,tasks:f.taskRuns.tasks}:null):undefined;
  return {state:"VERIFIED",flow:{projectId:f.projectId,stages,missionCount:cnt(f.missionCount),taskCount:cnt(f.taskCount),latestRunId:rid,taskRuns:tr}};
}

// ---------- Koşu hazırlığı (GET /v1/projects/:id/readiness) ----------
// //TR: LANE-A A-FLOW-2: "ilk koşu neden başlamıyor?" yanıtı (MISSION, RISK, REPOSITORY, TEST_COMMAND, PLAN) sabit sırada ve sabit durum sözlüğüyle eşlenir. Çelişkili yanıt tüm okumayı ERROR yapar: `ready` yalnız tüm engelleyici kontroller OK iken, `verifiable` yalnız ready ve tüm kontroller OK iken doğru olabilir; OK kontrolün gerekçesi, BLOCKED kontrolün ise gerekçesi olmak zorundadır. Hiçbir olumlu durum uydurulmaz.
export const READINESS_CHECKS=Object.freeze(["MISSION","RISK","REPOSITORY","TEST_COMMAND","PLAN"]);
export const READINESS_STATES=Object.freeze(["OK","BLOCKED","UNKNOWN"]);
const READINESS_CODE_RE=/^[A-Z][A-Z0-9_]{0,59}$/;
export const readinessPath=id=>pid(id)?`/v1/projects/${id}/readiness`:null;
export function mapRunReadiness(raw){
  const bad={state:"ERROR",readiness:null};
  const r=isObj(raw)?raw.readiness:null;
  if(!isObj(r)||!pid(r.projectId)||!(r.missionId===null||/^msn_[0-9a-f]{24}$/.test(typeof r.missionId==="string"?r.missionId:""))||typeof r.ready!=="boolean"||typeof r.verifiable!=="boolean"||!Array.isArray(r.checks)||r.checks.length!==READINESS_CHECKS.length)return bad;
  const checks=[];
  for(const [i,c] of r.checks.entries()){
    const code=v=>v===null||(typeof v==="string"&&READINESS_CODE_RE.test(v));
    if(!isObj(c)||c.id!==READINESS_CHECKS[i]||!READINESS_STATES.includes(c.state)||typeof c.blocking!=="boolean"||!code(c.reason)||!code(c.nextAction))return bad;
    if(c.state==="OK"?c.reason!==null:c.reason===null)return bad;
    checks.push({id:c.id,state:c.state,blocking:c.blocking,reason:c.reason,nextAction:c.nextAction});
  }
  const ready=checks.filter(c=>c.blocking).every(c=>c.state==="OK"),verifiable=ready&&checks.every(c=>c.state==="OK");
  if(r.ready!==ready||r.verifiable!==verifiable)return bad;
  return {state:"VERIFIED",readiness:{projectId:r.projectId,missionId:r.missionId,ready,verifiable,checks}};
}

// //TR: LANE-A: Akış aşamasının `detail` kodunu okunur anlama eşler. Anlam YALNIZ aşama durumuyla (state) birlikte geçerlidir: sunucu ACTIVE mission aşamasına son mission'ın durumunu (ör. COMPLETE) yazabilir, bu yüzden "tüm mission'lar tamamlandı" yalnız state=DONE iken söylenir. Bilinen kod yanlış durumla gelirse çevrilmez (MISSION için yalnız düz durum etiketi, diğerleri ham ve "beklenmeyen" notuyla); bilinmeyen kod AYNEN ham ve "tanınmadı" notuyla gösterilir. Olumlu anlam eklenmez.
export const FLOW_DETAIL_STATES=Object.freeze({
  MISSION:Object.freeze({COMPLETE:["DONE"],BLOCKED:["BLOCKED"]}),
  PLAN:Object.freeze({}),
  RUN:Object.freeze({}),
  REVIEW:Object.freeze({CLEAN_REVIEW_GATE_PASSED:["DONE"],CLEAN_REVIEW_FOR_HEAD:["DONE"],RUN_NOT_SUCCEEDED:["UNKNOWN"],REVIEW:["ACTIVE"],REGRESSION:["ACTIVE"],REPORT:["ACTIVE"]}),
  DELIVERY:Object.freeze({PRODUCT_VERIFIED:["DONE"],NOT_VERIFIED:["DONE"],SOURCE_DELIVERY_ACCEPTED_NOT_VERIFIED:["ACTIVE"],ARTIFACT_PREPARED_NOT_VERIFIED:["ACTIVE"]})
});
const FLOW_STATUS_RE=/^[A-Z][A-Z0-9_]{0,39}$/;
/** {kind:"key",key,vars} | {kind:"status",status} | {kind:"raw",text,mismatch?} | null (detay yok). PLAN "n/m DONE" ve RUN "STATUS/STEP" biçimleri sayı/durum olarak ayrıştırılır. */
export function describeFlowDetail(stage,detail,state){
  if(typeof detail!=="string"||!detail)return null;
  if(stage==="PLAN"){
    const m=/^(\d{1,6})\/(\d{1,6}) DONE$/.exec(detail);
    if(m&&Number(m[1])<=Number(m[2]))return {kind:"key",key:"flow.detail.PLAN.progress",vars:{done:m[1],total:m[2]}};
    return {kind:"raw",text:detail};
  }
  if(stage==="RUN"){
    const m=/^([A-Z][A-Z0-9_]{0,39})\/([A-Z][A-Z0-9_]{0,39})$/.exec(detail);
    if(m)return {kind:"key",key:"flow.detail.RUN.status",vars:{status:m[1],step:m[2]}};
    return {kind:"raw",text:detail};
  }
  const codes=FLOW_DETAIL_STATES[stage]??{};
  if(Object.hasOwn(codes,detail)){
    if(codes[detail].includes(state))return {kind:"key",key:`flow.detail.${stage}.${detail}`,vars:{}};
    if(stage==="MISSION")return {kind:"status",status:detail};
    return {kind:"raw",text:detail,mismatch:true};
  }
  if(stage==="MISSION"&&FLOW_STATUS_RE.test(detail))return {kind:"status",status:detail};
  return {kind:"raw",text:detail};
}
