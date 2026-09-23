# //TR: Bu script artifact doğrulamasından sonra yalnız source-reviewed lock ile deterministic dependency install, canonical validation, doctor, trust-root verify ve bootstrap-kernel self-test çalıştırır.
param([switch]$SkipOmniRoute)
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
& ".\scripts\check-prereqs.ps1"
if(-not (Test-Path "package-lock.json")){throw "SOURCE_REVIEWED_PACKAGE_LOCK_REQUIRED: target machine may not generate package-lock.json"}
node ".\scripts\ensure-dependencies.mjs"
if($LASTEXITCODE -ne 0){throw "reviewed-lock dependency install failed"}
node ".\scripts\run-validation.mjs"
if($LASTEXITCODE -ne 0){throw "canonical validation failed"}
npm run doctor
if($LASTEXITCODE -ne 0){throw "doctor failed"}
node ".\scripts\verify-trust-root.mjs"
if($LASTEXITCODE -ne 0){throw "trust-root verification failed"}
node ".\scripts\bootstrap-kernel-selftest.mjs"
if($LASTEXITCODE -ne 0){throw "bootstrap kernel self-test failed"}
if(-not $SkipOmniRoute){& ".\scripts\ensure-omniroute.ps1"}
Write-Host "BOOTSTRAP_CORE: PASS"
