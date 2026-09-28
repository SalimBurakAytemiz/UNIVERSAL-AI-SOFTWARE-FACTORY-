// //TR: Bu test Electron açık temin helper'ının hedefi yalnız reviewed checksums.json'dan türettiğini, indirmeyi izinli GitHub host'larına sınırladığını, dist içeriğini mühürlü checksum'a bağlı arşive birebir bağladığını (exe + manifest birlikte değiştirilse bile reddedilir) ve installer'ın temini smoke öncesi açıkça çağırdığını ağ erişimi olmadan doğrular.
import {describe,it,expect,afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {electronTarget,allowedDownloadUrl,readZipEntries,verifyProvisionedElectron} from "../automation/lib/electron-provision.mjs";
const sha=(b:Buffer|string)=>crypto.createHash("sha256").update(b).digest("hex");
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))fs.rmSync(r,{recursive:true,force:true})});
const win={platform:"win32",arch:"x64",assertSeal:()=>undefined};
type ZipFile={name:string,data?:Buffer};
function makeZip(files:ZipFile[]):Buffer{const locals:Buffer[]=[],cds:Buffer[]=[];let off=0;for(const f of files){const nameB=Buffer.from(f.name),data=f.data??Buffer.alloc(0),dir=f.name.endsWith("/"),comp=dir?data:zlib.deflateRawSync(data),method=dir?0:8,crc=zlib.crc32(data);
  const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(method,8);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(comp.length,18);lh.writeUInt32LE(data.length,22);lh.writeUInt16LE(nameB.length,26);locals.push(lh,nameB,comp);
  const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(method,10);cd.writeUInt32LE(crc,16);cd.writeUInt32LE(comp.length,20);cd.writeUInt32LE(data.length,24);cd.writeUInt16LE(nameB.length,28);cd.writeUInt32LE(off,42);cds.push(cd,nameB);off+=30+nameB.length+comp.length}
  const cdBuf=Buffer.concat(cds),eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(files.length,8);eocd.writeUInt16LE(files.length,10);eocd.writeUInt32LE(cdBuf.length,12);eocd.writeUInt32LE(off,16);return Buffer.concat([...locals,cdBuf,eocd])}
