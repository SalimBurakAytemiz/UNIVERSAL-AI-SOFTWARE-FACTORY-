// //TR: Bu test hedef makinede kurulu OmniRoute uyum selftest'inin salt okunur geçtiğini (kurulu değilse dürüstçe atladığını) ve sürüm aralığı yardımcısının tanınmayan ifadeyi PASS saymadığını doğrular.
import {describe,it,expect} from "vitest";
import cp from "node:child_process";
describe("OmniRoute installed CLI/version compatibility (T3)",{timeout:120000},()=>{
  it("passes or honestly skips when OmniRoute is not installed",()=>{const r=cp.spawnSync(process.execPath,["scripts/omniroute-install-compat-selftest.mjs"],{encoding:"utf8",timeout:110000});expect(r.status,r.stdout+r.stderr).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";expect(line).toMatch(/^OMNIROUTE_INSTALL_COMPAT: (PASS 6\/6 endpoint=(REACHABLE|NOT_RUNNING|HTTP_\d+)|SKIP NOT_INSTALLED)$/)});
  it("does not treat an unknown engines range as compatible",()=>{const code="import {satisfies} from './scripts/omniroute-install-compat-selftest.mjs';console.log(JSON.stringify([satisfies('v24.19.0','>=22.22.2 <23 || >=24.0.0 <27'),satisfies('v23.1.0','>=22.22.2 <23 || >=24.0.0 <27'),satisfies('v27.0.0','>=24.0.0 <27'),satisfies('v24.0.0','^24')]))";const r=cp.spawnSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8"});expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual([true,false,false,"UNKNOWN"])});
});
