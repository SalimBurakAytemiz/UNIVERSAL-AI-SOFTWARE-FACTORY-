// //TR: Bu validator schema catalog ile schemas/ altındaki fiziksel dosya setinin birebir aynı olduğunu, tüm object schema'ların strict ve semantic required alanlarının yeterli olduğunu doğrular.
import fs from "node:fs";
const c=JSON.parse(fs.readFileSync("registries/schema-catalog.json","utf8"));
const physical=fs.readdirSync("schemas").filter(x=>x.endsWith(".schema.json")).map(x=>`schemas/${x}`).sort();
const listed=c.schemas.map(x=>x.file).sort();
if(c.count!==c.schemas.length) throw new Error(`Schema catalog count mismatch declared=${c.count} entries=${c.schemas.length}`);
if(JSON.stringify(physical)!==JSON.stringify(listed)){
 const ps=new Set(physical),ls=new Set(listed);
 throw new Error(`Schema catalog exact-set mismatch missing=${physical.filter(x=>!ls.has(x)).join(",")} stale=${listed.filter(x=>!ps.has(x)).join(",")}`);
}
for(const x of c.schemas){
 const s=JSON.parse(fs.readFileSync(x.file,"utf8"));
 if(s.type!=="object"||!s["$schema"]) throw new Error(`Invalid schema baseline ${x.file}`);
 if(s.additionalProperties!==false) throw new Error(`Permissive object schema ${x.file}`);
 if(!Array.isArray(s.required)||s.required.length<4) throw new Error(`Semantic required fields too weak ${x.file}: ${s.required?.length??0}`);
}
console.log(`SCHEMA_CATALOG_VALIDATION: PASS exact-count=${c.schemas.length}`);
