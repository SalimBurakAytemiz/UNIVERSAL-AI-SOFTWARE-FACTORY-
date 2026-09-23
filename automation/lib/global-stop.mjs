// //TR: Bu helper Founder Global Stop dosyasını authoritative runtime signal olarak okur/yazar; scheduler yeni iş başlatmaz ve command runner aktif child process'i durdurabilir.
import fs from "node:fs";
import path from "node:path";
import {writeJsonAtomic,readJsonIfExists} from "./atomic-json.mjs";

export function globalStopState(file){
  const x=readJsonIfExists(file,null);
  return x?.active===true?x:null;
}
export function assertNotStopped(file){
  const x=globalStopState(file);
  if(x) { const e=new Error(`GLOBAL_STOP_ACTIVE: ${x.reason??"Founder stop"}`); e.code="GLOBAL_STOP"; throw e; }
}
export function activateGlobalStop(file,reason="Founder requested stop",actor="FOUNDER"){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  writeJsonAtomic(file,{"//TR":"Bu runtime signal yeni iş başlatılmasını ve destekleyen runner'larda aktif child process'in devam etmesini durdurur.",active:true,reason,actor,activatedAt:new Date().toISOString()});
}
export function clearGlobalStop(file,actor="FOUNDER"){
  if(fs.existsSync(file)) fs.rmSync(file,{force:true});
  return {active:false,clearedAt:new Date().toISOString(),actor};
}
