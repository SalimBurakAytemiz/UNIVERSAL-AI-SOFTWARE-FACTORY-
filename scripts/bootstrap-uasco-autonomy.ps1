# //TR: Bu betik UASCO otonomisinin tek seferlik Windows kurulumudur ve normal (yükseltilmemiş) bir PowerShell penceresinde çalışır; yönetici yetkisi gerekmez ve yükseltilmiş oturumu reddeder. İncelenmiş kontrol düzlemini (master'daki governed birleştirme) kanonik %LOCALAPPDATA%\UASCO\orchestrator\control altında depo Git yalıtımıyla klonlar, trust-root'u ve kalıcı kuyruğu (hash zincirli günlük, governed birleştirme, Global Stop, açık release hattı yok) düzlemin kendi kütüphanesiyle doğrular, bağımlılıkları gözden geçirilmiş kilitle (npm ci) kurar, gözden geçirilmiş kaynaktan bayt bayt aynı kararlı girişi ve gizli pencereli görev sarmalayıcısını kurar, düzlemi tek-worker kilidi altında etkinleştirip (control\current, CURRENT.json, hash zincirli CONTROL_PLANE_ACTIVATED geçişi) UASCO-Autonomous-Supervisor görevini bu kullanıcı için parola saklamadan (Interactive, Limited) oturum açılışı + 15 dakikalık periyotla kaydeder ve ilk çalıştırmanın görev sürecinden gerçekten başladığını doğrulamadan kurulumu tamamlanmış saymaz. LV1 ile ayrıca canlılık kütüphanesini, bağımsız watchdog betiğini ve pencere açmayan wscript sarmalayıcısını aynı doğrulamayla kurar, UASCO-Supervisor-Watchdog görevini (oturum açılışı + 5 dakikalık periyot, kendi kilidi, 15 dakika süre sınırı) kaydeder ve ilk çalışmasını doğrular; -Upgrade ile çalışan süpervizörü yalnız güvenli bir anda (giriş uyurken veya beklerken, uçuşta eylem ve tick süreci yokken) durdurup yükseltir, güvenli an gelmezse hiçbir şeyi değiştirmeden durur. Git push, ağ git işlemi, kimlik bilgisi okuma/yazma veya başka bir sistem ayarı değişikliği yapmaz.
<#
.SYNOPSIS
One-time UASCO autonomy bootstrap. Run once from a NORMAL Windows PowerShell window (not "Run as administrator"; no admin rights are needed).
-TestMode performs every step under a temporary LOCALAPPDATA and writes the scheduled-task definitions to files instead of registering or starting them.
-TaskControllerFixture (TestMode only) replaces every Task Scheduler call by an in-memory fake that records the calls (bootstrap\fake-task-controller.json) so the register / read-back / rollback branches run without touching a real scheduled task.
-Upgrade upgrades an installation whose supervisor task is running: it waits (up to 30 minutes) for a safe point, stops the task, installs and restarts both tasks.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Repo,
  [switch]$TestMode,
  [string]$DependencySource,
  [switch]$ProbeTaskRegistration,
  [string]$TaskControllerFixture,
  [switch]$Upgrade
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$TaskName = "UASCO-Autonomous-Supervisor"
$WatchdogTaskName = "UASCO-Supervisor-Watchdog"
$script:SupervisorDisabledForUpgrade = $false
$script:TaskRegistered = $false; $script:WatchdogRegistered = $false; $script:RolledBack = $false
$script:UpgradeMarker = $null
$script:UpgradeMarkerDoc = $null
$script:BootstrapMutex = $null
$script:Log = $null
$script:StartUtc = [DateTime]::UtcNow

