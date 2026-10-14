// //TR: Bu preload renderer'a Node yetkisi vermeden Control API read çağrıları ve token-protected Global Stop/Resume işlemleri için dar IPC köprüsü açar; B5 ile yalnız sabit allow-list'li JSON POST (apiPost) eklenir, kimlik bilgisi ana süreçte kalır. B7: sandbox:true preload ESM import desteklemediği için (Electron "Cannot use import statement outside a module" ile preload yüklemiyordu) electron modülü sandbox preload require ile alınır; açılan yüzey değişmez.
const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("uasco",{
  apiGet:(path)=>ipcRenderer.invoke("uasco:api-get",path),
  apiPost:(path,body)=>ipcRenderer.invoke("uasco:api-post",path,body),
  stop:(reason)=>ipcRenderer.invoke("uasco:stop",reason),
  resume:()=>ipcRenderer.invoke("uasco:resume"),
  retryBlocked:(packageId)=>ipcRenderer.invoke("uasco:retry-blocked",packageId)
});
