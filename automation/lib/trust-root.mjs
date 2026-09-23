// //TR: Bu helper normal feature build'in constitution/reviewer/validator/supervisor trust-root'unu değiştirerek sahte PASS üretmesini hash manifest ve protected-path guard ile engeller.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const h=s=>crypto.createHash("sha256").update(s).digest("hex");
export function fileHash(file){return h(fs.readFileSync(file))}
function matchesPrefix(p,prefix){return p===prefix||p.startsWith(prefix.endsWith("/")?prefix:`${prefix}/`)}

export function verifyTrustRoot(repoRoot,manifestPath="config/trust-root-manifest.json"){
  const manifest=JSON.parse(fs.readFileSync(path.join(repoRoot,manifestPath),"utf8"));
  const mismatches=[];
  for(const x of manifest.files){
    const f=path.join(repoRoot,x.path);
    if(!fs.existsSync(f)){mismatches.push({path:x.path,reason:"MISSING"});continue}
    const actual=fileHash(f);
    if(actual!==x.sha256)mismatches.push({path:x.path,reason:"HASH_MISMATCH",expected:x.sha256,actual});
  }
  return {ok:mismatches.length===0,mismatches,manifestVersion:manifest.schemaVersion};
}
export function protectedChangeViolations(changed,policy,governanceChange=false){
  if(governanceChange) return [];
  return changed.filter(p =>
    (policy.exactPaths??[]).includes(p) ||
    (policy.protectedPrefixes??[]).some(pre=>matchesPrefix(p,pre))
  );
}
