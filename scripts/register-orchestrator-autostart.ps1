# //TR: Bu script gözetimsiz inşa süpervizörünü (dar başlatıcı scripts/uasco-supervisor-launcher.mjs -> scripts/uasco-orchestrator.mjs --daemon) Windows Task Scheduler'a UASCO-Autonomous-Supervisor adıyla kaydeder: oturum açılışı ve periyodik kalp atışı tetikleyicileri, çökmede yeniden başlatma, süresiz tek örnek (IgnoreNew), yönetici yetkisi olmadan (Limited); açılış tetikleyicisi yalnız yükseltilmiş kayıtta ve parola saklamadan (S4U) eklenir. Yalnız trust-root'u doğrulanmış (SEALED) bir kontrol düzleminden çalışır, başka bir programa ait aynı adlı görevin üzerine yazmaz ve başka hiçbir sistem ayarını değiştirmez.
param(
  [Parameter(Mandatory=$true)][string]$ControlPlane,
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$TaskName="UASCO-Autonomous-Supervisor",
  [ValidateRange(5,240)][int]$RepetitionMinutes=15,
  [switch]$IncludeStartupTrigger
)
$ErrorActionPreference="Stop"
$cp=(Resolve-Path -LiteralPath $ControlPlane).Path;$repoPath=(Resolve-Path -LiteralPath $Repo).Path
if(-not (Test-Path -LiteralPath (Join-Path $cp "scripts\uasco-supervisor-launcher.mjs") -PathType Leaf)){throw "SUPERVISOR_LAUNCHER_MISSING: $cp"}
$node=(Get-Command node -ErrorAction Stop).Source
Push-Location $cp;try{& $node (Join-Path $cp "scripts\verify-trust-root.mjs")|Out-Null;if($LASTEXITCODE -ne 0){throw "CONTROL_PLANE_TRUST_ROOT_NOT_VERIFIED"}}finally{Pop-Location}
# //TR: Görev sabit control\current bağlantısı üzerinden başlatılır; denetimli kendini güncelleme yalnız bu bağlantıyı yeni doğrulanmış düzleme çevirir, görev yeniden kaydedilmez. Bağlantı yalnız bağlantı olarak kaldırılır, hedefi silinmez.
$controlDir=Split-Path -Parent $cp;$link=Join-Path $controlDir "current"
if((Split-Path -Leaf $cp) -ne "current"){if(Test-Path -LiteralPath $link){$item=Get-Item -LiteralPath $link -Force;if(-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "CONTROL_PLANE_LINK_NOT_A_JUNCTION: $link"};[IO.Directory]::Delete($link)};New-Item -ItemType Junction -Path $link -Target $cp|Out-Null}
$launcher=Join-Path $link "scripts\uasco-supervisor-launcher.mjs"
# //TR: Aynı adlı görev başka bir programa aitse (ör. kurulu sistemin kendi otomatik başlatması) üzerine yazılmaz.
$existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if($existing){$prev=@($existing.Actions|ForEach-Object{"$($_.Execute) $($_.Arguments)"}) -join " | ";if($prev -notmatch "uasco-supervisor-launcher\.mjs|uasco-orchestrator\.mjs"){throw "TASK_NAME_CONFLICT: $TaskName is registered for another program: $prev"}}
$action=New-ScheduledTaskAction -Execute $node -Argument "`"$launcher`" --repo `"$repoPath`"" -WorkingDirectory $link
$logon=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$periodic=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $RepetitionMinutes)
$triggers=@($logon,$periodic);$principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited;$startup="NOT_REQUESTED"
if($IncludeStartupTrigger){$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if(-not $admin){$startup="NOT_APPLICABLE_REQUIRES_ELEVATED_REGISTRATION"}else{$triggers+=New-ScheduledTaskTrigger -AtStartup;$principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited;$startup="REGISTERED_S4U_WITHOUT_STORED_PASSWORD"}}
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description "UASCO autonomous construction supervisor (reviewed control plane: $cp)" -Force|Out-Null
Write-Host "ORCHESTRATOR_AUTOSTART_REGISTERED: $TaskName controlPlane=$cp link=$link repo=$repoPath every=${RepetitionMinutes}m startupTrigger=$startup"
