// //TR: Bu yardımcı BS1 selftest senaryolarını doğrulama adımlarına bölen tek kaynaktır: her senaryo tam olarak bir kabukta (shard) yer alır, kabuk içindeki gruplar en çok iki eşzamanlı alt süreç olarak çalışır ve kabuğun her senaryosu PASS olmak zorundadır. Kapsam bütünlüğünü tests/pkg-vs-validation-sharding.test.ts denetler.
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export type Bs1Shard="a"|"b"|"c"|"d"|"e"|"f";
export const BS1_PARTITION:Record<Bs1Shard,string[][]>={
  a: [
    ["bootstrap-task-rollback-falls-back-to-disable-and-reports-an-unsafe-result"],
    ["entry-runs-the-tick-loop-timeout-cleanup-and-governed-upgrade-on-the-real-aut1b-plane"]
  ],
  b: [
    ["entry-never-runs-the-old-tick-once-master-has-the-launcher-and-upgrades-only-when-governed"],
    ["entry-stops-the-old-tick-once-a-governed-launcher-merge-lands-and-recovers-an-unrecorded-merge"]
  ],
  c: [
    ["static-safety-of-the-bootstrap-wrapper-and-entry",
     "bootstrap-installs-plane-entry-wrapper-activation-task-definition-and-record",
     "the-scheduled-task-command-line-round-trips-paths-with-spaces-ampersands-and-quotes",
     "bootstrap-first-run-verdict-fails-a-failed-tick-and-confirms-delegation-only-from-a-fresh-daemon-heartbeat",
     "bootstrap-refuses-unsafe-or-unverifiable-inputs-without-activating-anything"],
    ["entry-stops-the-old-tick-only-at-a-safe-point-or-at-once-in-the-release-lane"]
  ],
  d: [
    ["bootstrap-task-registration-succeeds-or-rolls-back-without-a-runnable-task"],
    ["bootstrap-task-first-run-failure-stops-and-rolls-back-the-task"]
  ],
  e: [
    ["bootstrap-repairs-an-inactive-half-cloned-plane-and-replaces-a-dangling-link",
     "entry-delegates-to-a-governed-plane-entry-and-to-the-launcher",
     "entry-heartbeat-watch-needs-two-stale-polls-ignores-suspend-and-reads-the-backup",
     "entry-heals-an-interrupted-link-switch-and-refuses-broken-or-unproven-planes",
     "entry-loops-the-pre-launcher-tick-writes-passive-status-and-honours-global-stop",
     "entry-records-the-top-level-tick-status-and-keeps-the-bootstrap-record-in-its-mirror"],
    ["entry-kills-a-hung-supervisor-whose-heartbeat-is-frozen",
     "entry-refuses-an-old-plane-release-lane-and-honours-global-stop",
     "entry-kills-the-whole-tick-process-tree-on-timeout-and-clears-its-lock",
     "entry-clears-only-provably-stale-locks-and-replaces-a-dangling-link"]
  ],
  f: [
    ["entry-generation-2-liveness-heartbeat-work-conserving-loop-dead-lease-and-single-instance"],
    ["bootstrap-task-upgrade-and-watchdog-rollback-never-re-enable-a-rolled-back-task"]
  ],
};
export const BS1_REAL_AUT1B_SCENARIO="entry-runs-the-tick-loop-timeout-cleanup-and-governed-upgrade-on-the-real-aut1b-plane";
export const AUT1B_COMMIT="f3b4ad87d7c297a5649c5072debe58675fc1422f";
export function bs1Scenarios(source:string):string[]{return [...source.matchAll(/scenario\("([^"]+)"/g)].map(m=>m[1])}
// //TR: Bölümleme kontrolü saf bir fonksiyondur: selftest kaynağındaki her senaryo tam bir kez atanmış olmalı, fazladan veya yinelenen atama olmamalı ve hiçbir ad başka bir adın öneki olmamalıdır (UASCO_BS1_ONLY önek eşleştirir).
export function checkBs1Partition(partition:Record<string,string[][]>,source:string):string[]{
  const errors:string[]=[],all=bs1Scenarios(source),assigned=Object.values(partition).flat(2),count=new Map<string,number>();
  for(const n of assigned)count.set(n,(count.get(n)??0)+1);
  for(const n of all)if(!count.has(n))errors.push("scenario-not-assigned:"+n);
  for(const [n,c] of count){if(!all.includes(n))errors.push("assigned-scenario-not-in-selftest:"+n);if(c>1)errors.push("scenario-assigned-twice:"+n)}
  if(new Set(all).size!==all.length)errors.push("duplicate-scenario-name-in-selftest");
  for(const a of all)for(const b of all)if(a!==b&&b.startsWith(a))errors.push("scenario-name-is-prefix-of-another:"+a);
  return errors;
}
// //TR: GitHub-hosted Windows runner işi yükseltilmiş (Administrator) çalıştırır; bootstrap bunu ürün kuralı olarak reddeder (MUST_RUN_UNELEVATED). Yalnız bu geçici runner'da selftest aynı kullanıcının yükseltilmemiş "Basic User" belirteciyle (runas /trustlevel:0x20000) çalıştırılır: bootstrap ve selftest değişmez, kontrol gevşetilmez, hiçbir senaryo atlanmaz. Geliştirici makinesinde veya self-hosted runner'da yükseltilmiş oturum dürüstçe başarısız olur.
export const deElevateOnHostedRunner=(env:NodeJS.ProcessEnv=process.env)=>env.GITHUB_ACTIONS==="true"&&env.RUNNER_ENVIRONMENT==="github-hosted";
const PS51=path.join(process.env.SystemRoot??"C:/Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
export function isElevatedWindows():boolean{
  if(process.platform!=="win32")return false;const env={...process.env};delete env.PSModulePath;
  const r=cp.spawnSync(PS51,["-NoProfile","-NonInteractive","-Command","([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],{encoding:"utf8",windowsHide:true,env});
  return r.status===0&&r.stdout.trim()==="True";
}
// //TR: 8.3 kısa TEMP yolu (ör. C:\Users\RUNNER~1) PS 5.1'in uzun yola açan GetFullPath'i ile Node'un path.resolve'u arasında kontrol kökü uyuşmazlığı üretir; alt sürece TEMP/TMP'nin gerçek uzun yolu verilir.
function childEnv(g:string[]):NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={...process.env,UASCO_BS1_SHARDS:"",UASCO_BS1_ONLY:g.join(",")};
  if(process.platform==="win32"){const t=fs.realpathSync.native(os.tmpdir());env.TEMP=t;env.TMP=t}
  return env;
}
// //TR: runas çıktıyı yakalamaz ve hemen döner; küçük sarmalayıcı selftest'i verilen ortamla çalıştırır, çıktıyı dosyaya yazar ve bitişi atomik bir işaret dosyasıyla bildirir.
const WRAPPER=`import cp from "node:child_process";import fs from "node:fs";
const j=JSON.parse(fs.readFileSync(process.argv[2],"utf8")),fd=fs.openSync(j.out,"w");
const r=cp.spawnSync(j.node,j.args,{cwd:j.cwd,env:j.env,stdio:["ignore",fd,fd],windowsHide:true});
if(r.error)fs.writeSync(fd,"\\nWRAPPER_SPAWN_ERROR "+r.error.message+"\\n");fs.closeSync(fd);
fs.writeFileSync(j.done+".tmp",String(r.status??1));fs.renameSync(j.done+".tmp",j.done);
`;
function runDeElevated(env:NodeJS.ProcessEnv):Promise<{code:number|null;out:string}>{
  const dir=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),"uasco-bs1-lua-")),e:NodeJS.ProcessEnv={};
  // //TR: Gizli değer taşıyabilecek adlar aktarılmaz; checkout Administrators'a ait olduğundan git'e yalnız bu checkout için komut kapsamlı safe.directory verilir (global/sistem yapılandırması değişmez).
  for(const [k,v] of Object.entries(env))if(v!==undefined&&!/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k))e[k]=v;
  const n=Number(e.GIT_CONFIG_COUNT??0)||0;e.GIT_CONFIG_COUNT=String(n+1);e[`GIT_CONFIG_KEY_${n}`]="safe.directory";e[`GIT_CONFIG_VALUE_${n}`]=process.cwd().replace(/\\/g,"/");
  const job={node:process.execPath,args:["scripts/bootstrap-autonomy-selftest.mjs"],cwd:process.cwd(),env:e,out:path.join(dir,"out.txt"),done:path.join(dir,"done.txt")},jobFile=path.join(dir,"job.json"),wrap=path.join(dir,"wrap.mjs");
  fs.writeFileSync(jobFile,JSON.stringify(job));fs.writeFileSync(wrap,WRAPPER);
  const finish=(code:number|null,out:string)=>{fs.rmSync(dir,{recursive:true,force:true});return {code,out}};
  return new Promise(res=>{
    const r=cp.spawn("runas",["/trustlevel:0x20000",`"${process.execPath}" "${wrap}" "${jobFile}"`],{windowsHide:true,stdio:"ignore"});
    r.on("error",err=>res(finish(null,"RUNAS_SPAWN_ERROR "+err.message)));
    r.on("close",rc=>{
      if(rc!==0)return res(finish(rc,"RUNAS_FAILED exit="+rc));
      const t0=Date.now(),iv=setInterval(()=>{
        if(fs.existsSync(job.done)){clearInterval(iv);const code=Number(fs.readFileSync(job.done,"utf8").trim());res(finish(Number.isInteger(code)?code:null,fs.readFileSync(job.out,"utf8")))}
        else if(Date.now()-t0>1_700_000){clearInterval(iv);res(finish(null,"DE_ELEVATED_SELFTEST_TIMEOUT "+(fs.existsSync(job.out)?fs.readFileSync(job.out,"utf8").slice(-2500):"")))}
      },1000);
    });
  });
}
function runDirect(env:NodeJS.ProcessEnv):Promise<{code:number|null;out:string}>{
  return new Promise(res=>{
    const c=cp.spawn(process.execPath,["scripts/bootstrap-autonomy-selftest.mjs"],{cwd:process.cwd(),env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let out="";c.stdout.on("data",d=>{out+=d});c.stderr.on("data",d=>{out+=d});c.on("close",code=>res({code,out}));
  });
}
// //TR: Bir kabuğun grupları ayrı alt süreçlerde paralel çalışır; her alt süreç selftest'i yalnız kendi senaryo adlarıyla (UASCO_BS1_ONLY) çağırır ve çıktıdaki her gerekli senaryonun PASS olması beklenir.
export async function runBs1Shard(shard:Bs1Shard):Promise<{ok:boolean;detail:string;line:string[];stdout:string}>{
  const groups=BS1_PARTITION[shard],lua=process.platform==="win32"&&deElevateOnHostedRunner()&&isElevatedWindows();
  const outs=await Promise.all(groups.map(g=>lua?runDeElevated(childEnv(g)):runDirect(childEnv(g))));
  const note=lua?"BS1_DE_ELEVATED: runas /trustlevel:0x20000 on an elevated github-hosted runner\n":"";
  return {ok:outs.every(o=>o.code===0),detail:note+outs.map(o=>"exit="+o.code+" "+o.out.slice(-2500)).join("\n---\n"),line:outs.map(o=>o.out.trim().split(/\r?\n/).pop()??""),stdout:outs.map(o=>o.out).join("\n")};
}
