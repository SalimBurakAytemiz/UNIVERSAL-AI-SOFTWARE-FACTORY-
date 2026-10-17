// //TR: Bu test canonical doğrulamanın bölünmüş test adımlarının kapsamını mekanik olarak kilitler: tests/*.test.ts dosyalarının tamamı vitest adımlarında tam bir kez yer alır, BS1 selftest senaryolarının her biri tam bir kabukta atanmıştır ve adım başına 600 sn sınırı yükseltilmemiştir.
import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {BS1_PARTITION,checkBs1Partition,bs1Scenarios} from "./support/bs1-shard.js";
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
  // //TR: INT-R4 (Lane-B normalizasyonu): her tests/v7-*.test.ts dosyası TEK "tests" adımında listelenir (ayrı tests-int-r3/tests-sbx8/tests-relfx adımı yoktur); BS1/LV1 shard'ları v7 değildir, ayrı kalır.
  it("lists every tests/v7-*.test.ts on disk in the single tests step",()=>{
    const testsStep=vitestSteps.find(s=>s.id==="tests");expect(testsStep,"a step with id 'tests' must exist").toBeTruthy();
    expect(vitestSteps.filter(s=>["tests-int-r3","tests-sbx8","tests-relfx"].includes(s.id)).map(s=>s.id),"no separate int-r3/sbx8/relfx test steps").toEqual([]);
    const v7=allTests.filter(f=>f.startsWith("tests/v7-"));expect(v7.length,"v7 test files present").toBeGreaterThan(0);
    for(const f of v7)expect(testsStep!.command,`${f} must be listed in the single tests step`).toContain(f);
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
