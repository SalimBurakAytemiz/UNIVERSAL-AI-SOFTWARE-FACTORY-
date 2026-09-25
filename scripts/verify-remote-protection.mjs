// //TR: Bu target-machine check GitHub origin varsa private visibility ve main branch protection'ın exact güvenlik kurallarını doğrular; yalnız HTTP 200 ile PASS üretmez.
import fs from "node:fs";import cp from "node:child_process";import {githubCliEnv,redactCliText} from "../automation/lib/github-cli-env.mjs";import {spawnGitSync} from "../automation/lib/git-isolation.mjs";import {evaluateRemoteProtection} from "../automation/lib/remote-protection.mjs";
const env=githubCliEnv();
function run(c,a){const r=cp.spawnSync(c,a,{encoding:"utf8",windowsHide:true,env});return {status:r.status,stdout:r.stdout??"",stderr:redactCliText(r.stderr??"")}}
const gitRemote=spawnGitSync(process.cwd(),["remote","get-url","origin"],{env});const url={status:gitRemote.status,stdout:gitRemote.stdout??"",stderr:redactCliText(gitRemote.stderr??"")};let report={"//TR":"Bu runtime report remote privacy/protection doğrulamasını taşır.",checkedAt:new Date().toISOString(),status:"LOCAL_ONLY",detail:"No origin"};
if(url.status===0){
 const gh=run("gh",["repo","view","--json","nameWithOwner,visibility,url"]);
 if(gh.status===0){
  const repo=JSON.parse(gh.stdout);
  if(repo.visibility!=="PRIVATE") report={...report,status:"BLOCKED",detail:"Remote is not private",repo:repo.nameWithOwner};
  else{
   const pr=run("gh",["api",`repos/${repo.nameWithOwner}/branches/main/protection`]);
   if(pr.status!==0) report={...report,status:"LOCAL_ONLY",detail:"Private remote but branch protection not verified/configured",repo:repo.nameWithOwner};
   else{let doc;try{doc=JSON.parse(pr.stdout)}catch{}const verdict=evaluateRemoteProtection(doc);report={...report,status:verdict.ok?"PASS":"LOCAL_ONLY",detail:verdict.ok?"Private remote + exact branch protection verified":`Protection rules insufficient: ${verdict.errors.join(",")}`,repo:repo.nameWithOwner,checks:verdict};}
  }
 }else report={...report,status:"LOCAL_ONLY",detail:"gh CLI/auth unavailable; remote protection unverified"};
}
fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/REMOTE_PROTECTION.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(report.status==="BLOCKED")process.exit(1);
