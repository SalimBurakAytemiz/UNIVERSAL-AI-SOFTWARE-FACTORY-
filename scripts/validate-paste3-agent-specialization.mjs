// //TR: Paste 3A validatorı 363 canonical agent genome, role overlay, role-specific evaluation, V2 skill authority ve compact context index coherence'ını adversarial olarak doğrular.
import fs from "node:fs";
import path from "node:path";

const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const clone = x => structuredClone(x);
const fail = m => { throw new Error(m); };
const sameSet = (a,b) => a.size===b.size && [...a].every(x=>b.has(x));
const unique = a => new Set(a).size===a.length;

const agents = read("registries/agents.json").agents;
const competency = read("registries/agent-competency-v2.json").agents;
const matrix = read("registries/agent-skill-matrix.json").agents;
const semantic = read("registries/agent-semantic-requirements.json").requirements;
const overlaysDoc = read("registries/agent-role-overlays.json");
const contextDoc = read("registries/agent-context-index-v2.json");
const skillAuthority = read("registries/skill-ontology-authority.json");
const skillsV2Doc = read("registries/skills-v2.json");
const skillsV1Doc = read("registries/skills.json");
const foundations = read("registries/engineering-foundations.json").foundations;
const technologies = new Set(read("registries/technologies.json").technologies.map(x=>x.id));
const v2Skills = new Set(skillsV2Doc.skills.map(x=>x.id));
const requiredTechnicalFoundations = new Set(foundations.filter(x=>x.requiredForTechnicalAgents).map(x=>x.id));

const genomeFiles = fs.readdirSync("organization/agents").filter(x=>x.endsWith(".json")).map(x=>`organization/agents/${x}`);
const genomes = genomeFiles.map(read);
const evalFiles = fs.readdirSync("evaluations/agents").filter(x=>x.endsWith(".json")).map(x=>`evaluations/agents/${x}`);
const evaluations = evalFiles.map(read);

