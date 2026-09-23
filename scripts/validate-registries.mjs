// //TR: Bu script 363 agent, 110 capability, 20 meta system ve completeness baseline'daki fabric/binder/domain/tool registriesinin sayısını/duplicate ID'lerini deterministik olarak doğrular.
import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const checks=[
 ["agents","registries/agents.json","agents",363],
 ["capabilities","registries/capabilities.json","capabilities",110],
 ["meta","registries/meta-core-systems.json","systems",20],
 ["fabrics","registries/execution-fabrics.json","fabrics",45],
 ["binders","registries/execution-binders.json","binders",16],
 ["domains","registries/domain-packs.json","domains",22]
];
for(const [name,path,key,count] of checks){
 const data=read(path); const list=data[key];
 if(list.length!==count) throw new Error(`${name} expected ${count}, got ${list.length}`);
 const ids=list.map(x=>x.id); if(new Set(ids).size!==ids.length) throw new Error(`${name} duplicate ids`);
}
const tools=read("registries/tool-adapters.json").adapters;
if(tools.length<120) throw new Error(`tool adapters too small: ${tools.length}`);
console.log(`REGISTRY_VALIDATION: PASS agents=363 capabilities=110 meta=20 fabrics=45 binders=16 domains=22 tools=${tools.length}`);
