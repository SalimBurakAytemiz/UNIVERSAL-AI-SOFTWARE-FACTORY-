// //TR: Bu helper uzun Claude/Codex/validation komutlarını spawn ile stream eder, redacted log yazar, output capture'ı sınırlar, timeout/Global Stop'ta process tree'yi kapatır ve failure classifier'a gerekli sonucu döndürür.
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {redactText} from "./redaction.mjs";
import {globalStopState} from "./global-stop.mjs";

export function requestProcessTreeStop(child,{platform=process.platform,graceMs=5000,onEvent=()=>{},spawnSyncFn=cp.spawnSync,killFn=process.kill,setTimer=setTimeout}={}){
  if(!child?.pid) return null;
  const pid=String(child.pid);
  try{
    if(platform==="win32"){
      onEvent("PROCESS_GRACEFUL_STOP_REQUESTED",{pid:child.pid,platform,graceMs});
      try{spawnSyncFn("taskkill",["/PID",pid,"/T"],{stdio:"ignore"})}catch{}
      const timer=setTimer(()=>{
        onEvent("PROCESS_HARD_KILL_FALLBACK",{pid:child.pid,platform});
        try{spawnSyncFn("taskkill",["/PID",pid,"/T","/F"],{stdio:"ignore"})}catch{}
      },graceMs);
      timer?.unref?.(); return timer;
    }
    onEvent("PROCESS_GRACEFUL_STOP_REQUESTED",{pid:child.pid,platform,graceMs});
    try{killFn(-child.pid,"SIGTERM")}catch{try{child.kill("SIGTERM")}catch{}}
    const timer=setTimer(()=>{
      onEvent("PROCESS_HARD_KILL_FALLBACK",{pid:child.pid,platform});
      try{killFn(-child.pid,"SIGKILL")}catch{try{child.kill("SIGKILL")}catch{}}
    },graceMs);
    timer?.unref?.(); return timer;
  }catch{return null}
}
function hardKillTree(child){
  if(!child?.pid)return;
  try{
    if(process.platform==="win32")cp.spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});
    else try{process.kill(-child.pid,"SIGKILL")}catch{try{child.kill("SIGKILL")}catch{}}
  }catch{}
}
class RedactedStreamWriter{
  constructor(file,maxBytes=10*1024*1024){
    this.file=file; this.maxBytes=maxBytes; this.written=0; this.tail="";
    fs.mkdirSync(path.dirname(file),{recursive:true});
  }
  write(chunk){
    this.tail+=String(chunk);
    if(this.tail.length<512) return;
    const emit=this.tail.slice(0,-256); this.tail=this.tail.slice(-256);
    this._writeSafe(emit);
  }
  end(){ if(this.tail){this._writeSafe(this.tail);this.tail=""} }
  _writeSafe(text){
    if(this.written>=this.maxBytes) return;
    const red=redactText(text);
    const b=Buffer.from(red,"utf8");
    const remain=this.maxBytes-this.written;
    if(b.length<=remain){fs.appendFileSync(this.file,b);this.written+=b.length}
    else{
      fs.appendFileSync(this.file,b.subarray(0,remain));
      fs.appendFileSync(this.file,"\n[LOG_TRUNCATED_BY_POLICY]\n","utf8");
      this.written=this.maxBytes;
    }
  }
}
export async function runCommand({
  cmd,args=[],cwd=process.cwd(),input="",timeoutMs=900000,env=process.env,
  logFile=null,maxCaptureBytes=4*1024*1024,maxLogBytes=10*1024*1024,
  globalStopFile=null,globalStopGraceMs=5000,onEvent=()=>{}
}){
  const started=Date.now();
  const writer=logFile?new RedactedStreamWriter(logFile,maxLogBytes):null;
  let stdout="",stderr="",timedOut=false,stopped=false,finished=false,stopInitiated=false,stopFallbackTimer=null;
  const cap=(current,chunk)=>{
    if(Buffer.byteLength(current,"utf8")>=maxCaptureBytes) return current;
    const combined=current+redactText(String(chunk));
    return Buffer.byteLength(combined,"utf8")<=maxCaptureBytes?combined:combined.slice(0,maxCaptureBytes);
  };
  return await new Promise((resolve)=>{
    let child;
    try{
      child=cp.spawn(cmd,args,{cwd,env,detached:process.platform!=="win32",windowsHide:true,stdio:["pipe","pipe","pipe"]});
    }catch(error){
      resolve({status:null,stdout,stderr,error:error?.message,durationMs:Date.now()-started,timedOut:false,globalStopped:false});
      return;
    }
    onEvent("PROCESS_STARTED",{pid:child.pid,cmd,args});
    child.stdout.on("data",d=>{stdout=cap(stdout,d);writer?.write(d)});
    child.stderr.on("data",d=>{stderr=cap(stderr,d);writer?.write(d)});
    child.on("error",e=>{stderr=cap(stderr,e.message)});
    if(input) child.stdin.write(input);
    child.stdin.end();

    const stopTimer=globalStopFile?setInterval(()=>{
      if(globalStopState(globalStopFile)&&!stopInitiated){
        stopped=true;stopInitiated=true;onEvent("GLOBAL_STOP_GRACEFUL",{pid:child.pid,graceMs:globalStopGraceMs});
        stopFallbackTimer=requestProcessTreeStop(child,{graceMs:globalStopGraceMs,onEvent});
      }
    },1000):null;
    const timer=setTimeout(()=>{
      timedOut=true; onEvent("PROCESS_TIMEOUT",{pid:child.pid,timeoutMs}); hardKillTree(child);
    },timeoutMs);

    child.on("close",(code,signal)=>{
      if(finished)return;finished=true;
      clearTimeout(timer); if(stopTimer)clearInterval(stopTimer); if(stopFallbackTimer)clearTimeout(stopFallbackTimer); writer?.end();
      resolve({status:code,signal,stdout,stderr,error:null,durationMs:Date.now()-started,timedOut,globalStopped:stopped,pid:child.pid});
    });
  });
}
