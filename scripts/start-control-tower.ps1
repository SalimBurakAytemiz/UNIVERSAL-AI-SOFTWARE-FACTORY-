# //TR: Bu script deterministic dependencies ile localhost Control API + hardened Electron Desktop'ı başlatır ve mutating Global Stop endpoint'i için process-local random control token üretir.
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
if(-not (Test-Path "package-lock.json")){throw "package-lock.json missing. Run install.ps1 first."}
node ".\scripts\ensure-dependencies.mjs";if($LASTEXITCODE -ne 0){throw "reviewed-lock dependency state invalid/install failed"}
$bytes=New-Object byte[] 32
$rng=[System.Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
$env:UASCO_CONTROL_TOKEN=[Convert]::ToBase64String($bytes)
npm run dev
