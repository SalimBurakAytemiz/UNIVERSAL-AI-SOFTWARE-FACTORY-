// //TR: Bu validator canonical schema dosyalarının unknown-field acceptance'ı açık bırakmadığını ve v2 core semantic şemalarının required alanlara sahip olduğunu doğrular.
import fs from "node:fs";
const files=fs.readdirSync("schemas").filter(x=>x.endsWith(".schema.json"));
let permissive=[];
for(const f of files){
 const s=JSON.parse(fs.readFileSync(`schemas/${f}`,"utf8"));
 if(s.type==="object" && s.additionalProperties!==false) permissive.push(f);
}
if(permissive.length) throw new Error(`Permissive schemas: ${permissive.slice(0,20).join(", ")}`);
for(const f of ["technology.schema.json","agent-competency-v2.schema.json","technology-depth.schema.json","phase-contract.schema.json"]){
 const s=JSON.parse(fs.readFileSync(`schemas/${f}`,"utf8"));
 if(!Array.isArray(s.required)||s.required.length<4) throw new Error(`Weak v2 schema ${f}`);
}
console.log(`SCHEMA_STRICTNESS_VALIDATION: PASS schemas=${files.length}`);