function validate(data){
  const {agents,competency,matrix,semantic,overlaysDoc,contextDoc,genomes,evaluations,skillsV2Doc,skillsV1Doc,skillAuthority}=data;
  for(const [name,arr] of Object.entries({agents,competency,matrix,semantic,genomes,evaluations,overlays:overlaysDoc.overlays,contexts:contextDoc.agents}))
    if(arr.length!==363) fail(`${name} expected 363 got ${arr.length}`);
  const agentIds=new Set(agents.map(x=>x.id));
  if(agentIds.size!==363) fail("Duplicate agent IDs");
  for(const [name,arr,key] of [["competency",competency,"agentId"],["matrix",matrix,"agentId"],["semantic",semantic,"agentId"],["genomes",genomes,"agentId"],["evaluations",evaluations,"agentId"],["overlays",overlaysDoc.overlays,"agentId"],["contexts",contextDoc.agents,"agentId"]]){
    const ids=new Set(arr.map(x=>x[key])); if(!sameSet(agentIds,ids)) fail(`${name} ID set mismatch`);
  }
  if(skillsV2Doc.authority!=="CANONICAL_RUNTIME"||skillsV2Doc.idPrefix!=="SK2-") fail("V2 skill authority invalid");
  if(skillsV1Doc.authority!=="LEGACY_REFERENCE_ONLY"||skillsV1Doc.idPrefix!=="SKILL-") fail("V1 skill authority invalid");
  if(skillAuthority.canonicalRuntime?.registry!=="registries/skills-v2.json"||skillAuthority.canonicalRuntime?.prefix!=="SK2-") fail("Canonical skill authority contract invalid");
  if(skillAuthority.legacyReferenceOnly?.registry!=="registries/skills.json"||skillAuthority.legacyReferenceOnly?.prefix!=="SKILL-") fail("Legacy skill authority contract invalid");
  if(contextDoc.authority!=="DISCOVERY_INDEX_ONLY") fail("Context index must not become source-of-truth");

  const cm=new Map(competency.map(x=>[x.agentId,x]));
  const mm=new Map(matrix.map(x=>[x.agentId,x]));
  const sm=new Map(semantic.map(x=>[x.agentId,x]));
  const gm=new Map(genomes.map(x=>[x.agentId,x]));
  const em=new Map(evaluations.map(x=>[x.agentId,x]));
  const om=new Map(overlaysDoc.overlays.map(x=>[x.agentId,x]));
  const xm=new Map(contextDoc.agents.map(x=>[x.agentId,x]));
  if(om.size!==363||xm.size!==363) fail("Duplicate overlay/context agent IDs");
  const overlayIds=overlaysDoc.overlays.map(x=>x.id); if(!unique(overlayIds)) fail("Duplicate role overlay IDs");
  const objectives=overlaysDoc.overlays.map(x=>x.roleObjective); if(!unique(objectives)) fail("Role overlay objectives are cloned/non-specific");

  for(const a of agents){
    const id=a.id, c=cm.get(id), m=mm.get(id), q=sm.get(id), g=gm.get(id), e=em.get(id), o=om.get(id), x=xm.get(id);
    if(!c||!m||!q||!g||!e||!o||!x) fail(`Missing cross-file agent ${id}`);
    const overlayRef=`registries/agent-role-overlays.json#ROLE-OVERLAY-${id}`;
    if(g.specializationRef!==overlayRef||c.roleOverlayRef!==overlayRef||m.roleOverlayRef!==overlayRef||e.roleOverlayRef!==overlayRef||x.specializationRef!==overlayRef) fail(`Overlay ref mismatch ${id}`);
    if(o.id!==`ROLE-OVERLAY-${id}`||o.sourceGenomePath!==genomeFiles.find(p=>read(p).agentId===id)||o.evaluationContractPath!==`evaluations/agents/${id}.json`) fail(`Overlay source binding mismatch ${id}`);
    if(o.sharedFoundationRef!=="registries/engineering-foundations.json"||o.universalCompanyLiteracyRequired!==true||c.universalCompanyLiteracy!==true) fail(`Shared foundation/literacy missing ${id}`);

    const gs=g.skills?.required??[];
    const gp=g.technology?.primaryMastery??[];
    const gc=g.technology?.comparativeDecision??[];
    if(g.skills?.ontologyVersion!=="2.0.0"||c.skillOntologyVersion!=="2.0.0"||c.legacySkillFieldsDeprecated!==true) fail(`Skill ontology metadata invalid ${id}`);
    for(const s of [...gs,...(c.requiredSkillIdsV2??[]),...(m.requiredSkillIds??[]),...(e.requiredSkillIds??[]),...(o.roleSpecificSkillIds??[]),...(x.skillHints??[])]){
      if(typeof s!=="string"||!s.startsWith("SK2-")||!v2Skills.has(s)) fail(`Runtime skill cross-use/dangling ${id}:${s}`);
    }
    if(!unique(gs)||!unique(gp)||!unique(gc)) fail(`Duplicate genome refs ${id}`);
    if(gp.some(t=>gc.includes(t))||c.primaryTechnologyIds.some(t=>(c.comparisonTechnologyIds??[]).includes(t))||m.primaryTechnologyIds.some(t=>(m.comparisonTechnologyIds??[]).includes(t))) fail(`Primary/comparison overlap ${id}`);
    for(const t of [...gp,...gc,...(e.primaryTechnologyIds??[]),...(o.primaryTechnologyIds??[]),...(x.primaryTechnologyIds??[])]) if(!technologies.has(t)) fail(`Unknown technology ${id}:${t}`);
    for(const req of q.requiredPrimaryTechnologyIds??[]) if(!gp.includes(req)||!c.primaryTechnologyIds.includes(req)||!m.primaryTechnologyIds.includes(req)) fail(`Missing semantic required primary tech ${id}:${req}`);
    if(q.technicalAgent&&!q.technologyAgnosticAllowed&&gp.length<q.minimumPrimaryTechnologyCount) fail(`Technical agent primary technology minimum ${id}`);
    if(g.technicalAgent){ for(const f of requiredTechnicalFoundations) if(!(g.engineeringFoundationIds??[]).includes(f)) fail(`Technical foundation missing ${id}:${f}`); }

    if(!Array.isArray(e.goldenTasks)||e.goldenTasks.length<1||!Array.isArray(e.hiddenHoldoutTasks)||e.hiddenHoldoutTasks.length<1) fail(`Generic evaluation placeholder ${id}`);
    const gt=e.goldenTasks[0], ht=e.hiddenHoldoutTasks[0];
    if(gt.id!==`${id}-GOLDEN-ROLE-CONTRACT`||ht.id!==`${id}-HOLDOUT-ROLE-CONTRACT`) fail(`Evaluation task identity mismatch ${id}`);
    if(!String(gt.objective).includes(g.name)||!String(ht.objective).includes(g.name)) fail(`Evaluation objective not role-specific ${id}`);
    for(const s of gt.requiredSkillIds??[]) if(!gs.includes(s)) fail(`Evaluation invented skill ${id}:${s}`);
    for(const t of gt.requiredTechnologyIds??[]) if(!gp.includes(t)) fail(`Evaluation invented technology ${id}:${t}`);
    if(e.state!=="NOT_EVALUATED") fail(`Evaluation must remain NOT_EVALUATED ${id}`);

    if((o.roleSpecificSkillIds??[]).some(s=>!gs.includes(s))) fail(`Overlay invented skill ${id}`);
    if((o.primaryTechnologyIds??[]).some(t=>!gp.includes(t))) fail(`Overlay invented tech ${id}`);
    if(o.assignmentRule!=="REFERENCE_EXISTING_CANONICAL_ROLE_PROFILE_ONLY_NO_RARITY_INFERENCE") fail(`Overlay assignment rule invalid ${id}`);
    if((x.skillHints??[]).length>6||(x.primaryTechnologyIds??[]).length>6||(x.reviewChainAgentIds??[]).length>4||(x.competencyFocus??[]).length>4) fail(`Context index not bounded ${id}`);
    if("requiredSkillIds" in x||"technologyDepthProfiles" in x||"decisionBoundary" in x) fail(`Context index contains full source-of-truth payload ${id}`);
  }
  return true;
}

