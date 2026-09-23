// //TR: Bu script 40 department'ın head atamasını, 363 agent üyeliğini ve council member referanslarını doğrular; böylece specialist→head review zinciri kâğıt üzerinde kalmaz.
import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8")); const agents=read("registries/agents.json").agents; const ids=new Set(agents.map(x=>x.id));
const org=read("registries/organization-hierarchy.json").departments; if(org.length!==40) throw new Error(`Expected 40 departments got ${org.length}`);
const seen=new Set(); for(const d of org){if(!ids.has(d.headAgentId)) throw new Error(`bad head ${d.id}`); for(const x of d.members){if(!ids.has(x)) throw new Error(`bad member ${x}`); seen.add(x)}}
if(seen.size!==363) throw new Error(`Only ${seen.size}/363 agents assigned`);
for(const c of read("registries/councils.json").councils) for(const x of c.members) if(!ids.has(x)) throw new Error(`bad council member ${x}`);
console.log("ORGANIZATION_VALIDATION: PASS departments=40 agents=363");
