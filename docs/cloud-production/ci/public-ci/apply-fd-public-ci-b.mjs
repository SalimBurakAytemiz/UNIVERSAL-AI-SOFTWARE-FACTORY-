//TR: MAINTAINER-ONLY uygulama betigi (FD-PUBLIC-CI-2026-10-19-B, yalniz PR #49): uc korunan dosyaya kesin metin degisikliklerini uygular ve her capanin TAM BIR KEZ bulundugunu dogrular; aksi halde hicbir dosyaya dokunmadan durur. (1) build-release-zip.mjs: process.exit(1) yerine exitCode + dogal sonlanma (Linux Node 24 kapanis kilitlenmesi). (2) verify-release-extract.mjs: Windows PowerShell 5.1 cocuklarina PSModulePath'siz ortam. (3) bootstrap-uasco-autonomy.ps1: Desktop (5.1) oturumunda 5.1 varsayilan modul yolunu geri yukle. Manifest reseal'i bu betik YAPMAZ; ayri adimda scripts/generate-trust-root.mjs calistirilir. Builder bu betigi calistirmaz.
import fs from "node:fs";

const PATCHES = [
  {
    file: "scripts/build-release-zip.mjs",
    edits: [
      {
        find: 'const fail=(code,detail="")=>{console.error(`RELEASE_ZIP: FAIL ${code}${detail?` ${detail}`:""}`);process.exit(1)};\n',
        replace:
          '// //TR: process.exit() kullanilmaz: Linux CI\'da agir dosya hash\'lemesinden hemen sonra process.exit(1), Node 24 kapanisinda ana is parcacigini V8 platform is parcacigina pthread_join ile kilitliyordu (ci/diagnose-shards: takilan surec futex/pthread_join; exitCode + dogal sonlanma A/B 0/16 takilma vs 2/8). Cikis kodu (1) ve cikti ayni; yalniz sonlanma yolu degisir.\n' +
          "class ReleaseFail extends Error{}\n" +
          'const fail=(code,detail="")=>{console.error(`RELEASE_ZIP: FAIL ${code}${detail?` ${detail}`:""}`);process.exitCode=1;throw new ReleaseFail(code)};\n' +
          "function main(){\n",
      },
    ],
    append: "}\ntry{main()}catch(e){if(!(e instanceof ReleaseFail))throw e}\n",
  },
  {
    file: "scripts/verify-release-extract.mjs",
    edits: [
      {
        find: 'const ps=path.join(process.env.SystemRoot??"C:\\\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");\n',
        replace:
          'const ps=path.join(process.env.SystemRoot??"C:\\\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");\n' +
          "// //TR: pwsh 7'den baslatilan bir oturumdan miras kalan PSModulePath, Windows PowerShell 5.1'in in-box modullerini (Expand-Archive, Get-FileHash) PS7 surumleriyle golgeler ve 5.1 bunlari yukleyemez; 5.1 cocuklarina PSModulePath'siz ortam verilir, 5.1 kendi varsayilan yolunu kurar.\n" +
          'const ps51Env=(extra={})=>({...Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toUpperCase()!=="PSMODULEPATH")),...extra});\n',
      },
      {
        find: "env:{...process.env,UASCO_RELEASE_ZIP:zipFile,UASCO_RELEASE_DEST:dest}",
        replace: "env:ps51Env({UASCO_RELEASE_ZIP:zipFile,UASCO_RELEASE_DEST:dest})",
      },
      {
        find: "const run=(name,cmd,argv,extraEnv={},timeout=900000)=>{const r=cp.spawnSync(cmd,argv,{cwd:dest,encoding:\"utf8\",windowsHide:true,timeout,env:{...process.env,...extraEnv}});",
        replace: "const run=(name,cmd,argv,extraEnv={},timeout=900000,baseEnv=process.env)=>{const r=cp.spawnSync(cmd,argv,{cwd:dest,encoding:\"utf8\",windowsHide:true,timeout,env:{...baseEnv,...extraEnv}});",
      },
      {
        find: 'run("verifyArtifactPowerShell",ps,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",path.join(dest,"scripts","verify-artifact.ps1")]);',
        replace: 'run("verifyArtifactPowerShell",ps,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",path.join(dest,"scripts","verify-artifact.ps1")],{},900000,ps51Env());',
      },
    ],
  },
  {
    file: "scripts/bootstrap-uasco-autonomy.ps1",
    edits: [
      {
        find: 'Set-StrictMode -Version Latest\n$ErrorActionPreference = "Stop"\n$TaskName = "UASCO-Autonomous-Supervisor"\n',
        replace:
          'Set-StrictMode -Version Latest\n$ErrorActionPreference = "Stop"\n' +
          "# //TR: pwsh 7'den baslatilan bir oturumdan miras kalan PSModulePath, Windows PowerShell 5.1'in in-box modullerini (Get-FileHash vb.) PS7 surumleriyle golgeler ve 5.1 bunlari yukleyemez; yalniz Windows PowerShell (Desktop) oturumunda 5.1 varsayilan modul yolu geri yuklenir, Core'da hicbir sey degismez.\n" +
          'if ($PSVersionTable.PSEdition -eq "Desktop") {\n' +
          '  $env:PSModulePath = @(\n' +
          '    (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "WindowsPowerShell\\Modules"),\n' +
          '    (Join-Path $env:ProgramFiles "WindowsPowerShell\\Modules"),\n' +
          '    (Join-Path $PSHOME "Modules")\n' +
          '  ) -join ";"\n' +
          "}\n" +
          '$TaskName = "UASCO-Autonomous-Supervisor"\n',
      },
    ],
  },
];

if (!process.argv.includes("--i-am-the-maintainer")) {
  console.error("REFUSED: maintainer-only; pass --i-am-the-maintainer (authority FD-PUBLIC-CI-2026-10-19-B, PR #49 only)");
  process.exit(2);
}
const next = new Map();
for (const p of PATCHES) {
  let text = fs.readFileSync(p.file, "utf8");
  if (text.includes("\r\n")) throw new Error(`${p.file}: CRLF content; refusing (repo text files are LF)`);
  for (const e of p.edits) {
    const n = text.split(e.find).length - 1;
    if (n !== 1) throw new Error(`${p.file}: anchor must occur exactly once, found ${n}: ${e.find.slice(0, 80)}`);
    text = text.replace(e.find, () => e.replace);
  }
  if (p.append) {
    if (!text.endsWith("\n")) throw new Error(`${p.file}: expected trailing newline`);
    text += p.append;
  }
  next.set(p.file, text);
}
for (const [file, text] of next) fs.writeFileSync(file, text);
console.log(`APPLIED FD-PUBLIC-CI-2026-10-19-B to ${[...next.keys()].join(", ")}`);
