// //TR: Bu dosya hardened Electron Control Tower penceresini context isolation/sandbox/preload ile başlatır, renderer'ın direct Node/network authority'sini sınırlar ve target-machine desktop smoke marker üretir.
import {app,BrowserWindow,ipcMain} from "electron";
import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const apiBase=`http://127.0.0.1:${process.env.CONTROL_API_PORT??3210}`;
const token=process.env.UASCO_CONTROL_TOKEN??"";

async function api(pathName,options={}){
  const r=await fetch(apiBase+pathName,{...options,headers:{...(options.headers??{}),...(token?{"x-uasco-control-token":token}:{})}});
  if(!r.ok)throw new Error(`${pathName}: HTTP ${r.status}`);
  return r.json();
}
ipcMain.handle("uasco:api-get",async(_e,p)=>{
  if(typeof p!=="string"||!p.startsWith("/v1/")&&p!=="/health")throw new Error("Invalid API path");
  return api(p);
});
ipcMain.handle("uasco:stop",async(_e,reason)=>api("/v1/control/stop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:String(reason??"Founder requested stop")})}));
ipcMain.handle("uasco:resume",async()=>api("/v1/control/resume",{method:"POST"}));
ipcMain.handle("uasco:retry-blocked",async(_e,packageId)=>api("/v1/control/retry-blocked",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({packageId})}));

app.whenReady().then(()=>{
  const win=new BrowserWindow({
    width:1500,height:920,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(here,"preload.mjs")}
  });
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  win.webContents.on("will-navigate",e=>e.preventDefault());
  win.webContents.on("will-attach-webview",e=>e.preventDefault());
  win.loadFile(path.join(here,"renderer","index.html"));
  if(process.env.UASCO_SMOKE==="1"){
    win.webContents.once("did-finish-load",async()=>{
      try{const h=await api("/health");if(h.status!=="HEALTHY")throw new Error("Control API unhealthy");
        fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/DESKTOP_SMOKE_READY.json",JSON.stringify({readyAt:new Date().toISOString(),controlApi:"HEALTHY"},null,2));
      }catch(e){fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/DESKTOP_SMOKE_READY.json",JSON.stringify({readyAt:new Date().toISOString(),controlApi:"FAIL",error:String(e.message)},null,2));}
      setTimeout(()=>app.quit(),500);
    });
  }
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});
