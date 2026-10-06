// //TR: Bu selftest hedef makinede kurulu OmniRoute'un config/omniroute-policy.json ile uyumunu salt okunur doğrular: global paket adı, izinli lisans, beklenen depo kimliği, Node sürümünün paketin engines aralığına uyması, PATH'teki başlatıcının npm global öneki içinde olması ve policy uç noktasının yalnız izinli yerel host üzerinde olması; OmniRoute'u başlatmaz, uç nokta çalışmıyorsa bunu NOT_RUNNING olarak dürüstçe raporlar, kurulu değilse NOT_INSTALLED ile atlar.
import fs from "node:fs";import path from "node:path";import cp from "node:child_process";import http from "node:http";import {pathToFileURL} from "node:url";
import {resolveNpmInvocation} from "../automation/lib/npm-invocation.mjs";
// //TR: npm çağrısı spawnSync sonucunu olduğu gibi döndürür; çağrı çözümlenemezse (ör. npm-cli.js yok) bu da bir hata sonucu olarak taşınır ve hiçbir başarısızlık "kurulu değil" ile karıştırılmaz.
const runNpm=(args)=>{let inv;try{inv=resolveNpmInvocation()}catch(e){return {error:e,status:null,signal:null,stdout:""}}return cp.spawnSync(inv.command,[...inv.prefixArgs,...args],{encoding:"utf8",windowsHide:true,timeout:30000})};
const npm=(args)=>{const r=runNpm(args);return !r.error&&r.status===0?String(r.stdout).trim():null};
// //TR: F-T3-003: `npm root -g` ölçümü yalnız sıfır çıkış koduyla, hatasız ve tam olarak tek satırlık mutlak, var olan bir dizin verdiğinde kullanılabilir; spawn hatası, zaman aşımı, sinyal, sıfır olmayan çıkış, boş/çok satırlı/göreli çıktı veya dizin olmayan yol UNAVAILABLE sayılır ve asla dürüst atlama (SKIP) olarak raporlanmaz.
export function classifyNpmRoot(r){const tok=v=>String(v).replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,64);
  if(r?.error){const c=r.error.code??String(r.error.message??r.error).split(":")[0];return {ok:false,reason:c==="ETIMEDOUT"?"TIMEOUT":`SPAWN_ERROR_${tok(c)}`}}
  if(r?.status!==0)return {ok:false,reason:r?.status==null?(r?.signal?`SIGNAL_${tok(r.signal)}`:"NO_EXIT_STATUS"):`EXIT_${tok(r.status)}`};
  const lines=String(r.stdout??"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(lines.length!==1)return {ok:false,reason:lines.length?"MULTIPLE_LINES":"EMPTY_OUTPUT"};
  const root=lines[0];if(!path.isAbsolute(root))return {ok:false,reason:"NOT_ABSOLUTE"};let st;try{st=fs.statSync(root)}catch{return {ok:false,reason:"NOT_FOUND"}}
  return st.isDirectory()?{ok:true,root}:{ok:false,reason:"NOT_DIRECTORY"}}
// //TR: Basit semver aralık denetimi ("A <B || >=C <D" biçimi); aralığın tamamı önce sözdizimsel olarak doğrulanır, boş alternatif veya tanınmayan tek bir ifade bile UNKNOWN döndürür ve PASS sayılmaz.
const COMPARATOR=/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/;
export function satisfies(version,range){const vm=String(version).match(/^v?(\d+)\.(\d+)\.(\d+)$/);if(!vm)return "UNKNOWN";const v=vm.slice(1).map(Number);const cmp=(a,b)=>{for(let i=0;i<3;i++){if((a[i]??0)!==(b[i]??0))return (a[i]??0)-(b[i]??0)}return 0};
  const alts=String(range).split("||").map(s=>s.trim());if(!alts.length||alts.some(a=>!a))return "UNKNOWN";
  const parsed=alts.map(alt=>alt.split(/\s+/).map(c=>c.match(COMPARATOR)));if(parsed.some(alt=>alt.some(m=>!m)))return "UNKNOWN";
  return parsed.some(alt=>alt.every(m=>{const d=cmp(v,m[2].split(".").map(Number));return {">=":d>=0,"<=":d<=0,">":d>0,"<":d<0,"=":d===0,undefined:d===0}[m[1]]}))}
