// //TR: Founder'ın gerçek Windows makinesinde TEK komutla çalışan kabul kiti: salt-okunur ön kontrol (WSL2 dağıtımı, /etc/wsl.conf interop+appendWindowsPath kapalı, yerel Claude CLI, profil girişleri) + deponun KENDİ gerçek-WSL testleri (selfTest/negatif sondalar, spawnAsync+köprü) çalıştırılır; her kontrol PASS / FAIL / SKIP(neden) yazılır, SKIP asla PASS sayılmaz, SHA'ya bağlı JSON kanıt dosyası üretilir. Bu betik ana makine ayarını ASLA değiştirmez; başarısız her önkoşul için Founder'ın çalıştıracağı tam komutu yazar. Depo testleri dışında hiçbir şey çalıştırılmaz.
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO = path.resolve(HERE, "..", "..", "..");
export const TEST_FILE = "tests/v7-int-r3-sbx-gate.test.ts";
/** Gerçek-WSL testlerinin adları (vitest JSON'unda aranır); bulunamayan test PASS sayılmaz, FAIL(TEST_NOT_FOUND) olur. */
export const REAL_TESTS = [
  {id: "WSL_SELFTEST_AND_RUN", title: "WSL provider selfTest (all negative probes) + a node test runs inside the sandbox", match: /REAL WSL \(win32 \+ UASCO_WSL_DISTRO\): selfTest passes its negative probes/},
  {id: "WSL_PRODUCT_BRIDGE", title: "Generated web-node product via spawnAsync + bridged 127.0.0.1 port answers 200, stop tears down", match: /REAL WSL \(win32 \+ UASCO_WSL_DISTRO\): the generated web-node product/}
];

/** wsl.exe yönetim çıktısı UTF-16LE gelebilir. */
export function decodeWslText(b) {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(String(b ?? ""));
  const s = buf.includes(0) ? buf.toString("utf16le") : buf.toString("utf8");
  return s.replace(/^﻿/, "").replace(/\u0000/g, "");
}
/** `wsl -l -q` çıktısı -> dağıtım adları. */
export function parseWslList(text) { return String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean); }
/** `wsl -l -v` çıktısı -> {name, version}. */
export function parseWslVerbose(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const c = line.replace(/^\s*\*/, "").trim().split(/\s+/);
    if (c.length >= 3 && /^\d+$/.test(c[c.length - 1])) rows.push({name: c[0], version: Number(c[c.length - 1])});
  }
  return rows;
}
/** /etc/wsl.conf (ini) -> interop.enabled ve interop.appendWindowsPath. Varsayılan WSL davranışı ikisi de TRUE'dur (yazılmamışsa açık sayılır). */
export function parseWslConf(text) {
  let section = "", interop = null, append = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) { section = sec[1].trim().toLowerCase(); continue; }
    const kv = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (!kv || section !== "interop") continue;
    const key = kv[1].toLowerCase(), val = kv[2].trim().toLowerCase();
    const b = val === "true" ? true : val === "false" ? false : null;
    if (key === "enabled") interop = b;
    if (key === "appendwindowspath") append = b;
  }
  return {interopEnabled: interop ?? true, appendWindowsPath: append ?? true, interopExplicit: interop !== null, appendExplicit: append !== null};
}
export const wslConfFixCommands = distro => [
  `wsl -d ${distro} -u root -- nano /etc/wsl.conf   (add these lines, then save)`,
  "    [interop]", "    enabled=false", "    appendWindowsPath=false",
  "wsl --shutdown   (then start the distro again, e.g. wsl -d " + distro + " -- echo ok)"
].join("\n");

const status = (id, title, st, detail, fix = null) => ({id, title, status: st, detail: String(detail ?? "").slice(0, 400), fix});
const PASS = "PASS", FAIL = "FAIL", SKIP = "SKIP";

