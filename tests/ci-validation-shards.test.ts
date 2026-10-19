// //TR: CI-PARALLEL: bu test Windows doğrulama kabuklamasını mekanik olarak kilitler: --shard seçimi deterministiktir ve kabukların birleşimi tüm adımları örtüşmesiz verir, geçersiz plan/kabuk fail-closed reddedilir, validate-shards birleştiricisi eksik/tekrar/fazla rapor, eksik/fazla/tekrar adım, SHA/özet uyuşmazlığı, FAIL, zaman aşımı, bozuk JSON ve zorunlu platformda NOT_RUN durumlarında FAIL verir ve --shard olmadan runner davranışı değişmez.
import {describe,it,expect,vi} from "vitest";
// //TR: Alt süreçli gerçek G/Ç testleri yoğun Windows runner'da varsayılan 5 sn sınırını aşabilir; yalnız varsayılan süre bütçesi, hiçbir iddia değişmez.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";

const runner=path.resolve("scripts/run-validation.mjs"),aggregator=path.resolve("scripts/validate-shards.mjs");
const SHA="c".repeat(40),RUN_ID="77",RUN_ATTEMPT="2",host=process.platform,other=host==="win32"?"linux":"win32";
type Step={id:string;command:string[];parallelGroup?:string;platforms?:string[]};
const ok=(id:string,x:Partial<Step>={}):Step=>({id,command:[process.execPath,"-e","process.exit(0)"],...x});
const withDir=<T>(fn:(dir:string)=>T):T=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-shard-"));try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}};
const writeCfg=(dir:string,cfg:object)=>{fs.mkdirSync(path.join(dir,"config"),{recursive:true});fs.writeFileSync(path.join(dir,"config","validation.json"),JSON.stringify(cfg,null,2)+"\n");return crypto.createHash("sha256").update(fs.readFileSync(path.join(dir,"config","validation.json"))).digest("hex")};
const runRunner=(dir:string,args:string[])=>cp.spawnSync(process.execPath,[runner,...args],{cwd:dir,encoding:"utf8",timeout:120000,env:{...process.env,UASCO_HEAD_SHA:SHA,GITHUB_RUN_ID:RUN_ID,GITHUB_RUN_ATTEMPT:RUN_ATTEMPT}});
const RUN=["--run-id",RUN_ID,"--run-attempt",RUN_ATTEMPT];
// //TR: Birleştirici ortamdan run id/attempt okuyabildiği için test kendi CI koşusunun GITHUB_RUN_* değerlerini sızdırmaz.
const aggEnv=()=>{const e={...process.env};delete e.GITHUB_RUN_ID;delete e.GITHUB_RUN_ATTEMPT;return e};
const runAgg=(dir:string,args:string[]=["--count","3","--sha",SHA,...RUN])=>{const r=cp.spawnSync(process.execPath,[aggregator,...args],{cwd:dir,encoding:"utf8",timeout:60000,env:aggEnv()});return {status:r.status,out:r.stdout+r.stderr,reasons:[...(r.stdout+r.stderr).matchAll(/^SHARD_AGGREGATION_REASON (.+)$/gm)].map(m=>m[1].trim())}};
const readJson=(f:string)=>JSON.parse(fs.readFileSync(f,"utf8"));

// //TR: Sabit sentetik config: üç kabuk, paralel grup, atanmamış adım (1. kabuk), yalnız host'a özgü ve yalnız başka platforma özgü adım.
const hostSteps=[ok("a",{parallelGroup:"g"}),ok("b",{parallelGroup:"g"}),ok("c"),ok("d",{platforms:[host]}),ok("e",{platforms:[other]}),ok("f")];
const hostCfg={steps:hostSteps,shardPlan:{[host]:{count:3,assign:{c:2,d:3,f:2}}}};

