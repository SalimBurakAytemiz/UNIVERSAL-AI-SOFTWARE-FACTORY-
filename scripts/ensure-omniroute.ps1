# //TR: Bu script OmniRoute eksikse npm metadata'dan version/license/repository/dist.integrity keşfeder, policy identity/license kontrolünü geçmeden kurmaz, sonra exact version kurup provenance kaydeder ve local endpoint health probe yapar.
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
& ".\scripts\sanitize-process-env.ps1"
$policy=Get-Content ".\config\omniroute-policy.json" -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force ".ai\runtime" | Out-Null
$trustedRegistry="https://registry.npmjs.org/"
foreach($name in @("NPM_CONFIG_REGISTRY","NPM_CONFIG_USERCONFIG","NPM_CONFIG_CAFILE","NPM_CONFIG_PROXY","NPM_CONFIG_HTTPS_PROXY","NODE_EXTRA_CA_CERTS","SSL_CERT_FILE","SSL_CERT_DIR")){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}

if(-not (Get-Command omniroute -ErrorAction SilentlyContinue)){
  $raw=npm --registry=$trustedRegistry --strict-ssl=true --ignore-scripts view $policy.packageName version license repository.url dist.integrity --json
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
  npm --registry=$trustedRegistry --strict-ssl=true --ignore-scripts install -g "$($policy.packageName)@$version"
  if($LASTEXITCODE -ne 0){throw "OmniRoute exact-version install failed"}
  if(-not (Get-Command omniroute -ErrorAction SilentlyContinue)){throw "OmniRoute launcher missing after install"}
  $installedRaw=npm list -g $policy.packageName --depth=0 --json
  if($LASTEXITCODE -ne 0){throw "Could not verify installed OmniRoute package"}
  $installed=($installedRaw|ConvertFrom-Json).dependencies.($policy.packageName).version
  if([string]$installed -ne $version){throw "Installed OmniRoute version mismatch: expected=$version actual=$installed"}
  $candidate.installedVersion=[string]$installed
  $candidate.installedAt=(Get-Date).ToString("o")
  $json=$candidate|ConvertTo-Json -Depth 5;[System.IO.File]::WriteAllText((Join-Path (Get-Location) ".ai\runtime\OMNIROUTE_INSTALL.json"),$json,(New-Object System.Text.UTF8Encoding($false)))
}

# //TR: PATH üzerinde aynı isimli arbitrary executable bulunması install/provenance kontrolünü bypass edemez; launcher npm global prefix ve expected package identity ile bağlanır.
$cmd=Get-Command omniroute -ErrorAction Stop
$npmPrefix=(npm prefix -g).Trim();if($LASTEXITCODE -ne 0 -or -not $npmPrefix){throw "Could not resolve npm global prefix for OmniRoute launcher verification"}
$launcher=[IO.Path]::GetFullPath([string]$cmd.Source);$prefixFull=[IO.Path]::GetFullPath($npmPrefix).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
if(-not $launcher.StartsWith($prefixFull,[StringComparison]::OrdinalIgnoreCase)){throw "OmniRoute launcher is outside npm global prefix: $launcher"}
$globalRoot=(npm root -g).Trim();if($LASTEXITCODE -ne 0 -or -not $globalRoot){throw "Could not resolve npm global root for OmniRoute package verification"}
$pkgJson=Join-Path $globalRoot (Join-Path $policy.packageName "package.json");if(-not (Test-Path -LiteralPath $pkgJson -PathType Leaf)){throw "OmniRoute global package.json missing"}
$installedPkg=Get-Content -LiteralPath $pkgJson -Raw|ConvertFrom-Json;if([string]$installedPkg.name -ne [string]$policy.packageName){throw "OmniRoute installed package identity mismatch"};if($policy.allowedLicenses -notcontains [string]$installedPkg.license){throw "OmniRoute installed package license not allowed: $($installedPkg.license)"}
$installedRepo=if($installedPkg.repository -is [string]){[string]$installedPkg.repository}else{[string]$installedPkg.repository.url};$installedRepoOk=$false;foreach($needle in $policy.expectedRepositorySubstrings){if($installedRepo -like "*$needle*"){$installedRepoOk=$true}};if(-not $installedRepoOk){throw "OmniRoute installed package repository identity mismatch: $installedRepo"}

$base=([string]$policy.endpoint).TrimEnd("/")
try{Invoke-WebRequest -UseBasicParsing "$base/models" -TimeoutSec 2 -MaximumRedirection 0|Out-Null;Write-Host "OMNIROUTE REACHABLE";exit 0}catch{}
Start-Process -WindowStyle Minimized -FilePath $launcher | Out-Null
Start-Sleep 5
try{Invoke-WebRequest -UseBasicParsing "$base/models" -TimeoutSec 3 -MaximumRedirection 0|Out-Null;Write-Host "OMNIROUTE STARTED"}
catch{Write-Warning "OmniRoute installed/started but provider/dashboard setup may still require one-time credentials. Runtime remains NOT_VERIFIED until /models succeeds."}
