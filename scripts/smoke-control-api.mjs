// //TR: Bu smoke script Control API'yi geçici portta gerçek process olarak başlatır, /health cevabını doğrular, sonucu kaydeder ve process'i temiz kapatır.
import cp from "node:child_process";
import fs from "node:fs";
const port=33210;
const env={...process.env,CONTROL_API_PORT:String(port),UASCO_CONTROL_TOKEN:"smoke-only-token"};
const child=cp.spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","apps/control-api/src/server.ts"],{cwd:process.cwd(),env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
let out="",err="";child.stdout.on("data",d=>out+=d);child.stderr.on("data",d=>err+=d);
let ok=false,detail="";
try{
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){const j=await r.json();if(j.status==="HEALTHY"){ok=true;break}}}catch{}
  await new Promise(r=>setTimeout(r,300));
 }
 detail=ok?"health endpoint returned HEALTHY":`startup/health failed ${err.slice(-1000)}`;
}finally{
 if(process.platform==="win32")cp.spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});else try{child.kill("SIGTERM")}catch{}
}
fs.mkdirSync(".ai/runtime",{recursive:true});
const report={"//TR":"Bu runtime report gerçek Control API startup/health smoke sonucunu kaydeder.",generatedAt:new Date().toISOString(),status:ok?"PASS":"FAIL",detail};
fs.writeFileSync(".ai/runtime/CONTROL_API_SMOKE.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));if(!ok)process.exit(1);
