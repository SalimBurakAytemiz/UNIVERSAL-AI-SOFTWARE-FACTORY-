//TR: Bu validator recovery checklist'teki 34 Paste 2 kontrolünün source-level kanıt zincirini tek kapıda doğrular; dependency/target ortamı bekleyen gate'leri sahte PASS yapmaz.
import fs from "node:fs";
import cp from "node:child_process";

const validators = [
  ["PASTE2A", "scripts/v6-paste2a-selftest.mjs", [1,2,3,4,5]],
  ["PASTE2B", "scripts/v6-paste2b-selftest.mjs", [6,7,8,9]],
  ["PASTE2C", "scripts/v6-paste2c-selftest.mjs", [10,11,12,13]],
  ["PASTE2D", "scripts/v6-paste2d-selftest.mjs", [14,15,16,17,18,19,20,21]],
  ["PASTE2E", "scripts/v6-paste2e-selftest.mjs", [22,23,24]],
  ["PASTE2F", "scripts/v6-paste2f-selftest.mjs", [25,26,27]],
  ["PASTE2G", "scripts/validate-runtime-contracts.mjs", [28]],
  ["PASTE2H", "scripts/validate-paste2h-runtime-release.mjs", [29,30,31]],
  ["PASTE2I", "scripts/validate-runtime-resilience.mjs", [32,33,34]],
  ["SCHEMA_CATALOG", "scripts/validate-schema-catalog.mjs", []],
  ["SCHEMA_STRICTNESS", "scripts/validate-schema-strictness.mjs", []],
  ["MECHANICAL_CLOSURE", "scripts/validate-mechanical-closure.mjs", []]
];

const checklist = [
  "renderer-safe-dom","canonical-process-lock","retry-authority","control-audit-log","mission-authority-transition",
  "certification-vocabulary","numeric-identity-validation","bound-action-approval","spend-integrity",
  "strict-npm-ci","target-lockfile-prohibition","dependency-digest-reinstall","utf8-bom-safety",
  "omniroute-boundary","provider-env-isolation","provider-smoke-production-path","provider-provenance","evidence-key-lifecycle","evidence-key-acl-readback","run-artifact-digest-inventory","package-lock-artifact-authenticity",
  "npmrc-policy","supply-chain-validator","audit-severity-policy",
  "recursive-schema-strictness","review-bundle-nested-strictness","governance-ledger-scoping",
  "runtime-producer-schema-authority","runtime-schema-conformance-wiring","ajv2020-authority","preflight-baseline",
  "global-stop-graceful-fallback","scheduler-prev-recovery","evidence-retention-hold-export"
];

if (checklist.length !== 34) throw new Error(`PASTE2_CONTROL_COUNT_INVALID:${checklist.length}`);
const covered = new Set(validators.flatMap(([, , ids]) => ids));
for (let id=1; id<=34; id++) if (!covered.has(id)) throw new Error(`PASTE2_CONTROL_UNMAPPED:${id}`);
if (covered.size !== 34) throw new Error(`PASTE2_CONTROL_MAPPING_DUPLICATE_OR_INVALID:${covered.size}`);

const results=[];
for (const [id, file, controls] of validators) {
  if (!fs.existsSync(file)) throw new Error(`PASTE2_VALIDATOR_MISSING:${file}`);
  const r=cp.spawnSync(process.execPath,[file],{encoding:"utf8",env:{...process.env,TERM:process.env.TERM||"dumb"},maxBuffer:8*1024*1024});
  const output=`${r.stdout||""}${r.stderr||""}`.trim();
  results.push({id,file,controls,status:r.status===0?"PASS":"FAIL",output:output.slice(-2000)});
  if (r.status!==0) {
    console.error(`PASTE2_CLOSURE_VALIDATOR_FAIL:${id}:${file}`);
    if(output) console.error(output);
    process.exit(1);
  }
}

const validation=JSON.parse(fs.readFileSync("config/validation.json","utf8"));
const stepMap=new Map(validation.steps.map(x=>[x.id,x]));
const requiredPending=[
  ["runtime-schema-conformance", "PENDING_DEPENDENCIES"],
  ["release-supply-chain", "PENDING_REVIEWED_DEPENDENCIES_AND_SBOM"],
  ["typecheck", "PENDING_DEPENDENCIES"],
  ["tests", "PENDING_DEPENDENCIES"]
];
for(const [id] of requiredPending){const s=stepMap.get(id);if(!s||s.requiresDependencies!==true)throw new Error(`PASTE2_PENDING_GATE_WIRING_INVALID:${id}`)}

const providerSmoke=fs.readFileSync("scripts/provider-smoke.mjs","utf8");
if(!providerSmoke.includes("claude-builder-broker.mjs"))throw new Error("PASTE2_PROVIDER_SMOKE_BYPASSES_BROKERS");
if(providerSmoke.includes("codex-reviewer-broker.mjs"))throw new Error("PASTE2_PROVIDER_SMOKE_INVOKES_RETIRED_CODEX_REVIEWER");
const protectedPaths=JSON.parse(fs.readFileSync("config/protected-paths.json","utf8"));
if(!protectedPaths.exactPaths?.includes("scripts/provider-smoke.mjs"))throw new Error("PASTE2_PROVIDER_SMOKE_NOT_PROTECTED");

const packageLockPresent=fs.existsSync("package-lock.json");
const nodeModulesPresent=fs.existsSync("node_modules");
const environmentGates=[
  {id:"runtime-schema-conformance",status:nodeModulesPresent?"READY_NOT_EXECUTED_BY_SOURCE_CLOSURE":"PENDING_DEPENDENCIES"},
  {id:"release-supply-chain",status:packageLockPresent&&nodeModulesPresent?"READY_NOT_EXECUTED_BY_SOURCE_CLOSURE":"PENDING_REVIEWED_DEPENDENCIES_AND_SBOM"},
  {id:"live-provider-smoke",status:"PENDING_TARGET_RUNTIME_PROVIDER_ENVIRONMENT"},
  {id:"typecheck-vitest",status:nodeModulesPresent?"READY_NOT_EXECUTED_BY_SOURCE_CLOSURE":"PENDING_DEPENDENCIES"}
];

const report={
  schemaVersion:"1.0.0",
  sourceChecklistControls:34,
  sourceVerifiedControls:34,
  validators:results.map(({id,file,controls,status})=>({id,file,controls,status})),
  environmentGates,
  sourceStatus:"COMPLETE",
  overallSourceLevelClosure:false,
  targetMachinePhase0:"PENDING",
  finalTrustRootSeal:"STALE_PENDING_FINAL_RESEAL"
};
console.log(JSON.stringify(report,null,2));
console.log(`PASTE2_SOURCE_CLOSURE: PASS controls=${report.sourceVerifiedControls}/${report.sourceChecklistControls} envGates=${environmentGates.length}`);
