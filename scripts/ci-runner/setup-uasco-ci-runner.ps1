# //TR: UASCO self-hosted Windows runner'ini UASCO-CI STANDART hesabi altinda guvenli kuran tek seferlik betik (VM yok, ek ucret yok). Resmi GitHub actions/runner paketi + SHA-256 (release notu isareti ve API asset digest, ikisi de varsa eslesmeli) + Authenticode imza dogrulamasi. Kayit/kaldirma token'i ve hesap parolasi SecureString ile alinir; ekrana, log'a, dosyaya veya commit'e ASLA yazilmaz. Yonetici (UAC) yalnizca servis kaydi ve ACL icindir; runner servisi UASCO-CI olarak yoneticisiz calisir. Modlar: -Audit (varsayilan, salt-okunur) | -Install | -RemoveOld -OldRunnerDir <yol>.
<#
.SYNOPSIS
  One-time, least-privilege setup of the UASCO Windows self-hosted runner under the
  standard local account UASCO-CI. Default mode is -Audit (read-only, no changes).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\ci-runner\setup-uasco-ci-runner.ps1            # audit only
  # elevated (Run as administrator), once:
  powershell -ExecutionPolicy Bypass -File scripts\ci-runner\setup-uasco-ci-runner.ps1 -Install
  # only after the smoke workflow printed RUNNER_SMOKE: PASS:
  powershell -ExecutionPolicy Bypass -File scripts\ci-runner\setup-uasco-ci-runner.ps1 -RemoveOld -OldRunnerDir C:\path\to\old\actions-runner

.NOTES
  Never paste tokens or passwords into chat or files. The script prompts for them as SecureString
  and redacts them from any captured output. It never reads .credentials* files.
#>
[CmdletBinding()]
param(
  [switch]$Audit,
  [switch]$Install,
  [switch]$RemoveOld,
  [string]$OldRunnerDir = '',
  [string]$RepoUrl = 'https://github.com/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-',
  [string]$Account = 'UASCO-CI',
  [string]$RunnerRoot = 'C:\uasco-ci\actions-runner',
  [string]$RunnerName = 'uasco-ci-win',
  [string]$Label = 'uasco-ci'
)
Set-StrictMode -Version 1
$ErrorActionPreference = 'Stop'
if (-not ($Install -or $RemoveOld)) { $Audit = $true }

# Well-known SIDs (locale-independent: on Turkish Windows "Administrators" is "Yoneticiler").
$AdminsSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'
$BroadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')   # Everyone, Authenticated Users, Users
$script:NativeExit = 0

function Write-Step([string]$m) { Write-Host "[uasco-ci] $m" }

