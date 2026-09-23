// //TR: Bu helper builder öncesi/sonrası Git common metadata/config/remotes/refs/HEAD/worktrees/hooks/attributes/submodules snapshotlarını karşılaştırır; source diff dışında Git trust state değişikliğini fail-closed yakalar.
import fs from "node:fs";import path from "node:path";import cp from "node:child_process";import crypto from "node:crypto";
const run=(cwd,args)=>{const r=cp.spawnSync("git",args,{cwd,encoding:"utf8",windowsHide:true});return r.status===0?r.stdout:"[ERROR]"};
function hashFile(p){try{return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}catch{return null}}
function hookState(common){const d=path.join(common,"hooks");if(!fs.existsSync(d))return {};return Object.fromEntries(fs.readdirSync(d).sort().map(n=>[n,hashFile(path.join(d,n))]));}
export function captureGitMetadata(cwd){let common=run(cwd,["rev-parse","--git-common-dir"]).trim();if(!path.isAbsolute(common))common=path.resolve(cwd,common);return {
 localConfig:run(cwd,["config","--local","--list","--show-origin"]),remotes:run(cwd,["remote","-v"]),refs:run(cwd,["show-ref","--head"]),head:run(cwd,["rev-parse","HEAD"]),worktrees:run(cwd,["worktree","list","--porcelain"]),
 hooks:hookState(common),gitmodules:hashFile(path.join(cwd,".gitmodules")),gitattributes:hashFile(path.join(cwd,".gitattributes")),gitPointer:hashFile(path.join(cwd,".git")),commonConfig:hashFile(path.join(common,"config"))};}
export function assertGitMetadataUnchanged(before,after){if(JSON.stringify(before)!==JSON.stringify(after))throw new Error(`GIT_METADATA_MUTATION_DETECTED before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);return true}
