// //TR: Bu test hedef Windows makinesinde gerçek alt süreçlerle süreç kilidi, kill, çökme, yeniden başlatma ve devam selftest'inin tamamının geçtiğini doğrular.
import {describe,it,expect} from "vitest";
import cp from "node:child_process";
describe("Windows process lock, kill, crash, restart and resume (T1)",{timeout:120000},()=>{
  it("passes every crash/resume scenario with real child processes",()=>{const r=cp.spawnSync(process.execPath,["scripts/windows-crash-resume-selftest.mjs"],{encoding:"utf8",timeout:110000});expect(r.status,r.stdout+r.stderr).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";expect(line).toMatch(/^WINDOWS_CRASH_RESUME_SELFTEST: PASS (\d+)\/\1$/);expect(Number(line.match(/PASS (\d+)/)?.[1])).toBeGreaterThanOrEqual(5)});
});
