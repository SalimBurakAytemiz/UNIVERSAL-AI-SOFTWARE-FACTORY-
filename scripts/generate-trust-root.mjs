// //TR: Bu maintainer-only script protected path policy'deki mevcut dosyaların SHA-256 manifestini artifact creation/governance change sırasında üretir; normal builder run bunu çağırmaz.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const policy=JSON.parse(fs.readFileSync("config/protected-paths.json","utf8"));
const all=[];
function walk(dir){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name),rel=p.replaceAll("\\","/");
  if(e.isDirectory())walk(p);else all.push(rel);
 }
}
walk(".");
const normalized=all.map(x=>x.replace(/^\.\//,"")).filter(x=>x!=="config/trust-root-manifest.json"&&x!=="SHA256SUMS.txt");
const selfPath="config/trust-root-manifest.json";const selected=new Set(policy.exactPaths.filter(x=>x!==selfPath&&fs.existsSync(x)));
for(const p of normalized) for(const pre of policy.protectedPrefixes??[]) if(p!==selfPath&&(p===pre||p.startsWith(pre.endsWith("/")?pre:`${pre}/`))) selected.add(p);
const files=[...selected].sort().map(p=>({path:p,sha256:crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}));
const doc={"//TR":"Bu manifest normal feature build sırasında korunacak trust-root dosyalarının artifact-creation anındaki SHA-256 değerlerini taşır.",schemaVersion:"1.0.0",generatedAt:new Date().toISOString(),sealStatus:"SEALED",files};
fs.writeFileSync("config/trust-root-manifest.json",JSON.stringify(doc,null,2)+"\n");
console.log(`TRUST_ROOT_MANIFEST_GENERATED files=${files.length}`);
