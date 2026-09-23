# //TR: Bu script dependency/validation tamamlandıktan sonra fresh klasörü Git repo yapar, repo-local automation identity ayarlar, initial baseline commit oluşturur ve remote verilirse PRIVATE durumu doğrulanmadan push etmez (explicit override hariç).
param(
  [string]$RemoteUrl="",
  [switch]$AllowUnverifiedRemote
)
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force ".ai\runtime" | Out-Null
$GitIsolationRoot=Join-Path ([IO.Path]::GetTempPath()) ("uasco-git-isolation-"+[guid]::NewGuid().ToString("N"))
$GitHooks=Join-Path $GitIsolationRoot "hooks"
New-Item -ItemType Directory -Force $GitHooks | Out-Null
$GitGlobal=Join-Path $GitIsolationRoot "global.gitconfig";$GitSystem=Join-Path $GitIsolationRoot "system.gitconfig"
Set-Content -NoNewline -Encoding ASCII $GitGlobal "";Set-Content -NoNewline -Encoding ASCII $GitSystem ""
$env:GIT_CONFIG_GLOBAL=$GitGlobal;$env:GIT_CONFIG_SYSTEM=$GitSystem;$env:GIT_CONFIG_NOSYSTEM="1";$env:GIT_TERMINAL_PROMPT="0"
function Invoke-UascoGit { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$GitArgs) & git -c "core.hooksPath=$GitHooks" @GitArgs }


if(-not (Test-Path ".git")){
  Invoke-UascoGit init
  if($LASTEXITCODE -ne 0){throw "git init failed"}
  Invoke-UascoGit branch -M main
  Invoke-UascoGit config --local user.name "UASCO Automation"
  Invoke-UascoGit config --local user.email "uasco@local.invalid"
  Invoke-UascoGit add --all
  Invoke-UascoGit commit -m "chore: initialize UASCO mechanically-closed canonical starter"
  if($LASTEXITCODE -ne 0){throw "initial commit failed"}
}
$inside=(Invoke-UascoGit rev-parse --is-inside-work-tree).Trim();if($inside -ne "true"){throw "Not a Git worktree"}
if(-not (Invoke-UascoGit config --local user.name)){Invoke-UascoGit config --local user.name "UASCO Automation"}
if(-not (Invoke-UascoGit config --local user.email)){Invoke-UascoGit config --local user.email "uasco@local.invalid"}

$visibility="LOCAL_ONLY";$detail="No origin remote configured";$protection="LOCAL_SUPERVISOR_MERGE_GATE"
if($RemoteUrl){
  Invoke-UascoGit remote get-url origin 2>$null
  if($LASTEXITCODE -ne 0){Invoke-UascoGit remote add origin $RemoteUrl}else{Invoke-UascoGit remote set-url origin $RemoteUrl}
  $safeRemote=$RemoteUrl -replace '(https?://)[^/@]+@','$1***@';$detail=$safeRemote;$visibility="REMOTE_UNVERIFIED"
  if(Get-Command gh -ErrorAction SilentlyContinue){
    try{
      $json=gh repo view --json visibility,url 2>$null | ConvertFrom-Json
      if($json.visibility -eq "PRIVATE"){$visibility="PRIVATE_VERIFIED"}else{$visibility="NOT_PRIVATE"}
    }catch{$visibility="REMOTE_UNVERIFIED"}
  }
  if($visibility -eq "NOT_PRIVATE"){throw "Remote repository is NOT PRIVATE; refusing push."}
  if($visibility -ne "PRIVATE_VERIFIED" -and -not $AllowUnverifiedRemote){throw "Remote privacy could not be verified. Authenticate GitHub CLI or rerun explicitly with -AllowUnverifiedRemote only after manual privacy verification."}
  Invoke-UascoGit push -u origin main
  if($LASTEXITCODE -ne 0){throw "initial remote push failed"}
  $local=(Invoke-UascoGit rev-parse HEAD).Trim();$remote=(Invoke-UascoGit ls-remote origin refs/heads/main).Split()[0];if($remote -ne $local){throw "Remote SHA verification failed"}
  if(Get-Command gh -ErrorAction SilentlyContinue){try{node ".\scripts\configure-github-protection.mjs"|Out-Host}catch{Write-Warning "GitHub branch protection auto-config could not be completed; supervisor will remain local-only unless protection verifies."}}
}
@{
  "//TR"="Bu runtime report Git repo, remote privacy ve local merge-gate durumunu kaydeder.";checkedAt=(Get-Date).ToString("o");visibility=$visibility;detail=$detail;protection=$protection;head=(Invoke-UascoGit rev-parse HEAD).Trim()
}|ConvertTo-Json -Depth 5|ForEach-Object{[System.IO.File]::WriteAllText((Join-Path (Get-Location) ".ai\runtime\REMOTE_STATUS.json"),$_,(New-Object System.Text.UTF8Encoding($false)))}
Remove-Item -Recurse -Force $GitIsolationRoot -ErrorAction SilentlyContinue
Write-Host "GIT_INIT: PASS ($visibility)"
