// //TR: Bu protected helper Electron binary'sinin reviewed lock içindeki checksums.json ile doğrulanmış açık temin hedefini, izinli indirme host'larını ve smoke öncesi temin doğrulamasını (manifest + sürüm + exe SHA-256) fail-closed tanımlar; binary node_modules dışında tutulduğu için installed-tree mührü bozulmaz.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ELECTRON_CACHE_DIR=path.join(".ai","cache","electron");
const EXECUTABLE={win32:"electron.exe",linux:"electron",darwin:"Electron.app/Contents/MacOS/Electron"};
const DOWNLOAD_HOSTS=new Set(["github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"]);
const readJson=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^﻿/,""));
export const fileSha256=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

export function electronTarget(root,{platform=process.platform,arch=process.arch}={}){
 const pkgDir=path.join(root,"node_modules","electron"),version=readJson(path.join(pkgDir,"package.json")).version,exe=EXECUTABLE[platform];
 if(typeof version!=="string"||!/^\d+\.\d+\.\d+$/.test(version))throw new Error(`ELECTRON_PACKAGE_VERSION_INVALID:${version}`);if(!exe)throw new Error(`ELECTRON_PLATFORM_UNSUPPORTED:${platform}`);
 const artifact=`electron-v${version}-${platform}-${arch}.zip`,expectedSha256=readJson(path.join(pkgDir,"checksums.json"))[artifact];
 if(!/^[0-9a-f]{64}$/.test(String(expectedSha256??"")))throw new Error(`ELECTRON_CHECKSUM_MISSING:${artifact}`);
 const dir=path.join(root,ELECTRON_CACHE_DIR,`${version}-${platform}-${arch}`);
 return {version,platform,arch,artifact,expectedSha256,url:`https://github.com/electron/electron/releases/download/v${version}/${artifact}`,dir,distDir:path.join(dir,"dist"),exe,exePath:path.join(dir,"dist",exe),manifestFile:path.join(dir,"PROVISIONED.json")};
}
export function allowedDownloadUrl(raw){let u;try{u=new URL(String(raw))}catch{return false}return u.protocol==="https:"&&DOWNLOAD_HOSTS.has(u.hostname.toLowerCase())&&!u.port&&!u.username&&!u.password}
export function verifyProvisionedElectron(root,options={}){
 const t=electronTarget(root,options),fail=why=>{throw new Error(`ELECTRON_BINARY_NOT_PROVISIONED:${why}: run scripts/provision-electron.mjs; smoke never downloads Electron implicitly`)};
 if(!fs.existsSync(t.manifestFile))fail("MANIFEST_MISSING");let m;try{m=readJson(t.manifestFile)}catch{fail("MANIFEST_INVALID")}
 if(m.version!==t.version||m.artifact!==t.artifact||m.zipSha256!==t.expectedSha256||m.exe!==t.exe)fail("MANIFEST_MISMATCH");
 let distVersion="";try{distVersion=fs.readFileSync(path.join(t.distDir,"version"),"utf8").trim().replace(/^v/,"")}catch{}if(distVersion!==t.version)fail("DIST_VERSION_MISMATCH");
 let st;try{st=fs.lstatSync(t.exePath)}catch{fail("EXECUTABLE_MISSING")}if(!st.isFile())fail("EXECUTABLE_NOT_REGULAR_FILE");
 if(!/^[0-9a-f]{64}$/.test(String(m.exeSha256??""))||fileSha256(t.exePath)!==m.exeSha256)fail("EXECUTABLE_SHA256_MISMATCH");
 return path.resolve(t.exePath);
}
