// //TR: Bu script üretilmiş UASCO NSIS kurulum paketini YALNIZ %TEMP% altında gerçek olarak dener: yetersiz-alan reddi, test anahtarlı (gerçek Masaüstü/Başlat menüsüne kısayol yazmayan) sessiz kurulum, izole --user-data-dir ile uygulama açılışı (/health kimlik doğrulaması + pencere yüklemesi), çalışma sırasında kurulum dizinine yazılmadığının hash ile kanıtı, onarım (aynı sürümü yeniden kurma), sessiz kaldırma ve HKCU kaldırma kaydının önce/sonra durumu; gerçek bir UASCO kurulumu varsa hiçbir şey yapmadan durur.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";

const UNINSTALL_ROOT = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), steps: []};
function step(name, data) { const row = {name, at: new Date().toISOString(), ...data}; report.steps.push(row); console.log(JSON.stringify(row)); return row; }
function run(cmd, args, opts = {}) { const t = Date.now(); const r = cp.spawnSync(cmd, args, {encoding: "utf8", windowsHide: true, timeout: 600000, ...opts}); return {status: r.status, error: r.error?.code ?? null, ms: Date.now() - t, stdout: (r.stdout ?? "").slice(-2000), stderr: (r.stderr ?? "").slice(-2000)}; }
function regQueryUasco() {
  const r = run("reg.exe", ["query", UNINSTALL_ROOT, "/s", "/f", "UASCO", "/d"]);
  const keys = [...(r.stdout ?? "").matchAll(/^(HKEY_CURRENT_USER\\[^\r\n]+)$/gm)].map(m => m[1].trim());
  return keys;
}
function regKey(key) { const r = run("reg.exe", ["query", key]); return {exists: r.status === 0, values: r.status === 0 ? r.stdout.split(/\r?\n/).filter(l => /REG_/.test(l)).map(l => l.trim().replace(/\s{2,}/g, " | ")) : []}; }
function shellFolders() {
  const r = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop');[Environment]::GetFolderPath('Programs')"]);
  const [desktop, programs] = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return {desktop, programs};
}
function shortcutState(f) { return {desktopLnk: fs.existsSync(path.join(f.desktop, "UASCO.lnk")), startMenuLnk: fs.existsSync(path.join(f.programs, "UASCO.lnk")), startMenuDir: fs.existsSync(path.join(f.programs, "UASCO"))}; }
function treeHashes(dir) { const out = {}; const walk = (d) => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p).replaceAll("\\", "/")] = sha(p); } }; walk(dir); return out; }
function diffTrees(a, b) { const added = Object.keys(b).filter(k => !(k in a)), removed = Object.keys(a).filter(k => !(k in b)), changed = Object.keys(a).filter(k => k in b && a[k] !== b[k]); return {added, removed, changed}; }
async function waitGone(p, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (!fs.existsSync(p)) return true; await sleep(500); } return !fs.existsSync(p); }
async function portClosed(port) { try { await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(2000)}); return false; } catch { return true; } }
function launchEnv(smoke = true) { const env = {}; for (const k of ["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "PATH", "PATHEXT", "COMPUTERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "USERNAME", "HOMEDRIVE", "HOMEPATH"]) if (process.env[k]) env[k] = process.env[k]; if (smoke) env.UASCO_SMOKE = "1"; return env; }
async function launchSmoke(installDir, userData, label, extraArgs = []) {
  const marker = path.join(userData, "runtime", "DESKTOP_SMOKE_READY.json");
  fs.rmSync(marker, {force: true});
  const t = Date.now();
  let stderr = "";
  const child = cp.spawn(path.join(installDir, "UASCO.exe"), [`--user-data-dir=${userData}`, "--enable-logging=stderr", ...extraArgs], {cwd: installDir, env: launchEnv(), stdio: ["ignore", "ignore", "pipe"], windowsHide: false});
  let ipcRejected = false;
  child.stderr.on("data", d => { stderr = (stderr + d).slice(-4000); if (stderr.includes("UNTRUSTED_IPC_SENDER")) ipcRejected = true; });
  const exit = await new Promise(resolve => { const timer = setTimeout(() => { try { child.kill(); } catch {} resolve({timeout: true}); }, 120000); child.on("exit", (code, signal) => { clearTimeout(timer); resolve({code, signal}); }); });
  const m = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : null;
  const closed = m?.port ? await portClosed(m.port) : null;
  const logFile = path.join(userData, "logs", "control-api.log");
  const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const hexOutsideChallenge = (logText.replace(/challenge=[0-9a-f]{64}/g, "challenge=<c>").match(/[0-9a-f]{64}/g) ?? []).length;
  const row = step(label, {args: extraArgs, exit, ms: Date.now() - t, rendererIpcRejected: ipcRejected, marker: m, backendPortClosedAfterQuit: closed, backendLogBytes: logText.length, backendLogHas64HexOutsideChallenge: hexOutsideChallenge, electronStderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-8), backendLogTail: logText.split(/\r?\n/).filter(l => l.startsWith("[desktop]")).slice(-4)});
  // //TR: Kurulu uygulamada renderer IPC çağrıları güvenilmeyen gönderen diye reddedilirse ekranlar veri alamaz; bu kurulum testini başarısız sayar.
  if (ipcRejected) throw new Error(`RENDERER_IPC_REJECTED:${label}`);
  return row;
}

