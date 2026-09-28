// //TR: Bu test //TR kaynak taramasının git'e girmeyen .ai/cache/ makine cache'ini (npm cache, Electron binary) atladığını, fakat kaynak dosyalarda eksik //TR'yi yakalamaya devam ettiğini gerçek validator çalıştırarak doğrular.
import {describe,it,expect,afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
const validator=path.resolve("scripts/validate-tr-comments.mjs");
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))fs.rmSync(r,{recursive:true,force:true})});
function tree(files:Record<string,string>){const root=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-tr-"));roots.push(root);for(const [rel,body] of Object.entries(files)){const p=path.join(root,...rel.split("/"));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body)}return root}
const run=(root:string)=>cp.spawnSync(process.execPath,[validator],{cwd:root,encoding:"utf8"});
describe("TR source scan and the machine cache",()=>{
  it("ignores third-party files inside the gitignored .ai/cache machine cache",()=>{const r=run(tree({"src/a.mjs":"// //TR: kaynak\n","README.md":"<!-- //TR: belge -->\n",".ai/cache/electron/44.4.5-win32-x64/dist/LICENSES.chromium.html":"<html></html>\n",".ai/cache/electron/44.4.5-win32-x64/dist/vk_swiftshader_icd.json":"{}\n"}));expect(r.status).toBe(0);expect(r.stdout).toContain("TR_VALIDATION: PASS")});
  it("still fails a source file that lacks //TR",()=>{const r=run(tree({"src/a.mjs":"// //TR: kaynak\n","src/b.json":"{}\n",".ai/cache/x.json":"{}\n"}));expect(r.status).not.toBe(0);expect(r.stderr).toContain("src/b.json");expect(r.stderr).not.toContain(".ai/cache/x.json")});
  it("still scans other .ai state files outside the cache",()=>{const r=run(tree({".ai/MASTER_STATE.json":"{}\n"}));expect(r.status).not.toBe(0);expect(r.stderr).toContain(".ai/MASTER_STATE.json")});
  it("skips only the gitignored cache prefix",()=>{const src=fs.readFileSync(validator,"utf8");expect(src).toContain('".ai/runtime/",".ai/cache/"]');expect(fs.readFileSync(".gitignore","utf8").split(/\r?\n/)).toContain(".ai/cache/")});
});
