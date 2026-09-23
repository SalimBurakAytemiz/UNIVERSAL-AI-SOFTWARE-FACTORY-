// //TR: Bu helper builder öncesi/sonrası Git trust state'ini credential içeriğini state/error'a taşımadan digest ile karşılaştırır; source diff dışındaki Git metadata değişikliğini fail-closed yakalar.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {spawnGitSync} from "./git-isolation.mjs";
const run=(cwd,args)=>{const r=spawnGitSync(cwd,args);return r.status===0?r.stdout:"[ERROR]"};
const digestText=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
function hashFile(p){try{return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}catch{return null}}
function hookState(common){const d=path.join(common,"hooks");if(!fs.existsSync(d))return {};return Object.fromEntries(fs.readdirSync(d).sort().map(n=>[n,hashFile(path.join(d,n))]));}
export function captureGitMetadata(cwd){let common=run(cwd,["rev-parse","--git-common-dir"]).trim();if(!path.isAbsolute(common))common=path.resolve(cwd,common);return {
 localConfigDigest:digestText(run(cwd,["config","--local","--list","--show-origin"])),remotesDigest:digestText(run(cwd,["remote","-v"])),refsDigest:digestText(run(cwd,["show-ref","--head"])),head:run(cwd,["rev-parse","HEAD"]).trim(),worktreesDigest:digestText(run(cwd,["worktree","list","--porcelain"])),
 hooks:hookState(common),gitmodules:hashFile(path.join(cwd,".gitmodules")),gitattributes:hashFile(path.join(cwd,".gitattributes")),gitPointer:hashFile(path.join(cwd,".git")),commonConfig:hashFile(path.join(common,"config"))};}
export function assertGitMetadataUnchanged(before,after){const keys=[...new Set([...Object.keys(before??{}),...Object.keys(after??{})])].filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k]));if(keys.length)throw new Error(`GIT_METADATA_MUTATION_DETECTED fields=${keys.join(",")}`);return true}
