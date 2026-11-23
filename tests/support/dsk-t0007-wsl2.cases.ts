// //TR: DSK-T0007 WSL2 sağlayıcısı (sahte wsl çalıştırıcısı; gerçek WSL veya model YOK): ayrılmış dağıtım zorunlu (kullanıcının varsayılan dağıtımı asla), wsl.conf birebir, otomatik bağlama/interop açık = ret, araç zinciri sabit özeti, konuk içi negatif sondalar fail-closed, öz-test geçmeden run NOT_EXECUTED, Windows -> Linux yol eşlemesi (bilinmeyen Windows yolu = ret), çalışma alanı geri aynalama (.git korunur), Acil Durdur'da dağıtım kapatma yedeği, kurulum planında sabit özetler, konuk proxy'si ana proxy ile aynı kararı verir. tests/v7-b3a-runner.test.ts altında kayıtlı (tests-3).
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {createRequire} from "node:module";
import {Wsl2SandboxProvider, WSL_DISTRO, WSL_CONF, GUEST, PROBE_SCRIPT, parseWslList, checkWslConf, evaluateProbe, provisionPlan, provision, mirrorBack, runKey, guestIsolationScript} from "../../core/sandbox/wsl2-provider.js";
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
    expect(m.cwd).toBe(`${GUEST.runs}/${runKey(cwd)}/repo`);
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
  it("mirrors the guest workspace back to the host (deleted files removed, new/changed files written, .git untouched) with a real tar", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-wsl-mirror-")), host = path.join(tmp, "host"), guest = path.join(tmp, "guest");
    for (const d of [host, guest, path.join(host, ".git")]) fs.mkdirSync(d, {recursive: true});
    fs.writeFileSync(path.join(host, ".git", "HEAD"), "ref"); fs.writeFileSync(path.join(host, "keep.txt"), "old"); fs.writeFileSync(path.join(host, "gone.txt"), "x");
    fs.writeFileSync(path.join(guest, "keep.txt"), "new"); fs.writeFileSync(path.join(guest, "added.txt"), "a");
    const data = cp.spawnSync("tar", ["-c", "-f", "-", "-C", guest, "."]).stdout;
    mirrorBack(host, ["./keep.txt", "./added.txt"], data, (dir, d) => { cp.spawnSync("tar", ["-x", "-f", "-", "-C", dir], {input: d}); });
    expect(fs.readFileSync(path.join(host, "keep.txt"), "utf8")).toBe("new"); expect(fs.existsSync(path.join(host, "added.txt"))).toBe(true);
    expect(fs.existsSync(path.join(host, "gone.txt"))).toBe(false); expect(fs.readFileSync(path.join(host, ".git", "HEAD"), "utf8")).toBe("ref");
  });
  it("provisioning: every artifact is sha256-pinned (refused otherwise), only the dedicated distro is imported, wsl.conf is written, and execution stops at the first failing step", async () => {
    const pin = (n: string) => ({path: `C:\\pkg\\${n}`, sha256: "d".repeat(64)});
    const base = {installDir: "C:\\Users\\f\\AppData\\Local\\UASCO\\wsl", rootfs: pin("rootfs.tar"), node: pin("node.tar.xz"), claude: pin("claude.tgz"), appScriptsTar: pin("app.tar")};
    expect(provisionPlan({...base, claude: {path: "x", sha256: "nope"}})).toEqual({ok: false, error: "PIN_MISSING_CLAUDE"});
    expect(provisionPlan({...base, installDir: "relative"})).toEqual({ok: false, error: "INSTALL_DIR_NOT_ABSOLUTE_WINDOWS"});
    const plan = provisionPlan(base); if (!plan.ok) throw new Error(plan.error);
    expect(plan.steps[0].args).toEqual(["--import", WSL_DISTRO, base.installDir, base.rootfs.path, "--version", "2"]);
    expect(plan.steps.find(s => s.input === WSL_CONF)).toBeTruthy();
    for (const s of plan.steps.filter(x => x.inputFile)) expect(s.args.join(" ")).toMatch(/sha256sum -c/);
    expect(plan.steps.every(s => !s.args.includes("Ubuntu"))).toBe(true);
    const seen: string[] = [];
    const res = await provision(plan, async args => { seen.push(args.join(" ")); return ok("", seen.length === 3 ? 1 : 0); }, () => Buffer.from("x"));
    expect(res).toEqual({ok: false, step: plan.steps[2].what}); expect(seen.length).toBe(3);
  });
  it("the guest egress proxy decides exactly like the host proxy (no drift)", () => {
    const guest = createRequire(import.meta.url)("../../core/sandbox/guest/egress.cjs") as {decide: (h: string) => unknown};
    for (const h of ["CONNECT api.anthropic.com:443 HTTP/1.1", "CONNECT claude.ai:443 HTTP/1.1", "CONNECT evil.com:443 HTTP/1.1", "CONNECT 1.2.3.4:443 HTTP/1.1", "CONNECT [::1]:443 HTTP/1.1",
      "CONNECT api.anthropic.com:80 HTTP/1.1", "GET / HTTP/1.1", "junk", "CONNECT localhost:443 HTTP/1.1", "CONNECT API.ANTHROPIC.COM:443 HTTP/1.0"])
      expect(guest.decide(h), h).toEqual(decideEgress(h));
  });
 });
}
