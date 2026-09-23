// //TR: Bu validator 149 phase contract'ın DAG/title/dependency/wave/lane/critical-path ile birebir uyumunu, phase-specific kabul/failure/artifact/scope/safety alanlarını ve generic placeholder kalmamasını fail-closed doğrular.
import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const idx=read("registries/phase-contracts-index.json");
const graph=read("roadmap/dependency-graph.json");
const waves=read("roadmap/build-waves.json");
const lanes=read("roadmap/parallel-lanes.json");
const critical=read("roadmap/critical-path.json");
const template=read("roadmap/scheduler-state.template.json");
const errors=[];
const expectPhases=[...Array(149).keys()];
const graphMap=new Map(graph.nodes.map(x=>[x.phase,x]));
const indexed=[...idx.contracts].sort((a,b)=>a.phase-b.phase);
if(indexed.length!==149) errors.push(`contract-index-count=${indexed.length}`);
if(graph.nodes.length!==149) errors.push(`graph-node-count=${graph.nodes.length}`);
if(JSON.stringify(indexed.map(x=>x.phase))!==JSON.stringify(expectPhases)) errors.push("contract-index-phase-set-not-0..148");
if(JSON.stringify([...graphMap.keys()].sort((a,b)=>a-b))!==JSON.stringify(expectPhases)) errors.push("graph-phase-set-not-0..148");
const bannedGenericFailure="phase-specific failure case must be added before implementation";
for(const x of indexed){
  if(!fs.existsSync(x.path)){errors.push(`missing-contract:${x.path}`);continue}
  const c=read(x.path),g=graphMap.get(x.phase);
  if(c.schemaVersion!=="3.0.0") errors.push(`phase-${x.phase}:schemaVersion=${c.schemaVersion}`);
  if(c.phase!==x.phase||c.title!==x.title||c.title!==g?.title) errors.push(`phase-${x.phase}:identity-title-mismatch`);
  if(JSON.stringify([...(c.dependsOn??[])].sort((a,b)=>a-b))!==JSON.stringify([...(g?.dependsOn??[])].sort((a,b)=>a-b))) errors.push(`phase-${x.phase}:dependency-mismatch`);
  const mins={entryCriteria:4,requiredDeliverables:5,requiredValidation:6,evidence:7,review:2,exitCriteria:6,requirements:3,invariants:5,phaseSpecificAcceptance:4,mandatoryFailureCases:2,requiredArtifacts:2,allowedPathPrefixes:1,prohibited:4};
  for(const [k,min] of Object.entries(mins)) if(!Array.isArray(c[k])||c[k].length<min) errors.push(`phase-${x.phase}:${k}<${min}`);
  if(!Array.isArray(c.unsupportedCases)) errors.push(`phase-${x.phase}:unsupportedCases-not-array`);
  const specialized=(c.phaseSpecificAcceptance??[]).slice(3);if(!specialized.length)errors.push(`phase-${x.phase}:specialized-acceptance-missing`);
  const normalized=v=>String(v).normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
  for(const k of ["requirements","phaseSpecificAcceptance","mandatoryFailureCases","requiredArtifacts"]){const vals=(c[k]??[]).map(normalized);if(new Set(vals).size!==vals.length)errors.push(`phase-${x.phase}:${k}-duplicate`)}
  if((c.requiredArtifacts??[]).some(v=>normalized(v)==="review result"))errors.push(`phase-${x.phase}:generic-review-result-artifact`);
  if(!(c.requiredArtifacts??[]).some(v=>!/^phase-\d{3}-review-attestation\.json$/i.test(String(v))))errors.push(`phase-${x.phase}:phase-evidence-artifact-missing`);
  const expectedFail=`Phase ${x.phase} mandatory failure-case validation: ${(c.mandatoryFailureCases??[]).join(", ")}`;if(!(c.requiredValidation??[]).includes(expectedFail))errors.push(`phase-${x.phase}:failure-validation-desync`);
  const expectedAcceptance=`Acceptance assertions: ${(c.phaseSpecificAcceptance??[]).join(" | ")}`;if(!(c.requiredValidation??[]).includes(expectedAcceptance))errors.push(`phase-${x.phase}:acceptance-validation-desync`);
  const expectedArtifact=`Phase-specific artifact evidence: ${(c.requiredArtifacts??[]).join(", ")}`;if(!(c.evidence??[]).includes(expectedArtifact))errors.push(`phase-${x.phase}:artifact-evidence-desync`);
  for(const b of ["allowPaidApi","allowProduction","allowRisk5","allowExistingTestAssertionReduction","requiresFrozenMilestoneContract"]) if(typeof c[b]!=="boolean") errors.push(`phase-${x.phase}:${b}-not-boolean`);
  if(c.requiresFrozenMilestoneContract!==true) errors.push(`phase-${x.phase}:frozen-contract-not-required`);
  if(!Number.isInteger(c.riskLevel)||c.riskLevel<0||c.riskLevel>5) errors.push(`phase-${x.phase}:risk-invalid`);
  if(!Number.isInteger(c.maxFilesChanged)||c.maxFilesChanged<1||c.maxFilesChanged>400) errors.push(`phase-${x.phase}:maxFilesChanged-invalid`);
  if((c.mandatoryFailureCases??[]).some(v=>String(v).toLowerCase().includes(bannedGenericFailure))) errors.push(`phase-${x.phase}:generic-failure-placeholder`);
  if(!(c.prohibited??[]).includes("FAKE_PASS")) errors.push(`phase-${x.phase}:FAKE_PASS-not-prohibited`);
  if(!(c.invariants??[]).includes("NO_WEAKENED_CONTROLS")) errors.push(`phase-${x.phase}:control-weakening-invariant-missing`);
}
function exactCoverage(groups,name){
 const flat=groups.flatMap(x=>x.phaseIds); const counts=new Map(); for(const p of flat) counts.set(p,(counts.get(p)??0)+1);
 const missing=expectPhases.filter(p=>!counts.has(p)), dup=[...counts].filter(([,n])=>n!==1).map(([p])=>p), extra=[...counts.keys()].filter(p=>!graphMap.has(p));
 if(missing.length||dup.length||extra.length) errors.push(`${name}-coverage missing=${missing} duplicate=${dup} extra=${extra}`);
}
exactCoverage(waves.waves.filter(x=>x.id!=="BOOTSTRAP_TRUST_KERNEL"),"waves");
exactCoverage(lanes.lanes,"lanes");
const waveIndex=new Map(); waves.waves.forEach((w,i)=>w.phaseIds.forEach(p=>waveIndex.set(p,i)));
for(const n of graph.nodes) for(const dep of n.dependsOn) if((waveIndex.get(dep)??-1)>(waveIndex.get(n.phase)??999)) errors.push(`wave-order-violation:${dep}->${n.phase}`);
for(const [a,b] of critical.phaseIds.slice(0,-1).map((x,i)=>[x,critical.phaseIds[i+1]])) if(!(graphMap.get(b)?.dependsOn??[]).includes(a)) errors.push(`critical-path-edge-invalid:${a}->${b}`);
if(critical.length!==critical.phaseIds.length||critical.phaseIds.length<2) errors.push("critical-path-length-invalid");
const templatePhases=(template.phases??[]).map(x=>x.phase).sort((a,b)=>a-b); if(JSON.stringify(templatePhases)!==JSON.stringify(expectPhases)) errors.push("scheduler-template-phase-set-invalid");
if(errors.length){console.error(errors.join("\n"));process.exit(1)}
console.log(`PHASE_CONTRACT_VALIDATION: PASS count=149 waves=${waves.waves.length-1} lanes=${lanes.lanes.length} criticalPath=${critical.phaseIds.length}`);
