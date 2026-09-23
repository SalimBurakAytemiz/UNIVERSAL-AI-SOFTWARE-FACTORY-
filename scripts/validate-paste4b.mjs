// //TR: Paste 4B validator phase-specific requirement/acceptance/failure/artifact traceability'sini, contamination temizliğini ve frozen package traceability bağını fail-closed doğrular.
import fs from "node:fs";
import {freezeMilestoneContract,freezeMilestonePackage} from "../automation/lib/milestone-contract.mjs";

const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const norm=v=>String(v??"").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
const phases=[...Array(149).keys()].map(p=>read(`roadmap/contracts/phase-${String(p).padStart(3,"0")}.json`));
const packages=read("roadmap/review-packages.json").packages;
const errors=[];let checks=0;
const ok=(name,cond)=>{checks++;if(!cond)errors.push(name)};

const allowedRepeatedAcceptance=new Map([
 [norm("Adapter/plugin permissions, provenance, dependency risk, sandbox/health/certification and revocation are enforced."),[42,56,60]],
 [norm("Model/report/log/export egress passes classification/redaction policy with negative leakage tests."),[6,133,134]],
 [norm("Backup is not PASS until restore/reconciliation proves recovery; migration rollback/irreversibility is explicit."),[7,71]],
 [norm("Build/deploy/IaC drift, security, rollback and resource health are tested."),[73,90]],
 [norm("Certification requires golden+hidden holdout+independent review and becomes stale on relevant dependency/source change."),[14,136]],
 [norm("Cross-customer/authority/DLP adversarial acceptance suite passes with fail-closed behavior."),[8,134]],
 [norm("Customer boundaries, retention/legal hold and offboarding export/delete paths are tested."),[8,134]],
 [norm("Detection->stabilization->timeline->root cause->remediation->validation/postmortem is executable."),[101,145]],
 [norm("Engine-specific consistency/index/query/TTL/cache/search semantics and failure modes are verified."),[70,111]],
 [norm("Exclusive resources cannot double-lease; stale leases recover and unhealthy resources quarantine."),[25,39]],
 [norm("Firmware/toolchain/device/protocol/HIL/OTA/recovery/security paths are evidence-linked to real/simulated hardware."),[122,142]],
 [norm("Locale/RTL/text expansion/timezone/DST/formatting paths are tested."),[84,131]],
 [norm("macOS worker/iOS device or simulator lease, signing/install/test/log/evidence/cleanup is end-to-end."),[51,59]],
 [norm("Public regression and private/rotating holdout detect contamination/memorization and preserve hidden evaluation integrity."),[14,136]],
 [norm("Release manifest/health/canary/rollback are executable and failed rollout returns to known-good state."),[102,148]],
 [norm("RPO/RTO are measured by restore drill, not documentation; immutable/offline recovery paths are considered."),[103,145]],
 [norm("Workload model and abort guards are explicit; latency/throughput/error/saturation and system telemetry correlate."),[95,144]]
]);

function validatePhase(c){
 const local=[];const p=c.phase;
 const special=(c.phaseSpecificAcceptance??[]).slice(3);
 if(!special.length)local.push("specialized-acceptance-missing");
 for(const key of ["requirements","phaseSpecificAcceptance","mandatoryFailureCases","requiredArtifacts"]){const vals=(c[key]??[]).map(norm);if(new Set(vals).size!==vals.length)local.push(`${key}-duplicate`)}
 if((c.requiredArtifacts??[]).some(x=>norm(x)==="review result"))local.push("generic-review-result-artifact");
 if(!(c.requiredArtifacts??[]).some(x=>!/^phase-\d{3}-review-attestation\.json$/i.test(String(x))))local.push("phase-evidence-artifact-missing");
 const fail=`Phase ${p} mandatory failure-case validation: ${(c.mandatoryFailureCases??[]).join(", ")}`;
 const acc=`Acceptance assertions: ${(c.phaseSpecificAcceptance??[]).join(" | ")}`;
 const art=`Phase-specific artifact evidence: ${(c.requiredArtifacts??[]).join(", ")}`;
 if(!(c.requiredValidation??[]).includes(fail))local.push("failure-validation-desync");
 if(!(c.requiredValidation??[]).includes(acc))local.push("acceptance-validation-desync");
 if(!(c.evidence??[]).includes(art))local.push("artifact-evidence-desync");
 if(!Array.isArray(c.unsupportedCases))local.push("unsupported-cases-not-explicit");
 return local;
}

for(const c of phases){for(const e of validatePhase(c))errors.push(`phase-${c.phase}:${e}`)}
ok("phase-count-149",phases.length===149);