const archiveFiles=(version="44.4.5"):ZipFile[]=>[{name:"version",data:Buffer.from(version)},{name:"electron.exe",data:Buffer.from("MZ-genuine-electron-binary")},{name:"resources/"},{name:"resources/default_app.asar",data:crypto.randomBytes(4096)}];
function fixture({files=archiveFiles(),provision=true,checksumOverride,manifest={}}:{files?:ZipFile[],provision?:boolean,checksumOverride?:string,manifest?:Record<string,unknown>}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-electron-"));roots.push(root);const pkg=path.join(root,"node_modules","electron");fs.mkdirSync(pkg,{recursive:true});const zip=makeZip(files),zipSha=checksumOverride??sha(zip);
  fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({name:"electron",version:"44.4.5"}));fs.writeFileSync(path.join(pkg,"checksums.json"),JSON.stringify({"electron-v44.4.5-win32-x64.zip":zipSha}));
  const dir=path.join(root,".ai","cache","electron","44.4.5-win32-x64");
  if(provision){fs.mkdirSync(path.join(dir,"archive"),{recursive:true});fs.writeFileSync(path.join(dir,"archive","electron-v44.4.5-win32-x64.zip"),zip);for(const f of files){const p=path.join(dir,"dist",...f.name.split("/"));if(f.name.endsWith("/"))fs.mkdirSync(p,{recursive:true});else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,f.data??Buffer.alloc(0))}}
    fs.writeFileSync(path.join(dir,"PROVISIONED.json"),JSON.stringify({version:"44.4.5",artifact:"electron-v44.4.5-win32-x64.zip",zipSha256:zipSha,exe:"electron.exe",exeSha256:sha(files.find(f=>f.name==="electron.exe")?.data??""),...manifest}))}
  return {root,dir,dist:path.join(dir,"dist")};
}
describe("Electron provisioning target",()=>{
  it("derives artifact, URL, archive and expected SHA-256 only from the installed electron package",()=>{const {root}=fixture({provision:false,checksumOverride:"b".repeat(64)});const t=electronTarget(root,win);expect(t.artifact).toBe("electron-v44.4.5-win32-x64.zip");expect(t.url).toBe("https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-win32-x64.zip");expect(t.expectedSha256).toBe("b".repeat(64));expect(t.archiveFile).toContain(path.join(".ai","cache","electron","44.4.5-win32-x64","archive"));expect(t.dir).not.toContain("node_modules")});
  it("fails closed when the reviewed checksum for the artifact is missing",()=>expect(()=>electronTarget(fixture({provision:false,checksumOverride:"not-a-sha"}).root,win)).toThrow(/^ELECTRON_CHECKSUM_MISSING:/));
  it("fails closed on an unsupported platform",()=>expect(()=>electronTarget(fixture({provision:false}).root,{platform:"sunos",arch:"x64"})).toThrow(/^ELECTRON_PLATFORM_UNSUPPORTED:/));
});
describe("Electron download host allowlist",()=>{
  for(const ok of ["https://github.com/electron/electron/releases/download/v44.4.5/x.zip","https://release-assets.githubusercontent.com/a/b","https://objects.githubusercontent.com/a/b"])it(`allows ${new URL(ok).hostname}`,()=>expect(allowedDownloadUrl(ok)).toBe(true));
  for(const bad of ["http://github.com/x.zip","https://evil.example/x.zip","https://github.com:8443/x.zip","https://user:pw@github.com/x.zip","https://github.com.evil.example/x.zip","not a url"])it(`denies ${bad}`,()=>expect(allowedDownloadUrl(bad)).toBe(false));
});
describe("archive-bound verifyProvisionedElectron",()=>{
  it("accepts a legitimate provision only after the dependency seal check",async()=>{const {root,dist}=fixture();const calls:string[]=[];expect(await verifyProvisionedElectron(root,{...win,assertSeal:r=>{calls.push(r)}})).toBe(path.resolve(dist,"electron.exe"));expect(calls).toEqual([root])});
  it("rejects when the dependency seal check fails",async()=>{const {root}=fixture();await expect(verifyProvisionedElectron(root,{...win,assertSeal:()=>{throw new Error("DEPENDENCY_STATE_INSTALLED_TREE_MISMATCH")}})).rejects.toThrow(/DEPENDENCY_STATE_INSTALLED_TREE_MISMATCH/)});
  it("rejects a replaced executable even when the manifest is rewritten to match it (F-PKGE-001)",async()=>{const {root,dist}=fixture(),evil=Buffer.from("MZ-attacker-binary");fs.writeFileSync(path.join(dist,"electron.exe"),evil);const mf=path.join(dist,"..","PROVISIONED.json"),m=JSON.parse(fs.readFileSync(mf,"utf8"));m.exeSha256=sha(evil);fs.writeFileSync(mf,JSON.stringify(m));await expect(verifyProvisionedElectron(root,win)).rejects.toThrow(/DIST_CONTENT_MISMATCH:electron\.exe/)});
  it("rejects an extra file dropped next to the executable",async()=>{const {root,dist}=fixture();fs.writeFileSync(path.join(dist,"version.dll"),"hijack");await expect(verifyProvisionedElectron(root,win)).rejects.toThrow(/DIST_EXTRA_FILE:version\.dll/)});
  it("rejects a missing archived file",async()=>{const {root,dist}=fixture();fs.rmSync(path.join(dist,"resources","default_app.asar"));await expect(verifyProvisionedElectron(root,win)).rejects.toThrow(/DIST_FILE_MISSING:resources\/default_app\.asar/)});
  it("rejects a replaced archive that no longer matches checksums.json",async()=>{const {root,dir}=fixture();fs.writeFileSync(path.join(dir,"archive","electron-v44.4.5-win32-x64.zip"),makeZip(archiveFiles().map(f=>f.name==="electron.exe"?{...f,data:Buffer.from("MZ-other")}:f)));await expect(verifyProvisionedElectron(root,win)).rejects.toThrow(/ARCHIVE_CHECKSUM_MISMATCH/)});
  it("rejects when the verified archive is missing",async()=>{const {root,dir}=fixture();fs.rmSync(path.join(dir,"archive"),{recursive:true});await expect(verifyProvisionedElectron(root,win)).rejects.toThrow(/ARCHIVE_MISSING/)});
  it("rejects when nothing is provisioned",async()=>{await expect(verifyProvisionedElectron(fixture({provision:false}).root,win)).rejects.toThrow(/ELECTRON_BINARY_NOT_PROVISIONED:MANIFEST_MISSING/)});
  it("rejects a manifest whose checksum differs from checksums.json",async()=>{await expect(verifyProvisionedElectron(fixture({manifest:{zipSha256:"c".repeat(64)}}).root,win)).rejects.toThrow(/MANIFEST_MISMATCH/)});
  it("rejects an archive whose version differs from the installed package",async()=>{await expect(verifyProvisionedElectron(fixture({files:archiveFiles("43.0.0")}).root,win)).rejects.toThrow(/DIST_VERSION_MISMATCH/)});
  it("rejects an executable path that is not a regular file",async()=>{const {root,dist}=fixture();fs.rmSync(path.join(dist,"electron.exe"));fs.mkdirSync(path.join(dist,"electron.exe"));await expect(verifyProvisionedElectron(root,win)).rejects.toThrow(/DIST_FILE_MISSING:electron\.exe/)});
  it("rejects archive entries with traversal names",()=>{const {root,dir}=fixture({files:[...archiveFiles(),{name:"../evil.dll",data:Buffer.from("x")}]});expect(()=>readZipEntries(path.join(dir,"archive","electron-v44.4.5-win32-x64.zip"))).toThrow(/ELECTRON_ARCHIVE_ENTRY_NAME_INVALID/);void root});
});
describe("provisioning step and installer wiring",()=>{
  const script=fs.readFileSync("scripts/provision-electron.mjs","utf8"),install=fs.readFileSync("scripts/install.ps1","utf8"),prot=JSON.parse(fs.readFileSync("config/protected-paths.json","utf8"));
  it("verifies the reviewed dependency seal before trusting checksums.json",()=>expect(script.indexOf("assertInstalledDependencyState(root)")).toBeGreaterThan(-1));
  it("follows redirects manually through the host allowlist and verifies SHA-256 before extraction",()=>{expect(script).toContain('redirect:"manual"');expect(script).toContain("if(!allowedDownloadUrl(current))");expect(script).toContain("ELECTRON_ZIP_CHECKSUM_MISMATCH");expect(script.indexOf("ELECTRON_ZIP_CHECKSUM_MISMATCH")).toBeLessThan(script.indexOf("cp.spawnSync(extractor[0]"))});
  it("extracts without a shell, keeps the verified archive and renames atomically",()=>{expect(script).not.toMatch(/\bshell\s*:/);expect(script).toContain('"System32","tar.exe"');expect(script).toContain('fs.renameSync(zip,path.join(staging,"archive",t.artifact))');expect(script).toContain("fs.renameSync(staging,t.dir)");expect(script).toContain("assertNoEscapingLinks")});
  it("gates EXISTING reuse and the final result on the archive-bound verifier",()=>expect(script.match(/await verifyProvisionedElectron\(root\)/g)?.length).toBe(2));
  it("installer provisions Electron explicitly before the Control Tower smoke",()=>{expect(install).toContain('Run-Step "electron-provision" {node ".\\scripts\\provision-electron.mjs"');expect(install.indexOf('Run-Step "electron-provision"')).toBeLessThan(install.indexOf('Run-Step "control-tower-smoke"'))});
  it("keeps the provisioning step inside the protected trust root",()=>{expect(prot.exactPaths).toContain("scripts/provision-electron.mjs");expect(prot.protectedPrefixes).toContain("automation/lib/")});
});
