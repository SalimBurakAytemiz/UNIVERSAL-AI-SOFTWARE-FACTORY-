// //TR: C-LINUX-SANDBOX-EXPORTS: Lane B'nin WSL2 sağlayıcısı Linux izolasyonunu kopyalamadan yeniden kullanır; bu test dışa aktarılan üç sabitin sağlayıcının KENDİ kullandığı değerler olduğunu sabitler (davranış değişmedi).
import {describe, it, expect} from "vitest";
import cp from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {LINUX_SANDBOX_HELPER_PATH, LINUX_SANDBOX_LOOPBACK_PROBE, LINUX_SANDBOX_NS_FLAGS, LINUX_SANDBOX_SETUP, LinuxUnshareSandboxProvider, loopbackVerdict, networkRouteProblem} from "../core/agents/linux-unshare-sandbox.js";

describe("C-LINUX-SANDBOX-EXPORTS: the exported isolation constants are the values the provider runs with", () => {
  it("exports the unchanged values (isolation flags frozen, helper PATH, setup script)", () => {
    expect([...LINUX_SANDBOX_NS_FLAGS]).toEqual(["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL"]);
    expect(Object.isFrozen(LINUX_SANDBOX_NS_FLAGS)).toBe(true);
    expect(() => (LINUX_SANDBOX_NS_FLAGS as string[]).push("--evil")).toThrow(TypeError); // a consumer cannot change the provider's flags
    expect(LINUX_SANDBOX_HELPER_PATH).toBe("/usr/sbin:/usr/bin:/sbin:/bin");
    expect(typeof LINUX_SANDBOX_SETUP).toBe("string");
    expect(LINUX_SANDBOX_SETUP).toContain(`PATH=${LINUX_SANDBOX_HELPER_PATH}`); // the script resolves privileged helpers with the exported HELPER_PATH
    expect(LINUX_SANDBOX_SETUP.startsWith("set -eu; set -f\n")).toBe(true);
  });

  // The provider's own argv builder (private) must embed exactly the exported flags and script. It needs a host directory that can serve as the new root (/mnt, /srv or /media); a host without one cannot build argv at all, which is reported (not silently passed).
  it("the provider's argv is [...exported flags, shell, -c, exported setup, ...] for the same inputs", () => {
    const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lsx-"));
    try {
      const p = new LinuxUnshareSandboxProvider({platform: "linux", readOnlyRoots: []}) as unknown as {args(cwd: string, timeoutMs: number, command: string[]): string[] | null};
      const argv = p.args(cwd, 1000, ["true"]);
      if (argv === null) { expect(["/mnt", "/srv", "/media"].some(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })).toBe(false); return; } // null only when no new-root mount point exists on this host
      expect(argv.slice(0, LINUX_SANDBOX_NS_FLAGS.length)).toEqual([...LINUX_SANDBOX_NS_FLAGS]);
      expect(argv[LINUX_SANDBOX_NS_FLAGS.length + 1]).toBe("-c");
      expect(argv[LINUX_SANDBOX_NS_FLAGS.length + 2]).toBe(LINUX_SANDBOX_SETUP);
    } finally { fs.rmSync(cwd, {recursive: true, force: true}); }
  });
});

