// //TR: Bu test BS1 bootstrap selftest'inin "a" kabuğundaki senaryolarını çalıştırır (tests/support/bs1-shard.ts); her senaryo PASS olmalıdır, kabuklar birlikte tam senaryo listesini kapsar (kapsam denetimi tests/pkg-vs-validation-sharding.test.ts).
import {describe,it,expect} from "vitest";
import fs from "node:fs";
import cp from "node:child_process";
import {BS1_PARTITION,BS1_REAL_AUT1B_SCENARIO,AUT1B_COMMIT,runBs1Shard} from "./support/bs1-shard.js";
describe("one-time autonomy bootstrap (BS1) shard a",{timeout:1_800_000},()=>{
  it("passes every scenario assigned to this shard",async()=>{
    const r=await runBs1Shard("a");expect(r.ok,r.detail).toBe(true);
    if(process.platform!=="win32"){for(const l of r.line)expect(l).toBe("BOOTSTRAP_AUTONOMY_SELFTEST FILTERED: SKIP NOT_WINDOWS");return}
    // //TR: Gerçek AUT1B düzlemi senaryosu yalnız AUT1B commit'i bu checkout'un geçmişinde yoksa (geçmişsiz dağıtım ağacı) açıkça atlanabilir; geçmiş varsa geçmek zorundadır.
    const aut1b=cp.spawnSync("git",["cat-file","-e",AUT1B_COMMIT+"^{commit}"]).status===0,names=BS1_PARTITION["a"].flat(),hasReal=names.includes(BS1_REAL_AUT1B_SCENARIO);
    for(const l of r.line){if(hasReal&&!aut1b&&/ SKIPPED 1$/.test(l))expect(l).toMatch(/^BOOTSTRAP_AUTONOMY_SELFTEST FILTERED: PASS (\d+)\/\1 SKIPPED 1$/);else expect(l).toMatch(/^BOOTSTRAP_AUTONOMY_SELFTEST FILTERED: PASS (\d+)\/\1$/)}
    for(const s of names){if(s===BS1_REAL_AUT1B_SCENARIO&&!aut1b)expect(r.stdout).toMatch(new RegExp('"'+s+'": "SKIP: AUT1B_COMMIT_NOT_IN_HISTORY"'));else expect(r.stdout).toMatch(new RegExp('"'+s+'": "PASS"'))}
  });
  it("locks the fixed bootstrap rules in code and protected paths",()=>{const ps=fs.readFileSync("scripts/bootstrap-uasco-autonomy.ps1","utf8"),wr=fs.readFileSync("scripts/uasco-supervisor-task.ps1","utf8"),prot=JSON.stringify(JSON.parse(fs.readFileSync("config/protected-paths.json","utf8")));
    for(const x of ['$TaskName = "UASCO-Autonomous-Supervisor"',"-LogonType Interactive -RunLevel Limited","-MultipleInstances IgnoreNew","-WindowStyle Hidden","MUST_RUN_UNELEVATED","TEST_MODE_REQUIRES_TEMP_REPO","INSTALLED_FIRST_TICK_PENDING","Resolve-DeadlineVerdict","LAUNCHER_EXITED","TASK_NAME_CONFLICT","FIRST_RUN_CONFIRMED","Initialize-GitIsolation","--activate","BOOTSTRAP_STATUS.json"])expect(ps).toContain(x);
    expect(ps).not.toMatch(/RunLevel Highest|LogonType (S4U|Password)|-Password\b|New-ScheduledTaskTrigger -AtStartup|Set-ExecutionPolicy|Invoke-Expression/);expect(wr).toContain("& $Node $entry --repo $Repo --control-root $root");
    for(const f of ["scripts/bootstrap-uasco-autonomy.ps1","scripts/uasco-supervisor-entry.mjs","scripts/uasco-supervisor-task.ps1","scripts/bootstrap-autonomy-selftest.mjs"])expect(prot).toContain(f);expect(fs.existsSync("docs/architecture/AUTONOMY-BOOTSTRAP.md")).toBe(true)});
});
