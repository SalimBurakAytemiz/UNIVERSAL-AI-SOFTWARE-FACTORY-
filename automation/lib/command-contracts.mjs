// //TR: Bu helper gözetimsiz orkestratörün çalıştırabileceği komutları tam sözleşmelere bağlar: her işlem sabit program + tip doğrulamalı parametrelerle shell'siz çalışır, yollar yalnız policy köklerinin altında olabilir, bilinmeyen sözleşme veya geçersiz parametre fail-closed reddedilir; keyfi PowerShell/cmd/Bash, silme, force push ve credential export sözleşmesi yoktur.
import path from "node:path";import cp from "node:child_process";
const SHA40=/^[0-9a-f]{40}$/,REF=/^refs\/heads\/[A-Za-z0-9._\/-]+$/,BRANCH=/^(v6|uasco\/run)\/[A-Za-z0-9._\/-]+$/,BASENAME=/^[A-Za-z0-9._-]+$/;
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
const NODE_SCRIPTS=["scripts/run-validation.mjs","scripts/ensure-dependencies.mjs","scripts/capture-provider-provenance.mjs","scripts/verify-trust-root.mjs","scripts/generate-trust-root.mjs","scripts/release-sha256sums.mjs","scripts/build-release-zip.mjs","scripts/verify-release-extract.mjs","scripts/codex-reviewer-broker.mjs","scripts/claude-builder-broker.mjs"];
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
    "git.commitAll":{program:git,args:p=>["-C",v.under("controlRoot",p.cwd),"-c","user.name=UASCO Orchestrator","-c","user.email=orchestrator@uasco.local.invalid","commit","-q","-a","-m",String(p.message).slice(0,2000)]},
    "git.addPaths":{program:git,args:p=>["-C",v.under("controlRoot",p.cwd),"add","--",...(p.paths??[]).map(x=>{if(typeof x!=="string"||path.isAbsolute(x)||x.split(/[\\/]/).includes(".."))deny("ADD_PATH");return x})]},
    "git.fetchBranchFromClone":{program:git,args:p=>["-C",v.under("repo",p.cwd),"fetch","-q",v.under("controlRoot",p.clone),`${v.sha(p.commit)}:${v.ref(`refs/heads/${v.branch(p.branch)}`)}`]},
    "node.script":{program:process.execPath,args:p=>[v.oneOf(NODE_SCRIPTS,p.script),...(p.args??[]).map(a=>{if(typeof a!=="string")deny("ARG");if(path.isAbsolute(a))return anyRoot(a);if(a==="."||a==="--with-validation"||a==="--source-commit"||SHA40.test(a))return a;deny(`ARG_NOT_ALLOWED:${a}`)})],cwdFrom:p=>anyRoot(p.cwd),input:true,allowEnvOverride:true},
    "ssh.addList":{program:policy.signing.sshAdd,args:()=>["-l"],allowExit:[0,1,2]},
    // //TR: İmza yalnız ssh-agent üzerinden: -f her zaman policy'deki PUBLIC key; özel anahtar yolu hiçbir sözleşmede yoktur.
    "ssh.sign":{program:policy.signing.sshKeygen,args:p=>["-Y","sign","-f",policy.signing.publicKey,"-n",policy.signing.namespace,v.under("signRoot",p.file)]},
    "ssh.verify":{program:policy.signing.sshKeygen,args:p=>["-Y","verify","-f",v.under("signRoot",p.allowedSigners),"-I",policy.signing.identity,"-n",policy.signing.namespace,"-s",v.under("signRoot",p.signature)],input:true},
    "ps.expandArchive":{program:ps,args:()=>["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop';Expand-Archive -LiteralPath $env:UASCO_RELEASE_ZIP -DestinationPath $env:UASCO_RELEASE_DEST"],envFrom:p=>({UASCO_RELEASE_ZIP:v.under("signRoot",p.zip),UASCO_RELEASE_DEST:v.under("installRoot",p.dest)})},
    "ps.installPhase0":{program:ps,args:p=>["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(v.under("installRoot",p.installRoot),"scripts","install.ps1"),"-RemoteUrl",v.oneOf([policy.phase0.remoteUrl],p.remoteUrl)],cwdFrom:p=>v.under("installRoot",p.installRoot),pathPrepend:policy.github.ghDirectory},
    "gh.authStatus":{program:path.join(policy.github.ghDirectory,"gh.exe"),args:()=>["auth","status"],allowExit:[0,1]},
    "gh.branchProtection":{program:path.join(policy.github.ghDirectory,"gh.exe"),args:()=>["api",`repos/${policy.github.expectedRemote.replace("https://github.com/","")}/branches/main/protection`],allowExit:[0,1]},
    "gh.repoView":{program:path.join(policy.github.ghDirectory,"gh.exe"),args:()=>["repo","view",policy.github.expectedRemote.replace(/^https:\/\/github\.com\//,""),"--json","nameWithOwner,visibility,url,isEmpty"]}
  };
}
export function createContractRunner({policy,repo,spawn=cp.spawnSync,env=process.env}){
  const contracts=buildContracts(policy,{repo});
  function run(id,params={},{input=null,timeoutMs=3_600_000,env:envOverride=null}={}){
    const c=contracts[id];if(!c)deny(`UNKNOWN_CONTRACT:${id}`);if(input!==null&&!c.input)deny(`INPUT_NOT_ALLOWED:${id}`);if(envOverride&&!c.allowEnvOverride)deny(`ENV_OVERRIDE_NOT_ALLOWED:${id}`);
    const args=c.args(params),cwd=c.cwdFrom?c.cwdFrom(params):undefined,childEnv={...(envOverride??env),...(c.envFrom?c.envFrom(params):{})};if(c.pathPrepend)childEnv.PATH=`${c.pathPrepend}${path.delimiter}${env.PATH??""}`;
    const r=spawn(c.program,args,{cwd,input:input??undefined,encoding:"utf8",windowsHide:true,timeout:timeoutMs,maxBuffer:64*1024*1024,env:childEnv,shell:false});
    const status=r.status??-1,ok=(c.allowExit??[0]).includes(status);return {id,status,ok,stdout:String(r.stdout??""),stderr:String(r.stderr??""),error:r.error?String(r.error.message):null};
  }
  function must(id,params,opts){const r=run(id,params,opts);if(!r.ok)throw new Error(`COMMAND_CONTRACT_FAILED:${id}:exit=${r.status}:${(r.stderr||r.stdout).trim().slice(-400)}`);return r}
  return {run,must,ids:Object.keys(contracts)};
}
