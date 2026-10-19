// //TR: Bu E2E harness gerçek Control API'yi ve gerçek Electron Desktop'ı (apps/desktop/main.mjs + preload.mjs) aynı rastgele token ile başlatır; Electron'u yalnız doğrulanmış binary ile (shell yok, electron.cmd yok, örtük indirme yok) --remote-debugging-port ile açar, Node'un yerleşik WebSocket'i üzerinden Chrome DevTools Protocol ile gerçek renderer rotalarını (routes.js) kullanıcı gibi gezer ve rota başına dürüst kanıtı (yüklendi mi, dürüst-durum doğrulamaları, konsol hataları, süre, ekran görüntüsü, commit SHA) .ai/runtime/e2e/E2E_EVIDENCE.json içine yazar; doğrulanamayan rota asla PASS yazılmaz, NOT_VERIFIED + sebep olur.
import cp from "node:child_process";import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {pathToFileURL} from "node:url";import {computeStatus,exitCodeFor,resolveCommitSha} from "./desktop-e2e-logic.mjs";
import {safeChildEnv} from "../../automation/lib/env-policy.mjs";import {controlChallengeProof,secureStringEqual} from "../../automation/lib/control-boundary.mjs";import {verifyProvisionedElectron} from "../../automation/lib/electron-provision.mjs";
// //TR: Electron binary yalnız scripts/provision-electron.mjs ile açıkça temin edilir; bu harness da smoke'lar gibi mühürlü arşive bağlı binary'yi doğrular ve eksikse indirme yapmadan fail-closed durur.
const root=process.cwd(),outDir=path.join(root,".ai","runtime","e2e"),evidenceFile=path.join(outDir,"E2E_EVIDENCE.json");
const apiPort=33230,cdpPort=33231,token=crypto.randomBytes(32).toString("hex");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {ROUTES}=await import(pathToFileURL(path.join(root,"apps/desktop/renderer/routes.js")).href);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const env={...safeChildEnv("config/environment-policy.json",{provider:"DETERMINISTIC"}),CONTROL_API_PORT:String(apiPort),UASCO_CONTROL_TOKEN:token};
// //TR: Linux'ta ekran sunucusu (xvfb) için yalnız DISPLAY/XAUTHORITY aktarılır; başka hiçbir ortam değişkeni sızdırılmaz.
if(process.platform==="linux")for(const k of ["DISPLAY","XAUTHORITY"])if(process.env[k])env[k]=process.env[k];
const evidence={"//TR":"Bu runtime kanıtı gerçek Electron Desktop + gerçek Control API üzerinde rota başına gözlenen dürüst durumu kaydeder; PASS yalnız harness'in gerçekten doğruladığı şeyi ifade eder, ürün-doğrulama (PRODUCT_VERIFIED) iddiası DEĞİLDİR ve bağımsız inceleme gerektirir.",schemaVersion:"1.0.0",generatedAt:new Date().toISOString(),commitSha:resolveCommitSha(process.env,cp.spawnSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).stdout),platform:process.platform,node:process.version,setup:{controlApi:"NOT_VERIFIED",desktop:"NOT_VERIFIED",cdp:"NOT_VERIFIED",firstRunWizard:"NOT_VERIFIED"},routes:[]};
const procs=[];
function killAll(){for(const c of procs){if(process.platform==="win32")cp.spawnSync("taskkill",["/PID",String(c.pid),"/T","/F"],{stdio:"ignore"});else try{c.kill("SIGTERM")}catch{}}}
function finish(fatal){
  killAll();
  const rs=evidence.routes,fail=rs.filter(r=>r.status==="FAIL").length,nv=rs.filter(r=>r.status==="NOT_VERIFIED").length,pass=rs.filter(r=>r.status==="PASS").length;
  evidence.summary={routes:rs.length,pass,fail,notVerified:nv,fatal:fatal??null};evidence.status=computeStatus(rs,fatal);
  fs.writeFileSync(evidenceFile,JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({status:evidence.status,...evidence.summary,routes:rs.map(r=>`${r.id}:${r.status}`)}));
  process.exit(exitCodeFor(evidence.status));
}
// //TR: Minimal CDP istemcisi: Node 24 yerleşik WebSocket'i; yeni bağımlılık yoktur.
function cdpConnect(url){return new Promise((resolve,reject)=>{const ws=new WebSocket(url),pending=new Map(),handlers=[];let id=0;
  ws.addEventListener("message",ev=>{const m=JSON.parse(String(ev.data));if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(new Error(m.error.message)):p.res(m.result)}else if(m.method)for(const h of handlers)h(m)});
  ws.addEventListener("error",()=>reject(new Error("CDP_WS_ERROR")));
  ws.addEventListener("open",()=>resolve({send:(method,params={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))}),on:h=>handlers.push(h),close:()=>ws.close()}));
})}
// //TR: Sayfa içinde çalışan dürüst-durum doğrulaması: görünüm gerçekten çizildi mi, ham i18n anahtarı / undefined / [object Object] / NaN sızıntısı var mı, boş (koşusuz) ortamda yaprak durum rozeti olarak PRODUCT_VERIFIED uydurma iddiası var mı (açıklama metinleri iddia sayılmaz). Sayfa metni kanıta yazılmaz (yalnız uzunluk ve bulgu etiketleri).
const PAGE_PROBE=`(()=>{const m=document.getElementById("main");if(!m)return {mainPresent:false};const txt=m.innerText||"";const raw=[...m.querySelectorAll("*")].filter(e=>e.children.length===0&&/^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9_-]+){1,4}$/.test((e.textContent||"").trim())).length;return {mainPresent:true,busy:m.getAttribute("aria-busy"),textLength:txt.trim().length,headings:m.querySelectorAll("h1,h2").length,hash:location.hash,rawKeyLeaks:raw,undefinedLeak:/\\bundefined\\b|\\[object Object\\]|\\bNaN\\b/.test(txt),productVerifiedClaim:[...m.querySelectorAll("*")].some(e=>e.children.length===0&&/^PRODUCT_VERIFIED$/.test((e.textContent||"").trim())),modalOpen:!!document.querySelector("dialog[open]"),api:(document.getElementById("ctxApi")||{}).textContent||"",bridge:typeof window.uasco==="object"&&typeof window.uasco.apiGet==="function"&&typeof window.uasco.apiPost==="function"}})()`;
try{
  // 1) Control API (gerçek süreç) + challenge-proof kimliği.
  const api=cp.spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","apps/control-api/src/server.ts"],{cwd:root,env,windowsHide:true,stdio:["ignore","ignore","ignore"]});procs.push(api);
  let ready=false;for(let i=0;i<75&&!ready;i++){try{const ch=crypto.randomBytes(32).toString("hex"),r=await fetch(`http://127.0.0.1:${apiPort}/health?challenge=${ch}`,{redirect:"error"});if(r.ok){const h=await r.json();if(h.port===apiPort&&h.bindHost==="127.0.0.1"&&secureStringEqual(String(h.controlProof??""),String(controlChallengeProof(token,ch)??"")))ready=true}}catch{}if(!ready)await sleep(200)}
  if(!ready)finish("CONTROL_API_IDENTITY_FAILED");
  evidence.setup.controlApi="VERIFIED";
  // 2) Electron Desktop (doğrulanmış binary, shell yok) + uzaktan hata ayıklama portu yalnız loopback.
  const electron=await verifyProvisionedElectron(root);
  const userData=path.join(outDir,"user-data"),args=[`--remote-debugging-port=${cdpPort}`,"--remote-debugging-address=127.0.0.1",`--user-data-dir=${userData}`];
  if(process.platform==="linux")args.push("--no-sandbox","--disable-gpu");
  const desktop=cp.spawn(electron,[...args,"apps/desktop/main.mjs"],{cwd:root,env,windowsHide:true,stdio:["ignore","ignore","ignore"]});procs.push(desktop);
  let target=null;for(let i=0;i<100&&!target;i++){try{const list=await (await fetch(`http://127.0.0.1:${cdpPort}/json`,{redirect:"error"})).json();target=list.find(t=>t.type==="page"&&/renderer\/index\.html/.test(t.url))??null}catch{}if(!target)await sleep(300)}
  if(!target)finish("DESKTOP_CDP_TARGET_NOT_FOUND");
  evidence.setup.desktop="VERIFIED";
  const cdp=await cdpConnect(target.webSocketDebuggerUrl);evidence.setup.cdp="VERIFIED";
  // //TR: Konsol hataları (console.error, yakalanmamış istisna, CSP/ağ kaynaklı log hatası) aktif rotaya yazılır; ileti metni kısaltılır ve kanıta yalnız tür+kısa metin girer.
  let currentErrors=[];const clip=s=>String(s).replace(/\s+/g," ").slice(0,200);
  cdp.on(m=>{if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error")currentErrors.push(`console.error: ${clip(m.params.args.map(a=>a.value??a.description??"").join(" "))}`);else if(m.method==="Runtime.exceptionThrown")currentErrors.push(`exception: ${clip(m.params.exceptionDetails?.exception?.description??m.params.exceptionDetails?.text)}`);else if(m.method==="Log.entryAdded"&&m.params.entry.level==="error")currentErrors.push(`log: ${clip(m.params.entry.text)}`)});
  await cdp.send("Runtime.enable");await cdp.send("Log.enable");await cdp.send("Page.enable");
  const probe=async()=>{const r=await cdp.send("Runtime.evaluate",{expression:PAGE_PROBE,returnByValue:true});return r.result?.value??{}};
  // //TR: İlk açılış sihirbazı modal'ı rotaları örter; kullanıcı gibi gerçek Escape tuşuyla atlanır (sihirbaz Escape'i skip sayar) ve kapandığı doğrulanır; kapanmazsa rotalar modal engelli diye FAIL olur.
  for(let i=0;i<40;i++){const p=await probe();if(p.mainPresent&&p.busy!=="true")break;await sleep(250)}
  if((await probe()).modalOpen){for(const type of ["keyDown","keyUp"])await cdp.send("Input.dispatchKeyEvent",{type,key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await sleep(500);evidence.setup.firstRunWizard=(await probe()).modalOpen?"FAIL_NOT_DISMISSED":"VERIFIED_DISMISSED_VIA_ESCAPE"}else evidence.setup.firstRunWizard="NOT_SHOWN";
  // 3) Her rota: gerçek hash gezintisi (kullanıcı gibi), yerleşme bekleme, doğrulama, ekran görüntüsü.
  for(const route of ROUTES){
    currentErrors=[];const t0=Date.now(),rec={id:route.id,hash:route.hash,view:route.view,component:route.component??null,status:"NOT_VERIFIED",loaded:false,assertions:[],consoleErrors:[],timingMs:null,screenshot:null,reason:null};
    try{
      await cdp.send("Runtime.evaluate",{expression:`location.hash=${JSON.stringify(route.hash)}`});
      let p={};const deadline=Date.now()+20000;let stable=0;while(Date.now()<deadline){await sleep(250);p=await probe();if(p.mainPresent&&p.hash===route.hash&&p.busy!=="true"&&p.textLength>0)stable++;else stable=0;if(stable>=3)break}
      rec.timingMs=Date.now()-t0;rec.loaded=stable>=3;
      const a=(name,ok,detail)=>rec.assertions.push({name,result:ok?"PASS":"FAIL",...(ok?{}:{detail})});
      if(!rec.loaded){rec.reason=`Route did not settle (aria-busy/hash/empty main) within 20s; main text length=${p.textLength??0}`;}
      else{
        a("hash-matches-route",p.hash===route.hash,`hash=${p.hash}`);
        a("no-blocking-modal",!p.modalOpen,"a dialog[open] covers the route");
        a("preload-bridge-present",p.bridge===true,"window.uasco.apiGet/apiPost missing");
        a("view-has-heading",p.headings>0,"no h1/h2 rendered in main");
        a("no-raw-i18n-keys",p.rawKeyLeaks===0,`${p.rawKeyLeaks} element(s) show raw translation keys`);
        a("no-undefined-or-NaN-text",!p.undefinedLeak,"main text contains undefined/[object Object]/NaN");
        a("no-fabricated-product-verified-claim",!p.productVerifiedClaim,"main text claims PRODUCT_VERIFIED");
        a("control-api-state-shown",String(p.api).trim().length>0,"ctxApi shows no state");
      }
      await sleep(300);
      rec.consoleErrors=[...new Set(currentErrors)];
      try{const shot=await cdp.send("Page.captureScreenshot",{format:"png"});const f=`${route.id}.png`;fs.writeFileSync(path.join(outDir,f),Buffer.from(shot.data,"base64"));rec.screenshot=f}catch(e){rec.reason=(rec.reason?rec.reason+"; ":"")+`screenshot failed: ${clip(e.message)}`}
      if(!rec.loaded)rec.status="NOT_VERIFIED";else rec.status=rec.assertions.some(x=>x.result==="FAIL")||rec.consoleErrors.length?"FAIL":"PASS";
    }catch(e){rec.status="NOT_VERIFIED";rec.reason=`harness error: ${clip(e.message)}`;rec.consoleErrors=[...new Set(currentErrors)];if(rec.consoleErrors.length)rec.status="FAIL"}
    evidence.routes.push(rec);
  }
  cdp.close();
  finish(null);
}catch(e){finish(`HARNESS_ERROR: ${String(e?.message??e).slice(0,200)}`)}
