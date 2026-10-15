// //TR: Bu dosya hardened Electron Control Tower penceresini yalnız doğrulanmış localhost Control API kimliğine bağlar; renderer IPC sender/GET allowlist (mevcut + B4/B5 sabit rotaları) ve ayrı sabit POST allowlist (32 KB JSON gövde sınırı, token yalnız ana süreçte), redirect ve browser yetkileri fail-closed sınırlandırılır. B7: paketlenmiş (kurulu) modda arka uç Electron node modunda başlatılır, değişken veri userData altına yönlendirilir ve tek örnek kilidi uygulanır; geliştirme modu (npm run dev) değişmez. PS-1B (Project Studio): sabit proje çalışma alanı GET/POST rotaları allow-list'e eklenir; içe aktarma diyaloğu, önizleme ve dışa aktarma klasörü yalnız ana süreçte çözülen değerlerle çalışır (renderer rastgele yol, URL veya komut veremez).
import {app,BrowserWindow,ipcMain,dialog,shell} from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import cp from "node:child_process";
import net from "node:net";
import {fileURLToPath,pathToFileURL} from "node:url";
import {parseControlPort,controlOrigin,controlChallengeProof,secureStringEqual,desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";

const here=path.dirname(fileURLToPath(import.meta.url)),rendererFile=path.join(here,"renderer","index.html"),rendererUrl=pathToFileURL(rendererFile).href;
// //TR: B7: kurulu uygulamada (app.isPackaged) token her açılışta ana süreçte rastgele üretilir, hiçbir yere yazılmaz ve arka uca yalnız stdin ile verilir; port boş bir loopback portu olarak açılışta seçilir. Geliştirme modunda eski env davranışı aynen korunur.
const packaged=app.isPackaged;
const token=packaged?crypto.randomBytes(32).toString("hex"):(process.env.UASCO_CONTROL_TOKEN??"");
let port=packaged?0:parseControlPort(process.env.CONTROL_API_PORT,3210),apiBase=packaged?"":controlOrigin(port);
let controlWindow=null,identityVerifiedAt=0;

// B7-PACKAGED-BEGIN
// //TR: Saf yol/başlatma eşlemesi: kurulu modda bütün değişken veri (runtime/GLOBAL_STOP, Work OS verisi, loglar, smoke işareti) userData (%APPDATA%/UASCO) altına düşer; program dosyaları yalnız kurulum dizininde kalır. Arka uç Electron ikilisiyle node modunda, kabuksuz, en az env ile başlatılır; token argv ya da env içinde yer almaz.
const PACKAGED_BACKEND_ENTRY=["apps","control-api","src","packaged-entry.js"];
const BACKEND_ENV_PASSTHROUGH=["SystemRoot","SystemDrive","windir","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","ProgramData","COMPUTERNAME","NUMBER_OF_PROCESSORS","PROCESSOR_ARCHITECTURE","PATHEXT"];
function packagedDataPaths(userData){
  if(typeof userData!=="string"||!path.isAbsolute(userData))throw new Error("USER_DATA_PATH_INVALID");
  const root=path.resolve(userData),runtimeDir=path.join(root,"runtime"),logsDir=path.join(root,"logs");
  return {userData:root,runtimeDir,globalStopFile:path.join(runtimeDir,"GLOBAL_STOP.json"),smokeMarker:path.join(runtimeDir,"DESKTOP_SMOKE_READY.json"),workosDataDir:path.join(root,"workos"),logsDir,backendLogFile:path.join(logsDir,"control-api.log"),desktopLogFile:path.join(logsDir,"desktop.log")};
}
function backendLaunchSpec({execPath,appRoot,paths,port,baseEnv}){
  const env={};for(const k of BACKEND_ENV_PASSTHROUGH)if(typeof baseEnv?.[k]==="string")env[k]=baseEnv[k];
  Object.assign(env,{ELECTRON_RUN_AS_NODE:"1",NODE_ENV:"production",CONTROL_API_PORT:String(port),UASCO_DATA_DIR:paths.workosDataDir,UASCO_RUNTIME_DIR:paths.runtimeDir});
  return {command:execPath,args:[path.join(appRoot,...PACKAGED_BACKEND_ENTRY)],options:{cwd:appRoot,env,stdio:["pipe","pipe","pipe"],windowsHide:true}};
}
// B7-PACKAGED-END

// B4-ALLOWLIST-BEGIN
// //TR: Token ana süreçte eklendiği için shell'in okuduğu ek GET rotaları (cockpit, projeler, mission'lar; B5: work-runs ve evidence) yalnız bu korumalı dosyada, tam eşleşme veya sıkı kimlik/sorgu kuralları ile fail-closed izinlenir; renderer token veya yeni yetki görmez.
const EXTRA_GET_ROUTES=new Set(["/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence"]);
const PROJECT_MISSIONS_RE=/^\/v1\/missions\?projectId=prj_[0-9a-f]{24}$/;
const MISSION_DETAIL_RE=/^\/v1\/missions\/msn_[0-9a-f]{24}$/;
const WORK_RUN_DETAIL_RE=/^\/v1\/work-runs\/[A-Za-z0-9_-]{6,64}$/;
const EVIDENCE_DETAIL_RE=/^\/v1\/evidence\/[A-Za-z0-9_-]{6,64}$/;
// //TR: M1a c2: koşu teslim görünümü (salt-okunur) ve proje bazlı teslim listesi; kimlikler sıkı biçimlidir.
const DELIVERY_DETAIL_RE=/^\/v1\/work-runs\/run_[0-9a-f]{24}\/delivery$/;
const DELIVERY_LIST_RE=/^\/v1\/deliveries\?projectId=prj_[0-9a-f]{24}$/;
const QUERY_RULES={missionId:/^msn_[0-9a-f]{24}$/,runId:/^[A-Za-z0-9_-]{6,64}$/,kind:/^[A-Z][A-Z0-9_]{0,39}$/,cursor:/^[A-Za-z0-9_.=:-]{1,128}$/,limit:/^[1-9][0-9]{0,2}$/};
function listQueryAllowed(value,base,keys){
  if(!value.startsWith(base+"?"))return false;
  const seen=new Set();
  for(const pair of value.slice(base.length+1).split("&")){
    const i=pair.indexOf("="),k=i>0?pair.slice(0,i):"",v=i>0?pair.slice(i+1):"";
    if(!keys.includes(k)||seen.has(k)||!QUERY_RULES[k].test(v))return false;
    seen.add(k);
  }
  return seen.size>0;
}
// //TR: PS-1B: Project Studio okuma rotaları tam eşleşme ile izinlenir (kimlik prj_ + 24 hex, dışa aktarma kimliği sıkı desen); yol sorgusu yüzde-kodlu ve kanonik olmalı, "..", "/" ile başlama, ters eğik çizgi, ":" ve "%" reddedilir; git referansı yalnız onaltılık özet veya HEAD(~N); bilinmeyen/yinelenen parametre reddedilir.
// //TR: PS-1B c2: kanonik kodlayıcı renderer (project-core.js encodeRelPath) ile birebir aynıdır; encodeURIComponent'in bırakıp bıraktığı ! ' ( ) * karakterleri de %XX olarak kodlanır; kodlanmış yol üst sınırı 300 karakter x 9 = 2700'dür.
function psEncodeRel(rel){return encodeURIComponent(rel).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase())}
function psRelPathValueOk(enc){
  if(typeof enc!=="string"||enc.length<1||enc.length>2700||!/^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/.test(enc))return false;
  let dec;try{dec=decodeURIComponent(enc)}catch{return false}
  if(psEncodeRel(dec)!==enc)return false;
  if(dec.length>300||/[\u0000-\u001f\u007f\\%:]/.test(dec)||dec.startsWith("/")||dec.endsWith("/"))return false;
  return dec.split("/").every(s=>s.length>0&&s!=="."&&s!=="..");
}
const PS_GIT_REF_RE=/^(?:[0-9a-f]{7,64}|HEAD(?:~[0-9]{1,3})?)$/;
const PS_GET_ROUTE_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/(devrun|files|file|git\/log|git\/diff|exports)$/;
const PS_EXPORT_DETAIL_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/exports\/[A-Za-z0-9_-]{6,64}$/;
const PS_QUERY={
  "devrun":{keys:{},req:[]},
  "files":{keys:{path:psRelPathValueOk},req:[]},
  "file":{keys:{path:psRelPathValueOk},req:["path"]},
  "git/log":{keys:{limit:v=>/^[1-9][0-9]{0,2}$/.test(v)&&Number(v)<=500},req:[]},
  "git/diff":{keys:{from:v=>PS_GIT_REF_RE.test(v),to:v=>PS_GIT_REF_RE.test(v)},req:[]},
  "exports":{keys:{},req:[]}
};
function projectStudioGetAllowed(value){
  if(typeof value!=="string"||value.length>2900)return false;
  if(value==="/v1/system/executors")return true;
  const q=value.indexOf("?"),base=q<0?value:value.slice(0,q);
  if(PS_EXPORT_DETAIL_RE.test(base))return q<0;
  const m=PS_GET_ROUTE_RE.exec(base);if(!m)return false;
  const rule=PS_QUERY[m[1]];
  if(q<0)return rule.req.length===0;
  const seen=new Set();
  for(const pair of value.slice(q+1).split("&")){
    const i=pair.indexOf("="),k=i>0?pair.slice(0,i):"",v=i>0?pair.slice(i+1):"";
    if(!Object.prototype.hasOwnProperty.call(rule.keys,k)||seen.has(k)||!rule.keys[k](v))return false;
    seen.add(k);
  }
  return rule.req.every(k=>seen.has(k));
}
function desktopExtraGetPathAllowed(value){
  if(projectStudioGetAllowed(value))return true;
  if(typeof value!=="string"||value.length>400)return false;
  return EXTRA_GET_ROUTES.has(value)||DELIVERY_DETAIL_RE.test(value)||DELIVERY_LIST_RE.test(value)||PROJECT_MISSIONS_RE.test(value)||MISSION_DETAIL_RE.test(value)||WORK_RUN_DETAIL_RE.test(value)||EVIDENCE_DETAIL_RE.test(value)||listQueryAllowed(value,"/v1/work-runs",["missionId"])||listQueryAllowed(value,"/v1/evidence",["missionId","runId","kind","cursor","limit"]);
}
// B4-ALLOWLIST-END

