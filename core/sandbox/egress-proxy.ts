// //TR: DSK-T0007: sandbox içindeki gerçek model sürecinin TEK ağ çıkışı. Namespace'in kendi ağı yoktur (unshare --net); süreç HTTPS_PROXY ile yalnız bu yerel CONNECT proxy'sine ulaşır ve proxy yalnız sabit izin listesindeki ana makine adlarına 443 portundan tünel açar. IP adresi, başka port, düz HTTP, CONNECT dışı yöntem, izin dışı ad ve aşırı uzun/bozuk istek reddedilir (fail-closed); hiçbir istek gövdesi okunmaz veya kaydedilmez (TLS uçtan uca kalır). Her karar sabit kodla kaydedilir.
import net from "node:net";

/** Claude Code's subscription login and model traffic (claude.ai sign-in, Anthropic API). Exact names only; no wildcard. */
export const MODEL_EGRESS_ALLOWLIST: readonly string[] = Object.freeze(["api.anthropic.com", "claude.ai", "console.anthropic.com", "statsig.anthropic.com"]);
export type EgressDecision = {allow: true; host: string; port: 443} | {allow: false; code: "NOT_CONNECT" | "MALFORMED" | "IP_LITERAL" | "PORT_NOT_ALLOWED" | "HOST_NOT_ALLOWED"};
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_HEAD = 4096;

/** Pure decision for one request head (the bytes before the first CRLFCRLF). */
export function decideEgress(head: string, allow: readonly string[] = MODEL_EGRESS_ALLOWLIST): EgressDecision {
  const line = head.split("\r\n", 1)[0] ?? "";
  const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(line);
  if (!m) return {allow: false, code: "MALFORMED"};
  if (m[1] !== "CONNECT") return {allow: false, code: "NOT_CONNECT"};
  const t = /^([^:\[\]]+):(\d{1,5})$/.exec(m[2]);
  if (!t) return {allow: false, code: m[2].includes("[") ? "IP_LITERAL" : "MALFORMED"};
  const host = t[1].toLowerCase(), port = Number(t[2]);
  if (net.isIP(host)) return {allow: false, code: "IP_LITERAL"};
  if (!HOST_RE.test(host)) return {allow: false, code: "MALFORMED"};
  if (port !== 443) return {allow: false, code: "PORT_NOT_ALLOWED"};
  if (!allow.includes(host)) return {allow: false, code: "HOST_NOT_ALLOWED"};
  return {allow: true, host, port: 443};
}

export interface EgressProxyOptions {
  allow?: readonly string[];
  /** Upstream connector (tests inject a local target; production: TCP to host:443). */
  connect?: (host: string, port: number) => net.Socket;
  onDecision?: (d: EgressDecision) => void;
  idleTimeoutMs?: number;
}
/** Starts the proxy on 127.0.0.1 (ephemeral port, or a unix socket path for a namespace bind). Resolves with the bound address and a close(). */
export function startEgressProxy(listen: {port: 0} | {path: string}, o: EgressProxyOptions = {}): Promise<{address: net.AddressInfo | string; close: () => Promise<void>}> {
  const allow = o.allow ?? MODEL_EGRESS_ALLOWLIST, connect = o.connect ?? ((h, p) => net.connect({host: h, port: p}));
  const sockets = new Set<net.Socket>();
  const server = net.createServer(client => {
    sockets.add(client); client.on("close", () => sockets.delete(client));
    client.setTimeout(o.idleTimeoutMs ?? 120_000, () => client.destroy());
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) { if (buf.length > MAX_HEAD) { o.onDecision?.({allow: false, code: "MALFORMED"}); client.end("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n"); } return; }
      client.off("data", onData);
      const dec = decideEgress(buf.subarray(0, end).toString("latin1"), allow);
      o.onDecision?.(dec);
      if (!dec.allow) { client.end(`HTTP/1.1 403 Forbidden\r\nX-UASCO-Egress: ${dec.code}\r\n\r\n`); return; }
      const up = connect(dec.host, dec.port); sockets.add(up); up.on("close", () => sockets.delete(up));
      up.once("connect", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); const rest = buf.subarray(end + 4); if (rest.length) up.write(rest); client.pipe(up); up.pipe(client); });
      up.on("error", () => { if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); });
      client.on("error", () => up.destroy());
    };
    client.on("data", onData);
    client.on("error", () => client.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const done = () => resolve({address: server.address() as net.AddressInfo | string, close: () => new Promise<void>(r => { for (const s of sockets) s.destroy(); server.close(() => r()); })});
    if ("path" in listen) server.listen(listen.path, done); else server.listen(0, "127.0.0.1", done);
  });
}