function Write-Step([string]$message) {
  $line = "[{0}] {1}" -f ([DateTime]::UtcNow.ToString("o")), $message
  Write-Host $line
  if ($script:Log) { Add-Content -LiteralPath $script:Log -Value $line -Encoding UTF8 }
}
function Get-SafeText([string]$text) {
  $t = [regex]::Replace([string]$text, '://[^/\s:@]+:[^/\s@]+@', '://***@')
  if ($t.Length -gt 700) { $t = $t.Substring(0, 700) + "..." }
  return $t
}
# //TR: Yükseltme için devre dışı bırakılan görevler her çıkış yolunda (başarısızlık, istisna, Ctrl+C) yeniden etkinleştirilir; kurulum eski haliyle çalışmaya ve izlenmeye devam eder. Ana gövde bunu bir finally bloğunda da çağırır.
function Restore-TasksAfterFailure {
  # //TR: Geri alma (BS1R) bir görevi devre dışı bıraktı veya kaldırdıysa geri alınan durum kazanır: yükseltme için devre dışı bırakılan görev yeniden etkinleştirilmez.
  if ($script:SupervisorDisabledForUpgrade -and -not $script:RolledBack) { try { Invoke-TaskCtl "Enable" } catch { }; $script:SupervisorDisabledForUpgrade = $false; Write-Host "SUPERVISOR_REENABLED_AFTER_FAILURE" }
  if ($script:UpgradeMarker) { if (Test-UpgradeMarkerOwned) { Remove-Item -LiteralPath $script:UpgradeMarker -Force -ErrorAction SilentlyContinue }; $script:UpgradeMarker = $null }
}
# //TR: İşaret bu bootstrap'ın mı (aynı PID ve başlangıç zamanı)? Başka bir bootstrap'ın yazdığı veya watchdog'un iyileştirdiği işarete dokunulmaz; sahiplik kurulumdan ve görev kaydından önce de denetlenir.
function Test-UpgradeMarkerOwned {
  if (-not $script:UpgradeMarker -or $null -eq $script:UpgradeMarkerDoc) { return $false }
  $m = Read-JsonOrNull $script:UpgradeMarker
  return ($null -ne $m -and [string](Get-JsonField $m "pid") -eq [string]$PID -and [string](Get-JsonField $m "startedAt") -eq [string]$script:UpgradeMarkerDoc["startedAt"])
}
function Stop-Bootstrap([string]$code, [string]$detail = "") {
  Write-Step ("BOOTSTRAP_FAILED: {0} {1}" -f $code, (Get-SafeText $detail))
  Restore-TasksAfterFailure
  exit 1
}
function Get-JsonField($object, [string]$name) {
  if ($null -ne $object -and ($object.PSObject.Properties.Name -contains $name)) { return $object.$name }
  return $null
}
function Read-JsonOrNull([string]$file) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  try { return (Get-Content -LiteralPath $file -Raw | ConvertFrom-Json) } catch { return $null }
}
function Get-SecondsFrom([object]$iso, [DateTime]$nowUtc) {
  try { return ([DateTime]::Parse([string]$iso).ToUniversalTime() - $nowUtc).TotalSeconds } catch { return $null }
}
# //TR: Yükseltme güvenli anı (dosya sistemine dokunmayan saf karar; boş dize güvenli demektir): tick/başlatıcı süreci veya uçuşta eylem varsa güvenli değildir; taze (180 sn) canlılık kalp atışı BLOCKED ise ya da SLEEPING/WAITING iken bir sonraki uyanmaya en az 60 sn varsa güvenlidir; canlılık kalp atışı olmayan (1. nesil) girişte giriş kalp atışı çıkış durumundaysa ya da SLEEPING iken bir sonraki yinelemeye en az 60 sn varsa güvenlidir; diğer her durum nedeniyle döner.
function Resolve-UpgradeSafePoint($entryHb, $liveHb, [DateTime]$nowUtc, [int]$workerProcesses, [int]$inFlight) {
  if ($workerProcesses -gt 0) { return "WORKER_PROCESS_RUNNING" }
  if ($inFlight -gt 0) { return "ACTION_IN_FLIGHT" }
  $liveAge = $null; if ($liveHb) { $liveAge = Get-SecondsFrom (Get-JsonField $liveHb "heartbeatAt") $nowUtc }
  if ($null -ne $liveAge -and $liveAge -ge -180 -and $liveAge -le 30) {
    $state = [string](Get-JsonField $liveHb "state")
    if ($state -eq "BLOCKED") { return "" }
    $wake = Get-SecondsFrom (Get-JsonField $liveHb "nextWakeAt") $nowUtc
    if ((@("SLEEPING", "WAITING", "RECOVERING") -contains $state) -and ([string](Get-JsonField $liveHb "phase") -eq "SLEEPING") -and $null -eq (Get-JsonField $liveHb "activeChildProcess") -and $null -ne $wake -and $wake -ge 60) { return "" }
    return "SUPERVISOR_$state"
  }
  if ($entryHb) {
    $state = [string](Get-JsonField $entryHb "state")
    if (@("BROKEN", "UPGRADE_BLOCKED", "STOPPED", "TICK_FATAL") -contains $state) { return "" }
    $next = Get-SecondsFrom (Get-JsonField $entryHb "nextIterationAt") $nowUtc
    if ($state -eq "SLEEPING" -and $null -ne $next -and $next -ge 60) { return "" }
    return "ENTRY_$state"
  }
  return "SUPERVISOR_STATE_UNKNOWN"
}
# //TR: Bu kontrol kökünün süpervizör süreçleri (sarmalayıcı, giriş, tick, başlatıcı) komut satırından bulunur; "worker" yalnız tick ve başlatıcıdır. Sıra önce köktür (sarmalayıcı, giriş, sonra worker).
function Get-SupervisorProcessRank([string]$commandLine) {
  if ($commandLine -match 'supervisor-task\.ps1') { return 0 }
  if ($commandLine -match 'supervisor-entry\.mjs') { return 1 }
  return 2
}
function Get-SupervisorProcesses([string]$controlRoot, [string]$kind) {
  $pattern = $(if ($kind -eq "worker") { 'uasco-(orchestrator|supervisor-launcher)\.mjs' } else { 'uasco-(supervisor-task\.ps1|supervisor-entry\.mjs|orchestrator\.mjs|supervisor-launcher\.mjs)' })
  return @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($controlRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match $pattern } | Sort-Object { Get-SupervisorProcessRank $_.CommandLine })
}
# //TR: Bu kontrol kökünün watchdog süreçleri (wscript sarmalayıcısı ve node watchdog'u).
function Get-WatchdogProcesses([string]$controlRoot) {
  return @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($controlRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match 'uasco-supervisor-watchdog(-task\.vbs|\.mjs)' })
}
function Test-GlobalStopPresent([string]$repo) {
  foreach ($stopFile in @((Join-Path $repo ".ai\runtime\GLOBAL_STOP.json"), (Join-Path $repo ".ai\runtime\GLOBAL_STOP.json.prev"))) { if (Test-Path -LiteralPath $stopFile) { return $true } }
  return $false
}
function Get-InFlightCount([string]$stateFile) {
  $doc = Read-JsonOrNull $stateFile
  if (-not $doc) { return 1 }
  $control = Get-JsonField $doc "control"; $n = 0
  foreach ($group in @((Get-JsonField $control "packages"), (Get-JsonField $control "releases"))) {
    if ($null -eq $group) { continue }
    foreach ($p in $group.PSObject.Properties) { if (Get-JsonField $p.Value "inFlight") { $n++ } }
  }
  return $n
}
# //TR: Görev komut satırına veya cmdlet'lere giren her yol aynı doğrulayıcıdan geçer: mutlak yerel yol, sürücü kökü değil; tırnak, yüzde (Task Scheduler %VAR% genişletir), ters tırnak, köşeli parantez, joker ve kontrol karakteri yok; sonda ters eğik çizgi, nokta veya boşluk yok.
function Get-SafePath([string]$value, [string]$label, [switch]$MustExist) {
  if ([string]::IsNullOrWhiteSpace($value)) { Stop-Bootstrap "PATH_EMPTY" $label }
  if ($value -match '["%`\r\n\t\*\?<>\|\[\]]') { Stop-Bootstrap "PATH_INVALID_CHARACTERS" $label }
  if (-not [IO.Path]::IsPathRooted($value) -or $value -notmatch '^[A-Za-z]:\\') { Stop-Bootstrap "PATH_NOT_ABSOLUTE_LOCAL" $label }
  $full = [IO.Path]::GetFullPath($value)
  if ($full -match '^[A-Za-z]:\\?$') { Stop-Bootstrap "PATH_IS_A_DRIVE_ROOT" $label }
  $full = $full.TrimEnd('\')
  if ($full -notmatch '^[A-Za-z]:\\[^\\]' -or $full -match '[\. ]$') { Stop-Bootstrap "PATH_NOT_ABSOLUTE_LOCAL" $label }
  if ($MustExist -and -not (Test-Path -LiteralPath $full)) { Stop-Bootstrap "PATH_MISSING" $label }
  return $full
}
function Test-Under([string]$root, [string]$candidate) {
  if ($root -notmatch '^[A-Za-z]:\\' -or $candidate -notmatch '^[A-Za-z]:\\') { return $false }
  $r = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  $c = [IO.Path]::GetFullPath($candidate).TrimEnd('\') + '\'
  return $c.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)
}
# //TR: Yalnız verilen zamandan sonra yazılmış (taze) bir JSON belgesini döndürür; dosya yoksa, okunamıyorsa veya zaman alanı eskiyse $null.
function Read-FreshJson([string]$File, [string]$Field, [DateTime]$AfterUtc) {
  if (-not (Test-Path -LiteralPath $File)) { return $null }
  try { $j = Get-Content -LiteralPath $File -Raw | ConvertFrom-Json } catch { return $null }
  if (-not $j -or -not ($j.PSObject.Properties.Name -contains $Field)) { return $null }
  try { if ([DateTime]::Parse([string]$j.$Field).ToUniversalTime() -gt $AfterUtc) { return $j } } catch { }
  return $null
}
# //TR: İlk çalıştırma kararı (taze giriş kalp atışından): başarısız bir durum veya sıfırdan farklı/zaman aşımlı bir tick sonucu başarısızlıktır; tamamlanmış başarılı tick onaydır; başlatıcıya devirde onay yalnız daemon'un bu kurulumdan sonra yazdığı kalp atışıyla verilir; diğer durumlarda karar henüz yoktur (boş dize) ve yoklama sürer.
function Resolve-FirstRunState($hb, [bool]$daemonFresh) {
  if (-not $hb -or -not ($hb.PSObject.Properties.Name -contains "state")) { return "" }
  $state = [string]$hb.state
  if (@("BROKEN", "UPGRADE_BLOCKED", "TICK_TIMEOUT", "LAUNCHER_KILLED_HUNG", "STOPPED", "TICK_FATAL") -contains $state) { return "FIRST_RUN_FAILED" }
  # //TR: Başlatıcı 0 koduyla biterse (ör. governed kendini yükseltme veya Global Stop) bu bir karar değildir ve yoklama sürer; sıfırdan farklı veya bilinmeyen kod başarısızlıktır.
  if ($state -eq "LAUNCHER_EXITED") { $code = [long]-1; if (($hb.PSObject.Properties.Name -contains "exitCode") -and ($null -ne $hb.exitCode) -and [long]::TryParse([string]$hb.exitCode, [ref]$code) -and ($code -eq 0)) { return "" }; return "FIRST_RUN_FAILED" }
  # //TR: Yükseltme beklemesindeki (UPGRADE_QUIESCE) bir giriş henüz tick yapmamıştır: karar yoktur.
  if (($hb.PSObject.Properties.Name -contains "reason") -and ([string]$hb.reason -eq "UPGRADE_QUIESCE")) { return "" }
  if ($state -eq "TICK_FINISHED" -or $state -eq "SLEEPING") {
    $t = $null; if ($hb.PSObject.Properties.Name -contains "tick") { $t = $hb.tick }
    if ($t -and ($t.PSObject.Properties.Name -contains "code") -and ($t.code -eq 0) -and -not (($t.PSObject.Properties.Name -contains "timedOut") -and $t.timedOut) -and ($t.PSObject.Properties.Name -contains "status") -and ([string]$t.status -eq "TICK_DONE")) { return "FIRST_RUN_CONFIRMED" }
    return "FIRST_RUN_FAILED"
  }
  if ($state -eq "DELEGATED_TO_LAUNCHER" -and $daemonFresh) { return "FIRST_RUN_CONFIRMED" }
  return ""
}
# //TR: Daemon'un tamamlanmış bir tick'i: taze kalp atışında lastTick vardır ve durumu TICK_DONE'dır (LEASE_HELD gibi iş yapmayan tick'ler sayılmaz; AUT1B kuralıyla aynı).
function Test-DaemonTickCompleted($sup) {
  if (-not $sup -or -not ($sup.PSObject.Properties.Name -contains "lastTick") -or -not $sup.lastTick) { return $false }
  return (($sup.lastTick.PSObject.Properties.Name -contains "status") -and ([string]$sup.lastTick.status -eq "TICK_DONE"))
}
# //TR: Süre sonu kararı: görev çalışıyor ama ilk tick (AUT1B tick'i veya daemon'un ilk tick'i) henüz bitmediyse sonuç yoktur ve bu ayrı bir karardır (onay değildir; giriş sonucu sonra kayda işler); diğer her durum doğrulanmamıştır.
function Resolve-DeadlineVerdict([string]$lastState, [string]$taskState) {
  if ($taskState -ne "Running") { return "FIRST_RUN_NOT_CONFIRMED" }
  if ($lastState -eq "DELEGATED_TO_LAUNCHER" -or $lastState -eq "RUNNING_TICK") { return "FIRST_RUN_TICK_IN_PROGRESS" }
  return "FIRST_RUN_NOT_CONFIRMED"
}
# //TR: Kalıcı kurulum durumu: onay INSTALLED; devam eden ilk tick INSTALLED_FIRST_TICK_PENDING (görev kurulu ve çalışıyor, tick sonucu giriş tarafından kayda işlenir); diğerleri kararın kendisidir.
function Get-InstallStatus([string]$verdict) {
  if ($verdict -eq "FIRST_RUN_CONFIRMED") { return "INSTALLED" }
  if ($verdict -eq "FIRST_RUN_TICK_IN_PROGRESS") { return "INSTALLED_FIRST_TICK_PENDING" }
  return $verdict
}
# //TR: Test kipinin kök koruması (dosya sistemine dokunmayan saf karar): LOCALAPPDATA TEMP altında olmalı; gerçek LocalApplicationData'nın kendisi, onu içeren bir dizin veya gerçek UASCO dizininin altı reddedilir. Boş dize kabul demektir.
function Test-TestModeRoots([string]$tempRoot, [string]$localAppData, [string]$realLocalAppData) {
  if (-not (Test-Under $tempRoot $localAppData)) { return "TEST_MODE_REQUIRES_TEMP_LOCALAPPDATA" }
  if ((Test-Under $localAppData $realLocalAppData) -or (Test-Under (Join-Path $realLocalAppData "UASCO") $localAppData)) { return "TEST_MODE_REFUSES_THE_REAL_CONTROL_ROOT" }
  return ""
}
function Test-AnyReparsePoint([string]$path, [string]$stopAt) {
  $p = $path
  while ($p -and (Test-Under $stopAt $p)) {
    if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $true }
    $p = Split-Path -Parent $p
  }
  return $false
}
function Get-Sha256([string]$file) { return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
# //TR: Bu betiğin özeti çalışmanın başında alınır (kayıttaki scriptSha256 çalışan betiğin kendisidir).
$script:ScriptSha256Start = Get-Sha256 $PSCommandPath
function Write-JsonAtomic([string]$file, $object) {
  $dir = Split-Path -Parent $file
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $tmp = "$file.tmp-$PID"
  [IO.File]::WriteAllText($tmp, ($object | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $file -Force
}
# //TR: Harici komutlar yalnız mutlak yollu yürütülebilirlerle ve dizi bağımsız değişkenlerle çalışır; kabuk veya dize birleştirme yoktur, her çıkış kodu denetlenir.
function Invoke-Tool([string]$exe, [string[]]$arguments, [string]$cwd, [string]$failCode, [switch]$AllowFailure) {
  Push-Location -LiteralPath $cwd
  $prev = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & $exe @arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Pop-Location }
  if ($code -ne 0 -and -not $AllowFailure) {
    $tail = (@($output) | Select-Object -Last 8) -join " | "
    Stop-Bootstrap $failCode ("exit={0} {1}" -f $code, $tail)
  }
  $script:LastToolExit = $code
  return @($output)
}
# //TR: Bootstrap'ın git çağrıları depo Git yalıtımını (automation/lib/git-isolation.mjs) birebir uygular: boş genel/sistem yapılandırması, NOSYSTEM, tehlikeli ortam değişkenleri kaldırılmış, boş hook ve şablon dizini, kimlik yardımcısı ve ext protokolü kapalı.
function Initialize-GitIsolation([string]$dir) {
  New-Item -ItemType Directory -Path (Join-Path $dir "hooks") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $dir "template") -Force | Out-Null
  foreach ($f in @("global.gitconfig", "system.gitconfig")) { [IO.File]::WriteAllText((Join-Path $dir $f), "") }
  $deny = @("GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "SSH_ASKPASS", "GIT_EXEC_PATH", "GIT_TEMPLATE_DIR", "GIT_PROXY_COMMAND", "GIT_EXTERNAL_DIFF", "GIT_DIFF_OPTS", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES")
  foreach ($item in @(Get-ChildItem Env:)) {
    $k = $item.Name.ToUpperInvariant()
    if ($deny -contains $k -or $k -match '^GIT_CONFIG_(KEY|VALUE)_\d+$') { Remove-Item -LiteralPath ("Env:" + $item.Name) -ErrorAction SilentlyContinue }
  }
  $env:GIT_CONFIG_GLOBAL = Join-Path $dir "global.gitconfig"
  $env:GIT_CONFIG_SYSTEM = Join-Path $dir "system.gitconfig"
  $env:GIT_CONFIG_NOSYSTEM = "1"
  $env:GIT_TERMINAL_PROMPT = "0"
  $env:GCM_INTERACTIVE = "Never"
  $script:GitHooks = Join-Path $dir "hooks"
  $script:GitTemplate = Join-Path $dir "template"
}
function Invoke-Git([string[]]$arguments, [string]$cwd, [string]$failCode, [switch]$AllowFailure) {
  $isolation = @("-c", "core.hooksPath=$script:GitHooks", "-c", "credential.helper=", "-c", "core.askPass=", "-c", "protocol.ext.allow=never", "-c", "core.fsmonitor=false")
  return Invoke-Tool $script:Git ($isolation + $arguments) $cwd $failCode -AllowFailure:$AllowFailure
}
# //TR: Görev tanımı tek bir üreticiden gelir; test kipi aynı CIM nesnesinin özelliklerini yazar, gerçek kip aynı nesneyi kaydeder ve geri okuyup aynı özellikleri karşılaştırır.
function New-SupervisorTask([string]$powershell, [string]$argumentLine, [string]$workingDirectory, [string]$userId, [switch]$Disabled) {
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $argumentLine -WorkingDirectory $workingDirectory
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $periodic = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 15)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 5 -Disable:$Disabled
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  return New-ScheduledTask -Action $action -Trigger @($logon, $periodic) -Settings $settings -Principal $principal -Description "UASCO autonomous construction supervisor (hidden wrapper -> stable entry -> reviewed control plane via control\current)"
}
# //TR: Bağımsız watchdog görevi: aynı kullanıcı, parola saklanmaz (Interactive, Limited); oturum açılışı + 5 dakikalık periyot; IgnoreNew; 15 dakika süre sınırı; pencere açmayan wscript sarmalayıcısı. Süpervizörün lease'ini veya tek-worker kilidini paylaşmaz.
function New-WatchdogTask([string]$wscript, [string]$argumentLine, [string]$workingDirectory, [string]$userId, [switch]$Disabled, [int]$FirstRunMinutes = 1) {
  $action = New-ScheduledTaskAction -Execute $wscript -Argument $argumentLine -WorkingDirectory $workingDirectory
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $periodic = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes($FirstRunMinutes)) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 5 -Disable:$Disabled
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  return New-ScheduledTask -Action $action -Trigger @($logon, $periodic) -Settings $settings -Principal $principal -Description "UASCO independent supervisor watchdog (windowless wscript wrapper -> installed watchdog; restarts a dead, frozen, hung or livelocked supervisor)"
}
function Get-TaskFacts($task) {
  $a = @($task.Actions)
  $triggers = @($task.Triggers | ForEach-Object {
    $rep = $null; if ($_.Repetition -and $_.Repetition.Interval) { $rep = [ordered]@{ interval = [string]$_.Repetition.Interval; duration = [string]$_.Repetition.Duration } }
    $u = $null; if ($_.PSObject.Properties.Name -contains "UserId") { $u = [string]$_.UserId }
    [ordered]@{ type = [string]$_.CimClass.CimClassName; userId = $u; repetition = $rep }
  })
  $s = $task.Settings
  return [ordered]@{
    actionCount = $a.Count; execute = [string]$a[0].Execute; arguments = [string]$a[0].Arguments; workingDirectory = [string]$a[0].WorkingDirectory
    principal = [ordered]@{ userId = [string]$task.Principal.UserId; logonType = [string]$task.Principal.LogonType; runLevel = [string]$task.Principal.RunLevel }
    triggers = $triggers
    settings = [ordered]@{ multipleInstances = [string]$s.MultipleInstances; executionTimeLimit = [string]$s.ExecutionTimeLimit; restartCount = [int]$s.RestartCount; restartInterval = [string]$s.RestartInterval; startWhenAvailable = [bool]$s.StartWhenAvailable; disallowStartIfOnBatteries = [bool]$s.DisallowStartIfOnBatteries; stopIfGoingOnBatteries = [bool]$s.StopIfGoingOnBatteries; priority = [int]$s.Priority }
  }
}
# //TR: Görev zamanlayıcıya giden her çağrı bu tek denetleyiciden geçer. Gerçek kipte Task Scheduler cmdlet'leridir; yalnız -TestMode -TaskControllerFixture ile bellekteki sahte denetleyici kullanılır ve çağrıları bootstrap\fake-task-controller.json'a kaydeder (gerçek görev asla kaydedilmez, başlatılmaz, değiştirilmez veya silinmez).
$script:TaskFake = $null
function Save-FakeTask {
  $f = $script:TaskFake
  Write-JsonAtomic $f.file ([ordered]@{ calls = @($f.calls); final = [ordered]@{ present = $f.present; state = $f.state; xml = $f.xml; facts = $f.facts }; watchdogCalls = @($f.wdCalls); watchdogFinal = [ordered]@{ present = $f.wd.present; state = $f.wd.state; registered = $f.wd.registered } })
}
function Initialize-FakeTask([string]$fixtureFile, [string]$storeFile) {
  $fx = Get-Content -LiteralPath $fixtureFile -Raw | ConvertFrom-Json
  $names = @($fx.PSObject.Properties | ForEach-Object { $_.Name })
  $script:TaskFake = @{ file = $storeFile; calls = [System.Collections.Generic.List[string]]::new(); present = $false; state = "ABSENT"; xml = $null; facts = $null
    preExisting = (($names -contains "preExisting") -and [bool]$fx.preExisting); readBackMismatch = (($names -contains "readBackMismatch") -and [bool]$fx.readBackMismatch); failDisable = (($names -contains "failDisable") -and [bool]$fx.failDisable); failUnregister = (($names -contains "failUnregister") -and [bool]$fx.failUnregister); failRestore = (($names -contains "failRestore") -and [bool]$fx.failRestore); failRegister = (($names -contains "failRegister") -and [bool]$fx.failRegister)
    failRecordWrite = (($names -contains "failRecordWrite") -and [bool]$fx.failRecordWrite); failTaskInfo = (($names -contains "failTaskInfo") -and [bool]$fx.failTaskInfo)
    firstRunVerdict = $(if ($names -contains "firstRunVerdict") { [string]$fx.firstRunVerdict } else { "" })
    wdCalls = [System.Collections.Generic.List[string]]::new(); wd = @{ present = $false; state = "ABSENT"; facts = $null; registered = $false }
    watchdogReadBackMismatch = (($names -contains "watchdogReadBackMismatch") -and [bool]$fx.watchdogReadBackMismatch); watchdogNotConfirmed = (($names -contains "watchdogNotConfirmed") -and [bool]$fx.watchdogNotConfirmed); watchdogPreExisting = (($names -contains "watchdogPreExisting") -and [bool]$fx.watchdogPreExisting) }
  if ($script:TaskFake.watchdogPreExisting) { $script:TaskFake.wd.present = $true; $script:TaskFake.wd.state = "Ready" }
  if ($script:TaskFake.preExisting) { $script:TaskFake.present = $true; $script:TaskFake.state = "Ready"; $script:TaskFake.xml = "<Task>PRE-EXISTING-DEFINITION</Task>"; $script:TaskFake.facts = [ordered]@{ marker = "pre-existing" } }
  Save-FakeTask
}
function Invoke-TaskCtl([string]$op, $arg = $null) {
  $f = $script:TaskFake
  if (-not $f) {
    switch ($op) {
      "Find" { return @(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) }
      "Facts" { return (Get-TaskFacts (Get-ScheduledTask -TaskName $TaskName -TaskPath "\")) }
      "Export" { if (@(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).Count -eq 0) { return $null }; return [string](Export-ScheduledTask -TaskName $TaskName -TaskPath "\") }
      "Register" { Register-ScheduledTask -TaskName $TaskName -InputObject $arg -Force | Out-Null; return }
      "RestoreXml" { Register-ScheduledTask -TaskName $TaskName -Xml $arg -Force | Out-Null; return }
      "Disable" { Disable-ScheduledTask -TaskName $TaskName -TaskPath "\" | Out-Null; return }
      "Unregister" { Unregister-ScheduledTask -TaskName $TaskName -TaskPath "\" -Confirm:$false; return }
      "Start" { Start-ScheduledTask -TaskName $TaskName -TaskPath "\"; return }
      "Stop" { Stop-ScheduledTask -TaskName $TaskName -TaskPath "\"; return }
      "Enable" { Enable-ScheduledTask -TaskName $TaskName -TaskPath "\" | Out-Null; return }
      "Info" { return (Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath "\").LastTaskResult }
      "State" { $t = @(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue); if ($t.Count -eq 0) { return "ABSENT" }; return [string]$t[0].State }
    }
    throw "UNKNOWN_TASK_OP $op"
  }
  $f.calls.Add($op)
  try {
    switch ($op) {
      "Find" {
        if (-not $f.present) { return @() }
        return @([pscustomobject]@{ TaskPath = "\"; State = $f.state; Actions = @([pscustomobject]@{ Execute = $powershellExe; Arguments = ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Repo "{1}" -Node "old"' -f $wrapper, $repoPath) }) })
      }
      "Facts" { if (-not $f.present) { throw "TASK_ABSENT" }; return $f.facts }
      "Export" { if ($f.present) { return $f.xml }; return $null }
      "Register" {
        if ($f.failRegister) { throw "FAKE_REGISTER_FAILED" }
        $nf = Get-TaskFacts $arg
        if ($f.readBackMismatch) { $nf.arguments = [string]$nf.arguments + " TAMPERED" }
        $f.present = $true; $f.state = "Ready"; $f.xml = "<Task>NEW-DEFINITION</Task>"; $f.facts = $nf; return
      }
      "RestoreXml" { if ($f.failRestore) { throw "FAKE_RESTORE_FAILED" }; $f.present = $true; $f.state = "Ready"; $f.xml = [string]$arg; $f.facts = [ordered]@{ marker = "restored" }; return }
      "Disable" { if ($f.failDisable) { throw "FAKE_DISABLE_FAILED" }; if ($f.present) { $f.state = "Disabled" }; return }
      "Unregister" { if ($f.failUnregister) { throw "FAKE_UNREGISTER_FAILED" }; $f.present = $false; $f.state = "ABSENT"; return }
      "Start" { $f.state = "Running"; return }
      "Stop" { if ($f.present -and $f.state -eq "Running") { $f.state = "Ready" }; return }
      "Enable" { if ($f.present -and $f.state -eq "Disabled") { $f.state = "Ready" }; return }
      "Info" { if ($f.failTaskInfo) { throw "FAKE_TASK_INFO_FAILED" }; return 0 }
      "State" { if (-not $f.present) { return "ABSENT" }; return [string]$f.state }
    }
    throw "UNKNOWN_TASK_OP $op"
  } finally { Save-FakeTask }
}
# //TR: Watchdog görevine giden her çağrı da tek denetleyiciden geçer (gerçek kipte Task Scheduler cmdlet'leri; sahte denetleyicide bellekteki wd kaydı ve ayrı watchdogCalls listesi, böylece süpervizör görevinin çağrı dizileri değişmez).
function Invoke-WatchdogCtl([string]$op, $arg = $null) {
  $f = $script:TaskFake
  if (-not $f) {
    switch ($op) {
      "Find" { return @(Get-ScheduledTask -TaskName $WatchdogTaskName -TaskPath "\" -ErrorAction SilentlyContinue) }
      "Facts" { return (Get-TaskFacts (Get-ScheduledTask -TaskName $WatchdogTaskName -TaskPath "\")) }
      "Register" { Register-ScheduledTask -TaskName $WatchdogTaskName -InputObject $arg -Force | Out-Null; return }
      "Disable" { Disable-ScheduledTask -TaskName $WatchdogTaskName -TaskPath "\" | Out-Null; return }
      "Stop" { Stop-ScheduledTask -TaskName $WatchdogTaskName -TaskPath "\" -ErrorAction SilentlyContinue; return }
      "State" { $t = @(Get-ScheduledTask -TaskName $WatchdogTaskName -TaskPath "\" -ErrorAction SilentlyContinue); if ($t.Count -eq 0) { return "ABSENT" }; return [string]$t[0].State }
    }
    throw "UNKNOWN_WATCHDOG_OP $op"
  }
  $f.wdCalls.Add($op)
  try {
    switch ($op) {
      "Find" {
        if (-not $f.wd.present) { return @() }
        return @([pscustomobject]@{ TaskPath = "\"; State = $f.wd.state; Actions = @([pscustomobject]@{ Execute = $wscriptExe; Arguments = ('//B //Nologo "{0}" "old"' -f $watchdogWrapper) }) })
      }
      "Facts" { if (-not $f.wd.present) { throw "WATCHDOG_ABSENT" }; return $f.wd.facts }
      "Register" {
        $nf = Get-TaskFacts $arg
        if ($f.watchdogReadBackMismatch) { $nf.arguments = [string]$nf.arguments + " TAMPERED" }
        $f.wd.present = $true; $f.wd.state = "Ready"; $f.wd.facts = $nf; $f.wd.registered = $true; return
      }
      "Disable" { if ($f.wd.present) { $f.wd.state = "Disabled" }; return }
      "Stop" { if ($f.wd.present -and $f.wd.state -eq "Running") { $f.wd.state = "Ready" }; return }
      "State" { if (-not $f.wd.present) { return "ABSENT" }; return [string]$f.wd.state }
    }
    throw "UNKNOWN_WATCHDOG_OP $op"
  } finally { Save-FakeTask }
}
# //TR: Kayıttan sonraki doğrulama (veya ilk çalıştırmayı başlatma) başarısız olursa bu görev çalıştırılabilir bırakılmaz. Anlambilim: bu çalıştırmadan ÖNCE var olan bir görev ASLA silinmez; önceki tanım (kayıttan önce dışa aktarılan XML) geri yüklenir ve DEVRE DIŞI bırakılır (geri yükleme olmazsa yeni tanım devre dışı bırakılır); önceden yoksa bu çalıştırmanın oluşturduğu görev kaldırılır (kaldırma olmazsa devre dışı bırakılır). Sonunda görev yok ya da Disabled değilse sonuç güvenli sayılmaz.
function Undo-TaskRegistration([bool]$hadPrevious, [string]$previousXml) {
  $notes = [System.Collections.Generic.List[string]]::new()
  try {
    if ($hadPrevious) { Invoke-TaskCtl "RestoreXml" $previousXml; $notes.Add("PREVIOUS_DEFINITION_RESTORED"); Invoke-TaskCtl "Disable"; $notes.Add("RESTORED_TASK_DISABLED") }
    else { Invoke-TaskCtl "Unregister"; $notes.Add("NEW_TASK_UNREGISTERED") }
  } catch {
    $notes.Add("ROLLBACK_STEP_FAILED:" + (Get-SafeText $_.Exception.Message))
    try { Invoke-TaskCtl "Disable"; $notes.Add("DISABLED_AS_FALLBACK") } catch { $notes.Add("FALLBACK_DISABLE_FAILED:" + (Get-SafeText $_.Exception.Message)) }
  }
  $state = "UNKNOWN"; try { $state = [string](Invoke-TaskCtl "State") } catch { $notes.Add("STATE_READ_FAILED") }
  return [pscustomobject]@{ safe = (@("ABSENT", "Disabled") -contains $state); state = $state; notes = ($notes -join ",") }
}
# //TR: Kayıttan dönen görev, üretilen görevle kullanıcı adının etki alanı öneki ve büyük/küçük harf dışında birebir aynı olmalıdır.
function ConvertTo-ComparableFacts($facts) {
  $copy = $facts | ConvertTo-Json -Depth 6 | ConvertFrom-Json
  $copy.principal.userId = ([string]$copy.principal.userId).Split('\')[-1].ToLowerInvariant()
  foreach ($t in @($copy.triggers)) { if ($t.userId) { $t.userId = ([string]$t.userId).Split('\')[-1].ToLowerInvariant() } }
  return ($copy | ConvertTo-Json -Depth 6 -Compress)
}

# ---------------------------------------------------------------- 1. host and caller (no writes before every input is validated)
if ($env:OS -ne "Windows_NT") { Stop-Bootstrap "WINDOWS_REQUIRED" }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
# //TR: Yükseltilmiş oturumda oluşturulan dosyaların sahibi Administrators olur, git "dubious ownership" ile reddedebilir ve görev yanlış belirteçle kaydedilir; kurulum yalnız normal kullanıcı oturumunda yapılır.
if ($elevated) { Stop-Bootstrap "MUST_RUN_UNELEVATED" "open a NORMAL Windows PowerShell window (not 'Run as administrator') and run the same command; no administrator rights are needed" }
$userId = "$env:USERDOMAIN\$env:USERNAME"
if ($identity.Name -ne $userId) { Stop-Bootstrap "USER_IDENTITY_MISMATCH" ("token={0} env={1}" -f $identity.Name, $userId) }
$realLocalAppData = Get-SafePath ([Environment]::GetFolderPath("LocalApplicationData")) "LocalApplicationData" -MustExist
# //TR: Kayıt yoklaması: aynı üreticiyle benzersiz adlı, devre dışı bir görev kaydedilir, geri okunur, karşılaştırılır ve her durumda silinir; başka hiçbir şey yapılmaz.
if ($ProbeTaskRegistration) {
  $probeTask = "UASCO-BS1-RegistrationProbe-{0}" -f ([Guid]::NewGuid().ToString("N").Substring(0, 12))
  $psExe = Get-SafePath (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") "powershell.exe" -MustExist
  $nodeProbe = Get-SafePath ((Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source) "node.exe" -MustExist
  $probeArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Repo "{1}" -Node "{2}"' -f (Join-Path $realLocalAppData "UASCO\orchestrator\bootstrap\uasco-supervisor-task.ps1"), (Get-SafePath $Repo "Repo" -MustExist), $nodeProbe
  $wsExe = Get-SafePath (Join-Path $env:SystemRoot "System32\wscript.exe") "wscript.exe" -MustExist
  $wdArgs = '//B //Nologo "{0}" "{1}" "{2}"' -f (Join-Path $realLocalAppData "UASCO\orchestrator\bootstrap\uasco-supervisor-watchdog-task.vbs"), (Get-SafePath $Repo "Repo" -MustExist), $nodeProbe
  $allSame = $true
  foreach ($probe in @(@{ kind = "SUPERVISOR"; built = (New-SupervisorTask $psExe $probeArgs $realLocalAppData $userId -Disabled) }, @{ kind = "WATCHDOG"; built = (New-WatchdogTask $wsExe $wdArgs $realLocalAppData $userId -Disabled) })) {
    $probeTask = "UASCO-LV1-RegistrationProbe-{0}-{1}" -f $probe.kind, ([Guid]::NewGuid().ToString("N").Substring(0, 12))
    $builtFacts = Get-TaskFacts $probe.built
    $back = $null
    try {
      Register-ScheduledTask -TaskName $probeTask -InputObject $probe.built | Out-Null
      $back = Get-TaskFacts (Get-ScheduledTask -TaskName $probeTask -TaskPath "\")
    } finally { Unregister-ScheduledTask -TaskName $probeTask -TaskPath "\" -Confirm:$false -ErrorAction SilentlyContinue }
    $left = @(Get-ScheduledTask -TaskName $probeTask -ErrorAction SilentlyContinue).Count
    $same = $back -and ((ConvertTo-ComparableFacts $back) -eq (ConvertTo-ComparableFacts $builtFacts)) -and $left -eq 0
    if (-not $same) { $allSame = $false }
    Write-Host ("TASK_REGISTRATION_PROBE {0}: {1} removed={2}" -f $probe.kind, $(if ($same) { "PASS" } else { "FAIL" }), ($left -eq 0))
    Write-Host ("BUILT " + ($builtFacts | ConvertTo-Json -Depth 6 -Compress))
    Write-Host ("READ  " + ($back | ConvertTo-Json -Depth 6 -Compress))
  }
  if ($allSame) { exit 0 } else { exit 1 }
}
if ($TestMode) {
  $localAppData = Get-SafePath $env:LOCALAPPDATA "LOCALAPPDATA" -MustExist
  $tempRoot = Get-SafePath ([IO.Path]::GetTempPath()) "TEMP" -MustExist
  $rootsRefusal = Test-TestModeRoots $tempRoot $localAppData $realLocalAppData
  if ($rootsRefusal) { Stop-Bootstrap $rootsRefusal $localAppData }
  if (Test-AnyReparsePoint $localAppData $tempRoot) { Stop-Bootstrap "TEST_MODE_REFUSES_THE_REAL_CONTROL_ROOT" $localAppData }
} else {
  if ($DependencySource) { Stop-Bootstrap "DEPENDENCY_SOURCE_ONLY_IN_TEST_MODE" }
  if ($TaskControllerFixture) { Stop-Bootstrap "TASK_FIXTURE_ONLY_IN_TEST_MODE" }
  $localAppData = $realLocalAppData
  if (-not [string]::Equals(([string]$env:LOCALAPPDATA).TrimEnd('\'), $localAppData, [StringComparison]::OrdinalIgnoreCase)) { Stop-Bootstrap "LOCALAPPDATA_MISMATCH" ("env={0} profile={1}" -f $env:LOCALAPPDATA, $localAppData) }
}
$ControlRoot = Get-SafePath (Join-Path $localAppData "UASCO\orchestrator") "ControlRoot"
# //TR: Aynı kontrol kökü için tek bootstrap: ikinci bir örnek (ör. aynı komut iki pencerede) hiçbir şeye dokunmadan durur. Adlandırılmış mutex süreç bitince (pencere kapansa da) kendiliğinden serbest kalır; terk edilmiş bir mutex alınmış sayılır.
$mutexKey = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes(([string]$ControlRoot).ToLowerInvariant()))).Replace("-", "").Substring(0, 16)
$script:BootstrapMutex = New-Object System.Threading.Mutex($false, ("Local\UASCO-Bootstrap-" + $mutexKey))
$mutexHeld = $false
try { $mutexHeld = $script:BootstrapMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
if (-not $mutexHeld) { Stop-Bootstrap "BOOTSTRAP_ALREADY_RUNNING" "another bootstrap for this control root is running; nothing was changed" }

# ---------------------------------------------------------------- 2. inputs and tools
$repoPath = Get-SafePath $Repo "Repo" -MustExist
# //TR: Test kipi gerçek depoya yazamaz (durum yansıması ve etkinleştirme geçişi depoya dokunur); yalnız TEMP altındaki bir fikstür deposu kabul edilir.
if ($TestMode -and ((-not (Test-Under $tempRoot $repoPath)) -or (Test-AnyReparsePoint $repoPath $tempRoot))) { Stop-Bootstrap "TEST_MODE_REQUIRES_TEMP_REPO" $repoPath }
if (-not (Test-Path -LiteralPath (Join-Path $repoPath ".git"))) { Stop-Bootstrap "REPO_NOT_A_GIT_WORK_TREE" $repoPath }
if (-not (Test-Path -LiteralPath (Join-Path $repoPath ".ai\cache\review\ORCHESTRATOR_STATE.json") -PathType Leaf)) { Stop-Bootstrap "DURABLE_STATE_MISSING" $repoPath }
if (Test-Under $repoPath $ControlRoot) { Stop-Bootstrap "CONTROL_ROOT_INSIDE_REPO" }
$source = Get-SafePath (Split-Path -Parent $PSScriptRoot) "BootstrapSource" -MustExist
$runtimeFiles = @("scripts/uasco-liveness.mjs", "scripts/uasco-supervisor-watchdog.mjs", "scripts/uasco-supervisor-watchdog-task.vbs", "scripts/uasco-supervisor-task.ps1", "scripts/uasco-supervisor-entry.mjs")
$installFiles = @("scripts/bootstrap-uasco-autonomy.ps1") + $runtimeFiles
foreach ($rel in $installFiles) { if (-not (Test-Path -LiteralPath (Join-Path $source $rel) -PathType Leaf)) { Stop-Bootstrap "BOOTSTRAP_SOURCE_FILE_MISSING" $rel } }
$nodeCmd = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$gitCmd = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCmd) { Stop-Bootstrap "NODE_NOT_FOUND" }
if (-not $gitCmd) { Stop-Bootstrap "GIT_NOT_FOUND" }
$script:Node = Get-SafePath $nodeCmd.Source "node.exe" -MustExist
$script:Git = Get-SafePath $gitCmd.Source "git.exe" -MustExist
if (-not $script:Node.EndsWith("\node.exe", [StringComparison]::OrdinalIgnoreCase)) { Stop-Bootstrap "NODE_PATH_UNEXPECTED" $script:Node }
$powershellExe = Get-SafePath (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") "powershell.exe" -MustExist
$wscriptExe = Get-SafePath (Join-Path $env:SystemRoot "System32\wscript.exe") "wscript.exe" -MustExist
$nodeVersion = (& $script:Node --version) -join ""
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { Stop-Bootstrap "NODE_24_REQUIRED" $nodeVersion }
$gitVersion = (& $script:Git --version) -join ""

# ---------------------------------------------------------------- 3. Global Stop (fail closed on unreadable files), MSIX check, logging
foreach ($stop in @((Join-Path $repoPath ".ai\runtime\GLOBAL_STOP.json"), (Join-Path $repoPath ".ai\runtime\GLOBAL_STOP.json.prev"))) {
  # //TR: automation/lib/global-stop.mjs ile aynı kural: Global Stop kaldırılınca dosya (ve .prev) silinir; dosyanın varlığı, içeriği ne olursa olsun durdurulmuş demektir.
  if (Test-Path -LiteralPath $stop) { Stop-Bootstrap "GLOBAL_STOP_ACTIVE" $stop }
}
$bootDir = Join-Path $ControlRoot "bootstrap"
New-Item -ItemType Directory -Path (Join-Path $bootDir "logs") -Force | Out-Null
if ($TaskControllerFixture) { Initialize-FakeTask (Get-SafePath $TaskControllerFixture "TaskControllerFixture" -MustExist) (Join-Path $bootDir "fake-task-controller.json") }
$script:Log = Join-Path $bootDir ("logs\bootstrap-{0}.log" -f $script:StartUtc.ToString("yyyyMMddTHHmmssZ"))
# //TR: Paketlenmiş (MSIX) bir uygulamanın içinden çalışan PowerShell'in LOCALAPPDATA yazıları sanallaştırılır ve görev bunları göremez; yoklama dosyası paket önbelleğinde görünürse kurulum durur.
$probeName = "probe-{0}.tmp" -f ([Guid]::NewGuid().ToString("N"))
$probe = Join-Path $bootDir $probeName
Set-Content -LiteralPath $probe -Value "probe" -Encoding ASCII
$virtualized = @(Get-ChildItem -Path (Join-Path $localAppData "Packages\*\LocalCache\Local\UASCO\orchestrator\bootstrap") -Filter $probeName -ErrorAction SilentlyContinue)
Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
if ($virtualized.Count -gt 0) { Stop-Bootstrap "RUNNING_INSIDE_A_PACKAGED_APP" "LOCALAPPDATA writes are virtualized; run the command from a normal Windows PowerShell window" }
$shadowCopies = @(Get-ChildItem -Path (Join-Path $localAppData "Packages\*\LocalCache\Local\UASCO") -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
Initialize-GitIsolation (Join-Path $bootDir "git-isolation")
Write-Step ("BOOTSTRAP_START user={0} repo={1} controlRoot={2} testMode={3} node={4} git={5}" -f $userId, $repoPath, $ControlRoot, [bool]$TestMode, $nodeVersion, $gitVersion)

# ---------------------------------------------------------------- 4. provenance of this bootstrap: clean checkout, files identical to the recorded commit
$sourceCommit = ((Invoke-Git @("rev-parse", "--verify", "HEAD^{commit}") $source "BOOTSTRAP_SOURCE_NOT_A_GIT_CHECKOUT") -join "").Trim()
if ($sourceCommit -notmatch '^[0-9a-f]{40}$') { Stop-Bootstrap "BOOTSTRAP_SOURCE_COMMIT_UNKNOWN" $sourceCommit }
$flags = Invoke-Git (@("ls-files", "-v", "--error-unmatch", "--") + $installFiles) $source "BOOTSTRAP_SOURCE_FILES_NOT_TRACKED"
foreach ($line in $flags) { if ($line -cnotmatch '^H ') { Stop-Bootstrap "BOOTSTRAP_SOURCE_FILE_FLAGGED" $line } }
$dirty = (Invoke-Git (@("status", "--porcelain", "--untracked-files=no", "--") + $installFiles) $source "BOOTSTRAP_SOURCE_STATUS_FAILED") -join ""
if ($dirty.Trim()) { Stop-Bootstrap "BOOTSTRAP_SOURCE_NOT_CLEAN" $dirty.Trim() }
$sourceBlobs = @{}
foreach ($rel in $installFiles) {
  $blobHead = ((Invoke-Git @("rev-parse", "HEAD:$rel") $source "BOOTSTRAP_SOURCE_BLOB_UNKNOWN") -join "").Trim()
  $blobFile = ((Invoke-Git @("hash-object", "--no-filters", "--", $rel) $source "BOOTSTRAP_SOURCE_HASH_FAILED") -join "").Trim()
  if ($blobHead -ne $blobFile) { Stop-Bootstrap "BOOTSTRAP_SOURCE_NOT_IDENTICAL_TO_COMMIT" $rel }
  $sourceBlobs[$rel] = $blobHead
}
# //TR: Doğrulanan dosyalar hemen kontrol kökündeki bir hazırlık dizinine kopyalanır ve kopyanın git blob kimliği doğrulanan blob ile yeniden karşılaştırılır; bundan sonra kaynak checkout'un değişmesi kurulumu etkilemez (doğrulama, etkinleştirme ve kurulum yalnız bu kopyaları kullanır).
$staging = Join-Path $bootDir ("staging-{0}" -f $PID)
New-Item -ItemType Directory -Path $staging -Force | Out-Null
$staged = @{}
foreach ($rel in $runtimeFiles) {
  $dst = Join-Path $staging (Split-Path -Leaf $rel)
  Copy-Item -LiteralPath (Join-Path $source ($rel -replace '/', '\')) -Destination $dst -Force
  $blobStaged = ((Invoke-Git @("hash-object", "--no-filters", "--", $dst) $source "BOOTSTRAP_STAGING_HASH_FAILED") -join "").Trim()
  if ($blobStaged -ne $sourceBlobs[$rel]) { Stop-Bootstrap "BOOTSTRAP_STAGED_COPY_NOT_IDENTICAL_TO_COMMIT" $rel }
  $staged[$rel] = $dst
}

# ---------------------------------------------------------------- 5. preflight of the existing installation
$controlDir = Join-Path $ControlRoot "control"
$link = Join-Path $controlDir "current"
if ((Test-Path -LiteralPath $link) -and -not ((Get-Item -LiteralPath $link -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Stop-Bootstrap "CONTROL_LINK_NOT_A_JUNCTION" $link }
$wrapper = Join-Path $bootDir "uasco-supervisor-task.ps1"
$entry = Join-Path $bootDir "uasco-supervisor-entry.mjs"
$argumentLine = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Repo "{1}" -Node "{2}"' -f $wrapper, $repoPath, $script:Node
$watchdogScript = Join-Path $bootDir "uasco-supervisor-watchdog.mjs"
$watchdogWrapper = Join-Path $bootDir "uasco-supervisor-watchdog-task.vbs"
$livenessLib = Join-Path $bootDir "uasco-liveness.mjs"
$watchdogArgumentLine = '//B //Nologo "{0}" "{1}" "{2}"' -f $watchdogWrapper, $repoPath, $script:Node
$previousXml = $null; $hadPrevious = $false
$existing = @()
if ((-not $TestMode) -or $script:TaskFake) {
  # //TR: Aynı adlı bir watchdog görevi varsa bizim olmalıdır (kök yol, tek eylem, bu kontrol kökünün wscript sarmalayıcısı); değilse kurulum durur ve ona dokunulmaz.
  $existingWatchdog = @(Invoke-WatchdogCtl "Find")
  if ($existingWatchdog.Count -gt 1) { Stop-Bootstrap "TASK_NAME_AMBIGUOUS" ("{0} tasks named {1}" -f $existingWatchdog.Count, $WatchdogTaskName) }
  if ($existingWatchdog.Count -eq 1) {
    $wa = @($existingWatchdog[0].Actions)
    $wdOurs = ($existingWatchdog[0].TaskPath -eq "\") -and ($wa.Count -eq 1) -and ($wa[0].Execute -eq $wscriptExe) -and ([string]$wa[0].Arguments).StartsWith(('//B //Nologo "{0}" "' -f $watchdogWrapper), [StringComparison]::OrdinalIgnoreCase)
    if (-not $wdOurs) { Stop-Bootstrap "TASK_NAME_CONFLICT" (@($wa | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " | ") }
  }
  $existing = @(Invoke-TaskCtl "Find")
  if ($existing.Count -gt 1) { Stop-Bootstrap "TASK_NAME_AMBIGUOUS" ("{0} tasks named {1}" -f $existing.Count, $TaskName) }
  if ($existing.Count -eq 1) {
    $e = $existing[0]; $acts = @($e.Actions)
    $ours = ($e.TaskPath -eq "\") -and ($acts.Count -eq 1) -and (
      ($acts[0].Execute -eq $powershellExe -and ([string]$acts[0].Arguments).StartsWith(('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Repo "' -f $wrapper), [StringComparison]::OrdinalIgnoreCase)) -or
      ($acts[0].Execute -like "*\node.exe" -and ([string]$acts[0].Arguments).StartsWith('"' + $controlDir + '\', [StringComparison]::OrdinalIgnoreCase) -and ([string]$acts[0].Arguments) -match 'scripts\\uasco-(orchestrator|supervisor-launcher)\.mjs" --'))
    if (-not $ours) { Stop-Bootstrap "TASK_NAME_CONFLICT" (@($acts | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " | ") }
    if ([string]$e.State -eq "Running" -and -not $Upgrade) { Stop-Bootstrap "SUPERVISOR_ALREADY_RUNNING" "the supervisor is running; the bootstrap is only needed again if the installation is broken, or with -Upgrade to install a newer reviewed entry and watchdog at a safe point" }
    # //TR: Var olan (bizim) tanım kayıttan ÖNCE dışa aktarılır; boş dışa aktarım güvenli geri yüklemeyi imkânsız kılar ve hiçbir şey değişmeden durulur.
    $previousXml = [string](Invoke-TaskCtl "Export")
    if ([string]::IsNullOrWhiteSpace($previousXml)) { Stop-Bootstrap "PREVIOUS_TASK_EXPORT_FAILED" $TaskName }
    $hadPrevious = $true
  }
}

# ---------------------------------------------------------------- 6. reviewed control plane = the governed master commit, cloned with Git isolation
$master = ((Invoke-Git @("rev-parse", "--verify", "refs/heads/master^{commit}") $repoPath "MASTER_UNRESOLVED") -join "").Trim()
if ($master -notmatch '^[0-9a-f]{40}$') { Stop-Bootstrap "MASTER_UNRESOLVED" $master }
$plane = Join-Path $controlDir $master.Substring(0, 12)
New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
if (Test-Path -LiteralPath $plane) {
  if ((Get-Item -LiteralPath $plane -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Bootstrap "PLANE_PATH_IS_A_LINK" $plane }
  # //TR: Yarım kalmış bir klon veya checkout'tan kalan, etkin olmayan (control\current veya CURRENT.json'ın göstermediği) düzlem yerinde onarılmaz (index.lock, eksik nesneler veya izlenmeyen dosyalar onarımı bozabilir): silinmeden kontrol dizininde kenara taşınır ve yeniden klonlanır. Etkin düzleme dokunulmaz; aşağıdaki HEAD ve temizlik denetimleri her durumda uygulanır.
  $activePlane = $null
  try { if (Test-Path -LiteralPath $link) { $activePlane = @((Get-Item -LiteralPath $link -Force).Target)[0] } } catch { $activePlane = $null }
  $recordPath = $null; try { $cur = Get-Content -LiteralPath (Join-Path $controlDir "CURRENT.json") -Raw | ConvertFrom-Json; if ($cur.PSObject.Properties.Name -contains "path") { $recordPath = [string]$cur.path } } catch { $recordPath = $null }
  $isActive = (($activePlane) -and [string]::Equals(([string]$activePlane).TrimEnd('\'), $plane, [StringComparison]::OrdinalIgnoreCase)) -or (($recordPath) -and [string]::Equals($recordPath.TrimEnd('\'), $plane, [StringComparison]::OrdinalIgnoreCase))
  $usable = Test-Path -LiteralPath (Join-Path $plane ".git\HEAD") -PathType Leaf
  if ($usable) {
    $reusedHead = (Invoke-Git @("rev-parse", "HEAD") $plane "PLANE_HEAD_FAILED" -AllowFailure) -join ""
    $reusedDirty = (Invoke-Git @("status", "--porcelain", "--untracked-files=all") $plane "PLANE_STATUS_FAILED" -AllowFailure) -join ""
    $usable = ($reusedHead.Trim() -eq $master) -and -not $reusedDirty.Trim() -and -not (Test-Path -LiteralPath (Join-Path $plane ".git\index.lock"))
  }
  if (-not $isActive -and -not $usable) {
    $aside = "{0}.broken-{1}" -f $plane, [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
    try { Rename-Item -LiteralPath $plane -NewName (Split-Path -Leaf $aside) -ErrorAction Stop } catch { Stop-Bootstrap "PLANE_SET_ASIDE_FAILED" ("{0}: {1}" -f $plane, $_.Exception.Message) }
    Write-Step "PLANE_SET_ASIDE $plane -> $aside"
    Invoke-Git @("clone", "-q", "--no-hardlinks", "--template=$script:GitTemplate", "--", $repoPath, $plane) $controlDir "PLANE_CLONE_FAILED" | Out-Null
    Invoke-Git @("checkout", "-q", "--detach", $master) $plane "PLANE_CHECKOUT_FAILED" | Out-Null
    Write-Step "PLANE_CLONED $plane"
  } else {
    Write-Step "PLANE_REUSED $plane"
  }
} else {
  Invoke-Git @("clone", "-q", "--no-hardlinks", "--template=$script:GitTemplate", "--", $repoPath, $plane) $controlDir "PLANE_CLONE_FAILED" | Out-Null
  Invoke-Git @("checkout", "-q", "--detach", $master) $plane "PLANE_CHECKOUT_FAILED" | Out-Null
  Write-Step "PLANE_CLONED $plane"
}
$head = ((Invoke-Git @("rev-parse", "HEAD") $plane "PLANE_HEAD_FAILED") -join "").Trim()
if ($head -ne $master) { Stop-Bootstrap "PLANE_HEAD_MISMATCH" $head }
$planeDirty = (Invoke-Git @("status", "--porcelain", "--untracked-files=all") $plane "PLANE_STATUS_FAILED") -join ""
if ($planeDirty.Trim()) { Stop-Bootstrap "PLANE_NOT_CLEAN" $planeDirty.Trim() }

# ---------------------------------------------------------------- 7. trust root and durable queue verification (dependency-free), then dependencies
$entrySource = $staged["scripts/uasco-supervisor-entry.mjs"]
$verifyLines = Invoke-Tool $script:Node @($entrySource, "--verify-install", "--repo", $repoPath, "--control-root", $ControlRoot, "--plane", $plane, "--expect-master", $master) $plane "DURABLE_STATE_OR_GOVERNANCE_NOT_VERIFIED" -AllowFailure
$verify = $null; try { $verify = ((@($verifyLines) | Select-Object -Last 1) -join "") | ConvertFrom-Json } catch { $verify = $null }
if (-not $verify -or -not $verify.ok) {
  $code = "DURABLE_STATE_OR_GOVERNANCE_NOT_VERIFIED"
  if ($verify -and ($verify.PSObject.Properties.Name -contains "checks") -and ($verify.checks.PSObject.Properties.Name -contains "trustRoot") -and -not $verify.checks.trustRoot) { $code = "PLANE_TRUST_ROOT_NOT_VERIFIED" }
  Stop-Bootstrap $code ((@($verifyLines) | Select-Object -Last 1) -join "")
}
Write-Step ("DURABLE_STATE_VERIFIED transitions={0} governedMerge={1} openPackages={2} trustRoot=PASS" -f $verify.checks.transitionLog.entries, $verify.checks.governedMerge, $verify.queue.total)
# //TR: Bağımlılıklar düzlemin kendi betiğiyle gözden geçirilmiş kilide göre npm ci ile kurulur; yalnız test kipinde birebir aynı kilitli bir kaynak kopyalanabilir ve yine aynı betikle doğrulanır.
if ($TestMode -and $DependencySource -and -not (Test-Path -LiteralPath (Join-Path $plane "node_modules"))) {
  $depRoot = Get-SafePath $DependencySource "DependencySource" -MustExist
  $lockA = Join-Path $depRoot "package-lock.json"; $lockB = Join-Path $plane "package-lock.json"
  if ((Test-Path -LiteralPath $lockA) -and (Test-Path -LiteralPath (Join-Path $depRoot "node_modules")) -and ((Get-Sha256 $lockA) -eq (Get-Sha256 $lockB))) {
    Copy-Item -LiteralPath (Join-Path $depRoot "node_modules") -Destination (Join-Path $plane "node_modules") -Recurse -Force
    Write-Step "TEST_DEPENDENCIES_COPIED_FROM_IDENTICAL_LOCK"
  }
}
$deps = Invoke-Tool $script:Node @((Join-Path $plane "scripts\ensure-dependencies.mjs")) $plane "PLANE_DEPENDENCIES_FAILED"
Write-Step ("PLANE_DEPENDENCIES " + ((@($deps) | Select-Object -Last 1) -join ""))

# ---------------------------------------------------------------- 7b. upgrade: quiesce a running supervisor at a safe point (never inside a tick or an in-flight action)
# //TR: Buradan sonuna kadar her çıkış yolu (başarısızlık, istisna, Ctrl+C) yükseltme için devre dışı bırakılan görevleri finally bloğunda yeniden etkinleştirir.
$upgradeInfo = $null
try {
if (((-not $TestMode) -or $script:TaskFake) -and $existing.Count -eq 1) {
  $entryHbFile = Join-Path $bootDir "ENTRY_HEARTBEAT.json"; $liveHbFile = Join-Path $ControlRoot "liveness\SUPERVISOR_HEARTBEAT.json"; $stateFile = Join-Path $repoPath ".ai\cache\review\ORCHESTRATOR_STATE.json"
  # //TR: Yükseltme işareti (bootstrap\UPGRADE_IN_PROGRESS.json, bu bootstrap'ın PID'i): çalışan 2. nesil giriş yeni tick başlatmaz, watchdog hiçbir şey yapmaz. Bootstrap işareti her çıkış yolunda siler; bootstrap ölürse (pencere kapandı) watchdog işareti bayat görür, devre dışı kalmış süpervizör görevini yeniden etkinleştirir ve işareti siler.
  $script:UpgradeMarker = Join-Path $bootDir "UPGRADE_IN_PROGRESS.json"
  $script:UpgradeMarkerDoc = [ordered]@{ "//TR" = "Bu isaret bir bootstrap -Upgrade calisirken vardir; giris yeni tick baslatmaz, watchdog bir sey yapmaz. Sahibi olen isaret bayattir."; pid = $PID; startedAt = [DateTime]::UtcNow.ToString("o"); bootstrapCommit = $sourceCommit }
  Write-JsonAtomic $script:UpgradeMarker $script:UpgradeMarkerDoc
  Write-Step "UPGRADE_MARKER_WRITTEN"
  # //TR: Eski watchdog işareti görür ve hiçbir şey yapmaz; işaretten önce başlamış çalışan bir örneği durdurulur ve bu kontrol kökündeki watchdog süreçleri sonlandırılır (yalnız kendi kilidini tutar; sahibi ölen kilit sonraki çalışmada bayat sayılır).
  $existingWatchdog = @(Invoke-WatchdogCtl "Find")
  if ($existingWatchdog.Count -eq 1) {
    try { Invoke-WatchdogCtl "Stop" } catch { }
    $wdStopDeadline = (Get-Date).AddSeconds(60)
    while (([string](Invoke-WatchdogCtl "State") -eq "Running") -and ((Get-Date) -lt $wdStopDeadline)) { Start-Sleep -Seconds 2 }
    foreach ($p in @(Get-WatchdogProcesses $ControlRoot)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Step ("WATCHDOG_PROCESS_STOPPED pid={0}" -f $p.ProcessId) }
  }
  # //TR: Durdurulan watchdog'un ölmeden önce silmiş olabileceği işaret aynı içerikle yeniden yazılır; bundan sonra işaret bu bootstrap'ındır ve watchdog çalışmaz.
  Write-JsonAtomic $script:UpgradeMarker $script:UpgradeMarkerDoc
  $wasRunning = ([string](Invoke-TaskCtl "State") -eq "Running")
  $why = ""
  # //TR: Görev çalışmıyor olsa da bu kontrol kökünde süpervizör süreci kalmışsa (ör. Task Scheduler End yalnız sarmalayıcıyı durdurdu) aynı güvenli an beklenir; görev çalışmıyor ve hiçbir süpervizör süreci yoksa an zaten güvenlidir.
  if ($wasRunning -or @(Get-SupervisorProcesses $ControlRoot "any").Count -gt 0) {
    $quiesceDeadline = (Get-Date).AddMinutes(30); $lastWhy = $null
    Write-Step "UPGRADE_WAITING_FOR_SAFE_POINT (up to 30 minutes)"
    do {
      if (([string](Invoke-TaskCtl "State") -ne "Running") -and @(Get-SupervisorProcesses $ControlRoot "any").Count -eq 0) { $why = ""; break }
      $workers = @(Get-SupervisorProcesses $ControlRoot "worker")
      # //TR: Başlatıcı (AUT2 daemon) düzleminde güvenli an yoktur: başlatıcı sürekli çalışan bir worker'dır. Başlatıcıya duyarlı yükseltme LV2'ye ertelendi; bu yüzden 30 dakika beklenmeden ve hiçbir şey kurulmadan durulur.
      if (@($workers | Where-Object { $_.CommandLine -match 'uasco-supervisor-launcher\.mjs' }).Count -gt 0) { Stop-Bootstrap "UPGRADE_LAUNCHER_PLANE_UNSUPPORTED" "the active control plane runs the launcher daemon; -Upgrade reaches a safe point only on a pre-launcher plane (a launcher-aware upgrade is deferred to LV2); nothing was installed" }
      $why = Resolve-UpgradeSafePoint (Read-JsonOrNull $entryHbFile) (Read-JsonOrNull $liveHbFile) ([DateTime]::UtcNow) ($workers.Count) (Get-InFlightCount $stateFile)
      if (-not $why) { break }
      if ($why -ne $lastWhy) { Write-Step "UPGRADE_NOT_YET_SAFE $why"; $lastWhy = $why }
      Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $quiesceDeadline)
    if ($why) { Stop-Bootstrap "SUPERVISOR_BUSY" ("the running supervisor did not reach a safe point within 30 minutes ({0}); nothing was installed, run the same command again later" -f $why) }
  }
  # //TR: Dosyalar değişirken görevin kendi 15 dakikalık tetikleyicisi bir giriş başlatamaz: görev devre dışı bırakılır (yeniden kayıt onu etkin olarak yeniden oluşturur) ve durdurulur.
  Invoke-TaskCtl "Disable"; $script:SupervisorDisabledForUpgrade = $true
  if ([string](Invoke-TaskCtl "State") -eq "Running") {
    Invoke-TaskCtl "Stop"
    $stopDeadline = (Get-Date).AddSeconds(60)
    while (([string](Invoke-TaskCtl "State") -eq "Running") -and ((Get-Date) -lt $stopDeadline)) { Start-Sleep -Seconds 2 }
    Write-Step "SUPERVISOR_STOPPED_AT_SAFE_POINT"
  }
  # //TR: Kalanlar tek bir listeden denetlenir ve öldürülür: listede bir tick/başlatıcı süreci varsa veya uçuşta eylem belirdiyse hiçbir şey öldürülmez ve kurulmaz (görev yeniden etkinleştirilir); yoksa aynı listedeki sarmalayıcı ve giriş önce kökü sonlandırılır (girişin listeden sonra başlattığı bir node çocuğu iş nesnesiyle birlikte sonlanır).
  $leftover = @(Get-SupervisorProcesses $ControlRoot "any")
  if ((@($leftover | Where-Object { $_.CommandLine -match 'uasco-(orchestrator|supervisor-launcher)\.mjs' }).Count -gt 0) -or ((Get-InFlightCount $stateFile) -gt 0)) { Stop-Bootstrap "SUPERVISOR_BUSY" "a tick, the launcher or an in-flight action appeared during the stop; nothing was killed or installed and the supervisor task is enabled again; run the same command again later" }
  foreach ($p in $leftover) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Step ("SUPERVISOR_PROCESS_STOPPED pid={0} name={1}" -f $p.ProcessId, $p.Name) }
  Start-Sleep -Seconds 1
  if (@(Get-SupervisorProcesses $ControlRoot "any").Count -gt 0) { Stop-Bootstrap "SUPERVISOR_PROCESSES_REMAIN" "a supervisor process of this control root is still running after the stop" }
  $upgradeInfo = [ordered]@{ requested = [bool]$Upgrade; wasRunning = $wasRunning; stoppedAt = [DateTime]::UtcNow.ToString("o"); leftoverProcessesStopped = $leftover.Count }
}
if (Test-GlobalStopPresent $repoPath) { Stop-Bootstrap "GLOBAL_STOP_ACTIVE" "Global Stop was set while the bootstrap waited; nothing was installed" }
if ($script:UpgradeMarker -and -not (Test-UpgradeMarkerOwned)) { Stop-Bootstrap "UPGRADE_MARKER_LOST" "the upgrade marker was removed or replaced (another bootstrap, or a watchdog heal after a long pause); nothing was installed; run the same command again" }

# ---------------------------------------------------------------- 8. install the liveness library, the watchdog, its windowless wrapper, the hidden task wrapper and the stable entry (byte-identical to the verified source; the entry last)
$installed = @{}
$installPairs = @(
  @{ src = "scripts\uasco-liveness.mjs"; rel = "scripts/uasco-liveness.mjs"; dst = $livenessLib },
  @{ src = "scripts\uasco-supervisor-watchdog.mjs"; rel = "scripts/uasco-supervisor-watchdog.mjs"; dst = $watchdogScript },
  @{ src = "scripts\uasco-supervisor-watchdog-task.vbs"; rel = "scripts/uasco-supervisor-watchdog-task.vbs"; dst = $watchdogWrapper },
  @{ src = "scripts\uasco-supervisor-task.ps1"; rel = "scripts/uasco-supervisor-task.ps1"; dst = $wrapper },
  @{ src = "scripts\uasco-supervisor-entry.mjs"; rel = "scripts/uasco-supervisor-entry.mjs"; dst = $entry })
foreach ($pair in $installPairs) {
  $src = $staged[$pair.rel]; $tmp = "$($pair.dst).tmp-$PID"
  Copy-Item -LiteralPath $src -Destination $tmp -Force
  $blobTmp = ((Invoke-Git @("hash-object", "--no-filters", "--", $tmp) $source "INSTALL_COPY_HASH_FAILED") -join "").Trim()
  if ($blobTmp -ne $sourceBlobs[$pair.rel]) { Stop-Bootstrap "INSTALL_COPY_HASH_MISMATCH" $pair.src }
  Move-Item -LiteralPath $tmp -Destination $pair.dst -Force
  $installed[$pair.src] = Get-Sha256 $pair.dst
}

# ---------------------------------------------------------------- 9. activation under the single-worker lock: control\current, CURRENT.json, CONTROL_PLANE_ACTIVATED
# //TR: Yükseltmede düzlem zaten bu master commit'iyle etkinse (bağlantı ve CURRENT.json aynı düzlemi gösteriyor) yeniden etkinleştirme geçişi yazılmaz; ölü lease'i giriş kendisi bırakır.
$alreadyActive = $false
if ($Upgrade) {
  try {
    $cur = Get-Content -LiteralPath (Join-Path $controlDir "CURRENT.json") -Raw | ConvertFrom-Json
    $tgt = @((Get-Item -LiteralPath $link -Force).Target)[0]
    $alreadyActive = ([string](Get-JsonField $cur "commit") -eq $master) -and [string]::Equals(([string](Get-JsonField $cur "path")).TrimEnd('\'), $plane, [StringComparison]::OrdinalIgnoreCase) -and [string]::Equals(([string]$tgt).TrimEnd('\'), $plane, [StringComparison]::OrdinalIgnoreCase)
  } catch { $alreadyActive = $false }
}
if (-not $TestMode -and @(Get-SupervisorProcesses $ControlRoot "any").Count -gt 0) { Stop-Bootstrap "SUPERVISOR_STARTED_DURING_UPGRADE" "a supervisor process of this control root started while the task was disabled; nothing was activated" }
if ($alreadyActive) {
  Write-Step "CONTROL_PLANE_ALREADY_ACTIVE $link -> $plane"
} else {
  $actLines = Invoke-Tool $script:Node @($entry, "--activate", "--repo", $repoPath, "--control-root", $ControlRoot, "--plane", $plane, "--expect-master", $master, "--bootstrap-commit", $sourceCommit) $plane "CONTROL_PLANE_ACTIVATION_FAILED" -AllowFailure
  $act = $null; try { $act = ((@($actLines) | Select-Object -Last 1) -join "") | ConvertFrom-Json } catch { $act = $null }
  if (-not $act -or -not $act.ok) { Stop-Bootstrap "CONTROL_PLANE_ACTIVATION_FAILED" ((@($actLines) | Select-Object -Last 1) -join "") }
  Write-Step "CONTROL_PLANE_ACTIVATED $link -> $plane"
}

# ---------------------------------------------------------------- 10. read-only signer check (fingerprint only, never key material)
$signer = [ordered]@{ agentService = $null; expectedFingerprint = [string]$verify.signingKeyFingerprint; keyLoaded = $false }
$svc = Get-Service -Name ssh-agent -ErrorAction SilentlyContinue
if ($svc) { $signer.agentService = "{0}/{1}" -f $svc.Status, $svc.StartType }
$sshAdd = Join-Path $env:SystemRoot "System32\OpenSSH\ssh-add.exe"
if ($svc -and [string]$svc.Status -eq "Running" -and (Test-Path -LiteralPath $sshAdd -PathType Leaf)) {
  $listed = Invoke-Tool $sshAdd @("-l") $bootDir "SIGNER_CHECK" -AllowFailure
  $fps = @([regex]::Matches(($listed -join "`n"), 'SHA256:[A-Za-z0-9+/=]+') | ForEach-Object { $_.Value })
  $signer.keyLoaded = ($fps -contains $signer.expectedFingerprint)
}

# ---------------------------------------------------------------- 11. scheduled task
# //TR: Başarısız ilk çalıştırmada yalnız bu kontrol kökünün kurulu giriş/sarmalayıcı betiklerini veya düzlemin scripts\uasco-*.mjs betiklerini (giriş, başlatıcı, daemon) çalıştıran süreçler ve çocukları sonlandırılır; bootstrap'ın kendisine ve başka hiçbir sürece dokunulmaz.
function Stop-ControlRootProcesses {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $hit = @{}
  $planeDir = (Join-Path $ControlRoot "control") + "\"
  foreach ($p in $all) {
    if ($p.ProcessId -eq $PID -or -not $p.CommandLine) { continue }
    $c = [string]$p.CommandLine
    $ours = ($c.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($c.IndexOf($wrapper, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
      (($c.IndexOf($planeDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) -and ($c -match 'scripts\\uasco-[a-z-]+\.mjs'))
    if ($ours) { $hit[[int]$p.ProcessId] = $true }
  }
  do { $grew = $false; foreach ($p in $all) { if ($p.ProcessId -ne $PID -and -not $hit.ContainsKey([int]$p.ProcessId) -and $hit.ContainsKey([int]$p.ParentProcessId)) { $hit[[int]$p.ProcessId] = $true; $grew = $true } } } while ($grew)
  foreach ($id in @($hit.Keys)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  return $hit.Count
}
# //TR: Kayıt sonrası başarısızlıkta: önce görev güvenli duruma getirilir (bkz. Undo-TaskRegistration), kalıcı kayıt ve depo yansıması ROLLED_BACK olarak yazılır, sonra ret kodu verilir. Geri alma güvenli bitmezse ret kodu ROLLBACK_UNSAFE olur.
function Stop-AfterRollback([string]$code, [string]$detail, [switch]$Running) {
  $killed = 0
  if ($Running) {
    try { Invoke-TaskCtl "Stop" } catch { Write-Step ("ROLLBACK_TASK_STOP_FAILED " + (Get-SafeText $_.Exception.Message)) }
    $killed = Stop-ControlRootProcesses
  }
  $undo = Undo-TaskRegistration $hadPrevious $previousXml
  # //TR: Geri alınan durum kazanır (BS1R x LV1): yükseltme için devre dışı bırakılan süpervizör görevi bundan sonra asla yeniden etkinleştirilmez. Bu çalıştırmanın kaydettiği watchdog görevi de çalıştırılabilir bırakılmaz: durdurulur ve devre dışı bırakılır (silinmez).
  $script:RolledBack = $true; $script:SupervisorDisabledForUpgrade = $false
  $wdState = "NOT_REGISTERED"
  if ($script:WatchdogRegistered) {
    try { Invoke-WatchdogCtl "Stop" } catch { Write-Step ("ROLLBACK_WATCHDOG_STOP_FAILED " + (Get-SafeText $_.Exception.Message)) }
    try { Invoke-WatchdogCtl "Disable"; $undo.notes += ",WATCHDOG_DISABLED" } catch { $undo.notes += ",WATCHDOG_DISABLE_FAILED:" + (Get-SafeText $_.Exception.Message) }
    $wdState = "UNKNOWN"; try { $wdState = [string](Invoke-WatchdogCtl "State") } catch { $undo.notes += ",WATCHDOG_STATE_READ_FAILED" }
    if (@("ABSENT", "Disabled") -notcontains $wdState) { $undo.safe = $false }
  }
  $record.status = $(if ($undo.safe) { "ROLLED_BACK_TASK_NOT_RUNNABLE" } else { "ROLLBACK_UNSAFE" })
  $record.taskRegistration = "ROLLED_BACK"
  if (-not $record.firstRun) { $record.firstRun = [ordered]@{ verdict = "NOT_STARTED" } }
  $record.firstRun["rollback"] = [ordered]@{ cause = $code; preExistingTask = $hadPrevious; resultingTaskState = $undo.state; watchdogState = $wdState; processesStopped = $killed; steps = $undo.notes }
  try {
    Write-JsonAtomic (Join-Path $ControlRoot "BOOTSTRAP_INSTALLED.json") $record
    Write-JsonAtomic (Join-Path $repoPath ".ai\runtime\BOOTSTRAP_STATUS.json") ([ordered]@{
      "//TR" = "Bu dosya tek seferlik otonomi kurulumunun sonucunu depo icinde pasif olarak yansitir; sir icermez ve bir karar degildir."
      schemaVersion = "1.0.0"; updatedAt = [DateTime]::UtcNow.ToString("o"); installed = [ordered]@{ status = $record.status; installedAt = $record.installedAt; taskName = $TaskName; controlPlaneCommit = $master; entrySha256 = $record.entry.sha256; bootstrapCommit = $sourceCommit; testMode = [bool]$TestMode }; firstRun = $record.firstRun; signer = $signer })
  } catch { Write-Step ("ROLLBACK_RECORD_WRITE_FAILED " + (Get-SafeText $_.Exception.Message)) }
  Stop-Bootstrap $(if ($undo.safe) { $code } else { "ROLLBACK_UNSAFE" }) ("{0}; task rolled back: state={1} steps={2}; {3}" -f $code, $undo.state, $undo.notes, (Get-SafeText $detail))
}
$task = New-SupervisorTask $powershellExe $argumentLine $ControlRoot $userId
$facts = Get-TaskFacts $task
# //TR: Watchdog görevi etkin kaydedilir; ilk periyodik çalışması 20 dakika sonradır (süpervizörün ilk çalışma yoklamasına karışmaz) ve bootstrap onu ilk çalışma kararından sonra kendisi başlatır. Pencere kapansa bile görev etkin kalır.
$watchdogTask = New-WatchdogTask $wscriptExe $watchdogArgumentLine $ControlRoot $userId -FirstRunMinutes 20
$watchdogFacts = Get-TaskFacts $watchdogTask
$record = [ordered]@{
  "//TR" = "Bu kayit tek seferlik UASCO otonomi kurulumunun yapildigini ve neyin kuruldugunu tutar; kurulum yalniz bozulursa veya bilerek kaldirilirsa yinelenir."
  schemaVersion = "1.0.0"; status = "PENDING_FIRST_RUN"; installedAt = [DateTime]::UtcNow.ToString("o"); testMode = [bool]$TestMode; user = $userId
  bootstrapSource = [ordered]@{ path = $source; commit = $sourceCommit; scriptSha256 = $script:ScriptSha256Start; blobs = $sourceBlobs }
  controlRoot = $ControlRoot; controlPlane = [ordered]@{ commit = $master; path = $plane; link = $link; governedMerge = $verify.checks.governedMerge }
  entry = [ordered]@{ path = $entry; sha256 = $installed["scripts\uasco-supervisor-entry.mjs"]; generation = 2 }; wrapper = [ordered]@{ path = $wrapper; sha256 = $installed["scripts\uasco-supervisor-task.ps1"] }
  liveness = [ordered]@{ library = [ordered]@{ path = $livenessLib; sha256 = $installed["scripts\uasco-liveness.mjs"] } }
  watchdog = [ordered]@{ path = $watchdogScript; sha256 = $installed["scripts\uasco-supervisor-watchdog.mjs"]; wrapper = [ordered]@{ path = $watchdogWrapper; sha256 = $installed["scripts\uasco-supervisor-watchdog-task.vbs"] }; task = [ordered]@{ taskName = $WatchdogTaskName; facts = $watchdogFacts }; taskRegistration = "NOT_REGISTERED_TEST_MODE"; firstRun = $null }
  upgrade = $upgradeInfo
  task = [ordered]@{ taskName = $TaskName; facts = $facts }; taskRegistration = "NOT_REGISTERED_TEST_MODE"; firstRun = $null
  durableState = [ordered]@{ transitions = $verify.checks.transitionLog.entries; openPackages = $verify.queue.total; codex = $verify.providers.codex }
  signer = $signer; tools = [ordered]@{ node = $script:Node; nodeVersion = $nodeVersion; nodeSha256 = (Get-Sha256 $script:Node); git = $script:Git; gitVersion = $gitVersion }
  msixShadowCopies = $shadowCopies
  limits = @(
    "Runs while this user is signed in (a locked screen is fine); after a reboot it resumes at the next sign-in. It does not wake a sleeping PC. A pre-logon start would need S4U, which cannot use the DPAPI-protected ssh-agent key needed for secure local signing, or a stored password, which is not allowed.",
    "Recovery: the independent UASCO-Supervisor-Watchdog task (every 5 minutes, own lock, never the worker lease) restarts a supervisor that is not running or whose heartbeat or main thread is frozen, and on pre-launcher planes one that makes no progress for 8 awake hours while work is eligible or that sleeps while work is eligible; at most 3 recoveries per hour with growing spacing, no destructive step in the first run after sleep. The entry releases a dead worker's lease, cuts a tick whose in-flight action exceeds its awake-time backstop and restarts a stale watchdog; the launcher restarts a crashed daemon; the periodic trigger restarts the task within 15 minutes.",
    "The watchdog task runs through wscript.exe (Windows Script Host) so that no console window flashes every 5 minutes. If Windows Script Host is disabled or VBScript is removed by a future Windows version, the watchdog does not run, the entry reports WATCHDOG_TASK state in SUPERVISOR_STATUS.json, and a bootstrap from a newer reviewed source is needed.",
    "Per-child timeouts inside the control plane (Codex, Claude, validation, npm, Git, release, Phase0), RETRYABLE_STALL accounting and daemon-side wake fields are control-plane code and arrive only through governed merges (LV2); until then the awake-time action backstop is the outer bound.",
    "Stop the supervisor with Global Stop (.ai/runtime/GLOBAL_STOP.json), not with Task Scheduler End or Disable.",
    "Founder decisions (for example a package blocked at its cycle limit) still need a Founder answer; routine operation needs no command.")
}
if ($TestMode -and -not $script:TaskFake) {
  Write-JsonAtomic (Join-Path $bootDir "task-definition.json") ([ordered]@{ taskName = $TaskName; facts = $facts })
  Write-JsonAtomic (Join-Path $bootDir "watchdog-task-definition.json") ([ordered]@{ taskName = $WatchdogTaskName; facts = $watchdogFacts })
  $record.status = "TEST_MODE_COMPLETE"
} else {
  if ($script:UpgradeMarker -and -not (Test-UpgradeMarkerOwned)) { Stop-Bootstrap "UPGRADE_MARKER_LOST" "the upgrade marker was removed or replaced during the installation; the tasks were not registered; run the same command again" }
  if ($hadPrevious) { Set-Content -LiteralPath (Join-Path $bootDir "previous-task-definition.xml") -Value $previousXml -Encoding Unicode }
  $registerFailure = $null; $readBack = $null
  try {
    Invoke-TaskCtl "Register" $task
    $script:TaskRegistered = $true
    $readBack = Invoke-TaskCtl "Facts"
    if ((ConvertTo-ComparableFacts $readBack) -ne (ConvertTo-ComparableFacts $facts)) { $registerFailure = "TASK_NOT_AS_REGISTERED" }
  } catch { $registerFailure = "TASK_REGISTRATION_VERIFY_FAILED"; $readBack = $_.Exception.Message }
  if ($registerFailure) { Stop-AfterRollback $registerFailure ($readBack | ConvertTo-Json -Depth 6 -Compress) }
  $record.taskRegistration = "REGISTERED"
  # //TR: Kayıt başarıyla yapıldı: yükseltme için devre dışı bırakılan görev artık yeni (etkin) tanımdır; bundan sonraki her başarısızlık geri almadan geçer ve geri alınan durum kazanır.
  $script:SupervisorDisabledForUpgrade = $false
  # //TR: Kayıttan sonraki her hata (Global Stop, watchdog kaydı, kayıt dosyası, beklenmeyen istisna) çalıştırılabilir bir görev bırakmaz: görev geri alınır.
  if (Test-GlobalStopPresent $repoPath) { Stop-AfterRollback "GLOBAL_STOP_ACTIVE" "Global Stop was set during the installation; the supervisor task was rolled back" }
  $wdFailure = $null; $wdBack = $null
  try {
    Invoke-WatchdogCtl "Register" $watchdogTask
    $script:WatchdogRegistered = $true
    $wdBack = Invoke-WatchdogCtl "Facts"
    # //TR: Geri okunan tanım üretilenle aynı değilse kurulum durur ve görevler geri alınır (watchdog devre dışı bırakılır, süpervizör görevi geri alınır).
    if ((ConvertTo-ComparableFacts $wdBack) -ne (ConvertTo-ComparableFacts $watchdogFacts)) { $wdFailure = "WATCHDOG_TASK_NOT_AS_REGISTERED" }
  } catch { $wdFailure = "WATCHDOG_TASK_REGISTRATION_FAILED"; $wdBack = $_.Exception.Message }
  if ($wdFailure) { Stop-AfterRollback $wdFailure ($wdBack | ConvertTo-Json -Depth 6 -Compress) }
  $record.watchdog.taskRegistration = "REGISTERED"
  Write-Step "WATCHDOG_TASK_REGISTERED $WatchdogTaskName (first periodic run in 20 minutes; started after the supervisor's first run is decided)"
  try {
    if ($script:TaskFake -and $script:TaskFake.failRecordWrite) { throw "FAKE_RECORD_WRITE_FAILED" }
    Write-JsonAtomic (Join-Path $ControlRoot "BOOTSTRAP_INSTALLED.json") $record
  } catch { Stop-AfterRollback "BOOTSTRAP_RECORD_WRITE_FAILED" $_.Exception.Message }
  Write-Step "TASK_REGISTERED $TaskName"
  # //TR: İlk çalıştırma, görev sürecinin kendisinin bu kurulumdan sonra yazdığı giriş kalp atışıyla doğrulanır; yalnız kayıt veya başlatma isteği başarı sayılmaz.
  # //TR: İşaretin görevi (eski girişi bekletmek, dosyalar değişirken watchdog'u durdurmak) iki görev kaydedildikten sonra biter. İlk çalıştırmadan önce silinir: canlı işaret yeni girişi UPGRADE_QUIESCE'te tutar ve ilk çalıştırma kararı hiçbir tick görmezdi.
  if ($script:UpgradeMarker) { if (Test-UpgradeMarkerOwned) { Remove-Item -LiteralPath $script:UpgradeMarker -Force -ErrorAction SilentlyContinue }; $script:UpgradeMarker = $null; Write-Step "UPGRADE_MARKER_REMOVED" }
  $firstRunStartUtc = [DateTime]::UtcNow
  if ($script:TaskFake) {
    $record.status = "TEST_MODE_COMPLETE"; $record.taskRegistration = "REGISTERED_FAKE_CONTROLLER"
    $record.watchdog.firstRun = [ordered]@{ verdict = $(if ($script:TaskFake.watchdogNotConfirmed) { "WATCHDOG_FIRST_RUN_NOT_CONFIRMED" } else { "WATCHDOG_FIRST_RUN_CONFIRMED" }); classification = "INJECTED_BY_TEST_FIXTURE" }
    if ($script:TaskFake.firstRunVerdict) {
      Invoke-TaskCtl "Start"
      $fakeState = $null; $fakeResult = $null
      try { $fakeState = [string](Invoke-TaskCtl "State"); $fakeResult = Invoke-TaskCtl "Info" } catch { Stop-AfterRollback "FIRST_RUN_STATE_UNREADABLE" $_.Exception.Message -Running }
      $record.firstRun = [ordered]@{ verdict = $script:TaskFake.firstRunVerdict; entryState = $null; entryReason = "INJECTED_BY_TEST_FIXTURE"; lastTaskResult = $fakeResult; taskState = $fakeState }
      $record.status = Get-InstallStatus $script:TaskFake.firstRunVerdict
    }
  }
  else {
  try { Invoke-TaskCtl "Start" } catch { Stop-AfterRollback "TASK_START_FAILED" $_.Exception.Message }
  Write-Step "FIRST_RUN_STARTED waiting for the task's own heartbeat (up to 3 minutes, up to 15 minutes while the first tick runs)"
  $hbFile = Join-Path $bootDir "ENTRY_HEARTBEAT.json"
  $supHbFile = Join-Path $ControlRoot "supervisor\SUPERVISOR_HEARTBEAT.json"
  # //TR: Yoklama 180 sn sürer; ilk tick (AUT1B tick'i veya daemon'un ilk tick'i) hâlâ çalışıyorsa sonucunu beklemek için en çok 900 sn'ye uzar. Süre sonunda karar Resolve-DeadlineVerdict ile verilir ve kayıt durumu Get-InstallStatus ile türetilir.
  $deadline = (Get-Date).AddSeconds(180); $tickDeadline = (Get-Date).AddSeconds(900); $verdict = "FIRST_RUN_NOT_CONFIRMED"; $lastState = $null; $lastReason = $null
  do {
    Start-Sleep -Seconds 3
    $hb = Read-FreshJson $hbFile "at" $firstRunStartUtc
    if ($hb -and ($hb.PSObject.Properties.Name -contains "state")) { $prevState = $lastState; $lastState = [string]$hb.state; $lastReason = $(if ($hb.PSObject.Properties.Name -contains "reason") { [string]$hb.reason } else { $null }); if ($lastState -ne $prevState) { Write-Step ("FIRST_RUN_STATE {0}" -f $lastState) } }
    $daemonFresh = $false; if ($lastState -eq "DELEGATED_TO_LAUNCHER") { $sup = Read-FreshJson $supHbFile "heartbeatAt" $firstRunStartUtc; $daemonFresh = Test-DaemonTickCompleted $sup }
    $v = Resolve-FirstRunState $hb $daemonFresh
    if ($v) { $verdict = $v; break }
  } while (((Get-Date) -lt $deadline) -or ((@("RUNNING_TICK", "DELEGATED_TO_LAUNCHER") -contains $lastState) -and ((Get-Date) -lt $tickDeadline)))
  $taskState = $null; $lastTaskResult = $null
  try { $taskState = [string](Invoke-TaskCtl "State"); $lastTaskResult = Invoke-TaskCtl "Info" } catch { Stop-AfterRollback "FIRST_RUN_STATE_UNREADABLE" $_.Exception.Message -Running }
  if ($verdict -eq "FIRST_RUN_NOT_CONFIRMED") { $verdict = Resolve-DeadlineVerdict $lastState $taskState }
  $record.firstRun = [ordered]@{ verdict = $verdict; entryState = $lastState; entryReason = $lastReason; lastTaskResult = $lastTaskResult; taskState = $taskState }
  $record.status = Get-InstallStatus $verdict
  # //TR: Watchdog başlatılır; ilk çalışması, watchdog sürecinin bu andan sonra kendi kontrol kökü durum dosyasına yazdığı lastRunAt ile doğrulanır (yalnız kayıt veya başlatma isteği başarı sayılmaz). İlk çalışması bir kurtarma yaparsa birkaç dakika sürebilir; 5 dakika beklenir.
  if (@("INSTALLED", "INSTALLED_FIRST_TICK_PENDING") -contains $record.status) {
    $wdStartUtc = [DateTime]::UtcNow
    Start-ScheduledTask -TaskName $WatchdogTaskName -TaskPath "\"
    Write-Step "WATCHDOG_FIRST_RUN_STARTED waiting for its own state record (up to 5 minutes)"
    $wdStateFile = Join-Path $ControlRoot "watchdog\WATCHDOG_STATE.json"
    $wdDeadline = (Get-Date).AddSeconds(300); $wdState = $null
    do { Start-Sleep -Seconds 3; $wdState = Read-FreshJson $wdStateFile "lastRunAt" $wdStartUtc } while (-not $wdState -and ((Get-Date) -lt $wdDeadline))
    $wdInfo = Get-ScheduledTaskInfo -TaskName $WatchdogTaskName -TaskPath "\"
    $record.watchdog.taskRegistration = "REGISTERED"
    $record.watchdog.firstRun = [ordered]@{ verdict = $(if ($wdState) { "WATCHDOG_FIRST_RUN_CONFIRMED" } else { "WATCHDOG_FIRST_RUN_NOT_CONFIRMED" }); classification = [string](Get-JsonField $wdState "lastClass"); outcome = [string](Get-JsonField $wdState "lastOutcome"); lastTaskResult = $wdInfo.LastTaskResult; taskState = [string](Invoke-WatchdogCtl "State") }
    Write-Step ("WATCHDOG_FIRST_RUN {0} class={1}" -f $record.watchdog.firstRun.verdict, $record.watchdog.firstRun.classification)
  } else { $record.watchdog.firstRun = [ordered]@{ verdict = "WATCHDOG_NOT_STARTED_FIRST_RUN_FAILED" } }
  # //TR: Giriş ilk sonucu bu arada kayda işlediyse (firstTick/firstSuccessfulRun) o sonuç korunur; bootstrap'ın kendi kararı firstRun içinde kalır (watchdog beklemesinden sonra okunur, üzerine yazılmaz).
  $onDisk = $null; try { $onDisk = Get-Content -LiteralPath (Join-Path $ControlRoot "BOOTSTRAP_INSTALLED.json") -Raw | ConvertFrom-Json } catch { $onDisk = $null }
  if ($onDisk -and ($onDisk.PSObject.Properties.Name -contains "firstRun") -and $onDisk.firstRun) {
    foreach ($k in @("firstTick", "firstSuccessfulRun")) { if ($onDisk.firstRun.PSObject.Properties.Name -contains $k) { $record.firstRun[$k] = $onDisk.firstRun.$k; $record.status = [string]$onDisk.status } }
  }
  }
  # //TR: Başarısız bir ilk çalıştırma kararında görev çalıştırılabilir bırakılmaz: çalışan örnek ve bu kontrol köküne ait süreçler durdurulur, görev geri alınır (önceden var olan görev eski tanımıyla DEVRE DIŞI geri yüklenir), ret kodu karardır.
  if ($record.firstRun -and (@("INSTALLED", "INSTALLED_FIRST_TICK_PENDING", "TEST_MODE_COMPLETE") -notcontains $record.status)) {
    Stop-AfterRollback ([string]$record.firstRun.verdict) ("first run not confirmed: entryState={0} reason={1} lastTaskResult={2} taskState={3}" -f $record.firstRun.entryState, $record.firstRun.entryReason, $record.firstRun.lastTaskResult, $record.firstRun.taskState) -Running
  }
  # //TR: LV1: süpervizör kuruldu ama watchdog görevi bir çalışma kaydetmediyse kurulum başarısızdır; çalıştırılabilir görev bırakılmaz (görevler geri alınır).
  if ($record.firstRun -and (@("INSTALLED", "INSTALLED_FIRST_TICK_PENDING") -contains $record.status) -and $record.watchdog.firstRun -and ($record.watchdog.firstRun.verdict -ne "WATCHDOG_FIRST_RUN_CONFIRMED")) {
    Stop-AfterRollback "WATCHDOG_FIRST_RUN_NOT_CONFIRMED" ("the watchdog task did not record a run (verdict={0}); Windows Script Host may be disabled on this PC; the tasks were rolled back" -f $record.watchdog.firstRun.verdict) -Running
  }
}

# ---------------------------------------------------------------- 12. durable record and its mirror in the repository
Write-JsonAtomic (Join-Path $ControlRoot "BOOTSTRAP_INSTALLED.json") $record
Write-JsonAtomic (Join-Path $repoPath ".ai\runtime\BOOTSTRAP_STATUS.json") ([ordered]@{
  "//TR" = "Bu dosya tek seferlik otonomi kurulumunun sonucunu depo icinde pasif olarak yansitir; sir icermez ve bir karar degildir."
  schemaVersion = "1.0.0"; updatedAt = [DateTime]::UtcNow.ToString("o"); installed = [ordered]@{ status = $record.status; installedAt = $record.installedAt; taskName = $TaskName; controlPlaneCommit = $master; entrySha256 = $record.entry.sha256; entryGeneration = 2; bootstrapCommit = $sourceCommit; testMode = [bool]$TestMode }; firstRun = $record.firstRun; signer = $signer
  watchdog = [ordered]@{ taskName = $WatchdogTaskName; sha256 = $record.watchdog.sha256; taskRegistration = $record.watchdog.taskRegistration; firstRun = $record.watchdog.firstRun }; upgrade = $upgradeInfo })
$watchdogOk = $TestMode -or ($record.watchdog.firstRun -and $record.watchdog.firstRun.verdict -eq "WATCHDOG_FIRST_RUN_CONFIRMED")
if ((@("INSTALLED", "INSTALLED_FIRST_TICK_PENDING", "TEST_MODE_COMPLETE") -contains $record.status) -and $watchdogOk) {
  Write-Step ("BOOTSTRAP_COMPLETE status={0} controlPlane={1} entrySha256={2} watchdog={3} signerKeyLoaded={4}" -f $record.status, $master.Substring(0, 12), $record.entry.sha256, $(if ($TestMode) { "TEST_MODE" } else { $record.watchdog.firstRun.verdict }), $signer.keyLoaded)
  exit 0
}
Stop-Bootstrap $record.status "unexpected install status"
} catch {
  # //TR: Süpervizör görevi kaydedildikten sonra beklenmeyen bir istisna çalıştırılabilir görev bırakmaz: görev geri alınır (geri alma zaten yapıldıysa istisna yeniden fırlatılır).
  $unexpectedError = $_
  if ($script:TaskRegistered -and -not $script:RolledBack) { Stop-AfterRollback "BOOTSTRAP_UNEXPECTED_ERROR" $unexpectedError.Exception.Message -Running } else { throw }
} finally { Restore-TasksAfterFailure }
