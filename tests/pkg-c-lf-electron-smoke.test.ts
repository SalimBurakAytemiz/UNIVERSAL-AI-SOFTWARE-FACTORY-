// //TR: Bu test protected .gitattributes'un bütün metin dosyalarını LF'e sabitlediğini ve Desktop/Control Tower smoke'larının Electron'u electron.cmd, shell veya örtük indirme olmadan yalnız doğrulanmış binary ile başlattığını doğrular.
import {describe,it,expect} from "vitest";
import fs from "node:fs";
const smokes=["scripts/smoke-desktop.mjs","scripts/smoke-control-tower.mjs"];
describe("PKG-C line endings and Electron smoke launch",()=>{
  it("pins every text file to LF regardless of core.autocrlf",()=>expect(fs.readFileSync(".gitattributes","utf8").split(/\r?\n/)).toContain("* text=auto eol=lf"));
  for(const f of smokes){
    const s=fs.readFileSync(f,"utf8"),code=s.split(/\r?\n/).filter(l=>!l.trimStart().startsWith("//")).join("\n");
    it(`${f} launches Electron without electron.cmd or a shell`,()=>{expect(code).not.toContain("electron.cmd");expect(code).not.toMatch(/\bshell\s*:/);expect(code).toContain("desktop=cp.spawn(electron,[\"apps/desktop/main.mjs\"]")});
    it(`${f} never triggers the implicit Electron binary download`,()=>{expect(code).not.toMatch(/require\(\s*["']electron["']\s*\)|import\s[^;]*["']electron["']|electron\/cli\.js|install\.js|install-electron|provision-electron|fetch\(\s*t\.url/);expect(code).toContain("const electron=await verifyProvisionedElectron(process.cwd());")});
    it(`${f} launches only a provisioned binary bound to the checksum-verified archive`,()=>{const helper=fs.readFileSync("automation/lib/electron-provision.mjs","utf8");expect(code).toContain('import {verifyProvisionedElectron} from "../automation/lib/electron-provision.mjs"');expect(helper).toContain("ELECTRON_BINARY_NOT_PROVISIONED");expect(helper).toContain('fail("DIST_VERSION_MISMATCH")');expect(helper).toContain('fail("EXECUTABLE_NOT_REGULAR_FILE")');expect(helper).toContain("fail(`DIST_CONTENT_MISMATCH:${e.name}`)")});
    it(`${f} keeps safe env, challenge proof and blocked redirects`,()=>{expect(s).toContain("safeChildEnv");expect(s).toContain("controlChallengeProof");expect(s).toContain('redirect:"error"')});
  }
});
