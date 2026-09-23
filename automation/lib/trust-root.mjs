// //TR: Bu helper protected trust-root'u hash manifest + policy coverage ile doğrular; filename-prefix kaçışını kapatır ve final reseal yapılmadan current manifesti geçerli saymaz.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";
const h=s=>crypto.createHash("sha256").update(s).digest("hex");
export function fileHash(file){return h(fs.readFileSync(file))}
function norm(p){return String(p).replaceAll("\\","/").replace(/^\.\//,"")}
function matchesPrefix(p,prefix){p=norm(p);prefix=norm(prefix);return p.startsWith(prefix)}
function walkFiles(root,dir=""){const abs=path.join(root,dir);if(!fs.existsSync(abs))return [];const out=[];for(const e of fs.readdirSync(abs,{withFileTypes:true})){if(e.name===".git"||e.name==="node_modules")continue;const rel=norm(path.posix.join(dir.replaceAll("\\","/"),e.name));if(e.isDirectory())out.push(...walkFiles(root,rel));else if(e.isFile())out.push(rel)}return out}
export function expectedProtectedFiles(repoRoot,policy,manifestPath="config/trust-root-manifest.json"){
 const all=walkFiles(repoRoot),expected=new Set();
 for(const p of policy.exactPaths??[])if(p!==manifestPath&&fs.existsSync(path.join(repoRoot,p)))expected.add(norm(p));
 for(const f of all)if((policy.protectedPrefixes??[]).some(pre=>matchesPrefix(f,pre))&&f!==manifestPath)expected.add(f);
 return [...expected].sort();
}
export function verifyTrustRoot(repoRoot,manifestPath="config/trust-root-manifest.json",policyPath="config/protected-paths.json"){
 const manifest=JSON.parse(fs.readFileSync(path.join(repoRoot,manifestPath),"utf8")),policy=JSON.parse(fs.readFileSync(path.join(repoRoot,policyPath),"utf8"));const mismatches=[];
 if(manifest.sealStatus!=="SEALED")mismatches.push({path:manifestPath,reason:"MANIFEST_NOT_SEALED",status:manifest.sealStatus??"UNSPECIFIED"});
 const listed=new Set((manifest.files??[]).map(x=>norm(x.path)));for(const p of expectedProtectedFiles(repoRoot,policy,manifestPath))if(!listed.has(p))mismatches.push({path:p,reason:"EXPECTED_PROTECTED_FILE_NOT_IN_MANIFEST"});
 for(const x of manifest.files??[]){const f=path.join(repoRoot,x.path);if(!fs.existsSync(f)){mismatches.push({path:x.path,reason:"MISSING"});continue}const actual=fileHash(f);if(actual!==x.sha256)mismatches.push({path:x.path,reason:"HASH_MISMATCH",expected:x.sha256,actual})}
 return {ok:mismatches.length===0,mismatches,manifestVersion:manifest.schemaVersion,sealStatus:manifest.sealStatus??"UNSPECIFIED"};
}
export function protectedChangeViolations(changed,policy,governanceChange=false){if(governanceChange)return [];return changed.filter(p=>(policy.exactPaths??[]).includes(p)||(policy.protectedPrefixes??[]).some(pre=>matchesPrefix(p,pre)))}