function Test-IsElevated {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertTo-PlainText([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# Windows PowerShell 5.1 turns redirected native stderr into terminating errors under 'Stop';
# run native tools with 'Continue' and capture the exit code explicitly.
function Invoke-Native([string]$exe, [string[]]$argv) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $o = & $exe @argv 2>&1 | ForEach-Object { [string]$_ }
    $script:NativeExit = $LASTEXITCODE
    return $o
  } finally { $ErrorActionPreference = $prev }
}

function Get-AccountState {
  $u = Get-LocalUser -Name $Account -ErrorAction SilentlyContinue
  if (-not $u) { return [pscustomobject]@{ Exists = $false; Enabled = $false; IsAdmin = $null; Sid = $null } }
  $isAdmin = $null
  try {
    $members = Get-LocalGroupMember -SID $AdminsSid -ErrorAction Stop
    $isAdmin = [bool]($members | Where-Object { $_.SID -and $_.SID.Value -eq $u.SID.Value })
  } catch {
    # Get-LocalGroupMember can fail on orphaned SIDs; fall back to ADSI via the translated group name.
    $grp = (New-Object Security.Principal.SecurityIdentifier($AdminsSid)).Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
    $adsi = [ADSI]"WinNT://$env:COMPUTERNAME/$grp,group"
    $names = @($adsi.psbase.Invoke('Members') | ForEach-Object { $_.GetType().InvokeMember('Name', 'GetProperty', $null, $_, $null) })
    $isAdmin = $names -contains $Account
  }
  return [pscustomobject]@{ Exists = $true; Enabled = $u.Enabled; IsAdmin = $isAdmin; Sid = $u.SID.Value }
}

function Get-RunnerServices {
  @(Get-CimInstance Win32_Service | Where-Object { $_.Name -like 'actions.runner.*' } | ForEach-Object {
    $exe = ($_.PathName -replace '^"([^"]+)".*$', '$1')
    $dir = Split-Path (Split-Path $exe -Parent) -Parent
    $agent = $null
    $rf = Join-Path $dir '.runner'   # .runner is non-secret metadata; .credentials* are never read
    if (Test-Path -LiteralPath $rf) { try { $agent = (Get-Content -LiteralPath $rf -Raw | ConvertFrom-Json).agentName } catch { $agent = $null } }
    [pscustomobject]@{ Service = $_.Name; State = $_.State; StartMode = $_.StartMode; RunsAs = $_.StartName; Dir = $dir; Agent = $agent }
  })
}

function Get-SidOf($identityReference) {
  try { return $identityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { return $null }
}

function Invoke-Audit {
  $os = (Get-CimInstance Win32_OperatingSystem).Caption
  Write-Step "OS: $os | PowerShell: $($PSVersionTable.PSVersion) | elevated: $(Test-IsElevated)"
  $a = Get-AccountState
  if (-not $a.Exists) { Write-Step "FAIL: local account '$Account' not found" }
  else {
    Write-Step "account '$Account': enabled=$($a.Enabled) isAdministrator=$($a.IsAdmin)"
    if ($a.IsAdmin -ne $false) { Write-Step "FAIL: '$Account' must be a STANDARD user (not in Administrators)" }
  }
  $svcs = Get-RunnerServices
  if ($svcs.Count -eq 0) { Write-Step 'no actions.runner.* Windows service registered' }
  foreach ($s in $svcs) {
    Write-Step ("runner service: {0} | state={1} | start={2} | runsAs={3} | agent={4} | dir={5}" -f $s.Service, $s.State, $s.StartMode, $s.RunsAs, $s.Agent, $s.Dir)
  }
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) { Write-Step "git on PATH: $(& git --version)" }
  else { Write-Step 'git on PATH: NO (actions/checkout falls back to a REST download without history; install Git for Windows machine-wide)' }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { Write-Step "node on PATH: $(& node --version)" }
  else { Write-Step 'node on PATH: no (OK: actions/setup-node installs Node 24 into the runner tool cache)' }
  # Exposure of the invoking user's profile: neither the runner account nor broad groups may hold an ACE.
  $prof = $env:USERPROFILE
  $bad = @()
  foreach ($ace in (Get-Acl -LiteralPath $prof).Access) {
    $sid = Get-SidOf $ace.IdentityReference
    if ($sid -and (($BroadSids -contains $sid) -or ($a.Sid -and $sid -eq $a.Sid))) { $bad += "$($ace.IdentityReference)=$($ace.FileSystemRights)" }
  }
  if ($bad.Count) { Write-Step "WARN: profile '$prof' grants: $($bad -join '; ')" } else { Write-Step "profile '$prof': no runner/broad ACEs (OK)" }
}

function Invoke-Install {
  if (-not (Test-IsElevated)) { throw 'UAC_REQUIRED: run -Install from an elevated PowerShell (Run as administrator). Admin is used only for the service registration and ACLs; the runner itself runs as the standard account.' }
  $a = Get-AccountState
  if (-not $a.Exists) { throw "ACCOUNT_MISSING: create the standard local user '$Account' first" }
  if ($a.IsAdmin -ne $false) { throw "ACCOUNT_NOT_STANDARD: '$Account' is (or could not be proven not to be) an Administrator; refusing (fail-closed)" }
  if ((Test-Path -LiteralPath $RunnerRoot) -and (Get-ChildItem -LiteralPath $RunnerRoot -Force | Select-Object -First 1)) {
    throw "TARGET_NOT_EMPTY: $RunnerRoot already contains files; refusing to overwrite (choose another -RunnerRoot or remove it deliberately)"
  }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $hdr = @{ 'User-Agent' = 'uasco-ci-setup'; 'Accept' = 'application/vnd.github+json' }
  $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' -Headers $hdr
  $ver = ([string]$rel.tag_name).TrimStart('v')
  $assetName = "actions-runner-win-x64-$ver.zip"
  $asset = @($rel.assets | Where-Object { $_.name -eq $assetName })[0]
  if (-not $asset) { throw "ASSET_MISSING: $assetName not found in release $($rel.tag_name)" }

  # Expected SHA-256 from two official sources; fail closed if none exists or if they disagree.
  $fromNotes = $null
  $m = [regex]::Match([string]$rel.body, '<!--\s*BEGIN SHA win-x64\s*-->\s*([0-9a-fA-F]{64})\s*<!--\s*END SHA win-x64\s*-->')
  if ($m.Success) { $fromNotes = $m.Groups[1].Value.ToLowerInvariant() }
  $fromDigest = $null
  if ($asset.PSObject.Properties['digest'] -and ([string]$asset.digest) -match '^sha256:([0-9a-fA-F]{64})$') { $fromDigest = $Matches[1].ToLowerInvariant() }
  if (-not $fromNotes -and -not $fromDigest) { throw 'NO_OFFICIAL_HASH: neither the release-notes SHA nor the asset digest is available; refusing' }
  if ($fromNotes -and $fromDigest -and $fromNotes -ne $fromDigest) { throw "HASH_SOURCES_DISAGREE: notes=$fromNotes digest=$fromDigest" }
  $expected = $fromNotes
  if (-not $expected) { $expected = $fromDigest }

  $parent = Split-Path $RunnerRoot -Parent
  New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null
  $zip = Join-Path $parent $assetName
  Write-Step "downloading $assetName ($($rel.tag_name)) from GitHub"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = 'uasco-ci-setup' }
  $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { Remove-Item -LiteralPath $zip -Force; throw "SHA256_MISMATCH: expected=$expected actual=$actual (download deleted)" }
  Write-Step "SHA-256 verified: $actual"
  Expand-Archive -LiteralPath $zip -DestinationPath $RunnerRoot
  Remove-Item -LiteralPath $zip -Force

  $listener = Join-Path $RunnerRoot 'bin\Runner.Listener.exe'
  $sig = Get-AuthenticodeSignature -LiteralPath $listener
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'GitHub|Microsoft') { throw "AUTHENTICODE_INVALID: status=$($sig.Status) signer=$($sig.SignerCertificate.Subject)" }
  Write-Step "Authenticode valid: $($sig.SignerCertificate.Subject)"

  # Least-privilege ACL on the runner tree: Administrators + SYSTEM full, the runner account Modify, nobody else.
  Invoke-Native 'icacls.exe' @($parent, '/inheritance:r', '/grant:r', "*${AdminsSid}:(OI)(CI)F", "*${SystemSid}:(OI)(CI)F", "*$($a.Sid):(OI)(CI)M") | Out-Null
  if ($script:NativeExit -ne 0) { throw "ICACLS_FAILED: exit $($script:NativeExit)" }

  $tokS = Read-Host -AsSecureString 'GitHub runner REGISTRATION token (Settings > Actions > Runners > New self-hosted runner; input hidden)'
  $pwS = Read-Host -AsSecureString "Password of local account '$Account' (input hidden; used only to register the Windows service)"
  $tok = ConvertTo-PlainText $tokS
  $pw = ConvertTo-PlainText $pwS
  try {
    if ([string]::IsNullOrWhiteSpace($tok) -or [string]::IsNullOrWhiteSpace($pw)) { throw 'EMPTY_SECRET: token and password are required' }
    $cfgArgs = @('configure', '--unattended', '--url', $RepoUrl, '--token', $tok, '--name', $RunnerName, '--labels', $Label,
                 '--work', '_work', '--replace', '--runasservice', '--windowslogonaccount', ".\$Account", '--windowslogonpassword', $pw)
    $out = Invoke-Native $listener $cfgArgs | ForEach-Object { $_.Replace($tok, '***').Replace($pw, '***') }
    $code = $script:NativeExit
    $out | ForEach-Object { Write-Host "  $_" }
    if ($code -ne 0) { throw "RUNNER_CONFIGURE_FAILED: exit $code (redacted output above)" }
  } finally {
    $tok = $null; $pw = $null; $cfgArgs = $null; $out = $null
    [GC]::Collect()
  }

  $svc = @(Get-RunnerServices | Where-Object { $_.Agent -eq $RunnerName -or $_.Dir -eq $RunnerRoot })[0]
  if (-not $svc) { throw 'SERVICE_NOT_FOUND after configure' }
  if ($svc.RunsAs -notmatch ('\\' + [regex]::Escape($Account) + '$')) { throw "SERVICE_WRONG_ACCOUNT: service runs as '$($svc.RunsAs)', expected '$Account'" }
  if ($svc.State -ne 'Running') { Start-Service -Name $svc.Service; Start-Sleep -Seconds 3 }
  $svc = @(Get-RunnerServices | Where-Object { $_.Service -eq $svc.Service })[0]
  Write-Step ("INSTALLED: service={0} state={1} runsAs={2} labels=self-hosted,Windows,X64,{3}" -f $svc.Service, $svc.State, $svc.RunsAs, $Label)
  Write-Step 'NEXT: push the PR #30 branch to ci/selfhosted-smoke; the safe smoke workflow must print RUNNER_SMOKE: PASS before -RemoveOld.'
}