// B5-POST-ALLOWLIST-BEGIN
// //TR: Renderer'ın yazma yetkisi yalnız bu sabit POST rotalarıyla sınırlıdır (proje oluştur, mission oluştur, mission geçişi, koşu başlat); gövde yalnız düz JSON nesnesi ve en çok 32 KB olabilir, token ana süreçte eklenir ve renderer'a hiç dönmez.
const POST_MAX_BODY_BYTES=32768;
// //TR: PS-1B: Project Studio yazma rotaları da sabittir: proje içe aktarma, geliştirme koşusu başlat/durdur/yeniden başlat, dışa aktarma ve yerel Claude yürütücüsünü etkinleştirme; başka yöntem veya rota yoktur.
const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/transition$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/runs$/,
  /^\/v1\/projects\/prj_[0-9a-f]{24}\/import$/,/^\/v1\/projects\/prj_[0-9a-f]{24}\/devrun\/(?:start|stop|restart)$/,/^\/v1\/projects\/prj_[0-9a-f]{24}\/export$/,/^\/v1\/system\/executors\/local-claude\/enable$/,
  // M1a c2: teslim paketini hazırla ve NOT_VERIFIED kaynak teslimini kabul et; dışa aktarma yalnız ana süreç köprüsündedir (hash ana süreçte yeniden doğrulanır).
  /^\/v1\/work-runs\/run_[0-9a-f]{24}\/delivery\/(?:prepare|accept)$/];
