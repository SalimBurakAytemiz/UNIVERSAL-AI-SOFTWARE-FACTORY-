// //TR: Bu test canonical doğrulamanın bölünmüş test adımlarının kapsamını mekanik olarak kilitler: tests/*.test.ts dosyalarının tamamı vitest adımlarında tam bir kez yer alır, BS1 selftest senaryolarının her biri tam bir kabukta atanmıştır ve adım başına 600 sn sınırı yükseltilmemiştir.
import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {BS1_PARTITION,checkBs1Partition,bs1Scenarios,deElevateOnHostedRunner,bs1DeElevate,deElevatedJobEnv,runasArgv,RUNAS,BS1_SECRET_NAME} from "./support/bs1-shard.js";
import {checkTestShards,isTestShardId,logicalTestFiles,testShardSteps} from "./support/validation-test-shards.js";
const cfg=JSON.parse(fs.readFileSync("config/validation.json","utf8")),selftest=fs.readFileSync("scripts/bootstrap-autonomy-selftest.mjs","utf8");
const vitestSteps=(cfg.steps as {id:string;command:string[]}[]).filter(s=>s.command.some(a=>a.includes("vitest")));
const allTests=fs.readdirSync("tests").filter(f=>f.endsWith(".test.ts")).map(f=>"tests/"+f);
// //TR: Yalnız bu yedi adım gerçekten Windows'a özgüdür (görev zamanlayıcı/PowerShell/Windows süreç ağacı); "platforms" başka hiçbir adıma eklenemez, böylece gerçek bir bulgu platform sorunu diye NOT_RUN'a çevrilemez.
const WIN32_ONLY_STEPS=["tests-bs1-a","tests-bs1-b","tests-bs1-c","tests-bs1-d","tests-bs1-e","tests-bs1-f","tests-lv1"];
describe("validation test sharding coverage",()=>{
  it("runs every tests/*.test.ts file in exactly one vitest step",()=>{
    expect(vitestSteps.map(s=>s.id)).toContain("tests");
    const seen=new Map<string,string[]>();
    for(const s of vitestSteps){const args=s.command.slice(s.command.indexOf("run")+1);expect(args.length,`${s.id}: a vitest step without file arguments would re-run everything`).toBeGreaterThan(0);
      for(const a of args){expect(allTests,`${s.id}: ${a} is not a tests/*.test.ts file`).toContain(a);seen.set(a,[...(seen.get(a)??[]),s.id])}}
    expect(allTests.filter(f=>!seen.has(f)),"test files not run by any step").toEqual([]);
    expect([...seen].filter(([,v])=>v.length>1),"test files run twice").toEqual([]);
    // //TR: vitest konumsal argümanları alt dizge filtresidir; her argüman tam olarak bir dosyayla eşleşmelidir.
    for(const a of seen.keys())expect(allTests.filter(f=>f.includes(a)),`${a} must match exactly one file`).toEqual([a]);
  });
  // //TR: INT-R4 (Lane-B normalizasyonu): her tests/v7-*.test.ts dosyası TEK mantıksal "tests" listesinde yer alır (ayrı tests-int-r3/tests-sbx8/tests-relfx adımı yoktur); BS1/LV1 shard'ları v7 değildir, ayrı kalır. PUBLIC-CI: mantıksal liste 600 sn limiti için sıralı, bitişik tests, tests-2..tests-N kabuklarına bölünebilir; kabukların birleşimi listeyi aynı sırayla verir (kapsam azalmaz).
  it("lists every tests/v7-*.test.ts on disk in the logical tests list (tests, tests-2..tests-N shards)",()=>{
    const testsStep=vitestSteps.find(s=>s.id==="tests");expect(testsStep,"a step with id 'tests' must exist").toBeTruthy();
    expect(checkTestShards(cfg),"tests shards are ordered, contiguous, canonical and never platform-filtered").toEqual([]);
    expect(vitestSteps.filter(s=>["tests-int-r3","tests-sbx8","tests-relfx"].includes(s.id)).map(s=>s.id),"no separate int-r3/sbx8/relfx test steps").toEqual([]);
    expect(vitestSteps.filter(s=>!isTestShardId(s.id)&&!WIN32_ONLY_STEPS.includes(s.id)).map(s=>s.id),"every vitest step is a tests shard or an allowlisted Windows-only shard").toEqual([]);
    const v7=allTests.filter(f=>f.startsWith("tests/v7-"));expect(v7.length,"v7 test files present").toBeGreaterThan(0);
    const logical=logicalTestFiles(cfg);
    for(const f of v7)expect(logical,`${f} must be listed in the logical tests list`).toContain(f);
  });
  // //TR: Kabuk eklemek kabul kapısını zayıflatamaz: phase0-acceptance her tests kabuğunu PASS olarak ister.
  it("phase0 acceptance requires every tests shard to PASS",()=>{
    const acceptance=fs.readFileSync("scripts/phase0-acceptance.mjs","utf8");
    for(const s of testShardSteps(cfg))expect(acceptance,`${s.id} must be required by phase0-acceptance`).toContain(`"${s.id}"`);
  });
  it("the shard check rejects out-of-order, non-contiguous, platform-filtered, flagged or empty shards (mutation)",()=>{
    const v=(id:string,files:string[]=["tests/dlp.test.ts"],x:Record<string,unknown>={})=>({id,command:["node","node_modules/vitest/vitest.mjs","run",...files],requiresDependencies:true,...x});
    const other={id:"typecheck",command:["node","x"]};
    expect(checkTestShards({steps:[v("tests"),v("tests-2"),v("tests-3")]})).toEqual([]);
    expect(checkTestShards({steps:[v("tests"),v("tests-3")]})).toContain("shard-id-out-of-order:tests-3@1");
    expect(checkTestShards({steps:[v("tests"),other,v("tests-2")]})).toContain("shards-not-contiguous");
    expect(checkTestShards({steps:[v("tests"),v("tests-2",undefined,{platforms:["linux"]})]})).toContain("shard-platform-filtered:tests-2");
    expect(checkTestShards({steps:[v("tests"),v("tests-2",["--shard=1/2"])]})).toContain("shard-with-cli-flag:tests-2");
    expect(checkTestShards({steps:[v("tests"),v("tests-2",[])]})).toContain("shard-without-files:tests-2");
    expect(checkTestShards({steps:[v("tests",undefined,{requiresDependencies:false})]})).toContain("shard-without-reviewed-dependencies:tests");
    expect(checkTestShards({steps:[other]})).toEqual(["no-tests-step"]);
    expect(logicalTestFiles({steps:[v("tests",["tests/a.test.ts"]),v("tests-2",["tests/b.test.ts","tests/c.test.ts"])]})).toEqual(["tests/a.test.ts","tests/b.test.ts","tests/c.test.ts"]);
  });
  it("assigns every BS1 selftest scenario to exactly one shard and every shard has a step and a test file",()=>{
    expect(bs1Scenarios(selftest).length).toBeGreaterThan(0);
    expect(checkBs1Partition(BS1_PARTITION,selftest)).toEqual([]);
    for(const k of Object.keys(BS1_PARTITION)){const f=`tests/pkg-bs1-autonomy-bootstrap-${k}.test.ts`;expect(allTests).toContain(f);expect(vitestSteps.find(s=>s.id===`tests-bs1-${k}`)?.command).toContain(f);expect(fs.readFileSync(f,"utf8")).toContain(`runBs1Shard("${k}")`)}
    expect(allTests).not.toContain("tests/pkg-bs1-autonomy-bootstrap.test.ts");
  });
  it("the partition check fails when a scenario is unassigned, duplicated or stale (mutation)",()=>{
    expect(checkBs1Partition(BS1_PARTITION,selftest+'\nscenario("zz-new-unassigned-scenario",()=>{});')).toContain("scenario-not-assigned:zz-new-unassigned-scenario");
    const first=Object.keys(BS1_PARTITION)[0],dropped=structuredClone(BS1_PARTITION) as Record<string,string[][]>,victim=dropped[first][0].shift() as string;
    expect(checkBs1Partition(dropped,selftest)).toContain("scenario-not-assigned:"+victim);
    const dup=structuredClone(BS1_PARTITION) as Record<string,string[][]>;dup.zz=[[victim]];dup[first][0].push(victim);
    expect(checkBs1Partition(dup,selftest).some((e:string)=>e.startsWith("scenario-assigned-twice:"))).toBe(true);
    const stale=structuredClone(BS1_PARTITION) as Record<string,string[][]>;stale[first].push(["zz-removed-scenario"]);
    expect(checkBs1Partition(stale,selftest)).toContain("assigned-scenario-not-in-selftest:zz-removed-scenario");
  });
  // //TR: BS1 selftest'i yalnız GitHub-hosted runner'da yükseltilmemiş belirteçle çalıştırılır; başka hiçbir ortamda (yerel, self-hosted, CI dışı) bootstrap'ın yükseltilmiş oturum reddi değişmeden devrededir.
  it("de-elevates the BS1 selftest only on an elevated GitHub-hosted Windows runner and never relaxes the bootstrap's elevation refusal",()=>{
    const hosted={GITHUB_ACTIONS:"true",RUNNER_ENVIRONMENT:"github-hosted"},yes=()=>true,no=()=>false;
    expect(bs1DeElevate("win32",hosted,yes)).toBe(true);
    expect(bs1DeElevate("win32",hosted,no)).toBe(false);
    for(const env of [{},{GITHUB_ACTIONS:"true"},{GITHUB_ACTIONS:"true",RUNNER_ENVIRONMENT:"self-hosted"},{RUNNER_ENVIRONMENT:"github-hosted"},{GITHUB_ACTIONS:"1",RUNNER_ENVIRONMENT:"github-hosted"}]){expect(deElevateOnHostedRunner(env)).toBe(false);expect(bs1DeElevate("win32",env,yes)).toBe(false)}
    for(const p of ["linux","darwin"])expect(bs1DeElevate(p,hosted,yes)).toBe(false);
    let asked=0;bs1DeElevate("win32",{},()=>{asked++;return true});expect(asked).toBe(0);
    expect(runasArgv("C:\\n\\node.exe","C:\\t d\\wrap.mjs","C:\\t d\\job.json")).toEqual(["/trustlevel:0x20000",'"C:\\n\\node.exe" "C:\\t d\\wrap.mjs" "C:\\t d\\job.json"']);
    expect(RUNAS).toMatch(/System32[\\/]runas\.exe$/i);if(process.platform==="win32")expect(path.isAbsolute(RUNAS)).toBe(true);
    const env=deElevatedJobEnv({PATH:"p",SystemRoot:"C:\\Windows",GITHUB_TOKEN:"x",NPM_TOKEN:"x",FOO_API_KEY:"x",SSH_PRIVATE_KEY:"x",MY_SECRET:"x",DB_PASSWORD:"x",GH_PAT:"x",GIT_CONFIG_COUNT:"1",GIT_CONFIG_KEY_0:"core.x",GIT_CONFIG_VALUE_0:"y"},"D:\\a\\repo");
    for(const k of ["GITHUB_TOKEN","NPM_TOKEN","FOO_API_KEY","SSH_PRIVATE_KEY","MY_SECRET","DB_PASSWORD","GH_PAT"])expect(env[k],k).toBeUndefined();
    expect(env).toMatchObject({PATH:"p",SystemRoot:"C:\\Windows",GIT_CONFIG_COUNT:"2",GIT_CONFIG_KEY_0:"core.x",GIT_CONFIG_VALUE_0:"y",GIT_CONFIG_KEY_1:"safe.directory",GIT_CONFIG_VALUE_1:"D:/a/repo",TEMP:fs.realpathSync.native(os.tmpdir()),TMP:fs.realpathSync.native(os.tmpdir())});
    for(const k of ["PATH","PATHEXT","SystemRoot","USERPROFILE","LOCALAPPDATA","GIT_CONFIG_KEY_0","UASCO_BS1_ONLY","RUNNER_TRACKING_ID"])expect(BS1_SECRET_NAME.test(k),k).toBe(false);
    expect(fs.readFileSync("tests/support/bs1-shard.ts","utf8")).toContain("lua=bs1DeElevate(process.platform,process.env,isElevatedWindows)");
    const ps=fs.readFileSync("scripts/bootstrap-uasco-autonomy.ps1","utf8");
    expect(ps).toMatch(/\$elevated = \(\[Security\.Principal\.WindowsPrincipal\]\$identity\)\.IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
    expect(ps).toMatch(/if \(\$elevated\) \{ Stop-Bootstrap "MUST_RUN_UNELEVATED"/);
  });
  it("keeps the 600 s per-step limit unchanged",()=>{expect(fs.readFileSync("scripts/run-validation.mjs","utf8")).toContain("timeoutMs:600000")});
  it("declares platforms on exactly the seven Windows-only shards, always as [\"win32\"], and on no other step",()=>{
    const steps=cfg.steps as {id:string;platforms?:unknown}[],withPlatforms=steps.filter(s=>Object.prototype.hasOwnProperty.call(s,"platforms"));
    expect(withPlatforms.map(s=>s.id).sort(),"only the allowlisted Windows-only shards may be platform-filtered").toEqual([...WIN32_ONLY_STEPS].sort());
    for(const s of withPlatforms)expect(s.platforms,`${s.id} platforms`).toEqual(["win32"]);
    for(const id of WIN32_ONLY_STEPS)expect(steps.filter(s=>s.id===id).length,`${id} must exist exactly once`).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(steps.find(s=>s.id==="tests"),"platforms"),"the single tests step is never platform-filtered").toBe(false);
  });
});
// //TR: Canonical runner'ın platform filtresi davranışsal olarak sınanır: başka platforma ait adım hiç çalıştırılmaz ve NOT_RUN_PLATFORM olur, koşu PASS değil PASS_PLATFORM_FILTERED olur; filtre yoksa düz PASS yazılır; host'ta başarısız adım FAIL kalır; bozuk "platforms" alanı BLOCKED olur.
describe("canonical runner platform filter (behaviour)",()=>{
  const runner=path.resolve("scripts/run-validation.mjs"),other=process.platform==="win32"?"linux":"win32";
  const step=(id:string,code:number,extra:Record<string,unknown>={})=>({id,command:[process.execPath,"-e",`process.exit(${code})`],...extra});
  const runWith=(steps:object[])=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-rv-"));try{fs.mkdirSync(path.join(dir,"config"));fs.writeFileSync(path.join(dir,"config","validation.json"),JSON.stringify({steps}));
    const r=cp.spawnSync(process.execPath,[runner],{cwd:dir,encoding:"utf8",timeout:120000});const report=JSON.parse(fs.readFileSync(path.join(dir,".ai","runtime","VALIDATION_REPORT.json"),"utf8"));
    return {status:r.status,stdout:r.stdout,last:r.stdout.trim().split(/\r?\n/).pop()??"",report}}finally{fs.rmSync(dir,{recursive:true,force:true})}};
  it("never runs a step for another platform, reports it as NOT_RUN_PLATFORM and the run as PASS_PLATFORM_FILTERED, never plain PASS",()=>{
    const r=runWith([step("a",0),step("b",7,{platforms:[other]}),step("c",0)]);
    expect(r.status,r.stdout).toBe(0);
    expect(r.last).toBe(`CANONICAL_VALIDATION: PASS_PLATFORM_FILTERED not-run=1 b host=${process.platform}`);
    expect(r.stdout).toContain(`VALIDATION_STEP_NOT_RUN b requires ${other} host=${process.platform}`);
    expect(r.stdout).not.toMatch(/^CANONICAL_VALIDATION: PASS$/m);
    expect(r.report).toMatchObject({status:"PASS_PLATFORM_FILTERED",platform:process.platform,platformFiltered:["b"]});
    expect(r.report.steps.map((s:{id:string;status:string})=>s.id+"="+s.status)).toEqual(["a=PASS","b=NOT_RUN_PLATFORM","c=PASS"]);
    expect(r.report.steps[1]).toMatchObject({exitCode:null,durationMs:0,timedOut:false});
  });
  it("runs a step whose platforms include the host and prints plain PASS only when nothing was filtered",()=>{
    const r=runWith([step("a",0,{platforms:[process.platform]})]);
    expect(r.status,r.stdout).toBe(0);expect(r.last).toBe("CANONICAL_VALIDATION: PASS");
    expect(r.report).toMatchObject({status:"PASS",platform:process.platform,platformFiltered:[]});
    expect(r.report.steps[0]).toMatchObject({id:"a",status:"PASS",exitCode:0,timedOut:false});
  });
  it("still fails a failing step on its own platform and blocks a malformed platforms field",()=>{
    const f=runWith([step("x",3,{platforms:[process.platform]}),step("y",0)]);
    expect(f.status).toBe(1);expect(f.report.status).toBe("FAIL");expect(f.report.steps).toHaveLength(1);expect(f.report.steps[0]).toMatchObject({id:"x",status:"FAIL",exitCode:3,timedOut:false});
    for(const bad of [[],"win32",[""],[1],null]){const b=runWith([step("m",0,{platforms:bad})]);expect(b.status,JSON.stringify(bad)).toBe(1);expect(b.report.status).toBe("FAIL");expect(b.report.steps[0].status,JSON.stringify(bad)).toBe("BLOCKED")}
  });
});
// //TR: PUBLIC-CI kanıt bağlayıcısı (scripts/ci/ci-evidence.mjs) davranışsal olarak sınanır: rapor yok/bozuk/FAIL/zaman aşımı --require ile çıkış 1 ve CI_EVIDENCE_FAIL; PASS ve PASS_PLATFORM_FILTERED (yalnız NOT_RUN_PLATFORM) çıkış 0; kanıt GITHUB_SHA ve PR head SHA'ya bağlanır, hiçbir PASS uydurulmaz.
describe("CI evidence binder (fail-closed, SHA-bound)",()=>{
  const binder=path.resolve("scripts/ci/ci-evidence.mjs");
  const run=(report:unknown,env:Record<string,string>={})=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-cie-"));try{if(report!==undefined){fs.mkdirSync(path.join(dir,".ai","runtime"),{recursive:true});fs.writeFileSync(path.join(dir,".ai","runtime","VALIDATION_REPORT.json"),typeof report==="string"?report:JSON.stringify(report))}
    const r=cp.spawnSync(process.execPath,[binder,"--require","--leg","linux"],{cwd:dir,encoding:"utf8",timeout:60000,env:{...process.env,GITHUB_SHA:"a".repeat(40),UASCO_HEAD_SHA:"b".repeat(40),GITHUB_RUN_ID:"7",GITHUB_RUN_ATTEMPT:"1",RUNNER_ENVIRONMENT:"github-hosted",...env}});
    return {status:r.status,stdout:r.stdout,evidence:JSON.parse(fs.readFileSync(path.join(dir,".ai","runtime","CI_EVIDENCE.json"),"utf8"))}}finally{fs.rmSync(dir,{recursive:true,force:true})}};
  const ok=(id:string)=>({id,status:"PASS",durationMs:5,timedOut:false});
  it("binds a PASS report to the commit and PR head SHA",()=>{
    const r=run({status:"PASS",platform:"linux",steps:[ok("a"),ok("tests")]});
    expect(r.status,r.stdout).toBe(0);expect(r.evidence.verdict).toBe("CI_EVIDENCE_PASS");
    expect(r.evidence.binding).toMatchObject({sha:"a".repeat(40),headSha:"b".repeat(40),runId:"7",runAttempt:"1",runnerEnvironment:"github-hosted"});
    expect(r.stdout).toContain("full coverage requires BOTH the Linux and the Windows CI context green on the same SHA");
  });
  it("accepts PASS_PLATFORM_FILTERED only when the filtered steps are NOT_RUN_PLATFORM",()=>{
    const r=run({status:"PASS_PLATFORM_FILTERED",platform:"linux",platformFiltered:["w"],steps:[ok("a"),{id:"w",status:"NOT_RUN_PLATFORM",durationMs:0,timedOut:false}]});
    expect(r.status,r.stdout).toBe(0);expect(r.stdout).toContain("NOT_RUN on this platform (filtered, never a PASS): w");
  });
  it("fails closed on a missing, unreadable, empty, failing or timed-out report",()=>{
    for(const [report,why] of [[undefined,"validation report missing"],["{not json","validation report unreadable"],[{status:"PASS",steps:[]},"report has no steps"],[{status:"FAIL",steps:[ok("a"),{id:"tests",status:"FAIL",durationMs:600034,timedOut:true}]},"validation status FAIL"],[{status:"PASS",steps:[ok("a"),{id:"b",status:"BLOCKED",durationMs:0}]},"non-PASS step status: b=BLOCKED"]] as [unknown,string][]){
      const r=run(report);expect(r.status,why).toBe(1);expect(r.evidence.verdict,why).toBe("CI_EVIDENCE_FAIL");expect(r.evidence.reasons.join("|"),why).toContain(why);
    }
    const t=run({status:"FAIL",steps:[{id:"tests",status:"FAIL",durationMs:600034,timedOut:true}]});expect(t.stdout).toContain("TIMED OUT at the 600s per-step cap");
  });
});
