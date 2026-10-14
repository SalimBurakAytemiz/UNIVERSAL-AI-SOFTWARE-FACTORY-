// //TR: Bu preload renderer'a Node yetkisi vermeden Control API read çağrıları ve token-protected Global Stop/Resume işlemleri için dar IPC köprüsü açar; B5 ile yalnız sabit allow-list'li JSON POST (apiPost) eklenir, kimlik bilgisi ana süreçte kalır.
import {contextBridge,ipcRenderer} from "electron";
contextBridge.exposeInMainWorld("uasco",{
  apiGet:(path)=>ipcRenderer.invoke("uasco:api-get",path),
  apiPost:(path,body)=>ipcRenderer.invoke("uasco:api-post",path,body),
  stop:(reason)=>ipcRenderer.invoke("uasco:stop",reason),
  resume:()=>ipcRenderer.invoke("uasco:resume"),
  retryBlocked:(packageId)=>ipcRenderer.invoke("uasco:retry-blocked",packageId)
});