function desktopPostPathAllowed(value){
  return typeof value==="string"&&value.length<=128&&POST_ROUTE_RES.some(re=>re.test(value));
}
/** Gövde düz bir JSON nesnesi olmalı ve 32 KB'ı aşmamalı; aksi halde ok:false ve sabit hata kodu döner. */
function desktopPostBodyCheck(body){
  const b=body===undefined||body===null?{}:body;
  if(typeof b!=="object"||Array.isArray(b))return {ok:false,error:"INVALID_API_BODY"};
  const proto=Object.getPrototypeOf(b);if(proto!==Object.prototype&&proto!==null)return {ok:false,error:"INVALID_API_BODY"};
  let text;try{text=JSON.stringify(b)}catch{return {ok:false,error:"INVALID_API_BODY"}}
  if(typeof text!=="string"||text.charAt(0)!=="{")return {ok:false,error:"INVALID_API_BODY"};
  if(Buffer.byteLength(text,"utf8")>POST_MAX_BODY_BYTES)return {ok:false,error:"API_BODY_TOO_LARGE"};
  return {ok:true,text};
}
// B5-POST-ALLOWLIST-END

// PS1B-NATIVE-BEGIN
// //TR: PS-1B saf yardımcıları (electron'suz, testle izole değerlendirilir): içe aktarma yolu yalnız ana süreçteki dosya diyaloğundan gelmiş olmalıdır (POST gövdesindeki path önceden verilmiş yollar tablosunda aranır); önizleme URL'si renderer'dan alınmaz, ana süreç backend devrun durumundan okur ve yalnız RUNNING + AVAILABLE iken http://127.0.0.1:<port>/ biçimindeki (Control API portu hariç, 1024-65535) adres kabul edilir; dışa aktarma konumu gerçek yola çözülüp yalnız veri dizinindeki exports klasörünün altındaysa gösterilir.
const PS_PROJECT_ID_RE=/^prj_[0-9a-f]{24}$/;
const PS_EXPORT_ID_RE=/^[A-Za-z0-9_-]{6,64}$/;
const PS_IMPORT_KINDS=["git","zip"];
const PS_IMPORT_PATH_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/import$/;
const PS_PREVIEW_URL_RE=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/$/;
function psImportPathValid(p,kind,pathMod){
  if(typeof p!=="string"||p.length<3||p.length>1000||/[\u0000-\u001f\u007f]/.test(p)||!pathMod.isAbsolute(p))return false;
  if(p.split(/[\\/]+/).includes(".."))return false;
  if(kind==="zip")return /\.zip$/i.test(p);
  return kind==="git";
}
function psImportPostAllowed(pathName,body,issued){
  if(typeof pathName!=="string"||!PS_IMPORT_PATH_RE.test(pathName))return true;
  const b=body===undefined||body===null?{}:body;
  if(typeof b!=="object"||Array.isArray(b)||Object.keys(b).sort().join(",")!=="kind,path")return false;
  return typeof b.path==="string"&&PS_IMPORT_KINDS.includes(b.kind)&&issued.get(b.path)===b.kind;
}
function psPreviewUrl(devrun,controlPort){
  if(!devrun||typeof devrun!=="object"||devrun.status!=="RUNNING")return null;
  const pv=devrun.preview;if(!pv||typeof pv!=="object"||pv.state!=="AVAILABLE"||typeof pv.url!=="string")return null;
  const m=PS_PREVIEW_URL_RE.exec(pv.url);if(!m)return null;
  const p=Number(m[1]);if(p<1024||p>65535||(Number.isSafeInteger(controlPort)&&p===controlPort))return null;
  if(devrun.port!==undefined&&devrun.port!==null&&devrun.port!==p)return null;
  return pv.url;
}
function psExportPathFromBody(body){
  const e=body&&typeof body==="object"?(body.export&&typeof body.export==="object"?body.export:body):null;
  if(!e)return null;
  for(const k of ["path","filePath","exportPath","archivePath"])if(typeof e[k]==="string"&&e[k])return e[k];
  return null;
}
function psResolveExportPath(candidate,exportsRoot,fsMod,pathMod){
  if(typeof candidate!=="string"||candidate.length<3||candidate.length>1000||/[\u0000-\u001f\u007f]/.test(candidate)||!pathMod.isAbsolute(candidate))return null;
  if(typeof exportsRoot!=="string"||!pathMod.isAbsolute(exportsRoot))return null;
  let real,root;try{real=fsMod.realpathSync(candidate);root=fsMod.realpathSync(exportsRoot)}catch{return null}
  const rel=pathMod.relative(root,real);
  if(!rel||rel===".."||rel.startsWith(".."+pathMod.sep)||pathMod.isAbsolute(rel))return null;
  return real;
}
// PS1B-NATIVE-END

