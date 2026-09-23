// //TR: Bu script 363 agentın canonical V2 matrix'inde gerçek skill ontology, technology ontology, multi-pack, review chain ve unknown-technology protokolünü taşıdığını doğrular.
import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const agents=read("registries/agents.json").agents;
const matrix=read("registries/agent-skill-matrix.json").agents;
const skills=new Set(read("registries/skills-v2.json").skills.map(x=>x.id));
const tech=new Set(read("registries/technologies.json").technologies.map(x=>x.id));
if(agents.length!==363||matrix.length!==363) throw new Error(`Expected 363 agents/matrix, got ${agents.length}/${matrix.length}`);
const map=new Map(matrix.map(x=>[x.agentId,x]));
for(const a of agents){
 const m=map.get(a.id); if(!m) throw new Error(`Missing competency ${a.id}`);
 if(!m.primaryCompetencyPacks?.length) throw new Error(`Missing primary pack ${a.id}`);
 if(m.unknownTechnologyProtocol!=="DYNAMIC_TECHNOLOGY_DISCOVERY_REQUIRED") throw new Error(`Bad unknown-tech protocol ${a.id}`);
 for(const s of m.requiredSkillIds||[]) if(!skills.has(s)) throw new Error(`Unknown V2 skill ${s} for ${a.id}`);
 for(const t of [...(m.primaryTechnologyIds||[]),...(m.comparisonTechnologyIds||[])]) if(!tech.has(t)) throw new Error(`Unknown technology ${t} for ${a.id}`);
 if(a.id!=="001" && !m.reviewChainAgentIds?.length) throw new Error(`Missing review chain ${a.id}`);
}
const api=map.get("096"); for(const t of ["TECH-OPENAPI","TECH-JSON-SCHEMA","TECH-POSTMAN","TECH-NEWMAN","TECH-AJV"]) if(!api.primaryTechnologyIds.includes(t)) throw new Error(`API QA missing ${t}`);
const flutter=map.get("053"); for(const t of ["TECH-DART","TECH-FLUTTER"]) if(!flutter.primaryTechnologyIds.includes(t)) throw new Error(`Flutter missing ${t}`);
const rn=map.get("054"); for(const t of ["TECH-REACT-NATIVE","TECH-HERMES","TECH-REACT-NATIVE-JSI"]) if(!rn.primaryTechnologyIds.includes(t)) throw new Error(`RN missing ${t}`);
console.log(`COMPETENCY_V2_VALIDATION: PASS agents=${matrix.length} skills=${skills.size} technologies=${tech.size}`);
