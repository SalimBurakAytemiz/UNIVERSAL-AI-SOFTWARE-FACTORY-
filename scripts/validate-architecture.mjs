// //TR: Bu script fresh starter'ın Mission, repository intelligence, polyglot, browser/mobile/device, assurance, game, global communications ve extension mimarisi gibi kritik canonical belgeleri içerdiğini doğrular.
import fs from "node:fs";
const required=[
"CANONICAL-STATUS.md","ARCHITECTURE-FREEZE.md","docs/architecture/AGENT-COMPETENCY-MODEL-V2.md","docs/architecture/TECHNOLOGY-KNOWLEDGE-GRAPH.md","docs/architecture/SEMANTIC-VALIDATION.md",
"ARCHITECTURE-CONSTITUTION.md","COMPLETENESS-BASELINE.md","ROADMAP.md","AGENTS.md","CLAUDE.md","REVIEWER-RULES.md",
"docs/architecture/MISSION-OS.md","docs/architecture/EXTENSION-ARCHITECTURE.md","docs/architecture/REPOSITORY-INTELLIGENCE.md",
"docs/architecture/POLYGLOT-BUILD-FABRIC.md","docs/architecture/BROWSER-EXECUTION-LAB.md","docs/architecture/MOBILE-DEVICE-LAB.md",
"docs/architecture/RESOURCE-SCHEDULER.md","docs/architecture/TECHNICAL-COMPETENCY-FABRIC.md","docs/architecture/TECHNOLOGY-DECISION-ENGINE.md","docs/architecture/ASSURANCE.md","docs/architecture/GAME-INTELLIGENCE.md",
"docs/architecture/GLOBAL-COMMUNICATIONS.md","docs/architecture/OMNIROUTE-MODEL-FABRIC.md",
"docs/governance/AUTHORIZED-ASSESSMENT.md","docs/governance/DATA-ROUTING.md","docs/governance/CLEAN-ROOM-RESEARCH.md"
];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length) throw new Error(`Missing canonical files: ${missing.join(", ")}`);
console.log("ARCHITECTURE_VALIDATION: PASS");
