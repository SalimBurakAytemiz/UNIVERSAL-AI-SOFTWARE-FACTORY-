// //TR: Bu script local makinede browser/mobile/cloud/build tool'larının varlığını yalnız discovery amacıyla kontrol eder ve yok olan bir aracı IMPLEMENTED gibi göstermeden health snapshot üretir.
import cp from "node:child_process";
import fs from "node:fs";
const commands=["git","node","npm","claude","codex","omniroute","docker","adb","appium","python","java","dotnet","go","cargo","flutter","kubectl","helm","terraform","tofu","ffmpeg"];
function exists(cmd){
 const checker=process.platform==="win32"?"where":"which";
 const r=cp.spawnSync(checker,[cmd],{encoding:"utf8"});
 return r.status===0;
}
const result={
 "//TR":"Bu runtime snapshot local makinede komutların bulunup bulunmadığını gösterir; bulunmak tek başına adapter certification veya health PASS anlamına gelmez.",
 discoveredAt:new Date().toISOString(),
 tools:Object.fromEntries(commands.map(c=>[c,exists(c)?"PRESENT":"MISSING"]))
};
fs.mkdirSync(".ai/runtime",{recursive:true});
fs.writeFileSync(".ai/runtime/LOCAL_TOOL_HEALTH.json",JSON.stringify(result,null,2));
console.log(result);
