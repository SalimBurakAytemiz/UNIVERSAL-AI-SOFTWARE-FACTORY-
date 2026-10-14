// //TR: Bu dosya hardened Electron Control Tower penceresini yalnız doğrulanmış localhost Control API kimliğine bağlar; renderer IPC sender/GET allowlist (mevcut + B4/B5 sabit rotaları) ve ayrı sabit POST allowlist (32 KB JSON gövde sınırı, token yalnız ana süreçte), redirect ve browser yetkileri fail-closed sınırlandırılır.
import {app,BrowserWindow,ipcMain} from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {parseControlPort,controlOrigin,controlChallengeProof,secureStringEqual,desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";

const here=path.dirname(fileURLToPath(import.meta.url)),rendererFile=path.join(here,"renderer","index.html"),rendererUrl=pathToFileURL(rendererFile).href;
const port=parseControlPort(process.env.CONTROL_API_PORT,3210),apiBase=controlOrigin(port),token=process.env.UASCO_CONTROL_TOKEN??"";
let controlWindow=null,identityVerifiedAt=0;

// B4-ALLOWLIST-BEGIN
// //TR: Token ana süreçte eklendiği için shell'in okuduğu ek GET rotaları (cockpit, projeler, mission'lar; B5: work-runs ve evidence) yalnız bu korumalı dosyada, tam eşleşme veya sıkı kimlik/sorgu kuralları ile fail-closed izinlenir; renderer token veya yeni yetki görmez.
const EXTRA_GET_ROUTES=new Set(["/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence"]);
const PROJECT_MISSIONS_RE=/^\/v1\/missions\?projectId=prj_[0-9a-f]{24}$/;
const MISSION_DETAIL_RE=/^\/v1\/missions\/msn_[0-9a-f]{24}$/;
const WORK_RUN_DETAIL_RE=/^\/v1\/work-runs\/[A-Za-z0-9_-]{6,64}$/;
const EVIDENCE_DETAIL_RE=/^\/v1\/evidence\/[A-Za-z0-9_-]{6,64}$/;
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
function desktopExtraGetPathAllowed(value){
  if(typeof value!=="string"||value.length>400)return false;
  return EXTRA_GET_ROUTES.has(value)||PROJECT_MISSIONS_RE.test(value)||MISSION_DETAIL_RE.test(value)||WORK_RUN_DETAIL_RE.test(value)||EVIDENCE_DETAIL_RE.test(value)||listQueryAllowed(value,"/v1/work-runs",["missionId"])||listQueryAllowed(value,"/v1/evidence",["missionId","runId","kind","cursor","limit"]);
}
// B4-ALLOWLIST-END

// B5-POST-ALLOWLIST-BEGIN
// //TR: Renderer'ın yazma yetkisi yalnız bu sabit POST rotalarıyla sınırlıdır (proje oluştur, mission oluştur, mission geçişi, koşu başlat); gövde yalnız düz JSON nesnesi ve en çok 32 KB olabilir, token ana süreçte eklenir ve renderer'a hiç dönmez.
const POST_MAX_BODY_BYTES=32768;
const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/transition$/,/^\/v1\/missions\/msn_[0-9a-f]{24}\/runs$/];
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
function trustedSender(event){return Boolean(controlWindow)&&event.sender===controlWindow.webContents&&event.senderFrame?.url===rendererUrl}
function requireTrustedSender(event){if(!trustedSender(event))throw new Error("UNTRUSTED_IPC_SENDER")}

ipcMain.handle("uasco:api-get",async(event,p)=>{requireTrustedSender(event);if(!desktopGetPathAllowed(p)&&!desktopExtraGetPathAllowed(p))throw new Error("INVALID_API_PATH");if(p==="/health"){await verifyServerIdentity(true);return {status:"HEALTHY",system:"UNIVERSAL-AI-SOFTWARE-COMPANY-OS",serverIdentity:"VERIFIED"}}return api(p)});
ipcMain.handle("uasco:api-post",async(event,p,body)=>{requireTrustedSender(event);if(!desktopPostPathAllowed(p))throw new Error("INVALID_API_PATH");const prepared=desktopPostBodyCheck(body);if(!prepared.ok)throw new Error(prepared.error);return apiPost(p,prepared.text)});
ipcMain.handle("uasco:stop",async(event,reason)=>{requireTrustedSender(event);return api("/v1/control/stop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:String(reason??"Founder requested stop").slice(0,1000)})})});
ipcMain.handle("uasco:resume",async(event)=>{requireTrustedSender(event);return api("/v1/control/resume",{method:"POST"})});
ipcMain.handle("uasco:retry-blocked",async(event,packageId)=>{requireTrustedSender(event);const id=String(packageId??"");if(!/^PKG-\d{3}$/.test(id))throw new Error("INVALID_PACKAGE_ID");return api("/v1/control/retry-blocked",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({packageId:id})})});

app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1500,height:920,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:false,navigateOnDragDrop:false,preload:path.join(here,"preload.mjs")}});controlWindow=win;
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));win.webContents.session.setPermissionCheckHandler(()=>false);
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));win.webContents.on("will-navigate",e=>e.preventDefault());win.webContents.on("will-redirect",e=>e.preventDefault());win.webContents.on("will-attach-webview",e=>e.preventDefault());
  if(process.env.UASCO_SMOKE==="1"){
    win.webContents.once("did-finish-load",async()=>{
      const marker=".ai/runtime/DESKTOP_SMOKE_READY.json";try{await verifyServerIdentity(true);fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(marker,JSON.stringify({readyAt:new Date().toISOString(),controlApi:"HEALTHY",serverIdentity:"VERIFIED",port},null,2)+"\n")}catch(e){fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(marker,JSON.stringify({readyAt:new Date().toISOString(),controlApi:"FAIL",serverIdentity:"REJECTED",error:String(e?.message??e)},null,2)+"\n")}setTimeout(()=>app.quit(),500);
    });
  }
  await win.loadFile(rendererFile);
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});
