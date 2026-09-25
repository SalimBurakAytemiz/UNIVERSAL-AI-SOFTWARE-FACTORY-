// //TR: GitHub CLI child processleri host proxy/config enjeksiyonunu miras almaz; yalnız explicit GitHub auth/host değişkenleri kontrollü biçimde aktarılır.
import {safeChildEnv} from "./env-policy.mjs";
const EXACT_GH_ENV=["GH_TOKEN","GITHUB_TOKEN","GH_ENTERPRISE_TOKEN","GH_HOST"];
export function githubCliEnv(policyFile="config/environment-policy.json"){
  const out=safeChildEnv(policyFile,{denyNetworkOverrides:true,provider:"GITHUB"});
  for(const name of EXACT_GH_ENV)if(process.env[name]!==undefined)out[name]=process.env[name];
  return out;
}
export function redactCliText(value=""){
  let out=String(value);
  for(const name of EXACT_GH_ENV){const secret=process.env[name];if(secret&&secret.length>=4)out=out.split(secret).join("[REDACTED]")}
  return out.replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,m=>m.replace(/\/\/.*@/,"//[REDACTED]@"));
}
