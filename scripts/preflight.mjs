// //TR: Bu script target machine'in repo/lock/filesystem boundary, Node/npm/Git/PowerShell, disk/RAM, gerekli CLI, kritik port ve platform durumunu machine-readable PREFLIGHT report olarak fail-closed kontrol eder.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import cp from "node:child_process";
import {dependencyState} from "../automation/lib/dependency-install.mjs";
import {scanFilesystemBoundary} from "../automation/lib/filesystem-boundary.mjs";

const execVersion=(cmd,args=["--version"])=>{const r=cp.spawnSync(cmd,args,{encoding:"utf8",windowsHide:true});return r.status===0?{present:true,version:(r.stdout||r.stderr).trim()}:{present:false,version:null}};
const portFree=port=>new Promise(resolve=>{const s=net.createServer();s.once("error",()=>resolve(false));s.listen(port,"127.0.0.1",()=>s.close(()=>resolve(true)))});
const checks={},root=process.cwd();
const rootMarkers=["package.json","config/automation.json","config/protected-paths.json","scripts/install.ps1"];checks.repoRoot={status:rootMarkers.every(x=>fs.existsSync(x))?"PASS":"BLOCKED",detail:rootMarkers.map(x=>`${x}=${fs.existsSync(x)?"PRESENT":"MISSING"}`).join(", ")};
try{const d=dependencyState(root);checks.reviewedLock={status:"PASS",detail:`lock=${d.lockSha256} package=${d.packageSha256}`}}catch(e){checks.reviewedLock={status:"BLOCKED",detail:String(e.message??e)}}
try{const b=scanFilesystemBoundary(root);checks.filesystemBoundary={status:b.ok?"PASS":"BLOCKED",detail:b.ok?"root/ancestor/repo symlink-junction boundary clean":JSON.stringify(b.violations)}}catch(e){checks.filesystemBoundary={status:"BLOCKED",detail:String(e.message??e)}}
const nodeMajor=Number(process.versions.node.split(".")[0]);checks.node={status:nodeMajor>=24?"PASS":"BLOCKED",detail:`${process.version}; required >=24`};
const npm=execVersion(process.platform==="win32"?"npm.cmd":"npm");checks.npm={status:npm.present?"PASS":"BLOCKED",detail:npm.version??"missing"};
const git=execVersion("git");checks.git={status:git.present?"PASS":"BLOCKED",detail:git.version??"missing"};
if(process.platform==="win32"){const ps=execVersion("powershell.exe",["-NoProfile","-Command","$PSVersionTable.PSVersion.ToString()"]),major=Number(String(ps.version??"").split(".")[0]);checks.powershell={status:ps.present&&major>=5?"PASS":"BLOCKED",detail:ps.present?`${ps.version}; required >=5.1`:"powershell.exe missing"}}else checks.powershell={status:"WARN",detail:`non-Windows source/preflight environment (${process.platform}); TARGET_MACHINE_PHASE0 remains Windows`};
for(const c of ["claude","codex"]){const x=execVersion(c);checks[c]={status:x.present?"PASS":"BLOCKED",detail:x.version??"missing"}}
for(const c of ["docker","adb","appium","python","java","dotnet","go","cargo","flutter","kubectl","helm","terraform","tofu","ffmpeg"]){const x=execVersion(c);checks[`optional:${c}`]={status:x.present?"PASS":"WARN",detail:x.version??"mission tool not installed"}}
const freeMemGb=os.freemem()/1024**3,totalMemGb=os.totalmem()/1024**3;checks.memory={status:totalMemGb>=8?"PASS":"BLOCKED",detail:`total=${totalMemGb.toFixed(1)}GB free=${freeMemGb.toFixed(1)}GB`};
try{const st=fs.statfsSync(root),free=Number(st.bavail)*Number(st.bsize)/1024**3;checks.disk={status:free>=5?"PASS":"BLOCKED",detail:`free=${free.toFixed(1)}GB; 20GB+ recommended`}}catch(e){checks.disk={status:"WARN",detail:`disk free-space check unavailable: ${e.message}`}}
checks.repoPath={status:root.length<=180?"PASS":"WARN",detail:`length=${root.length}; Windows path should stay short for toolchains`};for(const port of [3210,20128])checks[`port:${port}`]={status:(await portFree(port))?"PASS":"WARN",detail:"Expected free before service startup; existing intended service may explain WARN"};checks.platform={status:"PASS",detail:`${process.platform} ${os.release()} ${os.arch()}`};
const requiredBlocked=Object.entries(checks).filter(([k,v])=>!k.startsWith("optional:")&&v.status==="BLOCKED"),report={"//TR":"Bu runtime report full install öncesi exact target machine preflight durumunu repo/lock/filesystem boundary dahil kaydeder.",schemaVersion:"1.1.0",generatedAt:new Date().toISOString(),checks,final:requiredBlocked.length?"BLOCKED":"PASS"};fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/PREFLIGHT.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(requiredBlocked.length)process.exit(1);