/** Salt-okunur ön kontrol. deps: {platform, wsl(args)->{code,stdout}, detectClaudeCli, claudeProfileStatus, controlRoot, importError}. */
export async function preflight(distro, deps) {
  const out = [];
  if (deps.platform !== "win32") {
    for (const [id, t] of [["WSL_EXE", "wsl.exe available"], ["WSL_DISTRO", "WSL distro exists"], ["WSL_VERSION_2", "Distro runs WSL 2"], ["WSL_CONF", "/etc/wsl.conf: interop=false, appendWindowsPath=false"], ["WSL_INTEROP_RUNTIME", "Interop is off at runtime"], ["WSL_NODE", "Linux node inside the distro"]])
      out.push(status(id, t, SKIP, `NOT_WINDOWS (platform=${deps.platform}); run this kit on the Founder's Windows host`));
  } else if (!distro) {
    out.push(status("WSL_DISTRO", "WSL distro configured", FAIL, "No distro given", "node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu    (or set UASCO_WSL_DISTRO)"));
  } else {
    const st = await deps.wsl(["--status"]);
    out.push(st.code === 0 ? status("WSL_EXE", "wsl.exe available", PASS, "wsl --status exit 0") : status("WSL_EXE", "wsl.exe available", FAIL, `exit ${st.code}`, "wsl --install    (admin PowerShell, then reboot)"));
    const list = await deps.wsl(["-l", "-q"]);
    const names = list.code === 0 ? parseWslList(decodeWslText(list.stdout)) : [];
    const have = names.includes(distro);
    out.push(have ? status("WSL_DISTRO", "WSL distro exists", PASS, distro) : status("WSL_DISTRO", "WSL distro exists", FAIL, `'${distro}' not in [${names.join(", ")}]`, `wsl --install -d ${distro}`));
    if (have) {
      const v = await deps.wsl(["-l", "-v"]);
      const row = parseWslVerbose(decodeWslText(v.stdout)).find(r => r.name === distro);
      out.push(row && row.version === 2 ? status("WSL_VERSION_2", "Distro runs WSL 2", PASS, "version 2") : status("WSL_VERSION_2", "Distro runs WSL 2", FAIL, `version ${row?.version ?? "unknown"}`, `wsl --set-version ${distro} 2`));
      const conf = await deps.wsl(["-d", distro, "--exec", "/bin/cat", "/etc/wsl.conf"]);
      if (conf.code !== 0) out.push(status("WSL_CONF", "/etc/wsl.conf: interop=false, appendWindowsPath=false", FAIL, "/etc/wsl.conf missing or unreadable (defaults leave interop and Windows PATH ON)", wslConfFixCommands(distro)));
      else {
        const c = parseWslConf(decodeWslText(conf.stdout));
        const bad = [c.interopEnabled ? "interop.enabled is not false" : null, c.appendWindowsPath ? "interop.appendWindowsPath is not false" : null].filter(Boolean);
        out.push(bad.length ? status("WSL_CONF", "/etc/wsl.conf: interop=false, appendWindowsPath=false", FAIL, bad.join("; "), wslConfFixCommands(distro)) : status("WSL_CONF", "/etc/wsl.conf: interop=false, appendWindowsPath=false", PASS, "both false"));
      }
      const bm = await deps.wsl(["-d", distro, "--exec", "/bin/cat", "/proc/sys/fs/binfmt_misc/WSLInterop"]);
      const bmText = decodeWslText(bm.stdout).trim().split(/\r?\n/)[0] ?? "";
      out.push(bm.code !== 0 || bmText === "disabled" ? status("WSL_INTEROP_RUNTIME", "Interop is off at runtime", PASS, bm.code !== 0 ? "WSLInterop handler not registered" : "WSLInterop disabled") : status("WSL_INTEROP_RUNTIME", "Interop is off at runtime", FAIL, "WSLInterop handler is ACTIVE", wslConfFixCommands(distro)));
      const nodeV = await deps.wsl(["-d", distro, "--exec", "/usr/bin/env", "node", "--version"]);
      const nv = decodeWslText(nodeV.stdout).trim();
      out.push(nodeV.code === 0 && /^v\d+\./.test(nv) ? status("WSL_NODE", "Linux node inside the distro", PASS, nv) : status("WSL_NODE", "Linux node inside the distro", FAIL, "node not found inside the distro (with appendWindowsPath=false Windows node is not visible)", `wsl -d ${distro} -u root -- sh -c "apt-get update && apt-get install -y nodejs util-linux coreutils procps findutils bash tar"`));
    }
  }
  // Claude CLI ve profil girişleri (Lane C modülünden; kopyalanmaz)
  if (!deps.detectClaudeCli) out.push(status("CLAUDE_CLI", "Claude CLI is a native install (not a .cmd shim)", SKIP, `detectClaudeCli unavailable in this checkout: ${deps.importError ?? "not exported (Lane C C-IMPL-WIN-1 not merged)"}`));
  else {
    const cli = deps.detectClaudeCli();
    out.push(cli.state === "FOUND" ? status("CLAUDE_CLI", "Claude CLI is a native install (not a .cmd shim)", PASS, cli.path) : status("CLAUDE_CLI", "Claude CLI is a native install (not a .cmd shim)", FAIL, `${cli.state}${cli.path ? " at " + cli.path : ""}`, cli.founderAction ?? "irm https://claude.ai/install.ps1 | iex    (PowerShell; check Anthropic's current instructions)"));
  }
  for (const role of ["implementer", "reviewer"]) {
    const id = `CLAUDE_PROFILE_${role.toUpperCase()}`, title = `Claude ${role} profile is logged in`;
    if (!deps.claudeProfileStatus) { out.push(status(id, title, SKIP, `claudeProfileStatus unavailable: ${deps.importError ?? "claude-profiles module not importable"}`)); continue; }
    let p; try { p = deps.claudeProfileStatus(deps.controlRoot, role); } catch (e) { out.push(status(id, title, FAIL, `status error: ${String(e?.message ?? e).slice(0, 120)}`)); continue; }
    out.push(p.state === "READY" ? status(id, title, PASS, "credential store present") : status(id, title, FAIL, `${p.state}${p.reason ? ": " + p.reason : ""}`, p.loginCommand ? `${p.loginCommand}    (new PowerShell window; type /login inside Claude, sign in, then /exit)` : /GIT_WORKTREE/.test(String(p.reason)) ? "run this kit again with --control-root \"<the installed app's data folder, not a git checkout>\"" : "see the UASCO app: Settings > Claude profiles"));
  }
  return out;
}

