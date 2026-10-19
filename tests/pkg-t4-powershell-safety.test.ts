// //TR: Bu test Windows'ta PowerShell betiklerinin hatasız ayrıştığını, güvenlik kurallarına uyduğunu ve iki artifact doğrulayıcısının aynı kurcalamaları reddettiğini doğrulayan selftest'in geçtiğini (Windows dışında dürüstçe atlandığını) doğrular.
import {describe,it,expect,vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import cp from "node:child_process";
describe("PowerShell script safety and artifact verifier differential (T4)",{timeout:180000},()=>{
  it("passes or honestly skips outside Windows",(ctx)=>{const r=cp.spawnSync(process.execPath,["scripts/powershell-safety-selftest.mjs"],{encoding:"utf8",timeout:170000});expect(r.status,r.stdout+r.stderr).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";expect(line).toMatch(process.platform==="win32"?/^POWERSHELL_SAFETY_SELFTEST: PASS 7\/7$/:/^POWERSHELL_SAFETY_SELFTEST: SKIP NOT_WINDOWS$/);
    if(process.platform!=="win32")return ctx.skip("NOT_WINDOWS: T4 selftest reported SKIP NOT_WINDOWS; checks not executed on "+process.platform);
    for(const name of ["every-powershell-script-parses-without-errors","parse-error-and-invoke-expression-detectors-catch-violating-fixtures","powershell-scripts-follow-safety-rules","safety-rules-credit-only-parsed-code-not-comments-or-strings"])expect(r.stdout).toContain(`"${name}": "PASS"`)});
});
