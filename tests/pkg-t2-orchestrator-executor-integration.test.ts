// //TR: Bu test gözetimsiz orkestratör yürütücülerinin geçici gerçek git depoları üzerindeki entegrasyon selftest'inin tamamının geçtiğini doğrular (fast-forward merge ve CLEAN kanıt şartı, sağlayıcı çağrısız review/paket/imza/kurulum benimseme, imzalayıcı bekleme, Phase0 korumaları, builder turu kapsam/yetki retleri).
import {describe,it,expect} from "vitest";
import cp from "node:child_process";
describe("orchestrator executors against real git (T2)",{timeout:240000},()=>{
  it("passes every executor integration scenario",()=>{const r=cp.spawnSync(process.execPath,["scripts/orchestrator-executor-integration-selftest.mjs"],{encoding:"utf8",timeout:230000});expect(r.status,r.stdout+r.stderr).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";expect(line).toMatch(/^ORCHESTRATOR_EXECUTOR_INTEGRATION: PASS (\d+)\/\1$/);expect(Number(line.match(/PASS (\d+)/)?.[1])).toBeGreaterThanOrEqual(8)});
});
