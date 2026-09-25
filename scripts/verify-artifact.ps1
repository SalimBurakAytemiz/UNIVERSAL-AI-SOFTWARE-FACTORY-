# //TR: Bu dependency-free PowerShell verifier Node/npm kurulmadan önce ZIP'ten çıkan dosyaları SHA256SUMS manifestine karşı doğrular; eksik/değişmiş tracked artifact ile installer çalışmasını engeller.
$ErrorActionPreference="Stop";Set-Location (Split-Path -Parent $PSScriptRoot)
if(-not (Test-Path "SHA256SUMS.txt")){throw "SHA256SUMS.txt missing"}
$errors=[System.Collections.Generic.List[string]]::new()
$manifestEntries=[System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
Get-Content "SHA256SUMS.txt" | ForEach-Object {
  if($_ -match '^([0-9a-fA-F]{64})\s{2}(.+)$'){
    $expected=$Matches[1].ToLowerInvariant();$rel=$Matches[2].Replace("\","/");
    if($rel.StartsWith("/") -or $rel.Contains("../")){$errors.Add("UNSAFE_PATH:$rel");return}
    [void]$manifestEntries.Add($rel)
    if(-not (Test-Path -LiteralPath $rel)){$errors.Add("MISSING:$rel");return}
    $item=Get-Item -LiteralPath $rel -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$errors.Add("REPARSE_POINT_NOT_ALLOWED:$rel");return};if($item.PSIsContainer){$errors.Add("NOT_REGULAR_FILE:$rel");return}
    $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $rel).Hash.ToLowerInvariant();if($actual -ne $expected){$errors.Add("HASH:$rel")}
  } else {$errors.Add("MALFORMED:$_")}
}
if(-not $manifestEntries.Contains("package-lock.json")){$errors.Add("LOCKFILE_NOT_IN_ARTIFACT_MANIFEST:package-lock.json")}
if($errors.Count -gt 0){throw "ARTIFACT_VERIFY_PS_FAILED $($errors -join ',')"}
Write-Host "ARTIFACT_VERIFY_PS: PASS"
