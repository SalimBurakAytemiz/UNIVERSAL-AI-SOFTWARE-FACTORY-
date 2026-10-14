# //TR: Bu script yalnız Phase0 CLEAN/CLEAN_LOCAL_ONLY sonrasında Windows login'de autonomous wrapper'ı başlatır; aynı scheduled task instance'ını çoğaltmaz ve başarısız process için kontrollü restart ayarlar.
param([string]$RepoPath=(Get-Location).Path,[string]$TaskName="UASCO-Autonomous-Supervisor")
$ErrorActionPreference="Stop"
# //TR: GOV2: bu script eski (emekli) supervisor sarmalayıcısını oturum açılışında başlatan görev kaydederdi; eski supervisor emekli edildiği için görev KAYDEDİLMEZ, fail-closed durur (hiçbir scheduled task oluşturulmaz).
throw "AUTOSTART_BLOCKED_LEGACY_CODEX_REVIEW_PATH_RETIRED: no scheduled task is registered for the retired legacy supervisor"
$repo=(Resolve-Path $RepoPath).Path
$phase0=Join-Path $repo ".ai\runtime\PHASE0_ACCEPTANCE.json"
if(-not (Test-Path $phase0)){throw "Phase0 acceptance missing"}
$x=Get-Content $phase0 -Raw|ConvertFrom-Json
if($x.final -ne "CLEAN" -and $x.final -ne "CLEAN_LOCAL_ONLY"){throw "Autostart forbidden until Phase0 clean"}
$action=New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\start-full-auto.ps1`"" -WorkingDirectory $repo
$trigger=New-ScheduledTaskTrigger -AtLogOn
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 5) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force|Out-Null
Write-Host "AUTOSTART_REGISTERED"
