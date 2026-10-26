//TR: Bu dosya dev-run için sağlayıcı kontrollü TEK PORTLUK köprüyü sağlar: sandbox kendi (ayrı) ağ ad alanında çalışır; ana makine yalnız 127.0.0.1:<port> dinler ve her bağlantıyı sandbox'ın ağ ad alanına girip yalnız 127.0.0.1:<aynı port>'a bağlanan sabit bir röle ile iletir. Sandbox'tan ana makineye giden hiçbir yol yoktur; ağ ad alanı ana makineninkiyle AYNIYSA köprü reddedilir (ana makine loopback'ine sızmayı önler).
import cp from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import type {ChildProcess} from "node:child_process";
import type {SandboxProvider} from "./execution-gate.js";

/** HOST: sağlayıcı ana makinenin ağını paylaşır (yalnız test çiftleri); ISOLATED: sandbox'ın kendi ağ ad alanı vardır ve köprü ZORUNLUDUR. */
export type ProviderNetwork = "HOST" | "ISOLATED";
export interface BridgeHandle { readonly port: number; close(): void }
export type BridgeStarter = (child: ChildProcess, port: number) => Promise<BridgeHandle>;
export interface BridgeCapableProvider extends SandboxProvider {
  network?: ProviderNetwork;
  /** Linux sağlayıcısı: selfTest loopback'i (ip link set lo up + dinle/bağlan) KANITLADIYSA loopback=true. */
  capabilities?: {loopback?: boolean; loopbackReason?: string | null};
  /** Sağlayıcının kendi köprüsü (varsa kullanılır). */
  bridge?: BridgeStarter;
}
export type BridgeSupport = {ok: true; network: ProviderNetwork; start: BridgeStarter | null} | {ok: false; reason: string};

const LINUX_ID = "linux-unshare-v2", WSL_ID = "wsl-unshare-v1";
/** Bildirilmeyen sağlayıcı: bilinen gerçek sağlayıcılar ISOLATED, diğerleri (test çiftleri) HOST sayılır. */
export function providerNetwork(p: SandboxProvider): ProviderNetwork {
  const n = (p as BridgeCapableProvider).network;
  if (n === "HOST" || n === "ISOLATED") return n;
  return p.id === LINUX_ID || p.id === WSL_ID ? "ISOLATED" : "HOST";
}

// C-7: relay, hedef kullanıcı ad alanına girdikten sonra yetkileri bırakır (no_new_privs + boş bounding/inheritable/ambient); setpriv yoksa relay BAŞLAMAZ (fail-closed).
const RELAY_DROP = ["/usr/bin/setpriv", "--no-new-privs", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--"] as const;
export interface NsenterOptions { nsenterBinary?: string | null; nodeBinary?: string; maxConnections?: number; idleMs?: number; platform?: NodeJS.Platform; isolationWaitMs?: number }
const RELAY = 'const n=require("node:net");const s=n.connect({host:"127.0.0.1",port:Number(process.argv[1])});process.stdin.pipe(s);s.pipe(process.stdout);s.on("error",()=>process.exit(1));s.on("close",()=>process.exit(0));process.stdin.on("end",()=>s.end());';
function resolveNsenter(): string | null {
  for (const c of ["/usr/bin/nsenter", "/bin/nsenter", "/usr/sbin/nsenter"]) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* sonraki */ } }
  return null;
}
const netNs = (pid: number): string | null => { try { return fs.readlinkSync(`/proc/${pid}/ns/net`); } catch { return null; } };

