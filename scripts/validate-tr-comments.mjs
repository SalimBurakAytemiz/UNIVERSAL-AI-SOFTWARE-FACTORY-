// //TR: Bu script eligible human-maintained source/config/doc dosyalarının ilk bölümünde literal //TR amaç açıklaması bulunmasını build gate olarak denetler.
import fs from "node:fs"; import path from "node:path";
const root=process.cwd();
const exts=new Set([".ts",".tsx",".js",".mjs",".cjs",".java",".cs",".py",".ps1",".sh",".md",".yml",".yaml",".json",".jsonc",".toml",".css",".html"]);
const skip=[".git/","node_modules/","dist/","build/","coverage/",".ai/runtime/",".ai/cache/"];
const names=new Set(["package-lock.json","pnpm-lock.yaml","yarn.lock","SHA256SUMS.txt"]);
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const a=path.join(dir,e.name);const r=path.relative(root,a).replaceAll("\\","/");if(skip.some(x=>r.startsWith(x)))continue;if(e.isDirectory())walk(a,out);else out.push({a,r});}return out}
const bad=[];
for(const f of walk(root)){if(names.has(path.basename(f.r))||!exts.has(path.extname(f.r).toLowerCase()))continue;let s;try{s=fs.readFileSync(f.a,"utf8")}catch{continue};if(!s.split(/\r?\n/).slice(0,60).join("\n").includes("//TR"))bad.push(f.r);}
if(bad.length){console.error("TR_VALIDATION: FAIL");bad.forEach(x=>console.error(" - "+x));process.exit(2)}
console.log("TR_VALIDATION: PASS");
