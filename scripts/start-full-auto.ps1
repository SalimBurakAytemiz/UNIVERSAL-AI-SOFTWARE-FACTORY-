# //TR: Bu wrapper Phase0 CLEAN/CLEAN_LOCAL_ONLY kapısını doğrular, package-lock/node_modules deterministic durumunu korur ve supervisor'ı quota/retry/more-work kodlarına göre otomatik resume döngüsünde çalıştırır.
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
& ".\scripts\sanitize-process-env.ps1"
if(-not (Test-Path "package-lock.json")){throw "package-lock.json missing. Run scripts/install.ps1 first."}
node ".\scripts\ensure-dependencies.mjs";if($LASTEXITCODE -ne 0){throw "reviewed-lock dependency state invalid/install failed"}
if(-not (Test-Path ".ai\runtime\PHASE0_ACCEPTANCE.json")){throw "Phase0 acceptance missing. Run scripts/install.ps1 first."}
$phase0=Get-Content ".ai\runtime\PHASE0_ACCEPTANCE.json" -Raw | ConvertFrom-Json
if($phase0.final -ne "CLEAN" -and $phase0.final -ne "CLEAN_LOCAL_ONLY"){throw "Phase0 is not clean: $($phase0.final)"}

while($true){
  node ".\automation\factory-supervisor.mjs"
  $code=$LASTEXITCODE
  if($code -eq 0){Write-Host "SUPERVISOR_IDLE_OR_COMPLETE";break}
  if($code -eq 20){Start-Sleep -Seconds 10;continue}
  if($code -eq 30){
    $seconds=900
    if(Test-Path ".ai\runtime\SUPERVISOR_RETRY.json"){
      try{$x=Get-Content ".ai\runtime\SUPERVISOR_RETRY.json" -Raw|ConvertFrom-Json;$seconds=[int]$x.retryAfterSeconds}catch{}
    }
    Write-Host "SUPERVISOR_RETRY_WAIT $seconds seconds"
    Start-Sleep -Seconds ([Math]::Min([Math]::Max($seconds,60),7200))
    continue
  }
  if($code -eq 50){Write-Host "GLOBAL_STOP_ACTIVE";break}
  if($code -eq 40){Write-Warning "FOUNDER_ATTENTION_REQUIRED";break}
  throw "Supervisor failed with exit code $code"
}
