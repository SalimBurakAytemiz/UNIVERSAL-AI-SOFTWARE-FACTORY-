// //TR: Bu test paste4d/paste4c'nin mühür öncesi ve SEALED release-candidate modlarını, release SHA256SUMS üreticisini, deterministik ZIP'i ve taze extract doğrulamasını geçici bir kopya ağaçta adversarial olarak doğrular (PKGR-F1); gerçek repo dosyalarını değiştirmez.
import {describe,it,expect,beforeAll,afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
const repo=process.cwd(),SKIP=new Set([".git","node_modules",".ai/runtime",".ai/cache",".ai/automation","SHA256SUMS.txt"]);
const base=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-pkg-r1-")),tree=path.join(base,"tree");
function copyTree(src:string,dst:string,rel=""):void{for(const e of fs.readdirSync(path.join(src,rel),{withFileTypes:true})){const r=rel?`${rel}/${e.name}`:e.name;if(SKIP.has(r))continue;if(e.isDirectory()){fs.mkdirSync(path.join(dst,r),{recursive:true});copyTree(src,dst,r)}else if(e.isFile())fs.copyFileSync(path.join(src,r),path.join(dst,r))}}
function node(args:string[],cwd=tree){const r=cp.spawnSync(process.execPath,args,{cwd,encoding:"utf8",timeout:600000});return {status:r.status,out:`${r.stdout??""}${r.stderr??""}`}}
const rd=(f:string)=>fs.readFileSync(path.join(tree,f),"utf8"),wr=(f:string,s:string)=>fs.writeFileSync(path.join(tree,f),s);
const editJson=(f:string,fn:(j:any)=>void)=>{const j=JSON.parse(rd(f));fn(j);wr(f,JSON.stringify(j,null,2)+"\n")};
// //TR: Moda göre bütün truth yüzeyleri açıkça yazılır; başlangıç ağacı hangi modda olursa olsun (repo veya mühürlü extract) test aynı sonucu verir.
function setMode(mode:"PRE_SEAL"|"SEALED"){const S=mode==="SEALED",seal=S?"SEALED_RELEASE_CANDIDATE":"STALE_PENDING_FINAL_RESEAL",sums=S?"PACKAGING_STAGE_OUTSIDE_GIT":"NOT_DONE",auth=S?"EXTERNAL_DETACHED_SIGNATURE_REQUIRED":"NOT_DONE",zip=S?"PACKAGING_STAGE_OUTSIDE_GIT":"NOT_DONE",scope=S?"RELEASE_PACKAGING_SIGNATURE_THEN_TARGET_MACHINE_PHASE0":"FINAL_RESEAL_PACKAGING_THEN_TARGET_MACHINE_PHASE0",remaining=S?"ZERO_OPEN_P0P1P2_PENDING_PACKAGING_SIGNATURE_AND_TARGET_PHASE0":"ZERO_OPEN_P0P1P2_PENDING_FINAL_RESEAL_AND_TARGET_PHASE0";
  editJson("PACK.json",j=>{j.finalTrustRootSeal=seal;j.finalSha256Sums=sums;j.finalReleaseAuthenticity=auth;j.finalZip=zip});
  editJson("audit/CURRENT-AUDIT-STATE.json",j=>{j.finalTrustRootSeal=seal;j.finalSha256Sums=sums;j.finalReleaseAuthenticity=auth;j.overallRemainingP0P1P2=remaining;j.activeScope=scope});
  editJson("audit/V6-FULL-SCAN-PROGRESS.json",j=>{j.truth.FINAL_TRUST_ROOT_SEAL=seal;j.truth.FINAL_ZIP=zip;j.nextScope=scope});
  const md=(f:string)=>wr(f,rd(f).replace(/FINAL_TRUST_ROOT_SEAL = [A-Z_]+/g,`FINAL_TRUST_ROOT_SEAL = ${seal}`).replace(/FINAL_SHA256SUMS = [A-Z_]+/g,`FINAL_SHA256SUMS = ${sums}`).replace(/FINAL_RELEASE_AUTHENTICITY = [A-Z_]+/g,`FINAL_RELEASE_AUTHENTICITY = ${auth}`));
  for(const f of ["CANONICAL-STATUS.md","README.md",".ai/TEST_STATUS.md"])md(f);
  wr(".ai/NEXT_ACTIONS.md",rd(".ai/NEXT_ACTIONS.md").replace(/`(FINAL_RESEAL_PACKAGING|RELEASE_PACKAGING_SIGNATURE)_THEN_TARGET_MACHINE_PHASE0`/g,`\`${scope}\``));
  if(S){const g=node(["scripts/generate-trust-root.mjs"]);if(g.status!==0)throw new Error(g.out)}else editJson("config/trust-root-manifest.json",j=>{j.sealStatus="STALE_PENDING_FINAL_RESEAL"})}
const p4d=()=>node(["scripts/validate-paste4d-release-truth.mjs"]),p4c=()=>node(["scripts/validate-paste4c-doc-truth.mjs"]),mech=()=>node(["scripts/validate-mechanical-closure.mjs"]);
function mutate(f:string,fn:(s:string)=>string,check:()=>void){const orig=rd(f);try{wr(f,fn(orig));check()}finally{wr(f,orig)}}
// //TR: Geçici dosya ve onun için oluşturulan dizin (ör. .ai/runtime) geri alınır; ağaç temiz export olarak kalır.
function withFile(f:string,content:string,check:()=>void){const dir=path.dirname(path.join(tree,f)),existed=fs.existsSync(dir);try{fs.mkdirSync(dir,{recursive:true});wr(f,content);check()}finally{fs.rmSync(path.join(tree,f),{force:true});if(!existed)fs.rmSync(dir,{recursive:true,force:true})}}
beforeAll(()=>{fs.mkdirSync(tree);copyTree(repo,tree)});
afterAll(()=>{fs.rmSync(base,{recursive:true,force:true})});
describe("release truth modes (PKGR-F1)",()=>{
  it("the current tree passes both truth validators",()=>{expect(node(["scripts/validate-paste4d-release-truth.mjs"],repo).status).toBe(0);expect(node(["scripts/validate-paste4c-doc-truth.mjs"],repo).status).toBe(0)});
  it("pre-seal mode keeps the old absence rules",()=>{setMode("PRE_SEAL");const d=p4d();expect(d.status,d.out).toBe(0);expect(d.out).toContain("mode=PRE_SEAL");expect(p4c().status).toBe(0);const m=mech();expect(m.status,m.out).toBe(0);
    withFile("SHA256SUMS.txt","x\n",()=>{expect(p4d().out).toContain("stale-root-sha256sums-present-before-final-packaging")});
    withFile(".ai/runtime/ARTIFACT_VERIFY.json",JSON.stringify({status:"PASS"}),()=>{expect(p4d().out).toContain("stale-runtime-artifact-pass-present-before-final-manifest")});
    withFile(".ai/runtime/TRUST_ROOT_VERIFY.json",JSON.stringify({ok:true}),()=>{expect(p4d().out).toContain("stale-runtime-trust-root-pass-present")});
    for(const f of ["RELEASE-SIGNATURE.json","audit/RELEASE.sig","docs/Release.Sig"])withFile(f,"sig",()=>{expect(p4d().out).toContain(`unexpected-release-signature-present-before-final-release-stage:${f}`)});
    mutate("PACK.json",s=>s.replace('"finalTrustRootSeal": "STALE_PENDING_FINAL_RESEAL"','"finalTrustRootSeal": "SEALED_RELEASE_CANDIDATE"'),()=>{expect(p4d().out).toContain("pack-trust-root-overclaim");expect(p4c().out).toContain("pack-final-seal-overclaim")})},600000);
  it("rejects an unknown seal status in both validators",()=>{mutate("config/trust-root-manifest.json",s=>s.replace(/"sealStatus": "[A-Z_]+"/,'"sealStatus": "SEALED_MAYBE"'),()=>{expect(p4d().out).toContain("trust-root-unknown-seal-status");expect(p4c().out).toContain("trust-root-unknown-seal-status")})});
  it("sealed mode passes only with verified trust root and release-candidate truth",()=>{setMode("SEALED");const d=p4d();expect(d.status,d.out).toBe(0);expect(d.out).toContain("mode=SEALED");const c=p4c();expect(c.status,c.out).toBe(0);expect(c.out).toContain("mode=SEALED");const m=mech();expect(m.status,m.out).toBe(0);
    mutate("scripts/verify-trust-root.mjs",s=>s+"\n// tamper\n",()=>{expect(p4d().out).toContain("sealed-trust-root-verification-failed")});
    mutate("PACK.json",s=>s.replace('"finalReleaseAuthenticity": "EXTERNAL_DETACHED_SIGNATURE_REQUIRED"','"finalReleaseAuthenticity": "PASS"'),()=>{expect(p4d().out).toContain("pack-release-authenticity-overclaim")});
    mutate("CANONICAL-STATUS.md",s=>s.replace("FINAL_TRUST_ROOT_SEAL = SEALED_RELEASE_CANDIDATE","FINAL_TRUST_ROOT_SEAL = STALE_PENDING_FINAL_RESEAL"),()=>{expect(p4c().out).toContain("status-trust-seal-truth-missing");expect(mech().out).toContain("canonical-status-truth-missing:FINAL_TRUST_ROOT_SEAL = SEALED_RELEASE_CANDIDATE")});
    mutate("audit/CURRENT-AUDIT-STATE.json",s=>s.replace("ZERO_OPEN_P0P1P2_PENDING_PACKAGING_SIGNATURE_AND_TARGET_PHASE0","ZERO_OPEN_P0P1P2_PENDING_FINAL_RESEAL_AND_TARGET_PHASE0"),()=>{expect(p4d().out).toContain("current-audit-premature-zero-blocker-claim")});
    mutate(".ai/MASTER_STATE.json",s=>s.replace('"targetMachinePhase0": "PENDING"','"targetMachinePhase0": "PASS"'),()=>{expect(p4d().out).toContain("master-target-phase0-overclaim")});
    withFile("RELEASE.sig","sig",()=>{expect(p4d().out).toContain("release-signature-must-stay-detached-outside-artifact")});
    // //TR: F-PKGR1-001 regresyonu: iç içe dizindeki, büyük/küçük harf farklı veya .sig/.minisig uzantılı imza da reddedilir.
    for(const f of ["audit/RELEASE.sig","docs/release-signature.JSON","audit/checkpoints/release.minisig","scripts/notes.SIG"])withFile(f,"sig",()=>{expect(p4d().out).toContain(`release-signature-must-stay-detached-outside-artifact:${f}`)});
    withFile(".ai/runtime/ARTIFACT_VERIFY.json",JSON.stringify({status:"PASS"}),()=>{expect(p4d().out).toContain("stale-runtime-artifact-pass-present-before-final-manifest")})},600000);
  it("release SHA256SUMS generator refuses unsealed or unclean exports and binds to the sealed manifest",()=>{
    mutate("config/trust-root-manifest.json",s=>s.replace('"sealStatus": "SEALED"','"sealStatus": "STALE_PENDING_FINAL_RESEAL"'),()=>{const r=node(["scripts/release-sha256sums.mjs",tree]);expect(r.status).not.toBe(0);expect(r.out).toContain("TRUST_ROOT_NOT_SEALED_OR_INVALID")});
    fs.mkdirSync(path.join(tree,"node_modules"));try{expect(node(["scripts/release-sha256sums.mjs",tree]).out).toContain("SOURCE_NOT_CLEAN_EXPORT")}finally{fs.rmSync(path.join(tree,"node_modules"),{recursive:true,force:true})}
    const g=node(["scripts/release-sha256sums.mjs",tree]);expect(g.status,g.out).toBe(0);expect(node(["scripts/release-sha256sums.mjs",tree]).out).toContain("MANIFEST_ALREADY_PRESENT");
    expect(node(["scripts/verify-artifact.mjs"]).status).toBe(0);fs.rmSync(path.join(tree,".ai/runtime"),{recursive:true,force:true});
    const d=p4d();expect(d.status,d.out).toBe(0);
    withFile(".ai/runtime/ARTIFACT_VERIFY.json",JSON.stringify({status:"PASS"}),()=>{expect(p4d().status).toBe(0)});
    mutate("SHA256SUMS.txt",s=>s.replace(/^[0-9a-f]{64}(  config\/trust-root-manifest\.json)$/m,"0".repeat(64)+"$1"),()=>{expect(p4d().out).toContain("sealed-sha256sums-not-bound-to-sealed-manifest")});
    mutate("SHA256SUMS.txt",s=>s.replace(/^[0-9a-f]{64}(  scripts\/verify-trust-root\.mjs)$/m,"0".repeat(64)+"$1"),()=>{expect(p4d().out).toContain("sealed-sha256sums-trust-root-entry-mismatch")})},600000);
  it("builds a byte-identical ZIP twice and refuses a tampered export",()=>{const a=path.join(base,"a.zip"),b=path.join(base,"b.zip");
    const r1=node(["scripts/diag-build-release-zip-exitcode.mjs",tree,a]);expect(r1.status,r1.out).toBe(0);expect(node(["scripts/diag-build-release-zip-exitcode.mjs",tree,b]).status).toBe(0);
    const h=(f:string)=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");expect(h(a)).toBe(h(b));expect(JSON.parse(fs.readFileSync(`${a}.release.json`,"utf8")).zipSha256).toBe(h(a));
    expect(node(["scripts/diag-build-release-zip-exitcode.mjs",tree,a]).out).toContain("OUTPUT_ALREADY_EXISTS");
    mutate("README.md",s=>s+"\ntamper\n",()=>{const r=node(["scripts/diag-build-release-zip-exitcode.mjs",tree,path.join(base,"c.zip")]);expect(r.status).not.toBe(0);expect(r.out).toContain("SHA256SUMS_DOES_NOT_MATCH_EXPORT")})},600000);
  it.skipIf(process.platform!=="win32")("verifies a fresh Windows extract and rejects a ZIP with an unlisted entry",()=>{const a=path.join(base,"a.zip"),dest=path.join(base,"extract");
    const v=node(["scripts/verify-release-extract.mjs",a,dest]);expect(v.status,v.out).toBe(0);const rep=JSON.parse(fs.readFileSync(`${dest}.verify.json`,"utf8"));expect(rep.final).toBe("PASS");for(const k of ["expandArchive","postExtractSha256Sums","verifyArtifactPowerShell","verifyArtifactNode","verifyTrustRoot"])expect(rep.checks[k].status).toBe("PASS");
    expect(node(["scripts/verify-release-extract.mjs",a,dest]).out).toContain("EXTRACT_DIR_NOT_FRESH");
    const lib="file:///"+path.join(tree,"automation/lib/release-artifact.mjs").replaceAll("\\","/"),evil=path.join(base,"evil.zip");
    const code=`import fs from "node:fs";import zlib from "node:zlib";import {readZipCentralDirectory,writeDeterministicZip} from ${JSON.stringify(lib)};const src=fs.readFileSync(process.argv[1]);const cd=readZipCentralDirectory(src);const e=cd.map(c=>{const nl=src.readUInt16LE(c.offset+26),xl=src.readUInt16LE(c.offset+28),b=src.subarray(c.offset+30+nl+xl,c.offset+30+nl+xl+c.csize);return {name:c.name,data:c.method===8?zlib.inflateRawSync(b):b}});e.push({name:"zz-unlisted.txt",data:Buffer.from("x")});fs.writeFileSync(process.argv[2],writeDeterministicZip(e,{deflate:d=>zlib.deflateRawSync(d)}))`;
    const w=cp.spawnSync(process.execPath,["--input-type=module","-e",code,a,evil],{encoding:"utf8"});expect(w.status,w.stderr).toBe(0);
    const r=node(["scripts/verify-release-extract.mjs",evil,path.join(base,"extract-evil")]);expect(r.status).not.toBe(0);expect(r.out).toContain("ZIP_ENTRY_NOT_IN_SHA256SUMS")},600000);
  it("release-artifact helpers reject unsafe manifest lines and ZIP names",()=>{const lib="file:///"+path.join(tree,"automation/lib/release-artifact.mjs").replaceAll("\\","/");
    const code=`import {parseSha256Sums,writeDeterministicZip,readZipCentralDirectory} from ${JSON.stringify(lib)};const z="0".repeat(64);const out={};out.slip=parseSha256Sums(z+"  ../x\\n").errors.map(e=>e.reason);out.dup=parseSha256Sums(z+"  a\\n"+z+"  a\\n").errors.map(e=>e.reason);out.crlf=parseSha256Sums(z+"  a\\r\\n").errors.map(e=>e.reason);try{writeDeterministicZip([{name:"../evil",data:Buffer.from("x")}],{deflate:d=>d});out.zipSlip="ALLOWED"}catch(e){out.zipSlip=String(e.message)}const ok=writeDeterministicZip([{name:"a",data:Buffer.from("x")}],{deflate:d=>d});try{readZipCentralDirectory(Buffer.concat([ok,Buffer.from("comment")]));out.trailing="ALLOWED"}catch(e){out.trailing=String(e.message)}console.log(JSON.stringify(out))`;
    const r=cp.spawnSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8"});expect(r.status,r.stderr).toBe(0);const o=JSON.parse(r.stdout);
    expect(o.slip).toContain("UNSAFE_PATH");expect(o.dup).toContain("DUPLICATE_ENTRY");expect(o.crlf).toContain("CRLF_NOT_ALLOWED");expect(o.zipSlip).toContain("ZIP_UNSAFE_NAME");expect(o.trailing).toContain("ZIP_EOCD_NOT_AT_END_OR_COMMENT_PRESENT")});
});