/** Sağlayıcı bu ürünü barındırabilir mi (süreç başlatılmadan ÖNCE sorulur)? Kesin neden kodu döner; sessiz ana makine çalıştırması yoktur. */
export function bridgeSupport(provider: SandboxProvider, o: NsenterOptions = {}): BridgeSupport {
  const net = providerNetwork(provider);
  if (net === "HOST") return {ok: true, network: net, start: null};
  const p = provider as BridgeCapableProvider;
  if (typeof p.bridge === "function") return {ok: true, network: net, start: p.bridge.bind(p)};
  if (provider.id !== LINUX_ID) return {ok: false, reason: `PROVIDER_HAS_NO_BRIDGE:${provider.id}`};
  if ((o.platform ?? process.platform) !== "linux") return {ok: false, reason: "BRIDGE_PLATFORM_NOT_LINUX"};
  if (p.capabilities?.loopback !== true) return {ok: false, reason: `SANDBOX_LOOPBACK_NOT_VERIFIED:${p.capabilities?.loopbackReason ?? "NOT_REPORTED"}`};
  const bin = o.nsenterBinary === undefined ? resolveNsenter() : o.nsenterBinary;
  if (!bin) return {ok: false, reason: "NSENTER_MISSING"};
  return {ok: true, network: net, start: (child, port) => startNsenterBridge(child, port, {...o, nsenterBinary: bin})};
}

/** 127.0.0.1:<port> dinler; her bağlantı için sandbox'ın kullanıcı+ağ ad alanına girip 127.0.0.1:<port>'a bağlanan sabit röleyi çalıştırır. Yalnız ana makine -> sandbox yönü vardır. */
export async function startNsenterBridge(child: ChildProcess, port: number, o: NsenterOptions = {}): Promise<BridgeHandle> {
  const pid = child.pid;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("BRIDGE_PORT_INVALID");
  if (!Number.isInteger(pid) || (pid as number) <= 1) throw new Error("BRIDGE_TARGET_MISSING");
  const bin = o.nsenterBinary ?? resolveNsenter();
  if (!bin) throw new Error("NSENTER_MISSING");
  // Hedef GERÇEKTEN ayrı bir ağ ad alanında olmalı; aynıysa nsenter ana makine loopback'ine bağlanırdı.
  // Çocuk spawn edildikten hemen sonra henüz unshare(2) çağırmamış olabilir: ağ ad alanı ana makineninkinden FARKLI olana dek kısa süre beklenir; olmazsa ret.
  const own = netNs(process.pid);
  let target = netNs(pid as number);
  for (let i = 0; i < Math.ceil((o.isolationWaitMs ?? 5000) / 25) && (!target || target === own) && child.exitCode === null; i++) { await new Promise(r => setTimeout(r, 25)); target = netNs(pid as number); }
  if (!target || !own || target === own) throw new Error("BRIDGE_TARGET_NOT_ISOLATED");
  const max = o.maxConnections ?? 32, idleMs = o.idleMs ?? 120_000, node = o.nodeBinary ?? process.execPath;
  const live = new Set<net.Socket>(); const kids = new Set<ChildProcess>();
  const server = net.createServer(sock => {
    // PID yeniden kullanımı/çıkış: hedef canlı ve aynı ağ ad alanında değilse bağlantı reddedilir.
    if (live.size >= max || child.exitCode !== null || child.signalCode !== null || netNs(pid as number) !== target) { sock.destroy(); return; }
    live.add(sock); sock.setTimeout(idleMs, () => sock.destroy());
    const r = cp.spawn(bin, ["-U", "--preserve-credentials", "-n", "-t", String(pid), "--", ...RELAY_DROP, node, "-e", RELAY, String(port)], {shell: false, stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: {PATH: "/usr/bin:/bin"}});
    kids.add(r);
    sock.pipe(r.stdin!); r.stdout!.pipe(sock);
    const end = () => { live.delete(sock); kids.delete(r); sock.destroy(); try { r.kill("SIGKILL"); } catch { /* çıkmış */ } };
    sock.on("close", end); sock.on("error", end); r.on("close", end); r.on("error", end); r.stdin!.on("error", () => { /* erken kapanış */ });
  });
  await new Promise<void>((res, rej) => { server.once("error", rej); server.listen(port, "127.0.0.1", () => res()); });
  return {port, close: () => { try { server.close(); } catch { /* kapalı */ } for (const s of live) s.destroy(); for (const k of kids) { try { k.kill("SIGKILL"); } catch { /* çıkmış */ } } live.clear(); kids.clear(); }};
}
