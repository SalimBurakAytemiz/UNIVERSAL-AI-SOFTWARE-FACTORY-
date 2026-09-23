// //TR: Bu validator Technology Knowledge Graph'in boş olmadığını, ID/alias/grup ilişkilerini ve temel seed technology ailelerini deterministik olarak doğrular.
import fs from "node:fs";
const t=JSON.parse(fs.readFileSync("registries/technologies.json","utf8"));
const groups=JSON.parse(fs.readFileSync("registries/technology-groups.json","utf8"));
if(t.technologies.length<250) throw new Error(`Technology universe too small: ${t.technologies.length}`);
const ids=new Set(t.technologies.map(x=>x.id));
if(ids.size!==t.technologies.length) throw new Error("Duplicate technology IDs");
const required=["TECH-FLUTTER","TECH-DART","TECH-REACT-NATIVE","TECH-KOTLIN","TECH-SWIFT","TECH-REACT","TECH-SPRING-BOOT","TECH-ASPNET-CORE","TECH-POSTGRESQL","TECH-KAFKA","TECH-SOCKETIO","TECH-PLAYWRIGHT","TECH-APPIUM","TECH-UNREAL-ENGINE","TECH-KUBERNETES","TECH-PYTORCH"];
for(const id of required) if(!ids.has(id)) throw new Error(`Missing required seed technology ${id}`);
for(const g of groups.groups) for(const id of g.technologyIds) if(!ids.has(id)) throw new Error(`Unknown group technology ${id}`);
console.log(`TECHNOLOGY_GRAPH_VALIDATION: PASS technologies=${t.technologies.length} groups=${groups.groups.length}`);
