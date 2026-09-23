// //TR: Bu helper source-reviewed package-lock olmadan dependency kurmaz; lock/package digest state değişince node_modules'u deterministic npm ci --ignore-scripts ile yeniden kurar.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
const sha256=b=>crypto.createHash("sha256").update(b).digest("hex");
const readJson=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sections=["dependencies","devDependencies","optionalDependencies","peerDependencies"];
function sameMap(a={},b={}){const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return JSON.stringify(ak)===JSON.stringify(bk)&&ak.every(k=>a[k]===b[k])}
export function dependencyState(root){
 const pkgFile=path.join(root,"package.json"),lockFile=path.join(root,"package-lock.json");
 if(!fs.existsSync(pkgFile))throw new Error("PACKAGE_JSON_MISSING");
 if(!fs.existsSync(lockFile))throw new Error("SOURCE_REVIEWED_PACKAGE_LOCK_REQUIRED");
 const pkgBytes=fs.readFileSync(pkgFile),lockBytes=fs.readFileSync(lockFile),lock=JSON.parse(lockBytes.toString("utf8").replace(/^\uFEFF/,"")),pkg=JSON.parse(pkgBytes.toString("utf8").replace(/^\uFEFF/,""));
 if(lock.lockfileVersion!==3)throw new Error(`PACKAGE_LOCK_VERSION_UNSUPPORTED:${lock.lockfileVersion??"MISSING"}`);
 const rootEntry=lock.packages?.[""];if(!rootEntry)throw new Error("PACKAGE_LOCK_ROOT_ENTRY_MISSING");
 for(const section of sections)if(!sameMap(pkg[section]??{},rootEntry[section]??{}))throw new Error(`PACKAGE_LOCK_ROOT_MISMATCH:${section}`);
 return {lockSha256:sha256(lockBytes),packageSha256:sha256(pkgBytes)};
}
export function ensureDependencies(root,{npmCommand=process.platform==="win32"?"npm.cmd":"npm",cacheDir=null,preferOffline=false,spawnSync=cp.spawnSync}={}){
 root=path.resolve(root);const state=dependencyState(root),modules=path.join(root,"node_modules"),marker=path.join(modules,".uasco-dependency-state.json");
 try{const prior=readJson(marker);if(prior.lockSha256===state.lockSha256&&prior.packageSha256===state.packageSha256)return {mode:"EXISTING_REVIEWED_LOCK",...state}}
 catch{}
 fs.rmSync(modules,{recursive:true,force:true});
 const args=["ci","--ignore-scripts","--no-audit","--no-fund"];
 if(preferOffline)args.push("--prefer-offline");if(cacheDir){fs.mkdirSync(cacheDir,{recursive:true});args.push("--cache",cacheDir)}
 const r=spawnSync(npmCommand,args,{cwd:root,encoding:"utf8",windowsHide:true,env:process.env});
 if(r.status!==0)throw new Error(`NPM_CI_REVIEWED_LOCK_FAILED:${r.stderr||r.stdout||`exit=${r.status}`}`);
 fs.mkdirSync(modules,{recursive:true});fs.writeFileSync(marker,JSON.stringify({"//TR":"Bu marker node_modules'un exact source-reviewed lock/package digestine göre güvenli npm ci ile kurulduğunu kaydeder.",...state},null,2)+"\n",{encoding:"utf8"});
 return {mode:"NPM_CI_REVIEWED_LOCK",...state};
}
