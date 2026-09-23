# //TR: Bu script target Windows makinede Node>=24, npm, Git, PowerShell, disk/RAM/path/long-path ve mission tool görünürlüğünü kontrol eder; ayrıntılı cross-platform report için scripts/preflight.mjs çağrılır.
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)

foreach($cmd in @("git","node","npm")){
  if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)){throw "Required command missing: $cmd"}
}
$nodeRaw=(& node --version).Trim().TrimStart("v")
$nodeMajor=[int]($nodeRaw.Split(".")[0])
if($nodeMajor -lt 24){throw "Node >=24 required. Found $nodeRaw"}

$psMajor=$PSVersionTable.PSVersion.Major
if($psMajor -lt 5){throw "PowerShell 5.1+ required. Found $($PSVersionTable.PSVersion)"}

if($IsWindows -or $env:OS -eq "Windows_NT"){
  try{
    $lp=(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled
    if($lp -ne 1){Write-Warning "Windows LongPathsEnabled is not enabled. Deep generated projects may hit path limits."}
  }catch{Write-Warning "Could not read LongPathsEnabled registry state."}
}
node ".\scripts\preflight.mjs"
if($LASTEXITCODE -ne 0){throw "Preflight failed"}
Write-Host "PREREQ_CHECK: PASS"