const owners=new Map();
for(const c of phases)for(const text of c.phaseSpecificAcceptance.slice(3)){const n=norm(text);const a=owners.get(n)??[];a.push(c.phase);owners.set(n,a)}
for(const [text,ids] of owners){if(ids.length<2)continue;const allowed=allowedRepeatedAcceptance.get(text);if(!allowed||JSON.stringify(ids)!==JSON.stringify(allowed))errors.push(`unexpected-repeated-acceptance:${ids.join(",")}:${text}`)}
for(const [text,ids] of allowedRepeatedAcceptance){const actual=owners.get(text)??[];ok(`allowed-repeat-${ids.join("-")}`,JSON.stringify(actual)===JSON.stringify(ids))}

const contaminationPhrases=[
 [20,"RPO/RTO are measured by restore drill"],[24,"Protocol-specific schema"],[24,"RPO/RTO are measured by restore drill"],
 [31,"Dependencies/assets carry SBOM"],[33,"Engine-specific consistency"],[33,"Cross-customer/authority/DLP"],
 [51,"RPO/RTO are measured by restore drill"],[57,"macOS worker/iOS"],[57,"RPO/RTO are measured by restore drill"],
 [58,"RPO/RTO are measured by restore drill"],[59,"Physical/emulated Android"],[71,"Invoice/payment/reconciliation"],
 [84,"Language routing, glossary/TM"],[94,"Protocol-specific schema"],[102,"Exclusive resources cannot double-lease"],
 [104,"RPO/RTO are measured by restore drill"],[127,"Backup is not PASS"],[148,"Exclusive resources cannot double-lease"]
];
for(const [p,fragment] of contaminationPhrases){const c=phases[p];ok(`contamination-removed-p${p}-${fragment}`,!(c.phaseSpecificAcceptance??[]).some(x=>x.includes(fragment)))}

const protectedPolicy={exactPaths:[],protectedPrefixes:[]};
for(const c of phases){
 const frozen=freezeMilestoneContract({phaseContract:structuredClone(c),protectedPolicy});const tr=frozen.phaseTraceability?.[0];
 ok(`trace-phase-${c.phase}`,tr?.phase===c.phase);
 ok(`trace-requirement-${c.phase}`,tr?.requirement===c.requirements[0]);
 ok(`trace-acceptance-${c.phase}`,JSON.stringify(tr?.acceptanceCriteria)===JSON.stringify(c.phaseSpecificAcceptance.slice(3)));
 ok(`trace-failures-${c.phase}`,JSON.stringify(tr?.mandatoryFailureCases)===JSON.stringify(c.mandatoryFailureCases));
 ok(`trace-artifacts-${c.phase}`,JSON.stringify(tr?.requiredArtifacts)===JSON.stringify(c.requiredArtifacts));
 ok(`trace-schema-${c.phase}`,frozen.schemaVersion==="1.2.0");
}
const byPhase=new Map(phases.map(c=>[c.phase,c]));
for(const pkg of packages){const pcs=pkg.phaseIds.map(p=>byPhase.get(p));const frozen=freezeMilestonePackage({packageDef:pkg,phaseContracts:pcs,protectedPolicy});const ids=frozen.phaseTraceability.map(x=>x.phase);ok(`package-trace-${pkg.id}`,JSON.stringify(ids)===JSON.stringify(pkg.phaseIds));}

// Adversarial mutations prove the validator rejects the principal 4B bypasses.
const sample=structuredClone(phases[20]);sample.phaseSpecificAcceptance=sample.phaseSpecificAcceptance.slice(0,3);ok("adversarial-missing-specialized-rejected",validatePhase(sample).includes("specialized-acceptance-missing"));
const sample2=structuredClone(phases[20]);sample2.requiredArtifacts[0]="review result";ok("adversarial-generic-artifact-rejected",validatePhase(sample2).includes("generic-review-result-artifact"));
const sample3=structuredClone(phases[20]);sample3.requiredValidation=sample3.requiredValidation.filter(x=>!x.startsWith("Acceptance assertions:"));ok("adversarial-acceptance-desync-rejected",validatePhase(sample3).includes("acceptance-validation-desync"));
const sample4=structuredClone(phases[20]);sample4.evidence=sample4.evidence.filter(x=>!x.startsWith("Phase-specific artifact evidence:"));ok("adversarial-artifact-desync-rejected",validatePhase(sample4).includes("artifact-evidence-desync"));

if(errors.length){console.error(errors.join("\n"));process.exit(1)}
console.log(`PASTE4B_VALIDATION: PASS checks=${checks} phases=${phases.length} packages=${packages.length}`);
