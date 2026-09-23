// //TR: Bu validator full-woven canonical starter'ın teknoloji graph, gerçek skill ontology, 363 agent genome/evaluation/tool policy, department charter ve phase contract dosyalarını nicel+semantic minimumlarla doğrular.
import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const tech=read("registries/technologies.json").technologies;
const skills=read("registries/skills-v2.json").skills;
const agents=read("registries/agent-competency-v2.json").agents;
const matrix=read("registries/agent-skill-matrix.json").agents;
const tools=read("registries/tool-adapters.json").adapters;
const policies=read("registries/agent-tool-policy-v2.json").policies;
const phases=read("registries/phase-contracts-index.json").contracts;
const counts={
  technologyFiles:fs.readdirSync("knowledge/technologies").filter(x=>x.endsWith(".json")).length,
  agentFiles:fs.readdirSync("organization/agents").filter(x=>x.endsWith(".json")).length,
  evalFiles:fs.readdirSync("evaluations/agents").filter(x=>x.endsWith(".json")).length,
  departmentFiles:fs.readdirSync("organization/departments").filter(x=>x.endsWith(".json")).length,
  phaseFiles:fs.readdirSync("roadmap/contracts").filter(x=>x.endsWith(".json")).length
};
if(tech.length<350) throw new Error(`Technology universe too small ${tech.length}`);
if(skills.length<350) throw new Error(`Skill ontology too small ${skills.length}`);
if(agents.length!==363||matrix.length!==363||policies.length!==363) throw new Error("363-agent woven model incomplete");
if(counts.agentFiles!==363||counts.evalFiles!==363) throw new Error(`Agent artifacts incomplete ${JSON.stringify(counts)}`);
if(counts.departmentFiles!==40) throw new Error("Department charters incomplete");
if(phases.length!==counts.phaseFiles||phases.length<140) throw new Error("Phase contracts incomplete");
if(counts.technologyFiles!==tech.length) throw new Error("Technology knowledge files do not match registry");
if(tools.length<180) throw new Error(`Tool adapter universe too small ${tools.length}`);
const byId=new Map(matrix.map(x=>[x.agentId,x]));
for(const [id,reqTech] of Object.entries({
 "051":["TECH-KOTLIN","TECH-JETPACK-COMPOSE"],
 "052":["TECH-SWIFT","TECH-SWIFTUI"],
 "053":["TECH-DART","TECH-FLUTTER"],
 "054":["TECH-REACT-NATIVE","TECH-HERMES","TECH-REACT-NATIVE-JSI"],
 "096":["TECH-OPENAPI","TECH-JSON-SCHEMA","TECH-AJV"],
 "098":["TECH-WEBSOCKET","TECH-SOCKETIO","TECH-NATS","TECH-KAFKA"]
})){
 const a=byId.get(id); if(!a) throw new Error(`Missing agent ${id}`);
 for(const t of reqTech) if(!a.primaryTechnologyIds.includes(t)) throw new Error(`Agent ${id} missing ${t}`);
}
console.log(`WOVEN_MODEL_VALIDATION: PASS technologies=${tech.length} skills=${skills.length} tools=${tools.length} agents=363 phaseContracts=${phases.length}`);
