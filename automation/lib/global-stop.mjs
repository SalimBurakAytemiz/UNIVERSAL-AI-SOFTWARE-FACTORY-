// //TR: Bu helper Founder Global Stop dosyasını authoritative runtime signal olarak okur/yazar; scheduler yeni iş başlatmaz ve command runner aktif child process'i durdurabilir.
import fs from "node:fs";
import path from "node:path";
import {writeJsonAtomic,clearJsonAtomic} from "./atomic-json.mjs";

export function globalStopState(file){
  // //TR: Stop artifact mevcut fakat okunamıyor/geçersizse bunu "stop yok" saymak fail-open olur; bozuk state güvenli tarafta aktif stop kabul edilir.
  let sawArtifact=false;for(const f of [file,`${file}.prev`]){if(!fs.existsSync(f))continue;sawArtifact=true;try{const x=JSON.parse(fs.readFileSync(f,"utf8"));if(x&&x.active===true)return x}catch{}}
  return sawArtifact?{active:true,reason:"GLOBAL_STOP_STATE_INVALID_FAIL_CLOSED",actor:"SYSTEM"}:null;
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
  clearJsonAtomic(file);
  return {active:false,clearedAt:new Date().toISOString(),actor};
}
