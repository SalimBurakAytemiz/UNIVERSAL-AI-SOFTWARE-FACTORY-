# //TR: Bu betik UASCO otonomisinin tek seferlik Windows kurulumudur ve normal (yükseltilmemiş) bir PowerShell penceresinde çalışır; yönetici yetkisi gerekmez ve yükseltilmiş oturumu reddeder. İncelenmiş kontrol düzlemini (master'daki governed birleştirme) kanonik %LOCALAPPDATA%\UASCO\orchestrator\control altında depo Git yalıtımıyla klonlar, trust-root'u ve kalıcı kuyruğu (hash zincirli günlük, governed birleştirme, Global Stop, açık release hattı yok) düzlemin kendi kütüphanesiyle doğrular, bağımlılıkları gözden geçirilmiş kilitle (npm ci) kurar, gözden geçirilmiş kaynaktan bayt bayt aynı kararlı girişi ve gizli pencereli görev sarmalayıcısını kurar, düzlemi tek-worker kilidi altında etkinleştirip (control\current, CURRENT.json, hash zincirli CONTROL_PLANE_ACTIVATED geçişi) UASCO-Autonomous-Supervisor görevini bu kullanıcı için parola saklamadan (Interactive, Limited) oturum açılışı + 15 dakikalık periyotla kaydeder ve ilk çalıştırmanın görev sürecinden gerçekten başladığını doğrulamadan kurulumu tamamlanmış saymaz. Git push, ağ git işlemi, kimlik bilgisi okuma/yazma veya başka bir sistem ayarı değişikliği yapmaz.
<#
.SYNOPSIS
One-time UASCO autonomy bootstrap. Run once from a NORMAL Windows PowerShell window (not "Run as administrator"; no admin rights are needed).
-TestMode performs every step under a temporary LOCALAPPDATA and writes the scheduled-task definition to a file instead of registering or starting it.
-TaskControllerFixture (TestMode only) replaces every Task Scheduler call by an in-memory fake that records the calls (bootstrap\fake-task-controller.json) so the register / read-back / rollback branches run without touching a real scheduled task.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Repo,
  [switch]$TestMode,
  [string]$DependencySource,
  [switch]$ProbeTaskRegistration,
  [string]$TaskControllerFixture
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$TaskName = "UASCO-Autonomous-Supervisor"
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
function Stop-Bootstrap([string]$code, [string]$detail = "") {
  Write-Step ("BOOTSTRAP_FAILED: {0} {1}" -f $code, (Get-SafeText $detail))
  exit 1
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
  if (@("BROKEN", "UPGRADE_BLOCKED", "TICK_TIMEOUT", "LAUNCHER_KILLED_HUNG", "STOPPED") -contains $state) { return "FIRST_RUN_FAILED" }
  # //TR: Başlatıcı 0 koduyla biterse (ör. governed kendini yükseltme veya Global Stop) bu bir karar değildir ve yoklama sürer; sıfırdan farklı veya bilinmeyen kod başarısızlıktır.
  if ($state -eq "LAUNCHER_EXITED") { $code = [long]-1; if (($hb.PSObject.Properties.Name -contains "exitCode") -and ($null -ne $hb.exitCode) -and [long]::TryParse([string]$hb.exitCode, [ref]$code) -and ($code -eq 0)) { return "" }; return "FIRST_RUN_FAILED" }
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
  Write-JsonAtomic $f.file ([ordered]@{ calls = @($f.calls); final = [ordered]@{ present = $f.present; state = $f.state; xml = $f.xml; facts = $f.facts } })
}
function Initialize-FakeTask([string]$fixtureFile, [string]$storeFile) {
  $fx = Get-Content -LiteralPath $fixtureFile -Raw | ConvertFrom-Json
  $names = @($fx.PSObject.Properties | ForEach-Object { $_.Name })
  $script:TaskFake = @{ file = $storeFile; calls = [System.Collections.Generic.List[string]]::new(); present = $false; state = "ABSENT"; xml = $null; facts = $null
    preExisting = (($names -contains "preExisting") -and [bool]$fx.preExisting); readBackMismatch = (($names -contains "readBackMismatch") -and [bool]$fx.readBackMismatch); failDisable = (($names -contains "failDisable") -and [bool]$fx.failDisable); failUnregister = (($names -contains "failUnregister") -and [bool]$fx.failUnregister); failRestore = (($names -contains "failRestore") -and [bool]$fx.failRestore); failRegister = (($names -contains "failRegister") -and [bool]$fx.failRegister)
    failRecordWrite = (($names -contains "failRecordWrite") -and [bool]$fx.failRecordWrite); failTaskInfo = (($names -contains "failTaskInfo") -and [bool]$fx.failTaskInfo)
    firstRunVerdict = $(if ($names -contains "firstRunVerdict") { [string]$fx.firstRunVerdict } else { "" }) }
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
      "Info" { if ($f.failTaskInfo) { throw "FAKE_TASK_INFO_FAILED" }; return 0 }
      "State" { if (-not $f.present) { return "ABSENT" }; return [string]$f.state }
    }
    throw "UNKNOWN_TASK_OP $op"
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
  $built = New-SupervisorTask $psExe $probeArgs $realLocalAppData $userId -Disabled
  $builtFacts = Get-TaskFacts $built
  $back = $null
  try {
    Register-ScheduledTask -TaskName $probeTask -InputObject $built | Out-Null
    $back = Get-TaskFacts (Get-ScheduledTask -TaskName $probeTask -TaskPath "\")
  } finally { Unregister-ScheduledTask -TaskName $probeTask -TaskPath "\" -Confirm:$false -ErrorAction SilentlyContinue }
  $left = @(Get-ScheduledTask -TaskName $probeTask -ErrorAction SilentlyContinue).Count
  $same = $back -and ((ConvertTo-ComparableFacts $back) -eq (ConvertTo-ComparableFacts $builtFacts))
  Write-Host ("TASK_REGISTRATION_PROBE: {0} removed={1}" -f $(if ($same) { "PASS" } else { "FAIL" }), ($left -eq 0))
  Write-Host ("BUILT " + ($builtFacts | ConvertTo-Json -Depth 6 -Compress))
  Write-Host ("READ  " + ($back | ConvertTo-Json -Depth 6 -Compress))
  if ($same -and $left -eq 0) { exit 0 } else { exit 1 }
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

# ---------------------------------------------------------------- 2. inputs and tools
$repoPath = Get-SafePath $Repo "Repo" -MustExist
# //TR: Test kipi gerçek depoya yazamaz (durum yansıması ve etkinleştirme geçişi depoya dokunur); yalnız TEMP altındaki bir fikstür deposu kabul edilir.
if ($TestMode -and ((-not (Test-Under $tempRoot $repoPath)) -or (Test-AnyReparsePoint $repoPath $tempRoot))) { Stop-Bootstrap "TEST_MODE_REQUIRES_TEMP_REPO" $repoPath }
if (-not (Test-Path -LiteralPath (Join-Path $repoPath ".git"))) { Stop-Bootstrap "REPO_NOT_A_GIT_WORK_TREE" $repoPath }
if (-not (Test-Path -LiteralPath (Join-Path $repoPath ".ai\cache\review\ORCHESTRATOR_STATE.json") -PathType Leaf)) { Stop-Bootstrap "DURABLE_STATE_MISSING" $repoPath }
if (Test-Under $repoPath $ControlRoot) { Stop-Bootstrap "CONTROL_ROOT_INSIDE_REPO" }
$source = Get-SafePath (Split-Path -Parent $PSScriptRoot) "BootstrapSource" -MustExist
$installFiles = @("scripts/bootstrap-uasco-autonomy.ps1", "scripts/uasco-supervisor-entry.mjs", "scripts/uasco-supervisor-task.ps1")
foreach ($rel in $installFiles) { if (-not (Test-Path -LiteralPath (Join-Path $source $rel) -PathType Leaf)) { Stop-Bootstrap "BOOTSTRAP_SOURCE_FILE_MISSING" $rel } }
$nodeCmd = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$gitCmd = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCmd) { Stop-Bootstrap "NODE_NOT_FOUND" }
if (-not $gitCmd) { Stop-Bootstrap "GIT_NOT_FOUND" }
$script:Node = Get-SafePath $nodeCmd.Source "node.exe" -MustExist
$script:Git = Get-SafePath $gitCmd.Source "git.exe" -MustExist
if (-not $script:Node.EndsWith("\node.exe", [StringComparison]::OrdinalIgnoreCase)) { Stop-Bootstrap "NODE_PATH_UNEXPECTED" $script:Node }
$powershellExe = Get-SafePath (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") "powershell.exe" -MustExist
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
foreach ($rel in @("scripts/uasco-supervisor-entry.mjs", "scripts/uasco-supervisor-task.ps1")) {
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
$previousXml = $null; $hadPrevious = $false
if ((-not $TestMode) -or $script:TaskFake) {
  $existing = @(Invoke-TaskCtl "Find")
  if ($existing.Count -gt 1) { Stop-Bootstrap "TASK_NAME_AMBIGUOUS" ("{0} tasks named {1}" -f $existing.Count, $TaskName) }
  if ($existing.Count -eq 1) {
    $e = $existing[0]; $acts = @($e.Actions)
    $ours = ($e.TaskPath -eq "\") -and ($acts.Count -eq 1) -and (
      ($acts[0].Execute -eq $powershellExe -and ([string]$acts[0].Arguments).StartsWith(('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Repo "' -f $wrapper), [StringComparison]::OrdinalIgnoreCase)) -or
      ($acts[0].Execute -like "*\node.exe" -and ([string]$acts[0].Arguments).StartsWith('"' + $controlDir + '\', [StringComparison]::OrdinalIgnoreCase) -and ([string]$acts[0].Arguments) -match 'scripts\\uasco-(orchestrator|supervisor-launcher)\.mjs" --'))
    if (-not $ours) { Stop-Bootstrap "TASK_NAME_CONFLICT" (@($acts | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " | ") }
    if ([string]$e.State -eq "Running") { Stop-Bootstrap "SUPERVISOR_ALREADY_RUNNING" "the supervisor is running; the bootstrap is only needed again if the installation is broken" }
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

# ---------------------------------------------------------------- 8. install the stable entry and the hidden task wrapper (byte-identical to the verified source)
$installed = @{}
foreach ($pair in @(@{ src = "scripts\uasco-supervisor-entry.mjs"; rel = "scripts/uasco-supervisor-entry.mjs"; dst = $entry }, @{ src = "scripts\uasco-supervisor-task.ps1"; rel = "scripts/uasco-supervisor-task.ps1"; dst = $wrapper })) {
  $src = $staged[$pair.rel]; $tmp = "$($pair.dst).tmp-$PID"
  Copy-Item -LiteralPath $src -Destination $tmp -Force
  $blobTmp = ((Invoke-Git @("hash-object", "--no-filters", "--", $tmp) $source "INSTALL_COPY_HASH_FAILED") -join "").Trim()
  if ($blobTmp -ne $sourceBlobs[$pair.rel]) { Stop-Bootstrap "INSTALL_COPY_HASH_MISMATCH" $pair.src }
  Move-Item -LiteralPath $tmp -Destination $pair.dst -Force
  $installed[$pair.src] = Get-Sha256 $pair.dst
}

# ---------------------------------------------------------------- 9. activation under the single-worker lock: control\current, CURRENT.json, CONTROL_PLANE_ACTIVATED
$actLines = Invoke-Tool $script:Node @($entry, "--activate", "--repo", $repoPath, "--control-root", $ControlRoot, "--plane", $plane, "--expect-master", $master, "--bootstrap-commit", $sourceCommit) $plane "CONTROL_PLANE_ACTIVATION_FAILED" -AllowFailure
$act = $null; try { $act = ((@($actLines) | Select-Object -Last 1) -join "") | ConvertFrom-Json } catch { $act = $null }
if (-not $act -or -not $act.ok) { Stop-Bootstrap "CONTROL_PLANE_ACTIVATION_FAILED" ((@($actLines) | Select-Object -Last 1) -join "") }
Write-Step "CONTROL_PLANE_ACTIVATED $link -> $plane"

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
  $record.status = $(if ($undo.safe) { "ROLLED_BACK_TASK_NOT_RUNNABLE" } else { "ROLLBACK_UNSAFE" })
  $record.taskRegistration = "ROLLED_BACK"
  if (-not $record.firstRun) { $record.firstRun = [ordered]@{ verdict = "NOT_STARTED" } }
  $record.firstRun["rollback"] = [ordered]@{ cause = $code; preExistingTask = $hadPrevious; resultingTaskState = $undo.state; processesStopped = $killed; steps = $undo.notes }
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
$record = [ordered]@{
  "//TR" = "Bu kayit tek seferlik UASCO otonomi kurulumunun yapildigini ve neyin kuruldugunu tutar; kurulum yalniz bozulursa veya bilerek kaldirilirsa yinelenir."
  schemaVersion = "1.0.0"; status = "PENDING_FIRST_RUN"; installedAt = [DateTime]::UtcNow.ToString("o"); testMode = [bool]$TestMode; user = $userId
  bootstrapSource = [ordered]@{ path = $source; commit = $sourceCommit; scriptSha256 = $script:ScriptSha256Start; blobs = $sourceBlobs }
  controlRoot = $ControlRoot; controlPlane = [ordered]@{ commit = $master; path = $plane; link = $link; governedMerge = $verify.checks.governedMerge }
  entry = [ordered]@{ path = $entry; sha256 = $installed["scripts\uasco-supervisor-entry.mjs"] }; wrapper = [ordered]@{ path = $wrapper; sha256 = $installed["scripts\uasco-supervisor-task.ps1"] }
  task = [ordered]@{ taskName = $TaskName; facts = $facts }; taskRegistration = "NOT_REGISTERED_TEST_MODE"; firstRun = $null
  durableState = [ordered]@{ transitions = $verify.checks.transitionLog.entries; openPackages = $verify.queue.total; codex = $verify.providers.codex }
  signer = $signer; tools = [ordered]@{ node = $script:Node; nodeVersion = $nodeVersion; nodeSha256 = (Get-Sha256 $script:Node); git = $script:Git; gitVersion = $gitVersion }
  msixShadowCopies = $shadowCopies
  limits = @(
    "Runs while this user is signed in (a locked screen is fine); after a reboot it resumes at the next sign-in. It does not wake a sleeping PC. A pre-logon start would need S4U, which cannot use the DPAPI-protected ssh-agent key needed for secure local signing, or a stored password, which is not allowed.",
    "Recovery: the launcher restarts a crashed daemon with backoff; the entry kills a supervisor whose heartbeat is frozen; the periodic trigger restarts the task within 15 minutes. Task Scheduler's restart-on-failure only covers a task that fails to launch.",
    "Stop the supervisor with Global Stop (.ai/runtime/GLOBAL_STOP.json), not with Task Scheduler End or Disable.",
    "Founder decisions (for example a package blocked at its cycle limit) still need a Founder answer; routine operation needs no command.")
}
if ($TestMode -and -not $script:TaskFake) {
  Write-JsonAtomic (Join-Path $bootDir "task-definition.json") ([ordered]@{ taskName = $TaskName; facts = $facts })
  $record.status = "TEST_MODE_COMPLETE"
} else {
  if ($hadPrevious) { Set-Content -LiteralPath (Join-Path $bootDir "previous-task-definition.xml") -Value $previousXml -Encoding Unicode }
  $registerFailure = $null; $readBack = $null
  try {
    Invoke-TaskCtl "Register" $task
    $readBack = Invoke-TaskCtl "Facts"
    if ((ConvertTo-ComparableFacts $readBack) -ne (ConvertTo-ComparableFacts $facts)) { $registerFailure = "TASK_NOT_AS_REGISTERED" }
  } catch { $registerFailure = "TASK_REGISTRATION_VERIFY_FAILED"; $readBack = $_.Exception.Message }
  if ($registerFailure) { Stop-AfterRollback $registerFailure ($readBack | ConvertTo-Json -Depth 6 -Compress) }
  $record.taskRegistration = "REGISTERED"
  try {
    if ($script:TaskFake -and $script:TaskFake.failRecordWrite) { throw "FAKE_RECORD_WRITE_FAILED" }
    Write-JsonAtomic (Join-Path $ControlRoot "BOOTSTRAP_INSTALLED.json") $record
  } catch { Stop-AfterRollback "BOOTSTRAP_RECORD_WRITE_FAILED" $_.Exception.Message }
  Write-Step "TASK_REGISTERED $TaskName"
  # //TR: İlk çalıştırma, görev sürecinin kendisinin bu kurulumdan sonra yazdığı giriş kalp atışıyla doğrulanır; yalnız kayıt veya başlatma isteği başarı sayılmaz.
  $firstRunStartUtc = [DateTime]::UtcNow
  if ($script:TaskFake) {
    $record.status = "TEST_MODE_COMPLETE"; $record.taskRegistration = "REGISTERED_FAKE_CONTROLLER"
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
  # //TR: Giriş ilk sonucu bootstrap'tan önce kayda işlediyse (firstTick/firstSuccessfulRun) o sonuç korunur; bootstrap'ın kendi kararı firstRun içinde kalır.
  $onDisk = $null; try { $onDisk = Get-Content -LiteralPath (Join-Path $ControlRoot "BOOTSTRAP_INSTALLED.json") -Raw | ConvertFrom-Json } catch { $onDisk = $null }
  if ($onDisk -and ($onDisk.PSObject.Properties.Name -contains "firstRun") -and $onDisk.firstRun) {
    foreach ($k in @("firstTick", "firstSuccessfulRun")) { if ($onDisk.firstRun.PSObject.Properties.Name -contains $k) { $record.firstRun[$k] = $onDisk.firstRun.$k; $record.status = [string]$onDisk.status } }
  }
  }
  # //TR: Başarısız bir ilk çalıştırma kararında görev çalıştırılabilir bırakılmaz: çalışan örnek ve bu kontrol köküne ait süreçler durdurulur, görev geri alınır (önceden var olan görev eski tanımıyla DEVRE DIŞI geri yüklenir), ret kodu karardır.
  if ($record.firstRun -and (@("INSTALLED", "INSTALLED_FIRST_TICK_PENDING", "TEST_MODE_COMPLETE") -notcontains $record.status)) {
    Stop-AfterRollback ([string]$record.firstRun.verdict) ("first run not confirmed: entryState={0} reason={1} lastTaskResult={2} taskState={3}" -f $record.firstRun.entryState, $record.firstRun.entryReason, $record.firstRun.lastTaskResult, $record.firstRun.taskState) -Running
  }
}

# ---------------------------------------------------------------- 12. durable record and its mirror in the repository
Write-JsonAtomic (Join-Path $ControlRoot "BOOTSTRAP_INSTALLED.json") $record
Write-JsonAtomic (Join-Path $repoPath ".ai\runtime\BOOTSTRAP_STATUS.json") ([ordered]@{
  "//TR" = "Bu dosya tek seferlik otonomi kurulumunun sonucunu depo icinde pasif olarak yansitir; sir icermez ve bir karar degildir."
  schemaVersion = "1.0.0"; updatedAt = [DateTime]::UtcNow.ToString("o"); installed = [ordered]@{ status = $record.status; installedAt = $record.installedAt; taskName = $TaskName; controlPlaneCommit = $master; entrySha256 = $record.entry.sha256; bootstrapCommit = $sourceCommit; testMode = [bool]$TestMode }; firstRun = $record.firstRun; signer = $signer })
if (@("INSTALLED", "INSTALLED_FIRST_TICK_PENDING", "TEST_MODE_COMPLETE") -contains $record.status) {
  Write-Step ("BOOTSTRAP_COMPLETE status={0} controlPlane={1} entrySha256={2} signerKeyLoaded={3}" -f $record.status, $master.Substring(0, 12), $record.entry.sha256, $signer.keyLoaded)
  exit 0
}
Stop-Bootstrap $record.status "unexpected install status"
