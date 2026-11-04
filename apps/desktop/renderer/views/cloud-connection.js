// //TR: Bu görünüm CLOUD-T0005 Windows .exe'nin YALNIZ uzak bulut istemcisi/Control UI olmasını sağlar: yapılandırılmış bulut uç noktasına bağlantı durumunu gösterir; uç nokta yoksa fail-closed NOT_CONFIGURED gösterir, yerel çalışma zamanı/WSL/sandbox/araç kurulumu ASLA başlatmaz, çevrimdışıyken yalnız durum/salt-okunur kalır, oturum belirteci/secret ASLA çizilmez ve sunucu metni yalnız textContent ile (temizlenip redakte edilerek) yazılır. Saf mantık dışa aktarılan fonksiyonlardadır.
import {h} from "../components.js";

export const CLOUD_CONNECTION_STATES=Object.freeze(["NOT_CONFIGURED","ENDPOINT_INSECURE","OFFLINE","CONNECTING","AUTH_REQUIRED","SESSION_EXPIRED","CONNECTED","ERROR"]);
/** apps/control-api/src/cloud/remote-gateway.ts ROLE_PERMISSIONS ile birebir (testte eşlik doğrulanır). İstemci yalnız düğme gösterir; yetkiyi sunucu verir. */
export const CLIENT_ROLE_ACTIONS=Object.freeze({
  FOUNDER:Object.freeze(["job.submit","job.read","job.cancel","artifact.download","model.invoke","system.stop"]),
  OPERATOR:Object.freeze(["job.submit","job.read","job.cancel","artifact.download","model.invoke"]),
  VIEWER:Object.freeze(["job.read","artifact.download"]),
});
/** Bu istemcinin gönderebileceği uzak komutlar; hepsi bulut Control API'ye gider. Yerel yürütme komutu YOKTUR. */
export const REMOTE_COMMANDS=Object.freeze(["job.submit","job.cancel","artifact.download","system.stop"]);
export const LOCAL_EXECUTION_ALLOWED=false;
const MAX_TEXT=512;
/** core/cloud/contracts.ts ID_RE / ARTIFACT_NAME_RE / SHA256_RE ile aynı: komut argümanı yalnız bu desenlerden geçen HAM değerdir. */
export const CLOUD_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
export const ARTIFACT_NAME_RE=/^(?!.*\.\.)(?![/\\])[A-Za-z0-9._/-]{1,255}$/;
const SHA256_RE=/^[0-9a-f]{64}$/;
const rawIf=(v,re)=>typeof v==="string"&&re.test(v)?v:null;

function isLoopbackHost(hostname){
  const x=String(hostname).toLowerCase().replace(/\.+$/,"").replace(/^\[|\]$/g,"");
  if(x==="localhost"||x.endsWith(".localhost"))return true;
  if(/^127\.\d+\.\d+\.\d+$/.test(x)||x==="0.0.0.0"||x==="::"||x==="::1")return true;
  return /^::ffff:(127\.\d+\.\d+\.\d+|7f[0-9a-f]{2}:[0-9a-f]{1,4}|0\.0\.0\.0|0:0)$/.test(x);
}

/** remote-gateway resolveCloudRuntimeConfig ile aynı kurallar: uç nokta yoksa NOT_CONFIGURED (yerel yedek YOK); yalnız https, kimlik/sorgu/parça yok; üretimde loopback yok. */
export function resolveCloudEndpoint(cfg){
  const raw=typeof cfg?.endpoint==="string"?cfg.endpoint.trim():"";
  if(!raw)return {ok:false,reason:"CLOUD_RUNTIME_NOT_CONFIGURED"};
  let url;
  try{url=new URL(raw)}catch{return {ok:false,reason:"ENDPOINT_INSECURE"}}
  const environment=cfg?.environment??"staging";
  if(environment!=="staging"&&environment!=="production")return {ok:false,reason:"CLOUD_RUNTIME_NOT_CONFIGURED"};
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)return {ok:false,reason:"ENDPOINT_INSECURE"};
  if(environment==="production"&&isLoopbackHost(url.hostname))return {ok:false,reason:"ENDPOINT_INSECURE"};
  return {ok:true,endpoint:`${url.origin}${url.pathname}`,environment};
}

