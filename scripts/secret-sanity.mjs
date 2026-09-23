// //TR: Bu cross-platform CI helper committed source içinde yaygın private-key/access-key/token pattern'lerini tarar; full secret scanning engine'in yerini almaz ama baseline gate sağlar.
import fs from "node:fs";
import path from "node:path";
const patterns=[
  ["PRIVATE_KEY",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS_ACCESS_KEY",/\bAKIA[0-9A-Z]{16}\b/],
  ["GITHUB_TOKEN",/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ["ANTHROPIC_KEY",/\bsk-ant-[A-Za-z0-9_-]{16,}\b/],
  ["OPENAI_STYLE_KEY",/\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["BEARER_TOKEN",/\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}\b/],
  ["GENERIC_SECRET_ASSIGNMENT",/\b(?:password|secret|api[_-]?key|token)\s*[:=]\s*["\']?[A-Za-z0-9._~+\/=-]{16,}/i]
];
const ignorePrefixes=[".git/","node_modules/",".ai/runtime/",".ai/automation/"];
const ignoreNames=new Set(["package-lock.json"]);
const findings=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),rel=path.relative(".",p).replaceAll("\\","/");if(ignorePrefixes.some(x=>rel===x.slice(0,-1)||rel.startsWith(x)))continue;if(e.isDirectory())walk(p);else if(!ignoreNames.has(e.name)){let s;try{s=fs.readFileSync(p,"utf8")}catch{continue}for(const [type,re] of patterns)if(re.test(s))findings.push({type,path:rel})}}}
walk(".");
if(findings.length){console.error(JSON.stringify(findings,null,2));process.exit(1)}
console.log("SECRET_SANITY: PASS");