/** vitest --reporter=json çıktısı -> gerçek-WSL testlerinin durumları. Bulunamayan = FAIL (asla PASS); skipped/pending = SKIP. */
export function mapVitestJson(json) {
  const tests = [];
  for (const f of json?.testResults ?? []) for (const a of f.assertionResults ?? []) tests.push({name: String(a.fullName ?? a.title ?? ""), status: a.status, msg: (a.failureMessages ?? []).join(" ").slice(0, 300)});
  return REAL_TESTS.map(rt => {
    const t = tests.find(x => rt.match.test(x.name));
    if (!t) return status(rt.id, rt.title, FAIL, "TEST_NOT_FOUND in vitest output (wrong checkout?)", "git pull, then npm ci, then run this kit again");
    if (t.status === "passed") return status(rt.id, rt.title, PASS, "vitest passed");
    if (t.status === "failed") return status(rt.id, rt.title, FAIL, t.msg || "vitest failed", "send artifacts/runtime/acceptance/*.json to the coordinator");
    return status(rt.id, rt.title, SKIP, `vitest reported '${t.status}' (the real-WSL guard did not open: platform/distro/wsl --status)`);
  });
}

export function sha256File(f) { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch { return null; } }
export function verdictOf(checks, sha) {
  const fails = checks.filter(c => c.status === FAIL), skips = checks.filter(c => c.status === SKIP);
  const reasons = [...fails.map(c => `FAIL:${c.id}`), ...skips.map(c => `SKIP:${c.id}`), ...(sha ? [] : ["HEAD_SHA_UNKNOWN"])];
  return {verdict: reasons.length === 0 ? "ACCEPTED" : "NOT_ACCEPTED", reasons, pass: checks.filter(c => c.status === PASS).length, fail: fails.length, skip: skips.length};
}
export function renderTable(report) {
  const w = Math.max(...report.checks.map(c => c.id.length), 8), lines = [];
  lines.push(`UASCO Windows acceptance - ${report.repo.headSha ?? "SHA UNKNOWN"}${report.repo.dirty ? " (dirty tree)" : ""} - distro ${report.distro ?? "-"}`, "");
  for (const c of report.checks) lines.push(`${c.status.padEnd(5)} ${c.id.padEnd(w)}  ${c.title}${c.detail ? "  [" + c.detail + "]" : ""}`);
  const fixes = report.checks.filter(c => c.status === FAIL && c.fix);
  if (fixes.length) { lines.push("", "WHAT TO DO (this kit never changes your settings; run these yourself):"); for (const c of fixes) lines.push(`- ${c.id}:`, ...String(c.fix).split("\n").map(l => "    " + l)); }
  lines.push("", `RESULT: ${report.verdict}  (PASS ${report.pass}, FAIL ${report.fail}, SKIP ${report.skip}; SKIP is never PASS)`);
  if (report.reasons.length) lines.push(`Not accepted because: ${report.reasons.join(", ")}`);
  return lines.join("\n");
}

