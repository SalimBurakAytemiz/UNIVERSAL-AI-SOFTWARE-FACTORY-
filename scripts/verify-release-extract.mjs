// //TR: Bu maintainer release script'i final ZIP'i taze bir dizine Windows Expand-Archive ile açar ve Founder'ın kurulum yolunu taklit ederek doğrular: açmadan önce ZIP giriş adları/güvenliği ile SHA256SUMS kapsamını karşılaştırır, açtıktan sonra değiştirilmemiş scripts/verify-artifact.ps1, scripts/verify-artifact.mjs ve scripts/verify-trust-root.mjs'i extract içinde çalıştırır; --with-validation ile reviewed-lock bağımlılık kurulumu ve kanonik doğrulamayı da çalıştırır. İmza doğrulaması değildir.
// usage: node scripts/verify-release-extract.mjs <zip> <freshExtractDir> [--with-validation]
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import zlib from "node:zlib";import cp from "node:child_process";
import {ARTIFACT_MANIFEST,readZipCentralDirectory,parseSha256Sums,verifySha256Sums} from "../automation/lib/release-artifact.mjs";
const fail=(code,detail="")=>{console.error(`RELEASE_EXTRACT_VERIFY: FAIL ${code}${detail?` ${detail}`:""}`);process.exit(1)};
const args=process.argv.slice(2),withValidation=args.includes("--with-validation"),pos=args.filter(a=>a!=="--with-validation");
const [zipArg,destArg]=pos;if(!zipArg||!destArg)fail("USAGE","node scripts/verify-release-extract.mjs <zip> <freshExtractDir> [--with-validation]");
const zipFile=path.resolve(zipArg),dest=path.resolve(destArg),reportFile=`${dest}.verify.json`;
if(!fs.existsSync(zipFile))fail("ZIP_MISSING",zipFile);if(fs.existsSync(dest))fail("EXTRACT_DIR_NOT_FRESH",dest);if(fs.existsSync(reportFile))fail("REPORT_ALREADY_EXISTS",reportFile);
if(process.platform!=="win32")fail("EXTRACTOR_UNAVAILABLE","Windows Expand-Archive is the Founder install path");
const zip=fs.readFileSync(zipFile),zipSha256=crypto.createHash("sha256").update(zip).digest("hex"),report={"//TR":"Bu rapor final ZIP'in taze extract doğrulamasını kaydeder; external signature/authenticity iddiası değildir.",schemaVersion:"1.0.0",zipFile,zipSha256,extractDir:dest,checks:{}};
const sidecar=`${zipFile}.release.json`;if(fs.existsSync(sidecar)){const s=JSON.parse(fs.readFileSync(sidecar,"utf8"));if(s.zipSha256!==zipSha256)fail("ZIP_SHA256_DIFFERS_FROM_SIDECAR");report.checks.sidecar="PASS"}else report.checks.sidecar="ABSENT";
// //TR: Açmadan önce: güvensiz ad, yinelenen ad, ZIP64/şifreleme reddi ve ZIP içeriği == SHA256SUMS kapsamı + SHA256SUMS.txt.
let cd;try{cd=readZipCentralDirectory(zip)}catch(e){fail("ZIP_STRUCTURE",String(e.message??e))}
const manifestEntry=cd.find(c=>c.name===ARTIFACT_MANIFEST);if(!manifestEntry)fail("ZIP_WITHOUT_SHA256SUMS");
const nl=zip.readUInt16LE(manifestEntry.offset+26),xl=zip.readUInt16LE(manifestEntry.offset+28),body=zip.subarray(manifestEntry.offset+30+nl+xl,manifestEntry.offset+30+nl+xl+manifestEntry.csize),sumsText=(manifestEntry.method===8?zlib.inflateRawSync(body):body).toString("utf8");
const sums=parseSha256Sums(sumsText);if(sums.errors.length)fail("SHA256SUMS_MALFORMED",JSON.stringify(sums.errors.slice(0,5)));
const zipNames=new Set(cd.map(c=>c.name).filter(n=>n!==ARTIFACT_MANIFEST)),listed=new Set(sums.entries.keys());
for(const n of zipNames)if(!listed.has(n))fail("ZIP_ENTRY_NOT_IN_SHA256SUMS",n);for(const n of listed)if(!zipNames.has(n))fail("SHA256SUMS_ENTRY_NOT_IN_ZIP",n);
report.checks.preExtract={status:"PASS",entries:cd.length};
fs.mkdirSync(path.dirname(dest),{recursive:true});
const run=(name,cmd,argv,extraEnv={},timeout=900000)=>{const r=cp.spawnSync(cmd,argv,{cwd:dest,encoding:"utf8",windowsHide:true,timeout,env:{...process.env,...extraEnv}});const tail=((r.stdout??"")+(r.stderr??"")).trim().split(/\r?\n/).slice(-3).join(" | ").slice(0,600);report.checks[name]={status:r.status===0?"PASS":"FAIL",exitCode:r.status,tail};if(r.status!==0){fs.writeFileSync(reportFile,JSON.stringify({...report,final:"FAIL"},null,2)+"\n");fail(`${name.toUpperCase()}_FAILED`,tail)}};
const ps=path.join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
fs.mkdirSync(dest);
{const r=cp.spawnSync(ps,["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop';Expand-Archive -LiteralPath $env:UASCO_RELEASE_ZIP -DestinationPath $env:UASCO_RELEASE_DEST"],{encoding:"utf8",windowsHide:true,timeout:900000,env:{...process.env,UASCO_RELEASE_ZIP:zipFile,UASCO_RELEASE_DEST:dest}});report.checks.expandArchive={status:r.status===0?"PASS":"FAIL",exitCode:r.status};if(r.status!==0)fail("EXPAND_ARCHIVE_FAILED",String(r.stderr??"").slice(-400))}
const post=verifySha256Sums(dest);report.checks.postExtractSha256Sums={status:post.ok?"PASS":"FAIL",failures:post.failures.slice(0,10)};if(!post.ok)fail("POST_EXTRACT_SHA256SUMS",JSON.stringify(post.failures.slice(0,5)));
run("verifyArtifactPowerShell",ps,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",path.join(dest,"scripts","verify-artifact.ps1")]);
run("verifyArtifactNode",process.execPath,["scripts/verify-artifact.mjs"]);
run("verifyTrustRoot",process.execPath,["scripts/verify-trust-root.mjs"]);
if(withValidation){run("ensureDependencies",process.execPath,["scripts/ensure-dependencies.mjs"]);run("canonicalValidation",process.execPath,["scripts/run-validation.mjs"])}
report.withValidation=withValidation;report.final="PASS";fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report,null,2));
