// //TR: Paste 3B validatorı 415 technology structural relation coverage, 22 domain specialization seed'i ve registry authority/dangling/duplicate semantic ID closure'ını adversarial olarak doğrular.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const clone=x=>structuredClone(x);
const fail=m=>{throw new Error(m)};
const uniq=a=>new Set(a).size===a.length;
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");

const base={
 techDoc:read("registries/technologies.json"),
 groupsDoc:read("registries/technology-groups.json"),
 relDoc:read("registries/technology-relations.json"),
 certPolicy:read("registries/technology-certification-policy.json"),
 domainDoc:read("registries/domain-packs.json"),
 frameworkDoc:read("registries/framework-packs.json"),
 legacySkillsDoc:read("registries/skills.json"),
 runtimeSkillsDoc:read("registries/skills-v2.json"),
 authorityDoc:read("registries/registry-authority-v2.json"),
 adaptersDoc:read("registries/tool-adapters.json"),
 toolPolicyDoc:read("registries/agent-tool-policy-v2.json"),
 agentsDoc:read("registries/agents.json"),
 capabilitiesDoc:read("registries/capabilities.json"),
 fabricsDoc:read("registries/execution-fabrics.json"),
 bindersDoc:read("registries/execution-binders.json"),
 knowledgeDocs:fs.readdirSync("knowledge/technologies").filter(x=>x.endsWith(".json")).map(x=>read(`knowledge/technologies/${x}`)),
 domainProfiles:read("registries/domain-packs.json").domains.map(x=>read(x.profilePath))
};

function validate(d){
 const tech=d.techDoc.technologies, groups=d.groupsDoc.groups, rel=d.relDoc;
 if(tech.length!==415) fail(`Expected 415 technologies got ${tech.length}`);
 const techIds=tech.map(x=>x.id), techSet=new Set(techIds); if(!uniq(techIds)) fail("Duplicate technology IDs");
 if(d.knowledgeDocs.length!==415) fail(`Expected 415 knowledge docs got ${d.knowledgeDocs.length}`);
 const knowledgeIds=d.knowledgeDocs.map(x=>x.technologyId); if(!uniq(knowledgeIds)||new Set(knowledgeIds).size!==techSet.size||techIds.some(x=>!knowledgeIds.includes(x))) fail("Technology knowledge ID set mismatch");
 const knowledgeMap=new Map(d.knowledgeDocs.map(x=>[x.technologyId,x]));
 const groupMap=new Map(groups.map(x=>[x.id,new Set(x.technologyIds)]));
 if(groupMap.size!==groups.length) fail("Duplicate technology group IDs");
 for(const t of tech){
   if(!groupMap.has(t.group)||!groupMap.get(t.group).has(t.id)) fail(`Technology/group mismatch ${t.id}`);
   const k=knowledgeMap.get(t.id); if(!k||k.name!==t.name||k.group!==t.group) fail(`Knowledge identity mismatch ${t.id}`);
   const facets=new Set(k.knowledgeUnits?.map(x=>x.facet)); for(const f of t.knowledgeFacets??[]) if(!facets.has(f)) fail(`Knowledge facet missing ${t.id}:${f}`);
 }
 const structural=rel.structuralRelations??[];
 if(structural.length!==415||rel.structuralRelationCount!==415) fail(`Structural relation coverage count invalid ${structural.length}`);
 const structuralIds=structural.map(x=>x.technologyId); if(!uniq(structuralIds)||structuralIds.some(x=>!techSet.has(x))||techIds.some(x=>!structuralIds.includes(x))) fail("Structural relation coverage not 415/415");
 for(const r of structural){
   const t=tech.find(x=>x.id===r.technologyId); if(r.kind!=="GROUP_MEMBERSHIP"||r.coverageLevel!=="SEED_STRUCTURAL_DISCOVERY"||r.groupId!==t.group||!groupMap.get(r.groupId)?.has(r.technologyId)) fail(`Bad structural relation ${r.technologyId}`);
 }
 const exact=new Set(), altUndirected=new Set(), pairCoverage=new Set();
 for(const r of rel.relations??[]){
   if(!techSet.has(r.from)||!techSet.has(r.to)) fail(`Dangling technology relation ${r.from}->${r.to}`);
   if(r.from===r.to) fail(`Self technology relation ${r.from}`);
   const k=`${r.from}|${r.to}|${r.kind}`; if(exact.has(k)) fail(`Duplicate technology relation ${k}`); exact.add(k); pairCoverage.add(r.from); pairCoverage.add(r.to);
   if(r.kind==="ALTERNATIVE_FAMILY"){
     const u=[r.from,r.to].sort().join("|"); if(altUndirected.has(u)) fail(`Symmetric duplicate alternative relation ${u}`); altUndirected.add(u);
   }
 }
 if(rel.count!==(rel.relations??[]).length) fail("Technology relation count metadata drift");
 const req=d.certPolicy.requiredCertificationEvidence??[];
 for(const t of tech){
   if(t.knowledgeState===d.certPolicy.certifiedState){
     const ev=t.certificationEvidence; if(!ev||typeof ev!=="object") fail(`Certified technology evidence missing ${t.id}`);
     for(const key of req) if(ev[key]===undefined||ev[key]===null||ev[key]===""||(Array.isArray(ev[key])&&ev[key].length===0)) fail(`Certified technology evidence missing ${t.id}:${key}`);
     if(!pairCoverage.has(t.id)) fail(`Certified technology semantic orphan ${t.id}`);
   }
 }

 const domains=d.domainDoc.domains; if(domains.length!==22) fail(`Expected 22 domains got ${domains.length}`);
 const dIds=domains.map(x=>x.id); if(!uniq(dIds)) fail("Duplicate domain IDs");
 const profileMap=new Map(d.domainProfiles.map(x=>[x.id,x])); if(profileMap.size!==22) fail("Domain profile ID mismatch");
 const seedFields=["stateMachineSeeds","referenceArchitectureSeeds","qaSeeds","securityPrivacySeeds","failureSeeds","forbiddenAssumptionSeeds"];
 const fingerprints=new Map(seedFields.map(f=>[f,new Set()]));
 for(const row of domains){
   const p=profileMap.get(row.id); if(!p||p.name!==row.name) fail(`Domain profile identity mismatch ${row.id}`);
   if(row.knowledgeState!=="SEED_DOMAIN_PROFILE"||p.status!=="SEED_DOMAIN_PROFILE"||row.freshnessPolicy!=="MISSION_TIME_REVALIDATION_REQUIRED") fail(`Domain fake certification/state drift ${row.id}`);
   if(!p.domainSpecificSeeds||typeof p.domainSpecificSeeds!=="object") fail(`Domain specialization missing ${row.id}`);
   for(const f of seedFields){const v=p.domainSpecificSeeds[f]; if(!Array.isArray(v)||v.length<1) fail(`Domain specialization weak ${row.id}:${f}`); const h=hash(v); if(fingerprints.get(f).has(h)) fail(`Generic cloned domain specialization ${f}`); fingerprints.get(f).add(h);}
   if(!(p.prohibitedAssumptions??[]).includes("DOMAIN_LABEL_IS_NOT_EXPERTISE")||!(p.prohibitedAssumptions??[]).includes("MODEL_MEMORY_IS_NOT_CURRENT_REGULATION")) fail(`Domain truth rule missing ${row.id}`);
 }

 const auth=d.authorityDoc.authorities??{}; for(const p of Object.values(auth)) if(!fs.existsSync(p)) fail(`Registry authority target missing ${p}`);
 if(d.runtimeSkillsDoc.authority!=="CANONICAL_RUNTIME"||d.legacySkillsDoc.authority!=="LEGACY_REFERENCE_ONLY") fail("Skill authority drift");
 if(d.frameworkDoc.skillAuthority!=="LEGACY_REFERENCE_ONLY"||d.frameworkDoc.runtimeSkillAuthority!==false) fail("Framework skill authority drift");
 const legacySkills=new Set(d.legacySkillsDoc.skills.map(x=>x.id)); const runtimeSkills=new Set(d.runtimeSkillsDoc.skills.map(x=>x.id));
 if(legacySkills.size!==d.legacySkillsDoc.skills.length||runtimeSkills.size!==d.runtimeSkillsDoc.skills.length) fail("Duplicate skill IDs");
 for(const fw of d.frameworkDoc.frameworkPacks){for(const s of fw.skills??[]) if(!s.startsWith("SKILL-")||!legacySkills.has(s)) fail(`Framework dangling/cross-use skill ${fw.id}:${s}`)}
 const adapters=new Set(d.adaptersDoc.adapters.map(x=>x.id)); if(adapters.size!==d.adaptersDoc.adapters.length) fail("Duplicate tool adapter IDs");
 const agentIds=new Set(d.agentsDoc.agents.map(x=>x.id));
 for(const p of d.toolPolicyDoc.policies){if(!agentIds.has(p.agentId)) fail(`Tool policy unknown agent ${p.agentId}`); for(const a of p.candidateToolAdapterIds??[]) if(!adapters.has(a)) fail(`Tool policy dangling adapter ${p.agentId}:${a}`)}
 const idLists=[
   ["capability",d.capabilitiesDoc.capabilities],["fabric",d.fabricsDoc.fabrics],["binder",d.bindersDoc.binders],["framework",d.frameworkDoc.frameworkPacks]
 ];
 for(const [name,arr] of idLists){const ids=arr.map(x=>x.id); if(!uniq(ids)) fail(`Duplicate ${name} semantic IDs`)}
 return true;
}

