// //TR: Bu protected helper Electron binary'sinin açık temin hedefini, izinli indirme host'larını ve smoke/yeniden-kullanım öncesi temin doğrulamasını tanımlar; güven kökü mühürlü node_modules içindeki checksums.json'dır: saklanan zip SHA-256'sı ona, dist altındaki her dosya da zip içeriğine birebir bağlanır, yazılabilir cache manifest'i güven kaynağı değildir.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {Writable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {assertInstalledDependencyState} from "./dependency-install.mjs";

export const ELECTRON_CACHE_DIR=path.join(".ai","cache","electron");
const EXECUTABLE={win32:"electron.exe",linux:"electron",darwin:"Electron.app/Contents/MacOS/Electron"};
const DOWNLOAD_HOSTS=new Set(["github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"]);
const readJson=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
export const fileSha256=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
async function streamSha256(stages){const h=crypto.createHash("sha256");let bytes=0;await pipeline(...stages,new Writable({write(c,_e,cb){h.update(c);bytes+=c.length;cb()}}));return {sha256:h.digest("hex"),bytes}}

export function electronTarget(root,{platform=process.platform,arch=process.arch}={}){
 const pkgDir=path.join(root,"node_modules","electron"),version=readJson(path.join(pkgDir,"package.json")).version,exe=EXECUTABLE[platform];
 if(typeof version!=="string"||!/^\d+\.\d+\.\d+$/.test(version))throw new Error(`ELECTRON_PACKAGE_VERSION_INVALID:${version}`);if(!exe)throw new Error(`ELECTRON_PLATFORM_UNSUPPORTED:${platform}`);
 const artifact=`electron-v${version}-${platform}-${arch}.zip`,expectedSha256=readJson(path.join(pkgDir,"checksums.json"))[artifact];
 if(!/^[0-9a-f]{64}$/.test(String(expectedSha256??"")))throw new Error(`ELECTRON_CHECKSUM_MISSING:${artifact}`);
 const dir=path.join(root,ELECTRON_CACHE_DIR,`${version}-${platform}-${arch}`);
 return {version,platform,arch,artifact,expectedSha256,url:`https://github.com/electron/electron/releases/download/v${version}/${artifact}`,dir,distDir:path.join(dir,"dist"),archiveFile:path.join(dir,"archive",artifact),exe,exePath:path.join(dir,"dist",exe),manifestFile:path.join(dir,"PROVISIONED.json")};
}
export function allowedDownloadUrl(raw){let u;try{u=new URL(String(raw))}catch{return false}return u.protocol==="https:"&&DOWNLOAD_HOSTS.has(u.hostname.toLowerCase())&&!u.port&&!u.username&&!u.password}

