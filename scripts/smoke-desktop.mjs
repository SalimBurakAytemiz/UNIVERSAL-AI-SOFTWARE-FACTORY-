// //TR: Bu smoke script Electron Desktop shell'i UASCO_SMOKE modunda gerçek process olarak başlatır ve main process'in ready marker üretmesini bekleyerek target-machine masaüstü açılışını doğrular.
import cp from "node:child_process";
import fs from "node:fs";
const marker=".ai/runtime/DESKTOP_SMOKE_READY.json";try{fs.rmSync(marker,{force:true})}catch{}
const electron=process.platform==="win32"?"node_modules\\.bin\\electron.cmd":"node_modules/.bin/electron";
const child=cp.spawn(electron,["apps/desktop/main.mjs"],{cwd:process.cwd(),env:{...process.env,UASCO_SMOKE:"1"},windowsHide:true,stdio:["ignore","pipe","pipe"],shell:process.platform==="win32"});
let err="";child.stderr.on("data",d=>err+=d);
const deadline=Date.now()+20000;let ok=false;
while(Date.now()<deadline){if(fs.existsSync(marker)){ok=true;break}await new Promise(r=>setTimeout(r,300))}
if(process.platform==="win32")cp.spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});else try{child.kill("SIGTERM")}catch{}
const report={"//TR":"Bu runtime report Electron Desktop startup smoke sonucunu kaydeder.",generatedAt:new Date().toISOString(),status:ok?"PASS":"FAIL",detail:ok?"desktop ready marker received":err.slice(-1200)};
fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/DESKTOP_SMOKE.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));if(!ok)process.exit(1);
