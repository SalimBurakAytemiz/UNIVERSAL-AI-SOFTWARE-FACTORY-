// //TR: Paste 4C current-doc truth, historical authority boundary ve source-count drift kontrollerini fail-closed doğrular.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];
let checks = 0;
const must = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };
const text = p => fs.readFileSync(path.join(root, p), "utf8");
const json = p => JSON.parse(text(p));
const countFiles = (dir, rx) => fs.readdirSync(path.join(root, dir)).filter(x => rx.test(x)).length;

const readme = text("README.md");
const start = text("START-HERE.md");
const status = text("CANONICAL-STATUS.md");
const pack = json("PACK.json");
const progress = json("audit/V6-FULL-SCAN-PROGRESS.json");
const currentAudit = json("audit/CURRENT-AUDIT-STATE.json");
const nextActions = text(".ai/NEXT_ACTIONS.md");
const tech = json("registries/technologies.json");
const skillsV2 = json("registries/skills-v2.json");
const skillsV1 = json("registries/skills.json");
const adapters = json("registries/tool-adapters.json");
const rel = json("registries/technology-relations.json");
const packages = json("roadmap/review-packages.json");

const counts = {
  agents: countFiles("organization/agents", /\.json$/),
  evaluations: countFiles("evaluations/agents", /\.json$/),
  technologies: tech.technologies?.length ?? -1,
  technologyKnowledge: countFiles("knowledge/technologies", /\.json$/),
  domainPacks: countFiles("domain-packs", /\.json$/),
  schemas: countFiles("schemas", /\.schema\.json$/),
  phases: countFiles("roadmap/contracts", /^phase-\d{3}\.json$/),
  packages: packages.packages?.length ?? -1,
  skillsV2: skillsV2.skills?.length ?? -1,
  skillsV1: skillsV1.skills?.length ?? -1,
  adapters: adapters.adapters?.length ?? -1,
  pairwiseRelations: rel.relations?.length ?? -1,
  structuralRelations: rel.structuralRelations?.length ?? -1,
};

must(counts.agents === 363, `agent-count:${counts.agents}`);
must(counts.evaluations === 363, `evaluation-count:${counts.evaluations}`);
must(counts.technologies === 415, `technology-count:${counts.technologies}`);
must(counts.technologyKnowledge === 415, `technology-knowledge-count:${counts.technologyKnowledge}`);
must(counts.domainPacks === 22, `domain-pack-count:${counts.domainPacks}`);
must(counts.schemas === 152, `schema-count:${counts.schemas}`);
must(counts.phases === 149, `phase-count:${counts.phases}`);
must(counts.packages === 34, `package-count:${counts.packages}`);
must(counts.skillsV2 === 425, `skill-v2-count:${counts.skillsV2}`);
must(counts.skillsV1 === 1186, `skill-v1-count:${counts.skillsV1}`);
must(counts.adapters === 194, `adapter-count:${counts.adapters}`);
must(counts.pairwiseRelations === 117, `pairwise-relation-count:${counts.pairwiseRelations}`);
must(counts.structuralRelations === 415, `structural-relation-count:${counts.structuralRelations}`);

for (const [label, value] of Object.entries({
  "363 canonical agent": counts.agents,
  "425 canonical V2 runtime skill": counts.skillsV2,
  "1186 legacy/reference V1 skill": counts.skillsV1,
  "415 seed technology profile": counts.technologies,
  "117 deduplicated pairwise relation": counts.pairwiseRelations,
  "415/415 structural technology coverage": counts.structuralRelations,
  "194 registered tool/provider adapter": counts.adapters,
  "22 domain pack": counts.domainPacks,
  "152 canonical schema": counts.schemas,
  "149 acceptance phase": counts.phases,
  "34 coherent review package": counts.packages,
})) must(readme.includes(label), `readme-count-fact-missing:${label}:${value}`);

