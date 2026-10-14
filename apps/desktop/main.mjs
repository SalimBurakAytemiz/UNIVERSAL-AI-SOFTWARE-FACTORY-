// //TR: Bu dosya hardened Electron Control Tower penceresini yalnız doğrulanmış localhost Control API kimliğine bağlar; renderer IPC sender/GET allowlist (mevcut + B4 cockpit/projects/missions sabit rotaları), redirect ve browser yetkileri fail-closed sınırlandırılır.
import {app,BrowserWindow,ipcMain} from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {desktopExtraGetPathAllowed} from "./get-allowlist.mjs";
import {parseControlPort,controlOrigin,controlChallengeProof,secureStringEqual,desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";

const here=path.dirname(fileURLToPath(import.meta.url)),rendererFile=path.join(here,"renderer","index.html"),rendererUrl=pathToFileURL(rendererFile).href;
const port=parseControlPort(process.env.CONTROL_API_PORT,3210),apiBase=controlOrigin(port),token=process.env.UASCO_CONTROL_TOKEN??"";
let controlWindow=null,identityVerifiedAt=0;

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
function trustedSender(event){return Boolean(controlWindow)&&event.sender===controlWindow.webContents&&event.senderFrame?.url===rendererUrl}
function requireTrustedSender(event){if(!trustedSender(event))throw new Error("UNTRUSTED_IPC_SENDER")}

ipcMain.handle("uasco:api-get",async(event,p)=>{requireTrustedSender(event);if(!desktopGetPathAllowed(p)&&!desktopExtraGetPathAllowed(p))throw new Error("INVALID_API_PATH");if(p==="/health"){await verifyServerIdentity(true);return {status:"HEALTHY",system:"UNIVERSAL-AI-SOFTWARE-COMPANY-OS",serverIdentity:"VERIFIED"}}return api(p)});
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
