// //TR: Paste 4D current audit/status/release/artifact truth sınırını fail-closed doğrular; tarihsel PASS/CLEAN/SHA kanıtlarının current authority gibi kullanılmasını engeller. Mod yalnız config/trust-root-manifest.json sealStatus'undan türetilir: STALE_PENDING_FINAL_RESEAL (mühür öncesi, eski kurallar aynen) veya SEALED (release candidate: trust-root süreç içinde yeniden doğrulanır, SHA256SUMS varsa mühürlü manifeste bağlı olmalıdır, imza artifact dışında kalır, hiçbir final değer PASS olamaz).
import fs from "node:fs";
import path from "node:path";
import {verifyTrustRoot} from "../automation/lib/trust-root.mjs";
import {parseSha256Sums,sha256File} from "../automation/lib/release-artifact.mjs";

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

// Mod: bilinmeyen sealStatus fail-closed; SEALED dışındaki her şey mühür öncesi kurallarla değerlendirilir.
must(["STALE_PENDING_FINAL_RESEAL","SEALED"].includes(trust.sealStatus),"trust-root-unknown-seal-status");
const SEALED=trust.sealStatus==="SEALED";
const T=SEALED
  ?{seal:"SEALED_RELEASE_CANDIDATE",sums:"PACKAGING_STAGE_OUTSIDE_GIT",auth:"EXTERNAL_DETACHED_SIGNATURE_REQUIRED",zip:"PACKAGING_STAGE_OUTSIDE_GIT",remaining:["ZERO_OPEN_P0P1P2_PENDING_PACKAGING_SIGNATURE_AND_TARGET_PHASE0"]}
  :{seal:"STALE_PENDING_FINAL_RESEAL",sums:"NOT_DONE",auth:"NOT_DONE",zip:"NOT_DONE",remaining:["UNKNOWN_PENDING_CONFIG_RUNTIME_SWEEP_AND_FULL_REGRESSION","UNKNOWN_PENDING_FULL_SOURCE_REGRESSION","UNKNOWN_FULL_SYSTEM_REAUDIT_IN_PROGRESS","ZERO_DEPENDENCY_FREE_SOURCE_PENDING_DEPENDENCY_AWARE","ZERO_OPEN_P0P1P2_PENDING_FINAL_RESEAL_AND_TARGET_PHASE0"]};
const hasSums=exists("SHA256SUMS.txt");

// Mühür öncesi worktree final artifact değildir; stale root integrity manifest current authority olamaz.
if(!SEALED) must(!hasSums,"stale-root-sha256sums-present-before-final-packaging");
must(exists("audit/history/SHA256SUMS-V4-RECOVERY-BASELINE.txt"),"historical-sha256sums-not-preserved");
for(const f of ["V2-STATIC-CLOSURE-RESULTS.json","V3-RE-AUDIT-RESULTS.md","V4-CURRENT-AUDIT-STATE.json","V4-CURRENT-OPEN-FINDINGS.md"]) must(exists(`audit/history/${f}`),`historical-audit-not-preserved:${f}`);
for(const f of ["audit/STATIC-CLOSURE-RESULTS.json","audit/V3-RE-AUDIT-RESULTS.md","audit/V4-CURRENT-OPEN-FINDINGS.md"]) must(!exists(f),`stale-current-audit-surface-present:${f}`);

// Current authority V6 candidate gerçeğini taşımalıdır.
must(status.status==="V6_AUDIT_REMEDIATION_IN_PROGRESS","pack-status-overclaim-or-stale");
must(status.sourceStaticClosure===false,"pack-source-closure-overclaim");
must(status.finalTrustRootSeal===T.seal,"pack-trust-root-overclaim");
must(status.finalSha256Sums===T.sums,"pack-final-sha-overclaim");
must(status.finalReleaseAuthenticity===T.auth,"pack-release-authenticity-overclaim");
must(status.finalZip===T.zip,"pack-final-zip-overclaim");
must(canonical.includes("SOURCE_LEVEL_CLOSURE = FALSE"),"canonical-source-closure-overclaim");
must(canonical.includes(`FINAL_SHA256SUMS = ${T.sums}`),"canonical-final-sha-overclaim");
must(canonical.includes(`FINAL_RELEASE_AUTHENTICITY = ${T.auth}`),"canonical-release-authenticity-overclaim");
must(canonical.includes("TARGET_MACHINE_PHASE0 = PENDING"),"canonical-target-phase0-overclaim");

must(master.state==="V6_AUDIT_REMEDIATION_IN_PROGRESS","master-state-stale-or-overclaim");
must(master.sourceLevelClosure===false,"master-source-closure-overclaim");
must(master.lastStaticClosureAudit==="NOT_FINAL","master-static-closure-overclaim");
must(master.targetMachinePhase0==="PENDING","master-target-phase0-overclaim");
must(!/MECHANICALLY_CLOSED|INSTALLATION_CANDIDATE_READY|INSTALLATION_READY/i.test(JSON.stringify(master)),"master-stale-closed-ready-claim");
must(testStatus.includes("SOURCE_LEVEL_CLOSURE = FALSE"),"test-status-source-closure-overclaim");
must(testStatus.includes("DEPENDENCY_AWARE_VALIDATION = PASS_TARGET_WINDOWS_NODE24_NPM11"),"test-status-dependency-truth-missing");
must(testStatus.includes(`FINAL_SHA256SUMS = ${T.sums}`),"test-status-final-sha-overclaim");
must(testStatus.includes("TARGET_MACHINE_PHASE0 = PENDING"),"test-status-target-phase0-overclaim");

