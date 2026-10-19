// //TR: Bu test BS1 bootstrap selftest'inin "f" kabuğundaki senaryolarını çalıştırır (tests/support/bs1-shard.ts); her senaryo PASS olmalıdır, kabuklar birlikte tam senaryo listesini kapsar (kapsam denetimi tests/pkg-vs-validation-sharding.test.ts).
import {describe,it,expect,vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import cp from "node:child_process";
import {BS1_PARTITION,BS1_REAL_AUT1B_SCENARIO,AUT1B_COMMIT,runBs1Shard} from "./support/bs1-shard.js";
describe("one-time autonomy bootstrap (BS1) shard f",{timeout:1_800_000},()=>{
  it("passes every scenario assigned to this shard",async(ctx)=>{
    const r=await runBs1Shard("f");expect(r.ok,r.detail).toBe(true);
    // //TR: Windows dışında selftest'in dürüst SKIP satırı doğrulanır ve test PASSED değil SKIPPED olarak raporlanır (sessiz geçiş yok).
    if(process.platform!=="win32"){for(const l of r.line)expect(l).toBe("BOOTSTRAP_AUTONOMY_SELFTEST FILTERED: SKIP NOT_WINDOWS");return ctx.skip("NOT_WINDOWS: BS1 selftest reported SKIP NOT_WINDOWS; scenarios not executed on "+process.platform)}
    // //TR: Gerçek AUT1B düzlemi senaryosu yalnız AUT1B commit'i bu checkout'un geçmişinde yoksa (geçmişsiz dağıtım ağacı) açıkça atlanabilir; geçmiş varsa geçmek zorundadır.
    const aut1b=cp.spawnSync("git",["cat-file","-e",AUT1B_COMMIT+"^{commit}"]).status===0,names=BS1_PARTITION["f"].flat(),hasReal=names.includes(BS1_REAL_AUT1B_SCENARIO);
    for(const l of r.line){if(hasReal&&!aut1b&&/ SKIPPED 1$/.test(l))expect(l).toMatch(/^BOOTSTRAP_AUTONOMY_SELFTEST FILTERED: PASS (\d+)\/\1 SKIPPED 1$/);else expect(l).toMatch(/^BOOTSTRAP_AUTONOMY_SELFTEST FILTERED: PASS (\d+)\/\1$/)}
    for(const s of names){if(s===BS1_REAL_AUT1B_SCENARIO&&!aut1b)expect(r.stdout).toMatch(new RegExp('"'+s+'": "SKIP: AUT1B_COMMIT_NOT_IN_HISTORY"'));else expect(r.stdout).toMatch(new RegExp('"'+s+'": "PASS"'))}
  });
});
