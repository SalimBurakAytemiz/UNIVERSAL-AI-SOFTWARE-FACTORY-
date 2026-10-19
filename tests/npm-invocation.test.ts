// //TR: Bu test Windows npm.cmd EINVAL regresyonuna karşı npm'in shell'siz node + bundled npm-cli.js ile çağrıldığını, eksik veya düzenli dosya olmayan CLI'nin fail-closed reddedildiğini ve trusted kaynakta npm.cmd spawn'ı kalmadığını doğrular.
import {describe,it,expect,vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {resolveNpmInvocation,npmSpawnArgs} from "../automation/lib/npm-invocation.mjs";
const regular={isFile:()=>true},notRegular={isFile:()=>false};
const winNode="C:\\Program Files\\nodejs\\node.exe",winCli="C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
describe("npm invocation",()=>{
  it("keeps PATH npm off Windows without probing the filesystem",()=>expect(resolveNpmInvocation({platform:"linux",execPath:"/usr/bin/node",lstatSync:()=>{throw new Error("MUST_NOT_STAT")}})).toEqual({command:"npm",prefixArgs:[],mode:"PATH_NPM"}));
  it("runs bundled npm-cli.js through node on Windows instead of npm.cmd",()=>{const seen:string[]=[];const inv=resolveNpmInvocation({platform:"win32",execPath:winNode,lstatSync:p=>{seen.push(p);return regular}});expect(inv).toEqual({command:winNode,prefixArgs:[winCli],mode:"NODE_BUNDLED_NPM_CLI"});expect(seen).toEqual([winCli]);expect(inv.command).not.toMatch(/\.(cmd|bat)$/i)});
  it("fails closed when bundled npm-cli.js is missing",()=>expect(()=>resolveNpmInvocation({platform:"win32",execPath:winNode,lstatSync:()=>{throw Object.assign(new Error("ENOENT"),{code:"ENOENT"})}})).toThrow(/^NPM_CLI_NOT_FOUND:/));
  it("fails closed when npm-cli.js is a symlink or directory",()=>expect(()=>resolveNpmInvocation({platform:"win32",execPath:winNode,lstatSync:()=>notRegular})).toThrow(/^NPM_CLI_NOT_REGULAR_FILE:/));
  it("prefixes npm arguments with the resolved CLI",()=>expect(npmSpawnArgs(["ci","--ignore-scripts"],{platform:"win32",execPath:winNode,lstatSync:()=>regular})).toEqual({command:winNode,args:[winCli,"ci","--ignore-scripts"]}));
  it("spawns the resolved npm on this host without a shell",()=>{const inv=resolveNpmInvocation();const r=cp.spawnSync(inv.command,[...inv.prefixArgs,"--version"],{encoding:"utf8",windowsHide:true});expect(r.error).toBeUndefined();expect(r.status).toBe(0);expect(String(r.stdout).trim()).toMatch(/^\d+\.\d+\.\d+/)});
  it("leaves no npm.cmd spawn in trusted sources",()=>{const offenders:string[]=[];for(const dir of ["automation","automation/lib","scripts"])for(const f of fs.readdirSync(dir))if(/\.m?js$/.test(f)&&fs.readFileSync(path.join(dir,f),"utf8").includes('"npm.cmd"'))offenders.push(`${dir}/${f}`);expect(offenders).toEqual([])});
});
