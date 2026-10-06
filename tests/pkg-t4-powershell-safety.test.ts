// //TR: Bu test Windows'ta PowerShell betiklerinin hatasız ayrıştığını, güvenlik kurallarına uyduğunu ve iki artifact doğrulayıcısının aynı kurcalamaları reddettiğini doğrulayan selftest'in geçtiğini (Windows dışında dürüstçe atlandığını) doğrular.
import {describe,it,expect} from "vitest";
import cp from "node:child_process";
describe("PowerShell script safety and artifact verifier differential (T4)",{timeout:180000},()=>{
  it("passes or honestly skips outside Windows",()=>{const r=cp.spawnSync(process.execPath,["scripts/powershell-safety-selftest.mjs"],{encoding:"utf8",timeout:170000});expect(r.status,r.stdout+r.stderr).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";expect(line).toMatch(process.platform==="win32"?/^POWERSHELL_SAFETY_SELFTEST: PASS 7\/7$/:/^POWERSHELL_SAFETY_SELFTEST: SKIP NOT_WINDOWS$/);
    if(process.platform==="win32")for(const name of ["every-powershell-script-parses-without-errors","parse-error-and-invoke-expression-detectors-catch-violating-fixtures","powershell-scripts-follow-safety-rules","safety-rules-credit-only-parsed-code-not-comments-or-strings"])expect(r.stdout).toContain(`"${name}": "PASS"`)});
});