// //TR: Uç nokta yalnız izinli yerel host üzerindeyse yoklanır; izinsiz veya geçersiz host için hiçbir ağ isteği yapılmaz.
export async function checkEndpoint(policy,probeFn){let host=null;try{host=new URL(policy.endpoint).hostname.replace(/^\[|\]$/g,"")}catch{}const allowed=host!==null&&policy.allowedGatewayHosts.includes(host);return {check:allowed?"PASS":"FAIL",host,state:allowed?await probeFn(policy.endpoint):"NOT_PROBED_DISALLOWED_HOST"}}
const probe=url=>new Promise(res=>{let u;try{u=new URL(url.replace(/\/$/,"")+"/models")}catch{return res("INVALID_ENDPOINT")}const req=http.get(u,{timeout:2000},r=>{r.resume();res(r.statusCode>=200&&r.statusCode<500?"REACHABLE":`HTTP_${r.statusCode}`)});req.on("timeout",()=>{req.destroy();res("NOT_RUNNING")});req.on("error",()=>res("NOT_RUNNING"))});
// //TR: Ana akış yalnız script doğrudan çalıştırıldığında devreye girer; import eden testler yalnız yardımcıları kullanır.
async function main(){const policy=JSON.parse(fs.readFileSync("config/omniroute-policy.json","utf8")),report={checks:{}};
// //TR: Global kök ölçülemezse altı denetim sessizce düşürülmez: ayrı FAIL NPM_ROOT_UNAVAILABLE durumu ve sıfır olmayan çıkış kodu verilir; SKIP NOT_INSTALLED yalnız doğrulanmış kökte paket yoksa kullanılır.
const rootResult=classifyNpmRoot(runNpm(["root","-g"]));
if(!rootResult.ok){console.log(JSON.stringify({status:"FAIL",reason:"NPM_ROOT_UNAVAILABLE",detail:rootResult.reason,npmRoot:null},null,2));console.log(`OMNIROUTE_INSTALL_COMPAT: FAIL NPM_ROOT_UNAVAILABLE reason=${rootResult.reason}`);process.exitCode=1;return}
const root=rootResult.root,prefix=npm(["prefix","-g"]),pkgFile=path.join(root,policy.packageName,"package.json");
if(!fs.existsSync(pkgFile)){console.log(JSON.stringify({status:"NOT_INSTALLED",npmRoot:root},null,2));console.log("OMNIROUTE_INSTALL_COMPAT: SKIP NOT_INSTALLED");process.exit(0)}
const pkg=JSON.parse(fs.readFileSync(pkgFile,"utf8")),repoUrl=typeof pkg.repository==="string"?pkg.repository:String(pkg.repository?.url??"");
report.installed={name:pkg.name,version:pkg.version,license:pkg.license,repository:repoUrl,engines:pkg.engines?.node??null};
report.checks.identity=pkg.name===policy.packageName?"PASS":"FAIL";report.checks.license=policy.allowedLicenses.includes(String(pkg.license))?"PASS":"FAIL";
report.checks.repository=policy.expectedRepositorySubstrings.some(s=>repoUrl.includes(s))?"PASS":"FAIL";
const eng=pkg.engines?.node?satisfies(process.version,pkg.engines.node):"NO_ENGINES_FIELD";report.checks.nodeEngine=eng===true?"PASS":eng===false?"FAIL":`UNKNOWN(${eng})`;
const where=cp.spawnSync(process.platform==="win32"?"where.exe":"which",[policy.packageName],{encoding:"utf8",windowsHide:true}),launchers=String(where.stdout??"").split(/\r?\n/).filter(Boolean);
const under=p=>prefix&&path.resolve(p).toLowerCase().startsWith(path.resolve(prefix).toLowerCase()+path.sep);report.launchers=launchers;report.checks.launcherUnderGlobalPrefix=launchers.length&&launchers.every(under)?"PASS":"FAIL";
const ep=await checkEndpoint(policy,probe);report.checks.endpointLocalOnly=ep.check;
report.endpoint={url:policy.endpoint,state:ep.state,note:"informational: OmniRoute is not started by this test; provider routing through OmniRoute needs it running with credentials"};
const failed=Object.entries(report.checks).filter(([,v])=>v!=="PASS");report.status=failed.length?"FAIL":"PASS";console.log(JSON.stringify(report,null,2));console.log(`OMNIROUTE_INSTALL_COMPAT: ${report.status} ${Object.keys(report.checks).length-failed.length}/${Object.keys(report.checks).length} endpoint=${report.endpoint.state}`);if(failed.length)process.exit(1)}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