must(readme.includes("SOURCE_LEVEL_CLOSURE = FALSE"), "readme-source-closure-not-false");
must(readme.includes("FINAL_TRUST_ROOT_SEAL = STALE_PENDING_FINAL_RESEAL"), "readme-trust-seal-truth-missing");
must(readme.includes("TARGET_MACHINE_PHASE0 = PENDING"), "readme-target-phase0-truth-missing");
must(start.includes("final ZIP veya installation-ready release değildir"), "start-here-release-warning-missing");
must(start.includes("TARGET_MACHINE_PHASE0 = PENDING"), "start-here-target-pending-missing");
must(status.includes("SOURCE_LEVEL_CLOSURE = FALSE"), "status-source-closure-not-false");
must(status.includes("FINAL_TRUST_ROOT_SEAL = STALE_PENDING_FINAL_RESEAL"), "status-trust-seal-truth-missing");
must(status.includes("TARGET_MACHINE_PHASE0 = PENDING"), "status-target-phase0-truth-missing");

must(pack.name === "UNIVERSAL-AI-SOFTWARE-COMPANY-OS-V6-AUDIT-REMEDIATION-CANDIDATE", "pack-name-not-v6-candidate");
must(pack.status === "V6_AUDIT_REMEDIATION_IN_PROGRESS", "pack-status-not-in-progress");
must(pack.sourceStaticClosure === false, "pack-source-closure-must-be-false");
must(pack.mechanicalClosure === "IN_PROGRESS_NOT_FINAL", "pack-mechanical-closure-overclaim");
must(["NOT_FINAL_PASTE4_IN_PROGRESS","PASTE4_SOURCE_COMPLETE_FINAL_SWEEP_PENDING","DEPENDENCY_FREE_SOURCE_REGRESSION_COMPLETE_DEPENDENCY_GATES_PENDING"].includes(pack.staticClosureAudit), "pack-static-audit-overclaim");
must(pack.targetMachinePhase0 === "PENDING", "pack-target-phase0-overclaim");
must(pack.finalTrustRootSeal === "STALE_PENDING_FINAL_RESEAL", "pack-final-seal-overclaim");
must(pack.finalZip === "NOT_DONE", "pack-final-zip-overclaim");
must(pack.roadmapPhases === counts.phases, "pack-phase-count-drift");
must(pack.roadmapReviewPackages === counts.packages, "pack-package-count-drift");
must(pack.technologies === counts.technologies, "pack-technology-count-drift");
must(pack.technologyRelations === counts.pairwiseRelations, "pack-pairwise-relation-count-drift");
must(pack.technologyStructuralRelations === counts.structuralRelations, "pack-structural-relation-count-drift");
must(pack.engineeringSkillsV2 === counts.skillsV2, "pack-skill-v2-count-drift");
must(pack.legacySkillRegistryCount === counts.skillsV1, "pack-skill-v1-count-drift");
must(pack.toolAdapters === counts.adapters, "pack-adapter-count-drift");

const activeSurfaces = ["README.md", "START-HERE.md", "CANONICAL-STATUS.md", "PACK.json"];
const stalePatterns = [
  /MECHANICALLY_CLOSED_V3_SOURCE_AUDITED_TARGET_PHASE0_PENDING/i,
  /PASS_AFTER_V3_REAUDIT/i,
  /audit\/V3-RE-AUDIT-RESULTS\.md/i,
  /Mechanically Closed V3 Canonical Starter/i,
  /# Start Here — V3/i,
];
for (const f of activeSurfaces) {
  const t = text(f);
  for (const rx of stalePatterns) must(!rx.test(t), `active-doc-stale-claim:${f}:${rx}`);
}

