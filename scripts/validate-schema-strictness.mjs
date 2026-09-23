// //TR: Bu validator bütün canonical schema ağacını recursive tarar; object contract'ları STRICT, exact registry'deki legacy OPEN_MAP veya strict-value TYPED_MAP dışında fail-closed reddeder.
import fs from "node:fs";
const files=fs.readdirSync("schemas").filter(x=>x.endsWith(".schema.json")).sort();
const registry=JSON.parse(fs.readFileSync("config/schema-open-map-exceptions.json","utf8"));
if(registry.schemaVersion!=="1.0.0"||!Array.isArray(registry.entries))throw new Error("SCHEMA_OPEN_MAP_EXCEPTION_REGISTRY_INVALID");
const key=(file,pointer)=>`${file}::${pointer}`;
const exceptions=new Map();
for(const e of registry.entries){
 if(!e||typeof e.file!=="string"||typeof e.pointer!=="string"||!["OPEN_MAP","TYPED_MAP"].includes(e.mode)||typeof e.reason!=="string"||!e.reason.trim())throw new Error("SCHEMA_OPEN_MAP_EXCEPTION_ENTRY_INVALID");
 const k=key(e.file,e.pointer);if(exceptions.has(k))throw new Error(`SCHEMA_OPEN_MAP_EXCEPTION_DUPLICATE:${k}`);exceptions.set(k,e);
}
const seen=new Set(),errors=[];
function objectType(node){return node?.type==="object"||(Array.isArray(node?.type)&&node.type.includes("object"))}
function walk(file,node,pointer="$"){
 if(Array.isArray(node)){node.forEach((v,i)=>walk(file,v,`${pointer}/${i}`));return}
 if(!node||typeof node!=="object")return;
 if(objectType(node)){
   const k=key(file,pointer),e=exceptions.get(k),ap=node.additionalProperties;
   if(ap===false){if(e)errors.push(`STALE_OPEN_MAP_EXCEPTION:${k}`)}
   else if(ap&&typeof ap==="object"&&!Array.isArray(ap)){
     if(e?.mode!=="TYPED_MAP")errors.push(`UNREGISTERED_TYPED_MAP:${k}`);else seen.add(k);
   }else{
     if(e?.mode!=="OPEN_MAP")errors.push(`UNREGISTERED_OPEN_MAP:${k}`);else seen.add(k);
   }
 }
 for(const [k,v] of Object.entries(node))walk(file,v,`${pointer}/${k}`);
}
for(const name of files){const file=`schemas/${name}`,schema=JSON.parse(fs.readFileSync(file,"utf8"));if(schema.type!=="object"||schema.additionalProperties!==false)errors.push(`ROOT_NOT_STRICT:${file}`);walk(file,schema)}
for(const k of exceptions.keys())if(!seen.has(k))errors.push(`STALE_OR_UNRESOLVED_OPEN_MAP_EXCEPTION:${k}`);
for(const f of ["technology.schema.json","agent-competency-v2.schema.json","technology-depth.schema.json","phase-contract.schema.json"]){const s=JSON.parse(fs.readFileSync(`schemas/${f}`,"utf8"));if(!Array.isArray(s.required)||s.required.length<4)errors.push(`WEAK_V2_SCHEMA:schemas/${f}`)}
if(errors.length)throw new Error(`SCHEMA_RECURSIVE_STRICTNESS_FAILED count=${errors.length} ${errors.slice(0,20).join(" | ")}`);
console.log(`SCHEMA_STRICTNESS_VALIDATION: PASS schemas=${files.length} openExceptions=${[...exceptions.values()].filter(x=>x.mode==="OPEN_MAP").length} typedMaps=${[...exceptions.values()].filter(x=>x.mode==="TYPED_MAP").length}`);
