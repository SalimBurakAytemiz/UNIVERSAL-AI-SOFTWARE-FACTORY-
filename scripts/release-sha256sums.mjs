// //TR: Bu maintainer release script'i SEALED ve doğrulanmış trust-root taşıyan temiz bir export dizini (git archive) için SHA256SUMS.txt üretir; .git/node_modules/.ai/runtime/.ai/automation içeren, manifesti SEALED olmayan veya zaten SHA256SUMS taşıyan dizini fail-closed reddeder. İmza üretmez; release imzası Founder'ın harici anahtarıyla ayrıca (detached) atılır.
// usage: node scripts/release-sha256sums.mjs <exportDir>
import fs from "node:fs";import path from "node:path";
import {ARTIFACT_MANIFEST,ARTIFACT_EXCLUDED_DIRS,buildSha256Sums,sha256File} from "../automation/lib/release-artifact.mjs";
import {verifyTrustRoot} from "../automation/lib/trust-root.mjs";
const fail=(code,detail="")=>{console.error(`RELEASE_SHA256SUMS: FAIL ${code}${detail?` ${detail}`:""}`);process.exit(1)};
const dirArg=process.argv[2];if(!dirArg)fail("USAGE","node scripts/release-sha256sums.mjs <exportDir>");
const dir=path.resolve(dirArg);if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())fail("EXPORT_DIR_MISSING",dir);
for(const d of ARTIFACT_EXCLUDED_DIRS)if(fs.existsSync(path.join(dir,d)))fail("SOURCE_NOT_CLEAN_EXPORT",d);
if(fs.existsSync(path.join(dir,ARTIFACT_MANIFEST)))fail("MANIFEST_ALREADY_PRESENT");
let tr;try{tr=verifyTrustRoot(dir)}catch(e){fail("TRUST_ROOT_UNREADABLE",String(e.message??e))}
if(!tr.ok||tr.sealStatus!=="SEALED")fail("TRUST_ROOT_NOT_SEALED_OR_INVALID",JSON.stringify(tr.mismatches.slice(0,5)));
let built;try{built=buildSha256Sums(dir)}catch(e){fail("BUILD_REFUSED",String(e.message??e))}
fs.writeFileSync(path.join(dir,ARTIFACT_MANIFEST),built.text,{flag:"wx"});
console.log(JSON.stringify({"//TR":"Bu çıktı üretilen SHA256SUMS.txt'nin kapsamını ve hash'ini özetler; authenticity iddiası değildir.",status:"PASS",exportDir:dir,entries:built.files.length,sha256SumsSha256:built.sha256,trustRootManifestSha256:sha256File(path.join(dir,"config/trust-root-manifest.json")),protectedFilesVerified:tr.mismatches.length===0},null,2));
