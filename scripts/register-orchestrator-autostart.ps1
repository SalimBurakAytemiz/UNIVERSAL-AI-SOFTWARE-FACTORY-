# //TR: Bu script gözetimsiz inşa orkestratörünü (scripts/uasco-orchestrator.mjs) Windows Task Scheduler'a oturum açılışında ve periyodik olarak kaydeder; yalnız trust-root'u doğrulanmış (SEALED) bir kontrol düzleminden, yönetici yetkisi olmadan (Limited), aynı anda tek örnekle (IgnoreNew) çalışır ve başka hiçbir sistem ayarını değiştirmez.
param(
  [Parameter(Mandatory=$true)][string]$ControlPlane,
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$TaskName="UASCO-Construction-Orchestrator",
  [ValidateRange(5,240)][int]$RepetitionMinutes=15
)
$ErrorActionPreference="Stop"
$cp=(Resolve-Path -LiteralPath $ControlPlane).Path;$repoPath=(Resolve-Path -LiteralPath $Repo).Path
$script=Join-Path $cp "scripts\uasco-orchestrator.mjs";if(-not (Test-Path -LiteralPath $script -PathType Leaf)){throw "ORCHESTRATOR_SCRIPT_MISSING: $script"}
$node=(Get-Command node -ErrorAction Stop).Source
Push-Location $cp;try{& $node (Join-Path $cp "scripts\verify-trust-root.mjs")|Out-Null;if($LASTEXITCODE -ne 0){throw "CONTROL_PLANE_TRUST_ROOT_NOT_VERIFIED"}}finally{Pop-Location}
$action=New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --tick --repo `"$repoPath`"" -WorkingDirectory $cp
$logon=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$periodic=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $RepetitionMinutes)
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
$principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon,$periodic) -Settings $settings -Principal $principal -Description "UASCO unattended construction orchestrator (reviewed control plane: $cp)" -Force|Out-Null
Write-Host "ORCHESTRATOR_AUTOSTART_REGISTERED: $TaskName controlPlane=$cp repo=$repoPath every=${RepetitionMinutes}m"
