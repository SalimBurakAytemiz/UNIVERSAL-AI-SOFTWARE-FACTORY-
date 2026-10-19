// //TR: Bu maintainer release script'i SHA256SUMS.txt taşıyan temiz export dizininden deterministik final ZIP üretir: paketlemeden önce trust-root SEALED doğrulamasını ve SHA256SUMS'ın dosya kümesi/içerik eşleşmesini yeniden yapar, yalnız listelenen dosyaları ve SHA256SUMS.txt'yi paketler, sonra ZIP'i geri okuyup giriş/CRC/boyut eşleşmesini doğrular. İmza üretmez; ZIP ve SHA256SUMS Founder'ın harici anahtarıyla detached imzalanır.
// usage: node scripts/build-release-zip.mjs <exportDir> <outZip> [--source-commit <40-hex>]
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import zlib from "node:zlib";
import {ARTIFACT_MANIFEST,ARTIFACT_EXCLUDED_DIRS,verifySha256Sums,writeDeterministicZip,readZipCentralDirectory,crc32,sha256File} from "../automation/lib/release-artifact.mjs";
import {verifyTrustRoot} from "../automation/lib/trust-root.mjs";
// //TR: process.exit() kullanilmaz: Linux CI'da agir dosya hash'lemesinden hemen sonra process.exit(1), Node 24 kapanisinda ana is parcacigini V8 platform is parcacigina pthread_join ile kilitliyordu (ci/diagnose-shards: takilan surec futex/pthread_join; exitCode + dogal sonlanma A/B 0/16 takilma vs 2/8). Cikis kodu (1) ve cikti ayni; yalniz sonlanma yolu degisir.
class ReleaseFail extends Error{}
const fail=(code,detail="")=>{console.error(`RELEASE_ZIP: FAIL ${code}${detail?` ${detail}`:""}`);process.exitCode=1;throw new ReleaseFail(code)};
function main(){
const args=process.argv.slice(2),ci=args.indexOf("--source-commit");let sourceCommit=null;if(ci!==-1){sourceCommit=args[ci+1]??"";args.splice(ci,2);if(!/^[0-9a-f]{40}$/.test(sourceCommit))fail("SOURCE_COMMIT_NOT_FULL_SHA")}
const [dirArg,zipArg]=args;if(!dirArg||!zipArg)fail("USAGE","node scripts/build-release-zip.mjs <exportDir> <outZip> [--source-commit <sha>]");
const dir=path.resolve(dirArg),out=path.resolve(zipArg),sidecar=`${out}.release.json`;
if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())fail("EXPORT_DIR_MISSING",dir);
if(out===dir||out.startsWith(dir+path.sep))fail("ZIP_INSIDE_EXPORT_DIR");if(fs.existsSync(out)||fs.existsSync(sidecar))fail("OUTPUT_ALREADY_EXISTS");
for(const d of ARTIFACT_EXCLUDED_DIRS)if(fs.existsSync(path.join(dir,d)))fail("SOURCE_NOT_CLEAN_EXPORT",d);
let tr;try{tr=verifyTrustRoot(dir)}catch(e){fail("TRUST_ROOT_UNREADABLE",String(e.message??e))}if(!tr.ok||tr.sealStatus!=="SEALED")fail("TRUST_ROOT_NOT_SEALED_OR_INVALID",JSON.stringify(tr.mismatches.slice(0,5)));
const sums=verifySha256Sums(dir);if(!sums.ok)fail("SHA256SUMS_DOES_NOT_MATCH_EXPORT",JSON.stringify(sums.failures.slice(0,10)));
const manifestSha=sha256File(path.join(dir,"config/trust-root-manifest.json"));if(sums.entries.get("config/trust-root-manifest.json")!==manifestSha)fail("SHA256SUMS_NOT_BOUND_TO_SEALED_MANIFEST");
const names=[...sums.entries.keys(),ARTIFACT_MANIFEST].sort((a,b)=>a<b?-1:a>b?1:0);
const entries=names.map(name=>({name,data:fs.readFileSync(path.join(dir,name))}));
const zip=writeDeterministicZip(entries,{deflate:d=>zlib.deflateRawSync(d,{level:9})});
// //TR: Yazılan ZIP diske gitmeden önce geri okunur; her giriş SHA256SUMS ile aynı ad/CRC/boyutu taşımalıdır.
const cd=readZipCentralDirectory(zip);if(cd.length!==entries.length)fail("ZIP_SELF_CHECK_COUNT");
for(let i=0;i<cd.length;i++){const c=cd[i],e=entries[i];if(c.name!==e.name||c.usize!==e.data.length||c.crc!==crc32(e.data))fail("ZIP_SELF_CHECK_ENTRY",c.name);const nl=zip.readUInt16LE(c.offset+26),xl=zip.readUInt16LE(c.offset+28),body=zip.subarray(c.offset+30+nl+xl,c.offset+30+nl+xl+c.csize),data=c.method===8?zlib.inflateRawSync(body):body;if(!data.equals(e.data))fail("ZIP_SELF_CHECK_CONTENT",c.name)}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,zip,{flag:"wx"});
const report={"//TR":"Bu sidecar deterministik final ZIP'in kapsamını ve hash'lerini kaydeder; authenticity iddiası değildir, ZIP ve SHA256SUMS Founder'ın harici anahtarıyla ayrıca imzalanmalıdır.",schemaVersion:"1.0.0",zipFile:path.basename(out),zipSha256:crypto.createHash("sha256").update(zip).digest("hex"),zipBytes:zip.length,entries:entries.length,sha256SumsSha256:sha256File(path.join(dir,ARTIFACT_MANIFEST)),trustRootManifestSha256:manifestSha,trustRootProtectedFiles:JSON.parse(fs.readFileSync(path.join(dir,"config/trust-root-manifest.json"),"utf8")).files.length,sourceCommitDeclared:sourceCommit,deterministic:{timestamp:"1980-01-01T00:00:00 (DOS)",order:"byte order",compression:"raw DEFLATE level 9 when smaller, else STORE",node:process.version,zlib:process.versions.zlib},releaseAuthenticity:"EXTERNAL_DETACHED_SIGNATURE_REQUIRED"};
fs.writeFileSync(sidecar,JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report,null,2));
}
try{main()}catch(e){if(!(e instanceof ReleaseFail))throw e}