const base={agents,competency,matrix,semantic,overlaysDoc,contextDoc,genomes,evaluations,skillsV2Doc,skillsV1Doc,skillAuthority};
validate(base);
let adversarial=0;
const mustReject=(mutate,label)=>{ const d=clone(base); mutate(d); let rejected=false; try{validate(d)}catch{rejected=true} if(!rejected) fail(`Adversarial bypass: ${label}`); adversarial++; };
mustReject(d=>d.overlaysDoc.overlays[0].roleSpecificSkillIds.push("SK2-DOES-NOT-EXIST"),"overlay invented skill");
mustReject(d=>d.evaluations[0].goldenTasks="GENERATE_FROM_ROLE_AND_MISSION","evaluation placeholder");
mustReject(d=>d.genomes.find(x=>x.agentId==="030").technology.comparativeDecision.push("TECH-REACT"),"primary comparison overlap");
mustReject(d=>d.contextDoc.agents[0].skillHints=Array(7).fill("SK2-BUSINESS_MODEL_ANALYSIS"),"context unbounded");
mustReject(d=>d.matrix[0].requiredSkillIds[0]="SKILL-LEGACY-RUNTIME-LEAK","legacy skill runtime leak");
mustReject(d=>{const q=d.semantic.find(x=>(x.requiredPrimaryTechnologyIds??[]).length); if(q){const g=d.genomes.find(x=>x.agentId===q.agentId); g.technology.primaryMastery=g.technology.primaryMastery.filter(x=>x!==q.requiredPrimaryTechnologyIds[0]);}},"semantic required primary technology");
console.log(`PASTE3_AGENT_SPECIALIZATION_VALIDATION: PASS agents=363 overlays=363 evaluations=363 context=363 adversarial=${adversarial}`);
