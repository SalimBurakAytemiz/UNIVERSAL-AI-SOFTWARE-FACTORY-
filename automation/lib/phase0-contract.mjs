// //TR: Bu helper Phase0 CLEAN raporunu exact installId/source commit/trust-root manifest/runtime input digest setine bağlar ve Ed25519 imzasını supervisor başlangıcında yeniden doğrular.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "./git-isolation.mjs";
import {stableStringify} from "./atomic-json.mjs";
import {verifyEvidence} from "./evidence-signing.mjs";

export const PHASE0_SCHEMA_VERSION="1.2.0";
export const PHASE0_INPUT_FILES=Object.freeze({
  artifactIntegrity:".ai/runtime/ARTIFACT_VERIFY.json",
  preflight:".ai/runtime/PREFLIGHT.json",
  validation:".ai/runtime/VALIDATION_REPORT.json",
  dependencyState:"node_modules/.uasco-dependency-state.json",
  providerProvenance:".ai/runtime/PROVIDER_PROVENANCE.json",
  providerAuth:".ai/runtime/PROVIDER_SMOKE.json",
  builderBoundary:".ai/runtime/BUILDER_BOUNDARY_SMOKE.json",
  evidenceSigning:".ai/runtime/EVIDENCE_SIGNING.json",
  evidenceKeyProtection:".ai/runtime/EVIDENCE_KEY_PROTECTION.json",
  supervisorStateSelftest:".ai/runtime/SUPERVISOR_STATE_SELFTEST.json",
  bootstrapKernel:".ai/runtime/BOOTSTRAP_KERNEL_SELFTEST.json",
  localToolHealth:".ai/runtime/LOCAL_TOOL_HEALTH.json",
  controlApiSmoke:".ai/runtime/CONTROL_API_SMOKE.json",
  controlTowerSmoke:".ai/runtime/CONTROL_TOWER_SMOKE.json",
  remoteProtection:".ai/runtime/REMOTE_PROTECTION.json"
});
const shaFile=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const equal=(a,b)=>stableStringify(a)===stableStringify(b);
function currentHead(root){const r=spawnGitSync(root,["rev-parse","HEAD"]);if(r.status!==0)throw new Error("PHASE0_GIT_HEAD_UNAVAILABLE");const head=String(r.stdout??"").trim();if(!/^[0-9a-f]{40,64}$/.test(head))throw new Error("PHASE0_GIT_HEAD_INVALID");return head}
function currentInstallId(root){const file=path.join(root,".ai/runtime/INSTALL_STEPS.json");if(!fs.existsSync(file))throw new Error("PHASE0_INSTALL_STEPS_MISSING");const steps=readJson(file),ledger=String(steps.installId??""),env=String(process.env.UASCO_INSTALL_ID??"");if(!/^INSTALL-[A-Za-z0-9._:-]+$/.test(ledger))throw new Error("PHASE0_INSTALL_ID_INVALID");if(env&&env!==ledger)throw new Error("PHASE0_INSTALL_ID_ENV_LEDGER_MISMATCH");return ledger}
export function collectPhase0Binding(root){
 root=path.resolve(root);const trustFile=path.join(root,"config/trust-root-manifest.json");if(!fs.existsSync(trustFile))throw new Error("PHASE0_TRUST_ROOT_MANIFEST_MISSING");
 const inputDigests={};for(const [id,rel] of Object.entries(PHASE0_INPUT_FILES)){const file=path.join(root,rel);inputDigests[id]={path:rel,present:fs.existsSync(file),sha256:fs.existsSync(file)?shaFile(file):null}}
 return {installId:currentInstallId(root),sourceCommit:currentHead(root),trustRootManifestSha256:shaFile(trustFile),inputDigests};
}
export function phase0UnsignedPayload(report){const x={...report};delete x.sealSignature;return x}
export function verifyPhase0Acceptance({repoRoot,report,publicKeyFile}){
 const errors=[];if(!report||report.schemaVersion!==PHASE0_SCHEMA_VERSION)errors.push("PHASE0_SCHEMA_VERSION_INVALID");if(!["CLEAN","CLEAN_LOCAL_ONLY"].includes(report?.final))errors.push("PHASE0_NOT_CLEAN");if(report?.sealAlgorithm!=="Ed25519"||typeof report?.sealSignature!=="string"||!report.sealSignature)errors.push("PHASE0_SIGNATURE_MISSING");
 let current=null;try{current=collectPhase0Binding(repoRoot)}catch(e){errors.push(String(e.message??e))}
 if(current){if(report.installId!==current.installId)errors.push("PHASE0_INSTALL_ID_STALE");if(report.sourceCommit!==current.sourceCommit)errors.push("PHASE0_SOURCE_COMMIT_STALE");if(report.trustRootManifestSha256!==current.trustRootManifestSha256)errors.push("PHASE0_TRUST_ROOT_DIGEST_STALE");if(!equal(report.inputDigests,current.inputDigests))errors.push("PHASE0_INPUT_DIGEST_MISMATCH")}
 try{if(!publicKeyFile||!fs.existsSync(publicKeyFile)||!report?.sealSignature||!verifyEvidence(phase0UnsignedPayload(report),report.sealSignature,publicKeyFile))errors.push("PHASE0_SIGNATURE_INVALID")}catch{errors.push("PHASE0_SIGNATURE_INVALID")}
 return {ok:errors.length===0,errors,current};
}
