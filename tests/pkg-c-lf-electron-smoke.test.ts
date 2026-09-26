// //TR: Bu test protected .gitattributes'un bütün metin dosyalarını LF'e sabitlediğini ve Desktop/Control Tower smoke'larının Electron'u electron.cmd, shell veya örtük indirme olmadan yalnız doğrulanmış binary ile başlattığını doğrular.
import {describe,it,expect} from "vitest";
import fs from "node:fs";
const smokes=["scripts/smoke-desktop.mjs","scripts/smoke-control-tower.mjs"];
describe("PKG-C line endings and Electron smoke launch",()=>{
  it("pins every text file to LF regardless of core.autocrlf",()=>expect(fs.readFileSync(".gitattributes","utf8").split(/\r?\n/)).toContain("* text=auto eol=lf"));
  for(const f of smokes){
    const s=fs.readFileSync(f,"utf8"),code=s.split(/\r?\n/).filter(l=>!l.trimStart().startsWith("//")).join("\n");
    it(`${f} launches Electron without electron.cmd or a shell`,()=>{expect(code).not.toContain("electron.cmd");expect(code).not.toMatch(/\bshell\s*:/);expect(code).toContain("desktop=cp.spawn(electron,[\"apps/desktop/main.mjs\"]")});
    it(`${f} never triggers the implicit Electron binary download`,()=>{expect(code).not.toMatch(/require\(\s*["']electron["']\s*\)|import\s[^;]*["']electron["']|electron\/cli\.js|install\.js|install-electron/);expect(code).toContain("ELECTRON_BINARY_NOT_PROVISIONED")});
    it(`${f} validates path.txt, dist/version and a regular binary file before launch`,()=>{expect(s).toContain('["electron.exe","electron","Electron.app/Contents/MacOS/Electron"].includes(rel)');expect(s).toContain("distVersion!==version");expect(s).toContain("lstatSync(bin).isFile()")});
    it(`${f} keeps safe env, challenge proof and blocked redirects`,()=>{expect(s).toContain("safeChildEnv");expect(s).toContain("controlChallengeProof");expect(s).toContain('redirect:"error"')});
  }
});
