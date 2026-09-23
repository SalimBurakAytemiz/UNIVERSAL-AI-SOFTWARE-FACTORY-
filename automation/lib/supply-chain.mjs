// //TR: Bu helper reviewed npm lock/root sync, resmi registry/integrity ve installed package identity/version/license metadata kontrollerini deterministik uygular.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {dependencyState} from "./dependency-install.mjs";
const sha256=b=>crypto.createHash("sha256").update(b).digest("hex");
const nonEmpty=x=>typeof x==="string"&&x.trim().length>0;
export function validateSupplyChain(root=process.cwd(),policyFile="config/supply-chain-policy.json",{requireInstalled=true}={}){
 root=path.resolve(root);const policy=JSON.parse(fs.readFileSync(path.resolve(root,policyFile),"utf8")),lockPath=path.join(root,"package-lock.json"),errors=[],state=dependencyState(root),lock=JSON.parse(fs.readFileSync(lockPath,"utf8")),components=[];
 const allowed=new Set((policy.allowedRegistryHosts??[]).map(x=>String(x).toLowerCase()));
 for(const [rel,entry] of Object.entries(lock.packages??{})){
   if(rel==="")continue;if(!rel.includes("node_modules/")){errors.push(`LOCK_PACKAGE_PATH_UNEXPECTED:${rel}`);continue}
   const name=rel.slice(rel.lastIndexOf("node_modules/")+13);const version=entry?.version;
   if(!nonEmpty(name)||!nonEmpty(version))errors.push(`LOCK_PACKAGE_IDENTITY_MISSING:${rel}`);
   if(entry?.link===true)errors.push(`LOCK_LINK_PACKAGE_DENIED:${rel}`);
   if(entry?.resolved){try{const u=new URL(String(entry.resolved));if(policy.requireHttpsRegistry===true&&u.protocol!=="https:")errors.push(`REGISTRY_PROTOCOL_DENIED:${rel}:${u.protocol}`);if(!allowed.has(u.hostname.toLowerCase()))errors.push(`REGISTRY_HOST_DENIED:${rel}:${u.hostname}`);if(u.username||u.password)errors.push(`REGISTRY_URL_CREDENTIAL_DENIED:${rel}`)}catch{errors.push(`REGISTRY_URL_INVALID:${rel}`)}}else errors.push(`RESOLVED_URL_MISSING:${rel}`);
   if(policy.requireTransitiveIntegrity===true&&!nonEmpty(entry?.integrity))errors.push(`TRANSITIVE_INTEGRITY_MISSING:${rel}`);
   let installed={status:"NOT_CHECKED",name:null,version:null,license:null,packageJsonSha256:null};const installedPkg=path.join(root,rel,"package.json");
   if(fs.existsSync(installedPkg)){try{const bytes=fs.readFileSync(installedPkg),j=JSON.parse(bytes);installed={status:"PRESENT",name:j.name??null,version:j.version??null,license:j.license??null,packageJsonSha256:sha256(bytes)};if(policy.requireInstalledPackageIdentity===true&&(j.name!==name||j.version!==version))errors.push(`INSTALLED_IDENTITY_MISMATCH:${rel}:${j.name??"?"}@${j.version??"?"}:${name}@${version}`);if(policy.requireInstalledLicenseMetadata===true&&!nonEmpty(j.license))errors.push(`INSTALLED_LICENSE_MISSING:${rel}`)}catch{errors.push(`INSTALLED_PACKAGE_JSON_INVALID:${rel}`)}}
   else if(requireInstalled&&entry?.optional!==true)errors.push(`INSTALLED_PACKAGE_MISSING:${rel}`);
   components.push({path:rel,name,version:version??null,integrity:entry?.integrity??null,resolved:entry?.resolved??null,installed});
 }
 if(requireInstalled&&!fs.existsSync(path.join(root,"node_modules")))errors.push("NODE_MODULES_MISSING_FOR_INSTALLED_SUPPLY_CHAIN_VALIDATION");
 return {ok:errors.length===0,errors,lockSha256:state.lockSha256,packageSha256:state.packageSha256,components,policy};
}
export function evaluateAuditDocument(doc,blockingSeverities=["moderate","high","critical"]){
 const blocking=new Set(blockingSeverities.map(x=>String(x).toLowerCase())),blockers=[],low=[];
 for(const [name,v] of Object.entries(doc?.vulnerabilities??{})){const severity=String(v?.severity??"unknown").toLowerCase(),row={name,severity,isDirect:v?.isDirect===true,via:v?.via??[],range:v?.range??null,nodes:v?.nodes??[],fixAvailable:v?.fixAvailable??null};if(blocking.has(severity))blockers.push(row);else if(severity==="low")low.push(row);else blockers.push({...row,severity:`unknown:${severity}`})}
 return {blockers,low};
}
