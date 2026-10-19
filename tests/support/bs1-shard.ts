// //TR: Bu yardımcı BS1 selftest senaryolarını doğrulama adımlarına bölen tek kaynaktır: her senaryo tam olarak bir kabukta (shard) yer alır, kabuk içindeki gruplar paralel alt süreçler olarak çalışır (e kabuğunda dört, diğerlerinde en çok iki), Windows'ta tek paylaşılan fikstür şablonunu kullanır ve kabuğun her senaryosu PASS olmak zorundadır. Kapsam bütünlüğünü tests/pkg-vs-validation-sharding.test.ts denetler.
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
  // //TR: e kabuğu (10 senaryo) Windows CI'da 600 sn adım sınırına dayandığı için (yavaş runner'da TIMED OUT) iki grup yerine dört paralel gruba bölünür; senaryo kümesi ve adım aynıdır (checkBs1Partition her senaryonun tam bir kez atandığını doğrular).
  e: [
    ["bootstrap-repairs-an-inactive-half-cloned-plane-and-replaces-a-dangling-link",
     "entry-delegates-to-a-governed-plane-entry-and-to-the-launcher",
     "entry-heartbeat-watch-needs-two-stale-polls-ignores-suspend-and-reads-the-backup"],
    ["entry-heals-an-interrupted-link-switch-and-refuses-broken-or-unproven-planes",
     "entry-loops-the-pre-launcher-tick-writes-passive-status-and-honours-global-stop",
     "entry-records-the-top-level-tick-status-and-keeps-the-bootstrap-record-in-its-mirror"],
    ["entry-kills-a-hung-supervisor-whose-heartbeat-is-frozen",
     "entry-refuses-an-old-plane-release-lane-and-honours-global-stop"],
    ["entry-kills-the-whole-tick-process-tree-on-timeout-and-clears-its-lock",
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
// //TR: Tek karar noktası (saf, test edilir): yalnız win32 + GitHub-hosted + gerçekten yükseltilmiş süreç; yükseltme sorgusu yalnız ilk iki koşul sağlanınca çalışır.
export const bs1DeElevate=(platform:string,env:NodeJS.ProcessEnv,elevated:()=>boolean)=>platform==="win32"&&deElevateOnHostedRunner(env)&&elevated();
const SYS32=path.join(process.env.SystemRoot??"C:/Windows","System32"),PS51=path.join(SYS32,"WindowsPowerShell","v1.0","powershell.exe");
// //TR: runas mutlak System32 yolundan çalıştırılır; yükseltilmiş süreç çalışma dizinindeki (PR checkout'u) bir runas.exe/.com'u asla bulmaz.
export const RUNAS=path.join(SYS32,"runas.exe");
export const runasArgv=(node:string,wrap:string,job:string)=>["/trustlevel:0x20000",`"${node}" "${wrap}" "${job}"`];
export function isElevatedWindows():boolean{
  if(process.platform!=="win32")return false;const env={...process.env};delete env.PSModulePath;
  const r=cp.spawnSync(PS51,["-NoProfile","-NonInteractive","-Command","([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],{encoding:"utf8",windowsHide:true,env});
  return r.status===0&&r.stdout.trim()==="True";
}
export type Bs1Template={dir:string;repo:string;full:string};
// //TR: Şablon verilmezse değişkenler boş geçer: alt süreç dışarıdan gelen bayat bir şablon yolunu devralmaz, şablonu kendisi kurar.
const childEnv=(g:string[],tpl:Bs1Template|null=null):NodeJS.ProcessEnv=>({...process.env,UASCO_BS1_SHARDS:"",UASCO_BS1_ONLY:g.join(","),UASCO_BS1_TEMPLATE_REPO:tpl?.repo??"",UASCO_BS1_TEMPLATE_HEAD:tpl?.full??""});
export const BS1_SELFTEST="scripts/bootstrap-autonomy-selftest.mjs";
// //TR: Paylaşılan fikstür şablonu: selftest'in parçalı tasarımı şablonun üst süreçte BİR KEZ kurulup gruplara salt okunur klon kaynağı olarak verilmesini öngörür (UASCO_BS1_TEMPLATE_REPO/HEAD; selftest şablonun TEMP altında olduğunu ve HEAD'ini kendisi doğrular). Kabuk koşucusu bunu vermediğinde her grup tüm depoyu yeniden kopyalayıp commit ediyordu (Windows CI'da grup başına senaryo dışı 60-210 sn).
// //TR: Kurucu program korunan selftest'in kendi gitIn/SKIP/copyTree/makeTemplate satırlarından BİREBİR oluşturulur (kopya kod yok, sapma olamaz) ve grup alt süreçleriyle AYNI bağlamda (gerekirse yükseltilmemiş) tek bir alt süreçte çalışır: fikstür ve dosya sahipliği selftest'in kendi kurduğuyla aynıdır, git güven ayarı (safe.directory) genişletilmez. Satırlardan biri bulunamazsa açık hata verilir; sessiz geri dönüş yoktur.
export function bs1TemplateBuilder(source:string):string{
  const pick=(re:RegExp,what:string)=>{const m=source.match(re);if(!m)throw new Error("BS1_TEMPLATE_BUILDER_SOURCE_MISSING:"+what);return m[0].replace(/\r$/,"")};
  return ['import fs from "node:fs";import os from "node:os";import path from "node:path";import cp from "node:child_process";',"const UASCO=process.cwd();",
    pick(/^const gitIn=.*$/m,"gitIn"),pick(/^const SKIP=new Set\(.*$/m,"SKIP"),pick(/^function copyTree\(.*$/m,"copyTree"),pick(/^function makeTemplate\(\)\{.*$/m,"makeTemplate"),
    'const t=makeTemplate();process.stdout.write("BS1_TEMPLATE "+JSON.stringify({dir:t.dir,repo:t.repo,full:t.full})+"\\n");'].join("\n");
}
// //TR: Kurucunun bildirdiği şablon yalnız beklenen biçimdeyse kabul edilir (TEMP'in hemen altında uasco-bs1-tpl-* dizini, içinde "template repo", 40/64 haneli HEAD); aksi halde null döner ve kabuk başarısız olur. Silme yalnız bu doğrulanmış dizine uygulanır.
export function parseBs1Template(json:string,tmp:string=os.tmpdir()):Bs1Template|null{
  let t:unknown;try{t=JSON.parse(json)}catch{return null}
  const o=t as Partial<Bs1Template>|null;if(!o||typeof o.dir!=="string"||typeof o.repo!=="string"||typeof o.full!=="string")return null;
  const bases=new Set<string>();for(const f of [fs.realpathSync,fs.realpathSync.native])try{bases.add(f(tmp).toLowerCase())}catch{}
  if(!bases.has(path.dirname(o.dir).toLowerCase())||!path.basename(o.dir).startsWith("uasco-bs1-tpl-")||o.repo!==path.join(o.dir,"template repo")||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(o.full))return null;
  return {dir:o.dir,repo:o.repo,full:o.full};
}
// //TR: Diske yazılan iş ortamı: gizli değer taşıyabilecek adlar (depo redaksiyon sözlüğüyle uyumlu) aktarılmaz; checkout Administrators'a ait olduğundan git'e yalnız bu checkout için komut kapsamlı safe.directory verilir (global/sistem yapılandırması değişmez);
// //TR: 8.3 kısa TEMP yolu (ör. C:\Users\RUNNER~1) PS 5.1'in uzun yola açan GetFullPath'i ile Node'un path.resolve'u arasında kontrol kökü uyuşmazlığı ürettiğinden TEMP/TMP gerçek uzun yola çevrilir.
export const BS1_SECRET_NAME=/TOKEN|SECRET|PASSW(OR)?D|PWD|CREDENTIAL|API_?KEY|_KEY$|PRIVATE|AUTH|(^|_)PAT$/i;
export function deElevatedJobEnv(env:NodeJS.ProcessEnv,checkout:string):NodeJS.ProcessEnv{
  const e:NodeJS.ProcessEnv={};for(const [k,v] of Object.entries(env))if(v!==undefined&&!BS1_SECRET_NAME.test(k))e[k]=v;
  const n=Number(e.GIT_CONFIG_COUNT??0)||0;e.GIT_CONFIG_COUNT=String(n+1);e[`GIT_CONFIG_KEY_${n}`]="safe.directory";e[`GIT_CONFIG_VALUE_${n}`]=checkout.replace(/\\/g,"/");
  const t=fs.realpathSync.native(os.tmpdir());e.TEMP=t;e.TMP=t;return e;
}
// //TR: runas çıktıyı yakalamaz ve hemen döner; küçük sarmalayıcı iş dosyasını okuyup hemen siler, selftest'i verilen ortamla çalıştırır, çıktıyı dosyaya yazar ve bitişi atomik bir işaret dosyasıyla bildirir.
const WRAPPER=`import cp from "node:child_process";import fs from "node:fs";
const j=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));fs.rmSync(process.argv[2],{force:true});const fd=fs.openSync(j.out,"w");
const r=cp.spawnSync(j.node,j.args,{cwd:j.cwd,env:j.env,stdio:["ignore",fd,fd],windowsHide:true});
if(r.error)fs.writeSync(fd,"\\nWRAPPER_SPAWN_ERROR "+r.error.message+"\\n");fs.closeSync(fd);
fs.writeFileSync(j.done+".tmp",String(r.status??1));fs.renameSync(j.done+".tmp",j.done);
`;
function runDeElevated(env:NodeJS.ProcessEnv,args:string[]=[BS1_SELFTEST]):Promise<{code:number|null;out:string}>{
  const dir=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),"uasco-bs1-lua-"));
  const job={node:process.execPath,args,cwd:process.cwd(),env:deElevatedJobEnv(env,process.cwd()),out:path.join(dir,"out.txt"),done:path.join(dir,"done.txt")},jobFile=path.join(dir,"job.json"),wrap=path.join(dir,"wrap.mjs");
  fs.writeFileSync(jobFile,JSON.stringify(job));fs.writeFileSync(wrap,WRAPPER);
  const finish=(code:number|null,out:string)=>{fs.rmSync(dir,{recursive:true,force:true});return {code,out}};
  return new Promise(res=>{
    const r=cp.spawn(RUNAS,runasArgv(process.execPath,wrap,jobFile),{windowsHide:true,stdio:"ignore"});
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
function runDirect(env:NodeJS.ProcessEnv,args:string[]=[BS1_SELFTEST]):Promise<{code:number|null;out:string}>{
  return new Promise(res=>{
    const c=cp.spawn(process.execPath,args,{cwd:process.cwd(),env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let out="";c.stdout.on("data",d=>{out+=d});c.stderr.on("data",d=>{out+=d});c.on("close",code=>res({code,out}));
  });
}
// //TR: Bir kabuğun grupları ayrı alt süreçlerde paralel çalışır; her alt süreç selftest'i yalnız kendi senaryo adlarıyla (UASCO_BS1_ONLY) çağırır ve çıktıdaki her gerekli senaryonun PASS olması beklenir.
export async function runBs1Shard(shard:Bs1Shard):Promise<{ok:boolean;detail:string;line:string[];stdout:string}>{
  const groups=BS1_PARTITION[shard],lua=bs1DeElevate(process.platform,process.env,isElevatedWindows);
  // //TR: Yükseltilmemiş çalıştırma geçen koşularda da görünür biçimde bildirilir (yalnız hata mesajında değil); vitest 4 geçen testlerin console.log çıktısını göstermediği için doğrudan process.stdout'a yazılır.
  const note=lua?`BS1_DE_ELEVATED shard=${shard}: selftest ran via runas /trustlevel:0x20000 (Basic User) on an elevated github-hosted runner\n`:"";if(note)process.stdout.write(note);
  const run=(env:NodeJS.ProcessEnv,args?:string[])=>lua?runDeElevated(env,args):runDirect(env,args);
  const t0=Date.now();let tpl:Bs1Template|null=null;
  // //TR: Şablon yalnız Windows'ta kurulur (selftest başka platformda şablona dokunmadan dürüst SKIP NOT_WINDOWS ile çıkar); kurulamazsa kabuk açıkça başarısız olur.
  if(process.platform==="win32"){
    const b=await run(childEnv([]),["--input-type=module","-e",bs1TemplateBuilder(fs.readFileSync(BS1_SELFTEST,"utf8"))]),m=b.out.match(/^BS1_TEMPLATE (\{.*\})\s*$/m);
    tpl=b.code===0&&m?parseBs1Template(m[1]):null;
    process.stdout.write(`BS1_TIMING shard=${shard} template exit=${b.code} ok=${tpl!==null} wallMs=${Date.now()-t0}\n`);
    if(!tpl)return {ok:false,detail:note+"BS1_TEMPLATE_BUILD_FAILED exit="+b.code+" "+b.out.slice(-2500),line:[],stdout:b.out};
  }
  try{
    const outs=await Promise.all(groups.map(async g=>{const s0=Date.now(),o=await run(childEnv(g,tpl));return {...o,ms:Date.now()-s0}}));
    // //TR: Süre kanıtı her koşuda (geçen koşularda da) yazılır: şablon kurulumu, grup duvar süresi ve selftest'in kendi senaryo süreleri; adım 600 sn sınırına yaklaşınca hangi grubun/senaryonun pahalı olduğu CI günlüğünden ölçülür. Yalnız süre sayıları yazılır.
    outs.forEach((o,i)=>{const tm=o.out.match(/^BOOTSTRAP_AUTONOMY_SELFTEST_TIMINGS (\{.*\})\s*$/m);process.stdout.write(`BS1_TIMING shard=${shard} group=${i+1}/${groups.length} exit=${o.code} wallMs=${o.ms} scenarioMs=${tm?tm[1]:"MISSING"}\n`)});
    process.stdout.write(`BS1_TIMING shard=${shard} total wallMs=${Date.now()-t0}\n`);
    return {ok:outs.every(o=>o.code===0),detail:note+outs.map(o=>"exit="+o.code+" "+o.out.slice(-2500)).join("\n---\n"),line:outs.map(o=>o.out.trim().split(/\r?\n/).pop()??""),stdout:outs.map(o=>o.out).join("\n")};
  }finally{if(tpl)fs.rmSync(tpl.dir,{recursive:true,force:true,maxRetries:3})}
}
