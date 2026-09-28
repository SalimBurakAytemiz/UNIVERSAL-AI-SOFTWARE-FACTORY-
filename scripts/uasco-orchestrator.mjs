// //TR: Bu script UASCO'nun gözetimsiz inşa orkestratörüdür (Windows Task Scheduler ile periyodik ve oturum açılışında çalışır): kontrol düzleminin trust-root'unu doğrular, Global Stop'a uyar, tek süreç kilidi + lease alır, hash zincirli geçiş günlüğünü doğrular, yarım kalan eylemleri toparlar ve kalıcı kuyruktan bağımlılık farkında bir tick yürütür; yalnız config/orchestrator-policy.json kökleri ve automation/lib/command-contracts.mjs sözleşmeleri içinde çalışır, Founder kararı bekleyen iş yalnız kendi hattını durdurur.
// usage: node scripts/uasco-orchestrator.mjs --repo <constructionRepo> [--tick | --status | --founder-manual-quota-reset <codex|claude>]
import fs from "node:fs";import path from "node:path";import os from "node:os";import crypto from "node:crypto";import {fileURLToPath} from "node:url";
import {expandPolicyPaths,createContractRunner} from "../automation/lib/command-contracts.mjs";
import {loadState,commitTransition,verifyTransitionLog,acquireLease,heartbeat,releaseLease} from "../automation/lib/orchestrator-state.mjs";
import {runTick,recoverInFlight,nextAction} from "../automation/lib/orchestrator-engine.mjs";
import {createExecutors} from "../automation/lib/orchestrator-executors.mjs";
import {acquireProcessLock} from "../automation/lib/process-lock.mjs";import {verifyTrustRoot} from "../automation/lib/trust-root.mjs";import {globalStopState} from "../automation/lib/global-stop.mjs";
const controlPlaneRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),argv=process.argv.slice(2),arg=n=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:null};
const repo=path.resolve(arg("--repo")??process.env.UASCO_REPO??""),workerId=`${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
const readJson=f=>JSON.parse(fs.readFileSync(f,"utf8"));
let policy=null,release=null;
function out(obj,code){try{release?.()}catch{}release=null;const line=JSON.stringify({at:new Date().toISOString(),workerId,...obj},null,2);console.log(line);try{const d=path.join(policy?.roots?.controlRoot??os.tmpdir(),"logs");fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,"last-tick.json"),line+"\n");fs.appendFileSync(path.join(d,"ticks.jsonl"),JSON.stringify(JSON.parse(line))+"\n")}catch{}process.exit(code)}
if(!arg("--repo")&&!process.env.UASCO_REPO)out({status:"USAGE",usage:"--repo <constructionRepo> [--tick|--status|--founder-manual-quota-reset <provider>]"},2);
policy=expandPolicyPaths(readJson(path.join(controlPlaneRoot,"config/orchestrator-policy.json")),{repo});
// //TR: Mühürlü ve doğrulanmış olmayan bir kontrol düzlemi hiçbir eylem yapmaz.
const tr=verifyTrustRoot(controlPlaneRoot);if(!tr.ok)out({status:"CONTROL_PLANE_TRUST_ROOT_INVALID",mismatches:tr.mismatches.slice(0,5)},2);
function summarize(c){if(!c)return null;return {packages:Object.fromEntries(c.order.map(id=>[id,{status:c.packages[id].status,cycle:c.packages[id].cycle,nextAction:c.packages[id].nextAction??null,blockedReason:c.packages[id].blockedReason??null,classification:c.packages[id].classification??null,notBefore:c.packages[id].notBefore??null}])),releases:Object.fromEntries(Object.entries(c.releases??{}).map(([k,r])=>[k,{status:r.status,nextAction:r.nextAction??null,blockedReason:r.blockedReason??null,signerReason:r.signerReason??null}])),providers:c.providers??{},phase0:c.phase0?{accepted:c.phase0.accepted??false,final:c.phase0.final??null,attempts:c.phase0.attempts?.length??0}:null,github:c.github??null,next:nextAction(c,new Date())}}
if(argv.includes("--status")){const {control}=loadState(policy.roots.stateFile);out({status:"STATUS",summary:summarize(control)},0)}
if(globalStopState(path.join(repo,".ai/runtime/GLOBAL_STOP.json")))out({status:"GLOBAL_STOP_ACTIVE"},0);
try{release=acquireProcessLock(path.join(policy.roots.controlRoot,"orchestrator.lock"),workerId)}catch(e){if(/ALREADY_RUNNING/.test(String(e.message)))out({status:"ALREADY_RUNNING"},0);out({status:"LOCK_FAIL_CLOSED",reason:String(e.message)},2)}
try{
  let {doc,control}=loadState(policy.roots.stateFile);if(!control)out({status:"NO_CONTROL_STATE"},0);
  const log=verifyTransitionLog(policy.roots.transitionLog,control);if(!log.ok)out({status:"TRANSITION_LOG_INVALID",reason:log.reason},2);
  const ttl=policy.tick.leaseTtlMinutes*60_000,lease=acquireLease(control,{workerId,now:new Date(),ttlMs:ttl});if(!lease.ok)out({status:"LEASE_HELD",holder:lease.holder},0);
  const commit=(next,event)=>{const r=commitTransition({stateFile:policy.roots.stateFile,logFile:policy.roots.transitionLog,doc,next,event});doc=r.doc;return r.control};
  const persist=(next,event)=>commit(heartbeat({...next,lease:next.lease??control.lease},{workerId,now:new Date(),ttlMs:ttl}),event);
  control=commit(lease.control,{type:"LEASE_ACQUIRED",reason:lease.stale?`STALE_LEASE_TAKEN_OVER:${lease.previous.workerId}`:null});
  const rec=recoverInFlight(control,workerId);if(rec.recovered.length)control=persist(rec.control,{type:"INFLIGHT_RECOVERED",evidence:rec.recovered});
  const prov=arg("--founder-manual-quota-reset");if(prov){if(!["codex","claude"].includes(prov))out({status:"USAGE",reason:"provider must be codex or claude"},2);control=persist({...control,providers:{...(control.providers??{}),[prov]:{status:"PROBE_PENDING_FOUNDER_RESET",retryAfter:null,manualResetAt:new Date().toISOString()}}},{type:"FOUNDER_MANUAL_QUOTA_RESET",packageId:prov,reason:"stale retryAfter invalidated; one controlled probe"})}
  const runner=createContractRunner({policy,repo});
  // //TR: GitHub durumu günde bir kez dürüstçe kaydedilir; branch protection yoksa yerel mod ve kuyrukta bekleyen push olarak kalır, taklit edilmez.
  if(!control.github?.checkedAt||Date.now()-Date.parse(control.github.checkedAt)>86_400_000){const a=runner.run("gh.authStatus"),v=runner.run("gh.repoView"),bp=runner.run("gh.branchProtection");let repoInfo=null;try{repoInfo=JSON.parse(v.stdout)}catch{}const account=(`${a.stdout}\n${a.stderr}`.match(/account ([A-Za-z0-9-]+)/)??[])[1]??null;
    const protection=bp.status===0?"PRESENT_UNVERIFIED_RULES":/Upgrade to GitHub Pro/i.test(bp.stdout+bp.stderr)?"UNAVAILABLE_PLAN_LIMIT":/not protected/i.test(bp.stdout+bp.stderr)?"NOT_CONFIGURED":"UNKNOWN";
    control=persist({...control,github:{checkedAt:new Date().toISOString(),account,expectedOwner:policy.github.expectedOwner,ownerMatches:account===policy.github.expectedOwner,repository:repoInfo?.nameWithOwner??null,visibility:repoInfo?.visibility??null,remote:repoInfo?.url??null,remoteMatches:repoInfo?.url===policy.github.expectedRemote,branchProtection:protection,constructionRepoPush:"QUEUED_REMOTE_PROTECTION_POLICY"}},{type:"GITHUB_STATUS",reason:protection})}
  const executors=createExecutors({policy,repo,runner,controlPlaneRoot});
  const t=await runTick({control,executors,persist,policy,workerId});control=t.control;
  control=commit(releaseLease(control,{workerId}),{type:"LEASE_RELEASED"});
  out({status:"TICK_DONE",done:t.done,summary:summarize(control)},0);
}finally{try{release?.()}catch{}}