const historical = {
  "FULL-RED-TEAM-GAP-AUDIT-TR.md":"HISTORICAL_AUDIT_NOT_CURRENT_AUTHORITY",
  "TECHNICAL-COMPETENCY-CLOSURE-AUDIT-TR.md":"HISTORICAL_AUDIT_NOT_CURRENT_AUTHORITY",
  "V3-HARDENING-ADDITIONS.md":"HISTORICAL_HARDENING_NOTE_NOT_CURRENT_AUTHORITY",
  "V2-RE-AUDIT-NEW-GAPS-TR.md":"HISTORICAL_AUDIT_NOT_CURRENT_AUTHORITY",
  "MECHANICAL-CLOSURE-FIX-LEDGER.md":"HISTORICAL_FIX_LEDGER_NOT_CURRENT_AUTHORITY",
  "MECHANICAL-CLOSURE-RED-TEAM-AUDIT-TR.md":"HISTORICAL_AUDIT_NOT_CURRENT_AUTHORITY",
  "V3-RE-AUDIT-RESULTS-TR.md":"HISTORICAL_AUDIT_NOT_CURRENT_AUTHORITY",
  "ULTIMATE-ARCHITECTURE-CLOSURE-SPEC-TR.md":"REFERENCE_SPECIFICATION_NOT_CURRENT_STATUS_EVIDENCE",
};
for (const [f, marker] of Object.entries(historical)) {
  const head = text(`docs/closure/${f}`).split(/\r?\n/).slice(0, 8).join("\n");
  must(head.includes(marker), `historical-authority-banner-missing:${f}`);
}
must(text("docs/closure/README.md").includes("Current authority"), "closure-authority-index-missing");

const repoIntel = text("docs/architecture/REPOSITORY-INTELLIGENCE.md");
must(repoIntel.includes("smallest sufficient context, not the whole repository by default"), "bounded-context-doc-policy-missing");

// Current progress is the machine-readable authority for Paste segment status.
must(progress.truth?.SOURCE_LEVEL_CLOSURE === false, "progress-source-closure-overclaim");
must(progress.truth?.TARGET_MACHINE_PHASE0 === "PENDING", "progress-target-phase0-overclaim");
must(progress.truth?.FINAL_TRUST_ROOT_SEAL === "STALE_PENDING_FINAL_RESEAL", "progress-trust-seal-overclaim");
must(progress.paste4?.segments?.["4A"] === "COMPLETE_SOURCE", "progress-4a-not-complete");
must(progress.paste4?.segments?.["4B"] === "COMPLETE_SOURCE", "progress-4b-not-complete");
must(progress.fullSystemReaudit?.status === "COMPLETE_DEPENDENCY_FREE_PENDING_DEPENDENCY_AWARE", "progress-full-system-reaudit-status-stale");
must(progress.nextScope === "ENVIRONMENT_GATE_NODE24_NPM11_REGISTRY_REVIEWED_LOCK_DEPENDENCY_AWARE_VALIDATION", "progress-next-scope-stale");
must(currentAudit.activeScope === "ENVIRONMENT_GATE_NODE24_NPM11_REGISTRY_REVIEWED_LOCK_DEPENDENCY_AWARE_VALIDATION", "current-audit-active-scope-stale");
must(currentAudit.completedSourceScopes?.includes("FULL_SYSTEM_REAUDIT_DOCS_STATE_CURRENT_TRUTH_FINAL_SWEEP"), "current-audit-completed-scopes-stale");
must(nextActions.includes("ENVIRONMENT_GATE_NODE24_NPM11_REGISTRY_REVIEWED_LOCK_DEPENDENCY_AWARE_VALIDATION"), "next-actions-scope-stale");
must(!nextActions.includes("Continue full-system deep re-audit"), "next-actions-old-reaudit-instruction-stale");
must(["NEXT","IN_PROGRESS","COMPLETE_SOURCE"].includes(progress.paste4?.segments?.["4C"]), "progress-4c-invalid-state");
must(["PENDING","NEXT","IN_PROGRESS","COMPLETE_SOURCE"].includes(progress.paste4?.segments?.["4D"]), "progress-4d-invalid-state");

if (errors.length) {
  console.error(`PASTE4C_DOC_TRUTH_VALIDATION: FAIL checks=${checks} errors=${errors.length}`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`PASTE4C_DOC_TRUTH_VALIDATION: PASS checks=${checks}`);