must(auditState.status==="V6_AUDIT_REMEDIATION_IN_PROGRESS","current-audit-state-stale");
must(auditState.sourceLevelClosure===false,"current-audit-source-closure-overclaim");
must(T.remaining.includes(auditState.overallRemainingP0P1P2),"current-audit-premature-zero-blocker-claim");
must(auditState.finalTrustRootSeal===T.seal,"current-audit-trust-overclaim");
must(auditState.finalSha256Sums===T.sums,"current-audit-final-sha-overclaim");
must(auditState.finalReleaseAuthenticity===T.auth,"current-audit-release-auth-overclaim");
must(auditState.targetMachinePhase0==="PENDING","current-audit-target-overclaim");

must(progress.truth?.SOURCE_LEVEL_CLOSURE===false,"progress-source-closure-overclaim");
must(progress.truth?.FINAL_TRUST_ROOT_SEAL===T.seal,"progress-trust-overclaim");
must(progress.truth?.FINAL_ZIP===T.zip,"progress-final-zip-overclaim");
must(["NEXT","IN_PROGRESS","COMPLETE_SOURCE"].includes(progress.paste4?.segments?.["4D"]),"progress-4d-invalid-state");
must(findingsIndex.includes("audit/V6-FULL-SCAN-PROGRESS.json"),"findings-index-current-v6-authority-missing");
must(!findingsIndex.includes("V4-CURRENT-OPEN-FINDINGS.md — bugün")&&!findingsIndex.includes("V4-CURRENT-OPEN-FINDINGS.md` — bugün"),"findings-index-stale-v4-authority");

// Trust-root: mühür öncesi current manifest PASS olamaz; SEALED modda manifest süreç içinde yeniden doğrulanmalıdır (runtime rapora güvenilmez).
let trustVerified=false;
if(!SEALED) must(trust.sealStatus==="STALE_PENDING_FINAL_RESEAL","trust-root-premature-final-seal");
else{let tr={ok:false};try{tr=verifyTrustRoot(root)}catch{}trustVerified=tr.ok===true;must(trustVerified,"sealed-trust-root-verification-failed")}
if(exists(".ai/runtime/TRUST_ROOT_VERIFY.json")){
  const rt=json(".ai/runtime/TRUST_ROOT_VERIFY.json");
  must(rt.ok!==true||trustVerified,"stale-runtime-trust-root-pass-present");
}

// SEALED modda SHA256SUMS varsa: ayrıştırılabilir, lockfile'ı içerir, mühürlü manifeste ve her trust-root dosyasının mühürlü hash'ine bağlıdır.
let sumsBound=false;
if(SEALED&&hasSums){
  const {entries,errors:parseErrors}=parseSha256Sums(text("SHA256SUMS.txt"));
  must(parseErrors.length===0,"sealed-sha256sums-malformed");
  must(entries.has("package-lock.json"),"sealed-sha256sums-lockfile-missing");
  const manifestBound=entries.get("config/trust-root-manifest.json")===sha256File(p("config/trust-root-manifest.json"));
  must(manifestBound,"sealed-sha256sums-not-bound-to-sealed-manifest");
  const trustEntriesBound=(trust.files??[]).every(x=>entries.get(x.path)===x.sha256);
  must(trustEntriesBound,"sealed-sha256sums-trust-root-entry-mismatch");
  sumsBound=parseErrors.length===0&&manifestBound&&trustEntriesBound;
}
if(exists(".ai/runtime/ARTIFACT_VERIFY.json")){
  const art=json(".ai/runtime/ARTIFACT_VERIFY.json");
  must(art.status!=="PASS"||(SEALED&&sumsBound&&trustVerified),"stale-runtime-artifact-pass-present-before-final-manifest");
}

// Artifact self-manifest authenticity değildir; hem Node hem PowerShell lockfile membership'i zorunlu tutmalıdır.
must(nodeArtifact.includes('expectedFiles.has("package-lock.json")'),"node-artifact-lockfile-membership-not-enforced");
must(nodeArtifact.includes("external signature/authenticity iddiası değildir"),"node-artifact-self-manifest-authenticity-boundary-missing");
must(psArtifact.includes('Contains("package-lock.json")'),"powershell-artifact-lockfile-membership-not-enforced");
must(psArtifact.includes("LOCKFILE_NOT_IN_ARTIFACT_MANIFEST"),"powershell-artifact-lockfile-failure-missing");

// Release imzası her modda artifact/worktree dışında (detached) kalır; current authority final authenticity PASS diyemez.
const signatureCandidates=["RELEASE.sig","RELEASE-SIGNATURE.json","release.sig","release-signature.json"];
const persistedSignature=signatureCandidates.some(exists);
must(!persistedSignature,SEALED?"release-signature-must-stay-detached-outside-artifact":"unexpected-release-signature-present-before-final-release-stage");
must(status.finalReleaseAuthenticity===T.auth,SEALED?"release-authenticity-must-stay-external-detached-signature-required":"release-authenticity-must-remain-not-done-without-persisted-signature");

if(errors.length){
  console.error(`PASTE4D_RELEASE_TRUTH_VALIDATION: FAIL mode=${SEALED?"SEALED":"PRE_SEAL"} checks=${checks} errors=${errors.length}`);
  for(const e of errors)console.error(`- ${e}`);
  process.exit(1);
}
console.log(`PASTE4D_RELEASE_TRUTH_VALIDATION: PASS mode=${SEALED?"SEALED":"PRE_SEAL"} checks=${checks}`);
