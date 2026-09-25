// //TR: Bu script extracted artifact'in SHA256SUMS manifestindeki bütün source dosyalarını doğrular ve manifestte olmayan beklenmedik source file eklenmesini de bootstrap başlamadan fail-closed yakalar; bu self-manifest imza/authenticity yerine extraction consistency sağlar.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const manifestFile="SHA256SUMS.txt";
const lines=fs.readFileSync(manifestFile,"utf8").split(/\r?\n/).filter(Boolean);
const failures=[]; const expectedFiles=new Set();
for(const line of lines){
  const m=line.match(/^([0-9a-f]{64})\s{2}(.+)$/); if(!m){failures.push({line,reason:"MALFORMED"});continue}
  const [,expected,relRaw]=m; const rel=relRaw.replaceAll("\\","/");
  if(rel.startsWith("/")||rel.includes("../")){failures.push({path:rel,reason:"UNSAFE_PATH"});continue}
  expectedFiles.add(rel); const f=path.resolve(rel);
  if(!f.startsWith(path.resolve(".")+path.sep)){failures.push({path:rel,reason:"PATH_ESCAPE"});continue}
  if(!fs.existsSync(f)){failures.push({path:rel,reason:"MISSING"});continue}
  const lst=fs.lstatSync(f);if(lst.isSymbolicLink()){failures.push({path:rel,reason:"SYMLINK_NOT_ALLOWED"});continue}if(!lst.isFile()){failures.push({path:rel,reason:"NOT_REGULAR_FILE"});continue}
  const real=fs.realpathSync(f);if(!(real===path.resolve(".")||real.startsWith(path.resolve(".")+path.sep))){failures.push({path:rel,reason:"REALPATH_ESCAPE"});continue}
  const actual=crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  if(actual!==expected)failures.push({path:rel,reason:"HASH_MISMATCH",expected,actual});
}
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);const rel=path.relative(".",p).replaceAll("\\","/");if(rel===".git"||rel.startsWith(".git/")||rel==="node_modules"||rel.startsWith("node_modules/")||rel===".ai/runtime"||rel.startsWith(".ai/runtime/")||rel===".ai/automation"||rel.startsWith(".ai/automation/"))continue;if(e.isSymbolicLink())out.push(rel);else if(e.isDirectory())walk(p,out);else out.push(rel)}return out}
const actualSource=new Set(walk(".").filter(x=>x!==manifestFile));
if(!expectedFiles.has("package-lock.json"))failures.push({path:"package-lock.json",reason:"LOCKFILE_NOT_IN_ARTIFACT_MANIFEST"});
for(const rel of actualSource) if(!expectedFiles.has(rel)) failures.push({path:rel,reason:"UNLISTED_SOURCE_FILE"});
for(const rel of expectedFiles) if(!actualSource.has(rel)) failures.push({path:rel,reason:"MANIFEST_FILE_NOT_IN_SOURCE_SET"});
fs.mkdirSync(".ai/runtime",{recursive:true});
const report={"//TR":"Bu runtime report extracted artifact self-manifest consistency sonucunu kaydeder; external signature/authenticity iddiası değildir.",checkedAt:new Date().toISOString(),manifestEntries:lines.length,sourceFiles:actualSource.size,status:failures.length?"FAIL":"PASS",failures};
fs.writeFileSync(".ai/runtime/ARTIFACT_VERIFY.json",JSON.stringify(report,null,2)+"\n");
if(failures.length){console.error(JSON.stringify(report,null,2));process.exit(1)}
console.log(`ARTIFACT_VERIFY: PASS files=${lines.length}`);
