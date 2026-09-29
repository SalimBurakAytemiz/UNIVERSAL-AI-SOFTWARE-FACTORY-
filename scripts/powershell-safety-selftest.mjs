// //TR: Bu selftest Windows'ta depodaki her PowerShell betiğini PS 5.1 ayrıştırıcısıyla hatasız ayrıştırır ve güvenlik kurallarını uygular (Invoke-Expression/iex, EncodedCommand, DownloadString/DownloadFile, kalıcı Set-ExecutionPolicy yok; giriş betikleri $ErrorActionPreference="Stop"; web isteği yalnız izinli betikte ve yönlendirmesiz); ayrıca install.ps1'in iki artifact doğrulayıcısını (verify-artifact.ps1 ve verify-artifact.mjs) geçici bir ağaçta aynı kurcalamalara karşı fark testine sokar. Windows dışında dürüstçe atlar.
import fs from "node:fs";import os from "node:os";import path from "node:path";import cp from "node:child_process";
import {buildSha256Sums} from "../automation/lib/release-artifact.mjs";
const results={},assert=(c,m)=>{if(!c)throw new Error(m)};
if(process.platform!=="win32"){console.log(JSON.stringify({status:"SKIPPED_NOT_WINDOWS"}));console.log("POWERSHELL_SAFETY_SELFTEST: SKIP NOT_WINDOWS");process.exit(0)}
const ps=path.join(process.env.SystemRoot??"C:/Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
// //TR: Yardımcı betikler çağıranın hata politikası altında çalışır; yalnız bunlar ErrorActionPreference kuralından muaftır.
const HELPERS=new Set(["sanitize-process-env.ps1"]),WEB_ALLOWED={"ensure-omniroute.ps1":"-MaximumRedirection 0"};
function listPs1(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...listPs1(p));else if(/\.ps1$/i.test(e.name))out.push(p)}return out.sort()}
async function scenario(name,fn){try{await fn();results[name]="PASS"}catch(e){results[name]=`FAIL: ${e.message}`}}
const files=listPs1("scripts");
await scenario("every-powershell-script-parses-without-errors",async()=>{
  assert(files.length>=13,`too few scripts found: ${files.length}`);const code="$ErrorActionPreference='Stop';$out=@();foreach($f in ($env:UASCO_PS_FILES | ConvertFrom-Json)){$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$t,[ref]$e);$out+=[pscustomobject]@{file=$f;errors=@($e|ForEach-Object{$_.Message});commands=@($t|Where-Object{$_.TokenFlags -band [System.Management.Automation.Language.TokenFlags]::CommandName}|ForEach-Object{$_.Text})}};$out|ConvertTo-Json -Depth 4 -Compress";
  const r=cp.spawnSync(ps,["-NoProfile","-NonInteractive","-Command",code],{encoding:"utf8",windowsHide:true,timeout:120000,env:{...process.env,UASCO_PS_FILES:JSON.stringify(files.map(f=>path.resolve(f)))}});assert(r.status===0,`parser run failed: ${r.stderr}`);
  const parsed=[].concat(JSON.parse(r.stdout));assert(parsed.length===files.length,"not every script was parsed");const bad=parsed.filter(x=>[].concat(x.errors??[]).length);assert(!bad.length,`parse errors: ${bad.map(x=>`${path.basename(x.file)}: ${[].concat(x.errors).join("; ")}`).join(" | ")}`);
  const iex=parsed.filter(x=>[].concat(x.commands??[]).some(c=>/^(invoke-expression|iex)$/i.test(c)));assert(!iex.length,`Invoke-Expression used in ${iex.map(x=>path.basename(x.file)).join(",")}`)});