validate(base);
let adversarial=0;
const mustReject=(mutate,label)=>{const d=clone(base); mutate(d); let rejected=false; try{validate(d)}catch{rejected=true} if(!rejected) fail(`Adversarial bypass: ${label}`); adversarial++;};
mustReject(d=>d.relDoc.structuralRelations.pop(),"structural coverage missing technology");
mustReject(d=>{const r=d.relDoc.relations.find(x=>x.kind==="ALTERNATIVE_FAMILY"); d.relDoc.relations.push({...r,from:r.to,to:r.from}); d.relDoc.count=d.relDoc.relations.length;},"symmetric alternative duplicate");
mustReject(d=>{d.domainProfiles[1].domainSpecificSeeds=clone(d.domainProfiles[0].domainSpecificSeeds)},"cloned domain specialization");
mustReject(d=>{d.techDoc.technologies[0].knowledgeState="CERTIFIED"},"certified technology without evidence");
mustReject(d=>d.frameworkDoc.frameworkPacks[0].skills.push("SKILL-NOT-REGISTERED"),"framework dangling legacy skill");
mustReject(d=>d.toolPolicyDoc.policies[0].candidateToolAdapterIds.push("adapter-does-not-exist"),"tool policy dangling adapter");
mustReject(d=>{d.capabilitiesDoc.capabilities[1].id=d.capabilitiesDoc.capabilities[0].id},"duplicate capability ID");
console.log(`PASTE3_TECH_DOMAIN_REGISTRY_VALIDATION: PASS technologies=415 structural=415 pairwise=${base.relDoc.relations.length} domains=22 knowledge=415 adversarial=${adversarial}`);
