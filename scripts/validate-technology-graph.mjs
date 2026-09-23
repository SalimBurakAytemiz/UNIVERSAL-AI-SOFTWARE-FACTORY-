// //TR: Technology graph validatorı 415 canonical technology ID, exact group membership, pairwise relation integrity, 415/415 structural discovery coverage ve certified-evidence fail-closed kuralını doğrular.
import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const t=read("registries/technologies.json"), groups=read("registries/technology-groups.json"), rel=read("registries/technology-relations.json"), policy=read("registries/technology-certification-policy.json");
if(t.technologies.length!==415) throw new Error(`Technology universe must be 415, got ${t.technologies.length}`);
const ids=new Set(t.technologies.map(x=>x.id)); if(ids.size!==415) throw new Error("Duplicate technology IDs");
const gm=new Map(groups.groups.map(g=>[g.id,new Set(g.technologyIds)]));
for(const x of t.technologies){if(!gm.has(x.group)||!gm.get(x.group).has(x.id))throw new Error(`Technology group mismatch ${x.id}`)}
const sr=rel.structuralRelations??[]; if(sr.length!==415||new Set(sr.map(x=>x.technologyId)).size!==415)throw new Error("Technology structural coverage must be 415/415");
for(const r of sr){const x=t.technologies.find(y=>y.id===r.technologyId);if(!x||r.kind!=="GROUP_MEMBERSHIP"||r.groupId!==x.group||r.coverageLevel!=="SEED_STRUCTURAL_DISCOVERY")throw new Error(`Bad structural relation ${r.technologyId}`)}
const pairCoverage=new Set(),exact=new Set(),alt=new Set();for(const r of rel.relations){if(!ids.has(r.from)||!ids.has(r.to)||r.from===r.to)throw new Error(`Bad pairwise relation ${r.from}->${r.to}`);const k=`${r.from}|${r.to}|${r.kind}`;if(exact.has(k))throw new Error(`Duplicate relation ${k}`);exact.add(k);pairCoverage.add(r.from);pairCoverage.add(r.to);if(r.kind==="ALTERNATIVE_FAMILY"){const u=[r.from,r.to].sort().join("|");if(alt.has(u))throw new Error(`Symmetric duplicate alternative relation ${u}`);alt.add(u)}}
if(rel.count!==rel.relations.length)throw new Error("Technology relation count metadata drift");
for(const x of t.technologies)if(x.knowledgeState===policy.certifiedState){const e=x.certificationEvidence;if(!e)throw new Error(`Certified technology missing evidence ${x.id}`);for(const k of policy.requiredCertificationEvidence)if(!e[k]||(Array.isArray(e[k])&&e[k].length===0))throw new Error(`Certified technology missing ${k}: ${x.id}`);if(!pairCoverage.has(x.id))throw new Error(`Certified technology semantic orphan ${x.id}`)}
console.log(`TECHNOLOGY_GRAPH_VALIDATION: PASS technologies=415 structural=415 pairwise=${rel.relations.length} groups=${groups.groups.length}`);
