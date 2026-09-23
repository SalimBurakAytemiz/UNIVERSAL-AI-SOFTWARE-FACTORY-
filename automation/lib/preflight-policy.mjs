// //TR: Bu helper target-machine preflight gözlemlerini protected policy ile deterministik değerlendirir; versiyon/RAM/disk/port/TLS/clock gereksinimleri fail-closed kalır.
const num=x=>Number.parseInt(String(x),10);
export function normalizeVersion(raw){const m=String(raw??"").match(/(\d+)\.(\d+)(?:\.(\d+))?/);return m?`${num(m[1])}.${num(m[2])}.${num(m[3]??0)}`:null}
export function versionAtLeast(actual,minimum){const a=normalizeVersion(actual),m=normalizeVersion(minimum);if(!a||!m)return false;const av=a.split(".").map(Number),mv=m.split(".").map(Number);for(let i=0;i<3;i++){if(av[i]>mv[i])return true;if(av[i]<mv[i])return false}return true}
const row=(status,detail)=>({status,detail});
export function evaluatePreflightBaseline(observed,policy){
 const checks={};const mins=policy.minimumVersions??{};
 for(const [key,label] of [["node","Node"],["npm","npm"],["git","Git"]]){const actual=observed.versions?.[key]??null,min=mins[key];checks[key]=versionAtLeast(actual,min)?row("PASS",`${actual}; required >=${min}`):row("BLOCKED",`${actual??"missing"}; required >=${min}`)}
 if(observed.platform==="win32"){const actual=observed.versions?.powershell??null,min=mins.powershell;checks.powershell=versionAtLeast(actual,min)?row("PASS",`${actual}; required >=${min}`):row("BLOCKED",`${actual??"missing"}; required >=${min}`)}else checks.powershell=row("WARN",`non-Windows source/preflight environment (${observed.platform}); target requires PowerShell >=${mins.powershell}`);
 const mem=Number(observed.totalMemoryGb);checks.memory=Number.isFinite(mem)&&mem>=policy.minimumMemoryGb?row("PASS",`total=${mem.toFixed(1)}GB; required >=${policy.minimumMemoryGb}GB`):row("BLOCKED",`total=${Number.isFinite(mem)?mem.toFixed(1):"unknown"}GB; required >=${policy.minimumMemoryGb}GB`);
 const disk=Number(observed.freeDiskGb);checks.disk=Number.isFinite(disk)&&disk>=policy.minimumFreeDiskGb?row("PASS",`free=${disk.toFixed(1)}GB; required >=${policy.minimumFreeDiskGb}GB`):row("BLOCKED",`free=${Number.isFinite(disk)?disk.toFixed(1):"unknown"}GB; required >=${policy.minimumFreeDiskGb}GB`);
 const len=Number(observed.repoPathLength);checks.repoPath=Number.isFinite(len)&&len<=policy.maximumRepoPathLength?row("PASS",`length=${len}; max=${policy.maximumRepoPathLength}`):row("BLOCKED",`length=${Number.isFinite(len)?len:"unknown"}; max=${policy.maximumRepoPathLength}`);
 checks.utf8=observed.utf8RoundTrip===true?row("PASS","UTF-8 filesystem round-trip verified"):row("BLOCKED","UTF-8 filesystem round-trip failed");
 for(const port of policy.requiredPorts??[]){const free=observed.ports?.[String(port)]===true;checks[`port:${port}`]=free?row("PASS","port free before service startup"):row("BLOCKED","required startup port is occupied or unavailable")}
 checks.registryTls=observed.registryTls?.ok===true?row("PASS",observed.registryTls.detail??"registry TLS probe passed"):row("BLOCKED",observed.registryTls?.detail??"registry TLS probe failed");
 const names=Array.isArray(observed.proxyEnvNames)?observed.proxyEnvNames:[];checks.proxyObservation=names.length?row("WARN",`proxy configuration observed: ${names.join(",")}; values intentionally not logged`):row("PASS","no proxy environment variables observed");
 if(observed.platform==="win32"&&policy.requireWindowsClockSync===true)checks.clockSync=observed.clockSync?.ok===true?row("PASS",observed.clockSync.detail??"Windows clock sync query passed"):row("BLOCKED",observed.clockSync?.detail??"Windows clock sync query failed");else checks.clockSync=row("WARN","Windows clock sync verification deferred to target machine");
 return {checks,blocked:Object.entries(checks).filter(([,v])=>v.status==="BLOCKED").map(([k])=>k)};
}
