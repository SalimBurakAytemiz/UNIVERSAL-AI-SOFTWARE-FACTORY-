// //TR: Windows Sandbox yalıtım arka ucu: ağ, vGPU, pano, yazıcı, ses/görüntü girişi kapalı ve ProtectedClient açık .wsb yapılandırması üretir; yalnız işçinin kendi iş klasörlerini eşler (kaynak/araçlar salt-okunur, çıktı yazılabilir; kullanıcı profili, .ssh, token klasörleri asla), içeride çalışan PowerShell giriş betiklerini üretir ve sandbox'ı süre sınırıyla bekleyip zaman aşımında sonlandırır. Güvenilmeyen PR kodu yalnız bu sandbox içinde çalışır.
import fs from "node:fs";
import path from "node:path";

export const SANDBOX_EXE = "C:\\Windows\\System32\\WindowsSandbox.exe";
export const SANDBOX_PROCESSES = Object.freeze(["WindowsSandbox.exe", "WindowsSandboxClient.exe", "WindowsSandboxRemoteSession.exe"]);
export const IN = Object.freeze({src: "C:\\uasco\\src", deps: "C:\\uasco\\deps", tools: "C:\\uasco\\tools", worker: "C:\\uasco\\worker", ctl: "C:\\uasco\\ctl", out: "C:\\uasco\\out"});
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Drive-absolute path made of non-empty segments (no nested optional quantifiers: linear-time on hostile input).
const WIN_ABS = /^[A-Za-z]:\\(?:[^<>:"/\\|?*\x00-\x1f]+(?:\\[^<>:"/\\|?*\x00-\x1f]+)*)?\\?$/;
// Host folders that must never be visible inside the sandbox, whatever the configuration says.
const SECRET_SEGMENTS = [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config\\gh", ".claude", "appdata\\roaming\\github cli", "appdata\\local\\google\\chrome",
  "appdata\\local\\microsoft\\edge", "appdata\\roaming\\mozilla", "appdata\\roaming\\claude"];

export class SandboxError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new SandboxError(code); };
const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const norm = p => p.replace(/\\+$/, "").toLowerCase();
const inside = (child, parent) => norm(child) === norm(parent) || norm(child).startsWith(`${norm(parent)}\\`);

// A host folder may be mapped only if it is an absolute local Windows path inside workRoot (or, read-only, inside an allow-listed toolchain
// folder), is not the user profile or one of its ancestors, and contains no secret-bearing segment.
export function checkHostFolder(p, {workRoot, toolRoots = [], profile, readOnly}) {
  if (typeof p !== "string" || !WIN_ABS.test(p) || p.includes("..") || p.startsWith("\\\\")) fail("MAP_PATH_INVALID");
  const n = norm(p);
  if (SECRET_SEGMENTS.some(s => n.includes(`\\${s}`))) fail("MAP_PATH_SECRET");
  if (profile && inside(profile, p)) fail("MAP_PATH_PROFILE_OR_ANCESTOR");
  const inWork = inside(p, workRoot) && norm(p) !== norm(workRoot);
  const inTools = readOnly && toolRoots.some(t => inside(p, t));
  if (!inWork && !inTools) fail(readOnly ? "MAP_PATH_OUTSIDE_WORK_ROOT" : "MAP_PATH_WRITABLE_OUTSIDE_WORK_ROOT");
  return p;
}

export function buildWsb({memoryMB, mapped, logonCommand, workRoot, toolRoots, profile}) {
  if (!Number.isSafeInteger(memoryMB) || memoryMB < 2048 || memoryMB > 12288) fail("MEMORY_INVALID");
  if (!Array.isArray(mapped) || !mapped.length) fail("MAP_EMPTY");
  const writable = mapped.filter(m => m.readOnly !== true);
  if (writable.length !== 1 || writable[0].sandbox !== IN.out) fail("MAP_WRITABLE_MUST_BE_OUT_ONLY");
  const folders = mapped.map(m => {
    if (!Object.values(IN).includes(m.sandbox)) fail("MAP_SANDBOX_PATH_INVALID");
    checkHostFolder(m.host, {workRoot, toolRoots, profile, readOnly: m.readOnly === true});
    return `    <MappedFolder>\n      <HostFolder>${xml(m.host)}</HostFolder>\n      <SandboxFolder>${xml(m.sandbox)}</SandboxFolder>\n      <ReadOnly>${m.readOnly === true}</ReadOnly>\n    </MappedFolder>`;
  });
  return ["<Configuration>", "  <vGPU>Disable</vGPU>", "  <Networking>Disable</Networking>", "  <AudioInput>Disable</AudioInput>", "  <VideoInput>Disable</VideoInput>",
    "  <PrinterRedirection>Disable</PrinterRedirection>", "  <ClipboardRedirection>Disable</ClipboardRedirection>", "  <ProtectedClient>Enable</ProtectedClient>",
    `  <MemoryInMB>${memoryMB}</MemoryInMB>`, "  <MappedFolders>", ...folders, "  </MappedFolders>",
    "  <LogonCommand>", `    <Command>${xml(logonCommand)}</Command>`, "  </LogonCommand>", "</Configuration>", ""].join("\n");
}
export const logonFor = script => `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${IN.ctl}\\${script}`;

