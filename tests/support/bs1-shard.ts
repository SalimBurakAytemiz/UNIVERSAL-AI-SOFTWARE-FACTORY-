// //TR: Bu yardımcı BS1 selftest senaryolarını doğrulama adımlarına bölen tek kaynaktır: her senaryo tam olarak bir kabukta (shard) yer alır, kabuk içindeki gruplar en çok iki eşzamanlı alt süreç olarak çalışır ve kabuğun her senaryosu PASS olmak zorundadır. Kapsam bütünlüğünü tests/pkg-vs-validation-sharding.test.ts denetler.
import cp from "node:child_process";
export type Bs1Shard="a"|"b"|"c"|"d"|"e";
export const BS1_PARTITION:Record<Bs1Shard,string[][]>={
  a: [
    ["bootstrap-task-rollback-falls-back-to-disable-and-reports-an-unsafe-result"],
    ["entry-runs-the-tick-loop-timeout-cleanup-and-governed-upgrade-on-the-real-aut1b-plane"]
  ],
  b: [
    ["entry-never-runs-the-old-tick-once-master-has-the-launcher-and-upgrades-only-when-governed"],
    ["entry-stops-the-old-tick-once-a-governed-launcher-merge-lands-and-recovers-an-unrecorded-merge"]
  ],
  c: [
    ["static-safety-of-the-bootstrap-wrapper-and-entry",
     "bootstrap-installs-plane-entry-wrapper-activation-task-definition-and-record",
     "the-scheduled-task-command-line-round-trips-paths-with-spaces-ampersands-and-quotes",
     "bootstrap-first-run-verdict-fails-a-failed-tick-and-confirms-delegation-only-from-a-fresh-daemon-heartbeat",
     "bootstrap-refuses-unsafe-or-unverifiable-inputs-without-activating-anything"],
    ["entry-stops-the-old-tick-only-at-a-safe-point-or-at-once-in-the-release-lane"]
  ],
  d: [
    ["bootstrap-task-registration-succeeds-or-rolls-back-without-a-runnable-task"],
    ["bootstrap-task-first-run-failure-stops-and-rolls-back-the-task"]
  ],
  e: [
    ["bootstrap-repairs-an-inactive-half-cloned-plane-and-replaces-a-dangling-link",
     "entry-delegates-to-a-governed-plane-entry-and-to-the-launcher",
     "entry-heartbeat-watch-needs-two-stale-polls-ignores-suspend-and-reads-the-backup",
     "entry-heals-an-interrupted-link-switch-and-refuses-broken-or-unproven-planes",
     "entry-loops-the-pre-launcher-tick-writes-passive-status-and-honours-global-stop",
     "entry-records-the-top-level-tick-status-and-keeps-the-bootstrap-record-in-its-mirror"],
    ["entry-kills-a-hung-supervisor-whose-heartbeat-is-frozen",
     "entry-refuses-an-old-plane-release-lane-and-honours-global-stop",
     "entry-kills-the-whole-tick-process-tree-on-timeout-and-clears-its-lock",
     "entry-clears-only-provably-stale-locks-and-replaces-a-dangling-link"]
  ],
};
export const BS1_REAL_AUT1B_SCENARIO="entry-runs-the-tick-loop-timeout-cleanup-and-governed-upgrade-on-the-real-aut1b-plane";
export const AUT1B_COMMIT="f3b4ad87d7c297a5649c5072debe58675fc1422f";
export function bs1Scenarios(source:string):string[]{return [...source.matchAll(/scenario\("([^"]+)"/g)].map(m=>m[1])}
// //TR: Bölümleme kontrolü saf bir fonksiyondur: selftest kaynağındaki her senaryo tam bir kez atanmış olmalı, fazladan veya yinelenen atama olmamalı ve hiçbir ad başka bir adın öneki olmamalıdır (UASCO_BS1_ONLY önek eşleştirir).
export function checkBs1Partition(partition:Record<string,string[][]>,source:string):string[]{
  const errors:string[]=[],all=bs1Scenarios(source),assigned=Object.values(partition).flat(2),count=new Map<string,number>();
  for(const n of assigned)count.set(n,(count.get(n)??0)+1);
  for(const n of all)if(!count.has(n))errors.push("scenario-not-assigned:"+n);
  for(const [n,c] of count){if(!all.includes(n))errors.push("assigned-scenario-not-in-selftest:"+n);if(c>1)errors.push("scenario-assigned-twice:"+n)}
  if(new Set(all).size!==all.length)errors.push("duplicate-scenario-name-in-selftest");
  for(const a of all)for(const b of all)if(a!==b&&b.startsWith(a))errors.push("scenario-name-is-prefix-of-another:"+a);
  return errors;
}
// //TR: Bir kabuğun grupları ayrı alt süreçlerde paralel çalışır; her alt süreç selftest'i yalnız kendi senaryo adlarıyla (UASCO_BS1_ONLY) çağırır ve çıktıdaki her gerekli senaryonun PASS olması beklenir.
export async function runBs1Shard(shard:Bs1Shard):Promise<{ok:boolean;detail:string;line:string[];stdout:string}>{
  const groups=BS1_PARTITION[shard];
  const outs=await Promise.all(groups.map(g=>new Promise<{code:number|null;out:string}>(res=>{
    const c=cp.spawn(process.execPath,["scripts/bootstrap-autonomy-selftest.mjs"],{cwd:process.cwd(),env:{...process.env,UASCO_BS1_SHARDS:"",UASCO_BS1_ONLY:g.join(",")},windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let out="";c.stdout.on("data",d=>{out+=d});c.stderr.on("data",d=>{out+=d});c.on("close",code=>res({code,out}));
  })));
  return {ok:outs.every(o=>o.code===0),detail:outs.map(o=>"exit="+o.code+" "+o.out.slice(-2500)).join("\n---\n"),line:outs.map(o=>o.out.trim().split(/\r?\n/).pop()??""),stdout:outs.map(o=>o.out).join("\n")};
}
