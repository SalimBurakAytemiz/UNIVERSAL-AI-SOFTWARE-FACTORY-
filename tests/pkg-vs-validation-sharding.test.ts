// //TR: Bu test canonical doğrulamanın bölünmüş test adımlarının kapsamını mekanik olarak kilitler: tests/*.test.ts dosyalarının tamamı vitest adımlarında tam bir kez yer alır, BS1 selftest senaryolarının her biri tam bir kabukta atanmıştır ve adım başına 600 sn sınırı yükseltilmemiştir.
import {describe,it,expect} from "vitest";
import fs from "node:fs";
import {BS1_PARTITION,checkBs1Partition,bs1Scenarios} from "./support/bs1-shard.js";
const cfg=JSON.parse(fs.readFileSync("config/validation.json","utf8")),selftest=fs.readFileSync("scripts/bootstrap-autonomy-selftest.mjs","utf8");
const vitestSteps=(cfg.steps as {id:string;command:string[]}[]).filter(s=>s.command.some(a=>a.includes("vitest")));
const allTests=fs.readdirSync("tests").filter(f=>f.endsWith(".test.ts")).map(f=>"tests/"+f);
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
});