// M1A-C2-BEGIN
// //TR: M1a c2 saf yardımcıları (electron'suz, testle izole değerlendirilir): (1) uygulama kimliği yalnız paketlenmiş ürün adından türetilir: "UASCO Test" TEST varyantıdır (ayrı AppUserModelID,
// pencere başlığında "UASCO Test"), diğer her ad RELEASE kimliğini (değişmeden) kullanır; (2) teslim artefaktının dışa aktarımı: kayıt biçimi sıkıdır, dosya gerçek yola çözülüp yalnız veri
// dizinindeki deliveries/<runId>/<hash>.zip ise kabul edilir ve baytların sha256'sı kayıttaki exportArtifactHash ile birebir eşleşmeden hiçbir bayt verilmez.
const TEST_PRODUCT_NAME="UASCO Test";
function desktopIdentity(appName){return appName===TEST_PRODUCT_NAME?{variant:"test",appUserModelId:"com.uasco.desktop.test",titleSuffix:` — ${TEST_PRODUCT_NAME}`}:{variant:"release",appUserModelId:"com.uasco.desktop",titleSuffix:""}}
function windowTitleFor(pageTitle,identity){const t=typeof pageTitle==="string"&&pageTitle?pageTitle:"UASCO";return identity.titleSuffix&&!t.includes(TEST_PRODUCT_NAME)?`${t}${identity.titleSuffix}`:t}
const DELIVERY_RUN_ID_RE=/^run_[0-9a-f]{24}$/,DELIVERY_HASH_RE=/^[0-9a-f]{64}$/;
function deliveryExportFileName(rec){return `UASCO-teslim-${rec.runId}-${rec.exportArtifactHash.slice(0,12)}.zip`}
function deliveryExportCheck(body,runId,deliveriesRoot,fsMod,pathMod,cryptoMod){
  const rec=body&&typeof body==="object"?body.artifact:null;
  if(!DELIVERY_RUN_ID_RE.test(String(runId))||!rec||typeof rec!=="object"||rec.runId!==runId||!DELIVERY_HASH_RE.test(String(rec.exportArtifactHash))||rec.artifactPath!==`deliveries/${rec.runId}/${rec.exportArtifactHash}.zip`)return {ok:false,reason:"DELIVERY_RECORD_INVALID"};
  if(body.sha256!==rec.exportArtifactHash||body.fileState!=="VERIFIED")return {ok:false,reason:"DELIVERY_ARTIFACT_HASH_MISMATCH"};
  if(typeof deliveriesRoot!=="string"||!pathMod.isAbsolute(deliveriesRoot))return {ok:false,reason:"DELIVERY_PATH_REJECTED"};
  let real,expected;try{real=fsMod.realpathSync(String(body.path));expected=fsMod.realpathSync(pathMod.join(deliveriesRoot,rec.runId,`${rec.exportArtifactHash}.zip`))}catch{return {ok:false,reason:"DELIVERY_ARTIFACT_MISSING"}}
  if(real!==expected)return {ok:false,reason:"DELIVERY_PATH_REJECTED"};
  let bytes;try{bytes=fsMod.readFileSync(real)}catch{return {ok:false,reason:"DELIVERY_ARTIFACT_MISSING"}}
  const sha=cryptoMod.createHash("sha256").update(bytes).digest("hex");
  if(sha!==rec.exportArtifactHash)return {ok:false,reason:"DELIVERY_ARTIFACT_HASH_MISMATCH"};
  return {ok:true,bytes,sha256:sha,fileName:deliveryExportFileName(rec)};
}
// M1A-C2-END