/** Sunucu metni: kontrol karakterleri atılır, belirteç/secret benzeri diziler redakte edilir, uzunluk sınırlanır. Sonuç yine YALNIZ textContent ile yazılır. */
export function sanitizeServerText(v){
  if(v===undefined||v===null)return "";
  let s=String(v).replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g,"");
  s=s.replace(/\bv1\.[A-Za-z0-9._:-]+\.[A-Za-z0-9_-]+\.[0-9a-f]{64}\b/g,"[REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,"$1 [REDACTED]")
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr])[-_][A-Za-z0-9_-]{8,}/g,"[REDACTED]")
    .replace(/\b(token|secret|password|passwd|api[_-]?key|authorization)(\s*[:=]\s*)("?)[^\s",;]+/gi,"$1$2$3[REDACTED]")
    .replace(/\b[0-9a-f]{40,}\b/gi,"[REDACTED]");
  return s.length>MAX_TEXT?`${s.slice(0,MAX_TEXT)}…`:s;
}

/** Sunucunun döndürdüğü oturum özetinden yalnız gösterilebilir alanlar; belirteç/secret alanları hiç kopyalanmaz. */
export function sessionSummary(session,now){
  if(!session||typeof session!=="object")return null;
  const roles=Array.isArray(session.roles)?session.roles.filter(r=>typeof r==="string"&&Object.hasOwn(CLIENT_ROLE_ACTIONS,r)):[];
  const expiresAt=Number.isSafeInteger(session.expiresAt)?session.expiresAt:null;
  return {subject:sanitizeServerText(session.subject),tenantId:sanitizeServerText(session.tenantId),roles:[...new Set(roles)],expiresAt,
    expired:expiresAt===null||now.getTime()>=expiresAt};
}

/** Durum türetme: yapılandırma → ağ → probe → oturum. Bilinmeyen/eksik her durum kapalı (CONNECTED dışı) kalır. */
export function deriveConnectionState({config,online,probe,session,now}){
  const r=resolveCloudEndpoint(config);
  if(!r.ok)return {state:r.reason==="ENDPOINT_INSECURE"?"ENDPOINT_INSECURE":"NOT_CONFIGURED",endpoint:null,environment:null,session:null,readOnly:true};
  const base={endpoint:r.endpoint,environment:r.environment};
  const sess=sessionSummary(session,now);
  if(online!==true)return {...base,state:"OFFLINE",session:sess,readOnly:true};
  if(!probe||probe.status==="PENDING")return {...base,state:"CONNECTING",session:sess,readOnly:true};
  if(probe.status!=="OK")return {...base,state:"ERROR",session:sess,readOnly:true,error:sanitizeServerText(probe.code??"UNKNOWN")};
  if(!sess||sess.roles.length===0)return {...base,state:"AUTH_REQUIRED",session:null,readOnly:true};
  if(sess.expired)return {...base,state:"SESSION_EXPIRED",session:sess,readOnly:true};
  return {...base,state:"CONNECTED",session:sess,readOnly:false};
}

/** Gösterilecek uzak komutlar: yalnız CONNECTED + rol izni; çevrimdışı/diğer durumlarda hiçbiri (salt-okunur). */
export function allowedCommands(derived){
  if(!derived||derived.state!=="CONNECTED"||derived.readOnly)return [];
  const allowed=new Set(derived.session.roles.flatMap(r=>CLIENT_ROLE_ACTIONS[r]??[]));
  return REMOTE_COMMANDS.filter(a=>allowed.has(a));
}

