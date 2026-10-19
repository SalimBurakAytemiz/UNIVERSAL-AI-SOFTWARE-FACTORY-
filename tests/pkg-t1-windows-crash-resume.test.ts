// //TR: Bu test hedef Windows makinesinde gerçek alt süreçlerle süreç kilidi, kill, çökme, yeniden başlatma ve devam selftest'inin tamamının geçtiğini doğrular.
import {describe,it,expect,vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import cp from "node:child_process";
describe("Windows process lock, kill, crash, restart and resume (T1)",{timeout:300000},()=>{
  it("passes every crash/resume scenario with real child processes",()=>{const r=cp.spawnSync(process.execPath,["scripts/windows-crash-resume-selftest.mjs"],{encoding:"utf8",timeout:290000});expect(r.status,r.stdout+r.stderr).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";expect(line).toMatch(/^WINDOWS_CRASH_RESUME_SELFTEST: PASS (\d+)\/\1$/);expect(Number(line.match(/PASS (\d+)/)?.[1])).toBeGreaterThanOrEqual(7);for(const s of ["orchestrator-killed-after-provider-call-resumes-by-adopting-completed-review-with-one-measured-invocation","orchestrator-killed-before-governed-evaluation-evaluates-completed-output-without-new-provider-call","duplicate-provider-invocation-is-detected-by-the-measurement"])expect(r.stdout).toContain(`"${s}": "PASS"`)});
});
