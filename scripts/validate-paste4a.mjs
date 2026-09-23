// //TR: Bu validator Paste 4A için 149 phase DAG'i, 34 post-Phase0 package coverage'ı, deliveryTier construction sırası ve content-bound stable review-basis kimliklerini adversarial olarak doğrular.
import fs from "node:fs";
import {runnablePackages} from "../automation/lib/review-packages.mjs";
import {buildReviewBundle,stableReviewBasisId} from "../automation/lib/review-bundle.mjs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const errors=[],checks={};
const graph=read("roadmap/dependency-graph.json"),packagesDoc=read("roadmap/review-packages.json"),critical=read("roadmap/critical-path.json"),idx=read("registries/phase-contracts-index.json");
const phaseIds=[...Array(149).keys()],postPhase0=[...Array(148)].map((_,i)=>i+1),graphMap=new Map(graph.nodes.map(n=>[n.phase,n]));
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function assert(name,ok,detail=""){checks[name]=!!ok;if(!ok)errors.push(`${name}${detail?`:${detail}`:""}`)}
function cycleNodes(nodes,idOf,depsOf){const map=new Map(nodes.map(x=>[idOf(x),x])),state=new Map(),cycles=[];function visit(id,stack){state.set(id,1);stack.push(id);for(const dep of depsOf(map.get(id))??[]){if(!map.has(dep)){cycles.push(`MISSING:${id}->${dep}`);continue}if(state.get(dep)===1)cycles.push(`${stack.slice(stack.indexOf(dep)).concat(dep).join("->")}`);else if(!state.has(dep))visit(dep,stack)}stack.pop();state.set(id,2)}for(const id of map.keys())if(!state.has(id))visit(id,[]);return cycles}

// 149 canonical phases including Phase0 bootstrap gate.
assert("phase-count-149",graph.nodes.length===149&&idx.contracts.length===149);
assert("phase-set-exact",eq([...graphMap.keys()].sort((a,b)=>a-b),phaseIds));
assert("phase-deps-known",graph.nodes.every(n=>(n.dependsOn??[]).every(d=>graphMap.has(d)&&d!==n.phase)));
assert("phase-dag-acyclic",cycleNodes(graph.nodes,x=>x.phase,x=>x.dependsOn).length===0);
assert("critical-path-declared",critical.phaseIds.length===critical.length&&critical.phaseIds.every(p=>graphMap.get(p)?.priority==="CRITICAL_PATH"));

// Phase0 is an explicit bootstrap/trust gate; coherent review packages cover Phase1-148 exactly once.
const packages=packagesDoc.packages??[],flat=packages.flatMap(p=>p.phaseIds??[]),flatSorted=[...flat].sort((a,b)=>a-b),packageMap=new Map(packages.map(p=>[p.id,p]));
assert("package-count-34",packagesDoc.packageCount===34&&packages.length===34);
assert("post-phase0-count-148",packagesDoc.phaseCount===148&&flat.length===148);
assert("post-phase0-exact-once",new Set(flat).size===148&&eq(flatSorted,postPhase0));
assert("phase0-excluded-from-review-packages",!flat.includes(0));
assert("package-ids-unique",packageMap.size===34);
assert("package-deps-known",packages.every(p=>(p.dependsOnPackages??[]).every(d=>packageMap.has(d)&&d!==p.id)));
assert("package-dag-acyclic",cycleNodes(packages,x=>x.id,x=>x.dependsOnPackages).length===0);
const topo=packagesDoc.topologicalOrder??[],topoPos=new Map(topo.map((id,i)=>[id,i]));
assert("package-topological-order-exact",topo.length===34&&new Set(topo).size===34&&packages.every(p=>topoPos.has(p.id)));
assert("package-topological-order-valid",packages.every(p=>(p.dependsOnPackages??[]).every(d=>(topoPos.get(d)??Infinity)<(topoPos.get(p.id)??-1))));
const phaseToPackage=new Map();for(const p of packages)for(const phase of p.phaseIds)phaseToPackage.set(phase,p.id);
const missingExternal=[];for(const p of packages){const declared=new Set(p.dependsOnPackages??[]),own=new Set(p.phaseIds);for(const phase of p.phaseIds)for(const dep of graphMap.get(phase)?.dependsOn??[]){if(dep===0||own.has(dep))continue;const upstream=phaseToPackage.get(dep);if(upstream&&upstream!==p.id&&!declared.has(upstream))missingExternal.push(`${p.id}:${phase}<-${upstream}:${dep}`)}}
assert("package-deps-cover-phase-deps",missingExternal.length===0,missingExternal.slice(0,4).join(","));

// deliveryTier derives only from construction priority, never reviewProfile.
const expectedTier=p=>{const priorities=new Set(p.phaseIds.map(id=>graphMap.get(id)?.priority));return priorities.has("CRITICAL_PATH")?"CORE":priorities.has("HIGH")?"HIGH":"MEDIUM"};
const tierCounts={CORE:0,HIGH:0,MEDIUM:0};let tierDrift=[];for(const p of packages){if(p.deliveryTier in tierCounts)tierCounts[p.deliveryTier]++;if(p.deliveryTier!==expectedTier(p))tierDrift.push(`${p.id}:${p.deliveryTier}->${expectedTier(p)}`)}
assert("delivery-tier-derived",tierDrift.length===0,tierDrift.slice(0,5).join(","));
assert("delivery-tier-counts",tierCounts.CORE===14&&tierCounts.HIGH===2&&tierCounts.MEDIUM===18,JSON.stringify(tierCounts));