export async function runAcceptance(o, deps) {
  const distro = o.distro ?? null;
  const checks = await preflight(distro, deps);
  const blocking = checks.filter(c => ["WSL_EXE", "WSL_DISTRO", "WSL_VERSION_2"].includes(c.id) && c.status !== PASS);
  if (deps.platform !== "win32") for (const rt of REAL_TESTS) checks.push(status(rt.id, rt.title, SKIP, `NOT_WINDOWS (platform=${deps.platform})`));
  else if (blocking.length) for (const rt of REAL_TESTS) checks.push(status(rt.id, rt.title, SKIP, `PRECONDITION_FAILED: ${blocking.map(c => c.id).join(", ")} (fix those first)`));
  else checks.push(...mapVitestJson(await deps.runVitest(distro)));
  const git = deps.git();
  const sha = git.headSha ?? o.shaArg ?? null;
  const v = verdictOf(checks, sha);
  const body = {schemaVersion: 1, kit: "founder-acceptance-windows", generatedAt: deps.now(), host: {platform: deps.platform, arch: os.arch(), node: process.version, release: os.release()},
    repo: {headSha: sha, shaSource: git.headSha ? "GIT" : o.shaArg ? "ARGUMENT" : "UNKNOWN", dirty: git.dirty}, files: {script: deps.scriptSha256 ?? null, test: deps.testSha256 ?? null}, distro, checks, ...v};
  const evidenceSha256 = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return {...body, evidenceSha256};
}

