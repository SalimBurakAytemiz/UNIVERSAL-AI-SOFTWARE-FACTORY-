// //TR: Bu protected validator Global Stop graceful/hard fallback, scheduler .prev recovery ve release-critical evidence retention/export davranışlarını adversarial fixture ile doğrular.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {requestProcessTreeStop} from "../automation/lib/command-runner.mjs";
import {saveSchedulerState,loadSchedulerState,validateSchedulerState} from "../automation/lib/scheduler.mjs";
import {RunLedger,cleanupOldRuns} from "../automation/lib/run-ledger.mjs";

const checks=[];let failed=0;
function ok(name,value,detail=""){checks.push({name,pass:Boolean(value),detail});if(!value){failed++;console.error(`FAIL ${name}${detail?`: ${detail}`:""}`)}}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-2i-"));
try{
  // Windows yolu gerçek Windows gerektirmeden adapter üzerinden sıralı doğrulanır.
  const calls=[],events=[];let fallback=null;
  const fakeChild={pid:4242};
  requestProcessTreeStop(fakeChild,{platform:"win32",graceMs:321,onEvent:(e,d)=>events.push([e,d]),spawnSyncFn:(cmd,args)=>{calls.push([cmd,args]);return {status:0}},setTimer:(fn,ms)=>{fallback=fn;return {unref(){},ms}}});
  ok("windows-graceful-first",calls.length===1&&calls[0][0]==="taskkill"&&calls[0][1].join(" ")==="/PID 4242 /T",JSON.stringify(calls));
  ok("windows-grace-event",events.some(([e])=>e==="PROCESS_GRACEFUL_STOP_REQUESTED"));
  ok("windows-bounded-grace",fallback&&typeof fallback==="function");
  fallback?.();
  ok("windows-hard-fallback",calls.length===2&&calls[1][1].join(" ")==="/PID 4242 /T /F",JSON.stringify(calls));
  ok("windows-hard-event",events.some(([e])=>e==="PROCESS_HARD_KILL_FALLBACK"));

  // Scheduler current bozulduğunda yalnız valid .prev kabul edilir; iki kopya da bozuksa fail-closed.
  const stateFile=path.join(temp,"scheduler-state.json");
  const makeState=()=>({schemaVersion:"1.0.0",phases:Array.from({length:149},(_,phase)=>({phase,status:"PENDING",attempts:0,lastRunId:null,completedCommit:null,evidenceRefs:[]})),active:[],blocked:[],updatedAt:null});
  const s1=makeState();saveSchedulerState(stateFile,s1);
  const s2=structuredClone(s1);s2.phases[1].attempts=1;saveSchedulerState(stateFile,s2);
  ok("scheduler-prev-created",fs.existsSync(`${stateFile}.prev`));
  fs.writeFileSync(stateFile,"{broken-json\n");
  const recovered=loadSchedulerState(stateFile);
  ok("scheduler-recovers-prev",recovered.phases[1].attempts===0);
  ok("scheduler-restores-main",validateSchedulerState(JSON.parse(fs.readFileSync(stateFile,"utf8"))).ok);
  ok("scheduler-preserves-valid-prev",validateSchedulerState(JSON.parse(fs.readFileSync(`${stateFile}.prev`,"utf8"))).ok);
  fs.writeFileSync(stateFile,JSON.stringify({...makeState(),phases:[]}));
  const recoveredInvalid=loadSchedulerState(stateFile);
  ok("scheduler-rejects-invalid-current",recoveredInvalid.phases.length===149);
  fs.writeFileSync(stateFile,"{bad\n");fs.writeFileSync(`${stateFile}.prev`,"{also-bad\n");
  let unrecoverable=false;try{loadSchedulerState(stateFile)}catch(e){unrecoverable=String(e.message).includes("SCHEDULER_STATE_UNRECOVERABLE")}
  ok("scheduler-double-corruption-fail-closed",unrecoverable);

  // Signed COMPLETE run retention sınırını aşsa bile export edilir ve silinmez.
  const kp=crypto.generateKeyPairSync("ed25519"),priv=path.join(temp,"priv.pem"),pub=path.join(temp,"pub.pem");
  fs.writeFileSync(priv,kp.privateKey.export({format:"pem",type:"pkcs8"}));fs.writeFileSync(pub,kp.publicKey.export({format:"pem",type:"spki"}));
  const runs=path.join(temp,"runs"),exportsDir=path.join(temp,"exports");fs.mkdirSync(runs,{recursive:true});
  const critical=new RunLedger(runs,"RUN-CRITICAL",{signingKeyFile:priv});critical.event("release","DONE",{ok:true});critical.writeSummary({status:"COMPLETE"});
  const normal=new RunLedger(runs,"RUN-NORMAL",{signingKeyFile:priv});normal.event("test","FAIL",{});normal.writeSummary({status:"FATAL"});
  const manual=new RunLedger(runs,"RUN-MANUAL-HOLD",{signingKeyFile:priv});manual.event("test","HOLD",{});manual.writeSummary({status:"FATAL"});fs.writeFileSync(path.join(manual.dir,".release-evidence-hold.json"),JSON.stringify({active:true,reason:"release investigation"}));
  const unsignedDir=path.join(runs,"RUN-UNSIGNED-FAKE");fs.mkdirSync(unsignedDir,{recursive:true});fs.writeFileSync(path.join(unsignedDir,"summary.json"),JSON.stringify({status:"COMPLETE"}));
  const old=new Date(Date.now()-10*86400000);for(const d of [critical.dir,normal.dir,manual.dir,unsignedDir])fs.utimesSync(d,old,old);
  const policy={criticalSummaryStatuses:["COMPLETE"],manualHoldMarker:".release-evidence-hold.json",autoExportCritical:true,deleteCriticalAfterExport:false,requireSignedSummaryForAutomaticHold:true};
  const result=cleanupOldRuns(runs,1,500,{policy,exportRoot:exportsDir,publicKeyFile:pub});
  ok("critical-run-preserved",fs.existsSync(critical.dir),JSON.stringify(result));
  ok("critical-run-exported",fs.existsSync(path.join(exportsDir,"RUN-CRITICAL","EXPORT-MANIFEST.json")));
  ok("manual-hold-preserved",fs.existsSync(manual.dir));
  ok("manual-hold-exported",fs.existsSync(path.join(exportsDir,"RUN-MANUAL-HOLD","EXPORT-MANIFEST.json")));
  ok("normal-old-run-pruned",!fs.existsSync(normal.dir));
  ok("unsigned-fake-complete-not-trusted",!fs.existsSync(unsignedDir));
  const exportManifest=JSON.parse(fs.readFileSync(path.join(exportsDir,"RUN-CRITICAL","EXPORT-MANIFEST.json"),"utf8"));
  ok("export-includes-signed-summary",exportManifest.files.some(x=>x.path==="summary.json"));

  const cfg=JSON.parse(fs.readFileSync("config/automation.json","utf8"));
  const retention=JSON.parse(fs.readFileSync(cfg.evidence.retentionPolicy,"utf8"));
  ok("global-stop-grace-configured",Number.isInteger(cfg.globalStop.gracefulTimeoutMs)&&cfg.globalStop.gracefulTimeoutMs>0);
  ok("retention-policy-wired",retention.deleteCriticalAfterExport===false&&cfg.evidence.exportRoot===retention.exportRoot);
  const validation=JSON.parse(fs.readFileSync("config/validation.json","utf8"));
  ok("canonical-validation-wired",validation.steps.some(x=>x.id==="runtime-resilience"&&x.command?.[1]==="scripts/validate-runtime-resilience.mjs"));
} finally {fs.rmSync(temp,{recursive:true,force:true})}
console.log(`RUNTIME_RESILIENCE_VALIDATION: ${failed?"FAIL":"PASS"} ${checks.filter(x=>x.pass).length}/${checks.length}`);
if(failed)process.exit(1);
