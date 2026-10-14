# //TR: Bu sarmalayıcı UASCO-Autonomous-Supervisor görevinin gizli pencereli kök sürecidir: Task Scheduler bunu powershell.exe -WindowStyle Hidden ile başlatır (masaüstünde node konsol penceresi açılmaz, kapatılarak süpervizör yanlışlıkla durdurulamaz), yanındaki kararlı girişi mutlak node.exe ile doğrulanmış bağımsız değişkenlerle çalıştırır ve girişin çıkış kodunu Task Scheduler'a aynen iletir. Başka hiçbir şey yapmaz.
param(
  [Parameter(Mandatory=$true)][string]$Repo,
  [Parameter(Mandatory=$true)][string]$Node
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$entry = Join-Path $PSScriptRoot "uasco-supervisor-entry.mjs"
$root = Split-Path -Parent $PSScriptRoot
foreach ($p in @($Repo, $Node, $entry, $root)) {
  if ($p -match '["%`\r\n\t\*\?<>\|\[\]]' -or $p -notmatch '^[A-Za-z]:\\[^\\]' -or $p -match '[\\. ]$') { exit 64 }
}
if (-not $Node.EndsWith("\node.exe", [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $Node -PathType Leaf)) { exit 64 }
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { exit 6 }
& $Node $entry --repo $Repo --control-root $root
exit $LASTEXITCODE