/** İş sonuçları: görüntü metni temizlenmiş; komut argümanı ayrıca doğrulanmış HAM id/ad (temizlenmiş metin ASLA komuta gitmez). Ham değer desene uymazsa komut sunulmaz. */
export function jobRows(jobs,derived){
  const canDownload=allowedCommands(derived).includes("artifact.download"),canCancel=allowedCommands(derived).includes("job.cancel");
  return (Array.isArray(jobs)?jobs:[]).filter(j=>j&&typeof j==="object").slice(0,100).map(j=>{
    const rawJobId=rawIf(j.jobId,CLOUD_ID_RE);
    return {jobId:sanitizeServerText(j.jobId),rawJobId,status:sanitizeServerText(j.status),message:sanitizeServerText(j.message),
      cancellable:canCancel&&rawJobId!==null&&(j.status==="QUEUED"||j.status==="RUNNING"),
      artifacts:(Array.isArray(j.artifacts)?j.artifacts:[]).filter(a=>a&&typeof a.name==="string").map(a=>{
        const rawName=rawIf(a.name,ARTIFACT_NAME_RE);
        return {name:sanitizeServerText(a.name),rawName,downloadable:canDownload&&rawJobId!==null&&rawName!==null&&typeof a.sha256==="string"&&SHA256_RE.test(a.sha256)};
      })};
  });
}

const TEXT=Object.freeze({
  "cloud.title":"Bulut bağlantısı",
  "cloud.state.NOT_CONFIGURED":"Bulut uç noktası yapılandırılmadı (CLOUD_RUNTIME_NOT_CONFIGURED). Hiçbir iş başlatılmaz; yerel çalışma zamanı yedeği yoktur.",
  "cloud.state.ENDPOINT_INSECURE":"Bulut uç noktası reddedildi: yalnız https ve kimlik/sorgu içermeyen adres kabul edilir.",
  "cloud.state.OFFLINE":"Çevrimdışı: yalnız durum/salt-okunur. Komut gönderilmez.",
  "cloud.state.CONNECTING":"Bulut uç noktasına bağlanılıyor…",
  "cloud.state.AUTH_REQUIRED":"Oturum açılması gerekiyor.",
  "cloud.state.SESSION_EXPIRED":"Oturum süresi doldu; yeniden oturum açın.",
  "cloud.state.CONNECTED":"Bulut uç noktasına bağlı.",
  "cloud.state.ERROR":"Bulut uç noktasına ulaşılamadı.",
  "cloud.localExecution":"Bu istemci yerel olarak hiçbir şey çalıştırmaz (WSL/Node/CLI/araç kurulumu yok); tüm işler bulutta yürür.",
  "cloud.endpoint":"Uç nokta","cloud.environment":"Ortam","cloud.subject":"Kullanıcı","cloud.tenant":"Tenant","cloud.roles":"Roller","cloud.errorCode":"Hata kodu",
  "cloud.jobs":"Bulut işleri","cloud.noJobs":"Gösterilecek iş yok.",
  "cloud.cmd.job.submit":"İş gönder","cloud.cmd.job.cancel":"İptal et","cloud.cmd.artifact.download":"İndir","cloud.cmd.system.stop":"STOP",
  "cloud.jobsStatus.OK":"Bulut işleri Control API'den okundu (salt-okunur).",
  "cloud.jobsStatus.NOT_CONFIGURED":"Bulut iş kuyruğu yapılandırılmadı (NOT_CONFIGURED). Gösterilecek gerçek iş yok; örnek veri gösterilmez.",
  "cloud.jobsStatus.UNAVAILABLE":"Bulut iş durumu bu masaüstü derlemesinde açık değil (UNAVAILABLE).",
  "cloud.jobsStatus.OFFLINE":"Control API'ye ulaşılamadı (OFFLINE).",
  "cloud.jobsStatus.ERROR":"Bulut iş durumu okunamadı (ERROR).",
  "cloud.jobsStopped":"Global STOP etkin: yeni iş kabul edilmez.",
});
const tr=(ctx,k)=>{const v=typeof ctx?.t==="function"?ctx.t(k):k;return typeof v==="string"&&v!==k?v:(TEXT[k]??k)};
/** Komut yalnız ctx.sendRemoteCommand'a (bulut Control API köprüsü) iletilir; yoksa hiçbir şey yapılmaz. */
const send=(ctx,action,args)=>()=>{if(typeof ctx?.sendRemoteCommand==="function")ctx.sendRemoteCommand(action,args)};