const psq = s => `'${String(s).replace(/'/g, "''")}'`;
// Self-test run inside the sandbox: each check must come out true for the isolation to count as verified on this host.
export function selftestScript({hostProfile}) {
  return [
    "$ErrorActionPreference = 'Continue'",
    "$r = [ordered]@{}",
    "try { $null = Invoke-WebRequest -Uri 'https://github.com' -UseBasicParsing -TimeoutSec 8; $r.networkBlocked = $false } catch { $r.networkBlocked = $true }",
    `$r.hostProfileHidden = -not (Test-Path -LiteralPath ${psq(hostProfile)})`,
    `try { Set-Content -LiteralPath '${IN.src}\\.uasco-write-probe' -Value x -ErrorAction Stop; $r.sourceReadOnly = $false } catch { $r.sourceReadOnly = $true }`,
    `try { Set-Content -LiteralPath '${IN.out}\\.uasco-write-probe' -Value x -ErrorAction Stop; $r.outputWritable = $true } catch { $r.outputWritable = $false }`,
    "$r.secretsAbsent = -not ((Test-Path env:GITHUB_TOKEN) -or (Test-Path env:GH_TOKEN) -or (Test-Path env:ANTHROPIC_API_KEY) -or (Test-Path env:UASCO_STATUS_TOKEN) -or (Test-Path (Join-Path $env:USERPROFILE '.ssh')))",
    "$r.user = $env:USERNAME",
    `$r | ConvertTo-Json | Set-Content -LiteralPath '${IN.out}\\selftest.json' -Encoding utf8`,
    `Set-Content -LiteralPath '${IN.out}\\DONE' -Value done`, ""].join("\r\n");
}
// Job run inside the sandbox: copy the read-only source and dependencies to the sandbox's own disk, then run the planned steps with the worker's
// own run-steps.mjs (mapped read-only) and the commit's protected command runner.
export function jobScript({steps}) {
  if (!Array.isArray(steps) || !steps.length || !steps.every(s => STEP_ID.test(s))) fail("STEPS_INVALID");
  return [
    "$ErrorActionPreference = 'Continue'",
    `try {`,
    `  robocopy ${IN.src} C:\\work /E /NFL /NDL /NJH /NJS /NP /MT:8 | Out-Null`,
    `  robocopy ${IN.deps}\\node_modules C:\\work\\node_modules /E /NFL /NDL /NJH /NJS /NP /MT:8 | Out-Null`,
    `  $env:PATH = '${IN.tools}\\node;${IN.tools}\\git\\cmd;' + $env:PATH`,
    `  & '${IN.tools}\\node\\node.exe' '${IN.worker}\\run-steps.mjs' --repo C:\\work --steps '${steps.join(",")}' --out '${IN.out}' *> '${IN.out}\\run.log'`,
    `} catch { $_ | Out-String | Set-Content -LiteralPath '${IN.out}\\entry-error.txt' }`,
    `Set-Content -LiteralPath '${IN.out}\\DONE' -Value done`, ""].join("\r\n");
}

// Launch the sandbox and wait for <out>\DONE, bounded by timeoutMs; on timeout (or a launch failure) every sandbox process is killed.
// launch/killAll/sleep/now are injected so this logic is testable without Windows Sandbox.
export async function runSandbox({wsbFile, outDir, timeoutMs, launch, killAll, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, pollMs = 2000}) {
  const t0 = now(), done = path.join(outDir, "DONE");
  try { await launch(wsbFile); } catch { await killAll(); return {outcome: "LAUNCH_FAILED", elapsedMs: now() - t0}; }
  while (now() - t0 < timeoutMs) {
    if (fs.existsSync(done)) { await killAll(); return {outcome: "DONE", elapsedMs: now() - t0}; }
    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (now() - t0))));
  }
  await killAll();
  return {outcome: fs.existsSync(done) ? "DONE" : "TIMEOUT", elapsedMs: now() - t0};
}