await scenario("powershell-scripts-follow-safety-rules",async()=>{
  const violations=[];for(const f of files){const name=path.basename(f),src=fs.readFileSync(f,"utf8");
    if(/EncodedCommand|-enc\s/i.test(src))violations.push(`${name}: EncodedCommand`);if(/DownloadString|DownloadFile/i.test(src))violations.push(`${name}: DownloadString/DownloadFile`);
    if(/Set-ExecutionPolicy(?![^;\n]*-Scope\s+Process)/i.test(src))violations.push(`${name}: persistent Set-ExecutionPolicy`);if(/\|\s*(iex|Invoke-Expression)\b/i.test(src))violations.push(`${name}: pipe to Invoke-Expression`);
    if(!HELPERS.has(name)&&!/\$ErrorActionPreference\s*=\s*["']Stop["']/.test(src))violations.push(`${name}: missing $ErrorActionPreference="Stop"`);
    if(/Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b/i.test(src)&&!(WEB_ALLOWED[name]&&src.includes(WEB_ALLOWED[name])))violations.push(`${name}: web request outside the allowlist or without disabled redirects`)}
  assert(!violations.length,violations.join(" | "))});
// //TR: Fark testi: iki doğrulayıcı da içerik değişikliği, eksik dosya, lockfile'sız manifest ve güvensiz yol için reddetmeli; listede olmayan ek dosyayı Node doğrulayıcısı reddeder (PowerShell doğrulayıcısı bunu denetlemez; install.ps1 ikisini sırayla çalıştırır).
function fixture(){const d=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-verifier-diff-"));fs.mkdirSync(path.join(d,"scripts"),{recursive:true});for(const f of ["scripts/verify-artifact.ps1","scripts/verify-artifact.mjs"])fs.copyFileSync(f,path.join(d,f));fs.writeFileSync(path.join(d,"package-lock.json"),"{\"lockfileVersion\":3}\n");fs.writeFileSync(path.join(d,"a.txt"),"alpha\n");fs.writeFileSync(path.join(d,"SHA256SUMS.txt"),buildSha256Sums(d).text);return d}
const runPs=d=>cp.spawnSync(ps,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",path.join(d,"scripts","verify-artifact.ps1")],{cwd:d,encoding:"utf8",windowsHide:true,timeout:60000}).status===0;
const runNode=d=>cp.spawnSync(process.execPath,["scripts/verify-artifact.mjs"],{cwd:d,encoding:"utf8",windowsHide:true,timeout:60000}).status===0;
await scenario("artifact-verifiers-agree-on-clean-and-tampered-trees",async()=>{
  let d=fixture();assert(runPs(d)&&runNode(d),"clean tree rejected");
  d=fixture();fs.writeFileSync(path.join(d,"a.txt"),"tampered\n");assert(!runPs(d)&&!runNode(d),"content tamper accepted");
  d=fixture();fs.rmSync(path.join(d,"a.txt"));assert(!runPs(d)&&!runNode(d),"missing file accepted");
  d=fixture();fs.writeFileSync(path.join(d,"SHA256SUMS.txt"),fs.readFileSync(path.join(d,"SHA256SUMS.txt"),"utf8").split("\n").filter(l=>!l.endsWith("  package-lock.json")).join("\n"));fs.rmSync(path.join(d,"package-lock.json"));assert(!runPs(d)&&!runNode(d),"manifest without lockfile accepted");
  d=fixture();fs.appendFileSync(path.join(d,"SHA256SUMS.txt"),`${"0".repeat(64)}  ../escape.txt\n`);assert(!runPs(d)&&!runNode(d),"unsafe path accepted");
  d=fixture();fs.writeFileSync(path.join(d,"extra.txt"),"unlisted\n");assert(!runNode(d),"node verifier accepted an unlisted file");results["artifact-verifiers-agree-on-clean-and-tampered-trees:unlisted-file-powershell"]=runPs(d)?"KNOWN_ASYMMETRY_POWERSHELL_DOES_NOT_CHECK_UNLISTED_FILES":"POWERSHELL_ALSO_REJECTS";
  const install=fs.readFileSync("scripts/install.ps1","utf8");assert(install.indexOf("verify-artifact.ps1")>0&&install.indexOf("verify-artifact.ps1")<install.indexOf("verify-artifact.mjs")&&install.indexOf("verify-artifact.mjs")<install.indexOf("bootstrap-core"),"install.ps1 does not run both verifiers before bootstrap")});
const bad=Object.entries(results).filter(([k,v])=>v!=="PASS"&&!k.includes(":unlisted-file-powershell"));console.log(JSON.stringify({scripts:files.length,results},null,2));console.log(`POWERSHELL_SAFETY_SELFTEST: ${bad.length?"FAIL":"PASS"} ${Object.keys(results).filter(k=>!k.includes(":")).length-bad.length}/${Object.keys(results).filter(k=>!k.includes(":")).length}`);if(bad.length)process.exit(1);