// Adversarial scheduler: reviewProfile cannot outrank deliveryTier.
const mkPkg=(id,phase,deliveryTier,reviewProfile,dependsOnPackages=[])=>({id,phaseIds:[phase],deliveryTier,reviewProfile,dependsOnPackages});
const syntheticPkgs=[mkPkg("MEDIUM-RELEASE",3,"MEDIUM","RELEASE_CRITICAL"),mkPkg("CORE-STANDARD",1,"CORE","STANDARD"),mkPkg("HIGH-RELEASE",2,"HIGH","RELEASE_CRITICAL"),mkPkg("CORE-RELEASE",4,"CORE","RELEASE_CRITICAL")];
const synthetic={doc:{packages:syntheticPkgs},map:new Map(syntheticPkgs.map(x=>[x.id,x]))},syntheticGraph={map:new Map([1,2,3,4].map(phase=>[phase,{phase,dependsOn:[]}]))},syntheticState={phases:[1,2,3,4].map(phase=>({phase,status:"PENDING"}))};
const order=runnablePackages(synthetic,syntheticGraph,syntheticState).map(x=>x.id);
assert("scheduler-delivery-tier-before-review-profile",eq(order,["CORE-RELEASE","CORE-STANDARD","HIGH-RELEASE","MEDIUM-RELEASE"]),order.join(","));
const depPkgs=[mkPkg("A",10,"MEDIUM","STANDARD"),mkPkg("B",11,"CORE","RELEASE_CRITICAL",["A"])],depObj={doc:{packages:depPkgs},map:new Map(depPkgs.map(x=>[x.id,x]))},depGraph={map:new Map([[10,{phase:10,dependsOn:[]}],[11,{phase:11,dependsOn:[]}]])};
let depState={phases:[{phase:10,status:"PENDING"},{phase:11,status:"PENDING"}]};assert("declared-package-dependency-blocks",!runnablePackages(depObj,depGraph,depState).some(x=>x.id==="B"));depState={phases:[{phase:10,status:"COMPLETED"},{phase:11,status:"PENDING"}]};assert("declared-package-dependency-releases",runnablePackages(depObj,depGraph,depState)[0]?.id==="B");

// Stable review basis IDs: content and phase bound, array order independent.
const milestone={id:"PKG-X",phase:42,phaseIds:[42],requirements:["[P042] Alpha requirement","[P042] Beta requirement"],invariants:["NO_FAKE_SUCCESS"],acceptanceCriteria:["[P042] Alpha acceptance","[P042] Beta acceptance"],mandatoryValidation:["node validate"],mandatoryFailureCases:["[P042] Alpha failure","[P042] Beta failure"],requiredArtifacts:["[P042] Alpha artifact","[P042] Beta artifact"],riskLevel:2,reviewProfile:"STANDARD"};
const make=mc=>buildReviewBundle({runId:"R",cycle:1,phase:42,baseCommit:"a".repeat(40),reviewedCommit:"b".repeat(40),milestoneContract:mc,changedFiles:[],validation:{status:"PASS",steps:[]}}).reviewBasis;
const rb1=make(milestone),rb2=make({...milestone,requirements:[...milestone.requirements].reverse(),acceptanceCriteria:[...milestone.acceptanceCriteria].reverse(),mandatoryFailureCases:[...milestone.mandatoryFailureCases].reverse(),requiredArtifacts:[...milestone.requiredArtifacts].reverse()});
const rows=x=>Object.values(x).flat(),byText=x=>new Map(rows(x).map(r=>[r.text,r.id]));const a=byText(rb1),b=byText(rb2);
assert("stable-id-reorder-invariant",[...a].every(([text,id])=>b.get(text)===id));
const original=stableReviewBasisId({text:"[P042] Alpha acceptance",type:"AC",fallbackPhase:42}),whitespace=stableReviewBasisId({text:" [P042]   Alpha   acceptance ",type:"AC",fallbackPhase:42}),changed=stableReviewBasisId({text:"[P042] Alpha acceptance changed",type:"AC",fallbackPhase:42}),otherPhase=stableReviewBasisId({text:"[P043] Alpha acceptance",type:"AC",fallbackPhase:42});
assert("stable-id-normalized-whitespace",original===whitespace);
assert("stable-id-content-change",original!==changed);
assert("stable-id-phase-bound",original!==otherPhase);
assert("stable-id-format",/^P042-AC-[0-9a-f]{16}$/.test(original));
assert("legacy-sequence-basis-id-absent",rows(rb1).every(r=>! /^(REQ|INV|AC|VAL|FAIL|ART)-\d+$/.test(r.id)));

if(errors.length){console.error(errors.join("\n"));process.exit(1)}
console.log(`PASTE4A_VALIDATION: PASS checks=${Object.keys(checks).length} phases=149 packages=34 tiers=${tierCounts.CORE}/${tierCounts.HIGH}/${tierCounts.MEDIUM}`);