describe("run-validation --shard selection",()=>{
  it("is deterministic, keeps original order and the shards' union is every step exactly once",()=>withDir(dir=>{
    writeCfg(dir,hostCfg);
    const runs=[1,2,3].map(()=>[1,2,3].map(i=>{const r=runRunner(dir,["--shard",`${i}/3`]);expect(r.status,r.stdout+r.stderr).toBe(0);return readJson(path.join(dir,".ai","runtime",`VALIDATION_SHARD_${i}.json`))}));
    const ids=runs[0].map(rep=>rep.steps.map((s:{id:string})=>s.id));
    expect(ids).toEqual([["a","b","e"],["c","f"],["d"]]);
    for(const again of runs.slice(1))expect(again.map(rep=>rep.steps.map((s:{id:string})=>s.id))).toEqual(ids);
    const union=ids.flat();expect([...union].sort()).toEqual(hostSteps.map(s=>s.id).sort());expect(new Set(union).size).toBe(union.length);
    const r1=runs[0][0];
    expect(r1).toMatchObject({sha:SHA,runId:RUN_ID,runAttempt:RUN_ATTEMPT,shard:{index:1,count:3},platform:host,status:"PASS_PLATFORM_FILTERED",configSha256:writeCfg(dir,hostCfg)});
    expect(r1.steps.find((s:{id:string})=>s.id==="e")).toEqual({id:"e",status:"NOT_RUN_PLATFORM",durationMs:0,timedOut:false});
  }));
  it("rejects a missing plan, a count mismatch, an invalid shard, an unknown step or an out-of-range assignment (fail-closed)",()=>withDir(dir=>{
    const cases:[object,string,string][]=[
      [{steps:hostSteps},"1/3","no shardPlan for platform"],
      [{steps:hostSteps,shardPlan:{[other]:{count:3,assign:{}}}},"1/3","no shardPlan for platform"],
      [hostCfg,"1/2","shard count 2 != shardPlan count 3"],
      [hostCfg,"4/3","shard 4 > 3"],
      [hostCfg,"0/3","invalid --shard"],
      [hostCfg,"x","invalid --shard"],
      [{...hostCfg,shardPlan:{[host]:{count:3,assign:{zz:1}}}},"1/3","unknown step id in shardPlan: zz"],
      [{...hostCfg,shardPlan:{[host]:{count:3,assign:{c:4}}}},"1/3","invalid shard 4 for step c"],
      [{...hostCfg,shardPlan:{[host]:{count:0,assign:{}}}},"1/3","invalid shardPlan count"],
      [{...hostCfg,shardPlan:{[host]:{count:3,assign:[]}}},"1/3","invalid shardPlan assign"],
    ];
    for(const [cfg,arg,why] of cases){writeCfg(dir,cfg);const r=runRunner(dir,["--shard",arg]);expect(r.status,why).toBe(1);expect(r.stderr,why).toContain(`VALIDATION_SHARD_INVALID ${why}`);expect(fs.existsSync(path.join(dir,".ai","runtime","VALIDATION_REPORT.json")),why).toBe(false)}
    writeCfg(dir,hostCfg);const r=runRunner(dir,["--shard"]);expect(r.status).toBe(1);expect(r.stderr).toContain("VALIDATION_SHARD_INVALID invalid --shard");
  }));
  it("without --shard runs every step in config order and writes no shard report (unchanged behaviour)",()=>withDir(dir=>{
    writeCfg(dir,hostCfg);const r=runRunner(dir,[]);expect(r.status,r.stdout+r.stderr).toBe(0);
    expect(readJson(path.join(dir,".ai","runtime","VALIDATION_REPORT.json")).steps.map((s:{id:string})=>s.id)).toEqual(hostSteps.map(s=>s.id));
    expect(fs.readdirSync(path.join(dir,".ai","runtime")).filter(f=>f.startsWith("VALIDATION_SHARD_"))).toEqual([]);
    expect(r.stdout.trim().split(/\r?\n/).pop()).toBe(`CANONICAL_VALIDATION: PASS_PLATFORM_FILTERED not-run=1 e host=${host}`);
  }));
  it("a failing step fails its shard and still writes a FAIL shard report",()=>withDir(dir=>{
    writeCfg(dir,{...hostCfg,steps:hostSteps.map(s=>s.id==="c"?{...s,command:[process.execPath,"-e","process.exit(5)"]}:s)});
    const r=runRunner(dir,["--shard","2/3"]);expect(r.status).toBe(1);
    expect(readJson(path.join(dir,".ai","runtime","VALIDATION_SHARD_2.json"))).toMatchObject({status:"FAIL",steps:[{id:"c",status:"FAIL",timedOut:false}]});
  }));
});