/** model: {config:{endpoint,environment}, online, probe:{status,code}, session:{subject,tenantId,roles,expiresAt}, jobs, now} */
export function cloudConnectionView(ctx,model){
  const doc=ctx.doc,now=model?.now instanceof Date?model.now:new Date();
  const d=deriveConnectionState({...model,now}),cmds=allowedCommands(d);
  const kv=(k,v)=>h(doc,"div",{class:"kv"},h(doc,"dt",{text:tr(ctx,k)}),h(doc,"dd",{class:"mono",text:v}));
  const facts=[];
  if(d.endpoint){facts.push(kv("cloud.endpoint",d.endpoint),kv("cloud.environment",d.environment))}
  if(d.session&&d.state!=="AUTH_REQUIRED"){facts.push(kv("cloud.subject",d.session.subject),kv("cloud.tenant",d.session.tenantId),kv("cloud.roles",d.session.roles.join(", ")))}
  if(d.error)facts.push(kv("cloud.errorCode",d.error));
  const rows=d.endpoint?jobRows(model?.jobs,d):[];
  const jobs=d.endpoint?h(doc,"section",{class:"cloud-jobs","aria-label":tr(ctx,"cloud.jobs")},
    h(doc,"h4",{text:tr(ctx,"cloud.jobs")}),
    rows.length?h(doc,"ul",{class:"cards"},rows.map(j=>h(doc,"li",{class:"card",dataset:{cloudJob:j.jobId,cloudJobStatus:j.status}},
      h(doc,"span",{class:"mono",text:j.jobId})," ",h(doc,"span",{text:j.status}),
      j.message?h(doc,"p",{class:"note",text:j.message}):null,
      j.cancellable?h(doc,"button",{type:"button",class:"btn",dataset:{cloudCmd:"job.cancel"},text:tr(ctx,"cloud.cmd.job.cancel"),on:{click:send(ctx,"job.cancel",{jobId:j.rawJobId})}}):null,
      j.artifacts.length?h(doc,"ul",{class:"cloud-artifacts"},j.artifacts.map(a=>h(doc,"li",{},h(doc,"span",{class:"mono",text:a.name}),
        a.downloadable?h(doc,"button",{type:"button",class:"btn",dataset:{cloudCmd:"artifact.download"},text:tr(ctx,"cloud.cmd.artifact.download"),on:{click:send(ctx,"artifact.download",{jobId:j.rawJobId,name:a.rawName})}}):null))):null)))
      :h(doc,"p",{class:"note note-empty",text:tr(ctx,"cloud.noJobs")})):null;
  const global=cmds.filter(c=>c==="job.submit"||c==="system.stop");
  return h(doc,"section",{class:"cloud-connection",id:"cloud-connection",role:"region","aria-label":tr(ctx,"cloud.title"),dataset:{cloudState:d.state,readOnly:String(d.readOnly),localExecution:"false"}},
    h(doc,"h3",{text:tr(ctx,"cloud.title")}),
    h(doc,"p",{class:`note${d.state==="CONNECTED"?"":" note-error"}`,role:"status",dataset:{cloudStatus:d.state},text:tr(ctx,`cloud.state.${d.state}`)}),
    facts.length?h(doc,"dl",{class:"kvs"},facts):null,
    h(doc,"p",{class:"note",dataset:{cloudLocal:"none"},text:tr(ctx,"cloud.localExecution")}),
    global.length?h(doc,"div",{class:"btn-row"},global.map(c=>h(doc,"button",{type:"button",class:`btn${c==="system.stop"?" btn-danger":" btn-primary"}`,dataset:{cloudCmd:c},text:tr(ctx,`cloud.cmd.${c}`),on:{click:send(ctx,c,{})}}))):null,
    jobs);
}

