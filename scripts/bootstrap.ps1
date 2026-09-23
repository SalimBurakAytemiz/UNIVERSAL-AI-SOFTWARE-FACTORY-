# //TR: Bu script artifact doğrulamasından sonra deterministic dependency lock/install, canonical validation, doctor, trust-root verify ve bootstrap-kernel self-test adımlarını çalıştırır; Git/autostart/provider auth install.ps1 tarafından sıralanır.
param([switch]$SkipOmniRoute)
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)

& ".\scripts\check-prereqs.ps1"

if(-not (Test-Path "package-lock.json")){
  npm install --package-lock-only --ignore-scripts
  if($LASTEXITCODE -ne 0){throw "package-lock generation failed"}
}
npm ci
if($LASTEXITCODE -ne 0){throw "npm ci failed"}

node ".\scripts\run-validation.mjs"
if($LASTEXITCODE -ne 0){throw "canonical validation failed"}

npm run doctor
if($LASTEXITCODE -ne 0){throw "doctor failed"}

node ".\scripts\verify-trust-root.mjs"
if($LASTEXITCODE -ne 0){throw "trust-root verification failed"}

node ".\scripts\bootstrap-kernel-selftest.mjs"
if($LASTEXITCODE -ne 0){throw "bootstrap kernel self-test failed"}

if(-not $SkipOmniRoute){
  & ".\scripts\ensure-omniroute.ps1"
}
Write-Host "BOOTSTRAP_CORE: PASS"
