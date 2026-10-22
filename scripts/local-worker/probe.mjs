// //TR: Yerel Windows ana makinesinin SALT-OKUNUR ölçümü: Windows sürümü/sürümü (edition), işlemci (çekirdek, mantıksal, anlık yük, sanallaştırma firmware/SLAT), hypervisor varlığı, toplam/boş RAM, sistem diskinin boş alanı, fiziksel disk türü (SSD/HDD) ve Windows Sandbox kullanılabilirliği. Hiçbir ayar, dosya veya kayıt değiştirmez; yönetici yetkisi istemez. Windows dışında dürüstçe PLATFORM_NOT_WINDOWS döner. Makine kimliği yalnız SHA-256 özeti olarak raporlanır.
// Usage: node scripts/local-worker/probe.mjs   (prints one JSON line)
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

// One fixed, read-only PowerShell query (no user input is ever interpolated).
const PS = String.raw`$ErrorActionPreference='SilentlyContinue'
$os=Get-CimInstance Win32_OperatingSystem; $cs=Get-CimInstance Win32_ComputerSystem; $p=@(Get-CimInstance Win32_Processor)
$cv=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'; $mg=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid
$ld=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$pd=@(Get-PhysicalDisk | ForEach-Object { [ordered]@{name=$_.FriendlyName; mediaType=[string]$_.MediaType; busType=[string]$_.BusType; health=[string]$_.HealthStatus; sizeGB=[math]::Round($_.Size/1GB,1)} })
$load=($p | Measure-Object -Property LoadPercentage -Average).Average
[ordered]@{
 os=[ordered]@{caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; editionId=$cv.EditionID; displayVersion=$cv.DisplayVersion; arch=$os.OSArchitecture}
 cpu=[ordered]@{name=([string]$p[0].Name).Trim(); cores=($p | Measure-Object -Property NumberOfCores -Sum).Sum; logical=($p | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum; loadPct=$load; virtualizationFirmwareEnabled=$p[0].VirtualizationFirmwareEnabled; slat=$p[0].SecondLevelAddressTranslationExtensions}
 hypervisorPresent=$cs.HypervisorPresent
 memory=[ordered]@{totalMB=[math]::Round($cs.TotalPhysicalMemory/1MB); freeMB=[math]::Round($os.FreePhysicalMemory/1KB)}
 disk=[ordered]@{drive=$env:SystemDrive; freeGB=[math]::Round($ld.FreeSpace/1GB,1); sizeGB=[math]::Round($ld.Size/1GB,1)}
 physicalDisks=$pd
 sandboxExe=(Test-Path (Join-Path $env:windir 'System32\WindowsSandbox.exe'))
 machineGuid=$mg
} | ConvertTo-Json -Depth 5 -Compress`;

// Windows Sandbox needs a Pro/Enterprise/Education client edition, the optional feature (its exe), and hardware virtualization.
// With a running hypervisor, Win32_Processor reports VirtualizationFirmwareEnabled=false, so HypervisorPresent counts too.
export const SANDBOX_EDITIONS = Object.freeze(["Professional", "ProfessionalWorkstation", "ProfessionalEducation", "Enterprise", "EnterpriseS", "Education"]);
export function interpretProbe(raw, {now = Date.now()} = {}) {
  const editionOk = SANDBOX_EDITIONS.includes(raw?.os?.editionId);
  const virt = raw?.hypervisorPresent === true || raw?.cpu?.virtualizationFirmwareEnabled === true;
  const reasons = [];
  if (!editionOk) reasons.push("EDITION_WITHOUT_SANDBOX");
  if (raw?.sandboxExe !== true) reasons.push("SANDBOX_FEATURE_NOT_ENABLED");
  if (!virt) reasons.push("VIRTUALIZATION_NOT_AVAILABLE");
  const disks = Array.isArray(raw?.physicalDisks) ? raw.physicalDisks : raw?.physicalDisks ? [raw.physicalDisks] : [];
  const {machineGuid, sandboxExe, physicalDisks, ...rest} = raw ?? {};
  const fingerprint = crypto.createHash("sha256").update([machineGuid, raw?.os?.build, raw?.cpu?.name, raw?.cpu?.logical, raw?.memory?.totalMB].join("|")).digest("hex");
  return {schema: "uasco.local-host-probe/1", platform: "win32", readOnly: true, probedAt: new Date(now).toISOString(), ...rest,
    physicalDisks: disks, ssd: disks.length ? disks.some(d => d.mediaType === "SSD") : null,
    sandbox: {available: reasons.length === 0, editionOk, featureEnabled: sandboxExe === true, virtualization: virt, reasons}, fingerprint};
}

export function probeHost({run = spawnSync, now = Date.now()} = {}) {
  if (process.platform !== "win32") {
    return {schema: "uasco.local-host-probe/1", platform: process.platform, readOnly: true, probedAt: new Date(now).toISOString(), supported: false,
      reasons: ["PLATFORM_NOT_WINDOWS"], cpu: {name: os.cpus()[0]?.model ?? null, logical: os.cpus().length}, memory: {totalMB: Math.round(os.totalmem() / 2 ** 20), freeMB: Math.round(os.freemem() / 2 ** 20)},
      sandbox: {available: false, reasons: ["PLATFORM_NOT_WINDOWS"]}, fingerprint: null};
  }
  const r = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS], {encoding: "utf8", timeout: 60000, windowsHide: true});
  let raw;
  try { raw = JSON.parse(String(r.stdout).trim()); } catch { return {schema: "uasco.local-host-probe/1", platform: "win32", readOnly: true, supported: false, reasons: ["PROBE_FAILED"], sandbox: {available: false, reasons: ["PROBE_FAILED"]}, fingerprint: null}; }
  return {...interpretProbe(raw, {now}), supported: true};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(probeHost()) + "\n");