// //TR: CLOUD-T0005 gerçek durum: GET /v1/cloud/jobs yanıtı (apps/control-api/src/routes/cloud-jobs.ts) yalnız bu yükleyiciyle okunur; hata/yokluk dürüstçe
// NOT_CONFIGURED / UNAVAILABLE / OFFLINE / ERROR olarak gösterilir, asla örnek veri üretilmez. Sunucu metni temizlenip yalnız textContent ile çizilir.
export const CLOUD_JOBS_PATH="/v1/cloud/jobs";
export const CLOUD_JOBS_STATES=Object.freeze(["OK","NOT_CONFIGURED","UNAVAILABLE","OFFLINE","ERROR"]);
const JOB_STATUSES=new Set(["QUEUED","RUNNING","SUCCEEDED","FAILED","CANCELLED","TIMED_OUT","STOPPED"]);
function jobSummaryOk(j){
  return j&&typeof j==="object"&&rawIf(j.jobId,CLOUD_ID_RE)!==null&&JOB_STATUSES.has(j.status)&&Number.isSafeInteger(j.attempt)&&Number.isSafeInteger(j.maxAttempts);
}
/** api: renderer createApi() örneği. Dönen değer: {state, jobs, stopped, code}. */
export async function loadCloudJobs(api){
  const r=await api.get(CLOUD_JOBS_PATH);
  if(!r||!r.ok){
    const state=r?.state==="UNAVAILABLE"?"UNAVAILABLE":r?.state==="OFFLINE"?"OFFLINE":"ERROR";
    return {state,jobs:[],stopped:false,code:sanitizeServerText(r?.message??"")};
  }
  const d=r.data;
  if(d&&d.state==="NOT_CONFIGURED")return {state:"NOT_CONFIGURED",jobs:[],stopped:false,code:""};
  if(!d||d.state!=="OK"||!Array.isArray(d.jobs)||!d.jobs.every(jobSummaryOk))return {state:"ERROR",jobs:[],stopped:false,code:"CLOUD_JOBS_MALFORMED"};
  return {state:"OK",stopped:d.stopped===true,code:"",jobs:d.jobs.slice(0,100).map(j=>({
    jobId:sanitizeServerText(j.jobId),status:j.status,kind:sanitizeServerText(j.kind),attempt:`${j.attempt}/${j.maxAttempts}`,
    updatedAt:sanitizeServerText(j.updatedAt??""),message:sanitizeServerText(j.message??""),
    artifacts:(Array.isArray(j.artifacts)?j.artifacts:[]).filter(a=>a&&typeof a.name==="string").map(a=>sanitizeServerText(a.name))}))};
}
/** Salt-okunur panel: komut düğmesi yoktur (komutlar cloudConnectionView'da, oturum yetkisine bağlıdır). */
export function cloudJobsPanel(ctx,loaded){
  const doc=ctx.doc,st=CLOUD_JOBS_STATES.includes(loaded?.state)?loaded.state:"ERROR",jobs=st==="OK"?loaded.jobs:[];
  return h(doc,"section",{class:"cloud-jobs-status",id:"cloud-jobs-status",role:"region","aria-label":tr(ctx,"cloud.jobs"),dataset:{cloudJobsState:st}},
    h(doc,"h4",{text:tr(ctx,"cloud.jobs")}),
    h(doc,"p",{class:`note${st==="OK"?"":` note-${st.toLowerCase()}`}`,role:"status",dataset:{cloudJobsStatus:st},text:tr(ctx,`cloud.jobsStatus.${st}`)}),
    st!=="OK"&&loaded?.code?h(doc,"p",{class:"note mono",dataset:{cloudJobsCode:loaded.code},text:loaded.code}):null,
    st==="OK"&&loaded.stopped?h(doc,"p",{class:"note note-error",dataset:{cloudJobsStopped:"true"},text:tr(ctx,"cloud.jobsStopped")}):null,
    st==="OK"?(jobs.length?h(doc,"ul",{class:"cards"},jobs.map(j=>h(doc,"li",{class:"card",dataset:{cloudJob:j.jobId,cloudJobStatus:j.status}},
      h(doc,"span",{class:"mono",text:j.jobId})," ",h(doc,"span",{text:j.status})," ",h(doc,"span",{class:"note",text:`${j.kind} · ${j.attempt}`}),
      j.message?h(doc,"p",{class:"note",text:j.message}):null,
      j.artifacts.length?h(doc,"ul",{class:"cloud-artifacts"},j.artifacts.map(a=>h(doc,"li",{class:"mono",text:a}))):null)))
      :h(doc,"p",{class:"note note-empty",text:tr(ctx,"cloud.noJobs")})):null);
}
