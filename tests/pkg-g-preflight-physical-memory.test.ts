// //TR: Bu test preflight bellek kontrolünün Windows'ta takılı fiziksel RAM'i (Win32_PhysicalMemory) kullandığını, ölçüm yok/geçersiz/tutarsız olduğunda os.totalmem()'e düştüğünü, 16 GB eşiğinin değişmediğini ve iki değerin de rapora yazıldığını doğrular (PKGA-F8).
import {describe,it,expect} from "vitest";
import fs from "node:fs";
const src=fs.readFileSync("scripts/preflight.mjs","utf8"),policy=JSON.parse(fs.readFileSync("config/preflight-policy.json","utf8"));
describe("preflight physical memory measurement",()=>{
  it("keeps the 16 GB policy threshold",()=>expect(policy.minimumMemoryGb).toBe(16));
  it("measures installed physical RAM on Windows without a shell",()=>{expect(src).toContain('exec("powershell.exe",["-NoProfile","-NonInteractive","-Command","(Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum"])');expect(src).not.toMatch(/\bshell\s*:/)});
  it("accepts only a numeric measurement that is not below the OS-visible memory",()=>{expect(src).toContain("r.status===0&&/^\\d+$/.test(raw)");expect(src).toContain("gb>=osVisibleMemoryGb");expect(src).toContain("totalMemoryGb:physicalMemoryGb??osVisibleMemoryGb")});
  it("records the source and both values in the memory check",()=>{expect(src).toContain('source=${physicalMemoryGb!==null?"Win32_PhysicalMemory":"os.totalmem"}');expect(src).toContain("osVisible=${osVisibleMemoryGb.toFixed(2)}GB")});
});
