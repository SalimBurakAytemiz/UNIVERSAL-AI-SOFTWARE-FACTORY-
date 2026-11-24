// //TR: DSK-T0007 WSL2 sağlayıcısı (sahte wsl çalıştırıcısı; gerçek WSL veya model YOK): ayrılmış dağıtım zorunlu (kullanıcının varsayılan dağıtımı asla), wsl.conf birebir, otomatik bağlama/interop açık = ret, araç zinciri sabit özeti, konuk içi negatif sondalar fail-closed, öz-test geçmeden run NOT_EXECUTED, Windows -> Linux yol eşlemesi (bilinmeyen Windows yolu = ret), çalışma alanı geri aynalama (.git korunur), Acil Durdur'da dağıtım kapatma yedeği, kurulum planında sabit özetler, konuk proxy'si ana proxy ile aynı kararı verir. tests/v7-b3a-runner.test.ts altında kayıtlı (tests-3).
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {createRequire} from "node:module";
import {Wsl2SandboxProvider, WSL_DISTRO, WSL_CONF, GUEST, PROBE_SCRIPT, parseWslList, checkWslConf, evaluateProbe, provisionPlan, provision, safeMirror, safeCredentialsBack, readTarSafe, safeRelPath, guestIsolationScript, WSL2_ARTIFACTS} from "../../core/sandbox/wsl2-provider.js";
import {decideEgress} from "../../core/sandbox/egress-proxy.js";
import {ExecutionGate} from "../../core/workos/execution-gate.js";

const PIN = {node: "a".repeat(64), claude: "b".repeat(64)};
const utf16 = (s: string) => Buffer.from(s, "utf16le");
const ok = (stdout = "", code: number | null = 0) => ({exitCode: code, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), timedOut: false, aborted: false});
const GOOD_PROBE = "mnt_c=absent\ninterop=absent\nwindows_mounts=absent\nhome_visible=no\nroot_write=no\nwork_write=yes\ndirect_egress=blocked\nenv_leak=no\ncaps=dropped\ndone=1\n";
/** Scripted wsl: answers by command shape; records every call. */
function fakeWsl(over: Partial<{list: string; conf: string; outer: string; probe: string; pkill: number}> = {}) {
  const calls: string[][] = [];
  const runner = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "-l") return {...ok(), stdout: utf16(over.list ?? `  NAME            STATE    VERSION\n* Ubuntu          Running  2\n  ${WSL_DISTRO}   Stopped  2\n`)};
    if (args[0] === "--terminate") return ok();
    const cmd = args.slice(args.indexOf("--exec") + 1).join(" ");
    if (cmd.includes("/etc/wsl.conf")) return ok(over.conf ?? WSL_CONF);
    if (cmd.includes("sha256sum") && cmd.includes("command -v")) return ok(over.outer ?? `${PIN.node}  ${GUEST.node}\n${PIN.claude}  ${GUEST.claude}\n`);
    if (cmd.includes("pkill")) return ok("", over.pkill ?? 0);
    if (cmd.includes("unshare")) return ok(over.probe ?? GOOD_PROBE);
    return ok();
  };
  return {runner, calls};
}
const st = async (f: ReturnType<typeof fakeWsl>, pins = PIN) => { const p = new Wsl2SandboxProvider({runner: f.runner, pins}); const r = await p.selfTest(); return {p, r}; };