// //TR: B1: kabuk modu kısmi bir geçiştir; canonical VALIDATION_REPORT.json'ı asla yazmaz ve bayat olanı siler, böylece onu okuyan tüketiciler (factory-supervisor, review-pipeline, phase0, install-report, ci-evidence) kabuk-yalnız bir PASS göremez.
const canonical=(dir:string)=>path.join(dir,".ai","runtime","VALIDATION_REPORT.json");
const seedStalePass=(dir:string)=>{fs.mkdirSync(path.dirname(canonical(dir)),{recursive:true});fs.writeFileSync(canonical(dir),JSON.stringify({status:"PASS",platform:host,steps:[{id:"a",status:"PASS",durationMs:1,timedOut:false}]}))};
describe("shard mode never produces a canonical PASS report (B1)",()=>{
  it("a passing shard run writes only VALIDATION_SHARD_<i>.json and no canonical report, and prints no CANONICAL_VALIDATION line",()=>withDir(dir=>{
    writeCfg(dir,hostCfg);for(const i of [1,2,3]){const r=runRunner(dir,["--shard",`${i}/3`]);expect(r.status,r.stdout+r.stderr).toBe(0);expect(r.stdout).not.toMatch(/CANONICAL_VALIDATION/);expect(r.stdout).toContain(`VALIDATION_SHARD ${i}/3`)}
    expect(fs.existsSync(canonical(dir)),"no canonical report after shard runs").toBe(false);
    expect(fs.readdirSync(path.dirname(canonical(dir))).filter(f=>f.endsWith(".json")).sort()).toEqual(["VALIDATION_SHARD_1.json","VALIDATION_SHARD_2.json","VALIDATION_SHARD_3.json"]);
  }));
  it("removes a stale canonical PASS report on a passing, a failing and an invalid shard run",()=>withDir(dir=>{
    writeCfg(dir,hostCfg);seedStalePass(dir);expect(runRunner(dir,["--shard","1/3"]).status).toBe(0);expect(fs.existsSync(canonical(dir)),"passing shard").toBe(false);
    seedStalePass(dir);expect(runRunner(dir,["--shard","9/3"]).status).toBe(1);expect(fs.existsSync(canonical(dir)),"invalid shard").toBe(false);
    writeCfg(dir,{...hostCfg,steps:hostSteps.map(s=>s.id==="c"?{...s,command:[process.execPath,"-e","process.exit(5)"]}:s)});seedStalePass(dir);
    expect(runRunner(dir,["--shard","2/3"]).status).toBe(1);expect(fs.existsSync(canonical(dir)),"failing shard").toBe(false);
  }));
  it("ci-evidence after shard-only runs fails closed (report missing), never a shard-only PASS",()=>withDir(dir=>{
    writeCfg(dir,hostCfg);seedStalePass(dir);for(const i of [1,2,3])expect(runRunner(dir,["--shard",`${i}/3`]).status).toBe(0);
    const r=cp.spawnSync(process.execPath,[path.resolve("scripts/ci/ci-evidence.mjs"),"--require","--leg","Windows"],{cwd:dir,encoding:"utf8",timeout:60000,env:{...process.env,GITHUB_SHA:SHA,UASCO_HEAD_SHA:SHA}});
    expect(r.status,r.stdout+r.stderr).toBe(1);const ev=readJson(path.join(dir,".ai","runtime","CI_EVIDENCE.json"));expect(ev.verdict).toBe("CI_EVIDENCE_FAIL");expect(ev.reasons.join("|")).toContain("validation report missing");
  }));
  it("every canonical-report consumer reads only .ai/runtime/VALIDATION_REPORT.json and no consumer but the aggregator reads shard reports",()=>{
    const consumers=["automation/factory-supervisor.mjs","automation/lib/review-pipeline.mjs","automation/lib/phase0-contract.mjs","scripts/phase0-acceptance.mjs","scripts/install-report.mjs","scripts/ci/ci-evidence.mjs"];
    for(const f of consumers){const src=fs.readFileSync(f,"utf8");expect(src,`${f} reads the canonical report`).toMatch(/VALIDATION_REPORT\.json/);expect(src,`${f} must not read shard reports`).not.toMatch(/VALIDATION_SHARD/)}
    const walk=(d:string):string[]=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(["node_modules",".git",".ai"].includes(e.name)?[]:walk(path.join(d,e.name))):[path.join(d,e.name)]);
    const readers=["automation","scripts","apps","packages"].filter(d=>fs.existsSync(d)).flatMap(walk).filter(f=>/\.(mjs|js|ts|cjs)$/.test(f)&&fs.readFileSync(f,"utf8").includes("VALIDATION_SHARD")).map(f=>f.replaceAll("\\","/")).sort();
    expect(readers,"only the runner (writer) and the aggregator touch shard reports").toEqual(["scripts/run-validation.mjs","scripts/validate-shards.mjs"]);
  });
  it("the shard-mode branch never writes the canonical report (source lock)",()=>{
    const src=fs.readFileSync("scripts/run-validation.mjs","utf8");
    expect(src).toContain('if(!shard)fs.writeFileSync(path.join(runtime,"VALIDATION_REPORT.json")');
    expect(src.match(/VALIDATION_REPORT\.json"\),JSON\.stringify/g),"exactly one canonical write").toHaveLength(1);
  });
});

// //TR: Birleştirici negatifleri win32 adına sentetik raporlarla sınanır (CI'daki gerçek platform); w yalnız win32, l yalnız linux, x/y platformsuz.
const winSteps=[ok("x"),ok("w",{platforms:["win32"]}),ok("l",{platforms:["linux"]}),ok("y")];
const winCfg={steps:winSteps,shardPlan:{win32:{count:3,assign:{w:2,y:3}}}};
type Rep={sha:string;runId:string|null;runAttempt:string|null;configSha256:string;shard:{index:number;count:number};platform:string;status:string;steps:{id:string;status:string;durationMs:number;timedOut:boolean}[]};
const good=(digest:string):Rep[]=>[
  {sha:SHA,runId:RUN_ID,runAttempt:RUN_ATTEMPT,configSha256:digest,shard:{index:1,count:3},platform:"win32",status:"PASS_PLATFORM_FILTERED",steps:[{id:"x",status:"PASS",durationMs:5,timedOut:false},{id:"l",status:"NOT_RUN_PLATFORM",durationMs:0,timedOut:false}]},
  {sha:SHA,runId:RUN_ID,runAttempt:RUN_ATTEMPT,configSha256:digest,shard:{index:2,count:3},platform:"win32",status:"PASS",steps:[{id:"w",status:"PASS",durationMs:7,timedOut:false}]},
  {sha:SHA,runId:RUN_ID,runAttempt:RUN_ATTEMPT,configSha256:digest,shard:{index:3,count:3},platform:"win32",status:"PASS",steps:[{id:"y",status:"PASS",durationMs:9,timedOut:false}]},
];
const WIN=["--count","3","--sha",SHA,...RUN,"--platform","win32","--dir","shards"];
function aggregate(mutate:(reps:Rep[],dir:string)=>void=()=>{},cfg:object=winCfg){
  return withDir(dir=>{const digest=writeCfg(dir,cfg);const reps=good(digest);fs.mkdirSync(path.join(dir,"shards"));mutate(reps,dir);
    reps.forEach((r,i)=>{if(r)fs.writeFileSync(path.join(dir,"shards",`VALIDATION_SHARD_${i+1}.json`),JSON.stringify(r))});
    const res=runAgg(dir,WIN);const report=path.join(dir,".ai","runtime","VALIDATION_REPORT.json");return {...res,report:fs.existsSync(report)?readJson(report):null}});
}
describe("validate-shards aggregator (fail-closed)",()=>{
  it("passes only a complete, single, SHA/digest-bound, all-PASS set and writes the merged report for ci-evidence",()=>{
    const r=aggregate();expect(r.status,r.out).toBe(0);expect(r.out).toContain(`SHARD_AGGREGATION: PASS_PLATFORM_FILTERED shards=3 steps=4 sha=${SHA}`);
    expect(r.report).toMatchObject({status:"PASS_PLATFORM_FILTERED",platform:"win32",sha:SHA,platformFiltered:["l"]});
    expect(r.report.steps.map((s:{id:string;shard:number})=>`${s.id}@${s.shard}`)).toEqual(["x@1","w@2","l@1","y@3"]);
  });
  const neg:[string,(reps:Rep[],dir:string)=>void,string][]=[
    ["missing report",reps=>{delete (reps as unknown as Record<number,Rep>)[2]},"MISSING_SHARD:3"],
    ["duplicate shard",(reps,dir)=>fs.writeFileSync(path.join(dir,"shards","VALIDATION_SHARD_04.json"),JSON.stringify(reps[0])),"EXTRA_REPORT:VALIDATION_SHARD_04.json"],
    ["duplicate shard header",reps=>{reps[2].shard={index:1,count:3}},"SHARD_HEADER_MISMATCH:VALIDATION_SHARD_3.json"],
    ["extra report",(reps,dir)=>fs.writeFileSync(path.join(dir,"shards","VALIDATION_SHARD_4.json"),JSON.stringify({...reps[0],shard:{index:4,count:3}})),"EXTRA_REPORT:VALIDATION_SHARD_4.json"],
    ["duplicate step",reps=>{reps[2].steps.push({id:"x",status:"PASS",durationMs:1,timedOut:false})},"DUPLICATE_STEP:x"],
    ["missing step",reps=>{reps[2].steps=[]},"MISSING_STEP:y"],
    ["extra step",reps=>{reps[1].steps.push({id:"zz",status:"PASS",durationMs:1,timedOut:false})},"EXTRA_STEP:zz"],
    ["step in the wrong shard",reps=>{reps[1].steps.push(...reps[2].steps);reps[2].steps=[]},"STEP_WRONG_SHARD:y:2!=3"],
    ["run id mismatch (another run)",reps=>{reps[0].runId="78"},'RUN_MISMATCH:shard1:"78"/"2"'],
    ["run attempt mismatch (earlier attempt)",reps=>{reps[2].runAttempt="1"},'RUN_MISMATCH:shard3:"77"/"1"'],
    ["missing run binding",reps=>{reps[1].runId=null;reps[1].runAttempt=null},"RUN_MISMATCH:shard2:null/null"],
    ["sha mismatch",reps=>{reps[1].sha="d".repeat(40)},"SHA_MISMATCH:shard2"],
    ["digest mismatch",reps=>{reps[0].configSha256="0".repeat(64)},"DIGEST_MISMATCH:shard1"],
    ["FAIL status",reps=>{reps[2].steps[0].status="FAIL"},'STEP_NOT_PASS:y:"FAIL"'],
    ["timedOut",reps=>{reps[1].steps[0].timedOut=true},"TIMED_OUT:w"],
    ["NOT_RUN_PLATFORM on a step that requires win32",reps=>{reps[1].steps[0]={id:"w",status:"NOT_RUN_PLATFORM",durationMs:0,timedOut:false}},"NOT_RUN_REQUIRED_PLATFORM:w"],
    ["NOT_RUN_PLATFORM on an unfiltered step",reps=>{reps[2].steps[0].status="NOT_RUN_PLATFORM"},"NOT_RUN_REQUIRED_PLATFORM:y"],
    ["other-platform step reported PASS",reps=>{reps[0].steps[1].status="PASS"},'STEP_NOT_NOT_RUN_PLATFORM:l:"PASS"'],
    ["platform mismatch",reps=>{reps[0].platform="linux"},'PLATFORM_MISMATCH:shard1:"linux"'],
    ["shard status FAIL",reps=>{reps[0].status="FAIL"},'SHARD_STATUS:shard1:"FAIL"'],
    ["unparsable report",(reps,dir)=>{(reps as unknown as Record<number,Rep|undefined>)[1]=undefined;fs.writeFileSync(path.join(dir,"shards","VALIDATION_SHARD_2.json"),"{not json")},"UNPARSABLE_REPORT:VALIDATION_SHARD_2.json"],
    ["tampered (non-object) report",(reps,dir)=>{(reps as unknown as Record<number,Rep|undefined>)[1]=undefined;fs.writeFileSync(path.join(dir,"shards","VALIDATION_SHARD_2.json"),"[]")},"MALFORMED_REPORT:VALIDATION_SHARD_2.json"],
  ];
  for(const [name,mutate,reason] of neg)it(`FAILS on ${name}`,()=>{
    const r=aggregate(mutate);expect(r.status,r.out).toBe(1);expect(r.reasons.some(x=>x===reason||x.startsWith(reason+":")),`${reason} in ${r.out}`).toBe(true);expect(r.out).toMatch(/SHARD_AGGREGATION: FAIL/);expect(r.report,"no merged report on FAIL").toBeNull();
  });
  it("FAILS when the checked-out config changed after the shards ran (digest), or the plan is missing or mismatched",()=>{
    expect(aggregate((_r,dir)=>fs.appendFileSync(path.join(dir,"config","validation.json")," ")).reasons).toEqual(["DIGEST_MISMATCH:shard1","DIGEST_MISMATCH:shard2","DIGEST_MISMATCH:shard3"]);
    expect(aggregate(undefined,{steps:winSteps}).reasons).toEqual(["NO_SHARD_PLAN:win32"]);
    expect(aggregate(undefined,{steps:winSteps,shardPlan:{win32:{count:2,assign:{}}}}).reasons).toEqual(["PLAN_COUNT_MISMATCH:2!=3"]);
    expect(aggregate(undefined,{steps:winSteps,shardPlan:{win32:{count:3,assign:{zz:1}}}}).reasons).toEqual(["PLAN_UNKNOWN_STEP:zz"]);
  });
  it("FAILS on missing or invalid arguments, a missing report directory, and deletes a stale merged report",()=>withDir(dir=>{
    writeCfg(dir,winCfg);
    expect(runAgg(dir,["--count","3"]).reasons).toContain('INVALID_ARG_SHA:""');
    expect(runAgg(dir,["--count","x","--sha",SHA,...RUN]).reasons).toContain('INVALID_ARG_COUNT:"x"');
    expect(runAgg(dir,["--count","3","--sha",SHA]).reasons).toEqual(['INVALID_ARG_RUN_ID:""','INVALID_ARG_RUN_ATTEMPT:""']);
    expect(runAgg(dir,["--count","3","--sha",SHA,"--run-id","0","--run-attempt","a"]).reasons).toEqual(['INVALID_ARG_RUN_ID:"0"','INVALID_ARG_RUN_ATTEMPT:"a"']);
    fs.mkdirSync(path.join(dir,".ai","runtime"),{recursive:true});const stale=path.join(dir,".ai","runtime","VALIDATION_REPORT.json");fs.writeFileSync(stale,JSON.stringify({status:"PASS",steps:[{id:"x",status:"PASS"}]}));
    const r=runAgg(dir,[...WIN.slice(0,-1),"nope"]);expect(r.status).toBe(1);expect(r.reasons.some(x=>x.startsWith("DIR_UNREADABLE:"))).toBe(true);expect(fs.existsSync(stale),"stale PASS report removed").toBe(false);
  }));
  it("end to end: real --shard runs on this host aggregate to PASS",()=>withDir(dir=>{
    writeCfg(dir,hostCfg);for(const i of [1,2,3])expect(runRunner(dir,["--shard",`${i}/3`]).status).toBe(0);
    const r=runAgg(dir);expect(r.status,r.out).toBe(0);expect(r.out).toContain("SHARD_AGGREGATION: PASS_PLATFORM_FILTERED shards=3 steps=6");
  }));
});

describe("canonical shard plan and CI wiring",()=>{
  const cfg=readJson("config/validation.json"),plan=cfg.shardPlan?.win32,ci=fs.readFileSync(".github/workflows/ci.yml","utf8");
  it("plans 3 Windows shards over known steps and places every vitest step explicitly",()=>{
    expect(plan.count).toBe(3);const ids=cfg.steps.map((s:Step)=>s.id);
    for(const [id,v] of Object.entries(plan.assign as Record<string,number>)){expect(ids,id).toContain(id);expect([1,2,3],id).toContain(v)}
    for(const s of cfg.steps as Step[])if(s.command.some(a=>a.includes("vitest")))expect(Object.keys(plan.assign),`${s.id} must be assigned explicitly`).toContain(s.id);
    expect(Object.keys(cfg.shardPlan)).toEqual(["//TR","win32"]);
  });
  it("keeps Linux as one job and makes the required Windows context the fail-closed aggregator",()=>{
    expect(ci).toMatch(/\n {2}validate:\n[\s\S]*?os: \[ubuntu-latest\]\n/);
    expect(ci).toContain("name: validate-windows-shard (${{ matrix.shard }})");
    expect(ci).toContain("node scripts/run-validation.mjs --shard ${{ matrix.shard }}/3");
    expect(ci.match(/name: validate \(windows-latest\)/g)).toHaveLength(1);
    expect(ci).toMatch(/validate-windows:\n {4}name: validate \(windows-latest\)\n {4}needs: validate-windows-shard\n {4}if: always\(\)/);
    expect(ci).toContain('test "$SHARDS_RESULT" = "success"');
    // //TR: S1: birleştirici işi PR-kontrollü bağımlılık kurmaz; yalnız Node yerleşikleriyle çalışır. S2: run id/attempt bağlanır.
    const agg=ci.slice(ci.indexOf("\n  validate-windows:\n"));expect(agg.length).toBeGreaterThan(100);
    for(const banned of ["ensure-dependencies","npm ci","npm install","cache: npm","node_modules"])expect(agg,`aggregator job must not use ${banned}`).not.toContain(banned);
    expect(agg).toContain('--run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT"');
    expect(ci).toContain('node scripts/validate-shards.mjs --count 3 --sha "$UASCO_HEAD_SHA" --platform win32');
    for(const s of ["node scripts/secret-sanity.mjs","node scripts/bootstrap-kernel-selftest.mjs","node scripts/ci/ci-evidence.mjs --require --leg ${{ runner.os }}"])expect(ci.split(s).length-1,s).toBe(2);
    expect(ci).toContain("permissions:\n  contents: read");expect(ci).not.toMatch(/persist-credentials: true/);
    for(const u of ci.matchAll(/uses: (\S+)/g))expect(u[1],"every action is SHA-pinned").toMatch(/@[0-9a-f]{40}$/);
  });
});
// //TR: Dosya-adı öneki koruma sağlamaz (no-overmatch); birleştirici CI kapısıdır ve açıkça protected trust-root'ta olmalıdır.
describe("aggregator protection",()=>{
  it("the aggregator and the scripts its CI job runs import Node built-ins only (no npm dependencies)",()=>{
    const seen=new Set<string>(),ext:string[]=[];
    const walk=(f:string)=>{if(seen.has(f))return;seen.add(f);const src=fs.readFileSync(f,"utf8");if(/\brequire\(/.test(src))ext.push(`require in ${f}`);for(const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)){const sp=m[1];if(sp.startsWith("."))walk(path.resolve(path.dirname(f),sp));else if(!sp.startsWith("node:"))ext.push(`${sp} <- ${f}`)}};
    for(const f of ["scripts/validate-shards.mjs","scripts/secret-sanity.mjs","scripts/bootstrap-kernel-selftest.mjs","scripts/ci/ci-evidence.mjs"])walk(path.resolve(f));
    expect(ext).toEqual([]);expect(seen.size).toBeGreaterThanOrEqual(4);
  });
  it("lists scripts/validate-shards.mjs in protected exactPaths",()=>{expect(readJson("config/protected-paths.json").exactPaths).toContain("scripts/validate-shards.mjs")})});