async function verifyServerIdentity(force=false){
  if(!force&&Date.now()-identityVerifiedAt<2000)return true;
  const challenge=crypto.randomBytes(32).toString("hex"),expected=controlChallengeProof(token,challenge);if(!expected)throw new Error("CONTROL_TOKEN_NOT_CONFIGURED");
  const r=await fetch(`${apiBase}/health?challenge=${challenge}`,{redirect:"error",cache:"no-store"});if(!r.ok)throw new Error(`health: HTTP ${r.status}`);const h=await r.json();
  if(h.status!=="HEALTHY"||h.system!=="UNIVERSAL-AI-SOFTWARE-COMPANY-OS"||h.bindHost!=="127.0.0.1"||Number(h.port)!==port||!secureStringEqual(expected,String(h.controlProof??"")))throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");identityVerifiedAt=Date.now();return true;
}
async function api(pathName,options={}){
  if(typeof pathName!=="string"||!pathName.startsWith("/v1/"))throw new Error("CONTROL_API_PATH_INVALID");await verifyServerIdentity();
  const r=await fetch(apiBase+pathName,{...options,redirect:"error",cache:"no-store",headers:{...(options.headers??{}),"x-uasco-control-token":token}});if(!r.ok)throw new Error(`${pathName}: HTTP ${r.status}`);return r.json();
}
/** Hata gövdesinden token ve yerel mutlak yol sızıntısını temizler (renderer yalnız kısa, güvenli hata alanlarını görür). */
function scrubText(v,max=300){
  let t=String(v??"");if(token&&t.includes(token))t=t.split(token).join("[redacted]");
  return t.replace(/[A-Za-z]:[\\/][^\s"']*/g,"[path]").replace(/\/(?:Users|home|var|tmp|etc|opt|root)\/[^\s"']*/g,"[path]").slice(0,max);
}
function sanitizePostBody(status,parsed){
  if(parsed===null||typeof parsed!=="object"||Array.isArray(parsed))return status>=400?{error:"NON_JSON_ERROR"}:{};
  if(status>=400){const out={};for(const k of ["error","code","reason","message"])if(typeof parsed[k]==="string")out[k]=scrubText(parsed[k]);return out}
  return JSON.parse(JSON.stringify(parsed,(_k,v)=>typeof v==="string"?scrubText(v,4000):v));
}
async function apiPost(pathName,bodyText){
  await verifyServerIdentity();
  let r;try{r=await fetch(apiBase+pathName,{method:"POST",redirect:"error",cache:"no-store",headers:{"content-type":"application/json","x-uasco-control-token":token},body:bodyText})}catch{throw new Error("CONTROL_API_UNREACHABLE")}
  let parsed=null;try{parsed=JSON.parse((await r.text()).slice(0,262144))}catch{parsed=null}
  return {status:r.status,body:sanitizePostBody(r.status,parsed)};
}
// //TR: PS-1B: hash yönlendirmesi (#/projects vb.) aynı belgede kalır ve senderFrame.url sonuna "#..." ekler; güvenilir gönderen kontrolü yalnız fragmanı yok sayar, dosya yolu birebir aynı olmalıdır (başka dosya/URL hâlâ reddedilir).
function trustedSender(event){const u=event.senderFrame?.url;return Boolean(controlWindow)&&event.sender===controlWindow.webContents&&typeof u==="string"&&u.split("#")[0]===rendererUrl}
function requireTrustedSender(event){if(!trustedSender(event))throw new Error("UNTRUSTED_IPC_SENDER")}

// //TR: PS-1B ana süreç köprüleri: renderer yalnız tür ("git"|"zip"), proje kimliği ve dışa aktarma kimliği verir; yol, URL ve konum ana süreçte çözülür. Önizleme güvenli seçenek olarak varsayılan tarayıcıda açılır (uygulama içi pencere yok): üretilen uygulamanın kodu Electron sürecine/oturumuna hiç girmez, token ve IPC yüzeyine erişemez; URL yine de yalnız backend devrun durumundan, sıkı loopback biçiminde alınır.
const importIssued=new Map();
function dataDirRoot(){return packaged?packagedDataPaths(app.getPath("userData")).workosDataDir:(process.env.UASCO_DATA_DIR?path.resolve(process.env.UASCO_DATA_DIR):path.resolve(here,"..","..",".ai","workos"))}
ipcMain.handle("uasco:pick-import-path",async(event,kind)=>{
  requireTrustedSender(event);if(!PS_IMPORT_KINDS.includes(kind))throw new Error("INVALID_IMPORT_KIND");
  const r=await dialog.showOpenDialog(controlWindow,{title:kind==="git"?"UASCO — Git deposu / Git repository":"UASCO — ZIP",properties:kind==="git"?["openDirectory"]:["openFile"],filters:kind==="zip"?[{name:"ZIP",extensions:["zip"]}]:[]});
  if(r.canceled||!Array.isArray(r.filePaths)||r.filePaths.length!==1)return {cancelled:true};
  const p=path.resolve(r.filePaths[0]);if(!psImportPathValid(p,kind,path))throw new Error("IMPORT_PATH_REJECTED");
  if(importIssued.size>=8)importIssued.delete(importIssued.keys().next().value);importIssued.set(p,kind);return {cancelled:false,path:p,kind};
});
ipcMain.handle("uasco:open-preview",async(event,projectId)=>{
  requireTrustedSender(event);if(typeof projectId!=="string"||!PS_PROJECT_ID_RE.test(projectId))throw new Error("INVALID_PROJECT_ID");
  let devrun;try{devrun=await api(`/v1/projects/${projectId}/devrun`)}catch{return {opened:false,reason:"DEVRUN_UNAVAILABLE"}}
  const url=psPreviewUrl(devrun,port);if(!url)return {opened:false,reason:"PREVIEW_UNAVAILABLE"};
  try{await shell.openExternal(url)}catch{return {opened:false,reason:"OPEN_FAILED"}}return {opened:true};
});
ipcMain.handle("uasco:show-export",async(event,projectId,exportId)=>{
  requireTrustedSender(event);if(typeof projectId!=="string"||!PS_PROJECT_ID_RE.test(projectId)||typeof exportId!=="string"||!PS_EXPORT_ID_RE.test(exportId))throw new Error("INVALID_EXPORT_REF");
  let body;try{body=await api(`/v1/projects/${projectId}/exports/${exportId}`)}catch{return {shown:false,reason:"EXPORT_UNAVAILABLE"}}
  const resolved=psResolveExportPath(psExportPathFromBody(body),path.join(dataDirRoot(),"exports"),fs,path);if(!resolved)return {shown:false,reason:"EXPORT_PATH_REJECTED"};
  shell.showItemInFolder(resolved);return {shown:true};
});
// //TR: M1a c2 "Teslim paketini dışa aktar": renderer yalnız run kimliği verir. Ana süreç sunucudan kaydı ister (sunucu hash'i yeniden doğrular), dosyayı kendisi yeniden doğrular, kullanıcının seçtiği
// konuma yazar ve yazılan kopyanın sha256'sını tekrar karşılaştırır; uyuşmazlıkta kopya silinir ve bayt verilmez.
ipcMain.handle("uasco:export-delivery",async(event,runId)=>{
  requireTrustedSender(event);if(typeof runId!=="string"||!DELIVERY_RUN_ID_RE.test(runId))throw new Error("INVALID_RUN_ID");
  let res;try{res=await apiPost(`/v1/work-runs/${runId}/delivery/export`,"{}")}catch{return {exported:false,reason:"DELIVERY_UNAVAILABLE"}}
  if(res.status!==200)return {exported:false,reason:typeof res.body?.error==="string"?res.body.error:"DELIVERY_UNAVAILABLE"};
  const chk=deliveryExportCheck(res.body,runId,path.join(dataDirRoot(),"deliveries"),fs,path,crypto);if(!chk.ok)return {exported:false,reason:chk.reason};
  const r=await dialog.showSaveDialog(controlWindow,{title:"UASCO — Teslim paketini dışa aktar / Export delivery package",defaultPath:chk.fileName,filters:[{name:"ZIP",extensions:["zip"]}]});
  if(r.canceled||!r.filePath)return {exported:false,reason:"CANCELLED"};
  try{fs.writeFileSync(r.filePath,chk.bytes);const back=crypto.createHash("sha256").update(fs.readFileSync(r.filePath)).digest("hex");if(back!==chk.sha256){try{fs.rmSync(r.filePath,{force:true})}catch{}return {exported:false,reason:"DELIVERY_ARTIFACT_HASH_MISMATCH"}}}
  catch{return {exported:false,reason:"DELIVERY_WRITE_FAILED"}}
  return {exported:true,sha256:chk.sha256,fileName:path.basename(r.filePath),savedTo:r.filePath};
});
ipcMain.handle("uasco:api-get",async(event,p)=>{requireTrustedSender(event);if(!desktopGetPathAllowed(p)&&!desktopExtraGetPathAllowed(p))throw new Error("INVALID_API_PATH");if(p==="/health"){await verifyServerIdentity(true);return {status:"HEALTHY",system:"UNIVERSAL-AI-SOFTWARE-COMPANY-OS",serverIdentity:"VERIFIED"}}return api(p)});
ipcMain.handle("uasco:api-post",async(event,p,body)=>{requireTrustedSender(event);if(!desktopPostPathAllowed(p))throw new Error("INVALID_API_PATH");const prepared=desktopPostBodyCheck(body);if(!prepared.ok)throw new Error(prepared.error);if(!psImportPostAllowed(p,body,importIssued))throw new Error("IMPORT_PATH_NOT_MAIN_RESOLVED");const res=await apiPost(p,prepared.text);if(res.status>=200&&res.status<300&&PS_IMPORT_PATH_RE.test(p))importIssued.delete(body.path);return res});
ipcMain.handle("uasco:stop",async(event,reason)=>{requireTrustedSender(event);return api("/v1/control/stop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:String(reason??"Founder requested stop").slice(0,1000)})})});
ipcMain.handle("uasco:resume",async(event)=>{requireTrustedSender(event);return api("/v1/control/resume",{method:"POST"})});
ipcMain.handle("uasco:retry-blocked",async(event,packageId)=>{requireTrustedSender(event);const id=String(packageId??"");if(!/^PKG-\d{3}$/.test(id))throw new Error("INVALID_PACKAGE_ID");return api("/v1/control/retry-blocked",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({packageId:id})})});

// B7: kurulu modda arka uç yaşam döngüsü (başlat, /health kimlik doğrulaması ile bekle, çıkışta sonlandır) ve tek örnek kilidi.
let backend=null,backendLog=null,backendQuitting=false;
const singleInstanceOk=!packaged||app.requestSingleInstanceLock();
if(!singleInstanceOk)app.quit();
else if(packaged){app.setAppUserModelId(desktopIdentity(app.getName()).appUserModelId);app.on("second-instance",()=>{if(controlWindow){if(controlWindow.isMinimized())controlWindow.restore();controlWindow.focus()}})}
function logBackend(chunk){if(!backendLog)return;let t=String(chunk);if(t.includes(token))t=t.split(token).join("[redacted]");try{backendLog.write(t)}catch{}}
function openBackendLog(file){try{if(fs.existsSync(file)&&fs.statSync(file).size>5*1024*1024)fs.renameSync(file,file+".1")}catch{}return fs.createWriteStream(file,{flags:"a"})}
function freeLoopbackPort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.unref();s.on("error",reject);s.listen({host:"127.0.0.1",port:0},()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
function stopBackend(){
  const child=backend;backend=null;if(!child||child.exitCode!==null||child.signalCode!==null)return Promise.resolve();
  return new Promise(resolve=>{const t=setTimeout(()=>{try{child.kill()}catch{}resolve()},3000);child.once("exit",()=>{clearTimeout(t);resolve()});try{child.stdin.end()}catch{try{child.kill()}catch{}}});
}
async function startPackagedBackend(){
  const paths=packagedDataPaths(app.getPath("userData"));
  for(const d of [paths.runtimeDir,paths.workosDataDir,paths.logsDir])fs.mkdirSync(d,{recursive:true});
  backendLog=openBackendLog(paths.backendLogFile);
  try{
    port=parseControlPort(await freeLoopbackPort());apiBase=controlOrigin(port);
    const spec=backendLaunchSpec({execPath:process.execPath,appRoot:app.getAppPath(),paths,port,baseEnv:process.env});
    logBackend(`[desktop] ${new Date().toISOString()} starting control API on 127.0.0.1:${port}\n`);
    const child=cp.spawn(spec.command,spec.args,spec.options);backend=child;
    child.stdout.on("data",logBackend);child.stderr.on("data",logBackend);child.stdin.on("error",()=>{});
    child.on("error",e=>logBackend(`[desktop] backend spawn error: ${scrubText(e?.message??e)}\n`));
    child.on("exit",(code,signal)=>{logBackend(`[desktop] ${new Date().toISOString()} control API exited code=${code} signal=${signal}\n`);if(backend===child)backend=null});
    child.stdin.write(token+"\n");
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){if(backend!==child)throw new Error("CONTROL_API_EXITED");try{await verifyServerIdentity(true);logBackend("[desktop] control API identity verified\n");return true}catch{}await new Promise(r=>setTimeout(r,250))}
    throw new Error("CONTROL_API_HEALTH_TIMEOUT");
  }catch(e){logBackend(`[desktop] BACKEND_START_FAILED ${scrubText(e?.message??e)}\n`);await stopBackend();return false}
}
app.on("before-quit",e=>{if(!packaged||backendQuitting||!backend)return;e.preventDefault();backendQuitting=true;stopBackend().finally(()=>app.quit())});
process.on("exit",()=>{if(backend){try{backend.kill()}catch{}}});

app.whenReady().then(async()=>{
  if(!singleInstanceOk)return;
  const win=new BrowserWindow({width:1500,height:920,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:false,navigateOnDragDrop:false,preload:path.join(here,"preload.mjs")}});controlWindow=win;
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));win.webContents.session.setPermissionCheckHandler(()=>false);
  // M1a c2: TEST varyantının penceresi başlığında her zaman "UASCO Test" taşır (RELEASE başlığı değişmez).
  const identity=desktopIdentity(app.getName());if(identity.titleSuffix){win.on("page-title-updated",(e,title)=>{e.preventDefault();win.setTitle(windowTitleFor(title,identity))});win.setTitle(windowTitleFor(win.getTitle(),identity))}
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));win.webContents.on("will-navigate",e=>e.preventDefault());win.webContents.on("will-redirect",e=>e.preventDefault());win.webContents.on("will-attach-webview",e=>e.preventDefault());
  if(process.env.UASCO_SMOKE==="1"){
    win.webContents.once("did-finish-load",async()=>{
      const marker=packaged?packagedDataPaths(app.getPath("userData")).smokeMarker:".ai/runtime/DESKTOP_SMOKE_READY.json";try{await verifyServerIdentity(true);fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,JSON.stringify({readyAt:new Date().toISOString(),controlApi:"HEALTHY",serverIdentity:"VERIFIED",port},null,2)+"\n")}catch(e){fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,JSON.stringify({readyAt:new Date().toISOString(),controlApi:"FAIL",serverIdentity:"REJECTED",error:String(e?.message??e)},null,2)+"\n")}setTimeout(()=>app.quit(),500);
    });
  }
  if(packaged&&!(await startPackagedBackend())){await win.loadFile(path.join(here,"backend-error.html"));return}
  await win.loadFile(rendererFile);
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});