// //TR: C-SBX-LO-1: sandbox içinde loopback (127.0.0.1) çalışır, dışarıya HİÇBİR yol yoktur. Gerçek-sağlayıcı testleri yalnız ana makine namespace kurabiliyorsa koşar; `ip` yoksa (bu makine gibi) yetenek loopback=false/LOOPBACK_TOOL_MISSING olmalıdır ve sağlayıcı yine doğrulanır. Kök kullanıcıda `ip` yoksa, geçici bir /usr/sbin/ip TEST taslağıyla (wx: gerçek ip asla ezilmez, finally'de silinir) lo'nun gerçekten açıldığı kanıtlanır.
describe("C-SBX-LO-1: loopback inside the Linux sandbox, no way out", () => {
  const T2 = 180_000;
  const isRoot = (process.getuid?.() ?? 0) === 0;
  const procOpts = isRoot ? {acceptUnenforcedProcessLimit: true} : {};
  const hostCanIsolate = process.platform === "linux" && cp.spawnSync("unshare", ["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL", "true"], {stdio: "ignore"}).status === 0
    && ["setpriv", "pivot_root", "mount", "umount"].every(t => cp.spawnSync("sh", ["-c", `command -v ${t}`], {stdio: "ignore", env: {PATH: LINUX_SANDBOX_HELPER_PATH}}).status === 0);
  const hostHasIp = LINUX_SANDBOX_HELPER_PATH.split(":").some(d => { try { fs.accessSync(path.join(d, "ip"), fs.constants.X_OK); return true; } catch { return false; } });
  const PERL_STUB = '#!/usr/bin/perl\nuse Socket;\nexit 2 unless "@ARGV" eq "link set lo up";\nsocket(S, AF_INET, SOCK_DGRAM, 0) or exit 3;\nmy $ifr = pack("a16 s", "lo", 0x41);\nioctl(S, 0x8914, $ifr) or exit 4;\nexit 0;\n';
  const canStub = process.platform === "linux" && isRoot && hostCanIsolate && !hostHasIp && cp.spawnSync("sh", ["-c", "command -v perl"], {stdio: "ignore"}).status === 0 && (() => { try { fs.accessSync("/usr/sbin", fs.constants.W_OK); return true; } catch { return false; } })();
  const withStubIp = async <R,>(script: string, fn: () => Promise<R>): Promise<R> => {
    fs.writeFileSync("/usr/sbin/ip", script, {mode: 0o755, flag: "wx"}); // wx: an existing (real) ip is never overwritten
    try { return await fn(); } finally { fs.rmSync("/usr/sbin/ip", {force: true}); }
  };
  const hostListener = async () => {
    let connections = 0;
    const srv = net.createServer(s => { connections++; s.destroy(); });
    const port = await new Promise<number>((res, rej) => { srv.once("error", rej); srv.listen(0, "127.0.0.1", () => res((srv.address() as net.AddressInfo).port)); });
    return {port, srv, connections: () => connections};
  };

  it("SETUP brings lo up right after the prlimit lines: ip resolved with the fixed helper PATH before the capabilities are dropped, never any other tool", () => {
    const L = LINUX_SANDBOX_SETUP.split("\n");
    const at = (pred: (l: string) => boolean) => L.findIndex(pred);
    const iPath = at(l => l.startsWith('CALLER_PATH="$PATH"; PATH=')), iPrl = at(l => l.startsWith('if [ -n "$PRL" ] && ! "$PRL"'));
    const iIpb = L.indexOf('IPB=$(command -v ip 2>/dev/null) || IPB=""'), iUp = L.indexOf('if [ -n "$IPB" ]; then "$IPB" link set lo up 2>/dev/null || true; fi');
    const iRpriv = at(l => l.startsWith("mount --make-rprivate")), iDrop = at(l => l.startsWith('exec "$SETPRIV"'));
    expect([iPath >= 0, iPath < iPrl, iIpb === iPrl + 1, iUp === iIpb + 1, iRpriv === iUp + 1, iUp < iDrop]).toEqual([true, true, true, true, true, true]);
    expect(LINUX_SANDBOX_SETUP.split("link set lo up")).toHaveLength(2); // exactly one place brings an interface up
    expect(LINUX_SANDBOX_SETUP.toLowerCase()).not.toContain("python");
    expect(LINUX_SANDBOX_SETUP).not.toContain('PATH="$CALLER_PATH" command'); // the caller's PATH never resolves a privileged helper
  });

  it("the in-sandbox probe covers loopback and every outbound target, and names its host-loopback port", () => {
    for (const piece of ['"1.1.1.1", 53', '"8.8.8.8", 53', '"93.184.216.34", 80', 'targets.push(["127.0.0.1", hostPort])', "probe_started", "loopback_ok", "outbound_connected", "outbound_blocked", 'got === "pong"']) expect(LINUX_SANDBOX_LOOPBACK_PROBE).toContain(piece);
  });

  it("the probe script itself: loopback works, a reachable target is reported as outbound_connected, and a dead loopback is reported as loopback_failed", { timeout: 60_000 }, async () => {
    const l = await hostListener();
    try {
      const host = cp.spawnSync(process.execPath, ["-e", LINUX_SANDBOX_LOOPBACK_PROBE, String(l.port)], {encoding: "utf8", timeout: 30_000});
      const lines = String(host.stdout).split("\n").map(s => s.trim());
      expect([lines.includes("probe_started"), lines.includes("loopback_ok"), lines.includes("outbound_connected")]).toEqual([true, true, true]); // the host listener is a reachable "outside"
      await new Promise(r => setTimeout(r, 100)); // spawnSync blocked this process's event loop: let the accepted connection be delivered
      expect(l.connections()).toBeGreaterThan(0);
      if (hostCanIsolate) { // a fresh net namespace has lo DOWN: no listen, nothing reachable
        const ns = cp.spawnSync("unshare", ["--user", "--map-root-user", "--net", process.execPath, "-e", LINUX_SANDBOX_LOOPBACK_PROBE, String(l.port)], {encoding: "utf8", timeout: 30_000});
        const nl = String(ns.stdout).split("\n").map(s => s.trim());
        expect([nl.includes("probe_started"), nl.includes("loopback_failed"), nl.includes("outbound_blocked")]).toEqual([true, true, true]);
      }
    } finally { l.srv.close(); }
  });

  it("loopbackVerdict: every outcome (host loopback reached, outbound connected or unverified, no loopback with and without ip, node unavailable)", () => {
    const out = (...t: string[]) => t.join("\n") + "\n";
    const ok = (lo: boolean, reason: string | null) => ({ok: true, capabilities: {loopback: lo, loopbackReason: reason}});
    const full = out("probe_started", "loopback_ok", "outbound_blocked");
    expect(loopbackVerdict({ipPresent: true, stdout: full, hostConnections: 1})).toEqual({ok: false, detail: "SELFTEST_HOST_LOOPBACK_REACHED"});
    expect(loopbackVerdict({ipPresent: false, stdout: "", hostConnections: 2})).toEqual({ok: false, detail: "SELFTEST_HOST_LOOPBACK_REACHED"});
    for (const ip of [true, false]) expect(loopbackVerdict({ipPresent: ip, stdout: out("probe_started", "loopback_ok", "outbound_connected"), hostConnections: 0})).toEqual({ok: false, detail: "SELFTEST_OUTBOUND_CONNECT_SUCCEEDED"});
    expect(loopbackVerdict({ipPresent: true, stdout: out("probe_started", "loopback_ok"), hostConnections: 0})).toEqual({ok: false, detail: "SELFTEST_OUTBOUND_NOT_VERIFIED"}); // probe died before its verdict: fail closed
    expect(loopbackVerdict({ipPresent: true, stdout: out("probe_started", "loopback_failed", "outbound_blocked"), hostConnections: 0})).toEqual({ok: false, detail: "SELFTEST_LOOPBACK_NOT_AVAILABLE"});
    expect(loopbackVerdict({ipPresent: true, stdout: full, hostConnections: 0})).toEqual(ok(true, null));
    expect(loopbackVerdict({ipPresent: false, stdout: out("probe_started", "loopback_failed", "outbound_blocked"), hostConnections: 0})).toEqual(ok(false, "LOOPBACK_TOOL_MISSING")); // no ip: still verified, loopback not claimed
    expect(loopbackVerdict({ipPresent: false, stdout: full, hostConnections: 0})).toEqual(ok(true, null)); // the truth wins if lo is up some other way
    expect(loopbackVerdict({ipPresent: true, stdout: "node: not found\n", hostConnections: 0})).toEqual(ok(false, "LOOPBACK_PROBE_NODE_UNAVAILABLE"));
    expect(loopbackVerdict({ipPresent: false, stdout: "", hostConnections: 0})).toEqual(ok(false, "LOOPBACK_TOOL_MISSING"));
    expect(loopbackVerdict({ipPresent: true, stdout: "xprobe_started\nloopback_ok\noutbound_blocked\n", hostConnections: 0})).toEqual(ok(false, "LOOPBACK_PROBE_NODE_UNAVAILABLE")); // tokens match whole lines only
    expect(networkRouteProblem("a\nno_route_out\n")).toBeNull();
    expect(networkRouteProblem("a\nno_route_out_not\n")).toBe("SELFTEST_ROUTE_OUT_EXISTS");
    expect(networkRouteProblem("")).toBe("SELFTEST_ROUTE_OUT_EXISTS");
  });

  it.skipIf(!hostCanIsolate)("a real provider is verified, claims loopback only when it works, and nothing inside can reach the host loopback listener", { timeout: T2 }, async () => {
    const p = new LinuxUnshareSandboxProvider(procOpts);
    expect(p.capabilities).toEqual({loopback: false, loopbackReason: "NOT_PROBED"});
    const st = await p.selfTest();
    expect(st.ok, JSON.stringify(st)).toBe(true);
    expect(p.capabilities).toEqual(hostHasIp ? {loopback: true, loopbackReason: null} : {loopback: false, loopbackReason: "LOOPBACK_TOOL_MISSING"});
    const l = await hostListener(), ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lsx-ws-"));
    try {
      const attempt = `require("net").connect({host:"127.0.0.1",port:${l.port},timeout:2000}).on("connect",()=>{console.log("CONNECTED");process.exit(0)}).on("error",()=>{console.log("BLOCKED");process.exit(0)}).on("timeout",()=>{console.log("BLOCKED");process.exit(0)})`;
      const r = await p.run([process.execPath, "-e", attempt], {cwd: ws, env: {PATH: LINUX_SANDBOX_HELPER_PATH}, timeoutMs: 30_000});
      expect([r.exitCode, r.stdout.trim()]).toEqual([0, "BLOCKED"]);
      expect(l.connections()).toBe(0);
      const rt = await p.run(["sh", "-c", "tail -n +2 /proc/net/route | wc -l"], {cwd: ws, env: {PATH: LINUX_SANDBOX_HELPER_PATH}, timeoutMs: 30_000});
      expect(rt.stdout.trim()).toBe("0");
    } finally { l.srv.close(); fs.rmSync(ws, {recursive: true, force: true}); }
  });

  it.skipIf(!canStub)("with an ip that really brings lo up the provider claims loopback and project code can listen and connect on 127.0.0.1; a no-op or failing ip leaves lo down and the provider unverified", { timeout: T2 }, async () => {
    await withStubIp(PERL_STUB, async () => {
      const p = new LinuxUnshareSandboxProvider(procOpts), st = await p.selfTest();
      expect(st.ok, JSON.stringify(st)).toBe(true);
      expect(p.capabilities).toEqual({loopback: true, loopbackReason: null});
      const ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lsx-ws-"));
      try {
        const both = 'const net=require("net");const s=net.createServer(c=>c.end("pong"));s.listen(0,"127.0.0.1",()=>{net.connect(s.address().port,"127.0.0.1").on("data",d=>{console.log(String(d));process.exit(0)})})';
        const r = await p.run([process.execPath, "-e", both], {cwd: ws, env: {PATH: LINUX_SANDBOX_HELPER_PATH}, timeoutMs: 30_000});
        expect([r.exitCode, r.stdout.trim()]).toEqual([0, "pong"]);
      } finally { fs.rmSync(ws, {recursive: true, force: true}); }
    });
    for (const [label, script] of [["a no-op ip", "#!/bin/sh\nexit 0\n"], ["a failing ip (|| true keeps the namespace alive)", "#!/bin/sh\nexit 1\n"]] as const) {
      await withStubIp(script, async () => {
        const p = new LinuxUnshareSandboxProvider(procOpts);
        expect([label, await p.selfTest()]).toEqual([label, {ok: false, detail: "SELFTEST_LOOPBACK_NOT_AVAILABLE"}]);
        expect(p.capabilities).toEqual({loopback: false, loopbackReason: "NOT_PROBED"});
      });
    }
    expect(fs.existsSync("/usr/sbin/ip")).toBe(false); // the stub never outlives the test
  });
});
