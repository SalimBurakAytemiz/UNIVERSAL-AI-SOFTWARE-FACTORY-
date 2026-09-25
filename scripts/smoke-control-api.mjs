// //TR: Bu smoke script Control API'yi izole child env ile gerçek process olarak başlatır; localhost challenge-proof kimliğini, auth reddini ve authenticated read erişimini doğrular.
import cp from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import {safeChildEnv} from "../automation/lib/env-policy.mjs";
import {controlChallengeProof,secureStringEqual} from "../automation/lib/control-boundary.mjs";
const port=33210,token=crypto.randomBytes(32).toString("hex"),env={...safeChildEnv("config/environment-policy.json",{provider:"DETERMINISTIC"}),CONTROL_API_PORT:String(port),UASCO_CONTROL_TOKEN:token};
const child=cp.spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","apps/control-api/src/server.ts"],{cwd:process.cwd(),env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
let out="",err="";child.stdout.on("data",d=>out+=d);child.stderr.on("data",d=>err+=d);let ok=false,detail="";
try{
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  try{const challenge=crypto.randomBytes(32).toString("hex"),r=await fetch(`http://127.0.0.1:${port}/health?challenge=${challenge}`,{redirect:"error"});if(r.ok){const j=await r.json(),expected=controlChallengeProof(token,challenge);if(j.status==="HEALTHY"&&j.bindHost==="127.0.0.1"&&j.port===port&&secureStringEqual(String(j.controlProof??""),String(expected??""))){const denied=await fetch(`http://127.0.0.1:${port}/v1/factory`,{redirect:"error"}),allowed=await fetch(`http://127.0.0.1:${port}/v1/factory`,{redirect:"error",headers:{"x-uasco-control-token":token}});if(denied.status===403&&allowed.ok){ok=true;break}}}}catch{}
  await new Promise(r=>setTimeout(r,300));
 }
 detail=ok?"challenge-proof identity + auth boundary verified":`startup/identity/auth failed ${err.slice(-1000)}`;
}finally{if(process.platform==="win32")cp.spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});else try{child.kill("SIGTERM")}catch{}}
fs.mkdirSync(".ai/runtime",{recursive:true});const report={"//TR":"Bu runtime report gerçek Control API startup, challenge-proof server identity ve auth boundary smoke sonucunu kaydeder.",generatedAt:new Date().toISOString(),status:ok?"PASS":"FAIL",detail};fs.writeFileSync(".ai/runtime/CONTROL_API_SMOKE.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(!ok)process.exit(1);
