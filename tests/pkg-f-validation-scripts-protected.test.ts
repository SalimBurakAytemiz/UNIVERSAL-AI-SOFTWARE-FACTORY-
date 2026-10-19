// //TR: Bu test config/validation.json'ın çalıştırdığı her canonical script'in protected trust-root içinde olduğunu, dosya-adı öneki no-overmatch tasarımının korunduğunu ve validate-mechanical-closure'ın korumasız bir canonical script'i yakaladığını doğrular (TRUST-F1).
import {describe,it,expect,vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
const policy=JSON.parse(fs.readFileSync("config/protected-paths.json","utf8"));
const validation=JSON.parse(fs.readFileSync("config/validation.json","utf8"));
const scripts=[...new Set(validation.steps.map((s:{command:string[]})=>s.command.find(a=>/^scripts\/[^/]+\.mjs$/.test(a))).filter(Boolean))] as string[];
// //TR: trust-root.mjs için TypeScript bildirimi yok; protectedChangeViolations gerçek modülden alt süreçte çağrılır.
function violations(paths:string[],pol:unknown=policy):string[]{const url="file:///"+path.resolve("automation/lib/trust-root.mjs").replaceAll("\\","/");const code=`import {protectedChangeViolations} from ${JSON.stringify(url)};const i=JSON.parse(process.argv[1]);console.log(JSON.stringify(protectedChangeViolations(i.paths,i.policy,false)))`;const r=cp.spawnSync(process.execPath,["--input-type=module","-e",code,JSON.stringify({paths,policy:pol})],{encoding:"utf8"});if(r.status!==0)throw new Error(r.stderr);return JSON.parse(r.stdout)}
describe("canonical validation scripts are protected",()=>{
  it("covers every script run by config/validation.json",()=>{expect(scripts.length).toBeGreaterThanOrEqual(32);expect(violations(scripts).sort()).toEqual([...scripts].sort())});
  it("keeps the no-overmatch design for unknown files",()=>{expect(violations(["scripts/validate-evil.mjs"])).toEqual([]);expect(violations(["protected-evil","config-evil/x.json"])).toEqual([])});
  it("flags a canonical script once it is removed from exactPaths",()=>{const target="scripts/validate-paste4c-doc-truth.mjs";expect(violations([target],{...policy,exactPaths:policy.exactPaths.filter((x:string)=>x!==target)})).toEqual([])});
  it("validate-mechanical-closure enforces protection of every canonical script",()=>{const src=fs.readFileSync("scripts/validate-mechanical-closure.mjs","utf8");expect(src).toContain('import {protectedChangeViolations} from "../automation/lib/trust-root.mjs";');expect(src).toContain("validation-script-not-protected:");expect(policy.exactPaths).toContain("scripts/validate-mechanical-closure.mjs")});
});
