// //TR: Bu helper gözetimsiz orkestratörün çalıştırabileceği komutları tam sözleşmelere bağlar: her işlem sabit program + tip doğrulamalı parametrelerle shell'siz çalışır, yollar yalnız policy köklerinin altında olabilir, bilinmeyen sözleşme veya geçersiz parametre fail-closed reddedilir; keyfi PowerShell/cmd/Bash, silme, force push ve credential export sözleşmesi yoktur.
import path from "node:path";import cp from "node:child_process";import {Worker,MessageChannel,receiveMessageOnPort} from "node:worker_threads";import {isolatedGitArgs,isolatedGitEnv} from "./git-isolation.mjs";
const SHA40=/^[0-9a-f]{40}$/,REF=/^refs\/heads\/[A-Za-z0-9._\/-]+$/,BRANCH=/^(v6|uasco\/run)\/[A-Za-z0-9._\/-]+$/,BASENAME=/^[A-Za-z0-9._-]+$/;
// //TR: Orkestratör builder commit'lerinin sabit kimliği; çökme sonrası benimseme bir commit'i yalnız bu kimlik, beklenen tek ebeveyn ve tur konusu eşleşirse bu turun commit'i sayar.
export const ORCHESTRATOR_GIT_IDENTITY=Object.freeze({name:"UASCO Orchestrator",email:"orchestrator@uasco.local.invalid"});
const deny=reason=>{throw new Error(`COMMAND_CONTRACT_DENIED:${reason}`)};
const norm=p=>path.resolve(String(p)).replaceAll("\\","/").toLowerCase();
export function expandPolicyPaths(policy,{repo,env=process.env}){const sub=s=>String(s).replaceAll("${REPO}",repo).replaceAll("${LOCALAPPDATA}",env.LOCALAPPDATA??"").replaceAll("${USERPROFILE}",env.USERPROFILE??"");const roots=Object.fromEntries(Object.entries(policy.roots).map(([k,v])=>[k,path.resolve(sub(v))]));const signing={...policy.signing,publicKey:path.resolve(sub(policy.signing.publicKey))};return {...policy,roots,signing}}
// //TR: Parametre tipleri: kesin commit SHA, izinli dal/ref, tek dosya adı, policy kökü altında mutlak yol, sabit küme.
export function makeValidators(policy){
  const under=(rootKey,v)=>{if(typeof v!=="string"||!path.isAbsolute(v))deny(`PATH_NOT_ABSOLUTE:${rootKey}`);const r=norm(policy.roots[rootKey]),p=norm(v);if(p!==r&&!p.startsWith(r+"/"))deny(`PATH_OUTSIDE_ROOT:${rootKey}`);return path.resolve(v)};
  return {
    sha:v=>{if(!SHA40.test(String(v)))deny("SHA");return v},ref:v=>{if(!REF.test(String(v))||String(v).includes(".."))deny("REF");return v},branch:v=>{if(!BRANCH.test(String(v))||String(v).includes(".."))deny("BRANCH");return v},
    basename:v=>{if(!BASENAME.test(String(v)))deny("BASENAME");return v},under,
    oneOf:(set,v)=>{if(!set.includes(v))deny(`NOT_IN_SET:${v}`);return v}
  };
}
const NODE_SCRIPTS=["scripts/run-validation.mjs","scripts/ensure-dependencies.mjs","scripts/capture-provider-provenance.mjs","scripts/verify-trust-root.mjs","scripts/generate-trust-root.mjs","scripts/release-sha256sums.mjs","scripts/build-release-zip.mjs","scripts/verify-release-extract.mjs","scripts/codex-reviewer-broker.mjs","scripts/claude-builder-broker.mjs","scripts/provider-smoke.mjs"];
// //TR: Zamanlanmış görev durumu yerel ayardan bağımsız, salt-okunur ve sabit bir PowerShell sorgusuyla okunur; görev adı yalnız policy'deki iki addan biri olabilir ve ortam değişkeniyle geçer.
export const SCHEDULED_TASK_INFO_SCRIPT="$ErrorActionPreference='Stop';$n=$env:UASCO_TASK_NAME;$t=Get-ScheduledTask -TaskPath '\\' -TaskName $n -ErrorAction SilentlyContinue;if(-not $t){'{\"registered\":false}';exit 0};$i=Get-ScheduledTaskInfo -InputObject $t;$f={param($d)if($d -and $d.Year -gt 1999){$d.ToUniversalTime().ToString('o')}else{$null}};[pscustomobject]@{registered=$true;state=[string]$t.State;lastRunTime=(& $f $i.LastRunTime);lastTaskResult=$i.LastTaskResult;nextRunTime=(& $f $i.NextRunTime)}|ConvertTo-Json -Compress";
// //TR: Sözleşme tablosu; yeni işlem eklemek bu protected dosyada değişiklik ve bağımsız review gerektirir.
export function buildContracts(policy,{repo}){
  const v=makeValidators(policy),git="git",ps=path.join(process.env.SystemRoot??"C:/Windows","System32","WindowsPowerShell","v1.0","powershell.exe"),tar=path.join(process.env.SystemRoot??"C:/Windows","System32","tar.exe");
  const anyRoot=p=>{for(const k of ["repo","controlRoot","releaseRoot","signRoot","installRoot"]){try{return v.under(k,p)}catch{}}deny("PATH_OUTSIDE_ALL_ROOTS")};
  return {
    "git.revParse":{program:git,args:p=>["-C",anyRoot(p.cwd),"rev-parse","--verify",`${/^refs\//.test(p.rev)?v.ref(p.rev):v.sha(p.rev)}^{commit}`]},
    "git.status":{program:git,args:p=>["-C",anyRoot(p.cwd),"status","--porcelain=v1","--untracked-files=all"]},
    "git.isAncestor":{program:git,args:p=>["-C",anyRoot(p.cwd),"merge-base","--is-ancestor",v.sha(p.ancestor),v.sha(p.descendant)],allowExit:[0,1]},
    "git.diffNames":{program:git,args:p=>["-C",anyRoot(p.cwd),"diff","--name-only",`${v.sha(p.base)}..${v.sha(p.head)}`]},
    "git.lsTree":{program:git,args:p=>["-C",v.under("repo",p.cwd),"ls-tree","-r","--name-only",v.sha(p.commit)]},
    "git.treeOf":{program:git,args:p=>["-C",v.under("repo",p.cwd),"rev-parse",`${/^refs\//.test(p.rev)?v.ref(p.rev):v.sha(p.rev)}^{tree}`]},
    "git.archive":{program:git,args:p=>["-C",v.under("repo",p.cwd),"archive","--format=tar","-o",v.under("releaseRoot",p.out),v.sha(p.commit)]},
    "tar.extract":{program:tar,args:p=>["-xf",v.under("releaseRoot",p.file),"-C",v.under("releaseRoot",p.dest)]},
    // //TR: Yalnız fast-forward: beklenen eski değerle update-ref; ancestry ve tree eşitliği motor tarafından ayrıca doğrulanır; force/delete yoktur.
    "git.updateRefFF":{program:git,args:p=>["-C",v.under("repo",p.cwd),"update-ref","-m",`uasco-orchestrator: fast-forward after governed CLEAN (${v.basename(p.packageId)})`,v.ref(p.ref),v.sha(p.newSha),v.sha(p.oldSha)]},
    "git.cloneLocal":{program:git,args:p=>["clone","-q","--no-hardlinks",v.under("repo",p.source),v.under("controlRoot",p.dest)]},
    "git.fetchOrigin":{program:git,args:p=>["-C",v.under("controlRoot",p.cwd),"fetch","-q","origin"]},
    "git.checkoutDetached":{program:git,args:p=>["-C",v.under("controlRoot",p.cwd),"checkout","-q","--detach",v.sha(p.commit)]},
    "git.commitAll":{program:git,args:p=>["-C",v.under("controlRoot",p.cwd),"-c",`user.name=${ORCHESTRATOR_GIT_IDENTITY.name}`,"-c",`user.email=${ORCHESTRATOR_GIT_IDENTITY.email}`,"commit","-q","-a","-m",String(p.message).slice(0,2000)],envFrom:()=>({GIT_COMMITTER_NAME:ORCHESTRATOR_GIT_IDENTITY.name,GIT_COMMITTER_EMAIL:ORCHESTRATOR_GIT_IDENTITY.email})},
    "git.addPaths":{program:git,args:p=>["-C",v.under("controlRoot",p.cwd),"add","--",...(p.paths??[]).map(x=>{if(typeof x!=="string"||path.isAbsolute(x)||x.split(/[\\/]/).includes(".."))deny("ADD_PATH");return x})]},
    "git.fetchBranchFromClone":{program:git,args:p=>["-C",v.under("repo",p.cwd),"fetch","-q",v.under("controlRoot",p.clone),`${v.sha(p.commit)}:${v.ref(`refs/heads/${v.branch(p.branch)}`)}`]},
    "node.script":{program:process.execPath,args:p=>[v.oneOf(NODE_SCRIPTS,p.script),...(p.args??[]).map(a=>{if(typeof a!=="string")deny("ARG");if(path.isAbsolute(a))return anyRoot(a);if(a==="."||a==="--with-validation"||a==="--source-commit"||SHA40.test(a))return a;deny(`ARG_NOT_ALLOWED:${a}`)})],cwdFrom:p=>anyRoot(p.cwd),input:true,allowEnvOverride:true},
    "ssh.addList":{program:policy.signing.sshAdd,args:()=>["-l"],allowExit:[0,1,2]},
    // //TR: İmza yalnız ssh-agent üzerinden: -f her zaman policy'deki PUBLIC key; özel anahtar yolu hiçbir sözleşmede yoktur.
    "ssh.sign":{program:policy.signing.sshKeygen,args:p=>["-Y","sign","-f",policy.signing.publicKey,"-n",policy.signing.namespace,v.under("signRoot",p.file)]},
    "ssh.verify":{program:policy.signing.sshKeygen,args:p=>["-Y","verify","-f",v.under("signRoot",p.allowedSigners),"-I",policy.signing.identity,"-n",policy.signing.namespace,"-s",v.under("signRoot",p.signature)],input:true},
    "ps.expandArchive":{program:ps,args:()=>["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop';Expand-Archive -LiteralPath $env:UASCO_RELEASE_ZIP -DestinationPath $env:UASCO_RELEASE_DEST"],envFrom:p=>({UASCO_RELEASE_ZIP:v.under("signRoot",p.zip),UASCO_RELEASE_DEST:v.under("installRoot",p.dest)})},
    "ps.installPhase0":{program:ps,args:p=>["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(v.under("installRoot",p.installRoot),"scripts","install.ps1"),"-RemoteUrl",v.oneOf([policy.phase0.remoteUrl],p.remoteUrl),"-SkipAutoStart"],cwdFrom:p=>v.under("installRoot",p.installRoot),pathPrepend:policy.github.ghDirectory},
    // //TR: Kurulu sistemin otomatik başlatması inşa süpervizörüyle ad çakışmasın diye policy'deki ayrı adla, kurulu kopyanın kendi betiğiyle kaydedilir.
    "ps.registerInstalledAutostart":{program:ps,args:p=>{const root=v.under("installRoot",p.installRoot);return ["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts","register-autostart.ps1"),"-RepoPath",root,"-TaskName",policy.autostart.installedSystemTaskName]},cwdFrom:p=>v.under("installRoot",p.installRoot)},
    // //TR: Süpervizörün pasif durum keşfi için salt-okunur sözleşmeler (dal uçları, worktree listesi, zamanlanmış görev durumu).
    // //TR: Kendini güncelleme için salt-okunur: kontrol kökü altındaki bir düzlemin ayrık HEAD commit'i.
    "git.headCommit":{program:git,args:p=>["-C",v.under("controlRoot",p.cwd),"rev-parse","--verify","HEAD^{commit}"]},
    // //TR: Çökme sonrası builder turu benimsemesi için salt-okunur: bir commit'in ebeveynleri, committer kimliği ve konu satırı (imza gösterimi kapalı).
    "git.commitIdentity":{program:git,args:p=>["-C",anyRoot(p.cwd),"log","-1","--no-show-signature","--format=%P%n%cn <%ce>%n%s",v.sha(p.commit)]},
    "git.listBranchHeads":{program:git,args:p=>["-C",v.under("repo",p.cwd),"for-each-ref","--format=%(refname) %(objectname)","refs/heads/"]},
    "git.worktreeList":{program:git,args:p=>["-C",v.under("repo",p.cwd),"worktree","list","--porcelain"]},
    "ps.scheduledTaskInfo":{program:ps,args:()=>["-NoProfile","-NonInteractive","-Command",SCHEDULED_TASK_INFO_SCRIPT],envFrom:p=>({UASCO_TASK_NAME:v.oneOf([policy.autostart.taskName,policy.autostart.installedSystemTaskName],p.taskName)})},
    "gh.authStatus":{program:path.join(policy.github.ghDirectory,"gh.exe"),args:()=>["auth","status"],allowExit:[0,1]},
    "gh.branchProtection":{program:path.join(policy.github.ghDirectory,"gh.exe"),args:()=>["api",`repos/${policy.github.expectedRemote.replace("https://github.com/","")}/branches/main/protection`],allowExit:[0,1]},
    "gh.repoView":{program:path.join(policy.github.ghDirectory,"gh.exe"),args:()=>["repo","view",policy.github.expectedRemote.replace(/^https:\/\/github\.com\//,""),"--json","nameWithOwner,visibility,url,isEmpty"]}
  };
}
// //TR: İzlemeli çalıştırma: komut bir worker thread içinde asenkron başlatılır, ana thread senkron API'yi korurken durdurma koşulunu düzenli yoklar; durdurma gelirse (veya süre aşılırsa) komutun tüm süreç ağacı sonlandırılır (Windows'ta System32 taskkill /T /F, diğerlerinde süreç grubu). Sonuç spawnSync biçimindedir ve stopped alanı durdurma nedenini taşır.
const MONITOR_WORKER=`const {workerData:w}=process.getBuiltinModule("node:worker_threads"),cp=process.getBuiltinModule("node:child_process"),path=process.getBuiltinModule("node:path");
const post=m=>{try{w.port.postMessage(m)}catch{}};
try{const flag=new Int32Array(w.flag),win=process.platform==="win32",taskkill=path.join(process.env.SystemRoot||"C:\\\\Windows","System32","taskkill.exe");
const child=cp.spawn(w.program,w.args,{cwd:w.cwd,env:w.env,windowsHide:true,shell:false,detached:!win});post({type:"started",pid:child.pid??null});const out=[],err=[];let outLen=0,errLen=0,done=false,timedOut=false,stopped=false;
const killTree=()=>{if(child.pid===undefined)return;try{if(win)cp.spawnSync(taskkill,["/PID",String(child.pid),"/T","/F"],{windowsHide:true});else process.kill(-child.pid,"SIGKILL")}catch{try{child.kill("SIGKILL")}catch{}}};
child.stdout.on("data",d=>{if(outLen<w.maxBuffer){out.push(d);outLen+=d.length}});child.stderr.on("data",d=>{if(errLen<w.maxBuffer){err.push(d);errLen+=d.length}});
try{if(w.input!==null)child.stdin.end(w.input);else child.stdin.end()}catch{}
const timer=setTimeout(()=>{timedOut=true;killTree()},w.timeoutMs),poll=setInterval(()=>{if(!stopped&&Atomics.load(flag,0)===1){stopped=true;killTree()}},100);
const finish=(status,signal,error)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(poll);post({type:"exit",status,signal:signal??null,error:error??null,stdout:Buffer.concat(out).toString("utf8"),stderr:Buffer.concat(err).toString("utf8"),timedOut,stopped});try{w.port.close()}catch{}};
child.on("error",e=>finish(null,null,String(e.message)));child.on("close",(code,signal)=>finish(code,signal,null))}
catch(e){post({type:"exit",status:null,signal:null,error:"MONITOR_WORKER_FAILED:"+String(e&&e.message||e),stdout:"",stderr:"",timedOut:false,stopped:false})}`;
export function spawnMonitored(program,args,{cwd,input,env,timeout,maxBuffer=64*1024*1024}={},shouldStop=()=>null,pollMs=200){
  const {port1,port2}=new MessageChannel(),flagBuf=new SharedArrayBuffer(4),flag=new Int32Array(flagBuf),idle=new Int32Array(new SharedArrayBuffer(4)),timeoutMs=timeout??3_600_000,t0=Date.now();
  const worker=new Worker(MONITOR_WORKER,{eval:true,workerData:{program,args,cwd,env,input:input??null,timeoutMs,maxBuffer,port:port2,flag:flagBuf},transferList:[port2]});
  let result=null,stopReason=null,started=false,pid=null;
  const killPid=()=>{if(!pid)return;try{if(process.platform==="win32")cp.spawnSync(path.join(process.env.SystemRoot??"C:/Windows","System32","taskkill.exe"),["/PID",String(pid),"/T","/F"],{windowsHide:true});else process.kill(-pid,"SIGKILL")}catch{}};
  for(;;){let m;while((m=receiveMessageOnPort(port1))){if(m.message?.type==="started"){started=true;pid=m.message.pid}if(m.message?.type==="exit")result=m.message}if(result)break;
    // //TR: Worker hiç başlamazsa veya süre + pay aşılırsa ana thread komut ağacını kendisi sonlandırır ve başarısızlık döndürür (sessiz asılma yok).
    if(!started&&Date.now()-t0>30_000){result={status:null,signal:null,error:"MONITOR_WORKER_START_TIMEOUT",stdout:"",stderr:"",timedOut:false,stopped:false};break}
    if(Date.now()-t0>timeoutMs+60_000){killPid();result={status:null,signal:null,error:"TIMEOUT_MONITOR_DEADLINE",stdout:"",stderr:"",timedOut:true,stopped:false};break}
    if(!stopReason){let st=null;try{st=shouldStop()}catch(e){st=`STOP_CHECK_FAILED_FAIL_CLOSED:${e.message}`}if(st){stopReason=String(st);Atomics.store(flag,0,1)}}
    Atomics.wait(idle,0,0,pollMs)}
  try{port1.close()}catch{}worker.terminate().catch(()=>{});
  return {status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,error:result.error?{message:result.error}:(result.timedOut?{message:"TIMEOUT"}:null),stopped:result.stopped?(stopReason??"STOP"):null};
}
export function createContractRunner({policy,repo,spawn=null,env=process.env,shouldStop=null}){
  const contracts=buildContracts(policy,{repo});
  function run(id,params={},{input=null,timeoutMs=3_600_000,env:envOverride=null}={}){
    const c=contracts[id];if(!c)deny(`UNKNOWN_CONTRACT:${id}`);if(input!==null&&!c.input)deny(`INPUT_NOT_ALLOWED:${id}`);if(envOverride&&!c.allowEnvOverride)deny(`ENV_OVERRIDE_NOT_ALLOWED:${id}`);
    // //TR: Git sözleşmeleri diğer üretim Git süreçleri gibi depo Git izolasyonuyla çalışır (host global/system config, hook, credential helper yok); ek olarak
    // //TR: enjekte edilen GIT_CONFIG_PARAMETERS kaldırılır ve otomatik commit/tag imzası kapatılır, böylece izin verilen git komutu onaysız bir alt süreç başlatamaz.
    const isGit=c.program==="git",rawArgs=c.args(params),args=isGit?["-c","commit.gpgSign=false","-c","tag.gpgSign=false",...isolatedGitArgs(rawArgs)]:rawArgs,cwd=c.cwdFrom?c.cwdFrom(params):undefined,baseEnv={...(envOverride??env),...(c.envFrom?c.envFrom(params):{})};
    const childEnv=isGit?isolatedGitEnv(baseEnv):baseEnv;if(isGit)for(const k of Object.keys(childEnv))if(k.toUpperCase()==="GIT_CONFIG_PARAMETERS")delete childEnv[k];if(c.pathPrepend)childEnv.PATH=`${c.pathPrepend}${path.delimiter}${env.PATH??""}`;
    const stop=shouldStop?.();if(stop)deny(`GLOBAL_STOP_ACTIVE:${id}:${stop}`);
    const opts={cwd,input:input??undefined,encoding:"utf8",windowsHide:true,timeout:timeoutMs,maxBuffer:64*1024*1024,env:childEnv,shell:false};
    const r=spawn?spawn(c.program,args,opts):shouldStop?spawnMonitored(c.program,args,opts,shouldStop):cp.spawnSync(c.program,args,opts);
    const status=r.status??-1,stopped=r.stopped??null;if(stopped)throw new Error(`GLOBAL_STOP_ACTIVE:COMMAND_TERMINATED:${id}:${stopped}`);const ok=(c.allowExit??[0]).includes(status);return {id,status,ok,stopped,stdout:String(r.stdout??""),stderr:String(r.stderr??""),error:r.error?String(r.error.message):null};
  }
  function must(id,params,opts){const r=run(id,params,opts);if(r.stopped)throw new Error(`GLOBAL_STOP_ACTIVE:COMMAND_TERMINATED:${id}:${r.stopped}`);if(!r.ok)throw new Error(`COMMAND_CONTRACT_FAILED:${id}:exit=${r.status}:${(r.stderr||r.stdout).trim().slice(-400)}`);return r}
  return {run,must,ids:Object.keys(contracts)};
}
