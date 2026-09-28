// //TR: Bu selftest hedef makinede kurulu OmniRoute'un config/omniroute-policy.json ile uyumunu salt okunur doğrular: global paket adı, izinli lisans, beklenen depo kimliği, Node sürümünün paketin engines aralığına uyması, PATH'teki başlatıcının npm global öneki içinde olması ve policy uç noktasının yalnız izinli yerel host üzerinde olması; OmniRoute'u başlatmaz, uç nokta çalışmıyorsa bunu NOT_RUNNING olarak dürüstçe raporlar, kurulu değilse NOT_INSTALLED ile atlar.
import fs from "node:fs";import path from "node:path";import cp from "node:child_process";import http from "node:http";import {pathToFileURL} from "node:url";
import {resolveNpmInvocation} from "../automation/lib/npm-invocation.mjs";
const npm=(args)=>{const inv=resolveNpmInvocation();const r=cp.spawnSync(inv.command,[...inv.prefixArgs,...args],{encoding:"utf8",windowsHide:true,timeout:30000});return r.status===0?String(r.stdout).trim():null};
// //TR: Basit semver aralık denetimi ("A <B || >=C <D" biçimi); tanınmayan ifade UNKNOWN döner ve PASS sayılmaz.
export function satisfies(version,range){const v=String(version).replace(/^v/,"").split(".").map(Number);const cmp=(a,b)=>{for(let i=0;i<3;i++){if((a[i]??0)!==(b[i]??0))return (a[i]??0)-(b[i]??0)}return 0};
  const alts=String(range).split("||").map(s=>s.trim()).filter(Boolean);if(!alts.length)return "UNKNOWN";let known=true;
  const ok=alts.some(alt=>alt.split(/\s+/).every(c=>{const m=c.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/);if(!m){known=false;return false}const t=m[2].split(".").map(Number),d=cmp(v,t);return {">=":d>=0,"<=":d<=0,">":d>0,"<":d<0,"=":d===0,undefined:d===0}[m[1]]}));return ok?true:(known?false:"UNKNOWN")}
const probe=url=>new Promise(res=>{let u;try{u=new URL(url.replace(/\/$/,"")+"/models")}catch{return res("INVALID_ENDPOINT")}const req=http.get(u,{timeout:2000},r=>{r.resume();res(r.statusCode>=200&&r.statusCode<500?"REACHABLE":`HTTP_${r.statusCode}`)});req.on("timeout",()=>{req.destroy();res("NOT_RUNNING")});req.on("error",()=>res("NOT_RUNNING"))});
// //TR: Ana akış yalnız script doğrudan çalıştırıldığında devreye girer; import eden testler yalnız yardımcıları kullanır.
async function main(){const policy=JSON.parse(fs.readFileSync("config/omniroute-policy.json","utf8")),report={checks:{}};
const root=npm(["root","-g"]),prefix=npm(["prefix","-g"]),pkgFile=root?path.join(root,policy.packageName,"package.json"):null;
if(!pkgFile||!fs.existsSync(pkgFile)){console.log(JSON.stringify({status:"NOT_INSTALLED",npmRoot:root},null,2));console.log("OMNIROUTE_INSTALL_COMPAT: SKIP NOT_INSTALLED");process.exit(0)}
const pkg=JSON.parse(fs.readFileSync(pkgFile,"utf8")),repoUrl=typeof pkg.repository==="string"?pkg.repository:String(pkg.repository?.url??"");
report.installed={name:pkg.name,version:pkg.version,license:pkg.license,repository:repoUrl,engines:pkg.engines?.node??null};
report.checks.identity=pkg.name===policy.packageName?"PASS":"FAIL";report.checks.license=policy.allowedLicenses.includes(String(pkg.license))?"PASS":"FAIL";
report.checks.repository=policy.expectedRepositorySubstrings.some(s=>repoUrl.includes(s))?"PASS":"FAIL";
const eng=pkg.engines?.node?satisfies(process.version,pkg.engines.node):"NO_ENGINES_FIELD";report.checks.nodeEngine=eng===true?"PASS":eng===false?"FAIL":`UNKNOWN(${eng})`;
const where=cp.spawnSync(process.platform==="win32"?"where.exe":"which",[policy.packageName],{encoding:"utf8",windowsHide:true}),launchers=String(where.stdout??"").split(/\r?\n/).filter(Boolean);
const under=p=>prefix&&path.resolve(p).toLowerCase().startsWith(path.resolve(prefix).toLowerCase()+path.sep);report.launchers=launchers;report.checks.launcherUnderGlobalPrefix=launchers.length&&launchers.every(under)?"PASS":"FAIL";
let host=null;try{host=new URL(policy.endpoint).hostname.replace(/^\[|\]$/g,"")}catch{}report.checks.endpointLocalOnly=policy.allowedGatewayHosts.includes(host)?"PASS":"FAIL";
report.endpoint={url:policy.endpoint,state:await probe(policy.endpoint),note:"informational: OmniRoute is not started by this test; provider routing through OmniRoute needs it running with credentials"};
const failed=Object.entries(report.checks).filter(([,v])=>v!=="PASS");report.status=failed.length?"FAIL":"PASS";console.log(JSON.stringify(report,null,2));console.log(`OMNIROUTE_INSTALL_COMPAT: ${report.status} ${Object.keys(report.checks).length-failed.length}/${Object.keys(report.checks).length} endpoint=${report.endpoint.state}`);if(failed.length)process.exit(1)}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
