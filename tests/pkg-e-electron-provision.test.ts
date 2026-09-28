// //TR: Bu test Electron açık temin helper'ının hedefi yalnız reviewed checksums.json'dan türettiğini, indirmeyi yalnız izinli GitHub host'larına sınırladığını, eksik/uyuşmaz/tahrif edilmiş temini fail-closed reddettiğini ve installer'ın temini smoke öncesi açıkça çağırdığını ağ erişimi olmadan doğrular.
import {describe,it,expect,afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {electronTarget,allowedDownloadUrl,verifyProvisionedElectron} from "../automation/lib/electron-provision.mjs";
const sha=(b:Buffer|string)=>crypto.createHash("sha256").update(b).digest("hex");
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))fs.rmSync(r,{recursive:true,force:true})});
const win={platform:"win32",arch:"x64"};
function fixture({zipSha="a".repeat(64),provision=true,manifest={},distVersion="44.4.5",exeBytes="MZ-electron"}:{zipSha?:string,provision?:boolean,manifest?:Record<string,unknown>,distVersion?:string,exeBytes?:string}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-electron-"));roots.push(root);const pkg=path.join(root,"node_modules","electron");fs.mkdirSync(pkg,{recursive:true});
  fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({name:"electron",version:"44.4.5"}));fs.writeFileSync(path.join(pkg,"checksums.json"),JSON.stringify({"electron-v44.4.5-win32-x64.zip":zipSha}));
  if(provision){const dist=path.join(root,".ai","cache","electron","44.4.5-win32-x64","dist");fs.mkdirSync(dist,{recursive:true});fs.writeFileSync(path.join(dist,"version"),distVersion);fs.writeFileSync(path.join(dist,"electron.exe"),exeBytes);
    fs.writeFileSync(path.join(dist,"..","PROVISIONED.json"),JSON.stringify({version:"44.4.5",artifact:"electron-v44.4.5-win32-x64.zip",zipSha256:zipSha,exe:"electron.exe",exeSha256:sha(exeBytes),...manifest}))}
  return root;
}
describe("Electron provisioning target",()=>{
  it("derives artifact, URL and expected SHA-256 only from the installed electron package",()=>{const t=electronTarget(fixture({provision:false,zipSha:"b".repeat(64)}),win);expect(t.artifact).toBe("electron-v44.4.5-win32-x64.zip");expect(t.url).toBe("https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-win32-x64.zip");expect(t.expectedSha256).toBe("b".repeat(64));expect(t.dir).toContain(path.join(".ai","cache","electron","44.4.5-win32-x64"));expect(t.dir).not.toContain("node_modules")});
  it("fails closed when the reviewed checksum for the artifact is missing",()=>expect(()=>electronTarget(fixture({provision:false,zipSha:"not-a-sha"}),win)).toThrow(/^ELECTRON_CHECKSUM_MISSING:/));
  it("fails closed on an unsupported platform",()=>expect(()=>electronTarget(fixture({provision:false}),{platform:"sunos",arch:"x64"})).toThrow(/^ELECTRON_PLATFORM_UNSUPPORTED:/));
});
describe("Electron download host allowlist",()=>{
  for(const ok of ["https://github.com/electron/electron/releases/download/v44.4.5/x.zip","https://release-assets.githubusercontent.com/a/b","https://objects.githubusercontent.com/a/b"])it(`allows ${new URL(ok).hostname}`,()=>expect(allowedDownloadUrl(ok)).toBe(true));
  for(const bad of ["http://github.com/x.zip","https://evil.example/x.zip","https://github.com:8443/x.zip","https://user:pw@github.com/x.zip","https://github.com.evil.example/x.zip","not a url"])it(`denies ${bad}`,()=>expect(allowedDownloadUrl(bad)).toBe(false));
});
describe("verifyProvisionedElectron",()=>{
  it("returns the verified executable path",()=>{const root=fixture();expect(verifyProvisionedElectron(root,win)).toBe(path.resolve(root,".ai","cache","electron","44.4.5-win32-x64","dist","electron.exe"))});
  it("fails closed when nothing is provisioned",()=>expect(()=>verifyProvisionedElectron(fixture({provision:false}),win)).toThrow(/ELECTRON_BINARY_NOT_PROVISIONED:MANIFEST_MISSING/));
  it("fails closed when the manifest zip checksum differs from the reviewed checksum",()=>expect(()=>verifyProvisionedElectron(fixture({manifest:{zipSha256:"c".repeat(64)}}),win)).toThrow(/MANIFEST_MISMATCH/));
  it("fails closed when dist/version differs from the installed package version",()=>expect(()=>verifyProvisionedElectron(fixture({distVersion:"43.0.0"}),win)).toThrow(/DIST_VERSION_MISMATCH/));
  it("fails closed when the executable was modified after provisioning",()=>{const root=fixture();fs.appendFileSync(path.join(root,".ai","cache","electron","44.4.5-win32-x64","dist","electron.exe"),"tamper");expect(()=>verifyProvisionedElectron(root,win)).toThrow(/EXECUTABLE_SHA256_MISMATCH/)});
  it("fails closed when the executable is not a regular file",()=>{const root=fixture(),exe=path.join(root,".ai","cache","electron","44.4.5-win32-x64","dist","electron.exe");fs.rmSync(exe);fs.mkdirSync(exe);expect(()=>verifyProvisionedElectron(root,win)).toThrow(/EXECUTABLE_NOT_REGULAR_FILE/)});
});
describe("provisioning step and installer wiring",()=>{
  const script=fs.readFileSync("scripts/provision-electron.mjs","utf8"),install=fs.readFileSync("scripts/install.ps1","utf8"),prot=JSON.parse(fs.readFileSync("config/protected-paths.json","utf8"));
  it("verifies the reviewed dependency seal before trusting checksums.json",()=>expect(script.indexOf("assertInstalledDependencyState(root)")).toBeGreaterThan(-1));
  it("follows redirects manually through the host allowlist and verifies SHA-256 before extraction",()=>{expect(script).toContain('redirect:"manual"');expect(script).toContain("if(!allowedDownloadUrl(current))");expect(script).toContain("ELECTRON_ZIP_CHECKSUM_MISMATCH");expect(script.indexOf("ELECTRON_ZIP_CHECKSUM_MISMATCH")).toBeLessThan(script.indexOf("cp.spawnSync(extractor[0]"))});
  it("extracts without a shell into staging outside node_modules and renames atomically",()=>{expect(script).not.toMatch(/\bshell\s*:/);expect(script).toContain('"System32","tar.exe"');expect(script).toContain("fs.renameSync(staging,t.dir)");expect(script).toContain("assertNoEscapingLinks")});
  it("installer provisions Electron explicitly before the Control Tower smoke",()=>{expect(install).toContain('Run-Step "electron-provision" {node ".\\scripts\\provision-electron.mjs"');expect(install.indexOf('Run-Step "electron-provision"')).toBeLessThan(install.indexOf('Run-Step "control-tower-smoke"'))});
  it("keeps the provisioning step inside the protected trust root",()=>{expect(prot.exactPaths).toContain("scripts/provision-electron.mjs");expect(prot.protectedPrefixes).toContain("automation/lib/")});
});
