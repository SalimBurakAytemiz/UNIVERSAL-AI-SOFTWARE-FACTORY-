// //TR: Paste 4D current audit/status/release/artifact truth sınırını fail-closed doğrular; tarihsel PASS/CLEAN/SHA kanıtlarının current authority gibi kullanılmasını engeller.
import fs from "node:fs";
import path from "node:path";

const root=process.cwd(),errors=[];let checks=0;
const must=(cond,msg)=>{checks+=1;if(!cond)errors.push(msg)};
const p=x=>path.join(root,x);
const exists=x=>fs.existsSync(p(x));
const text=x=>fs.readFileSync(p(x),"utf8");
const json=x=>JSON.parse(text(x));

const status=json("PACK.json");
const canonical=text("CANONICAL-STATUS.md");
const progress=json("audit/V6-FULL-SCAN-PROGRESS.json");
const auditState=json("audit/CURRENT-AUDIT-STATE.json");
const master=json(".ai/MASTER_STATE.json");
const testStatus=text(".ai/TEST_STATUS.md");
const trust=json("config/trust-root-manifest.json");
const findingsIndex=text("audit/ALL-FINDINGS-INDEX.md");
const nodeArtifact=text("scripts/verify-artifact.mjs");
const psArtifact=text("scripts/verify-artifact.ps1");

// Current worktree final artifact değildir; stale root integrity manifest current authority olamaz.
must(!exists("SHA256SUMS.txt"),"stale-root-sha256sums-present-before-final-packaging");
must(exists("audit/history/SHA256SUMS-V4-RECOVERY-BASELINE.txt"),"historical-sha256sums-not-preserved");
for(const f of ["V2-STATIC-CLOSURE-RESULTS.json","V3-RE-AUDIT-RESULTS.md","V4-CURRENT-AUDIT-STATE.json","V4-CURRENT-OPEN-FINDINGS.md","V4-DEPENDENCY-FREE-RECHECK.log"]) must(exists(`audit/history/${f}`),`historical-audit-not-preserved:${f}`);
for(const f of ["audit/STATIC-CLOSURE-RESULTS.json","audit/V3-RE-AUDIT-RESULTS.md","audit/V4-CURRENT-OPEN-FINDINGS.md"]) must(!exists(f),`stale-current-audit-surface-present:${f}`);

// Current authority V6 candidate gerçeğini taşımalıdır.
must(status.status==="V6_AUDIT_REMEDIATION_IN_PROGRESS","pack-status-overclaim-or-stale");
must(status.sourceStaticClosure===false,"pack-source-closure-overclaim");
must(status.finalTrustRootSeal==="STALE_PENDING_FINAL_RESEAL","pack-trust-root-overclaim");
must(status.finalSha256Sums==="NOT_DONE","pack-final-sha-overclaim");
must(status.finalReleaseAuthenticity==="NOT_DONE","pack-release-authenticity-overclaim");
must(status.finalZip==="NOT_DONE","pack-final-zip-overclaim");
must(canonical.includes("SOURCE_LEVEL_CLOSURE = FALSE"),"canonical-source-closure-overclaim");
must(canonical.includes("FINAL_SHA256SUMS = NOT_DONE"),"canonical-final-sha-overclaim");
must(canonical.includes("FINAL_RELEASE_AUTHENTICITY = NOT_DONE"),"canonical-release-authenticity-overclaim");
must(canonical.includes("TARGET_MACHINE_PHASE0 = PENDING"),"canonical-target-phase0-overclaim");

must(master.state==="V6_AUDIT_REMEDIATION_IN_PROGRESS","master-state-stale-or-overclaim");
must(master.sourceLevelClosure===false,"master-source-closure-overclaim");
must(master.lastStaticClosureAudit==="NOT_FINAL","master-static-closure-overclaim");
must(master.targetMachinePhase0==="PENDING","master-target-phase0-overclaim");
must(!/MECHANICALLY_CLOSED|INSTALLATION_CANDIDATE_READY|INSTALLATION_READY/i.test(JSON.stringify(master)),"master-stale-closed-ready-claim");
must(testStatus.includes("SOURCE_LEVEL_CLOSURE = FALSE"),"test-status-source-closure-overclaim");
must(testStatus.includes("DEPENDENCY_AWARE_VALIDATION = PENDING"),"test-status-dependency-overclaim");
must(testStatus.includes("FINAL_SHA256SUMS = NOT_DONE"),"test-status-final-sha-overclaim");
must(testStatus.includes("TARGET_MACHINE_PHASE0 = PENDING"),"test-status-target-phase0-overclaim");

