# //TR: Bu script OmniRoute eksikse npm metadata'dan version/license/repository/dist.integrity keşfeder, policy identity/license kontrolünü geçmeden kurmaz, sonra exact version kurup provenance kaydeder ve local endpoint health probe yapar.
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$policy=Get-Content ".\config\omniroute-policy.json" -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force ".ai\runtime" | Out-Null

if(-not (Get-Command omniroute -ErrorAction SilentlyContinue)){
  $raw=npm view $policy.packageName version license repository.url dist.integrity --json
  if($LASTEXITCODE -ne 0){throw "Could not query OmniRoute npm metadata"}
  $meta=$raw|ConvertFrom-Json
  $version=[string]$meta.version
  $license=[string]$meta.license
  $repo=[string]$meta.repository.url
  $integrity=[string]$meta.dist.integrity
  if(-not $version -or -not $integrity){throw "OmniRoute metadata missing version/integrity"}
  if($policy.allowedLicenses -notcontains $license){throw "OmniRoute license not allowed by policy: $license"}
  $repoOk=$false
  foreach($needle in $policy.expectedRepositorySubstrings){if($repo -like "*$needle*"){$repoOk=$true}}
  if(-not $repoOk){throw "OmniRoute package repository identity mismatch: $repo"}
  $candidate=@{
    "//TR"="Bu runtime provenance kaydı install öncesi npm metadata ile doğrulanan OmniRoute package kimliğini taşır."
    package=$policy.packageName;version=$version;license=$license;repository=$repo;integrity=$integrity;discoveredAt=(Get-Date).ToString("o")
  }
  $json=$candidate|ConvertTo-Json -Depth 5;[System.IO.File]::WriteAllText((Join-Path (Get-Location) ".ai\runtime\OMNIROUTE_CANDIDATE.json"),$json,(New-Object System.Text.UTF8Encoding($false)))
  npm install -g "$($policy.packageName)@$version"
  if($LASTEXITCODE -ne 0){throw "OmniRoute exact-version install failed"}
  $candidate.installedAt=(Get-Date).ToString("o")
  $json=$candidate|ConvertTo-Json -Depth 5;[System.IO.File]::WriteAllText((Join-Path (Get-Location) ".ai\runtime\OMNIROUTE_INSTALL.json"),$json,(New-Object System.Text.UTF8Encoding($false)))
}

$base=([string]$policy.endpoint).TrimEnd("/")
try{Invoke-WebRequest -UseBasicParsing "$base/models" -TimeoutSec 2|Out-Null;Write-Host "OMNIROUTE REACHABLE";exit 0}catch{}
Start-Process -WindowStyle Minimized -FilePath "omniroute" | Out-Null
Start-Sleep 5
try{Invoke-WebRequest -UseBasicParsing "$base/models" -TimeoutSec 3|Out-Null;Write-Host "OMNIROUTE STARTED"}
catch{Write-Warning "OmniRoute installed/started but provider/dashboard setup may still require one-time credentials. Runtime remains NOT_VERIFIED until /models succeeds."}