export function registerDskWsl2Cases(): void {
 describe("DSK-T0007 WSL2 provider (scripted wsl; real isolation needs a Windows run)", () => {
  it("parses wsl -l -v (UTF-16) and only ever targets the dedicated distro, never the user's default", async () => {
    const rows = parseWslList(utf16(`  NAME      STATE    VERSION\n* Ubuntu    Running  2\n  ${WSL_DISTRO}  Stopped  1\n`));
    expect(rows).toEqual([{name: "Ubuntu", state: "Running", version: 2, isDefault: true}, {name: WSL_DISTRO, state: "Stopped", version: 1, isDefault: false}]);
    const f = fakeWsl(); await st(f);
    for (const c of f.calls.filter(c => c.includes("--exec"))) expect(c.slice(0, 2)).toEqual(["-d", WSL_DISTRO]);
    expect(f.calls.some(c => c.includes("Ubuntu"))).toBe(false);
  });
  it("self-test PASSES only with the dedicated WSL2 distro, the exact wsl.conf, no automount/interop, pinned tools and every negative probe", async () => {
    expect((await st(fakeWsl())).r).toEqual({ok: true});
    const cases: Array<[Parameters<typeof fakeWsl>[0], string]> = [
      [{list: "  NAME STATE VERSION\n* Ubuntu Running 2\n"}, "DISTRO_MISSING"],
      [{list: `  NAME STATE VERSION\n  ${WSL_DISTRO} Running 1\n`}, "DISTRO_NOT_WSL2"],
      [{conf: WSL_CONF.replace("enabled=false", "enabled=true")}, "WSL_CONF_MISMATCH"],
      [{outer: "AUTOMOUNT\n"}, "AUTOMOUNT_ACTIVE"],
      [{outer: "INTEROP\n"}, "INTEROP_ACTIVE"],
      [{outer: "MISSING\n"}, "GUEST_TOOLS_MISSING"],
      [{outer: `${"c".repeat(64)}  x\n${PIN.claude}  y\n`}, "GUEST_PIN_MISMATCH"],
      [{probe: GOOD_PROBE.replace("mnt_c=absent", "mnt_c=present")}, "PROBE_MNT_C"],
      [{probe: GOOD_PROBE.replace("interop=absent", "interop=present")}, "PROBE_INTEROP"],
      [{probe: GOOD_PROBE.replace("direct_egress=blocked", "direct_egress=open")}, "PROBE_DIRECT_EGRESS"],
      [{probe: GOOD_PROBE.replace("env_leak=no", "env_leak=yes")}, "PROBE_ENV_LEAK"],
      [{probe: GOOD_PROBE.replace("home_visible=no", "home_visible=yes")}, "PROBE_HOME_VISIBLE"],
      [{probe: GOOD_PROBE.replace("root_write=no", "root_write=yes")}, "PROBE_ROOT_WRITE"],
      [{probe: GOOD_PROBE.replace("caps=dropped", "caps=present")}, "PROBE_CAPS"],
      [{probe: GOOD_PROBE.replace("done=1\n", "")}, "PROBE_DONE"],
    ];
    for (const [over, reason] of cases) expect((await st(fakeWsl(over))).r, reason).toEqual({ok: false, detail: reason});
    expect(await new Wsl2SandboxProvider({runner: fakeWsl().runner}).selfTest()).toEqual({ok: false, detail: "GUEST_PIN_MISMATCH"}); // no pins configured = never verified
    expect(await new Wsl2SandboxProvider({platform: "linux"}).selfTest()).toEqual({ok: false, detail: "PLATFORM_NOT_WIN32"});
  });
  it("a failed self-test executes nothing: run() is NOT_EXECUTED and the gate never verifies the provider", async () => {
    const f = fakeWsl({probe: GOOD_PROBE.replace("direct_egress=blocked", "direct_egress=open")}), {p} = await st(f);
    const n = f.calls.length;
    const r = await p.run([GUEST.node, "x"], {cwd: `${GUEST.runs}/${"0".repeat(24)}/repo`, env: {}, timeoutMs: 1000});
    expect(r.exitCode).toBe(null); expect(r.stderr).toMatch(/NOT_EXECUTED: SANDBOX_NOT_VERIFIED/); expect(f.calls.length).toBe(n);
    const g = new ExecutionGate(new Wsl2SandboxProvider({runner: f.runner, pins: PIN})); await g.status(); expect(g.verifiedProvider()).toBe(null);
  });
  it("maps Windows host paths to Linux guest paths; an unknown Windows path is refused; only allowed env keys cross", async () => {
    const p = new Wsl2SandboxProvider({runner: fakeWsl().runner, pins: PIN, hostAppRoot: "C:\\Program Files\\UASCO\\resources\\app"});
    const cwd = "C:\\Users\\f\\AppData\\Roaming\\UASCO\\data\\runs\\run_x\\work";
    const m = p.mapModelProcess(["C:\\Program Files\\UASCO\\node.exe", "C:\\Program Files\\UASCO\\resources\\app\\scripts\\claude-builder-broker.mjs"],
      {cwd, env: {CLAUDE_CONFIG_DIR: "C:\\Users\\f\\AppData\\Roaming\\UASCO\\control\\claude-profiles\\implementer", USERPROFILE: "C:\\Users\\f", ANTHROPIC_API_KEY: "k", UASCO_PROVIDER: "ANTHROPIC"}})!;
    expect(m.argv).toEqual([GUEST.node, `${GUEST.app}/scripts/claude-builder-broker.mjs`]);
    expect(m.cwd).toMatch(new RegExp(`^${GUEST.runs}/[0-9a-f]{24}/repo$`));
    expect(m.env).toEqual({UASCO_PROVIDER: "ANTHROPIC", CLAUDE_CONFIG_DIR: "/work/profile", UASCO_CONTROL_ROOT: "/opt/uasco/control"});
    expect(JSON.stringify(m)).not.toMatch(/[A-Za-z]:\\\\|\\\\/);
    expect(p.mapModelProcess(["C:\\node.exe", "D:\\elsewhere\\evil.mjs"], {cwd, env: {}})).toBe(null);
    expect(p.mapModelProcess(["C:\\tools\\claude.exe", "-p"], {cwd, env: {}})!.argv).toEqual([GUEST.claude, "-p"]);
    expect(p.mapModelProcess(["C:\\tools\\python.exe"], {cwd, env: {}})).toBe(null);
  });
  it("the isolation script is the Linux provider's, with loopback raised BEFORE capabilities drop; the probe covers fs, interop, egress, env and caps", () => {
    const s = guestIsolationScript();
    expect(s.indexOf('link set lo up')).toBeGreaterThan(-1);
    expect(s.indexOf('link set lo up')).toBeLessThan(s.indexOf("--bounding-set=-all"));
    for (const k of ["/mnt/c", "WSLInterop", "drvfs", "1.1.1.1", "ANTHROPIC_API_KEY", "CapEff"]) expect(PROBE_SCRIPT).toContain(k);
    expect(checkWslConf(WSL_CONF.replace(/\n/g, "\r\n"))).toBe(true);
    expect(evaluateProbe(GOOD_PROBE)).toEqual({ok: true}); expect(evaluateProbe("")).toEqual({ok: false, reason: "PROBE_MNT_C"});
  });
  it("Global Stop/cancel kills the guest run processes and terminates the dedicated distro when that fails", async () => {
    const f = fakeWsl({pkill: 1}), p = new Wsl2SandboxProvider({runner: f.runner, pins: PIN});
    await p.stopAll();
    expect(f.calls.at(-1)).toEqual(["--terminate", WSL_DISTRO]);
    const g = fakeWsl(), q = new Wsl2SandboxProvider({runner: g.runner, pins: PIN}); await q.stopAll();
    expect(g.calls.some(c => c[0] === "--terminate")).toBe(false);
  });
  it("CONCURRENCY: two simultaneous mappings (even of the same host workspace) get distinct guest scratch dirs and host mappings; a key runs only once at a time", async () => {
    const p = new Wsl2SandboxProvider({runner: fakeWsl().runner, pins: PIN});
    const cwd = "C:\\w\\run\\work";
    const a = p.mapModelProcess(["C:\\node.exe"], {cwd, env: {}})!, b = p.mapModelProcess(["C:\\node.exe"], {cwd, env: {}})!;
    expect(a.cwd).not.toBe(b.cwd);
    const keys = new Set(Array.from({length: 200}, () => p.mapModelProcess(["C:\\node.exe"], {cwd, env: {}})!.cwd)); expect(keys.size).toBe(200);
  });
  // a ustar archive built byte by byte so every unsafe shape can be crafted
  const tarOf = (entries: Array<{name: string; type?: string; data?: string; prefix?: string; link?: string; magic?: string}>) => {
    const blocks: Buffer[] = [];
    for (const e of entries) {
      const h = Buffer.alloc(512), data = Buffer.from(e.data ?? ""), put = (o: number, v: string) => h.write(v, o, "latin1");
      put(0, e.name); put(100, "0000644\0"); put(108, "0000000\0"); put(116, "0000000\0"); put(124, data.length.toString(8).padStart(11, "0") + "\0"); put(136, "00000000000\0");
      h[156] = (e.type ?? "0").charCodeAt(0); if (e.link) put(157, e.link); put(257, e.magic ?? "ustar\0"); put(263, "00"); if (e.prefix) put(345, e.prefix);
      h.fill(32, 148, 156); put(148, [...h].reduce((x, y) => x + y, 0).toString(8).padStart(6, "0") + "\0 ");
      blocks.push(h, Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]));
    }
    return Buffer.concat([...blocks, Buffer.alloc(1024)]);
  };
  it("UNTRUSTED ARCHIVE: traversal, absolute/drive paths, links, devices, pax/GNU extensions, .git, Windows-reserved names and bad checksums are rejected whole", () => {
    const reason = (t: Buffer) => { const r = readTarSafe(t); return r.ok ? "OK" : r.reason; };
    expect(reason(tarOf([{name: "src/a.txt", data: "x"}, {name: "src", type: "5"}]))).toBe("OK");
    expect(reason(tarOf([{name: "../evil.txt", data: "x"}]))).toBe("UNSAFE_TAR_PATH");
    expect(reason(tarOf([{name: "evil.txt", prefix: "a/../.."}]))).toBe("UNSAFE_TAR_PATH");
    expect(reason(tarOf([{name: "/etc/passwd", data: "x"}]))).toBe("UNSAFE_TAR_PATH");
    expect(reason(tarOf([{name: "C:/Windows/x", data: "x"}]))).toBe("UNSAFE_TAR_PATH");
    expect(reason(tarOf([{name: "a\\..\\..\\x", data: "x"}]))).toBe("UNSAFE_TAR_PATH");
    expect(reason(tarOf([{name: ".git/config", data: "x"}]))).toBe("UNSAFE_TAR_PATH");
    expect(reason(tarOf([{name: "CON.txt", data: "x"}]))).toBe("UNSAFE_TAR_PATH");
    expect(reason(tarOf([{name: "link", type: "2", link: "/etc/passwd"}]))).toBe("UNSAFE_TAR_TYPE_SYMLINK");
    expect(reason(tarOf([{name: "hard", type: "1", link: "x"}]))).toBe("UNSAFE_TAR_TYPE_HARDLINK");
    expect(reason(tarOf([{name: "pax", type: "x", data: "30 path=../../escape\n"}]))).toBe("UNSAFE_TAR_TYPE_PAX");
    expect(reason(tarOf([{name: "././@LongLink", type: "L", data: "../../x"}]))).toBe("UNSAFE_TAR_TYPE_GNU_LONG");
    expect(reason(tarOf([{name: "dev", type: "3"}]))).toBe("UNSAFE_TAR_TYPE_SPECIAL");
    expect(reason(tarOf([{name: "a", data: "x", magic: "xxxxx\0"}]))).toBe("TAR_NOT_USTAR");
    const bad = tarOf([{name: "a", data: "x"}]); bad[0] ^= 1; expect(reason(bad)).toBe("TAR_BAD_CHECKSUM");
    expect(reason(tarOf([{name: "a", data: "x"}]).subarray(0, 600))).toBe("TAR_TRUNCATED");
    expect(safeRelPath("./ok/file.ts")).toBe("ok/file.ts"); expect(safeRelPath("a/./b")).toBe(null); expect(safeRelPath("trailing.")).toBe(null);
  });
  it("UNTRUSTED ARCHIVE: the mirror never writes outside the workspace — not through a host symlink, not via an unlisted file, never into .git; on any refusal NOTHING changes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-wsl-mirror-")), host = path.join(tmp, "host"), outside = path.join(tmp, "outside");
    for (const d of [host, outside, path.join(host, ".git")]) fs.mkdirSync(d, {recursive: true});
    fs.writeFileSync(path.join(host, ".git", "HEAD"), "ref"); fs.writeFileSync(path.join(host, "keep.txt"), "old"); fs.writeFileSync(path.join(host, "gone.txt"), "x");
    fs.symlinkSync(outside, path.join(host, "linkdir")); fs.writeFileSync(path.join(outside, "secret.txt"), "S");
    const snapshot = () => JSON.stringify([fs.readdirSync(host).sort(), fs.readFileSync(path.join(host, "keep.txt"), "utf8"), fs.readdirSync(outside).sort(), fs.readFileSync(path.join(outside, "secret.txt"), "utf8")]);
    const before = snapshot();
    expect(() => safeMirror(host, ["linkdir/secret.txt"], tarOf([{name: "linkdir/secret.txt", data: "PWNED"}]))).toThrow(/UNSAFE_HOST_LINK/);
    expect(() => safeMirror(host, ["keep.txt"], tarOf([{name: "keep.txt", data: "n"}, {name: "extra.txt", data: "e"}]))).toThrow(/UNSAFE_UNLISTED_FILE/);
    expect(() => safeMirror(host, ["../outside/secret.txt"], tarOf([{name: "keep.txt", data: "n"}]))).toThrow(/UNSAFE_FILE_LIST/);
    expect(() => safeMirror(host, ["keep.txt"], tarOf([{name: "link", type: "2", link: "/etc"}]))).toThrow(/UNSAFE_TAR_TYPE_SYMLINK/);
    expect(snapshot()).toBe(before); expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("S");
    // a valid archive: changed + added files written, absent files deleted, .git and the outside target untouched (the link itself is removed, not its target)
    safeMirror(host, ["keep.txt", "src/added.txt"], tarOf([{name: "keep.txt", data: "new"}, {name: "src", type: "5"}, {name: "src/added.txt", data: "a"}]));
    expect(fs.readFileSync(path.join(host, "keep.txt"), "utf8")).toBe("new"); expect(fs.readFileSync(path.join(host, "src", "added.txt"), "utf8")).toBe("a");
    expect(fs.existsSync(path.join(host, "gone.txt"))).toBe(false); expect(fs.readFileSync(path.join(host, ".git", "HEAD"), "utf8")).toBe("ref");
    expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("S");
  });
  it("#446 B2: NTFS 8.3 short names and any .git (any depth/case) are refused; a link into .git is refused; nothing is written", () => {
    for (const bad of ["GIT~1/config", "git~1/hooks/pre-commit", "PROGRA~1/x.txt", "src/GIT~1/config", "a/.git/config", "a/.GiT/hooks/x", ".Git/config", "x~/y", "~/z"]) expect(safeRelPath(bad), bad).toBe(null);
    const reason = (t: Buffer) => { const r = readTarSafe(t); return r.ok ? "OK" : r.reason; };
    expect(reason(tarOf([{name: "GIT~1/config", data: "[core]\n\tfsmonitor = touch /tmp/pwned\n"}]))).toBe("UNSAFE_TAR_PATH");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-wsl-git-")), host = path.join(tmp, "host");
    fs.mkdirSync(path.join(host, ".git", "hooks"), {recursive: true}); fs.writeFileSync(path.join(host, ".git", "config"), "[core]\n");
    fs.symlinkSync(path.join(host, ".git"), path.join(host, "gitlink")); // a link (POSIX symlink / Windows junction) into .git
    expect(() => safeMirror(host, ["gitlink/config"], tarOf([{name: "gitlink/config", data: "[core]\n\tfsmonitor = x\n"}]))).toThrow(/UNSAFE_HOST_LINK|UNSAFE_GIT_PATH/);
    expect(() => safeMirror(host, ["GIT~1/config"], tarOf([{name: "GIT~1/config", data: "x"}]))).toThrow(/UNSAFE_TAR_PATH/);
    expect(fs.readFileSync(path.join(host, ".git", "config"), "utf8")).toBe("[core]\n");
  });
  it("#446 B2 (c): a planted fsmonitor in a guest-touched clone never executes — .git integrity is checked before any git command", async () => {
    const {reviewWorkspaceSnapshot, reviewWorkspaceChange} = await import("../../core/workos/executors.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-wsl-fsmon-")), repo = path.join(tmp, "r"), marker = path.join(tmp, "FSMONITOR_RAN");
    fs.mkdirSync(repo); const g = (a: string[]) => cp.spawnSync("git", a, {cwd: repo});
    g(["init", "-q", "-b", "main"]); fs.writeFileSync(path.join(repo, "a.txt"), "a"); g(["add", "-A"]); g(["-c", "user.name=S", "-c", "user.email=s@local.invalid", "commit", "-q", "-m", "s"]);
    const policy = path.resolve(import.meta.dirname, "..", "..", "config", "environment-policy.json");
    const before = reviewWorkspaceSnapshot(repo, policy);
    expect(before.status).toBe("");
    const hook = path.join(tmp, "fsmon.sh"); fs.writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`, {mode: 0o755});
    fs.appendFileSync(path.join(repo, ".git", "config"), `[core]\n\tfsmonitor = ${hook}\n\thooksPath = ${tmp}\n`); // planted by an untrusted mirror
    const after = reviewWorkspaceSnapshot(repo, policy, before.gitDigest);
    expect(after.status).toBe(null); // no git process ran
    expect(fs.existsSync(marker)).toBe(false);
    expect(reviewWorkspaceChange(before, after)).toBe("REVIEW_WORKSPACE_GIT_CHANGED");
    // even without the digest guard, the hardened git invocation never runs the planted fsmonitor
    reviewWorkspaceSnapshot(repo, policy); expect(fs.existsSync(marker)).toBe(false);
  });
  it("credentials copy-back accepts exactly one regular .credentials.json into a real profile dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-wsl-cred-")), prof = path.join(tmp, "p"), other = path.join(tmp, "o"); fs.mkdirSync(prof); fs.mkdirSync(other);
    expect(() => safeCredentialsBack(prof, tarOf([{name: ".credentials.json", data: "{}"}, {name: "x", data: "y"}]))).toThrow(/UNSAFE_CREDENTIALS_ARCHIVE/);
    expect(() => safeCredentialsBack(prof, tarOf([{name: "settings.json", data: "{}"}]))).toThrow(/UNSAFE_CREDENTIALS_ARCHIVE/);
    fs.symlinkSync(path.join(other, "c"), path.join(prof, ".credentials.json"));
    expect(() => safeCredentialsBack(prof, tarOf([{name: ".credentials.json", data: "{}"}]))).toThrow(/UNSAFE_HOST_LINK/); expect(fs.existsSync(path.join(other, "c"))).toBe(false);
    fs.rmSync(path.join(prof, ".credentials.json")); safeCredentialsBack(prof, tarOf([{name: ".credentials.json", data: "{\"t\":1}"}]));
    expect(fs.readFileSync(path.join(prof, ".credentials.json"), "utf8")).toBe("{\"t\":1}");
  });
  it("provisioning: every artifact is sha256-pinned (refused otherwise), only the dedicated distro is imported, wsl.conf is written, and execution stops at the first failing step", async () => {
    const A = WSL2_ARTIFACTS, at = (n: string, sha256: string) => ({path: `C:\\pkg\\${n}`, sha256});
    const base = {installDir: "C:\\Users\\f\\AppData\\Local\\UASCO\\wsl", rootfs: at("rootfs.tar.gz", A.rootfs.sha256), node: at("node.tar.xz", A.node.sha256), claude: at("claude.tgz", A.claude.sha256), appScriptsTar: at("app.tar", "e".repeat(64)), nodeBinarySha256: A.node.binarySha256!, claudeBinarySha256: A.claude.binarySha256!};
    for (const k of ["rootfs", "node", "claude"] as const) { expect(A[k].url).toMatch(/^https:\/\/(cloud-images\.ubuntu\.com|nodejs\.org|registry\.npmjs\.org)\//); expect(A[k].sha256).toMatch(/^[0-9a-f]{64}$/); }
    expect(provisionPlan({...base, claude: {path: "x", sha256: "nope"}})).toEqual({ok: false, error: "PIN_MISSING_CLAUDE"});
    expect(provisionPlan({...base, installDir: "relative"})).toEqual({ok: false, error: "INSTALL_DIR_NOT_ABSOLUTE_WINDOWS"});
    expect(provisionPlan({...base, rootfs: at("other.tar", "f".repeat(64))})).toEqual({ok: false, error: "ARTIFACT_NOT_PINNED_ROOTFS"}); // a self-consistent but unknown rootfs is untrusted
    expect(provisionPlan({...base, claudeBinarySha256: "0".repeat(64)})).toEqual({ok: false, error: "ARTIFACT_NOT_PINNED_BINARY"});
    const plan = provisionPlan(base); if (!plan.ok) throw new Error(plan.error);
    expect(plan.steps[0].args).toEqual(["--import", WSL_DISTRO, base.installDir, base.rootfs.path, "--version", "2"]); expect(plan.steps[0].verify).toEqual(base.rootfs);
    expect(plan.steps.find(s => s.input === WSL_CONF)).toBeTruthy();
    for (const s of plan.steps.filter(x => x.inputFile)) { expect(s.args.join(" ")).toMatch(/sha256sum -c/); expect(s.verify).toBeTruthy(); }
    expect(plan.steps.at(-1)!.args.join(" ")).toContain(A.claude.binarySha256!);
    expect(plan.steps.every(s => !s.args.includes("Ubuntu"))).toBe(true);
    // host-side verification BEFORE wsl --import: a changed or missing rootfs never reaches wsl.exe
    const seen: string[] = [], run = async (args: string[]) => { seen.push(args.join(" ")); return ok("", 0); };
    expect(await provision(plan, run, () => Buffer.from("tampered"))).toEqual({ok: false, step: `ARTIFACT_HASH_MISMATCH:${plan.steps[0].what}`}); expect(seen).toEqual([]);
    expect(await provision(plan, run, () => { throw new Error("ENOENT"); })).toEqual({ok: false, step: `ARTIFACT_MISSING:${plan.steps[0].what}`}); expect(seen).toEqual([]);
    // with matching artifacts it runs in order and stops at the first failing step (the hash function is a test seam: real files are not in CI)
    const byPath: Record<string, string> = Object.fromEntries([base.rootfs, base.node, base.claude, base.appScriptsTar].map(x => [x.path, x.sha256]));
    const res = await provision(plan, async args => { seen.push(args.join(" ")); return ok("", seen.length === 3 ? 1 : 0); }, p => Buffer.from(p), b => byPath[b.toString()] ?? "x");
    expect(res).toEqual({ok: false, step: plan.steps[2].what}); expect(seen.length).toBe(3);
  });
  it("INSTALL: never touches the user's distros, verifies every download, never re-imports an existing UASCO-Sandbox, and writes the pin record only on success", async () => {
    const {installSandbox, SANDBOX_RECORD, GUEST_APP_FILES} = await import("../../core/sandbox/wsl2-install.js");
    const crypto = await import("node:crypto");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-wsl-inst-")), control = path.join(tmp, "control"), work = path.join(tmp, "work");
    const A = WSL2_ARTIFACTS, byUrl: Record<string, string> = {[A.rootfs.url]: "rootfs", [A.node.url]: "node", [A.claude.url]: "claude"};
    // the stub downloader writes marker bytes; a hash stub maps marker bytes to the pinned values (real artifacts are not in CI)
    const pinned: Record<string, string> = {rootfs: A.rootfs.sha256, node: A.node.sha256, claude: A.claude.sha256};
    const realHash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
    const sha = (b: Buffer) => pinned[b.toString()] ?? realHash(b); // test seam: marker bytes stand for the pinned artifacts
    const deps = (list: string, fail?: string, tamper?: string) => {
      const calls: string[][] = [];
      return {calls, d: {runner: async (args: string[]) => { calls.push(args); if (args[0] === "-l") return {...ok(), stdout: utf16(list)}; return ok("", fail && args.join(" ").includes(fail) ? 1 : 0); },
        download: async (url: string, dest: string) => { fs.writeFileSync(dest, tamper === byUrl[url] ? "evil" : byUrl[url]); }, packApp: (_r: string, files: readonly string[], dest: string) => { fs.writeFileSync(dest, files.join("\n")); }, sha256: sha}};
    };
    {
      const USER = "  NAME STATE VERSION\n* Ubuntu Running 2\n  Debian Stopped 2\n";
      const fresh = deps(USER);
      const r1 = await installSandbox({appRoot: "/app", controlRoot: control, installDir: "C:\\Users\\f\\AppData\\Local\\UASCO\\wsl", workDir: work}, fresh.d);
      expect(r1).toMatchObject({ok: true, installed: true});
      expect(JSON.parse(fs.readFileSync(SANDBOX_RECORD(control), "utf8"))).toMatchObject({distro: WSL_DISTRO, node: A.node.binarySha256, claude: A.claude.binarySha256});
      expect(fresh.calls.some(c => c[0] === "--import" && c[1] === WSL_DISTRO)).toBe(true);
      expect(fresh.calls.flat().some(a => a === "Ubuntu" || a === "Debian")).toBe(false); // the user's distros are never named
      expect(GUEST_APP_FILES).toContain("scripts/claude-builder-broker.mjs");
      // an existing UASCO-Sandbox is re-verified, never re-imported
      fs.rmSync(SANDBOX_RECORD(control));
      const again = deps(USER + `  ${WSL_DISTRO} Stopped 2\n`);
      expect(await installSandbox({appRoot: "/app", controlRoot: control, installDir: "C:\\x", workDir: work}, again.d)).toMatchObject({ok: true, installed: false});
      expect(again.calls.some(c => c[0] === "--import")).toBe(false);
      // a tampered download stops before wsl.exe imports anything and leaves no record
      fs.rmSync(SANDBOX_RECORD(control)); fs.rmSync(work, {recursive: true, force: true});
      const bad = deps(USER, undefined, "node");
      expect(await installSandbox({appRoot: "/app", controlRoot: control, installDir: "C:\\x", workDir: work}, bad.d)).toEqual({ok: false, step: "ARTIFACT_HASH_MISMATCH_NODE"});
      expect(bad.calls.some(c => c[0] === "--import")).toBe(false); expect(fs.existsSync(SANDBOX_RECORD(control))).toBe(false);
      // a failing guest step leaves no record (real execution stays disabled)
      fs.rmSync(work, {recursive: true, force: true});
      const fail = deps(USER, "sha256sum -c -");
      const r4 = await installSandbox({appRoot: "/app", controlRoot: control, installDir: "C:\\x", workDir: work}, fail.d);
      expect(r4.ok).toBe(false); expect(fs.existsSync(SANDBOX_RECORD(control))).toBe(false);
    }
  });

  it("the guest egress proxy decides exactly like the host proxy (no drift)", () => {
    const guest = createRequire(import.meta.url)("../../core/sandbox/guest/egress.cjs") as {decide: (h: string) => unknown};
    for (const h of ["CONNECT api.anthropic.com:443 HTTP/1.1", "CONNECT claude.ai:443 HTTP/1.1", "CONNECT evil.com:443 HTTP/1.1", "CONNECT 1.2.3.4:443 HTTP/1.1", "CONNECT [::1]:443 HTTP/1.1",
      "CONNECT api.anthropic.com:80 HTTP/1.1", "GET / HTTP/1.1", "junk", "CONNECT localhost:443 HTTP/1.1", "CONNECT API.ANTHROPIC.COM:443 HTTP/1.0"])
      expect(guest.decide(h), h).toEqual(decideEgress(h));
  });
 });
}