// //TR: Minimal ZIP merkezi dizin okuyucu; zip64, şifreli giriş, bilinmeyen sıkıştırma, sembolik link ve güvensiz yol adları fail-closed reddedilir.
function safeEntryName(name){return !(!name||name.includes("\\")||name.includes("\0")||name.startsWith("/")||/^[A-Za-z]:/.test(name)||name.replace(/\/$/,"").split("/").some(s=>s===""||s==="."||s===".."))}
export function readZipEntries(zipPath){
 const fd=fs.openSync(zipPath,"r");try{const size=fs.fstatSync(fd).size,tailLen=Math.min(size,65557),tail=Buffer.alloc(tailLen);fs.readSync(fd,tail,0,tailLen,size-tailLen);let eocd=-1;for(let i=tailLen-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){eocd=i;break}
  if(eocd<0)throw new Error("ELECTRON_ARCHIVE_EOCD_MISSING");const total=tail.readUInt16LE(eocd+10),cdSize=tail.readUInt32LE(eocd+12),cdOff=tail.readUInt32LE(eocd+16);if(total===0xffff||cdSize===0xffffffff||cdOff===0xffffffff)throw new Error("ELECTRON_ARCHIVE_ZIP64_UNSUPPORTED");
  const cd=Buffer.alloc(cdSize);fs.readSync(fd,cd,0,cdSize,cdOff);const entries=[];let p=0;
  for(let i=0;i<total;i++){if(p+46>cd.length||cd.readUInt32LE(p)!==0x02014b50)throw new Error("ELECTRON_ARCHIVE_CENTRAL_DIRECTORY_CORRUPT");const madeBy=cd.readUInt16LE(p+4),flags=cd.readUInt16LE(p+8),method=cd.readUInt16LE(p+10),csize=cd.readUInt32LE(p+20),usize=cd.readUInt32LE(p+24),nlen=cd.readUInt16LE(p+28),xlen=cd.readUInt16LE(p+30),clen=cd.readUInt16LE(p+32),ext=cd.readUInt32LE(p+38),localOffset=cd.readUInt32LE(p+42),name=cd.toString("utf8",p+46,p+46+nlen);p+=46+nlen+xlen+clen;
   if(!safeEntryName(name))throw new Error(`ELECTRON_ARCHIVE_ENTRY_NAME_INVALID:${JSON.stringify(name)}`);if(flags&1)throw new Error(`ELECTRON_ARCHIVE_ENTRY_ENCRYPTED:${name}`);if(csize===0xffffffff||usize===0xffffffff||localOffset===0xffffffff)throw new Error("ELECTRON_ARCHIVE_ZIP64_UNSUPPORTED");
   if((madeBy>>8)===3&&((ext>>>16)&0o170000)===0o120000)throw new Error(`ELECTRON_ARCHIVE_SYMLINK_UNSUPPORTED:${name}`);if(!name.endsWith("/")&&method!==0&&method!==8)throw new Error(`ELECTRON_ARCHIVE_METHOD_UNSUPPORTED:${name}:${method}`);
   entries.push({name,isDirectory:name.endsWith("/"),method,csize,usize,localOffset})}
  return entries}finally{fs.closeSync(fd)}
}
async function zipEntrySha256(zipPath,e){if(e.csize===0){if(e.usize!==0)throw new Error(`ELECTRON_ARCHIVE_ENTRY_SIZE_MISMATCH:${e.name}`);return crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex")}
 const fd=fs.openSync(zipPath,"r"),lh=Buffer.alloc(30);try{fs.readSync(fd,lh,0,30,e.localOffset)}finally{fs.closeSync(fd)}if(lh.readUInt32LE(0)!==0x04034b50)throw new Error(`ELECTRON_ARCHIVE_LOCAL_HEADER_CORRUPT:${e.name}`);
 const start=e.localOffset+30+lh.readUInt16LE(26)+lh.readUInt16LE(28),src=fs.createReadStream(zipPath,{start,end:start+e.csize-1}),r=await streamSha256(e.method===8?[src,zlib.createInflateRaw()]:[src]);if(r.bytes!==e.usize)throw new Error(`ELECTRON_ARCHIVE_ENTRY_SIZE_MISMATCH:${e.name}`);return r.sha256}
function listRegularFiles(dir){const out=[];const walk=(d,rel)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name),r=rel?`${rel}/${e.name}`:e.name;if(e.isSymbolicLink())throw new Error(`ELECTRON_BINARY_NOT_PROVISIONED:DIST_SYMLINK:${r}`);if(e.isDirectory())walk(p,r);else if(e.isFile())out.push(r);else throw new Error(`ELECTRON_BINARY_NOT_PROVISIONED:DIST_SPECIAL_FILE:${r}`)}};walk(dir,"");return out}

export async function verifyProvisionedElectron(root,{platform,arch,assertSeal=assertInstalledDependencyState}={}){
 // //TR: checksums.json güven köküdür; ona güvenmeden önce reviewed lock installed-tree mührü doğrulanır.
 assertSeal(root);
 const t=electronTarget(root,{platform,arch}),fail=why=>{throw new Error(`ELECTRON_BINARY_NOT_PROVISIONED:${why}: run scripts/provision-electron.mjs; smoke never downloads Electron implicitly`)};
 if(!fs.existsSync(t.manifestFile))fail("MANIFEST_MISSING");let m;try{m=readJson(t.manifestFile)}catch{fail("MANIFEST_INVALID")}
 if(m.version!==t.version||m.artifact!==t.artifact||m.zipSha256!==t.expectedSha256||m.exe!==t.exe)fail("MANIFEST_MISMATCH");
 if(!fs.existsSync(t.archiveFile))fail("ARCHIVE_MISSING");if((await streamSha256([fs.createReadStream(t.archiveFile)])).sha256!==t.expectedSha256)fail("ARCHIVE_CHECKSUM_MISMATCH");
 if(!fs.existsSync(t.distDir))fail("DIST_MISSING");const files=readZipEntries(t.archiveFile).filter(e=>!e.isDirectory),expected=new Set(files.map(e=>e.name)),actual=listRegularFiles(t.distDir);
 for(const f of actual)if(!expected.has(f))fail(`DIST_EXTRA_FILE:${f}`);const present=new Set(actual);for(const f of expected)if(!present.has(f))fail(`DIST_FILE_MISSING:${f}`);
 for(const e of files){const onDisk=(await streamSha256([fs.createReadStream(path.join(t.distDir,...e.name.split("/")))])).sha256;if(onDisk!==await zipEntrySha256(t.archiveFile,e))fail(`DIST_CONTENT_MISMATCH:${e.name}`)}
 let distVersion="";try{distVersion=fs.readFileSync(path.join(t.distDir,"version"),"utf8").trim().replace(/^v/,"")}catch{}if(distVersion!==t.version)fail("DIST_VERSION_MISMATCH");
 let st;try{st=fs.lstatSync(t.exePath)}catch{fail("EXECUTABLE_MISSING")}if(!st.isFile())fail("EXECUTABLE_NOT_REGULAR_FILE");
 return path.resolve(t.exePath);
}
