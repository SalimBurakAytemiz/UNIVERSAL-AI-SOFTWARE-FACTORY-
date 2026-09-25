# //TR: Bu guided prerequisite installer Windows'ta winget/npm mevcutsa Git, Node LTS, Claude Code ve Codex CLI'yi resmi paket adlarıyla kurmayı dener; login/OAuth insan adımı olarak ayrıca doğrulanır.
param([switch]$InstallAiCli)
$ErrorActionPreference="Stop"
& (Join-Path $PSScriptRoot "sanitize-process-env.ps1")
function Has($x){return [bool](Get-Command $x -ErrorAction SilentlyContinue)}
if(-not (Has "winget")){throw "winget missing. Install/update App Installer first."}
if(-not (Has "git")){winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements;if($LASTEXITCODE -ne 0){throw "Git install failed"}}
if(-not (Has "node")){winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements;if($LASTEXITCODE -ne 0){throw "Node install failed"}}
$nodeCmd=Get-Command node -ErrorAction SilentlyContinue;if(-not $nodeCmd -and (Test-Path "C:\Program Files\nodejs\node.exe")){$env:Path="C:\Program Files\nodejs;$env:Path";$nodeCmd=Get-Command node -ErrorAction SilentlyContinue}
if(-not $nodeCmd){throw "Node installed but not available in current process. Reopen PowerShell and rerun."}
$major=[int]((& node --version).Trim().TrimStart('v').Split('.')[0]);if($major -lt 24){throw "Node >=24 required; found $(& node --version)"}
$npmMajor=[int]((& npm --version).Trim().Split('.')[0]);if($npmMajor -lt 11){throw "npm >=11 required; found $(& npm --version). Upgrade npm explicitly, then rerun."}
$trustedRegistry="https://registry.npmjs.org/"
foreach($name in @("NPM_CONFIG_REGISTRY","NPM_CONFIG_USERCONFIG","NPM_CONFIG_CAFILE","NPM_CONFIG_PROXY","NPM_CONFIG_HTTPS_PROXY","NODE_EXTRA_CA_CERTS","SSL_CERT_FILE","SSL_CERT_DIR")){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}
function Install-ExactNpmPackage([string]$Package,[string]$Label){
  $raw=npm --registry=$trustedRegistry --strict-ssl=true --ignore-scripts view $Package version dist.integrity --json;if($LASTEXITCODE -ne 0){throw "$Label metadata lookup failed"};$meta=$raw|ConvertFrom-Json;$version=[string]$meta.version;$integrity=[string]$meta.dist.integrity;if(-not $version -or -not $integrity){throw "$Label metadata missing version/integrity"}
  npm --registry=$trustedRegistry --strict-ssl=true --ignore-scripts install -g "$Package@$version";if($LASTEXITCODE -ne 0){throw "$Label exact-version install failed"}
  $installedRaw=npm list -g $Package --depth=0 --json;if($LASTEXITCODE -ne 0){throw "$Label installed package verification failed"};$installed=($installedRaw|ConvertFrom-Json).dependencies.($Package).version;if([string]$installed -ne $version){throw "$Label installed version mismatch"}
}
if($InstallAiCli){
  if(-not (Has "claude")){Install-ExactNpmPackage "@anthropic-ai/claude-code" "Claude Code"}
  if(-not (Has "codex")){Install-ExactNpmPackage "@openai/codex" "Codex CLI"}
}
Write-Host "PREREQUISITES_INSTALL: PASS (authentication still requires user login where applicable)"
