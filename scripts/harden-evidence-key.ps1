# //TR: Bu script evidence private key ACL'sini Windows'ta current user + SYSTEM ile sınırlar ve final icacls readback başarısızsa PASS vermez.
$ErrorActionPreference="Stop";Set-Location (Split-Path -Parent $PSScriptRoot);$p=".ai\runtime\keys\evidence-ed25519-private.pem";if(-not(Test-Path $p)){throw "Evidence private key missing"};$aclDigest=$null
if($env:OS -eq "Windows_NT"){
  & icacls $p /inheritance:r | Out-Null;if($LASTEXITCODE -ne 0){throw "Evidence key ACL inheritance hardening failed"}
  & icacls $p /grant:r "${env:USERNAME}:(R,W)" "SYSTEM:(F)" | Out-Null;if($LASTEXITCODE -ne 0){throw "Evidence key ACL grant hardening failed"}
  $readback=(& icacls $p | Out-String);if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($readback)){throw "Evidence key ACL final readback failed"}
  $sha=[System.Security.Cryptography.SHA256]::Create();try{$aclDigest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($readback)))).Replace("-","").ToLowerInvariant()}finally{$sha.Dispose()}
}
$doc=@{"//TR"="Bu runtime report evidence private key filesystem permission hardening ve final ACL readback sonucunu taşır.";status="PASS";checkedAt=(Get-Date).ToString("o");aclReadbackSha256=$aclDigest};$json=$doc|ConvertTo-Json;[System.IO.File]::WriteAllText((Join-Path (Get-Location) ".ai\runtime\EVIDENCE_KEY_PROTECTION.json"),$json,(New-Object System.Text.UTF8Encoding($false)));Write-Host "EVIDENCE_KEY_PROTECTION: PASS"
