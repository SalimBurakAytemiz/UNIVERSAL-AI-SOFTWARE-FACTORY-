# //TR: YALNIZ TANI betigi: runner'in yukseltilmis oldugunu gosterir; ayni BS1 senaryosunu A) runas /trustlevel:0x20000 (ayni kullanici, Administrators deny-only) ve B) gecici standart yerel kullanici altinda calistirir; sonuclari yazdirir. Hicbir PASS uydurmaz.
$ErrorActionPreference = "Continue"
$repo = $env:GITHUB_WORKSPACE
$node = (Get-Command node).Source
$git = (Get-Command git).Source
$scenario = "bootstrap-task-rollback-falls-back-to-disable-and-reports-an-unsafe-result"
"runner IsInRole(Administrator)=" + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"identity=" + [Security.Principal.WindowsIdentity]::GetCurrent().Name
"EnableLUA=" + (Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name EnableLUA -ErrorAction SilentlyContinue).EnableLUA
"repo owner=" + (Get-Acl $repo).Owner
function Write-Probe($dir) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  $safe = $repo -replace '\\', '/'
  $c = @"
@echo off
cd /d "$repo"
set "GIT_CONFIG_COUNT=1"
set "GIT_CONFIG_KEY_0=safe.directory"
set "GIT_CONFIG_VALUE_0=$safe"
powershell.exe -NoProfile -Command "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); [Security.Principal.WindowsIdentity]::GetCurrent().Name; `$env:TEMP" > "$dir\elev.txt" 2>&1
"$git" -C "$repo" rev-parse HEAD > "$dir\git.txt" 2>&1
set "UASCO_BS1_SHARDS="
set "UASCO_BS1_ONLY=$scenario"
"$node" scripts\bootstrap-autonomy-selftest.mjs > "$dir\selftest.txt" 2>&1
echo %ERRORLEVEL% > "$dir\done.txt"
"@
  Set-Content -Encoding ascii "$dir\probe.cmd" $c
}
function Wait-Done($dir, $min) {
  $t = [DateTime]::UtcNow.AddMinutes($min)
  while (-not (Test-Path "$dir\done.txt") -and [DateTime]::UtcNow -lt $t) { Start-Sleep 5 }
  foreach ($f in 'elev', 'git', 'done') { "--- $f"; Get-Content "$dir\$f.txt" -ErrorAction SilentlyContinue }
  "--- selftest tail"; Get-Content "$dir\selftest.txt" -Tail 25 -ErrorAction SilentlyContinue
}
"===== A: runas /trustlevel:0x20000"
$a = "$env:RUNNER_TEMP\pa"; Write-Probe $a
$sw = [Diagnostics.Stopwatch]::StartNew()
runas /trustlevel:0x20000 "cmd.exe /c $a\probe.cmd"
"runas exit=$LASTEXITCODE"
Wait-Done $a 12
"A elapsed s=" + [int]$sw.Elapsed.TotalSeconds
"===== B: temporary standard local user"
$pw = "Aa1!" + [guid]::NewGuid().ToString("N")
"::add-mask::$pw"
net user uascostd $pw /add /Y | Out-Null
"net user exit=$LASTEXITCODE"
$b = "$env:RUNNER_TEMP\pb"; Write-Probe $b
icacls $repo /grant "uascostd:(OI)(CI)M" /T /C /Q | Out-Null
icacls $b /grant "uascostd:(OI)(CI)M" /T /C /Q | Out-Null
"icacls exit=$LASTEXITCODE"
$cred = [pscredential]::new("uascostd", (ConvertTo-SecureString $pw -AsPlainText -Force))
$sw = [Diagnostics.Stopwatch]::StartNew()
try { Start-Process -Credential $cred -FilePath cmd.exe -ArgumentList "/c `"$b\probe.cmd`"" -LoadUserProfile -WorkingDirectory $b -Wait -WindowStyle Hidden } catch { "Start-Process failed: $_" }
Wait-Done $b 12
"B elapsed s=" + [int]$sw.Elapsed.TotalSeconds
exit 0