function Invoke-RemoveOld {
  if (-not (Test-IsElevated)) { throw 'UAC_REQUIRED: run -RemoveOld from an elevated PowerShell' }
  if (-not $OldRunnerDir) { throw 'OLD_DIR_REQUIRED: pass -OldRunnerDir <folder of the OLD runner> explicitly (no guessing)' }
  $old = (Resolve-Path -LiteralPath $OldRunnerDir).Path.TrimEnd('\')
  if ($old -ieq $RunnerRoot.TrimEnd('\')) { throw 'REFUSE: -OldRunnerDir points at the NEW UASCO-CI runner' }
  $new = @(Get-RunnerServices | Where-Object { $_.Dir -ieq $RunnerRoot.TrimEnd('\') -and $_.State -eq 'Running' -and $_.RunsAs -match ('\\' + [regex]::Escape($Account) + '$') })[0]
  if (-not $new) { throw 'NEW_RUNNER_NOT_RUNNING: refuse to remove the old runner before the UASCO-CI runner is installed, running and running as the standard account' }
  $listener = Join-Path $old 'bin\Runner.Listener.exe'
  if (-not (Test-Path -LiteralPath $listener)) { throw "NOT_A_RUNNER_DIR: $old" }
  $tokS = Read-Host -AsSecureString 'GitHub REMOVAL token for the OLD runner (Settings > Actions > Runners > old runner > Remove; input hidden)'
  $tok = ConvertTo-PlainText $tokS
  try {
    if ([string]::IsNullOrWhiteSpace($tok)) { throw 'EMPTY_SECRET: removal token required' }
    $out = Invoke-Native $listener @('remove', '--token', $tok) | ForEach-Object { $_.Replace($tok, '***') }
    $code = $script:NativeExit
    $out | ForEach-Object { Write-Host "  $_" }
    if ($code -ne 0) { throw "RUNNER_REMOVE_FAILED: exit $code (redacted output above)" }
  } finally { $tok = $null; $out = $null; [GC]::Collect() }
  Write-Step "OLD runner unregistered from GitHub and its Windows service removed. Folder '$old' was NOT deleted; review and delete it manually."
}

try {
  if ($Audit) { Invoke-Audit }
  if ($Install) { Invoke-Audit; Invoke-Install }
  if ($RemoveOld) { Invoke-RemoveOld }
} catch {
  Write-Host "[uasco-ci] ERROR: $($_.Exception.Message)"
  exit 1
}