async function main() {
  if (process.platform !== "win32") throw new Error("WINDOWS_ONLY");
  const artifact = path.resolve(process.argv[2] ?? ""), unpackedDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (!fs.existsSync(artifact)) throw new Error(`INSTALLER_NOT_FOUND:${artifact}`);
  const tmp = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tmp, "uasco-b7-install-"));
  const installDir = path.join(root, "install", "UASCO"), userData = path.join(root, "userdata"), reportFile = path.join(root, "INSTALL-TEST-REPORT.json");
  const folders = shellFolders(), realAppData = path.join(process.env.APPDATA ?? "", "UASCO");
  const updaterCopy = path.join(process.env.LOCALAPPDATA ?? "", "uasco-desktop-updater"), tempCopy = path.join(process.env.LOCALAPPDATA ?? "", "Temp", "uasco-installer-copy");
  const installArgs = ["/S", "/UASCO_TEST_NO_SHORTCUTS", "--no-desktop-shortcut"];
  report.artifact = {path: artifact, bytes: fs.statSync(artifact).size, sha256: sha(artifact)};
  report.tempRoot = root;

  const before = step("preconditions", {uninstallKeys: regQueryUasco(), shortcuts: shortcutState(folders), realAppDataExists: fs.existsSync(realAppData), updaterCopyExists: fs.existsSync(updaterCopy)});
  if (before.uninstallKeys.length) throw new Error(`REAL_UASCO_INSTALL_PRESENT:${before.uninstallKeys.join(",")}`);

  // (0) refusal path: required space forced above any real disk -> exit 3, nothing installed
  const refuseDir = path.join(root, "refuse", "UASCO");
  const refuse = run(artifact, [...installArgs, "/UASCO_TEST_REQUIRE_MB=99999999", `/D=${refuseDir}`]);
  step("install-refused-insufficient-space", {command: `"${artifact}" ${installArgs.join(" ")} /UASCO_TEST_REQUIRE_MB=99999999 /D=${refuseDir}`, exitCode: refuse.status, ms: refuse.ms, installDirCreated: fs.existsSync(refuseDir), uninstallKeys: regQueryUasco()});

  // (b) silent install into %TEMP% without real shortcuts
  const inst = run(artifact, [...installArgs, `/D=${installDir}`]);
  const keys = regQueryUasco();
  const installed = step("silent-install", {command: `"${artifact}" ${installArgs.join(" ")} /D=${installDir}`, exitCode: inst.status, ms: inst.ms, exe: fs.existsSync(path.join(installDir, "UASCO.exe")), uninstallKeys: keys, uninstallKeyValues: keys.map(k => ({key: k, ...regKey(k)})), shortcuts: shortcutState(folders), updaterCopyExists: fs.existsSync(updaterCopy), tempCopyExists: fs.existsSync(tempCopy)});
  if (inst.status !== 0 || !installed.exe) throw new Error(`INSTALL_FAILED:${inst.status}`);
  const guid = keys[0]?.split("\\").pop() ?? null;
  report.installRegistryKey = guid ? `HKCU\\Software\\${guid}` : null;
  if (report.installRegistryKey) step("install-registry-key", {key: report.installRegistryKey, ...regKey(report.installRegistryKey)});
  const filesBefore = treeHashes(installDir);
  step("install-dir-snapshot", {files: Object.keys(filesBefore).length});

  // (c) launch with isolated userData; window load + verified backend identity; clean quit.
  // Environment limitation (recorded, not hidden): on this machine Chromium's sandboxed GPU/renderer child processes
  // cannot start from binaries located under %TEMP% (crash 0x80000003 "GPU process isn't usable"); the same payload
  // starts normally from the build directory with the sandbox enabled (see "unpacked-payload-sandboxed-launch").
  // The %TEMP% install is therefore launched once with default flags (expected failure, recorded) and then with
  // --no-sandbox, a command-line flag used ONLY by this test; the app code and its webPreferences are unchanged.
  await launchSmoke(installDir, path.join(root, "userdata-default-flags"), "launch-0-default-flags-from-temp");
  await launchSmoke(installDir, userData, "launch-1", ["--no-sandbox"]);
  if (unpackedDir) await launchSmoke(unpackedDir, path.join(root, "userdata-unpacked"), "unpacked-payload-sandboxed-launch");
  {
    // single instance: A stays open (no smoke auto-quit); B with the same userData must exit at once; then A is
    // terminated abruptly to prove its backend child exits on its own when the parent's stdin pipe closes.
    const a = cp.spawn(path.join(installDir, "UASCO.exe"), [`--user-data-dir=${userData}`, "--no-sandbox"], {cwd: installDir, env: launchEnv(false), stdio: "ignore"});
    const aExit = new Promise(r => a.on("exit", code => r(code)));
    await sleep(6000);
    const logFile = path.join(userData, "logs", "control-api.log");
    const ports = [...fs.readFileSync(logFile, "utf8").matchAll(/starting control API on 127\.0\.0\.1:(\d+)/g)].map(m => Number(m[1]));
    const aPort = ports[ports.length - 1];
    const aHealthy = !(await portClosed(aPort));
    const b = run(path.join(installDir, "UASCO.exe"), [`--user-data-dir=${userData}`, "--no-sandbox"], {cwd: installDir, env: launchEnv(false), timeout: 60000});
    const portsAfterB = [...fs.readFileSync(logFile, "utf8").matchAll(/starting control API on/g)].length;
    const kill = run("taskkill.exe", ["/PID", String(a.pid), "/F"]);
    const aCode = await Promise.race([aExit, sleep(30000).then(() => "TIMEOUT")]);
    await sleep(3000);
    step("single-instance", {firstInstanceBackendPort: aPort, firstInstanceBackendHealthy: aHealthy, secondInstanceExitCode: b.status, secondInstanceMs: b.ms, backendStartsLoggedAfterSecondInstance: portsAfterB, backendStartsBeforeSecondInstance: ports.length, firstInstanceTerminatedByTaskkill: kill.status, firstInstanceExit: aCode, firstInstanceBackendPortClosed: await portClosed(aPort)});
  }
  const runtimeDiff = diffTrees(filesBefore, treeHashes(installDir));
  step("install-dir-unchanged-after-launch", {...runtimeDiff, unchanged: !runtimeDiff.added.length && !runtimeDiff.removed.length && !runtimeDiff.changed.length});
  step("user-data-contents", {files: fs.readdirSync(userData, {recursive: true}).map(String).filter(x => !x.includes("Cache") && !x.includes("GPUCache")).slice(0, 60), realAppDataCreated: !before.realAppDataExists && fs.existsSync(realAppData)});

  // repair = re-run same version over the existing install
  const rep = run(artifact, [...installArgs, `/D=${installDir}`]);
  step("repair-reinstall-same-version", {exitCode: rep.status, ms: rep.ms, exe: fs.existsSync(path.join(installDir, "UASCO.exe")), uninstallKeys: regQueryUasco(), shortcuts: shortcutState(folders)});
  await launchSmoke(installDir, userData, "launch-2-after-repair", ["--no-sandbox"]);

  // (d) silent uninstall (keeps user data by default; --keep-shortcuts so no shortcut path is touched)
  const uninst = path.join(installDir, "Uninstall UASCO.exe");
  const un = run(uninst, ["/S", "--keep-shortcuts"]);
  const gone = await waitGone(installDir, 180000);
  await sleep(1500);
  step("silent-uninstall", {command: `"${uninst}" /S --keep-shortcuts`, exitCode: un.status, ms: un.ms, installDirRemoved: gone, userDataKept: fs.existsSync(path.join(userData, "runtime", "DESKTOP_SMOKE_READY.json")), shortcuts: shortcutState(folders)});

  // (e) registry after uninstall
  step("registry-after-uninstall", {uninstallKeys: regQueryUasco(), uninstallKeyExists: keys.map(k => ({key: k, exists: regKey(k).exists})), installRegistryKeyExists: report.installRegistryKey ? regKey(report.installRegistryKey).exists : null, realAppDataExists: fs.existsSync(realAppData), updaterCopyExists: fs.existsSync(updaterCopy), tempCopyExists: fs.existsSync(tempCopy)});
  report.endedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(`INSTALL_TEST_REPORT ${reportFile}`);
}
main().catch(e => { report.error = e instanceof Error ? e.message : String(e); console.error(`INSTALLER_INSTALL_TEST: FAIL ${report.error}`); console.log(JSON.stringify(report)); process.exit(1); });