function realDeps(opts) {
  const repo = opts.repo;
  const wslExe = process.platform === "win32" ? "wsl.exe" : "wsl";
  return {
    platform: process.platform, controlRoot: opts.controlRoot,
    wsl: args => new Promise(res => { const c = cp.spawn(wslExe, args, {shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {...process.env, WSL_UTF8: "1"}}); const o = []; c.stdout.on("data", d => o.push(d)); c.on("error", () => res({code: null, stdout: Buffer.alloc(0)})); c.on("close", code => res({code, stdout: Buffer.concat(o)})); setTimeout(() => { try { c.kill(); } catch { /* çıkmış */ } }, 60_000).unref(); }),
    git: () => {
      const r = cp.spawnSync("git", ["rev-parse", "HEAD"], {cwd: repo, encoding: "utf8", windowsHide: true}), s = cp.spawnSync("git", ["status", "--porcelain"], {cwd: repo, encoding: "utf8", windowsHide: true});
      return {headSha: r.status === 0 && /^[0-9a-f]{40}$/.test(r.stdout.trim()) ? r.stdout.trim() : null, dirty: s.status === 0 ? s.stdout.trim().length > 0 : null};
    },
    now: () => new Date().toISOString(),
    scriptSha256: sha256File(fileURLToPath(import.meta.url)), testSha256: sha256File(path.join(repo, TEST_FILE)),
    runVitest: distro => new Promise(res => {
      const entry = path.join(repo, "node_modules", "vitest", "vitest.mjs");
      if (!fs.existsSync(entry)) { res({testResults: []}); return; }
      const outFile = path.join(os.tmpdir(), `uasco-accept-${process.pid}-${Date.now()}.json`);
      const c = cp.spawn(process.execPath, [entry, "run", TEST_FILE, "-t", "REAL WSL", "--reporter=json", `--outputFile=${outFile}`], {cwd: repo, shell: false, windowsHide: true, stdio: ["ignore", "inherit", "inherit"], env: {...process.env, UASCO_WSL_DISTRO: distro}});
      const t = setTimeout(() => { try { c.kill(); } catch { /* çıkmış */ } }, 20 * 60_000); t.unref();
      c.on("close", () => { try { res(JSON.parse(fs.readFileSync(outFile, "utf8"))); } catch { res({testResults: []}); } try { fs.rmSync(outFile, {force: true}); } catch { /* temizlik */ } });
      c.on("error", () => res({testResults: []}));
    })
  };
}

export function parseArgs(argv, env = process.env) {
  const o = {repo: DEFAULT_REPO, distro: env.UASCO_WSL_DISTRO ?? null, controlRoot: env.UASCO_CONTROL_ROOT ?? null, out: null, shaArg: null};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--repo") o.repo = path.resolve(next() ?? ""); else if (a === "--distro") o.distro = next() ?? null; else if (a === "--control-root") o.controlRoot = path.resolve(next() ?? "");
    else if (a === "--out") o.out = path.resolve(next() ?? ""); else if (a === "--sha") o.shaArg = next() ?? null; else return {error: `unknown argument: ${a}`};
  }
  if (o.distro !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(o.distro)) return {error: "invalid --distro"};
  if (o.shaArg !== null && !/^[0-9a-f]{40}$/.test(o.shaArg)) return {error: "--sha must be 40 hex chars"};
  o.controlRoot ??= o.repo; o.out ??= path.join(o.repo, "artifacts", "runtime", "acceptance");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) { console.error(`${o.error}\nusage: node founder-acceptance.mjs [--distro Ubuntu] [--repo <dir>] [--control-root <dir>] [--out <dir>] [--sha <40hex>]`); process.exit(2); }
  const deps = realDeps(o);
  try {
    const prof = await import(pathToFileURL(path.join(o.repo, "core", "workos", "claude-profiles.ts")).href);
    deps.detectClaudeCli = typeof prof.detectClaudeCli === "function" ? () => prof.detectClaudeCli() : null;
    deps.claudeProfileStatus = typeof prof.claudeProfileStatus === "function" ? prof.claudeProfileStatus : null;
    if (!deps.detectClaudeCli) deps.importError = "detectClaudeCli is not exported by this checkout";
  } catch (e) { deps.importError = `cannot import core/workos/claude-profiles.ts (${String(e?.code ?? e?.message ?? e).slice(0, 80)}); needs Node >= 24`; }
  const report = await runAcceptance(o, deps);
  console.log("\n" + renderTable(report));
  try {
    fs.mkdirSync(o.out, {recursive: true});
    const file = path.join(o.out, `acceptance-${(report.repo.headSha ?? "nosha").slice(0, 12)}-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
    console.log(`Evidence: ${file}  (sha256 ${report.evidenceSha256})`);
  } catch (e) { console.error(`Could not write the evidence file: ${String(e?.message ?? e).slice(0, 120)}`); process.exit(1); }
  process.exit(report.verdict === "ACCEPTED" ? 0 : 1);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
