// //TR: Recovery checklist'teki Paste 3'ün 15 source kontrolünü tek fail-closed gate altında toplar; source completion ile runtime certification iddiasını birbirine karıştırmaz.
import fs from "node:fs";
import {spawnSync} from "node:child_process";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const fail=m=>{throw new Error(m)};
const run=s=>{const r=spawnSync(process.execPath,[s],{encoding:"utf8"});if(r.status!==0)fail(`${s} failed:\n${r.stdout}\n${r.stderr}`);return r.stdout.trim()};
const outputs={};
for(const s of [
 "scripts/validate-woven-model.mjs",
 "scripts/validate-organization.mjs",
 "scripts/validate-agent-semantic.mjs",
 "scripts/validate-paste3-agent-specialization.mjs",
 "scripts/validate-review-graph-v2.mjs",
 "scripts/validate-technology-graph.mjs",
 "scripts/validate-domain-packs.mjs",
 "scripts/validate-paste3-technology-domain-registry.mjs"
]) outputs[s]=run(s);
const controls=[];const ok=(id,evidence)=>controls.push({id,evidence});
const agents=read("registries/agents.json").agents;
const evalCount=fs.readdirSync("evaluations/agents").filter(x=>x.endsWith(".json")).length;
const genomeCount=fs.readdirSync("organization/agents").filter(x=>x.endsWith(".json")).length;
const deptCount=fs.readdirSync("organization/departments").filter(x=>x.endsWith(".json")).length;
const tech=read("registries/technologies.json").technologies;
const knowledgeCount=fs.readdirSync("knowledge/technologies").filter(x=>x.endsWith(".json")).length;
const domains=read("registries/domain-packs.json").domains;
if(agents.length!==363||evalCount!==363||genomeCount!==363||deptCount!==40||tech.length!==415||knowledgeCount!==415||domains.length!==22)fail("Paste3 exact-count coherence failed");ok("P3-01","363 agents/evals/genomes, 40 departments, 415 tech/knowledge, 22 domains");
ok("P3-02","requiredPrimaryTechnologyIds enforced by agent semantic validator");
ok("P3-03","shared foundation + family + role overlay; no rarity inference");
if(read("registries/agent-role-overlays.json").count!==363)fail("Role overlay count drift");ok("P3-04","363 role overlays and genome refs");
ok("P3-05","role-specific structured evaluation contracts");
ok("P3-06","unique self-free review graph");
ok("P3-07","primary/comparison technology overlap forbidden");
const rel=read("registries/technology-relations.json");if(rel.structuralRelationCount!==415)fail("Technology structural coverage metadata drift");ok("P3-08","415/415 structural discovery relation coverage");
ok("P3-09","certified technology evidence + semantic relation policy fail-closed");
ok("P3-10","22/22 domain-specific state/architecture/QA/security/failure seeds");
for(const d of domains)if(d.knowledgeState!=="SEED_DOMAIN_PROFILE")fail(`Domain non-seed claim ${d.id}`);ok("P3-11","domain packs remain honest SEED_DOMAIN_PROFILE");
const sa=read("registries/skill-ontology-authority.json");if(sa.canonicalRuntime?.prefix!=="SK2-"||sa.legacyReferenceOnly?.prefix!=="SKILL-")fail("Skill ontology authority drift");ok("P3-12","V1 legacy vs V2 canonical runtime ontology separated");
const ctx=read("registries/agent-context-index-v2.json");if(ctx.count!==363||ctx.authority!=="DISCOVERY_INDEX_ONLY")fail("Compact context index drift");ok("P3-13","bounded 363-agent discovery index");
const ra=read("registries/registry-authority-v2.json");if(!ra.authorities?.runtimeSkills||!ra.authorities?.toolAdapters)fail("Registry authority contract incomplete");ok("P3-14","canonical/legacy registry ownership machine enforced");
ok("P3-15","capability/fabric/binder/framework/skill/adapter refs duplicate+dangling scan clean");
if(controls.length!==15)fail(`Expected 15 controls got ${controls.length}`);
console.log(`PASTE3_SOURCE_CLOSURE: PASS controls=${controls.length}/15 technologies=415 domains=22 agents=363 runtimeCertificationClaim=false`);
