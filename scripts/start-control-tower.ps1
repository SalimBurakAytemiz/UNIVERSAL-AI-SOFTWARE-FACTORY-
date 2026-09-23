# //TR: Bu script deterministic dependencies ile localhost Control API + hardened Electron Desktop'ı başlatır ve mutating Global Stop endpoint'i için process-local random control token üretir.
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
if(-not (Test-Path "package-lock.json")){throw "package-lock.json missing. Run install.ps1 first."}
if(-not (Test-Path "node_modules")){npm ci;if($LASTEXITCODE -ne 0){throw "npm ci failed"}}
$bytes=New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:UASCO_CONTROL_TOKEN=[Convert]::ToBase64String($bytes)
npm run dev
