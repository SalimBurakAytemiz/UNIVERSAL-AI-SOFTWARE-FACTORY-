# //TR: Bu script dependency/validation tamamlandıktan sonra fresh klasörü Git repo yapar, repo-local automation identity ayarlar, initial baseline commit oluşturur ve remote verilirse PRIVATE durumu doğrulanmadan push etmez (explicit override hariç).
param(
  [string]$RemoteUrl="",
  [switch]$AllowUnverifiedRemote
)
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force ".ai\runtime" | Out-Null

if(-not (Test-Path ".git")){
  git init
  if($LASTEXITCODE -ne 0){throw "git init failed"}
  git branch -M main
  git config user.name "UASCO Automation"
  git config user.email "uasco@local.invalid"
  git add --all
  git commit -m "chore: initialize UASCO mechanically-closed canonical starter"
  if($LASTEXITCODE -ne 0){throw "initial commit failed"}
}
$inside=(git rev-parse --is-inside-work-tree).Trim();if($inside -ne "true"){throw "Not a Git worktree"}
if(-not (git config user.name)){git config user.name "UASCO Automation"}
if(-not (git config user.email)){git config user.email "uasco@local.invalid"}

$visibility="LOCAL_ONLY";$detail="No origin remote configured";$protection="LOCAL_SUPERVISOR_MERGE_GATE"
if($RemoteUrl){
  git remote get-url origin 2>$null
  if($LASTEXITCODE -ne 0){git remote add origin $RemoteUrl}else{git remote set-url origin $RemoteUrl}
  $safeRemote=$RemoteUrl -replace '(https?://)[^/@]+@','$1***@';$detail=$safeRemote;$visibility="REMOTE_UNVERIFIED"
  if(Get-Command gh -ErrorAction SilentlyContinue){
    try{
      $json=gh repo view --json visibility,url 2>$null | ConvertFrom-Json
      if($json.visibility -eq "PRIVATE"){$visibility="PRIVATE_VERIFIED"}else{$visibility="NOT_PRIVATE"}
    }catch{$visibility="REMOTE_UNVERIFIED"}
  }
  if($visibility -eq "NOT_PRIVATE"){throw "Remote repository is NOT PRIVATE; refusing push."}
  if($visibility -ne "PRIVATE_VERIFIED" -and -not $AllowUnverifiedRemote){throw "Remote privacy could not be verified. Authenticate GitHub CLI or rerun explicitly with -AllowUnverifiedRemote only after manual privacy verification."}
  git push -u origin main
  if($LASTEXITCODE -ne 0){throw "initial remote push failed"}
  $local=(git rev-parse HEAD).Trim();$remote=(git ls-remote origin refs/heads/main).Split()[0];if($remote -ne $local){throw "Remote SHA verification failed"}
  if(Get-Command gh -ErrorAction SilentlyContinue){try{node ".\scripts\configure-github-protection.mjs"|Out-Host}catch{Write-Warning "GitHub branch protection auto-config could not be completed; supervisor will remain local-only unless protection verifies."}}
}
@{
  "//TR"="Bu runtime report Git repo, remote privacy ve local merge-gate durumunu kaydeder.";checkedAt=(Get-Date).ToString("o");visibility=$visibility;detail=$detail;protection=$protection;head=(git rev-parse HEAD).Trim()
}|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 ".ai\runtime\REMOTE_STATUS.json"
Write-Host "GIT_INIT: PASS ($visibility)"
