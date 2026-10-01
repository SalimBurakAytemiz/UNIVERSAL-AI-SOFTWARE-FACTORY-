// //TR: Bu test ikinci gerçek Phase0 denemesindeki git-baseline hatasının (PHASE0-F4) regresyonunu Windows PowerShell 5.1 ile gerçek geçici depo ve yerel bare remote üzerinde doğrular: host hatayı üretir (negatif kontrol), origin yokken betik NativeCommandError ile düşmez, push edip uzak SHA'yı doğrular, ikinci çalıştırmada set-url yolunu izler ve -AllowUnverifiedRemote olmadan push etmeden reddeder. Windows dışında dürüstçe atlanır.
import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {isolatedGitArgs,isolatedGitEnv} from "../automation/lib/git-isolation.mjs";
const win=process.platform==="win32",ps=path.join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
// //TR: GH_REPO gibi host ayarları gh'nin başka bir depoyu doğrulamasına yol açmasın diye alt süreçlerden çıkarılır.
function childEnv():NodeJS.ProcessEnv{const env:NodeJS.ProcessEnv={...process.env,GH_PROMPT_DISABLED:"1"};for(const k of ["GH_REPO","GIT_DIR","GIT_WORK_TREE","GIT_INDEX_FILE"])delete env[k];return env}
const git=(cwd:string,...a:string[])=>cp.spawnSync("git",isolatedGitArgs(["-C",cwd,...a]),{encoding:"utf8",windowsHide:true,env:isolatedGitEnv(childEnv())});
function workspace(){const t=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-r4-git-baseline-")),repo=path.join(t,"fresh"),remote=path.join(t,"remote.git");
  fs.mkdirSync(path.join(repo,"scripts"),{recursive:true});fs.copyFileSync("scripts/init-private-git.ps1",path.join(repo,"scripts","init-private-git.ps1"));fs.writeFileSync(path.join(repo,"README.md"),"fixture\n");
  expect(git(t,"init","-q","--bare",remote).status).toBe(0);return {t,repo,remote}}
function runInit(repo:string,remote:string,allowUnverified:boolean){const r=cp.spawnSync(ps,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",path.join(repo,"scripts","init-private-git.ps1"),"-RemoteUrl",remote,...(allowUnverified?["-AllowUnverifiedRemote"]:[])],{cwd:repo,encoding:"utf8",windowsHide:true,timeout:120000,env:childEnv()});return {status:r.status,out:`${r.stdout??""}${r.stderr??""}`}}
describe.skipIf(!win)("init-private-git.ps1 on Windows PowerShell 5.1 (PHASE0-F4)",{timeout:300000},()=>{
  it("the host reproduces the defect: the original redirected probe is terminating under Stop (negative control)",()=>{const w=workspace();try{expect(git(w.repo,"init","-q").status).toBe(0);
    const r=cp.spawnSync(ps,["-NoProfile","-NonInteractive","-Command",`$ErrorActionPreference='Stop';if($PSVersionTable.PSVersion.Major -ne 5){'NOT_WINDOWS_POWERSHELL_5';exit 3};try{git -C '${w.repo}' remote get-url origin 2>$null;'NOT_TERMINATING'}catch{'TERMINATING:'+$_.FullyQualifiedErrorId}`],{encoding:"utf8",windowsHide:true,timeout:60000,env:isolatedGitEnv(childEnv())});
    expect(r.stdout,r.stderr).toContain("TERMINATING:NativeCommandError")}finally{fs.rmSync(w.t,{recursive:true,force:true})}});
  it("initializes, pushes to a new origin and verifies the remote SHA; a second run takes the set-url path",()=>{const w=workspace();try{
    const r=runInit(w.repo,w.remote,true);expect(r.status,r.out).toBe(0);expect(r.out).toContain("GIT_INIT: PASS (REMOTE_UNVERIFIED)");expect(r.out).not.toContain("NativeCommandError");
    const head=git(w.repo,"rev-parse","HEAD").stdout.trim();expect(head).toMatch(/^[0-9a-f]{40}$/);expect(git(w.remote,"rev-parse","refs/heads/main").stdout.trim()).toBe(head);
    const status=JSON.parse(fs.readFileSync(path.join(w.repo,".ai","runtime","REMOTE_STATUS.json"),"utf8"));expect(status.visibility).toBe("REMOTE_UNVERIFIED");expect(status.head).toBe(head);
    const again=runInit(w.repo,w.remote,true);expect(again.status,again.out).toBe(0);expect(again.out).not.toContain("NativeCommandError");expect(git(w.repo,"remote","get-url","origin").stdout.trim()).toBe(w.remote);expect(git(w.remote,"rev-parse","refs/heads/main").stdout.trim()).toBe(head)}finally{fs.rmSync(w.t,{recursive:true,force:true})}});
  it("refuses to push to an unverified remote without the explicit override",()=>{const w=workspace();try{
    const r=runInit(w.repo,w.remote,false);expect(r.status).not.toBe(0);expect(r.out).toContain("Remote privacy could not be verified");expect(r.out).not.toContain("NativeCommandError");
    expect(git(w.remote,"rev-parse","--verify","-q","refs/heads/main").status).not.toBe(0)}finally{fs.rmSync(w.t,{recursive:true,force:true})}});
  it("keeps both native probes scoped and exit-code checked",()=>{const src=fs.readFileSync("scripts/init-private-git.ps1","utf8");
    expect(src).toContain('try{Invoke-UascoGit remote get-url origin 2>$null|Out-Null;$originExists=($LASTEXITCODE -eq 0)}finally{$ErrorActionPreference=$eapBefore}');
    expect(src).toContain('try{$ghOut=gh repo view --json visibility,url 2>$null;$ghExit=$LASTEXITCODE}finally{$ErrorActionPreference=$eapBefore}');expect(src).toContain('if($ghExit -ne 0){throw "gh repo view failed with exit code $ghExit"}');
    expect(src).toMatch(/^\$ErrorActionPreference="Stop"$/m);expect(src).toContain('if($visibility -eq "NOT_PRIVATE"){throw "Remote repository is NOT PRIVATE; refusing push."}')});
});