must(auditState.status==="V6_AUDIT_REMEDIATION_IN_PROGRESS","current-audit-state-stale");
must(auditState.sourceLevelClosure===false,"current-audit-source-closure-overclaim");
must(["UNKNOWN_PENDING_CONFIG_RUNTIME_SWEEP_AND_FULL_REGRESSION","UNKNOWN_PENDING_FULL_SOURCE_REGRESSION"].includes(auditState.overallRemainingP0P1P2),"current-audit-premature-zero-blocker-claim");
must(auditState.finalTrustRootSeal==="STALE_PENDING_FINAL_RESEAL","current-audit-trust-overclaim");
must(auditState.finalSha256Sums==="NOT_DONE","current-audit-final-sha-overclaim");
must(auditState.finalReleaseAuthenticity==="NOT_DONE","current-audit-release-auth-overclaim");
must(auditState.targetMachinePhase0==="PENDING","current-audit-target-overclaim");

must(progress.truth?.SOURCE_LEVEL_CLOSURE===false,"progress-source-closure-overclaim");
must(progress.truth?.FINAL_TRUST_ROOT_SEAL==="STALE_PENDING_FINAL_RESEAL","progress-trust-overclaim");
must(progress.truth?.FINAL_ZIP==="NOT_DONE","progress-final-zip-overclaim");
must(["NEXT","IN_PROGRESS","COMPLETE_SOURCE"].includes(progress.paste4?.segments?.["4D"]),"progress-4d-invalid-state");
must(findingsIndex.includes("audit/V6-FULL-SCAN-PROGRESS.json"),"findings-index-current-v6-authority-missing");
must(!findingsIndex.includes("V4-CURRENT-OPEN-FINDINGS.md — bugün")&&!findingsIndex.includes("V4-CURRENT-OPEN-FINDINGS.md` — bugün"),"findings-index-stale-v4-authority");

// Trust-root final reseal yapılana kadar current manifest PASS olamaz.
must(trust.sealStatus==="STALE_PENDING_FINAL_RESEAL","trust-root-premature-final-seal");
if(exists(".ai/runtime/TRUST_ROOT_VERIFY.json")){
  const rt=json(".ai/runtime/TRUST_ROOT_VERIFY.json");
  must(rt.ok!==true,"stale-runtime-trust-root-pass-present");
}
if(exists(".ai/runtime/ARTIFACT_VERIFY.json")){
  const art=json(".ai/runtime/ARTIFACT_VERIFY.json");
  must(art.status!=="PASS","stale-runtime-artifact-pass-present-before-final-manifest");
}

// Artifact self-manifest authenticity değildir; hem Node hem PowerShell lockfile membership'i zorunlu tutmalıdır.
must(nodeArtifact.includes('expectedFiles.has("package-lock.json")'),"node-artifact-lockfile-membership-not-enforced");
must(nodeArtifact.includes("external signature/authenticity iddiası değildir"),"node-artifact-self-manifest-authenticity-boundary-missing");
must(psArtifact.includes('Contains("package-lock.json")'),"powershell-artifact-lockfile-membership-not-enforced");
must(psArtifact.includes("LOCKFILE_NOT_IN_ARTIFACT_MANIFEST"),"powershell-artifact-lockfile-failure-missing");

// Persisted detached release signature yoksa current authority final authenticity PASS diyemez.
const signatureCandidates=["RELEASE.sig","RELEASE-SIGNATURE.json","release.sig","release-signature.json"];
const persistedSignature=signatureCandidates.some(exists);
must(!persistedSignature,"unexpected-release-signature-present-before-final-release-stage");
must(status.finalReleaseAuthenticity==="NOT_DONE","release-authenticity-must-remain-not-done-without-persisted-signature");

if(errors.length){
  console.error(`PASTE4D_RELEASE_TRUTH_VALIDATION: FAIL checks=${checks} errors=${errors.length}`);
  for(const e of errors)console.error(`- ${e}`);
  process.exit(1);
}
console.log(`PASTE4D_RELEASE_TRUTH_VALIDATION: PASS checks=${checks}`);
